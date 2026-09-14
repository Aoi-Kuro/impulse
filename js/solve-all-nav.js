// ─── Solve-All side navigator ───────────────────────────────────────────────
// A thin progress rail pinned to the left edge of the viewport while
// Solve-All mode is open on wide screens (see css/solve-all-nav.css for the
// min-width gate — there's only room beside the centered 760px column once
// the viewport is wide enough). Shows evenly-spaced problem tick marks
// (P10, P20, ... — step adapts to how many problems are in the current set,
// see chooseTickStep), a small pointer that tracks scroll position
// continuously, and a highlighted "you are here" segment between the two
// tick marks nearest the current position. Clicking anywhere on the track
// (generous hitboxes, not just the thin visual line) scrolls there;
// clicking a tick jumps straight to that problem's card.
//
// Deliberately self-contained: never imports from or calls into
// quiz-engine.js, and quiz-engine.js never needs to know this file exists.
// Instead it watches #solveAllMode's `active` class and #solveAllContainer's
// children via MutationObserver, so it rebuilds itself automatically
// whenever Solve-All is opened, closed, or re-rendered (new quiz, Rerender
// Equations, a filtered pool, ...) no matter which code path triggered it.

(function () {
  const MIN_CARDS = 12;        // below this a nav rail isn't worth the clutter
  const ANCHOR_FRACTION = 0.3; // "current position" = this far down the viewport, not the very top — matches where a reader's eye actually sits
  const TICK_CANDIDATES = [5, 10, 15, 20, 25, 50, 100, 200, 500, 1000];
  const MAX_TICKS = 16;        // pick the smallest candidate step that keeps tick count at or below this

  let railEl = null, trackEl = null, highlightEl = null, ticksEl = null, pointerEl = null, hitzoneEl = null;
  let cards = [];      // [{ el, label, top, bottom }], document order, page-relative coordinates
  let tickList = [];   // [{ idx, pct, el }], ascending by idx
  let docTop = 0, docBottom = 0;
  let built = false;
  let rafPending = false;
  let resizeTimer = null;
  let containerDebounce = null;

  function chooseTickStep(n) {
    for (const step of TICK_CANDIDATES) {
      if (Math.ceil(n / step) <= MAX_TICKS) return step;
    }
    return TICK_CANDIDATES[TICK_CANDIDATES.length - 1];
  }

  function ensureDom() {
    if (railEl) return;
    railEl = document.createElement('nav');
    railEl.id = 'saNavRail';
    railEl.setAttribute('aria-hidden', 'true');
    railEl.innerHTML =
      '<div class="sa-nav-track" id="saNavTrack">' +
        '<div class="sa-nav-hitzone" id="saNavHitzone"></div>' +
        '<div class="sa-nav-highlight" id="saNavHighlight"></div>' +
        '<div class="sa-nav-ticks" id="saNavTicks"></div>' +
        '<div class="sa-nav-pointer" id="saNavPointer"><span class="sa-nav-pointer-arrow"></span></div>' +
      '</div>';
    // Appended to <body>, not #appPage — #appPage's fadeInPage/fadeOutPage
    // keyframes apply a transform, which would make this rail's `position:
    // fixed` center on #appPage's own (huge, scrolled) box instead of the
    // viewport. Same reasoning as #stickyScore / #mistakesModal (see their
    // comments in index.html).
    document.body.appendChild(railEl);
    trackEl = railEl.querySelector('#saNavTrack');
    highlightEl = railEl.querySelector('#saNavHighlight');
    ticksEl = railEl.querySelector('#saNavTicks');
    pointerEl = railEl.querySelector('#saNavPointer');
    hitzoneEl = railEl.querySelector('#saNavHitzone');
    hitzoneEl.addEventListener('click', onTrackClick);
  }

  function collectCards() {
    const container = document.getElementById('solveAllContainer');
    if (!container) return [];
    return Array.from(container.querySelectorAll(':scope > .problem-card')).map((el) => {
      const labelEl = el.querySelector('.problem-num');
      return { el: el, label: labelEl ? labelEl.textContent.trim() : '', top: 0, bottom: 0 };
    });
  }

  // Absolute document-coordinate top/bottom for every card, plus the range
  // the whole rail represents (first card's top to last card's bottom).
  function measure() {
    if (!cards.length) return false;
    const scrollY = window.scrollY || window.pageYOffset;
    cards.forEach((c) => {
      const r = c.el.getBoundingClientRect();
      c.top = r.top + scrollY;
      c.bottom = r.bottom + scrollY;
    });
    docTop = cards[0].top;
    docBottom = cards[cards.length - 1].bottom;
    return docBottom > docTop;
  }

  function makeTick(cardIdx, pct) {
    const c = cards[cardIdx];
    const tick = document.createElement('div');
    tick.className = 'sa-nav-tick';
    tick.style.top = pct.toFixed(3) + '%';
    tick.title = c.label;
    tick.innerHTML =
      '<span class="sa-nav-tick-label">' + c.label + '</span>' +
      '<span class="sa-nav-tick-mark"></span>';
    tick.addEventListener('click', (e) => {
      e.stopPropagation();
      scrollToCard(cardIdx);
    });
    return tick;
  }

  function buildTicks(step) {
    ticksEl.innerHTML = '';
    const range = docBottom - docTop || 1;
    const frag = document.createDocumentFragment();
    const list = [];

    // Always pin the very first problem to the top of the rail (0%), even
    // when the chosen step wouldn't otherwise land a tick there — an empty
    // top reads as "nothing before P10", not "this is where P1 starts".
    const firstTick = makeTick(0, 0);
    frag.appendChild(firstTick);
    list.push({ idx: 0, pct: 0, el: firstTick });

    for (let i = step - 1; i < cards.length; i += step) {
      if (i === 0) continue; // already added above
      const pct = ((cards[i].top - docTop) / range) * 100;
      const tick = makeTick(i, pct);
      frag.appendChild(tick);
      list.push({ idx: i, pct: pct, el: tick });
    }
    ticksEl.appendChild(frag);
    return list;
  }

  function currentAnchorY() {
    return (window.scrollY || window.pageYOffset) + window.innerHeight * ANCHOR_FRACTION;
  }

  function update() {
    rafPending = false;
    if (!built || !cards.length) return;

    const range = docBottom - docTop || 1;
    const anchor = currentAnchorY();
    const frac = Math.max(0, Math.min(1, (anchor - docTop) / range));
    pointerEl.style.top = (frac * 100).toFixed(3) + '%';

    // Current card = last one whose top has scrolled at/above the anchor line.
    let idx = 0;
    for (let i = 0; i < cards.length; i++) {
      if (cards[i].top <= anchor) idx = i; else break;
    }

    // The two tick marks bracketing the current card — highlight the track
    // segment between them, plus the ticks themselves. Off either end of
    // the tick list, the highlight just runs to the rail's edge (0%/100%).
    let lowerTick = null, upperTick = null;
    for (const t of tickList) {
      if (t.idx <= idx) lowerTick = t; else { upperTick = t; break; }
    }
    const lowerPct = lowerTick ? lowerTick.pct : 0;
    const upperPct = upperTick ? upperTick.pct : 100;

    highlightEl.style.top = lowerPct.toFixed(3) + '%';
    highlightEl.style.height = Math.max(0, upperPct - lowerPct).toFixed(3) + '%';

    tickList.forEach((t) => {
      t.el.classList.toggle('is-active', t === lowerTick || t === upperTick);
    });
  }

  function requestUpdate() {
    if (!built) return;
    if (rafPending) return;
    rafPending = true;
    requestAnimationFrame(update);
  }

  function scrollToCard(idx) {
    const c = cards[idx];
    if (!c) return;
    const target = c.top - window.innerHeight * ANCHOR_FRACTION + 4;
    window.scrollTo({ top: Math.max(0, target), behavior: 'smooth' });
  }

  function onTrackClick(e) {
    if (!built || !cards.length) return;
    const rect = trackEl.getBoundingClientRect();
    const frac = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));
    const targetDocY = docTop + frac * (docBottom - docTop);
    const target = targetDocY - window.innerHeight * ANCHOR_FRACTION;
    window.scrollTo({ top: Math.max(0, target), behavior: 'smooth' });
  }

  function isModeActive() {
    const modeEl = document.getElementById('solveAllMode');
    return !!(modeEl && modeEl.classList.contains('active'));
  }

  function hide() {
    built = false;
    if (railEl) railEl.classList.remove('is-ready');
  }

  function rebuild() {
    if (!isModeActive()) { hide(); return; }
    cards = collectCards();
    if (cards.length < MIN_CARDS || !measure()) { hide(); return; }

    ensureDom();
    const step = chooseTickStep(cards.length);
    tickList = buildTicks(step);
    built = true;

    // Two rAFs (not one) so the browser actually paints the rail's resting
    // opacity:0 state before .is-ready flips it to 1 — otherwise, on a
    // brand-new element inserted and revealed in the same tick, there's
    // nothing for the opacity transition to animate from and it just
    // appears instantly instead of fading in.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (!built) return; // Solve-All may have already closed again
        railEl.classList.add('is-ready');
        update();
      });
    });
  }

  window.addEventListener('scroll', requestUpdate, { passive: true });
  window.addEventListener('resize', () => {
    if (!built) return;
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(rebuild, 200);
  });

  const modeEl = document.getElementById('solveAllMode');
  if (modeEl) {
    new MutationObserver(() => {
      if (modeEl.classList.contains('active')) {
        // renderSolveAll()'s card build is async (chunked + math-cache-gated
        // — see buildSolveAllCards in js/quiz-engine.js), so give the first
        // batch a moment; the #solveAllContainer observer below covers the
        // rest of the build as later batches land.
        setTimeout(rebuild, 50);
      } else {
        hide();
      }
    }).observe(modeEl, { attributes: true, attributeFilter: ['class'] });

    // Covers a reload that lands mid-session with Solve-All already open.
    if (modeEl.classList.contains('active')) setTimeout(rebuild, 50);
  }

  const containerEl = document.getElementById('solveAllContainer');
  if (containerEl) {
    new MutationObserver(() => {
      if (!isModeActive()) return;
      // buildSolveAllCards() clears the container and appends ~12 cards per
      // animation-frame batch — debounce so a full rebuild only runs once
      // things settle, instead of once per batch.
      clearTimeout(containerDebounce);
      containerDebounce = setTimeout(rebuild, 180);
    }).observe(containerEl, { childList: true });
  }
})();
