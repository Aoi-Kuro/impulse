/* ═══════════════════════════════════════════════════════════════════
   solutions.js  ·  "See solution" on the practice site
   ───────────────────────────────────────────────────────────────────
   Shows the worked solutions written in the editor at /editor.

   Reading needs NO Edge Function: migration 008's RLS policy lets anon
   select problem_solutions rows whose status = 'published', so this is
   a plain PostgREST GET with the publishable key. Drafts are invisible
   here — not hidden by this code, but unreachable by the policy.

   Two kinds of request:
     1. the index — which problem_keys have a published solution and when
        each was last saved (no bodies). Fetched on load, when the tab comes
        back into view and hourly while it stays visible; cached in
        sessionStorage for a fast first paint;
     2. one row call the first time a given solution is opened, cached in
        memory until the index shows it was unpublished or saved again.

   WHERE THE BUTTON APPEARS
     Random quiz — only once scores are revealed (checkAll), so a
       solution can never be read instead of attempting the problem.
     Solve them all — always, since that mode is explicitly for working
       through problems with help at hand.

   Figures are the SVGs the editor already compiled; TikZJax is never
   loaded here. The TeX fonts are, though (vendor/tikzjax/fonts.css):
   dvisvgm writes glyphs as private-use codepoints in Computer Modern,
   so without that stylesheet every label in a figure renders blank.

   Requires: course-config.js, math-render.js, solution-render.js,
   figure.js, vendor/dompurify/purify.min.js, css/figure.css,
   css/solutions.css.
   ─────────────────────────────────────────────────────────────────── */

const SOLUTIONS_REST = `${SUPABASE_URL}/rest/v1/problem_solutions`;
const SOLUTIONS_INDEX_CACHE_KEY = STORAGE_PREFIX + '-solutions-index';
const SOLUTIONS_INDEX_TTL_MS = 5 * 60 * 1000;
const SOLUTIONS_INDEX_POLL_MS = 60 * 60 * 1000;   // re-check while a tab stays open and visible

let solutionsIndex = null;          // Set of problem_key with a published solution
let solutionsIndexPromise = null;   // in-flight load, so parallel callers share one request
const solutionsRowCache = new Map();

const solutionKeyFor = (quizNum, problemId) => `q${quizNum}_${problemId}`;

function solutionsRestHeaders() {
  return {
    'apikey': SUPABASE_PUBLISHABLE_KEY,
    'Authorization': `Bearer ${SUPABASE_PUBLISHABLE_KEY}`,
  };
}

/** Fetches the published keys and applies them. Never throws. */
function fetchSolutionsIndex() {
  if (solutionsIndexPromise) return solutionsIndexPromise;

  solutionsIndexPromise = fetch(`${SOLUTIONS_REST}?select=problem_key,updated_at&status=eq.published`, {
    headers: solutionsRestHeaders(),
    cache: 'no-store',
  })
    .then((r) => (r.ok ? r.json() : null))
    .then((rows) => {
      if (!rows) return solutionsIndex || new Set();      // keep what we had on a server error
      const fresh = new Set(rows.map((r) => r.problem_key));
      const stamps = new Map(rows.map((r) => [r.problem_key, r.updated_at]));

      // A solution opened earlier stays in memory, so drop it when it is no
      // longer published (or it would still open), or when it was saved
      // again since (or the student would keep reading the old text).
      solutionsRowCache.forEach((row, key) => {
        if (!fresh.has(key) || !row || row.updated_at !== stamps.get(key)) solutionsRowCache.delete(key);
      });

      solutionsIndex = fresh;
      try {
        sessionStorage.setItem(SOLUTIONS_INDEX_CACHE_KEY,
          JSON.stringify({ at: Date.now(), keys: [...fresh] }));
      } catch (e) { /* private mode / quota */ }
      return solutionsIndex;
    })
    .catch(() => {
      // Offline, or the table doesn't exist in this course's project yet.
      // An empty set simply means no buttons appear anywhere.
      solutionsIndex = solutionsIndex || new Set();
      return solutionsIndex;
    })
    .finally(() => { solutionsIndexPromise = null; });

  return solutionsIndexPromise;
}

/* Published keys only. Serve-then-revalidate: a cached list (if recent) is
   returned at once so buttons appear without waiting on the network, and a
   fresh copy is ALWAYS fetched in the background, which is what makes
   publishing and unpublishing show up in a tab that is already open. The
   caller passes a callback that runs again when the fresh list lands.

   Caching the list without revalidating — which this did at first — meant a
   solution unpublished in the editor stayed visible on the site for the rest
   of the cache window, and a newly published one stayed hidden. */
function loadSolutionsIndex(onFresh) {
  let cached = null;
  if (!solutionsIndex) {
    try {
      const raw = JSON.parse(sessionStorage.getItem(SOLUTIONS_INDEX_CACHE_KEY) || 'null');
      if (raw && Date.now() - raw.at < SOLUTIONS_INDEX_TTL_MS && Array.isArray(raw.keys)) {
        solutionsIndex = new Set(raw.keys);
        cached = solutionsIndex;
      }
    } catch (e) { /* ignore a corrupt cache */ }
  } else {
    cached = solutionsIndex;
  }

  const fresh = fetchSolutionsIndex().then((set) => {
    if (typeof onFresh === 'function') onFresh(set);
    return set;
  });

  return cached ? Promise.resolve(cached) : fresh;
}

function hasPublishedSolution(quizNum, problemId) {
  return !!solutionsIndex && solutionsIndex.has(solutionKeyFor(quizNum, problemId));
}

/** One published row, or null. Only the body is cached; the background
    index refresh above drops it once it is unpublished or edited. */
async function fetchSolution(problemKey) {
  if (solutionsRowCache.has(problemKey)) return solutionsRowCache.get(problemKey);
  const url = `${SOLUTIONS_REST}?select=problem_key,solution,figure,author,author_link,problem_hash,updated_at`
            + `&problem_key=eq.${encodeURIComponent(problemKey)}&status=eq.published&limit=1`;
  const res = await fetch(url, { headers: solutionsRestHeaders() });
  if (!res.ok) throw new Error('Could not load the solution.');
  const rows = await res.json();
  const row = (rows && rows[0]) || null;
  solutionsRowCache.set(problemKey, row);
  return row;
}

/* ── Buttons ──────────────────────────────────────────────────────────
   Cards are built by quiz-engine.js with the button already in place but
   hidden; this reveals the ones that have a solution. Called after a
   render and again when the index arrives, since the first render
   usually wins that race. */
function refreshSolutionButtons() {
  document.querySelectorAll('.solution-btn[data-quiz][data-problem]').forEach((btn) => {
    const show = hasPublishedSolution(+btn.dataset.quiz, btn.dataset.problem);
    btn.style.display = show ? '' : 'none';
  });
}

function initSolutions() {
  // Both callbacks matter: the first paints buttons from the cached list,
  // the second corrects them once the live list arrives.
  loadSolutionsIndex(refreshSolutionButtons).then(refreshSolutionButtons);

  // Coming back to a tab that was left open is the other moment the list
  // can be out of date (a solution published from the editor meanwhile).
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) fetchSolutionsIndex().then(refreshSolutionButtons);
  });

  // And a tab that stays in front the whole time: re-check hourly. Skipped
  // while hidden, since coming back already refreshes (above).
  setInterval(() => {
    if (!document.hidden) fetchSolutionsIndex().then(refreshSolutionButtons);
  }, SOLUTIONS_INDEX_POLL_MS);
}

/* ── Screen ───────────────────────────────────────────────────────────
   Same shape as #forumScreen: the solution replaces whatever screen you
   were on and is scrolled by the window, rather than floating over it in
   a modal. Closing restores that screen and its scroll position.

   This list mirrors FORUM_FAB_HOSTS in forum.js — each entry uses the
   show/hide signal that screen's own code already uses, rather than a
   second convention that could drift out of sync with it. */
const SOLUTION_HOSTS = [
  { id: 'appPage',      isVisible: (el) => el.classList.contains('visible'), hide: (el) => el.classList.remove('visible', 'fading-out'), show: (el) => el.classList.add('visible') },
  { id: 'statsScreen',  isVisible: (el) => el.classList.contains('visible'), hide: (el) => el.classList.remove('visible', 'fading-out'), show: (el) => el.classList.add('visible') },
  { id: 'reviewScreen', isVisible: (el) => el.classList.contains('visible'), hide: (el) => el.classList.remove('visible', 'fading-out'), show: (el) => el.classList.add('visible') },
  { id: 'choicePage',   isVisible: (el) => !el.classList.contains('hidden'), hide: (el) => el.classList.add('hidden'),                   show: (el) => el.classList.remove('hidden', 'fading-out') },
  { id: 'forumScreen',  isVisible: (el) => el.classList.contains('visible'), hide: (el) => el.classList.remove('visible', 'fading-out'), show: (el) => el.classList.add('visible') },
];

let solutionViewer = null;    // { steps, index } for the figure on screen
let solutionHost = null;      // { id, scrollY } of the screen we came from
let solutionOpen = false;

function solutionScreenEl() { return document.getElementById('solutionScreen'); }

function hideHostScreen() {
  solutionHost = null;
  for (const h of SOLUTION_HOSTS) {
    const el = document.getElementById(h.id);
    if (el && h.isVisible(el)) {
      solutionHost = { id: h.id, scrollY: window.scrollY || 0 };
      h.hide(el);
      return;
    }
  }
  // Nothing matched (landing screen): hide it the way forum.js does.
  const landing = document.getElementById('landingScreen');
  if (landing && !landing.classList.contains('hidden')) {
    solutionHost = { id: 'landingScreen', scrollY: window.scrollY || 0 };
    landing.classList.add('hidden');
  }
}

function restoreHostScreen() {
  if (!solutionHost) return;
  const { id, scrollY } = solutionHost;
  solutionHost = null;
  const el = document.getElementById(id);
  if (!el) return;
  if (id === 'landingScreen') el.classList.remove('hidden');
  else {
    const h = SOLUTION_HOSTS.find((x) => x.id === id);
    if (h) h.show(el);
  }
  if (typeof restoreScreenScroll === 'function') restoreScreenScroll(scrollY);
  else window.scrollTo(0, scrollY || 0);
}

function closeSolutionScreen() {
  const screen = solutionScreenEl();
  if (!screen || !solutionOpen) return;
  solutionOpen = false;

  const body = document.getElementById('solutionBody');
  const cap  = document.getElementById('solutionCaption');
  [body, cap].forEach((el) => {
    if (el && window.MathJax && MathJax.typesetClear) { try { MathJax.typesetClear([el]); } catch (e) {} }
  });
  stopSolutionAutoplay();
  solutionViewer = null;

  document.documentElement.classList.remove('solution-screen-open');
  screen.classList.add('fading-out');
  setTimeout(() => {
    screen.classList.remove('visible', 'fading-out');
    if (typeof setFieldLinesVisible === 'function') setFieldLinesVisible(true);
    if (typeof syncForumFabVisibility === 'function') syncForumFabVisibility();
    restoreHostScreen();
  }, 280);
}
// Kept so an older call site (or a browser back gesture wired to it) still works.
const closeSolution = closeSolutionScreen;

/* The figure plays itself through once, so the build-up is seen without
   anyone having to discover the arrows. The FIRST deliberate interaction
   (arrow, key, tap, swipe) hands control over for good — it never resumes
   and never fights the reader for the step they chose. */
const SOLUTION_AUTOPLAY_MS = 2200;
let solutionAutoTimer = null;

function stopSolutionAutoplay() {
  if (solutionAutoTimer) { clearInterval(solutionAutoTimer); solutionAutoTimer = null; }
  if (solutionViewer) solutionViewer.manual = true;
}

function startSolutionAutoplay() {
  stopSolutionAutoplay();
  if (!solutionViewer || solutionViewer.steps.length < 2) return;
  if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  solutionViewer.manual = false;
  solutionAutoTimer = setInterval(() => {
    if (!solutionViewer || solutionViewer.manual) return stopSolutionAutoplay();
    if (solutionViewer.index >= solutionViewer.steps.length - 1) {
      // Stop at the last step rather than looping: a figure that keeps
      // restarting under someone reading the text below is a distraction.
      stopSolutionAutoplay();
      return;
    }
    solutionViewer.index++;
    drawSolutionStep();
  }, SOLUTION_AUTOPLAY_MS);
}

function solutionStep(delta, fromUser) {
  if (!solutionViewer) return;
  if (fromUser !== false) stopSolutionAutoplay();
  const n = solutionViewer.steps.length;
  solutionViewer.index = Math.min(Math.max(solutionViewer.index + delta, 0), n - 1);
  drawSolutionStep();
}

/** Jump straight to a step (dot taps). */
function solutionGoToStep(i) {
  if (!solutionViewer) return;
  stopSolutionAutoplay();
  solutionViewer.index = Math.min(Math.max(i, 0), solutionViewer.steps.length - 1);
  drawSolutionStep();
}

function drawSolutionStep() {
  const v = solutionViewer;
  if (!v) return;
  const i = v.index, n = v.steps.length;
  document.querySelectorAll('#solutionFigure .fig-step').forEach((el, k) => el.classList.toggle('on', k === i));
  const dots = document.getElementById('solutionDots');
  if (dots) {
    dots.textContent = '';
    for (let k = 0; k < n; k++) {
      const d = document.createElement('i');
      if (k === i) d.className = 'on';
      d.title = `Step ${k + 1}`;
      d.addEventListener('click', () => solutionGoToStep(k));
      dots.appendChild(d);
    }
  }
  document.getElementById('solutionPrev').disabled = i <= 0;
  document.getElementById('solutionNext').disabled = i >= n - 1;
  document.getElementById('solutionStepNo').textContent = `Step ${i + 1} / ${n}`;
  const cap = document.getElementById('solutionCaption');
  // Hidden only when NO step has a caption; otherwise the reserved line
  // stays so the layout doesn't jump between captioned and bare steps.
  cap.hidden = !v.steps.some((s) => (s.caption || '').trim());
  const text = v.steps[i].caption || '';
  if (!text.trim()) {
    if (window.MathJax && MathJax.typesetClear) { try { MathJax.typesetClear([cap]); } catch (e) {} }
    cap.textContent = '';
  } else {
    renderSolutionInto(cap, text);
  }
}

async function openSolution(quizNum, problemId) {
  const key = solutionKeyFor(quizNum, problemId);
  const screen = solutionScreenEl();
  if (!screen) return;

  const label = problemLabel(quizNum, problemId);
  document.getElementById('solutionTitle').textContent = `📘 Solution · ${label}`;

  // Problem first — the student should see what is being solved without
  // leaving the page. The accepted answer is deliberately NOT shown: in
  // Solve-them-all the solution is reachable before an attempt.
  const p = getQuizProblem(quizNum, problemId);
  const probBox = document.getElementById('solutionProblem');
  if (p) {
    document.getElementById('solutionProblemNum').textContent = label;
    document.getElementById('solutionProblemTopic').textContent = p.topic || '';
    const pt = document.getElementById('solutionProblemText');
    pt.innerHTML = p.text;            // the site's own trusted problem text
    probBox.hidden = false;
    renderMathIn(pt);
  } else {
    probBox.hidden = true;
  }

  // Blank the rest while loading.
  const body = document.getElementById('solutionBody');
  body.textContent = '';
  document.getElementById('solutionFigureWrap').hidden = true;
  document.getElementById('solutionMain').hidden = true;
  document.getElementById('solutionStale').hidden = true;
  const credit = document.getElementById('solutionCredit');
  credit.hidden = true;
  const loading = document.getElementById('solutionLoading');
  loading.hidden = false;

  if (!solutionOpen) {
    hideHostScreen();
    // #saNavRail (Solve-All's progress line) and #stickyScore are
    // position:fixed, so they float above this screen until hidden — see
    // the html.solution-screen-open rule in css/solutions.css.
    document.documentElement.classList.add('solution-screen-open');
    if (typeof setFieldLinesVisible === 'function') setFieldLinesVisible(false);
    screen.classList.add('visible');
    solutionOpen = true;
    if (typeof syncForumFabVisibility === 'function') syncForumFabVisibility();
  }
  window.scrollTo(0, 0);

  let row;
  try {
    row = await fetchSolution(key);
  } catch (e) {
    loading.hidden = true;
    document.getElementById('solutionMain').hidden = false;
    body.textContent = 'Could not load this solution. Check your connection and try again.';
    return;
  }
  if (!solutionOpen) return;                       // closed while loading
  loading.hidden = true;

  if (!row) {
    document.getElementById('solutionMain').hidden = false;
    body.textContent = 'This solution is no longer published.';
    return;
  }

  const steps = (row.figure && Array.isArray(row.figure.steps) ? row.figure.steps : [])
    .filter((s) => s && typeof s.svg === 'string' && s.svg.trim());
  if (steps.length) {
    const stage = document.getElementById('solutionFigure');
    stage.textContent = '';
    const holder = document.createElement('div');
    holder.className = 'fig-steps fig-sized';
    holder.style.setProperty('--fig-scale', String(figScaleOf(row.figure)));
    steps.forEach((s) => {
      const d = document.createElement('div');
      d.className = 'fig-step';
      // ALWAYS sanitized: this markup is inlined (that is what makes it
      // follow the theme), and this page shares an origin with the forum.
      d.innerHTML = figSanitizeSvg(s.svg);
      holder.appendChild(d);
    });
    stage.appendChild(holder);
    document.getElementById('solutionFigureWrap').hidden = false;
    figCropToContent(holder);                      // only measurable once visible
    solutionViewer = { steps, index: 0, manual: false };
    document.getElementById('solutionNav').style.display = steps.length > 1 ? '' : 'none';
    drawSolutionStep();
    attachSolutionSwipe(stage);
    startSolutionAutoplay();
  } else {
    stopSolutionAutoplay();
    solutionViewer = null;
  }

  document.getElementById('solutionMain').hidden = false;
  renderSolutionInto(body, row.solution || '');

  if (row.author) {
    credit.textContent = '';
    credit.append(document.createTextNode('Solution by '));
    const b = document.createElement('b');
    b.textContent = '@' + String(row.author).replace(/^@/, '');
    // The editor's own link, if they set one. http(s) only: anything else
    // (javascript:, data:) would run or render on click.
    const href = safeAuthorLink(row.author_link);
    if (href) {
      const a = document.createElement('a');
      a.href = href;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      a.appendChild(b);
      credit.appendChild(a);
    } else {
      credit.appendChild(b);
    }
    credit.hidden = false;
  }

  // The problem may have been edited after the solution was written.
  if (row.problem_hash && p) {
    const now = await solutionProblemHash(p);
    if (solutionOpen && now !== row.problem_hash) document.getElementById('solutionStale').hidden = false;
  }
}

function safeAuthorLink(raw) {
  if (typeof raw !== 'string' || !raw) return null;
  try {
    const u = new URL(raw);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.href : null;
  } catch (e) {
    return null;
  }
}

/* Horizontal swipe on the figure, for phones. Only a clearly horizontal
   gesture counts, so a vertical flick still scrolls the page. */
function attachSolutionSwipe(el) {
  if (!el || el.dataset.swipeBound) return;
  el.dataset.swipeBound = '1';
  let x0 = null, y0 = null;
  el.addEventListener('touchstart', (e) => {
    const t = e.changedTouches[0];
    x0 = t.clientX; y0 = t.clientY;
  }, { passive: true });
  el.addEventListener('touchend', (e) => {
    if (x0 === null) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - x0, dy = t.clientY - y0;
    x0 = y0 = null;
    if (Math.abs(dx) < 40 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
    solutionStep(dx < 0 ? 1 : -1);
  }, { passive: true });
}

/** Must match problemHashOf() in editor/editor.js exactly. */
async function solutionProblemHash(p) {
  const src = `${p.text}\u0000${JSON.stringify(p.answer)}\u0000${JSON.stringify(p.units || [])}`;
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(src));
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 32);
}

document.addEventListener('keydown', (e) => {
  if (!solutionOpen) return;
  if (/^(INPUT|TEXTAREA|SELECT)$/.test(e.target && e.target.tagName)) return;
  if (e.key === 'Escape') { closeSolutionScreen(); return; }
  if (!solutionViewer) return;
  if (e.key === 'ArrowLeft')  solutionStep(-1);
  if (e.key === 'ArrowRight') solutionStep(1);
});

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initSolutions);
} else {
  initSolutions();
}
