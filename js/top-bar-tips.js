/* ═══════════════════════════════════════════════════════════════════
   top-bar-tips.js · Rotating one-line tips in the top bar
   ───────────────────────────────────────────────────────────────────
   Data lives in js/data/tips.js as window.TOP_BAR_TIPS = [string, ...],
   shown in random order (never the same tip twice in a row) — see
   nextTip() below. Add more tips there — nothing here needs to change.

   Width: the tip always fills the real open gap between the logo and the
   icon row (getSafeBounds() below — logo's right edge to the icon row's
   left edge, minus SAFE_GAP_PX of breathing room on each side), so it
   uses all the space that's actually free rather than being capped to
   whatever content column happens to render underneath it. SCREEN_WIDTH_REFS
   / INVERTED_SCREENS still map each top-level screen to a `ref` element,
   but only to confirm that screen has actually finished rendering
   (isTipEligible()'s mid-transition guard) — the element's own width is no
   longer read. Manual and Settings have no entry on purpose — see
   HIDDEN_ON_SCREENS below, which blocks the tip outright there. Resolved
   fresh every time a tip is about to show, and re-resolved on window
   resize or whenever any tracked screen's own .visible/.hidden class flips
   while a tip is already up, so it tracks a screen change or a window
   resize mid-tip instead of going stale.

   The tip is positioned at the midpoint of that logo↔icons gap (not the
   viewport's own midpoint — the logo and icon row are different widths,
   so those two points aren't the same) so it can use the gap's full width
   rather than being capped by its narrower half, which is what a
   viewport-centered assumption did before. If the safe width comes out
   non-positive (window too narrow to fit anything safely), the tip just
   doesn't show that cycle rather than rendering squished or overlapping.

   Shown only when:
     - the viewport isn't mobile-sized (no safe gap to put it in there —
       see the CSS media query in css/style.css),
     - the current screen isn't Manual or Settings, and
     - the top bar is currently in its --surface ("scrolled") state, the
       same moment .top-bar-backdrop itself goes opaque — a tip never
       floats over bare page background.
   js/top-bar-scroll.js dispatches a 'topbar:scrollstate' event on every
   --bg/--surface flip; that's the single source of truth this file
   reacts to, rather than polling body's class list.

   Every TRIGGER_INTERVAL_MS a new tip attempts to show (current value is
   short for debugging — will become a configurable/toggleable interval
   in Settings, see the second built-in tip). Once up, a tip stays for
   VISIBLE_MS and is then faded out — except if the bar drops back out of
   its --surface state, or the active screen becomes ineligible (Manual/
   Settings open, or its width reference collapses), in which case it
   fades out immediately instead of waiting.

   Short tips that fit the available width just sit centered in the box.
   Long tips that don't fit hold at the left edge, then scroll left at a
   constant speed until they've moved completely past it (nothing left
   showing) — never reversing back into view — then snap back to the
   start instantly and hold again. Old ticker-display style, not a
   back-and-forth marquee.
   ─────────────────────────────────────────────────────────────────── */

(function () {
  'use strict';

  const TRIGGER_INTERVAL_MS = 108000000; // how often a tip attempts to show — debug value
  const VISIBLE_MS          = 15000;  // how long a shown tip stays up before auto-fading
  const HOLD_MS             = 2000;  // pause at the start of a long tip before it scrolls
  const SCROLL_SPEED_PX_S   = 55;    // marquee speed once a tip overflows its box
  const MOBILE_QUERY        = '(max-width: 480px)';

  // Screen id → CSS selector (relative to that screen) for an element
  // that only exists once that screen has actually finished rendering —
  // used solely as an eligibility check (see isTipEligible()), not to
  // size the tip. Checked in this order; first matching *visible* screen
  // wins.
  const SCREEN_WIDTH_REFS = [
    { screen: 'statsScreen',   ref: '.stats-wrap' },
    { screen: 'reviewScreen',  ref: '.review-wrap' },
    { screen: 'forumScreen',   ref: '.forum-wrap' },
    { screen: 'appPage',       ref: '#quizContainer' },
  ];
  // Screens whose base state is "visible unless .hidden" rather than
  // "hidden unless .visible" (landing + the solve-all choice page).
  const INVERTED_SCREENS = [
    { screen: 'choicePage',    ref: '.landing-box' },
    { screen: 'landingScreen', ref: '.landing-box' },
  ];
  // Tip never shows while either of these is the active screen.
  const HIDDEN_ON_SCREENS = ['manualScreen', 'settingsScreen'];

  let tipEl = null, textEl = null;
  let tipIndex = -1;
  let barScrolled = false;
  let tipVisible = false;
  let triggerTimer = null;
  let hideTimer = null;
  let rafId = null;
  let screenObserver = null;

  function isMobile() {
    return window.matchMedia(MOBILE_QUERY).matches;
  }

  function isVisible(id) {
    const el = document.getElementById(id);
    return !!el && el.classList.contains('visible');
  }

  function isShown(id) {
    const el = document.getElementById(id);
    return !!el && !el.classList.contains('hidden');
  }

  // Widest the tip can be, and where its center should sit, while staying
  // clear of the logo/icons — see getSafeBounds below.
  const SAFE_GAP_PX = 20; // breathing room kept clear of the logo/icons

  // Used to previously assume the tip had to stay centered on the exact
  // viewport midpoint (CSS left:50%/translateX(-50%)) and sized itself to
  // 2 * the SHORTER of the two half-gaps around that midpoint. That's overly
  // conservative whenever the logo and the icon row aren't the same width —
  // which they never are (the icon row carries several icons, the logo is
  // just the mark) — because the doubling wastes whatever spare room sits on
  // the wider side. At ordinary desktop widths that shrank the "safe" width
  // to well under any screen's real content column, so every screen ended up
  // clamped to the same small constant regardless of its own width — the
  // "still looks like a constant width" bug.
  //
  // Fixed by not requiring the tip to sit on the viewport's midpoint at all:
  // it only needs to stay centered within the actual open gap between the
  // logo and the icons, which lets it use the full gap (minus the safety
  // margin on each side) instead of twice its narrower half. showTip/
  // refreshWhileVisible position the tip at `center` (inline `left`) rather
  // than relying on the CSS default, so this only ever narrows the visible
  // gap, never shifts content outside it.
  function getSafeBounds() {
    const logo = document.getElementById('siteLogoLink');
    const icons = document.querySelector('.theme-toggle-wrap');
    if (!logo || !icons) return null;
    const logoRight = logo.getBoundingClientRect().right;
    const iconsLeft = icons.getBoundingClientRect().left;
    const maxWidth = iconsLeft - logoRight - 2 * SAFE_GAP_PX;
    const center = (logoRight + iconsLeft) / 2;
    return { maxWidth, center };
  }

  // Whether a tip is eligible to show at all right now — Manual/Settings
  // open, or no known screen active/rendered, both make it ineligible.
  // SCREEN_WIDTH_REFS/INVERTED_SCREENS still name a `ref` element per
  // screen here, but only to confirm that screen has actually finished
  // rendering (mid-transition guard) — its width is no longer read. The
  // tip's own width always comes from getSafeBounds() below, so it fills
  // the real open gap next to the logo/icons rather than being capped to
  // whatever content column happens to sit under it.
  function isTipEligible() {
    if (HIDDEN_ON_SCREENS.some(isVisible)) return false;
    for (const { screen, ref } of SCREEN_WIDTH_REFS) {
      if (isVisible(screen)) {
        return !!document.querySelector('#' + screen + ' ' + ref);
      }
    }
    for (const { screen, ref } of INVERTED_SCREENS) {
      if (isShown(screen)) {
        return !!document.querySelector('#' + screen + ' ' + ref);
      }
    }
    return false;
  }

  // Current width (px) for the tip, or null if nothing eligible is
  // showing right now, or there's no room to show it without overlapping
  // the logo/icons. `bounds` is the getSafeBounds() result the caller
  // already fetched (it also needs `center` to position the tip, so it's
  // computed once and passed in rather than resolveWidthPx calling it
  // again itself).
  function resolveWidthPx(bounds) {
    if (!isTipEligible()) return null;
    if (bounds === null) return null;
    return bounds.maxWidth > 0 ? bounds.maxWidth : null; // no room at all — don't show a squished tip
  }

  // Picks a random tip, never repeating the one just shown back-to-back
  // (only matters once there are 2+ tips — with exactly one, it's the only
  // option every time). tipIndex here just tracks "last shown", not a
  // rotation cursor.
  function nextTip() {
    const tips = window.TOP_BAR_TIPS;
    if (!Array.isArray(tips) || tips.length === 0) return null;
    if (tips.length === 1) { tipIndex = 0; return tips[0]; }
    let next;
    do {
      next = Math.floor(Math.random() * tips.length);
    } while (next === tipIndex);
    tipIndex = next;
    return tips[tipIndex];
  }

  function stopMarquee() {
    if (rafId !== null) { cancelAnimationFrame(rafId); rafId = null; }
  }

  // Measures the just-rendered tip text and either centers it in place
  // (fits) or drives the hold/scroll/snap-back loop described up top
  // (overflows). justify-content is toggled to match: centered text needs
  // the box centering it, but the scrolling case needs the text pinned to
  // the box's left edge (justify-content: center there would just shift
  // the whole hold/scroll/snap animation sideways instead of letting it
  // start flush left).
  function runMarquee() {
    stopMarquee();
    if (!tipVisible) return;
    const boxW = tipEl.clientWidth;
    const textW = textEl.scrollWidth;
    textEl.style.transform = 'translateX(0)';
    if (textW <= boxW) {
      tipEl.style.justifyContent = 'center';
      return; // fits — no scrolling needed
    }
    tipEl.style.justifyContent = 'flex-start';

    let phase = 'hold';
    let phaseStart = performance.now();

    function step(now) {
      if (!tipVisible) { rafId = null; return; }
      const elapsed = now - phaseStart;
      if (phase === 'hold') {
        if (elapsed >= HOLD_MS) { phase = 'scroll'; phaseStart = now; }
      } else {
        const dist = (elapsed / 1000) * SCROLL_SPEED_PX_S;
        if (dist >= textW) {
          // Fully past the left edge — jump back to the start instantly
          // (no reverse animation) and hold again, ticker-style.
          textEl.style.transform = 'translateX(0)';
          phase = 'hold';
          phaseStart = now;
        } else {
          textEl.style.transform = `translateX(${-dist}px)`;
        }
      }
      rafId = requestAnimationFrame(step);
    }
    rafId = requestAnimationFrame(step);
  }

  function showTip() {
    if (!tipEl || isMobile() || !barScrolled) return;
    // Settings > Display > "Show running line" — off means never trigger a
    // tip at all, not just hide it visually via CSS (see
    // html.settings-hide-top-bar-tip in css/settings.css, which still
    // covers the case this setting is toggled off while a tip happens to
    // already be showing).
    if (typeof getSetting === 'function' && getSetting('display', 'showTopBarTip') === false) return;
    const bounds = getSafeBounds();
    const width = resolveWidthPx(bounds);
    if (width === null) return; // nothing eligible showing right now
    const tip = nextTip();
    if (!tip) return;
    tipEl.style.width = width + 'px';
    if (bounds !== null) tipEl.style.left = bounds.center + 'px';
    textEl.textContent = tip;
    tipVisible = true;
    tipEl.classList.add('visible');
    // Tells js/top-bar-quiz-status.js (if that file is active right now)
    // to fade its clock/battery out for as long as this tip is up — the
    // two share the same top-bar gap and are never meant to overlap. This
    // file has no reference to that one and doesn't need it; a plain
    // window event keeps them decoupled.
    window.dispatchEvent(new CustomEvent('topbartip:show'));
    // Wait a frame so layout has settled before measuring scrollWidth.
    requestAnimationFrame(() => requestAnimationFrame(runMarquee));
    clearTimeout(hideTimer);
    hideTimer = setTimeout(hideTip, VISIBLE_MS);
  }

  function hideTip() {
    tipVisible = false;
    if (tipEl) tipEl.classList.remove('visible');
    stopMarquee();
    clearTimeout(hideTimer);
    hideTimer = null;
    // Counterpart to the 'topbartip:show' dispatch in showTip() — lets the
    // clock/battery fade back in now that the gap is free again.
    window.dispatchEvent(new CustomEvent('topbartip:hide'));
  }

  // Called on resize and on any tracked screen's class flip while a tip
  // is already up — either it's no longer eligible (fade out now) or its
  // reference width just changed (follow it live).
  function refreshWhileVisible() {
    if (!tipVisible) return;
    const bounds = getSafeBounds();
    const width = resolveWidthPx(bounds);
    if (width === null || isMobile() || !barScrolled) { hideTip(); return; }
    tipEl.style.width = width + 'px';
    if (bounds !== null) tipEl.style.left = bounds.center + 'px';
    runMarquee();
  }

  function scheduleNextTrigger() {
    clearTimeout(triggerTimer);
    triggerTimer = setTimeout(function () {
      showTip();
      scheduleNextTrigger();
    }, TRIGGER_INTERVAL_MS);
  }

  window.addEventListener('topbar:scrollstate', function (e) {
    barScrolled = !!(e.detail && e.detail.scrolled);
    // Bar just left --surface (scrolled back up to --bg) mid-tip: fade
    // out right away instead of waiting for the usual VISIBLE_MS timer.
    if (!barScrolled && tipVisible) hideTip();
  });

  window.addEventListener('resize', refreshWhileVisible);

  function initTopBarTips() {
    tipEl = document.getElementById('topBarTip');
    textEl = document.getElementById('topBarTipText');
    if (!tipEl || !textEl) return;
    barScrolled = document.body.classList.contains('is-scrolled');

    // Watches every screen this file cares about for its own show/hide
    // class flipping, so a tip already on screen reacts immediately to a
    // navigation (e.g. opening Settings, or Stats swapping in) instead of
    // waiting for the next resize or trigger tick.
    const watchedIds = SCREEN_WIDTH_REFS.map(function (s) { return s.screen; })
      .concat(INVERTED_SCREENS.map(function (s) { return s.screen; }))
      .concat(HIDDEN_ON_SCREENS);
    screenObserver = new MutationObserver(refreshWhileVisible);
    watchedIds.forEach(function (id) {
      const el = document.getElementById(id);
      if (el) screenObserver.observe(el, { attributes: true, attributeFilter: ['class'] });
    });

    scheduleNextTrigger();
  }

  // This file is now loaded by index.html's tier-2 loader, which can run
  // after DOMContentLoaded has already fired — a bare 'DOMContentLoaded'
  // listener added at that point would never fire, so fall back to an
  // immediate call when the DOM is already past 'loading'.
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initTopBarTips);
  } else {
    initTopBarTips();
  }
})();
