// ─── Quiz attempt sync ────────────────────────────────────────────────────────
// Pushes any locally-queued (synced:false) attempts and pulls the full
// current server list back down in one round trip, via the
// sync-quiz-attempts Edge Function. Called: on every stats panel open, right
// after recording a new attempt, right after a delete, and on a 10s
// background timer for the whole session (not just while stats is open —
// see startAttemptsSyncPolling below). No visible button for any of this —
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
    _settleLiveDot(dot, 'ok', 'Synced and up to date');
  } else {
    _settleLiveDot(dot, 'syncing', 'Sync pending…');
  }
}

async function syncAttempts() {
  if (_attemptsSyncing) return; // already in flight — the caller's own next open/click will pick up the result
  const identityName = (typeof getForumNickname === 'function') ? getForumNickname() : '';
  if (!identityName) return; // nothing to sync to yet — quiz start already gates on this, but stats can still be opened without ever starting one

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
    const res = await fetch(`${SUPABASE_URL}/functions/v1/sync-quiz-attempts`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_PUBLISHABLE_KEY,
        'Authorization': `Bearer ${SUPABASE_PUBLISHABLE_KEY}`,
      },
      body: JSON.stringify({ device_id: deviceId, device_secret: deviceSecret, attempts: pending }),
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
  } catch (err) {
    console.error('Attempt sync error:', err);
    _lastSyncFailed = true;
  } finally {
    _attemptsSyncing = false;
    _setSyncButtonState('idle');
  }
}

// ── Background re-sync, for the whole session ──────────────────────────────
// Runs continuously once the page loads — same "always ticking, not tied to
// one screen" pattern as forum.js's own unread poll (startForumPolling) —
// rather than only while the stats screen happens to be open. This is what
// makes a delete on *another* device actually disappear here on its own:
// previously the fix only covered the deleting device racing its own
// button; a second, already-synced device had no route back to the server
// at all until it happened to open the stats screen (or someone hit a hard
// refresh). Each tick is a cheap no-op if there's no claimed identity yet
// (syncAttempts() itself gates on that first), so there's no cost to
// leaving this running everywhere.
const ATTEMPTS_SYNC_POLL_MS = 10000;
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
  }, ATTEMPTS_SYNC_POLL_MS);
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
