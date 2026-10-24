// Edge Function: sync-settings
//
// Deploy as "sync-settings". Auth mode: "publishable". "Verify JWT with
// legacy secret" OFF — same conventions as sync-solve-all.ts.
//
// One action does everything js/settings-sync.js needs, in a single round
// trip, keyed the same device_id -> identity_devices -> identity_id way as
// the other sync functions:
//   - changes (optional): { code: { v, t } } — the settings this device
//     changed since its last successful sync. Merged per setting by
//     merge_settings_sync() (migration 011_settings_sync.sql): the newer t
//     wins, a tie goes to the higher device id. d is always set here to the
//     sending device_id — never trusted from the client.
//   - known_rev (optional): the rev this device last merged. With no
//     changes and an unchanged rev the reply is just { unchanged: true } —
//     the cheap "anything new?" check every page load and fallback tick
//     makes, which reads one row and sends no settings back.
// Otherwise the reply carries the full merged data and its rev, so a push
// also brings back whatever other devices changed meanwhile.
//
// Every reply carries server_now (ms), which the client uses to correct its
// own clock before stamping changes — a device whose clock runs a day ahead
// would otherwise win every conflict for a day. A t more than a minute in
// the future is clamped to server_now here as well.
//
// settings_sync has RLS enabled with zero policies — reachable only
// through this service-role path, same as solve_all_progress.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "jsr:@supabase/server@^1";

// ── Device-secret verification (see migration 001_device_secrets.sql) ──────
// device_id alone is public (forum_messages_public), so it can't prove
// device ownership on its own — this endpoint reads/writes settings
// for a whole identity, same trust requirement as
// sync-quiz-attempts.ts.
const DEVICE_SECRET_PEPPER = Deno.env.get("DEVICE_SECRET_PEPPER");

async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function randomHex(byteLen: number): string {
  const arr = new Uint8Array(byteLen);
  crypto.getRandomValues(arr);
  return Array.from(arr).map((b) => b.toString(16).padStart(2, "0")).join("");
}

// -- Device-verification token (skips the device_secrets DB round-trip) ----
// verifyOrRegisterDevice() below used to hit `device_secrets` on every call,
// even seconds after the same device had already proven ownership -- the
// #1 source of Log Ingestion/Query volume (device_secrets + identity_devices
// made up 55% of all request logs in a 26-min sample, 2026-09-25). After a
// successful DB-backed verification we now also issue a short-lived signed
// token; a client holding a still-valid token skips the DB check next time.
// identity_devices is deliberately NOT covered by this -- that lookup stays
// live everywhere, since claim/drop-nickname can reassign device_id to a
// different identity at any moment and a cached identity would go stale.
// Security note: this token is not a weaker credential than device_secret
// itself -- both live in the same client-side (localStorage) trust
// boundary. It only bounds *how long* a proof of ownership is honored for,
// the same way a session cookie bounds a login.
const DEVICE_TOKEN_SECRET = Deno.env.get("DEVICE_TOKEN_SECRET");
const DEVICE_TOKEN_TTL_SECONDS = 12 * 60 * 60;

async function hmacHex(payload: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(DEVICE_TOKEN_SECRET!),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function issueDeviceToken(deviceId: string): Promise<{ token: string; expiresAt: number } | null> {
  if (!DEVICE_TOKEN_SECRET) return null; // secret not set yet -- fails open to DB-only mode
  const expiresAt = Math.floor(Date.now() / 1000) + DEVICE_TOKEN_TTL_SECONDS;
  const payload = `${deviceId}:${expiresAt}`;
  const token = btoa(payload) + "." + await hmacHex(payload);
  return { token, expiresAt };
}

async function verifyDeviceToken(deviceId: string, token: unknown): Promise<boolean> {
  if (!DEVICE_TOKEN_SECRET || typeof token !== "string" || !token.includes(".")) return false;
  const [encoded, sig] = token.split(".");
  let payload: string;
  try { payload = atob(encoded); } catch { return false; }
  const [tokenDeviceId, expiresAtStr] = payload.split(":");
  if (tokenDeviceId !== deviceId) return false;
  const expiresAt = Number(expiresAtStr);
  if (!Number.isFinite(expiresAt) || Date.now() / 1000 > expiresAt) return false;
  const expected = await hmacHex(payload);
  if (expected.length !== sig.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ sig.charCodeAt(i);
  return diff === 0;
}

// -- Identity-resolution token (skips the identity_devices DB round-trip) --
// identity_devices resolves device_id -> identity_id (which claimed
// nickname, if any, currently owns this device). It's deliberately NOT
// covered by the long-lived device token above -- device_id can be
// reassigned to a different identity mid-session (exit, then claim a new
// nickname on the same device), and a stale cache here would misattribute
// posts/edits/syncs to the identity that just left. Instead it gets its own
// much shorter-lived token (see IDENTITY_TOKEN_TTL_SECONDS below): short
// enough that a stolen/leaked token's usefulness expires in under five
// minutes, and drop-nickname (the one action that actually invalidates this)
// tells the client to delete its copy immediately rather than wait it out --
// see js/forum.js's storage-event listener for the other open-tabs half of
// that.
const IDENTITY_TOKEN_TTL_SECONDS = 300;

async function issueIdentityToken(deviceId: string, identityId: string | null): Promise<{ token: string; expiresAt: number } | null> {
  if (!DEVICE_TOKEN_SECRET) return null;
  const expiresAt = Math.floor(Date.now() / 1000) + IDENTITY_TOKEN_TTL_SECONDS;
  const payload = `${deviceId}:${identityId ?? ""}:${expiresAt}`;
  const token = btoa(payload) + "." + await hmacHex(payload);
  return { token, expiresAt };
}

// Returns { ok: false } on any invalid/expired/mismatched token -- caller
// falls back to the normal identity_devices DB lookup exactly as before.
// Returns { ok: true, identityId: null } for a device confirmed NOT linked
// to any identity (a lurker), so that case is cached too, not just the
// linked case.
async function verifyIdentityToken(deviceId: string, token: unknown): Promise<{ ok: true; identityId: string | null } | { ok: false }> {
  if (!DEVICE_TOKEN_SECRET || typeof token !== "string" || !token.includes(".")) return { ok: false };
  const [encoded, sig] = token.split(".");
  let payload: string;
  try { payload = atob(encoded); } catch { return { ok: false }; }
  const parts = payload.split(":");
  if (parts.length !== 3) return { ok: false };
  const [tokenDeviceId, identityIdPart, expiresAtStr] = parts;
  if (tokenDeviceId !== deviceId) return { ok: false };
  const expiresAt = Number(expiresAtStr);
  if (!Number.isFinite(expiresAt) || Date.now() / 1000 > expiresAt) return { ok: false };
  const expected = await hmacHex(payload);
  if (expected.length !== sig.length) return { ok: false };
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ sig.charCodeAt(i);
  if (diff !== 0) return { ok: false };
  return { ok: true, identityId: identityIdPart === "" ? null : identityIdPart };
}

async function verifyOrRegisterDevice(db: any, deviceId: string, secret: unknown, token?: unknown): Promise<boolean> {
  if (await verifyDeviceToken(deviceId, token)) return true;
  if (!DEVICE_SECRET_PEPPER || typeof secret !== "string" || secret.length < 16 || secret.length > 200) {
    return false;
  }
  const { data: row, error } = await db
    .from("device_secrets").select("secret_hash, secret_salt").eq("device_id", deviceId).maybeSingle();
  if (error) { console.error("sync-settings: device-auth lookup error", error); return false; }

  if (!row) {
    const salt = randomHex(16);
    const hash = await sha256Hex(`${DEVICE_SECRET_PEPPER}:${salt}:${secret}`);
    const { error: insErr } = await db
      .from("device_secrets").insert({ device_id: deviceId, secret_hash: hash, secret_salt: salt });
    if (!insErr) return true;
    const { data: retryRow, error: retryErr } = await db
      .from("device_secrets").select("secret_hash, secret_salt").eq("device_id", deviceId).maybeSingle();
    if (retryErr || !retryRow) { console.error("sync-settings: device-auth race-retry error", retryErr); return false; }
    const retryHash = await sha256Hex(`${DEVICE_SECRET_PEPPER}:${retryRow.secret_salt}:${secret}`);
    return retryHash === retryRow.secret_hash;
  }

  const candidateHash = await sha256Hex(`${DEVICE_SECRET_PEPPER}:${row.secret_salt}:${secret}`);
  return candidateHash === row.secret_hash;
}

// ── Payload limits ──────────────────────────────────────────────────────
// Codes look like "display.showAvatar" or "customTheme.night". One push
// carries at most MAX_CHANGES of them, each value at most MAX_VALUE_CHARS
// of JSON; merge_settings_sync() caps the stored total at 200 codes.
const CODE_RE = /^[A-Za-z][A-Za-z0-9_]{0,31}\.[A-Za-z][A-Za-z0-9_]{0,47}$/;
const MAX_CHANGES = 80;
const MAX_VALUE_CHARS = 2000;
const FUTURE_SLACK_MS = 60 * 1000;

// Returns the cleaned { code: { v, t, d } } map, or an error message.
function cleanChanges(raw: unknown, deviceId: string, now: number): Record<string, { v: unknown; t: number; d: string }> | string {
  if (raw == null) return {};
  if (typeof raw !== "object" || Array.isArray(raw)) return "Invalid changes.";
  const entries = Object.entries(raw as Record<string, unknown>);
  if (entries.length > MAX_CHANGES) return "Too many changes.";
  const out: Record<string, { v: unknown; t: number; d: string }> = {};
  for (const [code, entry] of entries) {
    if (!CODE_RE.test(code)) return "Invalid setting code.";
    if (!entry || typeof entry !== "object") return "Invalid change.";
    const { v, t } = entry as { v: unknown; t: unknown };
    if (v === undefined) return "Missing value.";
    if (JSON.stringify(v).length > MAX_VALUE_CHARS) return "Value too large.";
    if (typeof t !== "number" || !Number.isFinite(t) || t < 0) return "Invalid time.";
    const stamp = Math.floor(t);
    out[code] = { v, t: stamp > now + FUTURE_SLACK_MS ? now : stamp, d: deviceId };
  }
  return out;
}

export default {
  fetch: withSupabase({ auth: "publishable" }, async (req, ctx) => {
    const payload = await req.json();
    const { device_id, changes, known_rev, device_secret, device_token, identity_token } = payload ?? {};
    const now = Date.now();

    if (typeof device_id !== "string" || !/^[0-9a-f-]{36}$/i.test(device_id)) {
      return Response.json({ ok: false, error: "Invalid device id." }, { status: 400 });
    }
    const cleaned = cleanChanges(changes, device_id, now);
    if (typeof cleaned === "string") {
      return Response.json({ ok: false, error: cleaned }, { status: 400 });
    }

    const admin = ctx.supabaseAdmin;

    if (!(await verifyOrRegisterDevice(admin, device_id, device_secret, device_token))) {
      return Response.json({ ok: false, error: "device_auth_failed" }, { status: 403 });
    }
    const deviceToken = await issueDeviceToken(device_id);

    let identityId: string | null = null;
    const identityCheck = await verifyIdentityToken(device_id, identity_token);
    if (identityCheck.ok) {
      identityId = identityCheck.identityId;
    } else {
      const { data: link, error: linkErr } = await admin
        .from("identity_devices")
        .select("identity_id")
        .eq("device_id", device_id)
        .maybeSingle();
      if (linkErr) {
        console.error("Identity link lookup error:", linkErr);
        return Response.json({ ok: false, error: "Couldn't verify your identity, try again." }, { status: 500 });
      }
      identityId = link ? link.identity_id : null;
    }
    if (!identityId) {
      return Response.json({ ok: false, error: "no_identity", message: "Claim a name first." }, { status: 403 });
    }
    const identityToken = await issueIdentityToken(device_id, identityId);

    const tokens = {
      ...(deviceToken ? { device_token: deviceToken.token, device_token_expires_at: deviceToken.expiresAt } : {}),
      ...(identityToken ? { identity_token: identityToken.token, identity_token_expires_at: identityToken.expiresAt } : {}),
    };

    let data: Record<string, unknown> = {};
    let rev = 0;

    if (Object.keys(cleaned).length) {
      const { data: merged, error } = await admin.rpc("merge_settings_sync", {
        p_identity: identityId,
        p_device: device_id,
        p_changes: cleaned,
      });
      if (error || !merged) {
        console.error("Settings merge error:", error);
        return Response.json({ ok: false, error: "Couldn't save, try again." }, { status: 500 });
      }
      data = merged.data ?? {};
      rev = Number(merged.rev) || 0;
    } else {
      const { data: row, error } = await admin
        .from("settings_sync")
        .select("data, rev")
        .eq("identity_id", identityId)
        .maybeSingle();
      if (error) {
        console.error("Settings pull error:", error);
        return Response.json({ ok: false, error: "Couldn't fetch, try again." }, { status: 500 });
      }
      rev = row ? Number(row.rev) || 0 : 0;
      if (Number.isInteger(known_rev) && known_rev === rev) {
        return Response.json({ ok: true, unchanged: true, rev, identity_id: identityId, server_now: now, ...tokens });
      }
      data = row ? row.data ?? {} : {};
    }

    return Response.json({ ok: true, data, rev, identity_id: identityId, server_now: now, ...tokens });
  }),
};
