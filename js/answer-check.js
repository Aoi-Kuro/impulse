// ─── Answer checking: one field for number and unit ──────────────────────────
// Students type the whole answer in one field ("9.81 m/s^2"), like Moodle,
// and see it previewed under the field while they type. Reading the number,
// the unit and the preview is the pt-answer engine's job
// (vendor/pt-answer/pt-answer.min.js, global PTAnswer; its source, rules and
// tests are in vendor-src/pt-answer). This file applies the course's rules
// on top of it:
//
//   - answer type "numeric": numbers with + - * / ^, brackets, pi and e
//     (9.81, 1.5e3, 2*10^-3, 3/4, 2*pi); no functions
//   - p.units lists the accepted units ([] = none); p.answer is in units[0]
//   - "rad", "none" and "(none)" written alone mean no unit, either way round
//   - units convert by SI prefix and SI equivalence (500 cm = 5 m, J = N m,
//     V/m = N/C), never through non-SI units (km/h is not m/s)
//   - points: right value and unit 1; right value, wrong or missing unit 0.9;
//     a unit that isn't valid (N*m, m m) 0, as in Moodle; wrong value 0
//
// Answers are stored as before, as two strings: entered_value/entered_unit
// in attempts, {ans, unit} in Solve-them-all progress. splitAnswer() makes
// them from the field and joinAnswer() puts them back.

const ANSWER_TYPE = 'numeric';

// What the engine's error codes say in the field's preview.
const ANSWER_MESSAGES = {
  empty: 'Enter an answer.',
  'too-long': 'That answer is too long.',
  syntax: 'Not a valid number. Use a period for decimals: 3.14, 1.6e-19, 2*10^-3.',
  'number-expected': 'Enter a number.',
  'operator-not-allowed': 'That operator isn’t allowed here: use + - * / ^.',
  'function-not-allowed': 'Functions aren’t allowed: enter a number.',
  'identifier-not-allowed': 'Letters belong in the unit, after the number.',
  'syntax-not-allowed': 'Enter a number, then its unit.',
  'not-a-number': 'This doesn’t work out to a number.',
  domain: 'This can’t be worked out (division by zero?).',
  budget: 'That answer is too complex.',
  'unit-syntax': 'Not a valid unit. Multiply with a space (N m), divide with one / (m/s^2).',
  'unit-unknown': 'Unknown unit.',
  'unit-missing': 'Add a unit.',
};

const NO_UNIT = new Set(['', 'rad', 'none', '(none)']);
function unitOrNone(u) {
  const s = (u || '').trim();
  return NO_UNIT.has(s) ? '' : s;
}

// Every name in the unit is one the engine knows (m, kOhm, eV …).
function isKnownUnit(unit) {
  const u = PTAnswer.tryParseUnit(unit);
  return !!u && Object.keys(u).length > 0 && Object.keys(u).every(n => PTAnswer.DEFAULT_UNIT_TABLE.lookup(n));
}

// "9.81 m/s^2" → { value: "9.81", unit: "m/s^2" }.
//   - A whole answer that is a number on its own isn't split at an unknown
//     "unit": "2pi" is 2π, not 2 of a unit called pi.
//   - A number followed by a unit that isn't valid splits there ("0.5 m m",
//     "3 m/s/s"), so it's marked as a unit mistake, not a wrong number.
//   - Anything else that can't be split stays whole in value ("abc").
const NUMBER_THEN_UNIT = /^(.*?[\d).\s])\s*([\p{L}µ°Ω%].*)$/u;
function splitAnswer(text) {
  const s = (text || '').trim();
  if (!s) return { value: '', unit: '' };
  const split = PTAnswer.splitCombinedAnswer(s, ANSWER_TYPE);
  const wholeIsNumber = PTAnswer.validateAnswer(s, ANSWER_TYPE).ok;
  if (split.unit && !isKnownUnit(split.unit) && wholeIsNumber) return { value: s, unit: '' };
  if (!split.unit && !wholeIsNumber) {
    const m = NUMBER_THEN_UNIT.exec(s);
    if (m && PTAnswer.validateAnswer(m[1], ANSWER_TYPE).ok) return { value: m[1].trim(), unit: m[2].trim() };
  }
  return split;
}

function joinAnswer(value, unit) {
  return [value, unit].map(x => (x || '').trim()).filter(Boolean).join(' ');
}

// Conversion factor from the student's unit to an accepted one, or false.
function answerUnitFactor(student, accepted) {
  if (!student || !accepted) return student === accepted ? 1 : false;
  return PTAnswer.areCompatible(student, accepted);
}

/** Grades the text of an answer field against problem p.
    → { pts: 1 | 0.9 | 0, valueOk, unitStatus, value, unit }, where
    unitStatus is 'ok', 'wrong', 'missing' (none typed, one expected) or
    'invalid' (not a valid unit: no points). */
function gradeAnswer(text, p) {
  const { value, unit } = splitAnswer(text);
  const out = { pts: 0, valueOk: false, unitStatus: 'ok', value, unit };
  if (unit && PTAnswer.tryParseStudentUnit(unit) === null) {
    out.unitStatus = 'invalid';
    return out;
  }
  const student = unitOrNone(unit);
  const accepted = (p.units && p.units.length ? p.units : ['']).map(unitOrNone);
  // units[0] first: the stored answer is written in it
  let factor = false;
  for (const a of accepted) {
    factor = answerUnitFactor(student, a);
    if (factor !== false) break;
  }
  if (factor === false) out.unitStatus = student ? 'wrong' : 'missing';
  const v = PTAnswer.validateAnswer(value, ANSWER_TYPE);
  if (!v.ok) return out;
  out.valueOk = PTAnswer.withinTolerance(v.value * (factor === false ? 1 : factor), p.answer, { tolerance: {} });
  out.pts = out.valueOk ? (out.unitStatus === 'ok' ? 1 : 0.9) : 0;
  return out;
}

// The stored answer, as a student would type it ("8.99e9 N m^2/C").
function expectedAnswerText(p) {
  const u = (p.units || [])[0];
  return joinAnswer(fmt(p.answer), u === '(none)' ? '' : u);
}

// Feedback line under a checked answer. withExpected: also say what the
// answer was (Random quiz and review do; the practice modes let you retry).
function answerFeedbackHtml(res, p, withExpected) {
  const unit = `<strong>${fmtUnit(p.units)}</strong>`;
  const expected = withExpected ? ` Expected ≈ <strong>${fmt(p.answer)}</strong> ${fmtUnit(p.units)}` : '';
  if (res.pts === 1) return `✓ Correct <span class="pts-badge pts-full">+1 pt</span>`;
  if (res.pts === 0.9) {
    const hint = res.unitStatus === 'missing' ? `the unit is missing: ${unit}` : `unit should be ${unit}`;
    return `✓ Value correct, but ${hint} <span class="pts-badge pts-partial">+0.9 pt</span>`;
  }
  if (res.unitStatus === 'invalid') {
    return `✗ Unit format invalid: a space multiplies (N m), one / divides (m/s^2).${expected} <span class="pts-badge pts-zero">+0 pt</span>`;
  }
  return withExpected
    ? `✗${expected} <span class="pts-badge pts-zero">+0 pt</span>`
    : `✗ Wrong answer <span class="pts-badge pts-zero">+0 pt</span>`;
}

const ANSWER_RESULT_CLASSES = ['correct-input', 'partial-input', 'wrong-input'];
function markAnswerInput(input, pts) {
  input.classList.remove(...ANSWER_RESULT_CLASSES);
  if (pts != null) input.classList.add(pts === 1 ? 'correct-input' : pts === 0.9 ? 'partial-input' : 'wrong-input');
}

// maxlength: the attempts sync (superbase/edge-functions/sync-quiz-attempts.ts)
// refuses a whole batch if entered_value or entered_unit is over 200
// characters; the split pieces can't be longer than what was typed.
function answerInputHtml(id) {
  return `<input class="answer-input" id="${id}" type="text" placeholder="Answer" maxlength="200"
    autocomplete="off" autocapitalize="off" spellcheck="false" aria-label="Answer: number and unit">`;
}

// ── Live preview ──
// Moodle-style: while a field has focus, a box under it shows the answer as
// read ("67 m/s" with a proper fraction) or what's wrong with it. A plain
// number shows nothing, so a missing unit isn't hinted at. One box for the
// whole page, attached to <body> (the cards clip their overflow), placed
// under the focused field and kept there on scroll and resize.
let _previewBox = null, _previewFor = null, _previewTimer = 0, _previewShown = '';

function _previewEl() {
  if (!_previewBox) {
    _previewBox = document.createElement('div');
    _previewBox.className = 'answer-preview';
    _previewBox.setAttribute('role', 'status');
    _previewBox.hidden = true;
    document.body.appendChild(_previewBox);
    const follow = () => { if (_previewFor && !_previewBox.hidden) _placePreview(); };
    window.addEventListener('scroll', follow, { capture: true, passive: true });
    window.addEventListener('resize', follow, { passive: true });
  }
  return _previewBox;
}

function _placePreview() {
  const r = _previewFor.getBoundingClientRect();
  const box = _previewBox;
  box.style.left = Math.max(8, Math.min(r.left, window.innerWidth - box.offsetWidth - 8)) + 'px';
  box.style.top = (r.bottom + 4) + 'px';
}

function _hidePreview() {
  clearTimeout(_previewTimer);
  if (_previewBox) _previewBox.hidden = true;
  _previewFor = null;
}

// What the preview shows for a field's text: { ok, latex } or { ok: false,
// error }, or null for nothing. A number with no unit is read as splitAnswer
// reads it (2pi is 2π); a plain one ("67") shows nothing, as in Moodle.
function answerPreview(text) {
  const s = (text || '').trim();
  if (!s) return null;
  const { value, unit } = splitAnswer(s);
  if (!unit && value === s && PTAnswer.validateAnswer(s, ANSWER_TYPE).ok) {
    return /^[+-]?(?:\d+\.?\d*|\.\d+)$/.test(s) ? null : PTAnswer.validateField(s, ANSWER_TYPE, false);
  }
  return PTAnswer.validateField(s, ANSWER_TYPE, true);
}

function _showPreview(input) {
  if (document.activeElement !== input || input.disabled || input.readOnly) return _hidePreview();
  const r = answerPreview(input.value);
  if (!r) return _hidePreview();
  const box = _previewEl();
  const key = r.ok ? 'ok:' + r.latex : 'error:' + r.error;
  _previewFor = input;
  if (key !== _previewShown || box.hidden) {
    _previewShown = key;
    if (window.MathJax && MathJax.typesetClear) { try { MathJax.typesetClear([box]); } catch (e) { /* ignore */ } }
    box.classList.toggle('error', !r.ok);
    box.textContent = r.ok ? `\\(${r.latex}\\)` : PTAnswer.message(r.error, ANSWER_MESSAGES);
    box.hidden = false;
    _placePreview();
    if (r.ok) renderMathIn(box).then(() => { if (_previewFor === input) _placePreview(); });
  } else {
    _placePreview();
  }
}

function attachAnswerPreview(input) {
  if (!input) return;
  input.addEventListener('input', () => {
    clearTimeout(_previewTimer);
    _previewTimer = setTimeout(() => _showPreview(input), 300);
  });
  input.addEventListener('focus', () => _showPreview(input));
  input.addEventListener('blur', () => { if (_previewFor === input || !_previewFor) _hidePreview(); });
}
