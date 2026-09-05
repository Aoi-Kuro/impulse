// Setup type definitions for built-in Supabase Runtime APIs
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "jsr:@supabase/server@^1";

interface SubscribePayload {
  action: "subscribe" | "unsubscribe";
  device_id: string;
  device_secret?: string;
  endpoint?: string;
  keys?: { p256dh: string; auth: string };
}

// ── Device-secret verification (see migration 001_device_secrets.sql) ──────
// device_id alone is public (forum_messages_public), so it can't prove
// device ownership on its own — without this, anyone could unsubscribe (or
// re-point a subscribe onto) someone else's push endpoint by copying their
// device_id off the forum.
const DEVICE_SECRET_PEPPER = Deno.env.get("DEVICE_SECRET_PEPPER");

async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function randomHex(byteLen: number): string {
  const arr = new Uint8Array(byteLen);
  crypto.getRandomValues(arr);
  return Array.from(arr).map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function verifyOrRegisterDevice(db: any, deviceId: string, secret: unknown): Promise<boolean> {
  if (!DEVICE_SECRET_PEPPER || typeof secret !== "string" || secret.length < 16 || secret.length > 200) {
    return false;
  }
  const { data: row, error } = await db
    .from("device_secrets").select("secret_hash, secret_salt").eq("device_id", deviceId).maybeSingle();
  if (error) { console.error("save-push-subscription: device-auth lookup error", error); return false; }

  if (!row) {
    const salt = randomHex(16);
    const hash = await sha256Hex(`${DEVICE_SECRET_PEPPER}:${salt}:${secret}`);
    const { error: insErr } = await db
      .from("device_secrets").insert({ device_id: deviceId, secret_hash: hash, secret_salt: salt });
    if (!insErr) return true;
    const { data: retryRow, error: retryErr } = await db
      .from("device_secrets").select("secret_hash, secret_salt").eq("device_id", deviceId).maybeSingle();
    if (retryErr || !retryRow) { console.error("save-push-subscription: device-auth race-retry error", retryErr); return false; }
    const retryHash = await sha256Hex(`${DEVICE_SECRET_PEPPER}:${retryRow.secret_salt}:${secret}`);
    return retryHash === retryRow.secret_hash;
  }

  const candidateHash = await sha256Hex(`${DEVICE_SECRET_PEPPER}:${row.secret_salt}:${secret}`);
  return candidateHash === row.secret_hash;
}

export default {
  fetch: withSupabase({ auth: "publishable" }, async (req, ctx) => {
    const payload: SubscribePayload = await req.json();
    const { action, device_id, device_secret, endpoint, keys } = payload ?? {};

    // ctx.supabaseAdmin bypasses RLS — push_subscriptions has zero client
    // policies (see migration 014), so this is the only client that can
    // touch this table at all.
    const admin = ctx.supabaseAdmin;

    if (typeof device_id !== "string" || !/^[0-9a-f-]{36}$/i.test(device_id)) {
      return Response.json({ ok: false, error: "Invalid device id." }, { status: 400 });
    }
    if (!(await verifyOrRegisterDevice(admin, device_id, device_secret))) {
      return Response.json({ ok: false, error: "device_auth_failed" }, { status: 403 });
    }
    if (typeof endpoint !== "string" || !endpoint.startsWith("https://")) {
      return Response.json({ ok: false, error: "Invalid subscription endpoint." }, { status: 400 });
    }

    if (action === "unsubscribe") {
      // Scoped to device_id too, not just endpoint, so one device can't
      // drop a subscription it doesn't own even if it somehow knew the
      // endpoint string (it's not secret, just unique).
      const { error } = await admin
        .from("push_subscriptions")
        .delete()
        .eq("endpoint", endpoint)
        .eq("device_id", device_id);
      if (error) {
        console.error("Push unsubscribe error:", error);
        return Response.json({ ok: false, error: "Couldn't remove subscription." }, { status: 500 });
      }
      return Response.json({ ok: true });
    }

    if (action !== "subscribe") {
      return Response.json({ ok: false, error: "Invalid action." }, { status: 400 });
    }
    if (!keys || typeof keys.p256dh !== "string" || typeof keys.auth !== "string") {
      return Response.json({ ok: false, error: "Missing subscription keys." }, { status: 400 });
    }

    // Resolve this device's claimed identity, if any — same identity_devices
    // lookup post-message.ts runs before every post, so a subscription
    // always follows whichever identity is actually claimed on this device
    // right now, and updates automatically the next time this endpoint
    // re-subscribes under a different claim.
    const { data: link, error: linkErr } = await admin
      .from("identity_devices")
      .select("identity_id")
      .eq("device_id", device_id)
      .maybeSingle();
    if (linkErr) console.error("Identity link lookup error (push subscribe):", linkErr);

    const { error: upsertErr } = await admin.from("push_subscriptions").upsert(
      {
        device_id,
        identity_id: link?.identity_id ?? null,
        endpoint,
        p256dh: keys.p256dh,
        auth: keys.auth,
      },
      { onConflict: "endpoint" }
    );

    if (upsertErr) {
      console.error("Push subscribe error:", upsertErr);
      return Response.json({ ok: false, error: "Couldn't save subscription." }, { status: 500 });
    }
    return Response.json({ ok: true });
  }),
};
