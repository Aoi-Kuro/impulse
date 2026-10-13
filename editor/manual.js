/* Editor manual — the 📖 screen of /editor.
   Same docs browser as the practice site's manual (js/manual.js,
   css/manual.css): sections and pages on the left, the chosen page on the
   right. Content lives in editor/manual.json, so the copy can be edited
   without touching code.

   Pages can embed live examples that run on the editor's own engines, so
   an example always looks exactly like the editor and the site show it:
     .edm-demo[data-demo="tikz"]  TikZ → TikZJax, through the editor's own
                                  compile queue and preamble (window.edCompileTikz)
     .edm-demo[data-demo="svg"]   SVG body → svgfBuild (editor/svg-figure.js)
     .edm-demo[data-demo="sol"]   solution text → renderSolutionInto
   Each holds a <textarea> with the starting code, optionally a
   <p class="edm-note"> shown underneath, and for TikZ data-caps='[…]'
   (one caption per step). Links <a data-goto="page-id"> open another page. */
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const screen = $('edManual'), sidebar = $('edmSidebar'), content = $('edmContent'), btn = $('edManualBtn');
  if (!screen || !sidebar || !content || !btn) return;

  const mk = (tag, cls, text) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  };

  // Shown if editor/manual.json can't be fetched.
  const FALLBACK = [{
    id: 'unavailable', icon: '⚠️', title: 'Manual unavailable',
    subsections: [{ id: 'unavailable-notice', title: 'Content could not be loaded',
      html: '<p>The manual could not be loaded. Check the connection and open it again.</p>' }],
  }];
  let sections = null;
  const ready = fetch('/editor/manual.json', { cache: 'no-cache' })
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error('bad response'))))
    .then((d) => { sections = Array.isArray(d) && d.length ? d : FALLBACK; })
    .catch(() => { sections = FALLBACK; });

  // Kept while the page is loaded (memory only), so flipping between the
  // manual and a problem returns to the page you were reading.
  const expanded = new Set();
  let active = null;

  /* ── open / close ── */
  const isOpen = () => !screen.hidden;
  async function open() {
    screen.hidden = false;
    screen.classList.remove('fading-out');
    btn.setAttribute('aria-expanded', 'true');
    document.body.classList.add('man-open');
    if (!sections) {
      sidebar.textContent = '';
      sidebar.append(mk('div', 'manual-loading', 'Loading…'));
      await ready;
    }
    renderSidebar();
    renderContent();
  }
  function close() {
    btn.setAttribute('aria-expanded', 'false');
    document.body.classList.remove('man-open');
    screen.classList.add('fading-out');
    setTimeout(() => { screen.hidden = true; screen.classList.remove('fading-out'); }, 200);
  }
  btn.addEventListener('click', () => (isOpen() ? close() : open()));
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || !isOpen() || document.querySelector('.ed-lc-back')) return;
    const t = e.target;
    if (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) && screen.contains(t)) { t.blur(); return; }
    close();
  });

  /* ── sidebar ── */
  function renderSidebar() {
    sidebar.textContent = '';
    sections.forEach((s) => {
      const box = mk('div', 'manual-section' + (expanded.has(s.id) ? ' expanded' : ''));
      const head = mk('button', 'manual-section-header');
      head.type = 'button';
      head.append(mk('span', 'manual-section-chevron', '▸'), mk('span', 'manual-section-icon', s.icon), mk('span', 'manual-section-title', s.title));
      head.addEventListener('click', () => {
        if (expanded.has(s.id)) expanded.delete(s.id); else expanded.add(s.id);
        renderSidebar();
      });
      const list = mk('div', 'manual-subsection-list');
      s.subsections.forEach((sub) => {
        const b = mk('button', 'manual-subsection-btn' + (sub.id === active ? ' active' : ''), sub.title);
        b.type = 'button';
        b.addEventListener('click', () => select(sub.id));
        list.append(b);
      });
      box.append(head, list);
      sidebar.append(box);
    });
  }

  // Every page in reading order, for the previous / next links.
  const flat = () => sections.flatMap((s) => s.subsections.map((sub) => ({ s, sub })));

  function select(id) {
    const hit = flat().find((x) => x.sub.id === id);
    if (!hit) return;
    active = id;
    expanded.add(hit.s.id);
    renderSidebar();
    renderContent();
    screen.scrollTop = 0;
  }

  /* ── content ── */
  function renderContent() {
    demoGen++;
    const pages = flat();
    const i = pages.findIndex((x) => x.sub.id === active);
    content.textContent = '';
    if (i < 0) {
      active = null;
      const ph = mk('div', 'manual-placeholder');
      ph.append(mk('div', 'manual-placeholder-icon', '📖'), mk('div', null, 'Pick a topic on the left to read about it here.'));
      content.append(ph);
      return;
    }
    const { s, sub } = pages[i];
    const body = mk('div', 'manual-content-body');
    body.innerHTML = sub.html;            // our own content from editor/manual.json
    content.append(mk('div', 'manual-content-eyebrow', `${s.icon} ${s.title}`), mk('h2', 'manual-content-title', sub.title), body);

    const pager = mk('div', 'edm-pager');
    const link = (x, label, cls) => {
      const b = mk('button', 'edm-pager-btn ' + cls);
      b.type = 'button';
      b.append(mk('small', null, label), mk('span', null, x.sub.title));
      b.addEventListener('click', () => select(x.sub.id));
      return b;
    };
    if (pages[i - 1]) pager.append(link(pages[i - 1], '← Previous', 'prev'));
    if (pages[i + 1]) pager.append(link(pages[i + 1], 'Next →', 'next'));
    content.append(pager);

    // Examples start once the page is typeset, so MathJax never works on
    // nodes they move or re-render themselves.
    const gen = demoGen;
    Promise.resolve(typeof renderMathIn === 'function' ? renderMathIn(body) : null).then(() => {
      if (gen === demoGen) body.querySelectorAll('.edm-demo').forEach(initDemo);
    });
  }

  content.addEventListener('click', (e) => {
    const a = e.target.closest('[data-goto]');
    if (!a) return;
    e.preventDefault();
    select(a.getAttribute('data-goto'));
  });

  /* ── live examples ── */
  let demoGen = 0;                       // bumped per page render: late results from a left page are dropped

  // The figure part: a stage, ‹ step › and the step's caption.
  function figOut(demo) {
    const out = mk('div', 'edm-out');
    const stage = mk('div', 'edm-stage fig');
    const nav = mk('div', 'edm-nav');
    const prev = mk('button', 'edm-navbtn', '‹'); prev.type = 'button'; prev.setAttribute('aria-label', 'Previous step');
    const next = mk('button', 'edm-navbtn', '›'); next.type = 'button'; next.setAttribute('aria-label', 'Next step');
    const no = mk('span', 'edm-stepno');
    nav.append(prev, no, next);
    const cap = mk('div', 'edm-cap sol-text');
    out.append(stage, nav, cap);
    demo._k = 1;
    prev.addEventListener('click', () => { demo._k--; showStep(demo); });
    next.addEventListener('click', () => { demo._k++; showStep(demo); });
    return out;
  }
  function empty(stage, text, err) {
    stage.textContent = '';
    stage.append(mk('span', 'edm-empty' + (err ? ' err' : ''), text));
  }
  function mountFig(demo, svgs, labels) {
    const stage = demo.querySelector('.edm-stage');
    stage.textContent = '';
    const wrap = mk('div', 'fig-steps fig-sized');
    svgs.forEach((svg) => { const d = mk('div', 'fig-step'); d.innerHTML = figSanitizeSvg(svg); wrap.append(d); });
    stage.append(wrap);
    figCropToContent(wrap);               // same crop as the editor preview and the site
    demo._n = svgs.length;
    demo._labels = labels || null;
    demo._k = Math.min(Math.max(demo._k || 1, 1), demo._n);
    showStep(demo);
  }
  function showStep(demo) {
    const n = demo._n || 0, k = demo._k = Math.min(Math.max(demo._k, 1), Math.max(n, 1));
    demo.querySelectorAll('.fig-step').forEach((el, i) => el.classList.toggle('on', i === k - 1));
    const nav = demo.querySelector('.edm-nav');
    nav.hidden = n <= 1;
    const [prev, no, next] = nav.children;
    prev.disabled = k <= 1; next.disabled = k >= n;
    no.textContent = `Step ${k} / ${n}` + (demo._labels && demo._labels[k - 1] ? ` · ${demo._labels[k - 1]}` : '');
    const cap = demo.querySelector('.edm-cap');
    const t = (demo._caps || [])[k - 1] || '';
    if (t && typeof renderSolutionInto === 'function') renderSolutionInto(cap, t); else cap.textContent = '';
  }

  function initDemo(demo) {
    const kind = demo.getAttribute('data-demo');
    const ta = demo.querySelector('textarea');
    if (!ta || demo._ready) return;
    demo._ready = true;
    ta.classList.add('edm-src');
    ta.spellcheck = false;
    ta.setAttribute('autocapitalize', 'off');
    ta.setAttribute('autocomplete', 'off');
    try { demo._caps = JSON.parse(demo.getAttribute('data-caps') || '[]'); } catch (e) { demo._caps = []; }
    const start = ta.value;
    const note = demo.querySelector('.edm-note');

    const bar = mk('div', 'edm-bar');
    const label = { tikz: 'TikZ', svg: 'SVG', sol: 'Solution' }[kind] || kind;
    bar.append(mk('span', 'edm-bar-label', label + (kind === 'tikz' ? ' · Ctrl+Enter compiles' : ' · live')));
    const status = mk('span', 'edm-status');
    bar.append(status);
    const reset = mk('button', 'edm-btn', 'Reset'); reset.type = 'button';
    reset.title = 'Back to the original example';
    bar.append(reset);
    let run = null;
    if (kind === 'tikz') { run = mk('button', 'edm-btn primary', '▶ Compile'); run.type = 'button'; bar.append(run); }

    const src = mk('div', 'edm-in');
    demo.insertBefore(bar, demo.firstChild);
    ta.replaceWith(src);
    src.append(ta);
    // Same colours as the editor's own boxes (editor/highlight.js).
    if (typeof edHighlight === 'function') edHighlight(ta, kind === 'sol' ? 'latex' : kind);
    const out = kind === 'sol' ? mk('div', 'edm-out edm-solout sol-text') : figOut(demo);
    src.after(out);
    if (note) demo.append(note);
    const setStatus = (t, cls) => { status.textContent = t; status.className = 'edm-status ' + (cls || ''); };

    let timer = null;
    const gen = demoGen;
    const alive = () => gen === demoGen && demo.isConnected;

    if (kind === 'sol') {
      const draw = () => {
        if (!alive()) return;
        if (!ta.value.trim()) { out.textContent = ''; out.append(mk('span', 'edm-empty', 'Nothing to show yet')); return; }
        renderSolutionInto(out, ta.value);
      };
      ta.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(draw, 200); });
      reset.addEventListener('click', () => { ta.value = start; draw(); });
      draw();
      return;
    }

    if (kind === 'svg') {
      const stage = out.querySelector('.edm-stage');
      const warn = mk('div', 'edm-warn');
      out.append(warn);
      const build = async () => {
        if (!alive()) return;
        if (!ta.value.trim()) { demo._n = 0; showStep(demo); empty(stage, 'No figure'); warn.textContent = ''; setStatus(''); return; }
        let res;
        try { res = await svgfBuild(ta.value, {}); } catch (e) { res = { error: String((e && e.message) || e) }; }
        if (!alive()) return;
        warn.textContent = '';
        if (res.error) { setStatus('error', 'err'); empty(stage, 'This SVG could not be read: ' + res.error, true); return; }
        if (res.empty) { demo._n = 0; showStep(demo); empty(stage, 'Nothing is drawn yet'); setStatus('nothing drawn', 'err'); return; }
        mountFig(demo, res.svgs, res.n > 1 ? res.labels : null);
        setStatus(`ok · ${res.svgs.length} step${res.svgs.length > 1 ? 's' : ''}`, 'ok');
        const fixed = typeof svgfFixedColors === 'function' ? svgfFixedColors(ta.value) : [];
        if (fixed.length) {
          warn.append(mk('b', null, `${fixed.length} colour${fixed.length > 1 ? 's don’t' : ' doesn’t'} follow the theme: `));
          fixed.slice(0, 6).forEach((c) => {
            const chip = mk('span', 'ed-colchip');
            const i = mk('i'); i.style.background = c.css;
            chip.append(i, document.createTextNode(c.key));
            warn.append(chip);
          });
        }
        (res.notes || []).forEach((t) => warn.append(mk('div', null, t)));
      };
      ta.addEventListener('input', () => { setStatus('typing…'); clearTimeout(timer); timer = setTimeout(build, 250); });
      reset.addEventListener('click', () => { ta.value = start; demo._k = 1; build(); });
      build();
      return;
    }

    // TikZ: compiled on demand (it takes a few seconds), once on open.
    const stage = out.querySelector('.edm-stage');
    const warn = mk('div', 'edm-warn');
    out.append(warn);
    let busy = false, again = false;
    const compile = async () => {
      if (!alive()) return;
      if (typeof window.edCompileTikz !== 'function') { empty(stage, 'Live compiling is not available here.', true); return; }
      if (busy) { again = true; return; }
      busy = true; run.disabled = true;
      setStatus('compiling…', 'busy');
      const t0 = performance.now();
      let res = null;
      try { res = await window.edCompileTikz(ta.value); } catch (e) { res = null; }
      busy = false; run.disabled = false;
      if (!alive()) return;
      if (again) { again = false; compile(); return; }
      warn.textContent = '';
      if (!res || res.error) {
        setStatus('error', 'err');
        const lines = ((res && res.log) || []).join('\n').split('\n');
        const i = lines.findIndex((l) => l.startsWith('!'));
        warn.append(mk('b', null, res && res.timeout ? 'Compile timed out.' : (i >= 0 ? lines[i].replace(/^!\s*/, '') : 'TeX could not compile this figure.')));
        const ctx = i >= 0 && lines.slice(i + 1, i + 6).find((l) => /^l\.\d+/.test(l));
        if (ctx) { const c = mk('div'); c.append(mk('code', null, ctx.trim())); warn.append(c); }
        return;
      }
      mountFig(demo, res.svgs);
      setStatus(`ok · ${res.svgs.length} step${res.svgs.length > 1 ? 's' : ''} · ${((performance.now() - t0) / 1000).toFixed(1)} s`, 'ok');
    };
    run.addEventListener('click', compile);
    ta.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); compile(); }
    });
    ta.addEventListener('input', () => setStatus('edited · Compile to update'));
    reset.addEventListener('click', () => { ta.value = start; demo._k = 1; compile(); });
    empty(stage, 'Compiling…');
    compile();
  }
})();
