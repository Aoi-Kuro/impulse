// ── Course identity & per-course secrets ─────────────────────────────────────
// This site is deployed once per course (PHYS161, PHYS162, ...) as a
// completely separate repo/site each time. Everything that's IDENTICAL
// between deployments (framework code) stays here. Everything that
// DIFFERS is looked up below by the `data-course` attribute on <head> in
// index.html / offline.html — that attribute is the one thing you change
// by hand when spinning up a new course's copy of this repo.
//
// The public-facing title/meta/eyebrow text used to be a manual copy-paste
// job documented in course/course.json — that's now automated (see the
// `display` field per course and the code below that applies it), so
// course.json is stale/historical only; don't edit it expecting it to do
// anything.
//
// This script must load BEFORE anything that reads STORAGE_PREFIX,
// SUPABASE_URL, or SUPABASE_PUBLISHABLE_KEY — that means before
// banner-manager.js/themes.js/splash.js/easter.js, not just before forum.js.
// It's placed as the very first external <script> in index.html for that
// reason.

const COURSES = {
  phys162: {
    storagePrefix: 'phys162',
    supabase: {
      url: 'https://eammcjjsjyvmbjsloxpz.supabase.co',
      // Publishable key — safe to be public, RLS controls what it can
      // actually do (see the comment that used to live in
      // js/supabase-config.js). Never put the sb_secret_... key here.
      publishableKey: 'sb_publishable_NjZjecxc0iP1JnPSk5cJWQ_qllgCF7P',
    },
    // Public half of the VAPID keypair post-message.ts (in that project's
    // own superbase/edge-functions) signs pushes with. Public by design —
    // this is what identifies "a push claiming to be from this app", not
    // what lets anyone send one. Each Supabase project gets its own
    // keypair, so this is course-specific too.
    pushVapidPublicKey: 'BHEaaW9g9lqgGVa8cpwWaXq8Sy6vSdxYSJbhRpshv1G5WRExKk0NHqpU3oRPF8vetfrGzjmlV9T1u_xl18LszGY',
    // How big a "Random N" draw is, and — in cumulative mode — how many
    // of those N come from the previous quiz vs. the current one. Courses
    // can differ here (more/fewer problems per exam), so this isn't a
    // shared constant. cumulativePrevCount must be <= size; the remainder
    // (size - cumulativePrevCount) is drawn from the current quiz.
    quizSettings: {
      size: 6,
      cumulativePrevCount: 3,
    },
    // Row id in forum_messages shown pinned at the top of the forum
    // screen (see forum.js's renderForumPinnedBanner) — an ordinary
    // message, nothing server-side marks it special, this id is the only
    // thing that says "this one is the pinned one".
    pinnedMessageId: 336,
    // Which course this is for CHANGELOG.js's per-entry `scope` filtering
    // (js/data/changelog.js): 0 always means "both courses", so 0 is never
    // used here — this is the id that means "this course specifically".
    // Must be unique per course (don't reuse 2 for a 3rd course later).
    changelogScope: 2,
    // Everything index.html's <title>/OG/Twitter meta tags and the 4
    // "eyebrow" labels used to have hardcoded — applied automatically at
    // load (see the code below), so this is now the ONLY place this
    // course's public-facing name/description/URL need to be edited.
    // courseCode also drives the 4 "PHYS162 · <Mode>" eyebrow labels —
    // the "· Mode name" suffixes are fixed framework strings, not
    // course-specific, so they aren't repeated per course here.
    display: {
      courseCode: 'PHYS162',
      ogDescription: "Interactive physics practice quiz: electric fields, Gauss's law, circuits & more. Instant feedback with scoring.",
      twitterDescription: 'Interactive physics practice quiz for PHYS 162 course at Nazarbayev University.',
      siteUrl: 'https://your-domain.com/PHYS162_Practice_Quiz.html',
    },
  },
  phys161: {
    storagePrefix: 'phys161',
    supabase: {
      // TODO(phys161 release): stand up the phys161 Supabase project
      // (schema + edge functions from superbase/), then fill these in.
      // Left blank on purpose — see below for what happens otherwise.
      url: 'https://ntlonovwrpspqncmejdm.supabase.co',
      publishableKey: 'sb_publishable_cj-dJARetQ3jv_1r3vqtKQ_kndImovt',
    },
    // TODO(phys161 release): generate a fresh VAPID keypair for the
    // phys161 project (web-push generate-vapid-keys or equivalent), put
    // the public half here and the private half in that project's own
    // post-message.ts secrets. Push subscriptions will just fail to
    // register with this blank until then — not fatal.
    pushVapidPublicKey: 'BLvjq8A2HzqQC58nNwFGINf7_iw1_K634_lYwJTqEJ5yW3XKcOjMNwbFTNat_KSEE_2S2VpU655evW1oGpXxGKM',
    // TODO(phys161 release): confirm these match phys161's actual exam
    // structure — defaulted to phys162's numbers (6 per quiz, 3 of those
    // from the previous quiz in cumulative mode) since nothing else was
    // specified yet.
    quizSettings: {
      size: 7,
      cumulativePrevCount: 3,
    },
    pinnedMessageId: 2,
    changelogScope: 1,
    // TODO(phys161 release): confirm ogDescription/twitterDescription
    // actually describe phys161's real topic coverage — copied from
    // course/course.json's phys161 block, not re-verified here.
    display: {
      courseCode: 'PHYS161',
      ogDescription: 'Interactive physics practice quiz: kinematics, dynamics, thermodynamics & more. Instant feedback with scoring.',
      twitterDescription: 'Interactive physics practice quiz for PHYS 161 course at Nazarbayev University.',
      siteUrl: 'https://your-domain.com/PHYS161_Practice_Quiz.html',
    },
  },
};

const ACTIVE_COURSE = (document.head.dataset.course || 'phys162').toLowerCase();
const _courseConfig = COURSES[ACTIVE_COURSE];

if (!_courseConfig) {
  console.error(
    `course-config.js: unknown data-course="${ACTIVE_COURSE}" on <head>. ` +
    `Known courses: ${Object.keys(COURSES).join(', ')}. Falling back to phys162.`
  );
}

const _active = _courseConfig || COURSES.phys162;

const STORAGE_PREFIX = _active.storagePrefix;
// Kept as SUPABASE_URL / SUPABASE_PUBLISHABLE_KEY (same names the old
// js/supabase-config.js used) so forum.js, attempts-sync.js,
// push-notifications.js etc. don't need to change at all.
const SUPABASE_URL = _active.supabase.url;
const SUPABASE_PUBLISHABLE_KEY = _active.supabase.publishableKey;
const PUSH_VAPID_PUBLIC_KEY = _active.pushVapidPublicKey;

// Read by quiz-engine.js's newQuiz() instead of hardcoding 6/3, so each
// course can have its own exam size without touching engine code.
// Falls back to the phys162 defaults (6, 3) if a course's entry omits
// quizSettings entirely, rather than silently producing NaN-length quizzes.
const _quizSettings = _active.quizSettings || COURSES.phys162.quizSettings;
const QUIZ_SIZE = _quizSettings.size;
const QUIZ_CUMULATIVE_PREV_COUNT = _quizSettings.cumulativePrevCount;

if (QUIZ_CUMULATIVE_PREV_COUNT > QUIZ_SIZE) {
  console.error(
    `course-config.js: quizSettings.cumulativePrevCount (${QUIZ_CUMULATIVE_PREV_COUNT}) ` +
    `exceeds quizSettings.size (${QUIZ_SIZE}) for "${ACTIVE_COURSE}" — ` +
    `cumulative mode will draw 0 problems from the current quiz. Fix the values in COURSES.${ACTIVE_COURSE}.quizSettings.`
  );
}

// Read by forum.js instead of hardcoding one row id, since each course's
// Supabase project has its own forum_messages table with its own welcome
// post at a different id. No sane fallback exists here (unlike
// quizSettings, there's no "default" pinned message across courses), so a
// course entry that omits this ends up with the banner just not showing —
// flagged loudly so that's never silent.
const FORUM_PINNED_MESSAGE_ID = _active.pinnedMessageId;
if (FORUM_PINNED_MESSAGE_ID == null) {
  console.error(
    `course-config.js: no pinnedMessageId set for "${ACTIVE_COURSE}" — ` +
    `the pinned forum banner will stay hidden until COURSES.${ACTIVE_COURSE}.pinnedMessageId is set.`
  );
}

// Read by js/data/changelog.js's per-entry `scope` filter (0 = both
// courses, else = that course's own changelogScope). No sane fallback —
// unlike quizSettings there's no "default" course id — so a course entry
// missing this fails OPEN (changelog.js shows every entry, unfiltered)
// rather than silently hiding everything scope !== 0, since showing too
// much is far less confusing than an empty-looking changelog.
const COURSE_CHANGELOG_SCOPE = _active.changelogScope;
if (COURSE_CHANGELOG_SCOPE == null) {
  console.error(
    `course-config.js: no changelogScope set for "${ACTIVE_COURSE}" — ` +
    `the changelog will show ALL entries unfiltered until COURSES.${ACTIVE_COURSE}.changelogScope is set.`
  );
}

// ── Public-facing title/meta/eyebrow text ────────────────────────────────
// This corrects things for anyone who actually loads the page and runs JS
// (tab title, the "eyebrow" labels below) — but does NOT make the static
// <meta property="og:..."> / <meta name="twitter:..."> block in
// index.html's <head> safe to leave un-edited. Link-preview crawlers
// (Telegram, Discord, WhatsApp, Slack, X, Facebook) fetch raw HTML and
// never run JavaScript, so none of the setAttribute() calls below ever
// reach them — that static block still needs to be hand-edited to match
// `display` below at release time. See the "⚠ EDIT THESE 9 LINES BY HAND"
// comment right above that block in index.html and the "Manual-swap
// items" section of README.md.
const _display = _active.display || COURSES.phys162.display;
const COURSE_CODE = _display.courseCode;
const COURSE_TITLE = `${COURSE_CODE} Practice Quiz`;

// offline.html and index.html share this file but want different <title>
// text ("You're offline — ..." vs plain) — distinguished by filename
// rather than by any DOM heuristic, since offline.html has none of the
// OG/Twitter meta tags below to key off of.
const _isOfflinePage = /offline\.html$/i.test(location.pathname);
document.title = _isOfflinePage ? `You're offline — ${COURSE_TITLE}` : COURSE_TITLE;

// index.html-only from here down — offline.html has none of these meta
// tags, so each querySelector below just no-ops there (el is null). Kept
// as a harmless bonus for any JS-executing consumer (a browser tab, a
// crawler that does render JS) — NOT a substitute for editing the static
// block by hand; see the comment above.
function _setMetaContent(selector, value) {
  const el = document.querySelector(selector);
  if (el) el.setAttribute('content', value);
}
_setMetaContent('meta[property="og:title"]', COURSE_TITLE);
_setMetaContent('meta[name="twitter:title"]', COURSE_TITLE);
_setMetaContent('meta[property="og:description"]', _display.ogDescription);
_setMetaContent('meta[name="twitter:description"]', _display.twitterDescription);
_setMetaContent('meta[property="og:url"]', _display.siteUrl);

// The 4 "eyebrow" labels are all in <body>, not yet parsed when this
// <head> script runs — deferred to DOMContentLoaded. Each is
// `${COURSE_CODE} · <fixed mode name>`; the mode-name half is framework
// copy, not course-specific, so it's written here rather than repeated
// in every course's `display` block.
window.addEventListener('DOMContentLoaded', () => {
  const _setEyebrowText = (id, suffix) => {
    const el = document.getElementById(id);
    if (el) el.textContent = `${COURSE_CODE} · ${suffix}`;
  };
  _setEyebrowText('eyebrowLandingPractice', 'Practice Mode');
  _setEyebrowText('eyebrowLandingSolveAll', 'Solve them all');
  _setEyebrowText('eyebrowQuizHeader', 'Practice Mode');
  _setEyebrowText('eyebrowSolveHeader', 'Solve Mode');
});

if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) {
  // Not fatal — forum.js/attempts-sync.js/push-notifications.js all already
  // check `typeof SUPABASE_URL === 'undefined'` style guards and quietly
  // no-op without a client, they just won't have blank strings currently.
  // This just makes the "why isn't the forum loading" question answer
  // itself in devtools instead of failing silently.
  console.warn(
    `course-config.js: no Supabase credentials set for "${ACTIVE_COURSE}" — ` +
    `forum, stats sync, and push notifications will be disabled until ` +
    `COURSES.${ACTIVE_COURSE} in js/course-config.js is filled in.`
  );
}
