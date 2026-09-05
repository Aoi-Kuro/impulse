// Edge Function: edit-message
//
// Deploy as a NEW Edge Function named "edit-message". Same auth mode as the
// others: "publishable", "Verify JWT with legacy secret" OFF. Uses
// OPENAI_API_KEY, already set project-wide for post-message/claim-nickname
// (Edge Function secrets are shared across every function in a project),
// nothing new to configure.
//
// Request: { device_id, message_id, body?, scope?, problem_key? }
//
// `body` present   -> content edit (re-moderated, see below).
// `scope` present  -> topic edit (`problem_key` should come with it; null/
//                     omitted with scope:"global" means "move to Global").
// Either or both can be sent in the same call — editing text and moving it
// to a different quiz/problem at the same time is one request, not two.
//
// Rules:
//   - Only the identity that posted a claimed-nickname message — or, for an
//     anonymous/free-text message, only the exact device that posted it —
//     may edit it. Checked against forum_messages.identity_id, stamped once
//     at insert time (see migration 004) and never re-evaluated afterward,
//     specifically so that exiting a device (which unlinks it from its
//     identity) actually revokes edit access to that identity's past
//     messages instead of leaving it editable forever via a literal
//     device_id match. See the ownership-resolution block below for the
//     full reasoning. Never trust the client for this regardless — it's
//     enforced here even though the client only ever shows the Edit button
//     on what it thinks are the user's own messages.
//   - flag_status === "deleted" (red-flagged) blocks ALL edits, content and
//     topic both. A removed message stays removed, full stop.
//   - A topic-only edit (no `body`, or `body` sent but identical to what's
//     already stored) never touches flag_status/flag_reason and never calls
//     moderation — the words didn't change, so whatever moderation verdict
//     already applies still applies.
//   - Any edit that actually changes the body re-runs it through the same
//     OpenAI moderation gate a brand-new post goes through (see
//     post-message.ts). If it's flagged, the whole edit is rejected — the
//     old body (and old scope, if that was part of the same request) stays
//     exactly as it was, nothing is written — same as how a bad brand-new
//     post never gets inserted in the first place. If it passes, the new
//     body is saved AND flag_status/flag_reason are reset to null, even if
//     the message was previously "kept" (green-flagged) — a prior
//     flag-message.ts verdict was a judgment of the OLD words, not these
//     ones, so an edited "kept" message becomes flaggable again by the
//     community under its new wording, exactly like a fresh post would be.
//   - A body change also stamps `edited_at` (requires
//     sql/3_forum_messages_edited_at.sql to have been run — adds the
//     column and exposes it via forum_messages_public). Deliberately only
//     on a real content change, not a scope/topic-only move — matches
//     js/forum.js's submitForumEditMessage(), which already only sends
//     `body` in the payload when it actually differs from the original, and
//     matches what an "(ed.)" tag on the message intuitively promises a
//     reader: the words changed, not just which quiz thread it's filed
//     under. If that's not the behavior you want, move the
//     `patch.edited_at = ...` line out of the `if (bodyActuallyChanged)`
//     block below so it's set on any successful edit instead.

import { withSupabase } from 'npm:@supabase/server@^1';

function isUuid(v: unknown): v is string {
  return typeof v === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
}

// ── Device-secret verification (see migration 001_device_secrets.sql) ──────
// device_id alone is public (forum_messages_public exposes it to every
// reader) so it can't prove "this is my device" on its own — device_secret
// is the actual proof, generated once on the client and never sent
// anywhere except by its own owner. Trust-on-first-use: the first request
// ever seen for a device_id registers its secret; every later request for
// that device_id must match it. Duplicated per-function rather than
// shared-imported, matching this codebase's existing convention (see
// claim-nickname.ts's own copy of sha256Hex/randomHex).
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

async function verifyOrRegisterDevice(db: any, deviceId: string, secret: unknown): Promise<boolean> {
  if (!DEVICE_SECRET_PEPPER || typeof secret !== 'string' || secret.length < 16 || secret.length > 200) {
    return false;
  }
  const { data: row, error } = await db
    .from('device_secrets').select('secret_hash, secret_salt').eq('device_id', deviceId).maybeSingle();
  if (error) { console.error('edit-message: device-auth lookup error', error); return false; }

  if (!row) {
    const salt = randomHex(16);
    const hash = await sha256Hex(`${DEVICE_SECRET_PEPPER}:${salt}:${secret}`);
    const { error: insErr } = await db
      .from('device_secrets').insert({ device_id: deviceId, secret_hash: hash, secret_salt: salt });
    if (!insErr) return true;
    const { data: retryRow, error: retryErr } = await db
      .from('device_secrets').select('secret_hash, secret_salt').eq('device_id', deviceId).maybeSingle();
    if (retryErr || !retryRow) { console.error('edit-message: device-auth race-retry error', retryErr); return false; }
    const retryHash = await sha256Hex(`${DEVICE_SECRET_PEPPER}:${retryRow.secret_salt}:${secret}`);
    return retryHash === retryRow.secret_hash;
  }

  const candidateHash = await sha256Hex(`${DEVICE_SECRET_PEPPER}:${row.secret_salt}:${secret}`);
  return candidateHash === row.secret_hash;
}

const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY');
const OPENAI_MODERATION_MODEL = 'omni-moderation-latest';

// Same fail-open stance as claim-nickname.ts's nicknameIsFlagged(): a
// moderation-API outage shouldn't be able to permanently block someone from
// editing their own message. Worst case here is no worse than a moderation
// outage at original post time would have been.
async function bodyIsFlagged(body: string): Promise<boolean> {
  if (!OPENAI_API_KEY) {
    console.error('edit-message: OPENAI_API_KEY secret is not set — skipping moderation check');
    return false;
  }
  try {
    const res = await fetch('https://api.openai.com/v1/moderations', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify({ model: OPENAI_MODERATION_MODEL, input: body }),
    });
    if (!res.ok) {
      console.error('edit-message: OpenAI moderation API error', await res.text());
      return false;
    }
    const data = await res.json();
    return !!data?.results?.[0]?.flagged;
  } catch (err) {
    console.error('edit-message: OpenAI moderation call failed', err);
    return false;
  }
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
    const messageId = Number(payload?.message_id);
    const hasBodyEdit = typeof payload?.body === 'string';
    const newBody = hasBodyEdit ? payload.body.trim() : undefined;
    const hasScopeEdit = typeof payload?.scope === 'string';
    const newScope: string | undefined = hasScopeEdit ? payload.scope : undefined;
    const newProblemKey: string | null = typeof payload?.problem_key === 'string' ? payload.problem_key : null;

    if (!isUuid(deviceId)) {
      return Response.json({ ok: false, error: 'invalid_device_id' }, { status: 400 });
    }
    if (!(await verifyOrRegisterDevice(ctx.supabaseAdmin, deviceId, payload?.device_secret))) {
      return Response.json({ ok: false, error: 'device_auth_failed' }, { status: 403 });
    }
    if (!Number.isInteger(messageId) || messageId <= 0) {
      return Response.json({ ok: false, error: 'invalid_message_id' }, { status: 400 });
    }
    if (hasBodyEdit && newBody.length === 0) {
      return Response.json({ ok: false, error: 'empty_body' }, { status: 400 });
    }
    if (hasScopeEdit && newScope !== 'global' && newScope !== 'problem') {
      return Response.json({ ok: false, error: 'invalid_scope' }, { status: 400 });
    }
    if (!hasBodyEdit && !hasScopeEdit) {
      return Response.json({ ok: false, error: 'nothing_to_edit' }, { status: 400 });
    }

    const db = ctx.supabaseAdmin;

    const { data: msg, error: findErr } = await db
      .from('forum_messages')
      .select('id, device_id, body, flag_status, identity_id')
      .eq('id', messageId)
      .maybeSingle();
    if (findErr) {
      console.error('edit-message: lookup error', findErr);
      return Response.json({ ok: false, error: 'server_error' }, { status: 500 });
    }
    if (!msg) {
      return Response.json({ ok: false, error: 'not_found' }, { status: 404 });
    }
    // Ownership resolution — mirrors the read-side fix in migration 004
    // (forum_messages.identity_id, stamped once by post-message.ts at
    // insert time, never re-evaluated afterward). This used to be a LIVE
    // identity_devices join instead (device_id -> whichever identity that
    // device_id resolves to RIGHT NOW), with a literal device_id match
    // checked FIRST and unconditionally — which is exactly the same live-
    // join bug 004 fixed for authorship display, just on the write path:
    //   1. Exiting a device deletes its identity_devices row, but never
    //      rotates the device's own local device_id — so the literal
    //      match kept succeeding forever, on every message that device had
    //      EVER posted under ANY identity, sign-out or not. "Exit" was
    //      cosmetic for edit access: it hid the identity UI and required
    //      re-claiming to post NEW messages, but never actually revoked
    //      edit rights over the old ones.
    //   2. On a shared device, claiming a second nickname after the first
    //      exits doesn't create a new device_id either — so the SECOND
    //      person's browser could edit the FIRST person's old messages
    //      too, with no PIN or login involved, purely because they happen
    //      to share physical hardware.
    // Using the stamped identity_id instead closes both: a message posted
    // under a claimed identity can only be edited by whichever identity
    // CURRENTLY owns the requesting device_id (a live identity_devices
    // lookup, but compared against the frozen identity_id rather than
    // against another live lookup on the message's own device_id) — so a
    // device with nothing linked at all (exited) has nothing to match,
    // and a device linked to a DIFFERENT identity doesn't match either.
    // Renaming still edits fine, same as 004: identity_id never changes on
    // rename, only the identities row's nickname/avatar_svg do.
    let isOwner: boolean;
    if (msg.identity_id) {
      const { data: reqLink, error: reqErr } = await db
        .from('identity_devices').select('identity_id').eq('device_id', deviceId).maybeSingle();
      if (reqErr) {
        console.error('edit-message: identity lookup error', reqErr);
        return Response.json({ ok: false, error: 'server_error' }, { status: 500 });
      }
      isOwner = !!(reqLink && reqLink.identity_id === msg.identity_id);
    } else {
      // Anonymous/free-text message — posted before this device_id ever
      // claimed a nickname, so there's no identity to check against. Only
      // the exact device_id that posted it may edit it, same as before.
      isOwner = msg.device_id === deviceId;
    }
    if (!isOwner) {
      return Response.json({ ok: false, error: 'not_your_message' }, { status: 403 });
    }
    if (msg.flag_status === 'deleted') {
      return Response.json({ ok: false, error: 'deleted' }, { status: 403 });
    }

    const bodyActuallyChanged = hasBodyEdit && newBody !== msg.body;

    // Moderation runs (and can reject the whole request) BEFORE anything is
    // written — same as a brand-new post never getting inserted at all if
    // it fails the same check, rather than saving first and cleaning up
    // after.
    if (bodyActuallyChanged && await bodyIsFlagged(newBody!)) {
      return Response.json({ ok: false, error: 'flagged_body' }, { status: 422 });
    }

    const patch: Record<string, unknown> = {};

    if (bodyActuallyChanged) {
      patch.body = newBody;
      // Re-opens it to community review under the new wording — see the
      // header comment for why this resets even a previously-"kept"
      // message, not just null/reviewing ones.
      patch.flag_status = null;
      patch.flag_reason = null;
      // Drives the "(ed.)" tag in js/forum.js — see the header comment for
      // why this is scoped to a real body change rather than any edit.
      patch.edited_at = new Date().toISOString();
    }

    if (hasScopeEdit) {
      patch.scope = newScope;
      patch.problem_key = newScope === 'problem' ? newProblemKey : null;
    }

    if (Object.keys(patch).length === 0) {
      // `body` was sent but identical to what's already stored, and no
      // scope change either — nothing actually changed. Harmless no-op,
      // not an error.
      return Response.json({ ok: true, unchanged: true });
    }

    const { error: updateErr } = await db.from('forum_messages').update(patch).eq('id', messageId);
    if (updateErr) {
      console.error('edit-message: update error', updateErr);
      return Response.json({ ok: false, error: 'server_error' }, { status: 500 });
    }

    return Response.json({ ok: true, edited: true, reopened_for_review: bodyActuallyChanged });
  }),
};