// ── Logo while the database is off ──────────────────────────────────────────
// The cube turns red and "Limited (DB lost)" sits under the course name, with
// its L under the name's L. js/db-status.js says when.
//
// The cube is only a different picture: every animation runs on the <img> or
// on the 3D faces of js/logo-tumble.js, so the tumble and the quiz's turn
// (js/logo-wordmark.js) go on as ever. The faces get the same three reds in
// css/style.css, "Logo while the database is off". The change itself happens
// inside a tumble, which hides the <img> while it plays, so the swap can't be
// seen. The picture lives here rather than in favicon/ because it must not
// depend on a request: this is what shows when requests fail.
//
// The text moves like the course name: out of the cube letter by letter, and
// back in when the database returns or an attempt starts (as the name does).

(function () {
  const link = document.getElementById('siteLogoLink');
  const img  = link && link.querySelector('.site-logo-img');
  const word = link && link.querySelector('.site-logo-wordmark');
  if (!img || !word) return;

  const TEXT = 'Limited (DB lost)';
  const LIT = '#ef4757', MID = '#c4203a', SHADE = '#8a1226';  // top, left and right faces
  const REDS = [LIT, MID, SHADE];
  const STEP = 28;        // stagger between letters
  const FLY = 460;        // one letter's flight, as in js/logo-wordmark.js
  const START = 200;      // lets the tumble get going first
  const EASE_IN  = 'cubic-bezier(.55,0,.85,.35)';
  const EASE_OUT = 'cubic-bezier(.15,.65,.35,1)';

  const BLUE_CUBE = img.getAttribute('src');
  // favicon.svg's shapes with these colours.
  const RED_CUBE = 'data:image/svg+xml,' + encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 118.2693 136.584">' +
    `<polygon fill="${SHADE}" points="117.9693 102.2863 59.1347 136.2376 59.1347 68.292 117.9693 34.2977"/>` +
    `<polygon fill="${LIT}" points="59.1347 68.292 .3 34.2977 59.1347 .3464 117.9693 34.2977"/>` +
    `<polygon fill="${MID}" points="59.1347 68.292 59.1347 136.2376 .3 102.2863 .3 34.2977"/>` +
    '<g fill="none" stroke="#000" stroke-miterlimit="10" stroke-width=".6">' +
    '<polygon points="59.1347 .3464 .3 34.2977 .3 102.2863 59.1347 136.2376 117.9693 102.2863 117.9693 34.2977"/>' +
    '<polyline points=".3 34.2977 59.1347 68.292 117.9693 34.2977"/>' +
    '<line x1="59.1347" y1="68.292" x2="59.1347" y2="136.2376"/></g></svg>'
  );

  // One span per letter, as the course name has, with a red copy over each.
  const label = document.createElement('span');
  label.className = 'site-logo-limited';
  label.setAttribute('aria-label', TEXT);
  label.innerHTML = [...TEXT].map((ch, i) => {
    const shown = ch === ' ' ? '&nbsp;' : ch;
    return `<span class="site-logo-letter" aria-hidden="true">${shown}` +
      `<span class="site-logo-letter-tint" style="color:${REDS[i % 3]}">${shown}</span></span>`;
  }).join('');
  link.appendChild(label);
  const letters = [...label.querySelectorAll(':scope > .site-logo-letter')];
  const tints   = [...label.querySelectorAll('.site-logo-letter-tint')];

  function plainOnly() {
    const reduce = document.documentElement.classList.contains('settings-reduce-motion') ||
      (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    const off = typeof getSetting === 'function' && getSetting('display', 'showLogoTumble') === false;
    return reduce || off;
  }

  // Under the name's L. offsetLeft, unlike a measured rectangle, isn't moved
  // by the name flying about during an attempt.
  function placeLabel() {
    const nameLetters = [...word.querySelectorAll('.site-logo-letter')];
    const el = nameLetters.find((l) => l.firstChild.textContent === 'L');
    label.style.left = (word.offsetLeft + (el ? el.offsetLeft : 0)) + 'px';
  }

  function cancelLabel() {
    label.getAnimations({ subtree: true }).forEach((a) => a.cancel());
  }

  // Each letter's way to the cube's centre, measured at rest.
  function offsets() {
    const c = img.getBoundingClientRect();
    const cx = c.left + c.width / 2, cy = c.top + c.height / 2;
    return letters.map((l) => {
      const r = l.getBoundingClientRect();
      return { dx: cx - (r.left + r.width / 2), dy: cy - (r.top + r.height / 2) };
    });
  }

  function showLabel() {
    cancelLabel();
    placeLabel();
    label.classList.add('shown');
    if (plainOnly()) {
      label.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 250, fill: 'both' });
      return;
    }
    offsets().forEach(({ dx, dy }, i) => {
      const timing = { duration: FLY, delay: START + i * STEP, easing: EASE_OUT, fill: 'both' };
      letters[i].animate([
        { transform: `translate(${dx}px, ${dy}px) scale(.15) rotate(-40deg)`, opacity: 0 },
        { transform: `translate(${dx * .55}px, ${dy * .55}px) scale(.7)`, opacity: 1, offset: .45 },
        { transform: 'none', opacity: 1 }
      ], timing);
      tints[i].animate([{ opacity: 1 }, { opacity: 1, offset: .45 }, { opacity: 0 }], timing);
    });
  }

  function hideLabel() {
    cancelLabel();
    const hide = () => { label.classList.remove('shown'); cancelLabel(); };
    if (plainOnly()) {
      label.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 250, fill: 'both' }).finished.then(hide, () => {});
      return;
    }
    const running = offsets().map(({ dx, dy }, i) => {
      const timing = { duration: FLY, delay: i * STEP, easing: EASE_IN, fill: 'both' };
      tints[i].animate([{ opacity: 0 }, { opacity: 1, offset: .55 }, { opacity: 1 }], timing);
      return letters[i].animate([
        { transform: 'none', opacity: 1 },
        { transform: `translate(${dx * .55}px, ${dy * .55}px) scale(.7)`, opacity: 1, offset: .55 },
        { transform: `translate(${dx}px, ${dy}px) scale(.15) rotate(-40deg)`, opacity: 0 }
      ], timing);
    });
    // A cancelled one means showLabel() took over, and it stays shown.
    Promise.all(running.map((a) => a.finished)).then(hide, () => {});
  }

  let red = false, labelShown = false, inAttempt = false;

  function follow({ tumble }) {
    const offline = dbOffline();
    if (offline !== red) {
      red = offline;
      // The turn of an attempt is on the <img>, and a tumble would drop it.
      if (tumble && !inAttempt && typeof playLogoTumble === 'function') playLogoTumble(true);
      img.src = red ? RED_CUBE : BLUE_CUBE;
    }
    const wanted = offline && !inAttempt;
    if (wanted === labelShown) return;
    labelShown = wanted;
    if (wanted) showLabel(); else hideLabel();
  }

  document.addEventListener('db-status-changed', () => follow({ tumble: true }));
  window.addEventListener('quiztimer:activechange', (e) => {
    inAttempt = !!(e.detail && e.detail.active);
    follow({ tumble: false });
  });
  window.addEventListener('resize', placeLabel);
  if (document.fonts) document.fonts.ready.then(placeLabel).catch(() => {});

  // A page load during an outage: the welcome tumble comes by itself.
  follow({ tumble: false });
})();
