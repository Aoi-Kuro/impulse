// ─── Animated problem figures ───────────────────────────────────────────────
// A few redrawn figures (js/figure-style.js) have a short qualitative
// animation in course/animations/quizN.js, keyed like the drawings by image
// folder and file name. figure-style.js calls attachFigureAnimation() right
// after it puts a drawing on the page; this wraps the SVG in a .fig-anim span
// with a small play button and speed chip under its right corner (toOriginal
// in figure-style.js unwraps it again).
//
// Two kinds, by spec.loop:
//  - one-shot: plays forward for spec.duration s, holds spec.hold s, runs back
//    quickly in spec.back s and stops on the drawing as published. It cannot
//    be paused: the button stays disabled until it ends.
//  - looped: repeats every spec.period s. Its button turns into pause, and a
//    paused loop runs on to the end of its cycle, which is the drawing as
//    published, before it stops (pressing play again first keeps it going).
//    A flow (heat packets) sets spec.drain: after that last cycle it gets
//    spec.drain s more, with u running on past 1, for what is still under
//    way to run out instead of vanishing.
// spec.init(svg) finds the moving parts (data-part, set in tools/figures)
// and returns the state that spec.frame(state, u) moves: u is the one-shot's
// progress or the loop's phase, 0..1, and 0 is always the published drawing.
// Optional spec.start(state) / spec.end(state) run when playing starts/stops.
// The speed (0.5×, 1×, 2×) is one choice for every figure, kept per device;
// it scales the motion, not the one-shot's hold.
//
// Only FIG_ANIM_MAX_PLAYING loops keep going at once, so a page of played
// figures never keeps the CPU busy: starting a figure asks the longest-running
// loop to finish the way pause does (to the end of its cycle), and so does a
// loop scrolled out of view or hidden with its screen. One-shots end on their
// own within seconds, so they are left to play out and never count.

const FIG_ANIM_MAX_PLAYING = 1;
const FIG_ANIM_SPEEDS = [0.5, 1, 2];
const FIG_ANIM_SPEED_KEY = STORAGE_PREFIX + '-fig-anim-speed';
const FIG_ANIM_SRC_RE = /images\/([^/]+)\/([^/?#]+)$/;
const FIG_ANIM_ICON = {
  play: '<svg viewBox="0 0 16 16" width="10" height="10" aria-hidden="true"><path d="M4.5 2.6v10.8L13.2 8z" fill="currentColor"/></svg>',
  pause: '<svg viewBox="0 0 16 16" width="10" height="10" aria-hidden="true"><path d="M3.8 2.8h3v10.4h-3zM9.2 2.8h3v10.4h-3z" fill="currentColor"/></svg>',
};

let figAnimSpeedChoice = null;          // read once, then kept here (players ask every frame)
const figAnimLoops = [];                // loops playing and not yet told to stop, oldest first

// A playing loop that leaves the viewport (or whose screen is hidden) winds down.
const figAnimView = typeof IntersectionObserver === 'function'
  ? new IntersectionObserver((entries) => {
    entries.forEach((e) => { if (!e.isIntersecting && e.target._figAnimWindDown) e.target._figAnimWindDown(); });
  })
  : null;

// Called as a figure starts or resumes: the oldest other loops beyond the limit finish their cycle.
function figAnimMakeRoom(except) {
  const others = figAnimLoops.filter((p) => p !== except);
  others.slice(0, Math.max(0, others.length - (FIG_ANIM_MAX_PLAYING - 1))).forEach((p) => p.windDown());
}

function figAnimSpeed() {
  if (figAnimSpeedChoice !== null) return figAnimSpeedChoice;
  try {
    const v = parseFloat(localStorage.getItem(FIG_ANIM_SPEED_KEY));
    figAnimSpeedChoice = FIG_ANIM_SPEEDS.includes(v) ? v : 1;
  } catch (e) {
    figAnimSpeedChoice = 1;
  }
  return figAnimSpeedChoice;
}

function figAnimSpeedLabel(v) {
  return v + '×';
}

function figAnimationFor(src) {
  const m = FIG_ANIM_SRC_RE.exec(src || '');
  const all = window.FIGURE_ANIMATIONS;
  return (m && all && all[m[1]] && all[m[1]][m[2]]) || null;
}

function attachFigureAnimation(svg) {
  const spec = figAnimationFor(svg.dataset.figSrc);
  if (!spec) return;
  const wrap = document.createElement('span');
  wrap.className = 'fig-anim';
  svg.replaceWith(wrap);
  wrap.appendChild(svg);
  const bar = document.createElement('span');
  bar.className = 'fig-anim-ctl';
  bar.innerHTML = '<button type="button" class="fig-anim-btn fig-anim-speed" title="Animation speed"></button>' +
                  '<button type="button" class="fig-anim-btn fig-anim-play"></button>';
  wrap.appendChild(bar);
  const speedBtn = bar.firstChild, playBtn = bar.lastChild;
  speedBtn.textContent = figAnimSpeedLabel(figAnimSpeed());

  const state = spec.init(svg);
  let raf = 0, last = 0, u = 0, playing = false, stopping = false, draining = false, stage = 'fwd', held = 0;
  const player = { windDown };
  svg._figAnimWindDown = windDown;      // for figAnimView

  // A loop counts against FIG_ANIM_MAX_PLAYING while it plays and isn't stopping.
  function setCounted(on) {
    const i = figAnimLoops.indexOf(player);
    if (on && i < 0) figAnimLoops.push(player);
    if (!on && i >= 0) figAnimLoops.splice(i, 1);
  }

  function windDown() {
    if (!spec.loop || !playing || stopping) return;
    stopping = true;
    setCounted(false);
    show();
  }

  function release() {
    setCounted(false);
    if (figAnimView) figAnimView.unobserve(svg);
  }

  function show() {
    const pause = spec.loop && playing && !stopping;
    playBtn.innerHTML = pause ? FIG_ANIM_ICON.pause : FIG_ANIM_ICON.play;
    playBtn.setAttribute('aria-label', pause ? 'Pause animation' : 'Play animation');
    playBtn.title = pause ? 'Pause' : 'Play';
    playBtn.classList.toggle('is-playing', playing);
    playBtn.disabled = !spec.loop && playing;
  }

  function stop() {
    playing = false;
    stopping = false;
    draining = false;
    release();
    u = 0;
    spec.frame(state, 0);
    if (spec.end) spec.end(state);
    show();
  }

  function tick(now) {
    if (!svg.isConnected) {             // re-rendered or switched to the original image
      playing = false;
      release();
      return;
    }
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    const k = figAnimSpeed();
    if (spec.loop) {
      u += dt * k / spec.period;
      if (u >= 1 && !draining) {
        if (!stopping) u -= Math.floor(u);
        else if (spec.drain) draining = true;
        else return stop();
      }
      if (draining && u >= 1 + spec.drain / spec.period) return stop();
    } else if (stage === 'fwd') {
      u = Math.min(1, u + dt * k / spec.duration);
      if (u >= 1) { stage = 'hold'; held = 0; }
    } else if (stage === 'hold') {
      held += dt;
      if (held >= spec.hold) stage = 'back';
    } else {
      u = Math.max(0, u - dt * k / spec.back);
      if (u <= 0) return stop();
    }
    spec.frame(state, u);
    raf = requestAnimationFrame(tick);
  }

  playBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (playing) {
      if (!spec.loop) return;
      if (stopping) {                   // play again before the cycle ended: keep going
        stopping = false;
        if (draining) { draining = false; u -= 1; }   // already into the next cycle
        figAnimMakeRoom(player);
        setCounted(true);
        show();
      } else {
        windDown();
      }
      return;
    }
    figAnimMakeRoom(player);
    playing = true;
    stopping = false;
    draining = false;
    if (spec.loop) {
      setCounted(true);
      if (figAnimView) figAnimView.observe(svg);
    }
    u = 0;
    stage = 'fwd';
    if (spec.start) spec.start(state);
    last = performance.now();
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(tick);
    show();
  });

  speedBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const next = FIG_ANIM_SPEEDS[(FIG_ANIM_SPEEDS.indexOf(figAnimSpeed()) + 1) % FIG_ANIM_SPEEDS.length];
    figAnimSpeedChoice = next;
    try { localStorage.setItem(FIG_ANIM_SPEED_KEY, String(next)); } catch (err) { /* private mode: this page only */ }
    document.querySelectorAll('.fig-anim-speed').forEach((b) => { b.textContent = figAnimSpeedLabel(next); });
  });

  show();
}
