/**
 * Differential test: our parser (expr/parser.ts via ast.ts) against the
 * original mathjs-based ast.ts (saved next to it as ast.orig.ts), on a list
 * of hand-picked inputs and on random token soup.
 *
 * For every input the two must agree on parseExpression, with the authoring
 * settings and with the student ones: same AST, node count and depth, or
 * both refuse the same way (syntax / not allowed / budget). Everything after
 * parsing (checks, value, TeX) works on that AST alone, so equal trees mean
 * equal answers.
 *
 * Inputs using syntax our parser leaves out on purpose (objects, ranges,
 * "to"/"in", bitwise operators, "??", "?.") only need to be refused by both.
 *
 * Runs inside a checkout of pt-nu-phys161 (see README.md, "Testing").
 */
import { describe, expect, it } from 'vitest';
import * as mine from '../src/expr/ast.js';
import * as orig from '../src/expr/ast.orig.js';

type Outcome = { ok: true; ast: unknown; nodeCount: number; depth: number } | { ok: false; kind: string };

function outcome(parse: typeof mine.parseExpression, src: string): Outcome {
  try {
    const r = parse(src, { allowLambdas: true });
    return { ok: true, ast: r.ast, nodeCount: r.nodeCount, depth: r.depth };
  } catch (e) {
    const code = (e as { code?: string }).code ?? 'unknown';
    const kind = code.startsWith('disallowed') ? 'not-allowed' : ['too-long', 'too-many-nodes', 'too-deep'].includes(code) ? 'budget' : 'syntax';
    return { ok: false, kind };
  }
}

// Student answers are parsed with tighter limits and no lambdas (acceptance.ts).
const STUDENT = { allowLambdas: false, limits: { maxLength: 200, maxNodes: 200, maxDepth: 32 } };
function studentOutcome(parse: typeof mine.parseExpression, src: string): Outcome {
  try {
    const r = parse(src, STUDENT);
    return { ok: true, ast: r.ast, nodeCount: r.nodeCount, depth: r.depth };
  } catch (e) {
    const code = (e as { code?: string }).code ?? 'unknown';
    return { ok: false, kind: code.startsWith('disallowed') ? 'not-allowed' : ['too-long', 'too-many-nodes', 'too-deep'].includes(code) ? 'budget' : 'syntax' };
  }
}

const LEFT_OUT = /[{}]|(^|[^?]):|\bto\b|\bin\b|[&|]|<<|>>|\?\?|\?\./;

const HAND = [
  // numbers
  '9.81', '-9.81', '+3', '.5', '5.', '1e3', '1E3', '1e-3', '1e+3', '2.5e-3', '1.5E+10', '1e', '2e', '2e+', '2e-x', '1e5.3', '1e.', '3.e2',
  '0x1F', '0b101', '0o17', '0x1.8', '0xFFi8', '0x1FFi8', '0x', '0or', '5%0or', 'or%0or< mod', '00012', '1.2.3', '1..2', '. 5', '5 .', '1e400', '-1e400', '1e-400', 'NaN', 'Infinity', '-Infinity',
  // operators and precedence
  '1+2*3', '(1+2)*3', '2^3^2', '-2^2', '2^-3', '2^-3^2', '-(2)^2', '2*-3', '2*+3', '2--3', '2+-+-3', '6/2/3', '6/2*3', '2^(1/2)',
  '7 mod 3', '7 % 3', '7%3', '50%', '50 %', '100 + 10%', '100 - 10%', '10% + 5', '(50)%', '50%%', '2%3%', '5!', '3!2', '3!!', "x'",
  // implicit multiplication and rule 2
  '2pi', '2 pi', '2(3)', '(2)(3)', '(1+2)(3+4)', '(1+2)3', '2 3', '2(3)4', 'pi 2', 'pi(2)', '2 sqrt(4)', 'sqrt(4)(2)', 'sqrt(4) 2',
  '1/2pi', '1/2 pi', '-1/2pi', '+1/2pi', '1/2/3pi', '1/2(3)', '8pi/2pi', 'pi/2pi', '1/2e', '2e3pi', '3e2(2)', '1/(2pi)', '2 pi / 3 e',
  '1/2 sqrt(2)', '(1)/2pi', '1/-2pi', '1/2^2pi', '2^2pi', '2pi^2', '-2pi', '2*10^-3', '2*10^(-3)', '10^-11', '5*10^4', '3 * 10 ^ 8',
  // names, constants, functions
  'pi', 'e', 'x', 'sqrt(2)', 'sqrt(4, 2)', 'sqrt()', 'sin(pi/6)', 'log(100, 10)', 'abs(-3)', 'f(1)(2)', 'true', 'false', 'null', 'undefined',
  'mod', 'not 1', 'not', 'and', '1 and 0', '1 or 0', '1 xor 1', 'x = 2', 'f(x) = x^2', '2 = 3', '1; 2', '1;', 'a.b', 'pi.x', '[1, 2]', '[1, 2; 3, 4]',
  '[]', '[1, 2][1]', 'v[1]', '"text"', "'text'", '"a\\"b"', '"\\u0041"', '"\\q"', '"open', 'sum([1, 2, 3])', 'norm([3, 4])', 'import("fs")',
  '1 < 2', '1 < 2 < 3', '1 == 1', '1 != 2', '1 <= 2 >= 0', 'true ? 1 : 2', '1 ? 2 : 3 ? 4 : 5', '1 ?', '1 ? 2', 'x ? : 2',
  // brackets and junk
  '(', ')', '()', '(1', '1)', '((1))', '(1)(', '1,2', ',', '2,5', '@', '$', '5$', 'α', '2α', '𝑥', '2 𝑥', '#comment', '1 # note', '1\t+\t2',
  // typography normalised before parsing
  '1' + String.fromCharCode(10) + '2', '1+' + String.fromCharCode(10) + '2', '(1' + String.fromCharCode(10) + '+2)', '1' + String.fromCharCode(13) + '2', '1;' + String.fromCharCode(10) + '2', '#c' + String.fromCharCode(10) + '3',
  '2×3', '2·3', '6÷2', '−5', '2π', 'π/2', '10⁻³', '2·10⁵', '1e⁻³', 'x²', '2**3', '5 000',
];

// Random token soup: short sequences over everything students (and editors) might type.
const TOKENS = [
  '0', '1', '2', '9', '10', '2.5', '.5', '5.', '1e3', '1e-3', 'e', 'E', '.', '+', '-', '*', '/', '^', '%', '!', '(', ')', ',', ' ', ' ',
  'pi', 'x', 'sqrt', 'sin', 'mod', 'not', 'and', 'or', '<', '==', '?', '=', ';', '[', ']', '"', "'", 'true', 'NaN', '2pi', '10^', '×', '·', '−', '²', '⁻', String.fromCharCode(10), '#',
];
function* soup(n: number, seed: number): Generator<string> {
  let s = seed >>> 0;
  const rnd = (k: number): number => {
    s = (Math.imul(s ^ (s >>> 15), 0x2c1b3c6d) + 0x9e3779b9) >>> 0;
    return s % k;
  };
  for (let i = 0; i < n; i++) {
    const len = 1 + rnd(9);
    let out = '';
    for (let j = 0; j < len; j++) out += TOKENS[rnd(TOKENS.length)];
    yield out;
  }
}

function compare(src: string): string | null {
  const a = outcome(orig.parseExpression, src);
  const b = outcome(mine.parseExpression, src);
  if (LEFT_OUT.test(src)) {
    // left out on purpose: when mathjs refuses, we must refuse too
    if (!a.ok && b.ok) return 'mathjs refuses, ours accepts';
    if (a.ok && b.ok && JSON.stringify(a) !== JSON.stringify(b)) return 'different trees';
    return null;
  }
  if (JSON.stringify(a) !== JSON.stringify(b)) return `parse: mathjs ${JSON.stringify(a)}\n       ours   ${JSON.stringify(b)}`;
  const ca = studentOutcome(orig.parseExpression, src);
  const cb = studentOutcome(mine.parseExpression, src);
  if (JSON.stringify(ca) !== JSON.stringify(cb)) return `student: mathjs ${JSON.stringify(ca)}\n         ours   ${JSON.stringify(cb)}`;
  return null;
}

describe('our parser vs mathjs', () => {
  it('agrees on every hand-picked input', () => {
    const diffs = HAND.map((s) => [s, compare(s)] as const).filter(([, d]) => d);
    expect(diffs.map(([s, d]) => `${JSON.stringify(s)}\n  ${d}`).join('\n')).toBe('');
  });

  it.each([20261017, 7])('agrees on 300 000 random inputs (seed %i)', (seed) => {
    const seen = new Set<string>();
    const diffs: string[] = [];
    for (const src of soup(300_000, seed)) {
      if (seen.has(src)) continue;
      seen.add(src);
      const d = compare(src);
      if (d && diffs.length < 25) diffs.push(`${JSON.stringify(src)}\n  ${d}`);
    }
    expect(diffs.join('\n')).toBe('');
  }, 300_000);
});
