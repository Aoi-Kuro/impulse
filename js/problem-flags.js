/* ═══════════════════════════════════════════════════════════════════
   problem-flags.js  ·  Flags on problem cards
   ───────────────────────────────────────────────────────────────────
   A flag button at the top right of every problem card's header, after
   the topic (Random quiz, Entire Set, Stats attempt review),
   like the "Mark for review" flag in an exam app.

     Off  — an outline flag in the faint colour of the topic beside it.
     Tap  — the flag turns C2 (--accent2) and a small window opens under
            it offering C1 (--accent). Ignored (tap elsewhere, Esc),
            the flag simply stays C2.
     Tap a flagged one — the flag is removed.

   One flag per problem, not per card: every card of the same problem on
   the page (and in other tabs, via the 'storage' event) follows it.
   Stored under STORAGE_PREFIX '-problem-flags' as { "q1_P55": 1 | 2 }.
   Synced across devices with the settings (js/settings-sync.js, codes
   flags.q1, flags.q2, …: one set's flags each), so only while Settings >
   Sync & Storage > "Sync settings on this device" is on.

   Requires: course-config.js (STORAGE_PREFIX), css/problem-flags.css.
   ─────────────────────────────────────────────────────────────────── */

const PROBLEM_FLAGS_KEY = STORAGE_PREFIX + '-problem-flags';
// A pole with a single triangular pennant, stroked like js/icons.js's line
// icons; the pennant is filled once flagged (css/problem-flags.css).
const PROBLEM_FLAG_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true">'
  + '<path class="problem-flag-cloth" d="M5.5 3.5 19 8.75 5.5 14Z"/><path d="M5.5 21.5V3.5"/></svg>';
// What the first tap sets; the window under the flag offers the other one.
const PROBLEM_FLAG_DEFAULT = 2;

const problemFlagKey = (quizNum, problemId) => `q${quizNum}_${problemId}`;

function readProblemFlags() {
  try {
    const raw = JSON.parse(localStorage.getItem(PROBLEM_FLAGS_KEY) || 'null');
    return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  } catch (e) { return {}; }   // a corrupt copy reads as no flags
}

/** 0 (not flagged), 1 (C1) or 2 (C2). */
function problemFlagByKey(key) {
  const c = readProblemFlags()[key];
  return c === 1 || c === 2 ? c : 0;
}

function saveProblemFlags(flags) {
  try { localStorage.setItem(PROBLEM_FLAGS_KEY, JSON.stringify(flags)); } catch (e) { /* private mode / quota */ }
}

function setProblemFlag(key, colour) {
  const flags = readProblemFlags();
  if (colour) flags[key] = colour;
  else delete flags[key];
  saveProblemFlags(flags);
  paintProblemFlags(key);
  syncSolveAllFlagFilter();
  paintSolutionListFlags();
  // Stamps the change and schedules a push (a no-op while sync is off).
  if (typeof settingsSyncNoteLocalChanges === 'function') settingsSyncNoteLocalChanges();
}

// ── For settings sync (js/settings-sync.js): one set's flags at a time ──
// { P7: 2, P23: 1 }, keys sorted so the same flags always read as the
// same JSON (the sync spots changes by comparing it).
function readProblemFlagSet(quizNum) {
  const prefix = problemFlagKey(quizNum, '');
  const flags = readProblemFlags();
  const set = {};
  Object.keys(flags).filter((k) => k.startsWith(prefix)).sort().forEach((k) => {
    if (flags[k] === 1 || flags[k] === 2) set[k.slice(prefix.length)] = flags[k];
  });
  return set;
}

function validProblemFlagSet(set) {
  return !!set && typeof set === 'object' && !Array.isArray(set) && Object.keys(set)
    .every((id) => /^[A-Za-z][A-Za-z0-9_-]{0,30}$/.test(id) && (set[id] === 1 || set[id] === 2));
}

// Replaces set quizNum's flags with `set`; the other sets are untouched.
function writeProblemFlagSet(quizNum, set) {
  const prefix = problemFlagKey(quizNum, '');
  const flags = readProblemFlags();
  Object.keys(flags).forEach((k) => { if (k.startsWith(prefix)) delete flags[k]; });
  Object.keys(set).forEach((id) => { flags[prefix + id] = set[id]; });
  saveProblemFlags(flags);
}

// After flags arrive from another device: every card, the progress line
// (it watches the cards) and the "flagged only" button follow.
function applyProblemFlags() {
  paintProblemFlags();
  syncSolveAllFlagFilter();
  paintSolutionListFlags();
}

function paintProblemFlag(btn, colour) {
  btn.dataset.flag = String(colour);
  btn.setAttribute('aria-pressed', String(!!colour));
  btn.title = colour ? 'Flagged · tap to remove' : 'Flag this problem';
}

// Every flag button on the page, or only those of one problem.
function paintProblemFlags(key) {
  const flags = readProblemFlags();
  document.querySelectorAll('.problem-flag-btn[data-flag-key]').forEach((btn) => {
    if (key && btn.dataset.flagKey !== key) return;
    const c = flags[btn.dataset.flagKey];
    paintProblemFlag(btn, c === 1 || c === 2 ? c : 0);
  });
}

/** The header button, for the card templates (js/quiz-engine.js, js/stats.js). */
function problemFlagHtml(quizNum, problemId) {
  const key = String(problemFlagKey(quizNum, problemId)).replace(/[^A-Za-z0-9_-]/g, '');
  const c = problemFlagByKey(key);
  return `<button type="button" class="problem-flag-btn" data-flag-key="${key}" data-flag="${c}"`
    + ` aria-pressed="${!!c}" aria-label="Flag" title="${c ? 'Flagged · tap to remove' : 'Flag this problem'}">${PROBLEM_FLAG_SVG}</button>`;
}

/* ── Flags in the solution list (js/solutions.js) ─────────────────────
   A small filled flag in the top-left corner of a flagged problem's box,
   in its colour, blinking slowly. Every mark's blink is set back by how
   far the page clock is into the period, so marks added at different
   times (another set, a flag synced in) still blink together. */
const PROBLEM_FLAG_BLINK_MS = 2400;   // css/problem-flags.css, problemFlagBlink

function problemFlagListMarkHtml(quizNum, problemId) {
  const c = problemFlagByKey(problemFlagKey(quizNum, problemId));
  if (!c) return '';
  const delay = -(performance.now() % PROBLEM_FLAG_BLINK_MS);
  return `<span class="solution-list-flag" data-flag="${c}" style="animation-delay:${delay.toFixed(0)}ms">${PROBLEM_FLAG_SVG}</span>`;
}

// After a flag changes: the open list's boxes get the new marks.
function paintSolutionListFlags() {
  const grid = document.getElementById('solutionListGrid');
  if (!grid || !grid.dataset.quiz) return;
  const quizNum = +grid.dataset.quiz;
  grid.querySelectorAll('.solution-list-item[data-problem]').forEach((btn) => {
    const old = btn.querySelector('.solution-list-flag');
    const c = problemFlagByKey(problemFlagKey(quizNum, btn.dataset.problem));
    if (old && +old.dataset.flag === c) return;
    if (old) old.remove();
    if (c) btn.insertAdjacentHTML('beforeend', problemFlagListMarkHtml(quizNum, btn.dataset.problem));
  });
}

/* ── The C1 / C2 window ───────────────────────────────────────────────
   One at a time, on <body> with position: fixed, since .problem-card
   clips its overflow. Closed by a choice, a tap outside, Esc, or the
   flag scrolling off screen; closing without a choice leaves the flag
   as it is. */
let problemFlagPop = null;   // { el, btn }

function closeProblemFlagPop(refocus) {
  if (!problemFlagPop) return;
  const { el, btn } = problemFlagPop;
  problemFlagPop = null;
  el.remove();
  if (refocus && btn.isConnected) btn.focus({ preventScroll: true });
}

function openProblemFlagPop(btn) {
  closeProblemFlagPop();
  const key = btn.dataset.flagKey;
  const current = problemFlagByKey(key);
  const el = document.createElement('div');
  el.className = 'problem-flag-pop';
  el.setAttribute('role', 'group');
  el.setAttribute('aria-label', 'Flag colour');
  [1, 2].forEach((c) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'problem-flag-choice';
    b.dataset.flag = String(c);
    b.setAttribute('aria-pressed', String(c === current));
    b.title = b.ariaLabel = `Colour ${c}`;
    b.innerHTML = PROBLEM_FLAG_SVG;
    b.addEventListener('click', () => {
      setProblemFlag(key, c);
      closeProblemFlagPop(true);
    });
    el.appendChild(b);
  });
  document.body.appendChild(el);
  problemFlagPop = { el, btn };
  placeProblemFlagPop();
}

// Under the flag, right edges lined up, kept inside the window. Run again
// on scroll and resize rather than closing then: on a phone, tapping the
// flag while an answer field has the keyboard up closes the keyboard, which
// resizes and may scroll the page in the same moment. Closed only once the
// flag itself is off screen (or gone with a re-render).
function placeProblemFlagPop() {
  if (!problemFlagPop) return;
  const { el, btn } = problemFlagPop;
  const r = btn.getBoundingClientRect();
  if (!btn.isConnected || r.bottom < 0 || r.top > window.innerHeight) { closeProblemFlagPop(); return; }
  const w = el.offsetWidth;
  el.style.top = `${Math.round(r.bottom + 6)}px`;
  el.style.left = `${Math.round(Math.min(Math.max(8, r.right - w), window.innerWidth - w - 8))}px`;
}

document.addEventListener('click', (e) => {
  const btn = e.target.closest && e.target.closest('.problem-flag-btn');
  if (!btn || !btn.dataset.flagKey) return;
  const key = btn.dataset.flagKey;
  if (problemFlagByKey(key)) {
    setProblemFlag(key, 0);
    closeProblemFlagPop();
  } else {
    setProblemFlag(key, PROBLEM_FLAG_DEFAULT);
    openProblemFlagPop(btn);
  }
});

document.addEventListener('pointerdown', (e) => {
  if (!problemFlagPop) return;
  if (problemFlagPop.el.contains(e.target) || problemFlagPop.btn.contains(e.target)) return;
  closeProblemFlagPop();
}, true);
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && problemFlagPop) { e.stopPropagation(); closeProblemFlagPop(true); }
}, true);
document.addEventListener('scroll', placeProblemFlagPop, true);
window.addEventListener('resize', placeProblemFlagPop);

// Flagged or unflagged in another tab.
window.addEventListener('storage', (e) => {
  if (e.key === PROBLEM_FLAGS_KEY || e.key === null) { paintProblemFlags(); syncSolveAllFlagFilter(); paintSolutionListFlags(); }
});

/* ── Solve them all: flagged only ─────────────────────────────────────
   The filter + flag button in the floating score box (#stickyScore) hides
   every card that isn't flagged: the flags-only class on
   #solveAllContainer (css/problem-flags.css). The button shows only while
   this set has a flagged problem, with their count; unflagging the last
   one turns the filter off again, and so does leaving Solve them all. */
const saFlagContainer = () => document.getElementById('solveAllContainer');
const isShownCard = (el) => el.classList.contains('problem-card') && el.getClientRects().length > 0;

function syncSolveAllFlagFilter() {
  const btn = document.getElementById('stickyFlagFilterBtn');
  const c = saFlagContainer();
  if (!btn || !c) return;
  const n = c.querySelectorAll(':scope > .problem-card .problem-flag-btn:not([data-flag="0"])').length;
  if (!n) setSolveAllFlagFilter(false);
  const on = c.classList.contains('flags-only');
  btn.hidden = !n;
  btn.setAttribute('aria-pressed', String(on));
  btn.title = on ? 'Show all problems' : 'Show only flagged problems';
  document.getElementById('stickyFlagCount').textContent = String(n);
}

// Keeps your place: the card at the reading line (30% down the screen,
// as on the progress line) stays at the same height across the change.
// If the filter just hid it, the first flagged problem comes up instead.
function setSolveAllFlagFilter(on) {
  const c = saFlagContainer();
  if (!c || c.classList.contains('flags-only') === on) return;
  const line = window.innerHeight * 0.3;
  const keep = [...c.children].find((el) => isShownCard(el) && el.getBoundingClientRect().bottom > line);
  const before = keep ? keep.getBoundingClientRect().top : 0;
  c.classList.toggle('flags-only', on);
  if (!c.closest('.active')) return;      // Solve them all closed: nothing on screen to keep
  if (keep && isShownCard(keep)) {
    window.scrollBy({ top: keep.getBoundingClientRect().top - before, behavior: 'instant' });
    return;
  }
  const first = [...c.children].find(isShownCard);
  if (first) window.scrollTo({ top: Math.max(0, window.scrollY + first.getBoundingClientRect().top - line), behavior: 'instant' });
}

function toggleSolveAllFlagFilter() {
  const c = saFlagContainer();
  if (!c) return;
  setSolveAllFlagFilter(!c.classList.contains('flags-only'));
  syncSolveAllFlagFilter();
}

(function watchSolveAll() {
  const c = saFlagContainer();
  const mode = document.getElementById('solveAllMode');
  // Cards arrive in batches, and a new set or mode replaces them all.
  if (c) new MutationObserver(syncSolveAllFlagFilter).observe(c, { childList: true });
  if (mode) {
    new MutationObserver(() => {
      if (!mode.classList.contains('active')) setSolveAllFlagFilter(false);
      syncSolveAllFlagFilter();
    }).observe(mode, { attributes: true, attributeFilter: ['class'] });
  }
})();
