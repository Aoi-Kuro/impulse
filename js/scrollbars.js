// ─── Scrollbars ──────────────────────────────────────────────────────────────
// Used by the site (index.html) and the editor (editor/index.html).
// Scrollbars fade in while used (css/style.css, --sb-a): while their element
// scrolls, and while the pointer is over the bar itself. They fade out a
// moment after. The fade is stepped here frame by frame: a CSS transition
// doesn't repaint scrollbars in Chrome, a plain style change does.
//
// The page's own bar is tracked as <html> (document.scrollingElement), but
// its value is written to <body> too: Chrome styles the page bar from
// <body>'s ::-webkit-scrollbar when it has one (and the universal one in
// style.css gives it one), Firefox from <html>'s scrollbar-color.
(function () {
  const HIDE_MS = 900, FADE_MS = 300;
  const timers = new WeakMap(), fades = new WeakMap();
  let hovered = null;

  const root = document.documentElement;
  const barOwner = (el) => (el === document.body ? root : el);
  const setAlpha = (el, a) => {
    for (const x of el === root && document.body ? [el, document.body] : [el]) {
      if (a === null) x.style.removeProperty('--sb-a');
      else x.style.setProperty('--sb-a', a);
    }
  };

  const fadeTo = (el, target) => {
    let f = fades.get(el);
    if (!f) { f = { a: 0, target: 0, raf: 0, t: 0 }; fades.set(el, f); }
    f.target = target;
    if (f.raf || f.a === target) return;
    f.t = performance.now();
    const step = (now) => {
      const d = (now - f.t) / FADE_MS; f.t = now;
      f.a = f.target > f.a ? Math.min(f.target, f.a + d) : Math.max(f.target, f.a - d);
      setAlpha(el, f.a.toFixed(3));
      f.raf = f.a === f.target ? 0 : requestAnimationFrame(step);
      if (!f.raf && f.a === 0) setAlpha(el, null);
    };
    f.raf = requestAnimationFrame(step);
  };

  const hideLater = (el) => {
    clearTimeout(timers.get(el));
    timers.set(el, setTimeout(() => { if (el !== hovered) fadeTo(el, 0); }, HIDE_MS));
  };

  document.addEventListener('scroll', (e) => {
    const el = barOwner(e.target === document ? document.scrollingElement : e.target);
    if (!(el instanceof Element)) return;
    fadeTo(el, 1);
    hideLater(el);
  }, { capture: true, passive: true });

  // A bar belongs to its element, so the pointer is over one when it is
  // inside the element but past its client area (right or bottom edge).
  // The page's own bar sits at the viewport's edge instead: <html>'s box
  // moves up as the page scrolls, but its clientWidth/clientHeight are the
  // viewport's minus the bars.
  const overBar = (el, x, y) => {
    if (!(el instanceof Element)) return false;
    if (el === root) return x >= el.clientWidth || y >= el.clientHeight;
    const r = el.getBoundingClientRect();
    return x >= r.left + el.clientLeft + el.clientWidth || y >= r.top + el.clientTop + el.clientHeight;
  };

  const setHovered = (el) => {
    if (el === hovered) return;
    if (hovered) hideLater(hovered);
    hovered = el;
    if (el) { clearTimeout(timers.get(el)); fadeTo(el, 1); }
  };

  document.addEventListener('pointermove', (e) => {
    const el = barOwner(e.target);
    setHovered(overBar(el, e.clientX, e.clientY) ? el : null);
  }, { passive: true });
  root.addEventListener('pointerleave', () => setHovered(null));
})();
