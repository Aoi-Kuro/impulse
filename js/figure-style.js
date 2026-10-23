// ─── Redrawn problem figures (Settings › Study › Redrawn figures) ──────────
// course/figures/quizN.js map each problem image, by its folder and file
// name, to a redrawn SVG drawn in theme colours (made by tools/figures). The
// quiz data keeps the original <img>; this swaps it for the SVG on screen
// while the setting is on, and back again when it is off. Problem HTML is
// put on the page from several places (cards, Solve-All, review, the
// MathJax cache's stored HTML, which may hold either version), so one
// MutationObserver on <body> handles every insertion instead of each render
// path calling in.

const FIG_SRC_RE = /images\/([^/]+)\/([^/?#]+)$/;

// settings.js loads later in the same tier-2 queue; until it does, read its
// saved value straight from localStorage (default: on).
function redrawnFiguresOn() {
  if (typeof getSetting === 'function') return getSetting('study', 'redrawnFigures') !== false;
  try {
    const raw = JSON.parse(localStorage.getItem('flux_settings') || 'null');
    return !(raw && raw.study && raw.study.redrawnFigures === false);
  } catch (e) {
    return true;
  }
}

function redrawnSvgFor(src) {
  const m = FIG_SRC_RE.exec(src || '');
  const maps = window.REDRAWN_FIGURES;
  return (m && maps && maps[m[1]] && maps[m[1]][m[2]]) || null;
}

let figIdSerial = 0;

// The drawing for an image path, as a new <svg> element (null if there is
// none). Also used by the manual's figure demo (js/manual.js).
function redrawnFigure(src, alt) {
  let svgText = redrawnSvgFor(src);
  if (!svgText) return null;
  // A few drawings define ids (clip paths). Each copy on the page gets its
  // own, or two copies of one drawing would share them and a copy inside a
  // hidden screen could leave the visible one unclipped.
  if (svgText.includes(' id="')) {
    const n = ++figIdSerial;
    svgText = svgText.replace(/ id="([^"]+)"/g, ` id="$1-${n}"`).replace(/url\(#([^)]+)\)/g, `url(#$1-${n})`);
  }
  const holder = document.createElement('div');
  holder.innerHTML = svgText;
  const svg = holder.firstElementChild;
  svg.classList.add('fig-redrawn');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', alt || 'figure');
  svg.dataset.figSrc = src;
  // Drawn at one user unit per pixel: the viewBox width is the figure's
  // natural width (css/style.css scales it with the Figure size setting).
  svg.style.setProperty('--fig-w', String(svg.viewBox.baseVal.width || 350));
  return svg;
}

function toRedrawn(img) {
  const svg = redrawnFigure(img.getAttribute('src'), img.getAttribute('alt'));
  if (!svg) return;
  img.replaceWith(svg);
  // A drawing with an animation (course/animations/) gets its play button.
  if (typeof attachFigureAnimation === 'function') attachFigureAnimation(svg);
}

function toOriginal(svg) {
  const img = document.createElement('img');
  img.src = svg.dataset.figSrc;
  img.alt = svg.getAttribute('aria-label') || 'figure';
  img.setAttribute('width', '350px');
  // An animated drawing sits in a .fig-anim wrapper with its controls.
  const host = svg.parentElement && svg.parentElement.classList.contains('fig-anim') ? svg.parentElement : svg;
  host.replaceWith(img);
}

// HTML for the MathJax cache (js/quiz-engine.js): redrawn figures put back as
// their original <img>, so a cached card never holds an outdated drawing.
function figuresAsOriginal(html) {
  if (!html.includes('fig-redrawn')) return html;
  const t = document.createElement('template');
  t.innerHTML = html;
  t.content.querySelectorAll('svg.fig-redrawn').forEach(toOriginal);
  return t.innerHTML;
}

// Puts every problem figure inside root into the style the setting asks for.
function syncFigureStyle(root) {
  const wrap = root.closest ? root.closest('.fig-img-wrap') : null;
  const scope = wrap || root;
  if (redrawnFiguresOn()) scope.querySelectorAll('.fig-img-wrap img').forEach(toRedrawn);
  else scope.querySelectorAll('.fig-img-wrap svg.fig-redrawn').forEach(toOriginal);
}

// Called by the setting's switch: re-styles everything already on screen.
function applyFigureStyle() {
  syncFigureStyle(document.body);
}

new MutationObserver((records) => {
  for (const r of records) {
    for (const node of r.addedNodes) {
      if (node.nodeType !== 1) continue;
      // Cheap filter: most insertions (timers, toasts, chat) hold no figure.
      if (node.tagName === 'IMG' || node.classList.contains('fig-redrawn') ||
          node.getElementsByTagName('img').length || node.getElementsByClassName('fig-redrawn').length) {
        syncFigureStyle(node);
      }
    }
  }
}).observe(document.body, { childList: true, subtree: true });

// Problems rendered before this (tier-2) script ran.
applyFigureStyle();
