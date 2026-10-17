/** Named constants available in every expression. */
export const CONSTANTS: Readonly<Record<string, number>> = Object.freeze({
  pi: Math.PI,
  e: Math.E,
});

/** Functions a student may use in a `numericalFormula` answer. */
export const STUDENT_FUNCTIONS = [
  'sqrt',
  'abs',
  'exp',
  'log',
  'log10',
  'ln',
  'sin',
  'cos',
  'tan',
  'asin',
  'acos',
  'atan',
  'atan2',
  'sinh',
  'cosh',
  'tanh',
  'min',
  'max',
  'round',
  'floor',
  'ceil',
  'sign',
  'hypot',
  'sum',
  'factorial',
  'deg',
  'rad',
] as const;

/**
 * Authoring-only helpers. `solve` and `iterate` take an inline lambda
 * (`solve(f(r) = r^2 - 2, 0, 2)`), which is never allowed in student input.
 */
export const AUTHOR_FUNCTIONS = ['norm', 'dot', 'cross', 'clamp', 'solve', 'iterate'] as const;

export const FUNCTION_NAMES: readonly string[] = [...STUDENT_FUNCTIONS, ...AUTHOR_FUNCTIONS];

/** Words the parser treats as operators/literals; never valid variable names. */
export const KEYWORDS = ['and', 'or', 'not', 'xor', 'mod', 'to', 'in', 'true', 'false', 'null', 'end'] as const;

const RESERVED = new Set<string>([...Object.keys(CONSTANTS), ...FUNCTION_NAMES, ...KEYWORDS]);

/** Identifier syntax for variables: letter first, then letters/digits/underscore. */
export const IDENTIFIER_RE = /^[A-Za-z][A-Za-z0-9_]*$/;

export function isReservedName(name: string): boolean {
  return RESERVED.has(name);
}
