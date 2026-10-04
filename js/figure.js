/* ═══════════════════════════════════════════════════════════════════
   figure.js  ·  Solution figures: normalize + sanitize TikZ-made SVGs
   ───────────────────────────────────────────────────────────────────
   Shared by the solutions editor (/editor) and the practice site's
   "see solution" window, so both treat a figure identically.

   Colors: authors only use black (default), c1 and c2. TikZJax writes
   them as #000, #ff0001 and #ff0002. css/figure.css maps those exact
   values to currentColor / --accent / --accent2, so the stored SVG
   never needs re-rendering when the theme changes.

   figNormalizeSvg  — once, at compile/save time: canonical colors,
                      fixed-size attributes dropped, unique ids.
   figSanitizeSvg   — every time before inserting into the page
                      (DOMPurify): the SVG is inlined (so theme colors
                      work), which makes this a security boundary.
   Requires vendor/dompurify/purify.min.js for figSanitizeSvg.
   ─────────────────────────────────────────────────────────────────── */

const FIG_COLOR_ATTRS = ['fill', 'stroke', 'stop-color', 'color'];

function _figCanonColor(v) {
  const s = (v || '').trim().toLowerCase();
  if (!s || s === 'none' || s === 'currentcolor' || s === 'transparent' || s.startsWith('url(')) return s || v;
  if (s === 'black' || s === '#000' || s === '#000000') return '#000';
  let m = s.match(/^#([0-9a-f]{3})$/);
  if (m) return '#' + m[1].split('').map((c) => c + c).join('');
  m = s.match(/^rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)$/);
  if (m) {
    const h = (n) => Math.min(255, +n).toString(16).padStart(2, '0');
    const hex = '#' + h(m[1]) + h(m[2]) + h(m[3]);
    return hex === '#000000' ? '#000' : hex;
  }
  return s;
}

/** svgText -> normalized svg string. idPrefix must be unique per figure+step. */
function figNormalizeSvg(svgText, idPrefix) {
  const doc = new DOMParser().parseFromString(svgText, 'image/svg+xml');
  const root = doc.documentElement;
  if (!root || root.nodeName.toLowerCase() !== 'svg' || doc.querySelector('parsererror')) {
    throw new Error('Compiler output is not a valid SVG');
  }
  // sizing is done by CSS; keep viewBox only
  root.removeAttribute('width');
  root.removeAttribute('height');
  root.removeAttribute('style');
  root.setAttribute('preserveAspectRatio', 'xMidYMid meet');

  const all = [root, ...root.querySelectorAll('*')];
  all.forEach((el) => {
    FIG_COLOR_ATTRS.forEach((a) => { if (el.hasAttribute(a)) el.setAttribute(a, _figCanonColor(el.getAttribute(a))); });
  });

  // unique ids (glyph defs, clip paths, gradients) so several inline SVGs never collide
  const ids = new Map();
  all.forEach((el) => {
    const id = el.getAttribute('id');
    if (id) { ids.set(id, idPrefix + id); el.setAttribute('id', idPrefix + id); }
  });
  if (ids.size) {
    all.forEach((el) => {
      Array.from(el.attributes).forEach((at) => {
        let v = at.value;
        if (at.name === 'id') return;
        if (/^#/.test(v) && ids.has(v.slice(1)) && /href$/i.test(at.name)) { el.setAttribute(at.name, '#' + ids.get(v.slice(1))); return; }
        if (v.includes('url(#')) {
          v = v.replace(/url\(#([^)]+)\)/g, (m, id) => ids.has(id) ? `url(#${ids.get(id)})` : m);
          el.setAttribute(at.name, v);
        }
      });
    });
  }
  return new XMLSerializer().serializeToString(root);
}

const _FIG_PURIFY_CFG = {
  USE_PROFILES: { svg: true },
  FORBID_TAGS: ['script', 'style', 'foreignObject', 'use', 'image', 'a', 'animate', 'animateMotion', 'animateTransform', 'set', 'iframe', 'object', 'embed'],
  FORBID_ATTR: ['style'],
};

/** Always call this before putting an SVG string into the page. */
function figSanitizeSvg(svgText) {
  if (typeof DOMPurify === 'undefined') throw new Error('DOMPurify is not loaded');
  return DOMPurify.sanitize(svgText, _FIG_PURIFY_CFG);
}

/** Dimensions string like "170.7 85.4" from a normalized svg (for size-consistency checks). */
function figViewBox(svgText) {
  const m = svgText.match(/viewBox="([^"]+)"/);
  return m ? m[1].trim() : '';
}
