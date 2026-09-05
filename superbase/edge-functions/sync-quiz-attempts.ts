// Edge Function: sync-quiz-attempts
//
// Deploy as the "sync-quiz-attempts" Edge Function. Auth mode:
// "publishable", same as post-message/claim-nickname. "Verify JWT with
// legacy secret" OFF.
//
// One call does both directions of sync:
//   1. PUSH — any locally-queued attempts the client sends get upserted
//      (ON CONFLICT (attempt_hash) DO NOTHING — see 006_quiz_attempts.sql
//      for why the hash is what makes this idempotent).
//   2. PULL — the full current list of attempts for this device's identity
//      is returned in the response, which becomes the client's new
//      authoritative local copy. This is also how another device's
//      attempts, or attempts lost to local corruption, come back — the
//      client just calls this with an empty `attempts` array to pull
//      without pushing anything.
//
// Requires superbase/migrations/006_quiz_attempts.sql to have been run
// first. Requires the device to already be linked to a claimed identity
// (js/forum.js's claim flow, same identity_devices table post-message.ts
// and claim-nickname.ts already use) — there is no anonymous/unclaimed path
// here, unlike posting a forum message, because there'd be nothing to
// meaningfully sync TO without one.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "jsr:@supabase/server@^1";

// ── Device-secret verification (see migration 001_device_secrets.sql) ──────
// device_id alone is public (forum_messages_public), so it can't prove
// device ownership on its own — and this endpoint both reads AND writes a
// whole identity's quiz-attempt history, so this matters more here than
// almost anywhere else in the app.
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
  if (error) { console.error("sync-quiz-attempts: device-auth lookup error", error); return false; }

  if (!row) {
    const salt = randomHex(16);
    const hash = await sha256Hex(`${DEVICE_SECRET_PEPPER}:${salt}:${secret}`);
    const { error: insErr } = await db
      .from("device_secrets").insert({ device_id: deviceId, secret_hash: hash, secret_salt: salt });
    if (!insErr) return true;
    const { data: retryRow, error: retryErr } = await db
      .from("device_secrets").select("secret_hash, secret_salt").eq("device_id", deviceId).maybeSingle();
    if (retryErr || !retryRow) { console.error("sync-quiz-attempts: device-auth race-retry error", retryErr); return false; }
    const retryHash = await sha256Hex(`${DEVICE_SECRET_PEPPER}:${retryRow.secret_salt}:${secret}`);
    return retryHash === retryRow.secret_hash;
  }

  const candidateHash = await sha256Hex(`${DEVICE_SECRET_PEPPER}:${row.secret_salt}:${secret}`);
  return candidateHash === row.secret_hash;
}

const MAX_ATTEMPTS_PER_REQUEST = 100; // defensive cap, not a real-world limit
const MAX_ANSWERS_PER_ATTEMPT = 20;   // no quiz has anywhere near this many problems
const MAX_STRING_LEN = 200;           // entered_value/entered_unit/problem_id

interface IncomingAnswer {
  problem_id: string;
  quiz_num: number;
  entered_value: string;
  entered_unit: string;
  points: number;
}

interface IncomingAttempt {
  attempt_hash: string;
  quiz_num: number;
  mode: "single" | "cumulative";
  duration_seconds: number;
  score: number;
  max_score: number;
  answers: IncomingAnswer[];
  attempted_at: string; // ISO date string
}

function isPlainString(v: unknown, maxLen: number): v is string {
  return typeof v === "string" && v.length > 0 && v.length <= maxLen;
}

// Validates one incoming attempt object from the request body against the
// shapes/ranges the table itself enforces (quiz_num 1-4, mode enum, etc.)
// plus a few extra sanity bounds (string lengths, answers array size) the
// table doesn't know about — mirrors the defensive-but-not-paranoid style
// post-message.ts already uses for message payloads.
function validateAttempt(a: unknown): a is IncomingAttempt {
  if (!a || typeof a !== "object") return false;
  const x = a as Record<string, unknown>;
  if (!isPlainString(x.attempt_hash, 128)) return false;
  if (typeof x.quiz_num !== "number" || x.quiz_num < 1 || x.quiz_num > 4) return false;
  if (x.mode !== "single" && x.mode !== "cumulative") return false;
  if (typeof x.duration_seconds !== "number" || x.duration_seconds < 0 || x.duration_seconds > 24 * 60 * 60) return false;
  if (typeof x.score !== "number" || x.score < 0) return false;
  if (typeof x.max_score !== "number" || x.max_score < 0) return false;
  if (typeof x.attempted_at !== "string" || Number.isNaN(Date.parse(x.attempted_at))) return false;
  if (!Array.isArray(x.answers) || x.answers.length > MAX_ANSWERS_PER_ATTEMPT) return false;
  for (const ans of x.answers) {
    if (!ans || typeof ans !== "object") return false;
    const y = ans as Record<string, unknown>;
    if (!isPlainString(y.problem_id, MAX_STRING_LEN)) return false;
    if (typeof y.quiz_num !== "number" || y.quiz_num < 1 || y.quiz_num > 4) return false;
    // entered_value/entered_unit can legitimately be "" (left blank), so no
    // isPlainString (which requires length > 0) here — just a max length.
    if (typeof y.entered_value !== "string" || y.entered_value.length > MAX_STRING_LEN) return false;
    if (typeof y.entered_unit !== "string" || y.entered_unit.length > MAX_STRING_LEN) return false;
    if (typeof y.points !== "number") return false;
  }
  return true;
}

export default {
  fetch: withSupabase({ auth: "publishable" }, async (req, ctx) => {
    const payload = await req.json();
    const { device_id, attempts } = payload ?? {};

    if (typeof device_id !== "string" || !/^[0-9a-f-]{36}$/i.test(device_id)) {
      return Response.json({ ok: false, error: "Invalid device id." }, { status: 400 });
    }
    if (attempts !== undefined && !Array.isArray(attempts)) {
      return Response.json({ ok: false, error: "attempts must be an array." }, { status: 400 });
    }
    const incoming: IncomingAttempt[] = attempts ?? [];
    if (incoming.length > MAX_ATTEMPTS_PER_REQUEST) {
      return Response.json({ ok: false, error: "Too many attempts in one request." }, { status: 400 });
    }
    for (const a of incoming) {
      if (!validateAttempt(a)) {
        return Response.json({ ok: false, error: "Malformed attempt." }, { status: 400 });
      }
    }

    const admin = ctx.supabaseAdmin;

    if (!(await verifyOrRegisterDevice(admin, device_id, payload?.device_secret))) {
      return Response.json({ ok: false, error: "device_auth_failed" }, { status: 403 });
    }

    // Same device -> identity resolution post-message.ts uses for forcing
    // author_name — a device with no linked identity has nothing to sync
    // to, so this is a hard requirement here (unlike posting a forum
    // message, which still allows free-text unclaimed names).
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
      return Response.json({ ok: false, error: "no_identity", message: "Claim a name before syncing." }, { status: 403 });
    }
    const identityId = link.identity_id;

    // Push: identity_id/device_id are set from the resolved link above,
    // never trusted from the request body — same "never trust the client
    // for who they're posting as" principle post-message.ts applies to
    // author_name. ON CONFLICT DO NOTHING on attempt_hash is the entire
    // dedup mechanism (see 006_quiz_attempts.sql) — re-uploading an attempt
    // that's already there, from this device or another one that already
    // synced it, is a silent no-op rather than an error.
    if (incoming.length > 0) {
      const rows = incoming.map((a) => ({
        attempt_hash: a.attempt_hash,
        identity_id: identityId,
        device_id,
        quiz_num: a.quiz_num,
        mode: a.mode,
        duration_seconds: a.duration_seconds,
        score: a.score,
        max_score: a.max_score,
        answers: a.answers,
        attempted_at: a.attempted_at,
      }));
      const { error: insertErr } = await admin
        .from("quiz_attempts")
        .upsert(rows, { onConflict: "attempt_hash", ignoreDuplicates: true });
      if (insertErr) {
        console.error("Quiz attempts insert error:", insertErr);
        return Response.json({ ok: false, error: "Couldn't save attempts, try again." }, { status: 500 });
      }
    }

    // Pull: the full current list for this identity becomes the client's
    // new authoritative local copy, regardless of whether anything was
    // pushed this call — this is what makes "just call sync" also double
    // as "redownload everything" for corrupted-local-data recovery.
    const { data: rows, error: selectErr } = await admin
      .from("quiz_attempts")
      .select("attempt_hash, quiz_num, mode, duration_seconds, score, max_score, answers, attempted_at")
      .eq("identity_id", identityId)
      .order("attempted_at", { ascending: true });

    if (selectErr) {
      console.error("Quiz attempts fetch error:", selectErr);
      return Response.json({ ok: false, error: "Saved, but couldn't refresh your list." }, { status: 500 });
    }

    return Response.json({ ok: true, attempts: rows ?? [] });
  }),
};
