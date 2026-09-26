// Edge Function: delete-quiz-attempt
//
// Deploy as "delete-quiz-attempt". Auth mode: "publishable", same as
// sync-quiz-attempts. "Verify JWT with legacy secret" OFF.
//
// Fills the gap noted in QUIZ_ATTEMPTS_SYNC_NOTES.md ("No delete-from-
// server"): deleteAttempt() in js/stats.js used to only remove the local
// copy, so a synced attempt would reappear on the next sync. This deletes
// the row server-side too, scoped to the resolved identity — a device can
// only delete attempts belonging to its own linked identity, never an
// arbitrary hash, same trust model sync-quiz-attempts.ts already uses for
// device_id -> identity_id resolution.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "jsr:@supabase/server@^1";

// ── Device-secret verification (see migration 001_device_secrets.sql) ──────
// device_id alone is public (forum_messages_public), so it can't prove
// device ownership on its own — device_secret is the real proof, generated
// once on the client and never sent by anyone but its owner.
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

async function verifyOrRegisterDevice(db: any, deviceId: string, secret: unknown, token?: unknown): Promise<boolean> {
  if (await verifyDeviceToken(deviceId, token)) return true;
  if (!DEVICE_SECRET_PEPPER || typeof secret !== "string" || secret.length < 16 || secret.length > 200) {
    return false;
  }
  const { data: row, error } = await db
    .from("device_secrets").select("secret_hash, secret_salt").eq("device_id", deviceId).maybeSingle();
  if (error) { console.error("delete-quiz-attempt: device-auth lookup error", error); return false; }

  if (!row) {
    const salt = randomHex(16);
    const hash = await sha256Hex(`${DEVICE_SECRET_PEPPER}:${salt}:${secret}`);
    const { error: insErr } = await db
      .from("device_secrets").insert({ device_id: deviceId, secret_hash: hash, secret_salt: salt });
    if (!insErr) return true;
    const { data: retryRow, error: retryErr } = await db
      .from("device_secrets").select("secret_hash, secret_salt").eq("device_id", deviceId).maybeSingle();
    if (retryErr || !retryRow) { console.error("delete-quiz-attempt: device-auth race-retry error", retryErr); return false; }
    const retryHash = await sha256Hex(`${DEVICE_SECRET_PEPPER}:${retryRow.secret_salt}:${secret}`);
    return retryHash === retryRow.secret_hash;
  }

  const candidateHash = await sha256Hex(`${DEVICE_SECRET_PEPPER}:${row.secret_salt}:${secret}`);
  return candidateHash === row.secret_hash;
}

export default {
  fetch: withSupabase({ auth: "publishable" }, async (req, ctx) => {
    const payload = await req.json();
    const { device_id, attempt_hash, device_secret, device_token } = payload ?? {};

    if (typeof device_id !== "string" || !/^[0-9a-f-]{36}$/i.test(device_id)) {
      return Response.json({ ok: false, error: "Invalid device id." }, { status: 400 });
    }
    if (typeof attempt_hash !== "string" || attempt_hash.length === 0 || attempt_hash.length > 128) {
      return Response.json({ ok: false, error: "Invalid attempt hash." }, { status: 400 });
    }

    const admin = ctx.supabaseAdmin;

    if (!(await verifyOrRegisterDevice(admin, device_id, device_secret, device_token))) {
      return Response.json({ ok: false, error: "device_auth_failed" }, { status: 403 });
    }
    const deviceToken = await issueDeviceToken(device_id);

    const { data: link, error: linkErr } = await admin
      .from("identity_devices")
      .select("identity_id")
      .eq("device_id", device_id)
      .maybeSingle();

    if (linkErr) {
      console.error("Identity link lookup error:", linkErr);
      return Response.json({ ok: false, error: "Couldn't verify your identity, try again." }, { status: 500 });
    }
    if (!link) {
      return Response.json({ ok: false, error: "no_identity", message: "Claim a name first." }, { status: 403 });
    }

    // Scoped to identity_id, not just attempt_hash — a device can only ever
    // delete its own identity's attempts, never someone else's by guessing
    // a hash.
    const { error: delErr } = await admin
      .from("quiz_attempts")
      .delete()
      .eq("attempt_hash", attempt_hash)
      .eq("identity_id", link.identity_id);

    if (delErr) {
      console.error("Quiz attempt delete error:", delErr);
      return Response.json({ ok: false, error: "Couldn't delete, try again." }, { status: 500 });
    }

    return Response.json({
      ok: true,
      ...(deviceToken ? { device_token: deviceToken.token, device_token_expires_at: deviceToken.expiresAt } : {}),
    });
  }),
};
