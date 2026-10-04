// Edge Function: solutions-admin
//
// Deploy as the "solutions-admin" Edge Function. Auth mode: "publishable",
// same as post-message/claim-nickname/sync-quiz-attempts. "Verify JWT with
// legacy secret" OFF.
//
// Requires superbase/migrations/008_problem_solutions.sql to have been run
// first, in this same project.
//
// This is the ONLY way anything is ever written to problem_solutions.
// Reading PUBLISHED solutions does not come through here at all — the
// practice site selects them directly with the publishable key, which the
// RLS policy in migration 008 limits to status = 'published'. This function
// exists for everything that policy deliberately cannot do: see drafts,
// write, publish, unpublish, delete.
//
// ── Who may call it ────────────────────────────────────────────────────────
// Every action except "create-editor"/"revoke-editor" needs an editor access
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
// "create-editor" and "revoke-editor" instead need `admin_key` in the body
// to match the SOLUTIONS_ADMIN_KEY secret. That key belongs to the site
// owner alone.
//
// Both are also accepted as the x-solutions-key / x-admin-key headers, for
// calls made outside a browser (curl, the SQL-free setup path), where
// preflight never applies.
//
// ── Request shape ──────────────────────────────────────────────────────────
//   POST { action: "...", key: "<32 hex>", ...fields }
//         (admin_key instead of key for the two editor-management actions)
//
//   diagnose       -> { ok, pepper_set, admin_key_set, pepper_fingerprint,
//                        editor_rows }
//                     No auth. Setup aid only — see the comment at its
//                     implementation below.
//   whoami         -> { ok, name }
//                     Who this key belongs to. The editor shows it in the
//                     top bar, and uses it to confirm the key works at all.
//   index          -> { ok, index: { "<problem_key>": { status, updated_at,
//                                                       author } } }
//                     Every row's status, drafts included. One call at
//                     editor startup; the list is small (hundreds of rows,
//                     no bodies) so there is no paging.
//   get            { problem_key } -> { ok, row }
//                     One full row, or row: null.
//   save           { problem_key, solution, figure, status, problem_hash?,
//                    expected_updated_at? } -> { ok, row }
//                     Creates or replaces the row. expected_updated_at is
//                     what the caller last saw; if the stored row has moved
//                     on since, nothing is written and 409 comes back with
//                     the current row, so the other editor's work is never
//                     silently overwritten. Omit it only when creating a
//                     row that does not exist yet.
//   delete         { problem_key } -> { ok }
//   export         -> { ok, rows: [...] }
//                     Everything, for the editor's JSON backup button.
//   create-editor  { name } -> { ok, name, key }      [admin key]
//                     The generated key is shown ONCE. Only its hash is
//                     stored, so it cannot be recovered later.
//   revoke-editor  { name } -> { ok }                 [admin key]
//                     The key stops working immediately. The row stays, so
//                     past solutions keep showing their author.
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
// for a browser with an out-of-date sanitizer.

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

const MAX_SOLUTION_CHARS = 60_000;   // a very long worked solution is ~5k
const MAX_STEPS = 12;                // matches MAX_STEPS in editor/editor.js
const MAX_SVG_CHARS = 400_000;       // one compiled TikZ figure is ~1-50 kB
const MAX_TIKZ_CHARS = 20_000;
const MAX_CAPTION_CHARS = 500;

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

// Resolves an editor access key to its row, or null. Walks the (tiny)
// editors table because each row has its own salt, so the hash can't be
// computed without first knowing which salt to use. Two or three rows —
// this is a sub-millisecond loop, not a scan.
async function resolveEditor(db: any, key: unknown): Promise<{ id: number; name: string } | null> {
  if (!SOLUTIONS_KEY_PEPPER || typeof key !== "string" || !KEY_RE.test(key)) return null;

  const { data: rows, error } = await db
    .from("solution_editors")
    .select("id, name, key_hash, key_salt, revoked_at")
    .is("revoked_at", null);

  if (error) {
    console.error("solution_editors read error:", error);
    return null;
  }
  for (const row of rows ?? []) {
    const candidate = await sha256Hex(`${SOLUTIONS_KEY_PEPPER}:${row.key_salt}:${key}`);
    if (candidate === row.key_hash) return { id: row.id, name: row.name };
  }
  return null;
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

const bad = (error: string, status = 400) => Response.json({ ok: false, error }, { status });

export default {
  fetch: withSupabase({ auth: "publishable" }, async (req, ctx) => {
    if (req.method !== "POST") return bad("Use POST.", 405);

    let payload: any;
    try { payload = await req.json(); } catch { return bad("Malformed request body."); }

    const action = payload?.action;
    if (typeof action !== "string") return bad("Missing action.");

    const admin = ctx.supabaseAdmin;

    // ── Diagnostics (no auth) ──────────────────────────────────────────────
    // Setup-time only: says whether each secret is set, and a one-way
    // fingerprint of the pepper so it can be compared against the value
    // used when an editor row was created — WITHOUT either side revealing
    // the pepper. The fingerprint is a truncated SHA-256 of a 128-bit
    // random value, so it gives an attacker nothing, but this action is
    // still worth deleting once the setup is known good.
    //
    // Compare with, in the SQL editor:
    //   select left(encode(digest('<your pepper>', 'sha256'), 'hex'), 12);
    if (action === "diagnose") {
      const { count } = await admin
        .from("solution_editors")
        .select("id", { count: "exact", head: true });
      return Response.json({
        ok: true,
        pepper_set: !!SOLUTIONS_KEY_PEPPER,
        admin_key_set: !!SOLUTIONS_ADMIN_KEY,
        pepper_fingerprint: SOLUTIONS_KEY_PEPPER ? (await sha256Hex(SOLUTIONS_KEY_PEPPER)).slice(0, 12) : null,
        editor_rows: count ?? 0,
      });
    }

    // ── Editor management (admin key) ──────────────────────────────────────
    if (action === "create-editor" || action === "revoke-editor") {
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

      if (!SOLUTIONS_KEY_PEPPER) return bad("SOLUTIONS_KEY_PEPPER is not set on this function.", 500);

      // 16 bytes = 32 hex characters = 128 bits of entropy.
      const key = randomHex(16);
      const salt = randomHex(16);
      const key_hash = await sha256Hex(`${SOLUTIONS_KEY_PEPPER}:${salt}:${key}`);

      const { error } = await admin
        .from("solution_editors")
        .insert({ name, key_hash, key_salt: salt });
      if (error) {
        console.error("create-editor error:", error);
        return bad("Could not create that editor.", 500);
      }
      // The only time this key is ever visible. Hand it over now or it is gone.
      return Response.json({ ok: true, name, key });
    }

    // ── Everything else needs an editor key ────────────────────────────────
    const editor = await resolveEditor(admin, payload?.key ?? req.headers.get("x-solutions-key"));
    if (!editor) return bad("key_auth_failed", 403);

    if (action === "whoami") {
      return Response.json({ ok: true, name: editor.name });
    }

    if (action === "index") {
      const { data: rows, error } = await admin
        .from("problem_solutions")
        .select("problem_key, status, updated_at, author");
      if (error) {
        console.error("index error:", error);
        return bad("Could not read the solutions list.", 500);
      }
      const index: Record<string, unknown> = {};
      for (const r of rows ?? []) {
        index[r.problem_key] = { status: r.status, updated_at: r.updated_at, author: r.author };
      }
      return Response.json({ ok: true, index });
    }

    if (action === "export") {
      const { data: rows, error } = await admin
        .from("problem_solutions")
        .select("problem_key, solution, figure, status, author, problem_hash, updated_at")
        .order("problem_key", { ascending: true });
      if (error) {
        console.error("export error:", error);
        return bad("Could not export.", 500);
      }
      return Response.json({ ok: true, rows: rows ?? [] });
    }

    const problemKey = payload?.problem_key;
    if (typeof problemKey !== "string" || !PROBLEM_KEY_RE.test(problemKey)) {
      return bad("Invalid problem key.");
    }

    if (action === "get") {
      const { data: row, error } = await admin
        .from("problem_solutions")
        .select("problem_key, solution, figure, status, author, problem_hash, updated_at")
        .eq("problem_key", problemKey)
        .maybeSingle();
      if (error) {
        console.error("get error:", error);
        return bad("Could not read that solution.", 500);
      }
      return Response.json({ ok: true, row: row ?? null });
    }

    if (action === "delete") {
      const { error } = await admin.from("problem_solutions").delete().eq("problem_key", problemKey);
      if (error) {
        console.error("delete error:", error);
        return bad("Could not delete that solution.", 500);
      }
      return Response.json({ ok: true });
    }

    if (action === "save") {
      const solution = payload?.solution ?? "";
      const status = payload?.status;
      const figure = payload?.figure ?? {};
      const problemHash = payload?.problem_hash ?? null;

      if (typeof solution !== "string" || solution.length > MAX_SOLUTION_CHARS) {
        return bad("The solution text is missing or too long.");
      }
      if (status !== "draft" && status !== "published") {
        return bad("status must be 'draft' or 'published'.");
      }
      if (problemHash !== null && (typeof problemHash !== "string" || problemHash.length > 128)) {
        return bad("Invalid problem hash.");
      }
      const figureBad = figureProblem(figure);
      if (figureBad) return bad(figureBad);

      // Read first, so an edit made by the other editor between their save
      // and this one is reported rather than silently overwritten. A read +
      // write is not atomic, but two people editing the same problem in the
      // same second is not a case worth a transaction here: the window is
      // milliseconds, and the loser still sees the other's version on their
      // next load.
      const { data: existing, error: readErr } = await admin
        .from("problem_solutions")
        .select("problem_key, solution, figure, status, author, problem_hash, updated_at")
        .eq("problem_key", problemKey)
        .maybeSingle();
      if (readErr) {
        console.error("save/read error:", readErr);
        return bad("Could not save, try again.", 500);
      }

      const expected = payload?.expected_updated_at ?? null;
      if (existing && expected && existing.updated_at !== expected) {
        return Response.json(
          { ok: false, error: "conflict", row: existing },
          { status: 409 },
        );
      }

      const row = {
        problem_key: problemKey,
        solution,
        figure,
        status,
        // Never taken from the request body: authorship is whoever's key
        // this is, the same principle post-message.ts applies to
        // author_name.
        author: editor.name,
        problem_hash: problemHash,
        updated_at: new Date().toISOString(),
      };

      const { data: saved, error: writeErr } = await admin
        .from("problem_solutions")
        .upsert(row, { onConflict: "problem_key" })
        .select("problem_key, solution, figure, status, author, problem_hash, updated_at")
        .single();
      if (writeErr) {
        console.error("save/write error:", writeErr);
        return bad("Could not save, try again.", 500);
      }
      return Response.json({ ok: true, row: saved });
    }

    return bad("Unknown action.");
  }),
};
