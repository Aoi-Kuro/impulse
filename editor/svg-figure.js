/* ═══════════════════════════════════════════════════════════════════
   svg-figure.js  ·  Figures drawn as SVG (the editor's "SVG" mode)
   ───────────────────────────────────────────────────────────────────
   The author types (or pastes) only the BODY of an SVG — the shapes,
   no <svg> header, since every drawing app writes a different one. A
   whole file pasted by mistake is accepted too: its header is ignored.

   What comes out is exactly what a TikZ figure produces: one normalized
   SVG per step, all with the same viewBox (js/figure.js), so the
   practice site shows both kinds the same way and never knows which
   one it got.

   Box      — found automatically from what is drawn, unless the author
              gives one ("x y width height"), which then clips like
              \useasboundingbox does in TikZ.
   Colours  — #000 text, #f00 accent 1, #00f accent 2, #eee surface
              (also c1–c4 and the stored values themselves). Anything
              else stays a fixed colour; the editor lists those so they
              can be mapped.
   Layers   — top-level groups, bottom (first in the file) to top:
                <g data-layer="Name">           a layer (wins if present)
                <g inkscape:groupmode="layer">  Inkscape's layers
                any other top-level <g>         when neither is used
              Layer k adds its content at the next step and keeps it.
              data-steps="n" on a layer gives it n steps of its own, and
              data-step="r" on one of its elements shows that element
              from the layer's r-th step. Elements outside every layer
              are always shown. A hidden layer (display="none", as
              Inkscape writes it) is left out.

   The Layers & colours panel edits the SOURCE through the svgfOp*
   functions below (source in, source out), so the text box stays the
   one truth and every change can be seen and undone there.

   Nothing here ever runs the author's markup: parsing happens in an
   inert <template>, and whatever is put into the page goes through
   figSanitizeSvg (DOMPurify) first.
   Requires js/figure.js.
   ─────────────────────────────────────────────────────────────────── */

const SVGF_NS = 'http://www.w3.org/2000/svg';
const SVGF_XLINK = 'http://www.w3.org/1999/xlink';
const SVGF_MAX_STEPS = 12;                 // same as MAX_STEPS in editor.js

// The four colours an author can pick, as written into the source, and
// the value css/figure.css maps to the live theme.
const SVGF_THEME = [
  { id: 'text',    hex: '#000000', write: '#000', marker: '#000',    label: 'Text',     css: 'var(--text)' },
  { id: 'accent',  hex: '#ff0000', write: '#f00', marker: '#ff0001', label: 'Accent 1', css: 'var(--accent)' },
  { id: 'accent2', hex: '#0000ff', write: '#00f', marker: '#ff0002', label: 'Accent 2', css: 'var(--accent2)' },
  { id: 'surface', hex: '#eeeeee', write: '#eee', marker: '#ff0004', label: 'Surface',  css: 'var(--surface)' },
];
// Also understood: c1–c4 as in TikZ, and the stored values (a TikZJax SVG pasted in).
const SVGF_MARKER_CSS = {
  '#000': 'var(--text)', '#ff0001': 'var(--accent)', '#ff0002': 'var(--accent2)',
  '#ff0003': 'var(--bg)', '#ff0004': 'var(--surface)',
};
const SVGF_ALIAS = { c1: '#ff0001', c2: '#ff0002', c3: '#ff0003', c4: '#ff0004' };

const SVGF_COLOR_PROPS = ['fill', 'stroke', 'stop-color', 'flood-color', 'lighting-color', 'color'];
const SVGF_OPACITY_OF = { fill: 'fill-opacity', stroke: 'stroke-opacity', 'stop-color': 'stop-opacity', 'flood-color': 'flood-opacity' };

// CSS properties that have an SVG presentation attribute. Drawing apps
// write styling as style="…" or <style> classes; both are turned into
// these attributes, because stored figures may not carry CSS.
const SVGF_PRES = new Set([
  'fill', 'fill-opacity', 'fill-rule', 'stroke', 'stroke-width', 'stroke-opacity', 'stroke-dasharray',
  'stroke-dashoffset', 'stroke-linecap', 'stroke-linejoin', 'stroke-miterlimit', 'opacity', 'color',
  'display', 'visibility', 'font-family', 'font-size', 'font-weight', 'font-style', 'font-variant',
  'text-anchor', 'dominant-baseline', 'alignment-baseline', 'baseline-shift', 'letter-spacing',
  'word-spacing', 'text-decoration', 'marker-start', 'marker-mid', 'marker-end', 'stop-color',
  'stop-opacity', 'clip-path', 'clip-rule', 'mask', 'filter', 'flood-color', 'flood-opacity',
  'lighting-color', 'overflow', 'paint-order', 'vector-effect', 'shape-rendering', 'writing-mode',
]);
// The ones children inherit — what has to travel with an element moved out of its layer.
const SVGF_INHERITED = ['fill', 'fill-opacity', 'fill-rule', 'stroke', 'stroke-width', 'stroke-opacity',
  'stroke-dasharray', 'stroke-dashoffset', 'stroke-linecap', 'stroke-linejoin', 'stroke-miterlimit',
  'color', 'font-family', 'font-size', 'font-weight', 'font-style', 'text-anchor', 'marker-start',
  'marker-mid', 'marker-end', 'clip-rule', 'visibility'];
const SVGF_INITIAL = { fill: '#000', stroke: 'none', 'stroke-width': '1', 'fill-opacity': '1', 'stroke-opacity': '1', 'stroke-dasharray': 'none' };

// Top-level things that are not drawn by themselves: never a layer, never listed.
const SVGF_RESOURCE = new Set(['defs', 'style', 'metadata', 'title', 'desc', 'script', 'symbol', 'marker',
  'linearGradient', 'radialGradient', 'pattern', 'clipPath', 'mask', 'filter']);
const svgfIsResource = (el) => SVGF_RESOURCE.has(el.localName) || el.localName.includes(':');

/* ───────────────────────── small helpers ───────────────────────── */

function svgfInt(v, lo, hi, dflt) {
  const n = parseInt(v, 10);
  return isFinite(n) ? Math.min(hi, Math.max(lo, n)) : dflt;
}
const svgfRound = (n) => Math.round(n * 1000) / 1000;

/** "x y w h" (spaces or commas) -> [x, y, w, h], or null when it isn't four numbers with w, h > 0. */
function svgfParseBox(s) {
  const a = String(s || '').trim().split(/[\s,]+/).filter(Boolean).map(Number);
  if (a.length !== 4 || !a.every(isFinite) || a[2] <= 0 || a[3] <= 0) return null;
  return a;
}
/** The box as it is stored: normalized "x y w h", or '' for automatic. */
const svgfBoxString = (s) => { const b = svgfParseBox(s); return b ? b.join(' ') : ''; };

/** style="a:b; c:d" -> Map, in order; !important is dropped. */
function svgfDecls(text) {
  const m = new Map();
  String(text || '').split(';').forEach((d) => {
    const i = d.indexOf(':');
    if (i < 0) return;
    const p = d.slice(0, i).trim().toLowerCase();
    const v = d.slice(i + 1).replace(/!important/i, '').trim();
    if (p && v) m.set(p, v);
  });
  return m;
}
const svgfDeclText = (m) => Array.from(m, ([p, v]) => `${p}:${v}`).join(';');

/** An element's own value for a styling property: style="" wins over the attribute, as in CSS. */
function svgfOwn(el, prop) {
  const st = el.getAttribute('style');
  if (st) { const v = svgfDecls(st).get(prop); if (v) return v; }
  return el.getAttribute(prop);
}

let _svgfCtx = null;
/** Any CSS colour -> { key, rgb, a }: key groups equal colours ("#rrggbb", or
    "rgba(…)" with transparency), rgb is "#rrggbb". c1–c4 -> their stored
    value. null for none / url(#…) / currentColor / anything not a colour. */
function svgfColor(v) {
  const s = String(v || '').trim().toLowerCase();
  if (!s || s === 'none' || s === 'transparent' || s === 'inherit' || s === 'currentcolor'
      || s.startsWith('url(') || s.startsWith('context-') || s.includes('var(')) return null;
  if (SVGF_ALIAS[s]) return { key: s, rgb: SVGF_ALIAS[s], a: 1 };
  if (!(window.CSS && CSS.supports('color', s))) return null;
  _svgfCtx = _svgfCtx || document.createElement('canvas').getContext('2d');
  _svgfCtx.fillStyle = '#000';
  _svgfCtx.fillStyle = s;
  const out = String(_svgfCtx.fillStyle);
  if (out[0] === '#') return { key: out, rgb: out, a: 1 };
  const m = out.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+))?\s*\)$/);
  if (!m) return null;
  const rgb = '#' + [m[1], m[2], m[3]].map((n) => (+n).toString(16).padStart(2, '0')).join('');
  const a = m[4] == null ? 1 : +m[4];
  return { key: a >= 1 ? rgb : out, rgb, a };
}

/** The stored value for a colour that follows the theme, or null for a fixed colour. */
function svgfMarkerOf(c) {
  if (!c) return null;
  const t = SVGF_THEME.find((x) => x.hex === c.rgb);
  if (t) return t.marker;
  return SVGF_MARKER_CSS[c.rgb] && c.rgb !== '#000' ? c.rgb : null;   // '#ff0001'… pasted as-is
}
/** CSS for showing a colour value in the editor's own UI (theme colours as variables). */
function svgfSwatchCss(v) {
  if (String(v || '').trim().toLowerCase() === 'currentcolor') return 'var(--text)';
  const c = svgfColor(v);
  if (!c) return null;
  const mk = svgfMarkerOf(c);
  return mk ? SVGF_MARKER_CSS[mk] : (c.a < 1 ? c.key : c.rgb);
}

/* ───────────────────────── parse + layers ───────────────────────── */

/** Source -> { wrap, root }. wrap is a detached <svg> holding the source as
    typed; root is where the drawing lives — wrap itself, or the pasted file's
    own <svg> when a whole file was pasted. The HTML parser is used on
    purpose: it is lenient (Inkscape's undeclared inkscape:/sodipodi:
    prefixes would make an XML parse fail) and a <template> is inert. */
function svgfParse(src) {
  const t = document.createElement('template');
  t.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg">' + String(src || '') + '</svg>';
  const wrap = t.content.firstElementChild;
  let root = wrap;
  const kids = Array.from(wrap.children).filter((el) => !svgfIsResource(el));
  if (kids.length === 1 && kids[0].localName === 'svg') root = kids[0];
  return { wrap, root };
}

const svgfHidden = (el) => el.getAttribute('display') === 'none' || svgfDecls(el.getAttribute('style')).get('display') === 'none';

function svgfLayerName(g, i) {
  return (g.getAttribute('data-layer') || '').trim() || (g.getAttribute('inkscape:label') || '').trim()
    || (g.getAttribute('id') || '').trim() || `Layer ${i + 1}`;
}

/** The layer structure of a parsed source (see the header for the rules).
    { mode, layers: [{ el, name, hidden, n, start, items }], loose, n, over, labels } —
    start is the layer's first global step; labels names every step. */
function svgfLayerInfo(root) {
  const top = Array.from(root.children).filter((el) => !svgfIsResource(el));
  const gs = top.filter((el) => el.localName === 'g');
  let mode = 'data';
  let layerEls = gs.filter((g) => g.hasAttribute('data-layer'));
  if (!layerEls.length) { mode = 'inkscape'; layerEls = gs.filter((g) => g.getAttribute('inkscape:groupmode') === 'layer'); }
  if (!layerEls.length) { mode = 'groups'; layerEls = gs; }
  if (!layerEls.length) mode = 'none';
  const set = new Set(layerEls);
  const labels = [];
  let s = 1;
  const layers = layerEls.map((g, i) => {
    const L = {
      el: g, name: svgfLayerName(g, i), hidden: svgfHidden(g),
      n: svgfInt(g.getAttribute('data-steps'), 1, SVGF_MAX_STEPS, 1),
      items: Array.from(g.children).filter((el) => !svgfIsResource(el)),
      start: s,
    };
    if (!L.hidden) {
      for (let r = 1; r <= L.n; r++) labels.push(L.n > 1 ? `${L.name} ${r}/${L.n}` : L.name);
      s += L.n;
    }
    return L;
  });
  const total = labels.length;
  const n = Math.max(1, Math.min(total, SVGF_MAX_STEPS));
  return { mode, layers, loose: top.filter((el) => !set.has(el)), n, over: total > SVGF_MAX_STEPS, labels: labels.slice(0, n) };
}

/** An element's step inside its layer (1 = the layer's first). */
const svgfItemStep = (el, L) => svgfInt(el.getAttribute('data-step'), 1, L.n, 1);

/** Everything the panel lists, in one fixed order: outside-layer elements, then each layer's. */
function svgfItems(info) {
  return [
    ...info.loose.map((el) => ({ el, layer: null })),
    ...info.layers.flatMap((L) => L.items.map((el) => ({ el, layer: L }))),
  ];
}

const _svgfOutlineCache = { src: null, out: null };
/** Steps of a source, cheap enough to call on every keystroke:
    { n, hasSteps, labels } — labels name each step after its layer. */
function svgfOutline(src) {
  if (_svgfOutlineCache.src === src) return _svgfOutlineCache.out;
  const info = svgfLayerInfo(svgfParse(src).root);
  const out = {
    n: info.n,
    hasSteps: info.n > 1,
    labels: info.n > 1 ? info.labels.map((l, i) => `${i + 1} · ${l}`) : null,
    over: info.over,
  };
  _svgfOutlineCache.src = src; _svgfOutlineCache.out = out;
  return out;
}

/* ───────────────────────── colours in a source ───────────────────────── */

/** Calls fn(value, set, orig) for every colour value in the source —
    presentation attributes, style="", and <style> blocks. set(newValue,
    alpha, orig) writes a replacement (alpha: the transparency the old value
    carried, moved to the matching *-opacity so it isn't lost).

    orig is the colour a theme colour was mapped FROM in Layers & colours,
    remembered in the source so the mapping can be changed or undone later:
    data-was-<prop>="#ffe8cc" on the element, or a CSS comment reading
    "was #ffe8cc" right after the value in a <style> block. set's orig: a colour to remember,
    null to forget, undefined to leave as it is. (Stored figures never see
    either: data- attributes and CSS are stripped when building.) */
function svgfEachColor(wrap, fn) {
  const els = [wrap, ...wrap.querySelectorAll('*')].filter((el) => !el.localName.includes(':'));
  els.forEach((el) => {
    const setOpacity = (prop, a, decls) => {
      const op = SVGF_OPACITY_OF[prop];
      if (!op || a >= 1) return;
      const prev = parseFloat(decls ? decls.get(op) : el.getAttribute(op));
      const v = String(svgfRound((isFinite(prev) ? prev : 1) * a));
      if (decls) decls.set(op, v); else el.setAttribute(op, v);
    };
    const was = (p) => el.getAttribute('data-was-' + p);
    const remember = (p, orig) => {
      if (orig === undefined) return;
      if (orig) el.setAttribute('data-was-' + p, orig); else el.removeAttribute('data-was-' + p);
    };
    SVGF_COLOR_PROPS.forEach((p) => {
      if (!el.hasAttribute(p)) return;
      fn(el.getAttribute(p), (nv, a, orig) => { el.setAttribute(p, nv); setOpacity(p, a); remember(p, orig); }, was(p));
    });
    const st = el.getAttribute('style');
    if (st) {
      const decls = svgfDecls(st);
      let changed = false;
      SVGF_COLOR_PROPS.forEach((p) => {
        if (!decls.has(p)) return;
        fn(decls.get(p), (nv, a, orig) => { decls.set(p, nv); setOpacity(p, a, decls); remember(p, orig); changed = true; }, was(p));
      });
      if (changed) el.setAttribute('style', svgfDeclText(decls));
    }
    if (el.localName === 'style') {
      let changed = false;
      const css = (el.textContent || '').replace(/([a-z-]+)(\s*:\s*)([^;}]+)/gi, (m, p, sep, v) => {
        if (!SVGF_COLOR_PROPS.includes(p.toLowerCase())) return m;
        const memo = v.match(/\/\*\s*was\s+([^*]+?)\s*\*\//);
        const clean = v.replace(/\/\*[\s\S]*?\*\//g, '').trim();
        let out = m;
        fn(clean, (nv, a, orig) => {
          const keep = orig === undefined ? (memo ? memo[1] : null) : orig;
          out = p + sep + nv + (keep ? `/*was ${keep}*/` : '');
          changed = true;
        }, memo ? memo[1] : null);
        return out;
      });
      if (changed) el.textContent = css;
    }
  });
}

/** Every distinct colour:
      theme:  [{ id, label, css, count }]   what follows the theme now
      fixed:  [{ key, css, count }]         what does not
      mapped: [{ key, css, count, theme }]  fixed colours mapped in Layers &
                                            colours, by their original value */
function svgfColorList(wrap) {
  const fixed = new Map(), theme = new Map(), mapped = new Map();
  svgfEachColor(wrap, (v, set, orig) => {
    const c = svgfColor(v);
    if (!c) return;
    const mk = svgfMarkerOf(c);
    if (mk) {
      const t = SVGF_THEME.find((x) => x.marker === mk) || { id: 'bg', label: 'Background', css: 'var(--bg)' };
      const e = theme.get(t.id) || { id: t.id, label: t.label, css: t.css, count: 0 };
      e.count++; theme.set(t.id, e);
      const o = orig && svgfColor(orig);
      if (o) {
        const m = mapped.get(o.key) || { key: o.key, css: o.a < 1 ? o.key : o.rgb, count: 0, theme: t.id };
        m.count++; mapped.set(o.key, m);
      }
    } else {
      const e = fixed.get(c.key) || { key: c.key, css: c.a < 1 ? c.key : c.rgb, count: 0 };
      e.count++; fixed.set(c.key, e);
    }
  });
  const byCount = (a, b) => b.count - a.count;
  return { theme: Array.from(theme.values()), fixed: Array.from(fixed.values()).sort(byCount), mapped: Array.from(mapped.values()).sort(byCount) };
}

/** Colours that will NOT follow the theme (for the editor's warnings). */
const svgfFixedColors = (src) => svgfColorList(svgfParse(src).wrap).fixed;

/* ───────────────────────── cleaning (build only) ───────────────────────── */

function svgfInlineCss(wrap) {
  const props = new Map();                       // el -> Map(prop -> value), later wins
  const put = (el, p, v) => {
    if (!v || v.includes('var(')) return;
    if (p === 'marker') { ['marker-start', 'marker-mid', 'marker-end'].forEach((q) => put(el, q, v)); return; }
    if (!SVGF_PRES.has(p)) return;
    let m = props.get(el);
    if (!m) props.set(el, (m = new Map()));
    m.set(p, v);
  };
  wrap.querySelectorAll('style').forEach((st) => {
    let sheet;
    try { sheet = new CSSStyleSheet(); sheet.replaceSync(st.textContent || ''); } catch (e) { return; }
    for (const rule of sheet.cssRules) {
      if (rule.type !== 1) continue;             // plain style rules only (no @media etc.)
      let els;
      try { els = wrap.querySelectorAll(rule.selectorText); } catch (e) { continue; }
      els.forEach((el) => {
        for (let i = 0; i < rule.style.length; i++) {
          const p = rule.style[i];
          put(el, p, rule.style.getPropertyValue(p).trim());
        }
      });
    }
    st.remove();
  });
  [wrap, ...wrap.querySelectorAll('[style]')].forEach((el) => {
    if (!el.hasAttribute('style')) return;
    svgfDecls(el.getAttribute('style')).forEach((v, p) => put(el, p, v));
    el.removeAttribute('style');
  });
  props.forEach((m, el) => m.forEach((v, p) => el.setAttribute(p, v)));
}

// <use> is not allowed in stored figures (the sanitizer removes it), so
// each one becomes a copy of what it points at.
function svgfExpandUse(wrap, notes) {
  let budget = 2000;
  for (;;) {
    const uses = wrap.querySelectorAll('use');
    if (!uses.length) break;
    for (const u of uses) {
      if (!wrap.contains(u)) continue;             // inside a copy made this round
      if (--budget < 0) {
        wrap.querySelectorAll('use').forEach((x) => x.remove());
        notes.push('Some <use> copies were dropped (too many, or they point at each other).');
        return;
      }
      const href = u.getAttribute('href') || u.getAttributeNS(SVGF_XLINK, 'href') || u.getAttribute('xlink:href') || '';
      const ref = href.startsWith('#') ? wrap.querySelector('#' + CSS.escape(href.slice(1))) : null;
      if (!ref || ref === u || ref.contains(u)) { u.remove(); continue; }
      const g = u.ownerDocument.createElementNS(SVGF_NS, 'g');
      Array.from(u.attributes).forEach((a) => {
        if (!/^(href|xlink:href|x|y|width|height|id)$/.test(a.name)) g.setAttribute(a.name, a.value);
      });
      const x = parseFloat(u.getAttribute('x')) || 0, y = parseFloat(u.getAttribute('y')) || 0;
      if (x || y) g.setAttribute('transform', ((g.getAttribute('transform') || '') + ` translate(${x} ${y})`).trim());
      if (ref.localName === 'symbol') Array.from(ref.childNodes).forEach((c) => g.appendChild(c.cloneNode(true)));
      else { const c = ref.cloneNode(true); c.removeAttribute('id'); g.appendChild(c); }
      u.replaceWith(g);
    }
  }
}

/** Turns the parsed source (in place) into plain SVG the stored figure may
    hold: no header, CSS, prefixes, <use>, images, hidden parts; theme
    colours as the stored values; black as the default fill. */
function svgfClean(wrap, root, notes) {
  // A whole pasted file: its <svg> becomes a group that keeps only its styling.
  if (root !== wrap) {
    const g = root.ownerDocument.createElementNS(SVGF_NS, 'g');
    Array.from(root.attributes).forEach((a) => {
      if (SVGF_PRES.has(a.name) || a.name === 'style' || a.name === 'class') g.setAttribute(a.name, a.value);
    });
    while (root.firstChild) g.appendChild(root.firstChild);
    root.replaceWith(g);
  }
  let images = 0;
  wrap.querySelectorAll('*').forEach((el) => {
    const n = el.localName;
    if (n.includes(':') || /^(metadata|title|desc|script|foreignObject|iframe)$/.test(n)) el.remove();
    else if (n === 'image') { images++; el.remove(); }
    else if (n === 'a') el.replaceWith(...el.childNodes);
  });
  if (images) notes.push(`${images} embedded image${images > 1 ? 's were' : ' was'} removed: a figure may only hold drawn shapes and text.`);
  svgfInlineCss(wrap);
  svgfExpandUse(wrap, notes);
  [wrap, ...wrap.querySelectorAll('*')].forEach((el) => {
    Array.from(el.attributes).forEach((a) => {
      if (a.localName === 'href' && a.namespaceURI === SVGF_XLINK || a.name === 'xlink:href') {
        if (!el.hasAttribute('href')) el.setAttribute('href', a.value);
        el.removeAttributeNode(a);
      } else if ((a.name.includes(':') && a.name !== 'xmlns') || a.name === 'class' || /^on/i.test(a.name)) {
        el.removeAttributeNode(a);
      }
    });
  });
  wrap.querySelectorAll('[display="none"]').forEach((el) => {
    if (!el.closest('defs, marker, symbol, pattern, clipPath, mask')) el.remove();
  });
  svgfEachColor(wrap, (v, set) => {
    const c = svgfColor(v);
    if (!c) return;
    const mk = svgfMarkerOf(c);
    if (mk) set(mk, c.a); else set(c.key, 1);
  });
  // SVG's own default fill is black, not the text colour; this makes it the text colour.
  if (!wrap.hasAttribute('fill')) wrap.setAttribute('fill', '#000');
}

/* ───────────────────────── build ───────────────────────── */

/** Source -> what is stored: one normalized SVG per step, sharing one viewBox.
    opts.box: the author's crop box ('' = automatic).
    opts.preview: one SVG with everything (the panel's preview), its listed
      elements marked data-ed-i (panel index) and data-ed-gs (first step).
    Resolves { svgs, n, labels, box, notes, empty }. Measuring needs the page,
    so this only runs in a browser window. */
async function svgfBuild(src, opts = {}) {
  const { wrap, root } = svgfParse(src);
  const info = svgfLayerInfo(root);
  const notes = [];
  svgfItems(info).forEach((it, i) => {
    if (opts.preview) it.el.setAttribute('data-ed-i', String(i));
    if (it.layer) it.el.setAttribute('data-ed-gs', String(Math.min(it.layer.start + svgfItemStep(it.el, it.layer) - 1, SVGF_MAX_STEPS)));
  });
  info.layers.forEach((L) => { if (L.hidden) L.el.remove(); });
  if (info.over) notes.push(`The layers add up to more than ${SVGF_MAX_STEPS} steps; everything past step ${SVGF_MAX_STEPS} appears at step ${SVGF_MAX_STEPS}.`);
  svgfClean(wrap, root, notes);

  const userBox = svgfParseBox(opts.box);
  if (opts.box && String(opts.box).trim() && !userBox) notes.push('The crop box is not four numbers (x y width height), so the box is found automatically.');
  let box = userBox;
  if (!box) {
    if (document.fonts && document.fonts.ready) { try { await document.fonts.ready; } catch (e) {} }
    const holder = document.createElement('div');
    holder.className = 'fig';
    holder.style.cssText = 'position:fixed;left:-99999px;top:0;width:600px;visibility:hidden;pointer-events:none';
    holder.innerHTML = figSanitizeSvg(new XMLSerializer().serializeToString(wrap));
    document.body.appendChild(holder);
    const svg = holder.querySelector('svg');
    const c = svg && figContentBox([svg]);
    holder.remove();
    if (!c) return { svgs: [], n: info.n, labels: info.labels, box: '', notes, empty: true };
    // Generous on purpose: the reader's browser crops to what it actually
    // draws (figCropToContent) but never past this box, so room for text
    // that renders wider on another device costs nothing.
    let m = 0.04 * Math.max(c.x1 - c.x0, c.y1 - c.y0);
    if (wrap.querySelector('text')) {
      let fs = 16;
      wrap.querySelectorAll('[font-size]').forEach((el) => { const v = parseFloat(el.getAttribute('font-size')); if (v > fs) fs = v; });
      m += fs * 0.6;
    }
    box = [c.x0 - m, c.y0 - m, c.x1 - c.x0 + 2 * m, c.y1 - c.y0 + 2 * m].map(svgfRound);
  }
  const boxStr = box.join(' ');

  const out = [];
  const count = opts.preview ? 1 : info.n;
  for (let k = 1; k <= count; k++) {
    const c = wrap.cloneNode(true);
    if (!opts.preview) c.querySelectorAll('[data-ed-gs]').forEach((el) => { if (+el.getAttribute('data-ed-gs') > k) el.remove(); });
    [c, ...c.querySelectorAll('*')].forEach((el) => {
      Array.from(el.attributes).forEach((a) => {
        if (a.name.startsWith('data-') && !(opts.preview && (a.name === 'data-ed-i' || a.name === 'data-ed-gs'))) el.removeAttributeNode(a);
      });
    });
    c.setAttribute('viewBox', boxStr);
    out.push(figNormalizeSvg(new XMLSerializer().serializeToString(c), opts.preview ? 'lc-' : `f${k}-`));
  }
  return { svgs: out, n: info.n, labels: info.labels, box: boxStr, notes, empty: false };
}

/* ───────────────────────── model for the panel ───────────────────────── */

function svgfDescribe(el) {
  const tag = el.localName;
  let label = (el.getAttribute('inkscape:label') || el.getAttribute('id') || '').trim();
  if (tag === 'text') {
    const t = (el.textContent || '').replace(/\s+/g, ' ').trim();
    if (t) label = `“${t.length > 28 ? t.slice(0, 27) + '…' : t}”`;
  } else if (tag === 'g') {
    const n = Array.from(el.children).filter((c) => !svgfIsResource(c)).length;
    label = (label ? label + ' · ' : '') + `${n} part${n === 1 ? '' : 's'}`;
  }
  // up to three colours it draws with: its own, else its contents'
  const sw = [];
  const add = (v) => { const css = svgfSwatchCss(v); if (css && !sw.includes(css) && sw.length < 3) sw.push(css); };
  [el, ...el.querySelectorAll('*')].some((x) => { add(svgfOwn(x, 'fill')); add(svgfOwn(x, 'stroke')); return sw.length >= 3; });
  return { tag, label, swatches: sw };
}

/** Everything the Layers & colours panel shows, as plain data. Items are
    identified by their index in svgfItems order, layers by position. */
function svgfModel(src) {
  const { wrap, root } = svgfParse(src);
  const info = svgfLayerInfo(root);
  const items = svgfItems(info);
  const index = new Map(items.map((it, i) => [it.el, i]));
  const item = (el, L) => Object.assign({ i: index.get(el), step: L ? svgfItemStep(el, L) : 1 }, svgfDescribe(el));
  return {
    mode: info.mode, n: info.n, over: info.over, labels: info.labels,
    loose: info.loose.map((el) => item(el, null)),
    layers: info.layers.map((L, j) => ({
      j, name: L.name, hidden: L.hidden, n: L.n, start: L.start,
      items: L.items.map((el) => item(el, L)),
    })),
    colors: svgfColorList(wrap),
  };
}

/* ───────────────────────── panel operations (source -> source) ───────────────────────── */

/** The source text of a parsed wrap: its contents, without our own <svg> tag. */
function svgfSerialize(wrap) {
  const s = new XMLSerializer().serializeToString(wrap);
  if (/^<svg\b[^>]*\/>$/.test(s)) return '';
  return s.replace(/^<svg\b[^>]*>/, '').replace(/<\/svg>\s*$/, '');
}

/** SVG transform list -> DOMMatrix. */
function svgfMatrix(str) {
  const m = new DOMMatrix();
  const re = /(matrix|translate|scale|rotate|skewX|skewY)\s*\(([^)]*)\)/g;
  let r;
  while ((r = re.exec(str || ''))) {
    const a = r[2].trim().split(/[\s,]+/).filter(Boolean).map(Number);
    if (r[1] === 'matrix' && a.length === 6) m.multiplySelf(new DOMMatrix(a));
    else if (r[1] === 'translate') m.translateSelf(a[0] || 0, a[1] || 0);
    else if (r[1] === 'scale') m.scaleSelf(a[0] ?? 1, a[1] ?? a[0] ?? 1);
    else if (r[1] === 'rotate') {
      if (a.length >= 3) { m.translateSelf(a[1], a[2]); m.rotateSelf(a[0]); m.translateSelf(-a[1], -a[2]); }
      else m.rotateSelf(a[0] || 0);
    } else if (r[1] === 'skewX') m.skewXSelf(a[0] || 0);
    else if (r[1] === 'skewY') m.skewYSelf(a[0] || 0);
  }
  return m;
}
function svgfSetMatrix(el, m) {
  if (m.isIdentity) { el.removeAttribute('transform'); return; }
  const r = (n) => +n.toFixed(6);
  el.setAttribute('transform', `matrix(${r(m.a)} ${r(m.b)} ${r(m.c)} ${r(m.d)} ${r(m.e)} ${r(m.f)})`);
}

// Whitespace kept tidy when elements move, so the source stays readable.
const svgfIsWs = (n) => n && n.nodeType === 3 && !n.nodeValue.trim();
function svgfIndentBefore(el) {
  const p = el.previousSibling;
  if (!svgfIsWs(p)) return null;
  const v = p.nodeValue;
  return v.includes('\n') ? v.slice(v.lastIndexOf('\n') + 1) : null;
}
function svgfDetach(el) {
  const p = el.previousSibling;
  if (svgfIsWs(p)) p.remove();
  el.remove();
}
function svgfAppend(parent, el) {
  const doc = parent.ownerDocument;
  const firstEl = parent.firstElementChild;
  const own = svgfIndentBefore(parent) || '';
  const inner = (firstEl && svgfIndentBefore(firstEl)) ?? (own + '  ');
  const last = parent.lastChild;
  if (svgfIsWs(last)) {
    parent.insertBefore(doc.createTextNode('\n' + inner), last);
    parent.insertBefore(el, last);
  } else {
    parent.append(doc.createTextNode('\n' + inner), el, doc.createTextNode('\n' + own));
  }
}
function svgfMoveBefore(el, ref) {         // el (with its indentation) right before ref
  const ws = svgfIsWs(el.previousSibling) ? el.previousSibling : null;
  ref.before(el);
  if (ws) ref.before(ws);
}

/** Gives every layer an explicit data-layer, so layers stay layers after
    one is added or renamed (data-layer groups win over the other rules). */
function svgfAdopt(info) {
  info.layers.forEach((L) => { if (!L.el.hasAttribute('data-layer')) L.el.setAttribute('data-layer', L.name); });
}
function svgfNewLayer(root, info) {
  const names = new Set(info.layers.map((L) => L.name));
  let k = info.layers.length + 1;
  while (names.has(`Layer ${k}`)) k++;
  const g = root.ownerDocument.createElementNS(SVGF_NS, 'g');
  g.setAttribute('data-layer', `Layer ${k}`);
  svgfAppend(root, g);
  return g;
}

/** Runs fn({ wrap, root, info, items }) on the parsed source and returns the new
    source; fn returns false to mean "nothing changed". */
function svgfEdit(src, fn) {
  const P = svgfParse(src);
  const info = svgfLayerInfo(P.root);
  if (fn(Object.assign(P, { info, items: svgfItems(info) })) === false) return src;
  return svgfSerialize(P.wrap);
}

/** Moves listed element i to a layer (index), 'loose' (outside every layer) or 'new'. */
function svgfOpMove(src, i, target) {
  return svgfEdit(src, ({ root, info, items }) => {
    const it = items[i];
    if (!it) return false;
    svgfAdopt(info);
    const from = it.layer ? it.layer.el : root;
    const dst = target === 'new' ? svgfNewLayer(root, info)
      : target === 'loose' ? root
      : info.layers[target] && info.layers[target].el;
    if (!dst || dst === from) return false;
    const el = it.el;
    // Keep the look: the old layer's transform and the styling it passed down.
    const mFrom = from === root ? new DOMMatrix() : svgfMatrix(from.getAttribute('transform'));
    const mTo = dst === root ? new DOMMatrix() : svgfMatrix(dst.getAttribute('transform'));
    svgfSetMatrix(el, mTo.inverse().multiply(mFrom).multiply(svgfMatrix(el.getAttribute('transform'))));
    SVGF_INHERITED.forEach((p) => {
      if (svgfOwn(el, p) != null) return;
      const v = from !== root ? svgfOwn(from, p) : null;
      if (v != null) el.setAttribute(p, v);
      else if (dst !== root && svgfOwn(dst, p) != null && SVGF_INITIAL[p] != null) el.setAttribute(p, SVGF_INITIAL[p]);
    });
    const op = from !== root ? parseFloat(svgfOwn(from, 'opacity')) : NaN;
    if (isFinite(op) && op < 1) el.setAttribute('opacity', String(svgfRound((parseFloat(svgfOwn(el, 'opacity')) || 1) * op)));
    const n = dst === root ? 1 : svgfInt(dst.getAttribute('data-steps'), 1, SVGF_MAX_STEPS, 1);
    const r = svgfInt(el.getAttribute('data-step'), 1, SVGF_MAX_STEPS, 1);
    if (r > n || n === 1) el.removeAttribute('data-step');
    svgfDetach(el);
    svgfAppend(dst, el);
  });
}

/** Element i appears at its layer's r-th step. */
function svgfOpItemStep(src, i, r) {
  return svgfEdit(src, ({ items }) => {
    const it = items[i];
    if (!it || !it.layer) return false;
    if (r > 1) it.el.setAttribute('data-step', String(r)); else it.el.removeAttribute('data-step');
  });
}

/** Layer j gets n steps of its own (its elements beyond n move to step n). */
function svgfOpLayerSteps(src, j, n) {
  return svgfEdit(src, ({ info }) => {
    const L = info.layers[j];
    if (!L) return false;
    n = svgfInt(n, 1, SVGF_MAX_STEPS, 1);
    if (n > 1) L.el.setAttribute('data-steps', String(n)); else L.el.removeAttribute('data-steps');
    L.items.forEach((el) => {
      const r = svgfInt(el.getAttribute('data-step'), 1, SVGF_MAX_STEPS, 1);
      if (n === 1) el.removeAttribute('data-step');
      else if (r > n) el.setAttribute('data-step', String(n));
    });
  });
}

function svgfOpLayerHidden(src, j, hidden) {
  return svgfEdit(src, ({ info }) => {
    const L = info.layers[j];
    if (!L) return false;
    if (hidden) { L.el.setAttribute('display', 'none'); return; }
    L.el.removeAttribute('display');
    const st = L.el.getAttribute('style');
    if (st) {
      const d = svgfDecls(st); d.delete('display');
      if (d.size) L.el.setAttribute('style', svgfDeclText(d)); else L.el.removeAttribute('style');
    }
  });
}

function svgfOpLayerRename(src, j, name) {
  name = String(name || '').replace(/\s+/g, ' ').trim().slice(0, 60);
  return svgfEdit(src, ({ info }) => {
    const L = info.layers[j];
    if (!L || !name || name === L.name) return false;
    svgfAdopt(info);
    L.el.setAttribute('data-layer', name);
  });
}

/** Moves layer j one place earlier (dir -1) or later (+1): its steps and its drawing order. */
function svgfOpLayerMove(src, j, dir) {
  return svgfEdit(src, ({ info }) => {
    const a = info.layers[j], b = info.layers[j + dir];
    if (!a || !b) return false;
    svgfAdopt(info);
    if (dir < 0) svgfMoveBefore(a.el, b.el); else svgfMoveBefore(b.el, a.el);
  });
}

/** Removes layer j and everything in it. */
function svgfOpLayerDelete(src, j) {
  return svgfEdit(src, ({ info }) => {
    const L = info.layers[j];
    if (!L) return false;
    svgfAdopt(info);
    svgfDetach(L.el);
  });
}

/** Removes listed element i. */
function svgfOpDeleteItem(src, i) {
  return svgfEdit(src, ({ items }) => {
    const it = items[i];
    if (!it) return false;
    svgfDetach(it.el);
  });
}

function svgfOpNewLayer(src) {
  return svgfEdit(src, ({ root, info }) => { svgfAdopt(info); svgfNewLayer(root, info); });
}

/** Maps a fixed colour (its svgfColor key) to theme colour themeId,
    remembering the original. Also changes an earlier mapping of that colour
    to another theme colour, and with themeId '' ("Keep fixed") puts the
    original colour back. */
function svgfOpColor(src, key, themeId) {
  const t = SVGF_THEME.find((x) => x.id === themeId);
  if (themeId && !t) return src;
  return svgfEdit(src, ({ wrap }) => {
    let hit = false;
    svgfEachColor(wrap, (v, set, orig) => {
      const c = svgfColor(v);
      if (!c) return;
      const o = orig && svgfMarkerOf(c) && svgfColor(orig);
      if (o && o.key === key) {                    // mapped earlier: re-map or restore
        if (t) set(t.write, 1); else set(orig, 1, null);
        hit = true;
      } else if (t && !svgfMarkerOf(c) && c.key === key) {
        set(t.write, c.a, c.key);
        hit = true;
      }
    });
    return hit;
  });
}
