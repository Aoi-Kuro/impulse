// Edge Function: account-delete
//
// Deploy as the "account-delete" Edge Function. Auth mode "publishable",
// "Verify JWT with legacy secret" OFF, same as the others. Needs migration
// 020_account_deletion.sql and the secrets claim-nickname already uses
// (PIN_PEPPER, DEVICE_SECRET_PEPPER, DEVICE_TOKEN_SECRET).
//
// Everything a student can do about deleting their account
// (js/account-delete.js). Every call carries { device_id, device_secret,
// device_token? } like the other functions, plus an action:
//
//   "status"   What this device should show. One of:
//                active   signed in to an account that isn't being deleted;
//                pending  it was signed in to an account that is waiting to
//                         be deleted (with who asked, when, and the purge
//                         date), and hasn't chosen "Sign out" yet;
//                deleted  it was signed in to an account that has been
//                         purged since: wipe the local copy. Answered once
//                         per device (its hash is then dropped);
//                none     nothing to do.
//   "export"   { pin } The signed-in account's data as JSON.
//   "request"  { pin, nickname, from } Asks for deletion: hides the account
//              and signs every device out (request_account_deletion). The
//              nickname must be typed out as a check; `from` is a short
//              description of the device ("Windows | Edge") shown to the
//              account's other devices.
//   "cancel"   { nickname, pin } Undoes a pending deletion and signs this
//              device in (cancel_account_deletion). Works from any device,
//              so the owner can stop a deletion someone else asked for.
//   "sign_out" Leaves a pending deletion as it is; this device signs out for
//              good and isn't asked again.
//
// Wrong PINs count toward the same lock as logging in (5 tries, then 15
// minutes), since the PIN check here is the same check.

import { withSupabase } from 'npm:@supabase/server@^1';

const LOCK_MINUTES = 15;
const MAX_FAILED_ATTEMPTS = 5;
const PIN_PEPPER = Deno.env.get('PIN_PEPPER');
const DEVICE_SECRET_PEPPER = Deno.env.get('DEVICE_SECRET_PEPPER');
const DEVICE_TOKEN_SECRET = Deno.env.get('DEVICE_TOKEN_SECRET');
const DEVICE_TOKEN_TTL_SECONDS = 12 * 60 * 60;
const IDENTITY_TOKEN_TTL_SECONDS = 300;
const PAGE = 1000;

function isUuid(v: unknown): v is string {
  return typeof v === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
}

async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

function randomHex(byteLen: number): string {
  const arr = new Uint8Array(byteLen);
  crypto.getRandomValues(arr);
  return Array.from(arr).map((b) => b.toString(16).padStart(2, '0')).join('');
}

// Names are compared the way claim-nickname compares them (NFC, trimmed,
// lower case).
function nicknameKey(raw: unknown): string {
  return typeof raw === 'string' ? raw.normalize('NFC').trim().toLowerCase() : '';
}

// ── Device proof: copied from drop-nickname.ts ──────────────────────────────
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
  if (!DEVICE_TOKEN_SECRET) return null;
  const expiresAt = Math.floor(Date.now() / 1000) + DEVICE_TOKEN_TTL_SECONDS;
  const payload = `${deviceId}:${expiresAt}`;
  return { token: btoa(payload) + '.' + await hmacHex(payload), expiresAt };
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

async function issueIdentityToken(deviceId: string, identityId: string | null): Promise<{ token: string; expiresAt: number } | null> {
  if (!DEVICE_TOKEN_SECRET) return null;
  const expiresAt = Math.floor(Date.now() / 1000) + IDENTITY_TOKEN_TTL_SECONDS;
  const payload = `${deviceId}:${identityId ?? ''}:${expiresAt}`;
  return { token: btoa(payload) + '.' + await hmacHex(payload), expiresAt };
}

async function verifyOrRegisterDevice(db: any, deviceId: string, secret: unknown, token?: unknown): Promise<boolean> {
  if (await verifyDeviceToken(deviceId, token)) return true;
  if (!DEVICE_SECRET_PEPPER || typeof secret !== 'string' || secret.length < 16 || secret.length > 200) {
    return false;
  }
  const { data: row, error } = await db
    .from('device_secrets').select('secret_hash, secret_salt').eq('device_id', deviceId).maybeSingle();
  if (error) { console.error('account-delete: device-auth lookup error', error); return false; }
  if (!row) {
    const salt = randomHex(16);
    const hash = await sha256Hex(`${DEVICE_SECRET_PEPPER}:${salt}:${secret}`);
    const { error: insErr } = await db
      .from('device_secrets').insert({ device_id: deviceId, secret_hash: hash, secret_salt: salt });
    if (!insErr) return true;
    const { data: retryRow, error: retryErr } = await db
      .from('device_secrets').select('secret_hash, secret_salt').eq('device_id', deviceId).maybeSingle();
    if (retryErr || !retryRow) { console.error('account-delete: device-auth race-retry error', retryErr); return false; }
    return (await sha256Hex(`${DEVICE_SECRET_PEPPER}:${retryRow.secret_salt}:${secret}`)) === retryRow.secret_hash;
  }
  return (await sha256Hex(`${DEVICE_SECRET_PEPPER}:${row.secret_salt}:${secret}`)) === row.secret_hash;
}

// ── PIN: the same check and lock as claim-nickname.ts ───────────────────────
type IdentityRow = {
  id: string;
  nickname: string;
  nickname_lower: string;
  pin_hash: string;
  pin_salt: string;
  failed_attempts: number;
  locked_until: string | null;
  created_at: string;
  deletion_pending: boolean;
  deleted_at: string | null;
};

function isLocked(row: { locked_until: string | null }): boolean {
  return !!row.locked_until && new Date(row.locked_until).getTime() > Date.now();
}

async function checkPinOrThrottle(db: any, identity: IdentityRow, pin: string): Promise<boolean> {
  const candidateHash = await sha256Hex(`${PIN_PEPPER}:${identity.pin_salt}:${pin}`);
  if (candidateHash === identity.pin_hash) {
    if (identity.failed_attempts || identity.locked_until) {
      await db.from('identities').update({ failed_attempts: 0, locked_until: null }).eq('id', identity.id);
    }
    return true;
  }
  const failed = (identity.failed_attempts || 0) + 1;
  const patch: Record<string, unknown> = { failed_attempts: failed };
  if (failed >= MAX_FAILED_ATTEMPTS) {
    patch.locked_until = new Date(Date.now() + LOCK_MINUTES * 60_000).toISOString();
    patch.failed_attempts = 0;
  }
  await db.from('identities').update(patch).eq('id', identity.id);
  return false;
}

// One answer for "the PIN didn't check out", whatever the reason.
async function pinProblem(db: any, identity: IdentityRow, pin: unknown): Promise<Response | null> {
  if (!PIN_PEPPER) {
    console.error('account-delete: PIN_PEPPER secret is not set');
    return Response.json({ ok: false, error: 'server_error' }, { status: 500 });
  }
  if (isLocked(identity)) {
    return Response.json({ ok: false, error: 'locked', locked_until: identity.locked_until }, { status: 429 });
  }
  if (typeof pin !== 'string' || !/^\d{5}$/.test(pin.trim())) {
    return Response.json({ ok: false, error: 'invalid_pin_format' }, { status: 400 });
  }
  if (!(await checkPinOrThrottle(db, identity, pin.trim()))) {
    return Response.json({ ok: false, error: 'wrong_pin' }, { status: 403 });
  }
  return null;
}

// ── Reads ───────────────────────────────────────────────────────────────────
// supabase-js returns at most 1000 rows per request; this reads them all.
async function selectAll(build: () => any): Promise<any[]> {
  const out: any[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build().range(from, from + PAGE - 1);
    if (error) throw error;
    out.push(...(data || []));
    if (!data || data.length < PAGE) return out;
  }
}

async function linkedIdentity(db: any, deviceId: string): Promise<IdentityRow | null> {
  const { data: link, error } = await db
    .from('identity_devices').select('identity_id').eq('device_id', deviceId).maybeSingle();
  if (error) throw error;
  if (!link) return null;
  const { data: identity, error: idErr } = await db
    .from('identities').select('*').eq('id', link.identity_id).maybeSingle();
  if (idErr) throw idErr;
  return identity && !identity.deleted_at ? identity : null;
}

async function exportAccount(db: any, identity: IdentityRow) {
  const id = identity.id;
  const devices = await selectAll(() => db.from('identity_devices')
    .select('device_id, linked_at').eq('identity_id', id).order('linked_at'));
  const deviceIds = devices.map((d) => d.device_id);
  const [attempts, entireSet, settings, messages, flags, sightings] = await Promise.all([
    selectAll(() => db.from('quiz_attempts')
      .select('attempt_hash, quiz_num, mode, attempted_at, duration_seconds, score, max_score, answers, locked')
      .eq('identity_id', id).order('attempted_at')),
    selectAll(() => db.from('solve_all_progress')
      .select('quiz_num, cumulative, data, updated_at').eq('identity_id', id).order('quiz_num')),
    db.from('settings_sync').select('data, updated_at').eq('identity_id', id).maybeSingle(),
    selectAll(() => db.from('forum_messages')
      .select('id, created_at, edited_at, scope, problem_key, reply_to_id, body, flag_status')
      .eq('identity_id', id).order('id')),
    deviceIds.length
      ? selectAll(() => db.from('forum_flags').select('message_id, created_at').in('device_id', deviceIds).order('created_at'))
      : Promise.resolve([]),
    deviceIds.length
      ? selectAll(() => db.from('site_device_sightings').select('device_id, first_seen, last_seen').in('device_id', deviceIds))
      : Promise.resolve([]),
  ]);
  if (settings.error) throw settings.error;
  return {
    exported_at: new Date().toISOString(),
    account: { nickname: identity.nickname, created_at: identity.created_at },
    practice_exam_attempts: attempts,
    entire_set_progress: entireSet,
    settings: settings.data ? settings.data : null,
    forum_messages: messages,
    flags_filed: flags,
    devices,
    device_visits: sightings,
  };
}

// A short description of the asking device, shown to the account's other
// devices. Plain text only.
function cleanFrom(v: unknown): string {
  if (typeof v !== 'string') return '';
  return v.replace(/[\u0000-\u001f\u007f<>]/g, '').trim().slice(0, 60);
}

async function pendingForDevice(db: any, deviceId: string) {
  const { data, error } = await db
    .from('account_deletions')
    .select('id, identity_id, requested_at, purge_after, requested_by, requested_from, signed_out')
    .eq('status', 'pending')
    .contains('devices', [deviceId])
    .order('requested_at', { ascending: false })
    .limit(1);
  if (error) throw error;
  const row = data && data[0];
  if (!row || (row.signed_out || []).includes(deviceId)) return null;
  return row;
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
    const withToken = (body: Record<string, unknown>, init?: ResponseInit) => Response.json({
      ...body,
      ...(deviceToken ? { device_token: deviceToken.token, device_token_expires_at: deviceToken.expiresAt } : {}),
    }, init);
    const db = ctx.supabaseAdmin;

    try {
      // ── status ──
      if (action === 'status') {
        const identity = await linkedIdentity(db, deviceId);
        if (identity) return withToken({ ok: true, state: 'active' });

        const pending = await pendingForDevice(db, deviceId);
        if (pending) {
          const { data: who } = await db.from('identities').select('nickname').eq('id', pending.identity_id).maybeSingle();
          return withToken({
            ok: true,
            state: 'pending',
            nickname: who ? who.nickname : '',
            requested_at: pending.requested_at,
            purge_after: pending.purge_after,
            requested_from: pending.requested_from || '',
            asked_here: pending.requested_by === deviceId,
          });
        }

        const hash = await sha256Hex(deviceId);
        const { data: purged, error } = await db
          .from('account_deletions').select('id, device_hashes')
          .eq('status', 'purged').contains('device_hashes', [hash]);
        if (error) throw error;
        if (purged && purged.length) {
          // Told once: this device wipes its copy now.
          for (const row of purged) {
            await db.from('account_deletions')
              .update({ device_hashes: (row.device_hashes || []).filter((h: string) => h !== hash) })
              .eq('id', row.id);
          }
          return withToken({ ok: true, state: 'deleted' });
        }
        return withToken({ ok: true, state: 'none' });
      }

      // ── sign_out ──
      if (action === 'sign_out') {
        const pending = await pendingForDevice(db, deviceId);
        if (pending) {
          const { error } = await db.from('account_deletions')
            .update({ signed_out: [...(pending.signed_out || []), deviceId] })
            .eq('id', pending.id);
          if (error) throw error;
        }
        return withToken({ ok: true, clear_identity_token: true });
      }

      // ── cancel ──
      if (action === 'cancel') {
        const key = nicknameKey(payload?.nickname);
        if (!key) return withToken({ ok: false, error: 'not_found' }, { status: 404 });
        const { data: identity, error } = await db
          .from('identities').select('*').eq('nickname_lower', key).maybeSingle();
        if (error) throw error;
        if (!identity || identity.deleted_at) return withToken({ ok: false, error: 'not_found' }, { status: 404 });
        const problem = await pinProblem(db, identity, payload?.pin);
        if (problem) return problem;
        if (!identity.deletion_pending) {
          return withToken({ ok: false, error: 'not_pending' }, { status: 409 });
        }
        const { data: done, error: rpcErr } = await db.rpc('cancel_account_deletion', {
          p_identity: identity.id, p_device: deviceId,
        });
        if (rpcErr) throw rpcErr;
        if (!done) return withToken({ ok: false, error: 'not_pending' }, { status: 409 });
        const identityToken = await issueIdentityToken(deviceId, identity.id);
        return withToken({
          ok: true,
          cancelled: true,
          nickname: identity.nickname,
          ...(identityToken ? { identity_token: identityToken.token, identity_token_expires_at: identityToken.expiresAt } : {}),
        });
      }

      // ── export / request: the signed-in account ──
      if (action !== 'export' && action !== 'request') {
        return withToken({ ok: false, error: 'invalid_action' }, { status: 400 });
      }
      const identity = await linkedIdentity(db, deviceId);
      if (!identity) return withToken({ ok: false, error: 'no_identity' }, { status: 403 });
      if (action === 'request' && nicknameKey(payload?.nickname) !== identity.nickname_lower) {
        return withToken({ ok: false, error: 'nickname_mismatch' }, { status: 400 });
      }
      const problem = await pinProblem(db, identity, payload?.pin);
      if (problem) return problem;

      if (action === 'export') {
        return withToken({ ok: true, data: await exportAccount(db, identity) });
      }

      const { data: row, error: rpcErr } = await db.rpc('request_account_deletion', {
        p_identity: identity.id,
        p_device: deviceId,
        p_from: cleanFrom(payload?.from),
        p_days: 30,
      });
      if (rpcErr) throw rpcErr;
      return withToken({
        ok: true,
        requested: true,
        requested_at: row?.requested_at,
        purge_after: row?.purge_after,
        clear_identity_token: true,
      });
    } catch (err) {
      console.error(`account-delete: ${action} error`, err);
      return withToken({ ok: false, error: 'server_error' }, { status: 500 });
    }
  }),
};
