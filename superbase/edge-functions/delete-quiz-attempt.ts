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

async function verifyOrRegisterDevice(db: any, deviceId: string, secret: unknown): Promise<boolean> {
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
    const { device_id, attempt_hash, device_secret } = payload ?? {};

    if (typeof device_id !== "string" || !/^[0-9a-f-]{36}$/i.test(device_id)) {
      return Response.json({ ok: false, error: "Invalid device id." }, { status: 400 });
    }
    if (typeof attempt_hash !== "string" || attempt_hash.length === 0 || attempt_hash.length > 128) {
      return Response.json({ ok: false, error: "Invalid attempt hash." }, { status: 400 });
    }

    const admin = ctx.supabaseAdmin;

    if (!(await verifyOrRegisterDevice(admin, device_id, device_secret))) {
      return Response.json({ ok: false, error: "device_auth_failed" }, { status: 403 });
    }

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

    return Response.json({ ok: true });
  }),
};
