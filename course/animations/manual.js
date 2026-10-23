// Figure animations for the manual's demo drawings (course/figures/manual.js,
// keyed by name), shown live by .manual-fig-demo on the "Figures &
// animations" page. Played by js/figure-anim.js (see its header for the spec
// shape); the moving parts are tagged in tools/figures/manual.py.
(function () {
  const A = {};
  const geom = (el) => el.getAttribute('data-geom').trim().split(/\s+/).map(Number);
  const f2 = (v) => Math.round(v * 100) / 100;
  const TAU = 2 * Math.PI;

  // A coil spring drawn exactly as Fig.spring() in tools/figures/svgkit.py
  // draws it (the same as coil() in course/animations/quiz3.js).
  function coil(x1, x2, y, turns, amp, lead) {
    const x0 = x1 + lead, a = (x2 - lead - x0) / turns, loop = Math.min(a * 0.45, amp * 0.6), steps = 20;
    const pts = [[x1, y]];
    for (let i = 0; i <= turns * steps; i++) {
      const t = i / steps * TAU;
      pts.push([x0 + a * i / steps + loop * (Math.cos(t) - 1), y + amp * Math.sin(t)]);
    }
    pts.push([x2, y]);
    return 'M' + pts.map(([px, py]) => `${f2(px)},${f2(py)}`).join(' L');
  }

  // Two equal blocks between three springs, the middle one weak. m₁ starts
  // pulled aside, as drawn, and is let go: its swing passes over to m₂ and
  // back (beats). That motion is the sum of the two ways the pair can swing,
  // together (slower) and against each other (faster, the weak spring
  // helps); a loop holds 6 of the first and 7 of the second, so it ends
  // where it began, at rest, and a paused loop stops without a jolt.
  A['coupled-springs'] = {
    loop: true, period: 5,
    init(svg) {
      const part = (k) => svg.querySelector(`[data-part="${k}"]`);
      const springs = [1, 2, 3].map((i) => {
        const path = part('spring-' + i).querySelector('path');
        return { path, d0: path.getAttribute('d'), g: geom(part('spring-' + i)), k: part('k-' + i) };
      });
      const blocks = [part('block-1'), part('block-2')];
      return { springs, blocks, pull: geom(blocks[0])[0] };
    },
    frame(s, u) {
      if (u <= 0) {
        s.springs.forEach((sp) => { sp.path.setAttribute('d', sp.d0); sp.k.removeAttribute('transform'); });
        s.blocks.forEach((b) => b.removeAttribute('transform'));
        return;
      }
      const together = Math.cos(TAU * 6 * u), against = Math.cos(TAU * 7 * u), p = s.pull;
      // Each block's shift from the drawing (m₁ is drawn at -pull from rest).
      const d = [p - p / 2 * (together + against), -p / 2 * (together - against)];
      const ends = [[0, d[0]], [d[0], d[1]], [d[1], 0]];        // each spring's left and right end
      s.springs.forEach((sp, i) => {
        const [x1, x2, ...rest] = sp.g, [l, r] = ends[i];
        sp.path.setAttribute('d', coil(x1 + l, x2 + r, ...rest));
        sp.k.setAttribute('transform', `translate(${f2((l + r) / 2)} 0)`);
      });
      s.blocks.forEach((b, i) => b.setAttribute('transform', `translate(${f2(d[i])} 0)`));
    },
  };

  (window.FIGURE_ANIMATIONS = window.FIGURE_ANIMATIONS || {})['manual'] = A;
})();
