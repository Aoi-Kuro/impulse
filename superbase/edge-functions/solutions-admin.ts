// Edge Function: solutions-admin
//
// Deploy as the "solutions-admin" Edge Function. Auth mode: "publishable",
// same as post-message/claim-nickname/sync-quiz-attempts. "Verify JWT with
// legacy secret" OFF.
//
// Requires superbase/migrations/008-014 to have been run first, in this same
// project (014: it writes problem_solutions.author_id). Migration 013 and
// this version's predecessor went out TOGETHER: this version
// reads solution_editors.level, problem_solutions.id/owner_id/is_default and
// solution_reviews, and the previous version's saves fail once 013 has made
// problem_key non-unique.
//
// This is the ONLY way anything is ever written to problem_solutions.
// Reading PUBLISHED solutions does not come through here at all — the
// practice site selects them directly with the publishable key, which the
// RLS policy in migration 008 limits to status = 'published'. This function
// exists for everything that policy deliberately cannot do: see drafts and
// reviews, write, publish, unpublish, review, delete.
//
// ── Who may call it ────────────────────────────────────────────────────────
// Every action except the editor-management ones needs an editor access
// key, sent as `key` in the POST body — the same place device_secret is sent
// to every other function here, and never in the URL or query string, where
// it would end up in browser history, referrer headers and server logs.
// (A custom header would do just as well for secrecy, but a non-standard
// request header triggers a CORS preflight the browser then blocks, so the
// body is what actually works from a page.) The key is 32 random hex
// characters (128 bits): not guessable, and rate limiting would add nothing
// meaningful against that search space. It is compared against
// solution_editors.key_hash, a salted + peppered SHA-256, exactly like
// device_secrets.secret_hash.
//
// "create-editor", "revoke-editor", "set-editor-link" and "set-editor-level"
// instead need `admin_key` in the body to match the SOLUTIONS_ADMIN_KEY
// secret. That key belongs to the site owner alone, and sits outside the
// levels below: even a level-4 key can't issue keys.
//
// Both are also accepted as the x-solutions-key / x-admin-key headers, for
// calls made outside a browser (curl, the SQL-free setup path), where
// preflight never applies.
//
// ── Access levels (solution_editors.level, migration 013) ──────────────────
//   0  Observer   reads everything, drafts and reviews included.
//   1  Proposer   writes own solutions; publishing one, and any later edit
//                 to a published one, waits for a level 3+ approval.
//   2  Author     publishes own solutions directly.
//   3  Reviewer   2 + edits other people's solutions (their status stays as
//                 it is) + approves or rejects level 1 submissions.
//   4  Full       3 + publishes/unpublishes anyone's, deletes anyone's,
//                 changes credit, picks a problem's default solution.
//   At EVERY level, 0 included, an editor may delete their OWN solutions.
//
// "Own" always means owner_id — who created the row — never the credit
// (`author`), which level 4 may move. Review notes and pending edits are
// shown only to the solution's owner and to level 3+.
//
// ── Which solution a call is about ─────────────────────────────────────────
// A problem may now have several solutions (one per author). A call names
// one of them in one of three ways:
//   id                   that row.
//   problem_key + new    the caller's own solution on that problem, which
//                        must not exist yet (409 "exists" with it if it
//                        does). Only "save" uses this.
//   problem_key alone    LEGACY, the editor from before migration 013: the
//                        row that editor shows for the problem — the
//                        caller's own, else the default, else the most
//                        recently saved. While every problem has one
//                        solution, this is exactly the old behaviour.
//
// ── Request shape ──────────────────────────────────────────────────────────
//   POST { action: "...", key: "<32 hex>", ...fields }
//         (admin_key instead of key for the editor-management actions)
//
//   whoami         -> { ok, id, name, level }
//                     Who this key belongs to. The editor shows it in the
//                     top bar, and uses it to confirm the key works at all.
//   editors        -> { ok, editors: [{ name, link, level? }] }
//                     Active (non-revoked) editors, for the editor's
//                     "Editors" list. Names and links only, never key data;
//                     level too when the caller is level 4.
//   index          -> { ok, index: { "<problem_key>": entry }, rows: [entry] }
//                     Every row's status, drafts included, without bodies.
//                     entry = { id, problem_key, status, is_default, owner,
//                     author, saved_by, created_at, updated_at, share,
//                     review }. `index` holds one entry per problem (the
//                     legacy pick above) for the old editor; `rows` holds
//                     them all.
//   get            { id | problem_key } -> { ok, row }
//                     One full row with `owner` and `review` added, or
//                     row: null.
//   list           { problem_key } -> { ok, rows }
//                     Every solution of one problem, full rows, the default
//                     first, then by created_at (the tabs' order).
//   save           { id | problem_key [+ new], solution, figure, status,
//                    problem_hash?, expected_updated_at?, author?, share? }
//                    -> { ok, row, submitted?, share_error? }
//                     status is what the caller asks for, "draft" or
//                     "published"; the row's resulting status follows the
//                     level rules:
//                       level 1, own, asks published -> status "review"
//                         and a review is opened; for a row that is already
//                         published the row is NOT written at all, the edit
//                         waits in solution_reviews (submitted: true).
//                       level 3 on someone else's row -> content only, the
//                         row keeps its status.
//                     author: who to credit, honoured from level 4 only
//                     (an ACTIVE editor's name; others keep the row's
//                     credit, and a new row is credited to its creator).
//                     The credit is stored as that editor's id
//                     (author_id, migration 014) with their name and link
//                     copied next to it, so a rename carries over.
//                     share: when the result is published, the link-preview
//                     picture drawn from this same content ({ image, title,
//                     description, design, by }, as for share-card); stored with
//                     the row, for its new updated_at. share_error when only
//                     the picture could not be stored.
//                     figure = { tikz, steps: [{ svg, caption }], scale? }, or
//                     for a figure drawn as SVG
//                     { kind: "svg", svgSrc, svgBox?, tikz, steps, scale? };
//                     scale (0.25-2, default 1) is the display size factor,
//                     svgBox the author's crop box "x y w h" (absent = auto).
//                     kind says which source the steps were made from; the
//                     other kind's text is kept too when there is any.
//                     Readers only ever use steps; the sources are kept so
//                     the figure can be edited again.
//                     expected_updated_at is what the caller last saw; if the
//                     row has moved on since, nothing is written and 409
//                     comes back with the current row, so another editor's
//                     work is never silently overwritten.
//   set-credit     { id | problem_key, author?, expected_updated_at? }
//                    -> { ok, row }                         [level 4]
//                     Changes ONLY who is credited (author, author_link;
//                     saved_by and updated_at follow). 409 with the current
//                     row if it changed since expected_updated_at.
//   set-default    { id } -> { ok, rows }                   [level 4]
//                     Makes that published solution its problem's default
//                     (the one the site opens first); migration 013's
//                     triggers clear the previous one. rows as for list.
//   share-card     { id | problem_key, image, title, description, for }
//                    -> { ok, share }       [own at level 2+, any at 3+]
//                     Stores the link-preview picture of an already
//                     PUBLISHED solution (migration 012; the editor's
//                     "Make N link previews"; a publish sends its picture
//                     with the save instead): image is a JPEG data: URL
//                     drawn by the editor (editor/share-card.js), for the
//                     row's updated_at it was drawn from. Refused with 409
//                     when the row is no longer published or has been saved
//                     since — that card would show an older version. Writes
//                     only `share`, never updated_at.
//   delete         { id | problem_key } -> { ok }   [own at ANY level, any at 4]
//                     Also deletes the row's share-card picture and its
//                     review. If it was the default, the oldest remaining
//                     published solution becomes the default (trigger).
//   reviews        -> { ok, reviews: [{ id, problem_key, owner, status,
//                       review }] }                          [level 3]
//                     Every open or rejected review, without content (get
//                     the row for that).
//   review-approve { id, submitted_at?, expected_updated_at? } -> { ok, row }  [level 3]
//                     A new submission is published; a pending edit is
//                     copied into the row (saved_by = whoever submitted
//                     it). The review is removed.
//   review-reject  { id, note?, submitted_at?, expected_updated_at? } -> { ok, row }  [level 3]
//                     The review stays, marked rejected, with the note, for
//                     the author to read; a new submission goes back to
//                     draft. Resubmitting replaces it.
//                     For both: submitted_at / expected_updated_at are the
//                     review and row the reviewer read; if either moved on
//                     (the author resubmitted or saved), nothing is
//                     decided and 409 "changed" comes back with the row.
//                     Nobody below level 4 decides on their own submission.
//   export         -> { ok, rows: [...], reviews?: [...] }
//                     Everything, for the editor's JSON backup button;
//                     reviews (with their content) for level 4 only.
//   create-editor  { name, link?, level? } -> { ok, name, key, level }   [admin key]
//                     level defaults to 0 (observer). The generated key is
//                     shown ONCE. Only its hash is stored, so it cannot be
//                     recovered later.
//   set-editor-level { name, level } -> { ok }              [admin key]
//   set-editor-link { name, link } -> { ok }                [admin key]
//                     Sets (or, with "" / null, clears) the http(s) link
//                     "Solution by @name" points to. A trigger (migration
//                     009) rewrites author_link on that editor's existing
//                     rows, so nothing needs re-saving.
//   revoke-editor  { name } -> { ok }                       [admin key]
//                     The key stops working immediately, including for
//                     deleting its own solutions — lowering to level 0 is
//                     the way to stop someone writing while keeping that.
//                     The row stays, so past solutions keep their author.
//
// ── Why the SVG checks below exist ─────────────────────────────────────────
// A solution figure is stored as SVG markup and INLINED into the page by
// the reader's browser (that is what lets it follow the site's theme
// colors). Inlined SVG can carry <script>, event handlers and
// <foreignObject>, and the practice site shares an origin with the forum —
// including the forum's device_secret in localStorage. The reader's browser
// therefore runs every stored SVG through DOMPurify before inserting it
// (js/figure.js), and that is the real defence. The scan here is a second,
// cheaper filter so obviously hostile markup never even lands in the table:
// if an editor key ever leaked, a bad row would otherwise sit there waiting
// for a browser with an out-of-date sanitizer. Pending edits in
// solution_reviews go through the same checks, since approving one copies
// it into the row unchanged.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "jsr:@supabase/server@^1";

// Mixed into every editor key hash, so a dump of solution_editors alone is
// not enough to brute-force keys offline. Generate once with
// `openssl rand -hex 32`; set as an Edge Function secret, never typed by a
// person. Same role PIN_PEPPER and DEVICE_SECRET_PEPPER already play.
const SOLUTIONS_KEY_PEPPER = Deno.env.get("SOLUTIONS_KEY_PEPPER");

// The single key that may create or revoke editors. Site owner only.
const SOLUTIONS_ADMIN_KEY = Deno.env.get("SOLUTIONS_ADMIN_KEY");

const KEY_RE = /^[0-9a-f]{32}$/i;
const PROBLEM_KEY_RE = /^q[1-9][0-9]?_[A-Za-z][A-Za-z0-9_-]{0,30}$/;  // "q1_P47"
const EDITOR_NAME_RE = /^[\p{L}\p{N}._ -]{2,40}$/u;
const MAX_LINK_CHARS = 300;          // matches solution_editors_link_check

const MAX_SOLUTION_CHARS = 60_000;   // a very long worked solution is ~5k
const MAX_STEPS = 12;                // matches MAX_STEPS in editor/editor.js
const MAX_SVG_CHARS = 400_000;       // one compiled TikZ figure is ~1-50 kB
const MAX_TIKZ_CHARS = 20_000;
const MAX_SVG_SRC_CHARS = 300_000;   // pasted drawings carry long paths
const SVG_BOX_RE = /^-?\d*\.?\d+(e[-+]?\d+)?( -?\d*\.?\d+(e[-+]?\d+)?){3}$/i;
const MAX_CAPTION_CHARS = 500;
const MAX_REVIEW_NOTE_CHARS = 2_000; // matches solution_reviews_note_check

// Access levels (migration 013).
const OBSERVER = 0;
const PROPOSER = 1;
const AUTHOR = 2;
const REVIEWER = 3;
const FULL = 4;

// Share cards (migration 012). The picture is ~100-130 kB; the cap leaves
// room without letting the bucket fill with something else.
const SHARE_BUCKET = "share-cards";
const MAX_SHARE_IMAGE_BYTES = 1_500_000;
const MAX_SHARE_TITLE_CHARS = 160;
const MAX_SHARE_DESCRIPTION_CHARS = 400;

// Every column of a problem_solutions row the editor gets back.
const ROW_COLUMNS = "id, problem_key, owner_id, solution, figure, status, is_default, author, author_id, author_link, saved_by, problem_hash, created_at, updated_at, share";
// The same without the bodies, for index.
const META_COLUMNS = "id, problem_key, owner_id, status, is_default, author, author_id, saved_by, created_at, updated_at, share_for:share->>for, share_design:share->design, share_by:share->>by";
const REVIEW_COLUMNS = "solution_id, solution, figure, problem_hash, submitted_by, submitted_at, state, review_note, reviewed_by, reviewed_at";

type Editor = { id: number; name: string; link: string | null; level: number };

// One request's view of solution_editors: who is calling, and every
// editor's name by id (revoked ones too, so old rows still show an owner).
type Ctx = { db: any; editor: Editor; names: Map<number, string> };

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

// Length-independent comparison, so a wrong admin key can't be narrowed down
// by timing. (Editor keys are found by hash lookup, which never compares
// the key itself.)
function timingSafeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const ab = enc.encode(a);
  const bb = enc.encode(b);
  let diff = ab.length ^ bb.length;
  const n = Math.max(ab.length, bb.length);
  for (let i = 0; i < n; i++) diff |= (ab[i] ?? 0) ^ (bb[i] ?? 0);
  return diff === 0;
}

// Resolves an editor access key to its editor, plus every editor's name.
// Walks the (tiny) editors table because each row has its own salt, so the
// hash can't be computed without first knowing which salt to use. A handful
// of rows — this is a sub-millisecond loop, not a scan.
async function resolveEditor(db: any, key: unknown): Promise<Ctx | null> {
  if (!SOLUTIONS_KEY_PEPPER || typeof key !== "string" || !KEY_RE.test(key)) return null;

  const { data: rows, error } = await db
    .from("solution_editors")
    .select("id, name, link, level, key_hash, key_salt, revoked_at");

  if (error) {
    console.error("solution_editors read error:", error);
    return null;
  }
  const names = new Map<number, string>();
  let editor: Editor | null = null;
  for (const row of rows ?? []) {
    names.set(row.id, row.name);
    if (editor || row.revoked_at) continue;
    const candidate = await sha256Hex(`${SOLUTIONS_KEY_PEPPER}:${row.key_salt}:${key}`);
    if (candidate === row.key_hash) {
      editor = { id: row.id, name: row.name, link: row.link ?? null, level: row.level ?? OBSERVER };
    }
  }
  return editor ? { db, editor, names } : null;
}

// Markup that must never reach a reader's browser. Mirrors the FORBID list
// in js/figure.js's DOMPurify config — kept deliberately coarse: this is a
// filter against obviously hostile content, not a parser, and the browser's
// own sanitizer is what actually guarantees safety at render time.
const SVG_FORBIDDEN = [
  /<\s*script/i,
  /<\s*foreignObject/i,
  /<\s*iframe/i,
  /<\s*object/i,
  /<\s*embed/i,
  /\son[a-z]+\s*=/i,          // onclick=, onload=, ...
  /javascript\s*:/i,
  /data\s*:\s*text\/html/i,
  /<!ENTITY/i,                // XML entity expansion
];

function svgProblem(svg: string): string | null {
  if (typeof svg !== "string") return "figure step is not text";
  if (svg.length > MAX_SVG_CHARS) return "figure step is too large";
  if (svg && !/^\s*<svg[\s>]/i.test(svg)) return "figure step is not an SVG";
  for (const re of SVG_FORBIDDEN) {
    if (re.test(svg)) return "figure contains markup that is not allowed (scripts, event handlers or embedded documents)";
  }
  return null;
}

// Shape check for the `figure` jsonb. An empty object means "no figure".
function figureProblem(figure: any): string | null {
  if (figure === null || figure === undefined) return null;
  if (typeof figure !== "object" || Array.isArray(figure)) return "figure must be an object";
  const tikz = figure.tikz ?? "";
  if (typeof tikz !== "string" || tikz.length > MAX_TIKZ_CHARS) return "figure source is missing or too long";
  // SVG-mode figures (editor/svg-figure.js). The source is only ever parsed
  // inside the editor, which sanitizes everything it shows; readers get the
  // steps, which are checked below like any other.
  const kind = figure.kind ?? "tikz";
  if (kind !== "tikz" && kind !== "svg") return "unknown figure kind";
  const svgSrc = figure.svgSrc ?? "";
  if (typeof svgSrc !== "string" || svgSrc.length > MAX_SVG_SRC_CHARS) return "SVG figure source is too long";
  if (figure.svgBox !== undefined && (typeof figure.svgBox !== "string" || !SVG_BOX_RE.test(figure.svgBox))) {
    return "figure crop box must be four numbers: x y width height";
  }
  // Optional display scale set in the editor's preview (1 = default size).
  // Same range as FIG_SCALE_MIN/MAX in js/figure.js.
  if (figure.scale !== undefined &&
      (typeof figure.scale !== "number" || !(figure.scale >= 0.25 && figure.scale <= 2))) {
    return "figure scale must be a number between 0.25 and 2";
  }
  const steps = figure.steps ?? [];
  if (!Array.isArray(steps)) return "figure steps must be a list";
  if (steps.length > MAX_STEPS) return `a figure may have at most ${MAX_STEPS} steps`;
  for (const step of steps) {
    if (typeof step !== "object" || step === null) return "malformed figure step";
    const caption = step.caption ?? "";
    if (typeof caption !== "string" || caption.length > MAX_CAPTION_CHARS) return "a caption is missing or too long";
    const bad = svgProblem(step.svg ?? "");
    if (bad) return bad;
  }
  return null;
}

// Who to credit (migration 010): the key's owner when nothing (or their own
// name) is asked for, otherwise an ACTIVE editor looked up by name — never
// taken on trust, and the link comes from that editor's own row. Returns
// { name, link } or an error message.
async function creditFor(db: any, editor: Editor, wanted: unknown):
    Promise<{ id: number; name: string; link: string | null } | string> {
  if (wanted === undefined || wanted === null || wanted === "" || wanted === editor.name) {
    return { id: editor.id, name: editor.name, link: editor.link };
  }
  if (typeof wanted !== "string" || !EDITOR_NAME_RE.test(wanted)) return "Invalid author name.";
  const { data, error } = await db
    .from("solution_editors")
    .select("id, name, link")
    .eq("name", wanted)
    .is("revoked_at", null)
    .maybeSingle();
  if (error) {
    console.error("credit lookup error:", error);
    return "Could not check that editor, try again.";
  }
  if (!data) return "No active editor with that name to credit.";
  return { id: data.id, name: data.name, link: data.link ?? null };
}

// An editor's profile link: null to clear, otherwise an absolute http(s)
// URL. Returns undefined when the value is unacceptable. Only http(s), since
// it ends up in an href on the practice site.
function parseLink(raw: unknown): string | null | undefined {
  if (raw === null || raw === undefined || raw === "") return null;
  if (typeof raw !== "string" || raw.length > MAX_LINK_CHARS) return undefined;
  try {
    const u = new URL(raw.trim());
    return u.protocol === "http:" || u.protocol === "https:" ? u.href : undefined;
  } catch {
    return undefined;
  }
}

function parseLevel(raw: unknown): number | null {
  return Number.isInteger(raw) && (raw as number) >= OBSERVER && (raw as number) <= FULL ? raw as number : null;
}

// A row id as sent by the editor: a positive integer, or its digits.
function parseId(raw: unknown): number | null {
  const n = typeof raw === "string" && /^\d{1,15}$/.test(raw) ? Number(raw) : raw;
  return Number.isSafeInteger(n) && (n as number) > 0 ? n as number : null;
}

// Two timestamps as instants: the editor may hold 2026-…Z where the
// database answers 2026-…+00:00.
function sameInstant(a: unknown, b: unknown): boolean {
  return typeof a === "string" && typeof b === "string" && Date.parse(a) === Date.parse(b);
}

// A JPEG data: URL -> its bytes, or null when it is anything else.
function jpegBytes(raw: unknown): Uint8Array | null {
  if (typeof raw !== "string") return null;
  const m = raw.match(/^data:image\/jpeg;base64,([A-Za-z0-9+/]+={0,2})$/);
  if (!m || m[1].length * 3 / 4 > MAX_SHARE_IMAGE_BYTES) return null;
  let bytes: Uint8Array;
  try { bytes = Uint8Array.from(atob(m[1]), (c) => c.charCodeAt(0)); } catch { return null; }
  // Starts like a JPEG (SOI marker), so the bucket only ever holds pictures.
  return bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff ? bytes : null;
}

// The link-preview picture and its text as sent by the editor
// ({ image, title, description, design, by }), checked; or an error
// message. `by` is whose name the picture shows ("Solution by @name",
// drawn on versions other than the default; null on the default): stored
// so the editor can tell a card that no longer fits, after the default
// or the credit changed.
function parseShareCard(raw: any): { bytes: Uint8Array; title: string; description: string; design: number | null; by: string | null } | string {
  const bytes = jpegBytes(raw?.image);
  if (!bytes) return "The picture must be a JPEG of at most 1.5 MB.";
  const title = raw?.title;
  const description = raw?.description ?? "";
  if (typeof title !== "string" || !title.trim() || title.length > MAX_SHARE_TITLE_CHARS) {
    return "The link title is missing or too long.";
  }
  if (typeof description !== "string" || description.length > MAX_SHARE_DESCRIPTION_CHARS) {
    return "The link description is too long.";
  }
  const design = Number.isInteger(raw?.design) ? raw.design : null;
  const by = typeof raw?.by === "string" && EDITOR_NAME_RE.test(raw.by.replace(/^@/, "")) ? raw.by.replace(/^@/, "") : null;
  return { bytes, title: title.trim(), description: description.trim(), design, by };
}

// Uploads a picture under a new name; the name, or null if it failed. The
// row id keeps two solutions of one problem from sharing a name.
async function uploadShareImage(db: any, row: { id: number; problem_key: string }, bytes: Uint8Array): Promise<string | null> {
  const image = `${row.problem_key}-${row.id}-${Date.now()}.jpg`;
  const { error } = await db.storage
    .from(SHARE_BUCKET)
    .upload(image, bytes, { contentType: "image/jpeg", cacheControl: "31536000", upsert: false });
  if (error) {
    console.error("share image upload error:", error);
    return null;
  }
  return image;
}

// Deletes a stored share-card picture; a failure only leaves a stray file.
async function removeShareImage(db: any, share: any) {
  const name = share && typeof share.image === "string" ? share.image : null;
  if (!name) return;
  const { error } = await db.storage.from(SHARE_BUCKET).remove([name]);
  if (error) console.error("share image delete error:", error);
}

const bad = (error: string, status = 400) => Response.json({ ok: false, error }, { status });
const conflict = (row: unknown, error = "conflict") => Response.json({ ok: false, error, row }, { status: 409 });

// ── Permissions ────────────────────────────────────────────────────────────

const isOwn = (editor: Editor, row: any) => row.owner_id === editor.id;

// May write this row's content (own from level 1, anyone's from level 3).
const canEdit = (editor: Editor, row: any) => isOwn(editor, row) ? editor.level >= PROPOSER : editor.level >= REVIEWER;

// Review notes and pending edits: the author and the reviewers only.
const canSeeReview = (editor: Editor, row: any) => isOwn(editor, row) || editor.level >= REVIEWER;

// ── Rows as the editor gets them ───────────────────────────────────────────

// A review as shown to someone allowed to see it; content only when asked.
function reviewView(c: Ctx, r: any, withContent: boolean) {
  if (!r) return null;
  const v: Record<string, unknown> = {
    state: r.state,
    note: r.review_note ?? null,
    edit: r.solution !== null && r.solution !== undefined,
    submitted_by: c.names.get(r.submitted_by) ?? null,
    submitted_at: r.submitted_at,
    reviewed_by: r.reviewed_by ? c.names.get(r.reviewed_by) ?? null : null,
    reviewed_at: r.reviewed_at ?? null,
  };
  if (withContent && v.edit) {
    v.solution = r.solution;
    v.figure = r.figure;
    v.problem_hash = r.problem_hash;
  }
  return v;
}

// A row with its owner's name and (where visible) its review.
function present(c: Ctx, row: any, review: any, withContent = true) {
  if (!row) return null;
  return {
    ...row,
    owner: row.owner_id ? c.names.get(row.owner_id) ?? null : null,
    review: canSeeReview(c.editor, row) ? reviewView(c, review, withContent) : null,
  };
}

async function reviewsByRow(db: any, ids: number[]): Promise<Map<number, any>> {
  const out = new Map<number, any>();
  if (!ids.length) return out;
  const { data, error } = await db.from("solution_reviews").select(REVIEW_COLUMNS).in("solution_id", ids);
  if (error) console.error("reviews read error:", error);
  for (const r of data ?? []) out.set(r.solution_id, r);
  return out;
}

async function presentOne(c: Ctx, row: any) {
  if (!row) return null;
  const reviews = await reviewsByRow(c.db, [row.id]);
  return present(c, row, reviews.get(row.id) ?? null);
}

// The tabs' order: the default first, then oldest first.
const tabOrder = (a: any, b: any) =>
  (b.is_default ? 1 : 0) - (a.is_default ? 1 : 0) || Date.parse(a.created_at) - Date.parse(b.created_at) || a.id - b.id;

async function problemRows(c: Ctx, problemKey: string): Promise<any[] | null> {
  const { data, error } = await c.db.from("problem_solutions").select(ROW_COLUMNS).eq("problem_key", problemKey);
  if (error) {
    console.error("problem rows read error:", error);
    return null;
  }
  const rows = (data ?? []).sort(tabOrder);
  const reviews = await reviewsByRow(c.db, rows.map((r: any) => r.id));
  return rows.map((r: any) => present(c, r, reviews.get(r.id) ?? null));
}

// The row an old (pre-013) editor means by a bare problem_key: the
// caller's own, else the default, else the most recently saved.
function legacyPick(editor: Editor, rows: any[]): any | null {
  return rows.find((r) => isOwn(editor, r))
    ?? rows.find((r) => r.is_default)
    ?? [...rows].sort((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at))[0]
    ?? null;
}

// Which row a call is about (see "Which solution a call is about" above):
// { row, problemKey } with row null when it doesn't exist yet, or a
// Response to send back as is.
async function target(c: Ctx, payload: any, allowNew: boolean):
    Promise<{ row: any | null; problemKey: string } | Response> {
  if (payload?.id !== undefined && payload?.id !== null) {
    const id = parseId(payload.id);
    if (!id) return bad("Invalid solution id.");
    const { data: row, error } = await c.db.from("problem_solutions").select(ROW_COLUMNS).eq("id", id).maybeSingle();
    if (error) {
      console.error("target read error:", error);
      return bad("Could not read that solution.", 500);
    }
    if (!row) return bad("That solution no longer exists.", 404);
    return { row, problemKey: row.problem_key };
  }

  const problemKey = payload?.problem_key;
  if (typeof problemKey !== "string" || !PROBLEM_KEY_RE.test(problemKey)) return bad("Invalid problem key.");

  const { data: rows, error } = await c.db.from("problem_solutions").select(ROW_COLUMNS).eq("problem_key", problemKey);
  if (error) {
    console.error("target read error:", error);
    return bad("Could not read that problem's solutions.", 500);
  }

  if (payload?.new === true) {
    if (!allowNew) return bad("Name an existing solution by id.");
    const own = (rows ?? []).find((r: any) => isOwn(c.editor, r));
    if (own) return conflict(await presentOne(c, own), "exists");
    return { row: null, problemKey };
  }
  return { row: legacyPick(c.editor, rows ?? []), problemKey };
}

// ── Actions ────────────────────────────────────────────────────────────────

async function actionIndex(c: Ctx) {
  const { data: rows, error } = await c.db.from("problem_solutions").select(META_COLUMNS);
  if (error) {
    console.error("index error:", error);
    return bad("Could not read the solutions list.", 500);
  }
  const reviews = new Map<number, any>();
  {
    const { data, error: revErr } = await c.db.from("solution_reviews").select(REVIEW_COLUMNS);
    if (revErr) console.error("index/reviews error:", revErr);
    for (const r of data ?? []) reviews.set(r.solution_id, r);
  }
  const entries = (rows ?? []).map((r: any) => ({
    id: r.id,
    problem_key: r.problem_key,
    status: r.status,
    is_default: r.is_default,
    owner_id: r.owner_id,
    owner: r.owner_id ? c.names.get(r.owner_id) ?? null : null,
    author: r.author,
    saved_by: r.saved_by,
    created_at: r.created_at,
    updated_at: r.updated_at,
    // Which version and design the link-preview picture was drawn from.
    share: r.share_for ? { for: r.share_for, design: r.share_design, by: r.share_by ?? null } : null,
    review: canSeeReview(c.editor, r) ? reviewView(c, reviews.get(r.id), false) : null,
  }));

  const byProblem = new Map<string, any[]>();
  for (const e of entries) {
    const list = byProblem.get(e.problem_key) ?? [];
    list.push(e);
    byProblem.set(e.problem_key, list);
  }
  const index: Record<string, unknown> = {};
  for (const [key, list] of byProblem) index[key] = legacyPick(c.editor, list);

  return Response.json({ ok: true, index, rows: entries.sort((a: any, b: any) => a.problem_key.localeCompare(b.problem_key) || tabOrder(a, b)) });
}

async function actionSave(c: Ctx, payload: any) {
  const { db, editor } = c;
  const solution = payload?.solution ?? "";
  const wanted = payload?.status;
  const figure = payload?.figure ?? {};
  const problemHash = payload?.problem_hash ?? null;

  if (typeof solution !== "string" || solution.length > MAX_SOLUTION_CHARS) {
    return bad("The solution text is missing or too long.");
  }
  if (wanted !== "draft" && wanted !== "published") {
    return bad("status must be 'draft' or 'published'.");
  }
  if (problemHash !== null && (typeof problemHash !== "string" || problemHash.length > 128)) {
    return bad("Invalid problem hash.");
  }
  const figureBad = figureProblem(figure);
  if (figureBad) return bad(figureBad);

  if (editor.level < PROPOSER) return bad("Your access is read-only.", 403);

  const t = await target(c, payload, true);
  if (t instanceof Response) return t;
  const existing = t.row;

  if (existing && !canEdit(editor, existing)) {
    const owner = existing.owner_id ? c.names.get(existing.owner_id) : null;
    return bad(owner ? `This solution belongs to @${owner}.` : "You can't edit this solution.", 403);
  }

  // Quick check before anything is uploaded; the write below repeats it
  // atomically.
  const expected = payload?.expected_updated_at ?? null;
  if (existing && expected && !sameInstant(existing.updated_at, expected)) {
    return conflict(await presentOne(c, existing));
  }

  const own = !existing || isOwn(editor, existing);

  // What actually happens, by level (see the header).
  //   status   the row's status after this save
  //   review   "row"  : open a review of the row itself (new submission)
  //            "edit" : the row is NOT written; the content waits for review
  let status: string;
  let review: "row" | "edit" | null = null;
  if (own) {
    if (editor.level >= AUTHOR || wanted === "draft") {
      status = wanted;
    } else if (existing?.status === "published") {
      status = "published";
      review = "edit";
    } else {
      status = "review";
      review = "row";
    }
  } else {
    status = editor.level >= FULL ? wanted : existing.status;
  }

  if (review === "edit") {
    const { error } = await db.from("solution_reviews").upsert({
      solution_id: existing.id,
      solution, figure, problem_hash: problemHash,
      submitted_by: editor.id,
      submitted_at: new Date().toISOString(),
      state: "waiting", review_note: null, reviewed_by: null, reviewed_at: null,
    }, { onConflict: "solution_id" });
    if (error) {
      console.error("save/review error:", error);
      return bad("Could not submit the edit, try again.", 500);
    }
    return Response.json({ ok: true, row: await presentOne(c, existing), submitted: true });
  }

  // Credit (migration 010). A new row is credited to its creator; an
  // existing one keeps its credit. Only level 4 may name someone else, when
  // publishing — the editor asks who wrote the solution, since one editor
  // may polish another's work. The name is checked against
  // solution_editors, never taken on trust, and the link comes from that
  // editor's own row. Other levels' `author` is ignored rather than
  // refused, so the old editor (which always sends one) keeps working.
  // saved_by is never taken from the request: it is always the owner of
  // this key, the same principle post-message.ts applies to author_name.
  let author = existing ? existing.author : editor.name;
  let authorId = existing ? existing.author_id ?? null : editor.id;
  let authorLink = existing ? existing.author_link ?? null : editor.link;
  const wantedAuthor = payload?.author;
  if (editor.level >= FULL && status === "published" && wantedAuthor) {
    const credit = await creditFor(db, editor, wantedAuthor);
    if (typeof credit === "string") return bad(credit, credit.startsWith("Could not") ? 500 : 400);
    author = credit.name;
    authorId = credit.id;
    authorLink = credit.link;
  }

  // A publish carries its link-preview picture (migration 012), drawn by
  // the editor from exactly this content, so the two are stored together
  // and the card is recorded for this very version. If only the upload
  // fails, the solution is still saved (the picture only decides how a
  // shared link looks) and share_error says why; `share` then keeps the
  // old card, which the editor's Check all lists as out of date. Anything
  // but a publish leaves `share` alone. A new row has no id to name the
  // picture by yet, so its card is stored right after the insert.
  let card: ReturnType<typeof parseShareCard> | null = null;
  if (status === "published" && payload?.share) {
    card = parseShareCard(payload.share);
    if (typeof card === "string") return bad(card);
  }
  const updatedAt = new Date().toISOString();
  let shareError: string | null = null;
  const storeCard = async (row: { id: number; problem_key: string }): Promise<Record<string, unknown> | null> => {
    if (!card || typeof card === "string") return null;
    const image = await uploadShareImage(db, row, card.bytes);
    if (image) return { image, title: card.title, description: card.description, for: updatedAt, design: card.design, by: card.by };
    shareError = "the picture could not be stored";
    return null;
  };

  const fields: Record<string, unknown> = {
    solution,
    figure,
    status,
    author,
    author_id: authorId,
    author_link: authorLink,
    saved_by: editor.name,
    problem_hash: problemHash,
    updated_at: updatedAt,
  };

  let saved: any;
  if (existing) {
    const share = await storeCard(existing);
    if (share) fields.share = share;
    // Written only if the row is still what the caller saw: a save landing
    // between the check above and this write is reported, not overwritten.
    let q = db.from("problem_solutions").update(fields).eq("id", existing.id);
    if (expected) q = q.eq("updated_at", expected);
    const { data, error } = await q.select(ROW_COLUMNS);
    if (error || !data?.length) {
      if (share) await removeShareImage(db, share);
      if (error) {
        console.error("save/write error:", error);
        return bad("Could not save, try again.", 500);
      }
      const { data: now } = await db.from("problem_solutions").select(ROW_COLUMNS).eq("id", existing.id).maybeSingle();
      return now ? conflict(await presentOne(c, now)) : bad("That solution no longer exists.", 404);
    }
    saved = data[0];
    if (share && existing.share?.image) await removeShareImage(db, existing.share);
  } else {
    const { data, error } = await db
      .from("problem_solutions")
      .insert({ ...fields, problem_key: t.problemKey, owner_id: editor.id, created_at: updatedAt })
      .select(ROW_COLUMNS)
      .single();
    if (error) {
      // Unique (problem_key, owner_id): this editor's solution was created
      // meanwhile (another tab).
      if (error.code === "23505") {
        const { data: own } = await db.from("problem_solutions").select(ROW_COLUMNS)
          .eq("problem_key", t.problemKey).eq("owner_id", editor.id).maybeSingle();
        return conflict(await presentOne(c, own), "exists");
      }
      console.error("save/insert error:", error);
      return bad("Could not save, try again.", 500);
    }
    saved = data;
    const share = await storeCard(saved);
    if (share) {
      const { data: withCard, error: cardErr } = await db.from("problem_solutions")
        .update({ share }).eq("id", saved.id).eq("updated_at", updatedAt).select(ROW_COLUMNS);
      if (cardErr || !withCard?.length) {
        if (cardErr) console.error("save/card error:", cardErr);
        await removeShareImage(db, share);
        shareError = "the picture could not be stored";
      } else {
        saved = withCard[0];
      }
    }
  }

  if (review === "row") {
    const { error } = await db.from("solution_reviews").upsert({
      solution_id: saved.id,
      solution: null, figure: null, problem_hash: null,
      submitted_by: editor.id,
      submitted_at: updatedAt,
      state: "waiting", review_note: null, reviewed_by: null, reviewed_at: null,
    }, { onConflict: "solution_id" });
    if (error) console.error("save/submit error:", error);
  } else if (status !== "review") {
    // A waiting submission of the row itself is settled by this save
    // (withdrawn to a draft, or published by level 2+ / level 4). Rejected
    // ones stay, so their note can still be read.
    const { error } = await db.from("solution_reviews").delete()
      .eq("solution_id", saved.id).is("solution", null).eq("state", "waiting");
    if (error) console.error("save/settle error:", error);
  }

  const out: Record<string, unknown> = { ok: true, row: await presentOne(c, saved) };
  if (review === "row") out.submitted = true;
  if (shareError) out.share_error = shareError;
  return Response.json(out);
}

// Only the credit of an existing row: the content is never touched, so
// nobody's newer text can be replaced by a stale copy. Refused (409, with
// the current row) when the row changed after the caller last saw it —
// the credit was decided looking at that version.
async function actionSetCredit(c: Ctx, payload: any) {
  const { db, editor } = c;
  if (editor.level < FULL) return bad("Only full editors can change credit.", 403);
  const t = await target(c, payload, false);
  if (t instanceof Response) return t;
  const existing = t.row;
  if (!existing) return bad("Nothing is stored for this problem.", 404);

  const expected = payload?.expected_updated_at ?? null;
  if (expected && !sameInstant(existing.updated_at, expected)) return conflict(await presentOne(c, existing));

  const credit = await creditFor(db, editor, payload?.author);
  if (typeof credit === "string") return bad(credit, credit.startsWith("Could not") ? 500 : 400);
  const updatedAt = new Date().toISOString();
  const change: Record<string, unknown> = { author: credit.name, author_id: credit.id, author_link: credit.link, saved_by: editor.name, updated_at: updatedAt };
  // The link preview doesn't show who is credited: a card drawn from this
  // version stays current for the new updated_at.
  if (existing.share?.for && sameInstant(existing.share.for, existing.updated_at)) {
    change.share = { ...existing.share, for: updatedAt };
  }
  const { data, error } = await db
    .from("problem_solutions")
    .update(change)
    .eq("id", existing.id)
    .eq("updated_at", existing.updated_at)
    .select(ROW_COLUMNS);
  if (error) {
    console.error("set-credit/write error:", error);
    return bad("Could not change the credit, try again.", 500);
  }
  if (!data?.length) {
    const { data: now } = await db.from("problem_solutions").select(ROW_COLUMNS).eq("id", existing.id).maybeSingle();
    return now ? conflict(await presentOne(c, now)) : bad("That solution no longer exists.", 404);
  }
  return Response.json({ ok: true, row: await presentOne(c, data[0]) });
}

async function actionSetDefault(c: Ctx, payload: any) {
  if (c.editor.level < FULL) return bad("Only full editors can choose the default solution.", 403);
  const id = parseId(payload?.id);
  if (!id) return bad("Invalid solution id.");
  // Only a published row can be the default (migration 013's trigger would
  // silently refuse otherwise, so say why instead).
  const { data, error } = await c.db
    .from("problem_solutions")
    .update({ is_default: true })
    .eq("id", id)
    .eq("status", "published")
    .select("problem_key");
  if (error) {
    console.error("set-default error:", error);
    return bad("Could not change the default, try again.", 500);
  }
  if (!data?.length) return bad("Only a published solution can be the default.", 409);
  const rows = await problemRows(c, data[0].problem_key);
  return rows ? Response.json({ ok: true, rows }) : bad("Could not read that problem's solutions.", 500);
}

// The link-preview picture. Stored under a new name every time (no cached
// copy anywhere can outlive it), recorded in `share` only if the row is
// still the published version it was drawn from, and the previous picture
// is deleted afterwards.
async function actionShareCard(c: Ctx, payload: any) {
  const { db, editor } = c;
  const card = parseShareCard(payload);
  if (typeof card === "string") return bad(card);
  const drawnFor = payload?.for;
  if (typeof drawnFor !== "string" || !drawnFor) return bad("Missing the version the picture was drawn from.");

  const t = await target(c, payload, false);
  if (t instanceof Response) return t;
  const existing = t.row;
  if (!existing || existing.status !== "published" || !sameInstant(existing.updated_at, drawnFor)) {
    return bad("stale", 409);
  }
  // The picture is shown in every link preview without going through
  // review, so a level 1 editor can't set it even on their own solution:
  // the reviewer's editor draws it when approving.
  if (isOwn(editor, existing) ? editor.level < AUTHOR : editor.level < REVIEWER) {
    return bad("You can't change this solution's link preview.", 403);
  }

  const image = await uploadShareImage(db, existing, card.bytes);
  if (!image) return bad("Could not store the picture, try again.", 500);

  const share = { image, title: card.title, description: card.description, for: drawnFor, design: card.design, by: card.by };
  const { data: saved, error } = await db
    .from("problem_solutions")
    .update({ share })
    .eq("id", existing.id)
    .eq("status", "published")
    .eq("updated_at", existing.updated_at)
    .select("share");
  if (error || !saved?.length) {
    if (error) console.error("share-card/write error:", error);
    await removeShareImage(db, share);
    return error ? bad("Could not store the picture, try again.", 500) : bad("stale", 409);
  }
  if (existing.share?.image !== image) await removeShareImage(db, existing.share);
  return Response.json({ ok: true, share });
}

async function actionDelete(c: Ctx, payload: any) {
  const t = await target(c, payload, false);
  if (t instanceof Response) return t;
  const existing = t.row;
  if (!existing) return Response.json({ ok: true });
  // Taking down one's own work is never refused, whatever the level.
  if (!isOwn(c.editor, existing) && c.editor.level < FULL) {
    return bad("Only full editors can delete someone else's solution.", 403);
  }
  const { data: gone, error } = await c.db
    .from("problem_solutions")
    .delete()
    .eq("id", existing.id)
    .select("share");
  if (error) {
    console.error("delete error:", error);
    return bad("Could not delete that solution.", 500);
  }
  for (const r of gone ?? []) await removeShareImage(c.db, r.share);
  return Response.json({ ok: true });
}

async function actionReviews(c: Ctx) {
  if (c.editor.level < REVIEWER) return bad("Only reviewers can see the review queue.", 403);
  const { data: reviews, error } = await c.db.from("solution_reviews").select(REVIEW_COLUMNS);
  if (error) {
    console.error("reviews error:", error);
    return bad("Could not read the review queue.", 500);
  }
  const ids = (reviews ?? []).map((r: any) => r.solution_id);
  const rows = new Map<number, any>();
  if (ids.length) {
    const { data, error: rowErr } = await c.db.from("problem_solutions").select(META_COLUMNS).in("id", ids);
    if (rowErr) console.error("reviews/rows error:", rowErr);
    for (const r of data ?? []) rows.set(r.id, r);
  }
  const out = (reviews ?? [])
    .filter((r: any) => rows.has(r.solution_id))
    .map((r: any) => {
      const row = rows.get(r.solution_id);
      return {
        id: row.id,
        problem_key: row.problem_key,
        status: row.status,
        owner: row.owner_id ? c.names.get(row.owner_id) ?? null : null,
        review: reviewView(c, r, false),
      };
    })
    .sort((a: any, b: any) => Date.parse(a.review.submitted_at) - Date.parse(b.review.submitted_at));
  return Response.json({ ok: true, reviews: out });
}

async function actionReviewDecision(c: Ctx, payload: any, approve: boolean) {
  const { db, editor } = c;
  if (editor.level < REVIEWER) return bad("Only reviewers can approve or reject.", 403);
  const id = parseId(payload?.id);
  if (!id) return bad("Invalid solution id.");

  const note = payload?.note ?? null;
  if (note !== null && (typeof note !== "string" || note.length > MAX_REVIEW_NOTE_CHARS)) {
    return bad("The note is too long.");
  }

  const { data: review, error: revErr } = await db.from("solution_reviews").select(REVIEW_COLUMNS).eq("solution_id", id).maybeSingle();
  const { data: row, error: rowErr } = await db.from("problem_solutions").select(ROW_COLUMNS).eq("id", id).maybeSingle();
  if (revErr || rowErr) {
    console.error("review read error:", revErr || rowErr);
    return bad("Could not read that review.", 500);
  }
  if (!row) return bad("That solution no longer exists.", 404);
  if (!review || review.state !== "waiting") return bad("Nothing is waiting for review on this solution.", 409);
  // Someone promoted after submitting doesn't approve their own work.
  if (review.submitted_by === editor.id && editor.level < FULL) {
    return bad("Someone else has to review your own submission.", 403);
  }
  // The decision is about what the reviewer read: if the author has
  // resubmitted (or saved the row) since, nothing is decided and the
  // reviewer gets the new version to read first. Both are optional only
  // for calls from outside the editor (curl), which then decide on
  // whatever is current.
  if (payload?.submitted_at && !sameInstant(review.submitted_at, payload.submitted_at)) {
    return conflict(await presentOne(c, row), "changed");
  }
  if (payload?.expected_updated_at && !sameInstant(row.updated_at, payload.expected_updated_at)) {
    return conflict(await presentOne(c, row), "changed");
  }

  if (!approve) {
    const { error } = await db.from("solution_reviews").update({
      state: "rejected",
      review_note: note?.trim() || null,
      reviewed_by: editor.id,
      reviewed_at: new Date().toISOString(),
    }).eq("solution_id", id).eq("state", "waiting");
    if (error) {
      console.error("review-reject error:", error);
      return bad("Could not reject, try again.", 500);
    }
    let current = row;
    // A rejected new submission goes back to being the author's draft.
    // updated_at is left alone: the author's next save shouldn't look
    // like a conflict with a review decision.
    if (review.solution === null && row.status === "review") {
      const { data } = await db.from("problem_solutions").update({ status: "draft" })
        .eq("id", id).eq("status", "review").select(ROW_COLUMNS);
      if (data?.length) current = data[0];
    }
    return Response.json({ ok: true, row: await presentOne(c, current) });
  }

  // Approve. A pending edit is copied into the row as the author's save; a
  // new submission is published as it stands.
  let change: Record<string, unknown>;
  if (review.solution !== null) {
    const figureBad = figureProblem(review.figure ?? {});
    if (figureBad) return bad(`The submitted figure can't be published: ${figureBad}`);
    change = {
      solution: review.solution,
      figure: review.figure ?? {},
      problem_hash: review.problem_hash,
      saved_by: c.names.get(review.submitted_by) ?? row.saved_by,
      updated_at: new Date().toISOString(),
    };
  } else {
    if (row.status !== "review") {
      // Settled some other way meanwhile (withdrawn, or published by level 4).
      await db.from("solution_reviews").delete().eq("solution_id", id);
      return Response.json({ ok: true, row: await presentOne(c, row) });
    }
    change = { status: "published", updated_at: new Date().toISOString() };
  }
  const { data, error } = await db.from("problem_solutions").update(change)
    .eq("id", id).eq("updated_at", row.updated_at).select(ROW_COLUMNS);
  if (error) {
    console.error("review-approve error:", error);
    return bad("Could not approve, try again.", 500);
  }
  if (!data?.length) return conflict(await presentOne(c, row), "changed");
  // Only the review that was approved: a resubmission landing in between
  // replaces the row's review and must stay waiting.
  const { error: delErr } = await db.from("solution_reviews").delete()
    .eq("solution_id", id).eq("submitted_at", review.submitted_at);
  if (delErr) console.error("review-approve/cleanup error:", delErr);
  return Response.json({ ok: true, row: await presentOne(c, data[0]) });
}

// ── Editor management (admin key) ──────────────────────────────────────────

async function editorManagement(req: Request, admin: any, action: string, payload: any) {
  const adminKey = (typeof payload?.admin_key === "string" ? payload.admin_key : "")
    || req.headers.get("x-admin-key") || "";
  if (!SOLUTIONS_ADMIN_KEY || !timingSafeEqual(adminKey, SOLUTIONS_ADMIN_KEY)) {
    return bad("admin_auth_failed", 403);
  }
  const name = payload?.name;
  if (typeof name !== "string" || !EDITOR_NAME_RE.test(name)) {
    return bad("Editor name must be 2-40 letters, digits, spaces, dots, dashes or underscores.");
  }

  if (action === "revoke-editor") {
    // Must never be blocked by anything else in the body: it is what you
    // reach for when a key has leaked.
    const { error } = await admin
      .from("solution_editors")
      .update({ revoked_at: new Date().toISOString() })
      .eq("name", name)
      .is("revoked_at", null);
    if (error) {
      console.error("revoke-editor error:", error);
      return bad("Could not revoke that editor.", 500);
    }
    return Response.json({ ok: true });
  }

  if (action === "set-editor-level") {
    const level = parseLevel(payload?.level);
    if (level === null) return bad("level must be 0, 1, 2, 3 or 4.");
    const { data: rows, error } = await admin
      .from("solution_editors")
      .update({ level })
      .eq("name", name)
      .is("revoked_at", null)
      .select("id");
    if (error) {
      console.error("set-editor-level error:", error);
      return bad("Could not set that level.", 500);
    }
    if (!rows?.length) return bad("No active editor with that name.", 404);
    return Response.json({ ok: true });
  }

  const link = parseLink(payload?.link);
  if (link === undefined) return bad("The link must be a full http:// or https:// address.");

  if (action === "set-editor-link") {
    const { data: rows, error } = await admin
      .from("solution_editors")
      .update({ link })
      .eq("name", name)
      .is("revoked_at", null)
      .select("id");
    if (error) {
      console.error("set-editor-link error:", error);
      return bad("Could not set that link.", 500);
    }
    if (!rows?.length) return bad("No active editor with that name.", 404);
    return Response.json({ ok: true });
  }

  // create-editor
  if (!SOLUTIONS_KEY_PEPPER) return bad("SOLUTIONS_KEY_PEPPER is not set on this function.", 500);
  const level = payload?.level === undefined || payload?.level === null ? OBSERVER : parseLevel(payload.level);
  if (level === null) return bad("level must be 0, 1, 2, 3 or 4.");

  // 16 bytes = 32 hex characters = 128 bits of entropy.
  const key = randomHex(16);
  const salt = randomHex(16);
  const key_hash = await sha256Hex(`${SOLUTIONS_KEY_PEPPER}:${salt}:${key}`);

  const { error } = await admin
    .from("solution_editors")
    .insert({ name, link, level, key_hash, key_salt: salt });
  if (error) {
    console.error("create-editor error:", error);
    return bad("Could not create that editor.", 500);
  }
  // The only time this key is ever visible. Hand it over now or it is gone.
  return Response.json({ ok: true, name, key, level });
}

const ADMIN_ACTIONS = new Set(["create-editor", "revoke-editor", "set-editor-link", "set-editor-level"]);

export default {
  fetch: withSupabase({ auth: "publishable" }, async (req, ctx) => {
    if (req.method !== "POST") return bad("Use POST.", 405);

    let payload: any;
    try { payload = await req.json(); } catch { return bad("Malformed request body."); }

    const action = payload?.action;
    if (typeof action !== "string") return bad("Missing action.");

    const admin = ctx.supabaseAdmin;

    if (ADMIN_ACTIONS.has(action)) return editorManagement(req, admin, action, payload);

    // ── Everything else needs an editor key ────────────────────────────────
    const c = await resolveEditor(admin, payload?.key ?? req.headers.get("x-solutions-key"));
    if (!c) return bad("key_auth_failed", 403);

    switch (action) {
      case "whoami":
        return Response.json({ ok: true, id: c.editor.id, name: c.editor.name, level: c.editor.level });

      case "editors": {
        const { data: rows, error } = await admin
          .from("solution_editors")
          .select("name, link, level")
          .is("revoked_at", null)
          .order("name", { ascending: true });
        if (error) {
          console.error("editors error:", error);
          return bad("Could not read the editors list.", 500);
        }
        const full = c.editor.level >= FULL;
        const editors = (rows ?? []).map((r: any) => full ? r : { name: r.name, link: r.link });
        return Response.json({ ok: true, editors });
      }

      case "index":
        return actionIndex(c);

      case "get": {
        const t = await target(c, payload, false);
        if (t instanceof Response) return t;
        return Response.json({ ok: true, row: await presentOne(c, t.row) });
      }

      case "list": {
        const problemKey = payload?.problem_key;
        if (typeof problemKey !== "string" || !PROBLEM_KEY_RE.test(problemKey)) return bad("Invalid problem key.");
        const rows = await problemRows(c, problemKey);
        return rows ? Response.json({ ok: true, rows }) : bad("Could not read that problem's solutions.", 500);
      }

      case "save":
        return actionSave(c, payload);
      case "set-credit":
        return actionSetCredit(c, payload);
      case "set-default":
        return actionSetDefault(c, payload);
      case "share-card":
        return actionShareCard(c, payload);
      case "delete":
        return actionDelete(c, payload);
      case "reviews":
        return actionReviews(c);
      case "review-approve":
        return actionReviewDecision(c, payload, true);
      case "review-reject":
        return actionReviewDecision(c, payload, false);

      case "export": {
        const { data: rows, error } = await admin
          .from("problem_solutions")
          .select(ROW_COLUMNS)
          .order("problem_key", { ascending: true });
        if (error) {
          console.error("export error:", error);
          return bad("Could not export.", 500);
        }
        const out: Record<string, unknown> = { ok: true, rows: rows ?? [] };
        if (c.editor.level >= FULL) {
          const { data: reviews, error: revErr } = await admin.from("solution_reviews").select(REVIEW_COLUMNS);
          if (revErr) console.error("export/reviews error:", revErr);
          out.reviews = reviews ?? [];
        }
        return Response.json(out);
      }
    }

    return bad("Unknown action.");
  }),
};
