// Figure animations for quiz_3, keyed like course/figures/quiz3.js by the
// original image's file name. Played by js/figure-anim.js (see its header for
// the spec shape). The moving parts and their geometry are tagged in
// tools/figures/quiz3.py (data-part, data-geom); everything else in a drawing
// stays where it is. Motion is qualitative: it shows what happens, not the
// numbers the problem asks for.
//
// Some drawings serve several problems that differ in what moves (which wire
// is plucked, which overtone). Those animations read their own problem's
// text — the element around the figure, with MathJax's math letters
// (𝐴, 𝐵) folded back to plain ones — and fall back to a sensible default.
(function () {
  const A = {};
  const geom = (el) => el.getAttribute('data-geom').trim().split(/\s+/).map(Number);
  const rad = (deg) => deg * Math.PI / 180;
  const f2 = (v) => Math.round(v * 100) / 100;
  const TAU = 2 * Math.PI;

  // The problem's text around the figure (not the figure's own labels), read
  // when play is pressed. Typeset or not, it reads the same: math letters
  // are folded to plain ones (𝐴 to A), "$", "_", braces and the invisible
  // times MathJax puts between multiplied letters are dropped, and \alpha,
  // \theta, \mu become α, θ, μ ("$T_{a}$" and typeset Tₐ both read Ta).
  function problemText(svg) {
    const wrap = svg.closest('.fig-img-wrap');
    const host = wrap && wrap.parentElement;
    if (!host) return '';
    let t = '';
    host.childNodes.forEach((nd) => { if (nd !== wrap) t += nd.textContent; });
    return t.normalize('NFKC').replace(/\\(alpha|theta|mu)\b/g, (m, k) => ({ alpha: 'α', theta: 'θ', mu: 'μ' })[k])
      .replace(/[\u2061-\u2064$_{}]/g, '').replace(/\s+/g, ' ');
  }

  // A wire from (x1,y1) to (x2,y2) displaced across itself by off(s), s = 0..1 along it, as a polyline.
  function bent(x1, y1, x2, y2, off, pts) {
    const L = Math.hypot(x2 - x1, y2 - y1), nx = -(y2 - y1) / L, ny = (x2 - x1) / L;
    let d = '';
    for (let i = 0; i <= pts; i++) {
      const s = i / pts, o = off(s);
      d += (i ? ' L' : 'M') + f2(x1 + (x2 - x1) * s + nx * o) + ',' + f2(y1 + (y2 - y1) * s + ny * o);
    }
    return d;
  }

  // Rigid turning about a centre, with labels carried round upright; `turn`
  // degrees (counter-clockwise) per loop. Each label keeps its place along the
  // drawing's horizontal line through the centre and its distance across it.
  // With `clear`, that line is a rod that turns too: an upright label beside
  // it needs more room when the rod is steep (a word is wider than it is
  // tall), so the gap between label and rod is kept, not the distance.
  function spinner(period, turn, clear) {
    return {
      loop: true, period,
      init(svg) {
        const g = svg.querySelector('[data-part="spin"]');
        const [cx, cy] = geom(g);
        const labs = [...svg.querySelectorAll('[data-part="labels"] text')].map((t) => {
          const x = t.getAttribute('x'), y = t.getAttribute('y');
          return { t, x, y, along: x - cx, across: cy - y, hw: 0, hh: 0 };
        });
        return { g, cx, cy, labs };
      },
      start(s) {
        if (!clear) return;
        s.labs.forEach((l) => {
          let w = 0;
          try { w = l.t.getBBox().width; } catch (e) { /* not rendered: no correction */ }
          l.hw = w / 2;
          l.hh = 0.32 * parseFloat(l.t.getAttribute('font-size') || 15);   // half the cap height
        });
      },
      frame(s, u) {
        if (u <= 0) {
          s.g.removeAttribute('transform');
          s.labs.forEach((l) => { l.t.setAttribute('x', l.x); l.t.setAttribute('y', l.y); });
          return;
        }
        const th = rad(turn * u), c = Math.cos(th), sn = Math.sin(th);
        s.g.setAttribute('transform', `rotate(${f2(-turn * u)} ${s.cx} ${s.cy})`);
        s.labs.forEach((l) => {
          const across = l.across + Math.sign(l.across) * (l.hw * Math.abs(sn) + l.hh * Math.abs(c) - l.hh);
          l.t.setAttribute('x', f2(s.cx + l.along * c - across * sn));
          l.t.setAttribute('y', f2(s.cy - l.along * sn - across * c));
        });
      },
    };
  }

  // P17 · three stars on one orbit, the way the blue arrows show. A third of
  // a turn per loop: the picture (and the 120° marks) repeats exactly.
  A['unnamed(2).webp'] = spinner(2.2, 120);

  // P28 (and the other two-star problems) · both stars round their centre of
  // mass, with R, M and cm turning along; one full orbit per loop.
  A['unnamed(3).webp'] = spinner(4.2, 360, true);

  // Springs, drawn exactly as tools/figures draws them (zigzag() in quiz3.py,
  // Fig.spring() in svgkit.py), for a moved free end.
  function zigzag(x1, x2, y, teeth, amp, lead) {
    let d = `M${f2(x1)},${f2(y)} L${f2(x1 + lead)},${f2(y)}`;
    const step = (x2 - x1 - 2 * lead) / (teeth * 2);
    let x = x1 + lead;
    for (let i = 0; i < teeth * 2; i++) {
      x += step;
      d += ` L${f2(x - step / 2)},${f2(y + (i % 2 ? amp : -amp))} L${f2(x)},${f2(y)}`;
    }
    return d + ` L${f2(x2)},${f2(y)}`;
  }
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

  // A block (or stack) oscillating on a spring: the spring is redrawn, the
  // block and its label move, the spring's label k keeps to its middle.
  function oscillator(period, amp, draw) {
    return {
      loop: true, period,
      init(svg) {
        const sg = svg.querySelector('[data-part="spring"]');
        const path = sg.querySelector('path');
        return { path, d0: path.getAttribute('d'), g: geom(sg),
                 moving: [...svg.querySelectorAll('[data-part="block"]')], k: svg.querySelector('[data-part="k-label"]') };
      },
      frame(s, u) {
        if (u <= 0) {
          s.path.setAttribute('d', s.d0);
          s.moving.concat(s.k).forEach((el) => el.removeAttribute('transform'));
          return;
        }
        const dx = amp * Math.sin(TAU * u);
        const [x1, x2, ...rest] = s.g;
        s.path.setAttribute('d', draw(x1, x2 + dx, ...rest));
        s.moving.forEach((el) => el.setAttribute('transform', `translate(${f2(dx)} 0)`));
        s.k.setAttribute('transform', `translate(${f2(dx / 2)} 0)`);
      },
    };
  }

  // P39 (and the other single-spring problem) · block m oscillating on spring k.
  A['unnamed(4).webp'] = oscillator(1.6, 24, zigzag);

  // P54 · M₂ with M₁ riding on top, oscillating together on spring k.
  A['unnamed(5).webp'] = oscillator(2.0, 20, coil);

  // P105 / P75 · the wire between the posts as a standing wave. The problem
  // names the overtone: the nth overtone has n + 1 loops (fundamental if none).
  A['unnamed(7).webp'] = {
    loop: true, period: 1.2,
    init(svg) {
      const g = svg.querySelector('[data-part="wire"]');
      const path = g.querySelector('path');
      return { svg, path, d0: path.getAttribute('d'), ends: geom(g), loops: 1 };
    },
    start(s) {
      const t = problemText(s.svg);
      const ot = /(\d+)\s*(?:st|nd|rd|th)\s+overtone/i.exec(t), hm = /(\d+)\s*(?:st|nd|rd|th)\s+harmonic/i.exec(t);
      s.loops = ot ? +ot[1] + 1 : (hm ? +hm[1] : 1);
    },
    frame(s, u) {
      if (u <= 0) { s.path.setAttribute('d', s.d0); return; }
      const a = 6 * Math.sin(TAU * 4 * u);            // four swings per loop: about 3 per second
      s.path.setAttribute('d', bent(...s.ends, (x) => a * Math.sin(s.loops * Math.PI * x), Math.max(48, 16 * s.loops)));
    },
  };

  // Vertical wires A and B (each with optional arrowhead "head" carried
  // sideways). mode, from the problem's text:
  //   pulses — both plucked at the bottom: a pulse runs up each wire to the
  //            top; A's is faster, as A carries more of the load (P107)
  //   both   — both vibrate in their fundamental, `faster` a little quicker
  //   A / B  — only that wire vibrates (P143, P137)
  function wires(period, faster) {
    return {
      loop: true, period,
      init(svg) {
        const w = ['a', 'b'].map((k) => {
          const g = svg.querySelector(`[data-part="wire-${k}"]`);
          const path = g.querySelector(':scope > path');
          const head = g.querySelector('[data-part="head"]');
          const [x, y1, y2] = geom(g);
          return { name: k.toUpperCase(), path, d0: path.getAttribute('d'), head, x, y1, y2 };
        });
        return { svg, w, mode: 'both' };
      },
      start(s) {
        const t = problemText(s.svg);
        const one = /wire\s+([AB])\s+is\s+plucked/i.exec(t);
        const both = /\bboth\b/i.test(t) && /pluck/i.test(t);
        s.mode = both ? (/pulse|arriv|time delay/i.test(t) ? 'pulses' : 'both') : (one ? one[1].toUpperCase() : 'both');
      },
      frame(s, u) {
        s.w.forEach((w) => {
          let off = null;
          if (u > 0) {
            if (s.mode === 'pulses') {
              const travel = w.name === 'A' ? 0.44 : 0.62;     // A's pulse is about √2 times faster
              const p = (u - 0.06) / travel;                    // 0 at the bottom (the beam) .. 1 at the top
              if (p > 0 && p < 1) {
                const fade = Math.min(1, p / 0.08, (1 - p) / 0.08);
                off = (s2) => 7 * fade * Math.exp(-Math.pow(((1 - s2) - p) / 0.075, 2));
              }
            } else if (s.mode === 'both' || s.mode === w.name) {
              // about 3 swings a second, a whole number per loop so it repeats seamlessly
              const base = Math.round(period * 3);
              const cycles = s.mode === 'both' && w.name === faster ? base + 1 : base;
              const a = 6 * Math.sin(TAU * cycles * u);
              off = (s2) => a * Math.sin(Math.PI * s2);
            }
          }
          if (!off) {
            w.path.setAttribute('d', w.d0);
            if (w.head) w.head.removeAttribute('transform');
            return;
          }
          w.path.setAttribute('d', bent(w.x, w.y1, w.x, w.y2, off, 48));
          if (w.head) {
            const hy = +w.head.querySelector('path').getAttribute('d').match(/^M[-\d.]+,([-\d.]+)/)[1];
            w.head.setAttribute('transform', `translate(${f2(-off((hy - w.y1) / (w.y2 - w.y1)))} 0)`);
          }
        });
      },
    };
  }

  // P107 / P137 · beam on wires A and B (its centre of gravity nearer A).
  A['unnamed(8).webp'] = wires(3.0, 'A');

  // P143 / P100 · bar on wires A and B, the lead cube nearer B.
  A['unnamed(9).webp'] = wires(2.4, 'B');

  (window.FIGURE_ANIMATIONS = window.FIGURE_ANIMATIONS || {})['quiz_3'] = A;
})();
