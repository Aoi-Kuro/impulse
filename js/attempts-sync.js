// ─── Quiz attempt sync ────────────────────────────────────────────────────────
// Pushes any locally-queued (synced:false) attempts and pulls the full
// current server list back down in one round trip, via the
// sync-quiz-attempts Edge Function. Called: on every stats panel open, right
// after recording a new attempt, right after a delete, whenever a Realtime
// Broadcast ping says something changed (see _ensureAttemptsRealtime below —
// this is what replaced the old blind 10s-forever poll), and on a slow
// fallback timer for the whole session (not just while stats is open — see
// startAttemptsSyncPolling below) as a safety net in case a ping is ever
// missed. No visible button for any of this —
// status is conveyed only by the dot next to "Attempt log" (green pulse =
// confirmed up to date, gray pulse = syncing/queued, static red = last
// attempt failed and stays that way until a retry succeeds, hidden = no
// claimed identity yet). See _settleLiveDot below for the shared state
// machine this dot shares with the Forum & Site panel's dot.

let _attemptsSyncing = false;
let _lastSyncFailed = false;

// Hashes currently being deleted server-side (deleteAttemptOnServer, below).
// A pull that races with an in-flight delete would otherwise still see the
// row on the server and merge it right back in locally — this set makes
// syncAttempts() treat those hashes as gone regardless of what the pull
// returns, for as long as the delete request is outstanding.
const _pendingDeleteHashes = new Set();

function _setSyncButtonState(state) {
  _updateAttemptsSyncDot(state === 'syncing');
}

// ── Shared "live dot" state machine ─────────────────────────────────────────
// Drives both the Attempt log sync dot (#attemptsSyncDot, below) and the
// Forum & Site panel dot (#sfpLiveDot, js/stats.js) with identical behavior:
//   ok      — green pulse, last refresh succeeded and nothing's queued
//   syncing — same pulse, gray — a refresh is in flight, or something is
//             queued but not yet confirmed
//   error   — solid red, no pulse — last refresh failed (background poll
//             keeps retrying regardless)
//   hidden  — invisible — nothing to show yet (e.g. no claimed identity)
// ok <-> syncing is always an instant color morph — the pulse animation
// itself is never stopped for that transition (see .sfp-live-dot-syncing in
// css/stats.css), so there's nothing to interrupt going back and forth
// between them. Only moving INTO a static state (error/hidden) needs to
// actually stop the pulse — that always waits for the current cycle to
// finish first (via 'animationiteration'), so the animation comes to rest
// at its own natural low point instead of being frozen mid-swing.
const LIVE_DOT_PULSING = { ok: true, syncing: true, error: false, hidden: false };
const LIVE_DOT_CLASS = { ok: null, syncing: 'sfp-live-dot-syncing', error: 'sfp-live-dot-error', hidden: 'sfp-live-dot-hidden' };

function _settleLiveDot(dot, mode, title) {
  if (!dot) return;

  // A newer request always supersedes an older one still waiting on the
  // pulse to finish — cancel it so it can't apply stale state later.
  if (dot._pendingSettle) {
    dot.removeEventListener('animationiteration', dot._pendingSettle);
    dot._pendingSettle = null;
  }

  const apply = () => {
    dot.classList.remove('sfp-live-dot-syncing', 'sfp-live-dot-error', 'sfp-live-dot-hidden');
    const cls = LIVE_DOT_CLASS[mode];
    if (cls) dot.classList.add(cls);
    if (title !== undefined) dot.title = title;
  };

  const currentlyStatic = dot.classList.contains('sfp-live-dot-error') || dot.classList.contains('sfp-live-dot-hidden');
  if (LIVE_DOT_PULSING[mode] || currentlyStatic) {
    apply(); // pulsing target, or already at rest — nothing to wait on
    return;
  }
  const onIteration = () => { dot._pendingSettle = null; apply(); };
  dot._pendingSettle = onIteration;
  dot.addEventListener('animationiteration', onIteration, { once: true });
}

// Dot next to "Attempt log": green pulse when confirmed synced and nothing
// queued, gray (still pulsing, see _settleLiveDot above) while a sync is in
// flight or something is still only queued locally, static red when the
// last sync attempt failed, hidden only when there's no claimed identity to
// sync to at all. This runs on every background poll tick too (the 10s
// interval below keeps ticking for the whole session, not just while stats
// is open), so a failed retry shows red the whole time between retries, not
// just the moment you happen to be looking.
function _updateAttemptsSyncDot(syncing) {
  const dot = document.getElementById('attemptsSyncDot');
  if (!dot) return;
  const identityName = (typeof getForumNickname === 'function') ? getForumNickname() : '';

  if (!identityName) {
    dot.style.display = '';
    _settleLiveDot(dot, 'hidden');
    return;
  }
  dot.style.display = '';

  if (syncing) {
    _settleLiveDot(dot, 'syncing', 'Syncing…');
    return;
  }
  if (_lastSyncFailed) {
    _settleLiveDot(dot, 'error', "Couldn't sync — will retry automatically");
    return;
  }
  const upToDate = loadStats().every(a => a.synced);
  if (upToDate) {
    _settleLiveDot(dot, 'ok', 'Synced');
  } else {
    _settleLiveDot(dot, 'syncing', 'Sync pending…');
  }
}

// ── Realtime wake-up ─────────────────────────────────────────────────────
// quiz_attempts holds another identity's answers, so unlike js/forum.js's
// shared channel (which subscribes directly to the already-public
// forum_messages table), we can't just open this table to Postgres Changes
// without exposing everyone's history to everyone. Instead a DB trigger
// (superbase/migrations/003_attempts_realtime_broadcast.sql) sends a tiny,
// content-free "something changed" ping to a channel named after this
// identity's identity_id, the moment ANY device syncs a change for it. This
// listens for that ping and, on one, runs the exact same secure
// sync-quiz-attempts round trip as before — just on demand instead of every
// 10 seconds regardless. identity_id itself is learned from the sync
// response below (already resolved server-side, so this costs nothing
// extra) rather than stored — cheap to relearn on each page load, and it
// means a nickname change/drop can't leave this pointed at a stale channel.
let _attemptsIdentityId = null;
let _attemptsRealtimeChannel = null;
let _attemptsRealtimeEverConnected = false;
let _attemptsBroadcastDebounce = null;

function _onAttemptsBroadcast() {
  // A multi-attempt push fires this once per row, and our own push echoes
  // back to us too (we're subscribed to our own identity's channel) — a
  // short debounce coalesces all of that into one syncAttempts() call
  // instead of several back-to-back ones.
  if (_attemptsBroadcastDebounce) clearTimeout(_attemptsBroadcastDebounce);
  _attemptsBroadcastDebounce = setTimeout(() => {
    _attemptsBroadcastDebounce = null;
    syncAttempts();
    // js/stats.js's total/my quiz-count dials are driven by RPCs, not a
    // table Realtime can subscribe to directly — piggyback on this ping
    // instead of giving that panel a channel of its own.
    document.dispatchEvent(new Event('attempts-data-changed'));
  }, 3000);
}

function _ensureAttemptsRealtime(identityId) {
  if (!identityId || identityId === _attemptsIdentityId) return; // already on the right channel (or nothing to subscribe to yet)
  _teardownAttemptsRealtime();
  _attemptsIdentityId = identityId;
  const client = (typeof getForumClient === 'function') ? getForumClient() : null;
  if (!client) return;
  _attemptsRealtimeChannel = client
    .channel('attempts:' + identityId)
    .on('broadcast', { event: 'changed' }, _onAttemptsBroadcast)
    .subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        // Reconnected after actually dropping (not the first connect,
        // already covered by this sync's own immediate call) — something
        // could have changed while we were gone, so catch up now rather
        // than wait for the next ping or the slow fallback timer. This
        // also naturally settles the dot to a fresh ok/error result,
        // rather than leaving it on whatever it showed before the drop.
        if (_attemptsRealtimeEverConnected) syncAttempts();
        _attemptsRealtimeEverConnected = true;
        return;
      }
      // CHANNEL_ERROR / TIMED_OUT / CLOSED after having been up — the
      // socket dropped for a reason that might have nothing to do with an
      // actual sync attempt failing (server restart, brief network blip),
      // so without this the dot would just sit on stale "green" until
      // something else happens to fail or the 3-minute fallback tick
      // fires. Surface it immediately instead.
      if (_attemptsRealtimeEverConnected) {
        _lastSyncFailed = true;
        _updateAttemptsSyncDot(false);
      }
    });
}

function _teardownAttemptsRealtime() {
  if (_attemptsRealtimeChannel) {
    const client = (typeof getForumClient === 'function') ? getForumClient() : null;
    if (client) client.removeChannel(_attemptsRealtimeChannel);
  }
  _attemptsRealtimeChannel = null;
  _attemptsRealtimeEverConnected = false;
  _attemptsIdentityId = null;
}

// ── Connectivity-aware dots ──────────────────────────────────────────────
// navigator.onLine flips the moment the OS itself reports the network is
// down — far faster than waiting for an in-flight request to time out, or
// for the 3-minute fallback tick. Covers all three live dots this project
// has (Attempt log, Forum & Site panel, Solve-All), since none of them are
// meaningful to show as "synced" while genuinely offline regardless of
// which one's own channel happens to notice first.
window.addEventListener('offline', () => {
  _lastSyncFailed = true;
  _updateAttemptsSyncDot(false);
  const sfpDot = document.getElementById('sfpLiveDot');
  if (sfpDot && typeof _settleLiveDot === 'function') _settleLiveDot(sfpDot, 'error', "Offline — will retry automatically");
  if (typeof _setSolveAllSyncDot === 'function' && typeof _saSyncActive !== 'undefined' && _saSyncActive) _setSolveAllSyncDot('red');
});

window.addEventListener('online', () => {
  // Don't just flip back to green optimistically — actually re-check each
  // thing that's currently relevant, so every dot reflects a real, current
  // result the instant connectivity returns rather than a guess.
  syncAttempts();
  if (typeof pollStatsPanel === 'function' && document.getElementById('sfpLiveDot')) pollStatsPanel();
  if (typeof _saSyncActive !== 'undefined' && _saSyncActive && typeof _saSyncRoundTrip === 'function') {
    _saSyncRoundTrip(_saSyncActive.quizNum, _saSyncActive.cumulative, false);
  }
});

async function syncAttempts() {
  if (_attemptsSyncing) return; // already in flight — the caller's own next open/click will pick up the result
  const identityName = (typeof getForumNickname === 'function') ? getForumNickname() : '';
  if (!identityName) {
    _teardownAttemptsRealtime(); // no identity to sync to (or listen for) anymore
    return; // nothing to sync to yet — quiz start already gates on this, but stats can still be opened without ever starting one
  }

  const deviceId = (typeof getForumDeviceId === 'function') ? getForumDeviceId() : null;
  const deviceSecret = (typeof getForumDeviceSecret === 'function') ? getForumDeviceSecret() : null;
  if (!deviceId || typeof SUPABASE_URL === 'undefined' || typeof SUPABASE_PUBLISHABLE_KEY === 'undefined') return;

  _attemptsSyncing = true;
  _setSyncButtonState('syncing');

  try {
    const local = loadStats();
    const pending = local.filter(a => !a.synced).map(a => ({
      attempt_hash: a.hash,
      quiz_num: a.quizNum,
      mode: a.mode,
      duration_seconds: a.duration || 0,
      score: a.score,
      max_score: a.maxScore,
      answers: (a.answers || []).map(x => ({
        problem_id: x.problem_id,
        quiz_num: x.quiz_num,
        entered_value: x.entered_value,
        entered_unit: x.entered_unit,
        points: x.points
      })),
      attempted_at: a.date
    }));

    // Plain fetch, not a Supabase client method — same pattern every other
    // Edge Function call in this codebase uses (callForumClaimNickname,
    // post-message's fetch in submitForumMessage), not
    // supabase-js's .functions.invoke(), which isn't used anywhere else
    // here and would be an unverified assumption about what getForumClient()
    // actually wraps.
    //
    // AbortSignal.timeout matters more here than it looks: without it, a
    // request that goes out right as the network drops can sit "pending"
    // for close to a minute before the browser itself gives up and rejects
    // it — and since _attemptsSyncing stays true that whole time, EVERY
    // other call to this function (including the 'online' handler's own
    // reconnect attempt, above) just silently no-ops until that original
    // hung request finally settles. That's what made this dot/sync visibly
    // slower to recover than the stats panel's (which has no such
    // single-flight guard to get stuck behind). 10s is generous for a
    // small JSON round trip but short enough that "offline" gets
    // discovered promptly either way.
    const res = await fetch(`${SUPABASE_URL}/functions/v1/sync-quiz-attempts`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_PUBLISHABLE_KEY,
        'Authorization': `Bearer ${SUPABASE_PUBLISHABLE_KEY}`,
      },
      body: JSON.stringify({ device_id: deviceId, device_secret: deviceSecret, attempts: pending }),
      signal: AbortSignal.timeout(10000),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data || !data.ok) throw new Error((data && data.error) || 'sync_failed');

    // The server's list is now authoritative — rebuild the local cache from
    // it entirely (this is also the "corrupted local attempt gets reloaded
    // from the database" recovery path: anything that was dropped by
    // _isValidStoredAttempt just gets replaced here, as long as it made it
    // to the server before going bad locally).
    const merged = (data.attempts || [])
      .filter(row => !_pendingDeleteHashes.has(row.attempt_hash))
      .map(row => ({
        hash: row.attempt_hash,
        quizNum: row.quiz_num,
        mode: row.mode,
        date: row.attempted_at,
        duration: row.duration_seconds,
        score: row.score,
        maxScore: row.max_score,
        answers: row.answers || [],
        synced: true
      }));
    // Anything still local-only after a successful round trip is kept ONLY
    // if it was never synced yet (genuinely still-queued, e.g. the push
    // above silently failed for one row) — NOT if it was previously
    // synced:true. A previously-synced attempt missing from this pull was
    // deleted server-side (by this device or another), so it must be
    // dropped here too, or a delete on device A would never actually stick
    // once device B synced again.
    //
    // Re-read from storage here rather than reusing `local` (captured
    // before the `await fetch` above): a new attempt can get recorded
    // (recordAttemptFromQuiz -> saveStats) while this request is still in
    // flight — e.g. the 10s background poll (startAttemptsSyncPolling)
    // firing mid-quiz, or a second syncAttempts() call elsewhere landing
    // its own write in the gap. `local` wouldn't know about it, so the
    // saveStats(merged) below would silently overwrite it out of
    // existence — it was written to localStorage but never actually kept.
    // Longer attempts (cumulative mode's larger problem pool takes more
    // time to work through) are more likely to straddle a poll tick, which
    // is why this shows up there far more than with quick single-quiz
    // attempts. Re-reading right before merging closes that window.
    const localNow = loadStats();
    const mergedHashes = new Set(merged.map(a => a.hash));
    localNow.forEach(a => { if (!a.synced && !mergedHashes.has(a.hash) && !_pendingDeleteHashes.has(a.hash)) merged.push(a); });

    saveStats(merged);
    _lastSyncFailed = false;
    renderStats();
    if (data.identity_id) _ensureAttemptsRealtime(data.identity_id);
  } catch (err) {
    console.error('Attempt sync error:', err);
    _lastSyncFailed = true;
  } finally {
    _attemptsSyncing = false;
    _setSyncButtonState('idle');
  }
}

// ── Background safety net, for the whole session ────────────────────────────
// Realtime (_ensureAttemptsRealtime above) handles the normal case now —
// this interval only exists to catch a ping that genuinely got missed
// (e.g. the socket was down and even the reconnect catch-up didn't fire for
// some reason), so it can run far less often than the old blind 10s poll
// did. Still runs continuously once the page loads — same "not tied to one
// screen" reasoning as before — since it's a once-every-few-minutes no-op
// rather than a real cost. Each tick is also a cheap no-op if there's no
// claimed identity yet (syncAttempts() itself gates on that first).
const ATTEMPTS_SYNC_FALLBACK_MS = 180000; // 3 min — was a 10s poll before Realtime
let _attemptsSyncPollTimer = null;

function startAttemptsSyncPolling() {
  stopAttemptsSyncPolling();
  _attemptsSyncPollTimer = setInterval(() => {
    if (document.hidden) return; // resumes on visibilitychange below instead
    // isStatsIdle() (js/stats.js) only ever returns true while the stats
    // screen is open AND idle for 5+ minutes — it's always false whenever
    // the screen is closed, so this never affects the "keep syncing
    // regardless" background behavior away from the stats screen.
    if (typeof isStatsIdle === 'function' && isStatsIdle()) return;
    syncAttempts();
  }, ATTEMPTS_SYNC_FALLBACK_MS);
}

function stopAttemptsSyncPolling() {
  if (_attemptsSyncPollTimer) {
    clearInterval(_attemptsSyncPollTimer);
    _attemptsSyncPollTimer = null;
  }
}

document.addEventListener('visibilitychange', () => {
  if (!document.hidden && _attemptsSyncPollTimer) syncAttempts();
});

startAttemptsSyncPolling();

// ── Server-side delete ──────────────────────────────────────────────────────
// Best-effort — called from deleteAttempt() (js/stats.js) alongside the
// local removal. If this fails (offline, etc.) the attempt is still gone
// locally; it would just reappear on the next full sync, same as any other
// offline edge case in this file.
async function deleteAttemptOnServer(hash) {
  const deviceId = (typeof getForumDeviceId === 'function') ? getForumDeviceId() : null;
  const deviceSecret = (typeof getForumDeviceSecret === 'function') ? getForumDeviceSecret() : null;
  if (!deviceId || typeof SUPABASE_URL === 'undefined' || typeof SUPABASE_PUBLISHABLE_KEY === 'undefined') return false;
  _pendingDeleteHashes.add(hash);
  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/delete-quiz-attempt`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_PUBLISHABLE_KEY,
        'Authorization': `Bearer ${SUPABASE_PUBLISHABLE_KEY}`,
      },
      body: JSON.stringify({ device_id: deviceId, device_secret: deviceSecret, attempt_hash: hash }),
    });
    const data = await res.json().catch(() => null);
    return !!(res.ok && data && data.ok);
  } catch (e) {
    console.error('Server-side attempt delete error:', e);
    return false;
  } finally {
    _pendingDeleteHashes.delete(hash);
  }
}
