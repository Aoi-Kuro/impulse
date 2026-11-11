// ─── Exam handouts (course/quizzes/handouts.js) ────────────────────────
// A quiz with a handout gets a small button right after the number of each
// of its problems, in every mode: Random quiz (a mixed one too), Solve them
// all and the review in Stats. The handout was allowed in the exam, so the
// button is there during an attempt as well, unlike Solution and Common
// mistakes, and it stays in Safe Exam Browser lockdown.
//
// One shared window shows it: the redrawn drawings (course/figures/, through
// redrawnFigure in js/figure-style.js) with each body's name and formula, or
// the original handout image while Settings › Study › Redrawn figures is off.
// It is built the first time it opens and again only when that setting has
// changed since.

// A ball with an arrow going round it: the orbit passes in front of the
// ball, goes behind it, and the arrowhead on the far side shows the turn.
const HANDOUT_ICON_SVG = '<svg viewBox="0 0 16 16" aria-hidden="true">'
  + '<g transform="rotate(-16 8 8)">'
  + '<path class="handout-icon-back" d="M4.6,5.9 A6.4,2.7 0 0 0 1.6,8.2"/>'
  + '<circle class="handout-icon-ball" cx="8" cy="8.2" r="2.9"/>'
  + '<path d="M1.6,8.2 A6.4,2.7 0 0 0 14.4,8.2 A6.4,2.7 0 0 0 12.2,6.1"/>'
  + '<path class="handout-icon-head" d="M10.3,5.55 L12.85,4.7 L12.5,7.05 Z"/>'
  + '</g></svg>';

function quizHandout(quizNum) {
  return (typeof QUIZ_HANDOUTS !== 'undefined' && QUIZ_HANDOUTS[quizNum]) || null;
}

// The button for a problem's card header, or '' when its quiz has no handout.
function handoutButtonHtml(quizNum) {
  const h = quizHandout(quizNum);
  if (!h) return '';
  return `<button type="button" class="handout-btn" onclick="openHandout(${Number(quizNum)}, this)"`
    + ` title="${h.title} (exam handout)" aria-label="${h.title}" aria-haspopup="dialog">`
    + `${HANDOUT_ICON_SVG}<span class="handout-btn-text">Table</span></button>`;
}

let _handoutEl = null;        // the shared window, made on first open
let _handoutBuilt = '';       // "<quiz>:<redrawn|original>" it currently shows
let _handoutOpener = null;    // focus goes back here on close

function _handoutRedrawn() {
  return typeof redrawnFigure === 'function' && (typeof redrawnFiguresOn !== 'function' || redrawnFiguresOn());
}

function _handoutWindow() {
  if (_handoutEl) return _handoutEl;
  const el = document.createElement('div');
  el.className = 'handout-overlay';
  el.innerHTML = `
    <div class="handout-panel" role="dialog" aria-modal="true" aria-labelledby="handoutTitle" tabindex="-1">
      <div class="handout-head">
        <span class="handout-head-icon">${HANDOUT_ICON_SVG}</span>
        <span class="handout-title" id="handoutTitle"></span>
        <button type="button" class="handout-close" aria-label="Close" onclick="closeHandout()">✕</button>
      </div>
      <p class="handout-note"></p>
      <div class="handout-body"></div>
    </div>`;
  el.addEventListener('click', (e) => { if (e.target === el) closeHandout(); });
  document.body.appendChild(el);
  _handoutEl = el;
  return el;
}

function _buildHandout(quizNum, h) {
  const el = _handoutWindow();
  const redrawn = _handoutRedrawn();
  const key = `${quizNum}:${redrawn ? 'redrawn' : 'original'}`;
  if (_handoutBuilt === key) return;
  _handoutBuilt = key;
  el.querySelector('.handout-title').textContent = h.title;
  el.querySelector('.handout-note').textContent = h.note || '';
  const body = el.querySelector('.handout-body');
  body.innerHTML = '';
  if (!redrawn) {
    const img = document.createElement('img');
    img.className = 'handout-original';
    img.src = h.image;
    img.alt = h.title;
    body.appendChild(img);
    return;
  }
  const grid = document.createElement('div');
  grid.className = 'handout-grid';
  h.items.forEach((it) => {
    const cell = document.createElement('figure');
    cell.className = 'handout-item';
    const svg = redrawnFigure(`images/${h.figures}/${it.fig}`, it.name);
    const fig = document.createElement('div');
    fig.className = 'handout-fig';
    if (svg) fig.appendChild(svg);
    const cap = document.createElement('figcaption');
    const name = document.createElement('span');
    name.className = 'handout-item-name';
    name.textContent = it.name;
    const formula = document.createElement('span');
    formula.className = 'handout-item-formula';
    formula.textContent = `$${it.formula}$`;
    cap.append(name, formula);
    cell.append(fig, cap);
    grid.appendChild(cell);
  });
  body.appendChild(grid);
  if (typeof renderMathIn === 'function') renderMathIn(grid);
}

function openHandout(quizNum, opener) {
  const h = quizHandout(quizNum);
  if (!h) return;
  _buildHandout(quizNum, h);
  _handoutOpener = opener || document.activeElement;
  // The first time, the window was only just made: have the browser apply
  // its hidden state before opening, or there is nothing to fade from and
  // it appears at once.
  void _handoutEl.offsetWidth;
  _handoutEl.classList.add('open');
  document.documentElement.classList.add('handout-open');
  _handoutEl.querySelector('.handout-panel').scrollTop = 0;
  _handoutEl.querySelector('.handout-close').focus({ preventScroll: true });
}

function closeHandout() {
  if (!_handoutEl || !_handoutEl.classList.contains('open')) return;
  _handoutEl.classList.remove('open');
  document.documentElement.classList.remove('handout-open');
  if (_handoutOpener && _handoutOpener.isConnected) _handoutOpener.focus({ preventScroll: true });
  _handoutOpener = null;
}

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && _handoutEl && _handoutEl.classList.contains('open')) {
    e.stopPropagation();
    closeHandout();
  }
}, true);
