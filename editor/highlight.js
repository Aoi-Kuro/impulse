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

   opts.lineNumbers (code boxes): a VS Code-style gutter of line numbers,
   the caret's line brighter, and textarea._edHl.gotoLine(n), which scrolls
   to line n, puts the caret at its start and flashes the line for a moment
   (used by "Go to line" on a TeX error). textarea._edHl.setWrap(on) wraps
   long lines; each number then stays level with the first row of its line
   and takes that line's full wrapped height, measured on a hidden copy of
   the text at the same width and font.
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

function edHighlight(ta, lang, opts) {
  if (!ta || ta._edHl) return;
  opts = opts || {};
  const paint = lang === 'latex' ? edHlLatex : lang === 'svg' ? edHlSvg : edHlTikz;
  const wrap = document.createElement('div');
  wrap.className = 'ed-hl-wrap';
  ta.parentNode.insertBefore(wrap, ta);
  // Same classes as the textarea, so font, size, padding and wrapping always match.
  const pre = document.createElement('pre');
  pre.className = ta.className + ' ed-hl';
  pre.setAttribute('aria-hidden', 'true');
  wrap.append(pre, ta);

  // Line numbers: a gutter over the left padding (the textarea and its
  // coloured copy are padded by its width), and a layer for the go-to-line
  // flash. Both move with the textarea's vertical scroll.
  let gutter = null, gutterInner = null, flashLayer = null, flash = null, gutterW = 0, lineCount = 0, activeLine = 0;
  let wrapOn = false;
  let lineTops = null, lineHeights = null;   // per line, in px, while wrapping
  let measureEl = null;
  const basePadL = parseFloat(getComputedStyle(ta).paddingLeft) || 0;
  if (opts.lineNumbers) {
    wrap.classList.add('has-lines');
    gutter = document.createElement('div');
    gutter.className = 'ed-gutter';
    gutter.setAttribute('aria-hidden', 'true');
    gutterInner = document.createElement('div');
    gutterInner.className = 'ed-gutter-inner';
    gutter.appendChild(gutterInner);
    flashLayer = document.createElement('div');
    flashLayer.className = 'ed-flash-layer';
    flashLayer.setAttribute('aria-hidden', 'true');
    flash = document.createElement('div');
    flash.className = 'ed-lineflash';
    flashLayer.appendChild(flash);
    wrap.append(gutter, flashLayer);
  }
  const lineHeight = () => {
    const cs = getComputedStyle(ta);
    return parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.5;
  };
  const caretLine = () => ta.value.slice(0, ta.selectionStart).split('\n').length;
  const markActive = () => {
    if (!gutterInner) return;
    const n = caretLine();
    if (n === activeLine && gutterInner.children[n - 1] && gutterInner.children[n - 1].classList.contains('on')) return;
    const old = gutterInner.children[activeLine - 1];
    if (old) old.classList.remove('on');
    activeLine = n;
    const cur = gutterInner.children[n - 1];
    if (cur) cur.classList.add('on');
  };
  const renderGutter = () => {
    if (!gutterInner) return;
    const n = ta.value.split('\n').length;
    if (n !== lineCount) {
      lineCount = n;
      let html = '';
      for (let i = 1; i <= n; i++) html += `<span>${i}</span>`;
      gutterInner.innerHTML = html;
      activeLine = 0;
    }
    markActive();
  };

  // While wrapping, how tall each source line really is: the text, one
  // block per line, laid out in a hidden copy with the textarea's content
  // width, font and wrapping rules. Each gutter number gets its line's
  // height, so it stays level with the line's first row. Unwrapped, every
  // line is one row and nothing needs measuring.
  const measure = () => {
    if (!gutterInner) return;
    if (!wrapOn) {
      lineTops = lineHeights = null;
      for (const sp of gutterInner.children) sp.style.height = '';
      return;
    }
    const cs = getComputedStyle(ta);
    const width = ta.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    if (!(width > 0)) return;                      // hidden: measured again once shown (ResizeObserver)
    if (!measureEl) {
      measureEl = document.createElement('div');
      measureEl.className = 'ed-measure';
      measureEl.setAttribute('aria-hidden', 'true');
      wrap.appendChild(measureEl);
    }
    Object.assign(measureEl.style, {
      width: width + 'px', fontFamily: cs.fontFamily, fontSize: cs.fontSize, fontWeight: cs.fontWeight,
      fontStyle: cs.fontStyle, lineHeight: cs.lineHeight, letterSpacing: cs.letterSpacing,
      tabSize: cs.tabSize, whiteSpace: cs.whiteSpace, overflowWrap: cs.overflowWrap, wordBreak: cs.wordBreak,
    });
    const frag = document.createDocumentFragment();
    ta.value.split('\n').forEach((l) => {
      const d = document.createElement('div');
      d.textContent = l || ' ';                   // an empty line is still one row
      frag.appendChild(d);
    });
    measureEl.textContent = '';
    measureEl.appendChild(frag);
    lineTops = [];
    lineHeights = [];
    let y = 0;
    Array.from(measureEl.children).forEach((d, i) => {
      const h = d.getBoundingClientRect().height;
      lineTops.push(y);
      lineHeights.push(h);
      y += h;
      if (gutterInner.children[i]) gutterInner.children[i].style.height = h + 'px';
    });
    measureEl.textContent = '';
  };

  const scroll = () => {
    pre.scrollTop = ta.scrollTop; pre.scrollLeft = ta.scrollLeft;
    if (gutterInner) gutterInner.style.transform = flash.style.transform = `translateY(${-ta.scrollTop}px)`;
  };
  // The textarea's scrollbars take room the <pre> (no scrollbars) doesn't
  // have; padding it by the same amount keeps lines wrapping at the same place.
  const fit = () => {
    const cs = getComputedStyle(ta);
    const sbw = ta.offsetWidth - ta.clientWidth - parseFloat(cs.borderLeftWidth) - parseFloat(cs.borderRightWidth);
    const sbh = ta.offsetHeight - ta.clientHeight - parseFloat(cs.borderTopWidth) - parseFloat(cs.borderBottomWidth);
    pre.style.paddingRight = `calc(${cs.paddingRight} + ${Math.max(0, sbw)}px)`;
    pre.style.paddingBottom = `calc(${cs.paddingBottom} + ${Math.max(0, sbh)}px)`;
    if (gutter) {
      // Wide enough for the largest number; both copies of the text start after it.
      const fs = parseFloat(cs.fontSize) || 12;
      const w = Math.ceil((String(Math.max(lineCount, 1)).length + 1.6) * fs * 0.62);
      if (w !== gutterW) {
        gutterW = w;
        ta.style.paddingLeft = pre.style.paddingLeft = `${basePadL + w}px`;
      }
      const top = parseFloat(cs.borderTopWidth), left = parseFloat(cs.borderLeftWidth);
      const bottom = parseFloat(cs.borderBottomWidth) + Math.max(0, sbh);
      Object.assign(gutter.style, { top: top + 'px', left: left + 'px', bottom: bottom + 'px', width: w + 'px' });
      Object.assign(flashLayer.style, { top: top + 'px', left: left + 'px', bottom: bottom + 'px',
        right: (parseFloat(cs.borderRightWidth) + Math.max(0, sbw)) + 'px' });
      gutterInner.style.paddingTop = cs.paddingTop;
      gutterInner.style.fontSize = flash.style.fontSize = cs.fontSize;
      gutterInner.style.lineHeight = cs.lineHeight;
      measure();                                   // after the padding, which sets the width
    }
    scroll();
  };
  const render = () => {
    const v = ta.value;
    // A trailing newline needs a character after it, or the last empty line has no height.
    pre.innerHTML = paint(v) + (v.endsWith('\n') || !v ? ' ' : '');
    pre.classList.toggle('off', ta.disabled);
    renderGutter();
    fit();
  };

  // Scroll line n (1-based) into the middle of the box, put the caret at its
  // start, and flash it for a moment.
  const gotoLine = (n) => {
    const lines = ta.value.split('\n');
    n = Math.max(1, Math.min(lines.length, Math.round(n) || 1));
    let start = 0;
    for (let i = 0; i < n - 1; i++) start += lines[i].length + 1;
    const lh = lineHeight();
    // Wrapped, a line starts where the lines above it end and may be several rows tall.
    const top = lineTops && lineTops[n - 1] !== undefined ? lineTops[n - 1] : (n - 1) * lh;
    const h = lineHeights && lineHeights[n - 1] ? lineHeights[n - 1] : lh;
    ta.scrollIntoView({ block: 'nearest' });
    try { ta.focus({ preventScroll: true }); } catch (e) { ta.focus(); }
    ta.setSelectionRange(start, start);
    ta.scrollTop = Math.max(0, top - (ta.clientHeight - h) / 2);
    ta.scrollLeft = 0;
    scroll();
    markActive();
    if (flash) {
      flash.style.top = `calc(${getComputedStyle(ta).paddingTop} + ${top}px)`;
      flash.style.height = h + 'px';
      flash.classList.remove('go');
      void flash.offsetWidth;                      // restart the animation
      flash.classList.add('go');
    }
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
  if (gutter) {
    ['keyup', 'click', 'focus', 'select'].forEach((ev) => ta.addEventListener(ev, markActive));
    document.addEventListener('selectionchange', () => { if (document.activeElement === ta) markActive(); });
  }
  if (window.ResizeObserver) new ResizeObserver(fit).observe(ta);
  new MutationObserver(() => pre.classList.toggle('off', ta.disabled)).observe(ta, { attributes: true, attributeFilter: ['disabled'] });
  // Wrap long lines (the gutter follows); no horizontal scrollbar then.
  const setWrap = (on) => {
    wrapOn = !!on;
    wrap.classList.toggle('wrap', wrapOn);
    fit();
  };
  ta._edHl = { render, gotoLine, setWrap };
  render();
}
