# pt-answer

The answer engine behind the site's answer field: it reads a typed answer
(`9.81 m/s^2`) into a number and a unit, converts units, and makes the TeX
for the live preview. Built into `vendor/pt-answer/pt-answer.min.js`, which
defines the global `PTAnswer`. The course's own rules on top of it (accepted
units, `rad`, points, the preview box) are in `js/answer-check.js`.

This folder is not deployed (`minify.py` skips `vendor-src/`).

## Origin and license

Adapted from **pt-nu-phys161** by omga,
<https://github.com/omgaXD/pt-nu-phys161>, commit `6082c10` (2026-10-16),
MIT License (`LICENSE`, copied next to the built file). The files kept are
the answer path of its `packages/core` and `packages/ui/src/lib/answer`:

| Here | Upstream |
|---|---|
| `src/core/errors.ts`, `expr/acceptance.ts`, `expr/evaluate.ts`, `expr/latex.ts`, `expr/names.ts`, `units/index.ts`, `units/parse.ts`, `numbers/decimal.ts`, `schema/defaults.ts`, `grade/index.ts` | `packages/core/src/…`, unchanged |
| `src/ui/answer/messages.ts` | `packages/ui/src/lib/answer/messages.ts`, unchanged |
| `src/ui/answer/validate.ts` | same, one regex changed (below) |
| `src/core/expr/ast.ts` | same, parses with `parser.ts` instead of mathjs |
| `src/core/units/table.ts` | same, unit classes replaced (below) |
| `src/core/expr/parser.ts`, `src/core/index.ts`, `src/index.ts`, `src/core/schema/scenario.ts`, `src/core/instantiate/index.ts` | ours |

## What changed, and why

- **No mathjs.** Upstream used mathjs only to parse expressions (about 300 KB
  of the 350 KB bundle). `src/core/expr/parser.ts` builds the same
  mathjs-shaped node tree for the syntax an answer can hold, and `ast.ts`'s
  `convert` turns it into the AST exactly as before, so checks, evaluation
  and TeX are upstream code. Bundle: 40 KB (14 KB gzipped) instead of 347 KB
  (101 KB). Objects `{a: 1}`, ranges `1:3`, `to`/`in` unit conversion,
  bitwise operators, `??` and `?.` are left out: they are syntax errors here,
  where mathjs would build nodes that `ast.ts` refuses anyway.
- **Unit table** (`units/table.ts`, header comment): SI units take every SI
  prefix and convert through SI dimensions; the electrical units A, C, V,
  Ω/Ohm, F, T, Wb, H are added for PHYS 162; micro is also `u`, `mc`, `mk`;
  non-SI units (min, h, day, eV, L, atm, bar, cal, rpm, °, rad …) convert only
  within themselves, never to SI (upstream converts km/h to m/s, L to m³,
  eV to J).
- **Student exponents as Moodle reads them** (`units/parse.ts`,
  `tryParseStudentUnit`): after `^` only `2`, `-2` or `(-2)`, as in
  qtype_formulas' `parse_unit` (`answer_unit.php`); `s^(2)`, `s^(+2)`,
  `s^+2` and `m^1.5` are invalid. Units written in problems keep the looser
  grammar.
- **No lookbehind** in `validate.ts`'s e-notation regex: Safari before 16.4
  can't parse it, which would stop the whole file loading.
- `schema/scenario.ts` and `instantiate/index.ts` only declare the types the
  kept files import (upstream builds them from zod schemas).
- The bundle starts with an `Object.hasOwn` fallback for pre-2022 browsers.

## Build

```bash
python vendor-src/pt-answer/build.py
```

Writes `vendor/pt-answer/pt-answer.min.js` and `vendor/pt-answer/LICENSE`,
with the esbuild that `minify.py` downloads. Commit the built file.

## Testing

**Site tests** (Node 22+, no install): the built bundle with
`js/answer-check.js`, over grading rules, every problem of the course, and
optionally other course folders and the old two-field engine:

```bash
node --test vendor-src/pt-answer/test/site.test.mjs
COURSES="../examphys" OLD_ENGINE=old-quiz-engine.js node --test vendor-src/pt-answer/test/site.test.mjs
```

**Upstream suites and the parser-vs-mathjs test** run in a checkout of
pt-nu-phys161, with this folder's files copied over its own:

```bash
git clone https://github.com/omgaXD/pt-nu-phys161 && cd pt-nu-phys161
git checkout 6082c10
corepack pnpm@10.11.0 install --frozen-lockfile --ignore-scripts
git show HEAD:packages/core/src/expr/ast.ts > packages/core/src/expr/ast.orig.ts   # mathjs version, for the comparison
cp <impulse>/vendor-src/pt-answer/src/core/expr/{ast,parser}.ts packages/core/src/expr/
cp <impulse>/vendor-src/pt-answer/src/core/units/table.ts packages/core/src/units/
cp <impulse>/vendor-src/pt-answer/src/ui/answer/validate.ts packages/ui/src/lib/answer/
cp <impulse>/vendor-src/pt-answer/test/differential.test.ts packages/core/test/
(cd packages/core && CI=true npx vitest run)
(cd packages/ui && CI=true npx vitest run)
```

Results at the time of writing (2026-10-17):

- `test/differential.test.ts`: our parser and mathjs agree on 196
  hand-picked inputs and 600 000 random ones (same AST, node count and depth,
  or the same kind of refusal), with authoring and with student limits.
- Upstream core: 270 of 276 tests pass, plus the 3 differential tests. The 6
  that fail test the conversions our unit table leaves out on purpose
  (km/h ≡ m/s, L ≡ m³, eV ≡ J, min ≡ s, atm ≡ Pa, ° and rev ≡ rad,
  rpm ≡ Hz); with upstream's own `table.ts` all 279 pass.
- Upstream ui (answer field, preview): 42 of 42; quiz: 74 of 74.
- Type-check: `tsc -p vendor-src/pt-answer/tsconfig.json` passes, with
  upstream's strict settings.
