/**
 * Every error raised by @pt/core carries a stable machine-readable `code`
 * plus structured `params`. The English `message` is a developer fallback;
 * user-facing text is the caller's job (no i18n in core, no hard-coded UI copy).
 */
export class CoreError extends Error {
  readonly code: string;
  readonly params: Readonly<Record<string, unknown>>;

  constructor(code: string, message: string, params: Record<string, unknown> = {}) {
    super(message);
    this.name = new.target.name;
    this.code = code;
    this.params = params;
  }

  toJSON(): { name: string; code: string; message: string; params: Record<string, unknown> } {
    return { name: this.name, code: this.code, message: this.message, params: { ...this.params } };
  }
}

// ---- Expression errors -----------------------------------------------------

/** Base class for everything the expression layer throws. */
export class ExprError extends CoreError {}

/** Source could not be parsed, or uses syntax that is not permitted. */
export class ParseError extends ExprError {}

/** A symbol or function name is not defined in scope / the function table. */
export class UnknownIdentifierError extends ExprError {
  get identifiers(): readonly string[] {
    return (this.params.identifiers as string[] | undefined) ?? [];
  }
}

/** Node-count, depth, step or wall-clock budget exceeded. */
export class BudgetExceededError extends ExprError {}

/** Mathematically invalid operation: sqrt(-1), log(0), 1/0, NaN, wrong types... */
export class DomainError extends ExprError {}

// ---- Instantiation ---------------------------------------------------------

export class ConstraintUnsatisfiableError extends CoreError {}

/** A template references something that does not exist or cannot be formatted. */
export class TemplateError extends CoreError {}

/** A scenario could not be instantiated (bad answer formula, invalid seed...). */
export class InstantiationError extends CoreError {}

// ---- Repository ------------------------------------------------------------

export class NotFoundError extends CoreError {}
export class ValidationError extends CoreError {}
export class ConflictError extends CoreError {}
