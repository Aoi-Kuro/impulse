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

async function verifyOrRegisterDevice(db: any, deviceId: string, secret: unknown): Promise<boolean> {
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
    const { device_id, quiz_num, cumulative, action, data, device_secret } = payload ?? {};

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

    if (action === "pull") {
      const { data: row, error } = await admin
        .from("solve_all_progress")
        .select("data")
        .eq("identity_id", link.identity_id)
        .eq("quiz_num", quiz_num)
        .eq("cumulative", cum)
        .maybeSingle();
      if (error) {
        console.error("Solve-all pull error:", error);
        return Response.json({ ok: false, error: "Couldn't fetch, try again." }, { status: 500 });
      }
      return Response.json({ ok: true, found: !!row, data: row ? row.data : null });
    }

    if (action === "push") {
      if (typeof data !== "object" || data === null) {
        return Response.json({ ok: false, error: "Missing progress data." }, { status: 400 });
      }
      const { error } = await admin
        .from("solve_all_progress")
        .upsert(
          {
            identity_id: link.identity_id,
            quiz_num,
            cumulative: cum,
            data,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "identity_id,quiz_num,cumulative" },
        );
      if (error) {
        console.error("Solve-all push error:", error);
        return Response.json({ ok: false, error: "Couldn't save, try again." }, { status: 500 });
      }
      return Response.json({ ok: true });
    }

    // action === "reset"
    const { error } = await admin
      .from("solve_all_progress")
      .upsert(
        {
          identity_id: link.identity_id,
          quiz_num,
          cumulative: cum,
          data: null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "identity_id,quiz_num,cumulative" },
      );
    if (error) {
      console.error("Solve-all reset error:", error);
      return Response.json({ ok: false, error: "Couldn't reset, try again." }, { status: 500 });
    }
    return Response.json({ ok: true });
  }),
};
