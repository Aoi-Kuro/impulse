/**
 * Decimal-aware helpers. Rounding goes through the shortest round-trip decimal
 * string (`toExponential()`), so 1.005 rounds to 1.01 and
 * 0.25 + 7 × 0.01 = 0.32000000000000006 becomes 0.32: the value a human reads.
 */

/** x × 10^n computed on the decimal representation (no binary drift). */
export function shiftDecimal(x: number, n: number): number {
  if (x === 0 || !Number.isFinite(x)) return x;
  const [mantissa, exp] = x.toExponential().split('e') as [string, string];
  return Number(`${mantissa}e${Number(exp) + n}`);
}

/** Decimal exponent of |x| as written in scientific notation (0 for x = 0). */
export function decimalExponent(x: number): number {
  if (x === 0 || !Number.isFinite(x)) return 0;
  return Number(x.toExponential().split('e')[1]);
}

/** Round half away from zero to `decimals` places (negative = tens, hundreds...). */
export function roundHalfAway(x: number, decimals = 0): number {
  if (!Number.isFinite(x) || x === 0) return x;
  const r = shiftDecimal(Math.round(shiftDecimal(Math.abs(x), decimals)), -decimals);
  return x < 0 ? -r : r;
}

export function roundToSigfigs(x: number, sigfigs: number): number {
  if (!Number.isFinite(x) || x === 0) return x;
  return roundHalfAway(x, sigfigs - 1 - decimalExponent(x));
}

/** Number of digits after the decimal point in the shortest representation. */
export function decimalPlaces(x: number): number {
  if (!Number.isFinite(x) || Number.isInteger(x)) return 0;
  const [mantissa, exp] = x.toExponential().split('e') as [string, string];
  const frac = mantissa.split('.')[1]?.length ?? 0;
  return Math.max(0, frac - Number(exp));
}

/** Remove binary floating-point noise: 0.1 + 0.2 → 0.3. */
export function cleanFloat(x: number): number {
  if (!Number.isFinite(x) || x === 0) return x;
  return Number(x.toPrecision(15));
}

/** Significant digits in the shortest representation of x (printed precision). */
export function significantDigits(x: number): number {
  if (x === 0 || !Number.isFinite(x)) return 1;
  const mantissa = Math.abs(x).toExponential().split('e')[0]!;
  return mantissa.replace('.', '').replace(/^0+/, '').length;
}
