import { CoreError } from '../errors.js';
import type { AnswerType } from '../schema/scenario.js';
import type { Ast } from './ast.js';
import { createEvaluator } from './evaluate.js';
import { toTex } from './latex.js';
import { STUDENT_FUNCTIONS } from './names.js';

/**
 * Error codes returned by `validateAnswer`. Codes, not messages: the UI maps
 * them to text (no strings in core).
 */
export type AnswerErrorCode =
  | 'empty'
  | 'too-long'
  | 'syntax'
  | 'number-expected'
  | 'operator-not-allowed'
  | 'function-not-allowed'
  | 'identifier-not-allowed'
  | 'syntax-not-allowed'
  | 'not-a-number'
  | 'domain'
  | 'budget';

export type AnswerValidation =
  | { ok: true; latex: string; value: number }
  | { ok: false; error: AnswerErrorCode; params?: Record<string, unknown> };

/** Student input is untrusted: tight budgets, no lambdas, no authoring helpers. */
const studentEvaluator = createEvaluator({
  allowLambdas: false,
  maxLength: 200,
  maxNodes: 200,
  maxDepth: 32,
  maxSteps: 10_000,
  timeoutMs: 50,
});

const STUDENT_FNS = new Set<string>(STUDENT_FUNCTIONS);
const CONSTANT_NAMES = new Set(['pi', 'e']);
const NUMERIC_OPS = new Set(['+', '-', '*', '/', '^']);

type Violation = { error: AnswerErrorCode; params?: Record<string, unknown> };

function checkNumber(ast: Ast): Violation | null {
  let n = ast;
  if (n.t === 'unary' && n.op !== 'not') n = n.a;
  if (n.t === 'num') return null;
  if (n.t === 'sym') return CONSTANT_NAMES.has(n.name) ? null : { error: 'identifier-not-allowed', params: { name: n.name } };
  if (n.t === 'call') return { error: 'function-not-allowed', params: { name: n.name } };
  if (n.t === 'bin' || n.t === 'unary' || n.t === 'factorial' || n.t === 'paren' || n.t === 'chain') {
    return { error: 'operator-not-allowed' };
  }
  return { error: 'number-expected' };
}

/** First violation in source order for `numeric` / `numericalFormula`. */
function checkExpression(ast: Ast, allowFunctions: boolean): Violation | null {
  const walk = (n: Ast): Violation | null => {
    switch (n.t) {
      case 'num':
        return null;
      case 'sym':
        return CONSTANT_NAMES.has(n.name) ? null : { error: 'identifier-not-allowed', params: { name: n.name } };
      case 'paren':
        return walk(n.a);
      case 'unary':
        return n.op === 'not' ? { error: 'operator-not-allowed', params: { operator: 'not' } } : walk(n.a);
      case 'bin':
        if (!NUMERIC_OPS.has(n.op)) return { error: 'operator-not-allowed', params: { operator: n.op } };
        return walk(n.a) ?? walk(n.b);
      case 'factorial':
        return { error: 'operator-not-allowed', params: { operator: '!' } };
      case 'chain':
        return { error: 'operator-not-allowed', params: { operator: n.ops[0] } };
      case 'call':
        if (!allowFunctions || !STUDENT_FNS.has(n.name)) {
          return { error: 'function-not-allowed', params: { name: n.name } };
        }
        for (const a of n.args) {
          const v = walk(a);
          if (v) return v;
        }
        return null;
      case 'array':
        if (!allowFunctions) return { error: 'syntax-not-allowed' };
        for (const a of n.items) {
          const v = walk(a);
          if (v) return v;
        }
        return null;
      default:
        return { error: 'syntax-not-allowed' };
    }
  };
  return walk(ast);
}

/**
 * Decide whether a student may submit `src` for a part of `answerType`
 * by walking the parsed AST — never by regex. On success returns the
 * TeX for the live preview (number literals formatted by `num`) and the
 * evaluated value.
 */
export function validateAnswer(src: string, answerType: AnswerType, num?: (v: number) => string): AnswerValidation {
  if (src.trim() === '') return { ok: false, error: 'empty' };
  let ast: Ast;
  try {
    ast = studentEvaluator.compile(src).ast;
  } catch (e) {
    return fromError(e);
  }

  const violation =
    answerType === 'number'
      ? checkNumber(ast)
      : checkExpression(ast, answerType === 'numericalFormula');
  if (violation) return { ok: false, ...violation };

  let value: unknown;
  try {
    value = studentEvaluator.evaluate(src);
  } catch (e) {
    return fromError(e);
  }
  if (typeof value !== 'number' || !Number.isFinite(value)) return { ok: false, error: 'not-a-number' };
  return { ok: true, latex: toTex(ast, num), value: value === 0 ? 0 : value };
}

function fromError(e: unknown): AnswerValidation {
  if (!(e instanceof CoreError)) throw e;
  switch (e.name) {
    case 'BudgetExceededError':
      return { ok: false, error: e.code === 'too-long' ? 'too-long' : 'budget' };
    case 'UnknownIdentifierError':
      return {
        ok: false,
        error: e.params.kind === 'function' ? 'function-not-allowed' : 'identifier-not-allowed',
        params: { name: (e.params.identifiers as string[] | undefined)?.[0] },
      };
    case 'DomainError':
      return { ok: false, error: 'domain', params: { reason: e.code } };
    case 'ParseError':
      return e.code.startsWith('disallowed')
        ? { ok: false, error: 'syntax-not-allowed', params: { reason: e.code } }
        : { ok: false, error: 'syntax', params: { position: e.params.position } };
    default:
      return { ok: false, error: 'syntax' };
  }
}
