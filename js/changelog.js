// ── Changelog & Electromagnetic cursor ──────────────────────────────────────

// ── Changelog toggle ────────────────────────────────────────────────────────
let changelogOpen = false;

function toggleChangelog() {
  const panel = document.getElementById('changelogPanel');
  changelogOpen = !changelogOpen;
  panel.classList.toggle('open', changelogOpen);
}

// ── Field lines on/off toggle ─────────────────────────────────────────────
let fieldLinesEnabled = true;

function toggleFieldLines() {
  fieldLinesEnabled = !fieldLinesEnabled;
  const btn = document.getElementById('fieldLinesToggle');
  if (btn) {
    btn.classList.toggle('off', !fieldLinesEnabled);
    btn.title = fieldLinesEnabled ? 'Hide field lines' : 'Show field lines';
  }
  // Immediately clear overlay when turning off
  if (!fieldLinesEnabled) {
    const oc = overlay.getContext('2d');
    oc.clearRect(0, 0, overlay.width, overlay.height);
  }
}

// ── Version indent levels ────────────────────────────────────────────────────
function computeLevels(changelog) {
  const items = [...changelog].reverse();
  const levels = new Array(items.length).fill(0);
  let prevMajor = -1, prevMinor = -1;
  for (let i = 0; i < items.length; i++) {
    const [maj, min] = items[i].version.split('.').map(Number);
    if (maj !== prevMajor)      levels[i] = 0;
    else if (min !== prevMinor) levels[i] = 1;
    else                        levels[i] = 2;
    prevMajor = maj;
    prevMinor = min;
  }
  return levels.reverse();
}

// ── Render the changelog list ────────────────────────────────────────────────
// Each CHANGELOG entry has a `scope`: 0 = shown for every course, or a
// course's own COURSE_CHANGELOG_SCOPE id (js/course-config.js) = shown only
// for that course. When one or more consecutive entries are hidden this
// way between two visible ones, a clickable "⋯ N updates for another
// course ⋯" gap button is shown in their place — hover swaps its text to
// "tap to reveal anyway" and gives it a distinct look (dashed pill, not a
// real row) so it never reads as an actual changelog entry. Clicking it
// reveals ONLY that specific run of hidden entries, in place, leaving any
// other gaps elsewhere in the list untouched. Never shown at the very
// start or end of the list, only strictly between two visible entries.
function renderChangelog() {
  const list = document.getElementById('changelogList');
  if (!list || typeof CHANGELOG === 'undefined') return;

  const scope = (typeof COURSE_CHANGELOG_SCOPE !== 'undefined') ? COURSE_CHANGELOG_SCOPE : null;
  // scope === null (see course-config.js's own check) means "fail open" —
  // no filtering, every entry is treated as visible.
  const isVisible = (entry) => scope == null || entry.scope === 0 || entry.scope === scope;

  const levels   = computeLevels(CHANGELOG);
  const indentPx = [0, 22, 44];
  const frag     = document.createDocumentFragment();
  let prevMajor  = -1;
  let renderedAny = false;
  let latestVisibleVersion = null;

  // Accumulates the current run of hidden entries as its OWN fragment +
  // row count, so each gap's "N updates" count and reveal action are
  // scoped to just that run — not a single flag shared across the whole
  // list. null while not inside a hidden run.
  let hiddenRun = null;

  function buildRow(entry, level) {
    const row = document.createElement('div');
    row.className = `changelog-row level-${level}`;
    row.style.paddingLeft = indentPx[level] + 'px';

    const dot = document.createElement('span');
    dot.className = `changelog-dot level-${level}`;
    row.appendChild(dot);

    const ver = document.createElement('span');
    ver.className = `changelog-ver level-${level}`;
    ver.textContent = entry.version;
    row.appendChild(ver);

    const note = document.createElement('span');
    note.className = 'changelog-note';
    note.textContent = entry.note;
    row.appendChild(note);

    return row;
  }

  function maybeSep(level, maj) {
    if (level === 0 && prevMajor !== -1) {
      const sep = document.createElement('div');
      sep.className = 'changelog-sep';
      return sep;
    }
    return null;
  }

  // Turns the just-finished hidden run into a gap button + a hidden
  // (display:none) container holding its actual rows, appended to the
  // main fragment. Dropped entirely if nothing visible has rendered yet
  // (a hidden run at the very top of the list has no "gap" to represent).
  function flushHiddenRun() {
    if (!hiddenRun) return;
    if (renderedAny) {
      const wrap = hiddenRun.wrap; // starts collapsed
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'changelog-gap';
      const n = hiddenRun.count;
      const restLabel = `⋯ ${n} update${n === 1 ? '' : 's'} for another course ⋯`;
      btn.title = 'Click to reveal these updates anyway';

      const restSpan = document.createElement('span');
      restSpan.className = 'changelog-gap-label changelog-gap-label-rest';
      restSpan.textContent = restLabel;
      const hoverSpan = document.createElement('span');
      hoverSpan.className = 'changelog-gap-label changelog-gap-label-hover';
      hoverSpan.textContent = '⋯ tap to reveal anyway ⋯';
      btn.appendChild(restSpan);
      btn.appendChild(hoverSpan);

      btn.addEventListener('click', () => {
        wrap.style.display = '';
        btn.remove(); // one-shot — this specific gap only, nothing else changes
      }, { once: true });

      frag.appendChild(btn);
      frag.appendChild(wrap);
    }
    hiddenRun = null;
  }

  CHANGELOG.forEach((entry, i) => {
    const [maj] = entry.version.split('.').map(Number);
    const level = levels[i];
    const visible = isVisible(entry);

    if (visible) {
      flushHiddenRun();

      const sep = maybeSep(level, maj);
      if (sep) frag.appendChild(sep);
      prevMajor = maj;

      frag.appendChild(buildRow(entry, level));
      renderedAny = true;
      if (latestVisibleVersion === null) latestVisibleVersion = entry.version;
    } else {
      if (!hiddenRun) {
        const wrap = document.createElement('div');
        wrap.className = 'changelog-hidden-group';
        wrap.style.display = 'none';
        hiddenRun = { wrap, count: 0 };
      }
      const sep = maybeSep(level, maj);
      if (sep) hiddenRun.wrap.appendChild(sep);
      prevMajor = maj;

      hiddenRun.wrap.appendChild(buildRow(entry, level));
      hiddenRun.count++;
    }
  });
  // A hidden run reaching all the way to the end of the list is dropped
  // (hiddenRun left un-flushed) — same "never at the very end" rule as
  // the top-of-list case above.

  list.appendChild(frag);

  // The latest VISIBLE version, not just CHANGELOG[0] — if the true latest
  // entry happens to be scope-filtered out for this course, the button
  // badge would otherwise show a version number that never actually
  // appears in this course's own list.
  if (latestVisibleVersion) {
    const el = document.getElementById('changelogBtnVersion');
    if (el) el.textContent = latestVisibleVersion;
  }
}

// ── Electric field simulation ─────────────────────────────────────────────────
// Two like (+) charges repelling: the changelog button and the mouse cursor
// are both fixed +charges, so field lines diverge away from both rather than
// curving from one into the other. (Used to randomly show a dipole variant
// instead — one +charge, one −charge — but that's been cut; always the same-
// charge repelling pattern now.)
(function () {
  // ── Device pixel ratio ───────────────────────────────────────────────────
  // Read once; on resize events we re-read it so zooming is handled too.
  const CSS_BTN = 32; // logical (CSS) size of the charge canvas in px

  const canvas = document.getElementById('chargeCanvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');

  // Apply DPR scaling to the charge button canvas.
  // We scale ctx ONCE here; drawCharge() then uses CSS coordinates (0…32).
  function setupChargeCanvas() {
    const dpr = window.devicePixelRatio || 1;
    canvas.width        = CSS_BTN * dpr;
    canvas.height       = CSS_BTN * dpr;
    canvas.style.width  = CSS_BTN + 'px';
    canvas.style.height = CSS_BTN + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); // replaces any prior scale
  }
  setupChargeCanvas();

  let cursorX = -9999, cursorY = -9999;
  let smoothCX = -9999, smoothCY = -9999;

  // ── Charge polarity ────────────────────────────────────────────────────────
  // Both the button and the cursor are always +charges (see header comment —
  // the dipole variant that used to appear on a 50/50 coin flip is gone).
  // Kept as a named constant, not a literal `1`/`true`, purely so the sign
  // shows up by name everywhere it's used below (btnCharge/curCharge,
  // drawSign calls).
  const cursorIsPositive = true;

  // ── Overlay canvas (field lines) ─────────────────────────────────────────
  const overlay = document.createElement('canvas');
  overlay.style.cssText = 'position:fixed;top:0;left:0;pointer-events:none;z-index:9990;'; // stays below #update-banner/#bug-report-banner/#theme-nudge-banner (9997-9999) — see their CSS comment
  document.body.appendChild(overlay);

  function resizeOverlay() {
    const dpr = window.devicePixelRatio || 1;
    // Bitmap = physical pixels; CSS size stays at logical pixels
    overlay.width        = Math.round(window.innerWidth  * dpr);
    overlay.height       = Math.round(window.innerHeight * dpr);
    overlay.style.width  = window.innerWidth  + 'px';
    overlay.style.height = window.innerHeight + 'px';
  }
  resizeOverlay();
  window.addEventListener('resize', () => { resizeOverlay(); setupChargeCanvas(); });

  document.addEventListener('mousemove', (e) => {
    cursorX = e.clientX;
    cursorY = e.clientY;
  });

  // ── Theme-aware colour helper ─────────────────────────────────────────────
  // Dark theme: use a bright blue with higher alpha so lines pop on dark bg.
  // Light theme: use deep blue with higher alpha so lines are visible on white.
  // The multipliers below convert the base alpha to theme-appropriate values.
  const LINE_ALPHA_DARK  = 1.4;  // multiply base alpha by this in dark mode
  const LINE_ALPHA_LIGHT = 2;  // multiply base alpha by this in light mode — much more visible

  function lineColor(alpha) {
    const mult = document.body.classList.contains('light') ? LINE_ALPHA_LIGHT : LINE_ALPHA_DARK;
    return cssVarRgba('--accent', Math.min(1, alpha * mult));
  }
  // Colour for the small charge-sign markers (+ on the button, − on the cursor).
  function markerColor(alpha) {
    return document.body.classList.contains('light')
      ? cssVarRgba('--accent', Math.min(1, alpha * LINE_ALPHA_LIGHT))
      : cssVarRgba('--chrome-light', Math.min(1, alpha * LINE_ALPHA_DARK));
  }

  // ── Button glow ────────────────────────────────────────────────────────────
  let glowPhase = 0;

  // Draws using CSS coordinates (ctx already scaled by DPR).
  function drawCharge(dt) {
    const w = CSS_BTN, h = CSS_BTN; // logical size
    ctx.clearRect(0, 0, w, h);

    glowPhase += 0.025 * (dt / 16.667); // normalised to 60 Hz
    const glow = 0.15 + 0.08 * Math.sin(glowPhase);

    const grad = ctx.createRadialGradient(w/2, h/2, 1, w/2, h/2, w/2 - 1);
    grad.addColorStop(0,   cssVarRgba('--accent', 0.50));
    grad.addColorStop(0.5, cssVarRgba('--accent', 0.20));
    grad.addColorStop(1,   cssVarRgba('--accent', 0.03));
    ctx.beginPath();
    ctx.arc(w/2, h/2, w/2 - 1, 0, Math.PI * 2);
    ctx.fillStyle = grad;
    ctx.fill();

    ctx.beginPath();
    ctx.arc(w/2, h/2, w/2 - 1, 0, Math.PI * 2);
    ctx.strokeStyle = cssVarRgba('--accent', 0.45 + glow * 2);
    ctx.lineWidth = 1.2;
    ctx.stroke();

    const cg = ctx.createRadialGradient(w/2, h/2, 0, w/2, h/2, 7);
    cg.addColorStop(0,   cssVar('--chrome-light'));
    cg.addColorStop(0.4, cssVar('--accent'));
    cg.addColorStop(1,   cssVarRgba('--accent', 0));
    ctx.beginPath();
    ctx.arc(w/2, h/2, 7, 0, Math.PI * 2);
    ctx.fillStyle = cg;
    ctx.fill();

    // ── The + sign — this charge is always fixed positive — CSS coords, sharp on all DPR screens ──
    drawSign(ctx, w/2, h/2, true, 3.5, cssVarRgba('--chrome-light', 0.88), 1.5);
  }

  // Draws a + or − sign centred at (cx, cy). Shared by the button icon and
  // the cursor marker so both polarities stay visually consistent.
  function drawSign(c, cx, cy, isPositive, halfLen, strokeStyle, lineWidth) {
    c.strokeStyle = strokeStyle;
    c.lineWidth   = lineWidth;
    c.lineCap     = 'round';
    c.beginPath();
    c.moveTo(cx - halfLen, cy); c.lineTo(cx + halfLen, cy);
    if (isPositive) {
      c.moveTo(cx, cy - halfLen); c.lineTo(cx, cy + halfLen);
    }
    c.stroke();
  }

  // ── Field line tracing ────────────────────────────────────────────────────
  // General two-charge field: each charge is {x, y, sign}, sign is +1 or -1.
  // A +1 charge contributes an outward term, a -1 charge an inward term. This
  // single formula covers both the repelling (same-sign) and dipole
  // (opposite-sign) cases — no branching needed based on which case we're in.
  function efield(px, py, chargeA, chargeB) {
    const dx1 = px - chargeA.x, dy1 = py - chargeA.y;
    const dx2 = px - chargeB.x, dy2 = py - chargeB.y;
    const r1sq = dx1*dx1 + dy1*dy1;
    const r2sq = dx2*dx2 + dy2*dy2;
    const r1   = Math.sqrt(r1sq) || 0.001;
    const r2   = Math.sqrt(r2sq) || 0.001;
    const ex = chargeA.sign * dx1/(r1*r1sq) + chargeB.sign * dx2/(r2*r2sq);
    const ey = chargeA.sign * dy1/(r1*r1sq) + chargeB.sign * dy2/(r2*r2sq);
    const mag = Math.sqrt(ex*ex + ey*ey) || 0.001;
    return { x: ex/mag, y: ey/mag };
  }

  const STEP      = 4;
  const MAX_STEPS = 400;

  // traceLine works in CSS (logical) pixel coordinates.
  // dir = 1 integrates forward along E; dir = -1 integrates backward. Which
  // one to use for a given seed charge is decided by the caller based on that
  // charge's own sign (see drawLinesFromCharge) — forward from a +charge moves
  // away from it (good, long trace); forward from a -charge would immediately
  // collapse inward, so those are seeded with dir = -1 instead.
  function traceLine(sx, sy, chargeA, chargeB, dir) {
    const pts = [{x: sx, y: sy}];
    let x = sx, y = sy;
    const W = window.innerWidth;   // CSS px
    const H = window.innerHeight;  // CSS px
    const pad = 60;

    for (let i = 0; i < MAX_STEPS; i++) {
      const e = efield(x, y, chargeA, chargeB);
      x += dir * e.x * STEP;
      y += dir * e.y * STEP;
      if (x < -pad || x > W + pad || y < -pad || y > H + pad) break;
      pts.push({x, y});
    }
    return pts;
  }

  // ── Arrow marching ────────────────────────────────────────────────────────
  const N_LINES    = 14;
  const LINE_ALPHA = 0.09;   // base alpha; multiplied by LINE_ALPHA_DARK/LIGHT in lineColor()
  const ARROW_SPD  = 0.001;
  let   arrowT     = 0;

  function themeLineWidth(base) {
    return document.body.classList.contains('light') ? base * 1.6 : base;
  }

  function getButtonCenter() {
    const btn = document.getElementById('changelogBtn');
    if (!btn) return null;
    const r = btn.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }

  // All coordinates here are CSS (logical) pixels.
  // The context is pre-scaled to DPR via oc.scale() in drawFieldLines.
  // `seedCharge` is which of chargeA/chargeB the ring is seeded around — its
  // own sign decides trace direction (+charge forward, -charge backward).
  // `chargeA`/`chargeB` (always the same two physical charges) are what the
  // field calc uses, regardless of which one is being seeded.
  function drawLinesFromCharge(oc, seedCharge, chargeA, chargeB, startR, alpha) {
    const angleStep = (Math.PI * 2) / N_LINES;
    const dir = seedCharge.sign; // +1: trace forward, -1: trace backward

    for (let li = 0; li < N_LINES; li++) {
      const angle = li * angleStep;
      const sx = seedCharge.x + Math.cos(angle) * startR;
      const sy = seedCharge.y + Math.sin(angle) * startR;

      let pts = traceLine(sx, sy, chargeA, chargeB, dir);
      if (pts.length < 3) continue;

      // Lines seeded on a -charge are traced backward (outward from it), so
      // reverse the points: field lines physically flow INTO negative charges,
      // so arrows should animate toward the charge, not away from it.
      if (dir === -1) pts = pts.slice().reverse();

      oc.beginPath();
      oc.moveTo(pts[0].x, pts[0].y);
      for (let s = 1; s < pts.length; s++) oc.lineTo(pts[s].x, pts[s].y);
      oc.strokeStyle = lineColor(alpha);
      oc.lineWidth   = themeLineWidth(0.85);
      oc.setLineDash([]);
      oc.stroke();

      const nArrows = 2;
      for (let ai = 0; ai < nArrows; ai++) {
        const phaseBase = (li / N_LINES) * 0.55;
        const t = ((arrowT + ai / nArrows + phaseBase) % 1);

        // Interpolate smoothly between adjacent points instead of snapping
        const fIdx = t * (pts.length - 2);
        const idx  = Math.min(Math.floor(fIdx), pts.length - 3);
        const frac = fIdx - idx; // 0..1 sub-step fraction
        if (idx < 0) continue;

        const px  = pts[idx].x   + (pts[idx+1].x - pts[idx].x)   * frac;
        const py  = pts[idx].y   + (pts[idx+1].y - pts[idx].y)   * frac;
        const nx  = pts[idx+1].x + (pts[idx+2].x - pts[idx+1].x) * frac;
        const ny  = pts[idx+1].y + (pts[idx+2].y - pts[idx+1].y) * frac;
        const ang = Math.atan2(ny - py, nx - px);

        const fade   = Math.sin(Math.PI * t);
        const aAlpha = alpha * 2.2 * fade;
        if (aAlpha < 0.004) continue;

        oc.save();
        oc.translate(px, py);
        oc.rotate(ang);
        oc.beginPath();
        oc.moveTo(-5, -2.5);
        oc.lineTo( 0,  0);
        oc.lineTo(-5,  2.5);
        oc.strokeStyle = lineColor(aAlpha);
        oc.lineWidth   = themeLineWidth(1);
        oc.lineJoin    = 'round';
        oc.stroke();
        oc.restore();
      }
    }
  }

  // ── Main draw ─────────────────────────────────────────────────────────────
  function drawFieldLines(dt) {
    const dpr = window.devicePixelRatio || 1;
    const oc  = overlay.getContext('2d');

    // Always clear first so lines disappear as soon as conditions aren't met
    oc.clearRect(0, 0, overlay.width, overlay.height);

    // Don't render if: changelog is closed, user toggled lines off,
    // or the landing screen is no longer visible (user entered the quiz).
    if (!changelogOpen) return;
    if (!fieldLinesEnabled) return;
    const landing = document.getElementById('landingScreen');
    if (landing && landing.classList.contains('hidden')) return;

    if (cursorX < -100) return;

    const btn = getButtonCenter();
    if (!btn) return;

    const dist = Math.hypot(cursorX - btn.x, cursorY - btn.y);
    if (dist < 20) return;

    const lerpSpeed = 0.055;
    if (smoothCX < -100) { smoothCX = cursorX; smoothCY = cursorY; }
    smoothCX += (cursorX - smoothCX) * lerpSpeed;
    smoothCY += (cursorY - smoothCY) * lerpSpeed;

    arrowT = (arrowT + ARROW_SPD * dt) % 1;

    // Scale to physical pixels so all CSS coordinates hit the right pixels
    oc.save();
    oc.scale(dpr, dpr);

    // Both charges are always +1 (see "Charge polarity" above) — lines
    // diverge away from both rather than curving from one into the other.
    // efield()/drawLinesFromCharge() take signed charges generically, so
    // nothing here branches on that; it's just always same-sign now.
    const btnCharge = { x: btn.x, y: btn.y, sign: 1 };
    const curCharge = { x: smoothCX, y: smoothCY, sign: cursorIsPositive ? 1 : -1 };
    drawLinesFromCharge(oc, btnCharge, btnCharge, curCharge, 13, LINE_ALPHA);
    drawLinesFromCharge(oc, curCharge, btnCharge, curCharge, 9,  LINE_ALPHA * 0.75);

    // Cursor charge marker (whichever sign the coin flip gave it)
    const cAlpha = Math.min(1, (dist - 20) / 80) * 0.5;
    if (cAlpha > 0.01) {
      oc.beginPath();
      oc.arc(smoothCX, smoothCY, 6, 0, Math.PI * 2);
      oc.strokeStyle = lineColor(cAlpha * 0.4);
      oc.lineWidth   = 1;
      oc.stroke();

      oc.beginPath();
      oc.arc(smoothCX, smoothCY, 2.5, 0, Math.PI * 2);
      oc.fillStyle = lineColor(cAlpha * 0.6);
      oc.fill();

      drawSign(oc, smoothCX, smoothCY, cursorIsPositive, 3.5, markerColor(cAlpha * 0.85), 1.4);
    }

    oc.restore();
  }

  // ── Animation loop ────────────────────────────────────────────────────────
  // Use rAF timestamp so arrowT advances at the same real-time speed regardless
  // of display refresh rate (60 Hz, 120 Hz, 144 Hz, etc.)
  let lastTimestamp = null;

  function loop(timestamp) {
    if (lastTimestamp === null) lastTimestamp = timestamp;
    const dt = Math.min(timestamp - lastTimestamp, 64); // cap at ~2 missed frames
    lastTimestamp = timestamp;

    drawCharge(dt);
    drawFieldLines(dt);
    requestAnimationFrame(loop);
  }

  // ── Allow other modules to hide/show the field-lines overlay ──
  window.setFieldLinesVisible = function(visible) {
    overlay.style.display = visible ? '' : 'none';
  };

  document.addEventListener('DOMContentLoaded', () => { renderChangelog(); requestAnimationFrame(loop); });
  if (document.readyState !== 'loading') { renderChangelog(); requestAnimationFrame(loop); }
})();