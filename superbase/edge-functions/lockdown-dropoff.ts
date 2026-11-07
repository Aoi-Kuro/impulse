// Edge Function: lockdown-dropoff
//
// Deploy as the "lockdown-dropoff" Edge Function. Auth mode: "publishable",
// same as sync-quiz-attempts. "Verify JWT with legacy secret" OFF.
//
// Carries lockdown attempts out of Safe Exam Browser, whose separate browser
// has no identity to sync with (see js/lockdown.js). The student's normal
// browser makes a random ticket and passes it in the SEB link. Then:
//   put   — SEB leaves a finished attempt under the ticket
//   get   — the normal browser reads what's there and saves it locally, from
//           where the usual sync-quiz-attempts takes it to the student's Stats
//   clear — the normal browser removes what it has saved. A separate step, so
//           an attempt lost on the way back is simply read again
//
// The ticket is the only credential: whoever holds it can read and clear its
// attempts, which stay here for at most RETENTION_HOURS. Requires
// superbase/migrations/016_lockdown_dropoffs.sql.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "jsr:@supabase/server@^1";

const RETENTION_HOURS = 7 * 24;
const MAX_ATTEMPTS_PER_TICKET = 20;
// Anyone can make up a ticket, so the per-ticket limit alone can't bound the
// table. Real use stays far below this because collected rows are deleted, and
// past it only lockdown saves fail, not the rest of the site.
const MAX_ROWS = 5000;
const MAX_ANSWERS_PER_ATTEMPT = 20;
const MAX_STRING_LEN = 200;

const TICKET_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function isPlainString(v: unknown, maxLen: number): v is string {
  return typeof v === "string" && v.length > 0 && v.length <= maxLen;
}

// Same bounds as validateAttempt() in sync-quiz-attempts.ts, which checks each
// attempt again when the normal browser pushes it.
function isValidAttempt(a: unknown): boolean {
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
    if (typeof y.entered_value !== "string" || y.entered_value.length > MAX_STRING_LEN) return false;
    if (typeof y.entered_unit !== "string" || y.entered_unit.length > MAX_STRING_LEN) return false;
    if (typeof y.points !== "number") return false;
  }
  return true;
}

export default {
  fetch: withSupabase({ auth: "publishable" }, async (req, ctx) => {
    const payload = await req.json().catch(() => null);
    const { action, ticket } = payload ?? {};

    if (typeof ticket !== "string" || !TICKET_PATTERN.test(ticket)) {
      return Response.json({ ok: false, error: "Invalid ticket." }, { status: 400 });
    }

    const admin = ctx.supabaseAdmin;
    const cutoff = new Date(Date.now() - RETENTION_HOURS * 60 * 60 * 1000).toISOString();

    if (action === "put") {
      const attempt = payload?.attempt;
      if (!isValidAttempt(attempt)) {
        return Response.json({ ok: false, error: "Malformed attempt." }, { status: 400 });
      }

      // Nothing else removes rows nobody came back for.
      const { error: expireErr } = await admin.from("lockdown_dropoffs").delete().lt("created_at", cutoff);
      if (expireErr) console.error("lockdown-dropoff: expire error", expireErr);

      const { count, error: countErr } = await admin
        .from("lockdown_dropoffs")
        .select("attempt_hash", { count: "exact", head: true })
        .eq("ticket", ticket);
      const { count: total, error: totalErr } = await admin
        .from("lockdown_dropoffs")
        .select("attempt_hash", { count: "exact", head: true });
      if (countErr || totalErr) {
        console.error("lockdown-dropoff: count error", countErr ?? totalErr);
        return Response.json({ ok: false, error: "Couldn't save the attempt." }, { status: 500 });
      }
      if ((count ?? 0) >= MAX_ATTEMPTS_PER_TICKET) {
        return Response.json({ ok: false, error: "Too many attempts for this ticket." }, { status: 429 });
      }
      if ((total ?? 0) >= MAX_ROWS) {
        console.error("lockdown-dropoff: table is full");
        return Response.json({ ok: false, error: "Saving is full right now." }, { status: 429 });
      }

      const { error: insertErr } = await admin
        .from("lockdown_dropoffs")
        .upsert(
          { ticket, attempt_hash: attempt.attempt_hash, attempt },
          { onConflict: "ticket,attempt_hash", ignoreDuplicates: true },
        );
      if (insertErr) {
        console.error("lockdown-dropoff: insert error", insertErr);
        return Response.json({ ok: false, error: "Couldn't save the attempt." }, { status: 500 });
      }
      return Response.json({ ok: true });
    }

    if (action === "get") {
      const { data, error } = await admin
        .from("lockdown_dropoffs")
        .select("attempt")
        .eq("ticket", ticket)
        .gte("created_at", cutoff);
      if (error) {
        console.error("lockdown-dropoff: read error", error);
        return Response.json({ ok: false, error: "Couldn't read attempts." }, { status: 500 });
      }
      return Response.json({ ok: true, attempts: (data ?? []).map((row) => row.attempt) });
    }

    if (action === "clear") {
      const hashes = payload?.attempt_hashes;
      if (
        !Array.isArray(hashes) || hashes.length > MAX_ATTEMPTS_PER_TICKET ||
        !hashes.every((h) => isPlainString(h, 128))
      ) {
        return Response.json({ ok: false, error: "Invalid attempt list." }, { status: 400 });
      }
      const { error } = await admin
        .from("lockdown_dropoffs")
        .delete()
        .eq("ticket", ticket)
        .in("attempt_hash", hashes);
      if (error) {
        console.error("lockdown-dropoff: clear error", error);
        return Response.json({ ok: false, error: "Couldn't clear attempts." }, { status: 500 });
      }
      return Response.json({ ok: true });
    }

    return Response.json({ ok: false, error: "Unknown action." }, { status: 400 });
  }),
};
