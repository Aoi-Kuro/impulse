// Edge Function: check-ban
//
// Deploy as a NEW Edge Function named "check-ban". Same auth mode as your
// other functions: "publishable", "Verify JWT with legacy secret" OFF.
//
// Lets the front end ask "am I currently banned?" for its own device_id, so
// the ban banner (js/forum.js) can show up right when the forum screen opens
// or during the periodic live-poll tick — not only reactively, after an
// attempted post gets rejected by post-message.ts. Read-only, no side effects.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "jsr:@supabase/server@^1";

function isUuid(v: unknown): v is string {
  return typeof v === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
}

export default {
  fetch: withSupabase({ auth: "publishable" }, async (req, ctx) => {
    if (req.method !== "POST") {
      return Response.json({ ok: false, error: "method_not_allowed" }, { status: 405 });
    }

    let payload: any;
    try {
      payload = await req.json();
    } catch {
      return Response.json({ ok: false, error: "bad_json" }, { status: 400 });
    }

    const deviceId = payload?.device_id;
    if (!isUuid(deviceId)) {
      return Response.json({ ok: false, error: "invalid_device_id" }, { status: 400 });
    }

    const admin = ctx.supabaseAdmin;

    // Checks both: a direct device_bans row (unclaimed poster, or a mirrored
    // ban — see registerRedFlag in flag-message.ts), and, if this device is
    // linked to a claimed identity, that identity's own ban (survives
    // renames and "exit device"). Whichever expires later wins.
    let bannedUntil: string | null = null;

    const { data: devRow, error: devErr } = await admin
      .from("device_bans")
      .select("banned_until")
      .eq("device_id", deviceId)
      .maybeSingle();
    if (devErr) { console.error("check-ban device lookup error:", devErr); return Response.json({ ok: false, error: "server_error" }, { status: 500 }); }
    if (devRow?.banned_until && new Date(devRow.banned_until) > new Date()) bannedUntil = devRow.banned_until;

    const { data: link, error: linkErr } = await admin
      .from("identity_devices")
      .select("identity_id")
      .eq("device_id", deviceId)
      .maybeSingle();
    if (linkErr) { console.error("check-ban identity-link lookup error:", linkErr); return Response.json({ ok: false, error: "server_error" }, { status: 500 }); }

    if (link?.identity_id) {
      const { data: idRow, error: idErr } = await admin
        .from("identity_bans")
        .select("banned_until")
        .eq("identity_id", link.identity_id)
        .maybeSingle();
      if (idErr) { console.error("check-ban identity lookup error:", idErr); return Response.json({ ok: false, error: "server_error" }, { status: 500 }); }
      if (idRow?.banned_until && new Date(idRow.banned_until) > new Date()) {
        if (!bannedUntil || new Date(idRow.banned_until) > new Date(bannedUntil)) bannedUntil = idRow.banned_until;
      }
    }

    return Response.json({ ok: true, banned_until: bannedUntil });
  }),
};