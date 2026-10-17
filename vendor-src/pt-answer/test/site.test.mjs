/**
 * Site-side tests: the built bundle (vendor/pt-answer/pt-answer.min.js) with
 * the course rules in js/answer-check.js, run in Node without a browser.
 *
 *   node --test vendor-src/pt-answer/test/site.test.mjs
 *
 * Set COURSES to extra course folders (separated by ";") to check their
 * problems too, e.g. COURSES=../examphys for PHYS 162. Set OLD_ENGINE to a
 * file holding the old js/quiz-engine.js to print how points change against
 * the old two-field engine.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import vm from 'node:vm';

const ROOT = path.resolve(import.meta.dirname, '../../..');
const read = (p) => fs.readFileSync(path.resolve(ROOT, p), 'utf8');

// fmt / fmtUnit come from js/quiz-engine.js, as on the site
function pick(src, name) {
  const m = new RegExp(`^function ${name}\\(.*?^}`, 'ms').exec(src);
  if (!m) throw new Error(`no function ${name}`);
  return m[0];
}
const ctx = vm.createContext({ console });
vm.runInContext(read('vendor/pt-answer/pt-answer.min.js'), ctx);
const quizEngine = read('js/quiz-engine.js');
vm.runInContext(pick(quizEngine, 'fmt') + '\n' + pick(quizEngine, 'fmtUnit'), ctx);
vm.runInContext(read('js/answer-check.js'), ctx);
const site = (name) => vm.runInContext(name, ctx);
const gradeAnswer = site('gradeAnswer');
const expectedAnswerText = site('expectedAnswerText');
const splitAnswer = site('splitAnswer');
const joinAnswer = site('joinAnswer');
const PTAnswer = site('PTAnswer');

const pts = (text, answer, units) => gradeAnswer(text, { answer, units }).pts;

test('grading rules', () => {
  const cases = [
    // [typed, answer, units, points]
    ['9.81 m/s^2', 9.81, ['m/s^2'], 1],
    ['9.81m/s^2', 9.81, ['m/s^2'], 1],
    ['9.81 m s^-2', 9.81, ['m/s^2'], 1],
    ['9.81 m s^(-2)', 9.81, ['m/s^2'], 1],
    ['9.81 m/s²', 9.81, ['m/s^2'], 1],
    ['981 cm/s^2', 9.81, ['m/s^2'], 1],
    ['0.00981 km/s^2', 9.81, ['m/s^2'], 1],
    ['9.81 N/kg', 9.81, ['m/s^2'], 1],
    ['9.81 m/s', 9.81, ['m/s^2'], 0.9],
    ['9.81', 9.81, ['m/s^2'], 0.9],
    ['9.81 m*s^-2', 9.81, ['m/s^2'], 0],
    ['9.81 m·s^-2', 9.81, ['m/s^2'], 0],
    ['9.81 m/s/s', 9.81, ['m/s^2'], 0],
    ['9.7 m/s^2', 9.81, ['m/s^2'], 0],
    ['9.9 m/s^2', 9.81, ['m/s^2'], 1], // within 1%
    ['', 9.81, ['m/s^2'], 0],
    // numbers
    ['1.5e3 N', 1500, ['N'], 1],
    ['1.5E3 N', 1500, ['N'], 1],
    ['1.5*10^3 N', 1500, ['N'], 1],
    ['1.5*10^(3) N', 1500, ['N'], 1],
    ['1.5×10³ N', 1500, ['N'], 1],
    ['3/4', 0.75, [], 1],
    ['(1+2)/4', 0.75, [], 1],
    ['2*pi rad', 6.2832, ['rad'], 1],
    ['2pi', 6.2832, ['rad'], 1],
    ['2 pi', 6.2832, [], 1],
    ['2pi rad', 6.2832, ['rad'], 1],
    ['2 e', 5.4366, [], 1],
    ['sqrt(2)', 1.4142, [], 0],
    ['2,5 m', 2.5, ['m'], 0],
    ['−3 m', -3, ['m'], 1],
    // tiny and zero answers
    ['5.3e-26 kg', 5.3e-26, ['kg'], 1],
    ['5.3*10^-26 kg', 5.3e-26, ['kg'], 1],
    ['5.4e-26 kg', 5.3e-26, ['kg'], 0],
    ['0 kg', 5.3e-26, ['kg'], 0],
    ['0 J', 0, ['J'], 1],
    ['0.0001 J', 0, ['J'], 0],
    // PHYS 162 units
    ['5 V/m', 5, ['N/C', 'V/m'], 1],
    ['5 N/C', 5, ['N/C', 'V/m'], 1],
    ['5000 mV/m', 5, ['N/C', 'V/m'], 1],
    ['5 kg m s^-3 A^-1', 5, ['N/C', 'V/m'], 1],
    ['5 N', 5, ['N/C', 'V/m'], 0.9],
    ['2.2 uF', 2.2, ['µF'], 1],
    ['2.2 µF', 2.2, ['µF'], 1],
    ['2.2 μF', 2.2, ['µF'], 1],
    ['2.2 mcF', 2.2, ['µF'], 1],
    ['2.2 mkF', 2.2, ['µF'], 1],
    ['2200 nF', 2.2, ['µF'], 1],
    ['2.2e-6 F', 2.2, ['µF'], 1],
    ['47 Ω', 47, ['Ohm', 'Ω'], 1],
    ['0.047 kOhm', 47, ['Ohm', 'Ω'], 1],
    ['0.047 kΩ', 47, ['Ohm', 'Ω'], 1],
    ['47 V/A', 47, ['Ohm', 'Ω'], 1],
    ['500 mT', 0.5, ['T'], 1],
    ['0.5 Wb/m^2', 0.5, ['T'], 1],
    ['3 V s', 3, ['Wb'], 1],
    ['3 T m^2', 3, ['Wb'], 1],
    ['2 mH', 0.002, ['H'], 1],
    ['1.6e-19 C', 1.6e-19, ['C'], 1],
    ['1.6e-19 A s', 1.6e-19, ['C'], 1],
    ['3 mA', 0.003, ['A'], 1],
    ['12 kV', 12000, ['V'], 1],
    ['4 keV', 4, ['keV'], 1],
    ['4000 eV', 4, ['keV'], 1],
    ['326.9 nm', 326.9, ['nm'], 1],
    ['0.3269 um', 326.9, ['nm'], 1],
    // rad and no unit are the same
    ['1.2', 1.2, ['rad'], 1],
    ['1.2 rad', 1.2, ['rad'], 1],
    ['1.2 rad', 1.2, [], 1],
    ['1.2 rad', 1.2, ['(none)', ''], 1],
    ['1.2 °', 1.2, ['rad'], 0.9],
    // only SI conversions
    ['20 m/s', 20, ['m/s'], 1],
    ['72 km/h', 20, ['m/s'], 0],
    ['20 km/h', 20, ['m/s'], 0.9],
    ['72 km/h', 72, ['km/h'], 1],
    ['2 L', 0.002, ['m^3'], 0],
    ['2000 mL', 2, ['L'], 1],
    ['30 s', 0.5, ['min'], 0],
    ['1.5 days', 1.5, ['days'], 1],
    // units the table doesn't know match only themselves
    ['3 hectares', 3, ['hectares'], 1],
    ['3 in^3', 3, ['in^3'], 1],
    ['12.5 %', 12.5, ['%'], 1],
    ['12.5%', 12.5, ['%'], 1],
    // Moodle grammar: a unit name once, one "/"
    ['4 m m', 4, ['m^2'], 0],
    ['4 m^2', 4, ['m^2'], 1],
    ['3 J/(kg K)', 3, ['J/(kg K)'], 1],
    ['3 J/kg K', 3, ['J/(kg K)'], 1],
    // exponents as qtype_formulas reads them: 2, -2 or (-2) only
    ['5 m/s^(2)', 5, ['m/s^2'], 0],
    ['5 m s^(-2)', 5, ['m/s^2'], 1],
    ['5 m s^-2', 5, ['m/s^2'], 1],
    ['8 kN m^-2', 8, ['kN m^(-2)'], 1],
    ['5 m^(+2)', 5, ['m^2'], 0],
    ['5 m^+2', 5, ['m^2'], 0],
    ['5 m^1.5', 5, ['m^2'], 0],
    ['5 m²', 5, ['m^2'], 1],
    ['5 s⁻¹', 5, ['s^-1'], 1],
    // the official statement's examples
    ['50 kN m', 50, ['kN m'], 1],
    ['5 (m)', 5, ['m'], 0],
    ['5 km', 5, ['m'], 0],
    ['1e-6 km^2', 1, ['m^2'], 1],
    ['67.1495N', 67.1495, ['N'], 1], // no space: current qtype_formulas splits at the unit too
  ];
  const wrong = cases.filter(([t, a, u, p]) => pts(t, a, u) !== p).map(([t, a, u, p]) => `${JSON.stringify(t)} for ${a} ${JSON.stringify(u)}: got ${pts(t, a, u)}, want ${p}`);
  assert.deepEqual(wrong, []);
});

test('split and join keep what was typed', () => {
  for (const t of ['9.81 m/s^2', '5 N*m', '2*pi rad/s', '1.5e3 N', '7', '3/4', 'abc', '12.5 %']) {
    const { value, unit } = splitAnswer(t);
    assert.equal(joinAnswer(value, unit), t, t);
  }
  assert.deepEqual({ ...splitAnswer('9.81m/s^2') }, { value: '9.81', unit: 'm/s^2' });
  // a valid number with a unit that isn't valid splits there, so it reads as a unit mistake
  for (const [t, value, unit] of [['0.5 m m', '0.5', 'm m'], ['3 m/s/s', '3', 'm/s/s'], ['5 N*m', '5', 'N*m'], ['2pi', '2pi', ''], ['abc', 'abc', '']]) {
    assert.deepEqual({ ...splitAnswer(t) }, { value, unit }, t);
  }
  for (const t of ['0.5 m m', '3 m/s/s', '5 N*m', '7 kg·m']) {
    assert.equal(gradeAnswer(t, { answer: 5, units: ['m'] }).unitStatus, 'invalid', t);
  }
  assert.deepEqual({ ...splitAnswer('  ') }, { value: '', unit: '' });
});

test('preview text', () => {
  const v = site('answerPreview');
  assert.equal(v('67 m/s').ok, true);
  assert.match(v('67 m/s').latex, /67.*dfrac\{\\text\{m\}\}\{\\text\{s\}\}/);
  assert.equal(v('67'), null); // a plain number: no preview, the missing unit isn't hinted at
  assert.equal(v('1e4').ok, true); // but 10^4 notation is previewed
  assert.equal(v('9.81 m/s/s').error, 'unit-syntax');
  assert.equal(v('2,5 m').ok, false);
  assert.match(v('2pi').latex, /2.*\\pi/); // 2π, not 2 of a unit "pi"
  assert.doesNotMatch(v('2pi').latex, /text\{pi\}/);
  assert.match(v('5 hectares').latex, /hectares/); // an unknown unit still splits off
});

// ── the real problems ──
function loadProblems(courseDir) {
  const c = vm.createContext({});
  const dir = path.resolve(ROOT, courseDir, 'course/quizzes');
  const out = [];
  for (const f of fs.readdirSync(dir).filter((f) => /^quiz\d+\.js$/.test(f)).sort()) {
    const n = f.match(/\d+/)[0];
    vm.runInContext(fs.readFileSync(path.join(dir, f), 'utf8') + `\n;this.__p = Quiz_${n}_Problems;`, c);
    for (const p of c.__p) out.push({ ...p, where: `${courseDir} quiz ${n} ${p.id}` });
  }
  return out;
}
const COURSE_DIRS = ['.', ...(process.env.COURSES || '').split(';').filter(Boolean)];
const problems = COURSE_DIRS.flatMap(loadProblems);

test(`every problem accepts its shown answer and each listed unit (${problems.length} problems)`, () => {
  const bad = [];
  for (const p of problems) {
    if (pts(expectedAnswerText(p), p.answer, p.units) !== 1) bad.push(`${p.where}: "${expectedAnswerText(p)}"`);
    for (const u of (p.units || []).filter((u) => u !== '(none)')) {
      const t = joinAnswer(site('fmt')(p.answer), u);
      if (PTAnswer.tryParseUnit(u === '(none)' ? '' : u) === null) continue; // reported below
      if (pts(t, p.answer, p.units) !== 1) bad.push(`${p.where}: "${t}" (listed unit ${u})`);
    }
  }
  assert.deepEqual(bad, []);
});

test('listed units are all valid', () => {
  const bad = problems.flatMap((p) =>
    (p.units || []).filter((u) => PTAnswer.tryParseUnit(u === '(none)' ? '' : u) === null).map((u) => `${p.where}: ${JSON.stringify(u)}`));
  if (bad.length) console.log('Problems listing a unit nobody can type:\n  ' + bad.join('\n  '));
  assert.ok(true);
});

// ── against the old two-field engine ──
test('points against the old engine', { skip: !process.env.OLD_ENGINE }, () => {
  const old = vm.createContext({});
  const src = fs.readFileSync(process.env.OLD_ENGINE, 'utf8');
  const start = src.indexOf('// ─── Number parser (Moodle rules)');
  const end = src.indexOf('function fmt(n)');
  vm.runInContext(src.slice(start, end) + '\n' + pick(src, 'fmt') + '\n' + pick(src, 'fmtUnit'), old);
  const oldPts = (value, unit, p) => {
    const ok = old.numberCorrect(value, p.answer, old.unitConversionFactor(unit, p.units));
    return ok ? (old.unitStatus(unit, p.units) === 'ok' ? 1 : 0.9) : 0;
  };
  const fmt = site('fmt');
  const changes = new Map();
  for (const p of problems) {
    const u0 = (p.units || [])[0] || '';
    const v = fmt(p.answer);
    const unit0 = u0 === '(none)' ? '' : u0;
    const variants = [
      ['listed unit', v, unit0], ['no unit', v, ''], ['unit m', v, 'm'], ['value 5% off', fmt(p.answer * 1.05), unit0],
      ['milli-prefixed', fmt(p.answer * 1000), unit0 ? 'm' + unit0 : ''], ['kilo-prefixed', fmt(p.answer / 1000), unit0 ? 'k' + unit0 : ''],
      ['* between units', v, unit0.replace(/ /g, '*')], ['· between units', v, unit0.replace(/ /g, '·')],
      ['unit written twice', v, unit0 ? `${unit0} ${unit0}` : ''],
      ['*10^ notation', v.replace('e', '*10^'), unit0], ['rad swapped with none', v, unit0 === 'rad' ? '' : unit0 === '' ? 'rad' : unit0],
    ];
    for (const [kind, value, unit] of variants) {
      const before = oldPts(value, unit, p);
      const after = pts(joinAnswer(value, unit), p.answer, p.units);
      if (before === after) continue;
      const key = `${before} → ${after} (${kind})`;
      if (!changes.has(key)) changes.set(key, []);
      changes.get(key).push(`${p.where}: "${joinAnswer(value, unit)}" (units ${JSON.stringify(p.units)})`);
    }
  }
  for (const [key, list] of changes) {
    console.log(`\n${key}: ${list.length} inputs, e.g.\n  ` + list.slice(0, 12).join('\n  '));
  }
});
