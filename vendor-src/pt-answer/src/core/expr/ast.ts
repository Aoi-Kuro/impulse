import { BudgetExceededError, ParseError } from '../errors.js';
import { parseMathLike } from './parser.js';

/**
 * impulse copy: upstream used mathjs here, as a parser only. This copy uses
 * parser.ts instead, which builds the same mathjs-shaped node tree for the
 * syntax an answer field needs; `convert` below is unchanged and turns it
 * into the small, plain-data AST the rest of the code sees.
 */

export type CmpOp = '<' | '>' | '<=' | '>=' | '==' | '!=';
export type BinOp = '+' | '-' | '*' | '/' | '^' | 'mod' | 'and' | 'or' | 'xor' | CmpOp;

export type Ast =
  | { t: 'num'; v: number }
  | { t: 'str'; v: string }
  | { t: 'bool'; v: boolean }
  | { t: 'sym'; name: string }
  | { t: 'bin'; op: BinOp; a: Ast; b: Ast; implicit?: true }
  | { t: 'unary'; op: '-' | '+' | 'not'; a: Ast }
  | { t: 'factorial'; a: Ast }
  | { t: 'paren'; a: Ast }
  | { t: 'call'; name: string; args: Ast[] }
  | { t: 'lambda'; params: string[]; body: Ast }
  | { t: 'array'; items: Ast[] }
  | { t: 'index'; obj: Ast; idx: Ast }
  | { t: 'cond'; c: Ast; a: Ast; b: Ast }
  | { t: 'chain'; ops: CmpOp[]; args: Ast[] };

export interface ParseLimits {
  maxLength: number;
  maxNodes: number;
  maxDepth: number;
}

export const DEFAULT_PARSE_LIMITS: ParseLimits = { maxLength: 4000, maxNodes: 2000, maxDepth: 64 };

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
  '⁺': '+',
};

/**
 * Normalise typographic input before parsing: `**` → `^`, Unicode minus,
 * times and division signs, π, non-breaking spaces and superscript runs
 * (`10⁻¹⁶` → `10^(-16)`).
 */
export function normalizeSource(src: string): string {
  let s = src
    .replace(/[\u00a0\u2009\u202f]/g, ' ')
    .replace(/[\u2212\u2013\u2012]/g, '-')
    .replace(/[×·⋅∙]/g, '*')
    .replace(/÷/g, '/')
    .replace(/π/g, ' pi ')
    .replace(/\*\*/g, '^');
  s = s.replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹⁻⁺]+/g, (run) => `^(${[...run].map((c) => SUPERSCRIPT[c]).join('')})`);
  return s.trim();
}

const OP_MAP: Record<string, BinOp> = {
  add: '+',
  subtract: '-',
  multiply: '*',
  divide: '/',
  pow: '^',
  mod: 'mod',
  and: 'and',
  or: 'or',
  xor: 'xor',
  smaller: '<',
  larger: '>',
  smallerEq: '<=',
  largerEq: '>=',
  equal: '==',
  unequal: '!=',
};

// Minimal structural view of mathjs nodes (we never call their methods).
interface MNode {
  type: string;
  [key: string]: unknown;
}

function parseError(code: string, message: string, params: Record<string, unknown> = {}): ParseError {
  return new ParseError(code, message, params);
}

/** Functions whose first argument may be an inline lambda `f(x) = ...`. */
const LAMBDA_TAKERS = new Set(['solve', 'iterate']);

export interface ParsedExpression {
  ast: Ast;
  nodeCount: number;
  depth: number;
}

/**
 * Parse `src` into the internal AST. Rejects assignment, blocks, ranges,
 * objects, property access and function definitions at the AST level;
 * the only function-definition form allowed is an inline lambda as the first
 * argument of `solve`/`iterate`, and only when `allowLambdas` is set.
 */
export function parseExpression(
  src: string,
  opts: { allowLambdas?: boolean; limits?: Partial<ParseLimits> } = {},
): ParsedExpression {
  const limits = { ...DEFAULT_PARSE_LIMITS, ...opts.limits };
  const normalized = normalizeSource(src);
  if (normalized.length === 0) throw parseError('empty', 'expression is empty');
  if (normalized.length > limits.maxLength) {
    throw new BudgetExceededError('too-long', `expression longer than ${limits.maxLength} characters`, {
      limit: limits.maxLength,
    });
  }

  let root: MNode;
  try {
    root = parseMathLike(normalized) as unknown as MNode;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const m = /\(char (\d+)\)/.exec(msg);
    throw parseError('syntax', `syntax error: ${msg}`, {
      position: m ? Number(m[1]) - 1 : undefined,
      detail: msg,
    });
  }

  let nodeCount = 0;
  let maxDepth = 0;
  const allowLambdas = opts.allowLambdas ?? false;

  const convert = (n: MNode, depth: number, lambdaOk = false): Ast => {
    nodeCount++;
    if (depth > maxDepth) maxDepth = depth;
    if (nodeCount > limits.maxNodes) {
      throw new BudgetExceededError('too-many-nodes', `expression has more than ${limits.maxNodes} nodes`, {
        limit: limits.maxNodes,
      });
    }
    if (depth > limits.maxDepth) {
      throw new BudgetExceededError('too-deep', `expression nested deeper than ${limits.maxDepth}`, {
        limit: limits.maxDepth,
      });
    }
    const d = depth + 1;
    switch (n.type) {
      case 'ConstantNode': {
        const v = n.value;
        if (typeof v === 'number') {
          if (!Number.isFinite(v)) throw parseError('number-out-of-range', 'numeric literal out of range');
          return { t: 'num', v };
        }
        if (typeof v === 'string') return { t: 'str', v };
        if (typeof v === 'boolean') return { t: 'bool', v };
        throw parseError('disallowed-literal', `literal of type ${v === null ? 'null' : typeof v} is not allowed`);
      }
      case 'SymbolNode':
        return { t: 'sym', name: n.name as string };
      case 'ParenthesisNode':
        return { t: 'paren', a: convert(n.content as MNode, d) };
      case 'OperatorNode': {
        const fn = n.fn as string;
        const args = n.args as MNode[];
        if (fn === 'unaryMinus') return { t: 'unary', op: '-', a: convert(args[0]!, d) };
        if (fn === 'unaryPlus') return { t: 'unary', op: '+', a: convert(args[0]!, d) };
        if (fn === 'not') return { t: 'unary', op: 'not', a: convert(args[0]!, d) };
        if (fn === 'factorial') return { t: 'factorial', a: convert(args[0]!, d) };
        const op = OP_MAP[fn];
        if (!op || args.length !== 2) {
          throw parseError('disallowed-operator', `operator "${String(n.op)}" is not allowed`, { operator: n.op });
        }
        const node: Ast = { t: 'bin', op, a: convert(args[0]!, d), b: convert(args[1]!, d) };
        if (n.implicit === true) node.implicit = true;
        return node;
      }
      case 'RelationalNode': {
        const ops = (n.conditionals as string[]).map((c) => {
          const op = OP_MAP[c];
          if (!op) throw parseError('disallowed-operator', `comparison "${c}" is not allowed`);
          return op as CmpOp;
        });
        return { t: 'chain', ops, args: (n.params as MNode[]).map((p) => convert(p, d)) };
      }
      case 'ConditionalNode':
        return {
          t: 'cond',
          c: convert(n.condition as MNode, d),
          a: convert(n.trueExpr as MNode, d),
          b: convert(n.falseExpr as MNode, d),
        };
      case 'FunctionNode': {
        const fnNode = n.fn as MNode;
        if (fnNode.type !== 'SymbolNode') {
          throw parseError('disallowed-call', 'only named functions can be called');
        }
        const name = fnNode.name as string;
        const takesLambda = LAMBDA_TAKERS.has(name);
        const args = (n.args as MNode[]).map((a, i) => convert(a, d, takesLambda && i === 0));
        return { t: 'call', name, args };
      }
      case 'FunctionAssignmentNode': {
        if (!(allowLambdas && lambdaOk)) {
          throw parseError('disallowed-definition', 'function definitions are not allowed', {
            name: n.name,
          });
        }
        const params = (n.params as unknown[]).map(String);
        return { t: 'lambda', params, body: convert(n.expr as MNode, d) };
      }
      case 'ArrayNode':
        return { t: 'array', items: (n.items as MNode[]).map((i) => convert(i, d)) };
      case 'AccessorNode': {
        const index = n.index as MNode;
        const dims = index.dimensions as MNode[];
        if (index.dotNotation || dims.length !== 1) {
          throw parseError('disallowed-access', 'only single-index access like v[1] is allowed');
        }
        return { t: 'index', obj: convert(n.object as MNode, d), idx: convert(dims[0]!, d) };
      }
      case 'AssignmentNode':
        throw parseError('disallowed-assignment', 'assignment is not allowed');
      case 'BlockNode':
        throw parseError('disallowed-block', 'multiple statements are not allowed');
      default:
        throw parseError('disallowed-syntax', `${n.type.replace(/Node$/, '').toLowerCase()} syntax is not allowed`, {
          node: n.type,
        });
    }
  };

  const ast = convert(root, 0);
  return { ast, nodeCount, depth: maxDepth };
}

/** Free identifiers (symbols not bound by an enclosing lambda), in first-use order. */
export function freeSymbols(ast: Ast): string[] {
  const out = new Set<string>();
  const walk = (n: Ast, bound: ReadonlySet<string>): void => {
    switch (n.t) {
      case 'sym':
        if (!bound.has(n.name)) out.add(n.name);
        return;
      case 'num':
      case 'str':
      case 'bool':
        return;
      case 'bin':
        walk(n.a, bound);
        walk(n.b, bound);
        return;
      case 'unary':
      case 'factorial':
      case 'paren':
        walk(n.a, bound);
        return;
      case 'call':
        n.args.forEach((a) => walk(a, bound));
        return;
      case 'lambda':
        walk(n.body, new Set([...bound, ...n.params]));
        return;
      case 'array':
        n.items.forEach((a) => walk(a, bound));
        return;
      case 'index':
        walk(n.obj, bound);
        walk(n.idx, bound);
        return;
      case 'cond':
        walk(n.c, bound);
        walk(n.a, bound);
        walk(n.b, bound);
        return;
      case 'chain':
        n.args.forEach((a) => walk(a, bound));
        return;
    }
  };
  walk(ast, new Set());
  return [...out];
}

/** Names of all functions called anywhere in the tree. */
export function calledFunctions(ast: Ast): string[] {
  const out = new Set<string>();
  const walk = (n: Ast): void => {
    switch (n.t) {
      case 'call':
        out.add(n.name);
        n.args.forEach(walk);
        return;
      case 'bin':
        walk(n.a);
        walk(n.b);
        return;
      case 'unary':
      case 'factorial':
      case 'paren':
        walk(n.a);
        return;
      case 'lambda':
        walk(n.body);
        return;
      case 'array':
        n.items.forEach(walk);
        return;
      case 'index':
        walk(n.obj);
        walk(n.idx);
        return;
      case 'cond':
        walk(n.c);
        walk(n.a);
        walk(n.b);
        return;
      case 'chain':
        n.args.forEach(walk);
        return;
      default:
        return;
    }
  };
  walk(ast);
  return [...out];
}
