/* ═══════════════════════════════════════════════════════════════════
   store.js  ·  Where solutions are read from and written to
   ───────────────────────────────────────────────────────────────────
   THIS IS THE ONLY FILE THAT TALKS TO "THE SERVER".

   OFFLINE STAND-IN for editor/store.js: same methods, but everything
   lives in this browser's localStorage instead of the database. Swap
   which of the two files editor/index.html loads to use it — handy for
   layout work, demos, or trying the editor before the Supabase side of
   a course is set up. Nothing is shared with anyone else.

   A stored row looks exactly like the planned table row:
     { problem_key, solution, figure: { tikz, captions, steps[] },
       status: 'draft' | 'published', author, updated_at }
   `steps` holds the compiled SVGs; the practice site shows those and
   never runs TikZJax.
   ─────────────────────────────────────────────────────────────────── */

const SolutionStore = (function () {
  'use strict';

  const KEY = STORAGE_PREFIX + '-editor-server-mock';
  const LAG = 250; // ms — a touch of latency, so the UI is honest about being async

  function read() {
    try { return JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch (e) { return {}; }
  }
  function write(all) { localStorage.setItem(KEY, JSON.stringify(all)); }
  const wait = (v) => new Promise((res) => setTimeout(() => res(v), LAG));

  /** Who the stored key belongs to. The real version asks the server, which
      looks the key's hash up in the editors table and returns that name. */
  async function whoami() {
    return wait({ name: null });          // null -> the UI just says "editor"
  }

  /** Every problem_key that has a row, with its status — one call at load,
      so the list can show what is published without fetching every row. */
  async function index() {
    const all = read();
    const out = {};
    Object.keys(all).forEach((k) => { out[k] = { status: all[k].status, updated_at: all[k].updated_at }; });
    return wait(out);
  }

  /** One full row, or null when nothing is stored for this problem. */
  async function get(problemKey) {
    return wait(read()[problemKey] || null);
  }

  /** Create or overwrite a row. expectedUpdatedAt guards against the other
      editor having saved in the meantime (the real version does this check
      in SQL and returns 409). */
  async function save(problemKey, payload, expectedUpdatedAt) {
    const all = read();
    const cur = all[problemKey];
    if (cur && expectedUpdatedAt && cur.updated_at !== expectedUpdatedAt) {
      const err = new Error('Someone else saved this problem while you were editing it.');
      err.conflict = true; err.current = cur;
      return wait(Promise.reject(err));
    }
    const row = {
      problem_key: problemKey,
      solution: payload.solution,
      figure: payload.figure,
      status: payload.status,
      author: payload.author || null,
      author_link: payload.author_link || null,
      updated_at: new Date().toISOString(),
    };
    all[problemKey] = row;
    write(all);
    return wait(row);
  }

  /** Remove the row entirely (the problem goes back to "nothing stored"). */
  async function remove(problemKey) {
    const all = read();
    delete all[problemKey];
    write(all);
    return wait(true);
  }

  /** Everything, for the JSON backup button. */
  async function exportAll() { return wait(read()); }

  async function editors() { return wait([]); }

  async function createEditor() { throw new Error('Not available without the database.'); }

  return { whoami, editors, index, get, save, remove, exportAll, createEditor, isMock: true };
})();
