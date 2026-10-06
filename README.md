# Impulse & Flux — Physics Practice Quiz Platform

This repository is the **framework** for a physics practice-quiz site. One
course's content (currently PHYS 161; previously PHYS 162) lives inside it in a
form that is designed to be swapped out wholesale, so the same codebase can be
redeployed for a different course as a separate site with its own database.
The procedure is described in [Deploying a new course](#deploying-a-new-course).

> Live site: https://phys161.netlify.app
>
> Live site: https://phys162.netlify.app
>
> Source: https://github.com/Aoi-Kuro/impulse

---

## Table of contents

- [How it is built](#how-it-is-built)
- [Project structure](#project-structure)
- [The multi-course architecture](#the-multi-course-architecture)
  - [`course/` — swapped wholesale](#course--swapped-wholesale)
  - [`js/course-config.js` — the live switch](#jscourse-configjs--the-live-switch)
  - [Per-course changelog filtering](#per-course-changelog-filtering)
  - [What stays framework (shared)](#what-stays-framework-shared)
- [Problem banks](#problem-banks)
  - [Problem object format](#problem-object-format)
  - [The quiz registry](#the-quiz-registry)
  - [Problem ids, numbers and retiring problems](#problem-ids-numbers-and-retiring-problems)
  - [Adding a quiz](#adding-a-quiz)
- [Answer checking](#answer-checking)
- [Front-end subsystems](#front-end-subsystems)
  - [Page load order](#page-load-order)
  - [Quiz engine](#quiz-engine)
  - [Stats](#stats)
  - [Cross-device sync](#cross-device-sync)
  - [Forum](#forum)
  - [Push notifications](#push-notifications)
  - [Worked solutions (site side)](#worked-solutions-site-side)
  - [Settings](#settings)
  - [Offline support](#offline-support)
  - [Theming](#theming)
  - [Math rendering and the render cache](#math-rendering-and-the-render-cache)
  - [Top bar](#top-bar)
  - [Banners and the update checker](#banners-and-the-update-checker)
  - [Smaller modules](#smaller-modules)
- [Solutions editor (`/editor`)](#solutions-editor-editor)
  - [Access](#access)
  - [Layout](#layout)
  - [Figures (TikZ)](#figures-tikz)
  - [Figures (SVG)](#figures-svg)
  - [Solution text](#solution-text)
  - [Saving, publishing and conflicts](#saving-publishing-and-conflicts)
  - [Drafts and local history](#drafts-and-local-history)
  - [Other editor tools](#other-editor-tools)
  - [Managing editor keys](#managing-editor-keys)
- [Database (Supabase)](#database-supabase)
- [Edge functions](#edge-functions)
- [Device ownership (`device_secret`) and tokens](#device-ownership-device_secret-and-tokens)
- [Gemini integration](#gemini-integration)
- [Client-side storage reference](#client-side-storage-reference)
- [Running locally](#running-locally)
- [Building for deployment (`minify.py`)](#building-for-deployment-minifypy)
- [Deploying a new course](#deploying-a-new-course)
- [Manual-swap items](#manual-swap-items)
- [Versioning](#versioning)

---

## How it is built

- **No framework, no build step for development.** Plain HTML/CSS/JS is loaded
  as a stack of `<script>` tags in `index.html`, in a deliberate dependency
  order (documented in comments inside `index.html` itself). Files share
  globals; inline `onclick="…"` handlers call top-level functions by name.
- **Supabase** backs the forum, stats sync, Solve-All sync, push
  notifications and worked solutions: Postgres + Row Level Security + Realtime
  + Edge Functions (Deno/TypeScript). The browser talks to it directly with a
  public, RLS-restricted *publishable* key; every write goes through an Edge
  Function.
- **Netlify** serves the static files. A minified upload zip is produced by
  `minify.py` (see [Building for deployment](#building-for-deployment-minifypy)).
- **MathJax 3** (STIX Two font, vendored in `vendor/mathjax/`) renders LaTeX,
  with a persistent IndexedDB render cache for Solve-All mode.
- **TikZJax** (vendored in `vendor/tikzjax/`, ~9.5 MB) compiles TikZ figures
  to SVG — but only inside the solutions editor. The practice site only
  displays the stored SVGs.
- **DOMPurify** (vendored) sanitizes every solution-figure SVG before it is
  inlined into a page.
- **A service worker** (`sw.js`) provides an offline fallback page, the
  24-hour full offline mode, and Web Push display.
- Vendored export libraries (**jsPDF**, **svg2pdf**, **jspdf-autotable**,
  **SheetJS**, embedded IBM Plex fonts) are lazy-loaded only when stats are
  exported.

There is no `package.json` and no `npm install`. The only development
requirement is a static file server (see [Running locally](#running-locally)).

---

## Project structure

```
impulse/
├── index.html              Main app shell: landing screen, quiz/Solve-All UI,
│                            Stats/Forum/Manual/Settings/Solution screens,
│                            every modal, and the full <script> load order
│                            (its comments are the first thing to read)
├── offline.html             Fallback page shown by sw.js when a navigation
│                            fails with no connection (standalone page)
├── sw.js                    Service worker: offline fallback, 24h full
│                            offline mode, update-cache purge, Web Push
├── version.json             { "version": "X.Y.Z" } — polled by the update
│                            checkers of the site and of the editor
├── minify.py                Builds the minified Netlify upload zip
│
├── course/                  ★ Everything specific to the deployed course
│   ├── quizzes/
│   │   ├── quiz1.js .. quiz4.js   Problem banks: Quiz_N_Problems and
│   │   │                          Quiz_N_Retired arrays
│   │   └── quizzes.js       QUIZZES registry + id/number helpers
│   ├── images/quiz_1..3/    Figure images referenced from problem text
│   ├── splashes.json        Main-menu splash text pool
│   ├── manual.json          User manual content (sections/subsections)
│   ├── offline-laws.json    "Law of the moment" pool for offline.html
│   ├── preview.png          Open Graph / Twitter card image
│   └── course.json          Historical reference only — not loaded by
│                            anything (see below)
│
├── js/                      ★ Framework code, identical across courses
│   ├── course-config.js     Loads first. Per-course keys/settings → globals
│   ├── banner-manager.js    One-at-a-time queue for the bottom banners
│   ├── theme-colors.js      Reads live CSS variables for JS-drawn UI
│   ├── themes.js            Theme presets, custom theme builder, day/night
│   ├── splash.js            Splash line on the landing screen
│   ├── easter.js            Pi Day / Pi Hour easter egg
│   ├── data/changelog.js    Changelog entries (platform history)
│   ├── data/tips.js         Rotating top-bar tip strings
│   ├── stats.js             Attempt log, chart, table, problems overview,
│   │                        attempt review, Forum & Site panel
│   ├── stats-export.js      Export to PDF / Excel / CSV / TXT
│   ├── attempts-sync.js     Attempt sync + shared "live dot" state machine
│   ├── solve-all-sync.js    Solve-All progress sync (union merge)
│   ├── math-cache.js        IndexedDB cache of typeset MathJax output
│   ├── math-render.js       renderMathIn(el) wrapper around MathJax
│   ├── figure.js            Solution-figure SVG normalize/sanitize/crop
│   │                        (shared with the editor)
│   ├── solution-render.js   Solution text → blocks + MathJax (shared with
│   │                        the editor)
│   ├── solutions.js         "See solution" buttons and the Solution screen
│   ├── editor-access.js     Hidden long-press entry to /editor on the logo
│   ├── quiz-engine.js       Quiz engine: Random N, cumulative, filters,
│   │                        Solve-All, mistakes retry, number/unit parsing,
│   │                        live timer, full-screen hint, update checker
│   ├── fig-attribution.js   Tap-to-toggle (i) attribution badges on figures
│   ├── top-bar-scroll.js    Top-bar backdrop state on scroll
│   ├── top-bar-tips.js      Rotating one-line tips in the top bar
│   ├── top-bar-quiz-status.js  Clock + battery in the top bar (full screen)
│   ├── solve-all-nav.js     Solve-All progress rail (wide screens)
│   ├── changelog.js         Changelog panel + "field lines" cursor effect
│   ├── manual.js            User manual screen (reads course/manual.json)
│   ├── settings.js          Settings schema, storage, panel, backup
│   ├── offline-mode.js      "Go offline" download + Cache & storage tools
│   ├── site-visits.js       Records one visit per page load
│   ├── forum.js             The class forum
│   └── push-notifications.js  Web Push subscribe/unsubscribe UI
│
├── editor/                  Solutions editor, served at /editor/
│   ├── index.html           Editor page (key gate + app)
│   ├── editor.js            Editor logic
│   ├── editor.css           Editor styles
│   ├── svg-figure.js        SVG-mode figures: layers, colours, build, panel edits
│   ├── store.js             Talks to the solutions-admin Edge Function
│   └── store-mock.js        Drop-in localStorage stand-in for store.js
│
├── css/
│   ├── style.css            Core UI, landing screen, theme presets
│   ├── stats.css            Stats screen (+ shared modal styles)
│   ├── forum.css            Forum screen, Getting Started FAQ
│   ├── manual.css           Manual screen
│   ├── settings.css         Settings screen + Display hide classes
│   ├── solve-all-nav.css    Solve-All progress rail
│   ├── figure.css           Solution figures (shared with the editor)
│   └── solutions.css        "See solution" button + Solution screen
│
├── images/                  Framework images (not course-specific)
│   ├── gemini-logo.svg      Gemini bot avatar in the forum
│   └── offline/{dark,light}.png  offline.html illustration
│
├── favicon/                 Favicon set + site.webmanifest ("Flux")
│
├── vendor/                  Vendored third-party code (no CDN needed)
│   ├── mathjax/             MathJax bundle + STIX Two woff fonts
│   ├── tikzjax/             TikZJax (TeX in WebAssembly), TeX fonts, .sty
│   ├── dompurify/           DOMPurify
│   ├── jspdf/               jsPDF, svg2pdf, jspdf-autotable
│   ├── sheetjs/             SheetJS (xlsx)
│   └── fonts/               IBM Plex embedded for PDF export
│
└── superbase/               [sic] Supabase backend for ONE project
    ├── migrations/          000–009, run in order on a fresh project
    ├── edge-functions/      Deno/TypeScript Edge Functions
    ├── database.sql         Old context-only schema dump (reference only)
    └── schema-phys162.png   Reference screenshot of the phys162 schema
```

---

## The multi-course architecture

The repository is deployed once per course, each time as a completely separate
Netlify site + Supabase project (and, eventually, a separate GitHub
repository). Releasing a different course consists of replacing the contents
of `course/`, filling in that course's entry in `js/course-config.js`, and
hand-editing a small, well-marked set of values that cannot be centralized. The
release step is manual and copy-based rather than templated at build time.

### `course/` — swapped wholesale

Everything in `course/` is real content that differs between courses: problem
banks, figure images, splash text, the manual, the offline-page law list and
the preview image. For a different course, the entire folder's contents are
replaced with that course's versions.

`course/course.json` is **historical only**. It used to be a copy-paste
reference for titles and meta text; nothing loads it today (it is only listed
in the offline-mode download manifest). The eyebrow labels and `document.title`
are driven by `js/course-config.js`; the static meta tags are covered under
[Manual-swap items](#manual-swap-items).

### `js/course-config.js` — the live switch

This is the only framework file that knows about multiple courses, and the only
place where per-course keys live:

```js
const COURSES = {
  phys162: {
    storagePrefix: 'phys162',
    supabase: { url: '...', publishableKey: '...' },
    pushVapidPublicKey: '...',
    quizSettings: { size: 6, cumulativePrevCount: 3 },
    pinnedMessageId: 336,
    changelogScope: 2,
    display: { courseCode: 'PHYS162', ogDescription: '...', twitterDescription: '...', siteUrl: '...' },
  },
  phys161: {
    storagePrefix: 'phys161',
    supabase: { url: '...', publishableKey: '...' },
    pushVapidPublicKey: '...',
    quizSettings: { size: 7, cumulativePrevCount: 3 },
    pinnedMessageId: 2,
    changelogScope: 1,
    display: { courseCode: 'PHYS161', ogDescription: '...', twitterDescription: '...', siteUrl: '...' },
  },
};
```

The active course is read from `document.head.dataset.course`, i.e. the
`<head data-course="phys161">` attribute at the top of `index.html`,
`offline.html` **and** `editor/index.html`. An unknown value logs an error and
falls back to `phys162`. The file exposes these globals, which every other file
reads instead of hardcoding values:

| Global | Used for |
|---|---|
| `ACTIVE_COURSE` | The resolved `data-course` key. |
| `STORAGE_PREFIX` | Every course-scoped localStorage key and BroadcastChannel name (see [Client-side storage reference](#client-side-storage-reference)). |
| `SUPABASE_URL` / `SUPABASE_PUBLISHABLE_KEY` | Every Supabase call: forum, sync, push, solutions, visits. A blank value logs a warning and those features quietly disable themselves. |
| `PUSH_VAPID_PUBLIC_KEY` | Web Push subscription. Each Supabase project has its own VAPID keypair. |
| `QUIZ_SIZE` | How many problems a "Random N" draw contains. Also drives the "🎯 Random N" landing label and stats empty-state text. |
| `QUIZ_CUMULATIVE_PREV_COUNT` | In cumulative mode, how many of the `QUIZ_SIZE` problems come from earlier quizzes; the rest come from the selected quiz. Must be `<= QUIZ_SIZE` (an error is logged otherwise). |
| `FORUM_PINNED_MESSAGE_ID` | The `forum_messages` row shown pinned at the top of the forum. No default exists; an error is logged when it is missing and the banner stays hidden. |
| `COURSE_CHANGELOG_SCOPE` | Filters changelog entries (see below). When missing, every entry is shown unfiltered and an error is logged. |
| `COURSE_CODE` / `COURSE_CODE_DISPLAY` / `COURSE_TITLE` | `"PHYS161"`, `"PHYS 161"`, `"PHYS 161 Practice Quiz"`. Set `document.title` (with a "You're offline — " prefix on `offline.html`), the four eyebrow labels, and the editor's title. They also update the OG/Twitter meta tags in-browser, which link-preview crawlers never see (see [Manual-swap items](#manual-swap-items)). |

A course without `quizSettings` falls back to phys162's values (6, 3). The file
must load before anything that reads `STORAGE_PREFIX`, so it is the first
external `<script>` in `index.html`.

### Per-course changelog filtering

Every entry in `js/data/changelog.js` has the shape
`{ version: "X.Y.Z", note: "...", scope: N }`, newest first. `scope: 0` is
shown for every course; any other value must equal a course's
`changelogScope` (currently `phys162: 2`, `phys161: 1`). `renderChangelog()` in
`js/changelog.js` filters at render time; the array itself is never modified.

- When consecutive entries are hidden between two visible ones, a dashed
  "⋯ N updates for another course ⋯" pill (`.changelog-gap`) is shown in their
  place. Hovering swaps its label to "⋯ tap to reveal anyway ⋯"; clicking
  reveals only that run of entries, in place. A gap is never shown at the top
  or bottom of the list.
- Indentation (major → level 0, minor → level 1, patch → level 2) is computed
  from the full, unfiltered array, so hidden entries never shift the levels of
  visible ones.
- The version badge on the changelog button shows the latest *visible*
  entry's version.

### What stays framework (shared)

All of `js/` (apart from the per-course block in `course-config.js`), `css/`,
`editor/`, `images/`, `favicon/` and `vendor/` are identical across
deployments. `js/data/changelog.js` stays framework-side as well: it is the
platform's development history, not course content.

---

## Problem banks

### Problem object format

Each `course/quizzes/quizN.js` declares two arrays:

```js
const Quiz_3_Problems = [
  { id:"P5i", topic:"Gravitational force and field", answer:3.1761e-11, units:["N"],
    text:"Figure shows five equal masses ... <div class=\"fig-img-wrap\"><img src=\"course/images/quiz_3/unnamed.webp\" alt=\"figure\" width=\"300px\"></div>" },
  // ...
];
const Quiz_3_Retired = [];
```

| Field | Meaning |
|---|---|
| `id` | Permanent key, unique within its quiz, never reused (see below). |
| `topic` | Topic label shown on the card and used by the topic filter. |
| `answer` | Numeric answer, expressed in `units[0]`. |
| `units` | Accepted units. `units[0]` is the unit the answer is written in and the reference for SI-prefix conversion. `[]` or `[""]` means dimensionless. |
| `text` | Trusted HTML with inline `$...$` / display `$$...$$` LaTeX. Figures are `<img>` tags pointing into `course/images/`; images found here are also picked up automatically by the offline-mode download. |

### The quiz registry

`course/quizzes/quizzes.js` defines `QUIZZES`, one entry per quiz slot:

```js
{ name: "Gravity and Waves", problems: Quiz_3_Problems, retired: Quiz_3_Retired, enabled: true }
```

`enabled: false` hides a slot from the landing screen. The file also builds a
lookup index once at load and exposes the helpers every other file uses to turn
a stored `(quizNum, id)` into something visible:

| Helper | Returns |
|---|---|
| `problemNumber(quizNum, id)` | 1-based position of an active problem, or `null`. |
| `getQuizProblem(quizNum, id)` | The problem object, active or retired, or `null`. Used wherever a stored id must be shown again. |
| `isProblemRetired(quizNum, id)` | `true` for any id that is not currently served. |
| `problemLabel(quizNum, id)` | `"P12"` for an active problem, `"DEL"` otherwise. |

A load-time check logs a console error for a problem without a string id, and
for an id that appears more than once within a quiz (across `problems` and
`retired`).

### Problem ids, numbers and retiring problems

The **id is the permanent key** under which all history is stored: attempts
(`quiz_attempts`), Solve-All progress, forum threads (`problem_key` =
`q<N>_<id>`), worked solutions (`problem_solutions.problem_key`, same format)
and the math cache. It is never shown to students and never has to match the
problem's position.

What students **see** is the problem's current 1-based position in its quiz's
`problems` array (`P12`). Problems can therefore be reordered or inserted
anywhere without any history moving with the numbers. The number filter in
quiz mode also works on displayed numbers, not ids.

- **New problem:** the next unused id is assigned (an id is never reused), and
  the object is placed at the position where it should be shown.
- **Retiring a problem:** its object is *moved*, unchanged, from
  `Quiz_N_Problems` to `Quiz_N_Retired` in the same file. It is no longer
  served in Random N or Solve-All and disappears from Solve-All progress, but
  it still opens from attempt review, stats, forum threads and the Solution
  screen, labelled **`DEL`**. Stats keep counting its attempts. Moving it back
  restores its attempt history and forum threads; its Solve-All progress is
  not restored, because Solve-All pushes overwrite the server row with only the
  problems currently served.
- **Substantial change** (new numbers, different question): the old problem is
  retired and the new one is added under a fresh id. Keeping the id would
  carry the old solved status — and the old worked solution — over to what is
  effectively a different problem. For small edits, the editor and the
  Solution screen detect the change through `problem_hash` and flag the
  solution as possibly stale.
- **Deleting** a problem object outright is avoided whenever anyone may have
  attempted it (its attempts would show "original text no longer available").

### Adding a quiz

Up to four quiz slots exist. Enabling a prepared slot requires: the bank in
`course/quizzes/quizN.js`, its `<script>` tag in `index.html` (before
`quizzes.js`), and `enabled: true` plus a `name` in `QUIZZES`.

Quiz numbers 1–4 are assumed in several places, all of which need extending
for a fifth quiz: the `<script>` tags in `index.html`, the forum filter chips
(`data-filter="q1".."q4"` in `index.html`), the stored-attempt validator in
`js/stats.js` (`[1,2,3,4]`), the `--q1..--q4` series colors in `css/stats.css`,
`OFFLINE_CORE_FILES` in `js/offline-mode.js`, and `loadAllProblems()` in
`editor/editor.js` (`[1, 2, 3, 4]`).

---

## Answer checking

Implemented in `js/quiz-engine.js`; the student-facing summary is the
"How to enter your answer" guide in `index.html` and the
"Scoring & Answer Formatting" manual page in `course/manual.json`.

**Numbers** (`parseMoodleNumber`) follow Moodle rules:

- plain decimals: `3.14`, `-0.5`, `.5`, `1200`
- `e`/`E` notation: `1.6e-19`, `2.998E8` (no spaces, no parentheses)
- power-of-ten notation: `5*10^3`, `1*10^-11`, `1*10^(-11)`, `10^-4`, `10^(-4)`
- a comma (`3,14`) is rejected; `x` instead of `*` is rejected

**Tolerance** (`numberCorrect`): `|value − answer| <= 1% · |answer| + 1e-10`,
after the SI-prefix conversion below.

**Units** (`parseUnitToMap`, `unitStatus`, `unitConversionFactor`):

- a space multiplies (`N m`), a single `/` divides (`N/C`, `kg m/s^2`), `^`
  raises (`m^2`, `s^-1`, `s^(-1)`)
- `*`, `·`, `×` are rejected; parentheses are only allowed around an exponent
- Unicode superscripts are normalized (`m²` → `m^2`, `s⁻¹` → `s^-1`)
- named SI-derived units (`N J W Pa Hz C V Ohm F T Wb H`) are expanded into
  base units, so any dimensionally identical spelling is accepted:
  `Wb` = `V s` = `T m^2`, `V/m` = `N/C`, `N s` = `kg m/s`
- `""`, `none`, `(none)` and `rad` mean dimensionless
- units are case-sensitive

**SI prefixes** (`SI_PREFIXES`, `PREFIXABLE_UNITS`): `Y Z E P T G M k h da d c m u n p f a z y`,
with `mc`/`mk` as ASCII aliases for micro. They attach to
`N C m s J V A T W H Hz Pa Wb Ohm F` (not to `kg`). The conversion is relative
to `units[0]`, so a stored answer such as `326.9` with `units:["nm"]` matches
`326.9 nm` 1:1 and `0.3269 um` after conversion. A bare single-letter unit
(`T`, `m`) is never read as a prefix.

**Scoring** per problem: value ✓ + unit ✓ = **1**; value ✓ + unit ✗ or
unparseable = **0.9**; value ✗ = **0**.

---

## Front-end subsystems

### Page load order

`index.html` loads in tiers:

1. **Inline head scripts.** `history.scrollRestoration = 'manual'` (a reload
   always starts at the top); an anti-flicker script that reads the saved
   Display settings from `localStorage.flux_settings` and adds `settings-hide-*`
   classes to `<html>` before `<body>` exists; the MathJax config, which also
   creates `window.MathJaxReady` (a promise resolved once MathJax has started,
   so early callers can await it instead of racing it).
2. **All stylesheets** load as normal blocking `<link>`s. They are not
   deferred: the hidden screens and modals are only hidden by those files, so
   deferring them caused a flash of unstyled markup.
3. **Tier 1 scripts** (plain tags, in order): `course-config.js` →
   `banner-manager.js`, `theme-colors.js`, `themes.js`, `splash.js`,
   `easter.js` → `course/quizzes/quiz1..4.js` → `data/changelog.js`,
   `data/tips.js` → `quizzes.js` → `stats.js`, `stats-export.js`,
   `attempts-sync.js`, `solve-all-sync.js` → `math-cache.js`,
   `math-render.js` → DOMPurify, `figure.js`, `solution-render.js`,
   `solutions.js`, `editor-access.js` → `quiz-engine.js`. The engine boots
   inline (not on `DOMContentLoaded`), since everything it needs is already
   parsed by then.
4. **Tier 2** is loaded by a small sequential loader that only starts after
   tier 1 has finished, so its bytes never compete with the landing screen:
   `fig-attribution.js`, `top-bar-scroll.js`, `top-bar-tips.js`,
   `top-bar-quiz-status.js`, `solve-all-nav.js`, `changelog.js`, `manual.js`,
   `settings.js`, `offline-mode.js`, the Supabase JS client (jsDelivr CDN),
   `site-visits.js`, `forum.js`, `push-notifications.js`.
5. `sw.js` is registered on `load`.

Because `settings.js` arrives late, code that needs a setting earlier reads
the raw `flux_settings` value itself (`_readStudySettingRaw` in
`quiz-engine.js`, the inline anti-flicker script). Calls into tier-2 code are
guarded with `typeof fn === 'function'`.

### Quiz engine

`js/quiz-engine.js` drives every quiz screen.

**Landing screen.** Quiz buttons are rendered from `QUIZZES`
(`renderQuizButtons`). A mode switch selects **🎯 Random N** or
**⚡ Solve Them All**; for quiz 2 and later, a second switch selects
**Single quiz** or **Cumulative**. Settings can pre-select the latest quiz
and the cumulative switch.

**Random N** (`newQuiz`, `render`, `checkAll`). `QUIZ_SIZE` problems are drawn
from the selected quiz. In cumulative mode, `QUIZ_CUMULATIVE_PREV_COUNT` come
from all earlier quizzes and the remainder from the selected one. "Check
answers" scores everything at once, shows the result panel with a score-box
row (a P⇄Q toggle switches cumulative rows between problem and quiz labels), a
"Last attempts" mini-panel, per-problem forum buttons and, where published,
"📘 See solution" buttons. Each attempt is recorded by `stats.js`.

- **Problem Pool Filter**, per quiz, with four modes saved per quiz in
  localStorage: *none*, *topic* (checkboxes), *number* (ranges such as
  `3, 5-6, 15-19`, include or exclude; numbers are displayed positions), and
  *type* (attempt status: not attempted / wrong / almost correct / correct,
  following the Last/Best switch of the Stats problems overview). An empty
  filtered pool falls back to the whole quiz. A note appears under the header
  when a filter narrows the draw. The "↺ Reset" button uses a tap-twice
  confirmation with a countdown ring instead of `confirm()`.
- **Live timer** (`#liveQuizTimer`): a floating mm:ss clock while an attempt
  runs. `isQuizTimerActive()` and the `quiztimer:activechange` window event
  report whether an attempt is running, independently of whether the clock is
  shown.
- **Full screen** for Random N (on by default) is entered when an attempt
  starts and left when the score is revealed. A 10-second reminder banner
  ("Settings → Study") is shown once per full-screen session and pauses while
  a higher-priority banner is up.
- **Auto-stop** (optional): the attempt is submitted after 50 minutes.

**Solve Them All** (`startSolveAll`, `buildSolveAllCards`,
`checkSingleProblem`, `revealAnswer`). Every problem of the quiz (or of all
quizzes up to it, in cumulative mode) is shown, ordered or shuffled (an order
picker page appears unless the order is locked in Settings). Each card is
checked on its own; "See correct answer" reveals an answer and marks it
*revealed*. Cards are built in batches with a full-screen "Rendering
equations…" transition, using the math cache. Progress (status per problem,
locked cards, typed answers) is saved per quiz and mode, and synced across
devices once a nickname is claimed. The floating **sticky score** shows solved
/ correct / partial / wrong counts and a sync dot. "🗑 Reset Progress" clears
the session (locally and on the server); "🔁 Rerender Equations" discards the
cached typesetting for the current set.

**Mistakes retry** (`startMistakes`): from the sticky score, a quiz made of
only the wrong/revealed problems can be started, ordered or shuffled.

**Solve-All progress rail** (`js/solve-all-nav.js`, wide screens only, at
least 12 cards): tick marks every N problems, a "you are here" segment and a
scroll pointer; clicking jumps. The file is self-contained and watches the DOM
with a `MutationObserver` instead of being called by the engine.

**Screen handling.** `goToMainMenu`, `captureScreenScroll` /
`restoreScreenScroll` and the fade helpers move between screens and restore
scroll positions.

### Stats

`js/stats.js` records **Random N attempts only** (Solve-All is tracked
separately as progress). Attempts are stored under `STORAGE_PREFIX + '_stats_v2'`,
keyed by a content hash, each carrying the quiz, mode (`single`/`cumulative`),
date, duration, score and a per-problem `answers` array. Once a nickname is
claimed, localStorage is a cache/queue and the server is the source of truth.

The Stats screen contains:

- **Forum & Site panel**: avatar, nickname, join date and a ⚙ menu (Getting
  started / Change nickname / Your PIN / Exit); "my messages" and "my quizzes
  taken"; three tally dials (forum participants, total visits, total quizzes
  taken by everyone). Values come from the RPCs `get_stats_panel`,
  `get_total_quiz_attempts` and `get_my_total_quiz_attempts`, refreshed on
  Realtime pings plus a 45 s fallback.
- **Legend, chart (canvas, with tooltip) and filters.**
- **Attempt log table**, with per-attempt delete and a sync dot.
- **All-problems overview**: one pill per problem in every enabled quiz,
  colored by that problem's *Last* or *Best* score (switchable, remembered).
- **Attempt review screen** (`openAttemptReview`): a read-only replay of one
  attempt, reusing the live quiz card styles.
- **Export** (`js/stats-export.js`): PDF, Excel (.xlsx), CSV or TXT, via an
  in-app format picker. The vendor libraries are loaded on demand.

After 5 minutes without interaction on the Stats screen, the Attempt log and
the Forum & Site panel stop refreshing and dim; any interaction wakes them and
refreshes immediately.

### Cross-device sync

Both sync modules identify the device with `device_id` + `device_secret` (see
[Device ownership](#device-ownership-device_secret-and-tokens)); the server
resolves the device to its claimed identity.

- **Attempts** (`js/attempts-sync.js` ↔ `sync-quiz-attempts`,
  `delete-quiz-attempt`): one round trip pushes unsynced attempts and pulls the
  full server list. It runs on Stats open, after recording or deleting an
  attempt, on a Realtime Broadcast ping on `attempts:<identity_id>`
  (migration 003), when the tab regains focus or the network comes back, and
  on a slow fallback timer. Hashes being deleted are excluded from merges until
  the delete completes.
- **Solve-All** (`js/solve-all-sync.js` ↔ `sync-solve-all`): progress is a
  mutable per-problem map, so merges are a **union** that keeps the "more
  resolved" status per problem (correct > revealed > partial/wrong). It syncs
  when a session opens, on a ping on
  `solveall:<identity_id>:<quiz>_<s|c>` (migrations 004/005), on focus, on a
  60 s fallback and on exit. Pings carry the pushing device's id so a device
  ignores its own echo, and unchanged snapshots are not re-pushed — together
  these stop two open devices from ping-ponging. A reset writes a tombstone
  (`data: null`) rather than deleting, so the reset sticks on other devices;
  a device that discovers one mid-session returns to the order picker. Tabs of
  the same browser additionally coordinate through a `BroadcastChannel`.
- **Live dots**: `_settleLiveDot` drives the sync dots (green pulse = synced,
  gray pulse = syncing/queued, red = failed, hidden = no identity), letting a
  pulse finish its cycle before stopping.

Broadcast pings never carry data — only a timestamp (and a device id) — so the
identity-scoped channel names expose nothing new.

### Forum

`js/forum.js` reads `forum_messages_public` directly with the publishable key
(RLS allows SELECT only) and never inserts directly: posting, editing,
flagging and nickname changes go through Edge Functions.

- **Threads**: a message is *global* or attached to one problem
  (`problem_key` = `q<N>_<id>`). Filter chips (All / Global / Quiz 1–4, plus a
  per-problem select), replies, `@mention` autocomplete, full-text search over
  every message, "Load older messages" (pages of 25), and a "new messages" pill.
  Per-problem forum buttons on quiz cards show message counts; opening one
  shows a collapsible copy of the problem text above the thread.
- **Live updates**: one Realtime subscription to Postgres Changes on
  `forum_messages` drives the unread badges, the open feed and the per-problem
  counts.
- **Pinned message**: `FORUM_PINNED_MESSAGE_ID` is painted above the list until
  dismissed or 24 h after first shown.
- **Identity**: a nickname (2–40 letters, digits, `.`, `_`, `-`; no spaces so
  mentions work; `gemini` reserved) plus a 5-digit PIN generated at claim time
  (returned once by the server, kept on the device and viewable under
  "Your PIN"). Five wrong PINs lock the identity for 15 minutes. The same identity can
  be linked to several devices (restore with nickname + PIN), renamed, or
  exited on one device. New and renamed nicknames pass OpenAI moderation. A
  **Getting Started** modal (with FAQ) is shown before the first quiz Start on a
  device without a nickname, and leads into the claim modal.
- **Composer**: LaTeX with `$...$`/`$$...$$`, a live hover preview, an
  insert-equation modal with a quick grid, and **LaTeX shorthand**: `&x squared&`
  (inline) or `&&...&&` (display) is converted to real LaTeX server-side by
  Gemini before posting. When conversion fails, "↻" retries and "Post as is"
  posts the raw text (`force_latex`).
- **@gemini**: tagging `@gemini` asks the Gemini bot to reply in the thread
  (see [Gemini integration](#gemini-integration)). Bot posts use a sentinel
  `device_id` (`00000000-0000-4000-8000-000000000001`) that humans cannot post
  with, which is what the official avatar keys off.
- **Editing** own messages (body and scope) via a modal; **flagging** any
  message for AI review; a non-dismissible ban banner while a posting ban is
  active (`check-ban`).
- **Profiles**: tapping an `@name` chip opens a popup with `get_author_stats`.
- **Avatars**: DiceBear identicons, cached in localStorage.
- **Floating forum button** (`#forumFabWrap`): a second entry point visible
  everywhere except the landing screen and an unchecked Random N attempt, with
  the same unread and "@" badges.

### Push notifications

`js/push-notifications.js` shows an in-app explanation modal before the
browser's own permission prompt, subscribes with `PUSH_VAPID_PUBLIC_KEY`, and
saves or removes the subscription through `save-push-subscription`.
`post-message.ts` sends a push when a message mentions a claimed nickname or
replies to one. `sw.js` displays it (unless Settings → Notifications → "Go
silent" is on, read from IndexedDB `flux-notif-mute`) and opens the right
thread on tap.

### Worked solutions (site side)

`js/solutions.js` shows solutions written in the [editor](#solutions-editor-editor).

- Reading needs **no Edge Function**: migration 008's RLS policy allows anon
  SELECT on `problem_solutions` rows with `status = 'published'`, so drafts are
  unreachable rather than merely hidden.
- An **index** of published keys (`problem_key`, `updated_at`) is fetched at
  load, when the tab becomes visible again, and hourly while visible; it is
  cached in sessionStorage for a fast first paint. A full row is fetched the
  first time a solution is opened and kept in memory until the index shows it
  was unpublished or saved again.
- **"📘 See solution"** appears in Random N only after the score is revealed
  (so a solution cannot replace the attempt), and always in Solve-All.
- The **Solution screen** replaces the current screen (like the forum) and
  shows: the problem text (without the answer), a "problem changed since" note
  when the current problem's hash differs from the stored `problem_hash`, the
  figure with step navigation (‹ ›, dots, keyboard arrows, swipe, and an
  autoplay every 2.2 s that stops at the last step or on any manual step, and
  is skipped under reduced motion) and a caption per step, the solution text,
  and "Solution by @author" (linked when the editor has an http(s) link).
  Escape closes it and the previous screen and scroll position are restored.
- Figures are the stored SVGs. They are **always sanitized** with DOMPurify
  (`figSanitizeSvg`) before being inlined, then cropped to the drawn content
  (`figCropToContent`, one shared box for all steps) and scaled by
  `figure.scale`. `vendor/tikzjax/fonts.css` is loaded on the site because the
  SVG glyphs use Computer Modern private-use codepoints.
- Solution text is rendered by `renderSolutionInto` (`js/solution-render.js`):
  each line becomes its own block inserted as text (never HTML); multi-line
  `$$…$$`, `\[…\]` and `\begin{env}…\end{env}` blocks are kept together; an
  unclosed block falls back to one block per line.

### Settings

`js/settings.js` stores device-local settings (never synced) as
`localStorage.flux_settings` with a schema version and a migration that merges
saved values over `SETTINGS_DEFAULTS`. `getSetting(tab, key)` /
`setSetting(tab, key, value)` are the accessors. The screen has four tabs:

| Tab | Settings |
|---|---|
| **Display** | Show floating avatar · Show floating splashes · Show manual button · Show theme selector button · Show daylight switch (sub-setting: Follow device theme) · Show floating forum button · Show running line (top-bar tips) · Hide field lines by default |
| **Notifications** | Hide update reminder (sub: Update anyway outside quiz mode) · Hide try-new-theme reminder · Hide bug report reminder · Go silent — hides every badge and banner and mutes push (sub: Turn off automatically after 24 hours) |
| **Study** | Reduce motion · Show live timer · Reset filter on page load · Automatically stop after 50 minutes · Full screen for Random N (sub: Don't show full-screen reminder) · Select latest quiz by default · Select cumulative by default · Hide topic while active · Solve-All: Lock order + Order · Line progress (rail) · Show progress window (sticky score) · Reveal wrong answer instantly |
| **Sync & Storage** | Go offline (24 h) · Cache & storage tools · Backup |

Display toggles only add classes to `<html>`; the hiding itself is CSS in
`css/settings.css`. "↺ Reset all" restores defaults (tap twice to confirm).
**Backup** exports every setting except the offline-mode timestamp to a JSON
file (`app: "flux-settings-backup"`) and imports such a file back.
`openSettingsStudySection(rowKey)` opens the Study tab scrolled to a row (used
by the full-screen reminder banner).

### Offline support

Two independent jobs share `sw.js`:

1. **Offline fallback page** (always on). Navigations are network-first; when
   one fails, the precached `offline.html` is shown, with a theme-matched
   illustration, the site's theme colors and MathJax (both precached) and a
   random "law of the moment" from `course/offline-laws.json`. Precached
   assets (`PRECACHE_URLS`) are served cache-first with background
   revalidation. `CACHE_NAME` is bumped whenever that list changes. When the
   update checker detects a new version, the page asks the worker
   (`purge-update-cache` message) to drop `CACHE_NAME`, so a single reload
   fetches fresh files.
2. **Full offline mode** (`js/offline-mode.js`, Settings → Sync & Storage →
   "Go offline", tap twice). Pending attempts and Solve-All progress are pushed
   first; then the core files, the MathJax bundle and every image referenced
   by any problem (active or retired) are downloaded into
   `flux-offline-mode-v1` (six at a time, bypassing the HTTP cache). Only a
   complete download activates the window: the expiry timestamp is written to
   settings and to IndexedDB `flux-offline-mode`, where `sw.js` reads it. For
   24 hours, every cross-origin request (Supabase, CDNs) is refused and
   same-origin requests are served from that cache, even when a connection is
   available. "Go back online now" ends it early; `endOfflineMode()` also
   reconnects live sync. The forum and the PDF/XLSX exporters are deliberately
   not included.

`OFFLINE_CORE_FILES` in `js/offline-mode.js` is maintained **by hand** and must
list every same-origin file that `index.html` loads; the cache name and
IndexedDB names must stay identical in `js/offline-mode.js` and `sw.js`.

**Cache & storage** tools (tap twice to confirm): *Reset all cache* (local
attempts and Solve-All progress; the server copy returns on next sync),
*Reset prerendered LaTeX equations* (the whole math cache), *Reinstall service
worker* (unregister, clear every cache except the offline-mode one,
re-register, reload).

### Theming

Presets are CSS blocks in `css/style.css` (`body[data-theme="x"]`, each with a
`.light` variant): **Default, Nord, Sakura, Cyber, Forest, Solar**. `body.light`
is day mode. `js/themes.js` provides the picker, the **custom theme builder**
(background, text, two accents, roundness, font pairing — Plex, Grotesk,
Quicksand or All-mono — separately for night and day, with surface/border/
muted/accent-dim derived automatically; nothing is applied until "Save &
apply"), and a one-time theme nudge banner. `js/theme-colors.js` reads the live
computed CSS variables so canvas/JS-drawn UI (chart series via
`quizSeriesColor`, confetti, the π egg) follows the active theme. The editor
uses the same theme files and storage keys.

### Math rendering and the render cache

`renderMathIn(el)` (`js/math-render.js`) awaits `MathJaxReady` and typesets an
element. MathJax's menu and accessibility explorer are disabled, and a stale
`MathJax-Menu-Settings` key is removed on every load.

**Site-wide LaTeX macros**, defined identically in `index.html`,
`offline.html`, `editor/index.html` and the TikZ preamble in
`editor/editor.js` (all four must be kept in sync):

| Macro | Result |
|---|---|
| `\dd{x}` | upright d x |
| `\dv{x}{t}`, `\dv[2]{x}{t}` | (n-th) derivative |
| `\pdv{f}{x}`, `\pdv[2]{f}{x}` | (n-th) partial derivative |
| `\vb{F}` | bold vector |
| `\vu{r}` | bold unit vector with hat |
| `\abs{x}`, `\norm{v}` | auto-sized \| \| and ‖ ‖ |

**Render cache** (`js/math-cache.js`, IndexedDB `mathRenderCache`): for
Solve-All cards, the typeset HTML of each problem text is stored together with
exactly the CSS rules it needs, keyed by a hash of the source text and scoped
per quiz (`mathCacheKeyFor`). An edited problem misses the cache automatically.
`MATH_CACHE_SCHEMA` is bumped when card markup or the render pipeline changes.

### Top bar

- `.top-bar-backdrop` turns from `--bg` to `--surface` once the page scrolls
  past 28 px (`js/top-bar-scroll.js`, `topbar:scrollstate` event).
- **Running line** (`js/top-bar-tips.js`): random tips from
  `js/data/tips.js`, shown only on non-mobile widths, never on Manual or
  Settings, and only while the bar is in its scrolled state. It fills the real
  gap between the logo and the icon row.
- **Quiz status** (`js/top-bar-quiz-status.js`): HH:MM with a blinking colon
  and, where the Battery Status API exists, battery level/charging — only
  during a Random N attempt in full screen with enough room, and yielding to a
  tip (`topbartip:show` / `topbartip:hide` events).
- Icon row: ⚙️ Settings, 📖 Manual, 🎨 themes, day/night switch. The site logo
  returns to the main menu; holding it opens the editor entry (see
  [Access](#access)).

### Banners and the update checker

`window.BannerManager` (`js/banner-manager.js`) shows one bottom banner at a
time: `update` always preempts (others are paused, not lost); `bug`, `theme`
and the full-screen reminder queue first-come-first-served. API: `register`,
`request`, `release`, `cancel`.

- **Update banner**: `version.json` is polled every 5 minutes; a mismatch with
  `CURRENT_VERSION` shows "New version available" with Reload (which purges the
  service-worker cache first). With "Hide update reminder" on, the banner is
  suppressed, and "Update anyway outside quiz mode" reloads silently as soon as
  no timed attempt is running.
- **Bug-report nudge** ("Report on Telegram"): at most once a day, after 10
  minutes of use.
- **Theme nudge**: once, suggesting a preset.

### Smaller modules

- **Splash** (`js/splash.js` + `course/splashes.json`): entries are
  `[text, condition, mandatory?]`. Conditions: `""` always, `M`/`D`/`E`/`N`
  (morning/day/evening/night), `P` (near π time or π day), plus date codes for
  holidays defined in `COND_ACTIVE`. `mandatory: 1` guarantees the line is shown
  once on its day. Tapping the badge rolls a new line.
- **Manual** (`js/manual.js` + `course/manual.json`): an array of sections
  `{ id, icon, title, subsections: [{ id, title, html }] }` with inline LaTeX,
  shown as a collapsible tree and a content pane. A fallback notice appears
  when the JSON cannot be fetched (e.g. a `file://` page).
- **Changelog** (`js/changelog.js`): the panel under the landing box, the
  charge-canvas button with the version badge, a "⚡ field lines" cursor effect
  (toggleable; can be off by default via Settings) and a GitHub link.
- **Easter egg** (`js/easter.js`): Pi Hour (3:14 AM/PM) and Pi Day (14 March).
- **Figure attribution** (`js/fig-attribution.js`): tap-to-toggle `.fig-attr`
  (i) badges inside problem text; Escape or an outside tap closes them.
- **Site visits** (`js/site-visits.js`): one fire-and-forget `record-visit`
  call per page load, sharing the forum's `device_id`.

---

## Solutions editor (`/editor`)

A separate page at `/editor/` for writing a worked solution — text with LaTeX
plus an optional stepped figure in TikZ or SVG — for every problem. It reads the problem
banks live from the same origin, so it always matches the deployed course.

### Access

- The editor is **not linked** anywhere. Holding the site logo for 2 seconds
  (`js/editor-access.js`) opens a small "📘 Editorial" panel with *Open* and
  *Open in new tab*; a normal click still goes to the main menu. Once an editor
  key is stored in the browser, a 📘 quick link appears next to the logo.
- The page asks for a **32-character access key**, which is verified by the
  `solutions-admin` function (`whoami`) before the editor opens. The key is
  stored in localStorage (`<prefix>-editor-key`) only after the server accepts
  it, and removed on sign-out (tapping the `@name` in the top bar) or
  rejection. Keys are per course project.
- The page carries `noindex, nofollow`.

### Layout

- **Top bar**: logo (back to the site), sidebar toggle, title, `@editor-name`
  (sign-out) with the site identicon of the nickname signed in on the main
  site in the same browser, the site version label, themes and day/night.
- **Sidebar**: quizzes as collapsible groups of problems (retired ones
  included), each marked with its state; a filter for "problems with work";
  *Check all* and *Editors* at the bottom.
- **Problem bar**: problem key, state pill (opens the state panel), *Hide
  figure*, and *Problem* (shows the problem text and accepted answer).
- **State panel**: current state, sync state, last saved, author, "problem
  changed since" (one per line), and the actions *Publish*, *Save draft*,
  *Unpublish*, *Load from database…*, *Clear this problem…*, *History…*,
  *Check state* (reads the row again and updates the panel and the sidebar
  dot without touching the fields), *Export all as JSON*.
- **Split view**: inputs on the left (TikZ or SVG, captions, solution), previews on
  the right (figure with step viewer, solution). The divider is draggable,
  keyboard-resizable and resets on double-click; the layout stacks vertically
  on narrow screens.

### Figures (TikZ)

- The figure is TikZ code compiled **in the browser** by TikZJax, with a
  preamble added automatically (viewable under "Preamble"): packages
  `amsmath, amssymb`; libraries `arrows.meta, calc, positioning, angles,
  quotes, patterns, intersections, decorations.markings,
  decorations.pathreplacing, decorations.pathmorphing, shapes.geometric`; the
  site-wide macros; and the theme colors below.
- **Colors** follow the reader's theme. Black (default, also `ctext`) maps to
  the text color, `c1`/`c2` to accent 1/accent 2, `c3`/`cbg` to the page
  background and `c4`/`csurface` to the card background (useful as a fill to
  knock out what lies behind a label). TikZJax writes them as `#000`,
  `#ff0001`…`#ff0004`, and `css/figure.css` maps those values to CSS
  variables, so stored SVGs never need recompiling when a theme changes. The
  🎨 Colors button previews them in every theme.
- **Steps**: `\onstep{N}{…}` shows its content from step N on. The highest N
  sets the step count (max 12); every step is compiled separately with
  `\thestep` set, and each step gets its own caption. The site cross-fades
  between steps.
- Everything is kept inside `\useasboundingbox`; anything outside is clipped.
  The preview applies the same crop and size cap as the site.
- **Scale** (0.25–2, default 1) changes the displayed size of the stored SVG
  without recompiling.
- Compiles run in a queue with a per-source SVG cache and a 90 s timeout. On
  a TeX error, the first `!` line and its source line are shown, with the full
  TeX log available.
- At save time each SVG is normalized (`figNormalizeSvg`: canonical colors,
  fixed sizes removed, ids prefixed so several inline SVGs never collide).

### Figures (SVG)

The **TikZ / SVG** switch above the figure box picks how a problem's figure is
written (TikZ by default). Each kind keeps its own text, so switching loses
nothing. Only the selected kind is compiled and shown to readers, but both
texts are saved with the row (a change to either one counts as unsaved), and
a saved figure reopens in its kind. The logic is in `editor/svg-figure.js`.

- **Body only**: the shapes, no `<svg …>` header, since every drawing app
  writes a different one. A whole pasted file works too (its header is
  ignored). Parsing is lenient (HTML parser in an inert `<template>`), so
  Inkscape's `inkscape:`/`sodipodi:` markup is fine.
- **Box**: fitted automatically to what is drawn (stroke widths, arrowhead
  markers and text included, with margin; the site then crops tighter, as for
  TikZ). The optional *Crop box* field (`x y width height`) clips instead, like
  `\useasboundingbox`.
- **Colors**: `#000` text, `#f00` accent 1, `#00f` accent 2, `#eee` card
  background (also `c1`–`c4` and the stored `#ff000N` values). They are
  converted to the same stored values TikZ figures use. Any other colour
  stays fixed: the editor warns about it, lists it in pre-publish checks, and
  *Layers & colours* maps it to a theme colour.
- **Steps = layers**: top-level groups, first in the file = step 1, each
  adding to the one before. `<g data-layer="Name">` marks a layer; without
  any, Inkscape layers (`inkscape:groupmode="layer"`), then any top-level
  `<g>`, are used. `data-steps="n"` gives a layer n steps of its own and
  `data-step="r"` on an element inside it shows that element from the
  layer's r-th step. Elements outside every layer are always shown; a hidden
  layer (`display="none"`) is left out. Captions are labelled with the layer
  names.
- **Cleaning** before storing: `style=""` and `<style>` classes become
  presentation attributes, `<use>` becomes copies, prefixes, classes, event
  handlers, images and hidden parts are removed, and black becomes the default
  fill. Everything put on screen goes through DOMPurify first.
- **Layers & colours** (button next to 🎨 Colors): a window listing every
  layer and element with a preview (hovering a row highlights it, step buttons
  show the figure up to a step). It can hide, rename, reorder, add and delete
  layers, set a layer's step count and each element's step, move elements
  between layers (keeping their position and inherited styling) and map
  fixed colours. Every change is written into the SVG text as one edit, so
  Ctrl+Z in the text box undoes it.
- Stored as `figure = { kind: "svg", svgSrc, svgBox?, tikz, steps, scale? }`
  (a TikZ figure has no `kind`, and carries `svgSrc` only when there is SVG
  text too); the site uses only `steps`, whichever kind made them.

### Solution text

Plain text with `$…$`, `\(…\)`, `$$…$$`, `\[…\]` and environments, rendered
exactly as on the site (`renderSolutionInto`). Both code boxes offer
**snippets** in VS Code style: typing a prefix shows suggestions (↑/↓ to
choose, Tab or Enter to insert, Esc to close, Ctrl+Space lists everything),
with `${1:…}` tab stops visited by Tab/Shift+Tab. The TikZ list covers
pictures, bounding boxes, arrows, nodes, blocks, axes, inclines, angles,
ground/wall hatching, springs, braces, dimensions, `\onstep`, loops and
scopes; the solution list covers math blocks, `aligned`, `cases`, fractions,
roots, the derivative macros, integrals, accents, brackets, units, relations
and Greek letters.

### Saving, publishing and conflicts

- A row is either a **draft** (visible only in the editor) or **published**
  (visible on the site). *Unpublish* returns it to draft; *Clear this
  problem…* deletes the row.
- Every save stores `problem_hash` (SHA-256 of text, answer and units, first 32
  hex chars — `problemHashOf` in the editor and `solutionProblemHash` on the
  site must stay identical).
- Publishing is the only way a solution reaches the site; a row whose problem
  disappeared from the quiz files (deleted rather than retired) is reported
  as an orphan by *Check all*.
- Saves send the `updated_at` last seen. When another editor saved in between,
  the server answers **409** with the current row and nothing is overwritten;
  the editor then offers *Load theirs*, *Overwrite with mine* (saves again
  against their version) and *Preview*.
- **Asked before replacing** a stored version that isn't simply your own
  draft: publishing over the published version (*Replace published*), saving
  a draft over it, which takes it off the site (*Unpublish and save*), and
  saving over another editor's draft (*Overwrite*). *Load from database…*
  asks too.
- **Preview** (on all of these) opens both versions side by side: this window
  on the left, the stored one on the right, each headed with whose it is and
  when it was saved; then the figure with every step and caption, and the
  solution, each section marked *same* or *different*. The confirmation's
  buttons are repeated at the bottom.
- **Pre-publish checks** (warnings, "Publish anyway" is always offered): empty
  solution, unbalanced `$`, `$$`, `\[ \]`, `\( \)`, braces or
  `\begin`/`\end`, captions without a figure step, partially captioned steps,
  and a problem changed since the last save. Publishing is refused while a
  figure is still compiling.
- **Credit**: every publish asks "Who wrote this solution?" — the signed-in
  editor is preselected (Enter publishes), the row's current credit comes
  next ("latest publish"), then every other active editor; Esc cancels. The
  chosen editor becomes `author` (shown on the site as "Solution by @name",
  with their link); the server only accepts an active editor's name. Drafts
  keep the existing credit. `saved_by` is always whoever's key saved, and is
  what *By:* and the overwrite/conflict warnings show (*By:* adds "credited
  to @name" when the two differ). While the published version matches the
  window, the Publish button reads *Change credit…*: the same question, then
  the `set-credit` action, which changes only `author`/`author_link` (never
  the content) and is refused if the row changed since it was loaded.
- **Ctrl+S** re-publishes a published solution, or saves anything else as a
  draft, asking first in the cases above (a toast points to the state panel).

### Drafts and local history

- Field contents are kept per problem in localStorage (`<prefix>-editor-drafts`,
  debounced, flushed on tab hide/close), so nothing typed is lost on reload,
  sign-out or update.
- **History…** lists earlier versions kept **only in this browser**
  (`<prefix>-editor-history`): one on every save/publish, one before anything
  replaces the fields (load from database, clear, restore), and one every 10
  minutes while typing; identical consecutive versions are stored once. Up to
  30 per problem and 400 in total. Figures are stored as source (TikZ and
  SVG text) and recompile on restore.
- Each version has **Preview**: the compare window (see above) with this
  window on the left and that version on the right, headed with its label and
  when it was kept. Its figure is built for the preview (SVG at once, TikZ
  through the normal TeX queue); *Restore* is repeated at the bottom.

### Other editor tools

- **Check all**: re-reads every stored row and lists stale solutions (problem
  changed), published, drafted, orphaned (no matching problem) and locally
  unsaved work; each line selects that problem. It also refreshes the index,
  showing work published by another editor meanwhile.
- **Editors**: active editors and their links.
- **Export all as JSON**: every row, as a backup file.
- **Keyboard**: Alt+↑ / Alt+↓ previous/next problem (respecting the filter),
  Alt+N next problem with no work.
- **Version label**: shows the `version.json` value at load; when the site is
  updated it turns red ("outdated") and a tap reloads after purging the
  service-worker cache (drafts are kept).
- **Offline stand-in**: replacing `/editor/store.js` with
  `/editor/store-mock.js` in `editor/index.html` runs the editor with
  localStorage instead of the database (same API, marked "offline stand-in").

### Managing editor keys

Editor management needs the `SOLUTIONS_ADMIN_KEY` secret and is done by
calling `solutions-admin` directly (the `x-admin-key` header is accepted as an
alternative to `admin_key` in the body):

```bash
curl -X POST "https://<project>.supabase.co/functions/v1/solutions-admin" \
  -H "Content-Type: application/json" \
  -H "apikey: <publishable key>" -H "Authorization: Bearer <publishable key>" \
  -d '{"action":"create-editor","admin_key":"<admin key>","name":"someone","link":"https://t.me/someone"}'
```

| Action | Body | Effect |
|---|---|---|
| `create-editor` | `name`, `link?` | Returns a new 32-hex key **once**; only its salted, peppered hash is stored. |
| `set-editor-link` | `name`, `link` (`""`/`null` clears) | Sets the http(s) link behind "Solution by @name"; a trigger (migration 009) updates `author_link` on that editor's existing rows. |
| `revoke-editor` | `name` | The key stops working immediately; the row is kept so past solutions keep their author. |

A lost key cannot be recovered: the editor is revoked and a new one created.

---

## Database (Supabase)

The schema is Postgres + Row Level Security. A course's project is built by
running `superbase/migrations/` **in order** in the SQL editor of a fresh
project. `superbase/database.sql` is an old context-only dump, superseded and
never meant to be run.

| Migration | Adds |
|---|---|
| `000_initial_schema_consolidated.sql` | The entire base schema — tables, indexes, the `forum_messages_public` view, RPCs, the attempt-counter trigger and RLS — reconstructed and verified against the live phys162 database. |
| `001_device_secrets.sql` | `device_secrets` (see [Device ownership](#device-ownership-device_secret-and-tokens)). |
| `002_app_variables.sql` | `app_variables`, a key/value table for small state shared across Edge Function calls (Gemini cooldowns). |
| `003_attempts_realtime_broadcast.sql` | The "anon can receive broadcasts" policy on `realtime.messages`, and a trigger pinging `attempts:<identity_id>` on any attempt change. |
| `004_solve_all_realtime_broadcast.sql` | Trigger pinging `solveall:<identity_id>:<quiz>_<s\|c>` on progress upserts (needs 003's policy). |
| `005_solve_all_device_id.sql` | `solve_all_progress.device_id`, included in the ping so a device can ignore its own echo. |
| `006_site_visits_realtime_broadcast.sql` | Statement-level trigger pinging `site-visits` on new visits. |
| `007_gemini_table.sql` | `gemini_debug_log` (RLS on, no policies; written by `post-message`). |
| `008_problem_solutions.sql` | `problem_solutions` (anon may read published rows only) and `solution_editors` (no policies). |
| `009_editor_links.sql` | `solution_editors.link`, `problem_solutions.author_link`, and the trigger that keeps them in sync. |
| `010_solution_credit.sql` | `problem_solutions.saved_by` (who saved last), so `author` can be the credited editor. Run before deploying the `solutions-admin` that writes it. |

**Tables**

| Table | Purpose |
|---|---|
| `forum_messages` | Forum posts — global or per-problem, reply threading, edit and flag state. Publicly readable. |
| `identities` | Claimed nickname + PIN hash/salt, failed-attempt lockout. |
| `identity_devices` | Links `device_id`s to an identity (multi-device). |
| `forum_flags` | Flag log, used for the per-device rate limit. |
| `site_visits` / `site_device_sightings` | Visit counters (`record-visit`). |
| `device_bans` / `identity_bans` | Rolling red-flag counters and escalating posting bans. |
| `quiz_attempts` / `quiz_attempts_counter` | Synced Random N attempt log + increment-only counters (deleting an attempt never lowers the totals). |
| `solve_all_progress` | Per identity, per quiz, per mode Solve-All status map (`data: null` = reset tombstone). |
| `push_subscriptions` | Web Push subscriptions by device / identity. |
| `device_secrets` | Salted + peppered hash of each device's secret. No policies. |
| `app_variables` | Small cross-invocation state. No policies. |
| `gemini_debug_log` | One row per notable step of an `@gemini` attempt, for diagnosing silent failures. No policies. |
| `problem_solutions` | `problem_key`, `solution`, `figure` (`{ tikz, steps: [{ svg, caption }], scale }`, plus `kind`/`svgSrc`/`svgBox` for SVG figures), `status`, `author` (credited editor), `author_link`, `saved_by` (who saved last), `problem_hash`, `updated_at`. |
| `solution_editors` | Editor name, key hash/salt, link, `revoked_at`. No policies. |

**RPCs**: `get_author_stats(p_author_name)`, `get_unique_participants_count()`,
`get_stats_panel(p_device_id)`, `get_total_quiz_attempts()`,
`get_my_total_quiz_attempts(p_device_id)`.

**Realtime**: Realtime must be enabled for the project. Broadcast (003–006)
needs no publication; the forum's Postgres Changes subscription requires
`forum_messages` to be part of the `supabase_realtime` publication.

---

## Edge functions

All are deployed with auth mode **"publishable"** and **"Verify JWT with legacy
secret" OFF**. Client code never writes to Postgres directly — these functions
stand between the public key and the database. Request bodies carry
`device_id` + `device_secret` (plus the optional tokens below).

| Function | Purpose |
|---|---|
| `post-message.ts` | Post a message: ban check, LaTeX-shorthand conversion, OpenAI moderation, insert; `@gemini` replies; mention/reply push notifications. |
| `edit-message.ts` | Edit an own message (body, scope), re-moderated. |
| `flag-message.ts` | Flag a message: 5 flags per device per hour; Gemini judges only the flagged message (with surrounding context) and any failure keeps it; 3 deletions within 24 h ban the author's device or identity for 24 h, then 48 h, then 72 h. |
| `claim-nickname.ts` | New claim, link another device (PIN), rename (PIN), or no-op; PIN lockout; nickname moderation. |
| `drop-nickname.ts` | Exit this device (the nickname stays claimed); tells the client to drop its identity token. |
| `check-ban.ts` | Whether the calling device/identity is banned. |
| `record-visit.ts` | Log a page visit. |
| `sync-quiz-attempts.ts` | Push/pull attempts. |
| `delete-quiz-attempt.ts` | Delete one synced attempt. |
| `sync-solve-all.ts` | Pull, push or reset (tombstone) Solve-All progress. |
| `save-push-subscription.ts` | Register/remove a Web Push subscription. |
| `solutions-admin.ts` | Everything the editor needs: `whoami`, `editors`, `index`, `get`, `save` (with 409 conflict check), `delete`, `export`; and, with the admin key, `create-editor`, `set-editor-link`, `revoke-editor`. Validates sizes (solution ≤ 60 000 chars, ≤ 12 steps, SVG ≤ 400 000 chars per step, TikZ ≤ 20 000, caption ≤ 500) and rejects SVG containing `<script>`, `<foreignObject>`, `<iframe>`, `<object>`, `<embed>`, `on…=` handlers, `javascript:`, `data:text/html` or `<!ENTITY` before storing; DOMPurify in the browser remains the real defence. |

**Secrets** (Edge Function secrets are project-wide):

| Secret | Used by | Notes |
|---|---|---|
| `OPENAI_API_KEY` | post-message, edit-message, claim-nickname | OpenAI moderation. |
| `GEMINI_API_KEY` | post-message, flag-message | `@gemini`, LaTeX assist, flag review. |
| `PIN_PEPPER` | claim-nickname | Mixed into PIN hashes. `openssl rand -hex 32`. |
| `DEVICE_SECRET_PEPPER` | all nine device-authenticated functions | Mixed into `device_secret` hashes. `openssl rand -hex 32`. |
| `DEVICE_TOKEN_SECRET` | same nine | HMAC key for device/identity tokens. When unset, the functions run in DB-only mode. |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_SUBJECT` | post-message | Web Push signing (`npx web-push generate-vapid-keys`). |
| `SOLUTIONS_KEY_PEPPER` | solutions-admin | Mixed into editor key hashes. `openssl rand -hex 32`. |
| `SOLUTIONS_ADMIN_KEY` | solutions-admin | The owner-only key for editor management. `openssl rand -hex 32`. |

The nine device-authenticated functions are post-message, edit-message,
flag-message, claim-nickname, drop-nickname, sync-quiz-attempts,
delete-quiz-attempt, sync-solve-all and save-push-subscription. `check-ban`
and `record-visit` deliberately need no secret; `solutions-admin` uses editor
keys instead.

---

## Device ownership (`device_secret`) and tokens

**The problem.** `device_id` is public — `forum_messages_public` exposes it on
every message — so trusting it alone would let any forum reader act as another
device: edit or delete their messages, read or wipe their quiz history, post
under their nickname, or log them out.

**`device_secret`.** A second, 32-byte random value is generated once on the
client next to `device_id` (`getForumDeviceSecret()` in `forum.js`) and sent
with every write. The server stores only a salted + `DEVICE_SECRET_PEPPER`-
peppered hash in `device_secrets`. Verification is **trust-on-first-use**: the
first request for a `device_id` registers its secret; later requests must
match (`verifyOrRegisterDevice()`, duplicated in each function). `device_id`
stays public — it is simply no longer sufficient.

Rolling this out to a project that already has users is a race: if an
attacker registers a leaked `device_id` before its real owner, the owner gets
`device_auth_failed` until that row is removed from `device_secrets` by hand.
The backend and the front end are therefore deployed as close together as
possible.

**Tokens** (reduce database and log volume):

- **Device token** — after a successful DB verification, the server returns
  an HMAC-signed `device_token` (`deviceId:expiresAt`, TTL 12 h). While valid,
  it lets the next call skip the `device_secrets` lookup. The secret is still
  sent every time as the fallback.
- **Identity token** — a separate HMAC token for the `device_id → identity_id`
  resolution (TTL 5 min, since an identity can be reassigned on exit/claim).
  `drop-nickname` returns `clear_identity_token`; the client deletes it and
  other open tabs reload through a `storage` event (deferred during a timed
  attempt).

Both are cached in localStorage and refreshed from every write response by
`applyDeviceToken(json)` in `forum.js`.

---

## Gemini integration

**`@gemini` replies** (`callGemini()` in `post-message.ts`):

- Primary model `GEMINI_MODEL_PRIMARY` (`gemini-3.6-flash`), fallback
  `GEMINI_MODEL_FALLBACK` (`gemini-3.5-flash-lite`).
- A **429 with a `PerDay` quota id** on the primary writes a 24 h cooldown to
  `app_variables` (`gemini_post_message_model_disabled_until`) and retries the
  same request on the fallback.
- A **5xx** from the primary writes a 10-minute cooldown
  (`gemini_post_message_overloaded_until`) and goes straight to the fallback;
  a 5xx from the fallback is retried once after 1.5 s.
- `resolveGeminiModel()` reads both keys first, so a model already known to be
  unavailable is skipped; after a cooldown expires the primary is offered again
  automatically.
- When every model fails with an overload-type error, a visible "unavailable"
  notice is posted; configuration errors (400/403/404) stay silent.
- The model receives the tagged message, recent thread context, the problem
  text fetched from `SITE_ORIGIN` and the problem's figure image. It may answer
  `[[NO_REPLY]]` to stay silent (replies to its own messages, hostility).
  Replies pass OpenAI moderation before insertion.
- Each notable step is logged to `gemini_debug_log`.

**LaTeX shorthand assist** (`&…&` / `&&…&&`) and **flag review**
(`flag-message.ts`) are pinned to `gemini-3.5-flash-lite` and are not part of
the fallback.

`SITE_ORIGIN` and `GEMINI_SYSTEM_INSTRUCTIONS` near the top of
`post-message.ts` are course-specific (see [Manual-swap items](#manual-swap-items)).

---

## Client-side storage reference

Course-scoped keys start with `STORAGE_PREFIX` (shown as `<p>`).

| Storage | Key | Contents |
|---|---|---|
| localStorage | `flux_settings` | All settings (not course-prefixed). |
| localStorage | `<p>-theme`, `<p>-color-theme`, `<p>-custom-theme`, `<p>-theme-nudge-shown` | Day/night, preset, custom theme, nudge flag. |
| localStorage | `<p>_stats_v2`, `<p>_po_mode` | Attempt log; Last/Best overview mode. |
| localStorage | `<p>_sa_q…` | Solve-All progress per quiz and mode. |
| localStorage | `<p>_topics_q…`, `<p>_filtermode_q…`, `<p>_numfilter_q…`, `<p>_typefilter_q…` | Problem Pool Filter state per quiz. |
| localStorage | `<p>_forum_device_id`, `<p>_forum_device_secret`, `<p>_forum_device_token`, `<p>_forum_identity_token` | Device identity and tokens. |
| localStorage | `<p>_forum_nickname`, `<p>_forum_pin`, `<p>_forum_display_name`, `<p>_forum_avatar_cache`, `<p>_forum_last_seen_id`, `<p>_forum_pin_*` | Forum identity, avatars, unread tracking. |
| localStorage | `<p>_splash_seen`, `<p>_splash_mandatory_shown`, `<p>-bug-nudge-shown` | Splash and nudge bookkeeping. |
| localStorage | `<p>-editor-key`, `-editor-drafts`, `-editor-history`, `-editor-last`, `-editor-sidebar`, `-editor-split`, `-editor-server-mock` | Editor state (the last one only with `store-mock.js`). |
| sessionStorage | `<p>-solutions-index` | Published-solution index cache. |
| IndexedDB | `mathRenderCache` | Typeset Solve-All problem HTML + CSS. |
| IndexedDB | `flux-notif-mute` | "Go silent" flag for `sw.js`. |
| IndexedDB | `flux-offline-mode` | Offline-mode expiry for `sw.js`. |
| Cache Storage | `CACHE_NAME` (e.g. `phys161-offline-v8`) | offline.html and its assets. |
| Cache Storage | `flux-offline-mode-v1` | Full offline-mode download. |
| BroadcastChannel | `<p>-solve-all-sync` | Same-browser Solve-All coordination. |

---

## Running locally

No build step is needed; the site is static and talks to the remote Supabase
project configured in `js/course-config.js` (there is no local backend).

```bash
# from the repository root
python -m http.server 8000
# or: npx serve .
```

The site is then available at `http://localhost:8000/` and the editor at
`http://localhost:8000/editor/`. The repository root must be the server root:
the editor uses `<base href="/">` and absolute paths.

- `file://` pages do not work: `fetch()` of the JSON files fails and the
  service worker cannot register (it needs `https://` or `localhost`).
- The editor can be run without the database by swapping in
  `editor/store-mock.js` (see [Other editor tools](#other-editor-tools)).

---

## Building for deployment (`minify.py`)

```bash
python minify.py                  # -> ../<folder>-netlify.zip
python minify.py path/to/out.zip  # -> that file
```

The script never writes into the project folder. It copies the site to a
temporary folder, leaving out `.git`, `superbase/`, `README.md`, `*.zip`,
`*.py` and editor/IDE folders, then:

- minifies own `.js` and `.css` with **esbuild** (whitespace, syntax and
  **local** names only — top-level names are never renamed, because files
  share globals, inline handlers call them by name and the editor reads
  `Quiz_N_Problems` by name);
- minifies inline `<script>`/`<style>` in HTML, removes HTML comments and
  indentation (`<pre>`/`<textarea>` untouched);
- compacts `.json` and `.webmanifest`;
- copies `vendor/` unchanged.

Before zipping, it checks that every minified script (including inline ones)
still parses, that every top-level name is still present, and that every JSON
file holds the same data; on any failure nothing is zipped. esbuild is
downloaded once from the npm registry into a per-user cache folder.

---

## Deploying a new course

1. **The repository is duplicated** into a new one for the course (each course
   is a fully separate repository/site, not a branch).
2. **A new Supabase project is created**, Realtime is enabled, and every file
   in `superbase/migrations/` is run **in order** (000 → 009).
   `forum_messages` is added to the `supabase_realtime` publication.
3. **The Edge Functions are deployed** from `superbase/edge-functions/` with the
   auth settings above, and the project's secrets are set: `OPENAI_API_KEY`,
   `GEMINI_API_KEY`, `PIN_PEPPER`, `DEVICE_SECRET_PEPPER`,
   `DEVICE_TOKEN_SECRET`, `SOLUTIONS_KEY_PEPPER`, `SOLUTIONS_ADMIN_KEY`, and a
   fresh `VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY`/`VAPID_SUBJECT` triple.
4. **`post-message.ts` is edited** in the new project's copy: `SITE_ORIGIN` and
   `GEMINI_SYSTEM_INSTRUCTIONS` (both marked
   `⚠ COURSE-SPECIFIC — MANUAL EDIT AT RELEASE`).
5. **`js/course-config.js` is filled in** for the course: `storagePrefix`,
   `supabase.url`, `supabase.publishableKey`, `pushVapidPublicKey` (public half
   from step 3), `quizSettings`, `pinnedMessageId` (once a welcome post exists
   in the new forum), a unique `changelogScope`, and `display`.
6. **The contents of `course/` are replaced** with the course's quizzes,
   images, splashes, manual, offline laws and preview image.
7. **`data-course` is set** on `<head>` in `index.html`, `offline.html` and
   `editor/index.html`. This fixes the title and eyebrow labels; the static
   `<title>` and meta tags in `index.html` are edited by hand to match
   `display` (see below).
8. **`CACHE_NAME` in `sw.js` is changed** to the new course's prefix.
9. **The site is built** with `python minify.py` and deployed to Netlify as a
   new site with its own domain; `og:url` in `index.html` and `SITE_ORIGIN` in
   `post-message.ts` are updated once the domain is known.
10. **Editor keys are created** with `create-editor` (see
    [Managing editor keys](#managing-editor-keys)). Keys from another course's
    project do not work.

---

## Manual-swap items

Some course-specific values cannot be driven by `js/course-config.js`, because
they live where it is not available. Each is marked with a comment at its
location.

| Item | File | Why it cannot be centralized |
|---|---|---|
| `data-course` | `index.html`, `offline.html`, `editor/index.html` | It is the switch itself. |
| `<title>`, `og:title`, `og:description`, `og:url`, `twitter:title`, `twitter:description` | `index.html` `<head>` | `course-config.js` updates them in the browser, but link-preview crawlers (Telegram, Discord, WhatsApp, Slack, X, Facebook) read raw HTML and never run JavaScript. The values are duplicated, not shared, with `display` in `course-config.js`. `og:image`/`twitter:image` (`course/preview.png`) need no change. |
| `CACHE_NAME` | `sw.js` | A service worker has no `document` and cannot read `data-course`. |
| `SITE_ORIGIN`, `GEMINI_SYSTEM_INSTRUCTIONS` | `superbase/edge-functions/post-message.ts` | Edge Functions run in the Supabase Deno runtime and cannot import browser files. |

---

## Versioning

On every release the version is bumped in **three places**:

1. `js/data/changelog.js` — a new entry at the top
   (`{ version, note, scope }`; indentation is derived from the version).
2. `version.json`.
3. `CURRENT_VERSION` in `js/quiz-engine.js`.

The running site polls `version.json` and shows the update banner when it
differs from `CURRENT_VERSION`; the editor's version label turns red when
`version.json` changes after the editor was loaded. When `PRECACHE_URLS` in
`sw.js` changes, `CACHE_NAME` is bumped as well, and a change to Solve-All card
markup or the render pipeline requires bumping `MATH_CACHE_SCHEMA` in
`js/math-cache.js`.
