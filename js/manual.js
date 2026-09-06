// ─── User manual ────────────────────────────────────────────────────────────
// A simple docs browser: a collapsible section/subsection tree on the left,
// the selected subsection's content on the right, empty until something's
// picked. Structurally mirrors the Forum/Stats screens (openManualScreen/
// closeManualScreen follow the same landing fade-out/fade-in pattern as
// openStatsScreen/closeStatsScreen in js/stats.js) so it feels like the rest
// of the app rather than a bolted-on help widget.
//
// Content is plain HTML strings with inline ($...$) and display ($$...$$)
// LaTeX, typeset with the same renderMathIn() helper (js/math-render.js)
// the forum and quiz screens already use — nothing manual-specific there.
//
// Section/subsection data itself lives in course/manual.json (same
// fetch-based pattern splash.js uses for course/splashes.json) rather than
// inline here, so the actual copy can be edited without touching any code.
// It's currently filled with lorem ipsum as placeholders; swap the `html`
// fields in that file for real copy whenever it's ready — this module
// doesn't need to change either way.

let MANUAL_SECTIONS = null;

// Loaded once, eagerly, as soon as this script runs (mirrors splash.js's
// init()) — by the time the person actually opens the manual, the fetch has
// usually already resolved, so openManualScreen only has to await it on a
// genuinely first-ever-fast click.
const manualDataReady = loadManualData();

// Shown if course/manual.json can't be fetched — most commonly because the
// page is opened as a local file:// path rather than served over http(s),
// which blocks fetch(), same caveat as splash.js's FALLBACK_SPLASHES.
const MANUAL_FALLBACK_SECTIONS = [{
  id: 'unavailable',
  icon: '⚠️',
  title: 'Manual unavailable',
  subsections: [{
    id: 'unavailable-notice',
    title: 'Content could not be loaded',
    html: '<p>The manual\u2019s content could not be loaded. If you\u2019re viewing this page as a local file rather than through a server, that\u2019s the likely cause &mdash; try again once the site is served over http(s).</p>'
  }]
}];

async function loadManualData() {
  try {
    // Was 'force-cache', which serves whatever's already cached for this
    // URL with zero revalidation — meaning a browser that had ever fetched
    // an older manual.json (before a new section was added, etc.) would
    // keep serving that stale copy forever after a redeploy, with no way
    // to notice the file changed. 'no-cache' still lets the browser reuse
    // the cached body on a fast 304 Not Modified when nothing changed, but
    // it always asks the server first instead of trusting a stale cache.
    const res = await fetch('course/manual.json', { cache: 'no-cache' });
    if (!res.ok) throw new Error('bad response');
    const data = await res.json();
    MANUAL_SECTIONS = (Array.isArray(data) && data.length) ? data : MANUAL_FALLBACK_SECTIONS;
  } catch (e) {
    MANUAL_SECTIONS = MANUAL_FALLBACK_SECTIONS;
  }
  return MANUAL_SECTIONS;
}

// ── Screen state ──────────────────────────────────────────────────────────
let manualExpandedSections = new Set();
let manualActiveSubsectionId = null;

// The manual button lives in the fixed top-right icon strip (next to the
// theme palette), so — unlike the old Stats/Forum "launch" buttons, which
// only ever lived on the landing screen — it's reachable from mid-quiz,
// mid-stats, mid-forum, mid-review, anywhere. openManualScreen() has to hide
// whichever of those screens is actually showing (not just assume it's the
// landing screen) and closeManualScreen() has to bring back that same one,
// rather than always landing on the landing screen. Same "find the visible
// host, hide it, remember it for close" approach the Forum's own floating
// button already uses (FORUM_FAB_HOSTS/forumFabHostId in js/forum.js) —
// each entry mirrors the exact show/hide convention that screen's own code
// already uses.
const MANUAL_HOSTS = [
  {
    id: 'appPage',
    isVisible: el => el.classList.contains('visible'),
    hide:      el => el.classList.remove('visible', 'fading-out'),
    show:      el => el.classList.add('visible'),
  },
  {
    id: 'statsScreen',
    isVisible: el => el.classList.contains('visible'),
    hide:      el => el.classList.remove('visible', 'fading-out'),
    show:      el => el.classList.add('visible'),
  },
  {
    id: 'reviewScreen',
    isVisible: el => el.classList.contains('visible'),
    hide:      el => el.classList.remove('visible', 'fading-out'),
    show:      el => el.classList.add('visible'),
  },
  {
    id: 'forumScreen',
    isVisible: el => el.classList.contains('visible'),
    hide:      el => el.classList.remove('visible', 'fading-out'),
    show:      el => el.classList.add('visible'),
  },
  {
    // Missing until now — SETTINGS_HOSTS (js/settings.js) already lists
    // 'manualScreen' as a valid host, so Manual -> Settings worked, but the
    // reverse (Settings -> Manual) didn't: openManualScreen() found no
    // matching host, fell back to treating the (already-hidden) landing
    // screen as the host, and never actually hid Settings. Manual became
    // .visible but sat behind Settings (looked like it "didn't open"), and
    // closing Settings then revealed the landing screen underneath while
    // Manual's now-unhidden content sat stacked below it in normal page
    // flow (looked "appended to the bottom of the main page").
    id: 'settingsScreen',
    isVisible: el => el.classList.contains('visible'),
    hide:      el => el.classList.remove('visible', 'fading-out'),
    show:      el => el.classList.add('visible'),
  },
  {
    id: 'choicePage',
    isVisible: el => !el.classList.contains('hidden'),
    hide:      el => el.classList.add('hidden'),
    show:      el => el.classList.remove('hidden', 'fading-out'),
  },
];

// Set for the duration of a manual visit opened on top of one of
// MANUAL_HOSTS above — null whenever the manual was opened with the
// landing screen showing underneath. closeManualScreen() reads this to
// know whether to restore that screen or fall back to the landing screen.
let manualHostId = null;

// There's no in-screen ✕ Close button anymore — the manual button doubles
// as the close control, same as tapping the site logo (which routes through
// goToMainMenu() -> closeManualScreen(true) instead). This is what the
// manual button's onclick actually calls now.
function toggleManualScreen() {
  const manual = document.getElementById('manualScreen');
  if (manual && manual.classList.contains('visible')) {
    closeManualScreen();
  } else {
    openManualScreen();
  }
}

async function openManualScreen() {
  const landing = document.getElementById('landingScreen');
  const manual  = document.getElementById('manualScreen');
  if (!landing || !manual) return;

  if (typeof setFieldLinesVisible === 'function') setFieldLinesVisible(false);

  // Landing screen showing underneath -> ordinary open. Otherwise, find
  // whichever host screen is actually visible right now and hide that one
  // instead (see MANUAL_HOSTS comment above).
  const landingShowing = !landing.classList.contains('hidden');
  const hostEntry = landingShowing ? null : MANUAL_HOSTS.find(h => {
    const el = document.getElementById(h.id);
    return el && h.isVisible(el);
  });
  const hostEl = hostEntry ? document.getElementById(hostEntry.id) : landing;
  manualHostId = hostEntry ? hostEntry.id : null;

  hostEl.classList.add('fading-out');
  setTimeout(async () => {
    if (hostEntry) {
      hostEntry.hide(hostEl);
    } else {
      hostEl.classList.add('hidden');
      hostEl.classList.remove('fading-out');
    }
    manual.classList.add('visible');
    // Fresh open every time: nothing expanded, nothing selected, right pane
    // empty — same "reset filters on open" call as openStatsScreen makes,
    // rather than carrying over whatever was left open from a previous visit.
    manualExpandedSections = new Set();
    manualActiveSubsectionId = null;

    if (!MANUAL_SECTIONS) {
      renderManualLoading();
      await manualDataReady;
    }
    renderManualSidebar();
    renderManualContent();
  }, 280);
}

// `forceLanding` is true only when goToMainMenu() (quiz-engine.js) closes
// the manual via the site logo/main-menu action — a distinct, more explicit
// "take me all the way home" than tapping the manual button again (see
// toggleManualScreen() above), which instead returns to wherever the manual
// was actually opened from. Same convention as closeForumScreen's own
// forceLanding param.
function closeManualScreen(forceLanding) {
  const landing = document.getElementById('landingScreen');
  const manual  = document.getElementById('manualScreen');
  if (!landing || !manual) return;

  manual.classList.add('fading-out');
  manualFigDemoClearIntervals();
  setTimeout(() => {
    manual.classList.remove('visible', 'fading-out');

    const hostId = manualHostId;
    manualHostId = null;

    if (forceLanding && typeof exitAppOrChoiceToLanding === 'function') {
      // Also unwinds solve-all/mistakes state the same way leaving that
      // screen normally does, if appPage was the host underneath — not
      // just "hide manual, show landing" — see exitAppOrChoiceToLanding()
      // in quiz-engine.js.
      exitAppOrChoiceToLanding();
      if (typeof setFieldLinesVisible === 'function') setFieldLinesVisible(true);
      return;
    }

    if (hostId) {
      const host = MANUAL_HOSTS.find(h => h.id === hostId);
      const hostEl = host && document.getElementById(hostId);
      if (host && hostEl) { host.show(hostEl); return; }
    }

    // Original behavior: opened from the landing screen itself.
    landing.classList.remove('hidden');
    if (typeof showNewSplash === 'function') showNewSplash();
    if (typeof setFieldLinesVisible === 'function') setFieldLinesVisible(true);
  }, 280);
}

// ── Sidebar ──────────────────────────────────────────────────────────────
function renderManualLoading() {
  const sidebar = document.getElementById('manualSidebar');
  const content = document.getElementById('manualContent');
  manualFigDemoClearIntervals();
  if (sidebar) sidebar.innerHTML = `<div class="manual-loading">Loading…</div>`;
  if (content) content.innerHTML = `
    <div class="manual-placeholder">
      <div class="manual-placeholder-icon">📖</div>
      <div>Loading the manual…</div>
    </div>
  `;
}

function toggleManualSection(sectionId) {
  if (manualExpandedSections.has(sectionId)) {
    manualExpandedSections.delete(sectionId);
  } else {
    manualExpandedSections.add(sectionId);
  }
  renderManualSidebar();
}

function selectManualSubsection(sectionId, subId) {
  manualExpandedSections.add(sectionId);
  manualActiveSubsectionId = subId;
  renderManualSidebar();
  renderManualContent();
}

function renderManualSidebar() {
  const sidebar = document.getElementById('manualSidebar');
  if (!sidebar || !MANUAL_SECTIONS) return;

  sidebar.innerHTML = MANUAL_SECTIONS.map(section => {
    const expanded = manualExpandedSections.has(section.id);
    const subsHtml = section.subsections.map(sub => `
      <button type="button"
        class="manual-subsection-btn${sub.id === manualActiveSubsectionId ? ' active' : ''}"
        onclick="selectManualSubsection('${section.id}','${sub.id}')">
        ${sub.title}
      </button>
    `).join('');

    return `
      <div class="manual-section${expanded ? ' expanded' : ''}">
        <button type="button" class="manual-section-header" onclick="toggleManualSection('${section.id}')">
          <span class="manual-section-chevron">▸</span>
          <span class="manual-section-icon">${section.icon}</span>
          <span class="manual-section-title">${section.title}</span>
        </button>
        <div class="manual-subsection-list">${subsHtml}</div>
      </div>
    `;
  }).join('');
}

// ── Content pane ─────────────────────────────────────────────────────────
function renderManualContent() {
  const content = document.getElementById('manualContent');
  if (!content || !MANUAL_SECTIONS) return;

  if (!manualActiveSubsectionId) {
    manualFigDemoClearIntervals();
    content.innerHTML = `
      <div class="manual-placeholder">
        <div class="manual-placeholder-icon">📖</div>
        <div>Pick a topic on the left to read about it here.</div>
      </div>
    `;
    return;
  }

  let found = null;
  for (const section of MANUAL_SECTIONS) {
    const sub = section.subsections.find(s => s.id === manualActiveSubsectionId);
    if (sub) { found = { section, sub }; break; }
  }
  if (!found) { manualActiveSubsectionId = null; renderManualContent(); return; }

  content.innerHTML = `
    <div class="manual-content-eyebrow">${found.section.icon} ${found.section.title}</div>
    <h2 class="manual-content-title">${found.sub.title}</h2>
    <div class="manual-content-body">${found.sub.html}</div>
  `;

  if (typeof renderMathIn === 'function') renderMathIn(content);
  manualFigDemoInitAll(content);
  manualAvatarDemoInitAll(content);
  manualLatexDemoInitAll(content);
  manualSplashDemoInitAll(content);
  manualThemeGalleryInitAll(content);
  manualGithubDemoInitAll(content);
}

// ── Live GitHub repo card (About the project / Feedback & Contact pages) ──
// Pulls basic stats for the flux repo straight from the public GitHub REST
// API. Both manual pages that embed this widget share one fetch through
// _manualGithubDataPromise, so opening the manual only ever costs a single
// pair of requests against GitHub's unauthenticated (60/hr) rate limit no
// matter how many .manual-github-demo elements are on screen.
const MANUAL_GITHUB_REPO = 'Aoi-Kuro/flux';
let _manualGithubDataPromise = null;

// Small generic octicon-style glyphs (repo book, star, fork, issue-circle,
// commit) — plain geometric shapes, not GitHub's copyrighted mark, just
// enough to read as "GitHub UI" alongside the fixed GitHub color palette.
const MANUAL_GITHUB_ICONS = {
  repo:   '<svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor"><path d="M2 2.5A2.5 2.5 0 0 1 4.5 0h8.75a.75.75 0 0 1 .75.75v12.5a.75.75 0 0 1-.75.75h-2.5a.75.75 0 1 1 0-1.5h1.75v-2H4.5a1 1 0 0 0-.1 1.995c.03-.001.062-.001.093 0H12a.75.75 0 0 1 0 1.5H4.5A2.5 2.5 0 0 1 2 11.5v-9Zm10.5-1V9h-8c-.356 0-.694.074-1 .208V2.5a1 1 0 0 1 1-1h8Z"></path></svg>',
  star:   '<svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor"><path d="M8 .25a.75.75 0 0 1 .673.418l1.882 3.815 4.21.612a.75.75 0 0 1 .416 1.279l-3.046 2.97.72 4.192a.75.75 0 0 1-1.088.79L8 12.347l-3.766 1.98a.75.75 0 0 1-1.088-.79l.72-4.193L.818 6.374a.75.75 0 0 1 .416-1.28l4.21-.611L7.327.668A.75.75 0 0 1 8 .25Z"></path></svg>',
  fork:   '<svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor"><path d="M5 3.25a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0Zm0 2.122a2.25 2.25 0 1 0-1.5 0v.878A2.25 2.25 0 0 0 5.75 8.5h1.5v2.128a2.251 2.251 0 1 0 1.5 0V8.5h1.5a2.25 2.25 0 0 0 2.25-2.25v-.878a2.25 2.25 0 1 0-1.5 0v.878a.75.75 0 0 1-.75.75h-4.5a.75.75 0 0 1-.75-.75v-.878Zm3.75 7.378a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0ZM12 3.25a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0Z"></path></svg>',
  issue:  '<svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor"><path d="M8 9.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Z"></path><path d="M8 0a8 8 0 1 1 0 16A8 8 0 0 1 8 0ZM1.5 8a6.5 6.5 0 1 0 13 0 6.5 6.5 0 0 0-13 0Z"></path></svg>',
  commit: '<svg viewBox="0 0 16 16" width="12" height="12" fill="currentColor"><path d="M11.93 8.5a4.002 4.002 0 0 1-7.86 0H.75a.75.75 0 0 1 0-1.5h3.32a4.002 4.002 0 0 1 7.86 0h3.32a.75.75 0 0 1 0 1.5Zm-1.43-.75a2.5 2.5 0 1 0-5 0 2.5 2.5 0 0 0 5 0Z"></path></svg>',
};

function manualGithubFetchRepoData() {
  if (!_manualGithubDataPromise) {
    _manualGithubDataPromise = (async () => {
      const [repoRes, commitRes] = await Promise.all([
        fetch(`https://api.github.com/repos/${MANUAL_GITHUB_REPO}`),
        fetch(`https://api.github.com/repos/${MANUAL_GITHUB_REPO}/commits?per_page=1`)
      ]);
      if (!repoRes.ok) throw new Error('GitHub repo fetch failed');
      const repo = await repoRes.json();
      let commit = null;
      if (commitRes.ok) {
        const commits = await commitRes.json();
        if (Array.isArray(commits) && commits[0]) commit = commits[0];
      }
      return { repo, commit };
    })().catch(err => {
      _manualGithubDataPromise = null; // let a later demo instance retry
      throw err;
    });
  }
  return _manualGithubDataPromise;
}

function manualGithubDemoInitAll(container) {
  if (!container) return;
  container.querySelectorAll('.manual-github-demo[data-live]').forEach(demo => {
    manualGithubDemoRender(demo);
  });
}

async function manualGithubDemoRender(demo) {
  const statsEl  = demo.querySelector('.manual-github-demo-stats');
  const commitEl = demo.querySelector('.manual-github-demo-commit');
  if (!statsEl) return;

  try {
    const { repo, commit } = await manualGithubFetchRepoData();

    statsEl.innerHTML = '';
    const stats = [
      ['star',  repo.stargazers_count, repo.stargazers_count === 1 ? 'star' : 'stars', false],
      ['fork',  repo.forks_count, repo.forks_count === 1 ? 'fork' : 'forks', false],
      ['issue', repo.open_issues_count, 'open issues', true],
    ];
    stats.forEach(([iconKey, val, label, isIssues]) => {
      const stat = document.createElement('span');
      stat.className = 'manual-github-demo-stat' + (isIssues ? ' manual-github-demo-stat-issues' : '');
      const iconSpan = document.createElement('span');
      iconSpan.className = 'manual-github-demo-stat-icon';
      iconSpan.innerHTML = MANUAL_GITHUB_ICONS[iconKey];
      stat.appendChild(iconSpan);
      stat.append(`${val} ${label}`);
      statsEl.appendChild(stat);
    });

    if (commitEl) {
      commitEl.innerHTML = '';
      if (commit && commit.commit) {
        const fullMsg = commit.commit.message || '';
        const firstLine = fullMsg.split('\n')[0];
        const msg = firstLine.length > 90 ? firstLine.slice(0, 87) + '…' : firstLine;
        const rawDate = commit.commit.author && commit.commit.author.date;
        const dateStr = rawDate
          ? new Date(rawDate).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
          : '';

        const iconSpan = document.createElement('span');
        iconSpan.className = 'manual-github-demo-commit-icon';
        iconSpan.innerHTML = MANUAL_GITHUB_ICONS.commit;
        commitEl.appendChild(iconSpan);

        const msgSpan = document.createElement('span');
        msgSpan.className = 'manual-github-demo-commit-msg';
        msgSpan.textContent = `“${msg}”`;
        commitEl.appendChild(msgSpan);

        if (dateStr) {
          const dateSpan = document.createElement('span');
          dateSpan.className = 'manual-github-demo-commit-date';
          dateSpan.textContent = `· ${dateStr}`;
          commitEl.appendChild(dateSpan);
        }
      }
    }
  } catch (e) {
    statsEl.innerHTML = '';
    const err = document.createElement('span');
    err.className = 'manual-github-demo-error';
    err.textContent = 'Couldn’t reach GitHub right now — try the link above.';
    statsEl.appendChild(err);
    if (commitEl) commitEl.innerHTML = '';
  }
}

// ── Splash badge demo (used inline on the "About the project" manual page) ──
// Not a reimplementation: it draws from the exact same pool via the exact
// same no-repeat picker the real landing-screen badge uses
// (window.pickSplashText, exposed by splash.js), it just renders into its
// own element instead of #splashText so tapping it here never touches the
// real badge sitting behind the manual overlay.
function manualSplashDemoInitAll(container) {
  if (!container) return;
  container.querySelectorAll('.manual-splash-demo-preview .mc-splash').forEach(el => {
    manualSplashDemoRender(el);
  });
}

function manualSplashDemoReroll(el) {
  manualSplashDemoRender(el);
}

function manualSplashDemoRender(el) {
  if (typeof window.pickSplashText !== 'function') return;
  const text = window.pickSplashText();
  if (!text) return;
  el.textContent = text;
  // Restart the bounce animation from scratch, same trick showNewSplash()
  // itself uses on the real badge.
  el.style.animation = 'none';
  void el.offsetWidth; // force reflow
  el.style.animation = '';
}

// ── Figure theme demo (used inline on the "Random 6 mode" and "Solve them
// all mode" manual pages) ──
// Purely a manual illustration: retheming this preview only ever touches
// the two elements below (data-theme/data-mode on .manual-fig-demo-preview),
// never body[data-theme] or .light — the real toggle/palette panel outside
// the manual is completely untouched by tapping these.
//
// On top of the manual toggle/swatches, each demo also auto-cycles through
// the color presets on its own (day/night is never touched by the auto
// cycle — only the color theme) so a passive reader still sees it restyle
// without having to click anything. Any manual swatch click pauses that
// demo's auto-cycle for a bit so it doesn't yank the color back out from
// under the person right after they picked one.
const MANUAL_FIG_DEMO_THEMES = ['default', 'nord', 'sakura', 'cyber', 'forest', 'solar'];
const MANUAL_FIG_DEMO_CYCLE_MS = 5000;
const MANUAL_FIG_DEMO_PAUSE_MS = 30000;

// Interval ids for whatever demos are currently on screen — cleared and
// rebuilt every time the manual content re-renders (new subsection, or the
// manual screen closing) so nothing keeps ticking against detached nodes.
let manualFigDemoIntervals = [];

function manualFigDemoClearIntervals() {
  manualFigDemoIntervals.forEach(id => clearInterval(id));
  manualFigDemoIntervals = [];
}

function manualFigDemoApplyTheme(demo, theme) {
  const preview = demo.querySelector('.manual-fig-demo-preview');
  if (preview) preview.setAttribute('data-theme', theme);
  const swatches = demo.querySelectorAll('.manual-fig-demo-swatch');
  swatches.forEach((s, i) => s.classList.toggle('active', MANUAL_FIG_DEMO_THEMES[i] === theme));
}

// Sets every demo in the freshly-rendered content to match whatever theme
// and day/night mode is actually active on the real site right now, then
// kicks off each one's auto-cycle. Called once per content render rather
// than on manual-open, since a subsection swap re-creates these nodes.
function manualFigDemoInitAll(container) {
  manualFigDemoClearIntervals();
  if (!container) return;
  const demos = container.querySelectorAll('.manual-fig-demo');
  if (!demos.length) return;

  const realTheme = (typeof getColorTheme === 'function') ? getColorTheme() : 'default';
  const initTheme = MANUAL_FIG_DEMO_THEMES.includes(realTheme) ? realTheme : 'default';
  const realMode = document.body.classList.contains('light') ? 'light' : 'dark';

  demos.forEach(demo => {
    const preview = demo.querySelector('.manual-fig-demo-preview');
    if (preview) preview.setAttribute('data-mode', realMode);
    const toggleBtn = demo.querySelector('.manual-fig-demo-toggle');
    if (toggleBtn) toggleBtn.textContent = realMode === 'dark' ? '🌙 Night' : '☀️ Day';
    manualFigDemoApplyTheme(demo, initTheme);
    demo._manualFigPausedUntil = 0;

    const intervalId = setInterval(() => {
      if (Date.now() < (demo._manualFigPausedUntil || 0)) return;
      const curPreview = demo.querySelector('.manual-fig-demo-preview');
      if (!curPreview) return;
      const cur = curPreview.getAttribute('data-theme') || 'default';
      const idx = MANUAL_FIG_DEMO_THEMES.indexOf(cur);
      const next = MANUAL_FIG_DEMO_THEMES[(idx + 1) % MANUAL_FIG_DEMO_THEMES.length];
      manualFigDemoApplyTheme(demo, next);
    }, MANUAL_FIG_DEMO_CYCLE_MS);
    manualFigDemoIntervals.push(intervalId);
  });
}

function manualFigDemoToggleMode(btn) {
  const preview = btn.closest('.manual-fig-demo')?.querySelector('.manual-fig-demo-preview');
  if (!preview) return;
  const next = preview.getAttribute('data-mode') === 'dark' ? 'light' : 'dark';
  preview.setAttribute('data-mode', next);
  btn.textContent = next === 'dark' ? '🌙 Night' : '☀️ Day';
}

function manualFigDemoSetTheme(btn, theme) {
  const demo = btn.closest('.manual-fig-demo');
  if (!demo) return;
  // A manual pick pauses this demo's own auto-cycle for a while rather than
  // stopping it forever — it resumes on its own after the pause elapses.
  demo._manualFigPausedUntil = Date.now() + MANUAL_FIG_DEMO_PAUSE_MS;
  manualFigDemoApplyTheme(demo, theme);
}

// ── Theme gallery (used inline on the "Themes & fonts" manual page) ──
// Unlike the fig-demo swatches above, these windows aren't an isolated
// preview — clicking one applies that color theme to the whole site via
// themes.js, same as picking it from the palette panel. Day/night mode is
// untouched; only the color theme changes. The highlighted window always
// tracks whichever theme is actually active, including if it was changed
// elsewhere (palette panel, custom builder) while this page is open.
//
// The Custom window is the one exception to "colors are static, lifted
// from style.css presets": there's no fixed preset to lift, since it's
// whatever the reader has built themselves. Its two halves carry no
// inline colors in the HTML — manualThemeGalleryApplyCustomPreview below
// fills them in from the last *saved* custom draft (same source the
// palette panel's own custom swatch reads), via themes.js's deriveTheme
// so surface/border/muted match exactly what the real site would show.
function manualThemeGalleryApplyCustomPreview(container) {
  if (!container) return;
  const halves = container.querySelectorAll('.manual-theme-window-custom-half');
  if (!halves.length || typeof getCustomDraft !== 'function' || typeof deriveTheme !== 'function') return;
  const draft = getCustomDraft();
  halves.forEach(half => {
    const mode = half.getAttribute('data-mode') === 'day' ? 'day' : 'night';
    const d = draft[mode];
    if (!d) return;
    const der = deriveTheme(d.bg, d.text, d.accent, d.accent2);
    const s = half.style;
    s.setProperty('--bg', der.bg);
    s.setProperty('--surface', der.surface);
    s.setProperty('--border', der.border);
    s.setProperty('--text', der.text);
    s.setProperty('--accent', der.accent);
    s.setProperty('--accent2', der.accent2);
  });
}

function manualThemeGalleryMarkActive(container, id) {
  if (!container) return;
  container.querySelectorAll('.manual-theme-window').forEach(win => {
    win.classList.toggle('active', win.getAttribute('data-theme-id') === id);
  });
}

function manualThemeGallerySelect(el, id) {
  if (typeof selectTheme === 'function') selectTheme(id);
  else if (typeof applyColorTheme === 'function') applyColorTheme(id, true);
  const gallery = el.closest('.manual-theme-gallery');
  manualThemeGalleryMarkActive(gallery, id);
  // Saving a custom theme elsewhere wouldn't touch this page, but re-reading
  // the draft here is cheap and keeps the preview honest if it did change.
  manualThemeGalleryApplyCustomPreview(gallery);
}

function manualThemeGalleryInitAll(container) {
  if (!container) return;
  const gallery = container.querySelector('.manual-theme-gallery');
  if (!gallery) return;
  const cur = (typeof getColorTheme === 'function') ? getColorTheme() : 'default';
  manualThemeGalleryMarkActive(gallery, cur);
  manualThemeGalleryApplyCustomPreview(gallery);
}

// ── Live avatar demo (used inline on the "Posting & identity" manual page) ──
// Purely a manual illustration, but it's not faked: it calls the exact same
// seed→SVG DiceBear endpoint the forum itself uses at claim/rename time
// (fetchForumIdenticonSvg, defined in forum.js and loaded before this file),
// so whatever renders here is exactly the avatar that nickname would
// actually get. Debounced so a fast typist doesn't fire a request per
// keystroke, and request-id-guarded so a stale, slow response can't
// clobber a newer one that resolved first.
const MANUAL_AVATAR_DEMO_DEBOUNCE_MS = 350;
let _manualAvatarDemoReqId = 0;

function manualAvatarDemoInitAll(container) {
  if (!container) return;
  container.querySelectorAll('.manual-avatar-demo').forEach(demo => {
    const input = demo.querySelector('.manual-avatar-demo-input');
    if (input) manualAvatarDemoRender(demo, input.value);
  });
}

function manualAvatarDemoUpdate(input) {
  const demo = input.closest('.manual-avatar-demo');
  if (!demo) return;
  clearTimeout(demo._manualAvatarDemoTimer);
  const seed = input.value;
  demo._manualAvatarDemoTimer = setTimeout(() => manualAvatarDemoRender(demo, seed), MANUAL_AVATAR_DEMO_DEBOUNCE_MS);
}

async function manualAvatarDemoRender(demo, seed) {
  const preview = demo.querySelector('.manual-avatar-demo-preview');
  if (!preview) return;

  const trimmed = (seed || '').trim();
  if (!trimmed) {
    preview.classList.remove('is-loading');
    preview.innerHTML = '<div class="manual-avatar-demo-empty">Start typing…</div>';
    return;
  }

  const reqId = ++_manualAvatarDemoReqId;
  preview.classList.add('is-loading');

  const svg = (typeof fetchForumIdenticonSvg === 'function')
    ? await fetchForumIdenticonSvg(trimmed)
    : null;

  if (reqId !== _manualAvatarDemoReqId) return; // a newer keystroke already superseded this response
  preview.classList.remove('is-loading');
  preview.innerHTML = svg
    ? `<div class="manual-avatar-demo-box">${svg}</div>`
    : '<div class="manual-avatar-demo-empty">Couldn\u2019t reach DiceBear right now &mdash; try again in a moment.</div>';
}

// ── Live LaTeX playground (used inline on the "Writing LaTeX in messages"
// manual page) ──
// A free-typing textarea whose value is wrapped in $$ $$ and re-typeset
// below it as the reader edits, on the same renderMathIn() (js/math-render.js)
// pipeline the forum and quiz screens use — nothing here reimplements
// typesetting, it just fires it on a debounce instead of after a send.
// Debounced the same way manualAvatarDemoUpdate() debounces its DiceBear
// fetch above, and request-id-guarded the same way, so a burst of
// keystrokes only ever leaves the LAST one's output on screen even if an
// earlier MathJax pass is still mid-flight when a newer one starts.
const MANUAL_LATEX_DEMO_DEBOUNCE_MS = 150;
let _manualLatexDemoReqId = 0;

function manualLatexDemoInitAll(container) {
  if (!container) return;
  container.querySelectorAll('.manual-latex-demo').forEach(demo => {
    const input = demo.querySelector('.manual-latex-demo-input');
    if (input) manualLatexDemoRender(demo, input.value);
  });
}

function manualLatexDemoUpdate(textarea) {
  const demo = textarea.closest('.manual-latex-demo');
  if (!demo) return;
  clearTimeout(demo._manualLatexDemoTimer);
  const raw = textarea.value;
  demo._manualLatexDemoTimer = setTimeout(() => manualLatexDemoRender(demo, raw), MANUAL_LATEX_DEMO_DEBOUNCE_MS);
}

async function manualLatexDemoRender(demo, raw) {
  const preview = demo.querySelector('.manual-latex-demo-preview');
  if (!preview) return;

  const trimmed = (raw || '').trim();
  if (!trimmed) {
    preview.innerHTML = '<div class="manual-latex-demo-empty">Type something above&hellip;</div>';
    return;
  }

  // reqId isn't used to gate anything below right now (renderMathIn()
  // resolves rather than rejects even on malformed LaTeX — MathJax just
  // renders its own red error token inline), but it's kept and bumped
  // here so a future stricter error path has a request fence to check
  // against, same pattern as manualAvatarDemoRender()'s reqId above.
  const reqId = ++_manualLatexDemoReqId;
  void reqId;

  // Escaped before going into innerHTML — this is reader-typed text, not
  // trusted app content, so it's treated the same as any other
  // user-supplied string that ends up in the DOM rather than assumed safe.
  const escaped = trimmed
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  preview.innerHTML = `$$${escaped}$$`;

  if (typeof renderMathIn === 'function') await renderMathIn(preview);
}
