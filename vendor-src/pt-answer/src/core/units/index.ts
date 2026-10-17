import { parseUnit, type UnitMap } from './parse.js';
import { DEFAULT_UNIT_TABLE, type UnitTable } from './table.js';

export { normalizeUnitString, parseUnit, tryParseStudentUnit, tryParseUnit, type UnitMap, UnitParseError } from './parse.js';
export { createUnitTable, DEFAULT_UNIT_TABLE, SI_CLASSES, type UnitClass, type UnitTable } from './table.js';

/**
 * If a value expressed in `from` can be read as a value in `to`, return the
 * factor to multiply it by; otherwise `false`.
 *
 * Two units match when their components pair up class-by-class with equal
 * exponents, or else when all their components are known and their SI
 * dimensions agree: `J` ≡ `N m` ≡ `kg m^2 s^-2`, `mL` ≡ `cm^3`. Unknown names
 * only match themselves. The empty unit only matches the empty unit.
 */
export function areCompatible(
  from: string | UnitMap,
  to: string | UnitMap,
  table: UnitTable = DEFAULT_UNIT_TABLE,
): number | false {
  let a: UnitMap;
  let b: UnitMap;
  try {
    a = typeof from === 'string' ? parseUnit(from) : from;
    b = typeof to === 'string' ? parseUnit(to) : to;
  } catch {
    return false;
  }
  return byClass(a, b, table) || bySiDimensions(a, b, table);
}

/** SI dimensions and factor to the SI coherent unit, or null if a component is unknown or dimensionless-by-class. */
function toSi(u: UnitMap, table: UnitTable): { dims: Map<string, number>; factor: number } | null {
  const dims = new Map<string, number>();
  let factor = 1;
  for (const [name, exp] of Object.entries(u)) {
    const hit = table.lookup(name);
    if (!hit?.dims) return null;
    factor *= hit.factor ** exp;
    for (const [d, e] of Object.entries(hit.dims)) dims.set(d, (dims.get(d) ?? 0) + e * exp);
  }
  return { dims, factor };
}

function bySiDimensions(a: UnitMap, b: UnitMap, table: UnitTable): number | false {
  if (Object.keys(a).length === 0 || Object.keys(b).length === 0) return false;
  const sa = toSi(a, table);
  const sb = toSi(b, table);
  if (!sa || !sb) return false;
  const keys = new Set([...sa.dims.keys(), ...sb.dims.keys()]);
  for (const k of keys) if (Math.abs((sa.dims.get(k) ?? 0) - (sb.dims.get(k) ?? 0)) > 1e-9) return false;
  return sa.factor / sb.factor;
}

function byClass(a: UnitMap, b: UnitMap, table: UnitTable): number | false {
  const aEntries = Object.entries(a);
  const bEntries = Object.entries(b);
  if (aEntries.length !== bEntries.length) return false;

  const group = (entries: [string, number][]): Map<string, { exp: number; factor: number }[]> => {
    const m = new Map<string, { exp: number; factor: number }[]>();
    for (const [name, exp] of entries) {
      const hit = table.lookup(name);
      const key = hit ? `class:${hit.classId}` : `name:${name}`;
      const list = m.get(key) ?? [];
      list.push({ exp, factor: hit ? hit.factor : 1 });
      m.set(key, list);
    }
    return m;
  };
  const ga = group(aEntries);
  const gb = group(bEntries);
  if (ga.size !== gb.size) return false;

  let factor = 1;
  for (const [key, listA] of ga) {
    const listB = gb.get(key);
    if (!listB || listB.length !== listA.length) return false;
    const ea = listA.map((x) => x.exp).sort((x, y) => x - y);
    const eb = listB.map((x) => x.exp).sort((x, y) => x - y);
    if (ea.some((e, i) => e !== eb[i])) return false;
    for (const x of listA) factor *= x.factor ** x.exp;
    for (const x of listB) factor /= x.factor ** x.exp;
  }
  return factor;
}

function formatComponent(name: string, exp: number): string {
  return exp === 1 ? name : `${name}^${exp < 0 ? `(${exp})` : exp}`;
}

/** Canonical text form: `kg m/s^2`, `J/(kg K)`, `1/s`, `` for dimensionless. */
export function formatUnit(u: UnitMap): string {
  const entries = Object.entries(u);
  const num = entries.filter(([, e]) => e > 0).map(([n, e]) => formatComponent(n, e));
  const den = entries.filter(([, e]) => e < 0).map(([n, e]) => formatComponent(n, -e));
  if (den.length === 0) return num.join(' ');
  const top = num.length ? num.join(' ') : '1';
  return `${top}/${den.length > 1 ? `(${den.join(' ')})` : den[0]}`;
}

function texName(name: string): string {
  if (name === '°') return '^{\\circ}';
  return `\\text{${name}}`;
}

function texComponent(name: string, exp: number): string {
  return exp === 1 ? texName(name) : `${texName(name)}^{${exp}}`;
}

export interface UnitTexOptions {
  /** `\dfrac{\text{kg} \cdot \text{m}}{\text{s}^{2}}`, as in qtype_formulas' answer preview. */
  fraction?: boolean;
}

/** TeX for a unit: `\text{m}/\text{s}^{2}`. Falls back to `\text{…}` if unparseable. */
export function unitToTex(unit: string | UnitMap, opts: UnitTexOptions = {}): string {
  let u: UnitMap;
  try {
    u = typeof unit === 'string' ? parseUnit(unit) : unit;
  } catch {
    return `\\text{${String(unit).replace(/[\\{}$&#%_^~]/g, '')}}`;
  }
  const entries = Object.entries(u);
  const num = entries.filter(([, e]) => e > 0).map(([n, e]) => texComponent(n, e));
  const den = entries.filter(([, e]) => e < 0).map(([n, e]) => texComponent(n, -e));
  const sep = opts.fraction ? ' \\cdot ' : '\\,';
  const top = num.join(sep);
  if (den.length === 0) return top;
  const bottom = den.join(sep);
  if (opts.fraction) return `\\dfrac{${top || '1'}}{${bottom}}`;
  return `${top || '1'}/${den.length > 1 ? `\\left(${bottom}\\right)` : bottom}`;
}

/** True when the unit is the bare degree sign, written without a space: `29°`. */
export function isDegreeUnit(unit: string | undefined): boolean {
  return unit?.trim() === '°' || unit?.trim() === '˚';
}
