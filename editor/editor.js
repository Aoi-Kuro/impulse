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
               drafts: P + '-editor-drafts', history: P + '-editor-history' };
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
      '\\definecolor{c3}{HTML}{FF0003}',
      '\\definecolor{c4}{HTML}{FF0004}',
      '\\colorlet{ctext}{black}\\colorlet{cbg}{c3}\\colorlet{csurface}{c4}',
      '\\newcount\\thestep',
      '\\newcommand{\\onstep}[2]{\\ifnum\\thestep<#1 \\else #2\\fi}',
      // same as the site-wide MathJax macros (index.html etc.)
      '\\newcommand{\\dd}[1]{\\mathrm{d}#1}',
      '\\newcommand{\\dv}[3][]{\\frac{\\mathrm{d}^{#1}#2}{\\mathrm{d}#3^{#1}}}',
      '\\newcommand{\\pdv}[3][]{\\frac{\\partial^{#1}#2}{\\partial #3^{#1}}}',
      '\\newcommand{\\vb}[1]{\\mathbf{#1}}',
      '\\newcommand{\\vu}[1]{\\hat{\\mathbf{#1}}}',
      '\\newcommand{\\abs}[1]{\\left|#1\\right|}',
      '\\newcommand{\\norm}[1]{\\left\\|#1\\right\\|}',
    ],
  };
  const PREAMBLE_SHOWN = [
    '% packages: ' + Object.keys(TZ.packages).join(', '),
    '% tikz libraries: ' + TZ.libraries.split(',').join(', '),
    ...TZ.preamble,
    '% colors — each one follows the reader\'s theme:',
    '%   (default)  = text color      ctext   same thing, by name',
    '%   c1         = accent 1        c2      accent 2',
    '%   c3 / cbg   = page background c4 / csurface = card background',
    '%   use cbg or csurface as a FILL to hide what is behind a label',
    '% \\thestep is set automatically (1..N) for each step',
    '% keep everything inside \\useasboundingbox — anything outside it is cut off',
  ].join('\n');

  // The SVG-mode counterpart of the preamble (rules: editor/svg-figure.js).
  const SVG_HELP = [
    'Only the drawing itself: no <svg …> header (a whole pasted file works too,',
    'its header is ignored).',
    '',
    'colors — each one follows the reader\'s theme:',
    '  #000 = text color     #f00 = accent 1',
    '  #00f = accent 2       #eee = card background (surface)',
    '  any other color stays fixed: Layers & colours lists them to map',
    '',
    'steps — layers are top-level groups, bottom (first) = step 1:',
    '  <g data-layer="Name"> … </g>   (Inkscape layers and plain <g> work too)',
    '  each layer appears at the next step and stays',
    '  data-steps="3" on a layer gives it 3 steps of its own,',
    '  data-step="2" on an element inside it shows it from the 2nd of those',
    '  anything outside every layer is always shown',
    '',
    'box — fitted to what is drawn; type x y width height to clip instead',
  ].join('\n');

  document.title = `${COURSE_CODE_DISPLAY} Solutions editor`;
  $('edGateEyebrow').textContent = `${COURSE_CODE_DISPLAY} · Solutions editor`;
  $('edPreamble').textContent = PREAMBLE_SHOWN;
  $('edSvgHelp').textContent = SVG_HELP;

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

  /* ───────────────────────── small floating panels ─────────────────────────
     One at a time; closes on outside tap, Escape, or a second tap on its
     button. place(pop, rect) positions it against the anchor's rect. */
  let floatPop = null, floatAnchor = null;
  function closeFloat() {
    if (!floatPop) return;
    document.removeEventListener('pointerdown', onFloatOutside, true);
    document.removeEventListener('keydown', onFloatKey, true);
    floatPop.remove();
    floatPop = floatAnchor = null;
  }
  function onFloatOutside(e) {
    if (floatPop && !floatPop.contains(e.target) && !(floatAnchor && floatAnchor.contains(e.target))) closeFloat();
  }
  function onFloatKey(e) { if (e.key === 'Escape') closeFloat(); }
  function openFloat(anchor, build, place) {
    const again = floatAnchor === anchor;
    closeFloat();
    if (again) return null;
    const pop = document.createElement('div');
    pop.className = 'ed-colorpop ed-float';
    pop.setAttribute('role', 'dialog');
    build(pop);
    document.body.appendChild(pop);
    floatPop = pop; floatAnchor = anchor;
    place(pop, anchor.getBoundingClientRect());
    setTimeout(() => {
      document.addEventListener('pointerdown', onFloatOutside, true);
      document.addEventListener('keydown', onFloatKey, true);
    }, 0);
    return pop;
  }
  const clampX = (x, pop) => Math.max(8, Math.min(x, window.innerWidth - pop.offsetWidth - 8));
  const clampY = (y, pop) => Math.max(8, Math.min(y, window.innerHeight - pop.offsetHeight - 8));
  function floatHead(pop, title) {
    const head = document.createElement('div'); head.className = 'ed-cp-head';
    const t = document.createElement('span'); t.textContent = title;
    const x = document.createElement('button'); x.className = 'ed-cp-close'; x.textContent = '✕'; x.title = 'Close';
    x.addEventListener('click', closeFloat);
    head.append(t, x);
    pop.appendChild(head);
  }

  // Tapping your own @name in the top bar: sign out (forget the key here).
  // Drafts typed in this browser stay in localStorage either way.
  function openSignOut(anchor) {
    openFloat(anchor, (pop) => {
      floatHead(pop, 'Sign out?');
      const sub = document.createElement('div'); sub.className = 'ed-cp-sub';
      sub.textContent = 'This browser forgets your access key; you will need it to come back. Unsaved drafts stay in this browser.';
      const row = document.createElement('div'); row.className = 'ed-float-actions';
      const no = document.createElement('button'); no.className = 'ed-abtn'; no.textContent = 'Cancel';
      no.addEventListener('click', closeFloat);
      const yes = document.createElement('button'); yes.className = 'ed-abtn danger'; yes.textContent = 'Sign out';
      yes.addEventListener('click', () => { localStorage.removeItem(LS.key); location.reload(); });
      row.append(no, yes);
      pop.append(sub, row);
    }, (pop, r) => {
      pop.style.left = clampX(r.left, pop) + 'px';
      pop.style.top = clampY(r.bottom + 6, pop) + 'px';
    });
  }

  // Sidebar "Editors": every active editor and their contact link, floating
  // to the right of the sidebar.
  let editorsCache = null;
  async function openEditors() {
    const anchor = $('edEditors');
    const pop = openFloat(anchor, (p) => {
      floatHead(p, 'Editors');
      const list = document.createElement('div'); list.className = 'ed-editors';
      const n = document.createElement('div'); n.className = 'ed-cp-sub'; n.textContent = 'Loading…';
      list.appendChild(n);
      p.appendChild(list);
    }, placeEditors);
    if (!pop) return;
    try {
      editorsCache = editorsCache || await SolutionStore.editors();
    } catch (e) {
      if (floatPop === pop) pop.querySelector('.ed-editors').firstChild.textContent = (e && e.message) || 'Could not load the list.';
      return;
    }
    if (floatPop !== pop) return;                   // closed while loading
    const list = pop.querySelector('.ed-editors');
    list.textContent = '';
    if (!editorsCache.length) {
      const n = document.createElement('div'); n.className = 'ed-cp-sub'; n.textContent = 'No editors to show.';
      list.appendChild(n);
    }
    editorsCache.forEach((ed) => {
      const row = document.createElement('div'); row.className = 'ed-editor-row';
      const name = document.createElement('b'); name.textContent = '@' + ed.name;
      if (ed.name === editorName) name.classList.add('me');
      row.appendChild(name);
      // http(s) only, same rule as the practice site's credit link.
      let href = null;
      try { const u = new URL(ed.link); if (u.protocol === 'http:' || u.protocol === 'https:') href = u.href; } catch (e) {}
      if (href) {
        const a = document.createElement('a');
        a.href = href; a.target = '_blank'; a.rel = 'noopener noreferrer';
        a.textContent = new URL(href).host.replace(/^www\./, '');
        a.title = href;
        row.appendChild(a);
      } else {
        const none = document.createElement('span'); none.className = 'none'; none.textContent = 'no link';
        row.appendChild(none);
      }
      list.appendChild(row);
    });
    placeEditors(pop, anchor.getBoundingClientRect());   // its size changed
  }
  function placeEditors(pop, r) {
    const sb = $('edSidebar').getBoundingClientRect();
    const right = sb.width && sb.right > 0 ? sb.right : r.right;
    pop.style.left = clampX(right + 8, pop) + 'px';
    pop.style.top = clampY(r.bottom - pop.offsetHeight, pop) + 'px';
  }
  $('edEditors').addEventListener('click', openEditors);

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

  /* ───────────────────────── colour hint ─────────────────────────
     Shows the five figure colours as they will actually render, in every
     theme and in both night and day.

     The values are MEASURED, not hard-coded: presets live as CSS rules on
     body[data-theme=…] / body.light, and surface, border and muted are
     derived from bg and text, so the only way to get the real numbers is
     to ask the browser. Each theme is applied to <body> and read back in
     one synchronous pass, then the original is restored before the browser
     paints — so nothing flickers and the list can never drift out of step
     with css/style.css. */
  // svg: what an SVG figure writes for it (none = not available there).
  const FIG_COLORS = [
    { key: 'text',    label: 'text',      note: 'default · ctext', svg: '#000' },
    { key: 'accent',  label: 'c1',        note: 'accent 1',        svg: '#f00' },
    { key: 'accent2', label: 'c2',        note: 'accent 2',        svg: '#00f' },
    { key: 'bg',      label: 'c3',        note: 'cbg',             svg: null },
    { key: 'surface', label: 'c4',        note: 'csurface',        svg: '#eee' },
  ];
  // The list for the figure kind on screen, labelled the way that kind writes them.
  const figColorsFor = (kind) => kind === 'svg'
    ? FIG_COLORS.filter((c) => c.svg).map((c) => Object.assign({}, c, {
        label: c.svg, note: { text: 'text', accent: 'accent 1', accent2: 'accent 2', surface: 'surface' }[c.key] }))
    : FIG_COLORS;

  function measureThemes() {
    const body = document.body;
    const prevTheme = body.getAttribute('data-theme');
    const prevLight = body.classList.contains('light');
    const read = () => {
      const cs = getComputedStyle(body);
      const v = (n) => cs.getPropertyValue(n).trim();
      return { bg: v('--bg'), surface: v('--surface'), text: v('--text'),
               accent: v('--accent'), accent2: v('--accent2'), border: v('--border') };
    };

    const list = (typeof THEMES !== 'undefined' ? THEMES : [{ id: 'default', name: 'Default' }])
      .map((t) => ({ id: t.id, name: t.name }));
    list.push({ id: 'custom', name: 'Custom' });

    const out = [];
    list.forEach((t) => {
      const entry = { id: t.id, name: t.name };
      ['night', 'day'].forEach((mode) => {
        body.classList.toggle('light', mode === 'day');
        if (t.id === 'custom') {
          // Custom lives in inline style vars, applied per mode.
          body.removeAttribute('data-theme');
          if (typeof applyCustomForCurrentMode === 'function') applyCustomForCurrentMode();
        } else {
          if (typeof clearCustomVars === 'function') clearCustomVars();
          if (t.id === 'default') body.removeAttribute('data-theme');
          else body.setAttribute('data-theme', t.id);
        }
        entry[mode] = read();
      });
      out.push(entry);
    });

    // put everything back exactly as it was
    if (typeof clearCustomVars === 'function') clearCustomVars();
    body.classList.toggle('light', prevLight);
    if (prevTheme) body.setAttribute('data-theme', prevTheme);
    else body.removeAttribute('data-theme');
    if (!prevTheme && typeof getColorTheme === 'function' && getColorTheme() === 'custom'
        && typeof applyCustomForCurrentMode === 'function') applyCustomForCurrentMode();
    if (typeof updateOnColorVars === 'function') updateOnColorVars();
    return out;
  }

  /** The figure colours of one theme, as small squares. */
  function swatchRow(c, list) {
    const row = document.createElement('div');
    row.className = 'ed-cp-chips';
    // Same order as the list, so a column lines up across every theme.
    list.forEach((f) => {
      const sq = document.createElement('i');
      sq.style.background = c[f.key];
      sq.title = `${f.label} · ${c[f.key]}`;
      row.appendChild(sq);
    });
    return row;
  }

  let colorPop = null, colorPopAnchor = null;
  function closeColorPop() {
    if (!colorPop) return;
    document.removeEventListener('pointerdown', onColorPopOutside, true);
    document.removeEventListener('keydown', onColorPopKey, true);
    colorPop.remove();
    colorPop = colorPopAnchor = null;
  }
  function onColorPopOutside(e) {
    if (colorPop && !colorPop.contains(e.target) && !(colorPopAnchor && colorPopAnchor.contains(e.target))) closeColorPop();
  }
  function onColorPopKey(e) { if (e.key === 'Escape') closeColorPop(); }

  function openColorPop(anchor, kind) {
    if (colorPop) { closeColorPop(); return; }
    const data = measureThemes();
    const list = figColorsFor(kind);

    const pop = document.createElement('div');
    pop.className = 'ed-colorpop';

    const head = document.createElement('div');
    head.className = 'ed-cp-head';
    const ht = document.createElement('span'); ht.textContent = 'Figure colours in every theme';
    const close = document.createElement('button');
    close.className = 'ed-cp-close'; close.textContent = '✕'; close.title = 'Close';
    close.addEventListener('click', closeColorPop);
    head.append(ht, close);
    pop.appendChild(head);

    const sub = document.createElement('div');
    sub.className = 'ed-cp-sub';
    sub.append(document.createTextNode('A figure follows the reader\u2019s theme, so draw only with these. '));
    const code = document.createElement('code'); code.textContent = kind === 'svg' ? '#eee' : 'c3 / c4';
    sub.append(code, document.createTextNode(kind === 'svg' ? ' is the card background — useful as a fill under a label.'
      : ' are the backgrounds — useful as a fill under a label.'));
    pop.appendChild(sub);

    const cols = document.createElement('div');
    cols.className = 'ed-cp-cols';
    ['', '🌙 Night', '☀️ Day'].forEach((t) => {
      const c = document.createElement('div'); c.textContent = t; cols.appendChild(c);
    });
    pop.appendChild(cols);

    // The square order, named once at the top instead of on every row.
    const names = document.createElement('div');
    names.className = 'ed-cp-names';
    const spacer = document.createElement('div');
    names.appendChild(spacer);
    ['night', 'day'].forEach(() => {
      const strip = document.createElement('div');
      strip.className = 'ed-cp-chips labels';
      list.forEach((c) => {
        const l = document.createElement('span');
        l.textContent = c.label;
        strip.appendChild(l);
      });
      names.appendChild(strip);
    });
    pop.appendChild(names);

    data.forEach((t) => {
      const row = document.createElement('div');
      row.className = 'ed-cp-row';
      const name = document.createElement('div');
      name.className = 'ed-cp-name';
      const b = document.createElement('b'); b.textContent = t.name;
      name.appendChild(b);
      row.appendChild(name);
      ['night', 'day'].forEach((mode) => {
        const cell = document.createElement('div');
        cell.className = 'ed-cp-cell';
        cell.appendChild(swatchRow(t[mode], list));
        row.appendChild(cell);
      });
      pop.appendChild(row);
    });

    const legend = document.createElement('div');
    legend.className = 'ed-cp-legend';
    list.forEach((c) => {
      const s = document.createElement('span');
      const i = document.createElement('i');
      // the legend chips show the CURRENT theme, which is what the preview
      // on the right of the editor is using
      i.style.background = `var(--${c.key === 'text' ? 'text' : c.key})`;
      const t = document.createElement('span');
      t.textContent = `${c.label} · ${c.note}`;
      s.append(i, t);
      legend.appendChild(s);
    });
    pop.appendChild(legend);

    document.body.appendChild(pop);
    colorPop = pop; colorPopAnchor = anchor;

    // anchored under the button, nudged back inside the viewport
    const r = anchor.getBoundingClientRect();
    const w = pop.offsetWidth;
    let left = Math.min(r.left, window.innerWidth - w - 8);
    pop.style.left = Math.max(8, left) + 'px';
    pop.style.top = Math.min(r.bottom + 6, window.innerHeight - pop.offsetHeight - 8) + 'px';

    setTimeout(() => {
      document.addEventListener('pointerdown', onColorPopOutside, true);
      document.addEventListener('keydown', onColorPopKey, true);
    }, 0);
  }

  $('edColorHint').addEventListener('click', () => openColorPop($('edColorHint'), 'tikz'));
  $('edColorHintSvg').addEventListener('click', () => openColorPop($('edColorHintSvg'), 'svg'));

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
    saveTimer = setTimeout(flushDrafts, 500);
  }
  function flushDrafts() {
    clearTimeout(saveTimer); saveTimer = null;
    try { localStorage.setItem(LS.drafts, JSON.stringify(drafts)); } catch (e) { /* quota: ignore */ }
  }
  // The write above is debounced; without this, a reload or tab close within
  // half a second of typing would drop the last keystrokes.
  window.addEventListener('pagehide', flushDrafts);
  document.addEventListener('visibilitychange', () => { if (document.hidden) flushDrafts(); });
  /* A draft: { kind, tikz, svgSrc, svgBox, captions, solution, scale }.
     kind is how the figure is written ('tikz' | 'svg'); each kind keeps its
     own text. Only the selected kind is compiled and shown to readers, but
     both texts are saved, so switching devices or loading from the database
     never loses the other one. Drafts from before SVG figures have no
     kind/svgSrc and read as TikZ. */
  const emptyDraft = () => ({ kind: 'tikz', tikz: '', svgSrc: '', svgBox: '', captions: [], solution: '', scale: 1 });
  const figKind = (d) => (d && d.kind === 'svg' ? 'svg' : 'tikz');
  const figSrc = (d) => (d ? (figKind(d) === 'svg' ? d.svgSrc : d.tikz) || '' : '');
  // What a figure's SVGs were made from: equal keys = the stored SVGs still fit.
  const figKey = (d) => {
    if (!figSrc(d).trim()) return '';
    return figKind(d) === 'svg' ? `svg\u0000${d.svgSrc}\u0000${svgfBoxString(d.svgBox)}` : `tikz\u0000${d.tikz}`;
  };
  const rowFigKey = (f) => figKey(f ? { kind: f.kind, tikz: f.tikz, svgSrc: f.svgSrc, svgBox: f.svgBox } : null);
  // Steps of the figure in a draft: { n, hasSteps, labels? } (labels name SVG layers).
  const detectFig = (d) => (figKind(d) === 'svg' ? svgfOutline(d.svgSrc || '') : detectSteps(d.tikz || ''));
  // Both figure texts, as saved: equal = nothing to save on the figure side.
  const figSources = (d) => JSON.stringify(d ? [figKey(d), d.tikz || '', d.svgSrc || '', svgfBoxString(d.svgBox)] : ['', '', '', '']);
  const anyFigSrc = (d) => !!(d && ((d.tikz || '').trim() || (d.svgSrc || '').trim()));
  const hasContent = (d) => !!(d && (anyFigSrc(d) || d.solution.trim() || (d.captions || []).some((c) => c && c.trim())));

  // What the server has: problem_key -> { status, updated_at }. Filled at boot
  // by SolutionStore.index(), kept in step with every save/remove.
  let serverIndex = {};
  // The full row for the problem on screen (null = nothing stored yet), plus
  // the compiled SVGs of the figure currently in the preview.
  let curRow = null;
  let curStale = null;         // true when the problem changed after the row was saved
  let curSvgs = [];
  let curSvgKey = '';          // figKey() of what those SVGs were made from
  let cur = null;
  const draft = () => (drafts[cur.key] ||= emptyDraft());

  /* ───────────────────────── sidebar list ───────────────────────── */
  // Quizzes whose problem list is expanded. Memory only on purpose: every
  // page load starts with just the quiz headers, and an expanded quiz stays
  // expanded until the page is reloaded.
  const openQuizzes = new Set();
  function setQuizOpen(quiz, open) {
    if (open) openQuizzes.add(quiz); else openQuizzes.delete(quiz);
    const box = $('edList');
    const h = box.querySelector(`.ed-group[data-quiz="${quiz}"]`);
    if (h) h.setAttribute('aria-expanded', String(open));
    box.querySelectorAll(`.ed-item[data-quiz="${quiz}"]`).forEach((el) => { el.hidden = !open; });
  }
  // Marks the header of the quiz holding the open problem, so it can be
  // found while that quiz is collapsed.
  function markActiveGroup() {
    document.querySelectorAll('#edList .ed-group').forEach((h) => {
      h.classList.toggle('has-active', !!cur && +h.dataset.quiz === cur.quiz);
    });
  }

  // Filter: hide problems with nothing on them (no dot), and quizzes left
  // with none. Memory only, like the expanded quizzes.
  let onlyTouched = false;
  $('edFilter').addEventListener('click', () => {
    onlyTouched = !onlyTouched;
    $('edFilter').setAttribute('aria-pressed', String(onlyTouched));
    $('edList').classList.toggle('only-touched', onlyTouched);
  });
  // A quiz header is "empty" when none of its problems has a dot. Re-run
  // whenever a dot can appear or vanish (list render, markItem).
  function markEmptyGroups() {
    const box = $('edList');
    box.querySelectorAll('.ed-group').forEach((h) => {
      const any = box.querySelector(`.ed-item.has[data-quiz="${h.dataset.quiz}"]`);
      h.classList.toggle('empty', !any);
    });
  }

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
        const quiz = p.quiz;
        const h = document.createElement('button');
        h.className = 'ed-group' + (cur && cur.quiz === quiz ? ' has-active' : '');
        h.dataset.quiz = String(quiz);
        h.setAttribute('aria-expanded', String(openQuizzes.has(quiz)));
        const a = document.createElement('span');
        const caret = document.createElement('i'); caret.className = 'ed-group-caret'; caret.textContent = '▸';
        a.append(caret, document.createTextNode(`Q${quiz}`));
        const b = document.createElement('span'); b.textContent = String(counts[quiz]);
        h.append(a, b);
        h.addEventListener('click', () => setQuizOpen(quiz, !openQuizzes.has(quiz)));
        frag.appendChild(h);
      }
      const btn = document.createElement('button');
      btn.className = 'ed-item' + (p.retired ? ' retired' : '') + itemClasses(p.key);
      btn.dataset.key = p.key;
      btn.dataset.quiz = String(p.quiz);
      btn.hidden = !openQuizzes.has(p.quiz);
      // Shown position first (what the quiz page calls it), permanent key on
      // the right; the quiz itself is in the group header.
      const l = document.createElement('span'); l.textContent = p.retired ? 'DEL' : `#${p.pos}`;
      const dot = document.createElement('i'); dot.className = 'dot';
      // Tooltip follows the colour: green = published, amber = saved draft,
      // grey = typed here only. (It used to say "Has a draft" on all three.)
      const st = serverIndex[p.key];
      dot.title = st ? (st.status === 'published' ? 'Published' : 'Saved as draft')
                     : 'Unsaved — only in this browser';
      const r = document.createElement('span'); r.className = 'pid'; r.textContent = p.id;
      btn.append(l, dot, r);
      btn.addEventListener('click', () => { select(p.key); if (mqNarrow.matches) setSidebar(false, false); });
      frag.appendChild(btn);
    });
    box.appendChild(frag);
    markEmptyGroups();
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
    markEmptyGroups();
  }

  /* ───────────────────────── problem panel (hidable) ───────────────────────── */
  // Starts closed, and closes again whenever another problem is opened
  // (see select()), so the page opens on the figure and solution fields.
  function setProbOpen(open) {
    document.body.classList.toggle('prob-closed', !open);
    $('edProbToggle').setAttribute('aria-expanded', String(open));
  }
  setProbOpen(false);
  $('edProbToggle').addEventListener('click', () => setProbOpen(document.body.classList.contains('prob-closed')));

  /* ───────────────────────── figure fields (hidable) ─────────────────────────
     For problems that need no figure: hides the TikZ box, the captions and
     the figure preview. A view setting only — nothing is saved or erased.
     Every problem opens with them hidden unless it already has a figure
     (see loadIntoFields); the button opens them to start one. */
  function setFigOpen(open) {
    document.body.classList.toggle('fig-closed', !open);
    $('edFigToggle').textContent = open ? 'Hide figure' : 'Show figure';
    $('edFigToggle').setAttribute('aria-pressed', String(!open));
    // A figure that compiled while hidden couldn't be measured; crop it now.
    const steps = open && $('edStage').querySelector('.fig-steps');
    if (steps) figCropToContent(steps);
  }
  setFigOpen(true);
  $('edFigToggle').addEventListener('click', () => setFigOpen(document.body.classList.contains('fig-closed')));

  function showProblem(p) {
    $('edProbKey').textContent = `Q${p.quiz} · ${p.id}`;
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
  const svgEl = $('edSvg'), svgBoxEl = $('edSvgBox');

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
    // SVG figures name each step after its layer ("2 · Forces").
    capsEl.classList.toggle('named', !!stepState.labels);
    for (let i = 0; i < stepState.n; i++) {
      const row = document.createElement('label'); row.className = 'ed-cap';
      const tag = document.createElement('span');
      tag.textContent = stepState.labels ? stepState.labels[i] : stepState.hasSteps ? `Step ${i + 1}` : 'Caption';
      tag.title = tag.textContent;
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
    const wrap = document.createElement('div'); wrap.className = 'fig-steps fig-sized';
    svgs.forEach((svg, i) => {
      const d = document.createElement('div'); d.className = 'fig-step';
      d.innerHTML = figSanitizeSvg(svg);
      wrap.appendChild(d);
    });
    stage.appendChild(wrap);
    figCropToContent(wrap);   // same crop the practice site applies
    applyScale();
    renderViewer();
  }

  // Display scale (figure.scale): only changes how big the stored SVGs are
  // drawn, so it never needs a recompile.
  const scaleEl = $('edScale');
  const draftScale = (d) => figScaleOf({ scale: d && d.scale });
  function applyScale() {
    if (cur) stage.style.setProperty('--fig-scale', String(draftScale(draft())));
  }
  scaleEl.addEventListener('input', () => {
    if (!cur) return;
    const v = parseFloat(scaleEl.value);
    if (!isFinite(v) || v <= 0) return;           // mid-typing ("0.", "")
    draft().scale = figScaleOf({ scale: v });
    persistDrafts(); markItem(); refreshState(); applyScale();
  });
  scaleEl.addEventListener('change', () => {       // tidy the field on blur/enter
    if (cur) scaleEl.value = draftScale(draft()).toFixed(2);
  });

  // gen null: never superseded by edits; quiet: leave the status line alone
  // (both for compiling a history version for the compare window).
  function compileFigure(src, steps, gen, quiet) {
    return new Promise((resolve) => {
      compileChain = compileChain.then(async () => {
        const t0 = performance.now();
        const out = [];
        let lastLog = [];
        for (let k = 1; k <= steps.n; k++) {
          if (gen !== null && gen !== compileGen) return resolve(null);     // superseded by a newer edit
          const key = `${k}|${steps.hasSteps ? 1 : 0}|${src}`;
          if (svgCache.has(key)) { out.push(svgCache.get(key)); continue; }
          if (steps.n > 1 && !quiet) setStatus(`compiling ${k}/${steps.n}…`, 'busy');
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
    if (cur && figKind(draft()) === 'svg') { scheduleSvgBuild(gen); return; }
    const src = tikzEl.value;
    if (!src.trim()) { curSvgs = []; curSvgKey = ''; clearStage('No figure'); showWarn(null); showLog(null); setStatus('', ''); renderViewer(); refreshState(); return; }
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
      curSvgs = res.svgs; curSvgKey = figKey({ kind: 'tikz', tikz: src });
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

  /* SVG figures: no compiler, just editor/svg-figure.js — parsed, cleaned,
     split into steps by layer and boxed, in a few milliseconds. */
  function scheduleSvgBuild(gen) {
    const d = draft();
    const src = d.svgSrc || '';
    showLog(null);
    if (!src.trim()) { curSvgs = []; curSvgKey = ''; clearStage('No figure'); showWarn(null); setStatus('', ''); renderViewer(); refreshState(); return; }
    setStatus('typing…', '');
    compileTimer = setTimeout(async () => {
      if (gen !== compileGen) return;
      const key = figKey(d);
      let res;
      try { res = await svgfBuild(src, { box: d.svgBox }); }
      catch (e) { res = { error: String((e && e.message) || e) }; }
      if (gen !== compileGen) return;
      if (res.error) {
        setStatus('error', 'err');
        const b = document.createElement('b'); b.textContent = 'This SVG could not be read: ';
        showWarn([b, document.createTextNode(res.error)], true);
        return;
      }
      if (res.empty) {
        curSvgs = []; curSvgKey = '';
        clearStage('Nothing is drawn yet');
        setStatus('nothing drawn', 'err');
        showWarn(null); renderViewer(); refreshState();
        return;
      }
      curSvgs = res.svgs; curSvgKey = key;
      mountSteps(res.svgs);
      refreshState();
      const n = res.svgs.length;
      setStatus(`ok · ${n} step${n > 1 ? 's' : ''}${n > 1 ? ' · by layer' : ''}`, 'ok');
      showSvgWarnings(src, res.notes);
    }, 250);
  }

  // Notes from the build, plus colours that won't follow the reader's theme.
  function showSvgWarnings(src, notes) {
    const nodes = [];
    const fixed = svgfFixedColors(src);
    if (fixed.length) {
      const b = document.createElement('b');
      b.textContent = `${fixed.length} colour${fixed.length > 1 ? 's don’t' : ' doesn’t'} follow the theme: `;
      nodes.push(b);
      fixed.slice(0, 8).forEach((c) => {
        const chip = document.createElement('span'); chip.className = 'ed-colchip';
        const i = document.createElement('i'); i.style.background = c.css;
        chip.append(i, document.createTextNode(c.key));
        nodes.push(chip);
      });
      const go = document.createElement('button'); go.type = 'button'; go.className = 'ed-link'; go.textContent = 'Map them…';
      go.addEventListener('click', openLayers);
      nodes.push(go);
    }
    (notes || []).forEach((t) => { const div = document.createElement('div'); div.textContent = t; nodes.push(div); });
    showWarn(nodes.length ? nodes : null, false);
  }

  /* ───────────────────────── Layers & colours (SVG figures) ─────────────────────────
     A window over the editor showing the figure's structure: every layer
     and every element in it, the step each one appears at, and the colours
     that don't follow the theme yet. Each change is made to the SVG TEXT
     (svgfOp* in editor/svg-figure.js) through the browser's own edit
     command, so Ctrl+Z in the text box undoes it; the window then simply
     re-reads the text. Hovering a row highlights that element in the
     window's preview; the step buttons show the figure up to a step. */
  let lcBack = null;           // the open window's backdrop, or null
  let lcStep = 0;              // preview shows up to this step (0 = everything)
  let lcHover = null;          // panel indexes highlighted in the preview
  let lcGen = 0;               // stale preview builds stop early

  const mk = (tag, cls, text) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  };
  const mkBtn = (cls, text, onClick) => {
    const b = mk('button', cls, text); b.type = 'button';
    b.addEventListener('click', onClick);
    return b;
  };
  const mkSelect = (key, options, onChange) => {
    const s = mk('select', 'ed-lc-select');
    s.dataset.k = key;
    options.forEach(([v, t]) => s.append(new Option(t, v)));
    s.addEventListener('change', () => onChange(s.value));
    return s;
  };

  // Replaces the whole SVG text as ONE undoable edit (falls back to a plain
  // assignment where execCommand is unavailable). Fires the input event,
  // which saves the draft and rebuilds the figure.
  function svgSetSource(text) {
    if (svgEl.value === text) return;
    const back = document.activeElement;
    let ok = false;
    try {
      svgEl.focus({ preventScroll: true });
      svgEl.select();
      ok = document.execCommand('insertText', false, text);
    } catch (e) { ok = false; }
    if (!ok || svgEl.value !== text) { svgEl.value = text; svgEl.dispatchEvent(new Event('input')); }
    if (back && back !== svgEl && document.contains(back)) back.focus({ preventScroll: true });
  }

  function lcApply(op) {
    const src = svgEl.value;
    let out;
    try { out = op(src); }
    catch (e) { toast('Could not change the SVG: ' + ((e && e.message) || e), 'err'); return; }
    if (typeof out !== 'string' || out === src) { lcRender(); return; }
    svgSetSource(out);
    lcRender();
  }

  function lcKey(e) { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeLayers(); } }
  function closeLayers() {
    if (!lcBack) return;
    lcBack.remove();
    lcBack = null; lcHover = null;
    lcGen++;
    document.removeEventListener('keydown', lcKey, true);
  }
  function openLayers() {
    if (!cur || figKind(draft()) !== 'svg' || lcBack) return;
    closeFloat(); closeColorPop();
    lcStep = 0; lcHover = null;
    const back = mk('div', 'ed-lc-back');
    back.addEventListener('pointerdown', (e) => { if (e.target === back) closeLayers(); });
    const box = mk('div', 'ed-lc');
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-modal', 'true');
    box.setAttribute('aria-labelledby', 'edLcTitle');
    back.appendChild(box);
    document.body.appendChild(back);
    lcBack = back;
    document.addEventListener('keydown', lcKey, true);
    lcRender();
    const x = box.querySelector('.ed-cp-close');
    if (x) x.focus({ preventScroll: true });
  }
  $('edLayersBtn').addEventListener('click', openLayers);

  // Highlight these elements in the preview while the pointer (or focus) is on node.
  function lcHoverable(node, idxs) {
    const on = () => { lcHover = idxs; lcPaint(); };
    const off = () => { lcHover = null; lcPaint(); };
    node.addEventListener('pointerenter', on);
    node.addEventListener('pointerleave', off);
    node.addEventListener('focusin', on);
    node.addEventListener('focusout', off);
  }

  function lcPaint() {
    if (!lcBack) return;
    const prev = lcBack.querySelector('.ed-lc-prev');
    if (prev) {
      const hl = !!(lcHover && lcHover.length);
      prev.classList.toggle('hl', hl);
      prev.querySelectorAll('[data-ed-i]').forEach((el) => el.classList.toggle('lc-on', hl && lcHover.includes(+el.getAttribute('data-ed-i'))));
      prev.querySelectorAll('[data-ed-gs]').forEach((el) => {
        el.style.visibility = lcStep && +el.getAttribute('data-ed-gs') > lcStep ? 'hidden' : '';
      });
    }
    lcBack.querySelectorAll('.ed-lc-stepbtn').forEach((b) => b.setAttribute('aria-pressed', String(+b.dataset.step === lcStep)));
  }

  async function lcPreview(src, prev) {
    const gen = ++lcGen;
    let res = null;
    try { res = await svgfBuild(src, { box: draft().svgBox, preview: true }); } catch (e) { res = null; }
    if (gen !== lcGen || !lcBack || !prev.isConnected) return;
    prev.textContent = '';
    if (!res || res.empty || !res.svgs.length) { prev.append(mk('span', 'ed-empty', 'Nothing is drawn yet')); return; }
    prev.innerHTML = figSanitizeSvg(res.svgs[0]);
    figCropToContent(prev);
    lcPaint();
  }

  function lcRender() {
    if (!lcBack) return;
    const box = lcBack.firstChild;
    const src = svgEl.value;
    const m = svgfModel(src);
    if (lcStep > m.n) lcStep = 0;
    lcHover = null;
    const oldMain = box.querySelector('.ed-lc-main');
    const scroll = oldMain ? oldMain.scrollTop : 0;
    const act = document.activeElement;
    const focusKey = act && box.contains(act) ? act.dataset.k : null;
    const prevOld = box.querySelector('.ed-lc-prev');
    box.textContent = '';

    const head = mk('div', 'ed-lc-head');
    const title = mk('span', 'ed-lc-title', 'Layers & colours'); title.id = 'edLcTitle';
    const x = mkBtn('ed-cp-close', '✕', closeLayers); x.title = 'Close (Esc)';
    head.append(title, mk('span', 'ed-badge', `${m.n} step${m.n > 1 ? 's' : ''}`), x);

    const side = mk('div', 'ed-lc-side');
    // The old preview stays up until the new one is built, so it doesn't flash.
    const prev = prevOld || mk('div', 'ed-lc-prev fig');
    prev.className = 'ed-lc-prev fig';
    side.append(prev, lcStepStrip(m));
    const main = mk('div', 'ed-lc-main');
    main.append(lcColors(m), lcLayers(m));
    const body = mk('div', 'ed-lc-body');
    body.append(side, main);
    const foot = mk('div', 'ed-lc-foot', 'Every change is written into the SVG text: Ctrl+Z there undoes it.');
    box.append(head, body, foot);
    main.scrollTop = scroll;
    if (focusKey) {
      const f = box.querySelector(`[data-k="${CSS.escape(focusKey)}"]`);
      if (f) f.focus({ preventScroll: true });
    }
    lcPreview(src, prev);
  }

  function lcStepStrip(m) {
    const w = mk('div', 'ed-lc-steps');
    if (m.n <= 1) {
      w.append(mk('span', 'ed-lc-hint', 'One step. Put elements in two or more layers to build the figure up step by step.'));
      return w;
    }
    w.append(mk('span', 'ed-lc-hint', 'Show up to step'));
    const all = mkBtn('ed-lc-stepbtn', 'All', () => { lcStep = 0; lcPaint(); });
    all.dataset.step = '0';
    w.append(all);
    for (let k = 1; k <= m.n; k++) {
      const b = mkBtn('ed-lc-stepbtn', String(k), () => { lcStep = k; lcPaint(); });
      b.dataset.step = String(k);
      b.title = m.labels[k - 1] || '';
      w.append(b);
    }
    if (m.over) w.append(mk('div', 'ed-lc-hint warn', `More than ${MAX_STEPS} steps: the rest show at step ${MAX_STEPS}.`));
    return w;
  }

  function lcColors(m) {
    const sec = mk('section', 'ed-lc-sec');
    sec.append(mk('h4', null, 'Colours'));
    const { fixed, theme } = m.colors;
    if (theme.length) {
      const row = mk('div', 'ed-lc-chips');
      theme.forEach((t) => {
        const chip = mk('span', 'ed-colchip');
        const i = mk('i'); i.style.background = t.css;
        chip.append(i, document.createTextNode(`${t.label} ×${t.count}`));
        row.append(chip);
      });
      sec.append(row);
    }
    if (!fixed.length) {
      sec.append(mk('div', 'ed-lc-hint ok', theme.length ? 'Every colour follows the theme.' : 'No colours set: everything is drawn in the text colour.'));
      return sec;
    }
    sec.append(mk('div', 'ed-lc-hint', 'These stay the same in every theme. Pick what each should become:'));
    const opts = [['', 'Keep fixed'], ...SVGF_THEME.map((t) => [t.id, `${t.label} (${t.write})`])];
    fixed.forEach((c) => {
      const row = mk('div', 'ed-lc-color');
      const sw = mk('i', 'ed-lc-sw'); sw.style.background = c.css;
      const sel = mkSelect('c:' + c.key, opts, (v) => { if (v) lcApply((s) => svgfOpColor(s, c.key, v)); });
      row.append(sw, mk('span', 'ed-lc-colname', c.key), mk('span', 'ed-lc-muted', `×${c.count}`), sel);
      sec.append(row);
    });
    return sec;
  }

  function lcLayers(m) {
    const sec = mk('section', 'ed-lc-sec');
    const h = mk('h4', null, 'Layers');
    h.append(mk('small', null, ' · first = step 1, each adds to the one before'));
    sec.append(h);
    const total = m.layers.reduce((a, L) => a + (L.hidden ? 0 : L.n), 0);
    const targets = [['loose', 'Always shown'], ...m.layers.map((L) => [String(L.j), L.name]), ['new', '+ New layer']];

    if (m.loose.length || !m.layers.length) {
      const card = mk('div', 'ed-lc-layer loose');
      const hd = mk('div', 'ed-lc-lhead');
      hd.append(mk('b', 'ed-lc-lname', 'Always shown'),
        mk('span', 'ed-lc-muted', m.layers.length ? 'outside every layer · in every step' : 'no layers yet: add one, then move elements into it'));
      lcHoverable(hd, m.loose.map((it) => it.i));
      card.append(hd);
      m.loose.forEach((it) => card.append(lcItem(it, null, targets)));
      if (!m.loose.length) card.append(mk('div', 'ed-lc-empty', 'Nothing drawn yet.'));
      sec.append(card);
    }
    m.layers.forEach((L) => sec.append(lcLayer(L, m, targets, total)));
    const add = mkBtn('ed-abtn ed-lc-add', '+ New layer', () => lcApply(svgfOpNewLayer));
    add.dataset.k = 'add';
    sec.append(add);
    return sec;
  }

  function lcLayer(L, m, targets, total) {
    const card = mk('div', 'ed-lc-layer' + (L.hidden ? ' off' : ''));
    const hd = mk('div', 'ed-lc-lhead');
    const eye = mkBtn('ed-lc-ibtn', L.hidden ? 'Show' : 'Hide', () => lcApply((s) => svgfOpLayerHidden(s, L.j, !L.hidden)));
    eye.title = L.hidden ? 'This layer is left out of the figure. Bring it back.' : 'Leave this layer out of the figure';
    eye.dataset.k = 'h:' + L.j;
    const name = mk('input', 'ed-input ed-lc-name');
    name.value = L.name; name.spellcheck = false; name.dataset.k = 'n:' + L.j;
    name.setAttribute('aria-label', 'Layer name');
    name.addEventListener('change', () => lcApply((s) => svgfOpLayerRename(s, L.j, name.value)));
    name.addEventListener('keydown', (e) => { if (e.key === 'Enter') name.blur(); });
    const badge = mk('span', 'ed-badge', L.hidden ? 'hidden' : L.n > 1 ? `steps ${L.start}–${L.start + L.n - 1}` : `step ${L.start}`);
    const stp = mk('span', 'ed-lc-stepper');
    const minus = mkBtn('ed-lc-ibtn', '−', () => lcApply((s) => svgfOpLayerSteps(s, L.j, L.n - 1)));
    minus.disabled = L.n <= 1; minus.title = 'One step fewer'; minus.dataset.k = 'sm:' + L.j;
    const plus = mkBtn('ed-lc-ibtn', '+', () => lcApply((s) => svgfOpLayerSteps(s, L.j, L.n + 1)));
    plus.disabled = L.n >= MAX_STEPS || (!L.hidden && total >= MAX_STEPS);
    plus.title = 'Split this layer into one more step, then pick when each element appears';
    plus.dataset.k = 'sp:' + L.j;
    stp.append(mk('span', 'ed-lc-muted', 'steps'), minus, mk('b', null, String(L.n)), plus);
    const up = mkBtn('ed-lc-ibtn', '↑', () => lcApply((s) => svgfOpLayerMove(s, L.j, -1)));
    up.disabled = L.j === 0; up.title = 'Earlier (also drawn underneath)'; up.dataset.k = 'u:' + L.j;
    const down = mkBtn('ed-lc-ibtn', '↓', () => lcApply((s) => svgfOpLayerMove(s, L.j, 1)));
    down.disabled = L.j === m.layers.length - 1; down.title = 'Later (also drawn on top)'; down.dataset.k = 'd:' + L.j;
    const del = mkBtn('ed-lc-ibtn danger', '✕', () => lcApply((s) => svgfOpLayerDelete(s, L.j)));
    del.disabled = L.items.length > 0;
    del.title = L.items.length ? 'Move its elements out first' : 'Delete this empty layer';
    hd.append(eye, name, badge, stp, up, down, del);
    lcHoverable(hd, L.items.map((it) => it.i));
    card.append(hd);
    L.items.forEach((it) => card.append(lcItem(it, L, targets)));
    if (!L.items.length) card.append(mk('div', 'ed-lc-empty', 'Empty: move elements here with “Move to”.'));
    return card;
  }

  function lcItem(it, L, targets) {
    const row = mk('div', 'ed-lc-item');
    const sws = mk('span', 'ed-lc-sws');
    it.swatches.forEach((c) => { const i = mk('i'); i.style.background = c; sws.append(i); });
    const what = mk('span', 'ed-lc-what');
    what.append(mk('b', null, it.tag));
    if (it.label) what.append(document.createTextNode(' ' + it.label));
    row.append(sws, what);
    if (L && L.n > 1) {
      const opts = [];
      for (let r = 1; r <= L.n; r++) opts.push([String(r), `step ${L.start + r - 1}`]);
      const s = mkSelect('s:' + it.i, opts, (v) => lcApply((src) => svgfOpItemStep(src, it.i, +v)));
      s.value = String(it.step);
      s.title = 'The step it appears at';
      row.append(s);
    }
    const here = L ? String(L.j) : 'loose';
    const mv = mkSelect('m:' + it.i, [['', 'Move to…'], ...targets.filter(([v]) => v !== here)], (v) => {
      if (v) lcApply((src) => svgfOpMove(src, it.i, v === 'loose' || v === 'new' ? v : +v));
    });
    mv.title = 'Move to another layer';
    row.append(mv);
    lcHoverable(row, [it.i]);
    return row;
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
  // After the figure source changed (either kind): steps, captions, recompile.
  function figSourceChanged() {
    persistDrafts(); markItem(); refreshState(); histMaybeAuto();
    const next = detectFig(draft());
    const changed = next.n !== stepState.n || next.hasSteps !== stepState.hasSteps
      || JSON.stringify(next.labels || null) !== JSON.stringify(stepState.labels || null);
    stepState = next;
    if (changed) renderCaptions();
    renderViewer();
    scheduleCompile();
  }
  tikzEl.addEventListener('input', () => {
    if (!cur) return;
    draft().tikz = tikzEl.value;
    figSourceChanged();
  });
  svgEl.addEventListener('input', () => {
    if (!cur) return;
    draft().svgSrc = svgEl.value;
    figSourceChanged();
  });
  svgBoxEl.addEventListener('input', () => {
    if (!cur) return;
    draft().svgBox = svgBoxEl.value;
    figSourceChanged();
  });

  /* ── TikZ / SVG switch ──
     A view of which text is the figure. Both texts stay in the draft, so
     switching back and forth loses nothing; only the selected kind is
     saved (and a saved figure reopens in its kind). */
  function showFigKind(kind) {
    document.querySelectorAll('.ed-segbtn').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.kind === kind)));
    $('edTikzPart').hidden = kind !== 'tikz';
    $('edSvgPart').hidden = kind !== 'svg';
  }
  function setFigKind(kind) {
    if (!cur) return;
    const d = draft();
    if (figKind(d) === kind) return;
    d.kind = kind;
    showFigKind(kind);
    curSvgs = []; curSvgKey = '';
    showWarn(null); showLog(null);
    viewStep = 1;
    stepState = { n: -1 };                      // force the captions to redraw
    figSourceChanged();
  }
  document.querySelectorAll('.ed-segbtn').forEach((b) => b.addEventListener('click', () => setFigKind(b.dataset.kind)));
  solEl.addEventListener('input', () => {
    if (!cur) return;
    draft().solution = solEl.value; persistDrafts(); markItem(); refreshState(); histMaybeAuto();
    clearTimeout(solTimer); solTimer = setTimeout(renderSolPreview, 200);
  });

  /* ───────────────────────── state panel ───────────────────────── */
  const stPill = $('edStatePill'), stMsg = $('edStMsg'), stNote = $('edStNote');

  // Same as the problem panel: closed by default and on every problem change.
  function setStateOpen(open) {
    document.body.classList.toggle('state-closed', !open);
    $('edStateToggle').setAttribute('aria-expanded', String(open));
  }
  setStateOpen(false);
  $('edStateToggle').addEventListener('click', () => setStateOpen(document.body.classList.contains('state-closed')));

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
    const d = drafts[key] || emptyDraft();
    const has = !!figSrc(d).trim();
    const n = has ? detectFig(d).n : 0;
    const steps = [];
    // Freshly compiled SVGs when the figure in the window is what was
    // compiled; otherwise the ones already stored (so re-saving a problem
    // whose figure was never touched doesn't need a recompile).
    const k = figKey(d);
    const stored = ((rowFigure(key) || {}).steps || []).map((s) => s.svg);
    const fresh = (key === (cur && cur.key) && k && curSvgKey === k) ? curSvgs : null;
    const svgs = fresh || ((rowFigure(key) && rowFigKey(rowFigure(key)) === k) ? stored : []);
    for (let i = 0; i < n; i++) {
      steps.push({ svg: svgs[i] || '', caption: ((d.captions || [])[i] || '').trim() });
    }
    // TikZ figures keep the shape rows always had (no kind field). The other
    // kind's text rides along when there is any; readers only use steps.
    const figure = { tikz: d.tikz || '', steps };
    if (figKind(d) === 'svg') figure.kind = 'svg';
    if (figKind(d) === 'svg' || (d.svgSrc || '').trim()) figure.svgSrc = d.svgSrc || '';
    if (svgfBoxString(d.svgBox)) figure.svgBox = svgfBoxString(d.svgBox);
    const scale = draftScale(d);
    if (has && scale !== 1) figure.scale = scale;
    return { solution: d.solution, figure };
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
           figSources(drafts[key]) === figSources(row.figure ? draftFromRow(row) : null) &&
           figScaleOf(p.figure) === figScaleOf(row.figure) &&
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

  /* A confirmation that replaces the buttons' job: text + Confirm/Cancel.
     opts.more: further actions [{ label, run }] next to Confirm.
     opts.compare: () => the stored row (or a promise of it) this would
       replace; adds "Preview", which opens both versions side by side with
       the same actions at the bottom. */
  function askConfirm(text, confirmLabel, onYes, opts = {}) {
    stNote.hidden = false;
    stNote.textContent = '';
    const p = document.createElement('div'); p.textContent = text;
    const row = document.createElement('div'); row.className = 'ed-state-actions';
    const acts = [{ label: confirmLabel, run: onYes }, ...(opts.more || [])];
    acts.forEach((a) => {
      const b = mkBtn('ed-abtn danger', a.label, () => { hideNote(); a.run(); });
      row.append(b);
    });
    if (opts.compare) row.append(mkBtn('ed-abtn', 'Preview', () => openCompare(opts.compare, acts)));
    row.append(mkBtn('ed-abtn', 'Cancel', hideNote));
    stNote.append(p, row);
  }

  /* ───────────────────────── compare two versions ─────────────────────────
     This window (left) against a stored version (right): whose it is and
     when it was saved, then the figure with every step and its caption,
     then the solution, each section marked same / different. Opened from a
     confirmation's Preview; its actions are repeated at the bottom. */
  let cmpBack = null;
  function cmpKey(e) { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeCompare(); } }
  function closeCompare() {
    if (!cmpBack) return;
    cmpBack.remove(); cmpBack = null;
    document.removeEventListener('keydown', cmpKey, true);
  }

  // A version reduced to what the window shows and compares. steps: its
  // figure's SVGs with captions, or a promise of them (null = could not be
  // built) — history versions keep only source, so theirs is built on demand.
  function cmpVersion(d, steps) {
    const kind = figKind(d);
    const other = kind === 'svg' ? (d.tikz || '').trim() && 'TikZ' : (d.svgSrc || '').trim() && 'SVG';
    const n = figSrc(d).trim() ? detectFig(d).n : 0;
    const caps = Array.from({ length: n }, (_, i) => ((d.captions || [])[i] || '').trim());
    return {
      kind, other, n, steps, scale: draftScale(d), solution: d.solution || '',
      figSame: figSources(d) + JSON.stringify(caps) + draftScale(d),
    };
  }

  // The SVG steps of a draft that was never compiled (a history version).
  async function stepsForDraft(d) {
    if (!figSrc(d).trim()) return [];
    const caps = d.captions || [];
    let svgs = null;
    try {
      if (figKind(d) === 'svg') {
        const r = await svgfBuild(d.svgSrc, { box: d.svgBox });
        svgs = r.empty ? null : r.svgs;
      } else {
        const r = await compileFigure(d.tikz, detectSteps(d.tikz), null, true);
        svgs = r && !r.error ? r.svgs : null;
      }
    } catch (e) { svgs = null; }
    return svgs && svgs.map((svg, i) => ({ svg, caption: caps[i] || '' }));
  }

  // A stored row (or nothing stored) against this window.
  async function openCompare(getTheirs, acts) {
    if (!cur) return;
    const key = cur.key;
    let theirs;
    try { theirs = await getTheirs(); } catch (e) { toast('Could not read the saved version.', 'err'); return; }
    if (!cur || cur.key !== key) return;
    showCompare(theirs ? {
      d: draftFromRow(theirs),
      steps: (theirs.figure && theirs.figure.steps) || [],
      title: `${savedBy(theirs) ? '@' + savedBy(theirs) : 'Unknown editor'} · ${theirs.status === 'published' ? 'published' : 'draft'}`,
      sub: `saved ${fmtWhen(theirs.updated_at)} · ${fmtAgo(Date.parse(theirs.updated_at))}`,
    } : null, acts);
  }

  /* other: { d, steps, title, sub } — the right-hand version — or null for
     "nothing stored". acts: [{ label, run }] for the bottom of the window. */
  function showCompare(other, acts) {
    if (!cur) return;
    closeCompare();
    const key = cur.key;
    const mine = cmpVersion(drafts[key] || emptyDraft(), payloadOf(key).figure.steps);
    const their = other ? cmpVersion(other.d, other.steps) : null;

    const head = (title, sub) => {
      const c = mk('div', 'ed-cmp-head');
      c.append(mk('b', null, title), mk('span', null, sub));
      return c;
    };
    const section = (label, same) => {
      const s = mk('div', 'ed-cmp-sec');
      s.append(mk('span', null, label));
      if (same != null) s.append(mk('span', 'ed-cmp-diff ' + (same ? 'same' : 'differs'), same ? 'same' : 'different'));
      return s;
    };
    // Fills a figure cell; measuring and typesetting need it in the page,
    // which it is by the time a built figure arrives (and see the end).
    const fillFig = (cell, v, steps, live) => {
      cell.textContent = '';
      const n = Array.isArray(steps) ? steps.length : v.n;
      cell.append(mk('div', 'ed-cmp-meta', !v.n ? 'No figure'
        : `${v.kind === 'svg' ? 'SVG' : 'TikZ'} figure · ${n} step${n > 1 ? 's' : ''}${v.scale !== 1 ? ` · scale ${v.scale.toFixed(2)}` : ''}`));
      if (v.other) cell.append(mk('div', 'ed-cmp-meta', `Also kept, not shown: ${v.other} text`));
      if (!v.n) return;
      if (steps === undefined) { cell.append(mk('div', 'ed-cmp-meta', v.kind === 'svg' ? 'Building the figure…' : 'Compiling the figure (TeX)…')); return; }
      if (!steps) { cell.append(mk('div', 'ed-cmp-meta', 'This figure could not be built.')); return; }
      const box = mk('div', 'fig ed-cmp-fig');
      box.style.setProperty('--fig-scale', String(v.scale));
      const caps = [];
      steps.forEach((s, i) => {
        const st = mk('div', 'ed-cmp-step');
        if (n > 1) st.append(mk('div', 'ed-cmp-stepno', `Step ${i + 1}`));
        const holder = mk('div', 'fig-sized');
        if (s.svg) holder.innerHTML = figSanitizeSvg(s.svg);
        else holder.append(mk('span', 'ed-cmp-meta', 'not compiled yet'));
        st.append(holder);
        if ((s.caption || '').trim()) { const c = mk('div', 'sol-text ed-cmp-cap'); st.append(c); caps.push([c, s.caption]); }
        box.append(st);
      });
      cell.append(box);
      const finish = () => { figCropToContent(box); caps.forEach(([el, t]) => renderSolutionInto(el, t)); };
      if (live) finish(); else later.push(finish);
    };
    const later = [];                                   // run once the window is in the page
    const figCell = (v) => {
      const cell = mk('div', 'ed-cmp-cell');
      if (!v) { cell.append(mk('span', 'ed-cmp-meta', '—')); return cell; }
      if (v.steps && typeof v.steps.then === 'function') {
        fillFig(cell, v, undefined, false);
        v.steps.then((steps) => { if (cell.isConnected) fillFig(cell, v, steps, true); });
      } else fillFig(cell, v, v.steps || [], false);
      return cell;
    };
    const solCell = (v) => {
      const cell = mk('div', 'ed-cmp-cell');
      if (!v || !v.solution.trim()) { cell.append(mk('span', 'ed-cmp-meta', v ? 'No solution text' : '—')); return cell; }
      const t = mk('div', 'sol-text ed-cmp-sol');
      cell.append(t); later.push(() => renderSolutionInto(t, v.solution));
      return cell;
    };

    const back = mk('div', 'ed-lc-back');
    back.addEventListener('pointerdown', (e) => { if (e.target === back) closeCompare(); });
    const box = mk('div', 'ed-lc ed-cmp');
    box.setAttribute('role', 'dialog'); box.setAttribute('aria-modal', 'true'); box.setAttribute('aria-labelledby', 'edCmpTitle');
    const top = mk('div', 'ed-lc-head');
    const title = mk('span', 'ed-lc-title', `Compare versions · Q${cur.quiz} · ${cur.id}`); title.id = 'edCmpTitle';
    const x = mkBtn('ed-cp-close', '✕', closeCompare); x.title = 'Close (Esc)';
    top.append(title, x);

    const grid = mk('div', 'ed-cmp-grid');
    grid.append(
      head(`Yours${editorName ? ` · @${editorName}` : ''}`, 'this window · not saved'),
      other ? head(other.title, other.sub) : head('Database', 'nothing stored for this problem'),
      section('Figure', their ? mine.figSame === their.figSame : null), figCell(mine), figCell(their),
      section('Solution', their ? mine.solution === their.solution : null), solCell(mine), solCell(their),
    );

    const foot = mk('div', 'ed-cmp-foot');
    acts.forEach((a) => foot.append(mkBtn('ed-abtn danger', a.label, () => { closeCompare(); hideNote(); a.run(); })));
    foot.append(mkBtn('ed-abtn', 'Close', closeCompare));

    box.append(top, grid, foot);
    back.append(box);
    document.body.append(back);
    cmpBack = back;
    document.addEventListener('keydown', cmpKey, true);
    later.forEach((f) => f());
    x.focus({ preventScroll: true });
  }

  /* Saving over a stored version that isn't simply your own draft: the
     published one (replaced, or taken off the site by a draft save), or
     another editor's draft. Null when no confirmation is needed. */
  function overwriteWarning(status) {
    if (!curRow || !isDirty(cur.key)) return null;
    const by = savedBy(curRow);
    const mineRow = !by || by === editorName;
    const who = !by ? 'an unknown editor' : by === editorName ? 'you' : '@' + by;
    const when = fmtWhen(curRow.updated_at);
    if (curRow.status === 'published') {
      return status === 'published'
        ? { text: `This replaces the published version that readers see now (by ${who}, saved ${when}).`, label: 'Replace published' }
        : { text: `This takes the published version (by ${who}, saved ${when}) off the site and saves yours as a draft.`, label: 'Unpublish and save' };
    }
    if (!mineRow) return { text: `This overwrites ${who}'s draft (saved ${when}).`, label: 'Overwrite' };
    return null;
  }

  // Save draft (button and Ctrl+S): straight through, or ask first.
  function requestSaveDraft() {
    const ow = overwriteWarning('draft');
    if (!ow) return doSave('draft');
    setStateOpen(true);
    askConfirm(ow.text, ow.label, () => doSave('draft'), { compare: () => curRow });
    return Promise.resolve(false);
  }

  // Who saved a row last. `author` is who the site credits (chosen when
  // publishing, see pickAuthor); rows from before saved_by existed (no such
  // field at all) only have author, which then meant both.
  const savedBy = (row) => (row ? ('saved_by' in row ? row.saved_by : row.author) : null) || null;

  /* ── "Who wrote this solution?" ──
     Asked on every publish, because one editor may polish another's
     solution. The signed-in editor is preselected (Enter publishes), the
     row's current credit comes next, then every other active editor.
     Resolves '' for yourself, another editor's name, or null if cancelled. */
  let authBack = null;
  function pickAuthor() {
    return new Promise(async (resolve) => {
      if (authBack) authBack.remove();
      let list = editorsCache;
      if (!list) { try { list = editorsCache = await SolutionStore.editors(); } catch (e) { list = []; } }
      const credit = curRow && curRow.author;
      const opts = [{ v: '', name: editorName, note: 'you' }];
      if (credit && credit !== editorName) opts.push({ v: credit, name: credit, note: curRow.status === 'published' ? 'latest publish' : 'credited so far' });
      (list || []).forEach((ed) => { if (ed.name !== editorName && ed.name !== credit) opts.push({ v: ed.name, name: ed.name, note: '' }); });

      const back = mk('div', 'ed-lc-back');
      const box = mk('div', 'ed-lc ed-auth');
      box.setAttribute('role', 'dialog'); box.setAttribute('aria-modal', 'true'); box.setAttribute('aria-labelledby', 'edAuthTitle');
      const head = mk('div', 'ed-lc-head');
      const title = mk('span', 'ed-lc-title', 'Who wrote this solution?'); title.id = 'edAuthTitle';
      head.append(title);
      const body = mk('div', 'ed-auth-body');
      body.append(mk('div', 'ed-lc-hint', 'Shown on the site as “Solution by @name”.'));
      const group = mk('div', 'ed-auth-list'); group.setAttribute('role', 'radiogroup');
      opts.forEach((o, i) => {
        const lab = mk('label', 'ed-auth-opt');
        const r = mk('input'); r.type = 'radio'; r.name = 'edAuth'; r.value = o.v; r.checked = i === 0;
        const nm = mk('b', null, o.name ? '@' + o.name : 'You');
        lab.append(r, nm);
        if (o.note && o.name) lab.append(mk('span', 'ed-lc-muted', o.note));
        group.append(lab);
      });
      body.append(group, mk('div', 'ed-lc-muted ed-auth-keys', 'Enter publishes · ↑↓ choose · Esc cancels'));
      const foot = mk('div', 'ed-cmp-foot');
      const done = (v) => {
        document.removeEventListener('keydown', onKey, true);
        back.remove(); if (authBack === back) authBack = null;
        resolve(v);
      };
      const chosen = () => { const r = group.querySelector('input:checked'); return r ? r.value : ''; };
      const cancel = mkBtn('ed-abtn', 'Cancel', () => done(null));
      foot.append(mkBtn('ed-abtn primary', 'Publish', () => done(chosen())), cancel);
      const onKey = (e) => {
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); done(null); }
        else if (e.key === 'Enter' && document.activeElement !== cancel) { e.preventDefault(); e.stopPropagation(); done(chosen()); }
      };
      back.addEventListener('pointerdown', (e) => { if (e.target === back) done(null); });
      box.append(head, body, foot);
      back.append(box);
      document.body.append(back);
      authBack = back;
      document.addEventListener('keydown', onKey, true);
      group.querySelector('input:checked').focus({ preventScroll: true });   // arrows move the choice
    });
  }

  // Publish after asking who wrote it; false when cancelled or failed.
  async function publishPicked() {
    const who = await pickAuthor();
    if (who === null) { setMsg('Publishing cancelled.', ''); return false; }
    return doSave('published', undefined, who || undefined);
  }

  // The figure in a saved row, for "Current state". Published: the one
  // readers see (the selected kind, if it has steps). Draft: which texts
  // are stored, since both kinds are kept.
  function savedFigLabel(row, shown) {
    const f = (row && row.figure) || {};
    const isSvg = f.kind === 'svg';
    if (shown) {
      const has = (f.steps || []).some((s) => s && s.svg);
      return !has ? 'no figure' : isSvg ? 'SVG' : 'TikZ';
    }
    const t = !!(f.tikz || '').trim(), s = !!(f.svgSrc || '').trim();
    return t && s ? 'TikZ + SVG' : s ? 'SVG' : t ? 'TikZ' : 'no figure';
  }

  function refreshState() {
    const key = cur && cur.key;
    if (!key) return;
    const status = curRow ? curRow.status : null;
    const dirty = isDirty(key);
    const missingSvg = payloadOf(key).figure.steps.some((s) => !s.svg);

    stPill.className = 'ed-pill ' + (status === 'published' ? 'pub' : status === 'draft' ? 'draft' : dirty ? 'dirty' : 'none');
    stPill.textContent = status === 'published' ? 'published' : status === 'draft' ? 'draft' : dirty ? 'unsaved' : 'empty';

    $('edStCurrent').textContent = status === 'published' ? `Published (${savedFigLabel(curRow, true)})`
      : status === 'draft' ? `Draft (${savedFigLabel(curRow, false)})`
      : 'Nothing saved for this problem yet';
    $('edStSync').textContent = dirty ? (curRow ? 'Unsaved changes in this window' : 'Not saved yet')
      : curRow ? 'Matches the database' : 'Empty';
    $('edStWhen').textContent = curRow ? fmtWhen(curRow.updated_at) : '—';
    // Who saved it, and who the site credits when that is someone else.
    const by = curRow && savedBy(curRow);
    $('edStAuthor').textContent = !curRow ? '—'
      : (by ? '@' + by : '—') + (curRow.author && curRow.author !== by ? ` · credited to @${curRow.author}` : '');
    $('edStStale').textContent = curRow ? (curRow.problem_hash && curStale === true ? 'the problem changed since this was written' : 'no') : '—';
    $('edStStale').className = (curRow && curStale === true) ? 'ed-stale' : '';

    const empty = !hasContent(drafts[key]);
    $('edBtnPublish').disabled = empty || missingSvg;
    // Published and unchanged: nothing to publish, but the credit can still change.
    $('edBtnPublish').textContent = status === 'published' ? (dirty ? 'Publish changes' : 'Change credit…') : 'Publish';
    $('edBtnSave').disabled = empty || !dirty;
    $('edBtnUnpublish').disabled = status !== 'published';
    $('edBtnReload').disabled = !curRow;
    $('edBtnClear').disabled = !curRow && empty;
    if (missingSvg && !empty) setMsg(figKind(drafts[key]) === 'svg'
      ? 'The figure has nothing to show yet, so it can’t be published.'
      : 'Waiting for the figure to compile before it can be published.', '');
    else if (stMsg.className.indexOf('ok') === -1 && stMsg.className.indexOf('err') === -1) setMsg('');
  }

  // expected: the stored version this save may replace (default: the one
  // this window last saw); "Overwrite with mine" passes the newer one.
  // author: who to credit when publishing (default: you).
  async function doSave(status, expected, author) {
    const key = cur.key;
    setMsg('Saving…', '');
    try {
      const problem_hash = await problemHashOf(cur);
      const exp = expected !== undefined ? expected : (curRow ? curRow.updated_at : null);
      const row = await SolutionStore.save(key, Object.assign(payloadOf(key), { status, problem_hash, author }), exp);
      if (cur.key !== key) return;                           // moved on meanwhile
      curRow = row;
      curStale = false;
      serverIndex[key] = { status: row.status, updated_at: row.updated_at };
      markItem(key);
      refreshState();
      setMsg(status === 'published' ? 'Published.' : 'Draft saved.', 'ok');
      histSnapshot(key, status === 'published' ? 'Published' : 'Saved as draft');
      return true;
    } catch (e) {
      if (e && e.conflict) {
        const them = e.current || null;
        const who = them && savedBy(them) ? '@' + savedBy(them) : 'Someone else';
        setMsg('', 'err');
        setStateOpen(true);
        askConfirm(`${who} saved this problem${them ? ` (${fmtWhen(them.updated_at)})` : ''} while you were editing it. Loading their version erases what is in your window; overwriting replaces theirs with yours.`,
          'Load theirs', () => doReload(), {
            compare: () => them || SolutionStore.get(key),
            more: [{ label: 'Overwrite with mine', run: () => doSave(status, them ? them.updated_at : null, author) }],
          });
      } else if (e && e.auth) {
        setMsg('Your access key was not accepted. Tap your @name at the top to sign out and enter it again.', 'err');
      } else {
        setMsg('Could not save: ' + (e && e.message ? e.message : e), 'err');
      }
      refreshState();
      return false;
    }
  }

  // The editable fields for a stored row.
  function draftFromRow(row) {
    const f = row.figure || {};
    return {
      kind: f.kind === 'svg' ? 'svg' : 'tikz',
      tikz: f.tikz || '',
      svgSrc: f.svgSrc || '',
      svgBox: f.svgBox || '',
      captions: (f.steps || []).map((s) => s.caption || ''),
      solution: row.solution || '',
      scale: figScaleOf(row.figure),
    };
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
        histSnapshot(key, 'Before loading from the database');
        drafts[key] = draftFromRow(row);
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

  /* "Check state": reads this problem's row again and updates the state
     panel and the sidebar dot. The fields are never touched — a newer
     version shows up as "Unsaved changes in this window", and Load from
     database takes it. */
  async function checkState() {
    const key = cur.key;
    const before = curRow;
    setMsg('Checking…', '');
    try {
      const row = await SolutionStore.get(key);
      if (cur.key !== key) return;
      curRow = row;
      curStale = row && row.problem_hash ? (row.problem_hash !== await problemHashOf(cur)) : null;
      if (cur.key !== key) return;
      if (row) serverIndex[key] = { status: row.status, updated_at: row.updated_at };
      else delete serverIndex[key];
      markItem(key);
      refreshState();
      const by = row && savedBy(row) ? ` by @${savedBy(row)}` : '';
      setMsg(!row ? (before ? 'Checked: it was deleted from the database.' : 'Checked: nothing is stored for this problem.')
        : before && before.updated_at === row.updated_at ? 'Checked: nothing changed in the database.'
        : `Checked: the database has a newer version (saved${by}, ${fmtWhen(row.updated_at)}).`, 'ok');
    } catch (e) {
      setMsg(e && e.auth ? 'Your access key was not accepted. Tap your @name at the top to sign out and enter it again.'
        : 'Could not check: ' + (e && e.message ? e.message : e), 'err');
    }
  }
  $('edBtnCheck').addEventListener('click', () => { if (cur) checkState(); });

  $('edBtnPublish').addEventListener('click', () => {
    if (curRow && curRow.status === 'published' && !isDirty(cur.key)) changeCredit();
    else requestPublish();
  });

  // "Change credit…": the published version as it is, credited to someone
  // else. Same question as publishing; nothing is saved if the answer is
  // who is already credited. Only the credit is sent (set-credit), never
  // this window's text — and if the row changed since it was loaded, the
  // server refuses, so a newer version is never replaced by this copy.
  async function changeCredit() {
    const key = cur.key;
    const who = await pickAuthor();
    if (who === null || !cur || cur.key !== key) return;
    const name = who || editorName;
    if (name && name === curRow.author) { setMsg(`Already credited to @${name}.`, 'ok'); return; }
    setMsg('Saving…', '');
    try {
      const row = await SolutionStore.setCredit(key, who || null, curRow.updated_at);
      if (cur.key !== key) return;
      curRow = row;
      serverIndex[key] = { status: row.status, updated_at: row.updated_at };
      markItem(key);
      refreshState();
      setMsg(name ? `Credit changed to @${name}.` : 'Credit changed.', 'ok');
    } catch (e) {
      if (e && e.conflict) {
        const them = e.current || null;
        const by = them && savedBy(them) ? '@' + savedBy(them) : 'Someone else';
        setMsg('', 'err');
        setStateOpen(true);
        askConfirm(`${by} changed this solution${them ? ` (${fmtWhen(them.updated_at)})` : ''} after you opened it, so the credit was not changed. Load their version, check it, then change the credit.`,
          'Load theirs', () => doReload(), { compare: () => them || SolutionStore.get(key) });
      } else if (e && e.auth) {
        setMsg('Your access key was not accepted. Tap your @name at the top to sign out and enter it again.', 'err');
      } else {
        setMsg('Could not change the credit: ' + (e && e.message ? e.message : e), 'err');
      }
    }
  }
  $('edBtnSave').addEventListener('click', () => requestSaveDraft());
  $('edBtnUnpublish').addEventListener('click', () => {
    askConfirm('Unpublishing hides this solution on the site immediately. The text stays here as a draft.',
      'Unpublish', () => doSave('draft'));
  });
  $('edBtnReload').addEventListener('click', () => {
    askConfirm('This loads the latest version from the database and erases everything in this window for this problem.',
      'Load and erase', () => doReload(), { compare: () => SolutionStore.get(cur.key) });
  });
  $('edBtnClear').addEventListener('click', () => {
    askConfirm('This deletes the stored solution for this problem and empties the fields. It cannot be undone.',
      'Delete', async () => {
        const key = cur.key;
        setMsg('Deleting…', '');
        try {
          await SolutionStore.remove(key);
          histSnapshot(key, 'Before delete');
          delete serverIndex[key];
          delete drafts[key];
          persistDrafts();
          curRow = null; curStale = null; curSvgs = []; curSvgKey = '';
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
    if (lcBack) closeLayers();
    tikzEl.disabled = svgEl.disabled = svgBoxEl.disabled = solEl.disabled = scaleEl.disabled = false;
    tikzEl.value = d.tikz || '';
    svgEl.value = d.svgSrc || '';
    svgBoxEl.value = d.svgBox || '';
    showFigKind(figKind(d));
    scaleEl.value = draftScale(d).toFixed(2);
    applyScale();
    // Per problem: figure fields open only when there is a figure. Runs
    // again after an automatic load from the database, which then opens them.
    setFigOpen(anyFigSrc(d));
    solEl.value = d.solution;
    viewStep = 1;
    stepState = detectFig(d);
    renderCaptions();
    renderSolPreview();
    showWarn(null); showLog(null);
    curSvgs = []; curSvgKey = '';
    if (figSrc(d).trim()) { renderViewer(); scheduleCompile(); }
    else { clearTimeout(compileTimer); compileGen++; clearStage('No figure'); setStatus('', ''); renderViewer(); }
  }

  // reveal: expand the problem's quiz in the sidebar. Off only for the
  // problem restored at page load, so the list starts collapsed.
  async function select(key, reveal = true) {
    const p = byKey.get(key);
    if (!p) return;
    cur = p;
    if (reveal && !openQuizzes.has(p.quiz)) setQuizOpen(p.quiz, true);
    markActiveGroup();
    document.querySelectorAll('.ed-item.active').forEach((el) => el.classList.remove('active'));
    const item = $('edList').querySelector(`.ed-item[data-key="${CSS.escape(key)}"]`);
    if (item) { item.classList.add('active'); item.scrollIntoView({ block: 'nearest' }); }

    showProblem(p);
    setProbOpen(false); setStateOpen(false);
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
        // Stored in the database but nothing in this browser (another
        // device, cleared storage, the other editor's work): fill the fields
        // from the row instead of showing it as empty. Checked after the
        // fetch, so anything typed while it was loading is never replaced.
        if (row && !hasContent(drafts[key])) {
          drafts[key] = draftFromRow(row);
          persistDrafts();
          loadIntoFields();
          markItem(key);
        }
        refreshState();
      } catch (e) {
        setMsg(e && e.auth ? 'Your access key was not accepted. Tap your @name at the top to sign out and enter it again.'
                           : 'Could not read this problem from the database.', 'err');
      }
    }
  }

  /* ───────────────────────── toast ─────────────────────────
     Feedback for actions taken while the state panel is closed (Ctrl+S,
     restoring a version). */
  let toastTimer = null;
  function toast(text, cls) {
    let t = $('edToast');
    if (!t) {
      t = document.createElement('div'); t.id = 'edToast'; t.className = 'ed-toast';
      t.setAttribute('role', 'status');
      document.body.appendChild(t);
    }
    t.textContent = text;
    t.className = 'ed-toast visible ' + (cls || '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.className = 'ed-toast ' + (cls || ''); }, 2200);
  }

  /* ───────────────────────── pre-publish checks ─────────────────────────
     Things that are easy to miss and look broken to a student. Warnings
     only: "Publish anyway" is always offered. */
  function texIssues(text, where) {
    const out = [];
    const t = String(text || '').replace(/\\\\/g, '').replace(/\\\$/g, '');   // ignore \\ and \$
    const dd = (t.match(/\$\$/g) || []).length;
    if (dd % 2) out.push(`Unclosed $$ in ${where}.`);
    const single = (t.replace(/\$\$/g, '').match(/\$/g) || []).length;
    if (single % 2) out.push(`Unclosed $ in ${where}.`);
    const cnt = (re) => (t.match(re) || []).length;
    if (cnt(/\\\[/g) !== cnt(/\\\]/g)) out.push(`\\[ and \\] don't pair up in ${where}.`);
    if (cnt(/\\\(/g) !== cnt(/\\\)/g)) out.push(`\\( and \\) don't pair up in ${where}.`);
    const b = t.replace(/\\[{}]/g, '');                  // \{ \} are literal braces
    if ((b.match(/\{/g) || []).length !== (b.match(/\}/g) || []).length) {
      out.push(`{ and } don't pair up in ${where}.`);
    }
    const begins = {}, ends = {};
    t.replace(/\\begin\{([^}]+)\}/g, (m, e) => { begins[e] = (begins[e] || 0) + 1; return m; });
    t.replace(/\\end\{([^}]+)\}/g, (m, e) => { ends[e] = (ends[e] || 0) + 1; return m; });
    new Set([...Object.keys(begins), ...Object.keys(ends)]).forEach((e) => {
      if ((begins[e] || 0) !== (ends[e] || 0)) out.push(`\\begin{${e}} without a matching \\end{${e}} in ${where}.`);
    });
    return out;
  }
  function prePublishIssues(key) {
    const d = drafts[key] || emptyDraft();
    const issues = [];
    const n = figSrc(d).trim() ? detectFig(d).n : 0;
    if (n && figKind(d) === 'svg') {
      const fixed = svgfFixedColors(d.svgSrc);
      if (fixed.length) issues.push(`${fixed.length} colour${fixed.length > 1 ? 's' : ''} in the figure won’t follow the reader’s theme (${fixed.slice(0, 4).map((c) => c.key).join(', ')}${fixed.length > 4 ? ', …' : ''}). Map them in Layers & colours.`);
      if ((d.svgBox || '').trim() && !svgfBoxString(d.svgBox)) issues.push('The crop box is not four numbers, so the box is found automatically.');
    }
    if (!d.solution.trim()) issues.push('The solution text is empty.');
    issues.push(...texIssues(d.solution, 'the solution'));
    (d.captions || []).forEach((c, i) => {
      if (!c || !c.trim()) return;
      if (i >= n) issues.push(`Caption ${i + 1} has no figure step and will be dropped.`);
      else issues.push(...texIssues(c, n > 1 ? `caption ${i + 1}` : 'the caption'));
    });
    if (n > 1) {
      const filled = (d.captions || []).slice(0, n).filter((c) => c && c.trim()).length;
      if (filled && filled < n) issues.push(`Only ${filled} of ${n} steps have a caption.`);
    }
    if (curRow && key === cur.key && curStale === true) {
      issues.push('The problem changed after this solution was last saved; check that the numbers still match.');
    }
    return issues;
  }
  // Publish, but show the checks first when there is anything to flag.
  async function requestPublish() {
    const key = cur.key;
    if (payloadOf(key).figure.steps.some((s) => !s.svg)) {
      toast('The figure is still compiling. Try again in a moment.', 'err');
      return false;
    }
    const issues = prePublishIssues(key);
    const ow = overwriteWarning('published');
    if (!issues.length && !ow) return publishPicked();
    setStateOpen(true);
    const text = [ow && ow.text, issues.length && 'Before publishing, check:\n• ' + issues.join('\n• ')].filter(Boolean).join('\n\n');
    askConfirm(text, ow ? ow.label : 'Publish anyway', () => publishPicked(), ow ? { compare: () => curRow } : {});
    return false;
  }

  /* ───────────────────────── Ctrl+S ─────────────────────────
     Saves the open problem as it stands: a published solution is
     re-published (a draft save would take it off the site), anything else
     is saved as a draft. */
  document.addEventListener('keydown', async (e) => {
    if (!(e.ctrlKey || e.metaKey) || e.altKey || (e.key !== 's' && e.key !== 'S')) return;
    e.preventDefault();                               // never the browser's "save page"
    if (!cur || !gate.hidden) return;
    const key = cur.key;
    if (!hasContent(drafts[key]) && !curRow) { toast('Nothing to save yet.'); return; }
    if (!isDirty(key)) { toast('Already saved.'); return; }
    const published = curRow && curRow.status === 'published';
    // A confirmation waiting in the state panel is not a failure.
    const asked = () => !stNote.hidden;
    if (published) {
      const ok = await requestPublish();
      if (ok) toast('Published changes.', 'ok');
      else if (asked()) toast('Confirm in the state panel.');
      return;
    }
    toast('Saving…');
    const ok = await requestSaveDraft();
    if (ok) toast('Draft saved.', 'ok');
    else if (asked()) toast('Confirm in the state panel.');
    else { toast('Could not save. See the state panel.', 'err'); setStateOpen(true); }
  });

  /* ───────────────────────── local version history ─────────────────────────
     Earlier versions of each problem, kept ONLY in this browser
     (localStorage) — nothing is added to the database. Figures are kept as
     source (TikZ or SVG text), not compiled SVG, so a restored version
     recompiles; that keeps the store small.

     A version is kept: on every save/publish, before anything replaces the
     fields (load from database, delete, restoring another version), and
     every HIST_AUTO_MS while typing. Identical consecutive versions are
     kept once. */
  const HIST_PER_PROBLEM = 30;
  const HIST_TOTAL = 400;
  const HIST_AUTO_MS = 10 * 60 * 1000;
  let histAll = null;
  function histLoad() {
    if (histAll) return histAll;
    try { histAll = JSON.parse(localStorage.getItem(LS.history) || '{}') || {}; } catch (e) { histAll = {}; }
    return histAll;
  }
  function histPersist() {
    for (let tries = 0; tries < 6; tries++) {
      try { localStorage.setItem(LS.history, JSON.stringify(histAll)); return; }
      catch (e) {
        // Quota: drop the oldest fifth of all versions and retry.
        const all = [];
        Object.keys(histAll).forEach((k) => histAll[k].forEach((v) => all.push([v.at, k, v])));
        if (!all.length) return;
        all.sort((a, b) => a[0] - b[0]);
        all.slice(0, Math.max(1, Math.ceil(all.length / 5))).forEach(([, k, v]) => {
          histAll[k] = histAll[k].filter((x) => x !== v);
          if (!histAll[k].length) delete histAll[k];
        });
      }
    }
  }
  const histBody = (d) => ({
    kind: figKind(d), tikz: d.tikz || '', svgSrc: d.svgSrc || '', svgBox: d.svgBox || '',
    captions: (d.captions || []).slice(), solution: d.solution || '', scale: draftScale(d),
  });
  const histSame = (a, b) => JSON.stringify(histBody(a)) === JSON.stringify(histBody(b));
  function histSnapshot(key, label) {
    const d = drafts[key];
    if (!hasContent(d)) return;
    const all = histLoad();
    const list = all[key] || (all[key] = []);
    if (list.length && histSame(list[0], d)) return;  // nothing new since the last one
    list.unshift(Object.assign({ at: Date.now(), label }, histBody(d)));
    if (list.length > HIST_PER_PROBLEM) list.length = HIST_PER_PROBLEM;
    // Overall cap, oldest first.
    let total = 0; Object.keys(all).forEach((k) => { total += all[k].length; });
    while (total > HIST_TOTAL) {
      let oldK = null, oldAt = Infinity;
      Object.keys(all).forEach((k) => { const v = all[k][all[k].length - 1]; if (v && v.at < oldAt) { oldAt = v.at; oldK = k; } });
      if (!oldK) break;
      all[oldK].pop(); if (!all[oldK].length) delete all[oldK];
      total--;
    }
    histPersist();
  }
  let histAutoTimer = null;
  function histMaybeAuto() {
    if (!cur) return;
    const key = cur.key;
    clearTimeout(histAutoTimer);
    // Checked a few seconds after typing pauses, not on every keystroke.
    histAutoTimer = setTimeout(() => {
      const list = histLoad()[key] || [];
      if (!list.length || Date.now() - list[0].at >= HIST_AUTO_MS) histSnapshot(key, 'While editing');
    }, 3000);
  }

  function fmtAgo(ms) {
    const s = Math.round((Date.now() - ms) / 1000);
    if (s < 60) return 'just now';
    if (s < 3600) return `${Math.round(s / 60)} min ago`;
    if (s < 86400) return `${Math.round(s / 3600)} h ago`;
    return new Date(ms).toLocaleString();
  }
  function histRestore(key, v) {
    histSnapshot(key, 'Before restoring');
    drafts[key] = histBody(v);
    persistDrafts();
    loadIntoFields();
    markItem(key);
    refreshState();
    closeFloat();
    toast(`Restored the version from ${fmtAgo(v.at)}. Save to keep it.`, 'ok');
  }
  // A kept version next to the window. Its figure was kept as source, so it
  // is built here (SVG at once, TikZ through the normal TeX queue).
  function previewHistory(key, v) {
    closeFloat();
    const d = histBody(v);
    showCompare({
      d, steps: stepsForDraft(d),
      title: `Local history · ${v.label}`,
      sub: `kept ${new Date(v.at).toLocaleString()} · ${fmtAgo(v.at)} · this browser only`,
    }, histSame(v, draft()) ? [] : [{ label: 'Restore', run: () => histRestore(key, v) }]);
  }

  function openHistory() {
    if (!cur) return;
    const key = cur.key;
    const anchor = $('edBtnHistory');
    openFloat(anchor, (pop) => {
      floatHead(pop, 'Local history');
      const sub = document.createElement('div'); sub.className = 'ed-cp-sub';
      sub.textContent = 'Kept in this browser only. Restoring replaces the fields (the current text is kept here first); save afterwards to keep it.';
      pop.appendChild(sub);
      const list = histLoad()[key] || [];
      const box = document.createElement('div'); box.className = 'ed-hist';
      if (!list.length) {
        const n = document.createElement('div'); n.className = 'ed-cp-sub';
        n.textContent = 'No versions yet. One is kept on every save, before anything replaces the fields, and every 10 minutes while you type.';
        box.appendChild(n);
      }
      const now = draft();
      list.forEach((v) => {
        const row = document.createElement('div'); row.className = 'ed-hist-row';
        const info = document.createElement('div'); info.className = 'ed-hist-info';
        const top = document.createElement('div');
        const lbl = document.createElement('b'); lbl.textContent = v.label;
        const when = document.createElement('span'); when.textContent = ' · ' + fmtAgo(v.at); when.title = new Date(v.at).toLocaleString();
        top.append(lbl, when);
        // Just what kind of figure it had; Preview shows the rest.
        const steps = figSrc(v).trim() ? detectFig(v).n : 0;
        info.append(top);
        if (steps) {
          const peek = document.createElement('div'); peek.className = 'ed-hist-peek';
          peek.textContent = `${figKind(v) === 'svg' ? 'SVG' : 'TikZ'} figure · ${steps} step${steps > 1 ? 's' : ''}`;
          info.append(peek);
        }
        const same = histSame(v, now);
        const pv = mkBtn('ed-abtn', 'Preview', () => previewHistory(key, v));
        pv.title = 'This version next to what is in the window';
        const btn = document.createElement('button'); btn.className = 'ed-abtn';
        if (same) { btn.textContent = 'Current'; btn.disabled = true; }
        else { btn.textContent = 'Restore'; btn.addEventListener('click', () => histRestore(key, v)); }
        row.append(info, pv, btn);
        box.appendChild(row);
      });
      pop.appendChild(box);
    }, (pop, r) => {
      pop.style.left = clampX(r.left, pop) + 'px';
      pop.style.top = clampY(r.bottom + 6, pop) + 'px';
    });
  }
  $('edBtnHistory').addEventListener('click', openHistory);

  /* ───────────────────────── snippets (TikZ + solution) ─────────────────────────
     VS Code-style completion in both text boxes.
       TikZ box     — a word at the start of a line, with or without the
                      backslash (2+ letters): figure building blocks.
       Solution box — a backslash command anywhere (\fr, \vec, \alp…):
                      LaTeX that MathJax understands.
     ↑/↓ choose, Tab or Enter insert, Esc closes, Ctrl+Space lists all.

     Tab stops, as in VS Code: ${1:text} ${2:text} … are visited in order
     with Tab (Shift+Tab goes back), each one selected so typing replaces
     it; $0 is where the cursor ends up (end of the snippet if absent).
     Clicking elsewhere or Esc leaves the snippet. Extra lines get the
     current line's indentation. Defaults inside ${n:…} can't contain "}". */
  const TIKZ_SNIPPETS = [
    { p: 'tikzpicture', d: 'Picture with a bounding box', b: '\\begin{tikzpicture}\n  \\useasboundingbox (0,0) rectangle (${1:8},${2:5});\n  $0\n\\end{tikzpicture}' },
    { p: 'bbox', d: 'Bounding box (the visible area)', b: '\\useasboundingbox (${1:0,0}) rectangle (${2:8,5});' },
    { p: 'draw', d: 'Line between two points', b: '\\draw (${1:0,0}) -- (${2:2,0});' },
    { p: 'arrow', d: 'Arrow with a label (force, velocity…)', b: '\\draw[-{Stealth[length=2.5mm]}, thick, ${1:c1}] (${2:0,0}) -- ++(${3:1.5,0}) node[${4:right}] {$${5:\\vec F}$};' },
    { p: 'dashed', d: 'Dashed line', b: '\\draw[dashed] (${1:0,0}) -- (${2:2,0});' },
    { p: 'node', d: 'Text / math label', b: '\\node at (${1:0,0}) {$${2:m}$};' },
    { p: 'coordinate', d: 'Named point', b: '\\coordinate (${1:A}) at (${2:0,0});' },
    { p: 'circle', d: 'Circle', b: '\\draw (${1:0,0}) circle (${2:0.5});' },
    { p: 'dot', d: 'Filled point', b: '\\fill (${1:0,0}) circle (1.5pt);' },
    { p: 'rectangle', d: 'Rectangle', b: '\\draw (${1:0,0}) rectangle (${2:2,1});' },
    { p: 'block', d: 'Block of mass m', b: '\\draw[fill=csurface] (${1:0,0}) rectangle ++(${2:1,0.6}) node[midway] {$${3:m}$};' },
    { p: 'axes', d: 'x and y axes', b: '\\draw[->] (0,0) -- (${1:5},0) node[right] {$${2:x}$};\n\\draw[->] (0,0) -- (0,${3:4}) node[above] {$${4:y}$};' },
    { p: 'incline', d: 'Inclined plane with angle', b: '\\coordinate (A) at (0,0);\n\\coordinate (B) at (${1:4},0);\n\\coordinate (C) at ($(B)+(0,${2:3})$);\n\\draw (A) -- (B) -- (C) -- cycle;\n\\pic[draw, "$${3:\\theta}$", angle radius=7mm, angle eccentricity=1.45] {angle = B--A--C};' },
    { p: 'angle', d: 'Angle mark between named points', b: '\\pic[draw, "$${1:\\theta}$", angle radius=6mm, angle eccentricity=1.45] {angle = ${2:B--A--C}};' },
    { p: 'ground', d: 'Hatched ground', b: '\\draw (0,0) -- (${1:5},0) coordinate (g);\n\\fill[pattern=north east lines] (0,-0.2) rectangle (g);' },
    { p: 'wall', d: 'Hatched wall', b: '\\draw (0,0) -- (0,${1:3}) coordinate (w);\n\\fill[pattern=north east lines] (-0.2,0) rectangle (w);' },
    { p: 'spring', d: 'Spring (coil)', b: '\\draw[decorate, decoration={coil, aspect=0.4, segment length=2mm, amplitude=2mm}] (${1:0,0}) -- (${2:2,0});' },
    { p: 'brace', d: 'Brace with a label', b: '\\draw[decorate, decoration={brace, amplitude=5pt}] (${1:0,0}) -- (${2:2,0}) node[midway, above=5pt] {$${3:d}$};' },
    { p: 'dimension', d: 'Length marker ↔ with label', b: '\\draw[<->] (${1:0,-0.4}) -- (${2:2,-0.4}) node[midway, below] {$${3:L}$};' },
    { p: 'onstep', d: 'Show from step N on', b: '\\onstep{${1:2}}{$0}' },
    { p: 'foreach', d: 'Loop', b: '\\foreach \\x in {${1:0,1,2}} {\n  $0\n}' },
    { p: 'scope', d: 'Scope (shift / scale a group)', b: '\\begin{scope}[${1:xshift=2cm}]\n  $0\n\\end{scope}' },
  ];

  // Plain symbols: the command itself, nothing to fill in.
  const sym = (p, d) => ({ p, d, b: '\\' + p });
  const SOLUTION_SNIPPETS = [
    // math modes / structure
    { p: 'display', d: 'Display math block $$ … $$', b: '$$\n${1:}\n$$' },
    { p: 'inline', d: 'Inline math $ … $', b: '$${1:x}$' },
    { p: 'aligned', d: 'Aligned equations (inside $$)', b: '$$\n\\begin{aligned}\n  ${1:a} &= ${2:b} \\\\\n  &= ${3:c}\n\\end{aligned}\n$$' },
    { p: 'cases', d: 'Piecewise / cases', b: '\\begin{cases}\n  ${1:a}, & ${2:x > 0} \\\\\n  ${3:b}, & ${4:x \\le 0}\n\\end{cases}' },
    { p: 'boxed', d: 'Boxed final answer', b: '\\boxed{${1:answer}}' },
    // fractions, roots, calculus
    { p: 'frac', d: 'Fraction', b: '\\frac{${1:a}}{${2:b}}' },
    { p: 'dfrac', d: 'Full-size fraction', b: '\\dfrac{${1:a}}{${2:b}}' },
    { p: 'sqrt', d: 'Square root', b: '\\sqrt{${1:x}}' },
    { p: 'nroot', d: 'n-th root', b: '\\sqrt[${1:3}]{${2:x}}' },
    { p: 'dd', d: 'Differential: \\dd{x} → upright d x', b: '\\dd{${1:x}}' },
    { p: 'dv', d: 'Derivative dx/dt', b: '\\dv{${1:x}}{${2:t}}' },
    { p: 'dvn', d: 'n-th derivative d²x/dt²', b: '\\dv[${1:2}]{${2:x}}{${3:t}}' },
    { p: 'pdv', d: 'Partial derivative ∂f/∂x', b: '\\pdv{${1:f}}{${2:x}}' },
    { p: 'pdvn', d: 'n-th partial derivative ∂²f/∂x²', b: '\\pdv[${1:2}]{${2:f}}{${3:x}}' },
    { p: 'int', d: 'Definite integral', b: '\\int_{${1:a}}^{${2:b}} ${3:f(x)}\\,\\dd{${4:x}}' },
    { p: 'oint', d: 'Closed-loop integral', b: '\\oint ${1:\\vec E} \\cdot \\dd{${2:\\vec A}}' },
    { p: 'sum', d: 'Sum', b: '\\sum_{${1:i=1}}^{${2:n}} ' },
    { p: 'lim', d: 'Limit', b: '\\lim_{${1:x \\to 0}} ' },
    // accents
    { p: 'vec', d: 'Vector arrow', b: '\\vec{${1:F}}' },
    { p: 'vb', d: 'Bold vector F', b: '\\vb{${1:F}}' },
    { p: 'vu', d: 'Unit vector r̂ (bold)', b: '\\vu{${1:r}}' },
    { p: 'hat', d: 'Hat accent', b: '\\hat{${1:x}}' },
    { p: 'dot', d: 'Time derivative (dot)', b: '\\dot{${1:x}}' },
    { p: 'ddot', d: 'Second time derivative', b: '\\ddot{${1:x}}' },
    { p: 'bar', d: 'Average / bar', b: '\\bar{${1:v}}' },
    // brackets
    { p: 'lr', d: 'Auto-sized ( … )', b: '\\left(${1:x}\\right)' },
    { p: 'lrb', d: 'Auto-sized [ … ]', b: '\\left[${1:x}\\right]' },
    { p: 'abs', d: 'Absolute value | … |', b: '\\abs{${1:x}}' },
    { p: 'norm', d: 'Norm ‖ … ‖', b: '\\norm{${1:v}}' },
    { p: 'pmatrix', d: 'Column vector', b: '\\begin{pmatrix} ${1:a} \\\\ ${2:b} \\\\ ${3:c} \\end{pmatrix}' },
    { p: 'underbrace', d: 'Brace with a label underneath', b: '\\underbrace{${1:x}}_{${2:\\text{label}}}' },
    { p: 'overset', d: 'Symbol above a sign', b: '\\overset{${1:!}}{${2:=}}' },
    // text and units
    { p: 'text', d: 'Words inside math', b: '\\text{${1:text}}' },
    { p: 'mathrm', d: 'Upright letters (d, e, units)', b: '\\mathrm{${1:d}}' },
    { p: 'unit', d: 'Unit after a number: 5 m/s', b: '\\,\\text{${1:m/s}}' },
    { p: 'sci', d: 'Scientific notation × 10ⁿ', b: '\\times 10^{${1:3}}' },
    { p: 'deg', d: 'Degrees °', b: '^\\circ' },
    // relations and operators
    sym('cdot', 'Dot product ·'), sym('times', 'Cross product ×'), sym('approx', '≈'), sym('propto', '∝'),
    sym('pm', '±'), sym('infty', '∞'), sym('to', '→ (limit, mapping)'), sym('Rightarrow', '⇒ implies'),
    sym('le', '≤'), sym('ge', '≥'), sym('ne', '≠'), sym('ll', '≪'), sym('gg', '≫'), sym('sim', '∼ order of'),
    sym('nabla', '∇'), sym('partial', '∂'), sym('perp', '⊥'), sym('parallel', '∥'),
    // greek
    sym('alpha', 'α'), sym('beta', 'β'), sym('gamma', 'γ'), sym('delta', 'δ'), sym('epsilon', 'ε'),
    sym('varepsilon', 'ε (curly)'), sym('theta', 'θ'), sym('lambda', 'λ'), sym('mu', 'μ'), sym('nu', 'ν'),
    sym('pi', 'π'), sym('rho', 'ρ'), sym('sigma', 'σ'), sym('tau', 'τ'), sym('phi', 'φ'), sym('varphi', 'φ (curly)'),
    sym('omega', 'ω'), sym('Gamma', 'Γ'), sym('Delta', 'Δ'), sym('Theta', 'Θ'), sym('Lambda', 'Λ'),
    sym('Sigma', 'Σ'), sym('Phi', 'Φ'), sym('Omega', 'Ω'),
  ];

  // Pixel position of a caret index inside a textarea (mirror-div trick).
  function caretXY(ta, pos) {
    const cs = getComputedStyle(ta);
    const div = document.createElement('div');
    ['boxSizing', 'width', 'fontFamily', 'fontSize', 'fontWeight', 'lineHeight', 'letterSpacing', 'tabSize',
     'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
     'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth', 'borderStyle', 'whiteSpace', 'wordWrap', 'overflowWrap']
      .forEach((k) => { div.style[k] = cs[k]; });
    div.style.position = 'absolute'; div.style.visibility = 'hidden'; div.style.top = '0'; div.style.left = '-9999px';
    div.style.overflow = 'hidden';
    div.textContent = ta.value.slice(0, pos);
    const span = document.createElement('span'); span.textContent = ta.value.slice(pos, pos + 1) || '.';
    div.appendChild(span);
    document.body.appendChild(div);
    const r = ta.getBoundingClientRect();
    const x = r.left + parseFloat(cs.borderLeftWidth) + span.offsetLeft - ta.scrollLeft;
    const y = r.top + parseFloat(cs.borderTopWidth) + span.offsetTop - ta.scrollTop;
    const h = span.offsetHeight;
    div.remove();
    return { x, y, h };
  }

  // Body -> { text, stops: [{ s, e }] } with stops in visiting order
  // (${1} ${2} … then $0, or the end of the text).
  function expandSnippet(body, indent) {
    body = body.replace(/\n/g, '\n' + indent);
    const found = [];
    let text = '', last = 0;
    body.replace(/\$\{(\d+):([^}]*)\}|\$(\d+)/g, (m, n1, def, n2, at) => {
      text += body.slice(last, at);
      const n = +(n1 != null ? n1 : n2);
      const val = n1 != null ? def : '';
      found.push({ n, s: text.length, e: text.length + val.length });
      text += val;
      last = at + m.length;
      return m;
    });
    text += body.slice(last);
    // A number used twice is visited once (the first copy).
    const seen = new Set();
    const stops = found.filter((f) => f.n > 0 && !seen.has(f.n) && seen.add(f.n)).sort((a, b) => a.n - b.n);
    const zero = found.find((f) => f.n === 0);
    stops.push(zero ? { s: zero.s, e: zero.s } : { s: text.length, e: text.length });
    return { text, stops: stops.map(({ s, e }) => ({ s, e })) };
  }

  /** Attaches completion + tab stops to a textarea.
      mode 'line': word at the start of a line, backslash optional, 2+ letters.
      mode 'cmd' : a \command anywhere, 1+ letters after the backslash. */
  function attachSnippets(ta, list, mode) {
    let pop = null;          // { start, end, items, index, el }
    let stops = null;        // { list: [{s,e}], i, len }
    let inserting = false;

    function close() { if (pop && pop.el) pop.el.remove(); pop = null; }
    function endStops() { stops = null; }

    function word(force) {
      const v = ta.value, pos = ta.selectionStart;
      if (pos !== ta.selectionEnd) return null;
      const lineStart = v.lastIndexOf('\n', pos - 1) + 1;
      const before = v.slice(lineStart, pos);
      if (mode === 'line') {
        const m = before.match(/^(\s*)(\\?[A-Za-z]*)$/);
        return m ? { start: lineStart + m[1].length, end: pos, q: m[2].replace(/^\\/, '') } : null;
      }
      // \command not preceded by another backslash (\\ is a line break)
      const m = before.match(/(^|[^\\])\\([A-Za-z]*)$/);
      if (m) return { start: pos - m[2].length - 1, end: pos, q: m[2] };
      return force ? { start: pos, end: pos, q: '' } : null;
    }
    function matches(q) {
      const lq = q.toLowerCase();
      const starts = list.filter((s) => s.p.toLowerCase().startsWith(lq));
      // Exact-case first, so \D lists Delta before delta.
      starts.sort((a, b) => (b.p.startsWith(q) ? 1 : 0) - (a.p.startsWith(q) ? 1 : 0));
      const inner = lq ? list.filter((s) => !s.p.toLowerCase().startsWith(lq) && s.p.toLowerCase().includes(lq)) : [];
      return starts.concat(inner);
    }
    function update(force) {
      const w = word(force);
      const min = mode === 'line' ? 2 : 1;
      if (!w || (!force && w.q.length < min)) { close(); return; }
      const items = matches(w.q);
      if (!items.length) { close(); return; }
      const keep = pop && pop.items[pop.index] ? items.indexOf(pop.items[pop.index]) : -1;
      pop = Object.assign(pop || {}, { start: w.start, end: w.end, items, index: Math.max(0, keep) });
      render();
    }
    function render() {
      if (!pop) return;
      let el = pop.el;
      if (!el) {
        el = pop.el = document.createElement('div');
        el.className = 'ed-snip';
        el.setAttribute('role', 'listbox');
        document.body.appendChild(el);
      }
      el.textContent = '';
      pop.items.forEach((s, i) => {
        const it = document.createElement('div');
        it.className = 'ed-snip-item' + (i === pop.index ? ' on' : '');
        it.setAttribute('role', 'option');
        const a = document.createElement('b'); a.textContent = mode === 'cmd' ? '\\' + s.p : s.p;
        const b = document.createElement('span'); b.textContent = s.d;
        it.append(a, b);
        // mousedown, not click: keeps focus (and the caret) in the textarea
        it.addEventListener('mousedown', (e) => { e.preventDefault(); accept(i); });
        it.addEventListener('mousemove', () => { if (pop && pop.index !== i) { pop.index = i; render(); } });
        el.appendChild(it);
      });
      const c = caretXY(ta, pop.start);
      const w = el.offsetWidth, h = el.offsetHeight;
      let top = c.y + c.h + 2;
      if (top + h > window.innerHeight - 8) top = Math.max(8, c.y - h - 2);
      el.style.left = Math.max(8, Math.min(c.x, window.innerWidth - w - 8)) + 'px';
      el.style.top = top + 'px';
      const on = el.children[pop.index];
      if (on) on.scrollIntoView({ block: 'nearest' });
    }
    function accept(i) {
      if (!pop) return;
      const s = pop.items[i == null ? pop.index : i];
      const { start, end } = pop;
      close();
      if (!s) return;
      const v = ta.value;
      const lineStart = v.lastIndexOf('\n', start - 1) + 1;
      const indent = v.slice(lineStart, start).match(/^\s*/)[0];
      const { text, stops: rel } = expandSnippet(s.b, indent);
      ta.focus();
      ta.setSelectionRange(start, end);
      // execCommand keeps Ctrl+Z working and fires the input event that
      // updates the draft; setRangeText is the fallback where it's missing.
      inserting = true;
      let ok = false;
      try { ok = document.execCommand('insertText', false, text); } catch (e) { ok = false; }
      if (!ok) { ta.setRangeText(text, start, end, 'end'); ta.dispatchEvent(new Event('input')); }
      inserting = false;
      const abs = rel.map((r) => ({ s: start + r.s, e: start + r.e }));
      // Only the end stop: nothing to visit, just place the caret.
      if (abs.length === 1) { ta.setSelectionRange(abs[0].s, abs[0].e); endStops(); return; }
      stops = { list: abs, i: 0, len: ta.value.length };
      ta.setSelectionRange(abs[0].s, abs[0].e);
    }
    function goStop(dir) {
      const n = stops.i + dir;
      if (n < 0) return;
      stops.i = n;
      const st = stops.list[n];
      ta.setSelectionRange(st.s, st.e);
      if (n === stops.list.length - 1) endStops();     // reached the end
    }

    ta.addEventListener('input', (e) => {
      if (inserting) return;
      // Keep tab stops in place while the current one is being typed into.
      if (stops) {
        const delta = ta.value.length - stops.len;
        stops.len = ta.value.length;
        const cur = stops.list[stops.i];
        const caret = ta.selectionStart;
        if (caret < cur.s || caret > cur.e + delta) endStops();
        else {
          cur.e += delta;
          for (let j = stops.i + 1; j < stops.list.length; j++) { stops.list[j].s += delta; stops.list[j].e += delta; }
        }
      }
      if (e.inputType === 'insertText' || e.inputType === 'deleteContentBackward') update(false);
      else close();
    });
    ta.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === ' ') { e.preventDefault(); update(true); return; }
      // Alt+arrows / Alt+N switch problems (keyboard navigation): leave the
      // list and any tab stops to that instead of moving inside them.
      if (e.altKey) { close(); endStops(); return; }
      if (pop) {
        const n = pop.items.length;
        if (e.key === 'ArrowDown') { e.preventDefault(); pop.index = (pop.index + 1) % n; render(); return; }
        if (e.key === 'ArrowUp') { e.preventDefault(); pop.index = (pop.index - 1 + n) % n; render(); return; }
        if (e.key === 'Tab' || e.key === 'Enter') { e.preventDefault(); accept(); return; }
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); return; }
        if (/^(ArrowLeft|ArrowRight|Home|End)$/.test(e.key)) close();
      }
      if (stops) {
        if (e.key === 'Tab') { e.preventDefault(); goStop(e.shiftKey ? -1 : 1); return; }
        if (e.key === 'Escape') { e.preventDefault(); endStops(); }
      }
    });
    ta.addEventListener('blur', () => { close(); endStops(); });
    ta.addEventListener('scroll', close);
    ta.addEventListener('mousedown', () => { close(); endStops(); });
    window.addEventListener('resize', close);
  }
  // SVG box: the same start-of-line completion, for the usual shapes.
  // Colours are the theme ones (#000 text, #f00 / #00f accents, #eee surface).
  const SVG_SNIPPETS = [
    { p: 'layer', d: 'Layer: appears at the next step', b: '<g data-layer="${1:Name}">\n  $0\n</g>' },
    { p: 'layersteps', d: 'Layer with steps of its own (data-step="2" on an element inside)', b: '<g data-layer="${1:Name}" data-steps="${2:2}">\n  $0\n</g>' },
    { p: 'line', d: 'Line', b: '<line x1="${1:0}" y1="${2:0}" x2="${3:100}" y2="${4:0}" stroke="${5:#000}" stroke-width="${6:2}"/>' },
    { p: 'arrow', d: 'Arrow (uses an arrowhead marker)', b: '<line x1="${1:0}" y1="${2:0}" x2="${3:100}" y2="${4:0}" stroke="${5:#f00}" stroke-width="2" marker-end="url(#${6:head-red})"/>' },
    { p: 'arrowhead', d: 'Arrowhead marker (one per colour)', b: '<defs>\n  <marker id="${1:head-red}" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">\n    <path d="M0 0 10 5 0 10z" fill="${2:#f00}"/>\n  </marker>\n</defs>' },
    { p: 'dashed', d: 'Dashed line', b: '<line x1="${1:0}" y1="${2:0}" x2="${3:100}" y2="${4:0}" stroke="${5:#000}" stroke-width="1.5" stroke-dasharray="6 4"/>' },
    { p: 'rect', d: 'Rectangle (block)', b: '<rect x="${1:0}" y="${2:0}" width="${3:60}" height="${4:40}" fill="${5:#eee}" stroke="#000" stroke-width="2"/>' },
    { p: 'circle', d: 'Circle', b: '<circle cx="${1:0}" cy="${2:0}" r="${3:20}" fill="none" stroke="${4:#000}" stroke-width="2"/>' },
    { p: 'dot', d: 'Filled point', b: '<circle cx="${1:0}" cy="${2:0}" r="3" fill="${3:#000}"/>' },
    { p: 'polygon', d: 'Polygon (incline, triangle…)', b: '<polygon points="${1:0,100 160,100 160,20}" fill="${2:#eee}" stroke="#000" stroke-width="2"/>' },
    { p: 'path', d: 'Path', b: '<path d="M${1:0 0} L${2:100 0}" fill="none" stroke="${3:#000}" stroke-width="2"/>' },
    { p: 'text', d: 'Text label', b: '<text x="${1:0}" y="${2:0}" font-size="${3:16}" font-style="italic" fill="${4:#000}">${5:F}</text>' },
  ];

  attachSnippets(tikzEl, TIKZ_SNIPPETS, 'line');
  attachSnippets(svgEl, SVG_SNIPPETS, 'line');
  attachSnippets(solEl, SOLUTION_SNIPPETS, 'cmd');


  /* ───────────────────────── site version ─────────────────────────
     Pale "v12.1.0" in the top bar. The version this page is running is the
     one version.json said when it loaded (the editor has no copy of
     CURRENT_VERSION, so there is no extra place to bump). Re-checked every
     5 minutes and when the tab comes back; once version.json moves on, the
     label turns red — "(outdated)!" — and tapping it reloads.

     Reloading is safe: drafts and history live in localStorage, which a
     reload never touches (they are flushed first, see flushDrafts). Only the
     service worker's file cache is cleared, the same way the main site does,
     so one reload is enough to get the new files. */
  const VERSION_URL = '/version.json';
  const VERSION_CHECK_MS = 5 * 60 * 1000;
  let versionAtLoad = null;
  async function fetchSiteVersion() {
    try {
      const r = await fetch(VERSION_URL + '?_=' + Date.now(), { cache: 'no-store' });
      if (!r.ok) return null;
      const d = await r.json();
      return (d && typeof d.version === 'string' && d.version.trim()) || null;
    } catch (e) { return null; }
  }
  async function checkSiteVersion() {
    const v = await fetchSiteVersion();
    if (!v) return;                                   // offline / server hiccup: keep what is shown
    const el = $('edVer');
    if (!versionAtLoad) versionAtLoad = v;
    const outdated = v !== versionAtLoad;
    el.hidden = false;
    el.classList.toggle('outdated', outdated);
    el.textContent = outdated ? `v${versionAtLoad} (outdated)!` : `v${versionAtLoad}`;
    el.title = outdated ? `Version ${v} is out. Tap to reload; drafts are kept.` : 'Site version';
    el.disabled = !outdated;
  }
  // Same message the main site sends (sw.js 'purge-update-cache'); resolves
  // regardless, so a missing or silent service worker never blocks reload.
  function purgeSwCache() {
    return new Promise((resolve) => {
      if (!('serviceWorker' in navigator) || !navigator.serviceWorker.controller) { resolve(); return; }
      const ch = new MessageChannel();
      const t = setTimeout(resolve, 2000);
      ch.port1.onmessage = () => { clearTimeout(t); resolve(); };
      try { navigator.serviceWorker.controller.postMessage({ type: 'purge-update-cache' }, [ch.port2]); }
      catch (e) { clearTimeout(t); resolve(); }
    });
  }
  $('edVer').addEventListener('click', async () => {
    if (!$('edVer').classList.contains('outdated')) return;
    flushDrafts();
    $('edVer').textContent = 'Updating…';
    await purgeSwCache();
    location.reload();
  });
  checkSiteVersion();
  setInterval(() => { if (!document.hidden) checkSiteVersion(); }, VERSION_CHECK_MS);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) checkSiteVersion(); });

  /* ───────────────────────── site identicon ─────────────────────────
     The forum identicon of whoever is signed in on the main site in this
     browser, shown after the @name. Read-only use of the main site's own
     storage (same origin, js/forum.js): the claimed nickname, and its avatar
     cache, keyed by lowercased nickname. A cache miss is fetched from
     DiceBear with the same URL and seed the site uses (claim-nickname.ts)
     and written back into that cache, as forum.js itself would.
     Nothing shows if no nickname is claimed here. */
  const SITE_NICK_KEY = P + '_forum_nickname';
  const SITE_AVATAR_CACHE_KEY = P + '_forum_avatar_cache';
  const DICEBEAR_IDENTICON = 'https://api.dicebear.com/10.x/identicon/svg?seed=';
  function readAvatarCache() {
    try { const c = JSON.parse(localStorage.getItem(SITE_AVATAR_CACHE_KEY)); return c && typeof c === 'object' ? c : {}; }
    catch (e) { return {}; }
  }
  async function siteIdenticonSvg(nick) {
    const hit = readAvatarCache()[nick.toLowerCase()];
    if (hit && hit.svg) return hit.svg;
    try {
      const r = await fetch(DICEBEAR_IDENTICON + encodeURIComponent(nick));
      if (!r.ok) return null;
      const svg = await r.text();
      const c = readAvatarCache();
      c[nick.toLowerCase()] = { svg, at: Date.now() };
      try { localStorage.setItem(SITE_AVATAR_CACHE_KEY, JSON.stringify(c)); } catch (e) { /* best-effort */ }
      return svg;
    } catch (e) { return null; }
  }
  async function showSiteIdenticon() {
    const el = $('edFace');
    if (!el) return;
    let nick = null;
    try { nick = (localStorage.getItem(SITE_NICK_KEY) || '').trim() || null; } catch (e) {}
    if (!nick) { el.hidden = true; el.textContent = ''; return; }
    const svg = await siteIdenticonSvg(nick);
    if (!svg) { el.hidden = true; return; }
    // Shown as an <img>, not inlined: an SVG loaded as an image can't run
    // script or fetch anything, so this third-party markup needs no
    // sanitizing — and DiceBear's <use href="#row-…"> squares (which
    // DOMPurify always strips) render as they should.
    const img = document.createElement('img');
    img.alt = '';
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
    el.textContent = '';
    el.appendChild(img);
    el.title = `Signed in on the site as @${nick}`;
    el.hidden = false;
  }
  // Claiming, renaming or dropping the nickname in another tab updates this.
  window.addEventListener('storage', (e) => {
    if (e.key === SITE_NICK_KEY || e.key === null) showSiteIdenticon();
  });

  /* ───────────────────────── keyboard navigation ─────────────────────────
     Alt+↑ / Alt+↓  previous / next problem, in sidebar order. With the
                    "has work" filter on, only the problems it shows.
     Alt+N          next problem with no work at all (no dot), wrapping
                    around; retired problems are skipped.
     Work from inside the text boxes too (e.code, so a Mac's Option+N
     doesn't type "˜"), and never fire while the key gate is up. */
  const untouched = (p) => !serverIndex[p.key] && !hasContent(drafts[p.key]);
  function stepProblem(dir) {
    const pool = onlyTouched ? problems.filter((p) => !untouched(p) || p === cur) : problems;
    const i = pool.indexOf(cur);
    const next = pool[i + dir];
    if (next) select(next.key);
    else toast(dir > 0 ? 'Last problem.' : 'First problem.');
  }
  function nextEmpty() {
    const start = problems.indexOf(cur);
    for (let k = 1; k <= problems.length; k++) {
      const p = problems[(start + k) % problems.length];
      if (!p.retired && untouched(p) && p !== cur) { select(p.key); return; }
    }
    toast('Every problem has some work.', 'ok');
  }
  document.addEventListener('keydown', (e) => {
    if (!e.altKey || e.ctrlKey || e.metaKey || !cur || !gate.hidden || !problems.length) return;
    if (e.code === 'ArrowDown' && !e.shiftKey) { e.preventDefault(); stepProblem(1); }
    else if (e.code === 'ArrowUp' && !e.shiftKey) { e.preventDefault(); stepProblem(-1); }
    else if (e.code === 'KeyN' && !e.shiftKey) { e.preventDefault(); nextEmpty(); }
  });

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
    const lbl = document.createElement('span'); lbl.className = 'ed-who-label'; lbl.textContent = '|';
    // The name doubles as the sign-out button.
    const who = document.createElement('button');
    who.className = 'ed-who-name'; who.title = 'Sign out';
    who.textContent = editorName ? '@' + editorName : 'editor';
    who.addEventListener('click', () => openSignOut(who));
    const face = document.createElement('span'); face.className = 'ed-face'; face.id = 'edFace'; face.hidden = true;
    $('edWho').append(lbl, who, face);
    showSiteIdenticon();
    try { serverIndex = await SolutionStore.index(); } catch (e) { serverIndex = {}; }
    // For the "Who wrote this solution?" list, so publishing never waits on it.
    SolutionStore.editors().then((l) => { editorsCache = editorsCache || l; }).catch(() => {});
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
    select(byKey.has(last) ? last : problems[0].key, false);
  }

  renderViewer();
  if (validKey(localStorage.getItem(LS.key))) boot();
  else showGate('');
})();
