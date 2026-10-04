/* ═══════════════════════════════════════════════════════════════════
   solution-render.js  ·  Renders solution text + LaTeX (STIX Two)
   ───────────────────────────────────────────────────────────────────
   Same approach as forum messages: every line of the source becomes
   its own block (so line breaks are kept; an empty line stays as a
   gap), text goes in via textContent (never as HTML), and MathJax
   typesets $...$ / \(...\) / $$...$$ / \[...\].

   Except: display math written over several lines —
       $$            \[             \begin{aligned}
       x^2      or   x^2      or    ...
       $$            \]             \end{aligned}
   — is kept together in ONE block, since MathJax only finds math whose
   opening and closing delimiters are inside the same element. A block
   that is never closed (a typo) falls back to one block per line, so a
   stray $$ can't swallow the rest of the solution. Inline $...$ and
   \(...\) are not carried across lines: a lone $ is far more often a
   price or a typo than math meant to wrap.

   Shared by the editor preview and the practice site's solution window.
   Requires math-render.js (renderMathIn) and MathJax.
   ─────────────────────────────────────────────────────────────────── */

/** Source text -> list of blocks: normally one per line, but a multi-line
    display-math block ($$…$$, \[…\], \begin{env}…\end{env}) is one. */
function splitSolutionBlocks(text) {
  const lines = String(text || '').split(/\r\n|\r|\n/);
  const blocks = [];
  let open = null;        // null | '$$' | '\\[' | 'env:<name>'
  let pending = [];       // lines of the block that is still open

  // Advances `open` through one line and returns the new state.
  function scan(line, state) {
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '\\') {
        const n = line[i + 1];
        if (n === '[' && !state) { state = '\\['; i++; continue; }
        if (n === ']' && state === '\\[') { state = null; i++; continue; }
        if (!state || state.startsWith('env:')) {
          const m = line.slice(i).match(/^\\(begin|end)\{([^}]+)\}/);
          if (m) {
            if (m[1] === 'begin' && !state) state = 'env:' + m[2];
            else if (m[1] === 'end' && state === 'env:' + m[2]) state = null;
            i += m[0].length - 1;
            continue;
          }
        }
        i++;                                  // any other escape: \$, \\, \{ …
        continue;
      }
      if (c === '$' && line[i + 1] === '$') {
        if (!state) state = '$$';
        else if (state === '$$') state = null;
        i++;
      }
    }
    return state;
  }

  lines.forEach((line) => {
    open = scan(line, open);
    if (open) { pending.push(line); return; }
    if (pending.length) { pending.push(line); blocks.push(pending.join('\n')); pending = []; }
    else blocks.push(line);
  });
  // Never closed: don't merge, keep the lines as they were typed.
  if (pending.length) blocks.push(...pending);
  return blocks;
}

function renderSolutionInto(el, text) {
  if (window.MathJax && MathJax.typesetClear) { try { MathJax.typesetClear([el]); } catch (e) {} }
  el.textContent = '';
  const frag = document.createDocumentFragment();
  splitSolutionBlocks(text).forEach((block) => {
    const d = document.createElement('div');
    d.className = 'sol-line';
    d.textContent = block;
    frag.appendChild(d);
  });
  el.appendChild(frag);
  return renderMathIn(el);
}
