// Setup type definitions for built-in Supabase Runtime APIs
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "jsr:@supabase/server@^1";
import webpush from "npm:web-push@3.6.7";

interface PostMessagePayload {
  author_name: string;
  device_id: string;
  device_secret?: string;
  body: string;
  scope: "global" | "problem";
  problem_key?: string | null;
  // Set by the client's "Post as is" button after a previous attempt's
  // LaTeX-assist conversion (below) failed — skips straight past it this
  // time, posting the literal &...& text unconverted.
  force_latex?: boolean;
  reply_to_id?: number | null;
}

const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY")!;
const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY")!;

// ── Device-secret verification (see migration 001_device_secrets.sql) ──────
// device_id alone is public (forum_messages_public exposes it on every
// message), so it can't prove device ownership on its own — without this,
// anyone could post new messages under someone else's claimed identity by
// copying their device_id off an existing message.
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
  if (error) { console.error("post-message: device-auth lookup error", error); return false; }

  if (!row) {
    const salt = randomHex(16);
    const hash = await sha256Hex(`${DEVICE_SECRET_PEPPER}:${salt}:${secret}`);
    const { error: insErr } = await db
      .from("device_secrets").insert({ device_id: deviceId, secret_hash: hash, secret_salt: salt });
    if (!insErr) return true;
    const { data: retryRow, error: retryErr } = await db
      .from("device_secrets").select("secret_hash, secret_salt").eq("device_id", deviceId).maybeSingle();
    if (retryErr || !retryRow) { console.error("post-message: device-auth race-retry error", retryErr); return false; }
    const retryHash = await sha256Hex(`${DEVICE_SECRET_PEPPER}:${retryRow.secret_salt}:${secret}`);
    return retryHash === retryRow.secret_hash;
  }

  const candidateHash = await sha256Hex(`${DEVICE_SECRET_PEPPER}:${row.secret_salt}:${secret}`);
  return candidateHash === row.secret_hash;
}

// ── Push notifications (@mention alerts) ────────────────────────────────────
// Web Push requires a VAPID keypair identifying who's sending the push —
// generated once with `npx web-push generate-vapid-keys` and stored as
// Supabase secrets (`supabase secrets set VAPID_PUBLIC_KEY=... etc`), never
// committed. VAPID_PUBLIC_KEY is also embedded (safe — it's public) in
// js/push-notifications.js on the client side, where it's passed to
// pushManager.subscribe() as the applicationServerKey; the two must match
// or subscriptions silently fail. If these aren't set, sendMentionPush-
// Notifications below just no-ops instead of throwing — mentions still post
// fine, they just don't push.
const VAPID_PUBLIC_KEY = Deno.env.get("VAPID_PUBLIC_KEY") ?? "";
const VAPID_PRIVATE_KEY = Deno.env.get("VAPID_PRIVATE_KEY") ?? "";
const VAPID_SUBJECT = Deno.env.get("VAPID_SUBJECT") || "mailto:examphys@nu.edu.kz";
if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
}

// Same mention shape js/forum.js's FORUM_MENTION_RE matches, kept manually
// in sync with it (and with claim-nickname.ts's charset check) — a push
// should only ever fire for something that would actually render as a
// tappable @mention chip client-side, not a stray "@" in running text.
const PUSH_MENTION_RE = /@([\p{L}\p{N}._-]+)/gu;

// Rough LaTeX strip (keeps the inner content, drops the $ / $$ delimiters)
// so a notification preview doesn't show raw math source — not a real
// renderer, just good enough for a one-line OS notification body.
function pushExcerpt(body: string): string {
  const stripped = body.replace(/\${1,2}([^$]+)\${1,2}/g, "$1").replace(/\s+/g, " ").trim();
  return stripped.length > 140 ? stripped.slice(0, 137) + "…" : stripped;
}

// Same DiceBear identicon URL scheme claim-nickname.ts and js/forum.js
// already use for author_name (the seed there is always the nickname, no
// extra params) — reused here as a plain hosted PNG URL for the push
// notification's icon, so the OS notification shows the sender's actual
// identicon instead of the generic app logo. No fetch/storage needed on
// our end: the browser fetches this URL itself when it renders the
// notification, same as it fetches any other favicon/image URL.
const PUSH_DICEBEAR_ICON_URL = 'https://api.dicebear.com/10.x/identicon/png?size=192&seed=';

function pushIconUrl(authorName: string): string {
  return PUSH_DICEBEAR_ICON_URL + encodeURIComponent(authorName);
}

// Sends a push to every subscription belonging to whoever this message
// @mentions (by claimed nickname) or directly replies to — mirrors the
// exact "mentioned" definition js/forum.js's own unread-@-badge already
// uses (forumBodyMentionsName(body, name) OR reply_to author match), so a
// push only ever fires for something that would already have lit up that
// badge. Unclaimed free-text names are silently skipped: with no identity
// row, there's nothing to look up a subscription by. Best-effort throughout
// — any failure here never blocks the message itself from posting, since
// this always runs via EdgeRuntime.waitUntil after the response is sent.
async function sendMentionPushNotifications(
  admin: any,
  msg: { id: number; author_name: string; body: string; scope: string; problem_key: string | null },
  posterIdentityId: string | null,
  replyToParentIdentityId: string | null
) {
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) return;

  const mentionedNames = new Set<string>();
  for (const m of msg.body.matchAll(PUSH_MENTION_RE)) mentionedNames.add(m[1].toLowerCase());

  const targetIdentityIds = new Set<string>();

  if (mentionedNames.size > 0) {
    const { data: identities, error } = await admin
      .from("identities")
      .select("id, nickname_lower")
      .in("nickname_lower", [...mentionedNames]);
    if (error) console.error("Push mention identity lookup error:", error);
    else identities?.forEach((i: any) => targetIdentityIds.add(i.id));
  }

  if (replyToParentIdentityId) targetIdentityIds.add(replyToParentIdentityId);
  if (posterIdentityId) targetIdentityIds.delete(posterIdentityId); // never notify yourself
  if (targetIdentityIds.size === 0) return;

  const { data: subs, error: subsErr } = await admin
    .from("push_subscriptions")
    .select("id, endpoint, p256dh, auth")
    .in("identity_id", [...targetIdentityIds]);
  if (subsErr) { console.error("Push subscription lookup error:", subsErr); return; }
  if (!subs || subs.length === 0) return;

  const payload = JSON.stringify({
    title: `${msg.author_name} mentioned you`,
    body: pushExcerpt(msg.body),
    icon: pushIconUrl(msg.author_name),
    scope: msg.scope,
    problem_key: msg.problem_key,
    message_id: msg.id,
  });

  await Promise.all(
    subs.map(async (sub: any) => {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          payload
        );
      } catch (err: any) {
        // 404/410 = the browser dropped this subscription on its end
        // (uninstalled, permission revoked, storage cleared) — clean it up
        // here rather than retrying it forever on every future mention.
        if (err?.statusCode === 404 || err?.statusCode === 410) {
          await admin.from("push_subscriptions").delete().eq("id", sub.id);
        } else {
          console.error("Push send error:", err);
        }
      }
    })
  );
}

const MAX_NAME_LEN = 40;
const MAX_BODY_LEN = 1000;
const MIN_SECONDS_BETWEEN_POSTS = 8;

// ── @gemini reply feature ───────────────────────────────────────────────────
// Default model for @gemini replies. gemini-3.6-flash has a much lower
// daily quota than gemini-3.5-flash-lite, so this is paired with an
// automatic 24h fallback below — see resolveGeminiModel()/
// recordDailyQuotaExhaustion(). Only this feature uses this pair; every
// other Gemini call in this codebase (LATEX_ASSIST_MODEL below, and the
// moderation/flagging model in flag-message.ts) is pinned to
// gemini-3.5-flash-lite always, on purpose — not part of this fallback.
const GEMINI_MODEL_PRIMARY = "gemini-3.6-flash";
const GEMINI_MODEL_FALLBACK = "gemini-3.5-flash-lite";
const GEMINI_MENTION_RE = /(?:^|\s)@gemini\b/i;
const GEMINI_BOT_NAME = "Gemini";
// Fixed sentinel device_id for the bot's own inserts — any valid-looking UUID
// works, it just needs to stay constant so the bot always gets the same
// name-color client-side (colors are hashed from author_name + this isn't
// actually used for that, but keeping it stable is good practice anyway).
// IMPORTANT: this value is also how the front end decides whether to show
// the "official Gemini" avatar (js/forum.js, FORUM_GEMINI_BOT_DEVICE_ID) —
// if this ever changes, update that constant too, or the avatar will stop
// matching. The reservedDeviceId check below (in the human-message
// validation section) is what actually makes that avatar trustworthy: it
// stops a person from just POSTing this same device_id themselves and
// getting flagged as "official" client-side. Don't drop that check.
const GEMINI_BOT_DEVICE_ID = "00000000-0000-4000-8000-000000000001";
// Gemini outputs exactly this (and nothing else) when it decides not to
// reply at all — see the "silently decline" rule in
// GEMINI_SYSTEM_INSTRUCTIONS below. maybePostGeminiReply checks for it
// verbatim and skips moderation/insert entirely, the same way a null reply
// from a failed API call is skipped today.
const GEMINI_NO_REPLY_SENTINEL = "[[NO_REPLY]]";
// ⚠ COURSE-SPECIFIC — MANUAL EDIT AT RELEASE. Edge functions deploy
// straight into a Supabase project's own Deno runtime, so they can't read
// js/course-config.js or the data-course attribute the way client-side
// files do — this project's copy of post-message.ts (and its copy alone)
// is what needs editing when standing up a new course.
//
// The live site — used only to fetch a tagged problem's own statement text
// for context (that text lives in course/quizzes/quizN.js, not in Supabase).
const SITE_ORIGIN = "https://phys162.netlify.app";

// Edit this any time to change how Gemini behaves/answers in the forum —
// nothing else about the pipeline needs to change alongside it. Also
// course-specific, same manual-edit note as SITE_ORIGIN above.
const GEMINI_SYSTEM_INSTRUCTIONS = `
You are "Gemini", a helpful participant in a student forum for PHYS162
(electromagnetism & optics physics) at Nazarbayev University.
Someone just tagged you with @gemini. You'll be given the tagged message,
recent messages from the same thread for context, and — if the thread is
about a specific problem — that problem's exact text.

Rules:
- Answer the tagged message directly. Be concise: a few sentences or a short
  worked step, not a full essay, unless the student clearly asked for a
  complete derivation.
- This forum renders LaTeX via MathJax. Write inline math as $...$ and
  display math as $$...$$. Never use \\( \\), \\[ \\], or plain-text math.
- Prefer a standalone display equation ($$...$$ on its own line) over cramming
  a long expression inline into a sentence. Inline $...$ is fine for a single
  short symbol or quantity (e.g. "the charge $q$" or "so $v=3\\,\\text{m}\\,\\text{s}^{-1}$"),
  but anything with multiple terms, a fraction, an exponent/subscript stack,
  or more than a few characters should go on its own $$...$$ line instead of
  being wedged into running text — that reads as cramped and is harder to
  parse. When a derivation has several steps, put each resulting equation on
  its own $$...$$ line rather than chaining them inline one after another.
- Do NOT use Markdown formatting of any kind — no **bold**, no _italic_, no
  # headers, no \`code\` backticks, no markdown bullet/numbered lists. This
  forum only renders LaTeX math delimiters; everything else shows up as
  literal asterisks/hashes/etc. Write plain sentences and paragraphs. If you
  want a short list, just use plain lines like "1) ..." / "2) ..." with no
  other markup.
- If a specific problem's text is provided, treat it as ground truth for
  what's being asked — don't invent numbers or setup that aren't there.
- If the problem has a figure, its actual image is attached alongside this
  prompt (not just the text) — look at it directly rather than guessing what
  it shows from the surrounding text.
- If the student seems to be asking for a nudge or a check on their
  reasoning rather than the final answer, don't just hand them the number —
  walk through the reasoning and let them take the last step. Use judgment.
- If you're not confident about something, say so plainly instead of
  guessing.
- You'll be told the nickname of the user who tagged you, separately from their
  message. Start your first reply with "@" + that exact nickname (e.g.
  "@nickname, ...") so they get tagged — never the bare nickname without the
  "@", and never a different or invented name. After the first tag in a branch you can choose yourself if to use @ system.
- You don't have to reply every time you're tagged or replied to. If EITHER
  of the following is true, output exactly ${GEMINI_NO_REPLY_SENTINEL} and
  nothing else — no punctuation, no explanation, nothing before or after it:
  (a) this message is a direct reply to one of your own earlier messages,
  and its own content is trivial/non-substantive (e.g. just ".", "ok",
  "thanks", a single emoji, or similar) — that usually means someone is
  pointing an old reply of yours out to someone else in the conversation,
  not actually asking you anything new; or
  (b) the message tagging or replying to you is rude, hostile, insulting, or
  otherwise offensive toward you or anyone else — you're not obligated to
  engage with hostility, and staying silent is a completely valid choice.
  Otherwise, always answer normally per the rules above.
- For greek letters as a variables use their latex version like $\\mu$ but for the part of a text such as microfarads use just unicode symbol μ like μF.
- Stay on physics/coursework; politely decline anything unrelated. you can also redirect other user to @Aoi_Kuro during conflicts etc.).
`.trim();

console.info("post-message function started");

// ── LaTeX shorthand assist (&content& / &&content&&) ────────────────────────
// Lets a person write &x squared& or &&\int_0^x f\,dx&& instead of hand-
// writing $...$/$$...$$ themselves — this rewrites it to real LaTeX before
// the message is ever moderated/inserted. &&...&& (display) is matched
// before lone &...& (inline) so a display block can't be misread as two
// inline ones. Cheap fast path: text with no & in it never calls Gemini.
const LATEX_ASSIST_MODEL = "gemini-3.5-flash-lite";
const LATEX_ASSIST_RE = /&&([\s\S]+?)&&|&([^&\n]+?)&/g;
const LATEX_ASSIST_SYSTEM = `
You convert short math descriptions/shorthand into raw LaTeX math source —
no $ or $$ delimiters, no surrounding prose, just what would go between
$...$ in a MathJax-rendered document. Return a JSON array of strings, same
length and order as the input JSON array, one LaTeX string per input item.

Each output string must be ONLY the final LaTeX — nothing else. Never
include your reasoning, uncertainty, alternate interpretations, or
self-corrections (e.g. "wait, actually...") inside the string. If an input
is ambiguous or underspecified, silently pick the single most standard/
conventional interpretation and output just that — do not explain the
choice or hedge about it. The output is inserted directly into a document
and rendered as-is, so any non-LaTeX text you include will be shown
literally to the reader.

Formatting conventions:
- Differentials: use \mathrm{d} for the "d" in dx, dt, dV, etc. (e.g.
  \mathrm{d}x, not dx or \, dx).
- Subscripts that are words/abbreviations, not single variables: use
  \text{} inside the subscript, e.g. I_{\text{enc}}, Q_{\text{enc}},
  not I_{enc}. Plain single-letter/number subscripts (x_1, v_x) stay as-is.
`.trim();

async function callGeminiLatexAssist(items: string[]): Promise<string[] | null> {
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${LATEX_ASSIST_MODEL}:generateContent`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": GEMINI_API_KEY },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: LATEX_ASSIST_SYSTEM }] },
          contents: [{ role: "user", parts: [{ text: JSON.stringify(items) }] }],
          // Structured JSON output, not free text: Gemini's own JSON encoder
          // already escapes backslashes correctly (\\int etc.), so
          // JSON.parse() below hands back valid LaTeX with no manual
          // escaping step needed on our end.
          generationConfig: {
            responseMimeType: "application/json",
            responseSchema: { type: "ARRAY", items: { type: "STRING" } },
            // NOTE: do NOT add thinkingConfig here — gemini-3.5-flash-lite
            // rejects it outright with a 400 INVALID_ARGUMENT (confirmed in
            // prod logs), it does not just ignore an unsupported field. The
            // leaked-reasoning issue is handled via LATEX_ASSIST_SYSTEM
            // instructions instead.
          },
        }),
      }
    );
    if (!res.ok) { console.error("LaTeX-assist Gemini error:", await res.text()); return null; }
    const data = await res.json();
    const raw = data?.candidates?.[0]?.content?.parts?.map((p: any) => p.text).join("");
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length !== items.length || parsed.some((x: any) => typeof x !== "string")) {
      console.error("LaTeX-assist: malformed/mismatched response", parsed);
      return null;
    }
    return parsed;
  } catch (err) {
    console.error("LaTeX-assist call failed:", err);
    return null;
  }
}

// Returns the rewritten body, the original body unchanged if there was
// nothing to convert, or null on any failure (network/API/malformed
// response) — null is the signal the caller uses to surface a retryable
// error to the person instead of silently posting their raw &...& text.
async function applyLatexAssist(text: string): Promise<string | null> {
  const matches = [...text.matchAll(LATEX_ASSIST_RE)];
  if (matches.length === 0) return text;

  const segments = matches.map((m) => ({ display: m[1] !== undefined, raw: (m[1] ?? m[2]).trim() }));
  const latex = await callGeminiLatexAssist(segments.map((s) => s.raw));
  if (!latex) return null;

  let result = "";
  let cursor = 0;
  matches.forEach((m, i) => {
    result += text.slice(cursor, m.index!);
    result += segments[i].display ? `$$${latex[i]}$$` : `$${latex[i]}$`;
    cursor = m.index! + m[0].length;
  });
  return result + text.slice(cursor);
}

// Fetches the last N messages in the same scope (and, for problem scope, the
// same problem_key) as `body`, oldest-first, excluding the message with id
// `excludeId` (the one that was just inserted).
async function fetchRecentContext(admin: any, scope: string, problemKey: string | null, excludeId: number) {
  let query = admin
    .from("forum_messages")
    .select("id, author_name, body")
    .eq("scope", scope)
    .lt("id", excludeId)
    .order("id", { ascending: false })
    .limit(10);

  if (scope === "problem" && problemKey) query = query.eq("problem_key", problemKey);

  const { data, error } = await query;
  if (error || !data) return [];
  return data.reverse(); // chronological, oldest first
}

// problem_key format is "q{quizNumber}_{problemId}" (e.g. "q2_P18"), or
// "q{quizNumber}_general" for the composer's "General discussion" option,
// which isn't a real problem — skip that case.
function parseProblemKey(problemKey: string | null) {
  if (!problemKey) return null;
  const m = /^q(\d+)_(.+)$/.exec(problemKey);
  if (!m || m[2] === "general") return null;
  return { quizNum: m[1], problemId: m[2] };
}

// Reverses JS-string escaping (\\ -> \, \" -> ", etc.) — the quiz data files
// are plain JS source, not JSON, so a field like "...$1.67\\times10^{-27}$..."
// needs unescaping to get the real intended text before handing it to Gemini.
function unescapeJsString(raw: string) {
  return raw.replace(/\\(.)/g, (_, ch) => (ch === "n" ? "\n" : ch === "t" ? "\t" : ch));
}

// Best-effort fetch of a tagged problem's own statement text (and, if the
// statement embeds a figure, that figure's image URL) from the live site's
// quiz data file. Returns null (never throws) on any failure — a
// missing/unparseable problem just means the reply goes out without that
// extra context, not that the whole request fails.
async function fetchProblemContext(
  problemKey: string | null
): Promise<{ text: string; imageUrl: string | null } | null> {
  const parsed = parseProblemKey(problemKey);
  if (!parsed) return null;

  try {
    const quizUrl = `${SITE_ORIGIN}/course/quizzes/quiz${parsed.quizNum}.js`;
    const res = await fetch(quizUrl);
    if (!res.ok) {
      console.error(`Quiz file fetch non-OK: ${res.status} ${res.statusText} (${quizUrl})`);
      return null;
    }
    const src = await res.text();

    // Matches the `{ id:"P18", ... }` object literal for this problem. No
    // nested `{}` occur inside these objects, so a non-greedy match up to
    // the next `},` is safe.
    const blockRe = new RegExp(`\\{\\s*id:\\s*"${parsed.problemId}"[\\s\\S]*?\\}\\s*,`, "m");
    const block = blockRe.exec(src)?.[0];
    if (!block) return null;

    // Standard "quoted string with escapes" pattern: any escaped char, or
    // any non-quote/non-backslash char, repeated.
    const textMatch = /text:\s*"((?:\\.|[^"\\])*)"/.exec(block);
    if (!textMatch) return null;
    const text = unescapeJsString(textMatch[1]);

    // Some problem statements embed a figure as a plain
    // <img src="course/images/..."> tag (see course/quizzes/quizN.js) —
    // pull its src out so it can be fetched and handed to Gemini as an
    // actual image, not just markup it can't see anything from.
    const imgSrc = /<img[^>]+src="([^"]+)"/.exec(text)?.[1];
    const imageUrl = imgSrc ? `${SITE_ORIGIN}/${imgSrc}` : null;

    return { text, imageUrl };
  } catch (err) {
    console.error("Problem text fetch/parse error:", err);
    return null;
  }
}

// Extension → MIME type for problem figures. SVG is deliberately excluded:
// Gemini's inlineData image input doesn't accept it, and every quiz figure
// in course/images is a raster export anyway, so this just future-proofs
// against a stray .svg src without silently sending garbage to the API.
const PROBLEM_IMAGE_MIME_BY_EXT: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
};

// Stay well under Gemini's inline-data request size limit (20MB total
// request) — quiz figures are small diagrams, so anything past this is
// almost certainly not worth the bandwidth/latency anyway.
const MAX_PROBLEM_IMAGE_BYTES = 4 * 1024 * 1024;

// Best-effort fetch of a problem figure as base64, ready to hand to Gemini
// as inlineData. Same "never throws, null on failure" contract as
// fetchProblemContext — a missing/oversized/unsupported image just means
// the reply goes out without it.
async function fetchProblemImage(imageUrl: string): Promise<{ mimeType: string; data: string } | null> {
  const ext = imageUrl.split(".").pop()?.toLowerCase().split(/[?#]/)[0] ?? "";
  const mimeType = PROBLEM_IMAGE_MIME_BY_EXT[ext];
  if (!mimeType) return null;

  try {
    const res = await fetch(imageUrl);
    if (!res.ok) {
      console.error(`Problem image fetch non-OK: ${res.status} ${res.statusText} (${imageUrl})`);
      return null;
    }
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (bytes.byteLength === 0 || bytes.byteLength > MAX_PROBLEM_IMAGE_BYTES) {
      console.error(`Problem image skipped: ${bytes.byteLength} bytes (${imageUrl})`);
      return null;
    }

    // btoa() only takes a binary string, and spreading a large Uint8Array
    // straight into String.fromCharCode blows the call stack — build the
    // binary string in chunks instead.
    let binary = "";
    const CHUNK = 0x8000;
    for (let i = 0; i < bytes.length; i += CHUNK) {
      binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
    }
    return { mimeType, data: btoa(binary) };
  } catch (err) {
    console.error("Problem image fetch error:", err);
    return null;
  }
}

// Key in the general-purpose app_variables table (see migration
// 002_app_variables.sql) that holds the "gemini-3.6-flash is in its
// post-daily-quota timeout until <timestamp>" state. value is a jsonb
// string — an ISO timestamp — not a nested object, since that's all this
// needs; other variables added to app_variables later can shape their own
// value however suits them.
const GEMINI_MODEL_COOLDOWN_KEY = "gemini_post_message_model_disabled_until";

// Checks app_variables to see whether gemini-3.6-flash is still in its 24h
// post-daily-quota timeout. Fails open to the primary model on any DB
// error — worst case we waste one request re-discovering the quota is
// still exhausted, same as if this table didn't exist at all.
async function resolveGeminiModel(admin: any): Promise<string> {
  try {
    const { data, error } = await admin
      .from("app_variables")
      .select("value")
      .eq("key", GEMINI_MODEL_COOLDOWN_KEY)
      .maybeSingle();
    if (error || !data?.value) return GEMINI_MODEL_PRIMARY;
    return new Date(data.value as string).getTime() > Date.now() ? GEMINI_MODEL_FALLBACK : GEMINI_MODEL_PRIMARY;
  } catch (err) {
    console.error("resolveGeminiModel: lookup failed, defaulting to primary", err);
    return GEMINI_MODEL_PRIMARY;
  }
}

// Records that gemini-3.6-flash just hit its daily quota, so subsequent
// calls skip straight to the fallback for the next 24h instead of wasting
// a request re-discovering the same 429. After 24h, resolveGeminiModel()
// naturally starts offering the primary model again — no separate "reset"
// step needed.
async function recordDailyQuotaExhaustion(admin: any): Promise<void> {
  try {
    const disabledUntil = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    await admin
      .from("app_variables")
      .upsert({ key: GEMINI_MODEL_COOLDOWN_KEY, value: disabledUntil, updated_at: new Date().toISOString() });
  } catch (err) {
    console.error("recordDailyQuotaExhaustion: write failed (will just retry gemini-3.6-flash next time)", err);
  }
}

// True only for the specific "requests-per-day, this model, this project"
// quota violation — NOT for per-minute throttling or any other 429/error.
// A per-minute limit is exactly that: temporary and unrelated to which
// model is in use, so it isn't grounds for switching models for 24h (and
// with only a couple of forum regulars, RPM isn't expected to come up).
async function isDailyQuotaExhausted(res: Response): Promise<boolean> {
  if (res.status !== 429) return false;
  try {
    const body = await res.clone().json();
    const violations: any[] = body?.error?.details
      ?.find((d: any) => typeof d?.["@type"] === "string" && d["@type"].includes("QuotaFailure"))
      ?.violations ?? [];
    return violations.some((v: any) => typeof v?.quotaId === "string" && v.quotaId.includes("PerDay"));
  } catch {
    return false; // couldn't parse — treat as "not specifically a daily quota", let the normal error path handle it
  }
}

async function callGeminiOnce(model: string, systemInstruction: string, parts: Record<string, unknown>[]): Promise<Response> {
  return await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": GEMINI_API_KEY,
      },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemInstruction }] },
        contents: [{ role: "user", parts }],
      }),
    }
  );
}

async function callGemini(
  admin: any,
  taggerName: string,
  taggedMessage: string,
  contextMessages: { author_name: string; body: string }[],
  problemText: string | null,
  repliedTo: { author_name: string; body: string } | null,
  problemImage: { mimeType: string; data: string } | null
): Promise<string | null> {
  const contextBlock = contextMessages.length
    ? contextMessages.map(m => `${m.author_name}: ${m.body}`).join("\n")
    : "(no earlier messages in this thread)";
  const problemBlock = problemText ? `\n\nThe problem this thread is about:\n${problemText}` : "";
  const repliedToBlock = repliedTo
    ? `\n\nThis message was sent as a direct reply to this earlier message:\n${repliedTo.author_name}: ${repliedTo.body}`
    : "";

  const userContent =
    `Recent thread messages (oldest first):\n${contextBlock}${problemBlock}${repliedToBlock}\n\n` +
    `Nickname of the user tagging you: ${taggerName}\n` +
    `The message tagging you:\n${taggedMessage}`;

  // Text part first, then the figure (if any) — order doesn't matter much to
  // Gemini, but this keeps the prompt readable in logs.
  const parts: Record<string, unknown>[] = [{ text: userContent }];
  if (problemImage) {
    parts.push({ inlineData: { mimeType: problemImage.mimeType, data: problemImage.data } });
  }

  try {
    const firstModel = await resolveGeminiModel(admin);
    let res = await callGeminiOnce(firstModel, GEMINI_SYSTEM_INSTRUCTIONS, parts);

    // Only escalate to the fallback model when this was specifically the
    // daily-quota violation on the PRIMARY model — if we were already on
    // the fallback (because of a prior day's exhaustion), or this is any
    // other kind of error, fall through to the existing best-effort
    // "no reply this time" behavior below.
    if (!res.ok && firstModel === GEMINI_MODEL_PRIMARY && (await isDailyQuotaExhausted(res))) {
      console.log("gemini-3.6-flash: daily quota hit, falling back to gemini-3.5-flash-lite for 24h");
      await recordDailyQuotaExhaustion(admin);
      res = await callGeminiOnce(GEMINI_MODEL_FALLBACK, GEMINI_SYSTEM_INSTRUCTIONS, parts);
    }

    if (!res.ok) {
      console.error("Gemini API error:", await res.text());
      return null;
    }

    const data = await res.json();
    const reply = data?.candidates?.[0]?.content?.parts?.map((p: any) => p.text).join("").trim();
    return reply || null;
  } catch (err) {
    console.error("Gemini call failed:", err);
    return null;
  }
}

// Runs the whole @gemini side-effect: gather context, call Gemini, moderate
// the reply the same way a human message would be, insert it. Every step is
// best-effort — any failure just means no bot reply gets posted this time.
// forceTrigger (set true when the human message was a reply directly to a
// prior Gemini message) makes this run even without a literal "@gemini" in
// the body — replying to Gemini keeps the conversation going the same way
// tagging it does. repliedTo carries the parent message's own content when
// this post was a reply-to, so Gemini can judge things like "is this reply
// to me trivial" even when the parent is outside fetchRecentContext's
// last-10 window.
async function maybePostGeminiReply(
  admin: any,
  humanMsg: { id: number; author_name: string; body: string; scope: string; problem_key: string | null },
  forceTrigger: boolean,
  repliedTo: { author_name: string; body: string } | null
) {
  if (!forceTrigger && !GEMINI_MENTION_RE.test(humanMsg.body)) return;

  const [contextMessages, problemContext] = await Promise.all([
    fetchRecentContext(admin, humanMsg.scope, humanMsg.problem_key, humanMsg.id),
    fetchProblemContext(humanMsg.problem_key),
  ]);
  // Only fetched once problemContext is in hand (it's what tells us whether
  // there's an image URL at all) — not worth parallelizing with the above,
  // since this is the rarer/slower leg (an extra image download) and most
  // threads have no figure to fetch.
  const problemImage = problemContext?.imageUrl ? await fetchProblemImage(problemContext.imageUrl) : null;

  const reply = await callGemini(
    admin,
    humanMsg.author_name,
    humanMsg.body,
    contextMessages,
    problemContext?.text ?? null,
    repliedTo,
    problemImage
  );
  if (!reply) return;

  // Gemini's explicit "I choose not to reply" signal — see the no-reply
  // bullet in GEMINI_SYSTEM_INSTRUCTIONS. .startsWith() rather than a strict
  // === is a small safety margin in case the model tacks on trailing
  // whitespace/punctuation despite the instruction — a soft heuristic like
  // the rest of this file's "best effort" error handling. Skips moderation
  // and the insert entirely: no message, no DB row, nothing visible in the
  // thread.
  const normalizedReply = reply.trim();
  if (normalizedReply === GEMINI_NO_REPLY_SENTINEL || normalizedReply.startsWith(GEMINI_NO_REPLY_SENTINEL)) {
    console.info("Gemini chose not to reply (trivial reply-to, or offensive message).");
    return;
  }

  // No length cap here: MAX_BODY_LEN only bounds human-submitted payloads
  // (enforced above in the request handler); this insert goes straight in via
  // admin, and body is an unbounded `text` column, so Gemini's full reply can
  // go out as-is instead of being sliced mid-sentence.
  const trimmedReply = reply;

  // Same moderation gate a human message goes through, applied to Gemini's
  // own output before it's allowed to post.
  try {
    const modRes = await fetch("https://api.openai.com/v1/moderations", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ model: "omni-moderation-latest", input: trimmedReply }),
    });
    if (!modRes.ok) {
      console.error("Gemini-reply moderation API error:", await modRes.text());
      return;
    }
    const modData = await modRes.json();
    if (modData?.results?.[0]?.flagged) {
      console.error("Gemini reply was flagged by moderation, not posted.");
      return;
    }
  } catch (err) {
    console.error("Gemini-reply moderation call failed:", err);
    return;
  }

  const { error: geminiInsertErr } = await admin.from("forum_messages").insert({
    author_name: GEMINI_BOT_NAME,
    device_id: GEMINI_BOT_DEVICE_ID,
    body: trimmedReply,
    scope: humanMsg.scope,
    problem_key: humanMsg.problem_key,
    reply_to_id: humanMsg.id,
    moderation_status: "approved",
  });
  if (geminiInsertErr) {
    console.error("Gemini reply insert error:", geminiInsertErr);
  } else {
    console.info(
      `Gemini reply posted (problem=${humanMsg.problem_key ?? "none"}, image=${!!problemImage})`
    );
  }
}

export default {
  fetch: withSupabase({ auth: "publishable" }, async (req, ctx) => {
    const payload: PostMessagePayload = await req.json();
    const { author_name, device_id, device_secret, body, scope, problem_key, force_latex, reply_to_id } = payload ?? {};

    // ctx.supabaseAdmin bypasses RLS — the only client in this file allowed to write.
    const admin = ctx.supabaseAdmin;

    // ── Validation ──────────────────────────────────────────────────────
    if (typeof author_name !== "string" || author_name.trim().length === 0) {
      return Response.json({ ok: false, error: "Name is required." }, { status: 400 });
    }
    if (author_name.length > MAX_NAME_LEN) {
      return Response.json({ ok: false, error: `Name must be under ${MAX_NAME_LEN} characters.` }, { status: 400 });
    }
    if (typeof device_id !== "string" || !/^[0-9a-f-]{36}$/i.test(device_id)) {
      return Response.json({ ok: false, error: "Invalid device id." }, { status: 400 });
    }
    // The bot's sentinel device_id is only ever supposed to come from
    // maybePostGeminiReply()'s own admin insert below, never from a payload
    // a browser sent us. Without this check, anyone could POST with this
    // exact device_id and the front end would show them with the "official
    // Gemini" avatar (js/forum.js keys that avatar off device_id, precisely
    // to stop someone impersonating the bot by just typing "Gemini" as their
    // name) — so it has to be blocked here too, not just relied on client-side.
    if (device_id.toLowerCase() === GEMINI_BOT_DEVICE_ID.toLowerCase()) {
      return Response.json({ ok: false, error: "This device id is reserved." }, { status: 400 });
    }
    if (!(await verifyOrRegisterDevice(admin, device_id, device_secret))) {
      return Response.json({ ok: false, error: "device_auth_failed" }, { status: 403 });
    }

    // ── Ban check (escalating bans from red flags, see flag-message.ts) ────
    // Checked before any other content validation/work, since a banned
    // device shouldn't get moderation/LaTeX-assist calls spent on it. Checks
    // both device_bans (unclaimed poster, or a mirrored ban) and, if this
    // device is linked to a claimed identity, that identity's own ban
    // (survives renames and "exit device" — see identity_bans in the
    // migration). banned_until (the later of the two, if both apply) is
    // returned so the front end can show the exact remaining time.
    let banUntil: string | null = null;

    const { data: banRow, error: banErr } = await admin
      .from("device_bans")
      .select("banned_until")
      .eq("device_id", device_id)
      .maybeSingle();
    if (banErr) {
      console.error("Ban check (device) error:", banErr);
    } else if (banRow?.banned_until && new Date(banRow.banned_until) > new Date()) {
      banUntil = banRow.banned_until;
    }

    const { data: banLink, error: banLinkErr } = await admin
      .from("identity_devices")
      .select("identity_id")
      .eq("device_id", device_id)
      .maybeSingle();
    if (banLinkErr) {
      console.error("Ban check (identity link) error:", banLinkErr);
    } else if (banLink?.identity_id) {
      const { data: identityBanRow, error: identityBanErr } = await admin
        .from("identity_bans")
        .select("banned_until")
        .eq("identity_id", banLink.identity_id)
        .maybeSingle();
      if (identityBanErr) {
        console.error("Ban check (identity) error:", identityBanErr);
      } else if (identityBanRow?.banned_until && new Date(identityBanRow.banned_until) > new Date()) {
        if (!banUntil || new Date(identityBanRow.banned_until) > new Date(banUntil)) banUntil = identityBanRow.banned_until;
      }
    }

    if (banUntil) {
      return Response.json(
        { ok: false, error: "banned", code: "banned", banned_until: banUntil },
        { status: 403 }
      );
    }

    if (typeof body !== "string" || body.trim().length === 0) {
      return Response.json({ ok: false, error: "Message can't be empty." }, { status: 400 });
    }
    if (body.length > MAX_BODY_LEN) {
      return Response.json({ ok: false, error: `Message must be under ${MAX_BODY_LEN} characters.` }, { status: 400 });
    }
    if (scope !== "global" && scope !== "problem") {
      return Response.json({ ok: false, error: "Invalid scope." }, { status: 400 });
    }
    if (scope === "problem" && (typeof problem_key !== "string" || problem_key.trim().length === 0)) {
      return Response.json({ ok: false, error: "Missing problem key." }, { status: 400 });
    }

    let cleanBody = body.trim();
    // NOTE: was `const cleanName`, now `let` — the nickname block below may
    // override whatever name the client sent.
    let cleanName = author_name.trim();
    let cleanScope = scope;
    let cleanProblemKey = scope === "problem" ? problem_key!.trim() : null;
    let replyToId: number | null = null;
    let replyToIsGemini = false;
    let replyToParent: { author_name: string; body: string } | null = null;
    let replyToParentIdentityId: string | null = null;
    // Snapshot of which identity (if any) is posting this message, resolved
    // once below and stored directly on the row — see forum_messages_public
    // in the migration for why this can't just be re-derived from device_id
    // at read time.
    let myIdentityId: string | null = null;

    // ── LaTeX shorthand assist ────────────────────────────────────────────
    // Runs before moderation so moderation sees the actual text that will
    // be posted, not the raw &...& shorthand. force_latex (set by the
    // client's "Post as is" button) skips this entirely on a retry.
    if (!force_latex) {
      const assisted = await applyLatexAssist(cleanBody);
      if (assisted === null) {
        return Response.json(
          { ok: false, error: "Couldn't convert your LaTeX shorthand right now.", code: "latex_assist_failed" },
          { status: 422 }
        );
      }
      cleanBody = assisted;
    }

    // ── Reply-to: force scope/problem_key to match the parent (never trust
    // the client's), and note if the parent is Gemini's own message so a
    // reply to it can trigger a follow-up below without needing "@gemini".
    // Also keep the parent's own author_name/body so Gemini can judge things
    // like "is this reply to me trivial" even when the parent isn't within
    // fetchRecentContext's last-10 window.
    if (typeof reply_to_id === "number") {
      const { data: parent } = await admin
        .from("forum_messages")
        .select("id, device_id, scope, problem_key, author_name, body, identity_id")
        .eq("id", reply_to_id)
        .maybeSingle();
      if (parent) {
        replyToId = parent.id;
        replyToIsGemini = parent.device_id === GEMINI_BOT_DEVICE_ID;
        cleanScope = parent.scope;
        cleanProblemKey = parent.problem_key;
        replyToParent = { author_name: parent.author_name, body: parent.body };
        replyToParentIdentityId = parent.identity_id ?? null;
      }
    }

    // ── Nickname enforcement (multi-device identities) ──────────────────
    // If this device is linked to a claimed identity (identity_devices →
    // identities, see sql/identities_schema.sql), force the post to go out
    // under that identity's CURRENT nickname regardless of what the client
    // sent — otherwise a claim would be purely cosmetic, since anyone could
    // still type the claimed name as free text. This replaces the old
    // direct forum_identities-by-device_id lookup: a device now finds its
    // identity through identity_devices, which is what lets multiple
    // devices share one identity without any of them losing this
    // enforcement. See edge-functions/claim-nickname.ts.
    const { data: myLink, error: myLinkErr } = await admin
      .from("identity_devices")
      .select("identity_id")
      .eq("device_id", device_id)
      .maybeSingle();

    if (myLinkErr) {
      console.error("Identity link lookup error:", myLinkErr);
      return Response.json({ ok: false, error: "Couldn't verify your identity, try again." }, { status: 500 });
    }

    if (myLink) {
      myIdentityId = myLink.identity_id;
      const { data: myIdentity, error: myIdentityErr } = await admin
        .from("identities")
        .select("nickname")
        .eq("id", myLink.identity_id)
        .maybeSingle();
      if (myIdentityErr) {
        console.error("Identity lookup error:", myIdentityErr);
        return Response.json({ ok: false, error: "Couldn't verify your identity, try again." }, { status: 500 });
      }
      if (myIdentity) cleanName = myIdentity.nickname;
    } else {
      // Same charset claim-nickname.ts enforces for claimed names — keeps
      // every posted name @mentionable (js/forum.js's FORUM_MENTION_RE uses
      // this same \p{L}\p{N}._- set), so a free-text name can't silently
      // become impossible to tag correctly.
      if (!/^[\p{L}\p{N}._-]+$/u.test(cleanName)) {
        return Response.json(
          { ok: false, error: "Name can only use letters, numbers, dots, underscores, or hyphens (no spaces)." },
          { status: 400 }
        );
      }
      // This device owns no identity — make sure it isn't typing someone
      // else's claimed name as free text to dodge the claim flow.
      const { data: claimedByOther, error: otherErr } = await admin
        .from("identities")
        .select("id")
        .eq("nickname_lower", cleanName.toLowerCase())
        .maybeSingle();

      if (otherErr) {
        console.error("Nickname-collision lookup error:", otherErr);
        return Response.json({ ok: false, error: "Couldn't verify that name, try again." }, { status: 500 });
      }
      if (claimedByOther) {
        return Response.json(
          { ok: false, error: "That name is claimed by someone else. Claim it with its PIN, or pick a different name." },
          { status: 409 }
        );
      }
    }

    // ── Rate limit: one post per IDENTITY every N seconds ────────────────
    // Was previously keyed on device_id alone, which meant the cooldown was
    // per-device rather than per-person: a claimed identity linked to two
    // devices (see identity_devices above) could post from each on its own
    // independent timer, and switching devices didn't carry the wait over.
    // Key on identity_id whenever this poster has one; only fall back to
    // device_id for posters with no claimed identity at all, since there's
    // nothing else to group their posts by.
    const rateLimitColumn = myIdentityId ? "identity_id" : "device_id";
    const rateLimitValue  = myIdentityId ?? device_id;
    const { data: recent, error: recentErr } = await admin
      .from("forum_messages")
      .select("created_at")
      .eq(rateLimitColumn, rateLimitValue)
      .order("id", { ascending: false })
      .limit(1);

    if (!recentErr && recent && recent.length > 0) {
      const secondsSince = (Date.now() - new Date(recent[0].created_at).getTime()) / 1000;
      if (secondsSince < MIN_SECONDS_BETWEEN_POSTS) {
        return Response.json(
          { ok: false, error: `You're posting too fast, wait ${Math.ceil(MIN_SECONDS_BETWEEN_POSTS - secondsSince)}s.` },
          { status: 429 }
        );
      }
    }

    // ── Moderation ─────────────────────────────────────────────────────
    const modRes = await fetch("https://api.openai.com/v1/moderations", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ model: "omni-moderation-latest", input: cleanBody }),
    });

    if (!modRes.ok) {
      console.error("Moderation API error:", await modRes.text());
      return Response.json({ ok: false, error: "Couldn't verify message right now, try again shortly." }, { status: 502 });
    }

    const modData = await modRes.json();
    if (modData?.results?.[0]?.flagged) {
      return Response.json({ ok: false, error: "This message was flagged by moderation and wasn't posted." }, { status: 422 });
    }

    // ── Insert (only reached if moderation passed) ────────────────────────
    const { data: inserted, error: insertErr } = await admin
      .from("forum_messages")
      .insert({
        author_name: cleanName,
        device_id,
        body: cleanBody,
        scope: cleanScope,
        problem_key: cleanProblemKey,
        reply_to_id: replyToId,
        identity_id: myIdentityId,
        moderation_status: "approved",
      })
      .select("id, created_at, author_name, body, scope, problem_key")
      .single();

    if (insertErr) {
      console.error("Insert error:", insertErr);
      return Response.json({ ok: false, error: "Couldn't save your message, try again." }, { status: 500 });
    }

    // Runs in the background — EdgeRuntime.waitUntil keeps the function alive
    // until these promises settle, but doesn't make the client wait for them.
    // Without this, the response (and therefore your own message appearing
    // in the composer) would sit blocked for as long as Gemini/push takes —
    // often several seconds — instead of confirming right away like any
    // other message, with the side effects landing a beat later.
    EdgeRuntime.waitUntil(Promise.all([
      maybePostGeminiReply(admin, inserted, replyToIsGemini, replyToParent),
      sendMentionPushNotifications(admin, inserted, myIdentityId, replyToParentIdentityId),
    ]));

    return Response.json({ ok: true, message: inserted });
  }),
};