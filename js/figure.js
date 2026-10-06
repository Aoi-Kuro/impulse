/* ═══════════════════════════════════════════════════════════════════
   figure.js  ·  Solution figures: normalize + sanitize TikZ-made SVGs
   ───────────────────────────────────────────────────────────────────
   Shared by the solutions editor (/editor) and the practice site's
   "see solution" window, so both treat a figure identically.

   Colors: authors only use black (default), c1 and c2 (plus the two
   backgrounds c3/c4). TikZJax writes them as #000, #ff0001 and #ff0002.
   css/figure.css maps those exact values to currentColor / --accent /
   --accent2, so the stored SVG never needs re-rendering when the theme
   changes. Figures drawn as SVG (editor/svg-figure.js) are converted to
   the same values before they get here.

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

/** Crops the figure(s) inside `container` to what is actually drawn, so
    unused space inside the TikZ bounding box doesn't push the drawing off
    centre. Done at display time (needs the browser to measure), so stored
    SVGs stay untouched and old solutions benefit too.

    All steps share ONE crop box (the union of their contents), otherwise
    the figure would jump in size and position between steps. The box never
    grows past the original viewBox, so whatever the author clipped away
    with \useasboundingbox stays clipped. Call after the SVGs are in the
    page and not display:none — a hidden element measures as empty. */
function figCropToContent(container) {
  const svgs = Array.from(container.querySelectorAll('svg'));
  let vb = null;
  for (const svg of svgs) {
    const v = svg.viewBox && svg.viewBox.baseVal;
    if (!v || !v.width || !v.height) return;
    vb = vb || v;
  }
  const c = vb && figContentBox(svgs);
  if (!c) return;
  const cx0 = Math.max(vb.x, c.x0), cy0 = Math.max(vb.y, c.y0);
  const cx1 = Math.min(vb.x + vb.width, c.x1), cy1 = Math.min(vb.y + vb.height, c.y1);
  if (cx1 <= cx0 || cy1 <= cy0) return;
  const box = `${cx0} ${cy0} ${cx1 - cx0} ${cy1 - cy0}`;
  svgs.forEach((svg) => svg.setAttribute('viewBox', box));
}

/** Union of what is drawn in `svgs` (user units), padded for what getBBox
    leaves out: the outer half of the widest stroke, and arrowhead markers
    (SVG-mode figures; TikZ draws its arrows as paths). {x0,y0,x1,y1}, or
    null when nothing is measurable. The SVGs must be in the page and not
    display:none. Also used by the editor to find an SVG figure's box. */
function figContentBox(svgs) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, sw = 0, mk = 0, mkUser = 0;
  for (const svg of svgs) {
    let bb;
    try { bb = svg.getBBox(); } catch (e) { return null; }
    if (!bb || (!bb.width && !bb.height)) continue;   // an empty step
    x0 = Math.min(x0, bb.x); y0 = Math.min(y0, bb.y);
    x1 = Math.max(x1, bb.x + bb.width); y1 = Math.max(y1, bb.y + bb.height);
    svg.querySelectorAll('[stroke-width]').forEach((el) => {
      const w = parseFloat(el.getAttribute('stroke-width'));
      if (w > sw) sw = w;
    });
    // A marker reaches at most its own size past the end of the line; in
    // the default units that size is in multiples of the stroke width.
    svg.querySelectorAll('marker').forEach((m) => {
      const s = Math.max(parseFloat(m.getAttribute('markerWidth')) || 3, parseFloat(m.getAttribute('markerHeight')) || 3);
      if (m.getAttribute('markerUnits') === 'userSpaceOnUse') mkUser = Math.max(mkUser, s);
      else mk = Math.max(mk, s);
    });
  }
  if (!isFinite(x0) || x1 <= x0 || y1 <= y0) return null;
  const pad = sw / 2 + Math.max(mk * Math.max(sw, 1), mkUser) + 1;
  return { x0: x0 - pad, y0: y0 - pad, x1: x1 + pad, y1: y1 + pad };
}

const FIG_SCALE_MIN = 0.25, FIG_SCALE_MAX = 2;

/** A figure's stored scale factor, clamped to the allowed range; 1 when
    missing or nonsense (rows saved before scaling existed have none). */
function figScaleOf(figure) {
  const s = Number(figure && figure.scale);
  if (!isFinite(s) || s <= 0) return 1;
  return Math.min(FIG_SCALE_MAX, Math.max(FIG_SCALE_MIN, s));
}

/** Dimensions string like "170.7 85.4" from a normalized svg (for size-consistency checks). */
function figViewBox(svgText) {
  const m = svgText.match(/viewBox="([^"]+)"/);
  return m ? m[1].trim() : '';
}
