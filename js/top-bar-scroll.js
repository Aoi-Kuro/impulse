// ─── Top bar scroll state ───────────────────────────────────────────────────
// .top-bar-backdrop (css/style.css) starts as plain --bg — flush with the
// page, invisible — because with nothing scrolled under it yet there's
// nothing for a visible bar to separate, and a --surface stripe sitting over
// blank page looks like a stray line for no reason. Once the page scrolls
// past TOP_BAR_SCROLL_THRESHOLD (content now actually passing behind the
// bar), this adds .is-scrolled to <body>, which is all the CSS needs to fade
// the bar to --surface + a small shadow — a real seam once there's something
// underneath it to seam against. The threshold is a plain on/off flip (not a
// gradient tied to scroll position); the CSS transition on background-color
// is what makes that flip read as a smooth fade rather than a hard cut.
//
// Window-level scroll: the page itself is what scrolls (body has no
// overflow set, no inner scroll container on any screen — see the safe-area
// padding work in css/style.css), so window.scrollY is the right thing to
// read, on every screen (landing, quiz, Stats, Forum, ...) alike, without
// needing to know which one is currently showing.

const TOP_BAR_SCROLL_THRESHOLD = 28; // px scrolled before the bar switches to --surface

let _topBarScrolled = false;
let _topBarTicking = false;

function _updateTopBarScrollState() {
  _topBarTicking = false;
  const shouldBeScrolled = window.scrollY > TOP_BAR_SCROLL_THRESHOLD;
  if (shouldBeScrolled === _topBarScrolled) return;
  _topBarScrolled = shouldBeScrolled;
  document.body.classList.toggle('is-scrolled', _topBarScrolled);
  // Lets other modules (js/top-bar-tips.js) react to the bar's --bg/--surface
  // flip without polling body's class list themselves.
  window.dispatchEvent(new CustomEvent('topbar:scrollstate', { detail: { scrolled: _topBarScrolled } }));
}

window.addEventListener('scroll', () => {
  // rAF-throttled: scroll fires far more often than the class actually
  // needs to change, and classList.toggle is a no-op when the state hasn't
  // flipped anyway — this just avoids running the check on every single
  // scroll event rather than once per frame.
  if (_topBarTicking) return;
  _topBarTicking = true;
  requestAnimationFrame(_updateTopBarScrollState);
}, { passive: true });

// Covers a reload that lands mid-scroll (browsers can restore scroll
// position on refresh) — without this the bar would stay --bg until the
// next scroll event, out of sync with content already sitting behind it.
_updateTopBarScrollState();
