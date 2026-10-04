/* ═══════════════════════════════════════════════════════════════════
   solution-render.js  ·  Renders solution text + LaTeX (STIX Two)
   ───────────────────────────────────────────────────────────────────
   Same approach as forum messages: every line of the source becomes
   its own block (so line breaks are kept; an empty line stays as a
   gap), text goes in via textContent (never as HTML), and MathJax
   typesets $...$ / \(...\) / $$...$$ / \[...\].
   Shared by the editor preview and the practice site's solution window.
   Requires math-render.js (renderMathIn) and MathJax.
   ─────────────────────────────────────────────────────────────────── */

function renderSolutionInto(el, text) {
  if (window.MathJax && MathJax.typesetClear) { try { MathJax.typesetClear([el]); } catch (e) {} }
  el.textContent = '';
  const lines = String(text || '').split(/\r\n|\r|\n/);
  const frag = document.createDocumentFragment();
  lines.forEach((line) => {
    const d = document.createElement('div');
    d.className = 'sol-line';
    d.textContent = line;
    frag.appendChild(d);
  });
  el.appendChild(frag);
  return renderMathIn(el);
}
