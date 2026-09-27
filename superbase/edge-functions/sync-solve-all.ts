// Edge Function: sync-solve-all
//
// Deploy as "sync-solve-all". Auth mode: "publishable". "Verify JWT with
// legacy secret" OFF — same conventions as sync-quiz-attempts.ts and
// delete-quiz-attempt.ts.
//
// Handles all three actions the client needs for one solve-all session
// (one quiz_num + cumulative combo) in a single function, keyed the same
// device_id -> identity_devices -> identity_id way as the quiz-attempts
// functions:
//   - "pull":  return the stored row's data (or null if none/reset).
//   - "push":  upsert the client's already-merged snapshot.
//   - "reset": upsert data:null — a *tombstone*, not a delete. A bare
//     missing row can't be told apart from "this device never synced,"
//     but a row that exists with data:null unambiguously means "this was
//     reset since you last synced" — see js/solve-all-sync.js's pull
//     handling for why that distinction matters.
//
// All three responses include identity_id so the client can subscribe to a
// Realtime Broadcast channel scoped to identity+quiz_num+cumulative (see
// migration 004_solve_all_realtime_broadcast.sql) — that's what tells it
// WHEN to run another round trip, instead of a blind interval.
//
// solve_all_progress has RLS enabled with zero policies, same reasoning as
// quiz_attempts (see superbase/migrations/006_quiz_attempts.sql) — it's
// only ever reachable through this SECURITY DEFINER-equivalent (service
// role) path, never a direct client query.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "jsr:@supabase/server@^1";

// ── Device-secret verification (see migration 001_device_secrets.sql) ──────
// device_id alone is public (forum_messages_public), so it can't prove
// device ownership on its own — this endpoint reads/writes solve-all
// progress for a whole identity, same trust requirement as
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
  if (error) { console.error("sync-solve-all: device-auth lookup error", error); return false; }

  if (!row) {
    const salt = randomHex(16);
    const hash = await sha256Hex(`${DEVICE_SECRET_PEPPER}:${salt}:${secret}`);
    const { error: insErr } = await db
      .from("device_secrets").insert({ device_id: deviceId, secret_hash: hash, secret_salt: salt });
    if (!insErr) return true;
    const { data: retryRow, error: retryErr } = await db
      .from("device_secrets").select("secret_hash, secret_salt").eq("device_id", deviceId).maybeSingle();
    if (retryErr || !retryRow) { console.error("sync-solve-all: device-auth race-retry error", retryErr); return false; }
    const retryHash = await sha256Hex(`${DEVICE_SECRET_PEPPER}:${retryRow.secret_salt}:${secret}`);
    return retryHash === retryRow.secret_hash;
  }

  const candidateHash = await sha256Hex(`${DEVICE_SECRET_PEPPER}:${row.secret_salt}:${secret}`);
  return candidateHash === row.secret_hash;
}

export default {
  fetch: withSupabase({ auth: "publishable" }, async (req, ctx) => {
    const payload = await req.json();
    const { device_id, quiz_num, cumulative, action, data, device_secret, device_token, identity_token } = payload ?? {};

    if (typeof device_id !== "string" || !/^[0-9a-f-]{36}$/i.test(device_id)) {
      return Response.json({ ok: false, error: "Invalid device id." }, { status: 400 });
    }
    if (!Number.isInteger(quiz_num) || quiz_num < 1 || quiz_num > 999) {
      return Response.json({ ok: false, error: "Invalid quiz number." }, { status: 400 });
    }
    if (!["pull", "push", "reset"].includes(action)) {
      return Response.json({ ok: false, error: "Invalid action." }, { status: 400 });
    }

    const admin = ctx.supabaseAdmin;
    const cum = !!cumulative;

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

    if (action === "pull") {
      const { data: row, error } = await admin
        .from("solve_all_progress")
        .select("data")
        .eq("identity_id", identityId)
        .eq("quiz_num", quiz_num)
        .eq("cumulative", cum)
        .maybeSingle();
      if (error) {
        console.error("Solve-all pull error:", error);
        return Response.json({ ok: false, error: "Couldn't fetch, try again." }, { status: 500 });
      }
      return Response.json({
        ok: true,
        found: !!row,
        data: row ? row.data : null,
        identity_id: identityId,
        ...(deviceToken ? { device_token: deviceToken.token, device_token_expires_at: deviceToken.expiresAt } : {}),
        ...(identityToken ? { identity_token: identityToken.token, identity_token_expires_at: identityToken.expiresAt } : {}),
      });
    }

    if (action === "push") {
      if (typeof data !== "object" || data === null) {
        return Response.json({ ok: false, error: "Missing progress data." }, { status: 400 });
      }
      const { error } = await admin
        .from("solve_all_progress")
        .upsert(
          {
            identity_id: identityId,
            quiz_num,
            cumulative: cum,
            data,
            device_id, // which device made this write — lets the Realtime
                       // broadcast trigger tag its ping, so the pushing
                       // device itself can ignore its own echo instead of
                       // round-tripping in response to its own write (see
                       // migration 005_solve_all_device_id.sql)
            updated_at: new Date().toISOString(),
          },
          { onConflict: "identity_id,quiz_num,cumulative" },
        );
      if (error) {
        console.error("Solve-all push error:", error);
        return Response.json({ ok: false, error: "Couldn't save, try again." }, { status: 500 });
      }
      return Response.json({
        ok: true,
        identity_id: identityId,
        ...(deviceToken ? { device_token: deviceToken.token, device_token_expires_at: deviceToken.expiresAt } : {}),
        ...(identityToken ? { identity_token: identityToken.token, identity_token_expires_at: identityToken.expiresAt } : {}),
      });
    }

    // action === "reset"
    const { error } = await admin
      .from("solve_all_progress")
      .upsert(
        {
          identity_id: identityId,
          quiz_num,
          cumulative: cum,
          data: null,
          device_id, // see the push branch above for why
          updated_at: new Date().toISOString(),
        },
        { onConflict: "identity_id,quiz_num,cumulative" },
      );
    if (error) {
      console.error("Solve-all reset error:", error);
      return Response.json({ ok: false, error: "Couldn't reset, try again." }, { status: 500 });
    }
    return Response.json({
      ok: true,
      identity_id: identityId,
      ...(deviceToken ? { device_token: deviceToken.token, device_token_expires_at: deviceToken.expiresAt } : {}),
      ...(identityToken ? { identity_token: identityToken.token, identity_token_expires_at: identityToken.expiresAt } : {}),
    });
  }),
};
