import type { Part, RandomVar, Scenario } from './scenario.js';

/** Effective values for optional numeric fields (kept out of stored files). */
export const DEFAULTS = Object.freeze({
  rel: 0.01,
  absBelow: 1e-12,
  unitPenalty: 0.1,
  mark: 1,
  maxSampleAttempts: 200,
});

export interface EffectiveTolerance {
  rel: number;
  abs: number | undefined;
  absBelow: number;
}

export function effectiveTolerance(part: Pick<Part, 'tolerance'>): EffectiveTolerance {
  return {
    rel: part.tolerance.rel ?? DEFAULTS.rel,
    abs: part.tolerance.abs,
    absBelow: part.tolerance.absBelow ?? DEFAULTS.absBelow,
  };
}

export function effectiveUnitPenalty(part: Pick<Part, 'unitPenalty'>): number {
  return part.unitPenalty ?? DEFAULTS.unitPenalty;
}

export function effectiveMark(part: Pick<Part, 'mark'>): number {
  return part.mark ?? DEFAULTS.mark;
}

export function effectiveMaxSampleAttempts(s: Pick<Scenario, 'maxSampleAttempts'>): number {
  return s.maxSampleAttempts ?? DEFAULTS.maxSampleAttempts;
}

/** Grid step for a range variable: explicit, else 10^-decimals, else 1. */
export function effectiveStep(v: Extract<RandomVar, { kind: 'range' }>): number {
  if (v.step !== undefined) return v.step;
  if (v.decimals !== undefined) return Number(`1e-${v.decimals}`);
  return 1;
}
