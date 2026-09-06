/* ═══════════════════════════════════════════════════════════════════
   top-bar-tips.js · Rotating one-line tips in the top bar
   ───────────────────────────────────────────────────────────────────
   Data lives in js/data/tips.js as window.TOP_BAR_TIPS = [string, ...],
   rotated through in order. Add more there — nothing here needs to
   change.

   Width: every screen in this app uses its own content column
   (main#quizContainer's 760px, .stats-wrap's 860px, .review-wrap's
   760px, .forum-wrap's clamp(720px,60vw,1080px), .landing-box's 480px,
   ...) rather than one shared value, so instead of hard-coding any one
   of those, SCREEN_WIDTH_REFS below maps each top-level screen to the
   element whose live rendered width the tip should copy. Resolved fresh
   every time a tip is about to show (getBoundingClientRect — the actual
   current box, not the CSS max-width, since padding/clamp/viewport all
   affect the real number) and re-resolved on window resize or whenever
   any of those screens' own .visible/.hidden class flips while a tip is
   already up, so it tracks a screen change mid-tip instead of going
   stale. Manual and Settings have no entry on purpose — see
   HIDDEN_ON_SCREENS below, which blocks the tip outright there.

   That matched width is then clamped by getSafeBounds() so the tip never
   grows wide enough to actually overlap the logo on the left or the
   settings/manual/palette/theme icons on the right — a screen whose
   content column is wide (Stats' 860px) on a narrow-ish desktop window
   is the case this matters for. The tip is positioned at the midpoint
   of that logo↔icons gap (not the viewport's own midpoint — the logo
   and icon row are different widths, so those two points aren't the
   same) so it can use the gap's full width rather than being capped by
   its narrower half, which is what a viewport-centered assumption did
   before. If even the clamped width comes out non-positive (window too
   narrow to fit anything safely), the tip just doesn't show that cycle
   rather than rendering squished or overlapping.

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

   Long tips: if the text doesn't fit the available width, it holds at
   its starting position, then scrolls left at a constant speed until it
   has moved completely past the left edge (nothing left showing) —
   never reversing back into view — then snaps back to the start
   instantly and holds again. Old ticker-display style, not a back-and-
   forth marquee. Short tips that already fit just sit still.
   ─────────────────────────────────────────────────────────────────── */

(function () {
  'use strict';

  const TRIGGER_INTERVAL_MS = 20000; // how often a tip attempts to show — debug value
  const VISIBLE_MS          = 6000;  // how long a shown tip stays up before auto-fading
  const HOLD_MS             = 1400;  // pause at the start of a long tip before it scrolls
  const SCROLL_SPEED_PX_S   = 55;    // marquee speed once a tip overflows its box
  const MOBILE_QUERY        = '(max-width: 480px)';

  // Screen id → CSS selector (relative to that screen) for the element
  // whose width the tip should match. Checked in this order; first
  // matching *visible* screen wins.
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

  // Current width (px) to match, or null if nothing eligible is showing
  // right now (Manual/Settings open, or no known screen is active), or
  // no room to show it without overlapping the logo/icons. `bounds` is the
  // getSafeBounds() result the caller already fetched (it also needs
  // `center` to position the tip, so it's computed once and passed in
  // rather than resolveWidthPx calling it again itself).
  function resolveWidthPx(bounds) {
    if (HIDDEN_ON_SCREENS.some(isVisible)) return null;
    let width = null;
    for (const { screen, ref } of SCREEN_WIDTH_REFS) {
      if (isVisible(screen)) {
        const el = document.querySelector('#' + screen + ' ' + ref);
        width = el ? el.getBoundingClientRect().width : null;
        break;
      }
    }
    if (width === null) {
      for (const { screen, ref } of INVERTED_SCREENS) {
        if (isShown(screen)) {
          const el = document.querySelector('#' + screen + ' ' + ref);
          width = el ? el.getBoundingClientRect().width : null;
          break;
        }
      }
    }
    if (width === null || width <= 0) return null;
    if (bounds !== null) width = Math.min(width, bounds.maxWidth);
    return width > 0 ? width : null; // no room at all — don't show a squished tip
  }

  function nextTip() {
    const tips = window.TOP_BAR_TIPS;
    if (!Array.isArray(tips) || tips.length === 0) return null;
    tipIndex = (tipIndex + 1) % tips.length;
    return tips[tipIndex];
  }

  function stopMarquee() {
    if (rafId !== null) { cancelAnimationFrame(rafId); rafId = null; }
  }

  // Measures the just-rendered tip text and either leaves it still (fits)
  // or drives the hold/scroll/snap-back loop described up top.
  function runMarquee() {
    stopMarquee();
    if (!tipVisible) return;
    const boxW = tipEl.clientWidth;
    const textW = textEl.scrollWidth;
    textEl.style.transform = 'translateX(0)';
    if (textW <= boxW) return; // fits — no scrolling needed

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

  document.addEventListener('DOMContentLoaded', function () {
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
  });
})();
