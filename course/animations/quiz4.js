// Figure animations for quiz_4, keyed like course/figures/quiz4.js by the
// original image's file name. Played by js/figure-anim.js (see its header for
// the spec shape). The moving parts and their geometry are tagged in
// tools/figures/quiz4.py (data-part, data-geom); everything else in a drawing
// stays where it is. Motion is qualitative: it shows what happens, not the
// numbers the problem asks for.
(function () {
  const A = {};
  const geom = (el) => el.getAttribute('data-geom').trim().split(/\s+/).map(Number);
  const smooth = (u) => u * u * (3 - 2 * u);
  const f2 = (v) => Math.round(v * 100) / 100;
  const deg = (r) => r * 180 / Math.PI;

  // The problem's text around the figure (not the figure's own labels), read
  // when play is pressed, as in course/animations/quiz3.js: math letters
  // folded to plain ones, "$" dropped, and the invisible times MathJax puts
  // (U+2062) between multiplied letters, as in ADBA, removed.
  function problemText(svg) {
    const wrap = svg.closest('.fig-img-wrap');
    const host = wrap && wrap.parentElement;
    if (!host) return '';
    let t = '';
    host.childNodes.forEach((nd) => { if (nd !== wrap) t += nd.textContent; });
    return t.normalize('NFKC').replace(/\\(alpha|theta|mu)\b/g, (m, k) => ({ alpha: 'α', theta: 'θ', mu: 'μ' })[k])
      .replace(/[\u2061-\u2064$_{}]/g, '').replace(/\s+/g, ' ');
  }

  // P6 · cracked bar between fixed supports. The top bar warms (its red
  // deepens) and, lengthening against the supports, buckles up at the crack
  // until it looks like the lower bar. The halves are rigid: the crack rises
  // as √ of the stretch, quickly at first, as it would.
  function barHalf(xEnd, y, ax, ay) {              // bar_half() in tools/figures/quiz4.py
    const ux = ax - xEnd, uy = ay - y, L = Math.hypot(ux, uy);
    let nx = -uy / L * 8, ny = ux / L * 8;
    if (xEnd > ax) { nx = -nx; ny = -ny; }
    const pts = [[xEnd, y], [ax, ay], [ax + nx, ay + ny], [xEnd + nx, y + ny]];
    return 'M' + pts.map(([x, yy]) => `${f2(x)},${f2(yy)}`).join(' L') + ' Z';
  }
  A['unnamed.webp'] = {
    loop: false, duration: 2.4, hold: 0.8, back: 0.65,
    init(svg) {
      const g = svg.querySelector('[data-part="bar"]');
      const [x1, x2, xc, y, rise] = geom(g);
      const halves = [...g.querySelectorAll('path')];
      const half = xc - x1, grow = Math.hypot(half, rise) / half - 1;
      return { halves, d0: halves.map((p) => p.getAttribute('d')), fop: halves[0].getAttribute('fill-opacity'),
               ends: [x1, x2], xc, y, half, grow };
    },
    frame(s, u) {
      if (u <= 0) {
        s.halves.forEach((p, i) => { p.setAttribute('d', s.d0[i]); p.setAttribute('fill-opacity', s.fop); });
        return;
      }
      const e = smooth(u), len = s.half * (1 + s.grow * e), ay = s.y - Math.sqrt(Math.max(0, len * len - s.half * s.half));
      s.halves.forEach((p, i) => {
        p.setAttribute('d', barHalf(s.ends[i], s.y, s.xc, ay));
        p.setAttribute('fill-opacity', String(f2(+s.fop + 0.3 * e)));
      });
    },
  };

  // P31 · Y of copper, steel and brass. Heat packets leave the 100 °C end,
  // run down the copper and split at the junction: brass, whose k/L is
  // about three times steel's (130/21 against 50/23 in the problem), takes
  // three of every four. What comes in at the junction goes out. A paused
  // flow lets the packets under way run out (spec.drain).
  const PACKET_EVERY = 0.3, PACKET_SPEED = 70;     // s between packets, units per second
  A['unnamed(2).webp'] = {
    loop: true, period: 4.8, drain: 4.4,
    init(svg) {
      const g = svg.querySelector('[data-part="packets"]');
      const [tx, ty, jx, jy, sx, sy, bx, by] = geom(g);
      const copper = Math.hypot(jx - tx, jy - ty);
      const leg = (ex, ey) => ({ ex, ey, len: Math.hypot(ex - jx, ey - jy) });
      return { g, tx, ty, jx, jy, copper, steel: leg(sx, sy), brass: leg(bx, by), dots: [], loops: 0, last: 0 };
    },
    start(s) {
      s.loops = 0;
      s.last = 0;
      const count = 2 * Math.round(this.period / PACKET_EVERY);   // this cycle's packets and the last one's
      for (let i = 0; i < count; i++) {
        const c = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        c.setAttribute('r', '4.2');                                // a little wider than the rod
        c.setAttribute('fill', 'currentColor');
        c.setAttribute('stroke', 'var(--svg-fill-white)');
        c.setAttribute('stroke-width', '1.4');
        c.setAttribute('opacity', '0');
        s.g.appendChild(c);
        s.dots.push(c);
      }
    },
    end(s) {
      s.dots.forEach((c) => c.remove());
      s.dots = [];
    },
    frame(s, u) {
      if (u < s.last) s.loops++;
      s.last = u;
      const T = this.period, t = u * T;
      s.dots.forEach((c, i) => {
        const k = i >> 1, earlier = i & 1;                         // packet k of this cycle, or of the one before
        const age = t - k * PACKET_EVERY + (earlier ? T : 0);
        const branch = k % 4 === 2 ? s.steel : s.brass;
        const d = age * PACKET_SPEED, total = s.copper + branch.len;
        if ((earlier && !s.loops) || u <= 0 || d < 0 || d > total) {
          c.setAttribute('opacity', '0');
          return;
        }
        let x, y;
        if (d < s.copper) {
          x = s.tx + (s.jx - s.tx) * d / s.copper;
          y = s.ty + (s.jy - s.ty) * d / s.copper;
        } else {
          const f = (d - s.copper) / branch.len;
          x = s.jx + (branch.ex - s.jx) * f;
          y = s.jy + (branch.ey - s.jy) * f;
        }
        c.setAttribute('cx', f2(x));
        c.setAttribute('cy', f2(y));
        c.setAttribute('opacity', String(f2(Math.min(1, d / 10, (total - d) / 10))));
      });
    },
  };

  // P29 · rod of A and B end to end, heated: from the fixed left end, A
  // lengthens 2.6 times as much per unit length as B (0.065 against 0.025 in
  // the problem, much exaggerated); L_A and the labels go along.
  A['unnamed(1).webp'] = {
    loop: false, duration: 2.2, hold: 0.8, back: 0.6,
    init(svg) {
      const part = (k) => svg.querySelector(`[data-part="${k}"]`);
      const ra = part('rod-a').querySelector('rect'), rb = part('rod-b').querySelector('rect');
      return { ra, rb, x0: +ra.getAttribute('x'), wa: +ra.getAttribute('width'), wb: +rb.getAttribute('width'),
               xb: rb.getAttribute('x'), la: [...svg.querySelectorAll('[data-part="label-a"]')],
               lb: part('label-b'), arrows: part('length-a') };
    },
    frame(s, u) {
      if (u <= 0) {
        s.ra.setAttribute('width', s.wa);
        s.rb.setAttribute('x', s.xb);
        s.rb.setAttribute('width', s.wb);
        s.la.concat(s.lb, s.arrows).forEach((el) => el.removeAttribute('transform'));
        return;
      }
      const e = smooth(u), wa = s.wa * (1 + 0.07 * e), wb = s.wb * (1 + 0.027 * e), da = wa - s.wa;
      s.ra.setAttribute('width', f2(wa));
      s.rb.setAttribute('x', f2(s.x0 + wa));
      s.rb.setAttribute('width', f2(wb));
      s.la.forEach((el) => el.setAttribute('transform', `translate(${f2(da / 2)} 0)`));
      s.lb.setAttribute('transform', `translate(${f2(da + (wb - s.wb) / 2)} 0)`);
      s.arrows.setAttribute('transform', `translate(${s.x0} 0) scale(${f2(wa / s.wa * 1000) / 1000} 1) translate(${-s.x0} 0)`);
    },
  };

  // ── p–V paths ──
  // The arrowheads on the path a problem takes travel round it at an even
  // pace, turning the corners, in the order the path names; arrows off the
  // path stay still. A head running against its drawn direction turns round
  // first. The segments and heads are tagged in tools/figures/quiz4.py (see
  // seg() and head_tag() there); a loop takes each head once round.
  function bezier(c, t) {
    const m = 1 - t;
    return [m * m * m * c[0] + 3 * m * m * t * c[2] + 3 * m * t * t * c[4] + t * t * t * c[6],
            m * m * m * c[1] + 3 * m * m * t * c[3] + 3 * m * t * t * c[5] + t * t * t * c[7]];
  }
  // A segment as points with their parameter and distance along it (drawn order).
  function sampled(c) {
    const at = c.length === 4 ? (t) => [c[0] + (c[2] - c[0]) * t, c[1] + (c[3] - c[1]) * t] : (t) => bezier(c, t);
    const N = c.length === 4 ? 1 : 60, pts = [];
    let len = 0;
    for (let i = 0; i <= N; i++) {
      const [x, y] = at(i / N);
      if (i) len += Math.hypot(x - pts[i - 1].x, y - pts[i - 1].y);
      pts.push({ x, y, t: i / N, s: len });
    }
    return { pts, len };
  }
  function lerpBy(pts, key, v) {                     // the point where pts[key] reaches v
    let i = 1;
    while (i < pts.length - 1 && pts[i][key] < v) i++;
    const a = pts[i - 1], b = pts[i], k = b[key] === a[key] ? 0 : (v - a[key]) / (b[key] - a[key]);
    return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, s: a.s + (b.s - a.s) * k };
  }

  // path: state names in order, e.g. "ADBA". Returns null if the drawing lacks a step.
  function cycle(svg, path) {
    const segs = {};
    svg.querySelectorAll('[data-part="seg"]').forEach((g) => {
      segs[g.dataset.seg] = Object.assign(sampled(geom(g)), { colour: g.firstElementChild.getAttribute('stroke') });
    });
    const legs = [];
    let total = 0;
    for (let i = 0; i + 1 < path.length; i++) {
      const fwd = segs[path[i] + path[i + 1]], back = segs[path[i + 1] + path[i]];
      if (!fwd && !back) return null;
      legs.push({ name: fwd ? path[i] + path[i + 1] : path[i + 1] + path[i], seg: fwd || back, fwd: !!fwd, from: total,
                  a: path[i], b: path[i + 1] });
      total += (fwd || back).len;
    }
    const open = path[0] !== path[path.length - 1];
    // The point at distance s from the path's start (a closed path goes
    // round again, an open one stops at its ends), with its leg and how far
    // along the leg it is.
    const at = (s) => {
      s = open ? Math.max(0, Math.min(total, s)) : ((s % total) + total) % total;
      let k = legs.length - 1;
      while (k > 0 && legs[k].from > s) k--;
      const leg = legs[k], d = s - leg.from;
      const p = lerpBy(leg.seg.pts, 's', leg.fwd ? d : leg.seg.len - d);
      return { x: p.x, y: p.y, colour: leg.seg.colour, leg, along: d };
    };
    const heads = [];
    svg.querySelectorAll('[data-part="head"]').forEach((g) => {
      const leg = legs.find((l) => l.name === g.dataset.seg);
      if (!leg) return;                              // off the path: stays as drawn
      const [t, sign] = geom(g), seg = leg.seg, p = lerpBy(seg.pts, 't', t);
      const q = lerpBy(seg.pts, 's', Math.min(seg.len, p.s + 1)), r = lerpBy(seg.pts, 's', Math.max(0, p.s - 1));
      const shape = g.querySelector('path');
      heads.push({ g, shape, fill: shape.getAttribute('fill'), x: p.x, y: p.y,
                   ang: deg(Math.atan2(q.y - r.y, q.x - r.x)) + (sign < 0 ? 180 : 0),
                   s: leg.from + (leg.fwd ? p.s : seg.len - p.s) });
    });
    return { heads, total, at, open, path };
  }

  // ── The gas in a cylinder (gas_inset() and state_dot() in tools/figures/quiz4.py) ──
  // Plays a p–V path as what happens to the gas, beside the diagram, with a
  // dot for its state on the path:
  //  - volume: the piston's place;
  //  - temperature: the colour of the gas (and the dot) on a fixed thermal
  //    scale, blue (coldest on the path) through green and yellow to red;
  //  - pressure: the size of the arrow on the rod (its area grows with the
  //    pressure). It points in while the gas is being pushed in from
  //    outside, and out while the gas pushes the piston out, or presses on
  //    it while pins hold it at constant volume;
  //  - heat: arrows at the closed end, coming in or leaving, by the sign of
  //    dQ = (f/2) d(pV) + p dV (f: the gas's degrees of freedom); on an
  //    adiabatic step none, and an insulating jacket instead.
  // Volume and pressure are read off the drawing. So is temperature (as pV),
  // unless the problem states it at every state of the path (P93, P150):
  // then it goes from one stated value to the next along each step, since a
  // drawn curve is only roughly the true adiabat.
  const clamp01 = (v) => Math.max(0, Math.min(1, v));

  // Temperature as a thermal scale, cold to hot, the same in every theme
  // (accent pairs like cyan and magenta don't read as cold and hot): one set
  // for dark mode, a deeper one that holds up on light backgrounds.
  const THERMAL = {
    dark:  [[76, 155, 255], [63, 197, 107], [242, 200, 75], [255, 90, 90]],
    light: [[37, 99, 235], [22, 163, 74], [212, 160, 23], [220, 38, 38]],
  };
  const rgb = (c) => `rgb(${c.map(Math.round).join(', ')})`;
  function thermal(t) {                              // t: 0 (coldest) .. 1 (hottest)
    const stops = THERMAL[document.body.classList.contains('light') ? 'light' : 'dark'];
    const x = clamp01(t) * (stops.length - 1), i = Math.min(stops.length - 2, Math.floor(x)), k = x - i;
    return rgb(stops[i].map((v, j) => v + (stops[i + 1][j] - v) * k));
  }

  // The temperatures the problem states for the states of the path ("T_a = 298 K"), or null.
  function statedTemps(svg, path) {
    const t = {}, re = /\bT\s*([A-Da-d1-3])\s*=\s*(\d+(?:\.\d+)?)\s*K/g, text = problemText(svg);
    let m;
    while ((m = re.exec(text))) t[m[1]] = +m[2];
    return [...path].every((k) => k in t) ? t : null;
  }

  function cylinder(svg, walk, f, adiabatic) {
    const part = (k) => svg.querySelector(`[data-part="${k}"]`);
    const inset = part('inset'), dot = part('state'), [, lenMax, ox, oy] = geom(inset);
    const el = { gas: part('gas').querySelector('rect'), piston: part('piston'), pins: part('pins'), jacket: part('jacket'),
                 pushIn: part('push-in'), pushOut: part('push-out'), heatIn: part('heat-in'), heatOut: part('heat-out') };
    const kept = [[inset, ['opacity']], [dot, ['opacity', 'transform']], [dot.firstElementChild, ['fill']],
                  [el.gas, ['width', 'fill', 'fill-opacity']], [el.piston, ['transform']], [el.pins, ['opacity']],
                  [el.jacket, ['opacity']], [el.pushIn, ['opacity', 'transform']], [el.pushOut, ['opacity', 'transform']],
                  [el.heatIn, ['opacity', 'color']], [el.heatOut, ['opacity', 'color']]]
      .map(([e, names]) => [e, names.map((k) => [k, e.getAttribute(k)])]);
    const [tipX, tipY] = geom(el.pushIn), [tailX, tailY] = geom(el.pushOut);
    const temps = statedTemps(svg, walk.path);
    const tempAt = (q) => (temps ? temps[q.leg.a] + (temps[q.leg.b] - temps[q.leg.a]) * q.along / q.leg.seg.len
                                 : (q.x - ox) * (oy - q.y));
    let vMax = 0, pMax = 0, tMin = Infinity, tMax = -Infinity;
    for (let d = 0; d <= walk.total; d += 2) {
      const q = walk.at(d), T = tempAt(q);
      vMax = Math.max(vMax, q.x - ox);
      pMax = Math.max(pMax, oy - q.y);
      tMin = Math.min(tMin, T);
      tMax = Math.max(tMax, T);
    }
    const coolCss = thermal(0), warmCss = thermal(1);
    const scaled =(x, y, k) => `translate(${f2(x)} ${f2(y)}) scale(${f2(k)}) translate(${f2(-x)} ${f2(-y)})`;
    return {
      reset() {
        kept.forEach(([e, list]) => list.forEach(([k, v]) => (v === null ? e.removeAttribute(k) : e.setAttribute(k, v))));
      },
      // the state at distance d along the path, everything at opacity alpha
      show(d, alpha) {
        const q = walk.at(d), a = walk.at(walk.open ? Math.max(0, d - 3) : d - 3), b = walk.at(walk.open ? Math.min(walk.total, d + 3) : d + 3);
        const V = q.x - ox, p = oy - q.y, len = lenMax * V / vMax;
        const chord = Math.hypot(b.x - a.x, b.y - a.y) || 1, dV = (b.x - a.x) / chord, dp = -(b.y - a.y) / chord;
        const colour = thermal((tempAt(q) - tMin) / (tMax - tMin || 1));
        inset.setAttribute('opacity', String(f2(clamp01(alpha))));
        dot.setAttribute('opacity', String(f2(clamp01(alpha))));
        dot.setAttribute('transform', `translate(${f2(q.x)} ${f2(q.y)})`);
        dot.firstElementChild.setAttribute('fill', colour);
        el.gas.setAttribute('width', f2(len));
        el.gas.setAttribute('fill', colour);
        el.gas.setAttribute('fill-opacity', '0.7');
        el.piston.setAttribute('transform', `translate(${f2(len - lenMax)} 0)`);
        const inward = clamp01(-dV / 0.08), k = Math.sqrt(p / pMax);
        el.pushIn.setAttribute('opacity', String(f2(inward)));
        el.pushIn.setAttribute('transform', scaled(tipX, tipY, k));
        el.pushOut.setAttribute('opacity', String(f2(1 - inward)));
        el.pushOut.setAttribute('transform', scaled(tailX, tailY, k));
        el.pins.setAttribute('opacity', String(f2(clamp01(1 - Math.abs(dV) / 0.08))));
        const still = adiabatic.includes(q.leg.name);
        const heat = still ? 0 : (f / 2 + 1) * p * dV + (f / 2) * V * dp;
        el.heatIn.setAttribute('opacity', String(f2(clamp01(heat / 40))));
        el.heatIn.setAttribute('color', warmCss);
        el.heatOut.setAttribute('opacity', String(f2(clamp01(-heat / 40))));
        el.heatOut.setAttribute('color', coolCss);
        el.jacket.setAttribute('opacity', String(f2(still ? clamp01(Math.min(q.along, q.leg.seg.len - q.along) / 4) : 0)));
      },
    };
  }

  // gas: { f, adiabatic: [segment names] } adds the cylinder; a paused loop
  // then fades it out over spec.drain, back at the start of the path.
  function pvCycle(period, pathFor, gas) {
    return {
      loop: true, period, drain: gas ? 0.6 : 0,
      init(svg) { return { svg, c: null, gas: null, loops: 0, last: 0 }; },
      start(s) {
        s.c = cycle(s.svg, pathFor(s.svg)) || null;
        s.gas = gas && s.c ? cylinder(s.svg, s.c, gas.f, gas.adiabatic) : null;
        s.loops = 0;
        s.last = 0;
      },
      frame(s, u) {
        if (!s.c) return;
        if (u < s.last) s.loops++;
        s.last = u;
        if (s.gas) {
          if (u <= 0) s.gas.reset();
          else s.gas.show(Math.min(u, 1) * s.c.total,
                          u > 1 ? 1 - (u - 1) * this.period / this.drain : (s.loops ? 1 : Math.min(1, u / 0.06)));
        }
        const L = s.c.total, uu = Math.min(u, 1);
        s.c.heads.forEach((h) => {
          if (u <= 0) {
            h.g.removeAttribute('transform');
            h.g.removeAttribute('opacity');
            h.shape.setAttribute('fill', h.fill);
            return;
          }
          // An open path (a → b → c) has ends: a head fades out at the last
          // state and back in at the first.
          let d = h.s + uu * L;
          if (s.c.open) {
            d %= L;
            h.g.setAttribute('opacity', String(f2(Math.min(1, d / 14, (L - d) / 14))));
          }
          const p = s.c.at(d), a = s.c.at(s.c.open ? Math.max(0, d - 5) : d - 5), b = s.c.at(s.c.open ? Math.min(L - 0.01, d + 5) : d + 5);
          const turn = deg(Math.atan2(b.y - a.y, b.x - a.x)) - h.ang;    // the chord across a corner turns it smoothly
          h.g.setAttribute('transform', `translate(${f2(p.x - h.x)} ${f2(p.y - h.y)}) rotate(${f2(turn)} ${f2(h.x)} ${f2(h.y)})`);
          h.shape.setAttribute('fill', p.colour);
        });
      },
    };
  }

  // P90 / P91 / P92 · rectangle ABCD with its diagonals: the cycle the
  // problem names (ADBA, ABDA, ADCBA); ADCBA, the drawn rectangle, otherwise.
  A['unnamed(4).webp'] = pvCycle(5, (svg) => {
    const m = /\b([A-D]{4,6})\b/.exec(problemText(svg));
    const path = m && m[1][0] === m[1][m[1].length - 1] ? m[1] : 'ADCBA';
    return cycle(svg, path) ? path : 'ADCBA';
  }, { f: 5, adiabatic: [] });

  // P97 – P100 · a → b, then b → c at constant pressure: the arrowheads run
  // along it. Where the problem asks for the work (P99), the area under the
  // path fills in from a to c, stays a moment and fades before the loop
  // starts again: the work done by the gas is that area.
  const abc = pvCycle(3.6, () => 'abc');
  A['unnamed(6).webp'] = Object.assign({}, abc, {
    init(svg) {
      const s = abc.init(svg);
      s.work = svg.querySelector('[data-part="work"]');
      s.axis = geom(s.work)[0];
      const ab = geom(svg.querySelector('[data-seg="ab"]')), bc = geom(svg.querySelector('[data-seg="bc"]'));
      s.pts = [[ab[0], ab[1]], [ab[2], ab[3]], [bc[2], bc[3]]];
      s.area = null;
      return s;
    },
    start(s) {
      abc.start(s);
      if (!/\bwork\b/i.test(problemText(s.svg))) return;
      s.area = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      s.area.setAttribute('fill', 'var(--svg-blue)');
      s.area.setAttribute('fill-opacity', '0.22');
      s.area.setAttribute('stroke', 'none');
      s.work.appendChild(s.area);
    },
    end(s) {
      if (s.area) s.area.remove();
      s.area = null;
    },
    frame(s, u) {
      abc.frame(s, u);
      if (!s.area) return;
      const [a, b, c] = s.pts, x = a[0] + (c[0] - a[0]) * smooth(Math.min(1, u / 0.6));
      const on = (p, q) => p[1] + (q[1] - p[1]) * (x - p[0]) / (q[0] - p[0]);     // the path's height at x
      const edge = x <= b[0] ? [[x, on(a, b)]] : [b, [x, on(b, c)]];
      const pts = [[a[0], s.axis], a, ...edge, [x, s.axis]];
      s.area.setAttribute('d', 'M' + pts.map(([px, py]) => `${f2(px)},${f2(py)}`).join(' L') + ' Z');
      s.area.setAttribute('opacity', String(f2(u <= 0 ? 0 : Math.min(1, (1 - u) / 0.15))));
    },
  });

  // P112 · B → D: the gas is pushed in at constant pressure, cooling as heat
  // leaves it; D → A: pins hold the piston, heat comes in and the pressure
  // rises until the gas is back at its first temperature, on the isotherm
  // through B. The gas cylinder fades in beside the diagram and plays it,
  // with the dot moving along the path.
  A['unnamed(7).webp'] = {
    loop: false, duration: 3.4, hold: 0.9, back: 0.8,
    init(svg) { return { svg, walk: null, gas: null }; },
    start(s) {
      s.walk = cycle(s.svg, 'BDA');
      s.gas = s.walk ? cylinder(s.svg, s.walk, 5, []) : null;
    },
    frame(s, u) {
      if (!s.gas) return;
      if (u <= 0) { s.gas.reset(); return; }
      s.gas.show(smooth(Math.max(0, (u - 0.12) / 0.88)) * s.walk.total, Math.min(1, u / 0.12));
    },
  };

  // P93 · a → c at constant pressure, c → b adiabatic, b → a at constant
  // volume; a diatomic gas (C_p = 29.1 J/(mol K), so f = 5).
  A['unnamed(5).webp'] = pvCycle(5, () => 'acba', { f: 5, adiabatic: ['bc'] });

  // P150 · engine cycle 1 → 2 (constant volume), 2 → 3 (adiabatic), 3 → 1
  // (constant pressure); a diatomic gas.
  A['unnamed(8).webp'] = pvCycle(5, () => '1231', { f: 5, adiabatic: ['23'] });

  (window.FIGURE_ANIMATIONS = window.FIGURE_ANIMATIONS || {})['quiz_4'] = A;
})();
