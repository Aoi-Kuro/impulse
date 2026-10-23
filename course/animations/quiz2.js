// Figure animations for quiz_2, keyed like course/figures/quiz2.js by the
// original image's file name. Played by js/figure-anim.js (see its header for
// the spec shape). The moving parts and their geometry are tagged in
// tools/figures/quiz2.py (data-part, data-geom); everything else in a drawing
// stays where it is. Motion is qualitative, but where energy decides it
// (tracks, hills, swings) the speed along the way comes from it: faster
// lower down, slowing to rest at the top.
(function () {
  const A = {};
  const geom = (el) => el.getAttribute('data-geom').trim().split(/\s+/).map(Number);
  const smooth = (u) => u * u * (3 - 2 * u);
  const f2 = (v) => Math.round(v * 100) / 100;
  const clamp01 = (v) => Math.max(0, Math.min(1, v));
  const rad = (d) => d * Math.PI / 180;
  const deg = (r) => r * 180 / Math.PI;
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const part = (svg, k) => svg.querySelector(`[data-part="${k}"]`);
  const steady = (u) => (u < 0.15 ? u * u / 0.3 : u - 0.075) / 0.925;   // from rest: a short start, then steady
  const fromRest = (u) => u * u;                                        // steady acceleration from rest
  const move = (el, dx, dy) => el.setAttribute('transform', `translate(${f2(dx)} ${f2(dy)})`);
  const fade = (el, v) => el.setAttribute('opacity', String(f2(clamp01(v))));

  // The problem's text around the figure, as in course/animations/quiz3.js.
  function problemText(svg) {
    const wrap = svg.closest('.fig-img-wrap');
    const host = wrap && wrap.parentElement;
    if (!host) return '';
    let t = '';
    host.childNodes.forEach((nd) => { if (nd !== wrap) t += nd.textContent; });
    return t.normalize('NFKC').replace(/\\(alpha|theta|mu)\b/g, (m, k) => ({ alpha: 'α', theta: 'θ', mu: 'μ' })[k])
      .replace(/[⁡-⁤$_{}]/g, '').replace(/\s+/g, ' ');
  }
  function numberIn(text, re) {
    const m = re.exec(text);
    return m ? +m[1] : null;
  }

  // Remembers attributes of some elements; the returned function puts them back as drawn.
  function keeper(list) {
    const saved = list.filter(([el]) => el).map(([el, names]) => [el, names.map((k) => [k, el.getAttribute(k)])]);
    return () => saved.forEach(([el, l]) => l.forEach(([k, v]) => (v === null ? el.removeAttribute(k) : el.setAttribute(k, v))));
  }

  // A coil spring as Fig.spring() in tools/figures/svgkit.py draws it.
  function coil(x1, x2, y, turns, amp, lead) {
    const x0 = x1 + lead, a = (x2 - lead - x0) / turns, loop = Math.min(a * 0.45, amp * 0.6), steps = 20;
    const pts = [[x1, y]];
    for (let i = 0; i <= turns * steps; i++) {
      const t = i / steps * 2 * Math.PI;
      pts.push([x0 + a * i / steps + loop * (Math.cos(t) - 1), y + amp * Math.sin(t)]);
    }
    pts.push([x2, y]);
    return 'M' + pts.map(([px, py]) => `${f2(px)},${f2(py)}`).join(' L');
  }

  // An arc as Fig.arc() draws it (degrees, maths sense).
  function arcD(cx, cy, r, a0, a1) {
    const x0 = cx + r * Math.cos(rad(a0)), y0 = cy - r * Math.sin(rad(a0));
    const x1 = cx + r * Math.cos(rad(a1)), y1 = cy - r * Math.sin(rad(a1));
    return `M${f2(x0)},${f2(y0)} A${r},${r} 0 ${Math.abs(a1 - a0) > 180 ? 1 : 0} ${a1 > a0 ? 0 : 1} ${f2(x1)},${f2(y1)}`;
  }

  // An arrow added while playing, shaped like Fig.arrow(), with a label.
  function forceArrow(parent, colour, width, label) {
    const g = document.createElementNS(SVG_NS, 'g');
    const line = document.createElementNS(SVG_NS, 'line'), head = document.createElementNS(SVG_NS, 'path');
    line.setAttribute('stroke', colour);
    line.setAttribute('stroke-width', width);
    head.setAttribute('fill', colour);
    const text = document.createElementNS(SVG_NS, 'text');
    [['font-size', '14'], ['font-style', 'italic'], ['text-anchor', 'middle'], ['dominant-baseline', 'central'],
     ['fill', colour], ['stroke', 'none']].forEach(([k, v]) => text.setAttribute(k, v));
    text.textContent = label;
    g.append(line, head, text);
    parent.appendChild(g);
    return {
      set(x1, y1, x2, y2, size, lx, ly) {
        const L = Math.hypot(x2 - x1, y2 - y1);
        g.setAttribute('opacity', L < 3 ? '0' : '1');
        if (L < 3) return;
        const ux = (x2 - x1) / L, uy = (y2 - y1) / L, hl = Math.min(size, L), hw = hl * 0.4;
        const bx = x2 - ux * hl, by = y2 - uy * hl, nx = x2 - ux * hl * 0.72, ny = y2 - uy * hl * 0.72;
        line.setAttribute('x1', f2(x1));
        line.setAttribute('y1', f2(y1));
        line.setAttribute('x2', f2(x2 - ux * hl * 0.6));
        line.setAttribute('y2', f2(y2 - uy * hl * 0.6));
        head.setAttribute('d', `M${f2(x2)},${f2(y2)} L${f2(bx - uy * hw)},${f2(by + ux * hw)} L${f2(nx)},${f2(ny)} ` +
                               `L${f2(bx + uy * hw)},${f2(by - ux * hw)} Z`);
        text.setAttribute('x', f2(lx));
        text.setAttribute('y', f2(ly));
      },
    };
  }

  // Spokes drawn while playing, to show a plain disc turning.
  function spokes(parent, cx, cy, r) {
    const g = document.createElementNS(SVG_NS, 'g');
    g.setAttribute('stroke', 'currentColor');
    g.setAttribute('stroke-width', '1.2');
    g.setAttribute('opacity', '0');
    [90, 210, 330].forEach((a) => {
      const l = document.createElementNS(SVG_NS, 'line');
      [['x1', cx], ['y1', cy], ['x2', f2(cx + (r - 3) * Math.cos(rad(a)))], ['y2', f2(cy - (r - 3) * Math.sin(rad(a)))]]
        .forEach(([k, v]) => l.setAttribute(k, v));
      g.appendChild(l);
    });
    parent.appendChild(g);
    return g;
  }

  // ── Paths and timing ──
  // A path of pieces, sampled every couple of units: { c: [8 numbers], t0 }
  // (a cubic Bézier, from its parameter t0), { l: [x0, y0, x1, y1] }, or
  // { arc: [cx, cy, r, a0, a1] } (degrees, maths sense). at(s) gives the point
  // s along it and the unit tangent there.
  function bezier(c, t) {
    const m = 1 - t;
    return [m * m * m * c[0] + 3 * m * m * t * c[2] + 3 * m * t * t * c[4] + t * t * t * c[6],
            m * m * m * c[1] + 3 * m * m * t * c[3] + 3 * m * t * t * c[5] + t * t * t * c[7]];
  }
  function track(pieces) {
    const pts = [];
    const add = (x, y) => {
      const p = pts[pts.length - 1];
      if (p && Math.hypot(x - p.x, y - p.y) < 1e-6) return;
      pts.push({ x, y, s: p ? p.s + Math.hypot(x - p.x, y - p.y) : 0 });
    };
    pieces.forEach((pc) => {
      let f;
      if (pc.c) f = (k) => bezier(pc.c, (pc.t0 || 0) + (1 - (pc.t0 || 0)) * k);
      else if (pc.l) f = (k) => [pc.l[0] + (pc.l[2] - pc.l[0]) * k, pc.l[1] + (pc.l[3] - pc.l[1]) * k];
      else {
        const [cx, cy, r, a0, a1] = pc.arc;
        f = (k) => { const a = rad(a0 + (a1 - a0) * k); return [cx + r * Math.cos(a), cy - r * Math.sin(a)]; };
      }
      for (let i = 0; i <= 120; i++) add(...f(i / 120));
    });
    const len = pts[pts.length - 1].s;
    const index = (s) => {
      let lo = 1, hi = pts.length - 1;
      while (lo < hi) { const mid = (lo + hi) >> 1; if (pts[mid].s < s) lo = mid + 1; else hi = mid; }
      return lo;
    };
    return {
      pts, len,
      at(s) {
        s = Math.max(0, Math.min(len, s));
        const i = index(s), a = pts[i - 1], b = pts[i], k = (s - a.s) / (b.s - a.s || 1), d = b.s - a.s || 1;
        return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, tx: (b.x - a.x) / d, ty: (b.y - a.y) / d };
      },
      // the distance along it at which x first reaches x0 (for starting where a part is drawn)
      sAtX(x0) { const p = pts.find((q) => q.x >= x0); return p ? p.s : 0; },
    };
  }
  // A rigid block riding a path, both ends of its base (width W) on the path,
  // so it follows curves and tips over corners (and into hollows) the way a
  // real block does, rather than turning with the tangent at one point. s is
  // how far along the path the middle of its base is; side is which side of
  // the direction of travel is "up" for it (1: the left, as for a block
  // moving rightwards on top of a surface). Returns the middle of the block
  // (H tall) and its tilt in degrees. Beyond the path's ends it carries on
  // straight along the end tangents.
  function riding(tr, s, W, H, side) {
    const point = (q) => {
      if (q >= 0 && q <= tr.len) return tr.at(q);
      const e = tr.at(q < 0 ? 0 : tr.len), k = q < 0 ? q : q - tr.len;
      return { x: e.x + e.tx * k, y: e.y + e.ty * k };
    };
    const sf = s + W / 2, f = point(sf);
    let lo = sf - 2 * W, hi = sf;                      // the rear end: the point W from the front
    for (let i = 0; i < 28; i++) {
      const m = (lo + hi) / 2, r = point(m);
      if (Math.hypot(f.x - r.x, f.y - r.y) > W) lo = m; else hi = m;
    }
    const r = point((lo + hi) / 2), dx = (f.x - r.x) / W, dy = (f.y - r.y) / W;
    return { x: (f.x + r.x) / 2 + side * dy * H / 2, y: (f.y + r.y) / 2 - side * dx * H / 2, a: deg(Math.atan2(dy, dx)) };
  }
  // A square looks the same turned by 90°: the turn nearest to none that
  // shows tilt a.
  const squareTurn = (a) => a - 90 * Math.round(a / 90);

  // Moving along tr from s0 to s1 at speed(point): the distance gone at each
  // fraction of the time it takes (and that time, in the speed's units).
  function timing(tr, speed, s0 = 0, s1 = tr.len) {
    const ss = [], ts = [];
    let t = 0, prev = null;
    tr.pts.forEach((p) => {
      if (p.s < s0 - 1e-9 || p.s > s1 + 1e-9) return;
      if (prev) t += (p.s - prev.s) / Math.max((speed(prev) + speed(p)) / 2, 1e-3);
      ss.push(p.s);
      ts.push(t);
      prev = p;
    });
    const at = (f) => {
      const tt = clamp01(f) * t;
      let i = 1;
      while (i < ts.length - 1 && ts[i] < tt) i++;
      const k = (tt - ts[i - 1]) / (ts[i] - ts[i - 1] || 1);
      return ss[i - 1] + (ss[i] - ss[i - 1]) * clamp01(k);
    };
    at.total = t;
    return at;
  }

  // P72 / P73 · ballistic pendulum. The bullet flies into the block and
  // stays in; the block swings up on its strings, keeping level, slowing to
  // rest as high as the dashed h shows.
  A['unnamed.webp'] = A['unnamed(18).webp'] = {
    loop: false, duration: 2.8, hold: 0.8, back: 0.7,
    init(svg) {
      const sg = part(svg, 'strings'), [, , top, bottom] = geom(sg), strings = [...sg.querySelectorAll('line')];
      const block = part(svg, 'block'), bullet = part(svg, 'bullet'), arrow = part(svg, 'v-arrow');
      const x0 = +/^M([-\d.]+)/.exec(bullet.querySelector('path').getAttribute('d'))[1];
      return { strings, top, L: bottom - top, block, bullet, arrow, rise: geom(block)[0], run: geom(bullet)[0] - x0,
               reset: keeper([...strings.map((l) => [l, ['x2', 'y2']]), [block, ['transform']], [bullet, ['transform']],
                              [arrow, ['transform', 'opacity']]]) };
    },
    frame(s, u) {
      if (u <= 0) { s.reset(); return; }
      const HIT = 0.2, f = Math.min(1, u / HIT);
      const phi = Math.acos(1 - s.rise / s.L) * Math.sin(Math.PI / 2 * clamp01((u - HIT) / (1 - HIT)));
      const dx = s.L * Math.sin(phi), dy = -s.L * (1 - Math.cos(phi));
      move(s.block, dx, dy);
      move(s.bullet, s.run * f + dx, dy);
      move(s.arrow, s.run * f, 0);
      fade(s.arrow, (1 - f) / 0.35);
      s.strings.forEach((l) => {
        l.setAttribute('x2', f2(+l.getAttribute('x1') + dx));
        l.setAttribute('y2', f2(s.top + s.L * Math.cos(phi)));
      });
    },
  };

  // P4 / P5 · the particle is pulled up the half-cylinder at steady speed,
  // from the bottom to the top (after sliding back to the bottom to start);
  // the cord over the top, the radius, θ and m go with it.
  A['unnamed(1).webp'] = {
    loop: false, duration: 3, hold: 0.8, back: 0.7,
    init(svg) {
      const p = part(svg, 'particle'), [cx, cy, R, th0] = geom(p);
      const el = { cord: part(svg, 'cord').querySelector('path'), m: part(svg, 'm-label'), radius: part(svg, 'radius').querySelector('line'),
                   r: part(svg, 'r-label'), arc: part(svg, 'theta-arc').querySelector('path'), th: part(svg, 'theta') };
      return { ...el, p, cx, cy, R, th0,
               reset: keeper([[el.cord, ['d']], [p, ['transform']], [el.m, ['transform']], [el.radius, ['x2', 'y2']],
                              [el.r, ['transform']], [el.arc, ['d']], [el.th, ['transform']]]) };
    },
    frame(s, u) {
      if (u <= 0) { s.reset(); return; }
      const th = u < 0.1 ? s.th0 * (1 - smooth(u / 0.1)) : 90 * (u - 0.1) / 0.9;
      const at = (r, a) => [s.cx + r * Math.cos(rad(a)), s.cy - r * Math.sin(rad(a))];
      const carry = (el, r, a, a0) => { const [x, y] = at(r, a), [x0, y0] = at(r, a0); move(el, x - x0, y - y0); };
      carry(s.p, s.R + 9, th, s.th0);
      carry(s.m, s.R + 36, th - 6, s.th0 - 6);
      carry(s.r, 88, th + 12, s.th0 + 12);
      carry(s.th, 68, th / 2, s.th0 / 2);
      const [rx, ry] = at(s.R, th);
      s.radius.setAttribute('x2', f2(rx));
      s.radius.setAttribute('y2', f2(ry));
      s.cord.setAttribute('d', arcD(s.cx, s.cy, s.R + 4, th, 90));
      s.arc.setAttribute('d', arcD(s.cx, s.cy, 52, 0, th));
    },
  };

  // A part (and the near end of a cable) moving at steady speed along the
  // direction in its data-geom.
  function along(name, dist, cable) {
    return {
      loop: false, duration: 2.6, hold: 0.7, back: 0.6,
      init(svg) {
        const g = part(svg, name), [ux, uy] = geom(g), line = cable ? part(svg, cable).querySelector('line') : null;
        return { g, ux, uy, line, x1: line && +line.getAttribute('x1'), y1: line && +line.getAttribute('y1'),
                 reset: keeper([[g, ['transform']], [line, ['x1', 'y1']]]) };
      },
      frame(s, u) {
        if (u <= 0) { s.reset(); return; }
        const d = dist * steady(u);
        move(s.g, s.ux * d, s.uy * d);
        if (s.line) {
          s.line.setAttribute('x1', f2(s.x1 + s.ux * d));
          s.line.setAttribute('y1', f2(s.y1 + s.uy * d));
        }
      },
    };
  }

  // P12 / P13 / P14 · the suitcase, with F, is pulled up the ramp.
  A['unnamed(5).webp'] = along('case', 36);

  // P26 · the engine hauls the block up the incline at steady speed.
  A['unnamed(6).webp'] = along('block', 40, 'cable');

  // P38 / P39 · box, gravel and bucket. Where a worker picks up the gravel
  // (P39) it is lifted off and the bucket, now heavy enough, pulls the box
  // along, speeding up. Otherwise (P38) nothing moves: the cable's pull T and
  // the static friction f on the box grow equal and opposite.
  A['unnamed(7).webp'] = {
    loop: false, duration: 3, hold: 0.9, back: 0.7,
    init(svg) {
      const gravel = part(svg, 'gravel'), box = part(svg, 'box'), bucket = part(svg, 'bucket'), forces = part(svg, 'forces');
      const ch = part(svg, 'cable-h').querySelector('line'), cv = part(svg, 'cable-v').querySelector('line');
      return { svg, gravel, box, bucket, forces, ch, cv, x1: +ch.getAttribute('x1'), y2: +cv.getAttribute('y2'),
               at: geom(forces), lift: false, T: null, f: null,
               reset: keeper([[gravel, ['transform', 'opacity']], [box, ['transform']], [bucket, ['transform']], [ch, ['x1']], [cv, ['y2']]]) };
    },
    start(s) {
      s.lift = /picks up/i.test(problemText(s.svg));
      if (!s.lift) {
        s.T = forceArrow(s.forces, 'var(--svg-red)', 2, 'T');
        s.f = forceArrow(s.forces, 'var(--svg-red)', 2, 'f');
      }
    },
    end(s) {
      s.forces.replaceChildren();
      s.T = s.f = null;
    },
    frame(s, u) {
      if (u <= 0) { s.reset(); return; }
      if (s.lift) {
        const g = smooth(clamp01(u / 0.3)), d = 30 * fromRest(clamp01((u - 0.35) / 0.65));
        move(s.gravel, 0, -28 * g);
        fade(s.gravel, 1 - g);
        move(s.box, d, 0);
        s.ch.setAttribute('x1', f2(s.x1 + d));
        move(s.bucket, 0, d);
        s.cv.setAttribute('y2', f2(s.y2 + d));
      } else if (s.T) {
        const [kx, ky, bx, by] = s.at, L = 40 * smooth(clamp01(u / 0.7));
        s.T.set(kx, ky, kx + L, ky, 10, kx + L / 2, ky - 10);
        s.f.set(bx, by + 5, bx - L, by + 5, 10, bx - L / 2, by + 17);
      }
    },
  };

  // The spring-and-block drawings: what they share.
  function springParts(svg) {
    const sp = part(svg, 'spring'), [sx1, sx2, sy, turns, amp, lead] = geom(sp), block = part(svg, 'block');
    const [bx, fy] = geom(block);
    return { spring: sp.querySelector('path'), sx1, sx2, sy, turns, amp, lead, block, bx, fy, push: part(svg, 'push') };
  }

  // Released from rest, a spring pushes for a quarter of its swing: the block
  // goes E·(1 − cos), leaving at full speed E·π/2 per unit of the push's time.
  const springPush = (E, t) => E * (1 - Math.cos(Math.PI / 2 * clamp01(t)));

  // P40 / P41 · the spring pushes the block off (from rest to full speed as
  // it reaches its natural length), it slides on to the incline, tips onto
  // it and climbs, slowing evenly to a stop.
  A['unnamed(8).webp'] = A['unnamed(9).webp'] = {
    loop: false, duration: 3.2, hold: 0.8, back: 0.7,
    init(svg) {
      const s = springParts(svg), [fx, fy, th] = geom(part(svg, 'incline'));
      return Object.assign(s, { fx, footY: fy, th, reset: keeper([[s.spring, ['d']], [s.block, ['transform']], [s.push, ['opacity']]]) });
    },
    frame(s, u) {
      if (u <= 0) { s.reset(); return; }
      fade(s.push, 1 - u / 0.05);
      const W = 52, E = 24, PUSH = 0.15, UP = 80, gap = s.fx - (s.bx + W), v = E * Math.PI / 2 / PUSH, t = u - 0.05;
      let D;                                             // how far the block's front corner has gone
      if (t <= 0) D = 0;
      else if (t < PUSH) D = springPush(E, t / PUSH);
      else {
        const tc = (gap - E) / v, t2 = t - PUSH;
        if (t2 < tc) D = E + v * t2;
        else {
          const a = v * v / (2 * UP), t3 = Math.min(t2 - tc, v / a);
          D = gap + v * t3 - a * t3 * t3 / 2;
        }
      }
      const c = Math.cos(rad(s.th)), sn = Math.sin(rad(s.th));
      let rx, ry, ang;                                   // the rear bottom corner, the tilt
      if (D <= gap) { rx = s.bx + D; ry = s.fy; ang = 0; } else {
        const a = D - gap;                               // the front corner is a up the incline
        if (a < W) {
          rx = s.fx + a * c - Math.sqrt(W * W - a * a * sn * sn);
          ry = s.fy;
          ang = deg(Math.atan2(-a * sn, s.fx + a * c - rx));
        } else {
          rx = s.fx + (a - W) * c;
          ry = s.footY - (a - W) * sn;
          ang = -s.th;
        }
      }
      s.block.setAttribute('transform', `translate(${f2(rx - s.bx)} ${f2(ry - s.fy)}) rotate(${f2(ang)} ${s.bx} ${s.fy})`);
      s.spring.setAttribute('d', coil(s.sx1, s.sx2 + Math.min(D, E), s.sy, s.turns, s.amp, s.lead));
    },
  };

  // P42 / P50 / P51 · one block, start to finish: the spring pushes it off
  // (from rest to full speed), and it glides on along the table into 2,
  // where 2 shows it (dimmed meanwhile, as the target). On a frictionless
  // surface (P42) it keeps its speed and arrives with the velocity arrow 2
  // shows; with friction (P50, P51) it slows evenly to rest there, the
  // arrow shrinking with its speed. The floors of 1 and 2 are level, so it
  // just carries on across.
  A['unnamed(10).webp'] = A['unnamed(13).webp'] = {
    loop: false, duration: 3, hold: 0.8, back: 0.7,
    init(svg) {
      const s = springParts(svg), block2 = part(svg, 'block2'), v2 = part(svg, 'v2');
      const goal = +block2.querySelector('rect').getAttribute('x');
      return Object.assign(s, { svg, block2, v2, tail: geom(v2), goal, friction: true,
        reset: keeper([[s.spring, ['d']], [s.block, ['transform']], [s.push, ['opacity']], [block2, ['opacity']], [v2, ['transform', 'opacity']]]) });
    },
    start(s) { s.friction = !/frictionless/i.test(problemText(s.svg)); },
    frame(s, u) {
      if (u <= 0) { s.reset(); return; }
      fade(s.push, 1 - u / 0.05);
      fade(s.block2, 1 - 0.8 * clamp01(u / 0.08));
      // timed so that each run ends in time: steady needs less speed than slowing to rest
      const E = 24, glide = s.goal - s.bx - E, PUSH = s.friction ? 0.12 : 0.2, t = u - 0.05;
      const v = E * Math.PI / 2 / PUSH;
      let D, k;                                            // how far it has gone; its speed, as a part of v
      if (t < PUSH) { D = springPush(E, t / PUSH); k = Math.sin(Math.PI / 2 * clamp01(t / PUSH)); } else if (s.friction) {
        const a = v * v / (2 * glide), tt = Math.min(t - PUSH, v / a);
        D = E + v * tt - a * tt * tt / 2; k = 1 - a * tt / v;
      } else {
        D = E + Math.min(glide, v * (t - PUSH)); k = 1;
      }
      s.spring.setAttribute('d', coil(s.sx1, s.sx2 + Math.min(D, E), s.sy, s.turns, s.amp, s.lead));
      move(s.block, D, 0);
      // the velocity arrow rides on the block from the moment it is let go
      const [tx, ty] = s.tail, dx = s.bx + D - s.goal;
      s.v2.setAttribute('transform', `translate(${f2(dx)} 0) translate(${tx} ${ty}) scale(${f2(Math.max(k, 0.01))}) translate(${-tx} ${-ty})`);
      fade(s.v2, t < 0 ? 0 : k / 0.08);
    },
  };

  // P46 · the block drops onto the track, speeds down the curve, crosses
  // the rough flat part losing μL of its height, and climbs the far side
  // only as high as what is left (from h, L and μ in the problem).
  A['unnamed(11).webp'] = {
    loop: false, duration: 3.6, hold: 0.8, back: 0.8,
    init(svg) {
      const block = part(svg, 'block'), c = geom(block), rect = block.querySelector('rect');
      const tr = track([{ c: c.slice(0, 8) }, { l: [c[6], c[7], c[8], c[9]] }, { c: c.slice(8, 16) }]);
      return { svg, block, tr, top: c[1], floor: c[7], flat: [c[6], c[8]], plan: null, end: tr.len,
               cx0: +rect.getAttribute('x') + 13, cy0: +rect.getAttribute('y') + 13, reset: keeper([[block, ['transform']]]) };
    },
    start(s) {
      const t = problemText(s.svg);
      const h = numberIn(t, /height\s+h\s*=\s*(\d+(?:\.\d+)?)\s*cm/i), L = numberIn(t, /L\s*=\s*(\d+(?:\.\d+)?)\s*m\b/);
      const mu = numberIn(t, /friction\s+is\s+(\d+(?:\.\d+)?)/i);
      const loss = (h && L && mu ? Math.min(0.9, mu * L / (h / 100)) : 0.26) * (s.floor - s.top);
      const energy = (p) => (p.y - s.top) - loss * clamp01((p.x - s.flat[0]) / (s.flat[1] - s.flat[0]));
      const stop = s.tr.pts.find((p) => p.x > s.flat[1] && energy(p) <= 0);
      s.end = stop ? stop.s : s.tr.len;
      s.plan = timing(s.tr, (p) => Math.sqrt(Math.max(0, energy(p))), 0, s.end);
    },
    frame(s, u) {
      if (u <= 0 || !s.plan) { s.reset(); return; }
      // riding the inside of the track; from where it is drawn on the ledge
      // it settles onto the track in the first moments
      const b = riding(s.tr, s.plan(u / 0.92), 26, 26, 1), w = smooth(clamp01(u / 0.06));
      const x = s.cx0 + (b.x - s.cx0) * w, y = s.cy0 + (b.y - s.cy0) * w;
      s.block.setAttribute('transform', `translate(${f2(x - s.cx0)} ${f2(y - s.cy0)}) rotate(${f2(squareTurn(b.a) * w)} ${s.cx0} ${s.cy0})`);
    },
  };

  // P47 · the stone leaves A already moving (12 m/s from a 40 m hill, so it
  // has some speed to start with), slides down faster and faster to B, and
  // the rough stretch slows it evenly to rest. It rests on the ground all
  // the way: its middle is its half-height off the surface, across it.
  A['unnamed(12).webp'] = {
    loop: false, duration: 3.2, hold: 0.8, back: 0.7,
    init(svg) {
      const stone = part(svg, 'stone'), c = geom(stone);
      const tr = track([{ c: c.slice(0, 8) }, { c: c.slice(6, 14) }, { c: c.slice(12, 20) }, { l: [c[18], c[19], c[20], c[19]] }]);
      const s = { svg, stone, tr, top: c[1], bottomY: c[19], hillEnd: c[18], end: c[20], plan: null, start: 0, c0: [0, 0], half: 10,
                  reset: keeper([[stone, ['transform']]]) };
      // the stone's middle, resting on the surface at distance q along it
      s.rest = (q) => { const p = tr.at(q); return [p.x + s.half * p.ty, p.y - s.half * p.tx]; };
      return s;
    },
    start(s) {
      const t = problemText(s.svg);
      const v = numberIn(t, /speed of (\d+(?:\.\d+)?)\s*m/i), H = numberIn(t, /hill is (\d+(?:\.\d+)?)\s*m/i), g = numberIn(t, /\bg\s*=\s*(\d+(?:\.\d+)?)/) || 9.8;
      const head = (v && H ? v * v / (2 * g) / H : 0.18) * (s.bottomY - s.top);   // the starting speed, as a height
      const eB = head + (s.bottomY - s.top);
      const energy = (p) => (p.x <= s.hillEnd ? head + (p.y - s.top) : eB * (1 - (p.x - s.hillEnd) / (s.end - s.hillEnd)));
      const b = s.stone.getBBox();
      s.c0 = [b.x + b.width / 2, b.y + b.height / 2];
      s.half = b.height / 2;
      // start at the point of the hill whose resting place is nearest where the stone is drawn
      let best = Infinity;
      s.tr.pts.forEach((p) => {
        if (p.x > s.hillEnd) return;
        const q = s.rest(p.s), d = Math.hypot(q[0] - s.c0[0], q[1] - s.c0[1]);
        if (d < best) { best = d; s.start = p.s; }
      });
      s.plan = timing(s.tr, (p) => Math.sqrt(Math.max(0, energy(p))), s.start, s.tr.len);
    },
    frame(s, u) {
      if (u <= 0 || !s.plan) { s.reset(); return; }
      // in the first moments it settles from where it is drawn onto the hill; from then on it rests on the surface
      const [x, y] = s.rest(s.plan(u / 0.94)), [x0, y0] = s.rest(s.start), w = smooth(clamp01(u / 0.05));
      move(s.stone, x - s.c0[0] - (x0 - s.c0[0]) * (1 - w), y - s.c0[1] - (y0 - s.c0[1]) * (1 - w));
    },
  };

  // P54 / P55 · car A rolls from rest down the drop, round the loop (fastest
  // at the bottom, slowest at the top) and away; the other cars and the
  // arrows step aside while it runs, and it comes back to A for the next run.
  A['unnamed(14).webp'] = A['unnamed(15).webp'] = {
    loop: true, period: 6, drain: 0.4,
    init(svg) {
      const car = part(svg, 'car'), g = geom(car), others = [...svg.querySelectorAll('[data-part="others"]')];
      const inner = car.firstElementChild, m = /translate\(([-\d.]+)[ ,]+([-\d.]+)\)\s*rotate\(([-\d.]+)\)/.exec(inner.getAttribute('transform'));
      const tr = track([{ c: g.slice(0, 8), t0: g[8] }, { arc: [g[9], g[10], g[11], -90, 270] },
                        { c: [g[6], g[7], g[12], g[13], g[14], g[15], g[16], g[17]] }]);
      const y0 = tr.pts[0].y, plan = timing(tr, (p) => Math.sqrt(Math.max(0.5, p.y - y0)));
      return { car, others, tr, plan, x0: +m[1], y0: +m[2], a0: +m[3], loops: 0, last: 0,
               reset: keeper([[car, ['transform', 'opacity']], ...others.map((o) => [o, ['opacity']])]) };
    },
    start(s) { s.loops = 0; s.last = 0; },
    frame(s, u) {
      if (u <= 0) { s.reset(); return; }
      if (u < s.last) s.loops++;
      s.last = u;
      const home = u > 1 ? clamp01((u - 1) * this.period / this.drain) : 0;
      s.others.forEach((o) => fade(o, u > 1 ? home : s.loops ? 0 : 1 - u / 0.05));
      // a run, fading out as it leaves on the right; then back at A, fading in
      const RUN = 0.84;
      if (u < RUN) {
        const k = u / RUN, p = s.tr.at(s.plan(k)), nx = p.ty, ny = -p.tx;   // "up" for the car: off the rail
        const a = deg(Math.atan2(nx, -ny)), x = p.x + nx * 4, y = p.y + ny * 4;
        s.car.setAttribute('transform', `translate(${f2(x)} ${f2(y)}) rotate(${f2(a - s.a0)}) translate(${-s.x0} ${-s.y0})`);
        fade(s.car, (1 - k) / 0.06);
      } else {
        s.car.removeAttribute('transform');
        fade(s.car, u >= 1 ? 1 : (u - 0.9) / 0.1);
      }
    },
  };

  // P58 / P59 · the block slides up the hill, slowing (speed² falls by 2g
  // for every unit it rises). It is rigid, both ends of its base on the
  // ground, so it turns smoothly with the slope and tips over the corner onto
  // the flat top as a real block would. Off the edge it flies over the pit
  // as a projectile and lands on the far side: where the problem asks for
  // the least speed that clears the pit (P58), just past its far edge.
  A['unnamed(16).webp'] = A['unnamed(17).webp'] = {
    loop: false, duration: 3.4, hold: 0.8, back: 0.7,
    init(svg) {
      const block = part(svg, 'block'), g = geom(block), v = part(svg, 'v'), rect = block.querySelector('rect');
      const W = +rect.getAttribute('width'), H = +rect.getAttribute('height'), x0 = +rect.getAttribute('x') + W / 2;
      const tr = track([{ l: [0, g[1], g[0], g[1]] }, { c: g.slice(0, 8) }, { c: g.slice(6, 14) }, { l: [g[12], g[13], g[14], g[13]] }]);
      return { svg, block, v, tr, W, H, x0, base: g[1], top: g[13], edge: g[14], far: g[15], pitEnd: g[16], plan: null,
               reset: keeper([[block, ['transform']], [v, ['opacity']]]) };
    },
    start(s) {
      const least = /minimum speed/i.test(problemText(s.svg));
      s.land = s.pitEnd + s.W / 2 + (least ? 2 : 26);             // the middle of its base, landing
      s.flight = Math.sqrt(2 * (s.far - s.top));                   // in units with g = 1
      s.vTop = (s.land - s.edge) / s.flight;
      const v0sq = s.vTop * s.vTop + 2 * (s.base - s.top);
      s.plan = timing(s.tr, (p) => Math.sqrt(Math.max(0, v0sq - 2 * (s.base - p.y))), s.tr.sAtX(s.x0), s.tr.len);
      s.tSlide = 2 * 10 / s.vTop;                                   // then 10 units to rest
      s.total = s.plan.total + s.flight + s.tSlide;
    },
    frame(s, u) {
      if (u <= 0 || !s.plan) { s.reset(); return; }
      fade(s.v, 1 - u / 0.05);
      const T = clamp01((u - 0.03) / 0.92) * s.total, hill = s.plan.total;
      let x, y, a = 0;
      if (T <= hill) {
        const b = riding(s.tr, s.plan(T / hill), s.W, s.H, 1);
        x = b.x; y = b.y; a = b.a;
      } else if (T <= hill + s.flight) {
        const t = T - hill;
        x = s.edge + s.vTop * t; y = s.top + t * t / 2 - s.H / 2;
      } else {
        const t = Math.min(T - hill - s.flight, s.tSlide), dec = s.vTop / s.tSlide;
        x = s.land + s.vTop * t - dec * t * t / 2; y = s.far - s.H / 2;
      }
      const y0 = s.base - s.H / 2;
      s.block.setAttribute('transform', `translate(${f2(x - s.x0)} ${f2(y - y0)}) rotate(${f2(a)} ${s.x0} ${y0})`);
    },
  };

  // P78 / P79 · the cord is cut: the spring, staying with m₂, pushes the
  // blocks apart, then they glide on. Momentum is shared out: each block's
  // speed goes as the other's mass (from the problem), so m₁ goes further.
  A['unnamed(19).webp'] = A['unnamed(20).webp'] = {
    loop: false, duration: 3, hold: 0.8, back: 0.7,
    init(svg) {
      const sp = part(svg, 'spring'), [x1, x2, y, turns, amp, lead] = geom(sp), path = sp.querySelector('path');
      const rope = part(svg, 'rope'), m1 = part(svg, 'm1'), m2 = part(svg, 'm2');
      return { svg, path, x1, x2, y, turns, amp, lead, rope, m1, m2, share: 0.58,
               reset: keeper([[path, ['d']], [rope, ['opacity']], [m1, ['transform']], [m2, ['transform']]]) };
    },
    start(s) {
      const m = /masses\s+(\d+(?:\.\d+)?)\s*kg\s+and\s+(\d+(?:\.\d+)?)\s*kg/i.exec(problemText(s.svg));
      s.share = m ? +m[2] / (+m[1] + +m[2]) : 0.58;      // m₁'s part of the spread: m₂ / (m₁ + m₂)
    },
    frame(s, u) {
      if (u <= 0) { s.reset(); return; }
      fade(s.rope, 1 - u / 0.05);
      const E = 24, PUSH = 0.55, t = clamp01((u - 0.05) / PUSH), rest = Math.max(0, u - 0.05 - PUSH);
      const spread = springPush(E, t) + E * Math.PI / 2 / PUSH * rest;   // from rest; then gliding at the speed it left with
      const d1 = -spread * s.share, d2 = spread * (1 - s.share);
      move(s.m1, d1, 0);
      move(s.m2, d2, 0);
      const len = s.x2 - s.x1 + springPush(E, t);
      s.path.setAttribute('d', coil(s.x2 + d2 - len, s.x2 + d2, s.y, s.turns, s.amp, s.lead));
    },
  };

  // P111 / P112 · the ball rolls steadily along the floor and up the
  // incline, slowing evenly to rest where the second ball is drawn (dimmed
  // meanwhile, as the target).
  A['unnamed(21).webp'] = A['unnamed(22).webp'] = {
    loop: false, duration: 3, hold: 0.8, back: 0.7,
    init(svg) {
      const ball = part(svg, 'ball'), [x0, y0, fx, fy, th, send] = geom(ball), c = Math.cos(rad(th)), sn = Math.sin(rad(th));
      const r = fy - y0, sc = r * Math.tan(rad(th) / 2), xc = fx + sc * c - r * sn;       // where floor and incline paths meet
      const at = (s) => [fx + s * c - r * sn, fy - s * sn - r * c];
      return { ball, end: part(svg, 'ball-end'), v: part(svg, 'v'), x0, y0, xc, sc, send, at,
               reset: keeper([[ball, ['transform']], [part(svg, 'ball-end'), ['opacity']], [part(svg, 'v'), ['opacity']]]) };
    },
    frame(s, u) {
      if (u <= 0) { s.reset(); return; }
      fade(s.v, 1 - u / 0.05);
      fade(s.end, 1 - 0.7 * clamp01(u / 0.1));
      const Lf = s.xc - s.x0, Li = s.send - s.sc, T = clamp01((u - 0.03) / 0.95) * (Lf + 2 * Li);   // floor at speed 1, then even slowing
      let x, y;
      if (T <= Lf) { x = s.x0 + T; y = s.y0; } else {
        const t = Math.min(T - Lf, 2 * Li), a = 1 / (2 * Li);
        [x, y] = s.at(s.sc + t - a * t * t / 2);
      }
      move(s.ball, x - s.x0, y - s.y0);
    },
  };

  // P130 / P131 · the shell spins about its axis, carrying the two masses on
  // the equator round (dimmer and smaller behind); half a turn per loop,
  // which looks the same again.
  A['unnamed(24).webp'] = A['unnamed(25).webp'] = {
    loop: true, period: 2.4,
    init(svg) {
      const masses = [...svg.querySelectorAll('[data-part="mass"]')].map((g) => ({ g, geo: geom(g) }));
      return { masses, reset: keeper(masses.map(({ g }) => [g, ['transform', 'opacity']])) };
    },
    frame(s, u) {
      if (u <= 0) { s.reset(); return; }
      s.masses.forEach(({ g, geo: [cx, cy, r, b, a0] }) => {
        const a = rad(a0 + 180 * u), x = cx + r * Math.cos(a), y = cy + b * Math.sin(a), k = 1 + 0.15 * Math.sin(a);
        const x0 = cx + r * Math.cos(rad(a0)), y0 = cy + b * Math.sin(rad(a0));
        g.setAttribute('transform', `translate(${f2(x)} ${f2(y)}) scale(${f2(k)}) translate(${f2(-x0)} ${f2(-y0)})`);
        fade(g, 0.68 + 0.32 * Math.sin(a));
      });
    },
  };

  // P132 · the wheel starts to turn the way the net torque does (F₁ points
  // at the centre; F₂'s turn is the stronger): clockwise, faster and faster.
  A['unnamed(26).webp'] = {
    loop: false, duration: 2.6, hold: 0.7, back: 0.6,
    init(svg) {
      const host = part(svg, 'spokes'), [cx, cy, r, dir] = geom(host);
      return { host, cx, cy, r, dir, g: null };
    },
    start(s) { s.g = spokes(s.host, s.cx, s.cy, s.r); },
    end(s) { s.host.replaceChildren(); s.g = null; },
    frame(s, u) {
      if (!s.g) return;
      fade(s.g, u / 0.1);
      const q = clamp01((u - 0.1) / 0.9);
      s.g.setAttribute('transform', `rotate(${f2(-s.dir * 160 * q * q)} ${s.cx} ${s.cy})`);
    },
  };

  // P133 · the bullet flies in at distance d from the axis and sticks at the
  // rim; the cylinder (spokes added) turns with it, steadily, the way ω shows.
  A['unnamed(27).webp'] = {
    loop: false, duration: 3, hold: 0.7, back: 0.6,
    init(svg) {
      const bullet = part(svg, 'bullet'), [x0, y0, cx, cy, r] = geom(bullet), host = part(svg, 'spokes'), v0 = part(svg, 'v0');
      return { bullet, v0, host, x0, cx, cy, r, dir: geom(host)[3], hit: cx - Math.sqrt(r * r - (cy - y0) * (cy - y0)), g: null,
               reset: keeper([[bullet, ['transform']], [v0, ['transform', 'opacity']]]) };
    },
    start(s) { s.g = spokes(s.host, s.cx, s.cy, s.r); },
    end(s) { s.host.replaceChildren(); s.g = null; },
    frame(s, u) {
      if (u <= 0) { s.reset(); return; }
      const FLY = 0.3, f = Math.min(1, u / FLY), run = (s.hit - s.x0) * f, turn = -s.dir * 110 * clamp01((u - FLY) / (1 - FLY));
      s.bullet.setAttribute('transform', `rotate(${f2(turn)} ${s.cx} ${s.cy}) translate(${f2(run)} 0)`);
      move(s.v0, run, 0);
      fade(s.v0, (1 - f) / 0.3);
      if (s.g) {
        fade(s.g, (u - FLY) / 0.06);
        s.g.setAttribute('transform', `rotate(${f2(turn)} ${s.cx} ${s.cy})`);
      }
    },
  };

  // P136 / P137 · the block slides down the curved track, faster as it
  // drops (rigid, both ends of its base on the track), runs along the floor
  // into the dashed square at the rod's lower end and sticks; rod and block
  // swing up together, slowing to rest at θ, exactly onto the dashed
  // outline. Where the block has already struck (P137) it starts at the rod.
  A['unnamed(30).webp'] = {
    loop: false, duration: 3.4, hold: 0.8, back: 0.7,
    init(svg) {
      const rod = part(svg, 'rod'), block = part(svg, 'block'), [ox, oy, th] = geom(rod), [tx, ty, tr, ix, iy] = geom(block);
      const rect = block.querySelector('rect'), W = +rect.getAttribute('width');
      const cx0 = +rect.getAttribute('x') + W / 2, cy0 = +rect.getAttribute('y') + W / 2;
      // the track's middle line, then on along the floor past the rod
      const path = track([{ arc: [tx, ty, tr, 0, -90] }, { l: [tx, ty + tr, ix - 2 * W, ty + tr] }]);
      const s0 = W / 2, s1 = tr * Math.PI / 2 + (tx - ix);           // the base's middle: at the top; under the struck block
      const y0 = path.at(s0).y, plan = timing(path, (p) => Math.sqrt(Math.max(0.3, p.y - y0)), s0, s1);
      return { svg, rod, block, ox, oy, th, ix, iy, cx0, cy0, W, path, plan, full: true,
               reset: keeper([[rod, ['transform']], [block, ['transform', 'opacity']]]) };
    },
    start(s) { s.full = /slides/i.test(problemText(s.svg)); },
    frame(s, u) {
      if (u <= 0) { s.reset(); return; }
      const SWING = s.full ? 0.5 : 0.3;
      if (u < SWING) {
        if (s.full) {
          // from where it is drawn at the top it settles onto the track in the first moments
          const b = riding(s.path, s.plan(u / SWING), s.W, s.W, -1), w = smooth(clamp01(u / 0.06));
          const x = s.cx0 + (b.x - s.cx0) * w, y = s.cy0 + (b.y - s.cy0) * w;
          s.block.setAttribute('transform', `translate(${f2(x - s.cx0)} ${f2(y - s.cy0)}) rotate(${f2(squareTurn(b.a) * w)} ${s.cx0} ${s.cy0})`);
        } else {
          const there = u > 0.15;
          move(s.block, there ? s.ix - s.cx0 : 0, there ? s.iy - s.cy0 : 0);
          fade(s.block, there ? (u - 0.15) / 0.12 : 1 - u / 0.12);
        }
        s.rod.removeAttribute('transform');
        return;
      }
      fade(s.block, 1);
      const phi = s.th * Math.sin(Math.PI / 2 * clamp01((u - SWING) / (1 - SWING)));
      s.rod.setAttribute('transform', `rotate(${f2(phi)} ${s.ox} ${s.oy})`);
      s.block.setAttribute('transform', `rotate(${f2(phi)} ${s.ox} ${s.oy}) translate(${f2(s.ix - s.cx0)} ${f2(s.iy - s.cy0)})`);
    },
  };

  // P144 / P145 · the plane flies into the bar near its top; the bar starts
  // to turn about the hinge (then faster, as it tips), and the plane drops
  // to the ground.
  A['unnamed(31).webp'] = A['unnamed(32).webp'] = {
    loop: false, duration: 2.8, hold: 0.8, back: 0.6,
    init(svg) {
      const bar = part(svg, 'bar'), plane = part(svg, 'plane'), [hx, hy, tip] = geom(bar), [px, bx, ground] = geom(plane);
      return { bar, plane, hx, hy, tip, run: bx - px, px: bx, ground, y: +plane.querySelector('line').getAttribute('y1'),
               reset: keeper([[bar, ['transform']], [plane, ['transform']]]) };
    },
    frame(s, u) {
      if (u <= 0) { s.reset(); return; }
      const HIT = 0.3, q = clamp01((u - HIT) / (1 - HIT));
      s.bar.setAttribute('transform', `rotate(${f2(s.tip * (0.35 * q + 0.65 * q * q))} ${s.hx} ${s.hy})`);
      const drop = (s.ground - s.y) * q * q;
      s.plane.setAttribute('transform', `translate(${f2(s.run * Math.min(1, u / HIT))} ${f2(drop)}) rotate(${f2(28 * q)} ${s.px - s.run} ${s.y})`);
    },
  };

  // P147 / P148 · the string is pulled in steadily: the block spirals
  // inward, faster and faster (keeping its angular momentum, so its speed
  // goes as 1/r and its turning as 1/r²), its velocity arrow growing, until
  // the string breaks and it flies off straight along its path's tangent.
  A['unnamed(33).webp'] = {
    loop: false, duration: 3.6, hold: 0.6, back: 0.7,
    init(svg) {
      const block = part(svg, 'block'), [cx, cy, rx, ry, a0] = geom(block), v = part(svg, 'v'), [tx, ty] = geom(v);
      const line = part(svg, 'string').querySelector('line'), pull = part(svg, 'pull');
      const head = v.querySelector('line'), vAng = deg(Math.atan2(+head.getAttribute('y2') - +head.getAttribute('y1'), +head.getAttribute('x2') - +head.getAttribute('x1')));
      return { block, v, line, pull, cx, cy, rx, ry, a0, tx, ty, vAng,
               reset: keeper([[block, ['transform', 'opacity']], [v, ['transform']], [line, ['x1', 'y1', 'opacity']], [pull, ['transform']]]) };
    },
    frame(s, u) {
      if (u <= 0) { s.reset(); return; }
      const SPIRAL = 0.72, K = 0.45, TURN = 220;              // pulled in to 55%; how fast it turns at the start
      const state = (t) => {                                  // t: 0..1 of the spiral
        const r = 1 - K * t, a = rad(s.a0 - TURN * (1 / r - 1) / K);
        return [s.cx + s.rx * r * Math.cos(a), s.cy - s.ry * r * Math.sin(a), r];
      };
      const [px0, py0] = state(0);
      const t = Math.min(u, SPIRAL) / SPIRAL;
      let [x, y, r] = state(t);
      const [x2, y2] = state(Math.min(1, t + 0.002)), [x1b, y1b] = state(Math.max(0, t - 0.002));
      const vx = (x2 - x1b) / 0.004, vy = (y2 - y1b) / 0.004;  // per unit of spiral time
      if (u > SPIRAL) {
        const [bx, by] = state(1), [bx2, by2] = state(0.998), dt = (u - SPIRAL) / SPIRAL;
        x = bx + (bx - bx2) / 0.002 * dt; y = by + (by - by2) / 0.002 * dt;
      }
      move(s.block, x - px0, y - py0);
      fade(s.block, u > SPIRAL ? 1 - (u - SPIRAL) / (1 - SPIRAL) : 1);
      const [sx, sy] = state(0.002), ang = deg(Math.atan2(vy, vx)) - deg(Math.atan2(sy - py0, sx - px0));   // turned from its start
      const k = Math.min(1.7, 1 / r);
      s.v.setAttribute('transform', `rotate(${f2(ang)} ${s.tx} ${s.ty}) translate(${s.tx} ${s.ty}) scale(${f2(k)}) translate(${-s.tx} ${-s.ty})`);
      s.line.setAttribute('x1', f2(x));
      s.line.setAttribute('y1', f2(y));
      fade(s.line, u > SPIRAL ? 1 - (u - SPIRAL) / 0.04 : 1);
      move(s.pull, 0, 30 * (1 - r));
    },
  };

  (window.FIGURE_ANIMATIONS = window.FIGURE_ANIMATIONS || {})['quiz_2'] = A;
})();
