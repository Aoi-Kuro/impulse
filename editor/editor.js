/* Solutions editor — layout stage.
   Reads problems live from /course/quizzes/quizN.js on THIS origin.
   Nothing is saved yet (drafts live in memory only); the key is only
   format-checked here — server-side verification comes with the backend. */

/* ── Day / night (same logic and storage key as the main site) ── */
function toggleTheme() {
  if (window.themeFadeTick) themeFadeTick();
  const isLight = document.body.classList.toggle('light');
  document.getElementById('themeTrack').classList.toggle('on', isLight);
  localStorage.setItem(STORAGE_PREFIX + '-theme', isLight ? 'light' : 'dark');
  if (window.__applyCustomOnModeChange) window.__applyCustomOnModeChange();
  if (window.__updateOnColorVars) window.__updateOnColorVars();
}
(function restoreMode() {
  if (localStorage.getItem(STORAGE_PREFIX + '-theme') === 'light') {
    document.body.classList.add('light');
    document.getElementById('themeTrack').classList.add('on');
  }
  if (window.__applyCustomOnModeChange) window.__applyCustomOnModeChange();
  if (window.__updateOnColorVars) window.__updateOnColorVars();
})();

(function () {
  'use strict';

  let editorName = null;          // set once the server confirms the key
  const P  = STORAGE_PREFIX;
  const LS = { key: P + '-editor-key', sb: P + '-editor-sidebar', split: P + '-editor-split', last: P + '-editor-last',
               prob: P + '-editor-problem-open', drafts: P + '-editor-drafts',
               state: P + '-editor-state-open' };
  const MAX_STEPS = 12;
  const $ = (id) => document.getElementById(id);
  const mqNarrow = window.matchMedia('(max-width: 720px)');

  // What the TikZ compiler gets in addition to the author's code.
  // c1/c2 are placeholder colors the site maps to the theme's accent 1 / 2.
  const TZ = {
    packages: { amsmath: '', amssymb: '' },
    libraries: 'arrows.meta,calc,positioning,angles,quotes,patterns,intersections,decorations.markings,decorations.pathreplacing,decorations.pathmorphing,shapes.geometric',
    preamble: [
      '\\definecolor{c1}{HTML}{FF0001}',
      '\\definecolor{c2}{HTML}{FF0002}',
      '\\newcount\\thestep',
      '\\newcommand{\\onstep}[2]{\\ifnum\\thestep<#1 \\else #2\\fi}',
    ],
  };
  const PREAMBLE_SHOWN = [
    '% packages: ' + Object.keys(TZ.packages).join(', '),
    '% tikz libraries: ' + TZ.libraries.split(',').join(', '),
    ...TZ.preamble,
    '% colors: c1 = accent 1, c2 = accent 2, default black = text color',
    '% \\thestep is set automatically (1..N) for each step',
    '% keep everything inside \\useasboundingbox — anything outside it is cut off',
  ].join('\n');

  document.title = `${COURSE_CODE_DISPLAY} Solutions editor`;
  $('edTitle').textContent = `${COURSE_CODE_DISPLAY} · Solutions`;
  $('edGateEyebrow').textContent = `${COURSE_CODE_DISPLAY} · Solutions editor`;
  $('edPreamble').textContent = PREAMBLE_SHOWN;

  /* ───────────────────────── key gate ───────────────────────── */
  const validKey = (k) => /^\S{32}$/.test(k || '');
  const gate = $('edGate'), keyIn = $('edKeyInput'), keyErr = $('edKeyErr');

  // The gate is not the check — the server is. A key is only accepted once
  // solutions-admin has confirmed it belongs to an editor, so a typo, a key
  // from the other course, or a revoked key is refused here rather than
  // letting someone in to a UI where nothing can ever be saved.
  function setGateBusy(busy) {
    $('edKeyGo').disabled = busy;
    $('edKeyGo').textContent = busy ? 'Checking…' : 'Continue';
    keyIn.disabled = busy;
  }
  function showGate(message) {
    gate.hidden = false;
    setGateBusy(false);
    keyErr.textContent = message || '';
    keyIn.focus();
  }

  async function submitKey() {
    const k = keyIn.value.trim();
    if (!validKey(k)) { keyErr.textContent = 'The key must be exactly 32 characters, no spaces.'; return; }
    setGateBusy(true);
    keyErr.textContent = '';
    localStorage.setItem(LS.key, k);              // store.js reads it from here
    try {
      const me = await SolutionStore.whoami();
      editorName = (me && me.name) || null;
    } catch (e) {
      localStorage.removeItem(LS.key);
      showGate(e && e.auth
        ? 'That key was not accepted. Check it, or ask for a new one.'
        : (e && e.message) || 'Could not check the key.');
      return;
    }
    keyIn.value = '';
    setGateBusy(false);
    gate.hidden = true;
    boot();
  }
  $('edKeyGo').addEventListener('click', submitKey);
  keyIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') submitKey(); });
  keyIn.addEventListener('input', () => { keyErr.textContent = ''; });
  $('edChangeKey').addEventListener('click', () => { localStorage.removeItem(LS.key); location.reload(); });

  /* ───────────────────────── "Check all" ─────────────────────────
     A full pass over the database: re-reads every stored solution and
     compares each one's problem_hash against the problem as it stands in
     the quiz files right now.

     Why it has to read every ROW and not just the index: problem_hash
     lives on the row, and the index deliberately carries only status and
     timestamps so startup stays one small request. A few hundred reads is
     fine on demand, which is exactly why this is a button rather than
     something that runs by itself.

     It also refreshes serverIndex, so it doubles as the answer to "did my
     collaborator publish anything since I opened this?" */
  let checking = false;

  function closeCheckReport() {
    const box = $('edCheck');
    box.hidden = true;
    box.textContent = '';
  }

  function checkRow(parent, p, why, stale) {
    const b = document.createElement('button');
    b.className = 'ed-check-row' + (stale ? ' stale' : '');
    const name = document.createElement('span');
    name.textContent = `Q${p.quiz} · ${p.id}`;
    const w = document.createElement('span');
    w.className = 'why';
    w.textContent = why;
    b.append(name, w);
    b.addEventListener('click', () => { select(p.key); if (mqNarrow.matches) setSidebar(false, false); });
    parent.appendChild(b);
  }

  async function runCheckAll() {
    if (checking) return;
    checking = true;
    const btn = $('edCheckAll');
    const box = $('edCheck');
    btn.textContent = 'Checking…';
    btn.disabled = true;
    box.hidden = false;
    box.textContent = '';
    const progress = document.createElement('div');
    progress.className = 'ed-check-empty';
    progress.textContent = 'Reading the database…';
    box.appendChild(progress);

    try {
      serverIndex = await SolutionStore.index();
    } catch (e) {
      box.textContent = '';
      const err = document.createElement('div');
      err.className = 'ed-check-empty';
      err.textContent = (e && e.auth) ? 'Your access key was not accepted.' : 'Could not reach the database.';
      box.appendChild(err);
      btn.textContent = 'Check all'; btn.disabled = false; checking = false;
      return;
    }

    const keys = Object.keys(serverIndex);
    const stale = [], published = [], drafted = [], orphan = [], unsaved = [];

    for (let i = 0; i < keys.length; i++) {
      const key = keys[i];
      progress.textContent = `Checking ${i + 1} / ${keys.length}…`;
      const p = byKey.get(key);
      if (!p) {
        // A row whose problem is no longer in the quiz files at all — e.g.
        // deleted outright rather than retired. Worth seeing, never silently.
        orphan.push({ key, status: serverIndex[key].status });
        continue;
      }
      let row = null;
      try { row = await SolutionStore.get(key); } catch (e) { continue; }
      if (!row) continue;
      const bucket = row.status === 'published' ? published : drafted;
      bucket.push(p);
      if (row.problem_hash && row.problem_hash !== await problemHashOf(p)) {
        stale.push({ p, status: row.status });
      }
      if (key === (cur && cur.key)) {           // keep the open problem in step
        curRow = row;
        curStale = row.problem_hash ? stale.some((s) => s.p.key === key) : null;
        refreshState();
      }
    }

    // Local-only work: typed in this browser, never saved anywhere.
    problems.forEach((p) => { if (!serverIndex[p.key] && hasContent(drafts[p.key])) unsaved.push(p); });

    renderList();                                // dots now reflect the fresh index
    if (cur) markItem(cur.key);

    // ── report ──
    box.textContent = '';
    const head = document.createElement('div');
    head.className = 'ed-check-head';
    const ht = document.createElement('span'); ht.textContent = 'Check';
    const close = document.createElement('button');
    close.className = 'ed-check-close'; close.textContent = '✕'; close.title = 'Hide';
    close.addEventListener('click', closeCheckReport);
    head.append(ht, close);
    box.appendChild(head);

    const counts = document.createElement('div');
    counts.className = 'ed-check-counts';
    const addCount = (cls, text) => {
      const s = document.createElement('span');
      s.className = 'ed-check-count ' + cls;
      s.textContent = text;
      counts.appendChild(s);
    };
    addCount('pub', `${published.length} published`);
    addCount('draft', `${drafted.length} draft`);
    if (stale.length) addCount('stale', `${stale.length} out of date`);
    if (unsaved.length) addCount('local', `${unsaved.length} unsaved here`);
    box.appendChild(counts);

    if (stale.length) {
      const g = document.createElement('div');
      g.className = 'ed-check-group';
      g.textContent = 'Problem changed since written';
      box.appendChild(g);
      stale.forEach(({ p, status }) => checkRow(box, p, status === 'published' ? 'published' : 'draft', true));
    }
    if (unsaved.length) {
      const g = document.createElement('div');
      g.className = 'ed-check-group';
      g.textContent = 'Only in this browser';
      box.appendChild(g);
      unsaved.forEach((p) => checkRow(box, p, 'not saved', false));
    }
    if (orphan.length) {
      const g = document.createElement('div');
      g.className = 'ed-check-group';
      g.textContent = 'No matching problem';
      box.appendChild(g);
      orphan.forEach((o) => {
        const b = document.createElement('div');
        b.className = 'ed-check-row stale';
        const n = document.createElement('span'); n.textContent = o.key;
        const w = document.createElement('span'); w.className = 'why'; w.textContent = o.status;
        b.append(n, w);
        box.appendChild(b);
      });
    }
    if (!stale.length && !unsaved.length && !orphan.length) {
      const ok = document.createElement('div');
      ok.className = 'ed-check-empty';
      ok.textContent = keys.length ? 'Everything matches its problem.' : 'No solutions stored yet.';
      box.appendChild(ok);
    }
    if (stale.length) {
      const note = document.createElement('div');
      note.className = 'ed-check-note';
      note.textContent = 'Out of date means the problem text, answer or units changed after the solution was saved. Open it, check the numbers, then save again to clear the flag.';
      box.appendChild(note);
    }

    btn.textContent = 'Check all';
    btn.disabled = false;
    checking = false;
  }

  $('edCheckAll').addEventListener('click', runCheckAll);

  /* ───────────────────────── sidebar ───────────────────────── */
  function setSidebar(open, persist) {
    document.body.classList.toggle('sb-closed', !open);
    if (persist) localStorage.setItem(LS.sb, open ? '1' : '0');
  }
  (function initSidebar() {
    const saved = localStorage.getItem(LS.sb);
    setSidebar(saved === null ? !mqNarrow.matches : saved === '1', false);
  })();
  $('sbToggle').addEventListener('click', () => setSidebar(document.body.classList.contains('sb-closed'), true));
  $('edScrim').addEventListener('click', () => setSidebar(false, true));

  /* ───────────────────────── split divider ───────────────────────── */
  const split = $('edSplit'), divider = $('edDivider');
  const isVertical = () => getComputedStyle(split).flexDirection === 'column';
  const clampPct = (v) => Math.min(80, Math.max(20, v));
  function setSplit(pct, persist) {
    pct = clampPct(pct);
    split.style.setProperty('--split', pct + '%');
    divider.setAttribute('aria-valuenow', String(Math.round(pct)));
    if (persist) localStorage.setItem(LS.split, String(pct));
    return pct;
  }
  (function initSplit() {
    const v = parseFloat(localStorage.getItem(LS.split));
    if (!isNaN(v)) setSplit(v, false);
  })();
  divider.addEventListener('pointerdown', (e) => {
    divider.setPointerCapture(e.pointerId);
    document.body.classList.add('dragging');
    document.body.classList.toggle('vert', isVertical());
    e.preventDefault();
  });
  divider.addEventListener('pointermove', (e) => {
    if (!divider.hasPointerCapture(e.pointerId)) return;
    const r = split.getBoundingClientRect();
    const pct = isVertical() ? ((e.clientY - r.top) / r.height) * 100 : ((e.clientX - r.left) / r.width) * 100;
    setSplit(pct, false);
  });
  const endDrag = (e) => {
    if (!divider.hasPointerCapture(e.pointerId)) return;
    divider.releasePointerCapture(e.pointerId);
    document.body.classList.remove('dragging', 'vert');
    const v = parseFloat(split.style.getPropertyValue('--split'));
    if (!isNaN(v)) localStorage.setItem(LS.split, String(v));
  };
  divider.addEventListener('pointerup', endDrag);
  divider.addEventListener('pointercancel', endDrag);
  divider.addEventListener('dblclick', () => setSplit(50, true));
  divider.addEventListener('keydown', (e) => {
    const cur = parseFloat(split.style.getPropertyValue('--split')) || 50;
    const back = isVertical() ? 'ArrowUp' : 'ArrowLeft', fwd = isVertical() ? 'ArrowDown' : 'ArrowRight';
    if (e.key === back) { setSplit(cur - 2, true); e.preventDefault(); }
    else if (e.key === fwd) { setSplit(cur + 2, true); e.preventDefault(); }
  });

  /* ───────────────────────── problems (fetched live) ───────────────────────── */
  const BASE = location.origin;          // each course's editor reads its own site
  let problems = [];
  const byKey = new Map();

  async function loadQuiz(n) {
    try {
      const res = await fetch(`${BASE}/course/quizzes/quiz${n}.js?t=${Date.now()}`, { cache: 'no-store' });
      if (!res.ok) return null;
      const src = await res.text();
      const out = new Function(src + `;return {
        problems: typeof Quiz_${n}_Problems !== 'undefined' ? Quiz_${n}_Problems : [],
        retired:  typeof Quiz_${n}_Retired  !== 'undefined' ? Quiz_${n}_Retired  : []
      };`)();
      return { n, problems: out.problems, retired: out.retired };
    } catch (e) { return null; }         // missing file, fallback HTML page, syntax error
  }

  async function loadAllProblems() {
    const quizzes = (await Promise.all([1, 2, 3, 4].map(loadQuiz))).filter((q) => q && q.problems.length);
    const mk = (q, p, pos, retired) => ({
      key: `q${q.n}_${p.id}`, quiz: q.n, pos, retired, id: p.id, topic: p.topic || '',
      text: p.text || '', answer: p.answer, units: p.units,
    });
    return quizzes.flatMap((q) => [
      ...q.problems.map((p, i) => mk(q, p, i + 1, false)),
      ...q.retired.map((p) => mk(q, p, null, true)),
    ]);
  }

  /* ───────────────────────── drafts (this browser only, for now) ───────────────────────── */
  let drafts = {};
  try { drafts = JSON.parse(localStorage.getItem(LS.drafts) || '{}') || {}; } catch (e) { drafts = {}; }
  let saveTimer = null;
  function persistDrafts() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      try { localStorage.setItem(LS.drafts, JSON.stringify(drafts)); } catch (e) { /* quota: ignore */ }
    }, 500);
  }
  const hasContent = (d) => !!(d && (d.tikz.trim() || d.solution.trim() || (d.captions || []).some((c) => c && c.trim())));

  // What the server has: problem_key -> { status, updated_at }. Filled at boot
  // by SolutionStore.index(), kept in step with every save/remove.
  let serverIndex = {};
  // The full row for the problem on screen (null = nothing stored yet), plus
  // the compiled SVGs of the figure currently in the preview.
  let curRow = null;
  let curStale = null;         // true when the problem changed after the row was saved
  let curSvgs = [];
  let curSvgSrc = '';          // the TikZ those SVGs were compiled from
  let cur = null;
  const draft = () => (drafts[cur.key] ||= { tikz: '', captions: [], solution: '' });

  /* ───────────────────────── sidebar list ───────────────────────── */
  function renderList() {
    const box = $('edList');
    box.textContent = '';
    const counts = {};
    problems.forEach((p) => { counts[p.quiz] = (counts[p.quiz] || 0) + 1; });
    let lastQ = 0;
    const frag = document.createDocumentFragment();
    problems.forEach((p) => {
      if (p.quiz !== lastQ) {
        lastQ = p.quiz;
        const h = document.createElement('div');
        h.className = 'ed-group';
        const a = document.createElement('span'); a.textContent = `Q${p.quiz}`;
        const b = document.createElement('span'); b.textContent = String(counts[p.quiz]);
        h.append(a, b);
        frag.appendChild(h);
      }
      const btn = document.createElement('button');
      btn.className = 'ed-item' + (p.retired ? ' retired' : '') + itemClasses(p.key);
      btn.dataset.key = p.key;
      const l = document.createElement('span'); l.textContent = `Q${p.quiz} · ${p.id}`;
      const dot = document.createElement('i'); dot.className = 'dot';
      // Tooltip follows the colour: green = published, amber = saved draft,
      // grey = typed here only. (It used to say "Has a draft" on all three.)
      const st = serverIndex[p.key];
      dot.title = st ? (st.status === 'published' ? 'Published' : 'Saved as draft')
                     : 'Unsaved — only in this browser';
      const r = document.createElement('span'); r.className = 'pos'; r.textContent = p.retired ? 'DEL' : `#${p.pos}`;
      btn.append(l, dot, r);
      btn.addEventListener('click', () => { select(p.key); if (mqNarrow.matches) setSidebar(false, false); });
      frag.appendChild(btn);
    });
    box.appendChild(frag);
    $('edCount').textContent = String(problems.length);
  }
  // "has" = there is something to show a dot for; colour = server status;
  // "dirty" = the window differs from what the server has.
  function itemClasses(key) {
    const srv = serverIndex[key];
    const local = drafts[key];
    let c = (srv || hasContent(local)) ? ' has' : '';
    if (srv) c += srv.status === 'published' ? ' st-pub' : ' st-draft';
    if (isDirty(key)) c += ' dirty';
    return c;
  }
  function markItem(key) {
    key = key || (cur && cur.key);
    if (!key) return;
    const it = $('edList').querySelector(`.ed-item[data-key="${CSS.escape(key)}"]`);
    if (!it) return;
    const p = byKey.get(key);
    it.className = 'ed-item' + (p && p.retired ? ' retired' : '') + itemClasses(key) + (cur && cur.key === key ? ' active' : '');
  }

  /* ───────────────────────── problem panel (hidable) ───────────────────────── */
  function setProbOpen(open, persist) {
    document.body.classList.toggle('prob-closed', !open);
    $('edProbToggle').setAttribute('aria-expanded', String(open));
    if (persist) localStorage.setItem(LS.prob, open ? '1' : '0');
  }
  (function () {
    const saved = localStorage.getItem(LS.prob);
    setProbOpen(saved === null ? !mqNarrow.matches : saved === '1', false);
  })();
  $('edProbToggle').addEventListener('click', () => setProbOpen(document.body.classList.contains('prob-closed'), true));

  function showProblem(p) {
    $('edProbKey').textContent = `Q${p.quiz} · ${p.id}`;
    $('edProbMeta').textContent = [p.retired ? 'retired (DEL)' : `position #${p.pos}`, p.topic].filter(Boolean).join(' · ');
    // Problem text is the site's own trusted content (HTML + $math$), rendered exactly like on the site.
    $('edProbText').innerHTML = p.text;
    const ans = Array.isArray(p.answer) ? p.answer.join(' ; ') : (p.answer == null ? '—' : String(p.answer));
    const units = Array.isArray(p.units) && p.units.length ? ' ' + p.units.join(' | ') : '';
    const a = $('edProbAns');
    a.textContent = 'Accepted answer: ';
    const b = document.createElement('b'); b.textContent = ans + units;
    a.appendChild(b);
    renderMathIn($('edProbText'));
  }

  /* ───────────────────────── captions + step viewer ───────────────────────── */
  const tikzEl = $('edTikz'), solEl = $('edSol'), capsEl = $('edCaps');

  // Highest N in \onstep{N}, ignoring TeX comments; 1 when there are no steps.
  function detectSteps(src) {
    const clean = src.replace(/(^|[^\\])%.*$/gm, '$1');
    let n = 0;
    for (const m of clean.matchAll(/\\onstep\s*\{\s*(\d+)\s*\}/g)) n = Math.max(n, +m[1]);
    return { n: Math.min(Math.max(n, 1), MAX_STEPS), hasSteps: n > 0 };
  }

  let stepState = { n: 1, hasSteps: false }, viewStep = 1;

  function renderCaptions() {
    const d = draft();
    capsEl.textContent = '';
    for (let i = 0; i < stepState.n; i++) {
      const row = document.createElement('label'); row.className = 'ed-cap';
      const tag = document.createElement('span'); tag.textContent = stepState.hasSteps ? `Step ${i + 1}` : 'Caption';
      const inp = document.createElement('input');
      inp.className = 'ed-input'; inp.type = 'text'; inp.spellcheck = false;
      inp.placeholder = 'optional · $…$ allowed';
      inp.value = d.captions[i] || '';
      inp.addEventListener('input', () => { d.captions[i] = inp.value; persistDrafts(); markItem(); refreshState(); renderCaption(); });
      row.append(tag, inp);
      capsEl.appendChild(row);
    }
  }

  function renderCaption() {
    const el = $('edCapShow');
    const t = cur ? (draft().captions[viewStep - 1] || '') : '';
    if (!t.trim()) { if (window.MathJax && MathJax.typesetClear) { try { MathJax.typesetClear([el]); } catch (e) {} } el.textContent = ''; return; }
    renderSolutionInto(el, t);
  }

  function renderViewer() {
    const { n } = stepState;
    viewStep = Math.min(Math.max(viewStep, 1), n);
    $('edStepBadge').textContent = stepState.hasSteps ? `${n} step${n > 1 ? 's' : ''}` : 'static';
    $('edViewer').style.display = n > 1 ? '' : 'none';
    $('edPrev').disabled = viewStep <= 1;
    $('edNext').disabled = viewStep >= n;
    $('edStepNo').textContent = `Step ${viewStep} / ${n}`;
    const dots = $('edDots'); dots.textContent = '';
    for (let i = 1; i <= n; i++) { const dot = document.createElement('i'); if (i === viewStep) dot.className = 'on'; dots.appendChild(dot); }
    $('edStage').querySelectorAll('.fig-step').forEach((el, i) => el.classList.toggle('on', i === viewStep - 1));
    renderCaption();
  }

  $('edPrev').addEventListener('click', () => { viewStep--; renderViewer(); });
  $('edNext').addEventListener('click', () => { viewStep++; renderViewer(); });
  document.addEventListener('keydown', (e) => {
    if (e.target && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
    if (e.key === 'ArrowLeft'  && !$('edPrev').disabled) $('edPrev').click();
    if (e.key === 'ArrowRight' && !$('edNext').disabled) $('edNext').click();
  });

  /* ───────────────────────── TikZ compile (TikZJax, in the browser) ───────────────────────── */
  const stage = $('edStage'), statusEl = $('edStatus'), warnEl = $('edWarn');
  const logWrap = $('edLogWrap'), logEl = $('edLog');
  const svgCache = new Map();            // "k|tikz" -> normalized svg string
  let compileChain = Promise.resolve();  // TeX runs one at a time
  let compileGen = 0;                    // bumped on every edit; stale runs stop early

  function setStatus(text, cls) { statusEl.textContent = text; statusEl.className = 'ed-status ' + (cls || ''); }
  function showWarn(html, isErr) {
    warnEl.hidden = !html;
    warnEl.className = 'ed-warn' + (isErr ? ' err' : '');
    warnEl.textContent = '';
    if (html) warnEl.append(...html);
  }
  function showLog(lines) {
    logWrap.hidden = !lines || !lines.length;
    logEl.textContent = (lines || []).join('\n');
  }

  function tikzScript(src, k) {
    const s = document.createElement('script');
    s.type = 'text/tikz';
    s.dataset.disableCache = 'true';
    s.dataset.showConsole = 'true';
    s.dataset.texPackages = JSON.stringify(TZ.packages);
    s.dataset.tikzLibraries = TZ.libraries;
    s.dataset.addToPreamble = TZ.preamble.join('') + `\\thestep=${k}`;
    s.textContent = src;
    return s;
  }

  // Compiles ONE step. Resolves {svg} or {error, log}. Never rejects.
  function compileOne(src, k) {
    return new Promise((resolve) => {
      // The script MUST already be inside the holder when the holder is
      // attached. Appending the holder first and the script second gives
      // TikZJax's MutationObserver two records that both match the same
      // script, so it processes it twice, loses track of the live loader,
      // and ends up firing its finished event on a detached SVG — the
      // compile then hangs forever. One append, one record, one run.
      const holder = document.createElement('div');
      holder.style.cssText = 'position:fixed;left:-99999px;top:0;width:1px;height:1px;overflow:hidden';
      const logs = [];
      const origLog = console.log;
      let done = false, timer = null;

      const finish = (result) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        console.log = origLog;
        document.removeEventListener('tikzjax-load-finished', onOk);
        mo.disconnect();
        holder.remove();
        result.log = logs;
        resolve(result);
      };
      const onOk = (e) => {
        const svg = e.srcElement || e.target;
        if (svg && holder.contains(svg)) finish({ svg: svg.outerHTML });
      };
      // TikZJax replaces the <script> with an <img> when TeX fails
      const mo = new MutationObserver((muts) => {
        for (const m of muts) for (const n of m.addedNodes) {
          if (n.nodeName === 'IMG') { finish({ error: true }); return; }
        }
      });
      console.log = function (...a) { logs.push(a.map(String).join(' ')); };
      document.addEventListener('tikzjax-load-finished', onOk);
      mo.observe(holder, { childList: true, subtree: true });
      timer = setTimeout(() => finish({ error: true, timeout: true }), 90000);
      holder.appendChild(tikzScript(src, k));
      document.body.appendChild(holder);
    });
  }

  // Pulls the first "! ..." error and its source line out of a TeX log.
  function texErrorSummary(logs) {
    const text = logs.join('\n').split('\n');
    const i = text.findIndex((l) => l.startsWith('!'));
    if (i < 0) return null;
    const msg = text[i].replace(/^!\s*/, '');
    const ctx = text.slice(i + 1, i + 6).find((l) => /^l\.\d+/.test(l));
    return { msg, ctx: ctx ? ctx.trim() : '' };
  }

  function clearStage(msg) {
    stage.className = 'ed-stage fig';
    stage.textContent = '';
    const sp = document.createElement('span'); sp.className = 'ed-empty'; sp.textContent = msg;
    stage.appendChild(sp);
  }

  function mountSteps(svgs) {
    stage.className = 'ed-stage fig has-fig';
    stage.textContent = '';
    const wrap = document.createElement('div'); wrap.className = 'fig-steps';
    svgs.forEach((svg, i) => {
      const d = document.createElement('div'); d.className = 'fig-step';
      d.innerHTML = figSanitizeSvg(svg);
      wrap.appendChild(d);
    });
    stage.appendChild(wrap);
    renderViewer();
  }

  function compileFigure(src, steps, gen) {
    return new Promise((resolve) => {
      compileChain = compileChain.then(async () => {
        const t0 = performance.now();
        const out = [];
        let lastLog = [];
        for (let k = 1; k <= steps.n; k++) {
          if (gen !== compileGen) return resolve(null);     // superseded by a newer edit
          const key = `${k}|${steps.hasSteps ? 1 : 0}|${src}`;
          if (svgCache.has(key)) { out.push(svgCache.get(key)); continue; }
          if (steps.n > 1) setStatus(`compiling ${k}/${steps.n}…`, 'busy');
          const r = await compileOne(src, k);
          lastLog = r.log;
          if (r.error) return resolve({ error: true, step: k, log: r.log, timeout: r.timeout });
          let norm;
          try { norm = figNormalizeSvg(r.svg, `f${k}-`); }
          catch (e) { return resolve({ error: true, step: k, log: [String(e.message || e)] }); }
          svgCache.set(key, norm);
          if (svgCache.size > 60) svgCache.delete(svgCache.keys().next().value);
          out.push(norm);
        }
        resolve({ svgs: out, ms: performance.now() - t0, log: lastLog });
      });
    });
  }

  let compileTimer = null;
  function scheduleCompile() {
    clearTimeout(compileTimer);
    const gen = ++compileGen;
    const src = tikzEl.value;
    if (!src.trim()) { curSvgs = []; curSvgSrc = ''; clearStage('No figure'); showWarn(null); showLog(null); setStatus('', ''); renderViewer(); refreshState(); return; }
    setStatus('typing…', '');
    compileTimer = setTimeout(async () => {
      if (gen !== compileGen) return;
      setStatus('compiling…', 'busy');
      const steps = stepState;
      const res = await compileFigure(src, steps, gen);
      if (!res || gen !== compileGen) return;
      if (res.error) {
        const sum = texErrorSummary(res.log || []);
        setStatus('error', 'err');
        const nodes = [];
        const b = document.createElement('b');
        b.textContent = res.timeout ? 'Compile timed out. ' : (steps.hasSteps ? `Step ${res.step}: ` : '');
        nodes.push(b);
        if (sum) {
          nodes.push(document.createTextNode(sum.msg));
          if (sum.ctx) { const c = document.createElement('div'); const code = document.createElement('code'); code.textContent = sum.ctx; c.appendChild(code); nodes.push(c); }
        } else if (!res.timeout) {
          nodes.push(document.createTextNode('TeX could not compile this figure.'));
        }
        showWarn(nodes, true);
        showLog(res.log || []);
        // keep the last good figure on screen
        return;
      }
      showLog(null);
      curSvgs = res.svgs; curSvgSrc = src;
      mountSteps(res.svgs);
      refreshState();
      setStatus(`ok · ${res.svgs.length} step${res.svgs.length > 1 ? 's' : ''} · ${(res.ms / 1000).toFixed(1)} s`, 'ok');
      const boxes = new Set(res.svgs.map(figViewBox));
      if (boxes.size > 1) {
        const b = document.createElement('b'); b.textContent = 'The figure changes size between steps. ';
        const t = document.createTextNode('Add a fixed box at the start, e.g. ');
        const code = document.createElement('code'); code.textContent = '\\useasboundingbox (0,0) rectangle (8,5);';
        showWarn([b, t, code, document.createTextNode(' (use the same numbers in every step).')], false);
      } else showWarn(null);
    }, 700);
  }

  /* ───────────────────────── solution preview ───────────────────────── */
  const solView = $('edSolView');
  let solTimer = null;
  function renderSolPreview() {
    const t = solEl.value;
    if (!t.trim()) {
      if (window.MathJax && MathJax.typesetClear) { try { MathJax.typesetClear([solView]); } catch (e) {} }
      solView.className = 'ed-solview sol-text';
      solView.textContent = '';
      const sp = document.createElement('span'); sp.className = 'ed-empty'; sp.textContent = 'Nothing to show yet';
      solView.appendChild(sp);
      return;
    }
    solView.className = 'ed-solview sol-text has';
    renderSolutionInto(solView, t);
  }

  /* ───────────────────────── inputs ───────────────────────── */
  tikzEl.addEventListener('input', () => {
    if (!cur) return;
    draft().tikz = tikzEl.value; persistDrafts(); markItem(); refreshState();
    const next = detectSteps(tikzEl.value);
    const changed = next.n !== stepState.n || next.hasSteps !== stepState.hasSteps;
    stepState = next;
    if (changed) renderCaptions();
    renderViewer();
    scheduleCompile();
  });
  solEl.addEventListener('input', () => {
    if (!cur) return;
    draft().solution = solEl.value; persistDrafts(); markItem(); refreshState();
    clearTimeout(solTimer); solTimer = setTimeout(renderSolPreview, 200);
  });

  /* ───────────────────────── state panel ───────────────────────── */
  const stPill = $('edStatePill'), stMsg = $('edStMsg'), stNote = $('edStNote');

  function setStateOpen(open, persist) {
    document.body.classList.toggle('state-closed', !open);
    $('edStateToggle').setAttribute('aria-expanded', String(open));
    if (persist) localStorage.setItem(LS.state, open ? '1' : '0');
  }
  (function () {
    const saved = localStorage.getItem(LS.state);
    setStateOpen(saved === null ? !mqNarrow.matches : saved === '1', false);
  })();
  $('edStateToggle').addEventListener('click', () => setStateOpen(document.body.classList.contains('state-closed'), true));

  // Hash of the problem the solution was written against (text + accepted
  // answer), stored with the row so a solution can be flagged stale if the
  // problem is edited later. Same idea as js/math-cache.js's hashing.
  async function problemHashOf(p) {
    const src = `${p.text}\u0000${JSON.stringify(p.answer)}\u0000${JSON.stringify(p.units || [])}`;
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(src));
    return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 32);
  }

  // What would be sent to the server for the problem on screen.
  function payloadOf(key) {
    const d = drafts[key] || { tikz: '', captions: [], solution: '' };
    const n = detectSteps(d.tikz).n;
    const steps = [];
    // Freshly compiled SVGs when the figure in the window is what was
    // compiled; otherwise the ones already stored (so re-saving a problem
    // whose figure was never touched doesn't need a recompile).
    const stored = ((rowFigure(key) || {}).steps || []).map((s) => s.svg);
    const fresh = (key === (cur && cur.key) && curSvgSrc === d.tikz) ? curSvgs : null;
    const svgs = fresh || ((rowFigure(key) && rowFigure(key).tikz === d.tikz) ? stored : []);
    for (let i = 0; i < (d.tikz.trim() ? n : 0); i++) {
      steps.push({ svg: svgs[i] || '', caption: (d.captions[i] || '').trim() });
    }
    return { solution: d.solution, figure: { tikz: d.tikz, steps } };
  }
  function rowFigure(key) {
    const r = (key === (cur && cur.key)) ? curRow : null;
    return r ? r.figure : null;
  }
  const sameAsRow = (key) => {
    const row = (key === (cur && cur.key)) ? curRow : null;
    if (!row) return false;
    const p = payloadOf(key);
    return p.solution === row.solution &&
           p.figure.tikz === (row.figure ? row.figure.tikz : '') &&
           JSON.stringify(p.figure.steps.map((s) => s.caption)) === JSON.stringify((row.figure ? row.figure.steps : []).map((s) => s.caption));
  };
  function isDirty(key) {
    if (key !== (cur && cur.key)) return false;      // only the open problem is compared
    if (!curRow) return hasContent(drafts[key]);
    return !sameAsRow(key);
  }

  const fmtWhen = (iso) => {
    if (!iso) return '—';
    const d = new Date(iso);
    return isNaN(d) ? '—' : d.toLocaleString();
  };
  function setMsg(text, cls) { stMsg.textContent = text || ''; stMsg.className = 'ed-state-msg ' + (cls || ''); }
  function hideNote() { stNote.hidden = true; stNote.textContent = ''; }

  // A confirmation that replaces the buttons' job: title text + Confirm/Cancel.
  function askConfirm(text, confirmLabel, onYes) {
    stNote.hidden = false;
    stNote.textContent = '';
    const p = document.createElement('div'); p.textContent = text;
    const row = document.createElement('div'); row.className = 'ed-state-actions';
    const yes = document.createElement('button'); yes.className = 'ed-abtn danger'; yes.textContent = confirmLabel;
    const no = document.createElement('button'); no.className = 'ed-abtn'; no.textContent = 'Cancel';
    yes.addEventListener('click', () => { hideNote(); onYes(); });
    no.addEventListener('click', hideNote);
    row.append(yes, no);
    stNote.append(p, row);
  }

  function refreshState() {
    const key = cur && cur.key;
    if (!key) return;
    const status = curRow ? curRow.status : null;
    const dirty = isDirty(key);
    const missingSvg = payloadOf(key).figure.steps.some((s) => !s.svg);

    stPill.className = 'ed-pill ' + (status === 'published' ? 'pub' : status === 'draft' ? 'draft' : dirty ? 'dirty' : 'none');
    stPill.textContent = status === 'published' ? 'published' : status === 'draft' ? 'draft' : dirty ? 'unsaved' : 'empty';

    $('edStCurrent').textContent = status === 'published' ? 'Published — visible on the site'
      : status === 'draft' ? 'Draft — not visible on the site'
      : 'Nothing saved for this problem yet';
    $('edStSync').textContent = dirty ? (curRow ? 'Unsaved changes in this window' : 'Not saved yet')
      : curRow ? 'Matches the database' : 'Empty';
    $('edStWhen').textContent = curRow ? fmtWhen(curRow.updated_at) : '—';
    $('edStAuthor').textContent = (curRow && curRow.author) || '—';
    $('edStStale').textContent = curRow ? (curRow.problem_hash && curStale === true ? 'the problem changed since this was written' : 'no') : '—';
    $('edStStale').className = (curRow && curStale === true) ? 'ed-stale' : '';

    const empty = !hasContent(drafts[key]);
    $('edBtnPublish').disabled = empty || missingSvg;
    $('edBtnPublish').textContent = status === 'published' ? (dirty ? 'Publish changes' : 'Published') : 'Publish';
    $('edBtnSave').disabled = empty || !dirty;
    $('edBtnUnpublish').disabled = status !== 'published';
    $('edBtnReload').disabled = !curRow;
    $('edBtnClear').disabled = !curRow && empty;
    if (missingSvg && !empty) setMsg('Waiting for the figure to compile before it can be published.', '');
    else if (stMsg.className.indexOf('ok') === -1 && stMsg.className.indexOf('err') === -1) setMsg('');
  }

  async function doSave(status) {
    const key = cur.key;
    setMsg('Saving…', '');
    try {
      const problem_hash = await problemHashOf(cur);
      const row = await SolutionStore.save(key, Object.assign(payloadOf(key), { status, problem_hash }), curRow ? curRow.updated_at : null);
      if (cur.key !== key) return;                           // moved on meanwhile
      curRow = row;
      curStale = false;
      serverIndex[key] = { status: row.status, updated_at: row.updated_at };
      markItem(key);
      refreshState();
      setMsg(status === 'published' ? 'Published.' : 'Draft saved.', 'ok');
    } catch (e) {
      if (e && e.conflict) {
        setMsg('', 'err');
        askConfirm('Someone else saved this problem while you were editing it. Loading their version will erase what is in your window.',
          'Load theirs', () => doReload());
      } else if (e && e.auth) {
        setMsg('Your access key was not accepted. Use "Change key" to enter it again.', 'err');
      } else {
        setMsg('Could not save: ' + (e && e.message ? e.message : e), 'err');
      }
      refreshState();
    }
  }

  async function doReload() {
    const key = cur.key;
    setMsg('Loading…', '');
    try {
      const row = await SolutionStore.get(key);
      if (cur.key !== key) return;
      curRow = row;
      curStale = row && row.problem_hash ? (row.problem_hash !== await problemHashOf(cur)) : null;
      if (row) {
        drafts[key] = {
          tikz: (row.figure && row.figure.tikz) || '',
          captions: ((row.figure && row.figure.steps) || []).map((s) => s.caption || ''),
          solution: row.solution || '',
        };
        serverIndex[key] = { status: row.status, updated_at: row.updated_at };
      } else {
        delete serverIndex[key];
      }
      persistDrafts();
      loadIntoFields();
      markItem(key);
      refreshState();
      setMsg(row ? 'Loaded from the database.' : 'Nothing is stored for this problem.', 'ok');
    } catch (e) {
      setMsg('Could not load: ' + (e && e.message ? e.message : e), 'err');
    }
  }

  $('edBtnPublish').addEventListener('click', () => doSave('published'));
  $('edBtnSave').addEventListener('click', () => doSave('draft'));
  $('edBtnUnpublish').addEventListener('click', () => {
    askConfirm('Unpublishing hides this solution on the site immediately. The text stays here as a draft.',
      'Unpublish', () => doSave('draft'));
  });
  $('edBtnReload').addEventListener('click', () => {
    askConfirm('This loads the latest version from the database and erases everything in this window for this problem.',
      'Load and erase', () => doReload());
  });
  $('edBtnClear').addEventListener('click', () => {
    askConfirm('This deletes the stored solution for this problem and empties the fields. It cannot be undone.',
      'Delete', async () => {
        const key = cur.key;
        setMsg('Deleting…', '');
        try {
          await SolutionStore.remove(key);
          delete serverIndex[key];
          delete drafts[key];
          persistDrafts();
          curRow = null; curStale = null; curSvgs = []; curSvgSrc = '';
          loadIntoFields();
          markItem(key);
          refreshState();
          setMsg('Deleted.', 'ok');
        } catch (e) { setMsg('Could not delete: ' + (e && e.message ? e.message : e), 'err'); }
      });
  });
  $('edBtnExport').addEventListener('click', async () => {
    const all = await SolutionStore.exportAll();
    const blob = new Blob([JSON.stringify(all, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${STORAGE_PREFIX}-solutions-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    setMsg(`Exported ${Object.keys(all).length} solution(s).`, 'ok');
  });

  // Puts the current draft into the fields and refreshes both previews.
  function loadIntoFields() {
    const d = draft();
    tikzEl.disabled = solEl.disabled = false;
    tikzEl.value = d.tikz;
    solEl.value = d.solution;
    viewStep = 1;
    stepState = detectSteps(d.tikz);
    renderCaptions();
    renderSolPreview();
    showWarn(null); showLog(null);
    curSvgs = []; curSvgSrc = '';
    if (d.tikz.trim()) { renderViewer(); scheduleCompile(); }
    else { clearStage('No figure'); setStatus('', ''); renderViewer(); }
  }

  async function select(key) {
    const p = byKey.get(key);
    if (!p) return;
    cur = p;
    document.querySelectorAll('.ed-item.active').forEach((el) => el.classList.remove('active'));
    const item = $('edList').querySelector(`.ed-item[data-key="${CSS.escape(key)}"]`);
    if (item) { item.classList.add('active'); item.scrollIntoView({ block: 'nearest' }); }

    showProblem(p);
    curRow = null; curStale = null;
    hideNote(); setMsg('');
    loadIntoFields();
    refreshState();
    localStorage.setItem(LS.last, key);

    // The row itself is only fetched for the problem being opened.
    if (serverIndex[key]) {
      try {
        const row = await SolutionStore.get(key);
        if (cur.key !== key) return;
        curRow = row;
        curStale = row && row.problem_hash ? (row.problem_hash !== await problemHashOf(cur)) : null;
        if (cur.key !== key) return;
        refreshState();
      } catch (e) {
        setMsg(e && e.auth ? 'Your access key was not accepted. Use "Change key" to enter it again.'
                           : 'Could not read this problem from the database.', 'err');
      }
    }
  }

  /* ───────────────────────── boot ───────────────────────── */
  let booted = false;
  async function boot() {
    if (booted) return;
    booted = true;
    if (editorName === null) {
      // Reload path: the key is already stored, so confirm it still works
      // before showing the editor at all.
      try {
        const me = await SolutionStore.whoami();
        editorName = (me && me.name) || null;
      } catch (e) {
        booted = false;
        if (e && e.auth) localStorage.removeItem(LS.key);   // revoked / wrong key
        showGate(e && e.auth
          ? 'That key was not accepted. Check it, or ask for a new one.'
          : (e && e.message) || 'Could not reach the server.');
        return;
      }
    }
    $('edWho').textContent = '';
    $('edWho').append(document.createTextNode('· signed in as '));
    const who = document.createElement('b');
    who.textContent = editorName ? '@' + editorName : 'editor';
    $('edWho').appendChild(who);
    try { serverIndex = await SolutionStore.index(); } catch (e) { serverIndex = {}; }
    if (SolutionStore.isMock) {
      const w = $('edWho');
      const m = document.createElement('span'); m.className = 'ed-mock'; m.textContent = ' · offline stand-in';
      w.appendChild(m);
    }
    problems = await loadAllProblems();
    if (!problems.length) {
      $('edList').textContent = '';
      const n = document.createElement('div'); n.className = 'ed-note';
      n.textContent = 'Could not load the problem files. ';
      const retry = document.createElement('button'); retry.className = 'ed-link'; retry.textContent = 'Retry';
      retry.addEventListener('click', () => { booted = false; $('edList').textContent = 'Loading problems…'; boot(); });
      n.appendChild(retry); $('edList').appendChild(n);
      return;
    }
    problems.forEach((p) => byKey.set(p.key, p));
    renderList();
    const last = localStorage.getItem(LS.last);
    select(byKey.has(last) ? last : problems[0].key);
  }

  renderViewer();
  if (validKey(localStorage.getItem(LS.key))) boot();
  else showGate('');
})();
