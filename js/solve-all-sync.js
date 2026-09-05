// ─── Solve-all progress sync ────────────────────────────────────────────────
// Cross-device sync for whichever solve-all session (one quiz_num +
// cumulative-mode combo) is currently open. Mirrors js/attempts-sync.js's
// device_id -> identity resolution and "client owns the merge" approach,
// but the merge itself has to be different: quiz attempts are an
// append-only log (dedup by hash), while solve-all progress is a single
// mutable per-problem status map — two devices solving the same quiz
// independently need a UNION merge (whichever side solved a given problem
// "more", keep that), not a last-write-wins overwrite.
//
// Sync points, matching what was asked:
//   - Pull + union-merge + push once when solve-all opens.
//   - Immediately again the moment the tab regains focus (visibilitychange,
//     bottom of this file) — background tabs get their timers throttled
//     hard by the browser, so without this a session left open but
//     unfocused could sit stale far longer than 15s; the moment you switch
//     back is exactly when you want it caught up, same pattern already
//     used by js/attempts-sync.js and js/stats.js.
//   - One more push on exit (best-effort, catches whatever the last
//     periodic tick missed).
//   - Reset upserts a *tombstone* (data: null), not a delete. A missing row
//     can't be told apart from "never synced," but a row with data:null
//     unambiguously means "this was reset since you last synced — clear
//     your stale local copy too," which is what makes a reset actually
//     stick on another device instead of the union-merge quietly
//     resurrecting it. It also fires immediately on click, not on the next
//     periodic push. Discovering one mid-session (see _saSyncRoundTrip's
//     handling below) exits back to the choice/order picker
//     (handleRemoteSolveAllReset, js/quiz-engine.js) — same UX as pressing
//     Reset locally, rather than silently zeroing in place and leaving the
//     device sitting on a screen that now just looks like a brand-new
//     session.
//
// All of the above is cross-DEVICE sync (through the cloud). Two tabs/
// windows of the same browser get an additional, purely-local shortcut on
// top of it — see the BroadcastChannel section near the bottom of this
// file — since they don't need to wait on a network round trip to talk to
// each other at all.

const SA_SYNC_POLL_MS = 15000;
let _saSyncPollTimer = null;
let _saSyncActive = null;        // { quizNum, cumulative } while a session is open
const _saPendingReset = new Set(); // "quizNum_cum" keys mid-reset — pushes for that key are skipped

function _saSyncKey(quizNum, cumulative) { return `${quizNum}_${cumulative ? 'c' : 's'}`; }

// Higher = "more resolved". Used to pick a winner per-problem when merging
// two devices' independent progress on the same quiz — never lose a
// solved/revealed problem from either side.
function _saStatusRank(status) {
  if (status === 'correct')  return 3;
  if (status === 'revealed') return 2;
  if (status === 'partial' || status === 'wrong') return 1;
  return 0;
}

// Union-merge two saved solve-all snapshots ({order, checkedById, lockedIds,
// answersById}) into one. Ties (equal rank both sides) keep local's.
function mergeSolveAllSnapshots(local, server) {
  if (!server) return local;
  if (!local)  return server;

  const checkedById = { ...local.checkedById };
  const lockedSet = new Set(local.lockedIds || []);
  const answersById = { ...local.answersById };

  Object.keys(server.checkedById || {}).forEach(id => {
    if (_saStatusRank(server.checkedById[id]) > _saStatusRank(checkedById[id])) {
      checkedById[id] = server.checkedById[id];
    }
  });
  (server.lockedIds || []).forEach(id => lockedSet.add(id));
  Object.keys(server.answersById || {}).forEach(id => {
    if (!(id in answersById)) answersById[id] = server.answersById[id];
  });

  return {
    order: (local.order && local.order.length) ? local.order : server.order,
    checkedById,
    lockedIds: [...lockedSet],
    answersById,
  };
}

function _saHeaders() {
  return {
    'Content-Type': 'application/json',
    'apikey': SUPABASE_PUBLISHABLE_KEY,
    'Authorization': `Bearer ${SUPABASE_PUBLISHABLE_KEY}`,
  };
}

// Returns null on network/server failure, or { found, data } — data is null
// for both "never synced" (found:false) and "explicitly reset" (found:true).
async function pullSolveAllProgress(quizNum, cumulative) {
  const deviceId = (typeof getForumDeviceId === 'function') ? getForumDeviceId() : null;
  const deviceSecret = (typeof getForumDeviceSecret === 'function') ? getForumDeviceSecret() : null;
  if (!deviceId) return null;
  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/sync-solve-all`, {
      method: 'POST',
      headers: _saHeaders(),
      body: JSON.stringify({ device_id: deviceId, device_secret: deviceSecret, quiz_num: quizNum, cumulative: !!cumulative, action: 'pull' }),
    });
    const json = await res.json().catch(() => null);
    if (!res.ok || !json || !json.ok) return null;
    return { found: !!json.found, data: json.data ?? null };
  } catch (e) {
    console.error('Solve-all pull error:', e);
    return null;
  }
}

async function pushSolveAllProgress(quizNum, cumulative, snapshot) {
  const key = _saSyncKey(quizNum, cumulative);
  if (_saPendingReset.has(key)) return false; // a reset just fired for this session — don't resurrect it
  const deviceId = (typeof getForumDeviceId === 'function') ? getForumDeviceId() : null;
  const deviceSecret = (typeof getForumDeviceSecret === 'function') ? getForumDeviceSecret() : null;
  if (!deviceId) { _setSolveAllSyncDot('gray'); return false; }
  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/sync-solve-all`, {
      method: 'POST',
      headers: _saHeaders(),
      body: JSON.stringify({ device_id: deviceId, device_secret: deviceSecret, quiz_num: quizNum, cumulative: !!cumulative, action: 'push', data: snapshot }),
    });
    const json = await res.json().catch(() => null);
    const ok = !!(res.ok && json && json.ok);
    _setSolveAllSyncDot(ok ? 'green' : 'red');
    return ok;
  } catch (e) {
    console.error('Solve-all push error:', e);
    _setSolveAllSyncDot('red');
    return false;
  }
}

async function resetSolveAllProgressOnServer(quizNum, cumulative) {
  const key = _saSyncKey(quizNum, cumulative);
  _saPendingReset.add(key);
  const deviceId = (typeof getForumDeviceId === 'function') ? getForumDeviceId() : null;
  const deviceSecret = (typeof getForumDeviceSecret === 'function') ? getForumDeviceSecret() : null;
  if (!deviceId) { _saPendingReset.delete(key); return false; }
  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/sync-solve-all`, {
      method: 'POST',
      headers: _saHeaders(),
      body: JSON.stringify({ device_id: deviceId, device_secret: deviceSecret, quiz_num: quizNum, cumulative: !!cumulative, action: 'reset' }),
    });
    const json = await res.json().catch(() => null);
    return !!(res.ok && json && json.ok);
  } catch (e) {
    console.error('Solve-all reset error:', e);
    return false;
  } finally {
    // Keep the guard up a bit longer so a periodic push already in flight
    // right before the reset can't land after it and resurrect the row —
    // same reasoning as _pendingDeleteHashes in js/attempts-sync.js.
    setTimeout(() => _saPendingReset.delete(key), SA_SYNC_POLL_MS);
  }
}

// ── Dot on the floating score badge — reuses the exact same shared state
// machine as the Attempt log dot (_settleLiveDot, js/attempts-sync.js):
// green pulse (ok), gray pulse (syncing/pending), static red (error). No
// "hidden" state here even before a name is claimed — this is a small
// floating widget, not a title suffix, so it always shows something rather
// than disappearing.
function _setSolveAllSyncDot(state) {
  const dot = document.getElementById('solveAllSyncDot');
  if (!dot) return;
  if (typeof _settleLiveDot !== 'function') return;
  if (state === 'green') _settleLiveDot(dot, 'ok', 'Synced');
  else if (state === 'red') _settleLiveDot(dot, 'error', "Couldn't sync — will retry automatically");
  else _settleLiveDot(dot, 'syncing', 'Not synced yet');
}

// One full round trip for a session: pull the server's current copy,
// either merge it in or wipe local (if it was explicitly reset elsewhere),
// then push the result back. Used both once on open and on every periodic
// tick — a session left open on one device needs to actually notice
// changes made on another device while both stay open, not just push its
// own state outward and wait for the next full reopen to look again.
//
// isInitial distinguishes "just opening/starting this session" from "this
// session is already up and running" — they need different reactions to
// finding a tombstone (data:null). A tombstone left over from a reset never
// gets cleared by a push (see the reset-branch comment below for why), so
// the FIRST device to open a fresh session after any reset — including the
// very device that did the resetting — will still find that same tombstone
// sitting there. If that were treated as "someone else just reset us,"
// starting any new session right after a reset would immediately bounce
// straight back out to the choice/order picker, on every device, forever.
// So: on open, a tombstone is simply "nothing to resume," same as no row at
// all — start fresh normally, and the push a few lines down naturally
// converts it into a real (if empty) row, which is what stops every
// following tick from seeing "reset" for what's now just this device's own
// brand-new progress. Only once a session is already actively running does
// a newly-appeared tombstone mean a genuine "someone else reset this out
// from under me," worth exiting for.
async function _saSyncRoundTrip(quizNum, cumulative, isInitial) {
  const key = _saSyncKey(quizNum, cumulative);
  if (isInitial) {
    // Starting a brand-new session for this exact quiz/cumulative combo is
    // unambiguous evidence we're past whatever reset happened before it —
    // clear any lingering guard for this key rather than let it also
    // block THIS session's very first push. Without this: if a new
    // session opens within resetSolveAllProgressOnServer's guard window
    // (SA_SYNC_POLL_MS after a Reset — a near-certainty for "reset, then
    // immediately pick the same quiz again"), that first push — the one
    // that would finally overwrite the server's tombstone with a real,
    // if empty, row — gets silently dropped by pushSolveAllProgress's own
    // guard check. The tombstone then just sits there until this same
    // session's first periodic poll (~SA_SYNC_POLL_MS later, i.e. almost
    // exactly when the dropped push would have landed) — which, being a
    // periodic tick rather than an open, treats a tombstone as "someone
    // else reset this" and discards whatever the user solved in the
    // meantime, bouncing them back to the choice/order picker. The
    // original guard exists only to stop an old in-flight push from an
    // already-ended session resurrecting the row right after a reset —
    // by the time a user has clicked back through the picker and started
    // a genuinely new session, any such stale request has long since
    // resolved one way or the other, so there's nothing left to protect
    // once we're here.
    _saPendingReset.delete(key);
  }

  const identityName = (typeof getForumNickname === 'function') ? getForumNickname() : '';
  if (!identityName) { _setSolveAllSyncDot('gray'); return; }

  const pulled = await pullSolveAllProgress(quizNum, cumulative);
  if (pulled === null) {
    _setSolveAllSyncDot('red');
  } else if (pulled.found && pulled.data === null && !isInitial) {
    // Reset elsewhere since this device last synced — mirror the exact UX
    // of pressing Reset locally (handleRemoteSolveAllReset,
    // js/quiz-engine.js): exit back to the choice/order picker, rather
    // than applySolveAllReset() alone, which only zeroes the numbers in
    // place and leaves this device sitting on the same screen looking
    // exactly like a brand-new session — not like something that just got
    // reset. Return here instead of falling through to the push below:
    // the session's over, not continuing with a freshly-emptied state, and
    // pushing right now would overwrite the server's tombstone (data:null)
    // with a real empty row for no benefit.
    if (typeof handleRemoteSolveAllReset === 'function') handleRemoteSolveAllReset();
    else if (typeof applySolveAllReset === 'function') applySolveAllReset(); // fallback if not loaded
    return;
  } else if (pulled.data) {
    if (typeof applySolveAllMerge === 'function') applySolveAllMerge(pulled.data);
  }
  // pulled.found && pulled.data === null && isInitial falls through here on
  // purpose — nothing to merge, straight to the push below.

  const snap = (typeof buildSolveAllSnapshot === 'function') ? buildSolveAllSnapshot() : null;
  if (snap) await pushSolveAllProgress(quizNum, cumulative, snap);
}

async function syncSolveAllOnOpen(quizNum, cumulative) {
  _saSyncActive = { quizNum, cumulative };
  await _saSyncRoundTrip(quizNum, cumulative, /* isInitial */ true);

  if (_saSyncPollTimer) clearInterval(_saSyncPollTimer);
  _saSyncPollTimer = setInterval(() => {
    if (document.hidden || !_saSyncActive) return;
    _saSyncRoundTrip(_saSyncActive.quizNum, _saSyncActive.cumulative, false);
  }, SA_SYNC_POLL_MS);
}

function stopSolveAllSync() {
  if (_saSyncPollTimer) { clearInterval(_saSyncPollTimer); _saSyncPollTimer = null; }
  _saSyncActive = null;
}

// The periodic tick above already skips ticks while the tab is hidden — but
// with no listener to match, a session left open on a backgrounded tab just
// stayed silent until whatever's left of the *next* scheduled tick, and
// background tabs get their timers throttled hard by the browser (some
// browsers cap this to roughly once a minute), so that could be a long
// wait. This is what "doesn't listen for updates until I do something on
// my device" actually was: switching back to the tab (which is usually the
// first thing you do right before solving another problem) is exactly the
// visibilitychange this listener was missing — without it, nothing forced
// an immediate re-check right when you returned, so it looked like only
// your own local action could "wake" the sync back up, on a brand-new
// session with nothing solved yet as much as one with saved progress.
// Mirrors the identical pattern already used for the Attempt log poll
// (js/attempts-sync.js) and the Forum & Site panel poll (js/stats.js). Not
// an "opening" event, so isInitial is false here — a tombstone found this
// way is a genuine externally-triggered reset, not this session's own
// fresh start.
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && _saSyncActive) {
    _saSyncRoundTrip(_saSyncActive.quizNum, _saSyncActive.cumulative, false);
  }
});

// ── Same-browser, cross-tab/window instant sync (BroadcastChannel) ─────────
// Two tabs/windows of the same browser share localStorage but not each
// other's in-memory state, so without this they'd only ever see each
// other's solve-all progress by going through the cloud round trip above —
// same as two different devices, waiting up to 15s (or for a push on
// exit). That's real cross-device latency being paid for no reason when
// it's actually the same browser sitting right there. BroadcastChannel
// talks directly between same-origin contexts with no network round trip
// at all, and — this is the part that also fixes "a background tab
// doesn't update until I switch to it" — delivers to a hidden/backgrounded
// tab's listener immediately, not gated behind the same timer-throttling a
// setInterval is subject to. This is purely an optimization layered on top
// of the cloud sync above, never a replacement for it: a different device
// still needs the cloud round trip, and this channel only ever talks to
// other contexts of this same browser.
const _saChannel = (typeof BroadcastChannel !== 'undefined') ? new BroadcastChannel(STORAGE_PREFIX + '-solve-all-sync') : null;

// Fire-and-forget: a message for a session this tab doesn't currently have
// open is simply ignored by the handler below (nothing to show yet — it'll
// get the real progress from the cloud next time it's actually opened).
function broadcastSolveAllChange() {
  if (!_saChannel || !_saSyncActive) return;
  const snapshot = (typeof buildSolveAllSnapshot === 'function') ? buildSolveAllSnapshot() : null;
  if (!snapshot) return;
  _saChannel.postMessage({
    type: 'progress',
    key: _saSyncKey(_saSyncActive.quizNum, _saSyncActive.cumulative),
    snapshot,
  });
}

function broadcastSolveAllReset(quizNum, cumulative) {
  if (!_saChannel) return;
  _saChannel.postMessage({ type: 'reset', key: _saSyncKey(quizNum, cumulative) });
}

if (_saChannel) {
  _saChannel.onmessage = (ev) => {
    const msg = ev.data;
    // Ignore anything for a session this tab doesn't currently have open,
    // or doesn't match exactly (a different quiz/cumulative combo).
    if (!msg || !_saSyncActive || msg.key !== _saSyncKey(_saSyncActive.quizNum, _saSyncActive.cumulative)) return;

    if (msg.type === 'reset') {
      // Same reasoning as the cloud tombstone case above — mirror the
      // local Reset UX (exit to the choice/order picker) rather than
      // quietly zeroing in place.
      if (typeof handleRemoteSolveAllReset === 'function') handleRemoteSolveAllReset();
    } else if (msg.type === 'progress' && msg.snapshot) {
      if (typeof applySolveAllMerge === 'function') applySolveAllMerge(msg.snapshot);
    }
  };
}

