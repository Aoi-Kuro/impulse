// ─── Entire Set PDF builder (loaded on demand by js/pdf-export.js) ─────────
// buildProblemsPdf() turns the chosen problems into an A4 PDF, all vector
// except original (low-res) figures:
//   page 1     the course logo and name (one link to the site), the
//              exporter's identicon in a rounded tile and nickname, the date
//              and time (UTC and local); no footer
//   page 2 on  "Set N" and its name with a "Check for updates" button, then
//              the problems: number, a tiny 4-digit fingerprint (what the
//              check compares), text with inline and display math, figures,
//              then the chosen extras (blank space, answer line, answer or
//              upside-down answer)
//   last       a box sending the reader back to the site, with the same
//              button and QR codes for the site and for this PDF's check
//              link (white on black on dark pages); above it the logo's
//              jump from the main menu, frozen bullet-time style
//   from p. 2  the logo and name at the bottom left (a link to the site)
//              and the page number at the bottom right
//
// Everything is set in STIX Two Text (vendor/fonts/stix-two-text), and math
// in MathJax's STIX2 font, so text and formulas match; only the course name
// keeps the site's logo face, Kanit Black Italic (vendor/fonts/kanit). Math goes through a
// second, SVG-output MathJax (vendor/mathjax-svg) running in a hidden
// iframe, so it can't disturb the site's own (HTML-output) MathJax; each
// formula's SVG is drawn into the PDF by svg2pdf as vector paths. Its size
// comes from the SVG's viewBox: MathJax draws in thousandths of an em.
//
// Text layout is done here: words and inline formulas are broken into lines
// and justified, a problem's heading stays with its first lines, and a
// figure or formula is never split across pages.

const PDFB_PAGE_W = 595.28, PDFB_PAGE_H = 841.89;       // A4 in points
const PDFB_MARGIN_X = 62, PDFB_TOP = 58, PDFB_BOTTOM = 66;
const PDFB_FS = 11;                                      // body text size
const PDFB_LEADING = 1.42;
const PDFB_FONT = 'STIXTwoText';
// The course name (IMPULSE / FLUX) keeps the site's own logo face, Kanit
// Black Italic, as in the top bar; everything else is STIX.
const PDFB_BRAND_FONT = 'KanitBlackItalic';
const PDFB_FONT_FILES = [
  ['stix-two-text/STIXTwoText-Regular.ttf', PDFB_FONT, 'normal'],
  ['stix-two-text/STIXTwoText-Italic.ttf', PDFB_FONT, 'italic'],
  ['stix-two-text/STIXTwoText-Bold.ttf', PDFB_FONT, 'bold'],
  ['stix-two-text/STIXTwoText-BoldItalic.ttf', PDFB_FONT, 'bolditalic'],
  ['kanit/Kanit-BlackItalic.ttf', PDFB_BRAND_FONT, 'normal'],
];
// "Check for updates": two turning arrows.
const PDFB_UPDATE_ICON = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="FG" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M19.5 10.5A7.8 7.8 0 0 0 5.3 7.6"/><path d="M4.3 3.6L5.1 7.9L9.3 7"/><path d="M4.5 13.5A7.8 7.8 0 0 0 18.7 16.4"/><path d="M19.7 20.4L18.9 16.1L14.7 17"/></svg>';

const PDFB_THEMES = {
  light: {
    bg: null, fg: '#111111', muted: '#666666', rule: '#c9c9c9', tile: '#f1f1f1',
    fig: { blue: '#2C6DD5', red: '#C73A4A', 'fill-white': '#ffffff', dark: '#1f2328', gold: '#9a6700' },
  },
  dark: {
    bg: '#000000', fg: '#f2f2f2', muted: '#9a9a9a', rule: '#3d3d3d', tile: '#1f1f1f',
    fig: { blue: '#79AFFF', red: '#FF8A98', 'fill-white': '#000000', dark: '#000000', gold: '#d29922' },
  },
};

const _pdfbCache = { fonts: null, math: null, mathFrame: null, svgs: new Map() };

class PdfxCancelled extends Error {}

function _pdfbCheckCancel(job) { if (job && job.cancelled) throw new PdfxCancelled('cancelled'); }
function _pdfbTick() { return new Promise(r => setTimeout(r, 0)); }

function _pdfbRgb(hex) {
  const h = hex.replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

// ── Tools ───────────────────────────────────────────────────────────────────
async function _pdfbLoadTools() {
  if (!(window.jspdf && window.jspdf.jsPDF)) await pdfxLoadScript('vendor/jspdf/jspdf.umd.min.js');
  if (!window.jspdf.jsPDF.API.svg) await pdfxLoadScript('vendor/jspdf/svg2pdf.umd.min.js');
  if (typeof qrcode !== 'function') await pdfxLoadScript('vendor/qrcode/qrcode.js');
}

function _pdfbBase64(buf) {
  const bytes = new Uint8Array(buf);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

async function _pdfbLoadFonts() {
  if (_pdfbCache.fonts) return _pdfbCache.fonts;
  const fonts = await Promise.all(PDFB_FONT_FILES.map(async ([path, family, style]) => {
    const res = await fetch('vendor/fonts/' + path);
    if (!res.ok) throw new Error('Font ' + path + ': HTTP ' + res.status);
    return { file: path.split('/').pop(), family, style, data: _pdfbBase64(await res.arrayBuffer()) };
  }));
  _pdfbCache.fonts = fonts;
  return fonts;
}

// The site's own TeX macros, so formulas typeset exactly as on screen.
function _pdfbMacros() {
  const own = window.MathJax && MathJax.config && MathJax.config.tex && MathJax.config.tex.macros;
  return own || {
    dd: ['\\mathrm{d}#1', 1],
    dv: ['\\frac{\\mathrm{d}^{#1}#2}{\\mathrm{d}#3^{#1}}', 3, ''],
    pdv: ['\\frac{\\partial^{#1}#2}{\\partial #3^{#1}}', 3, ''],
    vb: ['\\mathbf{#1}', 1],
    vu: ['\\hat{\\mathbf{#1}}', 1],
    abs: ['\\left|#1\\right|', 1],
    norm: ['\\left\\|#1\\right\\|', 1],
  };
}

function _pdfbStartMath() {
  if (_pdfbCache.math) return _pdfbCache.math;
  _pdfbCache.math = new Promise((resolve, reject) => {
    const frame = document.createElement('iframe');
    frame.setAttribute('aria-hidden', 'true');
    frame.tabIndex = -1;
    frame.style.cssText = 'position:fixed;left:-12000px;top:0;width:900px;height:600px;border:0;visibility:hidden;pointer-events:none';
    const src = new URL('vendor/mathjax-svg/mathjax-stix2-svg.js', document.baseURI).href;
    const config = {
      tex: { macros: _pdfbMacros(), inlineMath: [], displayMath: [] },
      // fontCache 'none': every formula carries its own glyph paths, so each
      // SVG stands alone in the PDF. Glyph ranges outside the bundle load
      // from our own copy, never a CDN.
      // linebreaks.inline off: MathJax 4 otherwise splits an inline formula
      // at its operators into several <svg>s (so it can wrap like text);
      // the PDF needs it whole, as one box the layout below places.
      svg: { fontCache: 'none', fontPath: '[mathjax]/stix2-font', linebreaks: { inline: false } },
      // This build carries MathJax's accessibility parts (speech, braille,
      // the explorer), which start a speech worker from [mathjax]/sre — not
      // copied, and not wanted in a PDF. Left on, startup waited for that
      // worker forever. Off, nothing beyond the bundle and its font loads.
      options: {
        enableMenu: false,
        enableEnrichment: false,
        enableSpeech: false,
        enableBraille: false,
        enableExplorer: false,
        enableComplexity: false,
        menuOptions: { settings: { assistiveMml: false, collapsible: false, speech: false, braille: false, enrich: false } },
      },
      startup: { typeset: false },
    };
    // Ready as soon as MathJax's methods exist: tex2svgPromise itself waits
    // for any glyph files it still needs.
    frame.srcdoc = '<!doctype html><html><head><meta charset="utf-8"><script>' +
      'window.MathJax=' + JSON.stringify(config) + ';' +
      'window.MathJax.startup.ready=function(){try{MathJax.startup.defaultReady();window.__pdfxReady=true;}catch(e){console.error(e);window.__pdfxFailed=true;}};' +
      '<\/script><script src="' + src + '" onerror="window.__pdfxFailed=true"><\/script></head><body></body></html>';
    document.body.appendChild(frame);
    _pdfbCache.mathFrame = frame;
    const started = Date.now();
    (function wait() {
      const w = frame.contentWindow;
      if (w && w.__pdfxReady) { resolve(w); return; }
      if ((w && w.__pdfxFailed) || Date.now() - started > 25000) {
        _pdfbCache.math = null;
        frame.remove();
        reject(new Error('The math engine did not start'));
        return;
      }
      setTimeout(wait, 50);
    })();
  });
  return _pdfbCache.math;
}

// { el, vbW, asc, desc } in thousandths of an em, or null if the formula
// can't be typeset (then it's printed as plain TeX).
async function _pdfbTypeset(win, tex, display) {
  const key = (display ? 'D:' : 'I:') + tex;
  if (_pdfbCache.svgs.has(key)) return _pdfbCache.svgs.get(key);
  let out = null;
  try {
    const node = await win.MathJax.tex2svgPromise(tex, { display });
    const svg = node.querySelector('svg');
    const vb = svg && (svg.getAttribute('viewBox') || '').split(/[\s,]+/).map(Number);
    if (svg && vb && vb.length === 4 && vb.every(isFinite)) {
      out = { el: document.importNode(svg, true), vbW: vb[2], asc: -vb[1], desc: vb[1] + vb[3] };
    }
  } catch (e) {
    console.warn('[pdf-build] could not typeset', tex, e);
  }
  _pdfbCache.svgs.set(key, out);
  return out;
}

// ── Problem text → blocks ───────────────────────────────────────────────────
// A problem becomes a list of blocks: { type: 'para', items } with words and
// inline formulas, { type: 'math', tex } for display formulas and
// { type: 'figure', src, width, caption }. Each inline item knows whether a
// space came before it, so "$x$, which" keeps its comma on the formula.
const PDFB_MATH_RE = /\$\$([\s\S]+?)\$\$|\\\[([\s\S]+?)\\\]|\$([^$]+?)\$|\\\(([\s\S]+?)\\\)/g;

function _pdfbParse(html) {
  const doc = new DOMParser().parseFromString('<body>' + (html || '') + '</body>', 'text/html');
  const blocks = [];
  let para = null;
  let pendingSpace = false;
  const flush = () => { if (para && para.items.length) blocks.push(para); para = null; };
  const item = it => {
    if (!para) para = { type: 'para', items: [] };
    it.sp = para.items.length > 0 && pendingSpace;
    pendingSpace = false;
    para.items.push(it);
  };
  const addText = (text, style) => {
    const parts = text.split(/(\s+)/);
    parts.forEach(part => {
      if (!part) return;
      if (/^\s+$/.test(part)) { pendingSpace = true; return; }
      item({ t: 'w', s: part, st: style });
    });
  };
  const walkText = (text, style) => {
    let last = 0, m;
    PDFB_MATH_RE.lastIndex = 0;
    while ((m = PDFB_MATH_RE.exec(text))) {
      if (m.index > last) addText(text.slice(last, m.index), style);
      const display = m[1] !== undefined || m[2] !== undefined;
      const tex = (m[1] || m[2] || m[3] || m[4] || '').trim();
      if (display) { flush(); pendingSpace = false; blocks.push({ type: 'math', tex }); }
      else item({ t: 'm', tex });
      last = m.index + m[0].length;
    }
    if (last < text.length) addText(text.slice(last), style);
  };
  const walk = (node, style) => {
    node.childNodes.forEach(n => {
      if (n.nodeType === 3) { walkText(n.nodeValue, style); return; }
      if (n.nodeType !== 1) return;
      const tag = n.tagName.toLowerCase();
      const img = tag === 'img' ? n : n.querySelector && n.querySelector('img');
      if (img && (tag === 'img' || n.classList.contains('fig-img-wrap'))) {
        flush(); pendingSpace = false;
        const tip = n.querySelector && n.querySelector('.fig-attr-tip');
        blocks.push({
          type: 'figure',
          src: img.getAttribute('src'),
          width: parseFloat(img.getAttribute('width')) || 0,
          caption: tip ? tip.textContent.trim() : '',
        });
        return;
      }
      if (tag === 'br') { flush(); pendingSpace = false; return; }
      if (tag === 'p' || tag === 'div') { flush(); walk(n, style); flush(); return; }
      let st = style;
      if (tag === 'b' || tag === 'strong') st = style === 'italic' ? 'bolditalic' : 'bold';
      if (tag === 'i' || tag === 'em') st = style === 'bold' ? 'bolditalic' : 'italic';
      walk(n, st);
    });
  };
  walk(doc.body, 'normal');
  flush();
  return blocks;
}

// ── Figures ─────────────────────────────────────────────────────────────────
// A redrawn drawing in the page's colours: the theme variables and
// currentColor become fixed colours, and its lettering is set in STIX.
function _pdfbRedrawnSvg(src, theme) {
  let text = typeof redrawnSvgFor === 'function' ? redrawnSvgFor(src) : null;
  if (!text) return null;
  text = text
    .replace(/var\(--svg-([a-z-]+)(?:,[^)]*)?\)/g, (all, name) => theme.fig[name] || theme.fg)
    .replace(/currentColor/g, theme.fg)
    .replace(/font-family="[^"]*"/g, `font-family="${PDFB_FONT}"`);
  const el = new DOMParser().parseFromString(text, 'image/svg+xml').documentElement;
  if (!el || el.nodeName !== 'svg') return null;
  // Parts an animation fades in (an inset, a jacket) sit in the drawing at
  // opacity 0. A browser hides them; svg2pdf ignores a group's opacity and
  // drew them half-way. The PDF is the still drawing, so they go.
  el.querySelectorAll('[opacity],[style]').forEach(n => {
    const op = n.getAttribute('opacity');
    const st = n.getAttribute('style') || '';
    if ((op !== null && parseFloat(op) === 0) || /display\s*:\s*none|visibility\s*:\s*hidden|(^|;)\s*opacity\s*:\s*0(\.0*)?\s*(;|$)/.test(st)) n.remove();
  });
  // Labels are centred on their point with dominant-baseline="central",
  // which svg2pdf ignores: it set them on their baseline, a quarter of a
  // letter too high, into the lines above (Set 4 P6's L). A browser moves
  // STIX Two Text down by 0.26 em for "central" (measured in Edge), so the
  // same shift is written in as a translate, in the label's own frame.
  el.querySelectorAll('text[dominant-baseline="central"]').forEach(t => {
    let fs = NaN;
    for (let n = t; n && n.nodeType === 1 && !isFinite(fs); n = n.parentNode) fs = parseFloat(n.getAttribute('font-size'));
    if (!isFinite(fs)) fs = 16;
    t.removeAttribute('dominant-baseline');
    const tr = t.getAttribute('transform');
    t.setAttribute('transform', (tr ? tr + ' ' : '') + `translate(0 ${(fs * 0.26).toFixed(2)})`);
  });
  el.setAttribute('font-family', PDFB_FONT);
  const vb = el.viewBox && el.viewBox.baseVal;
  return { el, w: (vb && vb.width) || 350, h: (vb && vb.height) || 250 };
}

function _pdfbRaster(src) {
  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => {
      try {
        const c = document.createElement('canvas');
        c.width = img.naturalWidth; c.height = img.naturalHeight;
        const ctx = c.getContext('2d');
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, c.width, c.height);
        ctx.drawImage(img, 0, 0);
        resolve({ data: c.toDataURL('image/png'), w: img.naturalWidth, h: img.naturalHeight });
      } catch (e) { resolve(null); }
    };
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

// ── Logo, avatar ────────────────────────────────────────────────────────────
// favicon.svg styles its faces with a <style> block; svg2pdf wants plain
// attributes, so the class rules are copied onto the shapes.
async function _pdfbLogo() {
  const res = await fetch('favicon/favicon.svg');
  const text = await res.text();
  const el = new DOMParser().parseFromString(text, 'image/svg+xml').documentElement;
  const rules = {};
  el.querySelectorAll('style').forEach(s => {
    s.textContent.replace(/([^{}@]+)\{([^{}]*)\}/g, (all, sel, body) => {
      sel.split(',').forEach(one => {
        const m = /^\s*\.([\w-]+)\s*$/.exec(one);
        if (!m) return;
        body.split(';').forEach(decl => {
          const [k, v] = decl.split(':').map(x => x && x.trim());
          if (k && v) (rules[m[1]] = rules[m[1]] || {})[k] = v.replace(/px$/, '');
        });
      });
    });
    s.remove();
  });
  el.querySelectorAll('metadata').forEach(n => n.remove());
  el.querySelectorAll('[class]').forEach(n => {
    n.getAttribute('class').split(/\s+/).forEach(c => {
      Object.entries(rules[c] || {}).forEach(([k, v]) => { if (k !== 'isolation') n.setAttribute(k, v); });
    });
    n.removeAttribute('class');
  });
  const vb = el.viewBox.baseVal;
  return { el, ratio: vb.width / vb.height };
}

async function _pdfbAvatar(nickname) {
  try {
    if (typeof _exportAvatarSvgMarkup !== 'function') return null;
    const markup = await _exportAvatarSvgMarkup(nickname);
    const el = new DOMParser().parseFromString(markup, 'image/svg+xml').documentElement;
    return el && el.nodeName === 'svg' ? el : null;
  } catch (e) { return null; }
}

// ── Date line: "18 November 2026, 14:05 UTC (19:05 local)" ─────────────────
// The offset is left out: it follows from the two times.
function _pdfbDateLine(d) {
  const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const two = n => String(n).padStart(2, '0');
  const utc = `${d.getUTCDate()} ${months[d.getUTCMonth()]} ${d.getUTCFullYear()}, ${two(d.getUTCHours())}:${two(d.getUTCMinutes())} UTC`;
  if (!d.getTimezoneOffset()) return utc;
  const sameDay = d.getDate() === d.getUTCDate();
  const local = `${sameDay ? '' : d.getDate() + ' ' + months[d.getMonth()] + ', '}${two(d.getHours())}:${two(d.getMinutes())}`;
  return `${utc} (${local} local)`;
}

// "g/cm^3" → "g/cm³", "m s^-1" → "m s⁻¹", "N*m" → "N·m": units as typeset.
const PDFB_SUP = { '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹', '-': '⁻' };
function _pdfbUnit(u) {
  return String(u)
    .replace(/\^\(?(-?\d+)\)?/g, (all, n) => n.split('').map(c => PDFB_SUP[c]).join(''))
    .replace(/\*/g, '·')
    .replace(/-(?=\d)/g, '−');
}

function _pdfbUnitOf(p) {
  const u = (p.units || [])[0];
  return u && u !== '(none)' ? _pdfbUnit(u) : '';
}

function _pdfbAnswerText(p) {
  // The site's number format, with "2.58023e-8" written as 2.58023 × 10⁻⁸.
  const value = (typeof fmt === 'function' ? fmt(p.answer) : String(p.answer))
    .replace(/e([+-]?)(\d+)$/, (all, sign, exp) => ' × 10' + (sign === '-' ? '⁻' : '') + exp.split('').map(c => PDFB_SUP[c]).join(''))
    .replace(/^-/, '−');
  const u = _pdfbUnitOf(p);
  return u ? `${value} ${u}` : value;
}

// ── The logo's jump, bullet-time ────────────────────────────────────────────
// The main menu's logo tumble (css/style.css: logo-cube-tumble, eased as
// there; js/logo-tumble.js) frozen into one picture, like a bullet-time
// shot: the cube at rest, a trail of fading copies along its jump across
// the page, the cube landed.
// The cube is the CSS one: faces blue (±z), white (±x), red (±y), seen
// through rotateX(-35.264deg) and turned by rotateY(45° + 360°·e)
// rotateX(−360°·e); with e = 0 it is exactly favicon.svg's pose.
const PDFB_CUBE_FACES = [
  { n: [0, 0, 1], c: '#58a6ff' }, { n: [0, 0, -1], c: '#58a6ff' },
  { n: [1, 0, 0], c: '#ffffff' }, { n: [-1, 0, 0], c: '#ffffff' },
  { n: [0, 1, 0], c: '#d7263d' }, { n: [0, -1, 0], c: '#d7263d' },
];
// The path is a plain parabola across the page rather than the hop's own
// keyframes (crouch, early top, rebound): frozen, those read as a wiggle.
function _pdfbBezier(x1, y1, x2, y2) {
  const at = (a, b, t) => 3 * a * t * (1 - t) * (1 - t) + 3 * b * t * t * (1 - t) + t * t * t;
  return x => {
    let lo = 0, hi = 1;
    for (let k = 0; k < 30; k++) { const m = (lo + hi) / 2; if (at(x1, x2, m) < x) lo = m; else hi = m; }
    return at(y1, y2, (lo + hi) / 2);
  };
}
const _pdfbTumbleEase = _pdfbBezier(0.45, 0.05, 0.25, 1);

function _pdfbRot(p, axis, deg) {
  const a = deg * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
  const [x, y, z] = p;
  return axis === 'x' ? [x, y * c - z * s, y * s + z * c] : [x * c + z * s, y, -x * s + z * c];
}

// Visible faces of the cube at tumble progress e, as polygons in units of
// half an edge (screen axes: x right, y down).
function _pdfbCubeFaces(e) {
  const xf = p => _pdfbRot(_pdfbRot(_pdfbRot(p, 'x', -360 * e), 'y', 45 + 360 * e), 'x', -35.264);
  const out = [];
  PDFB_CUBE_FACES.forEach(f => {
    const n = xf(f.n);
    if (n[2] <= 1e-6) return;
    const axes = [0, 1, 2].filter(i => !f.n[i]);
    const corner = (su, sv) => { const p = f.n.slice(); p[axes[0]] = su; p[axes[1]] = sv; return xf(p); };
    out.push({ c: f.c, pts: [corner(1, 1), corner(1, -1), corner(-1, -1), corner(-1, 1)] });
  });
  return out;
}

// ── The builder ─────────────────────────────────────────────────────────────
async function buildProblemsPdf({ quizNum, problems, opts, seed, job, progress }) {
  const step = (f, text) => progress && progress(f, text);
  const theme = PDFB_THEMES[opts.pages === 'dark' ? 'dark' : 'light'];
  const q = QUIZZES[quizNum - 1];
  const appName = typeof APP_NAME === 'string' ? APP_NAME : 'Impulse';
  const brand = typeof BRAND_NAME === 'string' ? BRAND_NAME : appName.toUpperCase();
  const siteUrl = pdfxSiteUrl();
  const siteShort = siteUrl.replace(/^https?:\/\//, '').replace(/\/$/, '');
  const nickname = (typeof getForumNickname === 'function' && getForumNickname()) || '';
  const now = new Date();

  step(0.02, 'Loading the PDF tools…');
  await _pdfbLoadTools();
  _pdfbCheckCancel(job);
  step(0.08, 'Loading the STIX fonts…');
  const fonts = await _pdfbLoadFonts();
  _pdfbCheckCancel(job);
  step(0.14, 'Starting the math engine…');
  const mathWin = await _pdfbStartMath();
  _pdfbCheckCancel(job);

  // Parse every problem; typeset every formula once.
  const parsed = problems.map(p => ({ p, blocks: _pdfbParse(p.text), number: problemNumber(quizNum, p.id) }));
  const formulas = [];
  parsed.forEach(({ blocks }) => blocks.forEach(b => {
    if (b.type === 'math') formulas.push([b.tex, true]);
    if (b.type === 'para') b.items.forEach(it => { if (it.t === 'm') formulas.push([it.tex, false]); });
  }));
  const math = new Map();
  for (let i = 0; i < formulas.length; i++) {
    const [tex, display] = formulas[i];
    const key = (display ? 'D:' : 'I:') + tex;
    if (!math.has(key)) math.set(key, await _pdfbTypeset(mathWin, tex, display));
    if (i % 8 === 0) {
      _pdfbCheckCancel(job);
      step(0.2 + 0.35 * (i / formulas.length), `Typesetting equations ${i + 1} / ${formulas.length}`);
      await _pdfbTick();
    }
  }

  // Figures: redrawn drawings, or the original pictures as PNG.
  const figSrcs = [];
  parsed.forEach(({ blocks }) => blocks.forEach(b => { if (b.type === 'figure' && !figSrcs.includes(b.src)) figSrcs.push(b.src); }));
  const figs = new Map();
  for (let i = 0; i < figSrcs.length; i++) {
    const src = figSrcs[i];
    step(0.55 + 0.1 * (i / Math.max(1, figSrcs.length)), `Preparing figures ${i + 1} / ${figSrcs.length}`);
    const red = opts.figures === 'redrawn' ? _pdfbRedrawnSvg(src, theme) : null;
    figs.set(src, red ? { kind: 'svg', ...red } : await _pdfbRaster(src).then(r => r && { kind: 'img', ...r }));
    _pdfbCheckCancel(job);
  }

  // Check code: what the PDF prints, problem by problem.
  let flags = 0;
  if (seed) flags |= PDFX_FLAG_RANDOM;
  if (opts.answers !== 'none') flags |= PDFX_FLAG_ANSWERS;
  if (opts.figures === 'redrawn') flags |= PDFX_FLAG_REDRAWN;
  const entries = [];
  for (const { p, number } of parsed) entries.push({ id: p.id, number, fp: await pdfxFingerprint(p, flags) });
  const code = await pdfxEncodeCheck({ quizNum, flags, seed, time: now.getTime(), total: q.problems.length, entries });
  const checkUrl = pdfxCheckLink(code);

  const logo = await _pdfbLogo().catch(() => null);
  const avatar = nickname ? await _pdfbAvatar(nickname) : null;
  _pdfbCheckCancel(job);

  // ── Document ──
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: 'pt', format: 'a4', compress: true });
  fonts.forEach(f => { doc.addFileToVFS(f.file, f.data); doc.addFont(f.file, f.family, f.style); });
  const W = PDFB_PAGE_W, H = PDFB_PAGE_H, L = PDFB_MARGIN_X, R = W - PDFB_MARGIN_X, TW = R - L;
  const bottom = H - PDFB_BOTTOM;
  const S = { y: PDFB_TOP };
  const widths = new Map();

  const color = (hex, kind) => {
    const [r, g, b] = _pdfbRgb(hex);
    if (kind === 'fill') doc.setFillColor(r, g, b);
    else if (kind === 'draw') doc.setDrawColor(r, g, b);
    else doc.setTextColor(r, g, b);
  };
  const font = (style, size) => { doc.setFont(PDFB_FONT, style || 'normal'); doc.setFontSize(size); };
  const textW = (s, style, size) => {
    const k = style + '|' + size + '|' + s;
    let w = widths.get(k);
    if (w === undefined) { font(style, size); w = doc.getTextWidth(s); widths.set(k, w); }
    return w;
  };
  const brandFont = size => { doc.setFont(PDFB_BRAND_FONT, 'normal'); doc.setFontSize(size); };
  // "Check for updates": an outlined button with the turning-arrows icon,
  // a link to this PDF's check page.
  const BTN = { fs: 9.5, h: 22, icon: 11, padX: 9, gap: 6 };
  const updateButtonWidth = label => BTN.padX * 2 + BTN.icon + BTN.gap + textW(label, 'bold', BTN.fs);
  async function updateButton(x, y, label) {
    const w = updateButtonWidth(label);
    color(theme.fg, 'draw');
    doc.setLineWidth(0.8);
    doc.roundedRect(x, y, w, BTN.h, 5, 5, 'S');
    const icon = new DOMParser().parseFromString(PDFB_UPDATE_ICON.replace('FG', theme.fg), 'image/svg+xml').documentElement;
    await drawSvg(icon, x + BTN.padX, y + (BTN.h - BTN.icon) / 2, BTN.icon, BTN.icon);
    font('bold', BTN.fs); color(theme.fg);
    doc.text(label, x + BTN.padX + BTN.icon + BTN.gap, y + BTN.h / 2 + BTN.fs * 0.33);
    doc.link(x, y, w, BTN.h, { url: checkUrl });
    return w;
  }
  const paintBg = () => {
    if (!theme.bg) return;
    color(theme.bg, 'fill');
    doc.rect(0, 0, W, H, 'F');
  };
  const newPage = () => { doc.addPage('a4', 'portrait'); paintBg(); S.y = PDFB_TOP; };
  const ensure = h => { if (S.y + h > bottom) { newPage(); return true; } return false; };
  const drawSvg = (el, x, y, w, h) => doc.svg(el.cloneNode(true), { x, y, width: w, height: h });
  const mathBox = (key, fs) => {
    const m = math.get(key);
    if (!m) return null;
    const k = fs / 1000;
    return { m, w: m.vbW * k, asc: m.asc * k, desc: m.desc * k };
  };
  const mathEl = m => {
    const el = m.el.cloneNode(true);
    el.querySelectorAll('[fill="currentColor"],[stroke="currentColor"]').forEach(n => {
      if (n.getAttribute('fill') === 'currentColor') n.setAttribute('fill', theme.fg);
      if (n.getAttribute('stroke') === 'currentColor') n.setAttribute('stroke', theme.fg);
    });
    if (el.getAttribute('fill') === 'currentColor' || !el.getAttribute('fill')) el.setAttribute('fill', theme.fg);
    if (el.getAttribute('stroke') === 'currentColor') el.setAttribute('stroke', theme.fg);
    el.removeAttribute('style');
    el.querySelectorAll('text').forEach(t => t.setAttribute('font-family', PDFB_FONT));
    return el;
  };

  // Words and inline formulas → justified lines.
  async function paragraph(items, opt) {
    const fs = (opt && opt.fs) || PDFB_FS;
    const style0 = (opt && opt.style) || null;
    const maxW = (opt && opt.width) || TW;
    const x0 = (opt && opt.x) || L;
    const align = (opt && opt.align) || 'justify';
    const spaceW = textW(' ', 'normal', fs);
    // Items joined without a space can't be split between lines.
    const groups = [];
    items.forEach(it => {
      let box;
      if (it.t === 'w') {
        const st = style0 || it.st || 'normal';
        box = { t: 'w', s: it.s, st, w: textW(it.s, st, fs), asc: fs * 0.72, desc: fs * 0.24 };
      } else {
        const mb = mathBox('I:' + it.tex, fs);
        if (mb) {
          let scale = 1;
          if (mb.w > maxW) scale = maxW / mb.w;
          box = { t: 'm', m: mb.m, w: mb.w * scale, asc: mb.asc * scale, desc: mb.desc * scale };
        } else {
          box = { t: 'w', s: it.tex, st: 'italic', w: textW(it.tex, 'italic', fs), asc: fs * 0.72, desc: fs * 0.24 };
        }
      }
      if (!it.sp && groups.length) groups[groups.length - 1].boxes.push(box);
      else groups.push({ boxes: [box] });
    });
    groups.forEach(g => { g.w = g.boxes.reduce((a, b) => a + b.w, 0); });
    const lines = [];
    let cur = [], curW = 0;
    groups.forEach(g => {
      const add = cur.length ? spaceW + g.w : g.w;
      if (cur.length && curW + add > maxW) { lines.push({ groups: cur, w: curW }); cur = [g]; curW = g.w; }
      else { cur.push(g); curW += add; }
    });
    if (cur.length) lines.push({ groups: cur, w: curW, last: true });
    for (const line of lines) {
      let asc = fs * 0.78, desc = fs * 0.3;
      line.groups.forEach(g => g.boxes.forEach(b => { asc = Math.max(asc, b.asc + 1); desc = Math.max(desc, b.desc + 1); }));
      const lh = Math.max(fs * PDFB_LEADING, asc + desc + 2);
      ensure(lh);
      const base = S.y + (lh - (asc + desc)) / 2 + asc;
      let gap = spaceW;
      const gaps = line.groups.length - 1;
      if (align === 'justify' && !line.last && gaps > 0) {
        const extra = (maxW - line.w) / gaps;
        if (extra < spaceW * 3) gap = spaceW + extra;
      }
      let x = x0;
      if (align === 'center') x = x0 + (maxW - line.w) / 2;
      for (const g of line.groups) {
        for (const b of g.boxes) {
          if (b.t === 'w') {
            font(b.st, fs);
            color((opt && opt.color) || theme.fg);
            doc.text(b.s, x, base);
          } else {
            await drawSvg(mathEl(b.m), x, base - b.asc, b.w, b.asc + b.desc);
          }
          x += b.w;
        }
        x += gap;
      }
      S.y += lh;
    }
  }

  async function displayMath(tex) {
    const mb = mathBox('D:' + tex, PDFB_FS);
    if (!mb) { await paragraph([{ t: 'w', s: tex, st: 'italic' }], { align: 'center' }); return; }
    const scale = mb.w > TW ? TW / mb.w : 1;
    const w = mb.w * scale, h = (mb.asc + mb.desc) * scale;
    ensure(h + 12);
    S.y += 6;
    await drawSvg(mathEl(mb.m), L + (TW - w) / 2, S.y, w, h);
    S.y += h + 6;
  }

  // A figure's printed size: about 60% of its on-screen width, at most
  // 40% of the page's height.
  const figSize = (b, f) => {
    const natural = b.width || f.w;
    let w = Math.min(TW * 0.62, natural * 0.62);
    let h = w * (f.h / f.w);
    const maxH = (bottom - PDFB_TOP) * 0.4;
    if (h > maxH) { w *= maxH / h; h = maxH; }
    return { w, h };
  };

  // Roughly how tall a problem will be, to start it on a fresh page when it
  // would fit there whole but not in what is left of this one.
  const estimate = blocks => {
    let h = 18;
    const line = PDFB_FS * PDFB_LEADING;
    blocks.forEach(b => {
      if (b.type === 'para') {
        let w = 0;
        b.items.forEach(it => {
          if (it.t === 'w') w += textW(it.s, it.st || 'normal', PDFB_FS) + textW(' ', 'normal', PDFB_FS);
          else { const mb = mathBox('I:' + it.tex, PDFB_FS); w += (mb ? mb.w : 30) + 3; }
        });
        h += Math.ceil(w / TW + 0.05) * line;
      } else if (b.type === 'math') {
        const mb = mathBox('D:' + b.tex, PDFB_FS);
        h += (mb ? mb.asc + mb.desc : 20) + 12;
      } else if (b.type === 'figure') {
        const f = figs.get(b.src);
        h += (f ? figSize(b, f).h : 20) + 12 + (b.caption ? 24 : 0);
      }
    });
    return h;
  };

  async function figure(b) {
    const f = figs.get(b.src);
    if (!f) {
      await paragraph([{ t: 'w', s: '[figure unavailable]', st: 'italic' }], { align: 'center', color: theme.muted });
      return;
    }
    const { w, h } = figSize(b, f);
    ensure(h + 14);
    S.y += 6;
    const x = L + (TW - w) / 2;
    if (f.kind === 'svg') await drawSvg(f.el, x, S.y, w, h);
    else doc.addImage(f.data, 'PNG', x, S.y, w, h, 'fig:' + b.src, 'FAST');
    S.y += h + 6;
    if (b.caption) {
      const items = b.caption.split(/\s+/).filter(Boolean).map((s, i) => ({ t: 'w', s, st: 'italic', sp: i > 0 }));
      await paragraph(items, { fs: 8, align: 'center', color: theme.muted, width: Math.min(TW, w + 60), x: L + (TW - Math.min(TW, w + 60)) / 2 });
      S.y += 2;
    }
  }

  function answerLine() {
    const fs = 10.5;
    ensure(fs * 2.4);
    S.y += fs * 1.2;
    font('normal', fs);
    color(theme.fg);
    doc.text('Answer:', L, S.y);
    const x1 = L + textW('Answer:', 'normal', fs) + 6;
    const x2 = x1 + 170;
    color(theme.fg, 'draw');
    doc.setLineWidth(0.5);
    // No unit after the line: writing the unit is part of the answer.
    doc.line(x1, S.y + 1.5, x2, S.y + 1.5);
    S.y += fs * 0.9;
  }

  function answer(p, upside) {
    const fs = 10;
    const label = 'Answer: ';
    const value = _pdfbAnswerText(p);
    const w = textW(label, 'bold', fs) + textW(value, 'normal', fs);
    ensure(fs * 2.2);
    S.y += fs * 0.9;
    color(theme.muted);
    if (!upside) {
      font('bold', fs); doc.text(label, L, S.y + fs * 0.8);
      font('normal', fs); doc.text(value, L + textW(label, 'bold', fs), S.y + fs * 0.8);
    } else {
      // Turned 180° about its start: it runs leftward from the right margin
      // and hangs below the baseline, so the baseline sits at the top.
      const yTop = S.y + fs * 0.25;
      font('bold', fs); doc.text(label, R, yTop, { angle: 180 });
      font('normal', fs); doc.text(value, R - textW(label, 'bold', fs), yTop, { angle: 180 });
      void w;
    }
    S.y += fs * 1.3;
  }

  // ── Page 1: cover — no footer; the logo and the name are one link ──
  paintBg();
  {
    const logoH = 170, top = 180;
    let y = top;
    const lw = logo ? logoH * logo.ratio : 0;
    if (logo) await drawSvg(logo.el, (W - lw) / 2, y, lw, logoH);
    y += logoH + 76;
    const size = 56, cs = size * 0.03;          // the top bar's letter-spacing
    brandFont(size); color(theme.fg);
    const ww = doc.getTextWidth(brand) + cs * (brand.length - 1);
    doc.text(brand, (W - ww) / 2, y, { charSpace: cs });
    const linkW = Math.max(ww, lw) + 20;
    doc.link((W - linkW) / 2, top - 6, linkW, y - top + 20, { url: siteUrl });
    y += 64;
    if (nickname) {
      // The identicon in a softly rounded tile, so it reads on either page.
      const nameFs = 13, av = 20, padA = 4, tile = av + padA * 2, gap = 10;
      const nameW = textW(nickname, 'normal', nameFs);
      const gw = (avatar ? tile + gap : 0) + nameW;
      let x = (W - gw) / 2;
      if (avatar) {
        const ty = y - nameFs * 0.33 - tile / 2;
        color(theme.tile, 'fill'); color(theme.rule, 'draw');
        doc.setLineWidth(0.6);
        doc.roundedRect(x, ty, tile, tile, 4.5, 4.5, 'FD');
        await drawSvg(avatar, x + padA, ty + padA, av, av);
        x += tile + gap;
      }
      font('normal', nameFs); color(theme.fg);
      doc.text(nickname, x, y);
      y += 28;
    }
    font('normal', 9.5); color(theme.muted);
    doc.text(_pdfbDateLine(now), W / 2, y, { align: 'center' });
  }

  // ── Page 2: the set, then the problems ──
  newPage();
  {
    font('bold', 22); color(theme.fg);
    doc.text(`Set ${quizNum}`, L, S.y + 20);
    const label = 'Check for updates';
    await updateButton(R - updateButtonWidth(label), S.y + 3, label);
    font('normal', 15);
    doc.text(q.name, L, S.y + 42);
    // The rule between the title and the problems.
    color(theme.rule, 'draw');
    doc.setLineWidth(0.6);
    doc.line(L, S.y + 56, R, S.y + 56);
    S.y += 74;
  }

  const perPage = opts.space === 'page';
  for (let i = 0; i < parsed.length; i++) {
    _pdfbCheckCancel(job);
    step(0.66 + 0.3 * (i / parsed.length), `Laying out problem ${i + 1} / ${parsed.length}`);
    if (i % 4 === 0) await _pdfbTick();
    const { p, blocks, number } = parsed[i];
    // The whole problem on one page when it fits on one; otherwise at least
    // its heading with two lines under it.
    const est = estimate(blocks);
    const fitsOnePage = est < (bottom - PDFB_TOP) * 0.85;
    if (i > 0) {
      if (perPage) newPage();
      else if (fitsOnePage && S.y + 19 + est > bottom) newPage();
      else {
        ensure(60);
        if (S.y > PDFB_TOP + 1) {
          S.y += 7;
          color(theme.rule, 'draw');
          doc.setLineWidth(0.4);
          doc.line(L, S.y, R, S.y);
          S.y += 12;
        }
      }
    }
    if (!perPage && fitsOnePage && S.y + est > bottom && S.y > PDFB_TOP + 1) newPage();
    else ensure(PDFB_FS * PDFB_LEADING * 3 + 6);
    font('bold', 12); color(theme.fg);
    doc.text(`P${number}`, L, S.y + 11);
    // The fingerprint the check compares: tiny, in the text colour.
    font('normal', 5.5); color(theme.fg);
    doc.text('#' + pdfxHex4(entries[i].fp), R, S.y + 11, { align: 'right' });
    S.y += 18;
    for (const b of blocks) {
      if (b.type === 'para') await paragraph(b.items);
      else if (b.type === 'math') await displayMath(b.tex);
      else if (b.type === 'figure') await figure(b);
    }
    if (perPage) {
      // The rest of the page is working space; answer line and answer at its foot.
      const need = (opts.answerLine ? 26 : 0) + (opts.answers !== 'none' ? 24 : 0);
      if (need) S.y = Math.max(S.y, bottom - need - 4);
    } else if (opts.space === 'cm') {
      const gap = opts.spaceCm * 28.3465;
      if (S.y + gap > bottom) { const left = gap - (bottom - S.y); newPage(); S.y += Math.min(left, bottom - PDFB_TOP - 80); }
      else S.y += gap;
    }
    if (opts.answerLine) answerLine();
    if (opts.answers === 'below') answer(p, false);
    else if (opts.answers === 'upside') answer(p, true);
  }

  step(0.96, 'Finishing…');
  // ── The logo's jump above the closing box (bullet-time, see _pdfbCubeFaces) ──
  // The jump and the box share a page: both fit after the problems, or
  // both go to a new one.
  {
    const s = 11;                      // half an edge
    const arc = 52;                    // the jump's height at its top
    const need = arc + 3.4 * s + 40;
    // The closing box below, generously (its QR column, or its text column:
    // title, 4 lines, link, button), with its padding and gap.
    const boxNeed = Math.max(104 + 14, 22 + 4 * 14.2 + 26 + 30) + 32 + 6;
    if (S.y + 28 + need + boxNeed > bottom) newPage(); else S.y += 28;
    const ground = S.y + need - 14;
    const x0 = L + 3 * s, x1 = R - 3 * s;
    const restBottom = Math.max(..._pdfbCubeFaces(0).flatMap(f => f.pts.map(p => p[1])));
    const cube = (t, opacity) => {
      const sx = 1, sy = 1;
      const faces = _pdfbCubeFaces(_pdfbTumbleEase(t));
      const cx = x0 + (x1 - x0) * t;
      const dy = -arc * 4 * t * (1 - t);
      doc.setGState(new doc.GState({ opacity, 'stroke-opacity': opacity }));
      faces.forEach(f => {
        const pts = f.pts.map(p => [cx + p[0] * s * sx, ground + (p[1] - restBottom) * s * sy + dy]);
        color(f.c, 'fill');
        doc.setDrawColor(0, 0, 0);
        doc.setLineWidth(0.35);
        const d = pts.slice(1).map((p, i) => [p[0] - pts[i][0], p[1] - pts[i][1]]);
        doc.lines(d, pts[0][0], pts[0][1], [1, 1], 'FD', true);
      });
    };
    // Smear first (many faint copies), then the trail's frames, then the
    // two sharp ends on top.
    for (let k = 1; k < 60; k++) if (k % 6) cube(k / 60, 0.05);
    for (let k = 1; k < 10; k++) cube(k / 10, 0.2);
    cube(0, 1);
    cube(1, 1);
    doc.setGState(new doc.GState({ opacity: 1, 'stroke-opacity': 1 }));
    S.y = ground + 14;
  }

  // ── Closing box ──
  {
    const qrSite = 74, qrCheck = 104, pad = 16, gapQ = 18;
    const qrH = qrCheck + 14;                     // with its caption
    const colW = TW - pad * 2 - qrSite - qrCheck - gapQ * 2;
    // No page check of its own: the jump above already made room for this
    // box (boxNeed there; keep its numbers in step with this layout), so
    // the two always share a page.
    S.y += 6;
    const top = S.y;
    S.y = top + pad;
    font('bold', 13); color(theme.fg);
    doc.text("That's the whole set.", L + pad, S.y + 11);
    S.y += 22;
    const body = `We're waiting for you back on ${appName}: train with practice exams, check every answer instantly and track your progress.`;
    await paragraph(body.split(' ').map((s, k) => ({ t: 'w', s, st: 'normal', sp: k > 0 })), { fs: 10, width: colW, x: L + pad, align: 'left' });
    S.y += 4;
    font('normal', 10); color(theme.fg);
    doc.textWithLink(siteShort, L + pad, S.y + 9, { url: siteUrl });
    doc.setLineWidth(0.4); color(theme.fg, 'draw');
    doc.line(L + pad, S.y + 10.5, L + pad + textW(siteShort, 'normal', 10), S.y + 10.5);
    S.y += 22;
    S.y += 4;
    await updateButton(L + pad, S.y, 'Check for updates');
    S.y += 22;
    const boxBottom = Math.max(S.y, top + pad + qrH) + pad;
    color(theme.fg, 'draw');
    doc.setLineWidth(0.8);
    doc.rect(L, top, TW, boxBottom - top, 'S');
    // QR codes in the page's colours: black on white, white on black.
    const qr = (url, size, x, y, caption) => {
      const code = qrcode(0, 'L');
      code.addData(url, 'Byte');
      code.make();
      const n = code.getModuleCount();
      const quiet = 4 * size / (n + 8);
      const cell = (size - quiet * 2) / n;
      const darkPage = !!theme.bg;
      doc.setFillColor(...(darkPage ? [0, 0, 0] : [255, 255, 255]));
      doc.rect(x, y, size, size, 'F');
      doc.setFillColor(...(darkPage ? [255, 255, 255] : [0, 0, 0]));
      for (let r = 0; r < n; r++) {
        for (let c = 0; c < n; c++) {
          if (code.isDark(r, c)) doc.rect(x + quiet + c * cell, y + quiet + r * cell, cell + 0.02, cell + 0.02, 'F');
        }
      }
      doc.link(x, y, size, size, { url });
      font('normal', 7.5); color(theme.muted);
      doc.text(caption, x + size / 2, y + size + 10, { align: 'center' });
    };
    const xCheck = R - pad - qrCheck;
    const xSite = xCheck - gapQ - qrSite;
    qr(siteUrl, qrSite, xSite, top + pad + (qrCheck - qrSite), appName);
    qr(checkUrl, qrCheck, xCheck, top + pad, 'Check this PDF');
    S.y = boxBottom;
  }

  // ── Footers from page 2: logo + name (a link to the site), page number ──
  const pages = doc.getNumberOfPages();
  for (let i = 2; i <= pages; i++) {
    doc.setPage(i);
    const y = H - 30;
    const lh = 11;
    let x = L;
    if (logo) { await drawSvg(logo.el, x, y - lh + 1.5, lh * logo.ratio, lh); x += lh * logo.ratio + 5; }
    const bfs = 9.5, bcs = bfs * 0.03;
    brandFont(bfs); color(theme.fg);
    doc.text(brand, x, y, { charSpace: bcs });
    const bw = doc.getTextWidth(brand) + bcs * (brand.length - 1);
    doc.link(L, y - lh, x - L + bw, lh + 3, { url: siteUrl });
    font('normal', 8); color(theme.muted);
    doc.text(`${i} / ${pages}`, R, y, { align: 'right' });
    let mid = `Set ${quizNum} · ${q.name}`;
    if (textW(mid, 'normal', 8) > TW - 160) mid = `Set ${quizNum}`;
    doc.text(mid, W / 2, y, { align: 'center' });
  }

  doc.setProperties({
    title: `${appName}, Set ${quizNum}: ${q.name}`,
    subject: `${typeof COURSE_CODE_DISPLAY === 'string' ? COURSE_CODE_DISPLAY + ' ' : ''}practice problems, ${problems.length} from Set ${quizNum}`,
    author: nickname || appName,
    keywords: `pdfcheck:${ACTIVE_COURSE}:${code}`,
    creator: `${appName} (${siteUrl})`,
  });

  _pdfbCheckCancel(job);
  step(0.99, 'Saving…');
  // "Impulse_set4_20261119_122223.pdf": set, then the local date and time.
  const two = v => String(v).padStart(2, '0');
  const stamp = `${now.getFullYear()}${two(now.getMonth() + 1)}${two(now.getDate())}_${two(now.getHours())}${two(now.getMinutes())}${two(now.getSeconds())}`;
  doc.save(`${appName}_set${quizNum}_${stamp}.pdf`);
  step(1, 'Done');
  return { code, checkUrl, pages };
}
