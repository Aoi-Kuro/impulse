// ── Personal cabinet button ──────────────────────────────────────────────────
// A 👤 button right of the logo, on every screen, that opens Stats. Shares
// the Editorial link's look and placement (.editor-quick-link, see
// js/editor-access.js): when both are shown the cabinet is first and the
// Editorial link sits right of it, and during a Random N attempt both slide
// in beside the cube together (js/logo-wordmark.js).
// Settings > Display > "Show personal cabinet button" hides it (CSS class
// on <html>, also set early by index.html's anti-flicker script).
//
// Stats opens from the main menu only, so from anywhere else this goes home
// first (the same full cleanup as the logo: a Random N attempt is stopped,
// full screen left) and opens Stats as soon as the menu is up. Leaving a
// started attempt asks first, through the same "Leave this attempt?" popup
// as the logo (confirmLeaveRandomQuiz in js/quiz-engine.js).

(function () {
  const logo = document.getElementById('siteLogoLink');
  if (!logo) return;

  const a = document.createElement('a');
  a.id = 'cabinetLink';
  a.className = 'editor-quick-link cabinet-link';
  a.href = '#';
  a.title = 'Personal cabinet';
  a.setAttribute('aria-label', 'Personal cabinet: open your stats');
  a.textContent = '👤';
  logo.insertAdjacentElement('afterend', a);

  function shown(el) {
    return !!el && getComputedStyle(el).display !== 'none';
  }

  // Lays out the buttons right of the logo: cabinet, then Editorial, 10px
  // apart. Widths come from offsetWidth, not the bounding box, so a slide
  // in progress (the `translate` logo-wordmark.js animates) doesn't skew it.
  function layoutLogoLinks() {
    let x = logo.getBoundingClientRect().right + 10;
    for (const el of [a, document.getElementById('editorQuickLink')]) {
      if (!shown(el)) continue;
      el.style.left = x + 'px';
      x += el.offsetWidth + 10;
    }
  }
  window.layoutLogoLinks = layoutLogoLinks;
  layoutLogoLinks();
  window.addEventListener('resize', layoutLogoLinks);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(layoutLogoLinks);

  function isOpen(id) {
    const el = document.getElementById(id);
    return !!el && el.classList.contains('visible');
  }
  function landingUp() {
    const landing = document.getElementById('landingScreen');
    return !!landing && !landing.classList.contains('hidden') && !landing.classList.contains('fading-out') &&
      !isOpen('statsScreen');
  }

  function goToStats() {
    if (isOpen('statsScreen')) return;
    if (landingUp() && !isOpen('forumScreen') && !isOpen('manualScreen') &&
        !(typeof isSettingsScreenOpen === 'function' && isSettingsScreenOpen()) &&
        !(typeof isLicenseScreenOpen === 'function' && isLicenseScreenOpen()) &&
        !(typeof isSolutionScreenOpen === 'function' && isSolutionScreenOpen())) {
      openStatsScreen();
      return;
    }
    // Passing through the menu on the way: no welcome tumble for it.
    window.__logoTumbleSuppressedUntil = Date.now() + 3000;
    if (typeof _goToMainMenuNow === 'function') _goToMainMenuNow();
    const startedAt = Date.now();
    (function waitForMenu() {
      if (landingUp()) { openStatsScreen(); return; }
      if (Date.now() - startedAt < 3000) setTimeout(waitForMenu, 50);
    })();
  }

  a.addEventListener('click', (e) => {
    e.preventDefault();
    if (typeof openStatsScreen !== 'function') return;
    if (typeof confirmLeaveRandomQuiz === 'function') confirmLeaveRandomQuiz(goToStats);
    else goToStats();
  });
})();
