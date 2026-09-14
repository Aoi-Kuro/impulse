/* ═══════════════════════════════════════════════════════════════════
   top-bar-quiz-status.js · Live clock + battery in the top bar
   ───────────────────────────────────────────────────────────────────
   Shows the current time (HH:MM, with a `:` that blinks off/on once a
   second) and, where the Battery Status API exists, the battery level +
   charging state — in the same top-bar gap js/top-bar-tips.js uses for
   its rotating tip. Deliberately narrow about when it's allowed to show,
   all of which must hold at once:
     - a Random-N/cumulative timed attempt is actually running (the same
       `_quizTimerActive` lifecycle quiz-engine.js uses; this remains true
       even when the optional floating timer display is disabled),
     - the browser is actually fullscreen right now — whether entered by
       Settings > Study > "Full screen for Random N" or manually with F11,
       and
     - there is enough room in the logo↔icons gap and the layout is not the
       compact mobile layout.
   On top of all that, it's faded out for as long as a tip is actually
   showing (via the 'topbartip:show'/'topbartip:hide' events that file
   dispatches) so the two never overlap in the same small gap. Neither
   file imports the other — same "stay decoupled" convention
   js/solve-all-nav.js's own header comment describes for quiz-engine.js —
   plain window events are enough to coordinate the handoff.

   Positioning mirrors top-bar-tips.js's getSafeBounds(): centered on the
   actual open space between the logo and the icon row, not the
   viewport's own midpoint (those two points differ since the logo and
   icon row aren't the same width). Duplicated here rather than shared —
   both files are small and self-contained, and this one only needs the
   gap's center, not its width the way the tip does — so a shared helper
   would cost more than it saves.

   Battery Status API is Chromium-only (no Firefox/Safari support as of
   this writing) and some browsers now gate it further even where it
   exists — so the battery half only ever appears once
   navigator.getBattery() actually resolves; everywhere else this is
   just the clock, never a broken/placeholder battery icon ("if any", as
   asked for).
   ─────────────────────────────────────────────────────────────────── */

(function () {
  'use strict';

  const MOBILE_QUERY = '(max-width: 480px)';
  const MIN_GAP_PX    = 140; // below this the logo↔icons gap can't fit the widget without risking overlap

  let wrapEl, hEl, colonEl, mEl, battWrapEl, battFillEl, battPctEl, battChargingEl;
  let eligible    = false; // Random-N attempt active AND actually fullscreen right now
  let tipShowing  = false;
  let clockTimer  = null;
  let battery     = null; // BatteryManager, once/if navigator.getBattery() resolves

  function isMobile() {
    return window.matchMedia(MOBILE_QUERY).matches;
  }

  // Fullscreen can happen in two different ways:
  //   1. the Fullscreen API (document.fullscreenElement), and
  //   2. browser/OS fullscreen such as F11, which does NOT populate
  //      document.fullscreenElement.
  //
  // The indicator must follow the actual fullscreen state, not the
  // "Full screen for Random N" setting. The geometry fallback is used
  // only for browser-level fullscreen and is refreshed on resize, so
  // entering/leaving F11 updates the indicator dynamically as well.
  //
  // Do NOT require an exact innerWidth/innerHeight === screen.width/height
  // match here. Browsers are allowed to keep a small safe-area/system-UI
  // inset even in browser fullscreen, and some report that usable size via
  // screen.availWidth/availHeight instead. The old 1px-only comparison made
  // manual fullscreen look windowed on those browsers, which is why the
  // status appeared only when the Random-N setting itself called the
  // Fullscreen API (document.fullscreenElement was then available).
  function isFullscreen() {
    if (document.fullscreenElement) return true;

    const s = window.screen;
    if (!s) return false;

    const innerHeight = window.innerHeight;
    const innerWidth  = window.innerWidth;
    if (!innerHeight || !innerWidth || !s.height || !s.width) return false;

    // A few pixels of rounding are common, while safe areas / reserved UI
    // can be a few dozen pixels. Four percent is intentionally capped so a
    // normal maximized browser (which still loses much more height to its
    // tab/address bars) is not mistaken for fullscreen.
    function fillsDimension(inner, full, available) {
      const tolerance = Math.max(8, Math.min(64, Math.round(full * 0.04)));
      if (Math.abs(inner - full) <= tolerance) return true;
      return !!available && Math.abs(inner - available) <= tolerance;
    }

    return fillsDimension(innerWidth, s.width, s.availWidth)
      && fillsDimension(innerHeight, s.height, s.availHeight);
  }

  function isRandomNAttemptActive() {
    // quiz-engine.js intentionally tracks the attempt separately from the
    // floating timer's *display* setting. Use that semantic flag rather than
    // checking whether #liveQuizTimer happens to be visible, so this still
    // works when Settings > Study > "Show live timer" is turned off.
    return typeof isQuizTimerActive === 'function' && isQuizTimerActive();
  }

  function updateEligible() {
    eligible = isRandomNAttemptActive() && isFullscreen();
    refresh();
  }

  // Same calculation as top-bar-tips.js's getSafeBounds() — see that
  // file's header comment for why the gap's true center isn't the
  // viewport's own midpoint. Returns null (hide) if there isn't enough
  // room to sit there without crowding the logo/icons.
  function getGapCenter() {
    const logo  = document.getElementById('siteLogoLink');
    const icons = document.querySelector('.theme-toggle-wrap');
    if (!logo || !icons) return null;
    const logoRight = logo.getBoundingClientRect().right;
    const iconsLeft = icons.getBoundingClientRect().left;
    if (iconsLeft - logoRight < MIN_GAP_PX) return null;
    return (logoRight + iconsLeft) / 2;
  }

  // ── Clock ────────────────────────────────────────────────────────────
  function updateClock() {
    const now = new Date();
    if (hEl) hEl.textContent = String(now.getHours()).padStart(2, '0');
    if (mEl) mEl.textContent = String(now.getMinutes()).padStart(2, '0');
    // Dimmed on odd seconds, full opacity on even — a blink, not a fade,
    // so it reads as a ticking clock rather than a decorative pulse.
    if (colonEl) colonEl.classList.toggle('dim', now.getSeconds() % 2 === 1);
  }

  function startClock() {
    if (clockTimer) return;
    updateClock();
    clockTimer = setInterval(updateClock, 1000);
  }
  function stopClock() {
    if (clockTimer) { clearInterval(clockTimer); clockTimer = null; }
  }

  // ── Battery ──────────────────────────────────────────────────────────
  // Charge-level colors reuse the same three-tier language as the score
  // breakdown chips elsewhere (--correct/--partial/--wrong) rather than
  // inventing a fourth color meaning. Only applies while discharging —
  // a charging battery stays --correct regardless of level, since it's
  // headed up, not down.
  function renderBattery() {
    if (!battery || !battFillEl) return;
    const pct = Math.round(battery.level * 100);
    battFillEl.style.width = pct + '%';
    battFillEl.classList.remove('batt-low', 'batt-critical', 'batt-charging');
    if (battery.charging) {
      battFillEl.classList.add('batt-charging');
    } else if (pct <= 15) {
      battFillEl.classList.add('batt-critical');
    } else if (pct <= 30) {
      battFillEl.classList.add('batt-low');
    }
    if (battPctEl) battPctEl.textContent = pct + '%';
    if (battChargingEl) battChargingEl.classList.toggle('visible', battery.charging);
  }

  function initBattery() {
    // Not a feature-detect-and-hope: if the API isn't a function here,
    // this browser simply doesn't have it — skip straight to clock-only
    // rather than calling something that doesn't exist.
    if (typeof navigator.getBattery !== 'function') return;
    navigator.getBattery().then(function (b) {
      battery = b;
      if (wrapEl) wrapEl.classList.add('has-battery');
      renderBattery();
      battery.addEventListener('levelchange', renderBattery);
      battery.addEventListener('chargingchange', renderBattery);
    }).catch(function () { /* present but denied/unsupported this session — stay clock-only */ });
  }

  // ── Visibility: Random-N active × fullscreen × room to fit ──────────
  function refresh() {
    if (!wrapEl) return;
    const center = getGapCenter();
    // Fullscreen status is independent of scroll position. Entering/leaving
    // fullscreen can legitimately change window.scrollY, so coupling the two
    // made the widget disappear after a fullscreen round-trip even though the
    // browser was fullscreen again.
    const shouldShow = eligible && !isMobile() && center !== null;
    wrapEl.classList.toggle('visible', shouldShow);
    wrapEl.classList.toggle('tip-showing', tipShowing);
    if (shouldShow) {
      wrapEl.style.left = center + 'px';
      startClock();
    } else {
      stopClock();
    }
  }

  window.addEventListener('topbartip:show', function () { tipShowing = true; refresh(); });
  window.addEventListener('topbartip:hide', function () { tipShowing = false; refresh(); });
  // quiz-engine.js dispatches this whenever the semantic Random-N timer
  // starts/stops. That gives us an immediate mode transition even if
  // fullscreen itself does not change (for example, the user manually
  // entered F11 fullscreen and then leaves the quiz).
  window.addEventListener('quiztimer:activechange', updateEligible);
  // Resize is important here in addition to fullscreenchange:
  // browser-level fullscreen (e.g. F11) does not fire fullscreenchange,
  // but it does change the viewport dimensions.
  window.addEventListener('resize', updateEligible);
  window.addEventListener('orientationchange', updateEligible);
  document.addEventListener('visibilitychange', updateEligible);
  // Catches every way fullscreen can end/start — the Esc key, the
  // browser's own "Exit fullscreen" control, a script-driven
  // request/exitFullscreen() call (Settings > Study's own toggle), or the
  // OS taking it away (e.g. switching apps) — all fire this same event
  // regardless of cause, which is the whole point: this widget doesn't
  // care *why* fullscreen changed, only whether it's on right now.
  document.addEventListener('fullscreenchange', updateEligible);

  function initTopBarQuizStatus() {
    wrapEl     = document.getElementById('topBarQuizStatus');
    hEl        = document.getElementById('tbqsH');
    colonEl    = document.getElementById('tbqsColon');
    mEl        = document.getElementById('tbqsM');
    battWrapEl = document.getElementById('tbqsBattery');
    battFillEl = document.getElementById('tbqsBattFill');
    battPctEl  = document.getElementById('tbqsBattPct');
    battChargingEl = document.getElementById('tbqsBattCharging');
    if (!wrapEl) return;

    updateEligible();
    initBattery();
  }

  // Loaded by index.html's tier-2 runtime loader, which can run after
  // DOMContentLoaded has already fired — same fallback top-bar-tips.js
  // uses, for the same reason.
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initTopBarQuizStatus);
  } else {
    initTopBarQuizStatus();
  }
})();
