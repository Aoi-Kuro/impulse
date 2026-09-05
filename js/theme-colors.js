/* ═══════════════════════════════════════════════════════════════════
   theme-colors.js  ·  Theme color bridge (CSS variables → JS)
   ───────────────────────────────────────────────────────────────────
   All colors on this site live as CSS custom properties in
   css/style.css (:root and body.light). Canvas drawing and other
   JS-generated styles can't reference var(--x) directly, so this
   file reads the *live, computed* value of each CSS variable instead
   of hard-coding hex duplicates in JS.

   This is what makes future color-theme selection (beyond just
   light/dark) automatically propagate into charts, confetti, and the
   π-day easter egg: change the CSS variables, and every JS-drawn
   color updates with them — nothing to touch here.
   ─────────────────────────────────────────────────────────────────── */

/** Get the live computed value of a CSS custom property (e.g. '--accent'). */
function cssVar(name, el) {
  return getComputedStyle(el || document.body).getPropertyValue(name).trim();
}

/** Parse a '#rgb' / '#rrggbb' string into an [r,g,b] array. */
function hexToRgb(hex) {
  hex = (hex || '').trim().replace('#', '');
  if (hex.length === 3) hex = hex.split('').map(c => c + c).join('');
  const num = parseInt(hex, 16) || 0;
  return [(num >> 16) & 255, (num >> 8) & 255, num & 255];
}

/** [r,g,b] for a CSS variable that holds a hex color. */
function cssVarRgb(name, el) {
  return hexToRgb(cssVar(name, el));
}

/** 'rgba(r,g,b,alpha)' string calculated from a CSS variable + opacity. */
function cssVarRgba(name, alpha, el) {
  const [r, g, b] = cssVarRgb(name, el);
  return `rgba(${r},${g},${b},${alpha})`;
}

/** Live color for quiz series N (1-4), from --q1.. --q4 in css/stats.css. */
function quizSeriesColor(n) {
  return cssVar(`--q${n}`);
}
