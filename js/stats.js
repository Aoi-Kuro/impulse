// ─── Stats Module ─────────────────────────────────────────────────────────────
// Tracks Random 6 mode attempts only. Synced to a claimed forum identity via
// js/attempts-sync.js (superbase/edge-functions/sync-quiz-attempts.ts) —
// localStorage here is a local cache/queue of that synced state, not the
// source of truth once a name is claimed.

// v2: attempts are keyed by a content hash (not a random id) and carry a
// mode + per-problem answers array, for cross-device sync + the review
// screen. v1's key is deliberately different (not migrated) — old
// localStorage-only attempts from before this existed have no hash, no
// mode, no answers, and nothing to sync them to; they're left behind as-is
// rather than ported into the new shape.
const STATS_KEY = STORAGE_PREFIX + '_stats_v2';
// Quiz series colors are read live from --q1..--q4 (css/stats.css) via
// quizSeriesColor(n) (see js/theme-colors.js) — called fresh each time
// rather than cached, so charts follow the active color theme even if
// it's toggled without a page reload.
function quizColor(i) { return quizSeriesColor(i + 1); } // i is 0-based

// ── Storage ──────────────────────────────────────────────────────────────────
// Validates the shape of one stored attempt, dropping anything that doesn't
// look right instead of letting a corrupted/partial record crash rendering
// or sync. This is also literally the recovery path for "a local attempt got
// corrupted" — a dropped record just won't be in the array syncAttempts()
// pushes from, so it either never existed for other devices (nothing to
// recover) or it already made it to the server before going bad locally, in
// which case the very next sync pulls it straight back in under the same
// hash.
function _isValidStoredAttempt(a) {
  return a && typeof a === 'object'
    && typeof a.hash === 'string' && a.hash.length > 0
    && [1,2,3,4].includes(a.quizNum)
    && (a.mode === 'single' || a.mode === 'cumulative')
    && typeof a.date === 'string' && !Number.isNaN(Date.parse(a.date))
    && typeof a.score === 'number'
    && typeof a.maxScore === 'number'
    && Array.isArray(a.answers);
}

function loadStats() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STATS_KEY));
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(_isValidStoredAttempt);
  }
  catch(e) { return []; }
}
function saveStats(arr) {
  localStorage.setItem(STATS_KEY, JSON.stringify(arr));
}

// Wipes the local Random-6 attempt cache. Called when a nickname is
// exited on this device (js/forum.js submitForumExitDevice) — those
// cached attempts are the outgoing identity's synced data, not something
// this device owns on its own, so leaving them behind would let a
// "signed out" device keep showing someone's full attempt log. Re-renders
// the Stats screen immediately if it's the one currently open (e.g. Exit
// was triggered from the Forum screen mid-session with Stats still live
// underneath it).
function clearLocalAttemptsCache() {
  localStorage.removeItem(STATS_KEY);
  if (typeof _isStatsScreenOpen === 'function' && _isStatsScreenOpen()) renderStats();
}

// ── Timer ─────────────────────────────────────────────────────────────────────
let _attemptStart = null;
function startAttemptTimer() { _attemptStart = Date.now(); }
function stopAttemptTimer() {
  if (!_attemptStart) return 0;
  const dur = Math.round((Date.now() - _attemptStart) / 1000);
  _attemptStart = null;
  return dur;
}

// ── Hash (dedup key, also doubles as local storage key) ───────────────────────
// SHA-256 over a fixed-order field string, hex-encoded. Must exactly match
// what the person's *other* devices would compute for the same attempt for
// dedup to work at all — the point isn't cryptographic secrecy (scores are
// stored unencrypted server-side, on purpose, per project decision), just a
// stable fingerprint. attemptedAt already carries millisecond precision
// (toISOString()), which alone makes two genuinely different attempts
// astronomically unlikely to collide; identity is folded in too as a cheap
// extra guard, since the server's attempt_hash uniqueness is global across
// every identity, not scoped per-person.
async function computeAttemptHash(identityName, quizNum, mode, attemptedAt, score, maxScore, answers) {
  const sortedAnswers = [...answers]
    .sort((a, b) => (a.problem_id < b.problem_id ? -1 : a.problem_id > b.problem_id ? 1 : 0))
    .map(a => `${a.problem_id}:${a.quiz_num}:${a.entered_value}:${a.entered_unit}:${a.points}`)
    .join(',');
  const input = [identityName, quizNum, mode, attemptedAt, score, maxScore, sortedAnswers].join('|');
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('');
}

// ── Record ────────────────────────────────────────────────────────────────────
// Fire-and-forget from checkAll() (not awaited — the hash computation and
// any resulting sync attempt happen in the background while the person is
// already looking at their results panel, same as this file's other
// best-effort network calls).
async function recordAttemptFromQuiz(score, maxScore, mode, answers) {
  const dur = stopAttemptTimer();
  const attemptedAt = new Date().toISOString();
  const identityName = (typeof getForumNickname === 'function' ? getForumNickname() : '') || '';

  const hash = await computeAttemptHash(identityName, selectedQuizNum, mode, attemptedAt, score, maxScore, answers);

  const stats = loadStats();
  stats.push({
    hash,
    quizNum: selectedQuizNum,
    mode,
    date: attemptedAt,
    duration: dur,
    score,
    maxScore,
    answers,
    synced: false
  });
  saveStats(stats);
  renderStats();
  // Best-effort immediate sync — if there's no connection this just leaves
  // the attempt's synced:false as it already was, with the "not synced"
  // badge/Sync button covering the rest (see renderTable/syncAttempts).
  if (typeof syncAttempts === 'function') syncAttempts();
}

async function deleteAttempt(hash) {
  const target = loadStats().find(a => a.hash === hash);
  if (!target) return;
  if (!confirm('Delete this attempt? This removes it everywhere it\'s synced and cannot be undone.')) return;

  saveStats(loadStats().filter(a => a.hash !== hash));
  renderStats();

  // Also delete server-side (delete-quiz-attempt Edge Function) so it
  // doesn't just reappear on the next sync/other device. Best-effort: if
  // this fails (offline, etc.) the local copy is still gone; the next sync
  // will just pull it back since the server never got the delete.
  if (typeof deleteAttemptOnServer === 'function') {
    const ok = await deleteAttemptOnServer(hash);
    if (!ok) console.warn('Server-side delete failed — attempt may reappear on next sync.');
  }
}

// ── Review screen ────────────────────────────────────────────────────────────
// Read-only replay of one stored attempt. Looks the original problem back up
// in QUIZZES by (quiz_num, problem_id) from the attempt's own answers array,
// then reuses numberCorrect/unitConversionFactor/unitStatus/fmt/fmtUnit
// (all defined in quiz-engine.js) — the exact same grading functions
// checkAll() itself calls — so a reviewed card is graded identically to how
// it looked the moment it was actually checked, not a re-implementation
// that could quietly drift out of sync with real grading over time.
function findReviewProblem(quizNum, problemId) {
  const q = QUIZZES[quizNum - 1];
  return q ? (q.problems.find(p => p.id === problemId) || null) : null;
}

// Set by renderAttemptReview, read by paintForumProblemButtons via the
// 'rv-forum-' prefix (js/forum.js) — see that call site for why.
let _reviewProblemsForCounts = null;

function openAttemptReview(hash) {
  const attempt = loadStats().find(a => a.hash === hash);
  if (!attempt) return;
  renderAttemptReview(attempt);
  document.getElementById('statsScreen')?.classList.remove('visible');
  document.getElementById('reviewScreen')?.classList.add('visible');
  // Per-problem forum buttons just came into view — same 5s counts poll
  // live quiz cards use (idempotent, safe even if already running from
  // elsewhere).
  if (typeof startForumProblemCountsPolling === 'function') startForumProblemCountsPolling();
}

function closeAttemptReview() {
  document.getElementById('reviewScreen')?.classList.remove('visible');
  document.getElementById('statsScreen')?.classList.add('visible');
  if (typeof stopForumProblemCountsPolling === 'function') stopForumProblemCountsPolling();
  _reviewProblemsForCounts = null;
}

function _escAttr(s) { return (s || '').replace(/"/g, '&quot;'); }

function renderAttemptReview(attempt) {
  const metaEl = document.getElementById('reviewMeta');
  const listEl = document.getElementById('reviewProblems');
  if (!metaEl || !listEl) return;

  const quizName = QUIZZES[attempt.quizNum - 1]?.name || '';
  const dateStr = new Date(attempt.date).toLocaleDateString('en-GB', {day:'2-digit',month:'short',year:'numeric'});
  const timeStr = new Date(attempt.date).toLocaleTimeString('en-GB', {hour:'2-digit',minute:'2-digit'});

  metaEl.innerHTML = `
    <span class="review-meta-item"><span class="review-meta-label">Quiz</span>#${attempt.quizNum} · ${quizName}</span>
    <span class="review-meta-item"><span class="review-meta-label">Mode</span>${attempt.mode === 'cumulative' ? 'Cumulative' : 'Single'}</span>
    <span class="review-meta-item"><span class="review-meta-label">Date</span>${dateStr} ${timeStr}</span>
    <span class="review-meta-item"><span class="review-meta-label">Duration</span>${fmtDuration(attempt.duration)}</span>
    <span class="review-meta-item"><span class="review-meta-label">Score</span>${attempt.score}/${attempt.maxScore}</span>`;

  // Fed to paintForumProblemButtons (js/forum.js) via the 'rv-forum-' prefix
  // so the review screen's per-problem forum buttons get live total/unread
  // counts the same way live quiz cards do — see openAttemptReview/
  // closeAttemptReview starting/stopping the shared poll.
  _reviewProblemsForCounts = attempt.answers.map(a => ({ id: a.problem_id, _quizNum: a.quiz_num }));

  listEl.innerHTML = '';
  attempt.answers.forEach((a, idx) => {
    const p = findReviewProblem(a.quiz_num, a.problem_id);
    const card = document.createElement('div');
    card.className = 'problem-card review-problem-card';
    const forumRowHtml = `
        <div class="card-check-row" id="rv-forum-row-${idx}">
          <button class="forum-problem-btn" id="rv-forum-btn-${idx}" title="Forum thread for ${_escAttr(a.problem_id)}"
            onclick="openForumForProblem(${a.quiz_num}, '${_escAttr(a.problem_id).replace(/'/g, "\\'")}')">
            💬 <span id="rv-forum-total-${idx}"></span>
            <span class="forum-problem-btn-badge" id="rv-forum-badge-${idx}" style="display:none;"></span>
            <span class="forum-problem-btn-at" id="rv-forum-at-${idx}" style="display:none;">@</span>
          </button>
        </div>`;

    if (!p) {
      // The original problem text isn't available any more (quiz content
      // changed since this attempt was taken) — show what was recorded
      // instead of silently dropping the row from the review.
      card.classList.add('wrong');
      card.innerHTML = `
        <div class="card-header"><span class="problem-num">${a.problem_id} · Quiz #${a.quiz_num}</span></div>
        <div class="problem-text" style="color:var(--muted)">This problem's original text is no longer available.</div>
        <div class="answer-row">
          <span class="answer-label">Value =</span>
          <input class="answer-input" type="text" value="${_escAttr(a.entered_value)}" readonly tabindex="-1">
          <span class="sep">·</span>
          <input class="unit-input" type="text" value="${_escAttr(a.entered_unit)}" readonly tabindex="-1">
        </div>
        <div class="feedback show">Recorded score: <strong>${a.points}</strong> pt</div>
        ${forumRowHtml}`;
      listEl.appendChild(card);
      return;
    }

    const numOk  = numberCorrect(a.entered_value, p.answer, unitConversionFactor(a.entered_unit, p.units));
    const uStat  = unitStatus(a.entered_unit, p.units);
    const unitOk = uStat === 'ok';
    const pts    = a.points; // trust the score actually awarded at the time over a live recompute, in case grading rules ever change later

    card.classList.add(pts === 1 ? 'correct' : pts === 0.9 ? 'partial' : 'wrong');
    const isCumulative = attempt.mode === 'cumulative' && a.quiz_num !== attempt.quizNum;
    const numDisplay = isCumulative ? `${p.id} · Quiz #${a.quiz_num}` : p.id;

    let fbClass, fbHtml;
    if (pts === 1) {
      fbClass = 'correct-fb';
      fbHtml = `✓ Correct <span class="pts-badge pts-full">+1 pt</span>`;
    } else if (pts === 0.9) {
      fbClass = 'partial-fb';
      const unitHint = uStat === 'invalid'
        ? `unit format invalid — use spaces to multiply, e.g. <strong>${fmtUnit(p.units)}</strong>`
        : `unit should be <strong>${fmtUnit(p.units)}</strong>`;
      fbHtml = `✓ Value correct, but ${unitHint} <span class="pts-badge pts-partial">+0.9 pt</span>`;
    } else {
      fbClass = 'wrong-fb';
      fbHtml = `✗ Expected ≈ <strong>${fmt(p.answer)}</strong> ${fmtUnit(p.units)} <span class="pts-badge pts-zero">+0 pt</span>`;
    }

    card.innerHTML = `
      <div class="card-header">
        <span class="problem-num">${numDisplay}</span>
        <span class="problem-topic">${p.topic}</span>
      </div>
      <div class="problem-text">${p.text}</div>
      <div class="answer-row">
        <span class="answer-label">Value =</span>
        <input class="answer-input ${numOk ? 'correct-input' : 'wrong-input'}" type="text" value="${_escAttr(a.entered_value)}" readonly tabindex="-1">
        <span class="sep">·</span>
        <input class="unit-input ${numOk ? (unitOk ? 'correct-unit' : 'partial-unit') : 'wrong-unit'}" type="text" value="${_escAttr(a.entered_unit)}" readonly tabindex="-1">
      </div>
      <div class="feedback show ${fbClass}">${fbHtml}</div>
      ${forumRowHtml}`;
    listEl.appendChild(card);
  });
  renderMathIn(listEl);
}

// ── Filter state ──────────────────────────────────────────────────────────────
let sfQuizzes = new Set([1, 2, 3, 4]);
let sfMode = 'all'; // 'all' | 'single' | 'cumulative'

function getFiltered() {
  return loadStats().filter(a => {
    if (!sfQuizzes.has(a.quizNum)) return false;
    if (sfMode !== 'all' && a.mode !== sfMode) return false;
    return true;
  });
}

// ── Screen open / close ───────────────────────────────────────────────────────
function openStatsScreen() {
  const landing = document.getElementById('landingScreen');
  const stats   = document.getElementById('statsScreen');
  // Reset filters to default every time the screen is opened, rather than
  // carrying over whatever was left selected from the last visit.
  sfQuizzes = new Set([1, 2, 3, 4]);
  sfMode = 'all';
  // Hide field lines so they don't bleed through
  if (typeof setFieldLinesVisible === 'function') setFieldLinesVisible(false);
  landing.classList.add('fading-out');
  setTimeout(() => {
    landing.classList.add('hidden');
    landing.classList.remove('fading-out');
    stats.classList.add('visible');
    renderStats();
    loadStatsPanel();
    startStatsPanelPolling();
    if (typeof syncAttempts === 'function') syncAttempts();
    // Fresh open always starts active, never idle — and (re)arms the
    // 5-minute no-interaction timer.
    _statsIdle = false;
    stats.classList.remove('stats-idle');
    _armStatsIdleTimer();
  }, 280);
}

function closeStatsScreen() {
  const landing = document.getElementById('landingScreen');
  const stats   = document.getElementById('statsScreen');
  stats.classList.add('fading-out');
  stopStatsPanelPolling();
  clearTimeout(_statsIdleTimer);
  _statsIdle = false;
  stats.classList.remove('stats-idle');
  setTimeout(() => {
    stats.classList.remove('visible', 'fading-out');
    landing.classList.remove('hidden');
    if (typeof showNewSplash === 'function') showNewSplash();
    // Restore field lines
    if (typeof setFieldLinesVisible === 'function') setFieldLinesVisible(true);
  }, 280);
}

// ── Idle pause (Attempt log + Forum & Site panels only) ────────────────────
// After 5 minutes with zero interaction while the stats screen is open, both
// panels stop actively refreshing (isStatsIdle() is checked by both
// js/attempts-sync.js's background poll and pollStatsPanel's own interval
// below) and their buttons dim (see #statsScreen.stats-idle in
// css/stats.css) to signal the view has gone stale. Any interaction —
// pointer movement, click, key, scroll, touch — wakes it back up instantly
// and triggers an immediate refresh rather than waiting out the rest of
// whatever interval was already running. Forum chat polling itself
// (js/forum.js's startForumPolling) is entirely separate from this and
// keeps running no matter what.
const STATS_IDLE_MS = 5 * 60 * 1000;
let _statsIdle = false;
let _statsIdleTimer = null;

function isStatsIdle() { return _statsIdle; }

function _isStatsScreenOpen() {
  const stats = document.getElementById('statsScreen');
  return !!stats && stats.classList.contains('visible');
}

function _armStatsIdleTimer() {
  clearTimeout(_statsIdleTimer);
  _statsIdleTimer = setTimeout(() => {
    if (!_isStatsScreenOpen()) return; // closed in the meantime — nothing to dim
    _statsIdle = true;
    document.getElementById('statsScreen')?.classList.add('stats-idle');
  }, STATS_IDLE_MS);
}

function _statsActivityPing() {
  if (!_isStatsScreenOpen()) return;
  if (_statsIdle) {
    _statsIdle = false;
    document.getElementById('statsScreen')?.classList.remove('stats-idle');
    // Coming back from idle — refresh right away rather than waiting out
    // whatever's left of the next interval tick.
    if (typeof syncAttempts === 'function') syncAttempts();
    if (typeof pollStatsPanel === 'function') pollStatsPanel();
  }
  _armStatsIdleTimer();
}

['mousemove', 'mousedown', 'keydown', 'wheel', 'touchstart', 'scroll'].forEach(evt => {
  document.addEventListener(evt, _statsActivityPing, { passive: true });
});

// ── Render all ────────────────────────────────────────────────────────────────
function renderStats() {
  renderLegend();
  renderFilters();
  drawChart();
  renderTable();
  if (typeof updateExportButtonState === 'function') updateExportButtonState();
}

// ── Legend ────────────────────────────────────────────────────────────────────
function renderLegend() {
  const el = document.getElementById('statsLegend');
  el.innerHTML = QUIZZES.map((q, i) =>
    `<div class="legend-item">
      <div class="legend-dot" style="background:${quizColor(i)}"></div>
      <span>Quiz #${i+1} · ${q.name}</span>
    </div>`
  ).join('');
}

// ── Filters ───────────────────────────────────────────────────────────────────
function renderFilters() {
  const wrap = document.getElementById('statsFilters');
  wrap.innerHTML = '';

  // Quiz chips
  const qg = document.createElement('div');
  qg.className = 'sf-group';
  qg.innerHTML = '<span class="sf-label">Quiz:</span>';
  QUIZZES.forEach((q, i) => {
    const n = i + 1;
    const btn = document.createElement('button');
    btn.className = 'sf-chip' + (sfQuizzes.has(n) ? ' active' : '');
    btn.style.setProperty('--chip-color', quizColor(i));
    btn.textContent = `#${n}`;
    btn.title = q.name;
    btn.onclick = () => {
      if (sfQuizzes.has(n)) { if (sfQuizzes.size > 1) sfQuizzes.delete(n); }
      else sfQuizzes.add(n);
      renderStats();
    };
    qg.appendChild(btn);
  });
  wrap.appendChild(qg);

  const div = document.createElement('div');
  div.className = 'sf-divider';
  wrap.appendChild(div);

  // Mode chips
  const mg = document.createElement('div');
  mg.className = 'sf-group';
  mg.innerHTML = '<span class="sf-label">Mode:</span>';
  [['all','All'],['single','Single'],['cumulative','Cumul.']].forEach(([val, label]) => {
    const btn = document.createElement('button');
    btn.className = 'sf-chip' + (sfMode === val ? ' active mode-active' : '');
    btn.textContent = label;
    btn.onclick = () => { sfMode = val; renderStats(); };
    mg.appendChild(btn);
  });
  wrap.appendChild(mg);
}

// ── Chart ─────────────────────────────────────────────────────────────────────
let _chartData = []; // cached for tooltip hit-testing

function drawChart() {
  const canvas = document.getElementById('statsChart');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const W = canvas.clientWidth || canvas.offsetWidth || 700;
  const H = canvas.clientHeight || 240;
  canvas.width  = W * dpr;
  canvas.height = H * dpr;
  ctx.scale(dpr, dpr);

  const PAD = { top: 18, right: 18, bottom: 36, left: 40 };
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;

  const isLight = document.body.classList.contains('light');
  const textC  = cssVar('--text');
  const gridC  = cssVarRgba('--text', isLight ? 0.07 : 0.05);
  const mutedC = cssVar('--muted');
  const bgBack = cssVar('--bg');

  ctx.clearRect(0, 0, W, H);

  // Group by quiz preserving chronological order
  const all = loadStats(); // unfiltered for individual per-quiz series
  const byQuiz = {1:[],2:[],3:[],4:[]};
  all.forEach(a => { if (byQuiz[a.quizNum]) byQuiz[a.quizNum].push(a); });
  // Apply mode filter per-series
  const filtered = sfMode === 'all' ? null : sfMode;
  if (filtered) {
    for (let i = 1; i<=4; i++) byQuiz[i] = byQuiz[i].filter(a => a.mode === filtered);
  }

  const maxAttempts = Math.max(...Object.values(byQuiz).map(a => a.length), 2);
  const MAX_SCORE = 7;

  // Horizontal grid + Y labels
  for (let s = 0; s <= MAX_SCORE; s++) {
    const y = PAD.top + plotH * (1 - s / MAX_SCORE);
    ctx.strokeStyle = gridC;
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(PAD.left, y); ctx.lineTo(PAD.left + plotW, y); ctx.stroke();
    ctx.fillStyle = mutedC;
    ctx.font = `10px 'IBM Plex Mono', monospace`;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    ctx.fillText(s, PAD.left - 6, y);
  }

  // X axis attempt labels
  const step = maxAttempts <= 8 ? 1 : maxAttempts <= 20 ? 2 : Math.ceil(maxAttempts / 10);
  ctx.fillStyle = mutedC;
  ctx.font = `10px 'IBM Plex Mono', monospace`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  for (let i = 0; i < maxAttempts; i += step) {
    const x = PAD.left + (i / Math.max(maxAttempts - 1, 1)) * plotW;
    ctx.fillText(i + 1, x, PAD.top + plotH + 5);
  }

  // X axis label
  ctx.fillStyle = mutedC;
  ctx.font = `9px 'IBM Plex Mono', monospace`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText('attempt #', PAD.left + plotW / 2, PAD.top + plotH + 28);

  _chartData = [];

  for (let qi = 1; qi <= 4; qi++) {
    if (!sfQuizzes.has(qi)) continue;
    const arr = byQuiz[qi];
    if (arr.length === 0) continue;
    const color = quizColor(qi - 1);

    const points = arr.map((a, i) => ({
      x: PAD.left + (i / Math.max(maxAttempts - 1, 1)) * plotW,
      // Normalize each attempt's score to its own maxScore (which can be
      // less than 6 under a tight topic/number filter) into a 0–1 fraction,
      // then plot that fraction against the fixed 0–6 axis — so e.g. 1/2
      // plots at the same height as 3/6, matching what the attempt log
      // already shows.
      y: PAD.top + plotH * (1 - a.score / (a.maxScore || MAX_SCORE)),
      attempt: a, qi, idx: i
    }));

    // Gradient fill under the line
    const grad = ctx.createLinearGradient(0, PAD.top, 0, PAD.top + plotH);
    grad.addColorStop(0, color + '28');
    grad.addColorStop(1, color + '00');
    ctx.beginPath();
    ctx.moveTo(points[0].x, PAD.top + plotH);
    points.forEach(p => ctx.lineTo(p.x, p.y));
    ctx.lineTo(points[points.length-1].x, PAD.top + plotH);
    ctx.closePath();
    ctx.fillStyle = grad;
    ctx.fill();

    // Line
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.beginPath();
    points.forEach((p, i) => i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y));
    ctx.stroke();

    // Dots
    points.forEach(p => {
      ctx.beginPath();
      ctx.arc(p.x, p.y, 4, 0, Math.PI*2);
      ctx.fillStyle = color;
      ctx.fill();
      ctx.strokeStyle = bgBack;
      ctx.lineWidth = 1.5;
      ctx.stroke();
      _chartData.push(p);
    });
  }

  // Empty state
  if (_chartData.length === 0) {
    ctx.fillStyle = mutedC;
    ctx.font = `13px 'IBM Plex Mono', monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(`No attempts yet — complete a Random ${QUIZ_SIZE} quiz to track progress`, W/2, H/2 - 10);
    ctx.font = `11px 'IBM Plex Mono', monospace`;
    ctx.fillText(`(only Random ${QUIZ_SIZE} mode is recorded)`, W/2, H/2 + 12);
  }
}

// Chart tooltip on hover
function initChartTooltip() {
  const canvas = document.getElementById('statsChart');
  const tooltip = document.getElementById('chartTooltip');
  if (!canvas || !tooltip) return;

  canvas.addEventListener('mousemove', e => {
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    let closest = null, minDist = Infinity;
    _chartData.forEach(p => {
      const d = Math.hypot(p.x - mx, p.y - my);
      if (d < minDist) { minDist = d; closest = p; }
    });
    if (closest && minDist < 22) {
      const a = closest.attempt;
      const dateStr = new Date(a.date).toLocaleDateString('en-GB', {day:'numeric',month:'short',year:'numeric'});
      const durStr  = fmtDuration(a.duration);
      tooltip.innerHTML =
        `<span style="color:${quizColor(closest.qi-1)}">Quiz #${closest.qi}</span> · attempt ${closest.idx+1}<br>` +
        `Score: <b>${a.score}/${a.maxScore}</b> · ${a.mode} · ${durStr}<br>` +
        `${dateStr}`;
      const tw = tooltip.offsetWidth;
      const left = Math.min(mx + 12, rect.width - tw - 8);
      const top  = Math.max(my - 48, 4);
      tooltip.style.left = left + 'px';
      tooltip.style.top  = top  + 'px';
      tooltip.classList.add('visible');
    } else {
      tooltip.classList.remove('visible');
    }
  });
  canvas.addEventListener('mouseleave', () => tooltip.classList.remove('visible'));
}

// ── Table ─────────────────────────────────────────────────────────────────────
function renderTable() {
  const wrap = document.getElementById('statsTableWrap');
  const attempts = getFiltered().slice().reverse(); // newest first
  const count = document.getElementById('statsRowCount');
  if (count) count.textContent = attempts.length + ' attempt' + (attempts.length !== 1 ? 's' : '');

  const header = `
    <div class="stats-table-header">
      <span class="stats-table-title">Attempt log <span class="sfp-live-dot" id="attemptsSyncDot" title="Synced and up to date" style="display:none;"></span></span>
      <span class="stats-table-header-right">
        <button class="stats-io-btn" id="statsExportBtn" onclick="openExportFormatModal()" disabled>↓ Export stats</button>
        <span class="stats-table-count" id="statsRowCount">${attempts.length} attempt${attempts.length !== 1 ? 's' : ''}</span>
      </span>
    </div>`;

  if (attempts.length === 0) {
    wrap.innerHTML = `<div class="stats-table-section">${header}<div class="stats-empty">
      <div class="stats-empty-icon">📊</div>
      <div>No attempts match the current filter.</div>
    </div></div>`;
    if (typeof _setSyncButtonState === 'function') _setSyncButtonState(_attemptsSyncing ? 'syncing' : 'idle');
    if (typeof updateExportButtonState === 'function') updateExportButtonState();
    return;
  }

  const tbody = attempts.map(a => {
    const color = quizColor(a.quizNum - 1);
    const name  = QUIZZES[a.quizNum - 1]?.name || '';
    const dateStr = new Date(a.date).toLocaleDateString('en-GB', {day:'2-digit',month:'short',year:'numeric'});
    const timeStr = new Date(a.date).toLocaleTimeString('en-GB', {hour:'2-digit',minute:'2-digit'});
    const scoreClass = a.score >= a.maxScore ? 'score-perfect' :
                       a.score >= a.maxScore * 0.8 ? 'score-good' :
                       a.score >= a.maxScore * 0.6 ? 'score-ok' : 'score-low';
    // Escaped into a single-quoted JS string literal inside the onclick
    // attribute below — the hash itself is hex (computeAttemptHash in
    // stats.js), so this is defensive rather than something that can
    // currently fire, same reasoning as elsewhere in this file's inline
    // handlers.
    const hashAttr = a.hash.replace(/'/g, "\\'");
    return `<tr>
      <td>
        <span class="quiz-badge" style="background:${color}22;color:${color}">
          <span style="display:inline-block;width:6px;height:6px;border-radius:50%;background:${color}"></span>
          #${a.quizNum} · ${name}
        </span>
      </td>
      <td><span class="mode-badge ${a.mode}">${a.mode === 'cumulative' ? 'Cumul.' : 'Single'}</span></td>
      <td style="white-space:nowrap;color:var(--muted)">
        ${dateStr} <span style="opacity:0.6">${timeStr}</span>
        ${a.synced ? '' : '<div class="attempt-not-synced">not synced</div>'}
      </td>
      <td class="duration-cell">${fmtDuration(a.duration)}</td>
      <td class="score-cell ${scoreClass}">${a.score}<span style="color:var(--muted);font-weight:400">/${a.maxScore}</span></td>
      <td style="white-space:nowrap;">
        <button class="review-btn" title="Review this attempt" onclick="openAttemptReview('${hashAttr}')">Review</button>
        <button class="del-btn" title="Delete attempt" onclick="deleteAttempt('${hashAttr}')">🗑</button>
      </td>
    </tr>`;
  }).join('');

  wrap.innerHTML = `
    <div class="stats-table-section">
      ${header}
      <div style="overflow-x:auto">
        <table class="stats-table">
          <thead><tr>
            <th>Quiz</th><th>Mode</th><th>Date &amp; Time</th>
            <th>Duration</th><th>Score</th><th style="width:104px">Actions</th>
          </tr></thead>
          <tbody>${tbody}</tbody>
        </table>
      </div>
    </div>`;
  if (typeof _setSyncButtonState === 'function') _setSyncButtonState(_attemptsSyncing ? 'syncing' : 'idle');
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function fmtDuration(sec) {
  if (!sec || sec < 1) return '—';
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return m > 0 ? `${m}m ${s.toString().padStart(2,'0')}s` : `${s}s`;
}

// ── Forum & site stats panel ─────────────────────────────────────────────────
// Three rows: (1) identity — my avatar/nickname/join date, with a gear
// dropdown to claim/rename, view my PIN, or exit this device; (2) "my ___"
// numbers — my forum messages, my
// quizzes taken; (3) "everybody" numbers, each as its own tally-counter
// dial — total forum participants, total visits, total quizzes taken by
// everyone. Every number here refreshes together on one 5s interval
// (pollStatsPanel below, three RPCs in one Promise.allSettled batch) — 
// get_stats_panel covers the first two dials' values plus the "my
// messages"/join-date text, get_total_quiz_attempts covers the third dial,
// and get_my_total_quiz_attempts covers "my quizzes taken". The latter two
// both need superbase/migrations/008_quiz_attempts_persistent_counters.sql
// run once in the Supabase SQL editor — they read persistent, increment-
// only counters (bumped by a DB trigger on genuine attempt INSERT, never
// decremented), not live counts, specifically so deleting an attempt from
// the log doesn't silently reduce either number.
// Runs only while this screen is actually open (started/stopped in
// openStatsScreen/closeStatsScreen above), paused while the tab is
// backgrounded (visibilitychange below) or the screen has been idle 5+
// minutes (isStatsIdle()). The panel's own avatar is loaded once per
// screen-open instead (loadSfpAvatar below), via get_author_stats — it
// doesn't need a 5s refresh since it essentially never changes mid-session
// (only a rename re-seeds it, which already calls renderSfpIdentity again).
let _statsPanelPollTimer = null;

async function loadStatsPanel() {
  const nickname = (typeof getForumNickname === 'function') ? getForumNickname() : '';
  renderSfpIdentity(nickname);
  await pollStatsPanel();
}

// My claimed nickname + identicon avatar, next to "My date of join" — same
// avatar/name pairing the forum's own mention-profile popup shows
// (forumUserAvatarEl/forumInitialsAvatarEl, js/forum.js), just reused here
// so this panel visually confirms "this is you" at a glance.
function renderSfpIdentity(nickname) {
  const nameEl     = document.getElementById('sfpNickname');
  const avatarEl   = document.getElementById('sfpAvatar');
  const gsItem     = document.getElementById('sfpSettingsGettingStartedItem');
  const changeItem = document.getElementById('sfpSettingsChangeItem');
  const pinItem    = document.getElementById('sfpSettingsPinItem');
  const exitItem   = document.getElementById('sfpSettingsExitItem');
  if (!nameEl || !avatarEl) return;

  // Nothing claimed yet: the gear menu collapses down to just "Getting
  // started" (openSfpGettingStarted below) instead of offering
  // Change/PIN/Exit, which don't mean anything without an identity yet.
  // Once claimed, it flips back to the normal three-item menu.
  if (gsItem)     gsItem.style.display     = nickname ? 'none' : '';
  if (changeItem) changeItem.style.display = nickname ? '' : 'none';
  if (pinItem)    pinItem.style.display    = nickname ? '' : 'none';
  if (exitItem)   exitItem.style.display   = nickname ? '' : 'none';

  avatarEl.innerHTML = '';
  if (!nickname) {
    nameEl.textContent = 'Not registered yet';
    if (typeof forumInitialsAvatarEl === 'function') avatarEl.appendChild(forumInitialsAvatarEl('?'));
    return;
  }
  nameEl.textContent = nickname;
  loadSfpAvatar(nickname, avatarEl);
}

// "Getting started" item in the settings gear dropdown — shown only while
// unregistered (see renderSfpIdentity above). Reuses the same "Getting
// Started!" info screen the main Start button shows a brand-new device
// (openGettingStartedModal, js/forum.js), then chains straight into the
// nickname-claim modal exactly like startSelected() does in
// js/quiz-engine.js, except on success it refreshes this panel instead of
// launching a quiz.
function openSfpGettingStarted() {
  if (typeof openGettingStartedModal !== 'function' || typeof openForumClaimModal !== 'function') return;
  openGettingStartedModal(() => openForumClaimModal('create', '', () => {
    renderSfpIdentity((typeof getForumNickname === 'function') ? getForumNickname() : '');
    if (typeof pollStatsPanel === 'function') pollStatsPanel();
  }));
}

// ── Settings gear dropdown (Change nickname / Your PIN / Exit) ──────────────
// Same toggle-with-outside-click-close pattern as the color theme panel
// (toggleThemePanel/closeThemePanel in js/themes.js).
function toggleSfpSettingsMenu(e) {
  if (e) e.stopPropagation();
  const menu = document.getElementById('sfpSettingsMenu');
  if (!menu) return;
  menu.classList.toggle('open');
}
function closeSfpSettingsMenu() {
  document.getElementById('sfpSettingsMenu')?.classList.remove('open');
}
document.addEventListener('click', (e) => {
  const menu = document.getElementById('sfpSettingsMenu');
  if (menu && menu.classList.contains('open') && !menu.contains(e.target) && e.target.id !== 'sfpSettingsBtn') closeSfpSettingsMenu();
});

async function loadSfpAvatar(nickname, avatarEl) {
  // Local-first: paint whatever we already have (cache, or the plain
  // letter) immediately and synchronously — no network round-trip stands
  // between opening this panel and *something* showing up, which matters
  // most exactly when offline (previously this awaited the DB call first,
  // so an unreachable network meant 5-6s of blank avatar before the
  // fallback chain even started). The DB is then checked in the
  // background purely to keep the cache fresh: if it agrees with what's
  // already on screen, nothing changes; if it disagrees (or we had
  // nothing cached), the real one quietly substitutes in.
  const cached = (typeof getCachedAvatarSvg === 'function') ? getCachedAvatarSvg(nickname) : null;

  avatarEl.innerHTML = '';
  if (cached && typeof forumUserAvatarEl === 'function') {
    avatarEl.appendChild(forumUserAvatarEl(cached, nickname));
  } else if (typeof forumInitialsAvatarEl === 'function') {
    avatarEl.appendChild(forumInitialsAvatarEl(nickname));
  }

  // Live DiceBear fetch + plain-letter fallback, used both when there's no
  // DB client and when the DB lookup itself comes back empty/erroring.
  // Only actually touches the DOM if it produces something different from
  // what's already shown (i.e. we started from nothing/initials) — if we
  // already painted a cached identicon above, this is skipped entirely.
  const fallbackIfNeeded = async () => {
    if (cached) return; // already showing the real thing, nothing to improve on
    if (typeof forumResolveAvatarEl === 'function') {
      avatarEl.innerHTML = '';
      avatarEl.appendChild(await forumResolveAvatarEl(nickname));
    }
  };

  const client = (typeof getForumClient === 'function') ? getForumClient() : null;
  if (!client) { await fallbackIfNeeded(); return; }

  try {
    const { data, error } = await client.rpc('get_author_stats', { p_author_name: nickname });
    if (error) throw error;
    const row = data && data[0];
    if (row && row.avatar_svg) {
      if (row.avatar_svg !== cached) {
        // DB has something different (or we had nothing cached) — substitute.
        avatarEl.innerHTML = '';
        if (typeof forumUserAvatarEl === 'function') avatarEl.appendChild(forumUserAvatarEl(row.avatar_svg, nickname));
        if (typeof setCachedAvatarSvg === 'function') setCachedAvatarSvg(nickname, row.avatar_svg);
      }
      // else: identical to what's already on screen — leave it alone.
    } else {
      // DB genuinely has no avatar_svg for this name — could be a real
      // unclaimed/pre-avatar identity, or a stale/incorrect row. Only
      // reach for the live DiceBear/initials fallback if we didn't already
      // have a cached identicon painted.
      await fallbackIfNeeded();
    }
  } catch (e) {
    console.error('Forum & Site avatar load error:', e);
    // DB unreachable — the cached/initials avatar painted at the top is
    // already on screen, so just try to improve on it if it was initials.
    await fallbackIfNeeded();
  }
}

// "Change nickname" item in the settings gear dropdown (index.html,
// #sfpSettingsMenu). Picks the right claim-modal mode depending on whether
// this device already has a claimed identity — 'rename' if so (server
// still requires the PIN even though this device is already linked, see
// the 'rename' mode's own comment in js/forum.js), 'create' if nothing's
// claimed yet at all, same as any other first-claim entry point in the app.
function openSfpNicknameEditor() {
  if (typeof openForumClaimModal !== 'function') return;
  const current = (typeof getForumNickname === 'function') ? getForumNickname() : '';
  const onSuccess = () => {
    renderSfpIdentity((typeof getForumNickname === 'function') ? getForumNickname() : '');
    // A claim/rename/switch changes which identity this device resolves
    // to server-side, which every number in this panel (joined_at,
    // my_total_messages, my_total_quizzes) is keyed on — without this,
    // they stay frozen at whatever the last periodic poll fetched (under
    // the OLD identity, if this was a switch) until that poll's own
    // interval happens to fire next.
    if (typeof pollStatsPanel === 'function') pollStatsPanel();
  };
  if (current) {
    openForumClaimModal('rename', current, onSuccess);
  } else {
    openForumClaimModal('create', '', onSuccess);
  }
}

// "My total quizzes taken" — a persistent, increment-only counter
// (identities.total_quiz_attempts_ever, superbase/migrations/
// 008_quiz_attempts_persistent_counters.sql), NOT loadStats().length. It
// used to be the local count, which meant deleting an attempt silently
// decremented this number — the counter is bumped server-side by a trigger
// on genuine INSERT only, with no matching decrement on DELETE, so it stays
// "how many times a quiz was ever completed" regardless of what's since
// been deleted from the log. Fetched inline in pollStatsPanel's
// Promise.allSettled batch below, alongside the other two RPCs, rather than
// as its own separate function/call — one fewer thing to keep in sync with
// this poll's shared "ok" success flag and the live dot's state.

async function pollStatsPanel() {
  const client = (typeof getForumClient === 'function') ? getForumClient() : null;
  const dot = document.getElementById('sfpLiveDot');
  if (!client) return;

  if (dot) dot.style.display = '';
  if (typeof _settleLiveDot === 'function') _settleLiveDot(dot, 'syncing', 'Refreshing…');

  const [panelResult, totalQuizzesResult, myQuizzesResult] = await Promise.allSettled([
    client.rpc('get_stats_panel', { p_device_id: getForumDeviceId() }),
    client.rpc('get_total_quiz_attempts'),
    client.rpc('get_my_total_quiz_attempts', { p_device_id: getForumDeviceId() }),
  ]);

  let ok = true;

  if (panelResult.status === 'fulfilled' && !panelResult.value.error && panelResult.value.data && panelResult.value.data[0]) {
    const row = panelResult.value.data[0];

    const joinedEl = document.getElementById('sfpJoinedAt');
    if (joinedEl) {
      joinedEl.textContent = row.joined_at ? `Joined ${formatForumTime(row.joined_at)}` : 'Not registered yet';
    }
    const myMsgEl = document.getElementById('sfpMyMessages');
    if (myMsgEl) myMsgEl.textContent = (row.my_total_messages === null || row.my_total_messages === undefined) ? '—' : Number(row.my_total_messages);

    renderTallyDial('sfpDialParticipants', Number(row.total_participants || 0));
    renderTallyDial('sfpDialVisits', Number(row.total_visits || 0));
  } else {
    console.error('Stats panel poll error:', panelResult.status === 'rejected' ? panelResult.reason : panelResult.value.error);
    ok = false;
  }

  if (totalQuizzesResult.status === 'fulfilled' && !totalQuizzesResult.value.error) {
    renderTallyDial('sfpDialQuizzes', Number(totalQuizzesResult.value.data || 0));
  } else {
    // Most likely cause: superbase/migrations/008_quiz_attempts_persistent_counters.sql
    // hasn't been run yet on this Supabase project — logged once per poll
    // rather than surfaced as its own separate UI state, since the shared
    // live dot below already communicates "something didn't refresh".
    console.error('Total quiz attempts poll error:', totalQuizzesResult.status === 'rejected' ? totalQuizzesResult.reason : totalQuizzesResult.value.error);
    ok = false;
  }

  const myQuizzesEl = document.getElementById('sfpMyQuizzes');
  const hasIdentity = (typeof getForumNickname === 'function') && !!getForumNickname();
  if (!hasIdentity) {
    // No identity yet — "my quizzes taken" doesn't mean anything without
    // one (the RPC below is keyed by device_id, so it'd otherwise show a
    // plain 0 instead of matching "my total messages"'s "—" above).
    if (myQuizzesEl) myQuizzesEl.textContent = '—';
  } else if (myQuizzesResult.status === 'fulfilled' && !myQuizzesResult.value.error) {
    if (myQuizzesEl) myQuizzesEl.textContent = Number(myQuizzesResult.value.data || 0);
  } else {
    console.error('My total quiz attempts poll error:', myQuizzesResult.status === 'rejected' ? myQuizzesResult.reason : myQuizzesResult.value.error);
    ok = false;
  }

  if (typeof _settleLiveDot === 'function') {
    if (ok) _settleLiveDot(dot, 'ok', 'Live — updated just now');
    else _settleLiveDot(dot, 'error', "Couldn't refresh — will retry automatically");
  }
}

function startStatsPanelPolling() {
  stopStatsPanelPolling();
  _statsPanelPollTimer = setInterval(() => {
    // Skip the network round trip while the tab is backgrounded, or while
    // this screen has sat idle 5+ minutes — resumes on its own next active
    // tick, and immediately on visibilitychange/interaction instead of
    // waiting out the rest of the current 5s window.
    if (document.hidden) return;
    if (typeof isStatsIdle === 'function' && isStatsIdle()) return;
    pollStatsPanel();
  }, 5000);
}

function stopStatsPanelPolling() {
  if (_statsPanelPollTimer) {
    clearInterval(_statsPanelPollTimer);
    _statsPanelPollTimer = null;
  }
}

document.addEventListener('visibilitychange', () => {
  if (!document.hidden && _statsPanelPollTimer) pollStatsPanel();
});

// Draws a hand-tally-counter graphic: chrome body, a ring + thumb lever on
// top, and a 4-digit number-wheel window on the front — a live, physical
// "click counter" reading rather than a static number. The body/lever/window
// are built once per svgId; only the digits (and, when they actually change,
// a lever press + digit pulse) re-render on each poll. Used three times now
// (Total forum participants / Total visits / Total quizzes taken, all in
// .sfp-dial-row) — every internal lookup is scoped to `svg` itself (class-
// based, via querySelector) rather than a document-wide id, since three
// copies of the same id on the page isn't valid HTML.
function renderTallyDial(svgId, value) {
  const svg = document.getElementById(svgId);
  if (!svg) return;

  const n = Math.max(0, Math.floor(Number(value) || 0));
  const digitCount = Math.max(4, String(n).length);
  const padded = String(n).padStart(digitCount, '0');

  if (svg.dataset.built !== String(digitCount)) {
    const cx = 75;
    const winX = 25, winY = 63, winW = 100, winH = 40;
    const slotW = winW / digitCount;

    let dividers = '';
    for (let i = 1; i < digitCount; i++) {
      const x = (winX + slotW * i).toFixed(1);
      dividers += `<line x1="${x}" y1="${winY + 3}" x2="${x}" y2="${winY + winH - 3}" class="sfp-tally-divider" />`;
    }

    let tspans = '';
    for (let i = 0; i < digitCount; i++) {
      const x = (winX + slotW * i + slotW / 2).toFixed(1);
      tspans += `<tspan x="${x}">${padded[i]}</tspan>`;
    }

    svg.innerHTML = `
      <!-- lanyard ring -->
      <circle cx="${cx}" cy="12" r="6" class="sfp-tally-ring" />
      <line x1="${cx}" y1="18" x2="${cx}" y2="26" class="sfp-tally-bracket" />
      <!-- thumb lever -->
      <g class="sfp-tally-lever-group">
        <line x1="${cx - 13}" y1="38" x2="${cx - 13}" y2="26" class="sfp-tally-bracket" />
        <line x1="${cx + 13}" y1="38" x2="${cx + 13}" y2="26" class="sfp-tally-bracket" />
        <ellipse cx="${cx}" cy="26" rx="17" ry="8" class="sfp-tally-lever" />
      </g>
      <!-- body -->
      <rect x="12" y="38" width="126" height="102" rx="20" class="sfp-tally-body" />
      <rect x="12" y="38" width="126" height="40" rx="20" class="sfp-tally-shine" />
      <!-- reset wheel on the side -->
      <circle cx="128" cy="95" r="8" class="sfp-tally-wheel" />
      <!-- grip lines near the base -->
      <line x1="30" y1="122" x2="120" y2="122" class="sfp-tally-grip" />
      <line x1="30" y1="128" x2="120" y2="128" class="sfp-tally-grip" />
      <line x1="30" y1="134" x2="120" y2="134" class="sfp-tally-grip" />
      <!-- digit window -->
      <rect x="${winX}" y="${winY}" width="${winW}" height="${winH}" rx="4" class="sfp-tally-window" />
      ${dividers}
      <text x="0" y="${winY + winH / 2 + 6}" text-anchor="middle" class="sfp-tally-count">${tspans}</text>
    `;
    svg.dataset.built = String(digitCount);
    svg.dataset.value = padded;
    return;
  }

  const countText = svg.querySelector('.sfp-tally-count');
  if (countText && svg.dataset.value !== padded) {
    svg.dataset.value = padded;
    Array.from(countText.children).forEach((tspan, i) => { tspan.textContent = padded[i]; });

    countText.classList.remove('sfp-tally-count-pulse');
    void countText.getBBox(); // reflow so the pulse can replay on back-to-back changes
    countText.classList.add('sfp-tally-count-pulse');

    const lever = svg.querySelector('.sfp-tally-lever-group');
    if (lever) {
      lever.classList.remove('sfp-tally-lever-press');
      void lever.getBBox();
      lever.classList.add('sfp-tally-lever-press');
    }
  }
}

// ── Redraw chart on resize ────────────────────────────────────────────────────
window.addEventListener('resize', () => {
  if (document.getElementById('statsScreen').classList.contains('visible')) drawChart();
});

window.addEventListener('DOMContentLoaded', () => {
  initChartTooltip();
});
