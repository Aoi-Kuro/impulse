// ── Site visit tracking ───────────────────────────────────────────────────
// Fires once per page load, for every visitor — not just people who open
// the forum — feeding "Total visits" and "Total unique participants" on the
// stats panel (see loadStatsPanel in js/stats.js and
// edge-functions/record-visit.ts). Deliberately its own tiny file rather
// than folded into forum.js: it has to run on every page load unconditionally,
// while forum.js's own device-id logic only ever runs once someone actually
// opens the forum.
//
// SITE_DEVICE_ID_KEY is deliberately the exact same localStorage key forum.js
// uses for FORUM_DEVICE_ID_KEY (STORAGE_PREFIX + '_forum_device_id') — not a second,
// unrelated id. Reusing it is what lets get_stats_panel.sql's identity-link
// join actually match a visitor's device to a forum registration made from
// that same browser. Whichever of this file or forum.js runs first creates
// it; the other just reads the same value back.
const SITE_DEVICE_ID_KEY = STORAGE_PREFIX + '_forum_device_id';

function getSiteDeviceId() {
  let id = localStorage.getItem(SITE_DEVICE_ID_KEY);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(SITE_DEVICE_ID_KEY, id);
  }
  return id;
}

function recordSiteVisit() {
  if (typeof SUPABASE_URL === 'undefined' || typeof SUPABASE_PUBLISHABLE_KEY === 'undefined') return;
  // Fire-and-forget: a page load should never wait on, or fail because of,
  // this. Any error is swallowed — it's a stats side-effect, not something
  // the person is doing.
  fetch(`${SUPABASE_URL}/functions/v1/record-visit`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': SUPABASE_PUBLISHABLE_KEY,
      'Authorization': `Bearer ${SUPABASE_PUBLISHABLE_KEY}`,
    },
    body: JSON.stringify({ device_id: getSiteDeviceId() }),
  }).catch(() => {});
}

recordSiteVisit();
