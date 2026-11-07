// ─── Problem card layout ────────────────────────────────────────────────────
// Settings > Study > Problem card (study.cardLayout): what sits where under a
// problem on Random Quiz and Solve Them All cards.
//
//   inline  Check joins the answer field and the result sits beside them.
//           Chat, Common mistakes and Solution keep a row of their own.
//   tabs    The same, with that row as three tabs across the card.
//   legacy  One row holding everything.
//
// Check and "See correct answer" change as a student works, and sharing a row
// with them is what made Solution move. Parts are moved here, not drawn per
// layout: they keep their ids and handlers, and a change reaches the cards on
// screen. Their looks are in css/card-layouts.css.
//
// In Inline and Tabs a Solve Them All card shows its result on the Check
// button (✓, or ✗ turning into Retry). An eye next to it replaces "See correct
// answer", and anything left to read opens in a box under the field. The
// feedback line stays filled in but hidden, so Legacy is one setting away.

const CARD_LAYOUTS = ['inline', 'tabs', 'legacy'];

function getCardLayout() {
  const saved = typeof getSetting === 'function' ? getSetting('study', 'cardLayout') : null;
  return CARD_LAYOUTS.includes(saved) ? saved : 'inline';
}

// Call once a card has its parts, and again when one is added (the "See
// correct answer" button, a mistake note).
function placeCardParts(card) {
  const answerRow = card.querySelector('.answer-row');
  const result = card.querySelector('.card-result');
  const tools = card.querySelector('.card-check-row');
  if (!answerRow || !result || !tools) return;

  const layout = getCardLayout();
  const check = card.querySelector('.check-problem-btn');
  card.dataset.layout = layout;
  card.classList.toggle('card-answer-line', layout !== 'legacy');
  card.classList.toggle('card-self-check', layout !== 'legacy' && !!check);

  const see = card.querySelector('.btn-see-answer');
  const note = card.querySelector('.mistake-hit:not(.card-ghost)');
  // Moved only when out of place: moving a button takes the keyboard focus
  // off it and replays its entrance.
  const home = layout === 'legacy' ? tools : answerRow;
  if (check && check.parentElement !== home) home.append(check);
  if (see) {
    if (layout === 'legacy' && see.nextElementSibling !== check) check.before(see);
    if (layout !== 'legacy' && see.previousElementSibling !== check) check.after(see);
  }
  if (layout === 'legacy') {
    if (note) result.querySelector('.feedback').append(note);
    return;
  }
  if (note) {
    // Below the tools, after the list if it was opened: toggleMistakes()
    // expects the list right under the row.
    const panel = tools.nextElementSibling;
    (panel && panel.classList.contains('mistake-panel') ? panel : tools).after(note);
  }
}

function applyCardLayout() {
  document.querySelectorAll('.problem-card[data-layout]').forEach(placeCardParts);
}

// The eye and its label; css/card-layouts.css shows the one that fits.
const SEE_ANSWER_HTML = '<span class="see-label"></span>'
  + '<svg class="see-eye" viewBox="0 0 24 24" aria-hidden="true">'
  + '<g class="see-eye-closed"><path d="M3 10c2.5 3.6 5.5 5.4 9 5.4s6.5-1.8 9-5.4"/><path d="M12 15.4V19M6.6 13.7l-2 2.7M17.4 13.7l2 2.7"/></g>'
  + '<g class="see-eye-open"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/></g>'
  + '</svg>';

// A correct answer takes the eye away, in step with the box closing.
function removeSeeButton(card) {
  const see = card.querySelector('.btn-see-answer');
  if (!see) return;
  if (!card.classList.contains('card-self-check')) { see.remove(); return; }
  see.classList.add('see-leaving');
  setTimeout(() => see.remove(), 200);
}

// Plays the ✓, or the ✗ that turns into Retry. Restarts on a second wrong
// answer. The class goes when it's over, or coming back to this screen from
// another one would play it again on every card that has it.
function flashCheckResult(btn, kind) {
  btn.classList.remove('just-right', 'just-wrong');
  void btn.offsetWidth;
  btn.classList.add('just-' + kind);
  clearTimeout(btn._flashTimer);
  btn._flashTimer = setTimeout(() => btn.classList.remove('just-' + kind), 1100);
}

// The box under the field. Empty closes it, and what it showed stays until
// it has folded away.
function setCardFold(fold, html) {
  if (html) fold.querySelector('.card-fold-text').innerHTML = html;
  fold.classList.toggle('open', !!html);
}

function clearCardResult(card) {
  const fold = card.querySelector('.card-fold');
  if (fold) setCardFold(fold, '');
  const check = card.querySelector('.check-problem-btn');
  if (check) check.classList.remove('just-right', 'just-wrong');
}

// ─── Opening and closing without repainting the page ────────────────────────
// Animating a box's height repaints everything below it on every frame, which
// a page of 145 cards can't do at a display's full rate. So the page takes its
// final layout once, and transforms, which the GPU runs without repainting,
// carry it there: what moved slides from where it was, the card's outline
// stretches, and what opens comes out from under the part above it.

const CARD_MOTION = { duration: 220, easing: 'cubic-bezier(.2, .7, .2, 1)' };
const CARD_BOXES = '.card-fold.open, .mistake-panel.open, .mistake-hit';

// Each visible block of a card, by its distance from the card's top. The
// .card-result around the box under the field isn't one of them.
function _cardBlocks(card) {
  const tops = new Map();
  const cardTop = card.getBoundingClientRect().top;
  [...card.children, ...card.querySelectorAll('.card-fold')].forEach((el) => {
    if (el.classList.contains('card-result') || !el.offsetHeight) return;
    tops.set(el, el.getBoundingClientRect().top - cardTop);
  });
  return tops;
}

function _endCardMotion(card) {
  const motion = card._motion;
  if (!motion) return;
  card._motion = null;
  motion.anims.forEach((a) => a.cancel());
  motion.ghosts.forEach((g) => g.remove());
  motion.moved.forEach((el) => el.classList.remove('card-moved', 'card-bottom'));
  card.classList.remove('card-moving');
}

// Runs `change`, which opens or closes something in the card, and animates
// the result. Only for what a student just did: it measures the card.
function smoothCardChange(card, change) {
  _endCardMotion(card);
  if (!card.offsetHeight || matchMedia('(prefers-reduced-motion: reduce)').matches) {
    change();
    return;
  }

  const height0 = card.getBoundingClientRect().height;
  const before = _cardBlocks(card);
  const boxes = [...card.querySelectorAll(CARD_BOXES)].filter((el) => before.has(el));
  const clones = boxes.map((el) => el.cloneNode(true));

  change();

  const height1 = card.getBoundingClientRect().height;
  const delta = height1 - height0;
  if (Math.abs(delta) < 1) return;
  const after = _cardBlocks(card);

  const anims = [], moved = [], ghosts = [];
  const slide = (el, offset) => anims.push(el.animate(
    { transform: [`translateY(${offset}px)`, 'translateY(0)'] }, CARD_MOTION));

  card.classList.add('card-moving');
  anims.push(card.animate({ transform: [`scaleY(${height0 / height1})`, 'scaleY(1)'] },
    { ...CARD_MOTION, pseudoElement: '::before' }));

  // Bottom up, so what just appeared travels with the block under it.
  const order = [...after.keys()].sort((a, b) => after.get(b) - after.get(a));
  if (order[0]) { order[0].classList.add('card-bottom'); moved.push(order[0]); }
  let offset = -delta;
  order.forEach((el) => {
    if (before.has(el)) offset = before.get(el) - after.get(el);
    if (Math.abs(offset) < .5) return;
    el.classList.add('card-moved');
    moved.push(el);
    slide(el, offset);
  });

  // What closed stays on show, as a copy that slides away behind the rest.
  boxes.forEach((el, i) => {
    if (after.has(el)) return;
    const ghost = clones[i];
    ghost.classList.add('card-ghost');
    ghost.style.top = `${before.get(el) - 1}px`;
    card.append(ghost);
    ghosts.push(ghost);
    const below = [...before.keys()].filter((b) => before.get(b) > before.get(el) && after.has(b))
      .sort((a, b) => before.get(a) - before.get(b))[0];
    const by = below ? after.get(below) - before.get(below) : delta;
    anims.push(ghost.animate(
      { transform: ['translateY(0)', `translateY(${by}px)`], opacity: [1, 0] }, CARD_MOTION));
  });

  // The cards below, as far as the screen shows them.
  const reach = window.innerHeight + Math.abs(delta);
  for (let next = card.nextElementSibling; next; next = next.nextElementSibling) {
    if (next.getBoundingClientRect().top > reach) break;
    if (next.offsetHeight) slide(next, -delta);
  }

  const motion = { anims, moved, ghosts };
  card._motion = motion;
  Promise.all(anims.map((a) => a.finished))
    .then(() => { if (card._motion === motion) _endCardMotion(card); })
    .catch(() => {});
}

// ─── Ready before the first tap ─────────────────────────────────────────────
// A motion can't start until the page is laid out and what it moves has a GPU
// layer, which on a page of 145 cards is a delay you can feel. So in Solve Them
// All, once the maths is done, cards off screen skip layout and painting (their
// measured heights keep the page exactly as long), and the ones on or near the
// screen keep a layer of their own, so a tap finds them ready. Their transform
// is translateZ(0) and not will-change, which would turn off LCD text.

let _cardReadyWatch = null;

function prepareCardMotion(container) {
  const cards = [...container.querySelectorAll(':scope > .problem-card')];
  const heights = cards.map((card) => card.clientHeight);
  cards.forEach((card, i) => {
    if (heights[i]) card.style.containIntrinsicSize = `auto ${heights[i]}px`;
  });
  container.classList.add('cards-settled');
  if (!('IntersectionObserver' in window)) return;
  _cardReadyWatch = new IntersectionObserver((entries) => {
    entries.forEach((entry) => entry.target.classList.toggle('card-ready', entry.isIntersecting));
  }, { rootMargin: '60% 0px' });
  cards.forEach((card) => _cardReadyWatch.observe(card));
}

function releaseCardMotion(container) {
  if (_cardReadyWatch) _cardReadyWatch.disconnect();
  _cardReadyWatch = null;
  container.classList.remove('cards-settled');
}
