# Flux — Physics Practice Quiz Platform

Flux is a solo-built, vanilla-JS practice quiz platform for university physics
courses. It started as one HTML file with six random problems for a PHYS 161
summer term and grew into a full multi-mode quiz app with theming, cross-device
stats, a moderated class forum with an AI participant, a searchable manual, and
offline support — no framework, no build step, no bundler.

This repo is the **framework**: one course's content (currently PHYS 161) lives
inside it in a way that's designed to be swapped out wholesale, so the same
codebase can be redeployed for a different course (PHYS 162, etc.) as its own
separate site with its own database. See [Deploying a new course](#deploying-a-new-course)
for exactly how.

> Live site: https://phys161.netlify.app

---

## Table of contents

- [How it's built](#how-its-built)
- [Project structure](#project-structure)
- [The multi-course architecture](#the-multi-course-architecture)
  - [`course/` — swap this wholesale](#course--swap-this-wholesale)
  - [`js/course-config.js` — the live switch](#jscourse-configjs--the-live-switch)
  - [What's still framework (shared)](#whats-still-framework-shared)
- [How each subsystem works](#how-each-subsystem-works)
- [Database (Supabase)](#database-supabase)
- [Edge functions](#edge-functions)
- [Device ownership (device_secret)](#device-ownership-device_secret)
- [Gemini model fallback (post-message.ts)](#gemini-model-fallback-post-messagets)
- [Running it locally](#running-it-locally)
- [Deploying a new course](#deploying-a-new-course)
- [Manual-swap items (can't be centralized)](#manual-swap-items-cant-be-centralized)
- [Versioning](#versioning)

---

## How it's built

- **No framework, no build step.** Plain HTML/CSS/JS, loaded as a stack of
  `<script>` tags in `index.html`, in a deliberate dependency order (see
  comments in `index.html` itself).
- **Supabase** for the forum, stats sync, and push notifications — Postgres +
  Row Level Security + Edge Functions (Deno/TypeScript), called directly from
  the browser with a public, RLS-restricted "publishable" key.
- **Netlify** for static hosting.
- **MathJax** (STIX Two font, vendored locally in `vendor/mathjax/`) for LaTeX
  rendering, with a persistent IndexedDB render cache for solve-all mode.
- **A service worker** (`sw.js`) for one narrow purpose: showing a real
  offline page instead of the browser's default "no internet" screen.

There's no `package.json`, no `npm install`, no dev server requirement beyond
"serve these static files" — see [Running it locally](#running-it-locally).

---

## Project structure

```
flux/
├── index.html              Main app shell — the quiz UI, landing screen,
│                            forum/stats/manual panels, and the full
│                            <script> load order (read its comments first)
├── offline.html             Fallback page shown by sw.js when there's no
│                            connection — a standalone page, not a route
├── sw.js                    Service worker: offline-page fallback + Web
│                            Push notification display/click handling
├── version.json              { "version": "X.Y.Z" } — read by
│                            quiz-engine.js's update-checker
│
├── course/                  ★ Everything specific to the currently-deployed
│   │                          course. See "The multi-course architecture".
│   ├── course.json          Historical/stale — used to be a manual
│   │                        copy-paste reference for title/OG/Twitter/
│   │                        eyebrow text. That's now automated (see
│   │                        js/course-config.js's `display` field);
│   │                        editing this file does nothing.
│   ├── quizzes/
│   │   ├── quiz1.js .. quiz4.js   Problem banks (one file per quiz set)
│   │   └── quizzes.js       Registry wiring each quiz's name + enabled
│   │                        flag to its problem array (QUIZZES global)
│   ├── splashes.json        Minecraft-style main-menu splash text pool
│   ├── manual.json          User manual content (sections/subsections)
│   ├── offline-laws.json    Physics "law of the moment" shown on offline.html
│   ├── preview.png          Open Graph / Twitter card preview image
│   └── images/quiz_3/       Figure images referenced from quiz3.js problems
│
├── js/                       ★ Framework code — identical across every
│   │                          course deployment (nothing course-specific
│   │                          left here except manual-swap exceptions noted
│   │                          below).
│   ├── course-config.js      ⚡ Loads FIRST. Reads <head data-course="...">,
│   │                        exposes STORAGE_PREFIX / SUPABASE_URL /
│   │                        SUPABASE_PUBLISHABLE_KEY / PUSH_VAPID_PUBLIC_KEY
│   │                        for the active course. See below.
│   ├── banner-manager.js    Priority queue for the bottom notification
│   │                        banners (update / bug-report / theme-nudge)
│   ├── theme-colors.js      Reads live CSS custom properties into JS, so
│   │                        canvas/JS-drawn UI (confetti, π-day egg) stays
│   │                        in sync with the active color theme
│   ├── themes.js             Color theme picker, custom theme builder,
│   │                        day/night mode, one-time theme nudge
│   ├── splash.js             Fetches course/splashes.json, rolls a splash
│   │                        line on the landing screen
│   ├── easter.js             Pi Day / Pi Hour easter egg
│   ├── data/changelog.js    Changelog entries (shared across courses — this
│   │                        is the *platform's* dev history, not physics
│   │                        content, so it stays in js/ not course/)
│   ├── changelog.js          Changelog panel UI + a small "field lines"
│   │                        cursor toggle
│   ├── stats.js              Local attempt log (Random 6 mode), synced to
│   │                        a claimed forum identity
│   ├── stats-export.js       Stats screen export: CSV / TXT / Excel / PDF
│   ├── attempts-sync.js      Push/pull quiz attempts to/from Supabase
│   │                        (sync-quiz-attempts Edge Function)
│   ├── solve-all-sync.js    Cross-device sync for Solve-All progress
│   │                        (union-merge, not last-write-wins)
│   ├── math-cache.js        IndexedDB cache of pre-typeset MathJax output,
│   │                        keyed by a hash of each problem's LaTeX source
│   ├── math-render.js       Thin renderMathIn(el) wrapper around MathJax
│   ├── quiz-engine.js        The quiz engine itself: Practice mode, Solve
│   │                        Them All mode, Moodle-style number parsing,
│   │                        unit algebra/conversion, version-update banner
│   ├── fig-attribution.js   Tap-to-toggle (i) badges on figure images
│   ├── site-visits.js        Fires once per page load → record-visit
│   │                        Edge Function (feeds "Total visits" stat)
│   ├── forum.js              The class forum: read-only feed rendering,
│   │                        posting (via Edge Function, never direct
│   │                        .insert()), nicknames/PINs, replies, mentions,
│   │                        moderation UI, avatar caching
│   ├── push-notifications.js Web Push subscribe/unsubscribe UI for forum
│   │                        @mentions
│   └── manual.js              User manual browser (fetches course/manual.json)
│
├── css/
│   ├── style.css              Core UI: quiz cards, landing screen, theme
│   │                        presets (body[data-theme="x"] blocks), fonts
│   ├── forum.css              Forum screen (mirrors stats.css structurally)
│   ├── stats.css              Stats dashboard screen
│   └── manual.css             User manual screen
│
├── images/                   Framework-level images (NOT course-specific)
│   ├── gemini-logo.svg        Gemini bot avatar in the forum
│   └── offline/{dark,light}.png   offline.html illustration, both themes
│
├── favicon/                   Standard favicon set + site.webmanifest
│                            ("Flux" branding — shared across courses)
│
├── vendor/                    Vendored third-party libraries (no CDN
│                            dependency for these): MathJax, jsPDF, SheetJS,
│                            fonts
│
└── superbase/                 [sic — matches the folder name in this repo]
    │                          Everything for the Supabase backend. This
    │                          folder describes ONE Supabase project — the
    │                          currently-deployed course's. A new course
    │                          gets its own project built from the same
    │                          files, then course-specific edits (see
    │                          "Manual-swap items" below).
    ├── database.sql            Old context-only schema dump — superseded by
    │                          migrations/000, kept only for reference
    ├── migrations/              A single consolidated SQL file
    │                          (000_initial_schema_consolidated.sql) that
    │                          builds the entire database — tables, indexes,
    │                          view, functions, trigger, and RLS — in one
    │                          run against a fresh Supabase project
    ├── edge-functions/          Deno/TypeScript Edge Functions — see
    │                          "Edge functions" below for what each does
    └── schema-phys162.png      Reference screenshot of phys162's schema
```

---

## The multi-course architecture

**The model:** this repo is deployed once per course, each time as a
completely separate Netlify site + Supabase project + (eventually) separate
GitHub repo. Work on one course's copy, and when it's time to release a
different course, copy the `course/` folder's contents from that course,
hand-edit a small, well-marked set of header values, and redeploy. The
release step is manual and copy-based rather than templated at build time.

### `course/` — swap this wholesale

Everything in `course/` is real content that differs between courses:
problem banks, splash text, the manual, the offline-page law list, the OG
preview image, and course-specific images. To release a different course,
this entire folder's *contents* (quizzes, splashes, manual, offline-laws,
preview image, course images) get replaced with that course's versions.

`course/course.json` is **stale/historical** for the eyebrow labels — those
are pure in-page text with no crawler involved, so `js/course-config.js`'s
`display.courseCode` now drives them completely automatically; don't bother
keeping course.json's eyebrow fields in sync.

Title/OG/Twitter text is a different story: `course-config.js` also updates
those live in-browser, but that update is invisible to link-preview
crawlers (Telegram, Discord, WhatsApp, Slack, X, Facebook), which fetch raw
HTML and never run JavaScript. So the static `<title>`/`<meta>` block in
`index.html`'s `<head>` still needs its 9 lines hand-edited at release time
to match that course's `display` values — see the `⚠ EDIT THESE 9 LINES BY
HAND` comment right above that block, and the [Manual-swap
items](#manual-swap-items-cant-be-centralized) table.

### `js/course-config.js` — the live switch

This is the one framework file that's aware of multiple courses at once, and
it's the only place real secrets differ per course:

```js
const COURSES = {
  phys162: {
    storagePrefix: 'phys162',
    supabase: { url: '...', publishableKey: '...' },
    pushVapidPublicKey: '...',
    quizSettings: { size: 6, cumulativePrevCount: 3 },
    pinnedMessageId: 336,
    display: {
      courseCode: 'PHYS162',
      ogDescription: '...',
      twitterDescription: '...',
      siteUrl: 'https://your-domain.com/PHYS162_Practice_Quiz.html',
    },
  },
  phys161: {
    storagePrefix: 'phys161',
    supabase: { url: '...', publishableKey: '...' },
    pushVapidPublicKey: '...',
    quizSettings: { size: 6, cumulativePrevCount: 3 },
    pinnedMessageId: 2,
    display: {
      courseCode: 'PHYS161',
      ogDescription: '...',
      twitterDescription: '...',
      siteUrl: 'https://your-domain.com/PHYS161_Practice_Quiz.html',
    },
  },
};
```

It reads `document.head.dataset.course` — set via `<head data-course="phys162">`
at the very top of both `index.html` and `offline.html` — and exposes seven
globals every other framework file reads instead of hardcoding:

| Global | Used for |
|---|---|
| `STORAGE_PREFIX` | Every localStorage key and BroadcastChannel name across the app (`themes.js`, `splash.js`, `stats.js`, `forum.js`, `quiz-engine.js`, etc.) — was hardcoded `'phys162_...'` everywhere before this existed |
| `SUPABASE_URL` / `SUPABASE_PUBLISHABLE_KEY` | Every Supabase call (forum, stats sync, push) |
| `PUSH_VAPID_PUBLIC_KEY` | Web Push subscription (`push-notifications.js`) — each Supabase project has its own VAPID keypair |
| `QUIZ_SIZE` | How many problems a "Random N" draw pulls (`quiz-engine.js`'s `newQuiz()`) — was hardcoded `6` everywhere before this existed. Also drives the "🎯 Random N" landing-page label and the two stats-panel empty-state strings, so those stay correct without separate edits. |
| `QUIZ_CUMULATIVE_PREV_COUNT` | Of `QUIZ_SIZE`, how many come from the *previous* quiz when cumulative mode is on — was hardcoded `3` (i.e. half of 6). The remainder (`QUIZ_SIZE - QUIZ_CUMULATIVE_PREV_COUNT`) comes from the current quiz. Must be `<= QUIZ_SIZE`; course-config.js logs a console error if a course's entry violates that. |
| `FORUM_PINNED_MESSAGE_ID` | The `forum_messages` row id shown pinned at the top of the forum (`forum.js`'s `renderForumPinnedBanner`) — was hardcoded `336` everywhere before this existed. Each course's Supabase project has its own forum with its own welcome post at a different row id, so there's no sane cross-course default; course-config.js logs a console error if a course's entry omits it, since the pinned banner just silently stays hidden otherwise. |
| `COURSE_CHANGELOG_SCOPE` | Filters `js/data/changelog.js`'s `CHANGELOG` entries in `js/changelog.js`'s `renderChangelog()` — see "Per-course changelog filtering" below. Fails open (shows every entry, unfiltered) if a course's entry omits it, rather than silently hiding everything. |
| `COURSE_CODE` / `COURSE_TITLE` | Sets `document.title` and the 4 "eyebrow" labels (`PHYS162 · Practice Mode`, etc.) at load — fully automatic, no crawler involved. Also live-updates the `og:title`/`twitter:title`/`og:description`/`twitter:description`/`og:url` meta tags for anyone who loads the page with JS, but that does NOT reach link-preview crawlers (they fetch raw HTML, no JS) — the static block in `index.html`'s `<head>` still needs hand-editing at release, see [Manual-swap items](#manual-swap-items-cant-be-centralized). `og:image`/`twitter:image` are left as plain static tags since the relative path (`course/preview.png`) is the same for every course. |

A course whose `quizSettings` is missing falls back to phys162's values (6, 3)
rather than producing NaN-length quizzes — but every course should set its
own explicitly rather than relying on that fallback. `pinnedMessageId` has no
such fallback (there's no meaningful "default" pinned message across
courses) — omitting it just means the banner won't show until it's set.

It's loaded as the very first external `<script>` — before `banner-manager.js`
— because `themes.js`/`splash.js`/`easter.js` read `STORAGE_PREFIX` immediately
at load time, not lazily.

**To release a new course:** fill in that course's block in `COURSES`
(Supabase URL/key, VAPID public key, quiz size/cumulative-prev-count), then
flip the `data-course` attribute on both HTML files' `<head>`.

### `js/data/changelog.js` — per-course changelog filtering

Every entry has a `scope`: `0` means "show for every course". Any other
value must match a course's own `changelogScope` id
(`js/course-config.js` — currently `phys162: 2`, `phys161: 1`) to be shown
at all for that course. `js/changelog.js`'s `renderChangelog()` does the
filtering at render time — the underlying array is never modified, so
switching `data-course` is enough to see a different course's history with
no rebuild step.

When one or more consecutive entries get filtered out between two entries
that ARE visible, a clickable "⋯ N updates for another course ⋯" pill
(`.changelog-gap` in `css/style.css`) is shown in their place — a `<button>`
styled deliberately unlike a real `.changelog-row` (dashed border, pill
shape, centered) so it never reads as an actual entry. Hovering (or
focusing) swaps its label entirely to "⋯ tap to reveal anyway ⋯" via two
overlapping spans (`.changelog-gap-label-rest` / `-hover`), rather than
adding text alongside what's already there. Clicking reveals ONLY that
specific run of hidden entries, in place — each gap holds its own
collapsed `.changelog-hidden-group` container and its own click handler,
so revealing one gap never affects any other gap elsewhere in the list.
It's never shown at the very top or bottom of the list — only strictly
between two visible entries.

Version-number indentation (`computeLevels()`) is still computed from the
FULL unfiltered array, not the per-course visible subset — so a course
that's missing a given major/minor version (because those entries were
scoped to the other course) doesn't get its indentation levels
recalculated as if that gap didn't exist. This holds true whether or not
a given gap has actually been revealed yet, since the hidden rows (and any
separators among them) are built once up front, just started collapsed.
The version badge on the changelog button also reads the latest *visible*
entry's version, not always `CHANGELOG[0]` — otherwise a course could show
a version number in that badge that never actually appears anywhere in
its own filtered list.

All 145 pre-existing entries (from before per-course scoping existed) were
retroactively tagged: `2` (PHYS162-only) for anything about actual quiz
content — specific problems, figures/illustrations, per-quiz corrections —
since PHYS162 was the only course this repo ever held content for until
now; `0` (both) for everything about the framework/app itself (forum,
stats, themes, UI, cross-device syncing, etc.), since none of that depends
on which course's problems happen to be loaded. No entry currently uses
`scope: 1` (phys161-only) — that history starts empty and grows from
whatever changes are made after phys161 actually exists.

### What's still framework (shared)

Everything in `js/` other than `course-config.js`, all of `css/`, the
generic images (`images/gemini-logo.svg`, `images/offline/`), and
`favicon/` are identical across every course deployment. `js/data/changelog.js`
also stays framework-side — it's the *platform's* build history, not physics
content, so it isn't course data.

---

## How each subsystem works

**Quiz engine** (`quiz-engine.js`) — Two modes: Practice (Random 6, one quiz
at a time or cumulative) and Solve Them All. Numeric answers are parsed with
Moodle-compatible rules (`parseMoodleNumber`) and checked with a unit-algebra
conversion layer, so `3000 m` and `3 km` both validate against an accepted
unit list per problem.

**Theming** (`themes.js` + `theme-colors.js` + CSS custom properties in
`style.css`) — Presets are CSS blocks (`body[data-theme="x"]`); the picker UI
and a custom-theme builder (auto-derives surface/border/muted/accent-dim from
just bg + text) live in JS. `theme-colors.js` reads the *live computed*
values of CSS variables so JS-drawn UI (canvas confetti, the π-day egg)
follows theme changes automatically instead of duplicating hex codes.

**Math rendering** (`math-render.js` + `math-cache.js`) — MathJax (STIX Two,
vendored) handles inline `$...$` / display `$$...$$` LaTeX. Solve-All mode
caches typeset output in IndexedDB keyed by a hash of each problem's source
text, so a repeat visit skips MathJax entirely for unchanged problems.

**Splash text** (`splash.js` + `course/splashes.json`) — Minecraft-style
rotating splash line under the site title. Each entry is `[text, condition,
mandatory]`; conditions gate on time-of-day/pi-time/etc.

**Stats** (`stats.js` + `stats-export.js` + `attempts-sync.js`) — Local
attempt log for Random 6 mode, exportable as CSV/TXT/Excel/PDF. Once a forum
identity is claimed, `attempts-sync.js` pushes/pulls attempts to Supabase
(`sync-quiz-attempts` Edge Function) — localStorage becomes a cache/queue,
not the source of truth.

**Solve-All sync** (`solve-all-sync.js`) — Same identity-linked sync model as
stats, but progress is a mutable per-problem status map, not an append-only
log, so cross-device merges are a union (keep whichever side "solved more"
per problem) instead of last-write-wins.

**Forum** (`forum.js`) — Read-only feed rendered client-side from
`forum_messages` via the RLS-restricted publishable key. All writes (post,
edit, flag, claim/drop nickname) go through Edge Functions, never a direct
`.insert()`. Includes nicknames + 5-digit PINs, `@mention` popups, replies,
DiceBear identicon avatars (cached), and an AI participant (`@gemini`,
OpenAI-moderated before posting, Gemini-generated) — see `post-message.ts`.

**Push notifications** (`push-notifications.js` + `sw.js`'s `push`/
`notificationclick` handlers) — Web Push subscription for forum @mentions.
Sending happens server-side in `post-message.ts`; the service worker only
displays the notification and routes a tap back into the right thread.

**Manual** (`manual.js` + `course/manual.json`) — Collapsible docs tree,
structurally mirrors the Forum/Stats screens. Content is plain HTML strings
with inline LaTeX, rendered through the same `renderMathIn()` helper.

**Offline support** (`sw.js` + `offline.html`) — Narrow-purpose service
worker: shows `offline.html` (with its own theme-matched illustration and a
random "law of the moment" from `course/offline-laws.json`) instead of the
browser's default offline screen. Does **not** cache the rest of the app for
full offline use.

**Changelog** (`js/changelog.js` + `js/data/changelog.js`) — Version bump
requires updating three places: `js/data/changelog.js`, `version.json`, and
`CURRENT_VERSION` in `quiz-engine.js` (the update-checker compares the
running page's version against `version.json` to show the update banner).

---

## Database (Supabase)

Schema is Postgres + Row Level Security. The database is built by running the
`superbase/migrations/` files **in order** against a fresh Supabase project:
`000_initial_schema_consolidated.sql` (the entire original schema — every
table, index, view, function, trigger, and RLS policy, reconstructed and
verified directly against the live phys162 database, not derived from
guesswork), then `001_device_secrets.sql` and `002_app_variables.sql` (both
additive — see [Device ownership](#device-ownership-device_secret) and
[Gemini model fallback](#gemini-model-fallback-post-messagets) for why each
exists). `superbase/database.sql` is an old context-only dump kept for
reference; it's superseded by the migration files and was never meant to be
run directly.

Core tables (see each migration file for exact columns):

| Table | Purpose |
|---|---|
| `forum_messages` | Forum posts — global or per-problem, with reply threading and edit/flag state |
| `identities` | Claimed nickname + PIN-hash identities |
| `identity_devices` | Links a device_id to a claimed identity (multi-device support) |
| `forum_flags` | Moderation flag queue |
| `site_visits` / `site_device_sightings` | Visit counters (record-visit.ts) |
| `device_bans` / `identity_bans` | Moderation bans |
| `quiz_attempts` / `quiz_attempts_counter` | Synced Random 6 attempt log + persistent counters |
| `solve_all_progress` | Per-identity, per-quiz solved-problem status map |
| `push_subscriptions` | Web Push subscriptions, keyed by device_id / identity_id |
| `device_secrets` | Salted+peppered secret paired with each device_id, proving device ownership — see [Device ownership](#device-ownership-device_secret) |
| `app_variables` | General-purpose key/value store for small state that needs to survive across Edge Function calls — see [Gemini model fallback](#gemini-model-fallback-post-messagets) |

---

## Edge functions

All deployed with auth mode **"publishable"**, **"Verify JWT with legacy
secret" OFF**, unless noted. Client code never calls Postgres directly for
writes — everything below is what stands between the public key and the
database.

| Function | Purpose | Secrets used |
|---|---|---|
| `post-message.ts` | Post a forum message — OpenAI moderation, then insert; handles `@gemini` replies (with automatic model fallback, see below) and sends mention push notifications | `OPENAI_API_KEY`, `GEMINI_API_KEY`, `VAPID_PRIVATE_KEY`/`VAPID_PUBLIC_KEY`/`VAPID_SUBJECT`, `DEVICE_SECRET_PEPPER` |
| `edit-message.ts` | Edit an existing message (own messages only) | `OPENAI_API_KEY`, `DEVICE_SECRET_PEPPER` |
| `flag-message.ts` | Flag a message for moderation review | `GEMINI_API_KEY`, `DEVICE_SECRET_PEPPER` |
| `claim-nickname.ts` | Claim a nickname + PIN (v2, multi-device identities) | `PIN_PEPPER`, `DEVICE_SECRET_PEPPER` |
| `drop-nickname.ts` | Release a claimed nickname (v4, exit-only) | `PIN_PEPPER`, `DEVICE_SECRET_PEPPER` |
| `check-ban.ts` | Check whether the calling device/identity is banned | — |
| `record-visit.ts` | Log a page visit for the site-visits counters | — |
| `sync-quiz-attempts.ts` | Push/pull local quiz attempts to/from the server | `DEVICE_SECRET_PEPPER` |
| `delete-quiz-attempt.ts` | Delete a single synced attempt | `DEVICE_SECRET_PEPPER` |
| `sync-solve-all.ts` | Pull + union-merge + push Solve-All progress | `DEVICE_SECRET_PEPPER` |
| `save-push-subscription.ts` | Register/remove a Web Push subscription | `DEVICE_SECRET_PEPPER` |

`PIN_PEPPER` is an extra secret input mixed into the PIN hash (on top of
normal salted hashing) so PIN hashes can't be brute-forced offline even with
full database access. `DEVICE_SECRET_PEPPER` is the equivalent for
`device_secret` — see [Device ownership](#device-ownership-device_secret)
for what it protects against and why nine of the eleven functions above
need it and two (`check-ban.ts`, `record-visit.ts`) deliberately don't.

---

## Device ownership (`device_secret`)

**The problem.** Every write endpoint used to trust `device_id` alone as
proof of "this request came from that device" — taken straight from the
request body, no session, no signature. That would have been fine if
`device_id` were secret, but it isn't: `forum_messages_public` exposes it on
every message (the front end needs it client-side), so any reader of the
forum could copy another user's `device_id` out of the network response and
then call `edit-message`, `drop-nickname`, `delete-quiz-attempt`,
`sync-quiz-attempts`, `sync-solve-all`, `post-message`, `flag-message`,
`claim-nickname`, or `save-push-subscription` *as* that device — editing or
deleting their messages, reading or wiping their quiz history, posting under
their claimed nickname, or logging out their device, all without needing
their PIN (PIN only ever gated `claim-nickname`'s link/rename paths).

**The fix.** `device_secret` — a second, 32-byte random value generated once
on the client alongside `device_id` and stored next to it in `localStorage`
(`getForumDeviceSecret()` in `forum.js`) — is now required on every one of
those nine endpoints. The server only ever stores a salted +
`DEVICE_SECRET_PEPPER`-peppered hash of it (`device_secrets` table, migration
`001_device_secrets.sql`), the same hashing shape `claim-nickname.ts` already
used for PINs, applied to a different problem.

Verification is **trust-on-first-use (TOFU)**: the first request ever seen
for a given `device_id` registers whatever `device_secret` came with it as
that device's secret; every later request for the same `device_id` must
match it (`verifyOrRegisterDevice()`, duplicated per-function rather than
shared-imported — see that helper's comment in each file for why). There's
no separate "register" endpoint; registration happens naturally on a
device's first real action. `device_id` itself stays public — the fix isn't
hiding it, it's making it insufficient on its own.

**Deploying this to an existing project:** run `001_device_secrets.sql`,
set `DEVICE_SECRET_PEPPER` (`openssl rand -hex 32`) as an Edge Function
secret, then redeploy the nine functions listed above and the front end
together, as close in time as practical. Every device that visits after the
front-end deploy registers its own secret automatically on its first
request — no PIN, no re-login, nothing the user has to do. The one thing to
know: this is a race, not an instant fix — if an attacker already has a
`device_id` (leaked before the deploy) and manages to send a request with
their own `device_secret` before the real device does, TOFU registers the
*attacker's* secret for that `device_id`, and the real device gets
`device_auth_failed` from then on (not just "until it visits again" — the
mismatch is permanent until someone manually clears that row from
`device_secrets`). Deploying backend and frontend close together minimizes
this window; it can't be eliminated by any amount of care in the code
itself, only shortened.

---

## Gemini model fallback (`post-message.ts`)

The `@gemini` reply feature (`callGemini()` in `post-message.ts` — not the
LaTeX-shorthand assist, which stays pinned to `gemini-3.5-flash-lite`
always, nor `flag-message.ts`'s moderation model, same reasoning) defaults
to `gemini-3.6-flash` and falls back to `gemini-3.5-flash-lite` for 24 hours
after `gemini-3.6-flash` hits its **daily** (RPD) quota specifically — not a
per-minute throttle, which this forum's traffic isn't expected to hit.

Since an Edge Function has no memory between invocations, the 24h cooldown
is tracked in `app_variables` (migration `002_app_variables.sql`, a
general-purpose key/value table meant for exactly this kind of small
cross-invocation state) under the key
`gemini_post_message_model_disabled_until`. Flow:

1. `resolveGeminiModel()` reads that key. If its timestamp is still in the
   future, skip straight to `gemini-3.5-flash-lite` — no wasted request
   against a model already known to be exhausted for the day.
2. Otherwise try `gemini-3.6-flash` first. If that specific call comes back
   429 with a `quotaId` containing `PerDay` (checked via
   `isDailyQuotaExhausted()` — any other error, including a per-minute
   429, is left alone), write `now + 24h` to `app_variables` and
   **immediately retry the same request** on `gemini-3.5-flash-lite`, so
   the user still gets a reply rather than silently getting none.
3. After 24h, `resolveGeminiModel()` naturally starts offering
   `gemini-3.6-flash` again — no separate reset step.

If `gemini-3.6-flash`'s exact model string ever changes (or differs from
what's configured in the Google AI Studio account actually in use), it's
the sole value to update: `GEMINI_MODEL_PRIMARY` near the top of
`post-message.ts`.

---

## Running it locally

No build step — this is a static site plus a remote Supabase backend.

```bash
# from the repo root
python3 -m http.server 8000
# or: npx serve .
```

Then open `http://localhost:8000`. The forum/stats/push features will talk to
whatever Supabase project is configured for the active course in
`js/course-config.js` — there's no local/mock backend.

Service worker note: `sw.js` only activates over `https://` or `localhost` —
a plain `file://` open won't register it, so use the local server above if
you need to test offline behavior.

---

## Deploying a new course

1. **Duplicate the repo** into a new one for the new course (this repo's
   design assumes each course is a fully separate repo/site, not a branch).
2. **Stand up a new Supabase project.** Run all three files in
   `superbase/migrations/` **in order** — `000_initial_schema_consolidated.sql`
   (the entire base schema, verified to match the live phys 161 project
   exactly), then `001_device_secrets.sql`, then `002_app_variables.sql`
   (both additive — see [Device ownership](#device-ownership-device_secret)
   and [Gemini model fallback](#gemini-model-fallback-post-messagets)).
3. **Deploy the Edge Functions** in `superbase/edge-functions/` to that
   project, same auth-mode settings noted in each file's header comment. Set
   its secrets: `OPENAI_API_KEY`, `GEMINI_API_KEY`, `PIN_PEPPER`,
   `DEVICE_SECRET_PEPPER` (`openssl rand -hex 32`, same shape as
   `PIN_PEPPER` — see [Device ownership](#device-ownership-device_secret)),
   and a fresh `VAPID_PRIVATE_KEY`/`VAPID_PUBLIC_KEY`/`VAPID_SUBJECT` triple
   (e.g. via `npx web-push generate-vapid-keys`).
4. **Edit `superbase/edge-functions/post-message.ts` by hand** in the new
   project's copy — `SITE_ORIGIN` and `GEMINI_SYSTEM_INSTRUCTIONS` are
   course-specific and can't be centralized (Edge Functions run in a separate
   Deno runtime with no access to `course-config.js`). Both are marked
   `⚠ COURSE-SPECIFIC — MANUAL EDIT AT RELEASE` in that file.
5. **Fill in `js/course-config.js`**: add (or fill in) that course's entry in
   `COURSES` — `storagePrefix`, `supabase.url`, `supabase.publishableKey`,
   `pushVapidPublicKey` (the public half from step 3), `quizSettings`
   (`size`, `cumulativePrevCount`) if this course's exam structure differs
   from the default (6 problems per quiz, 3 from the previous quiz in
   cumulative mode), `pinnedMessageId` (the row id of this course's own
   welcome post in its own `forum_messages` table, once you've posted one),
   `changelogScope` (a unique numeric id — currently `2` is taken by
   phys162 — for filtering `js/data/changelog.js`'s history to this
   course, see "Per-course changelog filtering"), and `display`
   (`courseCode`, `ogDescription`, `twitterDescription`, `siteUrl`) — the
   source of truth for step 7 below.
6. **Replace the contents of `course/`** with the new course's quizzes,
   splashes, manual, offline-laws, preview image, and images.
7. **Set `data-course` on `<head>`** in both `index.html` and `offline.html`
   to the new course's key. This alone now fixes the page `<title>` and the
   four eyebrow labels. It does NOT fix the static OG/Twitter `<meta>`
   block in `index.html`'s `<head>` — hand-edit those 9 lines to match
   step 5's `display` values too (see the `⚠ EDIT THESE 9 LINES BY HAND`
   comment right there, and [Manual-swap
   items](#manual-swap-items-cant-be-centralized) for why JS can't cover
   it: link-preview crawlers never execute JavaScript).
8. **Bump `sw.js`'s `CACHE_NAME`** to the new course's prefix by hand (see
   [Manual-swap items](#manual-swap-items-cant-be-centralized) — this is the
   one thing a service worker can't read from `data-course` itself).
9. **Deploy to Netlify** as a new site pointed at the new repo, with its own
   domain. Update `og:url` in `index.html` and `SITE_ORIGIN` in
   `post-message.ts` to match once you know it.

---

## Manual-swap items (can't be centralized)

A few things are genuinely course-specific but structurally can't be driven
by `js/course-config.js`, because they run somewhere that has no access to
it (a separate Deno runtime, or a DOM-less service worker scope). These are
called out with comments at each location so they're never a silent gap:

| Item | File | Why it can't be centralized |
|---|---|---|
| `CACHE_NAME` | `sw.js` | Service workers have no `document` — can't read the `data-course` attribute |
| `SITE_ORIGIN`, `GEMINI_SYSTEM_INSTRUCTIONS` | `superbase/edge-functions/post-message.ts` | Edge Functions deploy into their own Supabase-project Deno runtime, not the browser — can't import `course-config.js` |
| The 9 `<meta property="og:...">` / `<meta name="twitter:...">` tags (+ `<title>`) | `index.html`'s `<head>` | `course-config.js` DOES update these live in-browser (see `_setMetaContent`) — but link-preview crawlers (Telegram, Discord, WhatsApp, Slack, X, Facebook) fetch raw HTML and never execute JavaScript, so that update never reaches them. The static text has to already be correct, or shared links show the wrong course. |

---

## Versioning

Bump the version in **three places** on every release: `js/data/changelog.js`
(add an entry — indentation is derived automatically from major/minor/patch),
`version.json`, and `CURRENT_VERSION` in `js/quiz-engine.js`. The running
page polls `version.json` and shows the update banner (`banner-manager.js`)
when it drifts from `CURRENT_VERSION`.
