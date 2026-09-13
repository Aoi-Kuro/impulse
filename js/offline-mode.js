// ─── Offline mode (Settings > Offline & Sync) ────────────────────────────
// Phase 4: "Go offline" downloads every file the app needs to keep running
// with zero connection (course data, quiz images, app shell, MathJax),
// then for 24 hours blocks every network request — same-origin app files
// AND the Supabase/host backend — so the app runs entirely off what's
// cached here, even if a real connection comes back mid-window.
//
// This file owns the download + the on/off state; sw.js is what actually
// enforces the block on every fetch(), and reads the same state back out
// (see OFFLINE_MODE_CACHE_NAME / OFFLINE_MODE_DB_NAME comments below —
// both must stay byte-for-byte in sync with sw.js's own copies). Kept
// deliberately separate from sw.js's own CACHE_NAME (the offline.html
// fallback cache) so a version bump on either one never deletes the
// other's files — see sw.js's 'activate' handler.

// Must match sw.js's OFFLINE_MODE_CACHE_NAME exactly.
const OFFLINE_MODE_CACHE_NAME = 'flux-offline-mode-v1';

// IndexedDB mirror of the "offline mode until" timestamp (ms epoch, or
// null) — same reasoning as settings.js's NOTIF_MUTE_DB_NAME: sw.js's
// fetch handler has no localStorage access, so this is the one storage
// both a page and the service worker can actually read. Must match sw.js's
// OFFLINE_MODE_DB_NAME/OFFLINE_MODE_STORE exactly.
const OFFLINE_MODE_DB_NAME = 'flux-offline-mode';
const OFFLINE_MODE_STORE = 'flags';

function writeOfflineModeUntilFlag(until) {
  if (typeof indexedDB === 'undefined') return;
  try {
    const req = indexedDB.open(OFFLINE_MODE_DB_NAME, 1);
    req.onupgradeneeded = () => { req.result.createObjectStore(OFFLINE_MODE_STORE); };
    req.onsuccess = () => {
      const db = req.result;
      try {
        const tx = db.transaction(OFFLINE_MODE_STORE, 'readwrite');
        tx.objectStore(OFFLINE_MODE_STORE).put(until || null, 'until');
        tx.oncomplete = () => db.close();
        tx.onerror = () => db.close();
      } catch (e) { db.close(); }
    };
    // req.onerror: IndexedDB unavailable/blocked — sw.js's readOfflineModeUntil()
    // just resolves null, same as offline mode never having been turned on.
  } catch (e) { /* ignore */ }
}

// ── What gets downloaded ──
// Core app shell + course data — everything needed to actually study,
// deliberately excluding the forum (Supabase-backed either way, can't work
// with zero connection regardless of caching) and the PDF/XLSX export
// vendor bundles (nice-to-have, not required to keep solving problems).
// Keep this in sync by hand whenever a new top-level css/js file is added
// to index.html's own script/link tags.
const OFFLINE_CORE_FILES = [
  'index.html',
  'css/style.css',
  'css/settings.css',
  'css/manual.css',
  'css/stats.css',
  'css/forum.css',
  'js/course-config.js',
  'js/theme-colors.js',
  'js/banner-manager.js',
  'js/themes.js',
  'js/splash.js',
  'js/easter.js',
  'js/data/changelog.js',
  'js/data/tips.js',
  'js/stats.js',
  'js/stats-export.js',
  'js/attempts-sync.js',
  'js/solve-all-sync.js',
  'js/math-cache.js',
  'js/math-render.js',
  'js/quiz-engine.js',
  'js/fig-attribution.js',
  'js/top-bar-scroll.js',
  'js/top-bar-tips.js',
  'js/changelog.js',
  'js/manual.js',
  'js/settings.js',
  'js/offline-mode.js',
  'js/site-visits.js',
  'js/forum.js',
  'js/push-notifications.js',
  'course/course.json',
  'course/manual.json',
  'course/splashes.json',
  'course/offline-laws.json',
  'course/quizzes/quiz1.js',
  'course/quizzes/quiz2.js',
  'course/quizzes/quiz3.js',
  'course/quizzes/quiz4.js',
  'course/quizzes/quizzes.js',
  'favicon/favicon.svg',
  'favicon/favicon-96x96.png',
  'favicon/apple-touch-icon.png',
  'favicon/web-app-manifest-192x192.png',
  'favicon/web-app-manifest-512x512.png',
  'favicon/site.webmanifest',
  'https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;600;700&family=IBM+Plex+Sans:wght@300;400;600&family=Bangers&family=STIX+Two+Text:ital,wght@0,400;1,400&family=Space+Grotesk:wght@400;500;700&family=Space+Mono:wght@400;700&family=Quicksand:wght@400;500;700&display=swap'
];

// Same MathJax vendor list sw.js already precaches for offline.html — one
// copy, reused here, rather than typed out a second time (this file runs
// in the page, not the service worker, so it can't just read sw.js's own
// array directly).
const OFFLINE_MATHJAX_FILES = [
  'vendor/mathjax/mathjax-stix2.js',
  'vendor/mathjax/fonts/woff/mjx-stx-ac.woff',
  'vendor/mathjax/fonts/woff/mjx-stx-acb.woff',
  'vendor/mathjax/fonts/woff/mjx-stx-acbi.woff',
  'vendor/mathjax/fonts/woff/mjx-stx-aci.woff',
  'vendor/mathjax/fonts/woff/mjx-stx-ar.woff',
  'vendor/mathjax/fonts/woff/mjx-stx-b.woff',
  'vendor/mathjax/fonts/woff/mjx-stx-bi.woff',
  'vendor/mathjax/fonts/woff/mjx-stx-brk.woff',
  'vendor/mathjax/fonts/woff/mjx-stx-c.woff',
  'vendor/mathjax/fonts/woff/mjx-stx-cb.woff',
  'vendor/mathjax/fonts/woff/mjx-stx-cy.woff',
  'vendor/mathjax/fonts/woff/mjx-stx-cyb.woff',
  'vendor/mathjax/fonts/woff/mjx-stx-cybi.woff',
  'vendor/mathjax/fonts/woff/mjx-stx-cyi.woff',
  'vendor/mathjax/fonts/woff/mjx-stx-db.woff',
  'vendor/mathjax/fonts/woff/mjx-stx-ds.woff',
  'vendor/mathjax/fonts/woff/mjx-stx-dsi.woff',
  'vendor/mathjax/fonts/woff/mjx-stx-e.woff',
  'vendor/mathjax/fonts/woff/mjx-stx-en.woff',
  'vendor/mathjax/fonts/woff/mjx-stx-f.woff',
  'vendor/mathjax/fonts/woff/mjx-stx-fb.woff',
  'vendor/mathjax/fonts/woff/mjx-stx-gk.woff',
  'vendor/mathjax/fonts/woff/mjx-stx-gkb.woff',
  'vendor/mathjax/fonts/woff/mjx-stx-gkbi.woff',
  'vendor/mathjax/fonts/woff/mjx-stx-gki.woff',
  'vendor/mathjax/fonts/woff/mjx-stx-i.woff',
  'vendor/mathjax/fonts/woff/mjx-stx-lb.woff',
  'vendor/mathjax/fonts/woff/mjx-stx-lbi.woff',
  'vendor/mathjax/fonts/woff/mjx-stx-li.woff',
  'vendor/mathjax/fonts/woff/mjx-stx-lo.woff',
  'vendor/mathjax/fonts/woff/mjx-stx-lr.woff',
  'vendor/mathjax/fonts/woff/mjx-stx-m.woff',
  'vendor/mathjax/fonts/woff/mjx-stx-mi.woff',
  'vendor/mathjax/fonts/woff/mjx-stx-mm.woff',
  'vendor/mathjax/fonts/woff/mjx-stx-n.woff',
  'vendor/mathjax/fonts/woff/mjx-stx-ob.woff',
  'vendor/mathjax/fonts/woff/mjx-stx-os.woff',
  'vendor/mathjax/fonts/woff/mjx-stx-ph.woff',
  'vendor/mathjax/fonts/woff/mjx-stx-phb.woff',
  'vendor/mathjax/fonts/woff/mjx-stx-phbi.woff',
  'vendor/mathjax/fonts/woff/mjx-stx-phi.woff',
  'vendor/mathjax/fonts/woff/mjx-stx-s.woff',
  'vendor/mathjax/fonts/woff/mjx-stx-s10.woff',
  'vendor/mathjax/fonts/woff/mjx-stx-s11.woff',
  'vendor/mathjax/fonts/woff/mjx-stx-s12.woff',
  'vendor/mathjax/fonts/woff/mjx-stx-s3.woff',
  'vendor/mathjax/fonts/woff/mjx-stx-s4.woff',
  'vendor/mathjax/fonts/woff/mjx-stx-s5.woff',
  'vendor/mathjax/fonts/woff/mjx-stx-s6.woff',
  'vendor/mathjax/fonts/woff/mjx-stx-s7.woff',
  'vendor/mathjax/fonts/woff/mjx-stx-s8.woff',
  'vendor/mathjax/fonts/woff/mjx-stx-s9.woff',
  'vendor/mathjax/fonts/woff/mjx-stx-sb.woff',
  'vendor/mathjax/fonts/woff/mjx-stx-sh.woff',
  'vendor/mathjax/fonts/woff/mjx-stx-so.woff',
  'vendor/mathjax/fonts/woff/mjx-stx-ss.woff',
  'vendor/mathjax/fonts/woff/mjx-stx-ssb.woff',
  'vendor/mathjax/fonts/woff/mjx-stx-ssbi.woff',
  'vendor/mathjax/fonts/woff/mjx-stx-ssi.woff',
  'vendor/mathjax/fonts/woff/mjx-stx-sy.woff',
  'vendor/mathjax/fonts/woff/mjx-stx-syb.woff',
  'vendor/mathjax/fonts/woff/mjx-stx-sybi.woff',
  'vendor/mathjax/fonts/woff/mjx-stx-syi.woff',
  'vendor/mathjax/fonts/woff/mjx-stx-u.woff',
  'vendor/mathjax/fonts/woff/mjx-stx-ud.woff',
  'vendor/mathjax/fonts/woff/mjx-stx-v.woff',
  'vendor/mathjax/fonts/woff/mjx-stx-vx.woff',
  'vendor/mathjax/fonts/woff/mjx-stx-zero.woff',
];

// Every image any quiz problem actually embeds (<img src="...">), read
// straight off the already-loaded QUIZZES data instead of a hand-typed
// list — a new quiz image just works the next time someone downloads for
// offline, with nothing here that can drift out of sync with it.
function discoverCourseImageUrls() {
  const urls = new Set();
  if (typeof QUIZZES !== 'undefined') {
    QUIZZES.forEach((q) => {
      (q.problems || []).forEach((p) => {
        const text = p && p.text;
        if (typeof text !== 'string') return;
        const re = /<img[^>]+src=["']([^"']+)["']/gi;
        let m;
        while ((m = re.exec(text))) urls.add(m[1]);
      });
    });
  }
  return Array.from(urls);
}

function buildOfflineManifest() {
  return Array.from(new Set([
    ...OFFLINE_CORE_FILES,
    ...OFFLINE_MATHJAX_FILES,
    ...discoverCourseImageUrls(),
  ]));
}

// Runs `worker` over `items` with at most `limit` in flight at once —
// plain sequential fetch()-then-await would mean a slow connection pays
// every file's round-trip one at a time; this keeps a handful of requests
// going in parallel (browsers already do this for real navigation anyway)
// without needing a full task-queue library for what's a one-off download.
async function runWithConcurrency(items, limit, worker) {
  let next = 0;
  async function lane() {
    while (next < items.length) {
      const i = next++;
      await worker(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, lane));
}

// ── Download / activation state ──
// status: 'idle' | 'downloading' | 'done' | 'error'
// Single module-level object so renderSettingsOfflineTab() (js/settings.js)
// always has one place to read "what's happening right now" from,
// regardless of whether this tab was the one open when a download started.
let offlineDownloadState = { status: 'idle', done: 0, total: 0, failed: [] };

function getOfflineModeUntil() {
  const v = getSetting('offline', 'until');
  return typeof v === 'number' ? v : null;
}

function isOfflineModeActive() {
  const until = getOfflineModeUntil();
  return !!until && Date.now() < until;
}

// Re-renders the Offline tab if (and only if) it's the one currently open
// — same guard renderSettingsBody() itself already needs, just called from
// outside a settings.js onchange this time.
function _refreshOfflineTabIfOpen() {
  if (typeof settingsActiveTab !== 'undefined' && settingsActiveTab === 'offline' && typeof renderSettingsBody === 'function') {
    renderSettingsBody();
  }
}

// Called at load and every 5 min (same cadence as the Go-silent 24h check
// in js/settings.js) so a tab left open past the 24h mark notices on its
// own, without needing a reload — and once right when the Offline tab is
// opened, so a stale "active" state never flashes before it self-corrects.
function checkOfflineModeExpiry() {
  const until = getOfflineModeUntil();
  if (until && Date.now() >= until) endOfflineMode();
}
setInterval(checkOfflineModeExpiry, 5 * 60 * 1000);

// Turns full offline mode off — either the 24h window lapsing on its own
// or the user tapping "Go back online now". Clears the shared timestamp
// both settings.js and sw.js read, and drops the downloaded cache so a
// later Go-offline run starts clean rather than serving whatever's left
// over from a previous, possibly-stale download.
function endOfflineMode() {
  setSetting('offline', 'until', null);
  writeOfflineModeUntilFlag(null);
  if (typeof caches !== 'undefined') caches.delete(OFFLINE_MODE_CACHE_NAME).catch(() => {});
  offlineDownloadState = { status: 'idle', done: 0, total: 0, failed: [] };
  _refreshOfflineTabIfOpen();
  // This never touches navigator.onLine — the real connection didn't
  // change, only the app's own artificial block did — so the 'online'
  // event (js/attempts-sync.js) never fires here on its own. Without this,
  // every live-sync surface just sits waiting on its own fallback poll.
  if (typeof reconnectAllLiveSync === 'function') reconnectAllLiveSync();
}

// The actual "Go offline" download — called once handleGoOfflineClick()'s
// tap-again confirm fires. Only activates the 24h window if every single
// file succeeds; a partial download would silently leave some quiz image
// or vendor file missing for the entire 24h no-network window with no way
// to fetch it mid-way through, so a failure here means try again rather
// than "close enough".
async function startGoOffline() {
  if (typeof caches === 'undefined') {
    offlineDownloadState = { status: 'error', done: 0, total: 0, failed: ['(this browser has no offline storage support)'] };
    _refreshOfflineTabIfOpen();
    return;
  }

  // Push any pending quiz-attempt/Solve-All progress before the 24h block
  // starts — best-effort: a failure here just means the same unsynced data
  // sits queued locally like normal, same as it would without offline mode.
  if (typeof syncAttempts === 'function') syncAttempts();
  if (typeof _saSyncActive !== 'undefined' && _saSyncActive && typeof _saSyncRoundTrip === 'function') {
    _saSyncRoundTrip(_saSyncActive.quizNum, _saSyncActive.cumulative, false);
  }

  const manifest = buildOfflineManifest();
  offlineDownloadState = { status: 'downloading', done: 0, total: manifest.length, failed: [] };
  _refreshOfflineTabIfOpen();

  const cache = await caches.open(OFFLINE_MODE_CACHE_NAME);
  await runWithConcurrency(manifest, 6, async (url) => {
    try {
      // cache: 'reload' bypasses the browser's own HTTP cache — a real
      // network fetch, not whatever's already sitting in memory/disk cache
      // from normal browsing, since the whole point is a guaranteed-fresh
      // copy to run offline from for the next 24h.
      const res = await fetch(url, { cache: 'reload' });
      if (res && res.ok) {
        await cache.put(url, res.clone());
      } else {
        offlineDownloadState.failed.push(url);
      }
    } catch (e) {
      offlineDownloadState.failed.push(url);
    }
    offlineDownloadState.done++;
    _refreshOfflineTabIfOpen();
  });

  if (offlineDownloadState.failed.length === 0) {
    const until = Date.now() + 24 * 60 * 60 * 1000;
    setSetting('offline', 'until', until);
    writeOfflineModeUntilFlag(until);
    offlineDownloadState = { status: 'done', done: manifest.length, total: manifest.length, failed: [] };
  } else {
    offlineDownloadState.status = 'error';
    // Don't leave a half-complete cache lying around to be mistaken for a
    // usable one later — endOfflineMode() would delete it anyway on the
    // next successful run, but there's no reason to hold onto broken data
    // in the meantime.
    caches.delete(OFFLINE_MODE_CACHE_NAME).catch(() => {});
  }
  _refreshOfflineTabIfOpen();
}

// ── Tap-again-to-confirm "Go offline" button ──
// Same idiom as js/settings.js's _armSettingsResetConfirm/
// _disarmSettingsResetConfirm for "Reset all settings": a first tap arms a
// countdown ring traced on the button's own border, a second tap within
// the window actually does the (consequential, one-way-for-24h) thing.
const GO_OFFLINE_CONFIRM_MS = 4000;
let _goOfflineConfirmArmed = false;
let _goOfflineConfirmTimer = null;

function handleGoOfflineClick() {
  const btn = document.getElementById('goOfflineBtn');
  if (!btn) return;
  if (_goOfflineConfirmArmed) {
    _disarmGoOfflineConfirm(btn);
    startGoOffline();
    return;
  }
  _armGoOfflineConfirm(btn);
}

function _armGoOfflineConfirm(btn) {
  _goOfflineConfirmArmed = true;
  btn.classList.add('confirming');
  btn.title = 'Tap again to start downloading and go offline';
  const label = btn.querySelector('.settings-offline-btn-label');
  if (label) label.textContent = 'Tap again to confirm';

  // Same live-measured ring sizing as _armSettingsResetConfirm (js/settings.js)
  // — traces the button's own current border box rather than a hardcoded
  // size, so it still lines up correctly if this button's own CSS ever changes.
  const ring = btn.querySelector('.settings-offline-confirm-ring');
  const rect = ring && ring.querySelector('rect');
  if (ring && rect) {
    const w = btn.offsetWidth, h = btn.offsetHeight;
    const strokeW = 1.5;
    const inset = strokeW / 2;
    const radius = parseFloat(getComputedStyle(btn).borderTopLeftRadius) || 0;
    ring.setAttribute('viewBox', `0 0 ${w} ${h}`);
    rect.setAttribute('x', inset);
    rect.setAttribute('y', inset);
    rect.setAttribute('width', Math.max(0, w - inset * 2));
    rect.setAttribute('height', Math.max(0, h - inset * 2));
    rect.setAttribute('rx', Math.max(0, radius - inset));
    const len = rect.getTotalLength();
    rect.style.transition = 'none';
    rect.style.strokeDasharray = len;
    rect.style.strokeDashoffset = 0;
    void rect.getBoundingClientRect(); // force reflow before transitioning
    rect.style.transition = `stroke-dashoffset ${GO_OFFLINE_CONFIRM_MS}ms linear`;
    requestAnimationFrame(() => { rect.style.strokeDashoffset = len; });
  }

  clearTimeout(_goOfflineConfirmTimer);
  _goOfflineConfirmTimer = setTimeout(() => _disarmGoOfflineConfirm(btn), GO_OFFLINE_CONFIRM_MS);
}

function _disarmGoOfflineConfirm(btn) {
  _goOfflineConfirmArmed = false;
  clearTimeout(_goOfflineConfirmTimer);
  _goOfflineConfirmTimer = null;
  btn.classList.remove('confirming');
  btn.title = 'Download everything needed and go offline for 24 hours';
  const label = btn.querySelector('.settings-offline-btn-label');
  if (label) label.textContent = '\u{1F4E5} Go offline';
}

// ── Cache & storage actions ──
// Three device-local escape hatches, rendered as ordinary settings rows
// (renderCacheStorageSection below) with a small circular danger button
// on the right in place of the usual switch — nuke the quiz-progress
// cache, nuke the LaTeX render cache, or force a fresh service worker.
// Each is a one-way, mildly disruptive action, so each gets its own
// tap-to-confirm — but unlike _armGoOfflineConfirm/
// _armSettingsResetConfirm above (module-level armed flag/timer, fine
// when there's only one such button on a screen), all three of these
// live on the same tab at once, so the armed/timer state is kept on the
// button element itself. That way arming one can never silently disarm
// or desync another.
//
// Arming swaps the icon for the literal word "Confirm" (the button grows
// into a small pill to fit it — see .settings-danger-btn.confirming in
// css/settings.css) rather than an icon-only countdown ring: a circle
// filling in is easy to miss or misread on a first tap, where "what does
// tapping this again actually do" needs to be unambiguous.
const DANGER_CONFIRM_MS = 3500;

function handleDangerBtnClick(btnId, onConfirm) {
  const btn = document.getElementById(btnId);
  if (!btn) return;
  if (btn._confirmArmed) {
    _disarmDangerConfirm(btn);
    onConfirm();
    return;
  }
  _armDangerConfirm(btn);
}

function _armDangerConfirm(btn) {
  btn._confirmArmed = true;
  btn.classList.add('confirming');
  btn.dataset.idleTitle = btn.title;
  btn.title = 'Tap again to confirm';

  clearTimeout(btn._confirmTimer);
  btn._confirmTimer = setTimeout(() => _disarmDangerConfirm(btn), DANGER_CONFIRM_MS);
}

function _disarmDangerConfirm(btn) {
  btn._confirmArmed = false;
  clearTimeout(btn._confirmTimer);
  btn._confirmTimer = null;
  btn.classList.remove('confirming');
  btn.title = btn.dataset.idleTitle || '';
}

// A) Reset all cache — wipes the local Random-6 attempt history
// (clearLocalAttemptsCache, js/stats.js) and every locally-stored
// Solve-All progress snapshot (clearLocalSolveAllProgress,
// js/quiz-engine.js). Both are already exactly this: a local *cache* of
// state a claimed forum identity syncs from the server (see stats.js's
// own file header) — so if this device is signed in, the next sync just
// pulls that data straight back down, same as it would for a brand new
// device. A reload afterward is deliberate, same reasoning as
// doResetAllSettings() in js/settings.js: several in-memory arrays
// (solveAllChecked, the stats screen's own cached render, etc.) have no
// single in-place path that reliably re-syncs with an emptied store.
function performResetAllCache() {
  if (typeof clearLocalAttemptsCache === 'function') clearLocalAttemptsCache();
  if (typeof clearLocalSolveAllProgress === 'function') clearLocalSolveAllProgress();
  location.reload();
}

// B) Reset all prerendered LaTeX equations — full wipe of the persistent
// MathJax render cache (clearAllMathCache, js/math-cache.js), every quiz,
// not just whichever set happens to be on screen (that lighter version is
// the manual's own "🔁 Rerender Equations" button — js/quiz-engine.js's
// rerenderSolveAllEquations). No reload needed: the cache is simply empty
// afterward, and the next Solve-All open re-typesets and re-caches fresh.
function performResetMathCache() {
  const btn = document.getElementById('resetMathCacheBtn');
  Promise.resolve(typeof clearAllMathCache === 'function' ? clearAllMathCache() : null)
    .then(() => { if (btn) btn.title = btn.dataset.idleTitle = 'Cleared \u2014 equations will re-render next time you open Solve-All'; })
    .catch(() => { if (btn) btn.title = btn.dataset.idleTitle = 'Clear failed \u2014 try again'; });
}

// C) Reinstall service worker — unregisters every SW registration for this
// scope, clears every Cache Storage bucket EXCEPT OFFLINE_MODE_CACHE_NAME
// (an active 24h Go-Offline download is a device's actual downloaded
// study material, not stale worker debris — a reinstall shouldn't cost
// someone their offline window), re-registers sw.js fresh, then reloads
// so the new worker takes control immediately rather than only from the
// next navigation.
async function performReinstallServiceWorker() {
  const btn = document.getElementById('reinstallSwBtn');
  try {
    if ('serviceWorker' in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map(r => r.unregister()));
    }
    if (typeof caches !== 'undefined') {
      const keys = await caches.keys();
      await Promise.all(keys.filter(k => k !== OFFLINE_MODE_CACHE_NAME).map(k => caches.delete(k)));
    }
    if ('serviceWorker' in navigator) {
      await navigator.serviceWorker.register('sw.js');
    }
  } catch (e) {
    console.error('Service worker reinstall error:', e);
  }
  location.reload();
}

// Rendered as ordinary .settings-row entries (same shape as the Display
// tab's toggle rows — renderSettingsDisplayTab above) instead of big
// standalone buttons: label+description on the left, a small circular
// danger button on the right where a toggle switch would normally sit.
// title carries the literal $\mathrm{La\TeX}$ markup for MathJax to pick
// up (see renderSettingsBody's renderMathIn call in js/settings.js);
// ariaLabel is the same copy in plain text, since a screen reader has no
// use for the raw LaTeX source.
const CACHE_STORAGE_ROWS = [
  {
    id: 'resetCacheBtn',
    icon: '\u21BB',
    title: 'Reset all cache',
    desc: 'Clears local attempt history and Solve-All progress on this device. Nothing is deleted from the server \u2014 if you\u2019re signed in, the next sync pulls it straight back down.',
    ariaLabel: 'Reset all cache',
    handler: 'performResetAllCache',
  },
  {
    id: 'resetMathCacheBtn',
    icon: '\u21BB',
    title: 'Reset prerendered $\\mathrm{La\\TeX}$ equations',
    desc: 'Clears every cached prerendered equation on this device. They re-render (and re-cache) the next time you open Solve-All.',
    ariaLabel: 'Reset prerendered LaTeX equations',
    handler: 'performResetMathCache',
  },
  {
    id: 'reinstallSwBtn',
    icon: '\u21BB',
    title: 'Reinstall service worker',
    desc: 'Unregisters and re-registers the app\u2019s service worker, then reloads. Won\u2019t interrupt an active offline-mode download.',
    ariaLabel: 'Reinstall service worker',
    handler: 'performReinstallServiceWorker',
  },
];

function renderCacheStorageSection() {
  const rows = CACHE_STORAGE_ROWS.map(r => `
    <div class="settings-row settings-row-danger">
      <div class="settings-row-label">
        <div class="settings-row-title">${r.title}</div>
        <div class="settings-row-desc">${r.desc}</div>
      </div>
      <button type="button" class="settings-danger-btn" id="${r.id}" aria-label="${r.ariaLabel}"
              title="Tap, then tap again to confirm" onclick="handleDangerBtnClick('${r.id}', ${r.handler})">
        <span class="settings-danger-confirm-label">Confirm?</span>
        <span class="settings-danger-icon">${r.icon}</span>
      </button>
    </div>
  `).join('');
  return `
    <div class="settings-cache-section">
      <div class="settings-offline-heading">Cache &amp; storage</div>
      <div class="settings-group">${rows}</div>
    </div>
  `;
}

// ── Rendering (called from renderSettingsBody() in js/settings.js) ──
function renderSettingsOfflineTab() {
  checkOfflineModeExpiry(); // catch an already-lapsed window the instant this tab opens, not just on the next 5-min tick
  const state = offlineDownloadState;
  const cacheSection = renderCacheStorageSection();

  if (state.status === 'downloading') {
    const pct = state.total ? Math.round((state.done / state.total) * 100) : 0;
    return `
      <div class="settings-offline-panel">
        <div class="settings-offline-heading">\u{1F4E5} Downloading\u2026</div>
        <div class="settings-offline-desc">Fetching everything needed to study with zero connection. Don\u2019t close the app until this finishes.</div>
        <div class="settings-offline-progress-track"><div class="settings-offline-progress-fill" style="width:${pct}%"></div></div>
        <div class="settings-offline-progress-label">${state.done} / ${state.total} files (${pct}%)</div>
      </div>
    ` + cacheSection;
  }

  if (state.status === 'error') {
    return `
      <div class="settings-offline-panel">
        <div class="settings-offline-heading">\u26A0\uFE0F Download didn\u2019t finish</div>
        <div class="settings-offline-desc">${state.failed.length} of ${state.total} files couldn\u2019t be fetched: check your connection and try again. Offline mode wasn\u2019t turned on, and nothing was blocked.</div>
        <button type="button" class="settings-offline-btn" onclick="startGoOffline()">
          <span class="settings-offline-btn-label">\u21BB Try again</span>
        </button>
      </div>
    ` + cacheSection;
  }

  if (isOfflineModeActive()) {
    const msLeft = getOfflineModeUntil() - Date.now();
    const h = Math.floor(msLeft / 3600000);
    const m = Math.floor((msLeft % 3600000) / 60000);
    return `
      <div class="settings-offline-panel">
        <div class="settings-offline-heading">\u2705 Offline mode is active</div>
        <div class="settings-offline-desc">Every request to the server is blocked \u2014 including from other open tabs, and even if you\u2019re actually back online \u2014 and the app runs entirely off what was downloaded. Expires automatically in ${h}h ${m}m, or end it early below.</div>
        <button type="button" class="settings-offline-btn settings-offline-btn-secondary" onclick="endOfflineMode()">
          <span class="settings-offline-btn-label">Go back online now</span>
        </button>
      </div>
    ` + cacheSection;
  }

  return `
    <div class="settings-offline-panel">
      <div class="settings-offline-heading">Go offline</div>
      <div class="settings-offline-desc">Downloads every quiz, image, and app file needed to study with zero connection, then blocks all server requests for the next 24 hours, even if you\u2019re back online before then. Tap once, then tap again to confirm; the download starts right away. Helpful for in-travel study.</div>
      <button type="button" class="settings-offline-btn" id="goOfflineBtn" onclick="handleGoOfflineClick()" title="Download everything needed and go offline for 24 hours">
        <svg class="settings-offline-confirm-ring" viewBox="0 0 100 32" preserveAspectRatio="none"><rect x="1.5" y="1.5" rx="7"></rect></svg>
        <span class="settings-offline-btn-label">\u{1F4E5} Go offline</span>
      </button>
    </div>
  ` + cacheSection;
}
