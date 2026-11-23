/* ═══════════════════════════════════════════════════════════════════
   solve-all-celebrate.js · "Everything solved" overlay for Solve them all
   ───────────────────────────────────────────────────────────────────
   Plays once, the moment the last problem of a Solve them all session
   turns correct (checkSingleProblem in js/quiz-engine.js). A full-screen
   overlay that stays until a tap anywhere or any key:

     0.0 s  one glowing particle per problem leaves the score badge and
            joins a tilted accelerator ring; the two beams run in
            opposite directions and keep speeding up
     1.5 s  the ring squeezes, both beams spiral into the centre
     1.85 s collision: flash, shock fronts, a short shake, sparks, then
            bubble-chamber tracks curling in a magnetic field (charged
            ones spiral as they lose energy, some decay into a V)
     2.0 s  "N/N" lands, ALL SOLVED comes in letter by letter, the set
            name under it

   How it stays smooth (and the same at 60, 120 or 144 Hz):
   • Split by cost. The big full-screen parts (backdrop, glow, flash,
     shake, every piece of text) are CSS transform/opacity animations,
     which the browser's compositor runs on the GPU, off the main thread.
     Only the particles are drawn by script, on two canvases.
   • Nothing depends on the frame rate. Every position is a formula of
     the time since the start: the beams' angles, the sparks (drag), the
     tracks (a velocity turning at ω and decaying at λ has a closed-form
     path). A faster screen just samples the same motion more often.
   • No full-screen work per frame. Trails are drawn from each
     particle's own recent positions, not by fading the whole canvas, and
     strokes are batched (one path per colour and trail step), so a frame
     is a few dozen draw calls whatever the screen size. Glows and
     bubbles are small pre-rendered images, stamped.
   • Live quality. It starts at up to 3× the CSS pixel density and
     watches the frame times; if frames run late it steps down (density,
     trail length, sparks, bubbles), mid-animation, without a jump.
   • The tracks layer is drawn incrementally, never cleared, and fades
     out with a CSS opacity transition. Both canvases are freed when the
     drawing ends (~6.3 s), so the open overlay then holds only text.

   Colours come from the live theme (--accent, --accent2, --correct,
   --partial, --bg, --text). Reduce motion (Settings or the OS) shows
   only the text, with no canvas at all.

   Preview from the console (debug: true logs frame rate and quality):
     playSolveAllCelebration({ total: 24, label: 'Set 4', debug: true })
   ─────────────────────────────────────────────────────────────────── */

(function () {
  'use strict';

  const T_INJECT    = 600;    // a particle's trip from the badge to the ring
  const T_SQUEEZE   = 1500;   // beams start to spiral in
  const T_COLLIDE   = 1850;   // they meet
  const T_TEXT      = 2000;   // keep in step with the CSS delays below
  const T_CUBE      = T_TEXT + 150;     // the logo cube is thrown up
  const T_CUBE_HOP  = T_CUBE + 1800;    // ...and later hops and tumbles
  const T_DRAW_END  = T_COLLIDE + 4500; // canvases stop and are freed
  const T_TAP_OK    = 700;    // taps and keys before this are ignored
  const FADE_OUT_MS = 450;
  const TILT        = 0.36;   // ring seen from above at an angle
  const TRAIL_MS    = 110;    // how far back a beam particle's trail reaches
  const FLASH_PX    = 240;    // the flash element's size before scaling

  // Quality levels, best first. dpr is a cap on the screen's own density.
  const LEVELS = [
    { dpr: 3,    trail: 12, sparks: 110, bubbleEvery: 1 },
    { dpr: 2,    trail: 10, sparks: 90,  bubbleEvery: 1 },
    { dpr: 1.5,  trail: 8,  sparks: 60,  bubbleEvery: 1 },
    { dpr: 1,    trail: 6,  sparks: 40,  bubbleEvery: 2 },
    { dpr: 0.75, trail: 5,  sparks: 25,  bubbleEvery: 3 },
  ];

  let active = null;

  const rand  = (a, b) => a + Math.random() * (b - a);
  const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
  const easeOutCubic = k => 1 - Math.pow(1 - k, 3);

  function reducedMotion () {
    return document.documentElement.classList.contains('settings-reduce-motion')
      || !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  }

  function themeColor (name, fallback) {
    const v = getComputedStyle(document.body).getPropertyValue(name).trim();
    return v || fallback;
  }

  // Any CSS colour → [r, g, b], via the canvas's own colour parser.
  let _parseCtx = null;
  function toRgb (color) {
    _parseCtx = _parseCtx || document.createElement('canvas').getContext('2d');
    _parseCtx.fillStyle = '#000';
    _parseCtx.fillStyle = color;
    const s = _parseCtx.fillStyle;
    if (s[0] === '#') return [1, 3, 5].map(i => parseInt(s.slice(i, i + 2), 16));
    const m = s.match(/[\d.]+/g) || [0, 0, 0];
    return [+m[0], +m[1], +m[2]];
  }
  const rgba = (rgb, a) => `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${a})`;

  /* ── Styles: injected once, when this file loads ───────────────────
     Only transform and opacity are animated (compositor, GPU), except
     the one-off shine sweep over the title. */
  function injectStyle () {
    if (document.getElementById('saCelebrateStyle')) return;
    const style = document.createElement('style');
    style.id = 'saCelebrateStyle';
    style.textContent = `
#saCelebrate {
  position: fixed; inset: 0; z-index: 99998; overflow: hidden;
  cursor: pointer; outline: none; -webkit-tap-highlight-color: transparent;
  transition: opacity ${FADE_OUT_MS}ms ease;
}
#saCelebrate.sac-out { opacity: 0; }
#saCelebrate.sac-out .sac-stage { transform: translate(-50%, -50%) scale(0.96); }
#saCelebrate .sac-backdrop {
  position: absolute; inset: 0; background: var(--bg); opacity: 0.93;
  animation: sac-fade-in 0.4s ease both;
}
#saCelebrate .sac-glow {
  position: absolute; inset: 0; opacity: 0.55;
  background: radial-gradient(circle at 50% 46%, color-mix(in srgb, var(--accent) 20%, transparent) 0, transparent 58%);
  animation: sac-glow 2.4s ease-out ${T_COLLIDE}ms both;
}
#saCelebrate .sac-shake {
  position: absolute; inset: 0;
  animation: sac-shake 0.45s linear ${T_COLLIDE}ms both;
}
#saCelebrate canvas { position: absolute; inset: 0; width: 100%; height: 100%; }
#saCelebrate .sac-tracks { transition: opacity 1.6s ease; }
#saCelebrate .sac-tracks.sac-faded { opacity: 0; }
#saCelebrate .sac-flash {
  position: absolute; left: 50%; top: 46%;
  width: ${FLASH_PX}px; height: ${FLASH_PX}px; margin: -${FLASH_PX / 2}px 0 0 -${FLASH_PX / 2}px;
  border-radius: 50%; opacity: 0; pointer-events: none; will-change: transform, opacity;
  background: radial-gradient(circle, var(--sac-core) 0, color-mix(in srgb, var(--accent) 70%, transparent) 24%,
    color-mix(in srgb, var(--accent) 22%, transparent) 46%, transparent 70%);
  animation: sac-flash 0.7s cubic-bezier(.2, .7, .3, 1) ${T_COLLIDE}ms both;
}
#saCelebrate .sac-stage {
  position: absolute; left: 50%; top: 46%; transform: translate(-50%, -50%);
  width: min(92vw, 640px); text-align: center; pointer-events: none;
  transition: transform ${FADE_OUT_MS}ms ease;
}
#saCelebrate .sac-count {
  font-family: 'Kanit', var(--sans); font-style: italic; font-weight: 900;
  font-size: clamp(3.6rem, 17vw, 8.5rem); line-height: 0.95; color: var(--text);
  font-variant-numeric: tabular-nums; white-space: nowrap;
  animation: sac-count-in 0.75s cubic-bezier(.16, 1, .3, 1) ${T_TEXT}ms backwards;
}
/* Text that zooms in: no will-change, and fill "backwards" only (each
   animation's end is the element's own style). A layer kept for a scale
   animation is rendered once at the animation's largest scale (2.6× for
   the count) and shrunk on screen, which left jagged, staircase edges on
   "24/24" for good. With the animation over and nothing holding the
   layer, the text is drawn again at its real size, sharp. */
/* No text-shadow on the text: the number changes every frame while it
   counts, and blurred shadows made each change a costly repaint (seen at
   ~149 Hz: frames late right as the text came in). The dark halo that
   keeps it readable over the tracks, and the accent glow, are these two
   gradient layers behind the text instead: painted once, then only
   faded and scaled on the compositor. */
#saCelebrate .sac-backing, #saCelebrate .sac-aura {
  position: absolute; left: 50%; top: 46%; pointer-events: none; will-change: transform, opacity;
  width: min(130vw, 980px); height: clamp(300px, 62vh, 560px); margin: 0;
  transform: translate(-50%, -50%);
}
#saCelebrate .sac-backing {
  background: radial-gradient(closest-side, color-mix(in srgb, var(--bg) 92%, transparent) 0,
    color-mix(in srgb, var(--bg) 72%, transparent) 45%, transparent 100%);
  animation: sac-fade-in 0.6s ease ${T_TEXT - 100}ms both;
}
#saCelebrate .sac-aura {
  width: min(90vw, 620px); height: clamp(180px, 34vh, 320px);
  background: radial-gradient(closest-side, color-mix(in srgb, var(--accent) 34%, transparent) 0, transparent 100%);
  animation: sac-aura 1.1s cubic-bezier(.16, 1, .3, 1) ${T_TEXT}ms both;
}
@keyframes sac-aura { from { opacity: 0; transform: translate(-50%, -50%) scale(0.4); } to { opacity: 1; transform: translate(-50%, -50%) scale(1); } }
#saCelebrate .sac-slash { color: var(--accent); margin: 0 0.04em; }
#saCelebrate .sac-title {
  position: relative; display: inline-block; margin-top: 0.2em; perspective: 600px;
  font-family: 'Kanit', var(--sans); font-style: italic; font-weight: 900;
  font-size: clamp(1.5rem, 6.4vw, 3rem); letter-spacing: 0.14em; white-space: nowrap;
  color: var(--text);
}
#saCelebrate .sac-l {
  display: inline-block; transform-origin: 50% 100%;
  animation: sac-letter 0.6s cubic-bezier(.2, 1.3, .4, 1) backwards;
  animation-delay: calc(${T_TEXT + 350}ms + var(--i) * 55ms);
}
#saCelebrate .sac-shine {
  position: absolute; inset: 0; color: transparent; text-shadow: none;
  background: linear-gradient(110deg, transparent 42%, color-mix(in srgb, var(--accent) 35%, #fff) 50%, transparent 58%);
  background-size: 300% 100%; background-position: 100% 0;
  -webkit-background-clip: text; background-clip: text;
  animation: sac-shine 1.2s ease-in-out ${T_TEXT + 1350}ms both;
}
#saCelebrate .sac-rule {
  height: 2px; width: min(60vw, 320px); margin: 0.8rem auto 0;
  background: linear-gradient(90deg, transparent, var(--accent), var(--correct), transparent);
  animation: sac-rule 0.7s cubic-bezier(.16, 1, .3, 1) ${T_TEXT + 900}ms backwards;
}
#saCelebrate .sac-sub {
  margin-top: 0.75rem; font-family: var(--mono); color: var(--muted);
  font-size: clamp(0.78rem, 3.1vw, 1rem); letter-spacing: 0.1em; text-transform: uppercase;
  animation: sac-up 0.6s ease ${T_TEXT + 1150}ms backwards;
}
#saCelebrate .sac-hint {
  position: absolute; left: 0; right: 0; bottom: calc(28px + env(safe-area-inset-bottom, 0px));
  text-align: center; font-family: var(--mono); font-size: 0.75rem; color: var(--muted); opacity: 0.7;
  animation: sac-fade-in 0.8s ease ${T_TEXT + 2400}ms both;
}
/* The logo cube above the count: the same six faces as the top bar's
   tumbling cube (.logo-cube-tilt / -spin / -face in css/style.css, so the
   colours, the database-offline reds included, come from there), only
   bigger. It is thrown up out of the collision spinning three turns, slows
   down like a top losing its spin, lands with a squash, then does the
   logo's own hop and tumble. All transforms: compositor, GPU. */
#saCelebrate .sac-cube-fly {
  --w: clamp(64px, 16vw, 104px); --a: calc(var(--w) / 1.4142136);
  position: relative; width: var(--w); height: calc(var(--a) * 1.6329932);
  margin: 0 auto 0.55rem; transform-origin: 50% 100%;
  animation: sac-cube-fly 1.3s cubic-bezier(.2, .9, .25, 1) ${T_CUBE}ms backwards;
}
/* The fly-in keeps the size near 1: growing a spinning 3D cube from a
   small scale made the browser re-render its faces every frame (seen at
   ~147 Hz: every frame late for the whole fly-in, smooth again the moment
   it landed, and the hop below, which barely scales, stayed smooth). */
#saCelebrate .sac-cube-hop {
  position: absolute; inset: 0; display: grid; place-items: center; transform-origin: 50% 100%;
  animation: sac-cube-hop 1.2s cubic-bezier(.3, .7, .3, 1) ${T_CUBE_HOP}ms;
}
#saCelebrate .sac-cube-fly .logo-cube-spin {
  animation: sac-cube-spin-in 1.3s cubic-bezier(.12, .6, .2, 1) ${T_CUBE}ms backwards,
             sac-cube-tumble 1.2s cubic-bezier(.45, .05, .25, 1) ${T_CUBE_HOP}ms;
}
/* favicon.svg's black hairline, scaled to this size. */
#saCelebrate .sac-cube-fly .logo-cube-face {
  box-shadow: inset 0 0 0 max(0.5px, calc(var(--w) * 0.005)) rgba(0, 0, 0, 0.45);
}
@keyframes sac-cube-fly {
  0%   { opacity: 0; transform: translateY(150%) scale(0.85); }
  14%  { opacity: 1; }
  45%  { transform: translateY(-24%) scale(1.02); }
  62%  { transform: translateY(0) scale(1.08, 0.88); }
  78%  { transform: translateY(-6%) scale(0.98, 1.03); }
  100% { opacity: 1; transform: none; }
}
@keyframes sac-cube-spin-in {
  from { transform: rotateY(1125deg) rotateX(-30deg); }
  to   { transform: rotateY(45deg) rotateX(0); }
}
/* Same moves as logo-cube-hop / logo-cube-tumble in css/style.css. */
@keyframes sac-cube-hop {
  0%   { transform: translateY(0) scale(1, 1); }
  12%  { transform: translateY(4%) scale(1.08, .88); }
  45%  { transform: translateY(-30%) scale(.97, 1.04); }
  72%  { transform: translateY(0) scale(1.08, .9); }
  84%  { transform: translateY(-8%) scale(.99, 1.02); }
  100% { transform: translateY(0) scale(1, 1); }
}
@keyframes sac-cube-tumble {
  from { transform: rotateY(45deg) rotateX(0); }
  to   { transform: rotateY(405deg) rotateX(-360deg); }
}
#saCelebrate.sac-reduced *, #saCelebrate.sac-reduced { animation: none !important; }
@keyframes sac-fade-in { from { opacity: 0; } }
@keyframes sac-glow { from { opacity: 0; } 15% { opacity: 1; } to { opacity: 0.55; } }
@keyframes sac-flash {
  0%   { opacity: 0; transform: scale(0.2); }
  2%   { opacity: 1; transform: scale(0.25); }
  100% { opacity: 0; transform: scale(var(--sac-flash-scale, 8)); }
}
@keyframes sac-shake {
  0%   { transform: translate(0, 0); }
  8%   { transform: translate(-13px, 9px); }
  17%  { transform: translate(11px, -10px); }
  27%  { transform: translate(-9px, -7px); }
  38%  { transform: translate(7px, 8px); }
  50%  { transform: translate(-5px, 4px); }
  63%  { transform: translate(4px, -3px); }
  78%  { transform: translate(-2px, 2px); }
  100% { transform: translate(0, 0); }
}
@keyframes sac-count-in { from { opacity: 0; transform: scale(2.6); } to { opacity: 1; transform: none; } }
@keyframes sac-letter { from { opacity: 0; transform: translateY(0.7em) rotateX(85deg); } to { opacity: 1; transform: none; } }
@keyframes sac-shine { from { background-position: 100% 0; } to { background-position: 0 0; } }
@keyframes sac-rule { from { opacity: 0; transform: scaleX(0); } to { opacity: 1; transform: scaleX(1); } }
@keyframes sac-up { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: none; } }
`;
    document.head.appendChild(style);
  }

  function buildDom (total, label, reduced, core, flashScale) {
    const el = document.createElement('div');
    el.id = 'saCelebrate';
    el.tabIndex = -1;
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-modal', 'true');
    el.setAttribute('aria-label', `All ${total} problems solved`);
    if (reduced) el.classList.add('sac-reduced');
    el.style.setProperty('--sac-core', core);
    el.style.setProperty('--sac-flash-scale', flashScale.toFixed(2));

    const title = 'ALL SOLVED';
    const letters = [...title].map((ch, i) =>
      `<span class="sac-l" style="--i:${i}">${ch === ' ' ? '&nbsp;' : ch}</span>`).join('');
    const sub = label ? `${label} | every answer correct` : 'Every answer correct';

    el.innerHTML = `
      <div class="sac-backdrop"></div>
      <div class="sac-glow"></div>
      <div class="sac-shake">
        ${reduced ? '' : '<canvas class="sac-tracks"></canvas><div class="sac-flash"></div><canvas class="sac-beams"></canvas>'}
        <div class="sac-backing"></div>
        <div class="sac-aura"></div>
        <div class="sac-stage">
          <div class="sac-cube-fly" aria-hidden="true">
            <div class="sac-cube-hop"><span class="logo-cube-tilt"><span class="logo-cube-spin">${
              ['front', 'back', 'right', 'left', 'top', 'bottom'].map(f => `<i class="logo-cube-face logo-cube-${f}"></i>`).join('')
            }</span></span></div>
          </div>
          <div class="sac-count"><span class="sac-num">${reduced ? total : 0}</span><span class="sac-slash">/</span><span class="sac-den">${total}</span></div>
          <div class="sac-title">${letters}<span class="sac-shine" aria-hidden="true">${title}</span></div>
          <div class="sac-rule"></div>
          <div class="sac-sub"></div>
        </div>
      </div>
      <div class="sac-hint">Tap anywhere or press any key to continue</div>`;
    el.querySelector('.sac-sub').textContent = sub;
    return el;
  }

  // Where the particles come from: the floating score badge, if it's on
  // screen, else the bottom centre. CSS pixels.
  function sourcePoint () {
    const badge = document.getElementById('stickyScore');
    const r = badge && badge.getBoundingClientRect();
    if (r && r.width && r.height) return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    return { x: innerWidth / 2, y: innerHeight - 40 };
  }

  // The best level this screen can start at: at most ~8 million canvas
  // pixels, one step lower on devices that report very little memory or
  // very few cores.
  function startLevel () {
    const css = innerWidth * innerHeight;
    const dev = window.devicePixelRatio || 1;
    let lv = 0;
    while (lv < LEVELS.length - 1 && css * Math.pow(Math.min(LEVELS[lv].dpr, dev), 2) > 8.3e6) lv++;
    const nav = window.navigator || {};
    if ((nav.deviceMemory && nav.deviceMemory <= 2) || (nav.hardwareConcurrency && nav.hardwareConcurrency <= 2)) lv = Math.max(lv, 2);
    return lv;
  }

  // Pre-rendered sprites, one per colour: a soft glow with a bright core,
  // and a small bubble.
  function makeSprite (size, stops) {
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const g = c.getContext('2d');
    const h = size / 2;
    const grad = g.createRadialGradient(h, h, 0, h, h, h);
    for (const [at, color] of stops) grad.addColorStop(at, color);
    g.fillStyle = grad;
    g.fillRect(0, 0, size, size);
    return c;
  }

  /* ── The canvas show ─────────────────────────────────────────────── */
  function startCanvas (el, total, t0, colors, debug) {
    const beamsCv  = el.querySelector('.sac-beams');
    const tracksCv = el.querySelector('.sac-tracks');
    const numEl    = el.querySelector('.sac-num');
    const bctx = beamsCv.getContext('2d');
    const tctx = tracksCv.getContext('2d');
    const { light, cA, cB, cC, cP, core } = colors;
    const blend = light ? 'source-over' : 'lighter';

    const rgbCore = toRgb(core);
    // Some themes share colours: each one only once, or it'd draw twice.
    const palette = [...new Set([cA, cB, cC, cP])];
    const beamCols = [...new Set([cA, cB])];
    const glow = {}, bubble = {};
    for (const col of palette) {
      const rgb = toRgb(col);
      glow[col] = makeSprite(128, [[0, rgba(rgbCore, 1)], [0.16, rgba(rgb, 0.95)], [0.42, rgba(rgb, 0.32)], [1, rgba(rgb, 0)]]);
      bubble[col] = makeSprite(16, [[0, rgba(rgb, 1)], [0.45, rgba(rgb, 0.85)], [1, rgba(rgb, 0)]]);
    }

    // Geometry, all in CSS pixels; each context carries the density.
    let Wc = 0, Hc = 0, cx = 0, cy = 0, R = 0, S = 1, maxR = 0, sizeK = 1;
    let level = startLevel(), Q = LEVELS[level], dpr = 1;
    const devDpr = () => window.devicePixelRatio || 1;

    function layout () {
      Wc = innerWidth; Hc = innerHeight;
      cx = Wc / 2; cy = Hc * 0.46;
      R = Math.min(Wc * 0.42, Math.min(Wc, Hc) * 0.48);
      S = Math.min(Wc, Hc) / 450;
      sizeK = clamp(S, 0.8, 1.5);
      maxR = Math.hypot(Math.max(cx, Wc - cx), Math.max(cy, Hc - cy));
    }
    // Resizes both canvases to the current level's density. The beams
    // layer is redrawn whole every frame; the tracks layer is persistent,
    // so what's on it is carried over, scaled.
    function sizeCanvases () {
      dpr = Math.min(Q.dpr, devDpr());
      const w = Math.max(1, Math.round(Wc * dpr)), h = Math.max(1, Math.round(Hc * dpr));
      let copy = null;
      if (tracksCv.width > 1 && (tracksCv.width !== w || tracksCv.height !== h)) {
        copy = document.createElement('canvas');
        copy.width = tracksCv.width; copy.height = tracksCv.height;
        copy.getContext('2d').drawImage(tracksCv, 0, 0);
      }
      beamsCv.width = w; beamsCv.height = h;
      if (tracksCv.width !== w || tracksCv.height !== h) {
        tracksCv.width = w; tracksCv.height = h;
        if (copy) { tctx.drawImage(copy, 0, 0, w, h); copy.width = copy.height = 0; }
      }
      bctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      tctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    layout();
    sizeCanvases();
    function onResize () { layout(); sizeCanvases(); }
    window.addEventListener('resize', onResize);

    const src = sourcePoint();

    // ── Beams: one particle per problem, two counter-rotating beams ──
    const nBeam = clamp(total, 10, 64);
    const stagger = Math.min(18, 420 / nBeam);
    const beam = [];
    for (let i = 0; i < nBeam; i++) {
      const dir = i % 2 ? 1 : -1;
      beam.push({ dir, th0: (i / nBeam) * Math.PI * 4, delay: i * stagger, col: dir > 0 ? cA : cB });
    }
    // Angle travelled by s seconds: ω = 2.5 + 4s² rad/s, ~16 rad/s at the collision.
    const phase = s => 2.5 * s + (4 / 3) * s * s * s;

    // Where particle p is at time t (ms). A pure function of t.
    function beamPos (p, t) {
      const tt = Math.max(t, p.delay);
      let r = R;
      if (tt > T_SQUEEZE) r = R * (1 - Math.pow(clamp((tt - T_SQUEEZE) / (T_COLLIDE - T_SQUEEZE), 0, 1), 2));
      const th = p.th0 + p.dir * phase(tt / 1000);
      let x = cx + r * Math.cos(th), y = cy + r * TILT * Math.sin(th);
      const k = clamp((tt - p.delay) / T_INJECT, 0, 1);
      if (k < 1) {
        const e = easeOutCubic(k);
        x = src.x + (x - src.x) * e;
        y = src.y + (y - src.y) * e;
      }
      return [x, y, Math.sin(th)];
    }

    function drawBeams (t) {
      let r = R;
      if (t > T_SQUEEZE) r = R * (1 - Math.pow(clamp((t - T_SQUEEZE) / (T_COLLIDE - T_SQUEEZE), 0, 1), 2));

      // The ring itself, faint.
      if (r > 1) {
        bctx.globalCompositeOperation = 'source-over';
        bctx.globalAlpha = clamp(t / 400, 0, 1) * (t > T_SQUEEZE ? 0.21 : 0.1);
        bctx.strokeStyle = cA;
        bctx.lineWidth = 1.2;
        bctx.beginPath();
        bctx.ellipse(cx, cy, r, r * TILT, 0, 0, Math.PI * 2);
        bctx.stroke();
      }

      // Trails: K samples back in time per particle, drawn as K-1 bands,
      // each band one path per beam colour (2·(K-1) strokes in all).
      const K = Q.trail;
      const dtS = TRAIL_MS / (K - 1);
      const pts = beam.map(p => {
        const a = [];
        for (let j = 0; j < K; j++) a.push(beamPos(p, t - j * dtS));
        return a;
      });
      bctx.globalCompositeOperation = blend;
      bctx.lineCap = 'round';
      const w0 = 3.2 * sizeK;
      for (let j = 1; j < K; j++) {
        const f = (j - 1) / (K - 1);
        bctx.globalAlpha = Math.pow(1 - f, 1.4) * 0.85;
        bctx.lineWidth = w0 * (1 - 0.7 * f);
        for (const col of beamCols) {
          bctx.strokeStyle = col;
          bctx.beginPath();
          for (let i = 0; i < beam.length; i++) {
            if (beam[i].col !== col || t < beam[i].delay) continue;
            const a = pts[i][j - 1], b = pts[i][j];
            bctx.moveTo(a[0], a[1]); bctx.lineTo(b[0], b[1]);
          }
          bctx.stroke();
        }
      }
      // Heads: a glow sprite each, bigger and brighter nearer the viewer.
      for (let i = 0; i < beam.length; i++) {
        if (t < beam[i].delay) continue;
        const [x, y, z] = pts[i][0];
        const rad = (6.5 + 3.5 * z) * sizeK;
        bctx.globalAlpha = 0.6 + 0.4 * (z + 1) / 2;
        bctx.drawImage(glow[beam[i].col], x - rad, y - rad, rad * 2, rad * 2);
      }
      // Charge building up in the middle just before they meet.
      if (t > T_COLLIDE - 280) {
        const k = clamp((t - (T_COLLIDE - 280)) / 280, 0, 1);
        const rad = (24 + 70 * k) * sizeK;
        bctx.globalAlpha = 0.9 * k;
        bctx.drawImage(glow[cA], cx - rad, cy - rad, rad * 2, rad * 2);
      }
    }

    // ── After the collision ──────────────────────────────────────────
    let sparks = [], tracks = [], collided = false;
    const SPARK_DRAG = 3.2;
    const shocks = [{ at: 0, col: cA, w: 9 }, { at: 0.14, col: cB, w: 6 }, { at: 0.3, col: cC, w: 3 }];

    // A track: velocity v0 turning at om (rad/s) and decaying at lam (1/s).
    // Its path is closed-form: z(t) = z0 + v0·(1 − e^{(iω−λ)t}) / (λ − iω).
    function addTrack (x, y, ang, speed, q, startAt, canDecay, om) {
      const lam = om !== undefined ? rand(0.7, 1.3) : rand(0.35, 1.0);
      if (om === undefined) om = q === 0 ? 0 : q * rand(1.2, 3.6);
      const stopSpeed = 10 * S;
      const tEnd = speed > stopSpeed ? Math.min(3.6, Math.log(speed / stopSpeed) / lam) : 0;
      const decayAt = canDecay && Math.random() < 0.18 ? rand(0.3, 0.9) : null;
      tracks.push({
        x0: x, y0: y, vx: Math.cos(ang) * speed, vy: Math.sin(ang) * speed, lam, om,
        startAt, tEnd, decayAt: decayAt !== null && decayAt < tEnd ? decayAt : null,
        lastT: 0, lx: x, ly: y, gap: 0, nb: 0, dead: false,
        col: q > 0 ? cA : q < 0 ? cB : cC,
      });
    }
    function trackAt (tr, tt) {
      const E = Math.exp(-tr.lam * tt), c = Math.cos(tr.om * tt), s = Math.sin(tr.om * tt);
      const mr = 1 - E * c, mi = -E * s;
      const ux = tr.vx * mr - tr.vy * mi, uy = tr.vx * mi + tr.vy * mr;
      const d = tr.lam * tr.lam + tr.om * tr.om;
      return [tr.x0 + (ux * tr.lam - uy * tr.om) / d, tr.y0 + (ux * tr.om + uy * tr.lam) / d,
        E * (tr.vx * c - tr.vy * s), E * (tr.vx * s + tr.vy * c)];
    }

    function collide () {
      collided = true;
      const nSparks = LEVELS[0].sparks;
      for (let i = 0; i < nSparks; i++) {
        const a = rand(0, Math.PI * 2);
        sparks.push({ ux: Math.cos(a), uy: Math.sin(a), v: rand(400, 1500) * S, life: rand(0.45, 1.1), col: palette[i % palette.length] });
      }
      const nTracks = clamp(30 + Math.round(total / 2), 30, 60);
      for (let i = 0; i < nTracks; i++) {
        addTrack(cx, cy, rand(0, Math.PI * 2), rand(260, 860) * S, [-1, 1, 1, -1, 0][i % 5], rand(0, 0.12), true);
      }
      // A few slow electrons: tight spirals.
      for (let i = 0; i < 5; i++) {
        const q = i % 2 ? 1 : -1;
        addTrack(cx, cy, rand(0, Math.PI * 2), rand(200, 360) * S, q, rand(0, 0.1), false, q * rand(5, 8));
      }
    }

    function drawBlast (since) {
      // Shock fronts: thin rings.
      bctx.globalCompositeOperation = blend;
      for (const sh of shocks) {
        const k = (since - sh.at) / 1.1;
        if (k <= 0 || k >= 1) continue;
        bctx.globalAlpha = Math.pow(1 - k, 1.5) * 0.9;
        bctx.strokeStyle = sh.col;
        bctx.lineWidth = sh.w * (1 - k) + 1;
        bctx.beginPath();
        bctx.arc(cx, cy, easeOutCubic(k) * maxR, 0, Math.PI * 2);
        bctx.stroke();
      }
      // Sparks: streaks along x(t) = v/k·(1 − e^{−kt}), batched per
      // colour and per quarter of remaining life.
      if (since < 1.15) {
        bctx.lineCap = 'round';
        bctx.lineWidth = 1.6;
        const dist = tt => (1 - Math.exp(-SPARK_DRAG * tt)) / SPARK_DRAG;
        const n = Math.min(sparks.length, Q.sparks);
        for (const col of palette) {
          for (let b = 1; b <= 4; b++) {
            bctx.beginPath();
            let any = false;
            for (let i = 0; i < n; i++) {
              const sp = sparks[i];
              if (sp.col !== col || since >= sp.life) continue;
              if (Math.ceil((1 - since / sp.life) * 4) !== b) continue;
              const d1 = dist(since) * sp.v, d0 = dist(Math.max(0, since - 0.03)) * sp.v;
              bctx.moveTo(cx + sp.ux * d0, cy + sp.uy * d0);
              bctx.lineTo(cx + sp.ux * d1, cy + sp.uy * d1);
              any = true;
            }
            if (!any) continue;
            bctx.globalAlpha = b / 4;
            bctx.strokeStyle = col;
            bctx.stroke();
          }
        }
      }
    }

    // Tracks: each frame adds the piece since the last frame (split into
    // short chords so spirals stay round at any frame rate) to the
    // persistent layer, plus bubbles every 5.5 px; heads go on the beams
    // layer.
    function drawTracks (since) {
      const paths = new Map();
      const born = [];
      const heads = [];
      for (const tr of tracks) {
        if (tr.dead || since < tr.startAt) continue;
        let tt = Math.min(since - tr.startAt, tr.tEnd);
        let decays = false;
        if (tr.decayAt !== null && tt >= tr.decayAt) { tt = tr.decayAt; decays = true; }
        if (tt <= tr.lastT) { if (tt >= tr.tEnd) tr.dead = true; continue; }

        let path = paths.get(tr.col);
        if (!path) { path = new Path2D(); paths.set(tr.col, path); }
        const steps = Math.max(1, Math.ceil(Math.abs(tr.om) * (tt - tr.lastT) / 0.08));
        let p = null;
        for (let k = 1; k <= steps; k++) {
          p = trackAt(tr, tr.lastT + (tt - tr.lastT) * k / steps);
          path.moveTo(tr.lx, tr.ly);
          path.lineTo(p[0], p[1]);
          // Bubbles along the chord.
          const seg = Math.hypot(p[0] - tr.lx, p[1] - tr.ly);
          tr.gap += seg;
          while (tr.gap > 5.5) {
            tr.gap -= 5.5;
            if (tr.nb++ % Q.bubbleEvery) continue;
            const f = seg ? 1 - tr.gap / seg : 1;
            const r = rand(1.1, 2.4);
            tctx.globalAlpha = rand(0.55, 0.95);
            tctx.drawImage(bubble[tr.col], tr.lx + (p[0] - tr.lx) * f - r + rand(-0.5, 0.5),
              tr.ly + (p[1] - tr.ly) * f - r + rand(-0.5, 0.5), r * 2, r * 2);
          }
          tr.lx = p[0]; tr.ly = p[1];
        }
        tr.lastT = tt;
        const speed = Math.hypot(p[2], p[3]);
        heads.push([p[0], p[1], clamp(speed / (300 * S), 0.2, 1), tr.col]);

        if (decays) {
          const ang = Math.atan2(p[3], p[2]), open = rand(0.25, 0.6), at = tr.startAt + tr.decayAt;
          born.push([p[0], p[1], ang + open, speed * rand(0.55, 0.85), 1, at]);
          born.push([p[0], p[1], ang - open, speed * rand(0.55, 0.85), -1, at]);
          tr.dead = true;
        } else if (tt >= tr.tEnd || p[0] < -Wc * 0.3 || p[0] > Wc * 1.3 || p[1] < -Hc * 0.3 || p[1] > Hc * 1.3) {
          tr.dead = true;
        }
      }
      for (const [x, y, a, v, q, at] of born) addTrack(x, y, a, v, q, at, false);

      tctx.globalCompositeOperation = blend;
      tctx.globalAlpha = 0.32;
      tctx.lineWidth = 1.1;
      tctx.lineCap = 'round';
      for (const [col, path] of paths) { tctx.strokeStyle = col; tctx.stroke(path); }

      bctx.globalCompositeOperation = blend;
      for (const [x, y, a, col] of heads) {
        const rad = 5 * sizeK;
        bctx.globalAlpha = a;
        bctx.drawImage(glow[col], x - rad, y - rad, rad * 2, rad * 2);
      }
    }

    // ── Live quality: watch frame intervals, step down when late ─────
    const intervals = [];
    const lateWindows = [];   // debug: every window with late frames
    let winStart = 150, winFrames = 0, winLate = 0, period = 0;
    // After a step down, the next window shows whether it helped. If frames
    // are just as late, the slow part isn't the canvas (it was the page's
    // own layers once, at ~147 Hz): the step is undone and quality stays
    // put from then on, rather than blurring the particles for nothing.
    let tried = null, frozen = false;
    // The next level that actually draws fewer pixels on this screen: on a
    // 1.25× screen levels 0–2 are all 1.25×, so stepping 0 → 1 changed
    // nothing that mattered. Its smaller trail and spark counts come along.
    function nextLevel () {
      for (let lv = level + 1; lv < LEVELS.length; lv++) {
        if (Math.min(LEVELS[lv].dpr, devDpr()) < dpr) return lv;
      }
      return level < LEVELS.length - 1 ? LEVELS.length - 1 : level;
    }
    function monitor (iv, t) {
      if (!(iv > 0) || iv > 250) return;              // first frame, or a hidden tab
      intervals.push(iv);
      if (intervals.length >= 8 && (!period || intervals.length % 30 === 0)) {
        const sorted = intervals.slice().sort((a, b) => a - b);
        period = Math.max(4, sorted[Math.floor(sorted.length * 0.1)]); // the screen's refresh interval
      }
      if (!period || t < 150 || t > T_COLLIDE + 3000) return;
      winFrames++;
      if (iv > Math.max(period * 1.45, period + 4) || iv > 25) winLate++;
      if (t - winStart >= 300) {
        const ratio = winFrames ? winLate / winFrames : 0;
        if (debug && winLate) lateWindows.push(`${(winStart / 1000).toFixed(2)}–${(t / 1000).toFixed(2)} s: ${winLate}/${winFrames}`);
        if (tried && winFrames >= 6) {
          if (ratio > 0.35 && ratio > tried.ratio - 0.25) {
            level = tried.from;
            Q = LEVELS[level];
            sizeCanvases();
            frozen = true;
            if (debug) console.info(`[celebrate] ${t.toFixed(0)} ms: still late (${winLate}/${winFrames}), so not the canvas: back to level ${level} (density ${dpr}×), quality fixed from here`);
          }
          tried = null;
        } else if (!frozen && winFrames >= 6 && ratio > 0.35) {
          const lv = nextLevel();
          if (lv !== level) {
            tried = { from: level, ratio };
            level = lv;
            Q = LEVELS[level];
            sizeCanvases();
            if (debug) console.info(`[celebrate] ${t.toFixed(0)} ms: frames late (${winLate}/${winFrames}), quality → level ${level} (density ${dpr}×)`);
          }
        }
        winStart = t; winFrames = 0; winLate = 0;
      }
    }

    let last = 0, raf = 0, stopped = false, tracksFaded = false, shownNum = -1;
    let frames = 0, jsTime = 0;
    function frame (now) {
      if (stopped) return;
      const t = now - t0;
      monitor(last ? now - last : 0, t);
      last = now;
      const js0 = debug ? performance.now() : 0;

      bctx.setTransform(1, 0, 0, 1, 0, 0);
      bctx.clearRect(0, 0, beamsCv.width, beamsCv.height);
      bctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (t < T_COLLIDE) drawBeams(t);
      else {
        if (!collided) collide();
        const since = (t - T_COLLIDE) / 1000;
        drawBlast(since);
        drawTracks(since);
      }
      bctx.globalAlpha = 1;
      tctx.globalAlpha = 1;

      // Count up; the text only changes when the number does.
      const n = Math.round(total * easeOutCubic(clamp((t - T_TEXT) / 900, 0, 1)));
      if (n !== shownNum) { shownNum = n; numEl.textContent = String(n); }

      if (!tracksFaded && t > T_COLLIDE + 2700) {
        tracksFaded = true;
        tracksCv.classList.add('sac-faded');
      }
      if (debug) { frames++; jsTime += performance.now() - js0; }
      if (t > T_DRAW_END) { stop(); return; }
      raf = requestAnimationFrame(frame);
    }
    raf = requestAnimationFrame(frame);

    // Ends the drawing and frees both canvases (and the sprites).
    function stop () {
      if (stopped) return;
      stopped = true;
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', onResize);
      numEl.textContent = String(total);
      for (const cv of [beamsCv, tracksCv]) { cv.width = cv.height = 0; cv.remove(); }
      for (const col of palette) { glow[col].width = glow[col].height = 0; bubble[col].width = bubble[col].height = 0; }
      sparks = []; tracks = [];
      if (debug && frames && intervals.length) {
        const hz = period ? Math.round(1000 / period) : '?';
        console.info(`[celebrate] ${frames} frames, screen ~${hz} Hz, average ${(intervals.reduce((a, b) => a + b, 0) / intervals.length).toFixed(1)} ms per frame, script ${(jsTime / frames).toFixed(2)} ms per frame, final level ${level} (density ${dpr}×)`
          + `\n  late frames by window: ${lateWindows.length ? lateWindows.join(' | ') : 'none'}`);
      }
    }
    return stop;
  }

  /* ── Public entry point ──────────────────────────────────────────── */
  function playSolveAllCelebration (opts) {
    if (active) return;
    opts = opts || {};
    const total = Math.max(1, parseInt(opts.total, 10) || 1);
    const label = opts.label || '';
    const reduced = reducedMotion();

    injectStyle();
    const light = document.body.classList.contains('light');
    const colors = {
      light,
      cA: themeColor('--accent', '#58a6ff'),
      cB: themeColor('--accent2', '#ff8a98'),
      cC: themeColor('--correct', '#3fb950'),
      cP: themeColor('--partial', '#d29922'),
    };
    colors.core = light ? colors.cA : '#ffffff';
    const maxR = Math.hypot(innerWidth / 2, Math.max(innerHeight * 0.46, innerHeight * 0.54));
    const el = buildDom(total, label, reduced, colors.core, (maxR * 2 * 0.85) / FLASH_PX);
    document.body.appendChild(el);
    const t0 = performance.now();
    const prevFocus = document.activeElement;
    try { el.focus({ preventScroll: true }); } catch (e) { /* old browsers */ }

    let stopCanvas = () => {};
    if (!reduced) {
      try { stopCanvas = startCanvas(el, total, t0, colors, !!opts.debug); }
      catch (e) { console.error('Celebration canvas failed:', e); }
    }

    // No timer: it stays until the student taps or presses a key.
    let closing = false;
    function close () {
      if (closing) return;
      closing = true;
      document.removeEventListener('keydown', onKey, true);
      el.classList.add('sac-out');
      setTimeout(() => {
        stopCanvas();
        el.remove();
        active = null;
        if (prevFocus && document.contains(prevFocus) && typeof prevFocus.focus === 'function') {
          try { prevFocus.focus({ preventScroll: true }); } catch (e) { /* ignore */ }
        }
      }, FADE_OUT_MS);
    }
    // Any key closes it, but not a key still held down from the Check
    // that started it (auto-repeat), and not in the first moment.
    function onKey (e) {
      if (e.repeat || performance.now() - t0 <= T_TAP_OK) return;
      e.stopPropagation();
      // Keep browser shortcuts (Ctrl+R, Cmd+W…) working.
      if (!e.ctrlKey && !e.metaKey && !e.altKey) e.preventDefault();
      close();
    }
    el.addEventListener('click', () => { if (performance.now() - t0 > T_TAP_OK) close(); });
    document.addEventListener('keydown', onKey, true);

    active = { close };
  }

  // Ready before the moment it's needed: no style work on the first frame.
  injectStyle();
  window.playSolveAllCelebration = playSolveAllCelebration;
})();
