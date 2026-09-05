// Edge Function: flag-message
//
// Deploy as a NEW Edge Function named "flag-message". Same auth mode as your
// other functions: "publishable", "Verify JWT with legacy secret" OFF.
// Uses GEMINI_API_KEY — already set project-wide for post-message, nothing
// new to configure there (Edge Function secrets are shared across every
// function in the project, not per-function).
//
// Flow for one flag tap:
//   1. Rate-limit check: 5 flags per device per rolling hour, across ALL
//      messages (see forum_flags in sql/forum_flags.sql).
//   2. Atomically "claim" the message for review (flag_status: null →
//      'reviewing') — this is what stops a double-tap, or two different
//      people flagging at once, from triggering two Gemini calls on the
//      same message. If the claim fails, the message was either already
//      reviewed (kept/deleted) or is mid-review right now.
//   3. Fetch nearby messages (same thread) before AND after the flagged one,
//      for context.
//   4. Ask Gemini to judge ONLY the flagged message's own content — context
//      is explicitly framed as background, never grounds for deletion on
//      its own (see FLAG_SYSTEM_INSTRUCTIONS below for exactly how that's
//      worded, since this is the part most likely to go wrong).
//   5. Any failure/uncertainty from Gemini → keep the message. A stuck or
//      wrongly-deleted message is a worse failure mode than an occasional
//      bad one staying up an extra moment.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "jsr:@supabase/server@^1";

const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY")!;
const GEMINI_MODEL = "gemini-3.5-flash-lite";

// ── Device-secret verification (see migration 001_device_secrets.sql) ──────
// device_id alone is public (forum_messages_public), so it can't prove
// device ownership on its own — without this, anyone could submit flags
// under someone else's device_id, burning their rate-limit quota and
// misattributing who reported what in forum_flags.
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
  if (error) { console.error("flag-message: device-auth lookup error", error); return false; }

  if (!row) {
    const salt = randomHex(16);
    const hash = await sha256Hex(`${DEVICE_SECRET_PEPPER}:${salt}:${secret}`);
    const { error: insErr } = await db
      .from("device_secrets").insert({ device_id: deviceId, secret_hash: hash, secret_salt: salt });
    if (!insErr) return true;
    const { data: retryRow, error: retryErr } = await db
      .from("device_secrets").select("secret_hash, secret_salt").eq("device_id", deviceId).maybeSingle();
    if (retryErr || !retryRow) { console.error("flag-message: device-auth race-retry error", retryErr); return false; }
    const retryHash = await sha256Hex(`${DEVICE_SECRET_PEPPER}:${retryRow.secret_salt}:${secret}`);
    return retryHash === retryRow.secret_hash;
  }

  const candidateHash = await sha256Hex(`${DEVICE_SECRET_PEPPER}:${row.secret_salt}:${secret}`);
  return candidateHash === row.secret_hash;
}

const MAX_FLAGS_PER_HOUR = 5;
const CONTEXT_MESSAGES_EACH_SIDE = 5;

// ── Escalating bans on the message's own author ─────────────────────────────
// 3 red flags (deleted messages) within a rolling 24h window bans the
// device. Duration escalates by ban_level, then holds at the last entry
// forever after (see registerRedFlag below).
const RED_FLAGS_TO_BAN = 3;
const RED_FLAG_WINDOW_MS = 24 * 60 * 60_000;
const BAN_DURATIONS_H = [24, 48, 72];

// Bumps the rolling red-flag counter for one ban "subject" (either a
// device_id, for an unclaimed poster, or an identity_id, for a claimed
// nickname — see registerRedFlag below for which one is chosen). Returns
// { bannedUntil, banLevel } — bannedUntil is null unless a ban was just
// newly issued by *this* call.
async function bumpBanCounter(admin: any, table: "device_bans" | "identity_bans", keyColumn: string, keyValue: string) {
  const now = new Date();
  const { data: row, error } = await admin
    .from(table)
    .select("flag_count, window_started_at, ban_level")
    .eq(keyColumn, keyValue)
    .maybeSingle();
  if (error) { console.error(`bumpBanCounter(${table}) lookup error:`, error); return null; }

  let flagCount = 1;
  let windowStart: string | null = now.toISOString();
  let banLevel = row?.ban_level ?? 0;

  if (row?.window_started_at && now.getTime() - new Date(row.window_started_at).getTime() <= RED_FLAG_WINDOW_MS) {
    flagCount = (row.flag_count ?? 0) + 1;
    windowStart = row.window_started_at;
  }

  let bannedUntil: string | null = null;
  if (flagCount >= RED_FLAGS_TO_BAN) {
    const durationH = BAN_DURATIONS_H[Math.min(banLevel, BAN_DURATIONS_H.length - 1)];
    bannedUntil = new Date(now.getTime() + durationH * 60 * 60_000).toISOString();
    banLevel = banLevel + 1;
    flagCount = 0;
    windowStart = null;
  }

  const { error: upsertErr } = await admin.from(table).upsert({
    [keyColumn]: keyValue,
    flag_count: flagCount,
    window_started_at: windowStart,
    ban_level: banLevel,
    banned_until: bannedUntil,
    updated_at: now.toISOString(),
  });
  if (upsertErr) { console.error(`bumpBanCounter(${table}) upsert error:`, upsertErr); return null; }

  return { bannedUntil, banLevel };
}

// Best-effort, non-blocking for the caller's own verdict: a failure here
// just means this one red flag didn't count toward a ban, not that the
// deletion itself fails.
//
// identityId is the flagged message's OWN forum_messages.identity_id — a
// snapshot taken by post-message.ts at the moment it was posted — not a
// fresh identity_devices lookup by device_id. That distinction matters:
// device_id can be reassigned to a different identity later (exit device,
// then someone else claims a nickname on it), and re-deriving "who posted
// this" from the device at flag time would attribute the ban to whoever
// owns the device NOW, not whoever actually wrote the flagged message. See
// the migration that added forum_messages.identity_id for the full story.
//
// If the message had a claimed identity, the ban is issued against that
// identity_id (survives renames and "exit device" — see identity_bans in
// the migration), and then mirrored onto device_bans for every device
// *currently* linked to that identity, so a raw device-id check alone still
// catches it. An unclaimed poster (no identity) is banned by device_id
// directly, same as before.
async function registerRedFlag(admin: any, deviceId: string, identityId: string | null) {
  try {
    if (!identityId) {
      await bumpBanCounter(admin, "device_bans", "device_id", deviceId);
      return;
    }

    const result = await bumpBanCounter(admin, "identity_bans", "identity_id", identityId);
    if (!result?.bannedUntil) return; // no new ban issued this call

    const { data: devices, error: devicesErr } = await admin
      .from("identity_devices")
      .select("device_id")
      .eq("identity_id", identityId);
    if (devicesErr) { console.error("registerRedFlag device-fanout lookup error:", devicesErr); return; }

    const now = new Date().toISOString();
    for (const d of devices || []) {
      const { error: mirrorErr } = await admin.from("device_bans").upsert({
        device_id: d.device_id,
        flag_count: 0,
        window_started_at: null,
        ban_level: result.banLevel,
        banned_until: result.bannedUntil,
        updated_at: now,
      });
      if (mirrorErr) console.error("registerRedFlag device-mirror upsert error:", mirrorErr);
    }
  } catch (err) {
    console.error("registerRedFlag failed:", err);
  }
}

function isUuid(v: unknown): v is string {
  return typeof v === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
}

// The exact separation of "flagged message" vs "context" — and the explicit
// instruction that context never justifies deletion on its own — is the
// direct answer to "what if the considered message is fine but the context
// isn't": Gemini is told point-blank that only the flagged message's own
// content is on trial.
const FLAG_SYSTEM_INSTRUCTIONS = `
You are reviewing ONE flagged message from a student physics course forum.
You will be given nearby messages from the same thread labeled "CONTEXT
MESSAGES", and the message someone flagged, labeled "THE FLAGGED MESSAGE".

Your only job: decide whether THE FLAGGED MESSAGE, judged on its own words,
is bad enough to remove — harassment, hate speech, sexual content, threats,
doxxing, or spam.

Critical rules:
- Judge ONLY the flagged message's own content. CONTEXT MESSAGES exist
  purely so you understand what it's replying to or referencing — they are
  NEVER grounds to delete the flagged message. If the flagged message itself
  reads as fine but the context around it is bad, the correct answer is
  false (keep it) — someone else's bad message is not this message's fault.
- If the flagged message is mild, ambiguous, sarcastic-but-harmless, ordinary
  rude banter between people who clearly know each other, or a restrained
  reaction to something bad someone else said, KEEP IT.
- Only answer true if you are confident. "Somewhat suspicious" is not
  enough — default to keeping whenever you are not certain. Removing a real,
  harmless message is a worse outcome than leaving one borderline message up.
- Do not allow бранные русские выражения, including that separated by spaces like "пи здец" or "су ка"

Respond with ONLY a JSON object, nothing else:
{"delete": true or false, "reason": "under 10 words, plain text"}
The "reason" is shown publicly if delete is true, so phrase it plainly
(e.g. "targeted personal insult", "sexual content", "spam link") — never
quote or restate the message itself.
`.trim();

async function fetchContext(admin: any, scope: string, problemKey: string | null, messageId: number) {
  let beforeQuery = admin
    .from("forum_messages")
    .select("id, author_name, body")
    .eq("scope", scope)
    .lt("id", messageId)
    .order("id", { ascending: false })
    .limit(CONTEXT_MESSAGES_EACH_SIDE);
  let afterQuery = admin
    .from("forum_messages")
    .select("id, author_name, body")
    .eq("scope", scope)
    .gt("id", messageId)
    .order("id", { ascending: true })
    .limit(CONTEXT_MESSAGES_EACH_SIDE);

  if (scope === "problem" && problemKey) {
    beforeQuery = beforeQuery.eq("problem_key", problemKey);
    afterQuery = afterQuery.eq("problem_key", problemKey);
  }

  const [{ data: before }, { data: after }] = await Promise.all([beforeQuery, afterQuery]);
  const beforeChrono = (before || []).slice().reverse();
  return [...beforeChrono, ...(after || [])];
}

async function callGeminiFlagReview(
  flagged: { author_name: string; body: string },
  context: { author_name: string; body: string }[]
): Promise<{ delete: boolean; reason: string } | null> {
  const contextBlock = context.length
    ? context.map(m => `${m.author_name}: ${m.body}`).join("\n")
    : "(no nearby messages)";

  // Two clearly separated, explicitly labeled blocks — deliberately not
  // interleaved with the flagged message, so there's no ambiguity about
  // which text is actually under review.
  const userContent =
    `CONTEXT MESSAGES (background only — never grounds for deletion by themselves):\n${contextBlock}\n\n` +
    `THE FLAGGED MESSAGE (the ONLY thing being judged):\n${flagged.author_name}: ${flagged.body}`;

  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": GEMINI_API_KEY },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: FLAG_SYSTEM_INSTRUCTIONS }] },
          contents: [{ role: "user", parts: [{ text: userContent }] }],
          generationConfig: {
            responseMimeType: "application/json",
            responseSchema: {
              type: "OBJECT",
              properties: {
                delete: { type: "BOOLEAN" },
                reason: { type: "STRING" },
              },
              required: ["delete", "reason"],
            },
          },
        }),
      }
    );
    if (!res.ok) {
      console.error("Gemini flag-review API error:", await res.text());
      return null;
    }
    const data = await res.json();
    const text = data?.candidates?.[0]?.content?.parts?.map((p: any) => p.text).join("");
    if (!text) return null;
    const parsed = JSON.parse(text);
    if (typeof parsed.delete !== "boolean" || typeof parsed.reason !== "string") return null;
    return { delete: parsed.delete, reason: parsed.reason.trim() };
  } catch (err) {
    console.error("Gemini flag-review call failed:", err);
    return null;
  }
}

export default {
  fetch: withSupabase({ auth: "publishable" }, async (req, ctx) => {
    if (req.method !== "POST") {
      return Response.json({ ok: false, error: "method_not_allowed" }, { status: 405 });
    }

    let payload: any;
    try {
      payload = await req.json();
    } catch {
      return Response.json({ ok: false, error: "bad_json" }, { status: 400 });
    }

    const deviceId = payload?.device_id;
    const messageId = Number(payload?.message_id);

    if (!isUuid(deviceId)) {
      return Response.json({ ok: false, error: "invalid_device_id" }, { status: 400 });
    }
    if (!Number.isInteger(messageId) || messageId <= 0) {
      return Response.json({ ok: false, error: "invalid_message_id" }, { status: 400 });
    }

    const admin = ctx.supabaseAdmin;

    if (!(await verifyOrRegisterDevice(admin, deviceId, payload?.device_secret))) {
      return Response.json({ ok: false, error: "device_auth_failed" }, { status: 403 });
    }

    // ── Rate limit: 5 flags per device per rolling hour, across all messages ──
    const oneHourAgo = new Date(Date.now() - 60 * 60_000).toISOString();
    const { count: recentFlagCount, error: rateErr } = await admin
      .from("forum_flags")
      .select("id", { count: "exact", head: true })
      .eq("device_id", deviceId)
      .gte("created_at", oneHourAgo);

    if (rateErr) {
      console.error("flag-message: rate-limit lookup error", rateErr);
      return Response.json({ ok: false, error: "server_error" }, { status: 500 });
    }
    if ((recentFlagCount ?? 0) >= MAX_FLAGS_PER_HOUR) {
      return Response.json({ ok: false, error: "rate_limited" }, { status: 429 });
    }

    // ── Atomically claim this message for review ──────────────────────────
    // Only matches (and only updates) if flag_status is currently null —
    // this single WHERE clause is what makes the claim race-safe: if two
    // requests hit this at once, Postgres's row lock means only one can
    // actually perform the update, and the other gets zero rows back.
    const { data: claimed, error: claimErr } = await admin
      .from("forum_messages")
      .update({ flag_status: "reviewing" })
      .eq("id", messageId)
      .is("flag_status", null)
      .select("id, author_name, body, scope, problem_key, device_id, identity_id")
      .maybeSingle();

    if (claimErr) {
      console.error("flag-message: claim error", claimErr);
      return Response.json({ ok: false, error: "server_error" }, { status: 500 });
    }
    if (!claimed) {
      return Response.json({ ok: false, error: "already_reviewed" }, { status: 409 });
    }

    // Logged now, not only on success — it's the flag ATTEMPT that counts
    // against the hourly limit, independent of what Gemini decides.
    await admin.from("forum_flags").insert({ message_id: messageId, device_id: deviceId });

    const context = await fetchContext(admin, claimed.scope, claimed.problem_key, claimed.id);
    const verdict = await callGeminiFlagReview(claimed, context);

    // Fail-safe: any error, empty response, or malformed JSON from Gemini
    // keeps the message rather than risking a wrongful deletion from a
    // flaky API call. The reason (if Gemini did return one) is stored but
    // never shown for a kept message — reasons are only user-facing on
    // deletion.
    if (!verdict || verdict.delete !== true) {
      await admin
        .from("forum_messages")
        .update({ flag_status: "kept", flag_reason: verdict?.reason ?? null })
        .eq("id", messageId);
      return Response.json({ ok: true, result: "kept" });
    }

    const shownReason = verdict.reason.length > 0 ? verdict.reason : "violated forum guidelines";
    await admin
      .from("forum_messages")
      .update({ flag_status: "deleted", flag_reason: shownReason })
      .eq("id", messageId);

    await registerRedFlag(admin, claimed.device_id, claimed.identity_id ?? null);

    return Response.json({ ok: true, result: "deleted", reason: shownReason });
  }),
};