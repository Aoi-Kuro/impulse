// Edge Function: record-visit
//
// Deploy this as a NEW Supabase Edge Function named "record-visit"
// (dashboard → Edge Functions → New Function). Auth mode: "publishable",
// same as post-message/claim-nickname — the browser calls it with the
// publishable key, no login involved. Make sure "Verify JWT with legacy
// secret" is OFF for this function too (same dashboard quirk noted for
// post-message).
//
// Called once per page load from js/site-visits.js — see that file for why
// this fires unconditionally on every page, not just when the forum is
// opened. Two independent effects, both best-effort:
//
//   1. Always insert one row into site_visits (sql/site_visits.sql) — the
//      raw "every visit" counter, no dedup.
//   2. If a valid device_id was sent, upsert it into site_device_sightings
//      (sql/site_device_sightings.sql) — the raw "unique devices ever
//      seen" set that get_stats_panel.sql later collapses by registered
//      identity.
//
// No moderation, no secrets beyond what Supabase auto-injects — this never
// touches user-authored content, just counters.
import { withSupabase } from 'npm:@supabase/server@^1';

function isUuid(v: unknown): v is string {
  return typeof v === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
}

export default {
  fetch: withSupabase({ auth: 'publishable' }, async (req, ctx) => {
    if (req.method !== 'POST') {
      return Response.json({ ok: false, error: 'method_not_allowed' }, { status: 405 });
    }

    let payload: any = {};
    try { payload = await req.json(); } catch { /* body is optional */ }

    const deviceId: unknown = payload?.device_id;
    const db = ctx.supabaseAdmin;

    const { error: visitErr } = await db.from('site_visits').insert({});
    if (visitErr) console.error('record-visit: site_visits insert error', visitErr);

    if (isUuid(deviceId)) {
      const { error: sightingErr } = await db
        .from('site_device_sightings')
        .upsert(
          { device_id: deviceId, last_seen: new Date().toISOString() },
          { onConflict: 'device_id' },
        );
      if (sightingErr) console.error('record-visit: site_device_sightings upsert error', sightingErr);
    }

    // Best-effort either way — a person's page load should never fail or
    // even visibly wait on this.
    return Response.json({ ok: true });
  }),
};