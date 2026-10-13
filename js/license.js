// ─── License screen ─────────────────────────────────────────────────────
// Opened from the "Copyright" link under the changelog button on the landing
// screen. One scrollable page: the project's own statements first (what is
// licensed how, who owns the course material, who to contact), then the
// full text of the license the project uses — the unmodified official
// LICENSE file (GNU AGPL v3, from gnu.org), fetched on first use and kept
// for the rest of the visit. Solutions are all rights reserved, so they
// have no license text. LICENSE_TEXTS can hold more than one license: the
// tab bar only shows once there are two or more.
//
// Same open/close fade as #manualScreen (js/manual.js). It is only ever
// opened from the landing screen, so closing always returns there. Manual
// and Settings can open on top of it: both list 'licenseScreen' among
// their hosts, and the forum FAB stays hidden while it is showing (see
// syncForumFabVisibility in js/forum.js).

const LICENSE_TEXTS = {
  agpl: {
    label: 'GNU AGPL v3.0',
    file: 'LICENSE',
    online: 'https://www.gnu.org/licenses/agpl-3.0.html',
  },
};

let licenseActiveTab = 'agpl';
let licenseLandingScrollY = 0;
const licenseTextCache = {};

// Visible on screen — read from the DOM, not a flag, because Manual or
// Settings opened on top of it hide it by removing this same class.
function isLicenseScreenOpen() {
  const el = document.getElementById('licenseScreen');
  return !!el && el.classList.contains('visible');
}

function openLicenseScreen() {
  const landing = document.getElementById('landingScreen');
  const screen  = document.getElementById('licenseScreen');
  if (!landing || !screen || isLicenseScreenOpen()) return;

  if (typeof setFieldLinesVisible === 'function') setFieldLinesVisible(false);
  licenseLandingScrollY = typeof captureScreenScroll === 'function' ? captureScreenScroll() : (window.scrollY || 0);

  landing.classList.add('fading-out');
  setTimeout(() => {
    landing.classList.add('hidden');
    landing.classList.remove('fading-out');
    screen.classList.add('visible');
    if (typeof scrollScreenToTop === 'function') scrollScreenToTop();
    else window.scrollTo(0, 0);
    renderLicenseTabs();
    renderLicenseText();
    renderLicenseSolutionAuthors();
  }, 280);
}

// ── Solution authors ──
// Under "Worked Solutions": every editor with at least one published
// solution, then for each quiz the problem numbers students see (P1, P2…),
// with runs of three or more collapsed ("3–6"). Retired problems and
// disabled quizzes are left out, and so are quizzes an editor has no
// solution in. Re-read on every open so a newly published solution shows.
function formatProblemNumberRuns(nums) {
  const sorted = [...new Set(nums)].sort((a, b) => a - b);
  const parts = [];
  for (let i = 0; i < sorted.length; ) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1] === sorted[j] + 1) j++;
    if (j - i >= 2) parts.push(`${sorted[i]}–${sorted[j]}`);
    else for (let k = i; k <= j; k++) parts.push(String(sorted[k]));
    i = j + 1;
  }
  return parts.join(', ');
}

async function renderLicenseSolutionAuthors() {
  const box = document.getElementById('licenseSolutionAuthors');
  if (!box || typeof fetchSolutionAuthorRows !== 'function') return;
  const rows = await fetchSolutionAuthorRows();
  if (!Array.isArray(rows)) { box.hidden = true; return; }

  // author key (case-insensitive, no "@") -> { name, total, quizzes: Map<quizNum, number[]> }
  const authors = new Map();
  for (const r of rows) {
    const m = /^q(\d+)_(.+)$/.exec((r && r.problem_key) || '');
    const name = String((r && r.author) || '').trim().replace(/^@/, '');
    if (!m || !name) continue;
    const quizNum = +m[1];
    const quiz = typeof QUIZZES !== 'undefined' ? QUIZZES[quizNum - 1] : null;
    if (!quiz || quiz.enabled === false) continue;
    const num = typeof problemNumber === 'function' ? problemNumber(quizNum, m[2]) : null;
    if (num === null) continue;
    const key = name.toLowerCase();
    if (!authors.has(key)) authors.set(key, { name, total: 0, quizzes: new Map() });
    const a = authors.get(key);
    if (!a.quizzes.has(quizNum)) a.quizzes.set(quizNum, []);
    a.quizzes.get(quizNum).push(num);
    a.total++;
  }

  box.textContent = '';
  if (!authors.size) { box.hidden = true; return; }

  // Author | Quiz | Problems — one row per (author, quiz), the author cell
  // spanning that author's rows, with their solution count under the name.
  const table = document.createElement('table');
  table.className = 'license-authors-table';
  table.innerHTML = '<thead><tr><th>Author</th><th>Quiz</th><th>Problems</th></tr></thead>';
  const tbody = document.createElement('tbody');

  [...authors.values()]
    .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name))
    .forEach((a) => {
      const quizNums = [...a.quizzes.keys()].sort((x, y) => x - y);
      quizNums.forEach((quizNum, i) => {
        const tr = document.createElement('tr');
        if (i === quizNums.length - 1) tr.className = 'license-author-last';
        if (i === 0) {
          const who = document.createElement('td');
          who.className = 'license-author-cell';
          who.rowSpan = quizNums.length;
          const nameEl = document.createElement('div');
          nameEl.className = 'license-author-name';
          nameEl.textContent = '@' + a.name;
          const countEl = document.createElement('div');
          countEl.className = 'license-author-count';
          countEl.textContent = `${a.total} solution${a.total === 1 ? '' : 's'}`;
          who.append(nameEl, countEl);
          tr.appendChild(who);
        }
        const q = document.createElement('td');
        q.className = 'license-author-quiz';
        q.textContent = `Q${quizNum}`;
        const nums = document.createElement('td');
        nums.className = 'license-author-problems';
        nums.textContent = formatProblemNumberRuns(a.quizzes.get(quizNum));
        tr.append(q, nums);
        tbody.appendChild(tr);
      });
    });

  const cells = tbody.querySelectorAll('td.license-author-cell');
  if (cells.length) cells[cells.length - 1].classList.add('is-final');   // no line under the table's end
  table.appendChild(tbody);
  const scroll = document.createElement('div');
  scroll.className = 'license-authors-scroll';
  scroll.appendChild(table);
  box.appendChild(scroll);
  box.hidden = false;
}

// `forceLanding` (the site logo, via goToMainMenu in quiz-engine.js) ends on
// the landing screen too; it only skips restoring the landing scroll.
function closeLicenseScreen(forceLanding) {
  const landing = document.getElementById('landingScreen');
  const screen  = document.getElementById('licenseScreen');
  if (!landing || !screen) return;

  screen.classList.add('fading-out');
  setTimeout(() => {
    screen.classList.remove('visible', 'fading-out');
    landing.classList.remove('hidden');
    if (typeof showNewSplash === 'function') showNewSplash();
    if (typeof setFieldLinesVisible === 'function') setFieldLinesVisible(true);
    const y = forceLanding === true ? 0 : licenseLandingScrollY;
    if (typeof restoreScreenScroll === 'function') restoreScreenScroll(y);
    else window.scrollTo(0, y || 0);
  }, 280);
}

function switchLicenseTab(id) {
  if (!LICENSE_TEXTS[id] || id === licenseActiveTab) return;
  licenseActiveTab = id;
  renderLicenseTabs();
  renderLicenseText();
}

function renderLicenseTabs() {
  const nav = document.getElementById('licenseTabs');
  if (!nav) return;
  const ids = Object.keys(LICENSE_TEXTS);
  nav.hidden = ids.length < 2;
  nav.innerHTML = ids.map((id) => `
    <button type="button" class="settings-tab-btn${id === licenseActiveTab ? ' active' : ''}"
            onclick="switchLicenseTab('${id}')">${LICENSE_TEXTS[id].label}</button>
  `).join('');
}

async function renderLicenseText() {
  const id = licenseActiveTab;
  const t = LICENSE_TEXTS[id];
  const pre = document.getElementById('licenseText');
  if (!pre || !t) return;

  if (licenseTextCache[id] === undefined) {
    pre.textContent = 'Loading…';
    try {
      const res = await fetch(t.file);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      licenseTextCache[id] = await res.text();
    } catch (e) {
      if (licenseActiveTab !== id) return;
      pre.textContent = '';
      pre.append(document.createTextNode('Could not load the license text. Read it online: '));
      const a = document.createElement('a');
      a.href = t.online;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      a.textContent = t.online;
      pre.appendChild(a);
      return;
    }
  }
  if (licenseActiveTab !== id) return;      // tab switched while loading
  pre.textContent = licenseTextCache[id];
}
