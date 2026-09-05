/* ═══════════════════════════════════════════════════════════════════
   splash.js · Minecraft-style main-menu splash text
   ───────────────────────────────────────────────────────────────────
   Data lives in course/splashes.json as [text, condition, mandatory]
   tuples (mandatory is optional, defaults to 0/false).

   condition is "" (always eligible) or a short code checked against
   COND_ACTIVE below. Add a new condition by adding one entry there —
   no changes needed anywhere else.

     ""  always            "M" morning (5–11)   "D" day (11–17)
     "N" night (21–5)      "E" evening (17–21)  "P" pi-time near
     date-specific holiday/anniversary codes (NY, XMAS, WD, ... see
     COND_ACTIVE below) are only active on their specific day(s).

   mandatory: 1 means "make sure this is shown at least once today,
   the very first time the splash badge is shown" (used for the
   date-specific holiday/anniversary lines — a New Year's splash is
   pointless if it never wins the random draw). This is tracked in
   localStorage so it survives across page loads within the same day
   and only fires once per day per splash.

   showNewSplash() is called on first load and is also exposed on
   window so quiz-engine.js / stats.js can call it any other time the
   landing screen is (re)shown (back button, closing stats, etc.).
   ─────────────────────────────────────────────────────────────────── */

(function () {
  'use strict';

  let splashes = null;   // [[text, cond, mandatory?], ...] once loaded

  function hour () { return new Date().getHours(); }

  function isPiNear () {
    const now = new Date();
    const h = now.getHours(), m = now.getMinutes();
    const nearClock = ((h === 2 || h === 14) && m >= 44) || ((h === 3 || h === 15) && m <= 14);
    const nearDay   = now.getMonth() + 1 === 3 && now.getDate() >= 7 && now.getDate() <= 14;
    return nearClock || nearDay;
  }

  function isTimeNear (hour, minute, toleranceMin = 2) {
  const n = new Date();
  const targetMinutes = hour * 60 + minute;
  const nowMinutes = n.getHours() * 60 + n.getMinutes();
  return Math.abs(nowMinutes - targetMinutes) <= toleranceMin;
  }

  // Date-specific helpers for the holiday/anniversary splash codes.
  function isDate (month, day) {
    const n = new Date();
    return n.getMonth() + 1 === month && n.getDate() === day;
  }
  function isDateRange (month, dayStart, dayEnd) {
    const n = new Date();
    return n.getMonth() + 1 === month && n.getDate() >= dayStart && n.getDate() <= dayEnd;
  }

  // Special condition codes → is it active right now?
  const COND_ACTIVE = {
    M: () => hour() >= 6  && hour() < 12,
    D: () => hour() >= 12 && hour() < 17,
    E: () => hour() >= 17 && hour() < 22,
    N: () => hour() >= 22 || hour() < 6,
    P: isPiNear,

    GS: () => isTimeNear(20, 31),   // fires ~20:29–20:33
    PM: () => isTimeNear(3, 14),   // fires ~20:29–20:33

    // ── Kazakhstan / general holidays ──────────────────────────────
    NY:          () => isDateRange(1, 1, 2),   // New Year
    XMAS:        () => isDate(1, 7),           // Orthodox Christmas
    WD:          () => isDate(3, 8),           // International Women's Day
    NAURYZ:      () => isDateRange(3, 21, 23), // Nauryz
    UNITY:       () => isDate(5, 1),           // Kazakhstan People's Unity Day
    MENSDAY:     () => isDate(5, 7),           // Defender of the Fatherland Day
    VICTORY:     () => isDate(5, 9),           // Victory Day
    ASTANADAY:   () => isDate(7, 6),           // Astana Day
    REPUBLICDAY: () => isDate(10, 25),         // Republic Day
    INDEPDAY:    () => isDate(12, 16),         // Independence Day

    // ── Science / history anniversaries ────────────────────────────
    MAC84:          () => isDate(1, 24),  // First Macintosh, 1984
    DARWIN:         () => isDate(2, 12),  // Darwin's birthday
    EINSTEINBDAY:   () => isDate(3, 14),  // Einstein's birthday (also Pi Day)
    GAGARIN:        () => isDate(4, 12),  // First human in space, 1961
    BLACKHOLE:      () => isDate(4, 10),  // First black hole image, 2019
    HUBBLE:         () => isDate(4, 24),  // Hubble launch, 1990
    DNA:            () => isDate(4, 25),  // DNA double-helix published, 1953
    SI1875:         () => isDate(5, 20),  // Metre Convention signed, 1875
    MOONLANDING:    () => isDate(7, 20),  // Apollo 11 Moon landing, 1969
    HIROSHIMA:      () => isDate(8, 6),   // Atomic bomb first used in war, 1945
    GRAVWAVES:      () => isDate(9, 14),  // Gravitational waves detected, 2015
    EMC2:           () => isDate(9, 27),  // Einstein publishes E = mc², 1905
    SPUTNIK:        () => isDate(10, 4),  // Sputnik 1 launch, 1957
    ARPANET:        () => isDate(10, 29), // First ARPANET message, 1969
    CHAINREACTION:  () => isDate(12, 2),  // First controlled nuclear chain reaction, 1942
    WRIGHTFLIGHT:   () => isDate(12, 17), // Wright brothers' first flight, 1903
    JWST:           () => isDate(12, 25), // James Webb Space Telescope launch, 2021
  };

  function eligible () {
    return splashes.filter(([, cond]) => !cond || (COND_ACTIVE[cond] && COND_ACTIVE[cond]()));
  }

  /* ── No-repeat picker (rolling window) ────────────────────────────
     A plain Math.random() pick can (and with >100 items, still
     visibly does) show the same splash again soon, especially across
     page reloads where nothing remembers what was just shown. Instead
     we keep the last N shown in sessionStorage and simply avoid those
     — a rolling window rather than "cycle through everything before
     any repeat", so with a big pool you'll never notice a repeat, and
     with a small (e.g. filtered/time-of-day) pool it still gracefully
     falls back once the window is bigger than the pool itself. */
  const SEEN_KEY  = STORAGE_PREFIX + '_splash_seen';
  const SEEN_MAX  = 15;

  function loadSeen () {
    try { return JSON.parse(sessionStorage.getItem(SEEN_KEY)) || []; }
    catch (e) { return []; }
  }
  function saveSeen (seen) {
    try { sessionStorage.setItem(SEEN_KEY, JSON.stringify(seen)); }
    catch (e) { /* private browsing etc. — fine, just won't persist */ }
  }
  function rememberShown (text) {
    let seen = loadSeen();
    seen.push(text);
    if (seen.length > SEEN_MAX) seen = seen.slice(seen.length - SEEN_MAX);
    saveSeen(seen);
  }

  /* ── Mandatory "at least once today" holiday splashes ─────────────
     Tracked in localStorage (so it survives across sessions, not just
     the tab) keyed to today's date. Once a mandatory splash has fired
     today it's crossed off and normal random picking takes over. */
  const MANDATORY_KEY = STORAGE_PREFIX + '_splash_mandatory_shown';

  function todayStr () {
    const d = new Date();
    return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate();
  }
  function loadMandatoryShownToday () {
    try {
      const raw = JSON.parse(localStorage.getItem(MANDATORY_KEY));
      if (raw && raw.date === todayStr() && Array.isArray(raw.conds)) return raw.conds;
      return [];
    } catch (e) { return []; }
  }
  function saveMandatoryShownToday (conds) {
    try { localStorage.setItem(MANDATORY_KEY, JSON.stringify({ date: todayStr(), conds })); }
    catch (e) { /* private browsing etc. */ }
  }

  function pickDueMandatory (pool) {
    const shownToday = loadMandatoryShownToday();
    const due = pool.filter(([, cond, mandatory]) => mandatory && cond && !shownToday.includes(cond));
    if (!due.length) return null;
    const choice = due[(Math.random() * due.length) | 0];
    saveMandatoryShownToday(shownToday.concat([choice[1]]));
    return choice[0];
  }

  function pick () {
    if (!splashes) return null; // init() hasn't resolved yet — extremely unlikely by the
                                 // time anything can call this, but guards eligible()'s
                                 // .filter() against a null splashes either way.
    const pool = eligible();
    if (!pool.length) return null;

    // A due holiday/anniversary splash always wins the first draw of
    // the day it's active, regardless of the no-repeat window below.
    const mandatoryChoice = pickDueMandatory(pool);
    if (mandatoryChoice) {
      rememberShown(mandatoryChoice);
      return mandatoryChoice;
    }

    if (pool.length === 1) return pool[0][0];

    const seen = loadSeen();
    let candidates = pool.filter(([text]) => !seen.includes(text));
    if (!candidates.length) candidates = pool; // window bigger than pool — just pick freely

    const choice = candidates[(Math.random() * candidates.length) | 0][0];
    rememberShown(choice);
    return choice;
  }

  /* ── Easter egg: "Maxwell's Demon" (~1-in-100) ──────────────────────
     A rare alternate state for the landing avatar + splash badge, rolled
     and shown together as one matched pair rather than as two independent
     rolls — this rolls once, here, and drives both. While active, the
     landing avatar (index.html #landingIdentityBtn, normally hidden
     entirely with nobody signed in — see renderLandingIdentity in
     js/forum.js) is forced to show a "Maxwell's Demon" identicon
     regardless of sign-in state, and tapping it does what tapping the
     splash badge does (pick a new splash / restore the avatar) instead of
     its usual "open Stats" action — see handleLandingIdentityClick below,
     wired as that button's onclick in index.html. Ends the moment either
     one is tapped, same as any other splash change. */
  const DEMON_NAME    = "Maxwell's Demon";
  const DEMON_SPLASH   = 'How many molecules do I have to sort before this stops being a statistical fluctuation and starts being my fault?';
  const DEMON_CHANCE  = 1 / 100;
  const DEMON_FLY_MS  = 550; // keep in sync with .demon-flying's transition duration in css/style.css
  let demonActive = false;

  function enterDemonMode () {
    const btn      = document.getElementById('landingIdentityBtn');
    const avatarEl = document.getElementById('landingIdentityAvatar');
    const splashEl = document.getElementById('splashText');
    if (!btn || !avatarEl) return;
    demonActive = true;

    // Reset to the neutral resting transform with transitions off first, so
    // the flight below always starts from the same known point instead of
    // animating from wherever a previous flight/exit left it mid-motion.
    btn.classList.add('demon-flying');
    btn.style.transition = 'none';
    btn.style.transform = 'translate(0px, 0px) rotate(-14deg) scale(1)';
    btn.style.display = '';
    btn.title = DEMON_NAME;
    void btn.offsetWidth; // force the reset above to apply before re-enabling transitions
    btn.style.transition = '';

    avatarEl.innerHTML = '';
    if (typeof forumResolveAvatarEl === 'function') {
      // Same live DiceBear lookup (with its own cache/initials fallback
      // chain) every other avatar in the app uses — "Maxwell's Demon" is
      // just a seed string to it, nothing special needs generating.
      forumResolveAvatarEl(DEMON_NAME).then(avatarChild => {
        // A tap, or losing the 1-in-100 draw again on the very next splash,
        // may have already exited demon mode by the time this async fetch
        // resolves — don't stomp whatever's showing now.
        if (!demonActive) return;
        avatarEl.innerHTML = '';
        avatarEl.appendChild(avatarChild);
      });
    }

    // Fly over to sit right beside the splash badge — computed from the
    // two elements' actual on-screen positions (rather than a fixed CSS
    // offset) so it lands correctly regardless of viewport width or how
    // long the splash text itself is.
    requestAnimationFrame(() => {
      if (!demonActive) return;
      const btnRect = btn.getBoundingClientRect();
      let dx = 0, dy = 0;
      if (splashEl) {
        const splashRect = splashEl.getBoundingClientRect();
        dx = (splashRect.left - 6) - btnRect.right;
        dy = (splashRect.top + splashRect.height / 2) - (btnRect.top + btnRect.height / 2);
      }
      btn.style.transform = `translate(${dx}px, ${dy}px) rotate(10deg) scale(0.85)`;
    });
  }

  function exitDemonModeIfActive () {
    if (!demonActive) return;
    demonActive = false;
    const btn = document.getElementById('landingIdentityBtn');
    if (btn) {
      btn.style.transform = 'translate(0px, 0px) rotate(-14deg) scale(1)';
    }
    // Let the fly-back-away animation actually play before handing the
    // avatar back to its normal state (a real signed-in identity, or
    // hidden entirely) — same function every real identity change already
    // calls. Re-checks demonActive first: a re-roll on the very next
    // splash may have re-entered demon mode before this fires, in which
    // case that new flight owns the element now and this must not touch it.
    setTimeout(() => {
      if (demonActive) return;
      if (btn) {
        btn.classList.remove('demon-flying');
        btn.style.transition = '';
        btn.style.transform = '';
      }
      if (typeof renderLandingIdentity === 'function' && typeof getForumNickname === 'function') {
        renderLandingIdentity(getForumNickname());
      }
    }, DEMON_FLY_MS);
  }

  // Wired as #landingIdentityBtn's onclick in index.html (replacing a
  // plain openStatsScreen() call) so the SAME button can serve both its
  // normal job and the demon-mode one without two competing handlers on
  // one element.
  function handleLandingIdentityClick () {
    if (demonActive) {
      showNewSplash();
    } else if (typeof openStatsScreen === 'function') {
      openStatsScreen();
    }
  }

  function showNewSplash () {
    const el = document.getElementById('splashText');
    if (!el || !splashes) return;

    exitDemonModeIfActive();

    let text;
    if (Math.random() < DEMON_CHANCE) {
      text = DEMON_SPLASH;
      enterDemonMode();
    } else {
      text = pick();
    }
    if (!text) return;

    el.textContent = text;
    // Restart the bounce animation from scratch each time.
    el.style.animation = 'none';
    void el.offsetWidth; // force reflow
    el.style.animation = '';
  }

  // Shown instead of nothing if splashes.json can't be fetched — most
  // commonly because the page is opened as a local file:// path rather
  // than served over http(s), which blocks fetch(). Keeps the badge
  // visible (and its position/animation checkable) during local work.
  const FALLBACK_SPLASHES = [['Welcome!', '']];

  async function init () {
    try {
      const res = await fetch('course/splashes.json', { cache: 'force-cache' });
      if (!res.ok) throw new Error('bad response');
      const data = await res.json();
      splashes = (Array.isArray(data) && data.length) ? data : FALLBACK_SPLASHES;
    } catch (e) {
      splashes = FALLBACK_SPLASHES;
    }
    showNewSplash();
  }

  window.showNewSplash = showNewSplash;
  // Exposed so index.html's #landingIdentityBtn can route through demon
  // mode (see above) without index.html needing to know demonActive exists.
  window.handleLandingIdentityClick = handleLandingIdentityClick;
  // Exposed read-only so renderLandingIdentity (js/forum.js) can bail out
  // instead of clobbering the demon avatar if some unrelated identity
  // refresh (a background poll, a claim success elsewhere) fires while
  // demon mode happens to be showing.
  window.isLandingDemonActive = () => demonActive;
  // Exposed read-only so other screens can borrow the exact same pool/
  // no-repeat picker without touching the real #splashText element — see
  // manualSplashDemoRender() in js/manual.js, the manual's "About the
  // project" splash demo.
  window.pickSplashText = pick;
  document.addEventListener('DOMContentLoaded', init);
})();
