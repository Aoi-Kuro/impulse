/* ═══════════════════════════════════════════════════════════════════
   store.js  ·  Where solutions are read from and written to
   ───────────────────────────────────────────────────────────────────
   THE ONLY FILE IN THE EDITOR THAT TALKS TO THE SERVER.

   Every call goes to the solutions-admin Edge Function (see
   superbase/edge-functions/solutions-admin.ts) with the editor's access
   key in the POST body — the same place forum.js and attempts-sync.js
   send device_secret, and never in the URL, where it would land in
   history, referrer headers and server logs. A custom request header
   would be just as private, but it makes the browser send a CORS
   preflight that Supabase's functions do not allow, so the call never
   leaves the page.

   Reading PUBLISHED solutions does NOT go through here: the practice
   site selects them straight from problem_solutions with the
   publishable key, which the RLS policy in migration 008 limits to
   status = 'published'. This file is for the editor's own work, which
   needs to see drafts and write.

   SUPABASE_URL / SUPABASE_PUBLISHABLE_KEY come from js/course-config.js,
   so this file is automatically per-course.

   To work without a backend (layout work, demos), load
   editor/store-mock.js instead of this file in editor/index.html — it
   exposes the same five methods backed by localStorage.
   ─────────────────────────────────────────────────────────────────── */

const SolutionStore = (function () {
  'use strict';

  const ENDPOINT = `${SUPABASE_URL}/functions/v1/solutions-admin`;
  const KEY_STORAGE = STORAGE_PREFIX + '-editor-key';

  const getKey = () => localStorage.getItem(KEY_STORAGE) || '';

  async function call(action, body) {
    let res;
    try {
      res = await fetch(ENDPOINT, {
        method: 'POST',
        headers: {
          // Exactly the three headers every other function in this repo
          // sends. Anything beyond these triggers a preflight that gets
          // blocked.
          'Content-Type': 'application/json',
          'apikey': SUPABASE_PUBLISHABLE_KEY,
          'Authorization': `Bearer ${SUPABASE_PUBLISHABLE_KEY}`,
        },
        body: JSON.stringify(Object.assign({ action, key: getKey() }, body || {})),
      });
    } catch (e) {
      // A missing function is indistinguishable from a dead network here:
      // when solutions-admin is not deployed, the browser's preflight gets
      // no CORS headers back and fetch() rejects before any status is seen.
      // So the message names the likeliest cause rather than claiming the
      // network is down.
      const err = new Error('Could not reach the solutions-admin function. It may not be deployed in this Supabase project yet, or you are offline.');
      err.offline = true;
      throw err;
    }

    let data = null;
    try { data = await res.json(); } catch (e) { /* non-JSON error page */ }

    if (res.status === 409) {
      const err = new Error('Someone else saved this problem while you were editing it.');
      err.conflict = true;
      err.current = data && data.row;
      throw err;
    }
    if (res.status === 403) {
      // Two very different failures share this status, so the server's own
      // error code decides the message — "access key" vs "admin key" is the
      // difference between asking for a new key and fixing a secret.
      const code = data && data.error;
      if (code === 'admin_auth_failed') {
        const err = new Error('The admin key was not accepted. Check SOLUTIONS_ADMIN_KEY in the function\'s Secrets — and make sure the deployed solutions-admin is the current version.');
        err.adminAuth = true;
        throw err;
      }
      const err = new Error('This access key was not accepted. If it was just issued, check that the deployed solutions-admin is the current version.');
      err.auth = true;
      throw err;
    }
    if (res.status === 404) {
      const err = new Error('The solutions-admin function is not deployed in this Supabase project yet.');
      err.offline = true;
      throw err;
    }
    if (res.status === 401) {
      const err = new Error('The project rejected the request. Check that solutions-admin has auth mode "publishable" and "Verify JWT with legacy secret" switched off.');
      err.offline = true;
      throw err;
    }
    if (!res.ok || !data || data.ok !== true) {
      throw new Error((data && data.error) || `Server error (${res.status}).`);
    }
    return data;
  }

  /** Who the stored key belongs to — also how the editor checks the key works. */
  async function whoami() {
    const d = await call('whoami');
    return { name: d.name || null };
  }

  /** [{ name, link }] for every active editor. */
  async function editors() {
    const d = await call('editors');
    return Array.isArray(d.editors) ? d.editors : [];
  }

  /** problem_key -> { status, updated_at, author } for every row, drafts included. */
  async function index() {
    const d = await call('index');
    return d.index || {};
  }

  /** One full row, or null. */
  async function get(problemKey) {
    const d = await call('get', { problem_key: problemKey });
    return d.row || null;
  }

  /** Create or replace a row. expectedUpdatedAt guards against the other
      editor having saved in the meantime (the server answers 409). */
  async function save(problemKey, payload, expectedUpdatedAt) {
    const d = await call('save', {
      problem_key: problemKey,
      solution: payload.solution,
      figure: payload.figure,
      status: payload.status,
      problem_hash: payload.problem_hash || null,
      expected_updated_at: expectedUpdatedAt || null,
    });
    return d.row;
  }

  /** Delete the row entirely. */
  async function remove(problemKey) {
    await call('delete', { problem_key: problemKey });
    return true;
  }

  /** Every row, for the JSON backup button. */
  async function exportAll() {
    const d = await call('export');
    const out = {};
    (d.rows || []).forEach((r) => { out[r.problem_key] = r; });
    return out;
  }

  /** Issues a new editor key. Needs the admin key, which only the site
      owner has; the generated key is returned once and never again. */
  async function createEditor(adminKey, name) {
    const d = await call('create-editor', { name, admin_key: adminKey });
    return { name: d.name, key: d.key };
  }

  return { whoami, editors, index, get, save, remove, exportAll, createEditor, isMock: false };
})();
