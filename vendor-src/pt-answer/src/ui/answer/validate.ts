import { type AnswerType, splitCombinedAnswer, tryParseStudentUnit, unitToTex, validateAnswer } from '@pt/core';

export type FieldValidation = { ok: true; latex: string } | { ok: false; error: string };

// The preview mimics qtype_formulas': literals with PHP's 14 significant
// digits, e-notation kept as typed (1.5·10³), units as a fraction with
// centred dots, and a \quad between number and unit.

function moodleNumber(v: number): string {
  const abs = Math.abs(v);
  if (v === 0 || (abs >= 1e-4 && abs < 1e15)) return String(Number(v.toPrecision(14)));
  const [m, e] = v.toExponential(13).split('e') as [string, string];
  return `${Number(m)} \\cdot 10^{${Number(e)}}`;
}

const PLAIN_NUMBER = /^[+-]?(?:\d+\.?\d*|\.\d+)$/;

// impulse copy: the character before the literal is matched ($1) rather than
// looked behind at, since Safari before 16.4 can't parse lookbehind.
const E_LITERAL = /(^|[^\w.])(\d+(?:\.\d*)?|\.\d+)[eE]([+-]?\d+)/g;

/** Preview TeX for an already validated value. */
function valueTex(src: string, fallback: string): string {
  const r = validateAnswer(src.replace(E_LITERAL, '$1$2*10^($3)'), 'numericalFormula', moodleNumber);
  return r.ok ? r.latex : fallback;
}

/**
 * Validate a value field, or a combined "number unit" field. Null means there
 * is nothing to show: a bare number in a combined field gets neither preview
 * nor warning, as in Moodle, so the missing unit is not hinted at.
 */
export function validateField(input: string, answerType: AnswerType, withUnit: boolean): FieldValidation | null {
  if (!withUnit) {
    const r = validateAnswer(input, answerType);
    return r.ok ? { ok: true, latex: valueTex(input, r.latex) } : { ok: false, error: r.error };
  }
  const { value, unit } = splitCombinedAnswer(input, answerType);
  if (unit === '') {
    // No unit, but a valid value: Moodle previews it ("1e4" → 1·10⁴,
    // "10^2"), except a plain number, which gets nothing at all.
    const whole = validateAnswer(value, answerType);
    if (whole.ok) return PLAIN_NUMBER.test(value.trim()) ? null : { ok: true, latex: valueTex(value, whole.latex) };
    // A valid number followed by unit-like text means the unit is what's
    // wrong ("191.88 m/s/s"), not the number.
    const m = /^(.*?[\d).\s])\s*([\p{L}µ°Ω].*)$/u.exec(input.trim());
    if (m && validateAnswer(m[1]!, answerType).ok) return { ok: false, error: 'unit-syntax' };
    return { ok: false, error: whole.error };
  }
  const r = validateAnswer(value, answerType);
  if (!r.ok) return { ok: false, error: r.error };
  if (tryParseStudentUnit(unit) === null) return { ok: false, error: 'unit-syntax' };
  return { ok: true, latex: `${valueTex(value, r.latex)}\\quad ${unitToTex(unit, { fraction: true })}` };
}

export function validateUnitField(input: string): FieldValidation {
  if (input.trim() === '') return { ok: false, error: 'unit-missing' };
  return tryParseStudentUnit(input) ? { ok: true, latex: unitToTex(input, { fraction: true }) } : { ok: false, error: 'unit-syntax' };
}
