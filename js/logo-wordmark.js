// ── Logo wordmark during a Random N attempt ──────────────────────────────────
// While a Random N / cumulative attempt is running, the course name beside
// the logo (IMPULSE / FLUX) is soaked up by the cube: the letters fly into
// it one by one, nearest first, taking on its face colours, and the cube
// makes a one-third turn and stays turned for the rest of the attempt.
// When the attempt ends (checked, or left), the cube turns back and lets
// the letters out again.
//
// Driven by the same 'quiztimer:activechange' event as the top-bar clock
// (quiz-engine.js's startLiveQuizTimer/stopLiveQuizTimer), so it covers
// every way an attempt starts or ends. "New quiz" mid-attempt fires end and
// start back to back; both are folded into one microtask so the cube just
// stays turned instead of turning back and forth.
//
// Going home mid-attempt: the main menu's tumble (js/logo-tumble.js) waits
// for the turn back to finish — see logoWordmarkBusyMs() below — so the
// name comes back first and the usual tumble plays after.
//
// With Settings > Display > Logo animation off, or reduced motion, the name
// just fades out and back and the cube doesn't turn.

(function () {
  const link = document.getElementById('siteLogoLink');
  const img  = link && link.querySelector('.site-logo-img');
  const word = link && link.querySelector('.site-logo-wordmark');
  if (!img || !word) return;

  const FACE_COLORS = ['#d7263d', '#58a6ff', '#f2f2f2']; // favicon.svg's faces

  // One span per letter, so each can fly on its own. The whole name stays
  // readable to screen readers through aria-label. Each letter carries a
  // copy of itself in its face colour, faded in over it: animating `color`
  // directly runs on the main thread and stuttered while the quiz was
  // rendering, whereas transform/opacity stay on the compositor.
  const name = word.textContent;
  word.setAttribute('aria-label', name);
  word.innerHTML = [...name]
    .map((ch, i) => '<span class="site-logo-letter" aria-hidden="true">' + ch +
      '<span class="site-logo-letter-tint" style="color:' + FACE_COLORS[i % 3] + '">' + ch + '</span></span>')
    .join('');
  const letters = [...word.querySelectorAll('.site-logo-letter')];
  const tints   = [...word.querySelectorAll('.site-logo-letter-tint')];

  // An attempt starts at the page's busiest moment (rendering the problems,
  // typesetting maths, entering full screen), so the absorb waits for that
  // to settle instead of starting with dropped frames.
  const SETTLE_MIN = 250, SETTLE_MAX = 900;
  const STEP = 55;        // stagger between letters
  const FLY = 460;        // one letter's flight
  const TURN = 520;       // the cube's one-third turn
  const EASE_IN  = 'cubic-bezier(.55,0,.85,.35)';
  const EASE_OUT = 'cubic-bezier(.15,.65,.35,1)';
  const TURNED = 'rotate(120deg)';

  function plainOnly() {
    const reduce = document.documentElement.classList.contains('settings-reduce-motion') ||
      (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    const off = typeof getSetting === 'function' && getSetting('display', 'showLogoTumble') === false;
    return reduce || off;
  }

  let absorbed = false;
  let busyUntil = 0;
  let pending = null;
  let settleTimer = null;
  let lastKind = null;    // 'absorb' | 'restore': which set of animations is on the elements

  // The buttons right of the logo — the 👤 personal cabinet
  // (js/cabinet-link.js) and, for signed-in editors, the 📘 Editorial link
  // (js/editor-access.js) — follow the name: while it's absorbed they slide
  // left together to sit next to the cube, and back out ahead of the
  // letters. Moved with the separate `translate` property so their own
  // hover `transform: scale()` still works.
  function logoLinks() {
    return ['cabinetLink', 'editorQuickLink']
      .map((id) => document.getElementById(id))
      .filter((el) => el && getComputedStyle(el).display !== 'none');
  }
  // How far left they move: the first one from past the name to just past
  // the cube; the rest keep their spacing behind it.
  function logoLinksShift(links) {
    return (img.getBoundingClientRect().right + 10) - links[0].getBoundingClientRect().left;
  }
  function animateLinks(links, from, to, timing) {
    links.forEach((el) => el.animate([{ translate: `${from}px 0` }, { translate: `${to}px 0` }], timing));
  }
  const LINK_EASE = 'cubic-bezier(.3,.1,.3,1)';

  function liveAnims() {
    return [...img.getAnimations(), ...word.getAnimations({ subtree: true }),
            ...logoLinks().flatMap((el) => el.getAnimations())];
  }
  // Entering and leaving a quiz in quick succession: the other direction
  // is still playing, so it's run backwards from wherever it got to rather
  // than restarted from its far end (which jumped).
  function midFlight(kind) {
    return lastKind === kind && liveAnims().some((a) => a.playState === 'running');
  }
  // How long the animations would take to play back to where they came
  // from if reversed now (they may already be running backwards).
  function reverseMs() {
    return Math.max(0, ...liveAnims().map((a) => {
      const t = Number(a.currentTime) || 0;
      return a.playbackRate >= 0 ? t : a.effect.getComputedTiming().endTime - t;
    }));
  }
  function reverseAll() {
    const ms = reverseMs();
    liveAnims().forEach((a) => a.reverse());
    return ms;
  }

  // The main menu's tumble (js/logo-tumble.js) hides this <img> behind a 3D
  // cube while it plays. An attempt started mid-tumble used to turn the
  // hidden <img>, which then reappeared already turned when the tumble
  // ended, before its own turn played: so the absorb waits for the tumble
  // to finish first.
  let tumbleWait = null;
  function afterTumble(fn) {
    if (!link.classList.contains('logo-tumbling')) { fn(); return; }
    tumbleWait = new MutationObserver(() => {
      if (link.classList.contains('logo-tumbling')) return;
      stopTumbleWait();
      requestAnimationFrame(fn);
    });
    tumbleWait.observe(link, { attributes: true, attributeFilter: ['class'] });
  }
  function stopTumbleWait() {
    if (tumbleWait) { tumbleWait.disconnect(); tumbleWait = null; }
  }

  // True from asking for the absorb until it actually starts (settling,
  // then any tumble): leaving in that window has nothing to turn back.
  let absorbPending = false;
  function afterSettle(fn) {
    clearTimeout(settleTimer);
    stopTumbleWait();
    absorbPending = true;
    const run = () => { if (!absorbPending) return; absorbPending = false; fn(); };
    settleTimer = setTimeout(() => {
      settleTimer = null;
      const go = () => requestAnimationFrame(() => afterTumble(run));
      if (window.requestIdleCallback) requestIdleCallback(go, { timeout: SETTLE_MAX - SETTLE_MIN });
      else go();
    }, SETTLE_MIN);
  }

  function cancelAll() {
    clearTimeout(settleTimer);
    settleTimer = null;
    stopTumbleWait();
    absorbPending = false;
    liveAnims().forEach((a) => a.cancel());
  }

  // Each letter's distance to the cube's centre, measured at rest.
  function offsets() {
    const c = img.getBoundingClientRect();
    const cx = c.left + c.width / 2, cy = c.top + c.height / 2;
    return letters.map((l) => {
      const r = l.getBoundingClientRect();
      return { dx: cx - (r.left + r.width / 2), dy: cy - (r.top + r.height / 2) };
    });
  }

  function absorb() {
    if (midFlight('restore')) { lastKind = 'absorb'; reverseAll(); return; }
    cancelAll();
    lastKind = 'absorb';
    const links = logoLinks();
    const shift = links.length ? logoLinksShift(links) : 0;
    if (plainOnly()) {
      word.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 250, fill: 'forwards' });
      animateLinks(links, 0, shift, { duration: 0, fill: 'forwards' });
      return;
    }
    const offs = offsets();
    letters.forEach((l, i) => {
      const { dx, dy } = offs[i];
      const timing = { duration: FLY, delay: i * STEP, easing: EASE_IN, fill: 'both' };
      l.animate([
        { transform: 'none', opacity: 1 },
        { transform: `translate(${dx * .55}px, ${dy * .55}px) scale(.7)`, opacity: 1, offset: .55 },
        { transform: `translate(${dx}px, ${dy}px) scale(.15) rotate(-40deg)`, opacity: 0 }
      ], timing);
      tints[i].animate([{ opacity: 0 }, { opacity: 1, offset: .55 }, { opacity: 1 }], timing);
    });
    const landAt = (letters.length - 1) * STEP + FLY;
    img.animate([
      { transform: 'rotate(0deg) scale(1)' },
      { transform: 'rotate(60deg) scale(1.12)', offset: .5 },
      { transform: TURNED + ' scale(1)' }
    ], { duration: TURN, delay: Math.max(0, landAt - 80), easing: 'cubic-bezier(.3,.1,.3,1)', fill: 'forwards' });
    // Slides in once the name is gone, together with the cube's turn.
    animateLinks(links, 0, shift, { duration: TURN, delay: Math.max(0, landAt - 80), easing: LINK_EASE, fill: 'both' });
  }

  // How long restore() is about to take, without starting it: 0 if the
  // absorb never got going, the reversal's length if it's mid-flight.
  function plannedRestoreMs() {
    if (absorbPending) return 0;
    if (midFlight('absorb')) return reverseMs();
    return plainOnly() ? 250 : 200 + (letters.length - 1) * STEP + FLY;
  }

  // Returns how long it takes.
  function restore() {
    // Left before the absorb even started (it waits for the page to settle).
    if (absorbPending) { cancelAll(); return 0; }
    if (midFlight('absorb')) { lastKind = 'restore'; return reverseAll(); }
    const ms = plannedRestoreMs();
    cancelAll();
    lastKind = 'restore';
    // Measured at rest (cancelAll put them back): where they were slid to.
    const links = logoLinks();
    const shift = links.length ? logoLinksShift(links) : 0;
    // fill 'both' everywhere below: the end state matches the resting look
    // anyway, and it lets an absorb reverse these mid-flight without a snap.
    if (plainOnly()) {
      word.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 250, fill: 'both' });
      return ms;
    }
    // Out of the way first, before the letters reach its spot.
    animateLinks(links, shift, 0, { duration: 360, easing: LINK_EASE, fill: 'both' });
    img.animate([
      { transform: TURNED + ' scale(1)' },
      { transform: 'rotate(60deg) scale(1.12)', offset: .5 },
      { transform: 'rotate(0deg) scale(1)' }
    ], { duration: TURN, easing: 'cubic-bezier(.3,.1,.3,1)', fill: 'both' });
    // The letters start coming out while the cube is still turning back.
    const offs = offsets();
    letters.forEach((l, i) => {
      const { dx, dy } = offs[i];
      const timing = { duration: FLY, delay: 200 + i * STEP, easing: EASE_OUT, fill: 'both' };
      l.animate([
        { transform: `translate(${dx}px, ${dy}px) scale(.15) rotate(-40deg)`, opacity: 0 },
        { transform: `translate(${dx * .55}px, ${dy * .55}px) scale(.7)`, opacity: 1, offset: .45 },
        { transform: 'none', opacity: 1 }
      ], timing);
      tints[i].animate([{ opacity: 1 }, { opacity: 1, offset: .45 }, { opacity: 0 }], timing);
    });
    return ms;
  }

  function apply() {
    const want = pending;
    pending = null;
    if (want === absorbed) { if (want) busyUntil = 0; return; }
    absorbed = want;
    // A restore still playing keeps going while the absorb waits to settle;
    // absorb() then reverses it from wherever it got to.
    if (want) { busyUntil = 0; afterSettle(absorb); }
    else { busyUntil = Date.now() + restore(); }
  }

  window.addEventListener('quiztimer:activechange', (e) => {
    const active = !!(e.detail && e.detail.active);
    // Set right away, not in apply(): going home fires this just before
    // the main menu un-hides, and logo-tumble.js checks it in the same tick.
    if (!active && absorbed) busyUntil = Date.now() + plannedRestoreMs();
    if (pending === null) queueMicrotask(apply);
    pending = active;
  });

  // How long until the turn back is done (0 when nothing is playing).
  window.logoWordmarkBusyMs = () => Math.max(0, busyUntil - Date.now());
})();
