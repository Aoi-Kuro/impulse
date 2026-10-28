// ─── Remote settings from site-version.json ──────────────────────────────────
// Every open tab fetches site-version.json every few minutes while it is
// visible (checkForUpdate, js/quiz-engine.js). Next to "version" and
// "editor" the file can carry the optional settings below, which reach every
// open tab within one check, without a release. Anything missing, misspelled
// or out of range falls back to its default; builds from before this file
// ignore all of it. Once a key has shipped, never rename it or change what it means:
// tabs on older builds keep reading the old name (renaming version.json is
// what left tabs stuck on old code for days, see js/quiz-engine.js).
// minify.py checks the file before every build and lists what it will do.
// The file keeps every key as a do-nothing placeholder ("min_version": "",
// "poll": {}, "off": [], "sync_paused": false, "purge_id": ""), so the
// options are visible where they're set; an empty value means the default.
//
//   "min_version": "12.4.6"
//       Tabs on an older version reload as soon as they are outside a timed
//       quiz, instead of after the usual 48 h; a timed quiz is interrupted
//       only once it has run 3 h. Missing: no minimum. Handled in
//       js/quiz-engine.js (maybeForceUpdateOutsideQuiz).
//   "poll": { "attempts": 120, ... }
//       Background intervals in seconds (SITE_POLL below). A missing name
//       keeps its default; a value outside the limits is clamped to them,
//       except zero or a negative number, which is ignored: read as "off"
//       or a typo, clamping it would poll at the fastest rate allowed.
//   "off": ["realtime", "forum_posting"]
//       realtime       no live connections; everything relies on its poll
//       forum_posting  the forum is read-only: no new messages, replies or edits
//   "sync_paused": true
//       Attempts, Solve-All progress and settings stay in each browser and are neither
//       sent nor fetched until this is removed; deleting an attempt and
//       resetting Solve-All still go through. Removing it syncs at once.
//   "purge_id": "2026-10-23"
//       Each browser refills its offline cache once per new value (sw.js
//       refills at most once an hour, so a fresh install skips it).
//
// The last settings seen are kept in localStorage, so a page load starts
// with them instead of the defaults until its first check comes back.

// name:          [default, min, max] in seconds. minify.py reads this table.
const SITE_POLL = {
  attempts:    [45, 15, 3600],       // attempts sync fallback (js/attempts-sync.js)
  solve_all:   [60, 15, 3600],       // Solve-All sync fallback (js/solve-all-sync.js)
  settings:    [900, 60, 86400],     // settings sync fallback (js/settings-sync.js)
  stats:       [45, 15, 3600],       // Forum & Site panel refresh (js/stats.js)
  forum:       [90, 15, 3600],       // forum fallback check (js/forum.js)
  forum_quiet: [900, 60, 21600],     // forum fallback check once nobody has posted for 24 h
  solutions:   [1800, 60, 86400],    // how long one solutions index fetch is reused (js/solutions.js)
  update:      [300, 60, 1800],      // site-version.json check (js/quiz-engine.js)
};
const SITE_OFF_NAMES = ['realtime', 'forum_posting'];
const SITE_CONFIG_KEY = STORAGE_PREFIX + '-site-config';
const SITE_PURGE_ID_KEY = STORAGE_PREFIX + '-purge-id';

function _cleanSiteConfig(raw) {
  const src = (raw && typeof raw === 'object') ? raw : {};
  const poll = {};
  const rawPoll = (src.poll && typeof src.poll === 'object') ? src.poll : {};
  Object.keys(SITE_POLL).forEach((name) => {
    const v = Number(rawPoll[name]);
    if (rawPoll[name] == null || !Number.isFinite(v) || v <= 0) return;
    const [, min, max] = SITE_POLL[name];
    poll[name] = Math.min(max, Math.max(min, v));
  });
  return {
    poll,
    off: Array.isArray(src.off) ? SITE_OFF_NAMES.filter((n) => src.off.includes(n)) : [],
    sync_paused: src.sync_paused === true,
    purge_id: typeof src.purge_id === 'string' ? src.purge_id.trim().slice(0, 100) : '',
  };
}

let _siteConfig = _cleanSiteConfig((() => {
  try { return JSON.parse(localStorage.getItem(SITE_CONFIG_KEY) || 'null'); } catch (_) { return null; }
})());

function sitePollMs(name) {
  const v = _siteConfig.poll[name];
  return (v != null ? v : SITE_POLL[name][0]) * 1000;
}
function siteOff(name) { return _siteConfig.off.includes(name); }
function siteSyncPaused() { return _siteConfig.sync_paused; }

// setInterval whose period is the "poll" setting `name`. A changed setting
// re-arms it straight away, so a slower interval doesn't wait out the old one.
// The callers' ticks skip themselves when something else (coming back to
// the tab, a Realtime ping) already did the work less than an interval ago
// (sitePollDue below); otherwise that tick repeats it seconds later.
const _sitePollTimers = new Set();
function _armSitePoll(t) {
  clearInterval(t.id);
  t.ms = sitePollMs(t.name);
  t.id = setInterval(t.fn, t.ms);
}
function startSitePoll(name, fn) {
  const t = { name, fn, ms: 0, id: null };
  _sitePollTimers.add(t);
  _armSitePoll(t);
  return t;
}
// True once `lastAt` is an interval old. A few seconds of slack keep a timer
// tick that fires a little early from being skipped for a whole extra interval.
function sitePollDue(name, lastAt) {
  return Date.now() - lastAt >= sitePollMs(name) - 5000;
}

// Returns null, so callers can write `timer = stopSitePoll(timer)`.
function stopSitePoll(t) {
  if (t) { clearInterval(t.id); _sitePollTimers.delete(t); }
  return null;
}

// Called with the parsed site-version.json on every successful check.
// Dispatches 'site-config-changed' ({ before, after }) on the document when
// anything differs, for the files that have to react (Realtime, sync pause).
function applySiteConfig(manifest) {
  const next = _cleanSiteConfig(manifest);
  const before = _siteConfig;
  if (next.purge_id) _applySitePurgeId(next.purge_id);
  if (JSON.stringify(next) === JSON.stringify(before)) return;
  _siteConfig = next;
  try { localStorage.setItem(SITE_CONFIG_KEY, JSON.stringify(next)); } catch (_) {}
  _sitePollTimers.forEach((t) => { if (sitePollMs(t.name) !== t.ms) _armSitePoll(t); });
  document.dispatchEvent(new CustomEvent('site-config-changed', { detail: { before, after: next } }));
}

// Once per browser per value: the id is stored before the worker is asked,
// so other tabs seeing the same value don't ask again. Without localStorage
// there's no record, so nothing is asked (it would repeat every check).
function _applySitePurgeId(id) {
  try {
    if (localStorage.getItem(SITE_PURGE_ID_KEY) === id) return;
    localStorage.setItem(SITE_PURGE_ID_KEY, id);
  } catch (_) { return; }
  const worker = ('serviceWorker' in navigator) ? navigator.serviceWorker.controller : null;
  if (worker) worker.postMessage({ type: 'purge-update-cache' });
}
