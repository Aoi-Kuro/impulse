/**
 * impulse copy: upstream defines these with zod schemas (schema/scenario.ts).
 * This copy only needs the types, for the type-only imports of the files kept.
 */
export type AnswerType = 'number' | 'numeric' | 'numericalFormula';

export interface Tolerance {
  /** Relative tolerance. Default 0.01. */
  rel?: number;
  /** Absolute tolerance, used only when |model| is below `absBelow`. */
  abs?: number;
  /** Default 1e-12. */
  absBelow?: number;
}

export interface Part {
  id: string;
  prompt: string;
  answerType: AnswerType;
  answer: string;
  unit?: string;
  unitPenalty?: number;
  tolerance: Tolerance;
  integer?: boolean;
  exactUnit?: boolean;
  mark?: number;
}

export type RandomVar =
  | { kind: 'range'; min: number; max: number; step?: number; decimals?: number; sigfigs?: number }
  | { kind: 'choice'; values: unknown[] };

export interface Scenario {
  id: string;
  parts: Part[];
  maxSampleAttempts?: number;
}
