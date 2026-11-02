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
      // "conflict": saved by someone else since; "exists": you already
      // have a solution on this problem (row = that one); "stale": a share
      // card for an older version. Anything else is a refusal worth
      // reading as is (e.g. "Only a published solution can be the default").
      const code = data && data.error;
      const known = { conflict: 'Someone else saved this problem while you were editing it.',
        exists: 'You already have a solution on this problem.', stale: 'stale',
        changed: 'The author changed it after you opened it. Read the new version, then decide.' };
      const err = new Error(known[code] || code || known.conflict);
      err.conflict = !code || code === 'conflict' || code === 'stale';
      err.exists = code === 'exists';
      err.changed = code === 'changed';
      err.current = data && data.row;
      throw err;
    }
    if (res.status === 403) {
      // Three very different failures share this status, so the server's
      // own error code decides the message — "access key" vs "admin key" is
      // the difference between asking for a new key and fixing a secret, and
      // anything else is the server refusing this action at your level.
      const code = data && data.error;
      if (code === 'admin_auth_failed') {
        const err = new Error('The admin key was not accepted. Check SOLUTIONS_ADMIN_KEY in the function\'s Secrets — and make sure the deployed solutions-admin is the current version.');
        err.adminAuth = true;
        throw err;
      }
      if (code && code !== 'key_auth_failed') {
        const err = new Error(code);
        err.forbidden = true;
        throw err;
      }
      const err = new Error('This access key was not accepted. If it was just issued, check that the deployed solutions-admin is the current version.');
      err.auth = true;
      throw err;
    }
    if (res.status === 404) {
      // The function's own 404s ("That solution no longer exists.") carry a
      // message; a bare 404 means the function itself isn't there.
      if (data && data.error) {
        const err = new Error(data.error);
        err.gone = true;
        throw err;
      }
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

  // Which solution a call is about (see solutions-admin.ts, "Which solution
  // a call is about"): `id` when the editor knows the row, `new` to create
  // this editor's own on a problem that has someone else's, otherwise the
  // bare problem_key (your own, else the default).
  const which = (problemKey, id, isNew) =>
    id ? { id } : isNew ? { problem_key: problemKey, new: true } : { problem_key: problemKey };

  let meId = null;   // this key's editor id, from whoami

  /** Who the stored key belongs to — also how the editor checks the key
      works. level: 0 observer … 4 full (migration 013). */
  async function whoami() {
    const d = await call('whoami');
    meId = d.id ?? null;
    return { id: meId, name: d.name || null, level: Number.isInteger(d.level) ? d.level : 4 };
  }

  /** [{ name, link, level? }] for every active editor (level: to full editors only). */
  async function editors() {
    const d = await call('editors');
    return Array.isArray(d.editors) ? d.editors : [];
  }

  /** { index, rows }: index is problem_key -> the entry the editor works on
      for that problem (your own, else the default); rows is every
      solution's entry ({ id, problem_key, status, is_default, owner,
      author, saved_by, updated_at, share, review }), drafts included. */
  async function index() {
    const d = await call('index');
    return { index: d.index || {}, rows: Array.isArray(d.rows) ? d.rows : [] };
  }

  /** One full row (with owner and, where you may see it, review), or null. */
  async function get(problemKey, id) {
    const d = await call('get', which(problemKey, id));
    return d.row || null;
  }

  /** Every solution of one problem, full rows, in tab order. */
  async function list(problemKey) {
    const d = await call('list', { problem_key: problemKey });
    return d.rows || [];
  }

  /** Create or replace a row. expectedUpdatedAt guards against the other
      editor having saved in the meantime (the server answers 409).
      payload.author: who to credit when publishing (honoured for full
      editors only; the server checks it is an active editor).
      payload.share: when publishing, the link-preview picture drawn from
      this content ({ image, title, description, design }), stored with it.
      opts: { id } the row, or { isNew } your own new one (see `which`).
      Resolves to the saved row; row.shareError says why the picture was
      not stored when only that failed, row.submitted that it went to
      review instead of being published. */
  async function save(problemKey, payload, expectedUpdatedAt, opts) {
    const d = await call('save', Object.assign(which(problemKey, opts && opts.id, opts && opts.isNew), {
      solution: payload.solution,
      figure: payload.figure,
      status: payload.status,
      problem_hash: payload.problem_hash || null,
      expected_updated_at: expectedUpdatedAt || null,
      author: payload.author || null,
      share: payload.share || null,
    }));
    if (d.share_error) d.row.shareError = d.share_error;
    if (d.submitted) d.row.submitted = true;
    return d.row;
  }

  /** Changes only who is credited on an existing row (never its content).
      Rejects with err.conflict (and err.current) when the row changed after
      expectedUpdatedAt. */
  async function setCredit(problemKey, author, expectedUpdatedAt, id) {
    const d = await call('set-credit', Object.assign(which(problemKey, id), {
      author: author || null,
      expected_updated_at: expectedUpdatedAt || null,
    }));
    return d.row;
  }

  /** Makes a published solution its problem's default; resolves to the
      problem's rows in their new order. */
  async function setDefault(id) {
    const d = await call('set-default', { id });
    return d.rows || [];
  }

  /** Stores the link-preview picture of a published solution.
      card: { image (JPEG data: URL), title, description, for (the row's
      updated_at it was drawn from), design }. Rejects with err.stale when
      the row was saved again or unpublished meanwhile. */
  async function shareCard(problemKey, card, id) {
    try {
      const d = await call('share-card', Object.assign(which(problemKey, id), card));
      return d.share;
    } catch (e) {
      // 409 here means the row moved on, not that a save was refused.
      if (e && e.conflict) { e.stale = true; e.message = 'the solution was saved again or unpublished meanwhile'; }
      throw e;
    }
  }

  /** Delete the row entirely. */
  async function remove(problemKey, id) {
    await call('delete', which(problemKey, id));
    return true;
  }

  /** The review queue (reviewers): [{ id, problem_key, owner, status, review }]. */
  async function reviews() {
    const d = await call('reviews');
    return d.reviews || [];
  }
  // seen: { submitted_at, updated_at } of the review and row the reviewer
  // read; the server refuses (err.changed) if the author moved on since.
  const seenOf = (seen) => ({
    submitted_at: (seen && seen.submitted_at) || null,
    expected_updated_at: (seen && seen.updated_at) || null,
  });
  async function approve(id, seen) { return (await call('review-approve', Object.assign({ id }, seenOf(seen)))).row; }
  async function reject(id, note, seen) { return (await call('review-reject', Object.assign({ id, note: note || null }, seenOf(seen)))).row; }

  /** Every solution, as stored, for the JSON backup button (and reviews,
      for full editors). */
  async function exportRows() {
    const d = await call('export');
    return { rows: d.rows || [], reviews: d.reviews };
  }

  /** problem_key -> the row the editor works on for that problem (your
      own, else the default, else the newest), for Check all. */
  async function exportAll() {
    const { rows } = await exportRows();
    const out = {};
    const rank = (r) => (r.owner_id === meId ? 2 : r.is_default ? 1 : 0);
    rows.forEach((r) => {
      const had = out[r.problem_key];
      if (!had || rank(r) > rank(had) || (rank(r) === rank(had) && Date.parse(r.updated_at) > Date.parse(had.updated_at))) {
        out[r.problem_key] = r;
      }
    });
    return out;
  }

  /** Issues a new editor key. Needs the admin key, which only the site
      owner has; the generated key is returned once and never again.
      level: 0-4, default 0 (observer). */
  async function createEditor(adminKey, name, level) {
    const d = await call('create-editor', Object.assign({ name, admin_key: adminKey }, Number.isInteger(level) ? { level } : {}));
    return { name: d.name, key: d.key, level: d.level };
  }

  return {
    whoami, editors, index, get, list, save, setCredit, setDefault, shareCard, remove,
    reviews, approve, reject, exportRows, exportAll, createEditor, isMock: false,
  };
})();
