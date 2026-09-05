// Minimal service worker — its ONLY job is showing offline.html when a page
// reload happens with no internet. It does not cache or serve the rest of
// the site (quiz pages, forum, etc.) for offline use — this is just the
// "you're offline" fallback, not a full offline-first app shell.
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
const CACHE_NAME = 'phys161-offline-v5';
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
        names.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n))
      ))
      .then(() => self.clients.claim())
  );
});

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
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  const isPrecached = PRECACHE_URLS.some((p) => url.pathname.endsWith('/' + p) || url.pathname === '/' + p);

  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request).catch(() => caches.match(OFFLINE_URL))
    );
    return;
  }

  if (isPrecached) {
    event.respondWith(
      caches.match(event.request).then((cached) => {
        const revalidate = fetch(event.request).then((response) => {
          if (response && response.ok) {
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, response.clone()));
          }
          return response;
        }).catch(() => cached);
        // Cache hit: return it now, let the network call finish in the
        // background purely to refresh the cache. Cache miss (e.g. this
        // one entry failed during precache — see the .catch on cache.add
        // in 'install' above): fall through to that same network call,
        // which still falls back to whatever's cached if it fails.
        return cached || revalidate;
      })
    );
  }
});

// ── Push notifications (forum @mentions) ──
// This is the part that makes notifications work even with the site fully
// closed: 'push' is a service-worker-only event, dispatched by the browser
// itself whenever it wakes this worker up for an incoming push message —
// there's no open tab or page context involved at all, just this file
// running in its own background thread. The actual send happens server-side
// (post-message.ts's sendMentionPushNotifications, via the Web Push
// protocol + VAPID), this is only the "show something when it arrives" half.
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
  event.waitUntil(self.registration.showNotification(title, options));
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
