// Figure animations for quiz_1, keyed like course/figures/quiz1.js by the
// original image's file name. Played by js/figure-anim.js (see its header for
// the spec shape). The moving parts and their geometry are tagged in
// tools/figures/quiz1.py (data-part, data-geom); everything else in a drawing
// stays where it is. Motion is qualitative: it shows what happens, not the
// numbers the problem asks for.
(function () {
  const A = {};
  const geom = (el) => el.getAttribute('data-geom').trim().split(/\s+/).map(Number);
  const smooth = (u) => u * u * (3 - 2 * u);
  const rad = (deg) => deg * Math.PI / 180;
  const pt = (cx, cy, r, deg) => [cx + r * Math.cos(rad(deg)), cy - r * Math.sin(rad(deg))];
  const f2 = (v) => Math.round(v * 100) / 100;
  const clamp01 = (v) => Math.max(0, Math.min(1, v));
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const part = (svg, k) => svg.querySelector(`[data-part="${k}"]`);

  // The problem's text around the figure, as in course/animations/quiz3.js.
  function problemText(svg) {
    const wrap = svg.closest('.fig-img-wrap');
    const host = wrap && wrap.parentElement;
    if (!host) return '';
    let t = '';
    host.childNodes.forEach((nd) => { if (nd !== wrap) t += nd.textContent; });
    return t.normalize('NFKC').replace(/\\(alpha|theta|mu)\b/g, (m, k) => ({ alpha: 'α', theta: 'θ', mu: 'μ' })[k])
      .replace(/[\u2061-\u2064$_{}]/g, '').replace(/\s+/g, ' ');
  }

  // Remembers attributes of some elements; the returned function puts them back as drawn.
  function keeper(list) {
    const saved = list.map(([el, names]) => [el, names.map((k) => [k, el.getAttribute(k)])]);
    return () => saved.forEach(([el, l]) => l.forEach(([k, v]) => (v === null ? el.removeAttribute(k) : el.setAttribute(k, v))));
  }

  // From rest: a short start, then steady speed (0..1 of the way).
  const steady = (u) => (u < 0.15 ? u * u / 0.3 : u - 0.075) / 0.925;

  // A force arrow added while playing, drawn as Fig.arrow() in
  // tools/figures/svgkit.py draws one, with an optional label.
  function forceArrow(parent, colour, width, label, dash) {
    const g = document.createElementNS(SVG_NS, 'g');
    const line = document.createElementNS(SVG_NS, 'line'), head = document.createElementNS(SVG_NS, 'path');
    line.setAttribute('stroke', colour);
    line.setAttribute('stroke-width', width);
    if (dash) line.setAttribute('stroke-dasharray', dash);
    head.setAttribute('fill', colour);
    g.append(line, head);
    let text = null;
    if (label) {
      text = document.createElementNS(SVG_NS, 'text');
      [['font-size', '14'], ['font-style', 'italic'], ['text-anchor', 'middle'], ['dominant-baseline', 'central'],
       ['fill', colour], ['stroke', 'none']].forEach(([k, v]) => text.setAttribute(k, v));
      text.textContent = label;
      g.append(text);
    }
    parent.appendChild(g);
    return {
      g,
      // tail (x1, y1) to tip (x2, y2), head size; label at (lx, ly)
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
        if (text) { text.setAttribute('x', f2(lx)); text.setAttribute('y', f2(ly)); }
      },
    };
  }

  // P68 · mug sliding off a counter. A copy of the mug slides to the edge
  // and follows the drawn path to where the drawing shows it landing (dimmed
  // meanwhile as the target); on the way back it fades out at the counter.
  A['unnamed(4).webp'] = {
    loop: false, duration: 2.3, hold: 0.7, back: 0.65,
    init(svg) {
      const mug = svg.querySelector('[data-part="mug"]');
      const [x0, top, lx, ly] = geom(mug);
      const m = /translate\(([-\d.]+)[ ,]+([-\d.]+)\)\s*rotate\(([-\d.]+)\)/.exec(mug.getAttribute('transform'));
      return { mug, copy: null, x0, top, lx, ly, ex: +m[1], ey: +m[2], er: +m[3] };
    },
    // opacity as an SVG attribute (not inline style), so ending leaves the markup exactly as drawn
    start(s) {
      s.copy = s.mug.cloneNode(true);
      s.copy.removeAttribute('data-part');
      s.copy.removeAttribute('data-geom');
      s.copy.setAttribute('opacity', '0');
      s.mug.after(s.copy);
      s.mug.setAttribute('opacity', '0.25');
    },
    end(s) {
      if (s.copy) s.copy.remove();
      s.copy = null;
      s.mug.removeAttribute('opacity');
    },
    frame(s, u) {
      if (!s.copy) return;
      const SLIDE = 0.1, run = 20, rest = -13;   // slide 20 units to the edge; the upright mug's base is 13 below its centre
      let x, y, rot;
      if (u <= SLIDE) {
        x = s.x0 - run + run * (u / SLIDE);
        y = s.top + rest;
        rot = 0;
      } else {
        const p = (u - SLIDE) / (1 - SLIDE);     // time in flight: uniform across, falling as p²
        x = s.x0 + (s.lx - s.x0) * p + (s.ex - s.lx) * p;
        y = s.top + (s.ly - s.top) * p * p + rest * (1 - p) + (s.ey - s.ly) * p;
        rot = s.er * p;
      }
      s.copy.setAttribute('opacity', String(Math.min(1, f2(u / SLIDE * 1.5))));
      s.copy.setAttribute('transform', `translate(${f2(x)} ${f2(y)}) rotate(${f2(rot)})`);
    },
  };

  // P123 · two-pulley hoist. The free end is pulled down; the movable
  // pulley, chain and weight rise half as far; the rope follows both wheels.
  A['unnamed(15).webp'] = {
    loop: false, duration: 2.4, hold: 0.7, back: 0.65,
    init(svg) {
      const ropeG = svg.querySelector('[data-part="rope"]');
      const path = ropeG.querySelector('path');
      const [lx, ly, ux, uy, r, end] = geom(ropeG);
      const d0 = path.getAttribute('d');
      const ceil = +/^M[-\d.]+,([-\d.]+)/.exec(d0)[1];
      return { path, d0, lx, ly, ux, uy, r, end, ceil,
               load: [...svg.querySelectorAll('[data-part="load"]')], pull: [...svg.querySelectorAll('[data-part="pull"]')] };
    },
    frame(s, u) {
      if (u <= 0) {
        s.path.setAttribute('d', s.d0);
        s.load.concat(s.pull).forEach((el) => el.removeAttribute('transform'));
        return;
      }
      const pull = 36 * smooth(u), lift = pull / 2, ly = s.ly - lift;
      s.path.setAttribute('d', `M${s.lx - s.r},${s.ceil} L${s.lx - s.r},${f2(ly)} A${s.r},${s.r} 0 0 0 ${s.lx + s.r},${f2(ly)} ` +
        `L${s.ux - s.r},${s.uy} A${s.r},${s.r} 0 0 1 ${s.ux + s.r},${s.uy} L${s.ux + s.r},${f2(s.end + pull)}`);
      s.load.forEach((el) => el.setAttribute('transform', `translate(0 ${f2(-lift)})`));
      s.pull.forEach((el) => el.setAttribute('transform', `translate(0 ${f2(pull)})`));
    },
  };

  // P90 · block m circling on the table (front moving right, as the drawn
  // arrows show); the cord follows it to the hole and M stays at rest. The
  // block grows a little at the front of the circle and shrinks at the back.
  // The labels turn with it: r keeps its place beside the cord and m its
  // place next to the block, each measured along and across the radius as
  // drawn, so they never land on the block, the cord or the table edge.
  A['unnamed(6).webp'] = {
    loop: true, period: 2.8,
    init(svg) {
      const cordG = svg.querySelector('[data-part="cord"]');
      const cord = cordG.querySelector('line');
      const [cx, cy, rx, ry] = geom(cordG);
      const rect = svg.querySelector('[data-part="block"] rect');
      const bx = +rect.getAttribute('x') + +rect.getAttribute('width') / 2;
      const by = +rect.getAttribute('y') + +rect.getAttribute('height') / 2;
      const c0 = ['x1', 'y1', 'x2', 'y2'].map((a) => cord.getAttribute(a));
      const [x1, y1, hx, hy] = c0.map(Number);
      const rLab = svg.querySelector('[data-part="r-label"]'), mLab = svg.querySelector('[data-part="m-label"]');
      const at = (g) => { const t = g.querySelector('text'); return [+t.getAttribute('x'), +t.getAttribute('y')]; };
      // a label's drawn offset from its anchor, in (along the radius, across it) components
      const local = ([lx, ly], ax, ay, dx, dy) => [(lx - ax) * dx + (ly - ay) * dy, (lx - ax) * dy - (ly - ay) * dx];
      const L0 = Math.hypot(hx - x1, hy - y1), dx0 = (hx - x1) / L0, dy0 = (hy - y1) / L0;
      return { cord, c0, cx, cy, rx, ry, bx, by, hx, hy, half: x1 - bx, rLab, mLab,
               rOff: local(at(rLab), (x1 + hx) / 2, (y1 + hy) / 2, dx0, dy0),
               mOff: local(at(mLab), bx, by, -dx0, -dy0),
               block: svg.querySelector('[data-part="block"]') };
    },
    frame(s, u) {
      if (u <= 0) {
        ['x1', 'y1', 'x2', 'y2'].forEach((a, i) => s.cord.setAttribute(a, s.c0[i]));
        [s.block, s.rLab, s.mLab].forEach((el) => el.removeAttribute('transform'));
        return;
      }
      const phi = Math.PI - 2 * Math.PI * u;
      const x = s.cx + s.rx * Math.cos(phi) + (s.bx - (s.cx - s.rx));
      const y = s.cy + s.ry * Math.sin(phi) + (s.by - s.cy);
      const k = 1 + 0.12 * Math.sin(phi);
      s.block.setAttribute('transform', `translate(${f2(x)} ${f2(y)}) scale(${f2(k)}) translate(${-s.bx} ${-s.by})`);
      const L = Math.hypot(s.hx - x, s.hy - y), dx = (s.hx - x) / L, dy = (s.hy - y) / L, h = s.half * k;
      const x1 = x + dx * h, y1 = y + dy * h;
      s.cord.setAttribute('x1', f2(x1));
      s.cord.setAttribute('y1', f2(y1));
      // back from (along, across) to a position: across is the drawn normal (dy, -dx) of the radius direction
      const place = (el, [a, c], ax, ay, ux, uy) => {
        const [x0, y0] = [+el.querySelector('text').getAttribute('x'), +el.querySelector('text').getAttribute('y')];
        const px = ax + a * ux + c * uy, py = ay + a * uy - c * ux;
        el.setAttribute('transform', `translate(${f2(px - x0)} ${f2(py - y0)})`);
      };
      place(s.rLab, s.rOff, (x1 + s.hx) / 2, (y1 + s.hy) / 2, dx, dy);
      place(s.mLab, s.mOff, x, y, -dx, -dy);
    },
  };

  // P92 · conical pendulum. The ball goes round the dashed path the way the
  // blue arrow shows; the string, its angle mark and L follow it.
  A['unnamed(7).webp'] = {
    loop: true, period: 2.6,
    init(svg) {
      const ball = svg.querySelector('[data-part="ball"]');
      const [px, py, cx, cy, rx, ry, a0] = geom(ball);
      const line = svg.querySelector('[data-part="string"] line');
      const arc = svg.querySelector('[data-part="theta-arc"] path');
      const th = svg.querySelector('[data-part="theta"] text');
      const lab = svg.querySelector('[data-part="L"] text');
      const keep = (el, attrs) => attrs.map((a) => el.getAttribute(a));
      return { ball, line, arc, th, lab, px, py, cx, cy, rx, ry, a0,
               bx0: cx + rx * Math.cos(rad(a0)), by0: cy - ry * Math.sin(rad(a0)),
               d0: arc.getAttribute('d'), line0: keep(line, ['x2', 'y2']), th0: keep(th, ['x', 'y']), lab0: keep(lab, ['x', 'y']) };
    },
    frame(s, u) {
      if (u <= 0) {
        s.line.setAttribute('x2', s.line0[0]); s.line.setAttribute('y2', s.line0[1]);
        s.arc.setAttribute('d', s.d0);
        s.th.setAttribute('x', s.th0[0]); s.th.setAttribute('y', s.th0[1]);
        s.lab.setAttribute('x', s.lab0[0]); s.lab.setAttribute('y', s.lab0[1]);
        s.ball.removeAttribute('transform');
        return;
      }
      const a = s.a0 - 360 * u;
      const bx = s.cx + s.rx * Math.cos(rad(a)), by = s.cy - s.ry * Math.sin(rad(a));
      s.line.setAttribute('x2', f2(bx));
      s.line.setAttribute('y2', f2(by));
      const k = (1 - 0.08 * Math.sin(rad(a))) / (1 - 0.08 * Math.sin(rad(s.a0)));   // nearer (front) is larger
      s.ball.setAttribute('transform', `translate(${f2(bx)} ${f2(by)}) scale(${f2(k)}) translate(${f2(-s.bx0)} ${f2(-s.by0)})`);
      const vert = Math.atan2(-(s.cy - s.py), s.cx - s.px) * 180 / Math.PI;
      const ang = Math.atan2(-(by - s.py), bx - s.px) * 180 / Math.PI;
      const [x0, y0] = pt(s.px, s.py, 64, vert), [x1, y1] = pt(s.px, s.py, 64, ang);
      s.arc.setAttribute('d', `M${f2(x0)},${f2(y0)} A64,64 0 ${Math.abs(ang - vert) > 180 ? 1 : 0} ${ang > vert ? 0 : 1} ${f2(x1)},${f2(y1)}`);
      const [tx, ty] = pt(s.px, s.py, 80, (vert + ang) / 2 - 2);
      s.th.setAttribute('x', f2(tx)); s.th.setAttribute('y', f2(ty));
      s.lab.setAttribute('x', f2((s.px + bx) / 2 + 18)); s.lab.setAttribute('y', f2((s.py + by) / 2 - 4));
    },
  };

  // P51 · the plane speeds up from rest at a steady rate (so its distance
  // grows as the square of the time) down the runway into the second
  // plane's place, tilting up as it lifts off. The second plane is dimmed
  // meanwhile, as the target.
  A['unnamed(2).webp'] = {
    loop: false, duration: 2.6, hold: 0.8, back: 0.6,
    init(svg) {
      const plane = part(svg, 'plane-start'), target = part(svg, 'plane-end');
      const [wx, wy, run, tilt] = geom(plane);
      return { plane, target, wx, wy, run, tilt };
    },
    frame(s, u) {
      if (u <= 0) {
        s.plane.removeAttribute('transform');
        s.target.removeAttribute('opacity');
        return;
      }
      const rot = s.tilt * smooth(clamp01((u - 0.82) / 0.18));
      s.plane.setAttribute('transform', `translate(${f2(s.run * u * u)} 0) rotate(${f2(rot)} ${s.wx} ${s.wy})`);
      s.target.setAttribute('opacity', String(f2(1 - 0.75 * clamp01(u / 0.1))));
    },
  };

  // P66 · the shell flies up the dashed path, slowing as it climbs, and
  // bursts at the top. The path is a parabola whose x runs evenly with its
  // parameter, so moving the parameter evenly in time is the true motion:
  // steady across, slowing to nothing upward at the top.
  A['unnamed(3).webp'] = {
    loop: false, duration: 2.6, hold: 0.9, back: 0.6,
    init(svg) {
      const shell = part(svg, 'shell'), burst = part(svg, 'burst');
      const [lx, ly, qx, qy, tx, ty] = geom(shell);
      return { shell, burst, lx, ly, qx, qy, tx, ty };
    },
    frame(s, u) {
      if (u <= 0) {
        s.shell.removeAttribute('transform');
        s.burst.removeAttribute('transform');
        s.burst.removeAttribute('opacity');
        return;
      }
      const FLY = 0.8, t = Math.min(1, u / FLY), m = 1 - t;
      const x = m * m * s.lx + 2 * m * t * s.qx + t * t * s.tx, y = m * m * s.ly + 2 * m * t * s.qy + t * t * s.ty;
      s.shell.setAttribute('transform', `translate(${f2(x - s.tx)} ${f2(y - s.ty)})`);
      const pop = smooth(clamp01((u - FLY) / (1 - FLY)));      // the drawn burst fades as the shell leaves, then blooms
      s.burst.setAttribute('opacity', String(f2(u < FLY ? clamp01(1 - u / 0.06) : pop)));
      s.burst.setAttribute('transform', `translate(${s.tx} ${s.ty}) scale(${f2(0.25 + 0.75 * pop)}) translate(${-s.tx} ${-s.ty})`);
    },
  };

  // A one-shot in which tagged parts slide by fixed amounts along
  // profile(u) (from 0 to 1), and the ends of tagged strings follow.
  function slide(parts, ends, profile) {
    return {
      loop: false, duration: 2.4, hold: 0.8, back: 0.6,
      init(svg) {
        const els = parts.flatMap(([k, dx, dy]) => [...svg.querySelectorAll(`[data-part="${k}"]`)].map((el) => [el, dx, dy]));
        const lines = ends.map(([k, attr, d]) => {
          const l = part(svg, k).querySelector('line');
          return [l, attr, +l.getAttribute(attr), d];
        });
        return { els, lines, reset: keeper([...els.map(([el]) => [el, ['transform']]), ...lines.map(([l, a]) => [l, [a]])]) };
      },
      frame(s, u) {
        if (u <= 0) { s.reset(); return; }
        const p = profile(u);
        s.els.forEach(([el, dx, dy]) => el.setAttribute('transform', `translate(${f2(dx * p)} ${f2(dy * p)})`));
        s.lines.forEach(([l, a, v0, d]) => l.setAttribute(a, f2(v0 + d * p)));
      },
    };
  }
  const fromRest = (u) => u * u;                     // steady acceleration from rest

  // P94 / P95 · m₂ falls and drags m₁ toward the pulley, speeding up. Where
  // m₂ "can be increased smoothly" (P94), its plates go on one at a time
  // first, and only then does it start to move.
  A['unnamed(9).webp'] = {
    loop: false, duration: 2.8, hold: 0.8, back: 0.6,
    init(svg) {
      const sh = part(svg, 'string-h').querySelector('line'), sv = part(svg, 'string-v').querySelector('line');
      const plates = [...svg.querySelectorAll('[data-part="plate"]')];       // top to bottom
      const m1 = part(svg, 'm1'), m2 = part(svg, 'm2');
      const reset = keeper([[sh, ['x1']], [sv, ['y2']], [m1, ['transform']], [m2, ['transform']], ...plates.map((p) => [p, ['opacity']])]);
      const pr = plates[0].querySelector('rect');
      return { svg, sh, sv, m1, m2, plates, reset, load: false, step: +pr.getAttribute('height'),
               x1: +sh.getAttribute('x1'), y2: +sv.getAttribute('y2') };
    },
    start(s) { s.load = /increased/i.test(problemText(s.svg)); },
    frame(s, u) {
      if (u <= 0) { s.reset(); return; }
      let off = 0, p = fromRest(u);                   // plates off the top (0..n-1), how far it has moved
      if (s.load) {
        const n = s.plates.length - 1;
        off = u < 0.08 ? n * smooth(u / 0.08) : n * (1 - clamp01((u - 0.12) / 0.33));
        p = fromRest(clamp01((u - 0.5) / 0.5));
      }
      s.plates.forEach((pl, k) => pl.setAttribute('opacity', String(f2(clamp01(k + 1 - off)))));
      const d = 30 * p;
      s.m1.setAttribute('transform', `translate(${f2(d)} 0)`);
      s.m2.setAttribute('transform', `translate(0 ${f2(d)})`);
      s.sh.setAttribute('x1', f2(s.x1 + d));
      s.sv.setAttribute('y2', f2(s.y2 + off * s.step + d));
    },
  };

  // P96 · F drags m₁ to the left; m₂ rises.
  A['unnamed(10).webp'] = slide([['m1', -30, 0], ['m2', 0, -30]], [['string-h', 'x1', -30], ['string-v', 'y2', -30]], fromRest);

  // P99 / P100 · F pushes both blocks along the frictionless floor together.
  A['unnamed(11).webp'] = slide([['move', 50, 0]], [], fromRest);

  // P102 · F pulls the block along the floor.
  A['unnamed(12).webp'] = slide([['move', 34, 0]], [], fromRest);

  // P127 / P128 / P130 · once set going, m₁ moves at steady speed up the
  // slope, or down it where the problem says so (P128); m₂ the other way.
  A['unnamed(17).webp'] = {
    loop: false, duration: 2.6, hold: 0.7, back: 0.6,
    init(svg) {
      const m1 = part(svg, 'm1'), m2 = part(svg, 'm2'), [ux, uy] = geom(m1);
      const slope = part(svg, 'string-slope').querySelector('line'), sv = part(svg, 'string-v').querySelector('line');
      return { svg, m1, m2, ux, uy, slope, sv, dir: 1, x1: +slope.getAttribute('x1'), y1: +slope.getAttribute('y1'),
               y2: +sv.getAttribute('y2'), reset: keeper([[m1, ['transform']], [m2, ['transform']], [slope, ['x1', 'y1']], [sv, ['y2']]]) };
    },
    start(s) { s.dir = /moves?\s+down\s+the\s+plane/i.test(problemText(s.svg)) ? -1 : 1; },
    frame(s, u) {
      if (u <= 0) { s.reset(); return; }
      const d = 28 * s.dir * steady(u), dx = s.ux * d, dy = s.uy * d;
      s.m1.setAttribute('transform', `translate(${f2(dx)} ${f2(dy)})`);
      s.slope.setAttribute('x1', f2(s.x1 + dx));
      s.slope.setAttribute('y1', f2(s.y1 + dy));
      s.m2.setAttribute('transform', `translate(0 ${f2(d)})`);
      s.sv.setAttribute('y2', f2(s.y2 + d));
    },
  };

  // P131 / P132 / P133 · the weight is hung on gradually. Block A stays
  // put: the cord's pull on it (T) and the static friction holding it (f)
  // grow together, equal and opposite. The dashed mark is as far as static
  // friction can go (μN): the drawn weight takes friction right up to it
  // where the problem asks for the largest weight or the smallest μ, and
  // part of the way when it gives everything (P131).
  A['unnamed(18).webp'] = {
    loop: false, duration: 2.8, hold: 1, back: 0.6,
    init(svg) {
      const weight = part(svg, 'weight'), forces = part(svg, 'forces');
      const [kx, ky] = geom(weight), [hx, hy, bx, by] = geom(forces);
      return { svg, weight, forces, kx, ky, hx, hy, bx, by, ratio: 1, arrows: null };
    },
    start(s) {
      const t = problemText(s.svg), num = (re) => { const m = re.exec(t); return m ? +m[1] : null; };
      const wA = num(/Block\s+A\s+weighs\s+(\d+(?:\.\d+)?)/i), mu = num(/static friction[^.]*?\bis\s+(\d+(?:\.\d+)?)/i);
      const al = num(/α\s*=\s*(\d+(?:\.\d+)?)/), w = num(/weight\s+w\s+is\s+(\d+(?:\.\d+)?)/i);
      s.ratio = wA && mu && al && w ? Math.min(1, w / Math.tan(rad(al)) / (mu * wA)) : 1;   // pull w/tan α against μN
      s.arrows = { limit: forceArrow(s.forces, 'currentColor', 1.2, 'μN', '3 3'),
                   T: forceArrow(s.forces, 'var(--svg-red)', 2, 'T'), f: forceArrow(s.forces, 'var(--svg-red)', 2, 'f') };
      s.arrows.limit.g.setAttribute('opacity', '0');
    },
    end(s) {
      s.forces.replaceChildren();
      s.arrows = null;
    },
    frame(s, u) {
      if (u <= 0) { s.weight.removeAttribute('transform'); return; }
      if (!s.arrows) return;
      // shrinks quickly to a small weight, then is hung on to the full one
      const k = u < 0.1 ? 1 - 0.65 * smooth(u / 0.1) : 0.35 + 0.65 * smooth(clamp01((u - 0.1) / 0.75));
      s.weight.setAttribute('transform', `translate(${s.kx} ${s.ky}) scale(${f2(k)}) translate(${-s.kx} ${-s.ky})`);
      const full = 42, L = full * (u < 0.1 ? 0 : (k - 0.35) / 0.65), lim = Math.min(74, full / s.ratio), fy = s.by + 4;
      s.arrows.T.set(s.hx + 3, s.hy, s.hx + 3 + L, s.hy, 10, s.hx + 3 + L / 2, s.hy - 10);
      s.arrows.f.set(s.bx, fy, s.bx - L, fy, 10, s.bx - L / 2, fy + 13);
      s.arrows.limit.set(s.bx, fy, s.bx - lim, fy, 7, s.bx - lim + 8, fy - 12);
      s.arrows.limit.g.setAttribute('opacity', String(f2(0.8 * clamp01((u - 0.1) / 0.1))));
    },
  };

  // P135 / P136 · F drags B to the left at steady speed. A is held by the
  // cord to the wall (P135), or rides on B where there is no cord (P136).
  function dragB(withA) {
    return slide([['b', -30, 0]].concat(withA ? [['a', -30, 0]] : []), [], steady);
  }
  A['unnamed(19).webp'] = dragB(true);
  A['unnamed(20).webp'] = dragB(false);

  // P143 / P144 / P145 · the car drives round the inside of the loop at
  // steady speed. The wall's push N points to the centre and changes round
  // the loop, mv²/R ± the part of the weight across the wall: biggest at the
  // bottom, smallest at the top; the weight mg stays the same. Sizes go by
  // v²/(gR) from the problem (v, R, g); without a speed (P145, the least
  // speed at the top) N just reaches zero there. The drawn velocity arrow
  // fades out as the car sets off and back in once it is home again, while
  // the forces fade out (spec.drain).
  function carLoop() {
    return {
      loop: true, period: 4, drain: 0.35,
      init(svg) {
        const car = part(svg, 'car'), forces = part(svg, 'forces'), [cx, cy, R, side] = geom(car);
        return { svg, car, forces, velocity: part(svg, 'velocity'), cx, cy, R, side, k: 1, n: null, w: null, loops: 0, last: 0 };
      },
      start(s) {
        const t = problemText(s.svg), num = (re) => { const m = re.exec(t); return m ? +m[1] : null; };
        const v = num(/speed\s+of\s+v\s*=\s*(\d+(?:\.\d+)?)/i), r = num(/radius\s+of\s+(\d+(?:\.\d+)?)\s*m\b/i), g = num(/\bg\s*=\s*(\d+(?:\.\d+)?)/);
        s.k = v && r ? v * v / ((g || 9.8) * r) : 1;
        s.n = forceArrow(s.forces, 'var(--svg-red)', 2.4, 'N');
        s.w = forceArrow(s.forces, 'currentColor', 2, 'mg');
        s.loops = 0;
        s.last = 0;
      },
      end(s) { s.forces.replaceChildren(); },
      frame(s, u) {
        if (u <= 0) {
          s.car.removeAttribute('transform');
          s.velocity.removeAttribute('opacity');
          s.forces.removeAttribute('opacity');
          return;
        }
        if (!s.n) return;
        if (u < s.last) s.loops++;
        s.last = u;
        const home = u > 1 ? clamp01((u - 1) * this.period / this.drain) : 0;   // after the last lap
        s.velocity.setAttribute('opacity', String(f2(u > 1 ? home : s.loops ? 0 : clamp01(1 - u / 0.04))));
        s.forces.setAttribute('opacity', String(f2(1 - home)));
        const turn = -360 * Math.min(u, 1), psi = rad((s.side > 0 ? 90 : -90) + turn);   // the car's place, seen from the centre
        s.car.setAttribute('transform', `rotate(${f2(turn)} ${s.cx} ${s.cy})`);
        const ex = Math.cos(psi), ey = Math.sin(psi), tx = -ey, ty = ex;          // outward; along the wall
        const px = s.cx + ex * (s.R - 16), py = s.cy + ey * (s.R - 16);
        const unit = 70 / (s.k + 1), nLen = Math.max(0, unit * (s.k + ey));       // ey: 1 at the bottom, -1 at the top
        const nx = px - tx * 6, ny = py - ty * 6, wx = px + tx * 6, wy = py + ty * 6;
        s.n.set(nx, ny, nx - ex * nLen, ny - ey * nLen, 10, nx - ex * (nLen + 11), ny - ey * (nLen + 11));
        s.w.set(wx, wy, wx, wy + unit, 9, wx + 14, wy + unit + 4);
      },
    };
  }
  A['unnamed(22).webp'] = carLoop();
  A['unnamed(23).webp'] = carLoop();

  (window.FIGURE_ANIMATIONS = window.FIGURE_ANIMATIONS || {})['quiz_1'] = A;
})();
