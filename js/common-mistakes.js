// ─── Common mistakes ───────────────────────────────────────────────────
// Shows the common wrong answers in course/quizzes/quizN-mistakes.js:
//
//   - a small "Common mistakes" button in the row under a problem, which
//     opens the list. In a Random quiz the button stays hidden until scores
//     are shown (css/solutions.css), so a timed attempt stays fair; in All
//     Problems it is always there, and opening it is the student's choice;
//   - a reaction when a wrong answer matches a known one. Settings > Study >
//     Common mistakes picks it (getMistakesMode): 'note' writes the reason
//     under the feedback line, 'hint' only flashes the button, 'button' does
//     nothing, and 'off' hides the whole feature.
//
// A reason names the mistake and never the correct final answer, so it is
// safe in All Problems, where the student can still try again.
//
// Each list is drawn the first time it is opened: most never are, and All
// Problems has about 150 cards to typeset.

const MISTAKE_MATCH_TOLERANCE = 0.01;

const QUIZ_MISTAKES = {
  1: typeof Quiz_1_Mistakes !== 'undefined' ? Quiz_1_Mistakes : null,
  2: typeof Quiz_2_Mistakes !== 'undefined' ? Quiz_2_Mistakes : null,
  3: typeof Quiz_3_Mistakes !== 'undefined' ? Quiz_3_Mistakes : null,
};

function problemMistakes(quizNum, problemId) {
  const table = QUIZ_MISTAKES[quizNum];
  return (table && table[problemId]) || [];
}

function getMistakesMode() {
  return typeof getSetting === 'function' ? getSetting('study', 'commonMistakes') || 'note' : 'note';
}

// The typed number in the problem's answer unit (units[0]), or null. An
// answer with a unit that doesn't convert keeps its number as typed: a value
// is often the mistake even when the unit is wrong too.
function _answerInKeyUnits(text, p) {
  const { value, unit } = splitAnswer(text || '');
  const v = PTAnswer.validateAnswer(value, ANSWER_TYPE);
  if (!v.ok) return null;
  const student = unitOrNone(courseUnit(unit));
  if (student && PTAnswer.tryParseStudentUnit(student) !== null) {
    for (const a of (p.units && p.units.length ? p.units : ['']).map(unitOrNone)) {
      const factor = answerUnitFactor(student, a);
      if (factor !== false) return v.value * factor;
    }
  }
  return v.value;
}

// How far `x` is from the nearest power of ten, as a fraction.
function _powerOfTenGap(x) {
  return Math.abs(x / Math.pow(10, Math.round(Math.log10(x))) - 1);
}

// Distance from a typed number to a mistake, or Infinity. An exact match
// always beats one that is off by a power of ten, which also counts (a slip
// in the exponent on top of the mistake). The exception is a mistake that
// is itself a power-of-ten slip, like metres for km: moved by another power
// of ten it would name a cause the student didn't have. A sign slip (m.flip)
// is the right number with the sign reversed, so only that sign can match it.
function _mistakeDistance(typed, m, p) {
  if (m.flip && Math.sign(typed) === Math.sign(p.answer)) return Infinity;
  const ratio = Math.abs(typed) / m.v;
  if (!ratio || !isFinite(ratio)) return Infinity;
  const exact = Math.abs(ratio - 1);
  if (exact <= MISTAKE_MATCH_TOLERANCE) return exact;
  if (_powerOfTenGap(m.v / Math.abs(p.answer)) <= MISTAKE_MATCH_TOLERANCE) return Infinity;
  const shifted = _powerOfTenGap(ratio);
  return shifted <= MISTAKE_MATCH_TOLERANCE ? 1 + shifted : Infinity;
}

// The known mistake a wrong answer matches, closest first. Sign is ignored
// except on sign slips: the wrong values come from magnitudes.
function matchMistake(text, p, quizNum) {
  const list = problemMistakes(quizNum, p.id);
  if (!list.length || gradeAnswer(text || '', p).pts !== 0) return null;
  const typed = _answerInKeyUnits(text, p);
  if (typed === null) return null;
  let best = null, bestDistance = Infinity;
  list.forEach((m) => {
    const d = _mistakeDistance(typed, m, p);
    if (d < bestDistance) { best = m; bestDistance = d; }
  });
  return best;
}

// True when the button will flash for this answer, so the "📘 Solution" flash
// (hintSolutionButton) can stand aside: two flashes point at nothing.
function mistakeWillHint(text, p, quizNum) {
  return getMistakesMode() === 'hint' && !!matchMistake(text, p, quizNum);
}

// MathJax's typesetting doesn't overlap safely, and a Random quiz can add
// several notes in the same moment, so they take turns.
let _mistakeTypesetQueue = Promise.resolve();
function _typesetMistake(el) {
  _mistakeTypesetQueue = _mistakeTypesetQueue.then(() => renderMathIn(el));
  return _mistakeTypesetQueue;
}

// The same quick flash as the Solution button, with the same delay
// (css/solutions.css), so it isn't lost in the card's own jump.
function _flashMistakeButton(fb) {
  const card = fb.closest('.problem-card');
  const btn = card && card.querySelector('.mistake-btn');
  if (!btn) return;
  btn.classList.remove('mistake-btn-hint');
  void btn.offsetWidth;               // restart it on a second wrong answer
  btn.classList.add('mistake-btn-hint');
}

// Takes the list's row for an answer off the list, or marks it. `index` is
// kept on the card because the list is only built when first opened.
function _markMistakeRow(card, index) {
  if (index === undefined) delete card.dataset.mistakeRow;
  else card.dataset.mistakeRow = index;
  card.querySelectorAll('.mistake-panel [data-row]').forEach((el) => {
    el.classList.toggle('mistake-mine', el.dataset.row === card.dataset.mistakeRow);
  });
}

// Takes a card's note away. It can sit outside the feedback line
// (js/card-layout.js), so writing that line doesn't remove it.
function clearMistakeHit(card) {
  if (!card) return;
  const note = card.querySelector('.mistake-hit:not(.card-ghost)');
  if (note) note.remove();
  _markMistakeRow(card);
}

// Call after setting a feedback line. `justChecked` is true on a real check:
// a card being drawn again keeps its note but shouldn't flash.
function showMistakeHit(fb, text, p, quizNum, justChecked) {
  if (!fb) return;
  const card = fb.closest('.problem-card');
  const mode = getMistakesMode();
  const hit = mode === 'off' ? null : matchMistake(text, p, quizNum);
  const row = hit ? problemMistakes(quizNum, p.id).indexOf(hit) : undefined;
  // The same mistake again keeps its note, already typeset.
  const shown = card.querySelector('.mistake-hit:not(.card-ghost)');
  const same = !!shown && shown.dataset.row === String(row);
  if (!same) clearMistakeHit(card);
  if (!hit) return;
  _markMistakeRow(card, row);
  if (mode === 'button') return;
  if (mode === 'hint') {
    if (justChecked) _flashMistakeButton(fb);
    return;
  }
  if (same) return;
  const note = document.createElement('div');
  note.className = 'mistake-hit mistake-typesetting';
  note.dataset.row = row;
  note.innerHTML = hit.n;
  fb.appendChild(note);
  if (typeof placeCardParts === 'function') placeCardParts(card);
  _typesetMistake(note).then(() => note.classList.remove('mistake-typesetting'));
}

function mistakeButtonHtml(quizNum, problemId) {
  if (!problemMistakes(quizNum, problemId).length) return '';
  return `<button type="button" class="mistake-btn" aria-expanded="false"
    data-quiz="${quizNum}" data-problem="${problemId}" onclick="toggleMistakes(this)"><span class="mistake-btn-icon">📋</span><span class="mistake-btn-text"><span class="mistake-btn-long">Common </span>mistakes</span></button>`;
}

function _buildMistakePanel(btn) {
  const rows = problemMistakes(+btn.dataset.quiz, btn.dataset.problem)
    .map((m, i) => `<span class="mistake-value" data-row="${i}">${m.s}</span><span class="mistake-reason" data-row="${i}">${m.n}</span>`)
    .join('');
  const panel = document.createElement('div');
  panel.className = 'mistake-panel';
  panel.innerHTML = `<div class="mistake-panel-body">
    <span class="mistake-head">Answer</span><span class="mistake-head">Reason</span>${rows}
  </div>`;
  return panel;
}

// The list is typeset before its first opening, so it opens at its real
// height and the maths doesn't arrive halfway through the animation.
async function toggleMistakes(btn) {
  if (btn.dataset.typesetting) return;
  const row = btn.closest('.card-check-row');
  const card = row.closest('.problem-card');
  let panel = row.nextElementSibling;
  if (!panel || !panel.classList.contains('mistake-panel')) {
    btn.dataset.typesetting = '1';
    panel = _buildMistakePanel(btn);
    panel.classList.add('mistake-panel-typesetting');
    row.after(panel);
    _markMistakeRow(card, card.dataset.mistakeRow);
    await _typesetMistake(panel);
    panel.classList.remove('mistake-panel-typesetting');
    delete btn.dataset.typesetting;
  }
  const open = !panel.classList.contains('open');
  btn.setAttribute('aria-expanded', String(open));
  smoothCardChange(card, () => panel.classList.toggle('open', open));
}
