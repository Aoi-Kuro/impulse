import { CoreError } from '../errors.js';

/** A parsed unit: component name → exponent, in written order. */
export type UnitMap = Readonly<Record<string, number>>;

export class UnitParseError extends CoreError {}

const SUPERSCRIPT: Record<string, string> = {
  '⁰': '0',
  '¹': '1',
  '²': '2',
  '³': '3',
  '⁴': '4',
  '⁵': '5',
  '⁶': '6',
  '⁷': '7',
  '⁸': '8',
  '⁹': '9',
  '⁻': '-',
};

export function normalizeUnitString(s: string): string {
  return s
    .replace(/\u03bc/g, 'µ') // Greek mu → micro sign
    .replace(/[˚º]/g, '°')
    .replace(/[\u2212\u2013]/g, '-')
    .replace(/[·⋅∙*]/g, ' ')
    .replace(/[\u00a0\u2009\u202f]/g, ' ')
    .replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹⁻]+/g, (run) => `^(${[...run].map((c) => SUPERSCRIPT[c]).join('')})`)
    .trim();
}

const NAME_CHAR = /[\p{L}°Ω%]/u;

function fail(code: string, message: string, input: string): never {
  throw new UnitParseError(code, message, { input });
}

/**
 * Parse a unit string into name → exponent.
 *
 * - space (or `*`, `·`) multiplies: `kg m/s` → {kg: 1, m: 1, s: -1}
 * - `^` exponents: `m s^-1`, `m s^(-1)`, `s^2`; superscripts are accepted
 * - at most one `/`; its right side may be parenthesised; exponents negated
 * - a component name may appear only once
 * - the empty string is dimensionless: {}
 */
export function parseUnit(input: string): UnitMap {
  const s = normalizeUnitString(input);
  const out: Record<string, number> = {};
  if (s === '') return out;

  let i = 0;
  let sign = 1;
  let slashSeen = false;
  let inGroup = false;
  let sawNumerator = false;
  let denominatorCount = 0;

  const skipWs = (): void => {
    while (i < s.length && /\s/.test(s[i]!)) i++;
  };
  const readExponent = (): number => {
    skipWs();
    let text: string;
    if (s[i] === '(') {
      const close = s.indexOf(')', i);
      if (close < 0) fail('unit-syntax', 'unclosed parenthesis in exponent', input);
      text = s.slice(i + 1, close).replace(/\s+/g, '');
      i = close + 1;
    } else {
      const m = /^[+-]?\d+(?:\.\d+)?/.exec(s.slice(i));
      if (!m) fail('unit-syntax', 'expected an exponent after ^', input);
      text = m[0];
      i += m[0].length;
    }
    if (!/^[+-]?\d+(?:\.\d+)?$/.test(text)) fail('unit-syntax', `invalid exponent "${text}"`, input);
    const e = Number(text);
    if (e === 0) fail('unit-syntax', 'exponent 0 is not allowed', input);
    return e;
  };

  while (true) {
    skipWs();
    if (i >= s.length) break;
    const c = s[i]!;
    if (c === '/') {
      if (slashSeen) fail('unit-multiple-slash', 'at most one "/" is allowed', input);
      slashSeen = true;
      sign = -1;
      i++;
      skipWs();
      if (s[i] === '(') {
        inGroup = true;
        i++;
      }
      continue;
    }
    if (c === ')') {
      if (!inGroup) fail('unit-syntax', 'unexpected ")"', input);
      inGroup = false;
      i++;
      skipWs();
      if (i < s.length) fail('unit-syntax', 'unexpected text after ")"', input);
      break;
    }
    if (c === '1' && !slashSeen && !sawNumerator && /^1\s*\//.test(s.slice(i))) {
      // "1/s": a unit numerator placeholder.
      i++;
      sawNumerator = true;
      continue;
    }
    if (!NAME_CHAR.test(c)) fail('unit-syntax', `unexpected "${c}"`, input);
    let j = i;
    while (j < s.length && NAME_CHAR.test(s[j]!)) j++;
    const name = s.slice(i, j);
    i = j;
    sawNumerator = true;
    skipWs();
    let exp = 1;
    if (s[i] === '^') {
      i++;
      exp = readExponent();
    }
    if (Object.hasOwn(out, name)) fail('unit-duplicate', `unit "${name}" appears more than once`, input);
    out[name] = sign * exp;
    if (slashSeen) denominatorCount++;
  }
  if (inGroup) fail('unit-syntax', 'unclosed parenthesis', input);
  if (slashSeen && denominatorCount === 0) fail('unit-syntax', 'missing unit after "/"', input);
  return out;
}

export function tryParseUnit(input: string): UnitMap | null {
  try {
    return parseUnit(input);
  } catch (e) {
    if (e instanceof UnitParseError) return null;
    throw e;
  }
}

// impulse copy: the exponents qtype_formulas' parse_unit accepts after "^"
// (answer_unit.php): a whole number, a negative one, or a negative one in
// brackets. So m^2, s^-1, s^(-1); not s^(2), s^(+2), s^+2 or m^1.5.
const STUDENT_EXPONENT = /\^\s*(?:\(-\d+\)|-\d+|\d+)(?![\d.])/y;

/**
 * A unit as a student may type it: like qtype_formulas, only spaces multiply
 * (`N*m` and `N·m` are invalid), there is no `1/` numerator (`1/s`), and an
 * exponent is `2`, `-2` or `(-2)` (brackets only around a negative one).
 * Authored units keep the looser grammar of `parseUnit`.
 */
export function tryParseStudentUnit(input: string): UnitMap | null {
  if (/[*·⋅∙]/.test(input) || /(^|\s)1\s*\//.test(input.trim())) return null;
  for (let i = input.indexOf('^'); i >= 0; i = input.indexOf('^', i + 1)) {
    STUDENT_EXPONENT.lastIndex = i;
    if (!STUDENT_EXPONENT.test(input)) return null;
  }
  return tryParseUnit(input);
}
