// This service worker does two independent jobs, layered on top of each
// other rather than fighting for the same fetch events:
//
//   1. (Original, always on) Shows offline.html when a page reload happens
//      with no internet — a lightweight "you're offline" fallback, not a
//      full offline-first app shell. See PRECACHE_URLS/CACHE_NAME below.
//
//   2. (Phase 4, js/offline-mode.js) Settings > Offline & Sync's "Go
//      offline" button downloads the FULL app — course data, quiz images,
//      every JS/CSS file — into its own cache (OFFLINE_MODE_CACHE_NAME,
//      completely separate from CACHE_NAME below so a version bump on
//      either one never deletes the other's files — see 'activate') and
//      sets a 24h expiry. While that window is running, every fetch —
//      same-origin or not, network reachable or not — gets routed through
//      respondFullOffline() first: cross-origin requests (Supabase, GitHub,
//      the jsdelivr CDN, etc.) are refused outright, same-origin requests
//      are served from that cache. Job 1's logic (below, in
//      respondDefault()) only ever runs once job 2 has confirmed it has
//      nothing to say about a given request — normal online behavior is
//      completely unaffected outside the 24h window.
//
// The MathJax vendor bundle is precached too because offline.html renders
// LaTeX (its "meanwhile, look at..." panel) using the site's own local
// MathJax copy rather than a CDN — CDNs aren't reachable offline, but a
// same-origin file that was cached during a previous online visit is.
//
// Bump this on any change to the precached list below, or browsers may keep
// serving a stale cached copy of offline.html/its assets.
//
// NOT wired to js/course-config.js's STORAGE_PREFIX: a service worker has
// no `document`, so it can't read the data-course attribute the way every
// other file here does. This is a manual swap item at release time —
// change the 'phys162' prefix by hand alongside the data-course attribute.
const CACHE_NAME = 'phys161-offline-v7';

// ── Phase 4: full offline mode (js/offline-mode.js) ──
// OFFLINE_MODE_CACHE_NAME must match that file's own copy of the same
// constant exactly — it's the cache startGoOffline() fills and this file
// reads from. OFFLINE_MODE_DB_NAME/STORE must match its
// writeOfflineModeUntilFlag()'s copy the same way: IndexedDB is the one
// storage a service worker and a page both have access to (no
// localStorage here), same reasoning as the existing Go-silent mute flag
// below.
const OFFLINE_MODE_CACHE_NAME = 'flux-offline-mode-v1';
const OFFLINE_MODE_DB_NAME = 'flux-offline-mode';
const OFFLINE_MODE_STORE = 'flags';

function readOfflineModeUntil() {
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open(OFFLINE_MODE_DB_NAME, 1);
      req.onupgradeneeded = () => { req.result.createObjectStore(OFFLINE_MODE_STORE); };
      req.onsuccess = () => {
        const db = req.result;
        try {
          const tx = db.transaction(OFFLINE_MODE_STORE, 'readonly');
          const getReq = tx.objectStore(OFFLINE_MODE_STORE).get('until');
          getReq.onsuccess = () => { resolve(getReq.result || null); db.close(); };
          getReq.onerror = () => { resolve(null); db.close(); };
        } catch (e) { resolve(null); db.close(); }
      };
      req.onerror = () => resolve(null);
    } catch (e) { resolve(null); }
  });
}

// Handles one fetch while the 24h full-offline window is active. Returns a
// Response if it has one, or null to fall through to respondDefault()
// below — the only expected null case is a same-origin request for
// something Go offline's manifest didn't happen to include (e.g. a URL
// added to a quiz after the last download), which is safe to just let
// through normally since it never leaves the same origin.
async function respondFullOffline(event) {
  const request = event.request;
  const url = new URL(request.url);

  // Cross-origin — the Supabase backend, GitHub API (manual.js's version
  // check), the Dicebear avatar service, the jsdelivr Supabase client
  // bundle, push subscription calls, etc. This is the actual "block DB +
  // host requests" half of the 24h window: refused outright, not just
  // left unfetched, so a real connection coming back mid-window changes
  // nothing.
  //
  // Google Fonts is the one exception: it's a read-only static asset (the
  // splash text's 'Bangers' font, plus the rest of index.html's <link>
  // fonts) with no bearing on "block DB + host requests" at all, and Go
  // offline's manifest never downloads it (Google serves different actual
  // font files per User-Agent from one dynamic CSS URL, so it can't be
  // predownloaded the same static way as everything else in
  // OFFLINE_CORE_FILES). Blocking it just meant the splash text silently
  // fell back to a plain sans-serif font for no real benefit. Falls
  // through to the browser's own HTTP cache below (fonts are typically
  // cached long-lived already from any earlier visit) instead of being
  // refused outright.
  if (url.origin !== self.location.origin
      && url.hostname !== 'fonts.googleapis.com'
      && url.hostname !== 'fonts.gstatic.com') {
    return new Response(null, { status: 503, statusText: 'Offline mode active' });
  }

  if (request.mode === 'navigate') {
    // Serve the actual app shell, not just offline.html's minimal fallback
    // — job 1 only ever shows offline.html on a failed *network* request,
    // but here there's no attempt at the network at all.
    const shell = await caches.match('index.html', { cacheName: OFFLINE_MODE_CACHE_NAME });
    if (shell) return shell;
    return null; // shouldn't happen: startGoOffline() never activates the window unless every file, including index.html, was cached successfully
  }

  // ignoreSearch: true — index.html requests site.webmanifest with a
  // ?v=1.0.3 cache-busting query string, but it's cached here under its
  // plain path (OFFLINE_CORE_FILES has no query strings at all), so an
  // exact-URL match would always miss and fall through to a network
  // request that fails outright when there's no real connection.
  const cached = await caches.match(request, { cacheName: OFFLINE_MODE_CACHE_NAME, ignoreSearch: true });
  return cached || null;
}
const OFFLINE_URL = 'offline.html';
const PRECACHE_URLS = [
  OFFLINE_URL,
  'images/offline/light.png',
  'images/offline/dark.png',
  'favicon/favicon.svg',
  'course/offline-laws.json',
  // Theme colors/logic are referenced by offline.html, not duplicated —
  // see its own comments. These three need to be cached for that to still
  // work with zero connection.
  'css/style.css',
  'js/course-config.js',
  'js/banner-manager.js',
  'js/themes.js',
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

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => Promise.all(
        PRECACHE_URLS.map((url) =>
          cache.add(url).catch((err) => console.warn('[sw] precache failed:', url, err))
        )
      ))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((names) => Promise.all(
        // Never touch OFFLINE_MODE_CACHE_NAME here — it's versioned and
        // managed entirely by js/offline-mode.js's own startGoOffline()/
        // endOfflineMode(), on a completely different lifecycle than this
        // worker's own install/activate. Deleting it on every activate (as
        // a naive "clean up anything not CACHE_NAME" pass would) would
        // wipe out everything Go offline downloaded the next time this
        // file's own CACHE_NAME gets bumped for an unrelated reason.
        names.filter((n) => n !== CACHE_NAME && n !== OFFLINE_MODE_CACHE_NAME).map((n) => caches.delete(n))
      ))
      .then(() => self.clients.claim())
  );
});

// -- Update-triggered precache purge -------------------------------------
// respondDefault()'s isPrecached branch below is cache-first with a
// background revalidate -- great for speed, but it structurally means a
// changed file (style.css, course-config.js, banner-manager.js, themes.js,
// the MathJax bundle) never shows up on the SAME reload that fetches it:
// reload #1 serves the stale cached copy instantly while quietly re-fetching
// in the background, and only reload #2 actually serves what just landed in
// the cache. quiz-engine.js's checkForUpdate() already knows the instant a
// real content update exists (version.json vs CURRENT_VERSION) -- when it
// does, it messages this listener to wipe CACHE_NAME before the page
// reloads, so that one reload's fetches all miss cache and go straight to
// the network, repopulating it fresh. Everyday browsing (no version
// mismatch) never sends this message, so the normal cache-first path above
// is completely unaffected.
self.addEventListener('message', (event) => {
  if (!event.data || event.data.type !== 'purge-update-cache') return;
  event.waitUntil(
    caches.delete(CACHE_NAME).then(() => {
      if (event.ports && event.ports[0]) event.ports[0].postMessage({ ok: true });
    })
  );
});

self.addEventListener('fetch', (event) => {
  event.respondWith(routeFetch(event));
});

async function routeFetch(event) {
  const until = await readOfflineModeUntil();
  if (until && Date.now() < until) {
    const handled = await respondFullOffline(event);
    if (handled) return handled;
    // null: same-origin request Go offline's manifest didn't cover — fall
    // through to the normal job-1 handling below, same as if full offline
    // mode weren't running at all.
  }
  return respondDefault(event);
}

// Everything below is job 1, completely unchanged from before Phase 4 —
// only ever reached once routeFetch() above has confirmed full offline
// mode either isn't active or has nothing cached for this particular
// request.
function respondDefault(event) {
  const url = new URL(event.request.url);
  const isPrecached = PRECACHE_URLS.some((p) => url.pathname.endsWith('/' + p) || url.pathname === '/' + p);

  // Network-first for page navigations: try the real page, and only fall
  // back to the cached offline.html if the network request actually fails.
  //
  // For every other request that matches something we precached (dark/light
  // theme images, style.css, themes.js, offline-laws.json, the MathJax
  // vendor bundle + its fonts): cache-first, revalidating in the background.
  // Serve the cached copy immediately if there is one — no network round
  // trip in the way at all — then still kick off a real fetch to refresh the
  // cache for next time. Previously this was network-first-with-cache-
  // fallback, which meant every one of these requests waited for the
  // network call to actually finish failing before falling back — with no
  // connection, that's not instant, it's however long Chrome takes to give
  // up on the request (5-10s in practice), which is why the theme images and
  // MathJax's fonts visibly stalled instead of appearing immediately. Since
  // PRECACHE_URLS is already versioned by CACHE_NAME (bumped on any change
  // per the comment above), cache-first can't serve something stale forever
  // — a version bump always repopulates it on the next install.
  if (event.request.mode === 'navigate') {
    return fetch(event.request).catch(() => caches.match(OFFLINE_URL));
  }

  if (isPrecached) {
    return caches.match(event.request).then((cached) => {
      const revalidate = fetch(event.request).then((response) => {
        if (response && response.ok) {
          // Clone synchronously, right here, before any async work — if
          // this were deferred until inside caches.open().then(...), the
          // response returned below could already be locked/streaming to
          // the page by the time clone() runs, throwing "Response body
          // is already used".
          const responseToCache = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, responseToCache));
        }
        return response;
      }).catch(() => cached);
      // Cache hit: return it now, let the network call finish in the
      // background purely to refresh the cache. Cache miss (e.g. this
      // one entry failed during precache — see the .catch on cache.add
      // in 'install' above): fall through to that same network call,
      // which still falls back to whatever's cached if it fails.
      return cached || revalidate;
    });
  }

  // Not a navigation, not precached — same as never having called
  // event.respondWith() at all (job 1's original behavior): just do the
  // normal network fetch.
  return fetch(event.request);
}

// ── Push notifications (forum @mentions) ──
// This is the part that makes notifications work even with the site fully
// closed: 'push' is a service-worker-only event, dispatched by the browser
// itself whenever it wakes this worker up for an incoming push message —
// there's no open tab or page context involved at all, just this file
// running in its own background thread. The actual send happens server-side
// (post-message.ts's sendMentionPushNotifications, via the Web Push
// protocol + VAPID), this is only the "show something when it arrives" half.

// Settings > Notifications > "Go silent" (js/settings.js) mirrors its
// effective state into this same IndexedDB database/store/key — this is
// the read side. Can't just check localStorage: a service worker has no
// access to it at all, and this event in particular is the one case where
// there might not even be a page open to read it from anyway. Name/store/
// key must stay in sync with js/settings.js's NOTIF_MUTE_DB_NAME/
// NOTIF_MUTE_STORE. Resolves false (not muted) on any failure — an
// unreadable flag should never be the reason a real mention silently never
// shows up.
function readNotifMuteFlag() {
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open('flux-notif-mute', 1);
      req.onupgradeneeded = () => { req.result.createObjectStore('flags'); };
      req.onsuccess = () => {
        const db = req.result;
        try {
          const tx = db.transaction('flags', 'readonly');
          const getReq = tx.objectStore('flags').get('muted');
          getReq.onsuccess = () => { resolve(!!getReq.result); db.close(); };
          getReq.onerror = () => { resolve(false); db.close(); };
        } catch (e) { resolve(false); db.close(); }
      };
      req.onerror = () => resolve(false);
    } catch (e) { resolve(false); }
  });
}

self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (e) { /* malformed payload — show a generic notification below */ }

  const title = data.title || 'New forum mention';
  const options = {
    body: data.body || '',
    // data.icon is the mentioner's own DiceBear identicon URL, set
    // server-side in post-message.ts's sendMentionPushNotifications — falls
    // back to the generic app icon for a malformed/older payload that never
    // had one.
    icon: data.icon || 'favicon/web-app-manifest-192x192.png',
    badge: 'favicon/favicon-96x96.png',
    // Same tag for every mention in the same thread collapses them into one
    // notification instead of stacking a pile of separate OS notifications
    // for a fast-moving conversation; a bare mention (no problem_key) still
    // gets its own shared "forum-global" bucket.
    tag: data.problem_key ? `forum-${data.problem_key}` : 'forum-global',
    data,
  };
  event.waitUntil(
    readNotifMuteFlag().then((muted) => {
      if (muted) return; // Go silent is on — skip showing anything
      return self.registration.showNotification(title, options);
    })
  );
});

// Tapping the notification. Two cases: a tab is already open (focus it and
// hand the click details over via postMessage — see the matching listener
// in js/push-notifications.js, which opens the right thread without a full
// reload) or nothing is open (openWindow with the same details folded into
// a query string, read back out on that fresh page's own load).
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const data = event.notification.data || {};

  const params = new URLSearchParams();
  params.set('openForum', '1');
  if (data.scope) params.set('scope', data.scope);
  if (data.problem_key) params.set('problem_key', data.problem_key);
  const targetUrl = new URL('./?' + params.toString(), self.registration.scope).href;

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      for (const client of windowClients) {
        if ('focus' in client) {
          client.postMessage({ type: 'forum-mention-click', ...data });
          return client.focus();
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(targetUrl);
    })
  );
});
