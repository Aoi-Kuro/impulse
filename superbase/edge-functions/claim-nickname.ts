// Edge Function: claim-nickname (v2 — multi-device identities)
//
// Deploy as the "claim-nickname" Edge Function (replace the existing one).
// Auth mode: "publishable", same as post-message. "Verify JWT with legacy
// secret" OFF.
//
// Requires sql/identities_schema.sql to have been run first (identities +
// identity_devices tables, forum_messages_public view). forum_identities is
// gone — this file no longer touches it.
//
// Same request shape as before — { device_id, nickname, pin? } — but the
// server-side model underneath changed from "one device = one row" to
// "many devices can point at one identity row". Four possible outcomes,
// distinguished by what's already true for (a) this device and (b) the
// requested nickname:
//
//   1. NEW CLAIM       — nickname is free, and this device isn't linked to
//      any identity yet. Creates a new identity, links this device to it,
//      generates a 5-digit PIN and returns it once (never retrievable
//      again after this).
//
//   2. LINK / SWITCH DEVICE — nickname is claimed by an existing identity
//      (whether or not this device is currently linked to a DIFFERENT
//      identity). Requires that identity's PIN. On success this device is
//      linked to it — this NEVER removes any other device already linked to
//      that identity, which is the whole point: phone, tablet, and PC can
//      all be linked to the same identity at once. If this device was
//      previously linked to a different identity, that link is simply
//      replaced (the old identity is untouched and keeps whatever other
//      devices it has).
//
//   3. RENAME — this device is already linked to an identity, and the
//      requested nickname is free. Requires that identity's PIN. Renames
//      the identity itself (not a per-device thing), so every device linked
//      to it — and every past message it ever posted, via
//      forum_messages_public — shows the new name immediately.
//
//   4. NO-OP — this device is already linked to the identity that already
//      owns the requested nickname (i.e. you "claimed" the name you already
//      have). Returns success without changing anything.
//
// A 5-digit PIN only has 100,000 possible values, so wrong-PIN attempts are
// throttled per-identity: 5 wrong guesses locks that identity for 15 minutes.
//
// A nickname is content too — it's shown next to every message someone
// posts, exactly like a message body — so both places a nickname is ever
// SET (Case 1's new claim, Case 3's rename) run it through the same OpenAI
// moderation pipeline post-message.ts already runs message bodies through
// before letting them in. Case 2 (link) and Case 4 (no-op) never introduce
// new nickname text, so neither one calls moderation at all.

import { withSupabase } from 'npm:@supabase/server@^1';

// No space allowed: @mentions (FORUM_MENTION_RE in forum.js) only ever match
// up to the first whitespace character, so a nickname containing a space
// would be permanently unmentionable past that point (e.g. "@Aoi Kuro" only
// ever resolves the mention as "Aoi", silently dropping " Kuro"). Underscores,
// periods, and hyphens remain available as space substitutes.
const NICKNAME_RE = /^[\p{L}\p{N}._-]{2,40}$/u;
const LOCK_MINUTES = 15;
const MAX_FAILED_ATTEMPTS = 5;

// Same sentinel used in post-message.ts for the Gemini bot — a human claim
// can never use this device_id.
// FIXED: this was left as the literal placeholder string
// 'REPLACE_WITH_YOUR_GEMINI_BOT_DEVICE_ID', which never matches a real
// device_id, so the block below silently never fired. Now matches the
// actual sentinel used in post-message.ts / forum.js
// (FORUM_GEMINI_BOT_DEVICE_ID) — keep these three in sync if it ever changes.
const GEMINI_BOT_DEVICE_ID = '00000000-0000-4000-8000-000000000001';

// Reserved nicknames no human claim can ever land on, case-insensitive.
// "gemini" specifically: this exact name is how the front end labels the
// bot's own replies (GEMINI_BOT_NAME in post-message.ts) and picks its
// official avatar (device_id check there; FORUM_GEMINI_BOT_DEVICE_ID in
// forum.js). A human claiming "Gemini" wouldn't get that device_id or
// avatar, but would still read as the bot at a glance in a message list —
// close enough to trick someone. Checked for both a brand-new claim and a
// rename (both go through the block below, right after nicknameLower is
// computed, before any of the four cases branch), reusing the same
// 'flagged_nickname' error code/message moderation already uses so the
// front end needs no changes to handle this.
const RESERVED_NICKNAMES_LOWER = new Set(['gemini']);

function isUuid(v: unknown): v is string {
  return typeof v === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
}

// PIN_PEPPER: a secret string set only as an Edge Function secret (dashboard
// → this function → Secrets), mixed into every PIN hash alongside the
// per-row salt. Same reasoning as before: a table leak alone shouldn't be
// enough to brute-force every PIN offline. Generate with `openssl rand -hex
// 32`, set once — it's never entered by a person.
const PIN_PEPPER = Deno.env.get('PIN_PEPPER');

// DEVICE_SECRET_PEPPER: same idea as PIN_PEPPER, but for device_secret (see
// migration 001_device_secrets.sql). device_id is public — anyone reading
// the forum can see whose device_id posted what — so it can't be trusted
// as proof of "this is my device" on its own. device_secret is the actual
// proof: generated once on the client alongside device_id and never sent
// anywhere except in requests from its own owner. Generate the pepper with
// `openssl rand -hex 32`, set once, same as PIN_PEPPER.
const DEVICE_SECRET_PEPPER = Deno.env.get('DEVICE_SECRET_PEPPER');

// Verifies device_secret against device_secrets, registering it
// trust-on-first-use if this device_id has never been seen before. Returns
// true iff the request is allowed to proceed as this device_id. Reuses
// sha256Hex/randomHex above rather than redefining them — same hashing
// shape as hashPin(), just a different pepper and table.
async function verifyOrRegisterDevice(db: any, deviceId: string, secret: unknown): Promise<boolean> {
  if (!DEVICE_SECRET_PEPPER || typeof secret !== 'string' || secret.length < 16 || secret.length > 200) {
    return false;
  }

  const { data: row, error } = await db
    .from('device_secrets')
    .select('secret_hash, secret_salt')
    .eq('device_id', deviceId)
    .maybeSingle();
  if (error) {
    console.error('claim-nickname: device-auth lookup error', error);
    return false;
  }

  if (!row) {
    const salt = randomHex(16);
    const hash = await sha256Hex(`${DEVICE_SECRET_PEPPER}:${salt}:${secret}`);
    const { error: insErr } = await db
      .from('device_secrets')
      .insert({ device_id: deviceId, secret_hash: hash, secret_salt: salt });
    if (!insErr) return true;
    // Race: another request for this same brand-new device_id registered
    // it a moment ago — fall through and verify against whatever it wrote,
    // rather than failing a legitimate first-ever request outright.
    const { data: retryRow, error: retryErr } = await db
      .from('device_secrets').select('secret_hash, secret_salt').eq('device_id', deviceId).maybeSingle();
    if (retryErr || !retryRow) {
      console.error('claim-nickname: device-auth race-retry error', retryErr);
      return false;
    }
    const retryHash = await sha256Hex(`${DEVICE_SECRET_PEPPER}:${retryRow.secret_salt}:${secret}`);
    return retryHash === retryRow.secret_hash;
  }

  const candidateHash = await sha256Hex(`${DEVICE_SECRET_PEPPER}:${row.secret_salt}:${secret}`);
  return candidateHash === row.secret_hash;
}

// OPENAI_API_KEY: shared with post-message.ts (see the header comment there
// and in forum.js) — Edge Function secrets are project-wide, so nothing new
// to configure if that function is already set up. Only ever read inside
// nicknameIsFlagged() below, right before the two call sites that actually
// need it, rather than gating the whole endpoint on it the way PIN_PEPPER
// does above — Case 2 (link) and Case 4 (no-op) never set new nickname text,
// so they have no reason to fail just because this key happens to be unset.
const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY');
const OPENAI_MODERATION_MODEL = 'omni-moderation-latest';

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

function randomPin(): string {
  const n = 10000 + Math.floor(Math.random() * 90000); // always exactly 5 digits
  return String(n);
}

async function hashPin(pin: string, salt: string): Promise<string> {
  return sha256Hex(`${PIN_PEPPER}:${salt}:${pin}`);
}

function isLocked(row: { locked_until: string | null }): boolean {
  return !!row.locked_until && new Date(row.locked_until).getTime() > Date.now();
}

// Runs `nickname` through OpenAI's moderation endpoint. Called exactly at
// the two places a nickname is ever newly set (brand-new claim, rename) —
// never for a link or a no-op, since neither introduces new text.
//
// Fails OPEN (returns false, i.e. "not flagged") on a missing key, a network
// error, or a bad response — same stance flag-message.ts takes with Gemini:
// an outage in the moderation call shouldn't be able to lock someone out of
// picking a name entirely, and this is a much lower-stakes surface than
// flag-message's delete-a-message decision (worst case here, a bad name
// slips through until someone flags a message posted under it).
async function nicknameIsFlagged(nickname: string): Promise<boolean> {
  if (!OPENAI_API_KEY) {
    console.error('claim-nickname: OPENAI_API_KEY secret is not set — skipping nickname moderation check');
    return false;
  }
  try {
    const res = await fetch('https://api.openai.com/v1/moderations', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify({ model: OPENAI_MODERATION_MODEL, input: nickname }),
    });
    if (!res.ok) {
      console.error('claim-nickname: OpenAI moderation API error', await res.text());
      return false;
    }
    const data = await res.json();
    return !!data?.results?.[0]?.flagged;
  } catch (err) {
    console.error('claim-nickname: OpenAI moderation call failed', err);
    return false;
  }
}

const DICEBEAR_IDENTICON_URL = 'https://api.dicebear.com/10.x/identicon/svg?seed=';
async function fetchIdenticonSvg(seed: string): Promise<string | null> {
  try {
    const res = await fetch(DICEBEAR_IDENTICON_URL + encodeURIComponent(seed));
    if (!res.ok) {
      console.error('claim-nickname: DiceBear API error', res.status, await res.text());
      return null;
    }
    return await res.text();
  } catch (err) {
    console.error('claim-nickname: DiceBear call failed', err);
    return null;
  }
}

type IdentityRow = {
  id: string;
  nickname: string;
  nickname_lower: string;
  pin_hash: string;
  pin_salt: string;
  failed_attempts: number;
  locked_until: string | null;
};

// Verifies `pin` against `identity`, applying the lockout/throttle rule on
// failure. Returns true iff the PIN was correct. Caller must have already
// checked isLocked(identity) before calling this.
async function checkPinOrThrottle(db: any, identity: IdentityRow, pin: string): Promise<boolean> {
  const candidateHash = await hashPin(pin, identity.pin_salt);
  if (candidateHash === identity.pin_hash) return true;

  const failed = (identity.failed_attempts || 0) + 1;
  const patch: Record<string, unknown> = { failed_attempts: failed };
  if (failed >= MAX_FAILED_ATTEMPTS) {
    patch.locked_until = new Date(Date.now() + LOCK_MINUTES * 60_000).toISOString();
    patch.failed_attempts = 0;
  }
  await db.from('identities').update(patch).eq('id', identity.id);
  return false;
}

// Mirrors FORUM_MENTION_RE in js/forum.js exactly — same "@" + run of
// [A-Za-z0-9_.-] chars shape the composer/renderer/mention-badge logic all
// already agree defines a mention token. Kept as a literal duplicate rather
// than a shared import since this is a Deno Edge Function and forum.js is a
// plain browser script — if that shape ever changes, update both.
const MENTION_TOKEN_RE = /@([A-Za-z0-9_.\-]+)/g;

// Rewrites every "@oldNickname" mention token in `body` to "@newNickname",
// matching the *whole* captured name case-insensitively against
// `oldNicknameLower` (same full-token comparison forumBodyMentionsName()
// does client-side) — so "@Aoi_Kurotaro" is left alone when renaming
// "Aoi_Kuro", not partially clobbered as "@Aoi_Kurotaro" -> "@NewNametaro".
// Returns the rewritten body, or null if nothing in it actually changed.
function rewriteMentionTokens(body: string, oldNicknameLower: string, newNickname: string): string | null {
  let changed = false;
  const rewritten = body.replace(MENTION_TOKEN_RE, (full: string, name: string) => {
    if (name.toLowerCase() === oldNicknameLower) {
      changed = true;
      return '@' + newNickname;
    }
    return full;
  });
  return changed ? rewritten : null;
}

// Finds every message that could possibly mention `oldNickname` and rewrites
// those mentions to `newNickname`, in place. Called once, right after a
// successful Case 3 rename, with the identity's pre-rename nickname_lower
// (the JS object read before the DB write, so still the old value).
//
// Best-effort and deliberately isolated from the rename itself: the rename
// already succeeded by the time this runs, so a failure in here (logged,
// never thrown) doesn't roll it back or fail the response — a stale mention
// left behind is a much smaller problem than telling someone their rename
// failed when it didn't.
//
// Two-step: an ILIKE pre-filter first (cheap, but imprecise — Postgres LIKE
// treats "_" as a single-char wildcard, and nicknames can contain "_", so
// this can only ever over-match, never under-match), then the exact
// case-insensitive whole-token check from rewriteMentionTokens() above
// decides what actually gets written. flag_status:'deleted' rows are
// filtered out in JS below rather than via a `.neq('flag_status', 'deleted')`
// query filter — in SQL, `flag_status <> 'deleted'` evaluates to NULL (not
// true) for every ordinary row where flag_status IS NULL, which is the
// common case for an ordinary never-flagged message, so that filter would
// have silently excluded almost everything instead of just the deleted
// rows.
// "A removed message stays removed, full stop" (edit-message.ts) still
// applies here — this isn't a fresh edit that could reopen one for review,
// just a mechanical text fix, so removed messages are left untouched either
// way.
async function rewriteMentionsAfterRename(db: any, oldNicknameLower: string, newNickname: string): Promise<number> {
  try {
    const { data: candidates, error } = await db
      .from('forum_messages')
      .select('id, body, flag_status')
      .ilike('body', `%@${oldNicknameLower}%`);
    if (error) {
      console.error('claim-nickname: mention-rewrite lookup error', error);
      return 0;
    }
    if (!candidates || candidates.length === 0) return 0;

    const updates = candidates
      .filter((row: { flag_status: string | null }) => row.flag_status !== 'deleted')
      .map((row: { id: number; body: string }) => {
        const rewritten = rewriteMentionTokens(row.body, oldNicknameLower, newNickname);
        return rewritten === null ? null : { id: row.id, body: rewritten };
      })
      .filter((u: unknown): u is { id: number; body: string } => u !== null);

    if (updates.length === 0) return 0;

    const results = await Promise.all(
      updates.map((u: { id: number; body: string }) =>
        db.from('forum_messages').update({ body: u.body }).eq('id', u.id)
      )
    );
    const failures = results.filter((r: any) => r.error);
    if (failures.length > 0) {
      console.error('claim-nickname: mention-rewrite update errors', failures.map((f: any) => f.error));
    }
    return updates.length - failures.length;
  } catch (err) {
    console.error('claim-nickname: mention-rewrite failed', err);
    return 0;
  }
}

export default {
  fetch: withSupabase({ auth: 'publishable' }, async (req, ctx) => {
    if (!PIN_PEPPER) {
      console.error('claim-nickname: PIN_PEPPER secret is not set');
      return Response.json({ ok: false, error: 'server_misconfigured' }, { status: 500 });
    }
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
    const rawNickname: string = typeof payload?.nickname === 'string' ? payload.nickname.trim() : '';
    const pin: string | undefined = typeof payload?.pin === 'string' ? payload.pin.trim() : undefined;

    if (!isUuid(deviceId)) {
      return Response.json({ ok: false, error: 'invalid_device_id' }, { status: 400 });
    }
    if (deviceId === GEMINI_BOT_DEVICE_ID) {
      return Response.json({ ok: false, error: 'reserved_device_id' }, { status: 403 });
    }
    if (!(await verifyOrRegisterDevice(ctx.supabaseAdmin, deviceId, payload?.device_secret))) {
      return Response.json({ ok: false, error: 'device_auth_failed' }, { status: 403 });
    }
    if (!NICKNAME_RE.test(rawNickname)) {
      return Response.json({ ok: false, error: 'invalid_nickname' }, { status: 400 });
    }
    if (pin !== undefined && !/^\d{5}$/.test(pin)) {
      return Response.json({ ok: false, error: 'invalid_pin_format' }, { status: 400 });
    }

    const nicknameLower = rawNickname.toLowerCase();
    if (RESERVED_NICKNAMES_LOWER.has(nicknameLower)) {
      return Response.json({ ok: false, error: 'flagged_nickname' }, { status: 422 });
    }
    const db = ctx.supabaseAdmin;

    // "mine" = the identity (if any) this device is currently linked to.
    // "target" = the identity (if any) that already owns the requested name.
    const [mineLink, targetIdentity] = await Promise.all([
      db.from('identity_devices').select('identity_id').eq('device_id', deviceId).maybeSingle(),
      db.from('identities').select('*').eq('nickname_lower', nicknameLower).maybeSingle(),
    ]);
    if (mineLink.error || targetIdentity.error) {
      console.error('claim-nickname: lookup error', mineLink.error || targetIdentity.error);
      return Response.json({ ok: false, error: 'server_error' }, { status: 500 });
    }

    let mineIdentity: IdentityRow | null = null;
    if (mineLink.data) {
      const { data, error } = await db.from('identities').select('*').eq('id', mineLink.data.identity_id).maybeSingle();
      if (error) {
        console.error('claim-nickname: mine-identity lookup error', error);
        return Response.json({ ok: false, error: 'server_error' }, { status: 500 });
      }
      mineIdentity = data;
    }
    const target: IdentityRow | null = targetIdentity.data;

    // ── Case 4: no-op — already yours ───────────────────────────────────────
    if (mineIdentity && target && mineIdentity.id === target.id) {
      return Response.json({ ok: true, nickname: target.nickname, unchanged: true });
    }

    // ── Case 2: link/switch this device onto an existing identity ─────────
    if (target) {
      if (isLocked(target)) {
        return Response.json({ ok: false, error: 'locked', locked_until: target.locked_until }, { status: 429 });
      }
      if (!pin) {
        return Response.json({ ok: false, error: 'taken', needs_pin: true }, { status: 409 });
      }
      const correct = await checkPinOrThrottle(db, target, pin);
      if (!correct) {
        return Response.json({ ok: false, error: 'wrong_pin' }, { status: 403 });
      }

      // Upsert, not update: device_id is the primary key on identity_devices,
      // so this either creates this device's first link or repoints its
      // existing link — either way it's scoped to this one row and never
      // touches any other device linked to `target` (or to mineIdentity, if
      // this device was previously linked elsewhere).
      const { error: linkErr } = await db
        .from('identity_devices')
        .upsert({ device_id: deviceId, identity_id: target.id, linked_at: new Date().toISOString() });
      if (linkErr) {
        console.error('claim-nickname: link error', linkErr);
        return Response.json({ ok: false, error: 'server_error' }, { status: 500 });
      }
      // Clear the lock state on success (mirrors the old restore behavior).
      await db.from('identities').update({ failed_attempts: 0, locked_until: null }).eq('id', target.id);

      return Response.json({ ok: true, nickname: target.nickname, linked: true });
    }

    // ── Case 3: rename — this device owns an identity, new name is free ───
    if (mineIdentity) {
      if (isLocked(mineIdentity)) {
        return Response.json({ ok: false, error: 'locked', locked_until: mineIdentity.locked_until }, { status: 429 });
      }
      // Checked before requiring/verifying the PIN: no point making someone
      // enter their PIN correctly just to be told the name itself is no good.
      if (await nicknameIsFlagged(rawNickname)) {
        return Response.json({ ok: false, error: 'flagged_nickname' }, { status: 422 });
      }
      if (!pin) {
        return Response.json({ ok: false, error: 'pin_required' }, { status: 400 });
      }
      const correct = await checkPinOrThrottle(db, mineIdentity, pin);
      if (!correct) {
        return Response.json({ ok: false, error: 'wrong_pin' }, { status: 403 });
      }

      const renamePatch: Record<string, unknown> = {
        nickname: rawNickname,
        nickname_lower: nicknameLower,
        failed_attempts: 0,
        updated_at: new Date().toISOString(),
      };
      const renameAvatar = await fetchIdenticonSvg(rawNickname);
      if (renameAvatar !== null) renamePatch.avatar_svg = renameAvatar;

      const { error: renameErr } = await db
        .from('identities')
        .update(renamePatch)
        .eq('id', mineIdentity.id);
      if (renameErr) {
        // Most likely a race: someone else claimed this exact name between
        // our lookup above and this update (nickname_lower is unique).
        console.error('claim-nickname: rename error', renameErr);
        return Response.json({ ok: false, error: 'taken' }, { status: 409 });
      }

      // The identity's OWN name on every message it ever posted updates for
      // free, everywhere, via forum_messages_public's join to identities —
      // nothing to do there. But an "@OldName" mention someone ELSE typed
      // is just plain text baked into their message body at post time, not
      // a live reference — it doesn't move on its own. Best-effort fix that
      // up across every message, everywhere, right now.
      const mentionsRewritten = await rewriteMentionsAfterRename(db, mineIdentity.nickname_lower, rawNickname);

      return Response.json({ ok: true, nickname: rawNickname, renamed: true, mentions_rewritten: mentionsRewritten });
    }

    // ── Case 1: brand new claim ─────────────────────────────────────────────
    if (await nicknameIsFlagged(rawNickname)) {
      return Response.json({ ok: false, error: 'flagged_nickname' }, { status: 422 });
    }

    const newPin = randomPin();
    const salt = randomHex(16);
    const pinHash = await hashPin(newPin, salt);
    const newAvatar = await fetchIdenticonSvg(rawNickname);

    const { data: created, error: insertErr } = await db
      .from('identities')
      .insert({
        nickname: rawNickname,
        nickname_lower: nicknameLower,
        pin_hash: pinHash,
        pin_salt: salt,
        ...(newAvatar !== null ? { avatar_svg: newAvatar } : {}),
      })
      .select('id')
      .single();
    if (insertErr || !created) {
      // Most likely a race: someone else claimed this exact name a moment ago.
      console.error('claim-nickname: insert error', insertErr);
      return Response.json({ ok: false, error: 'taken' }, { status: 409 });
    }

    const { error: linkErr } = await db
      .from('identity_devices')
      .insert({ device_id: deviceId, identity_id: created.id });
    if (linkErr) {
      // Roll back the orphaned identity rather than leaving an unreachable
      // claimed nickname with no linked device.
      console.error('claim-nickname: initial link error', linkErr);
      await db.from('identities').delete().eq('id', created.id);
      return Response.json({ ok: false, error: 'server_error' }, { status: 500 });
    }

    return Response.json({ ok: true, nickname: rawNickname, pin: newPin, created: true });
  }),
};