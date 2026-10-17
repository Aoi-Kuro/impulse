/**
 * Dimension classes. Units of one class convert by factor; the factor is
 * relative to the SI coherent unit the class's `dims` describe (kg, not g).
 * Across classes, units match when their SI dimensions agree (`J` ≡ `N m` ≡
 * `kg m^2 s^-2`), as in Moodle. A class without `dims` only matches itself.
 *
 * impulse copy — the classes below are ours, for the course's rules:
 *   - SI units take every SI prefix and convert through their SI dimensions:
 *     km ≡ 1000 m, mA, kV, µF, nC, MΩ, mT …; J ≡ N m ≡ kg m^2 s^-2,
 *     V/m ≡ N/C, Wb ≡ V s ≡ T m^2, Hz ≡ s^-1. The electrical units (A, C,
 *     V, Ω/Ohm, F, T, Wb, H) are here for PHYS 162.
 *   - micro is µ, μ, u, mc or mk (the last two: "мк" typed in Latin).
 *   - everything else (min, h, day, eV, L, atm, bar, cal, rpm, °, rad …)
 *     converts only within itself, by its prefixes (keV ≡ 1000 eV,
 *     mL ≡ 0.001 L), never to SI: km/h is not m/s, L is not dm^3.
 */
export interface UnitClass {
  /** Class id; conventionally its base unit name. */
  id: string;
  /** Unit name → factor relative to the class's SI coherent unit. */
  units: Readonly<Record<string, number>>;
  /** SI base dimensions of that unit: `{ kg: 1, m: 1, s: -2 }` for N. Angles count as their own dimension. */
  dims?: Readonly<Record<string, number>>;
}

const PREFIX: Record<string, number> = {
  Y: 1e24,
  Z: 1e21,
  E: 1e18,
  P: 1e15,
  T: 1e12,
  G: 1e9,
  M: 1e6,
  k: 1e3,
  h: 1e2,
  da: 1e1,
  d: 1e-1,
  c: 1e-2,
  m: 1e-3,
  µ: 1e-6,
  n: 1e-9,
  p: 1e-12,
  f: 1e-15,
  a: 1e-18,
  z: 1e-21,
  y: 1e-24,
};
const ALL = Object.keys(PREFIX).join(' ');
const MICRO_ALIASES = ['u', 'mc', 'mk'];

/** `base` plus each prefixed variant; `µ` also accepts the spellings u, mc and mk. */
function prefixed(base: string, baseFactor: number, prefixes: string): Record<string, number> {
  const out: Record<string, number> = { [base]: baseFactor };
  for (const p of prefixes.split(' ').filter(Boolean)) {
    const f = PREFIX[p];
    if (f === undefined) throw new Error(`unknown SI prefix ${p}`);
    out[p + base] = f * baseFactor;
    if (p === 'µ') for (const alias of MICRO_ALIASES) out[alias + base] = f * baseFactor;
  }
  return out;
}

/** An SI unit with every prefix. */
const si = (id: string, dims: Record<string, number>, baseFactor = 1, base = id): UnitClass => ({
  id,
  units: prefixed(base, baseFactor, ALL),
  dims,
});

export const SI_CLASSES: readonly UnitClass[] = Object.freeze<UnitClass[]>([
  // base units (the gram's class is scaled to the kilogram)
  si('m', { m: 1 }),
  si('s', { s: 1 }),
  si('g', { kg: 1 }, 1e-3),
  si('A', { A: 1 }),
  si('K', { K: 1 }),
  si('mol', { mol: 1 }),
  // derived units
  si('N', { kg: 1, m: 1, s: -2 }),
  si('J', { kg: 1, m: 2, s: -2 }),
  si('W', { kg: 1, m: 2, s: -3 }),
  si('Pa', { kg: 1, m: -1, s: -2 }),
  si('Hz', { s: -1 }),
  si('C', { A: 1, s: 1 }),
  si('V', { kg: 1, m: 2, s: -3, A: -1 }),
  { id: 'Ω', units: { ...prefixed('Ω', 1, ALL), ...prefixed('Ohm', 1, ALL) }, dims: { kg: 1, m: 2, s: -3, A: -2 } },
  si('F', { kg: -1, m: -2, s: 4, A: 2 }),
  si('T', { kg: 1, s: -2, A: -1 }),
  si('Wb', { kg: 1, m: 2, s: -2, A: -1 }),
  si('H', { kg: 1, m: 2, s: -2, A: -2 }),
  // not SI: each converts only within itself
  { id: 'min', units: { min: 1 } },
  { id: 'h', units: { h: 1 } },
  { id: 'day', units: { day: 1, days: 1 } },
  { id: 'eV', units: prefixed('eV', 1, 'k M G T m µ') },
  { id: 'L', units: prefixed('L', 1, 'm µ d c') },
  { id: 'atm', units: { atm: 1 } },
  { id: 'bar', units: prefixed('bar', 1, 'm k') },
  { id: 'cal', units: prefixed('cal', 1, 'k') },
  { id: 'rpm', units: { rpm: 1 } },
  { id: 'rad', units: prefixed('rad', 1, 'm µ') },
  { id: '°', units: { '°': 1, deg: 1 } },
  { id: 'rev', units: { rev: 1 } },
  { id: 'turns', units: { turns: 1 } },
  { id: '°C', units: { '°C': 1 } },
  { id: 'dB', units: { dB: 1 } },
  { id: '%', units: { '%': 1 } },
]);

export interface UnitTable {
  readonly classes: readonly UnitClass[];
  /** Class id, factor and SI dimensions for a unit name, or undefined when unknown. */
  lookup(name: string): UnitInfo | undefined;
}

export interface UnitInfo {
  classId: string;
  factor: number;
  dims?: Readonly<Record<string, number>>;
}

export function createUnitTable(classes: readonly UnitClass[]): UnitTable {
  const index = new Map<string, UnitInfo>();
  for (const c of classes) {
    for (const [name, factor] of Object.entries(c.units)) {
      if (index.has(name)) throw new Error(`unit "${name}" is in more than one class`);
      index.set(name, { classId: c.id, factor, ...(c.dims && { dims: c.dims }) });
    }
  }
  return { classes, lookup: (name) => index.get(name) };
}

export const DEFAULT_UNIT_TABLE: UnitTable = createUnitTable(SI_CLASSES);
