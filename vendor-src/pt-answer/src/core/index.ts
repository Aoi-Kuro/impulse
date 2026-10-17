// impulse copy: the parts of @pt/core the answer field and grading use.
export { type AnswerErrorCode, type AnswerValidation, validateAnswer } from './expr/acceptance.js';
export { splitCombinedAnswer, withinTolerance } from './grade/index.js';
export {
  areCompatible,
  createUnitTable,
  DEFAULT_UNIT_TABLE,
  formatUnit,
  SI_CLASSES,
  tryParseStudentUnit,
  tryParseUnit,
  type UnitMap,
  unitToTex,
} from './units/index.js';
export type { AnswerType } from './schema/scenario.js';
