import { type AnswerErrorCode, validateAnswer } from '../expr/acceptance.js';
import type { InstancePart, ProblemInstance } from '../instantiate/index.js';
import { effectiveMark, effectiveTolerance, effectiveUnitPenalty } from '../schema/defaults.js';
import type { AnswerType, Part, Scenario } from '../schema/scenario.js';
import { areCompatible, DEFAULT_UNIT_TABLE, tryParseStudentUnit, tryParseUnit, type UnitMap } from '../units/index.js';

/** What a student submitted for one part: separate fields, or one combined field. */
export type PartResponse = { value: string; unit?: string } | { combined: string };

export type GradeErrorCode = AnswerErrorCode | 'no-response' | 'unit-syntax';

/** What the answer inputs of one part hold. */
export interface FieldContents {
  /** The value field, or the whole "number unit" text in combined mode. */
  value: string;
  /** The separate unit field (empty in combined mode). */
  unit: string;
}

/** Turn field contents into the response `gradePart` expects; blank fields are no response. */
export function responseFromFields(part: Pick<InstancePart, 'slots'>, fields: FieldContents | undefined): PartResponse | undefined {
  if (!fields || (fields.value.trim() === '' && fields.unit.trim() === '')) return undefined;
  if (part.slots.some((s) => s.kind === 'combined')) return { combined: fields.value };
  return { value: fields.value, unit: fields.unit };
}

export interface PartResult {
  partId: string;
  fraction: number;
  valueOk: boolean;
  unitOk: boolean;
  /** TeX of the parsed student expression, when it parsed. */
  parsedLatex: string | null;
  modelAnswer: number;
  studentValue: number | null;
  studentUnit: string | null;
  /** Factor applied to the student value (1 when units are absent or incompatible). */
  conversionFactor: number;
  error?: { code: GradeErrorCode; params?: Record<string, unknown> };
}

export interface ScenarioResult {
  scenarioId: string;
  /** Σ(mark·fraction) / Σ(mark), in [0, 1]. */
  fraction: number;
  earned: number;
  total: number;
  parts: PartResult[];
}

function unitIsKnown(unit: string): boolean {
  const u = tryParseUnit(unit);
  return u !== null && Object.keys(u).length > 0 && Object.keys(u).every((n) => DEFAULT_UNIT_TABLE.lookup(n));
}

/**
 * Split a combined "number + unit" field (`191.88 J`, `3.2 m/s^2`, `2 pi rad`)
 * into value and unit. Prefers the leftmost split whose suffix is a known unit
 * and whose prefix is an acceptable answer; then any syntactically valid unit.
 */
export function splitCombinedAnswer(input: string, answerType: AnswerType = 'numeric'): { value: string; unit: string } {
  const s = input.trim();
  const candidates: number[] = [];
  for (let i = 1; i < s.length; i++) {
    const c = s[i]!;
    const prev = s[i - 1]!;
    if (/[\p{L}µ°Ω%]/u.test(c) && !/[\p{L}_]/u.test(prev)) candidates.push(i);
  }
  for (const known of [true, false]) {
    for (const i of candidates) {
      const value = s.slice(0, i).trim();
      const unit = s.slice(i).trim();
      if (!value) continue;
      if (known ? !unitIsKnown(unit) : tryParseUnit(unit) === null) continue;
      if (validateAnswer(value, answerType).ok) return { value, unit };
    }
  }
  return { value: s, unit: '' };
}

function normalizeResponse(response: PartResponse, answerType: AnswerType): { value: string; unit: string } {
  if ('combined' in response) return splitCombinedAnswer(response.combined, answerType);
  return { value: response.value, unit: response.unit ?? '' };
}

/** The part fields grading reads (a stored snapshot needs only these plus the model answer). */
export type GradablePart = Pick<Part, 'id' | 'answerType' | 'unit' | 'integer' | 'tolerance' | 'unitPenalty' | 'exactUnit'>;

/** Same components with the same exponents, in any order: `m s^-1` ≡ `m/s`, but `km/h` ≠ `m/s`. */
function sameUnit(a: UnitMap, b: UnitMap): boolean {
  const ea = Object.entries(a);
  return ea.length === Object.keys(b).length && ea.every(([n, e]) => b[n] === e);
}

/** Conversion factor from the student's unit to the expected one, or false. */
function unitFactor(student: string, part: GradablePart & { unit: string }): number | false {
  if (!part.exactUnit) return areCompatible(student, part.unit);
  const a = tryParseUnit(student);
  const b = tryParseUnit(part.unit);
  return a !== null && b !== null && sameUnit(a, b) ? 1 : false;
}

/** |value − model| within tolerance; exact integer match for `integer` parts. */
export function withinTolerance(value: number, model: number, part: Pick<Part, 'integer' | 'tolerance'>): boolean {
  if (part.integer) {
    const target = Math.round(model);
    return Math.abs(value - target) <= 1e-9 * Math.max(1, Math.abs(target));
  }
  const tol = effectiveTolerance(part);
  const mag = Math.abs(model);
  let allowed = tol.rel * mag;
  if (mag < tol.absBelow && tol.abs !== undefined) allowed = Math.max(allowed, tol.abs);
  // A few ULPs of slack so that exact-boundary answers are not lost to rounding.
  return Math.abs(value - model) <= allowed + 4 * Number.EPSILON * Math.max(mag, Math.abs(value));
}

/**
 * Grade one part against a whole instance or just its instance part.
 * Parse/acceptance/evaluation failures give a zero fraction; unit
 * compatibility is still evaluated independently.
 */
export function gradePart(
  part: GradablePart,
  instance: Pick<ProblemInstance, 'parts'> | Pick<InstancePart, 'modelAnswer'>,
  response: PartResponse | undefined,
): PartResult {
  let model: number;
  if ('parts' in instance) {
    const ip = instance.parts.find((p) => p.partId === part.id);
    if (!ip) throw new Error(`instance has no part "${part.id}"`);
    model = ip.modelAnswer;
  } else {
    model = instance.modelAnswer;
  }
  const base: PartResult = {
    partId: part.id,
    fraction: 0,
    valueOk: false,
    unitOk: part.unit === undefined,
    parsedLatex: null,
    modelAnswer: model,
    studentValue: null,
    studentUnit: null,
    conversionFactor: 1,
  };
  if (!response) return { ...base, error: { code: 'no-response' } };

  const { value, unit } = normalizeResponse(response, part.answerType);
  base.studentUnit = unit;

  // An invalid unit makes the whole answer invalid, as in Moodle: no credit at all.
  const unitInvalid = unit !== '' && tryParseStudentUnit(unit) === null;
  if (unitInvalid) {
    base.unitOk = false;
    base.error = { code: 'unit-syntax' };
  } else if (part.unit !== undefined) {
    const factor = unitFactor(unit, { ...part, unit: part.unit });
    if (factor !== false) {
      base.unitOk = true;
      base.conversionFactor = factor;
    }
  }

  const v = validateAnswer(value, part.answerType);
  if (!v.ok) {
    return { ...base, error: { code: v.error, ...(v.params && { params: v.params }) } };
  }
  base.parsedLatex = v.latex;
  base.studentValue = v.value;
  base.valueOk = withinTolerance(v.value * base.conversionFactor, model, part);
  const penalty = part.unit === undefined ? 0 : effectiveUnitPenalty(part);
  base.fraction = unitInvalid ? 0 : (base.valueOk ? 1 : 0) * (base.unitOk ? 1 : 1 - penalty);
  return base;
}

export function gradeScenario(
  scenario: Pick<Scenario, 'id' | 'parts'>,
  instance: Pick<ProblemInstance, 'parts'>,
  responses: Readonly<Record<string, PartResponse | undefined>>,
): ScenarioResult {
  let earned = 0;
  let total = 0;
  const parts = scenario.parts.map((p) => {
    const ip = instance.parts.find((x) => x.partId === p.id);
    if (!ip) throw new Error(`instance has no part "${p.id}"`);
    const r = gradePart(p, ip, responses[p.id]);
    const mark = effectiveMark(p);
    earned += mark * r.fraction;
    total += mark;
    return r;
  });
  return { scenarioId: scenario.id, fraction: total > 0 ? earned / total : 0, earned, total, parts };
}
