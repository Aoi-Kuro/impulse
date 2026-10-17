import type { AnswerErrorCode } from '@pt/core';

/**
 * English text for the error codes @pt/core returns. Core returns codes, not
 * messages; pass `messages` to any answer component to translate.
 */
export type AnswerMessages = Record<AnswerErrorCode | 'unit-syntax' | 'unit-unknown' | 'unit-missing', string>;

export const DEFAULT_MESSAGES: AnswerMessages = {
  empty: 'Enter an answer.',
  'too-long': 'That answer is too long.',
  syntax: 'This is not a valid number or expression.',
  'number-expected': 'Enter a single number.',
  'operator-not-allowed': 'Enter a single number, without operators.',
  'function-not-allowed': 'Functions are not allowed here.',
  'identifier-not-allowed': 'Letters are not allowed here (put units in the unit field).',
  'syntax-not-allowed': 'That kind of expression is not allowed here.',
  'not-a-number': 'This does not evaluate to a number.',
  domain: 'This expression cannot be evaluated (e.g. division by zero).',
  budget: 'That expression is too complex.',
  'unit-syntax': 'This is not a valid unit.',
  'unit-unknown': 'Unknown unit.',
  'unit-missing': 'Add a unit.',
};

export function message(code: string, overrides?: Partial<AnswerMessages>): string {
  return (overrides as Record<string, string> | undefined)?.[code] ?? (DEFAULT_MESSAGES as Record<string, string>)[code] ?? code;
}
