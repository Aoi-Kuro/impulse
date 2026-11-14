/* ═══════════════════════════════════════════════════════════════════
   solutions.js  ·  "See solution" on the practice site
   ───────────────────────────────────────────────────────────────────
   Shows the worked solutions written in the editor at /editor.

   Reading needs NO Edge Function: migration 008's RLS policy lets anon
   select problem_solutions rows whose status = 'published', so this is
   a plain PostgREST GET with the publishable key. Drafts are invisible
   here — not hidden by this code, but unreachable by the policy.

   A problem may have several published solutions, one per author
   (migration 013): the default opens first, the others are tabs above it
   ("Default | By @name | …", renderSolutionTabs).

   Two kinds of request:
     1. the index — which problem_keys have a published solution, and each
        solution's id and when it was last saved (no bodies). Fetched at
        most once every 30 minutes per browser: the copy is kept in
        localStorage, so every tab and reload in between reads it instead
        of the network;
     2. one call for all of a problem's solutions the first time it is
        opened, cached in memory until the index shows one of them was
        unpublished, saved again, or joined by another.
   While Go offline's 24h window runs, both are answered from the copy it
   downloaded (offline-data/solutions.json) instead of the network. While
   the database is off (js/db-status.js), from the copy kept on Netlify
   (/solutions-copy, see "The copy kept on Netlify" below).

   WHERE THE BUTTON APPEARS
     Random quiz — shown but disabled during the attempt, usable only
       once scores are revealed (checkAll), so a solution can never be
       read instead of attempting the problem.
     Solve them all — always, since that mode is explicitly for working
       through problems with help at hand.

   Figures are the SVGs the editor already compiled; TikZJax is never
   loaded here. The TeX fonts are, though (vendor/tikzjax/fonts.css):
   dvisvgm writes glyphs as private-use codepoints in Computer Modern,
   so without that stylesheet every label in a figure renders blank.

   Requires: course-config.js, math-render.js, solution-render.js,
   figure.js, vendor/dompurify/purify.min.js, css/figure.css,
   css/solutions.css.
   ─────────────────────────────────────────────────────────────────── */

const SOLUTIONS_REST = `${SUPABASE_URL}/rest/v1/problem_solutions`;
const SOLUTIONS_INDEX_CACHE_KEY = STORAGE_PREFIX + '-solutions-index';
// One index fetch per browser per "poll.solutions" in site-version.json
// (js/site-config.js, 30 min by default), shared by all tabs.
const SOLUTIONS_INDEX_CHECK_MS = 5 * 60 * 1000;     // how often a visible tab looks whether that copy has expired (no request)
// Columns of one published row — also what Go offline downloads (js/offline-mode.js).
const SOLUTIONS_ROW_COLUMNS = 'id,problem_key,is_default,solution,figure,author,author_link,problem_hash,created_at,updated_at';
// A problem's solutions in tab order: the default first, then oldest first
// (as solutions-admin's tabOrder).
const SOLUTIONS_ORDER = 'is_default.desc,created_at.asc,id.asc';

// ── Full offline mode (js/offline-mode.js) ──
// While the 24h window runs, every request to Supabase is refused by
// sw.js, so solutions come from the copy "Go offline" stored in the
// offline cache instead. Must match OFFLINE_SOLUTIONS_URL in
// js/offline-mode.js. The window is read straight from flux_settings, since
// settings.js/offline-mode.js load later (tier 2) than this file.
const SOLUTIONS_OFFLINE_URL = 'offline-data/solutions.json';
let solutionsOfflineRows = null;    // the downloaded rows, read once per window

function solutionsOfflineActive() {
  try {
    const raw = JSON.parse(localStorage.getItem('flux_settings') || 'null');
    const until = raw && raw.offline && raw.offline.until;
    return typeof until === 'number' && Date.now() < until;
  } catch (e) {
    return false;
  }
}

/** The downloaded rows, or [] when there is no download to read. */
async function loadOfflineSolutionRows() {
  if (solutionsOfflineRows) return solutionsOfflineRows;
  let rows = [];
  try {
    const res = typeof caches !== 'undefined' ? await caches.match(SOLUTIONS_OFFLINE_URL) : null;
    if (res) rows = await res.json();
  } catch (e) { /* missing or unreadable: no solutions offline */ }
  solutionsOfflineRows = Array.isArray(rows) ? rows : [];
  return solutionsOfflineRows;
}

// ── The copy kept on Netlify, for a database that is off ──
// netlify/edge-functions/solutions-copy.ts holds every published solution as
// of the last deploy and hands it out only while its own check finds the
// database off; while the database is up it answers 404, so the copy can't be
// read then. This page asks for it only when the indicator already says the
// database is offline (dbOffline(), js/db-status.js), and only once a
// solution is wanted: one opened, the Solution list, or the Copyright
// screen's authors. Asking never starts a status check of its own; the
// indicator keeps its usual schedule. Held in memory for this page only,
// never stored, and dropped once the database is back. Go offline's download
// (above) comes first while its window runs.
const SOLUTIONS_COPY_URL = '/solutions-copy';
const SOLUTIONS_COPY_RETRY_MS = 60 * 1000;   // after a failed ask, before the next
let solutionsCopyRows = null;                // the copy's rows, once read
let solutionsCopyPromise = null;
let solutionsCopyFailedAt = 0;

function solutionsCopyWanted() {
  return !solutionsOfflineActive() && typeof dbOffline === 'function' && dbOffline();
}

/** The copy's rows, or null when there is none to read (the database is up
    after all, an older deploy without one, or no connection). Never throws. */
function loadSolutionsCopy() {
  if (solutionsCopyRows) return Promise.resolve(solutionsCopyRows);
  if (solutionsCopyPromise) return solutionsCopyPromise;
  if (Date.now() - solutionsCopyFailedAt < SOLUTIONS_COPY_RETRY_MS) return Promise.resolve(null);
  const ref = new URL(SUPABASE_URL).hostname.split('.')[0];
  solutionsCopyPromise = fetch(SOLUTIONS_COPY_URL, { cache: 'no-store' })
    .then((res) => (res.ok ? res.json() : null))
    .then((copy) => {
      if (!copy || !Array.isArray(copy.rows) || copy.projectRef !== ref) throw new Error('no copy');
      // Dropped again if the database came back while it was loading.
      if (!solutionsCopyWanted()) return null;
      solutionsCopyRows = copy.rows;
      applySolutionsIndexRows(copy.rows);
      refreshSolutionsUi();
      return solutionsCopyRows;
    })
    .catch(() => { solutionsCopyFailedAt = Date.now(); return null; })
    .finally(() => { solutionsCopyPromise = null; });
  return solutionsCopyPromise;
}

/** Index rows ({ id, problem_key, updated_at }) from the network or, while
    offline mode is active, from the download, or, while the database is off,
    from the Netlify copy if it was read already. null on a server error. */
async function solutionsIndexRows() {
  if (solutionsOfflineActive()) return loadOfflineSolutionRows();
  solutionsOfflineRows = null;
  if (solutionsCopyWanted() && solutionsCopyRows) return solutionsCopyRows;
  const r = await fetch(`${SOLUTIONS_REST}?select=id,problem_key,updated_at&status=eq.published`, {
    headers: solutionsRestHeaders(),
    cache: 'no-store',
  });
  return r.ok ? r.json() : null;
}

/** Published { problem_key, author, author_link } rows, for the solution
    authors list on the Copyright screen (js/license.js). null when it
    can't be loaded. */
async function fetchSolutionAuthorRows() {
  try {
    const copy = solutionsOfflineActive() ? await loadOfflineSolutionRows()
      : solutionsCopyWanted() ? await loadSolutionsCopy() : null;
    if (copy) return copy.map((r) => ({ problem_key: r.problem_key, author: r.author, author_link: r.author_link }));
    const r = await fetch(`${SOLUTIONS_REST}?select=problem_key,author,author_link&status=eq.published`, {
      headers: solutionsRestHeaders(),
      cache: 'no-store',
    });
    return r.ok ? await r.json() : null;
  } catch (e) {
    return null;
  }
}

let solutionsIndex = null;          // Set of problem_key with a published solution
let solutionsIndexStamps = null;    // problem_key -> solutionsStampOf its rows, from the same index
let solutionsIndexPromise = null;   // in-flight load, so parallel callers share one request
const solutionsRowCache = new Map();

/* Opened solutions are also kept across page loads, in Cache Storage (a
   row with its figures can be far bigger than localStorage allows), under
   this course's own prefix: one entry per problem, holding all its
   solutions. A stored entry is used without a request while the index
   lists the same solutions saved at the same times (the index itself is
   at most poll.solutions old), or, before the index has loaded (a shared
   link on a fresh page), while it was fetched less than poll.solutions
   ago. sw.js's activate step clears it with the other caches on each new
   version, which is fine: it only costs one fetch per problem. v2: an
   entry holds a list of rows since migration 013, not one row. */
const SOLUTION_ROWS_CACHE = 'flux-solution-rows-v2';
const solutionRowUrl = (key) => new URL(`__solution-rows/${STORAGE_PREFIX}/${encodeURIComponent(key)}`, location.href).href;

// Which solutions a problem has and when each was saved, as one string: it
// changes when one is saved again, unpublished, or another is published.
// An index cached by a build from before migration 013 has no ids, so it
// never matches and the rows are simply fetched again.
function solutionsStampOf(rows) {
  return rows.map((r) => `${r.id ?? ''}@${r.updated_at}`).sort().join(' ');
}

// Tab order (SOLUTIONS_ORDER), for rows that didn't come from a query that
// sorted them: the offline download.
function sortSolutionRows(rows) {
  const t = (r) => Date.parse(r.created_at || r.updated_at) || 0;
  return rows.slice().sort((a, b) =>
    (b.is_default ? 1 : 0) - (a.is_default ? 1 : 0) || t(a) - t(b) || (a.id || 0) - (b.id || 0));
}

// anyAge: for when the server can't be asked, so old beats nothing.
async function readStoredSolutionRows(key, anyAge) {
  try {
    if (typeof caches === 'undefined') return null;
    const res = await (await caches.open(SOLUTION_ROWS_CACHE)).match(solutionRowUrl(key));
    if (!res) return null;
    const { rows, at } = await res.json();
    if (!Array.isArray(rows) || !rows.length) return null;
    if (anyAge) return rows;
    const fresh = solutionsIndexStamps
      ? solutionsIndexStamps.get(key) === solutionsStampOf(rows)
      : Date.now() - at < sitePollMs('solutions');
    return fresh ? rows : null;
  } catch (e) { return null; }   // unreadable: just fetch it
}

// Keeps `rows` for the next page load; null (no longer published) drops them.
function storeSolutionRows(key, rows) {
  if (typeof caches === 'undefined') return;
  caches.open(SOLUTION_ROWS_CACHE).then((c) => (rows
    ? c.put(solutionRowUrl(key), new Response(JSON.stringify({ rows, at: Date.now() }), { headers: { 'Content-Type': 'application/json' } }))
    : c.delete(solutionRowUrl(key)))).catch(() => { /* quota / private mode: memory only */ });
}

const solutionKeyFor = (quizNum, problemId) => `q${quizNum}_${problemId}`;

function solutionsRestHeaders() {
  return {
    'apikey': SUPABASE_PUBLISHABLE_KEY,
    'Authorization': `Bearer ${SUPABASE_PUBLISHABLE_KEY}`,
  };
}

/** Makes `rows` ({ id, problem_key, updated_at }) the current index. */
function applySolutionsIndexRows(rows) {
  const byKey = new Map();
  rows.forEach((r) => {
    if (!byKey.has(r.problem_key)) byKey.set(r.problem_key, []);
    byKey.get(r.problem_key).push(r);
  });
  const fresh = new Set(byKey.keys());
  const stamps = new Map([...byKey].map(([key, list]) => [key, solutionsStampOf(list)]));

  // Solutions opened earlier stay in memory, so drop a problem's when one
  // is no longer published (or it would still open), was saved again since
  // (or the student would keep reading the old text), or another was
  // published next to them (or its tab would be missing).
  solutionsRowCache.forEach((list, key) => {
    if (!fresh.has(key) || !list || solutionsStampOf(list) !== stamps.get(key)) solutionsRowCache.delete(key);
  });

  solutionsIndex = fresh;
  solutionsIndexStamps = stamps;
  return solutionsIndex;
}

/** The index another tab (or an earlier load) fetched, or null. */
function readSolutionsIndexCache() {
  try {
    const raw = JSON.parse(localStorage.getItem(SOLUTIONS_INDEX_CACHE_KEY) || 'null');
    if (raw && typeof raw.at === 'number' && Array.isArray(raw.rows)) return raw;
  } catch (e) { /* ignore a corrupt cache */ }
  return null;
}

/** Fetches the published keys and applies them. Never throws. */
function fetchSolutionsIndex() {
  if (solutionsIndexPromise) return solutionsIndexPromise;

  // The offline download and the Netlify copy are not a fresh server copy,
  // so they never reset the 30-minute window for the tabs that are online.
  const offline = solutionsOfflineActive() || !!(solutionsCopyWanted() && solutionsCopyRows);
  solutionsIndexPromise = solutionsIndexRows()
    .then((rows) => {
      if (!rows) return solutionsIndex || new Set();      // keep what we had on a server error
      if (!offline) {
        try {
          localStorage.setItem(SOLUTIONS_INDEX_CACHE_KEY, JSON.stringify({
            at: Date.now(),
            rows: rows.map((r) => ({ id: r.id, problem_key: r.problem_key, updated_at: r.updated_at })),
          }));
        } catch (e) { /* private mode / quota */ }
      }
      return applySolutionsIndexRows(rows);
    })
    .catch(() => {
      // Offline, or the table doesn't exist in this course's project yet.
      // An empty set simply means no buttons appear anywhere.
      solutionsIndex = solutionsIndex || new Set();
      return solutionsIndex;
    })
    .finally(() => { solutionsIndexPromise = null; });

  return solutionsIndexPromise;
}

/* Published keys only. The copy in localStorage is used while it is under
   30 minutes old, whichever tab fetched it; only after that does a tab go
   to the network, and the copy it stores then serves every other tab.

   So a solution published or unpublished in the editor can take up to 30
   minutes to gain or lose its button in a tab that is already open. An
   unpublished one still cannot be read in that time: fetchSolutions() only
   asks for published rows, so its button opens "This solution is no
   longer published." The page used to refetch on every load and every tab
   switch to close that gap, which was most of this project's
   problem_solutions traffic. */
function loadSolutionsIndex() {
  if (!solutionsOfflineActive()) {
    const cached = readSolutionsIndexCache();
    const age = cached ? Date.now() - cached.at : Infinity;
    if (age >= 0 && age < sitePollMs('solutions')) return Promise.resolve(applySolutionsIndexRows(cached.rows));
  }
  return fetchSolutionsIndex();
}

function hasPublishedSolution(quizNum, problemId) {
  return !!solutionsIndex && solutionsIndex.has(solutionKeyFor(quizNum, problemId));
}

/** A problem's published solutions in tab order (the default first), or
    null when it has none. Kept in memory for the page's life and in Cache
    Storage across loads (readStoredSolutionRows); the background index
    refresh above drops the memory copy once one of them is unpublished or
    edited or another is published, and a stored copy no longer matching
    the index is fetched again. While offline mode is active the rows come
    from the download instead: the network request would only be refused
    by sw.js. */
async function fetchSolutions(problemKey) {
  if (solutionsRowCache.has(problemKey)) return solutionsRowCache.get(problemKey);
  if (solutionsOfflineActive()) {
    const rows = (await loadOfflineSolutionRows()).filter((r) => r && r.problem_key === problemKey);
    return rows.length ? sortSolutionRows(rows) : null;
  }
  // The database is off: the Netlify copy. Without one, on as before (what
  // this browser kept, then a request that will most likely fail).
  if (solutionsCopyWanted()) {
    const copy = await loadSolutionsCopy();
    if (copy) {
      const rows = copy.filter((r) => r && r.problem_key === problemKey);
      return rows.length ? sortSolutionRows(rows) : null;
    }
  }
  const stored = await readStoredSolutionRows(problemKey);
  if (stored) {
    solutionsRowCache.set(problemKey, stored);
    return stored;
  }
  const url = `${SOLUTIONS_REST}?select=${SOLUTIONS_ROW_COLUMNS}`
            + `&problem_key=eq.${encodeURIComponent(problemKey)}&status=eq.published&order=${SOLUTIONS_ORDER}`;
  let res;
  try {
    res = await fetch(url, { headers: solutionsRestHeaders() });
    if (!res.ok) throw new Error('Could not load the solution.');
  } catch (e) {
    const old = await readStoredSolutionRows(problemKey, true);
    if (old) return old;
    throw e;
  }
  const rows = await res.json();
  const list = Array.isArray(rows) && rows.length ? rows : null;
  solutionsRowCache.set(problemKey, list);
  storeSolutionRows(problemKey, list);
  return list;
}

/* ── Buttons ──────────────────────────────────────────────────────────
   Cards are built by quiz-engine.js with the button already in place but
   hidden; this reveals the ones that have a solution. Called after a
   render and again when the index arrives, since the first render
   usually wins that race. With the database off the index may never
   arrive, so every card shows it: opening one gives the Netlify copy's
   solution, what this browser has kept of it, or says why there's none.
   Once the copy is read its list is the index, so only real ones show. */
function refreshSolutionButtons() {
  const everyCard = dbOffline() && !solutionsCopyRows;
  document.querySelectorAll('.solution-btn[data-quiz][data-problem]').forEach((btn) => {
    const show = everyCard || hasPublishedSolution(+btn.dataset.quiz, btn.dataset.problem);
    btn.style.display = show ? '' : 'none';
    // A Random quiz card before Check answers: the row holds only this
    // (disabled) button, so it shows exactly when the button does.
    const locked = btn.closest('.card-check-row.rq-locked');
    if (locked) locked.style.display = show ? '' : 'none';
  });
}

// The index was (re)loaded: the quiz cards' buttons and, on the Solution
// screen, the arrows or the open list follow it at once.
function refreshSolutionsUi() {
  refreshSolutionButtons();
  if (!isSolutionScreenOpen() || !solutionCurrent || solutionPreviewMode) return;
  renderSolutionPager(solutionCurrent.quizNum, solutionCurrent.problemId);
}

function initSolutions() {
  loadSolutionsIndex().then(refreshSolutionsUi);
  document.addEventListener('db-status-changed', () => {
    // Back up: the copy goes, and the index comes from the database again.
    if (!dbOffline() && solutionsCopyRows) {
      solutionsCopyRows = null;
      solutionsIndex = null;
      solutionsIndexStamps = null;
      loadSolutionsIndex().then(refreshSolutionsUi);
    }
    refreshSolutionsUi();
  });

  // Coming back to a tab, and every few minutes while one stays in front,
  // pick up the newest copy: usually another tab's, read from localStorage
  // without a request; a fetch only once the 30 minutes are up.
  const recheck = () => { if (!document.hidden) loadSolutionsIndex().then(refreshSolutionsUi); };
  document.addEventListener('visibilitychange', recheck);
  setInterval(recheck, SOLUTIONS_INDEX_CHECK_MS);
}

/* ── Screen ───────────────────────────────────────────────────────────
   Same shape as #forumScreen: the solution replaces whatever screen you
   were on and is scrolled by the window, rather than floating over it in
   a modal. Closing restores that screen and its scroll position.

   This list mirrors FORUM_FAB_HOSTS in forum.js — each entry uses the
   show/hide signal that screen's own code already uses, rather than a
   second convention that could drift out of sync with it. */
const SOLUTION_HOSTS = [
  { id: 'appPage',      isVisible: (el) => el.classList.contains('visible'), hide: (el) => el.classList.remove('visible', 'fading-out'), show: (el) => el.classList.add('visible') },
  { id: 'statsScreen',  isVisible: (el) => el.classList.contains('visible'), hide: (el) => el.classList.remove('visible', 'fading-out'), show: (el) => el.classList.add('visible') },
  { id: 'reviewScreen', isVisible: (el) => el.classList.contains('visible'), hide: (el) => el.classList.remove('visible', 'fading-out'), show: (el) => el.classList.add('visible') },
  { id: 'choicePage',   isVisible: (el) => !el.classList.contains('hidden'), hide: (el) => el.classList.add('hidden'),                   show: (el) => el.classList.remove('hidden', 'fading-out') },
  { id: 'forumScreen',  isVisible: (el) => el.classList.contains('visible'), hide: (el) => el.classList.remove('visible', 'fading-out'), show: (el) => el.classList.add('visible') },
];

let solutionViewer = null;    // { steps, index } for the figure on screen
let solutionHost = null;      // { id, scrollY } of the screen we came from
let solutionOpen = false;

function solutionScreenEl() { return document.getElementById('solutionScreen'); }

function hideHostScreen() {
  solutionHost = null;
  for (const h of SOLUTION_HOSTS) {
    const el = document.getElementById(h.id);
    if (el && h.isVisible(el)) {
      solutionHost = { id: h.id, scrollY: window.scrollY || 0 };
      h.hide(el);
      return;
    }
  }
  // Nothing matched (landing screen): hide it the way forum.js does.
  const landing = document.getElementById('landingScreen');
  if (landing && !landing.classList.contains('hidden')) {
    solutionHost = { id: 'landingScreen', scrollY: window.scrollY || 0 };
    landing.classList.add('hidden');
  }
}

function restoreHostScreen() {
  if (!solutionHost) return;
  const { id, scrollY } = solutionHost;
  solutionHost = null;
  const el = document.getElementById(id);
  if (!el) return;
  if (id === 'landingScreen') el.classList.remove('hidden');
  else {
    const h = SOLUTION_HOSTS.find((x) => x.id === id);
    if (h) h.show(el);
  }
  if (typeof restoreScreenScroll === 'function') restoreScreenScroll(scrollY);
  else window.scrollTo(0, scrollY || 0);
}

// Open AND showing: Settings, Manual or the forum can sit on top of it
// (they hide it as their host and bring it back when they close), and
// then the screen on top is what the logo and keys act on.
function isSolutionScreenOpen() {
  const el = solutionScreenEl();
  return solutionOpen && !!el && el.classList.contains('visible');
}

// Going home (exitAppOrChoiceToLanding in js/quiz-engine.js) while the
// solution sits hidden under Settings / Manual / the forum: the screen on
// top closes straight to landing, so the solution is dropped too instead
// of staying "open" with nothing showing.
function abandonSolutionScreen() {
  if (!solutionOpen) return;
  solutionOpen = false;
  solutionHost = null;
  stopSolutionAutoplay();
  solutionViewer = null;
  setSolutionPreviewMode(false);
  resetSolutionFigTools();
  const screen = solutionScreenEl();
  if (screen) screen.classList.remove('visible', 'fading-out');
  document.documentElement.classList.remove('solution-screen-open');
}

// forceLanding: the site logo (goToMainMenu in quiz-engine.js) means "all
// the way home", not "back to where the solution was opened from". The
// host screen is NOT restored then; it is unwound the way the logo unwinds
// it when no solution is open. Without this the logo showed the landing
// screen while #solutionScreen stayed visible, stacked under it.
function closeSolutionScreen(forceLanding) {
  const screen = solutionScreenEl();
  if (!screen || !solutionOpen) return;
  forceLanding = forceLanding === true;
  // The editor's Full preview shows this page in an overlay (an iframe):
  // Close, Escape and the logo all ask the editor to close that overlay,
  // rather than revealing the landing screen inside it.
  if (solutionPreviewMode && window.parent !== window) {
    notifyPreviewParent('solution-preview-close');
    return;
  }
  solutionOpen = false;
  setSolutionPreviewMode(false);
  const hostId = solutionHost ? solutionHost.id : null;
  if (forceLanding) solutionHost = null;

  const body = document.getElementById('solutionBody');
  const cap  = document.getElementById('solutionCaption');
  [body, cap].forEach((el) => {
    if (el && window.MathJax && MathJax.typesetClear) { try { MathJax.typesetClear([el]); } catch (e) {} }
  });
  stopSolutionAutoplay();
  solutionViewer = null;

  document.documentElement.classList.remove('solution-screen-open');
  screen.classList.add('fading-out');
  setTimeout(() => {
    screen.classList.remove('visible', 'fading-out');
    if (typeof setFieldLinesVisible === 'function') setFieldLinesVisible(true);
    if (typeof syncForumFabVisibility === 'function') syncForumFabVisibility();
    if (!forceLanding) { restoreHostScreen(); return; }
    // Forum and Stats unwind through their own close below, which shows
    // the landing screen on the tick right after this one.
    if (hostId !== 'forumScreen' && hostId !== 'statsScreen' && typeof exitAppOrChoiceToLanding === 'function') {
      exitAppOrChoiceToLanding();
    }
  }, 280);
  // Started after the timer above, so with the same 280ms delay they finish
  // just after #solutionScreen is gone and the two screens never stack.
  // Their own close does the cleanup a plain hide would skip (forum live
  // polling and read marks, Stats polling and idle timer).
  if (forceLanding && hostId === 'forumScreen' && typeof closeForumScreen === 'function') closeForumScreen(true);
  if (forceLanding && hostId === 'statsScreen' && typeof closeStatsScreen === 'function') closeStatsScreen();
}
// Kept so an older call site (or a browser back gesture wired to it) still works.
const closeSolution = closeSolutionScreen;

/* The figure plays itself through once, so the build-up is seen without
   anyone having to discover the arrows. The FIRST deliberate interaction
   (arrow, key, tap, swipe) hands control over for good — it never resumes
   and never fights the reader for the step they chose. */
const SOLUTION_AUTOPLAY_MS = 2200;
let solutionAutoTimer = null;

function stopSolutionAutoplay() {
  if (solutionAutoTimer) { clearInterval(solutionAutoTimer); solutionAutoTimer = null; }
  if (solutionViewer) solutionViewer.manual = true;
}

function startSolutionAutoplay() {
  stopSolutionAutoplay();
  if (!solutionViewer || solutionViewer.steps.length < 2) return;
  if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  solutionViewer.manual = false;
  solutionAutoTimer = setInterval(() => {
    if (!solutionViewer || solutionViewer.manual) return stopSolutionAutoplay();
    if (solutionViewer.index >= solutionViewer.steps.length - 1) {
      // Stop at the last step rather than looping: a figure that keeps
      // restarting under someone reading the text below is a distraction.
      stopSolutionAutoplay();
      return;
    }
    solutionViewer.index++;
    drawSolutionStep();
  }, SOLUTION_AUTOPLAY_MS);
}

function solutionStep(delta, fromUser) {
  if (!solutionViewer) return;
  if (fromUser !== false) stopSolutionAutoplay();
  const n = solutionViewer.steps.length;
  solutionViewer.index = Math.min(Math.max(solutionViewer.index + delta, 0), n - 1);
  drawSolutionStep();
}

/** Jump straight to a step (dot taps). */
function solutionGoToStep(i) {
  if (!solutionViewer) return;
  stopSolutionAutoplay();
  solutionViewer.index = Math.min(Math.max(i, 0), solutionViewer.steps.length - 1);
  drawSolutionStep();
}

function drawSolutionStep() {
  const v = solutionViewer;
  if (!v) return;
  hideSolutionLens();
  const i = v.index, n = v.steps.length;
  document.querySelectorAll('#solutionFigure .fig-step').forEach((el, k) => el.classList.toggle('on', k === i));
  const dots = document.getElementById('solutionDots');
  if (dots) {
    dots.textContent = '';
    for (let k = 0; k < n; k++) {
      const d = document.createElement('i');
      if (k === i) d.className = 'on';
      d.title = `Step ${k + 1}`;
      d.addEventListener('click', () => solutionGoToStep(k));
      dots.appendChild(d);
    }
  }
  document.getElementById('solutionPrev').disabled = i <= 0;
  document.getElementById('solutionNext').disabled = i >= n - 1;
  document.getElementById('solutionStepNo').textContent = `Step ${i + 1} / ${n}`;
  const cap = document.getElementById('solutionCaption');
  // Hidden only when NO step has a caption; otherwise the reserved line
  // stays so the layout doesn't jump between captioned and bare steps.
  cap.hidden = !v.steps.some((s) => (s.caption || '').trim());
  const text = v.steps[i].caption || '';
  if (!text.trim()) {
    if (window.MathJax && MathJax.typesetClear) { try { MathJax.typesetClear([cap]); } catch (e) {} }
    cap.textContent = '';
    return Promise.resolve();
  }
  return renderSolutionInto(cap, figureCaptionText(text, i === n - 1));   // its math typeset
}

/* ── Building without jumps ───────────────────────────────────────────
   openSolution keeps the screen's parts invisible (but in their places)
   while they are assembled: the problem box until its math and pictures
   are done, everything under it until the figure, the solution's math and
   the credit are. Then each part fades in whole, so nothing on screen is
   pushed around by the next part arriving. A typeset that never finishes
   only delays this by SOLUTION_SETTLE_MAX_MS. */
const SOLUTION_SETTLE_MAX_MS = 4000;

// Settles once every <img> in `el` has loaded or failed.
function solutionImagesSettled(el) {
  return Promise.all([...el.querySelectorAll('img')].map((img) => (img.complete ? null : new Promise((res) => {
    img.addEventListener('load', res, { once: true });
    img.addEventListener('error', res, { once: true });
  }))));
}

// `promise`, but given up on after SOLUTION_SETTLE_MAX_MS; never rejects.
function solutionSettled(promise) {
  return Promise.race([
    Promise.resolve(promise).catch(() => {}),
    new Promise((res) => setTimeout(res, SOLUTION_SETTLE_MAX_MS)),
  ]);
}

// Bumped on every openSolution() call and tab switch. Each checks it after
// every await, so tapping Previous/Next (or the tabs) quickly never lets a
// slower, older response paint over the solution that was asked for last.
let solutionOpenToken = 0;
// What is on screen, for the Share button and the Previous/Next buttons.
// solutionId: the tab showing, null for the first (the default), so a
// share link to the default stays the plain /s/<problem_key>.
let solutionCurrent = null;   // { quizNum, problemId, solutionId }
// The open problem's published solutions, in tab order, and which is on screen.
let solutionRows = null;
let solutionShownId = null;
// True while showing the editor's "Full preview" (see openSolutionFromURL):
// the row comes from the editor, not the database.
let solutionPreviewMode = false;

// Puts the Solution screen in place of the screen it was opened from (if
// it isn't showing yet), at the top.
function showSolutionScreen(screen) {
  if (!solutionOpen) {
    hideHostScreen();
    // #saNavRail (Solve-All's progress line) and #stickyScore are
    // position:fixed, so they float above this screen until hidden — see
    // the html.solution-screen-open rule in css/solutions.css.
    document.documentElement.classList.add('solution-screen-open');
    if (typeof setFieldLinesVisible === 'function') setFieldLinesVisible(false);
    screen.classList.add('visible');
    solutionOpen = true;
    document.documentElement.classList.remove('solution-preview-boot');
    if (typeof syncForumFabVisibility === 'function') syncForumFabVisibility();
  }
  window.scrollTo(0, 0);
}

// The Solution screen with no solution open, only the Solution list of set
// quizNum (Entire Set's "Solution list" button). Nothing is current in the
// list and it has no ✕ (the screen's own ✕ goes back); picking a problem
// opens its solution as usual.
function openSolutionBrowser(quizNum) {
  const screen = solutionScreenEl();
  if (!screen) return;
  ++solutionOpenToken;                  // a solution still loading won't paint over this
  stopSolutionAutoplay();
  solutionViewer = null;
  ['solutionBody', 'solutionCaption'].forEach((id) => {
    const el = document.getElementById(id);
    if (el && window.MathJax && MathJax.typesetClear) { try { MathJax.typesetClear([el]); } catch (e) {} }
  });
  solutionCurrent = { quizNum, problemId: null, solutionId: null };
  solutionRows = null;
  setSolutionPreviewMode(false);
  screen.classList.remove('sol-problem-pending', 'sol-body-pending');
  resetSolutionFigTools();
  document.getElementById('solutionTitle').textContent = '📘 Solutions';
  document.getElementById('solutionShareBtn').hidden = true;     // nothing to share
  ['solutionProblem', 'solutionTabs', 'solutionLoading', 'solutionStale', 'solutionFigureWrap', 'solutionMain', 'solutionPager', 'solutionList']
    .forEach((id) => { document.getElementById(id).hidden = true; });
  showSolutionScreen(screen);
  showSolutionList(false);
}

// Stops the figure on screen and releases its typeset math, before the
// same elements are reused for another solution.
function releaseSolutionContent() {
  stopSolutionAutoplay();
  solutionViewer = null;
  ['solutionBody', 'solutionCaption'].forEach((id) => {
    const el = document.getElementById(id);
    if (el && window.MathJax && MathJax.typesetClear) { try { MathJax.typesetClear([el]); } catch (e) {} }
  });
}

// previewRow: a row built by the editor's Full preview — shown instead of
// fetching the published ones. solutionId: open that tab instead of the
// default (a shared link to it); unknown ids fall back to the default.
/* ── Without an account: five solutions ──────────────────────────────
   A visitor with no nickname (claimed, or made offline and waiting to
   register, js/offline-account.js) can open GUEST_SOLUTION_LIMIT different
   solutions on this device, and those stay open to them. The next one,
   however it is asked for (a card's button, the list, Previous/Next, a
   shared link), takes them to the main page and opens Getting started with
   a note saying why (#gsSolutionsNote). They can close it and use the site
   as before without an account (starting a quiz asks for one anyway), but
   no other solution opens until they have one; with an account made from
   that screen, the solution they asked for opens. Counted in localStorage,
   so it is a nudge, not a lock. The editor's preview never counts. */
const GUEST_SOLUTION_LIMIT = 5;
const GUEST_SOLUTIONS_KEY = STORAGE_PREFIX + '-guest-solutions';

// Read straight from storage as well: a shared link can open a solution
// before js/forum.js and js/offline-account.js have loaded.
function solutionsHaveAccount() {
  if (typeof getForumNickname === 'function' && getForumNickname()) return true;
  if (typeof getPendingAccount === 'function' && getPendingAccount()) return true;
  try {
    return !!(localStorage.getItem(STORAGE_PREFIX + '_forum_nickname') || localStorage.getItem(STORAGE_PREFIX + '_pending_account'));
  } catch (e) {
    return false;
  }
}

// Whether this visitor may open the solution of `key`; a new one is counted.
function guestMayOpenSolution(key) {
  if (solutionsHaveAccount()) return true;
  let seen = [];
  try { seen = JSON.parse(localStorage.getItem(GUEST_SOLUTIONS_KEY) || '[]'); } catch (e) { seen = []; }
  if (!Array.isArray(seen)) seen = [];
  if (seen.includes(key)) return true;
  if (seen.length >= GUEST_SOLUTION_LIMIT) return false;
  seen.push(key);
  try { localStorage.setItem(GUEST_SOLUTIONS_KEY, JSON.stringify(seen)); } catch (e) { /* storage off: not counted */ }
  return true;
}

// Over the limit: the main page, then Getting started once the landing
// screen is up (and the scripts behind it have loaded).
function stopGuestAtSolutionLimit(quizNum, problemId, solutionId) {
  if (typeof goToMainMenu === 'function') goToMainMenu();
  const reopen = () => { if (solutionsHaveAccount()) openSolution(quizNum, problemId, null, solutionId); };
  let tries = 0;
  const ask = () => {
    if (typeof openGettingStartedModal !== 'function') {
      if (++tries < 50) setTimeout(ask, 200);
      return;
    }
    if (typeof setGettingStartedReason === 'function') setGettingStartedReason('solutions');
    if (typeof offlineAccountGate === 'function') offlineAccountGate(reopen, { quiz: false });
    else openGettingStartedModal(reopen);
  };
  setTimeout(ask, 420);   // after closeSolutionScreen's 280 ms fade
}

async function openSolution(quizNum, problemId, previewRow, solutionId) {
  const key = solutionKeyFor(quizNum, problemId);
  if (!previewRow && !guestMayOpenSolution(key)) {
    stopGuestAtSolutionLimit(quizNum, problemId, solutionId);
    return;
  }
  const screen = solutionScreenEl();
  if (!screen) return;
  const token = ++solutionOpenToken;
  const stale = () => token !== solutionOpenToken || !solutionOpen;
  solutionCurrent = { quizNum, problemId, solutionId: null };
  solutionRows = null;
  setSolutionPreviewMode(!!previewRow);
  // Invisible until built (see "Building without jumps" above).
  screen.classList.add('sol-problem-pending', 'sol-body-pending');
  const reveal = () => {
    if (token === solutionOpenToken) screen.classList.remove('sol-problem-pending', 'sol-body-pending');
  };

  // Switching from one solution to another (Previous/Next) while the
  // screen stays open.
  if (solutionOpen) releaseSolutionContent();

  const label = problemLabel(quizNum, problemId);

  // Problem first — the student should see what is being solved without
  // leaving the page. The accepted answer is deliberately NOT shown: in
  // Solve-them-all the solution is reachable before an attempt.
  const p = getQuizProblem(quizNum, problemId);
  // The Problem box below already shows the number; the title only carries
  // it when that box is hidden (a problem that can no longer be found).
  document.getElementById('solutionTitle').textContent =
    (p ? '📘 Solution' : `📘 Solution · ${label}`) + (solutionPreviewMode ? ' · Preview' : '');
  const probBox = document.getElementById('solutionProblem');
  let probReady = Promise.resolve();  // its math typeset and pictures loaded
  if (p) {
    document.getElementById('solutionProblemNum').textContent = label;
    document.getElementById('solutionProblemTopic').textContent = p.topic || '';
    const pt = document.getElementById('solutionProblemText');
    pt.innerHTML = p.text;            // the site's own trusted problem text
    probBox.hidden = false;
    probReady = Promise.all([renderMathIn(pt), solutionImagesSettled(pt)]);
  } else {
    probBox.hidden = true;
  }
  // The problem shows as soon as it is ready, the rest maybe later.
  solutionSettled(probReady).then(() => {
    if (token === solutionOpenToken) screen.classList.remove('sol-problem-pending');
  });

  // Blank the rest while loading.
  blankSolutionContent();
  const body = document.getElementById('solutionBody');
  document.getElementById('solutionTabs').hidden = true;
  document.getElementById('solutionList').hidden = true;   // picked from it, or a new solution
  renderSolutionPager(quizNum, problemId);
  if (!previewRow && solutionListByDefault()) showSolutionList(false);
  const loading = document.getElementById('solutionLoading');
  loading.hidden = false;

  showSolutionScreen(screen);

  let rows;
  try {
    rows = previewRow ? [previewRow] : await fetchSolutions(key);
  } catch (e) {
    const failure = await dbFailureText('Could not load this solution. Check your connection and try again.');
    if (stale()) return;
    loading.hidden = true;
    document.getElementById('solutionMain').hidden = false;
    body.textContent = failure;
    if (dbOffline()) body.replaceChildren(dbOfflineBox());
    reveal();
    if (solutionPreviewMode) notifyPreviewParent('solution-preview-ready');
    return;
  }
  if (stale()) return;                             // closed, or another solution asked for

  if (!rows) {
    loading.hidden = true;
    document.getElementById('solutionMain').hidden = false;
    body.textContent = solutionsCopyWanted() && solutionsCopyRows
      ? 'This solution isn\'t in the copy kept for while the database is offline.'
      : 'This solution is no longer published.';
    reveal();
    if (solutionPreviewMode) notifyPreviewParent('solution-preview-ready');
    return;
  }

  solutionRows = rows;
  const row = (solutionId && rows.find((r) => r.id === solutionId)) || rows[0];
  renderSolutionTabs();
  await paintSolutionRow(row, p, probReady, stale, reveal);
  if (stale()) return;

  // Editor Full preview: the overlay keeps this page invisible until now,
  // so none of the start-up screens flicker past; two frames for the
  // layout to settle.
  if (solutionPreviewMode) {
    requestAnimationFrame(() => requestAnimationFrame(() => { if (!stale()) notifyPreviewParent('solution-preview-ready'); }));
  }

  // The published list may not have arrived yet (a shared link opened on a
  // fresh page load): fill the Previous/Next buttons in once it has.
  if (!solutionsIndex && !solutionPreviewMode) {
    await loadSolutionsIndex();
    if (!stale()) renderSolutionPager(quizNum, problemId);
  }
}

// Empties the figure, solution and credit (kept in place, hidden).
function blankSolutionContent() {
  resetSolutionFigTools();
  document.getElementById('solutionBody').textContent = '';
  document.getElementById('solutionFigureWrap').hidden = true;
  document.getElementById('solutionMain').hidden = true;
  document.getElementById('solutionStale').hidden = true;
  document.getElementById('solutionCredit').hidden = true;
}

/* ── Tabs: several solutions of one problem ───────────────────────────
   "Default | By @name | …" above the figure, only when the problem has
   more than one published solution (never in the editor's preview). A
   tab swaps the figure, solution and credit in place; the problem, the
   list and the pager stay as they are. */
function renderSolutionTabs() {
  const box = document.getElementById('solutionTabs');
  const tabs = document.getElementById('solutionTabList');
  if (!box || !tabs) return;
  tabs.textContent = '';
  const rows = solutionRows || [];
  box.hidden = rows.length < 2 || solutionPreviewMode;
  if (box.hidden) return;
  rows.forEach((r, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'solution-close-btn solution-list-set solution-tab';
    b.setAttribute('role', 'tab');
    b.dataset.id = String(r.id);
    const by = r.author ? '@' + String(r.author).replace(/^@/, '') : '';
    b.textContent = i === 0 ? 'Default' : by ? 'By ' + by : `Solution ${i + 1}`;
    b.title = by ? `Solution by ${by}` : '';
    b.onclick = () => showSolutionTab(r.id);
    tabs.appendChild(b);
  });
}

// Marks the tab of the solution on screen.
function markSolutionTab(id) {
  document.querySelectorAll('#solutionTabs .solution-tab').forEach((b) => {
    const on = b.dataset.id === String(id);
    b.setAttribute('aria-selected', String(on));
    b.tabIndex = on ? 0 : -1;
  });
}

// Left/Right (and Home/End) move between the tabs, as in any tab list.
document.addEventListener('keydown', (e) => {
  const tab = e.target && e.target.closest && e.target.closest('#solutionTabs .solution-tab');
  if (!tab) return;
  const all = [...document.querySelectorAll('#solutionTabs .solution-tab')];
  const i = all.indexOf(tab);
  const to = { ArrowLeft: i - 1, ArrowRight: i + 1, Home: 0, End: all.length - 1 }[e.key];
  if (to === undefined) return;
  e.preventDefault();
  const next = all[(to + all.length) % all.length];
  next.focus();
  next.click();
});

function showSolutionTab(id) {
  if (!solutionRows || !solutionCurrent || solutionPreviewMode) return;
  const row = solutionRows.find((r) => r.id === id);
  const screen = solutionScreenEl();
  if (!row || !screen || solutionShownId === id) return;
  const token = ++solutionOpenToken;
  const stale = () => token !== solutionOpenToken || !solutionOpen;
  // Held at its height while the new one is built, so the page doesn't
  // jump up and back down under the student's finger.
  const wrap = screen.querySelector('.solution-wrap');
  if (wrap) wrap.style.minHeight = wrap.offsetHeight + 'px';
  screen.classList.add('sol-body-pending');
  releaseSolutionContent();
  blankSolutionContent();
  const p = getQuizProblem(solutionCurrent.quizNum, solutionCurrent.problemId);
  paintSolutionRow(row, p, Promise.resolve(), stale, () => {
    if (token !== solutionOpenToken) return;
    screen.classList.remove('sol-body-pending');
    if (wrap) wrap.style.minHeight = '';
  });
}

// Builds the figure, solution and credit of `row` (one of solutionRows),
// then reveals them once everything is typeset (with `ready`, what else
// has to be ready first). stale/reveal: as in openSolution.
async function paintSolutionRow(row, p, ready, stale, reveal) {
  const body = document.getElementById('solutionBody');
  const credit = document.getElementById('solutionCredit');
  const loading = document.getElementById('solutionLoading');
  solutionShownId = row.id ?? null;
  solutionCurrent.solutionId = solutionRows && row !== solutionRows[0] ? row.id : null;
  markSolutionTab(row.id);

  let capMath = Promise.resolve();

  const steps = (row.figure && Array.isArray(row.figure.steps) ? row.figure.steps : [])
    .filter((s) => s && typeof s.svg === 'string' && s.svg.trim());
  if (steps.length) {
    const stage = document.getElementById('solutionFigure');
    stage.textContent = '';
    const holder = document.createElement('div');
    holder.className = 'fig-steps fig-sized';
    holder.style.setProperty('--fig-scale', String(figScaleOf(row.figure)));
    steps.forEach((s) => {
      const d = document.createElement('div');
      d.className = 'fig-step';
      // ALWAYS sanitized: this markup is inlined (that is what makes it
      // follow the theme), and this page shares an origin with the forum.
      d.innerHTML = figSanitizeSvg(s.svg);
      holder.appendChild(d);
    });
    stage.appendChild(holder);
    document.getElementById('solutionFigureWrap').hidden = false;
    figCropToContent(holder);                      // only measurable once visible
    solutionViewer = { steps, index: 0, manual: false };
    document.getElementById('solutionNav').style.display = steps.length > 1 ? '' : 'none';
    capMath = drawSolutionStep();
    attachSolutionSwipe(stage);
  } else {
    stopSolutionAutoplay();
    solutionViewer = null;
  }

  document.getElementById('solutionMain').hidden = false;
  const bodyMath = renderSolutionInto(body, row.solution || '');

  credit.textContent = '';
  if (row.author) {
    const by = document.createElement('div');
    by.append(document.createTextNode('Solution by '));
    const b = document.createElement('b');
    b.textContent = '@' + String(row.author).replace(/^@/, '');
    // The editor's own link, if they set one. http(s) only: anything else
    // (javascript:, data:) would run or render on click.
    const href = safeAuthorLink(row.author_link);
    if (href) {
      const a = document.createElement('a');
      a.href = href;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      a.appendChild(b);
      by.appendChild(a);
    } else {
      by.appendChild(b);
    }
    credit.appendChild(by);
  }
  const updated = formatSolutionDate(row.updated_at);
  if (updated) {
    const up = document.createElement('div');
    up.className = 'solution-updated';
    up.textContent = 'Updated ' + updated;
    credit.appendChild(up);
  }
  // Every published solution (text and figure) is all rights reserved — see
  // the License section of README.md and the Copyright screen. Shown even
  // without an author line.
  const lic = document.createElement('div');
  lic.className = 'solution-license';
  lic.textContent = 'All rights reserved.';
  credit.appendChild(lic);
  credit.hidden = false;

  // The problem may have been edited after the solution was written:
  // decided before the reveal, so the note doesn't push the rest down.
  const staleCheck = row.problem_hash && p
    ? solutionProblemHash(p).then((now) => {
        if (!stale() && now !== row.problem_hash) document.getElementById('solutionStale').hidden = false;
      })
    : null;

  await solutionSettled(Promise.all([ready, bodyMath, capMath, staleCheck]));
  if (stale()) return;
  loading.hidden = true;
  reveal();
  // Only now, so its first step change is seen.
  if (solutionViewer) startSolutionAutoplay();
}

/** "12 Oct 2026" for a stored timestamp, or '' if there is none. */
function formatSolutionDate(iso) {
  const d = iso ? new Date(iso) : null;
  if (!d || isNaN(d)) return '';
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

/* ── Previous / Next solution ─────────────────────────────────────────
   Steps through the problems of the same quiz that have a published
   solution, in the order students see them (active problems only, so a
   retired one has no neighbours and the buttons stay hidden). */
function solutionNeighbours(quizNum, problemId) {
  const quiz = typeof QUIZZES !== 'undefined' ? QUIZZES[quizNum - 1] : null;
  if (!quiz) return { prev: null, next: null };
  const ids = (quiz.problems || [])
    .map((q) => q.id)
    .filter((id) => id === problemId || hasPublishedSolution(quizNum, id));
  const i = ids.indexOf(problemId);
  if (i < 0) return { prev: null, next: null };
  return { prev: ids[i - 1] || null, next: ids[i + 1] || null };
}

function renderSolutionPager(quizNum, problemId) {
  const pager = document.getElementById('solutionPager');
  if (!pager) return;
  if (solutionPreviewMode) { pager.hidden = true; return; }   // would lead to published solutions
  // The index arrived while the list is open: update the list instead.
  if (isSolutionListOpen()) { pager.hidden = true; updateSolutionList(true); return; }
  const { prev, next } = solutionNeighbours(quizNum, problemId);
  [['solutionPrevProblem', prev, (l) => `‹ ${l}`], ['solutionNextProblem', next, (l) => `${l} ›`]]
    .forEach(([id, target, text]) => {
      const btn = document.getElementById(id);
      if (!btn) return;
      // visibility, not display: the other button keeps its side.
      btn.style.visibility = target ? '' : 'hidden';
      btn.textContent = target ? text(problemLabel(quizNum, target)) : '';
      btn.onclick = target ? () => openSolution(quizNum, target) : null;
      btn.title = target ? (id === 'solutionPrevProblem' ? 'Previous solution' : 'Next solution') : '';
    });
  // Always shown: the Solution list is useful even with no neighbours.
  pager.hidden = false;
}

/* ── Solution list ────────────────────────────────────────────────────
   Shown under every solution by default (solutionListByDefault), in the
   pager's place: one small box per active problem of a set, in the order
   students see them, the ones with a published solution clickable, and
   Q1–Q4 to look at another set. A dot in a box's corner is how that
   problem stands in the set's Solve them all (none if not tried there).
   With the setting off, the pager shows instead and its middle button
   opens the list, which then has a ✕ (or Esc) to bring the pager back.
   Picking a problem opens its solution (openSolution). When the index is
   refreshed while the list is open (refreshSolutionsUi), newly published
   boxes light up in place. */
let solutionListQuiz = null;   // the set the list shows

function isSolutionListOpen() {
  const list = document.getElementById('solutionList');
  return !!list && !list.hidden;
}

// Settings → Study → "Show the solution list by default" (on unless turned
// off): every solution opens with the list showing, and it has no ✕. Off,
// the pager shows instead, and a list opened from it can be closed.
function solutionListByDefault() {
  return typeof getSetting !== 'function' || getSetting('study', 'openSolutionList') !== false;
}

// Only a list opened from the pager can be closed: not one shown by
// default, nor the list alone (openSolutionBrowser).
function solutionListClosable() {
  return !solutionListByDefault() && !!solutionCurrent && !!solutionCurrent.problemId;
}

// Also run when the setting changes: an open list gains or loses its ✕,
// and turned on with a solution open, the list replaces the pager.
function syncSolutionListClose() {
  const btn = document.querySelector('#solutionList .solution-list-close');
  if (btn) btn.hidden = !solutionListClosable();
  if (solutionListByDefault() && solutionOpen && !solutionPreviewMode && !isSolutionListOpen()) showSolutionList(false);
}

// problemId -> 'correct' | 'partial' | 'wrong' | 'revealed': the set's
// Solve-them-all progress, from the same key its screen would open
// (saStorageKey in js/quiz-engine.js, for set quizNum).
function solveAllStatusesFor(quizNum) {
  const cum = typeof selectedCumulativeMode !== 'undefined' && selectedCumulativeMode === 'cumulative' ? 'c' : 's';
  try {
    const snap = JSON.parse(localStorage.getItem(`${STORAGE_PREFIX}_sa_q${quizNum}_${cum}`) || 'null');
    return (snap && snap.checkedById) || {};
  } catch (e) { return {}; }
}
const SOLVE_ALL_DOT = {
  correct:  ['correct', 'solved'],
  partial:  ['partial', 'value right, unit or form not'],
  wrong:    ['wrong', 'wrong so far'],
  revealed: ['wrong', 'answer revealed'],
};

// Restarts a one-shot animation class (css/solutions.css).
function replaySolutionAnim(el, cls) {
  el.classList.remove(cls);
  void el.offsetWidth;
  el.classList.add(cls);
}

// Builds the set buttons and the boxes of solutionListQuiz; which boxes
// are available is updateSolutionList's job.
function renderSolutionList() {
  const sets = document.getElementById('solutionListSets');
  const grid = document.getElementById('solutionListGrid');
  if (!sets || !grid || !solutionCurrent) return;
  const quizzes = typeof QUIZZES !== 'undefined' ? QUIZZES : [];
  const quizNum = solutionListQuiz || solutionCurrent.quizNum;

  sets.textContent = '';
  quizzes.forEach((q, i) => {
    const n = i + 1;
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'solution-close-btn solution-list-set';
    b.textContent = 'Q' + n;
    b.title = q.name ? `Set #${n}: ${q.name}` : `Set #${n}`;
    b.setAttribute('aria-pressed', String(n === quizNum));
    if (!q.enabled || !(q.problems || []).length) {
      b.disabled = true;
      b.title += ' (not available yet)';
    } else {
      b.onclick = () => {
        if (solutionListQuiz === n) return;
        solutionListQuiz = n;
        renderSolutionList();
        replaySolutionAnim(grid, 'sol-list-swap');
      };
    }
    sets.appendChild(b);
  });

  const statuses = solveAllStatusesFor(quizNum);
  const quiz = quizzes[quizNum - 1];
  grid.textContent = '';
  grid.dataset.quiz = String(quizNum);
  ((quiz && quiz.problems) || []).forEach((p) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'solution-close-btn solution-list-item';
    btn.dataset.problem = p.id;
    btn.textContent = problemLabel(quizNum, p.id);
    const dot = SOLVE_ALL_DOT[statuses[p.id]];
    if (dot) {
      const i = document.createElement('i');
      i.className = 'solution-list-dot ' + dot[0];
      btn.appendChild(i);
      btn.dataset.tried = 'Solve them all: ' + dot[1];
    }
    if (typeof problemFlagListMarkHtml === 'function') btn.insertAdjacentHTML('beforeend', problemFlagListMarkHtml(quizNum, p.id));
    btn.onclick = () => {
      if (btn.getAttribute('aria-current')) closeSolutionList();
      else openSolution(quizNum, p.id);
    };
    grid.appendChild(btn);
  });
  updateSolutionList(false);
}

// Marks the available boxes and the count. announce: pulse the boxes that
// just became available (the index was refreshed with the list open).
function updateSolutionList(announce) {
  const grid = document.getElementById('solutionListGrid');
  if (!grid || !solutionCurrent) return;
  const quizNum = +grid.dataset.quiz;
  const here = solutionCurrent.quizNum === quizNum ? solutionCurrent.problemId : null;
  let available = 0;
  const boxes = grid.querySelectorAll('.solution-list-item');
  boxes.forEach((btn) => {
    const id = btn.dataset.problem;
    const published = hasPublishedSolution(quizNum, id);
    if (published) available++;
    const open = published || id === here;
    if (announce && open && btn.disabled) replaySolutionAnim(btn, 'sol-list-new');
    btn.disabled = !open;
    if (id === here) btn.setAttribute('aria-current', 'true');
    else btn.removeAttribute('aria-current');
    btn.title = (id === here ? 'This solution' : open ? 'Open the solution' : 'No solution yet')
      + (btn.dataset.tried ? ' · ' + btn.dataset.tried : '')
      + (btn.querySelector('.solution-list-flag') ? ' · Flagged' : '');
  });
  document.getElementById('solutionListCount').textContent =
    boxes.length ? `(${available}/${boxes.length} available now)` : '';
}

function openSolutionList() { showSolutionList(true); }

// focus: move keyboard focus to the open problem's box — on a tap of the
// list button, not when the setting opens it with the solution.
function showSolutionList(focus) {
  const list = document.getElementById('solutionList');
  if (!list || solutionPreviewMode || !solutionCurrent) return;
  solutionListQuiz = solutionCurrent.quizNum;
  list.hidden = false;
  document.getElementById('solutionPager').hidden = true;
  syncSolutionListClose();
  renderSolutionList();
  // A tap eases it in; shown with a solution, it fades in with the rest.
  if (focus) replaySolutionAnim(list, 'sol-list-in');
  const here = list.querySelector('.solution-list-item[aria-current]');
  if (focus && here) here.focus({ preventScroll: true });
  // A copy older than poll.solutions is fetched again now, so the list is
  // as fresh as the rest of the site allows. With the database off, the
  // Netlify copy is the list instead (it refreshes the UI once read).
  if (solutionsCopyWanted()) loadSolutionsCopy();
  else loadSolutionsIndex().then(refreshSolutionsUi);
}

function closeSolutionList() {
  const list = document.getElementById('solutionList');
  if (!list || list.hidden) return;
  list.hidden = true;
  if (solutionCurrent) renderSolutionPager(solutionCurrent.quizNum, solutionCurrent.problemId);
  const pager = document.getElementById('solutionPager');
  if (pager && !pager.hidden) replaySolutionAnim(pager, 'sol-list-in');
  const btn = document.getElementById('solutionListBtn');
  if (btn) btn.focus({ preventScroll: true });
}

/* ── Share ────────────────────────────────────────────────────────────
   Copies a link that opens this solution directly: /s/q4_P16, which
   netlify/edge-functions/share.ts answers with the solution's own link
   preview (its picture, from the editor) and then sends on to
   ?solution=q4_P16, read back by openSolutionFromURL below. A local copy
   of the site has no edge function, so there the link is ?solution=
   itself. A tab other than the default adds its row id: /s/q4_P16~187
   (~ can't be part of a problem id, so the key stays unambiguous).
   Falls back to the share sheet, then to a prompt the link can be copied
   from by hand. */
let solutionShareTimer = null;
async function shareSolutionLink() {
  if (!solutionCurrent) return;
  const key = solutionKeyFor(solutionCurrent.quizNum, solutionCurrent.problemId)
    + (solutionCurrent.solutionId ? '~' + solutionCurrent.solutionId : '');
  const base = new URL(window.location.pathname.replace(/[^/]*$/, ''), window.location.origin);
  const local = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(window.location.hostname);
  const url = local ? new URL('?solution=' + encodeURIComponent(key), base) : new URL('s/' + encodeURIComponent(key), base);
  const link = url.href;
  const btn = document.getElementById('solutionShareBtn');
  const flash = (text) => {
    if (!btn) return;
    btn.textContent = text;
    clearTimeout(solutionShareTimer);
    solutionShareTimer = setTimeout(() => { btn.textContent = '🔗 Share'; }, 1600);
  };
  try {
    await navigator.clipboard.writeText(link);
    flash('✓ Copied');
    return;
  } catch (e) { /* no clipboard access: try the next way */ }
  if (navigator.share) {
    try { await navigator.share({ url: link }); } catch (e) { /* cancelled */ }
    return;
  }
  window.prompt('Copy this link:', link);
}

/* ── Editor "Full preview" ─────────────────────────────────────────────
   The editor (editor/editor.js, openFullPreview) loads this page as
   /?solutionPreview=1 in an overlay (an iframe) over itself. The page asks
   it for the solution it has on screen — saved or not — by postMessage,
   then shows it on the real Solution screen, exactly as readers will see
   it, credited to that editor and dated now. Share and Previous/Next are
   hidden there, Close asks the editor to close the overlay, and the visit
   is not counted (js/site-visits.js). Nothing goes through storage.

   Messages to the editor: 'solution-preview-request' (send the solution),
   'solution-preview-ready' (show me), 'solution-preview-failed' (nothing
   usable to preview) and 'solution-preview-close'. No-op outside an
   iframe. The editor answers with 'solution-preview-data'. */
function notifyPreviewParent(type) {
  if (window.parent !== window) window.parent.postMessage({ type }, window.location.origin);
}

function setSolutionPreviewMode(on) {
  solutionPreviewMode = on;
  const share = document.getElementById('solutionShareBtn');
  if (share) share.hidden = on;
  const close = document.getElementById('solutionCloseBtn');
  if (close) close.title = close.ariaLabel = on ? 'Close preview' : 'Close';
}

// A shared link (?solution=q4_P16, or q4_P16~187 for one of its tabs)
// opens that solution once the page has loaded, then the parameter is
// dropped from the address bar so a reload does not reopen it. The problem
// id is matched ignoring case. Unknown keys, disabled quizzes and problems
// that no longer exist are ignored; an unknown tab opens the default.
(function openSolutionFromURL() {
  const params = new URLSearchParams(window.location.search);
  const key = params.get('solution');
  const preview = params.get('solutionPreview') === '1';
  if (!key && !preview) return;
  params.delete('solution');
  params.delete('solutionPreview');
  const rest = params.toString();
  history.replaceState(history.state, '', window.location.pathname + (rest ? '?' + rest : '') + window.location.hash);
  const whenLoaded = (fn) => {
    if (document.readyState === 'complete') fn();
    else window.addEventListener('load', fn, { once: true });
  };

  if (preview) {
    // Opened on its own (not inside the editor): nothing to preview.
    if (window.parent === window) return;
    // Not a reader's visit (js/site-visits.js skips it), and the landing
    // screen stays hidden until the solution is up, so it doesn't flash.
    window.__solutionPreview = true;
    document.documentElement.classList.add('solution-preview-boot', 'solution-preview');
    window.addEventListener('message', function onPreviewData(e) {
      if (e.source !== window.parent || e.origin !== window.location.origin) return;
      if (!e.data || e.data.type !== 'solution-preview-data') return;
      window.removeEventListener('message', onPreviewData);
      const data = e.data.data;
      // Disabled quizzes are fine here: editors write ahead of a quiz going live.
      const pm = data && /^q([1-9][0-9]?)_([A-Za-z][A-Za-z0-9_-]{0,30})$/.exec(data.problem_key || '');
      if (!pm) { notifyPreviewParent('solution-preview-failed'); return; }
      const row = {
        problem_key: data.problem_key,
        solution: typeof data.solution === 'string' ? data.solution : '',
        figure: data.figure && typeof data.figure === 'object' ? data.figure : null,
        author: data.author || null,
        author_link: data.author_link || null,
        updated_at: data.updated_at || new Date().toISOString(),
      };
      whenLoaded(() => openSolution(+pm[1], pm[2], row));
    });
    notifyPreviewParent('solution-preview-request');
    return;
  }

  const m = /^q([1-9][0-9]?)_([A-Za-z][A-Za-z0-9_-]{0,30})(?:~([1-9][0-9]{0,14}))?$/.exec(key);
  if (!m) return;
  const solutionId = m[3] ? +m[3] : null;
  const quizNum = +m[1];
  const quiz = typeof QUIZZES !== 'undefined' ? QUIZZES[quizNum - 1] : null;
  if (!quiz || quiz.enabled === false) return;
  // A link can arrive lowercased (an address bar's autocomplete, typed by
  // hand: ?solution=q3_p17i), so the id is matched ignoring case.
  const lower = m[2].toLowerCase();
  const p = getQuizProblem(quizNum, m[2]) ||
    [...(quiz.problems || []), ...(quiz.retired || [])].find((q) => q.id.toLowerCase() === lower);
  if (!p) return;
  whenLoaded(() => openSolution(quizNum, p.id, null, solutionId));
})();

function safeAuthorLink(raw) {
  if (typeof raw !== 'string' || !raw) return null;
  try {
    const u = new URL(raw);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.href : null;
  } catch (e) {
    return null;
  }
}

/* Horizontal swipe on the figure, for phones. Only a clearly horizontal
   gesture counts, so a vertical flick still scrolls the page. */
function attachSolutionSwipe(el) {
  if (!el || el.dataset.swipeBound) return;
  el.dataset.swipeBound = '1';
  let x0 = null, y0 = null;
  el.addEventListener('touchstart', (e) => {
    const t = e.changedTouches[0];
    x0 = t.clientX; y0 = t.clientY;
  }, { passive: true });
  el.addEventListener('touchend', (e) => {
    if (x0 === null) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - x0, dy = t.clientY - y0;
    x0 = y0 = null;
    if (Math.abs(dx) < 40 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
    if (solFigZoom > 1 || solFigLensOn) return;     // that drag was panning / magnifying
    solutionStep(dx < 0 ? 1 : -1);
  }, { passive: true });
}

/* ── Figure zoom & magnifier ───────────────────────────────────────────
   Three buttons at the right of the step-navigation row: − / + zoom
   (100–400%) and a magnifier.
     Zoom: the figure is drawn wider inside a frame that keeps its 100%
       size and scrolls — dragged with the mouse, or panned with a finger
       (native scrolling). The point at the centre of the view stays there.
       − back down to 100% (or the 0 key) resets. Keys + / − / 0 too.
     Magnifier: a round lens showing what is under it at SOL_LENS_ZOOM×.
       Mouse: follows the pointer over the figure. Touch: press and drag;
       the lens sits above the finger so the finger doesn't cover it.
       It holds a copy of the step on screen, inside a .fig element, so the
       theme colours apply to it like to the figure.
   Using either stops the step autoplay, and while zoomed or magnifying a
   swipe no longer changes steps. Everything resets when a solution opens. */
const SOL_ZOOM_STEPS = [1, 1.5, 2, 3, 4];
const SOL_LENS_SIZE = 150, SOL_LENS_ZOOM = 2.5;
let solFigZoom = 1, solFigLensOn = false;
let solFigBase = null;             // { w, h } of the figure and its frame at 100%
let solFigDrag = null;             // mouse drag-to-pan in progress

const solFigEls = () => ({
  stage: document.getElementById('solutionFigure'),
  wrap: document.getElementById('solutionFigStage'),
  lens: document.getElementById('solutionFigLens'),
});

function updateSolutionZoomUi() {
  const out = document.getElementById('solutionZoomOut');
  const inn = document.getElementById('solutionZoomIn');
  if (out) out.disabled = solFigZoom <= SOL_ZOOM_STEPS[0];
  if (inn) inn.disabled = solFigZoom >= SOL_ZOOM_STEPS[SOL_ZOOM_STEPS.length - 1];
  if (out) out.title = solFigZoom > 1 ? `Zoom out (${Math.round(solFigZoom * 100)}%)` : 'Zoom out';
  const lb = document.getElementById('solutionLensBtn');
  if (lb) lb.setAttribute('aria-pressed', String(solFigLensOn));
  const { wrap } = solFigEls();
  if (wrap) wrap.classList.toggle('lens-on', solFigLensOn);
}

function setSolutionZoom(z) {
  const { stage } = solFigEls();
  const holder = stage && stage.querySelector('.fig-steps');
  const svg = holder && holder.querySelector('.fig-step.on svg, svg');
  if (!stage || !holder || !svg) { solFigZoom = 1; updateSolutionZoomUi(); return; }
  z = Math.min(SOL_ZOOM_STEPS[SOL_ZOOM_STEPS.length - 1], Math.max(1, z));
  if (z === solFigZoom) { updateSolutionZoomUi(); return; }
  if (z > 1) stopSolutionAutoplay();
  // Keep the point at the centre of the view in the centre.
  const fx = stage.scrollWidth ? (stage.scrollLeft + stage.clientWidth / 2) / stage.scrollWidth : 0.5;
  const fy = stage.scrollHeight ? (stage.scrollTop + stage.clientHeight / 2) / stage.scrollHeight : 0.5;
  if (solFigZoom === 1) {
    const r = svg.getBoundingClientRect();
    solFigBase = { w: r.width, h: stage.clientHeight };
  }
  solFigZoom = z;
  hideSolutionLens();
  if (z === 1 || !solFigBase) {
    stage.classList.remove('zoomed');
    stage.style.height = holder.style.width = holder.style.maxWidth = '';
    stage.scrollLeft = stage.scrollTop = 0;
  } else {
    stage.classList.add('zoomed');
    stage.style.height = solFigBase.h + 'px';       // the frame keeps its 100% size
    holder.style.maxWidth = 'none';
    holder.style.width = (solFigBase.w * z) + 'px';
    stage.scrollLeft = fx * stage.scrollWidth - stage.clientWidth / 2;
    stage.scrollTop = fy * stage.scrollHeight - stage.clientHeight / 2;
  }
  updateSolutionZoomUi();
}

function stepSolutionZoom(dir) {
  const i = SOL_ZOOM_STEPS.findIndex((z) => z >= solFigZoom - 1e-9);
  const next = SOL_ZOOM_STEPS[Math.min(SOL_ZOOM_STEPS.length - 1, Math.max(0, (i < 0 ? 0 : i) + dir))];
  setSolutionZoom(next);
}

function hideSolutionLens() {
  const { lens } = solFigEls();
  if (lens) lens.hidden = true;
}

// Shows the lens at a pointer position (client coordinates). touch: put it
// above the finger instead of under it.
function showSolutionLens(clientX, clientY, touch) {
  const { wrap, lens } = solFigEls();
  const svg = document.querySelector('#solutionFigure .fig-step.on svg');
  if (!wrap || !lens || !svg) return;
  const r = svg.getBoundingClientRect();
  if (clientX < r.left || clientX > r.right || clientY < r.top || clientY > r.bottom) { hideSolutionLens(); return; }
  const idx = solutionViewer ? solutionViewer.index : 0;
  if (lens.dataset.step !== String(idx) || !lens.firstElementChild) {
    lens.textContent = '';
    const copy = svg.cloneNode(true);
    copy.removeAttribute('id');
    lens.appendChild(copy);
    lens.dataset.step = String(idx);
  }
  const copy = lens.firstElementChild;
  const half = SOL_LENS_SIZE / 2;
  copy.style.width = (r.width * SOL_LENS_ZOOM) + 'px';
  copy.style.height = (r.height * SOL_LENS_ZOOM) + 'px';
  copy.style.left = (half - (clientX - r.left) * SOL_LENS_ZOOM) + 'px';
  copy.style.top = (half - (clientY - r.top) * SOL_LENS_ZOOM) + 'px';
  const wr = wrap.getBoundingClientRect();
  const lift = touch ? SOL_LENS_SIZE * 0.8 : 0;
  lens.style.transform = `translate(${clientX - wr.left - half}px, ${clientY - wr.top - half - lift}px)`;
  lens.hidden = false;
}

function toggleSolutionLens() {
  solFigLensOn = !solFigLensOn;
  if (solFigLensOn) stopSolutionAutoplay();
  hideSolutionLens();
  updateSolutionZoomUi();
}

function resetSolutionFigTools() {
  solFigLensOn = false;
  const { lens } = solFigEls();
  if (lens) { lens.textContent = ''; lens.dataset.step = ''; }
  setSolutionZoom(1);
  solFigZoom = 1;
  solFigBase = null;
  updateSolutionZoomUi();
}

// Run once the page is parsed: this file loads before #solutionScreen's
// markup, so its buttons don't exist yet when the script itself runs.
function initSolutionFigTools() {
  const { stage, wrap } = solFigEls();
  if (!stage || !wrap) return;
  const on = (id, fn) => { const b = document.getElementById(id); if (b) b.addEventListener('click', fn); };
  on('solutionZoomIn', () => stepSolutionZoom(1));
  on('solutionZoomOut', () => stepSolutionZoom(-1));
  on('solutionLensBtn', toggleSolutionLens);

  stage.addEventListener('pointerdown', (e) => {
    if (solFigLensOn) {
      if (e.pointerType !== 'mouse') { showSolutionLens(e.clientX, e.clientY, true); try { stage.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ } }
      return;
    }
    // Mouse drag-to-pan while zoomed (touch pans by native scrolling).
    if (solFigZoom > 1 && e.pointerType === 'mouse' && e.button === 0) {
      solFigDrag = { x: e.clientX, y: e.clientY, l: stage.scrollLeft, t: stage.scrollTop };
      stage.classList.add('dragging');
      try { stage.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
      e.preventDefault();
    }
  });
  stage.addEventListener('pointermove', (e) => {
    if (solFigDrag) {
      stage.scrollLeft = solFigDrag.l - (e.clientX - solFigDrag.x);
      stage.scrollTop = solFigDrag.t - (e.clientY - solFigDrag.y);
      return;
    }
    if (!solFigLensOn) return;
    if (e.pointerType === 'mouse') showSolutionLens(e.clientX, e.clientY, false);
    else if (e.buttons || e.pressure > 0) showSolutionLens(e.clientX, e.clientY, true);
  });
  const end = (e) => {
    if (solFigDrag) {
      solFigDrag = null;
      stage.classList.remove('dragging');
    }
    if (e.type === 'pointerleave' || e.pointerType !== 'mouse') hideSolutionLens();
  };
  ['pointerup', 'pointercancel', 'pointerleave'].forEach((t) => stage.addEventListener(t, end));
  // Sizes measured at 100% no longer hold after the window changes size.
  window.addEventListener('resize', () => { if (solFigZoom > 1) setSolutionZoom(1); hideSolutionLens(); });
  updateSolutionZoomUi();
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initSolutionFigTools);
else initSolutionFigTools();

/** Must match problemHashOf() in editor/editor.js exactly. */
async function solutionProblemHash(p) {
  const src = `${p.text}\u0000${JSON.stringify(p.answer)}\u0000${JSON.stringify(p.units || [])}`;
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(src));
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 32);
}

document.addEventListener('keydown', (e) => {
  if (!isSolutionScreenOpen()) return;              // not while another screen sits on top
  if (/^(INPUT|TEXTAREA|SELECT)$/.test(e.target && e.target.tagName)) return;
  if (e.key === 'Escape') {
    // A list that can be closed (it has its ✕) goes first, then the screen.
    if (isSolutionListOpen() && solutionListClosable()) closeSolutionList();
    else closeSolutionScreen();
    return;
  }
  if (e.key === '+' || e.key === '=') { stepSolutionZoom(1); return; }
  if (e.key === '-' || e.key === '_') { stepSolutionZoom(-1); return; }
  if (e.key === '0') { setSolutionZoom(1); return; }
  if (!solutionViewer) return;
  if (e.key === 'ArrowLeft')  solutionStep(-1);
  if (e.key === 'ArrowRight') solutionStep(1);
});

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initSolutions);
} else {
  initSolutions();
}
