import { BudgetExceededError, DomainError, UnknownIdentifierError } from '../errors.js';
import { roundHalfAway } from '../numbers/decimal.js';
import { type Ast, type BinOp, type CmpOp, freeSymbols, type ParseLimits, parseExpression } from './ast.js';
import { CONSTANTS } from './names.js';

/** A value an expression can produce or read from scope. */
export type Value = number | boolean | string | number[];
export type Scope = Readonly<Record<string, Value>>;

interface Lambda {
  kind: 'lambda';
  params: string[];
  body: Ast;
  env: Env;
}
type RtValue = Value | Lambda;

interface Env {
  scope: Scope;
  locals: ReadonlyMap<string, RtValue> | null;
}

export interface EvaluatorOptions extends Partial<ParseLimits> {
  /** Permit `solve(f(x) = ..., lo, hi)` / `iterate(...)` lambdas. Default true. */
  allowLambdas?: boolean;
  /** Maximum node evaluations per `evaluate` call (loops count). Default 1e6. */
  maxSteps?: number;
  /** Wall-clock guard per `evaluate` call, in ms. Default 250. */
  timeoutMs?: number;
}

export interface Compiled {
  readonly source: string;
  readonly ast: Ast;
  /** Free identifiers the expression reads from scope (constants excluded). */
  readonly identifiers: readonly string[];
}

export interface Evaluator {
  compile(src: string): Compiled;
  evaluate(compiled: Compiled | string, scope?: Scope): Value;
}

const CACHE_LIMIT = 2000;

export function createEvaluator(opts: EvaluatorOptions = {}): Evaluator {
  const allowLambdas = opts.allowLambdas ?? true;
  const maxSteps = opts.maxSteps ?? 1_000_000;
  const timeoutMs = opts.timeoutMs ?? 250;
  const limits: Partial<ParseLimits> = {
    ...(opts.maxLength !== undefined && { maxLength: opts.maxLength }),
    ...(opts.maxNodes !== undefined && { maxNodes: opts.maxNodes }),
    ...(opts.maxDepth !== undefined && { maxDepth: opts.maxDepth }),
  };
  const cache = new Map<string, Compiled>();

  function compile(src: string): Compiled {
    const hit = cache.get(src);
    if (hit) return hit;
    const { ast } = parseExpression(src, { allowLambdas, limits });
    const unknownFns = calledUnknown(ast);
    if (unknownFns.length > 0) {
      throw new UnknownIdentifierError('unknown-function', `unknown function ${unknownFns.join(', ')}`, {
        identifiers: unknownFns,
        kind: 'function',
      });
    }
    const identifiers = freeSymbols(ast).filter((n) => !(n in CONSTANTS));
    const compiled: Compiled = Object.freeze({ source: src, ast, identifiers: Object.freeze(identifiers) });
    if (cache.size >= CACHE_LIMIT) cache.delete(cache.keys().next().value as string);
    cache.set(src, compiled);
    return compiled;
  }

  function evaluate(c: Compiled | string, scope: Scope = {}): Value {
    const compiled = typeof c === 'string' ? compile(c) : c;
    const missing = compiled.identifiers.filter((n) => !Object.hasOwn(scope, n));
    if (missing.length > 0) {
      throw new UnknownIdentifierError('unknown-identifier', `unknown identifier ${missing.join(', ')}`, {
        identifiers: missing,
        kind: 'variable',
      });
    }
    const run = new Run(maxSteps, timeoutMs);
    const v = run.eval(compiled.ast, { scope, locals: null });
    if (isLambda(v)) throw new DomainError('lambda-result', 'a function is not a value');
    return v;
  }

  return { compile, evaluate };
}

function calledUnknown(ast: Ast): string[] {
  const out = new Set<string>();
  const walk = (n: Ast): void => {
    switch (n.t) {
      case 'call':
        if (!FUNCTIONS.has(n.name)) out.add(n.name);
        n.args.forEach(walk);
        break;
      case 'bin':
        walk(n.a);
        walk(n.b);
        break;
      case 'unary':
      case 'factorial':
      case 'paren':
        walk(n.a);
        break;
      case 'lambda':
        walk(n.body);
        break;
      case 'array':
        n.items.forEach(walk);
        break;
      case 'index':
        walk(n.obj);
        walk(n.idx);
        break;
      case 'cond':
        walk(n.c);
        walk(n.a);
        walk(n.b);
        break;
      case 'chain':
        n.args.forEach(walk);
        break;
      default:
        break;
    }
  };
  walk(ast);
  return [...out];
}

// ---------------------------------------------------------------------------

function isLambda(v: RtValue): v is Lambda {
  return typeof v === 'object' && v !== null && !Array.isArray(v) && v.kind === 'lambda';
}

function domain(code: string, message: string, params: Record<string, unknown> = {}): DomainError {
  return new DomainError(code, message, params);
}

function finite(x: number, what: string): number {
  if (Number.isNaN(x)) throw domain('nan', `${what} is not a number`);
  if (!Number.isFinite(x)) throw domain('non-finite', `${what} is not finite`);
  return x;
}

function num(v: RtValue, what: string): number {
  if (typeof v === 'number') return v;
  if (typeof v === 'boolean') return v ? 1 : 0;
  throw domain('type', `${what} must be a number`, { got: describe(v) });
}

function truthy(v: RtValue): boolean {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v !== 0;
  throw domain('type', 'condition must be a boolean or number', { got: describe(v) });
}

function describe(v: RtValue): string {
  if (Array.isArray(v)) return 'array';
  if (isLambda(v)) return 'function';
  return typeof v;
}

type Fn = (run: Run, args: RtValue[]) => RtValue;

const FUNCTIONS = new Map<string, { fn: Fn }>();

function unary(name: string, f: (x: number) => number, check?: (x: number) => string | null): void {
  FUNCTIONS.set(name, {
    fn: (_run, args) => {
      if (args.length !== 1) throw domain('arity', `${name} takes 1 argument`, { fn: name });
      const x = num(args[0]!, `${name} argument`);
      const bad = check?.(x);
      if (bad) throw domain(bad, `${name}(${x}) is undefined`, { fn: name, arg: x });
      return finite(f(x), `${name}(${x})`);
    },
  });
}

function flatNums(name: string, args: RtValue[]): number[] {
  const out: number[] = [];
  for (const a of args) {
    if (Array.isArray(a)) out.push(...a);
    else out.push(num(a, `${name} argument`));
  }
  if (out.length === 0) throw domain('arity', `${name} needs at least one value`, { fn: name });
  return out;
}

function vector(v: RtValue, name: string): number[] {
  if (!Array.isArray(v)) throw domain('type', `${name} expects an array`, { fn: name });
  return v;
}

unary('sqrt', Math.sqrt, (x) => (x < 0 ? 'sqrt-negative' : null));
unary('abs', Math.abs);
unary('exp', Math.exp);
unary('ln', Math.log, (x) => (x <= 0 ? 'log-non-positive' : null));
unary('log10', Math.log10, (x) => (x <= 0 ? 'log-non-positive' : null));
unary('sin', Math.sin);
unary('cos', Math.cos);
unary('tan', Math.tan);
unary('asin', Math.asin, (x) => (x < -1 || x > 1 ? 'asin-domain' : null));
unary('acos', Math.acos, (x) => (x < -1 || x > 1 ? 'acos-domain' : null));
unary('atan', Math.atan);
unary('sinh', Math.sinh);
unary('cosh', Math.cosh);
unary('tanh', Math.tanh);
unary('floor', Math.floor);
unary('ceil', Math.ceil);
unary('sign', Math.sign);
unary('deg', (x) => (x * 180) / Math.PI);
unary('rad', (x) => (x * Math.PI) / 180);
unary(
  'factorial',
  (x) => {
    let r = 1;
    for (let i = 2; i <= x; i++) r *= i;
    return r;
  },
  (x) => (!Number.isInteger(x) || x < 0 ? 'factorial-domain' : x > 170 ? 'factorial-overflow' : null),
);

FUNCTIONS.set('log', {
  fn: (_run, args) => {
    if (args.length < 1 || args.length > 2) throw domain('arity', 'log takes 1 or 2 arguments', { fn: 'log' });
    const x = num(args[0]!, 'log argument');
    if (x <= 0) throw domain('log-non-positive', `log(${x}) is undefined`, { fn: 'log', arg: x });
    if (args.length === 1) return Math.log(x);
    const b = num(args[1]!, 'log base');
    if (b <= 0 || b === 1) throw domain('log-base', `log base ${b} is invalid`, { fn: 'log', arg: b });
    return finite(Math.log(x) / Math.log(b), 'log');
  },
});
FUNCTIONS.set('atan2', {
  fn: (_run, args) => {
    if (args.length !== 2) throw domain('arity', 'atan2 takes 2 arguments', { fn: 'atan2' });
    return Math.atan2(num(args[0]!, 'atan2 y'), num(args[1]!, 'atan2 x'));
  },
});
FUNCTIONS.set('round', {
  fn: (_run, args) => {
    if (args.length < 1 || args.length > 2) throw domain('arity', 'round takes 1 or 2 arguments', { fn: 'round' });
    const x = num(args[0]!, 'round argument');
    const n = args.length === 2 ? num(args[1]!, 'round decimals') : 0;
    if (!Number.isInteger(n) || n < 0 || n > 15) throw domain('round-decimals', 'round decimals must be 0..15');
    return roundHalfAway(x, n);
  },
});
FUNCTIONS.set('min', { fn: (_r, args) => Math.min(...flatNums('min', args)) });
FUNCTIONS.set('max', { fn: (_r, args) => Math.max(...flatNums('max', args)) });
FUNCTIONS.set('sum', { fn: (_r, args) => finite(flatNums('sum', args).reduce((a, b) => a + b, 0), 'sum') });
FUNCTIONS.set('hypot', { fn: (_r, args) => finite(Math.hypot(...flatNums('hypot', args)), 'hypot') });
FUNCTIONS.set('norm', {
  fn: (_r, args) => {
    if (args.length !== 1) throw domain('arity', 'norm takes 1 argument', { fn: 'norm' });
    return finite(Math.hypot(...vector(args[0]!, 'norm')), 'norm');
  },
});
FUNCTIONS.set('dot', {
  fn: (_r, args) => {
    if (args.length !== 2) throw domain('arity', 'dot takes 2 arguments', { fn: 'dot' });
    const a = vector(args[0]!, 'dot');
    const b = vector(args[1]!, 'dot');
    if (a.length !== b.length) throw domain('dimension-mismatch', 'dot: arrays differ in length');
    return finite(
      a.reduce((s, x, i) => s + x * b[i]!, 0),
      'dot',
    );
  },
});
FUNCTIONS.set('cross', {
  fn: (_r, args) => {
    if (args.length !== 2) throw domain('arity', 'cross takes 2 arguments', { fn: 'cross' });
    const a = vector(args[0]!, 'cross');
    const b = vector(args[1]!, 'cross');
    if (a.length !== 3 || b.length !== 3) throw domain('dimension-mismatch', 'cross needs two 3-vectors');
    const [a1, a2, a3] = a as [number, number, number];
    const [b1, b2, b3] = b as [number, number, number];
    return [a2 * b3 - a3 * b2, a3 * b1 - a1 * b3, a1 * b2 - a2 * b1];
  },
});
FUNCTIONS.set('clamp', {
  fn: (_r, args) => {
    if (args.length !== 3) throw domain('arity', 'clamp takes 3 arguments', { fn: 'clamp' });
    const [x, lo, hi] = args.map((a, i) => num(a, `clamp argument ${i + 1}`)) as [number, number, number];
    if (lo > hi) throw domain('clamp-bounds', 'clamp: lo > hi');
    return Math.min(hi, Math.max(lo, x));
  },
});

function callLambda(run: Run, f: RtValue, args: number[], name: string): number {
  if (!isLambda(f)) throw domain('type', `${name} expects a function like f(x) = ... as first argument`, { fn: name });
  if (f.params.length !== args.length) {
    throw domain('arity', `${name}: function must take ${args.length} parameter(s)`, { fn: name });
  }
  const locals = new Map<string, RtValue>(f.env.locals ?? []);
  f.params.forEach((p, i) => locals.set(p, args[i]!));
  return num(run.eval(f.body, { scope: f.env.scope, locals }), `${name} function result`);
}

FUNCTIONS.set('solve', {
  // Bisection root-finder: solve(f(x) = ..., lo, hi) → x with f(x) = 0.
  fn: (run, args) => {
    if (args.length !== 3) throw domain('arity', 'solve takes (f, lo, hi)', { fn: 'solve' });
    const f = args[0]!;
    let lo = num(args[1]!, 'solve lo');
    let hi = num(args[2]!, 'solve hi');
    let flo = callLambda(run, f, [lo], 'solve');
    const fhi = callLambda(run, f, [hi], 'solve');
    if (flo === 0) return lo;
    if (fhi === 0) return hi;
    if (Math.sign(flo) === Math.sign(fhi)) {
      throw domain('solve-no-bracket', 'solve: f(lo) and f(hi) have the same sign', { lo, hi, flo, fhi });
    }
    for (let i = 0; i < 200; i++) {
      const mid = lo + (hi - lo) / 2;
      if (mid === lo || mid === hi) return mid;
      const fm = callLambda(run, f, [mid], 'solve');
      if (fm === 0) return mid;
      if (Math.sign(fm) === Math.sign(flo)) {
        lo = mid;
        flo = fm;
      } else {
        hi = mid;
      }
    }
    return lo + (hi - lo) / 2;
  },
});
FUNCTIONS.set('iterate', {
  // iterate(f(x) = ..., x0, n) → f applied n times to x0.
  fn: (run, args) => {
    if (args.length !== 3) throw domain('arity', 'iterate takes (f, x0, n)', { fn: 'iterate' });
    let x = num(args[1]!, 'iterate x0');
    const n = num(args[2]!, 'iterate n');
    if (!Number.isInteger(n) || n < 0 || n > 100_000) throw domain('iterate-count', 'iterate: n must be 0..100000');
    for (let i = 0; i < n; i++) x = callLambda(run, args[0]!, [x], 'iterate');
    return x;
  },
});

/** Every function name the evaluator implements (kept in sync with names.ts by test). */
export const IMPLEMENTED_FUNCTIONS: readonly string[] = [...FUNCTIONS.keys()];

class Run {
  private steps = 0;
  private readonly deadline: number;

  constructor(
    private readonly maxSteps: number,
    timeoutMs: number,
  ) {
    this.deadline = Date.now() + timeoutMs;
  }

  private tick(): void {
    this.steps++;
    if (this.steps > this.maxSteps) {
      throw new BudgetExceededError('too-many-steps', `evaluation exceeded ${this.maxSteps} steps`, {
        limit: this.maxSteps,
      });
    }
    if ((this.steps & 1023) === 0 && Date.now() > this.deadline) {
      throw new BudgetExceededError('timeout', 'evaluation took too long');
    }
  }

  eval(n: Ast, env: Env): RtValue {
    this.tick();
    switch (n.t) {
      case 'num':
      case 'str':
      case 'bool':
        return n.v;
      case 'sym': {
        if (env.locals?.has(n.name)) return env.locals.get(n.name)!;
        if (Object.hasOwn(env.scope, n.name)) return env.scope[n.name]!;
        const c = CONSTANTS[n.name];
        if (c !== undefined) return c;
        throw new UnknownIdentifierError('unknown-identifier', `unknown identifier ${n.name}`, {
          identifiers: [n.name],
          kind: 'variable',
        });
      }
      case 'paren':
        return this.eval(n.a, env);
      case 'unary': {
        const v = this.eval(n.a, env);
        if (n.op === 'not') return !truthy(v);
        if (Array.isArray(v)) return n.op === '-' ? v.map((x) => -x) : v;
        const x = num(v, 'operand');
        return n.op === '-' ? -x : x;
      }
      case 'factorial':
        return FUNCTIONS.get('factorial')!.fn(this, [this.eval(n.a, env)]);
      case 'bin':
        return this.binary(n.op, n.a, n.b, env);
      case 'chain': {
        let left = this.eval(n.args[0]!, env);
        for (let i = 0; i < n.ops.length; i++) {
          const right = this.eval(n.args[i + 1]!, env);
          if (!compare(n.ops[i]!, left, right)) return false;
          left = right;
        }
        return true;
      }
      case 'cond':
        return truthy(this.eval(n.c, env)) ? this.eval(n.a, env) : this.eval(n.b, env);
      case 'array':
        return n.items.map((item, i) => {
          const v = this.eval(item, env);
          if (typeof v !== 'number') throw domain('array-element', `array element ${i + 1} must be a number`);
          return v;
        });
      case 'index': {
        const obj = this.eval(n.obj, env);
        if (!Array.isArray(obj)) throw domain('index-non-array', 'only arrays can be indexed');
        const i = num(this.eval(n.idx, env), 'index');
        if (!Number.isInteger(i) || i < 1 || i > obj.length) {
          throw domain('index-out-of-range', `index ${i} out of range 1..${obj.length} (indices are 1-based)`, {
            index: i,
            length: obj.length,
          });
        }
        return obj[i - 1]!;
      }
      case 'lambda':
        return { kind: 'lambda', params: n.params, body: n.body, env };
      case 'call': {
        const f = FUNCTIONS.get(n.name);
        if (!f) {
          throw new UnknownIdentifierError('unknown-function', `unknown function ${n.name}`, {
            identifiers: [n.name],
            kind: 'function',
          });
        }
        const args = n.args.map((a) => this.eval(a, env));
        if (n.name !== 'solve' && n.name !== 'iterate' && args.some(isLambda)) {
          throw domain('type', `${n.name} does not take a function argument`);
        }
        return f.fn(this, args);
      }
    }
  }

  private binary(op: BinOp, an: Ast, bn: Ast, env: Env): RtValue {
    if (op === 'and') return truthy(this.eval(an, env)) && truthy(this.eval(bn, env));
    if (op === 'or') return truthy(this.eval(an, env)) || truthy(this.eval(bn, env));
    const a = this.eval(an, env);
    const b = this.eval(bn, env);
    if (op === 'xor') return truthy(a) !== truthy(b);
    if (op === '<' || op === '>' || op === '<=' || op === '>=' || op === '==' || op === '!=') {
      return compare(op, a, b);
    }
    if (Array.isArray(a) || Array.isArray(b)) return arrayArith(op, a, b);
    const x = num(a, 'left operand');
    const y = num(b, 'right operand');
    switch (op) {
      case '+':
        return finite(x + y, 'sum');
      case '-':
        return finite(x - y, 'difference');
      case '*':
        return finite(x * y, 'product');
      case '/':
        if (y === 0) throw domain('division-by-zero', 'division by zero');
        return finite(x / y, 'quotient');
      case '^': {
        if (x < 0 && !Number.isInteger(y)) throw domain('pow-domain', `${x}^${y} is not real`);
        if (x === 0 && y < 0) throw domain('division-by-zero', `0^${y} is undefined`);
        return finite(x ** y, 'power');
      }
      case 'mod':
        if (y === 0) throw domain('division-by-zero', 'mod by zero');
        return x - y * Math.floor(x / y);
    }
  }
}

function arrayArith(op: BinOp, a: RtValue, b: RtValue): number[] {
  if (Array.isArray(a) && Array.isArray(b)) {
    if (op !== '+' && op !== '-') throw domain('array-op', `arrays cannot be combined with "${op}"; use dot/cross`);
    if (a.length !== b.length) throw domain('dimension-mismatch', 'arrays differ in length');
    return a.map((x, i) => finite(op === '+' ? x + b[i]! : x - b[i]!, 'array element'));
  }
  if (Array.isArray(a)) {
    const y = num(b, 'scalar');
    if (op === '*') return a.map((x) => finite(x * y, 'array element'));
    if (op === '/') {
      if (y === 0) throw domain('division-by-zero', 'division by zero');
      return a.map((x) => finite(x / y, 'array element'));
    }
  } else if (Array.isArray(b) && op === '*') {
    const x = num(a, 'scalar');
    return b.map((y) => finite(x * y, 'array element'));
  }
  throw domain('array-op', `unsupported array operation "${op}"`);
}

function compare(op: CmpOp, a: RtValue, b: RtValue): boolean {
  if (typeof a === 'string' || typeof b === 'string') {
    if (op === '==') return a === b;
    if (op === '!=') return a !== b;
    throw domain('type', 'strings can only be compared with == and !=');
  }
  const x = num(a, 'comparison operand');
  const y = num(b, 'comparison operand');
  switch (op) {
    case '<':
      return x < y;
    case '>':
      return x > y;
    case '<=':
      return x <= y;
    case '>=':
      return x >= y;
    case '==':
      return x === y;
    case '!=':
      return x !== y;
  }
}
