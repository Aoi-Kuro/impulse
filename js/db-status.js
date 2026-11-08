// ─── Database status: is the course database off? ────────────────────────────
// The course database gets paused between semesters. A paused Supabase
// project has no DNS record, so in the browser every request fails with the
// same "Failed to fetch" as a dead network, and only a server can tell them
// apart. netlify/edge-functions/db-status.ts is that server; its header has
// the details.
//
// The cases this separates after a failed request:
//   paused   the server says so. siteSyncPaused() and siteOff('realtime') turn
//            true (js/site-config.js), so attempts, Solve-All and settings
//            wait on this device exactly as with "sync_paused", and catch up
//            by themselves once it's back.
//   down     the server can't get an answer from the database either. One
//            answer could be a hiccup, so it only counts as offline once a
//            second check a minute later agrees (DB_DOWN_CONFIRM_MS).
//   anything else, or /db-status itself failing: the database is fine or
//            unknown, so the trouble is on the viewer's side and callers keep
//            their usual "check your connection" text.
//
// dbOffline() is the "we're sure" answer. While it's true, html.db-offline is
// set: that shows every .db-offline-box on the page and lets the CSS hide what
// can't work. 'db-status-changed' goes to the document when it flips, for
// what CSS can't do. Lockdown doesn't wait for "sure": it refuses on any
// problem at all (dbProblemText(), js/lockdown.js), as an attempt that can't
// reach the drop-off is lost.
//
// While the site is healthy /db-status is asked only by the few things that
// must know first: starting lockdown, and a new device about to register. Any
// other check follows a failed request to Supabase, at most once per
// "poll.db_status" per browser (the result is shared between tabs through
// localStorage), and a page load starts from the last result, so one during a
// pause sends nothing first.
//
// Watching window.fetch rather than each caller also covers supabase-js and
// every Edge Function call, and needs no change to any of them. It only looks
// at the outcome; the caller gets the same response or error either way.

const DB_STATUS_URL = '/db-status';
const DB_STATUS_KEY = STORAGE_PREFIX + '-db-status';
const DB_STATUS_TIMEOUT_MS = 8000;     // db-status.ts takes 8 s at the very worst
const DB_DOWN_CONFIRM_MS = 60 * 1000;  // as long as Netlify's CDN keeps an answer
const DB_ADMIN_LINK = 'https://t.me/Aoi_Kuro';

let _dbState = 'up';                   // 'up', 'paused' or 'down'
let _dbSince = 0;                      // when this state was first seen
let _dbAt = 0;                         // when it was last seen
let _dbCheck = null;                   // the check under way

function dbOffline() {
  return _dbState === 'paused' || (_dbState === 'down' && _dbAt - _dbSince >= DB_DOWN_CONFIRM_MS);
}

function _readDbStatus() {
  try { return JSON.parse(localStorage.getItem(DB_STATUS_KEY) || 'null'); } catch (_) { return null; }
}

function _applyDbStatus(status) {
  const wasPaused = _dbState === 'paused';
  const wasOffline = dbOffline();
  _dbState = status.state;
  _dbSince = status.since;
  _dbAt = status.at;
  if (wasPaused !== (_dbState === 'paused')) setSiteDbPaused(_dbState === 'paused');
  if (wasOffline === dbOffline()) return;
  document.documentElement.classList.toggle('db-offline', dbOffline());
  document.dispatchEvent(new CustomEvent('db-status-changed'));
}

function _setDbState(state) {
  const at = Date.now();
  const status = { state, at, since: state === _dbState && _dbSince ? _dbSince : at };
  try { localStorage.setItem(DB_STATUS_KEY, JSON.stringify(status)); } catch (_) {}
  _applyDbStatus(status);
  if (state === 'down' && !dbOffline()) setTimeout(() => checkDbStatus({ force: true }), DB_DOWN_CONFIRM_MS + 5000);
}

// Full offline mode (js/offline-mode.js): sw.js refuses every Supabase request
// on purpose, so those failures say nothing about the database.
function _dbOfflineMode() {
  try {
    const raw = JSON.parse(localStorage.getItem('flux_settings') || 'null');
    const until = raw && raw.offline && raw.offline.until;
    return typeof until === 'number' && Date.now() < until;
  } catch (_) {
    return false;
  }
}

// Resolves once the state is as known as it's going to get. Never rejects.
// force: don't settle for an answer from the last few minutes.
function checkDbStatus({ force = false } = {}) {
  if (_dbCheck) return _dbCheck;
  if (navigator.onLine === false || _dbOfflineMode()) return Promise.resolve();
  const saved = _readDbStatus();
  if (!force && saved && !sitePollDue('db_status', saved.at)) {
    _applyDbStatus(saved);
    return Promise.resolve();
  }
  _dbCheck = fetch(DB_STATUS_URL, { cache: 'no-store', signal: AbortSignal.timeout(DB_STATUS_TIMEOUT_MS) })
    .then((res) => (res.ok ? res.json() : null))
    .then((data) => _setDbState(data && (data.state === 'paused' || data.state === 'down') ? data.state : 'up'))
    .catch(() => { /* couldn't ask: says nothing about the database */ })
    .finally(() => { _dbCheck = null; });
  return _dbCheck;
}

// One line for a spot too small for the box, or null when the database isn't
// the reason.
function dbProblemText() {
  if (dbOffline()) return 'The project\'s database is offline right now.';
  if (_dbState === 'down') return 'The project\'s database isn\'t responding right now. Try again in a bit.';
  return null;
}

// The same for a failure that has just happened, which started the check that
// this waits for. `fallback` is the caller's usual message.
async function dbFailureText(fallback) {
  await checkDbStatus();
  return dbProblemText() || fallback;
}

// Inside Safe Exam Browser a link leads nowhere, so there it's plain words.
function _fillDbOfflineBox(box) {
  const admin = document.documentElement.classList.contains('lockdown')
    ? 'the admin'
    : `<a href="${DB_ADMIN_LINK}" target="_blank" rel="noopener">the admin</a>`;
  box.setAttribute('role', 'status');
  box.innerHTML = 'The project\'s database is currently offline. This is most likely because the '
    + 'course isn\'t active this semester, or, less likely, because of a Supabase outage. '
    + `Please contact ${admin} if you need the project now.`;
}

// A box for a spot that only exists after a failure.
function dbOfflineBox() {
  const box = document.createElement('div');
  box.className = 'db-offline-box';
  _fillDbOfflineBox(box);
  return box;
}

document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('.db-offline-box:empty').forEach(_fillDbOfflineBox);
});

const _plainFetch = window.fetch;
window.fetch = function (input) {
  const pending = _plainFetch.apply(this, arguments);
  const url = typeof input === 'string' ? input : (input && input.url) || String(input);
  if (!url.startsWith(SUPABASE_URL)) return pending;
  pending.then((res) => {
    if (res.status >= 500 || res.status === 402) _dbRequestFailed();
    else if (_dbState !== 'up') _setDbState('up');   // back on: no need to wait for the next check
  }, (err) => {
    if (!err || err.name !== 'AbortError') _dbRequestFailed();
  });
  return pending;
};

// Forum and stats polls keep failing during a pause; the timer below is what
// rechecks then, so they don't each ask again.
function _dbRequestFailed() {
  if (_dbState === 'up' && !document.hidden) checkDbStatus();
}

function _recheckDbStatus() {
  if (_dbState !== 'up' && !document.hidden) checkDbStatus();
}

const _dbSaved = _readDbStatus();
if (_dbSaved) _applyDbStatus(_dbSaved);
_recheckDbStatus();

startSitePoll('db_status', _recheckDbStatus);
document.addEventListener('visibilitychange', _recheckDbStatus);
window.addEventListener('storage', (e) => {
  if (e.key !== DB_STATUS_KEY) return;
  const saved = _readDbStatus();
  if (saved) _applyDbStatus(saved);
});
