// Setup type definitions for built-in Supabase Runtime APIs
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "jsr:@supabase/server@^1";

interface SubscribePayload {
  action: "subscribe" | "unsubscribe";
  device_id: string;
  device_secret?: string;
  device_token?: string;
  identity_token?: string;
  endpoint?: string;
  keys?: { p256dh: string; auth: string };
}

// ── Device-secret verification (see migration 001_device_secrets.sql) ──────
// device_id alone is public (forum_messages_public), so it can't prove
// device ownership on its own — without this, anyone could unsubscribe (or
// re-point a subscribe onto) someone else's push endpoint by copying their
// device_id off the forum.
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
  if (error) { console.error("save-push-subscription: device-auth lookup error", error); return false; }

  if (!row) {
    const salt = randomHex(16);
    const hash = await sha256Hex(`${DEVICE_SECRET_PEPPER}:${salt}:${secret}`);
    const { error: insErr } = await db
      .from("device_secrets").insert({ device_id: deviceId, secret_hash: hash, secret_salt: salt });
    if (!insErr) return true;
    const { data: retryRow, error: retryErr } = await db
      .from("device_secrets").select("secret_hash, secret_salt").eq("device_id", deviceId).maybeSingle();
    if (retryErr || !retryRow) { console.error("save-push-subscription: device-auth race-retry error", retryErr); return false; }
    const retryHash = await sha256Hex(`${DEVICE_SECRET_PEPPER}:${retryRow.secret_salt}:${secret}`);
    return retryHash === retryRow.secret_hash;
  }

  const candidateHash = await sha256Hex(`${DEVICE_SECRET_PEPPER}:${row.secret_salt}:${secret}`);
  return candidateHash === row.secret_hash;
}

export default {
  fetch: withSupabase({ auth: "publishable" }, async (req, ctx) => {
    const payload: SubscribePayload = await req.json();
    const { action, device_id, device_secret, device_token, identity_token, endpoint, keys } = payload ?? {};

    // ctx.supabaseAdmin bypasses RLS — push_subscriptions has zero client
    // policies (see migration 014), so this is the only client that can
    // touch this table at all.
    const admin = ctx.supabaseAdmin;

    if (typeof device_id !== "string" || !/^[0-9a-f-]{36}$/i.test(device_id)) {
      return Response.json({ ok: false, error: "Invalid device id." }, { status: 400 });
    }
    if (!(await verifyOrRegisterDevice(admin, device_id, device_secret, device_token))) {
      return Response.json({ ok: false, error: "device_auth_failed" }, { status: 403 });
    }
    const deviceToken = await issueDeviceToken(device_id);
    if (typeof endpoint !== "string" || !endpoint.startsWith("https://")) {
      return Response.json({ ok: false, error: "Invalid subscription endpoint." }, { status: 400 });
    }

    if (action === "unsubscribe") {
      // Scoped to device_id too, not just endpoint, so one device can't
      // drop a subscription it doesn't own even if it somehow knew the
      // endpoint string (it's not secret, just unique).
      const { error } = await admin
        .from("push_subscriptions")
        .delete()
        .eq("endpoint", endpoint)
        .eq("device_id", device_id);
      if (error) {
        console.error("Push unsubscribe error:", error);
        return Response.json({ ok: false, error: "Couldn't remove subscription." }, { status: 500 });
      }
      return Response.json({
        ok: true,
        ...(deviceToken ? { device_token: deviceToken.token, device_token_expires_at: deviceToken.expiresAt } : {}),
      });
    }

    if (action !== "subscribe") {
      return Response.json({ ok: false, error: "Invalid action." }, { status: 400 });
    }
    if (!keys || typeof keys.p256dh !== "string" || typeof keys.auth !== "string") {
      return Response.json({ ok: false, error: "Missing subscription keys." }, { status: 400 });
    }

    // Resolve this device's claimed identity, if any — same identity_devices
    // lookup post-message.ts runs before every post, so a subscription
    // always follows whichever identity is actually claimed on this device
    // right now, and updates automatically the next time this endpoint
    // re-subscribes under a different claim.
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
      if (linkErr) console.error("Identity link lookup error (push subscribe):", linkErr);
      identityId = link?.identity_id ?? null;
    }
    const identityToken = await issueIdentityToken(device_id, identityId);

    const { error: upsertErr } = await admin.from("push_subscriptions").upsert(
      {
        device_id,
        identity_id: identityId,
        endpoint,
        p256dh: keys.p256dh,
        auth: keys.auth,
      },
      { onConflict: "endpoint" }
    );

    if (upsertErr) {
      console.error("Push subscribe error:", upsertErr);
      return Response.json({ ok: false, error: "Couldn't save subscription." }, { status: 500 });
    }
    return Response.json({
      ok: true,
      ...(deviceToken ? { device_token: deviceToken.token, device_token_expires_at: deviceToken.expiresAt } : {}),
      ...(identityToken ? { identity_token: identityToken.token, identity_token_expires_at: identityToken.expiresAt } : {}),
    });
  }),
};
