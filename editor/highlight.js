/* ═══════════════════════════════════════════════════════════════════
   highlight.js  ·  Syntax colours for the editor's code boxes
   ───────────────────────────────────────────────────────────────────
   VS Code-style colouring for the TikZ box and the solution box. The
   textarea stays the real editor (typing, selection, undo, snippets,
   Tab): a <pre> with the same font, padding and wrapping is drawn
   behind it, and the textarea's own text is made transparent so the
   coloured copy shows through. The copy is redrawn on every input and
   on every value set from code, and scrolls with the textarea.

   Colours are theme variables mixed with the text colour (css: .ed-hl
   in editor/editor.css), so every theme, day and night stays readable.
   Only colour changes, never weight or style, so the copy keeps exactly
   the textarea's character widths.

     edHighlight(textarea, 'tikz')   commands, options, numbers, $math$, % comments
     edHighlight(textarea, 'latex')  solution text: math regions, commands, numbers
     edHighlight(textarea, 'svg')    tags, attributes, values, comments
   ─────────────────────────────────────────────────────────────────── */

const ED_HL_ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;' };
const edHlEsc = (s) => s.replace(/[&<>]/g, (c) => ED_HL_ESC[c]);
const edHlSpan = (cls, s) => (cls ? `<span class="hl-${cls}">${edHlEsc(s)}</span>` : edHlEsc(s));
// A digit right after a letter belongs to a name (c1, f2), not a number.
const edHlInName = (src, i) => i > 0 && /[A-Za-z_@]/.test(src[i - 1]);

/* TikZ: \commands, [options], numbers, $math$, % comments, \begin{env}. */
function edHlTikz(src) {
  const re = /(%[^\n]*)|(\\(?:[A-Za-z@]+\*?|.))|(\$)|(\d+\.?\d*|\.\d+)|([\[\]])|([{}()])/g;
  let out = '', last = 0, math = false, opt = 0, m;
  const plain = (s) => edHlSpan(math ? 'math' : opt ? 'opt' : null, s);
  while ((m = re.exec(src))) {
    out += plain(src.slice(last, m.index));
    const t = m[0];
    if (m[1]) out += edHlSpan('com', t);
    else if (m[2]) {
      out += edHlSpan('cmd', t);
      const env = (t === '\\begin' || t === '\\end') && /^\{([^}\n]*)\}/.exec(src.slice(re.lastIndex));
      if (env) {
        out += edHlSpan('punc', '{') + edHlSpan('env', env[1]) + edHlSpan('punc', '}');
        re.lastIndex += env[0].length;
      }
    } else if (m[3]) { out += edHlSpan('del', t); math = !math; }
    else if (m[4]) out += edHlInName(src, m.index) ? plain(t) : edHlSpan('num', t);
    else if (m[5]) {
      if (!math) opt = Math.max(0, opt + (t === '[' ? 1 : -1));
      out += edHlSpan('punc', t);
    } else out += edHlSpan('punc', t);
    last = re.lastIndex;
  }
  return out + plain(src.slice(last));
}

/* Solution text: prose stays plain; math ($…$, $$…$$, \(…\), \[…\],
   \begin{env}…\end{env}) gets its own colour, with commands, numbers,
   & and \\ picked out inside it. */
function edHlLatex(src) {
  const re = /(\\(?:begin|end)\{[^}\n]*\})|(\$\$|\$|\\\(|\\\)|\\\[|\\\])|(\\(?:[A-Za-z@]+\*?|.))|(\d+\.?\d*|\.\d+)|(&)|([{}^_])/g;
  const CLOSE = { '$$': '$$', '$': '$', '\\(': '\\)', '\\[': '\\]' };
  let out = '', last = 0, close = null, m;     // close: what ends the math region we are in
  const plain = (s) => edHlSpan(close ? 'math' : null, s);
  const envTok = (t) => {
    const i = t.indexOf('{');
    return edHlSpan('cmd', t.slice(0, i)) + edHlSpan('punc', '{') + edHlSpan('env', t.slice(i + 1, -1)) + edHlSpan('punc', '}');
  };
  while ((m = re.exec(src))) {
    out += plain(src.slice(last, m.index));
    const t = m[0];
    if (m[1]) {
      if (!close && t.startsWith('\\begin')) { close = '\\end' + t.slice(6); out += envTok(t); }
      else { out += envTok(t); if (close === t) close = null; }
    } else if (m[2]) {
      if (!close && CLOSE[t]) { close = CLOSE[t]; out += edHlSpan('del', t); }
      else if (close === t) { close = null; out += edHlSpan('del', t); }
      else out += plain(t);
    } else if (m[3]) out += edHlSpan(close && t === '\\\\' ? 'op' : 'cmd', t);
    else if (m[4]) out += close && !edHlInName(src, m.index) ? edHlSpan('num', t) : plain(t);
    else if (m[5]) out += close ? edHlSpan('op', t) : plain(t);
    else out += close ? edHlSpan('punc', t) : plain(t);
    last = re.lastIndex;
  }
  return out + plain(src.slice(last));
}

/* SVG: tag names, attribute names, "values", <!-- comments -->. The step
   attributes (data-layer, data-steps, data-step) stand out, since they
   decide how the figure is split into steps. Text between tags stays plain. */
function edHlSvg(src) {
  const re = /(<!--[\s\S]*?(?:-->|$))|(<\/?)([A-Za-z][\w:.-]*)?|(\/?>)|("[^"]*"?|'[^']*'?)|([A-Za-z_:][\w:.-]*)|(=)/g;
  let out = '', last = 0, tag = false, m;
  while ((m = re.exec(src))) {
    if (!tag && !m[1] && !m[2]) continue;          // outside a tag: plain text, picked up below
    out += edHlEsc(src.slice(last, m.index));
    const t = m[0];
    if (m[1]) out += edHlSpan('com', t);
    else if (m[2]) { out += edHlSpan('punc', m[2]) + (m[3] ? edHlSpan('cmd', m[3]) : ''); tag = true; }
    else if (m[4]) { out += edHlSpan('punc', t); tag = false; }
    else if (m[5]) out += edHlSpan('str', t);
    else if (m[6]) out += edHlSpan(/^data-(layer|steps?)$/.test(t) ? 'env' : 'opt', t);
    else out += edHlSpan('punc', t);
    last = re.lastIndex;
  }
  return out + edHlEsc(src.slice(last));
}

function edHighlight(ta, lang) {
  if (!ta || ta._edHl) return;
  const paint = lang === 'latex' ? edHlLatex : lang === 'svg' ? edHlSvg : edHlTikz;
  const wrap = document.createElement('div');
  wrap.className = 'ed-hl-wrap';
  ta.parentNode.insertBefore(wrap, ta);
  // Same classes as the textarea, so font, size, padding and wrapping always match.
  const pre = document.createElement('pre');
  pre.className = ta.className + ' ed-hl';
  pre.setAttribute('aria-hidden', 'true');
  wrap.append(pre, ta);

  const scroll = () => { pre.scrollTop = ta.scrollTop; pre.scrollLeft = ta.scrollLeft; };
  // The textarea's scrollbars take room the <pre> (no scrollbars) doesn't
  // have; padding it by the same amount keeps lines wrapping at the same place.
  const fit = () => {
    const cs = getComputedStyle(ta);
    const sbw = ta.offsetWidth - ta.clientWidth - parseFloat(cs.borderLeftWidth) - parseFloat(cs.borderRightWidth);
    const sbh = ta.offsetHeight - ta.clientHeight - parseFloat(cs.borderTopWidth) - parseFloat(cs.borderBottomWidth);
    pre.style.paddingRight = `calc(${cs.paddingRight} + ${Math.max(0, sbw)}px)`;
    pre.style.paddingBottom = `calc(${cs.paddingBottom} + ${Math.max(0, sbh)}px)`;
    scroll();
  };
  const render = () => {
    const v = ta.value;
    // A trailing newline needs a character after it, or the last empty line has no height.
    pre.innerHTML = paint(v) + (v.endsWith('\n') || !v ? ' ' : '');
    pre.classList.toggle('off', ta.disabled);
    fit();
  };

  // Values set from code (switching problems, restoring, snippets) don't fire input.
  const desc = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value');
  Object.defineProperty(ta, 'value', {
    configurable: true,
    get() { return desc.get.call(this); },
    set(v) { desc.set.call(this, v); render(); },
  });
  ta.addEventListener('input', render);
  ta.addEventListener('scroll', scroll);
  if (window.ResizeObserver) new ResizeObserver(fit).observe(ta);
  new MutationObserver(() => pre.classList.toggle('off', ta.disabled)).observe(ta, { attributes: true, attributeFilter: ['disabled'] });
  ta._edHl = { render };
  render();
}
