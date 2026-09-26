// Edge Function: drop-nickname (v4 — exit-only, "drop everywhere" removed)
//
// Deploy as the "drop-nickname" Edge Function (replace the existing one).
// Same auth mode as the others: "publishable", "Verify JWT with legacy
// secret" OFF.
//
// The client no longer offers a "drop everywhere" button — PIN + Change +
// Exit covered everything Drop did, minus the destructive delete-for-
// everyone part, so it was cut. This function now does exactly one thing:
//
//   { device_id, action: "exit" }
//     Unlinks ONLY the calling device from its identity (deletes its one
//     row in identity_devices). The identity itself, its nickname, its PIN,
//     and every OTHER device still linked to it are completely untouched.
//     No PIN required — this can only ever affect the device that's asking,
//     the same way signing out doesn't need your password on top of
//     already being logged in. Coming back later is just claim-nickname
//     with the nickname + PIN again.
//
// `action` is still required and must be exactly "exit" — kept as an
// explicit field (rather than just trusting the endpoint name) so a client
// bug that calls this without meaning to fails loudly instead of silently
// unlinking a device. If "drop everywhere" ever needs to come back, restore
// it from git history rather than re-adding it here from scratch — the PIN
// verification, throttling, and identities-cascade-delete logic was already
// worked out once.

import { withSupabase } from 'npm:@supabase/server@^1';

function isUuid(v: unknown): v is string {
  return typeof v === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
}

// ── Device-secret verification (see migration 001_device_secrets.sql) ──────
// Same rationale/shape as edit-message.ts's copy — device_id is public
// (forum_messages_public), so it can't prove device ownership on its own.
const DEVICE_SECRET_PEPPER = Deno.env.get('DEVICE_SECRET_PEPPER');

async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('');
}

function randomHex(byteLen: number): string {
  const arr = new Uint8Array(byteLen);
  crypto.getRandomValues(arr);
  return Array.from(arr).map(b => b.toString(16).padStart(2, '0')).join('');
}

// -- Device-verification token (skips the device_secrets DB round-trip) ----
// verifyOrRegisterDevice() below used to hit `device_secrets` on every call,
// even seconds after the same device had already proven ownership -- the
// #1 source of Log Ingestion/Query volume (device_secrets + identity_devices
// made up 55% of all request logs in a 26-min sample, 2026-09-25). After a
// successful DB-backed verification we now also issue a short-lived signed
// token; a client holding a still-valid token skips the DB check next time.
// identity_devices is deliberately NOT covered by this -- that lookup stays
// live everywhere, since claim/drop-nickname can reassign device_id to a
// different identity at any moment and a cached identity would go stale.
// Security note: this token is not a weaker credential than device_secret
// itself -- both live in the same client-side (localStorage) trust
// boundary. It only bounds *how long* a proof of ownership is honored for,
// the same way a session cookie bounds a login.
const DEVICE_TOKEN_SECRET = Deno.env.get('DEVICE_TOKEN_SECRET');
const DEVICE_TOKEN_TTL_SECONDS = 12 * 60 * 60;

async function hmacHex(payload: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(DEVICE_TOKEN_SECRET!),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload));
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function issueDeviceToken(deviceId: string): Promise<{ token: string; expiresAt: number } | null> {
  if (!DEVICE_TOKEN_SECRET) return null; // secret not set yet -- fails open to DB-only mode
  const expiresAt = Math.floor(Date.now() / 1000) + DEVICE_TOKEN_TTL_SECONDS;
  const payload = `${deviceId}:${expiresAt}`;
  const token = btoa(payload) + '.' + await hmacHex(payload);
  return { token, expiresAt };
}

async function verifyDeviceToken(deviceId: string, token: unknown): Promise<boolean> {
  if (!DEVICE_TOKEN_SECRET || typeof token !== 'string' || !token.includes('.')) return false;
  const [encoded, sig] = token.split('.');
  let payload: string;
  try { payload = atob(encoded); } catch { return false; }
  const [tokenDeviceId, expiresAtStr] = payload.split(':');
  if (tokenDeviceId !== deviceId) return false;
  const expiresAt = Number(expiresAtStr);
  if (!Number.isFinite(expiresAt) || Date.now() / 1000 > expiresAt) return false;
  const expected = await hmacHex(payload);
  if (expected.length !== sig.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ sig.charCodeAt(i);
  return diff === 0;
}

async function verifyOrRegisterDevice(db: any, deviceId: string, secret: unknown, token?: unknown): Promise<boolean> {
  if (await verifyDeviceToken(deviceId, token)) return true;
  if (!DEVICE_SECRET_PEPPER || typeof secret !== 'string' || secret.length < 16 || secret.length > 200) {
    return false;
  }
  const { data: row, error } = await db
    .from('device_secrets').select('secret_hash, secret_salt').eq('device_id', deviceId).maybeSingle();
  if (error) { console.error('drop-nickname: device-auth lookup error', error); return false; }

  if (!row) {
    const salt = randomHex(16);
    const hash = await sha256Hex(`${DEVICE_SECRET_PEPPER}:${salt}:${secret}`);
    const { error: insErr } = await db
      .from('device_secrets').insert({ device_id: deviceId, secret_hash: hash, secret_salt: salt });
    if (!insErr) return true;
    const { data: retryRow, error: retryErr } = await db
      .from('device_secrets').select('secret_hash, secret_salt').eq('device_id', deviceId).maybeSingle();
    if (retryErr || !retryRow) { console.error('drop-nickname: device-auth race-retry error', retryErr); return false; }
    const retryHash = await sha256Hex(`${DEVICE_SECRET_PEPPER}:${retryRow.secret_salt}:${secret}`);
    return retryHash === retryRow.secret_hash;
  }

  const candidateHash = await sha256Hex(`${DEVICE_SECRET_PEPPER}:${row.secret_salt}:${secret}`);
  return candidateHash === row.secret_hash;
}

export default {
  fetch: withSupabase({ auth: 'publishable' }, async (req, ctx) => {
    if (req.method !== 'POST') {
      return Response.json({ ok: false, error: 'method_not_allowed' }, { status: 405 });
    }

    let payload: any;
    try {
      payload = await req.json();
    } catch {
      return Response.json({ ok: false, error: 'bad_json' }, { status: 400 });
    }

    const deviceId: string = payload?.device_id;
    const action: string = payload?.action;

    if (!isUuid(deviceId)) {
      return Response.json({ ok: false, error: 'invalid_device_id' }, { status: 400 });
    }
    if (!(await verifyOrRegisterDevice(ctx.supabaseAdmin, deviceId, payload?.device_secret, payload?.device_token))) {
      return Response.json({ ok: false, error: 'device_auth_failed' }, { status: 403 });
    }
    const deviceToken = await issueDeviceToken(deviceId);
    if (action !== 'exit') {
      return Response.json({ ok: false, error: 'invalid_action' }, { status: 400 });
    }

    const db = ctx.supabaseAdmin;

    const { data: link, error: linkErr } = await db
      .from('identity_devices')
      .select('identity_id')
      .eq('device_id', deviceId)
      .maybeSingle();
    if (linkErr) {
      console.error('drop-nickname: link lookup error', linkErr);
      return Response.json({ ok: false, error: 'server_error' }, { status: 500 });
    }
    if (!link) {
      return Response.json({ ok: false, error: 'not_found' }, { status: 404 });
    }

    const { error: unlinkErr } = await db
      .from('identity_devices')
      .delete()
      .eq('device_id', deviceId);
    if (unlinkErr) {
      console.error('drop-nickname: exit/unlink error', unlinkErr);
      return Response.json({ ok: false, error: 'server_error' }, { status: 500 });
    }

    return Response.json({
      ok: true,
      exited: true,
      ...(deviceToken ? { device_token: deviceToken.token, device_token_expires_at: deviceToken.expiresAt } : {}),
    });
  }),
};