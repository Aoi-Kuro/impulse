// ── Site logo tumble ─────────────────────────────────────────────────────────
// The cube in the top-left logo jumps and tumbles (a full turn around two
// axes at once, with a squash on take-off and landing) whenever the main
// menu appears:
//   - coming back to it from any screen (Stats, a quiz, Solve all, Forum,
//     Settings, …) — watched through #landingScreen's "hidden" class, the
//     same signal forum.js's initForumPollingWatcher uses, so every route
//     home is covered without touching each close function;
//   - tapping the logo while already on it;
//   - once after a page load, but only when everything has finished
//     loading (the page's own files, the tier-2 scripts in index.html and
//     the fonts), so it doubles as a "the site is ready" signal.
//
// The animation is a real 3D cube made of six faces (css/style.css, "Site
// logo tumble"), laid over the <img> and shown only while it plays; at rest
// it is pixel-for-pixel the same isometric view as favicon.svg, so the swap
// back to the <img> is invisible. Skipped when Settings > Display > Reduce
// motion is on (html.settings-reduce-motion) or the device asks for reduced
// motion.

(function () {
  const link    = document.getElementById('siteLogoLink');
  const landing = document.getElementById('landingScreen');
  if (!link || !landing) return;

  // Opposite faces share a color: red top/bottom, white left/right, blue
  // front/back — the same three colors as favicon.svg.
  const cube = document.createElement('span');
  cube.className = 'logo-cube';
  cube.setAttribute('aria-hidden', 'true');
  cube.innerHTML =
    '<span class="logo-cube-tilt"><span class="logo-cube-spin">' +
    ['front', 'back', 'right', 'left', 'top', 'bottom']
      .map((f) => '<i class="logo-cube-face logo-cube-' + f + '"></i>').join('') +
    '</span></span>';
  link.appendChild(cube);

  function reducedMotion() {
    return document.documentElement.classList.contains('settings-reduce-motion') ||
      (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  }

  function landingShown() {
    return !landing.classList.contains('hidden') &&
      getComputedStyle(landing).visibility !== 'hidden';
  }

  function playLogoTumble() {
    if (reducedMotion()) return;
    // Restart from the first frame if it's already mid-tumble.
    link.classList.remove('logo-tumbling');
    void link.offsetWidth;
    link.classList.add('logo-tumbling');
  }
  // The jump (on .logo-cube itself) and the turn last equally long, so the
  // jump ending is the whole animation ending.
  cube.addEventListener('animationend', (e) => {
    if (e.target === cube) link.classList.remove('logo-tumbling');
  });
  window.playLogoTumble = playLogoTumble;

  // Coming back to the main menu from anywhere.
  let wasHidden = landing.classList.contains('hidden');
  new MutationObserver(() => {
    const hidden = landing.classList.contains('hidden');
    if (wasHidden && !hidden) playLogoTumble();
    wasHidden = hidden;
  }).observe(landing, { attributes: true, attributeFilter: ['class'] });

  // Tapping the logo while already on the main menu (from anywhere else the
  // observer above plays it once the menu is back). Runs before the inline
  // onclick's goToMainMenu() swaps screens (a capture listener fires before
  // the target's own handlers), so landingShown() still describes the
  // screen the tap came from.
  link.addEventListener('click', () => {
    if (landingShown()) playLogoTumble();
  }, true);

  // After a page load: wait for the load event (the page and everything it
  // references), the tier-2 loader's last script (index.html sets
  // window.tier2Loaded and fires 'tier2-loaded') and the fonts. A tier-2
  // script that never settles shouldn't hold the welcome back for good, so
  // that wait is capped.
  const pageLoaded = new Promise((resolve) => {
    if (document.readyState === 'complete') resolve();
    else window.addEventListener('load', resolve, { once: true });
  });
  const tier2Loaded = new Promise((resolve) => {
    if (window.tier2Loaded) return resolve();
    window.addEventListener('tier2-loaded', resolve, { once: true });
    pageLoaded.then(() => setTimeout(resolve, 15000));
  });
  const fontsLoaded = document.fonts ? document.fonts.ready.catch(() => {}) : Promise.resolve();
  Promise.all([pageLoaded, tier2Loaded, fontsLoaded]).then(() => {
    if (landingShown()) playLogoTumble();
  });
})();
