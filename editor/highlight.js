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

   opts.fold (TikZ box, with lineNumbers): VS Code-style folding. A block
   that spans lines — {…} such as \onstep{2}{…} or a \foreach body, a
   \begin{env}…\end{env}, or a section from a "% ===== Name" line to a
   "% ===" line (folded, only the title shows) — gets an arrow in the
   gutter; folding it puts
   one marker character in the textarea where its text was (drawn as a
   "⋯" pill in the coloured copy) and keeps that text aside. So the
   textarea holds the folded view, and textarea._edHl.text() is the full
   text, the one to save and compile. Markers are Braille characters
   (U+2800–28FF), never written in TikZ. Gutter numbers count lines of
   the full text, so they still match TeX's error lines. Folding and
   unfolding go through execCommand, so Ctrl+Z undoes them like typing;
   fold texts are kept for the session, so undo/redo always restores
   them. Copy and cut put out the full text; Backspace / Delete next to
   a marker unfolds it instead of deleting the hidden block. A value set
   from code clears the folds, unless it is a text this box showed
   folded before (switching problems and back keeps the folds).
   Click a pill or an arrow; Ctrl+Shift+[ / ] (also ⌘⌥[ / ]) folds the
   block at the caret / unfolds the caret's line; _edHl.foldAll() folds
   every block inside the picture at every level (opening one shows the
   ones inside it still folded), _edHl.unfoldAll() opens everything.
   The box fires "edfold" ({ folded, foldable }) when those counts change.

   opts.copyText(text) (any box): what copy / cut put on the clipboard
   for the selected text (full text, folds put back); the editor uses it
   to add the figure's scale when the whole figure is copied.
   ─────────────────────────────────────────────────────────────────── */

const ED_HL_ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;' };
const edHlEsc = (s) => s.replace(/[&<>]/g, (c) => ED_HL_ESC[c]);
const edHlSpan = (cls, s) => (cls ? `<span class="hl-${cls}">${edHlEsc(s)}</span>` : edHlEsc(s));
// A digit right after a letter belongs to a name (c1, f2), not a number.
const edHlInName = (src, i) => i > 0 && /[A-Za-z_@]/.test(src[i - 1]);

/* TikZ: \commands, [options], numbers, $math$, % comments, \begin{env}.
   Section lines (% ===== Name, % ===) stand out from other comments. */
function edHlTikz(src) {
  const re = /(%[^\n]*)|(\\(?:[A-Za-z@]+\*?|.))|(\$)|(\d+\.?\d*|\.\d+)|([\[\]])|([{}()])/g;
  let out = '', last = 0, math = false, opt = 0, m;
  const plain = (s) => edHlSpan(math ? 'math' : opt ? 'opt' : null, s);
  while ((m = re.exec(src))) {
    out += plain(src.slice(last, m.index));
    const t = m[0];
    if (m[1]) {
      const line = src.slice(src.lastIndexOf('\n', m.index - 1) + 1, m.index) + t;
      if (ED_SEC_START.test(line) || ED_SEC_END.test(line)) {
        // "% =====" and the section's name in colours of their own.
        const k = /^%\s*=+/.exec(t)[0].length;
        out += edHlSpan('sec', t.slice(0, k)) + (k < t.length ? edHlSpan('secname', t.slice(k)) : '');
      } else out += edHlSpan('com', t);
    }
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

/* Folding: the blocks of TikZ text that span lines, as
   { line, s, e, env } — line is where the block starts (0-based), s..e
   the text a fold hides: inside the braces for {…}, from the end of the
   \begin line to \end for an environment. % comments and \{ \} are skipped. */
const ED_FOLD_RE = /[⠀-⣿]/g;
const ED_SEC_START = /^\s*%\s*={5,}/, ED_SEC_END = /^\s*%\s*={3}(?!=)/;
function edFoldRanges(src) {
  const out = [], braces = [], envs = [];
  const envRe = /\\(begin|end)\s*\{([^}\n]*)\}/y;
  let line = 0;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (c === '\n') { line++; continue; }
    if (c === '%') { const j = src.indexOf('\n', i); if (j < 0) break; i = j - 1; continue; }
    if (c === '\\') {
      envRe.lastIndex = i;
      const m = envRe.exec(src);
      if (m) {
        if (m[1] === 'begin') {
          const eol = src.indexOf('\n', i);
          envs.push({ line, s: eol < 0 ? src.length : eol, env: m[2] });
        } else {
          let k = envs.length - 1;
          while (k >= 0 && envs[k].env !== m[2]) k--;
          if (k >= 0) {
            const o = envs[k];
            envs.length = k;
            if (line > o.line) out.push({ line: o.line, s: o.s, e: i, env: o.env });
          }
        }
        i += m[0].length - 1;
      } else if (src[i + 1] !== '\n') i++;
      continue;
    }
    if (c === '{') braces.push({ line, s: i + 1 });
    else if (c === '}') {
      const o = braces.pop();
      if (o && line > o.line) out.push({ line: o.line, s: o.s, e: i, env: null });
    }
  }
  // Sections: "% ===== Name" (5+ "=") up to "% ===" (exactly 3), paired as
  // a stack, so sections nest; one with no end doesn't fold. The fold
  // hides everything after the title line, the end line included. A
  // folded title (it holds a marker) is already closed: not pushed.
  const open = [];
  let at = 0;
  src.split('\n').forEach((l, n) => {
    const eol = at + l.length;
    if (ED_SEC_START.test(l)) { if (!/[⠀-⣿]/.test(l)) open.push({ line: n, s: eol }); }
    else if (ED_SEC_END.test(l)) {
      const o = open.pop();
      if (o) out.push({ line: o.line, s: o.s, e: eol, env: null, section: true });
    }
    at = eol + 1;
  });
  return out;
}
// "Fold all": the outermost blocks inside the picture.
function edFoldTop(ranges) {
  const out = [];
  let end = -1;
  ranges.filter((r) => r.env !== 'tikzpicture' && r.env !== 'document')
    .sort((a, b) => a.s - b.s || b.e - a.e)
    .forEach((r) => { if (r.s >= end) { out.push(r); end = r.e; } });
  return out;
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

  // Folding (opts.fold): marker character -> the text it stands for.
  const foldOn = !!(opts.fold && gutter);
  const folds = new Map();
  const remembered = new Map();      // full text -> its folded view, for values set again from code
  let ranges = [], rangeByLine = new Map(), foldState = '0,0', busy = false;
  const expand = (s, depth) => (folds.size && (depth || 0) < 32
    ? s.replace(ED_FOLD_RE, (c) => (folds.has(c) ? expand(folds.get(c), (depth || 0) + 1) : c)) : s);
  const newlines = (s) => (s.match(/\n/g) || []).length;
  const lineStart = (v, i) => { let p = 0; while (i-- > 0) p = v.indexOf('\n', p) + 1; return p; };

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
  let gutterHtml = '';
  const renderGutter = () => {
    if (!gutterInner) return;
    const v = ta.value;
    if (!foldOn) {
      const n = v.split('\n').length;
      if (n !== lineCount) {
        lineCount = n;
        let html = '';
        for (let i = 1; i <= n; i++) html += `<span>${i}</span>`;
        gutterInner.innerHTML = html;
        activeLine = 0;
      }
      markActive();
      return;
    }
    // One row per line on screen, numbered by the full text; an arrow where
    // a block starts (open) or a folded one sits (shut).
    ranges = edFoldRanges(v);
    rangeByLine = new Map();
    ranges.forEach((r) => { const o = rangeByLine.get(r.line); if (!o || r.s < o.s) rangeByLine.set(r.line, r); });
    let num = 1, html = '', folded = 0;
    v.split('\n').forEach((l, i) => {
      let hidden = 0, shut = false;
      for (const c of l.match(ED_FOLD_RE) || []) {
        if (folds.has(c)) { shut = true; folded++; hidden += newlines(expand(folds.get(c))); }
      }
      const arrow = shut ? `<i class="ed-fold shut" data-l="${i}" title="Unfold (${hidden + 1} lines)"></i>`
        : rangeByLine.has(i) ? `<i class="ed-fold" data-l="${i}" title="Fold"></i>` : '<i class="ed-fold none"></i>';
      html += `<span>${num}${arrow}</span>`;
      num += 1 + hidden;
    });
    lineCount = num - 1;
    if (html !== gutterHtml) { gutterHtml = html; gutterInner.innerHTML = html; activeLine = 0; }
    markActive();
    const state = `${folded},${edFoldTop(ranges).length}`;
    if (state !== foldState) {
      foldState = state;
      ta.dispatchEvent(new CustomEvent('edfold', { detail: { folded, foldable: edFoldTop(ranges).length } }));
    }
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
      const w = Math.ceil((String(Math.max(lineCount, 1)).length + 1.6 + (foldOn ? 1.9 : 0)) * fs * 0.62);
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
    let html = paint(v);
    // Fold markers: same character (same width as in the textarea), drawn as a pill.
    if (foldOn && folds.size) html = html.replace(ED_FOLD_RE, (c) => (folds.has(c) ? `<span class="hl-fold">${c}</span>` : c));
    // A trailing newline needs a character after it, or the last empty line has no height.
    pre.innerHTML = html + (v.endsWith('\n') || !v ? ' ' : '');
    pre.classList.toggle('off', ta.disabled);
    renderGutter();
    fit();
  };

  /* ── Folding ── */
  // Replaces from..to of the textarea's text as one typing step (so Ctrl+Z
  // undoes it), then puts back the selection, moved by map, and the scroll.
  const replace = (from, to, str, map) => {
    if (ta.disabled) return;
    const s0 = ta.selectionStart, e0 = ta.selectionEnd, top = ta.scrollTop, left = ta.scrollLeft;
    const prev = document.activeElement;
    if (prev !== ta) { try { ta.focus({ preventScroll: true }); } catch (e) { ta.focus(); } }
    busy = ta._edFolding = true;
    ta.setSelectionRange(from, to);
    let ok = false;
    try { ok = document.execCommand(str ? 'insertText' : 'delete', false, str); } catch (e) { ok = false; }
    if (!ok) { ta.setRangeText(str, from, to, 'end'); ta.dispatchEvent(new Event('input')); }
    busy = ta._edFolding = false;
    ta.setSelectionRange(map(s0), map(e0));
    ta.scrollTop = top; ta.scrollLeft = left;
    scroll();
    markActive();
    if (prev !== ta && prev && prev.focus) { try { prev.focus({ preventScroll: true }); } catch (e) { /* ignore */ } }
  };
  // A marker character no fold uses and the text doesn't contain. When all
  // are taken, the folds nothing points at any more (not on screen, not
  // inside another fold, not in a remembered view) are forgotten.
  const newMark = () => {
    for (let pass = 0; pass < 2; pass++) {
      const used = expand(ta.value);
      for (let i = 0; i < 256; i++) {
        const c = String.fromCharCode(0x2800 + i);
        if (!folds.has(c) && !used.includes(c)) return c;
      }
      const live = new Set(), todo = [ta.value, ...remembered.values()];
      while (todo.length) {
        for (const c of todo.pop().match(ED_FOLD_RE) || []) {
          if (folds.has(c) && !live.has(c)) { live.add(c); todo.push(folds.get(c)); }
        }
      }
      [...folds.keys()].forEach((c) => { if (!live.has(c)) folds.delete(c); });
    }
    return null;
  };
  // Folds these blocks (non-overlapping) in one step.
  const foldBlocks = (list) => {
    const v = ta.value, marks = [];
    let end = -1;
    list.slice().sort((a, b) => a.s - b.s).forEach((r) => {
      if (r.s < end || r.e <= r.s) return;
      const c = newMark();
      if (!c) return;
      folds.set(c, v.slice(r.s, r.e));
      marks.push({ s: r.s, e: r.e, c });
      end = r.e;
    });
    if (!marks.length) return;
    let str = '', at = marks[0].s;
    marks.forEach((m) => { str += v.slice(at, m.s) + m.c; at = m.e; });
    // A caret inside a folded block lands just after its marker.
    const map = (p) => {
      let d = 0;
      for (const m of marks) {
        if (p <= m.s) return p + d;
        if (p <= m.e) return m.s + 1 + d;
        d += 1 - (m.e - m.s);
      }
      return p + d;
    };
    replace(marks[0].s, at, str, map);
  };
  // Unfolds the markers at these positions; deep: the folds inside them too.
  const unfoldAt = (positions, deep) => {
    const v = ta.value;
    const ps = positions.filter((p) => folds.has(v[p])).sort((a, b) => a - b);
    if (!ps.length) return;
    let str = '', at = ps[0];
    const grow = [];
    ps.forEach((p) => {
      const h = deep ? expand(folds.get(v[p])) : folds.get(v[p]);
      str += v.slice(at, p) + h;
      at = p + 1;
      grow.push({ p, n: h.length - 1 });
    });
    const map = (q) => { let d = 0; for (const g of grow) { if (q <= g.p) break; d += g.n; } return q + d; };
    replace(ps[0], at, str, map);
  };
  const marksIn = (v, from, to) => {
    const out = [];
    for (let p = from; p < to; p++) if (folds.has(v[p])) out.push(p);
    return out;
  };
  // Line i of the textarea (0-based): unfold what is folded there, or fold
  // the block that starts there.
  const toggleLine = (i) => {
    const v = ta.value, s = lineStart(v, i);
    let e = v.indexOf('\n', s);
    if (e < 0) e = v.length;
    const marks = marksIn(v, s, e);
    if (marks.length) unfoldAt(marks);
    else if (rangeByLine.has(i)) foldBlocks([rangeByLine.get(i)]);
  };
  // Every block inside the picture, at every level, in one step: inner
  // blocks are folded inside the outer ones, so opening a section shows
  // its \onstep blocks still folded. A block that crosses the end of the
  // one around it (a section closing inside an \onstep) is left open.
  const foldAll = () => {
    const v = ta.value, root = { s: -1, e: Infinity, kids: [] }, stack = [root];
    ranges.filter((r) => r.env !== 'tikzpicture' && r.env !== 'document' && r.e > r.s)
      .sort((a, b) => a.s - b.s || b.e - a.e)
      .forEach((r) => {
        while (stack.length > 1 && r.s >= stack[stack.length - 1].e) stack.pop();
        const top = stack[stack.length - 1];
        if (r.e > top.e) return;
        const node = { s: r.s, e: r.e, kids: [] };
        top.kids.push(node);
        stack.push(node);
      });
    if (!root.kids.length) return;
    const inside = (node, from, to) => {
      let str = '', at = from;
      node.kids.forEach((k) => { str += v.slice(at, k.s) + (k.c || v.slice(k.s, k.e)); at = k.e; });
      return str + v.slice(at, to);
    };
    const fold = (node) => {
      node.kids.forEach(fold);
      const c = newMark();
      if (c) { folds.set(c, inside(node, node.s, node.e)); node.c = c; }
    };
    root.kids.forEach(fold);
    const marks = root.kids.filter((k) => k.c);
    if (!marks.length) return;
    const first = marks[0].s, last = marks[marks.length - 1].e;
    const str = inside({ kids: marks }, first, last);
    const map = (p) => {
      let d = 0;
      for (const m of marks) {
        if (p <= m.s) return p + d;
        if (p <= m.e) return m.s + 1 + d;
        d += 1 - (m.e - m.s);
      }
      return p + d;
    };
    replace(first, last, str, map);
  };
  const unfoldAll = () => unfoldAt(marksIn(ta.value, 0, ta.value.length), true);
  // Line n of the full text -> its line in the textarea (both 1-based),
  // unfolding whatever hides it.
  const reveal = (n) => {
    for (let guard = 0; guard < 64; guard++) {
      if (n <= 1) return 1;
      const v = ta.value;
      let line = 1, shown = 1, hit = -1;
      for (let i = 0; i < v.length; i++) {
        if (v[i] === '\n') { line++; shown++; if (line >= n) return shown; }
        else if (folds.has(v[i])) {
          const k = newlines(expand(folds.get(v[i])));
          if (line + k >= n) { hit = i; break; }
          line += k;
        }
      }
      if (hit < 0) return shown;
      unfoldAt([hit]);
    }
    return 1;
  };
  // What the textarea shows for a value set from code: the folded view it
  // had before if this is a text it showed folded, else the text itself
  // (marker characters in a new text are its own, so folds using them go).
  const viewOf = (v) => {
    const now = desc.get.call(ta), full = expand(now);
    if (full !== now) {
      remembered.delete(full);
      remembered.set(full, now);
      while (remembered.size > 40) remembered.delete(remembered.keys().next().value);
    }
    const seen = remembered.get(v);
    if (seen != null && expand(seen) === v) return seen;
    for (const c of v.match(ED_FOLD_RE) || []) {
      if (!folds.has(c)) continue;
      folds.delete(c);
      for (const [k, d] of remembered) if (d.includes(c)) remembered.delete(k);
    }
    return v;
  };

  // Scroll line n (1-based) into the middle of the box, put the caret at its
  // start, and flash it for a moment. n counts lines of the full text.
  const gotoLine = (n) => {
    if (foldOn) n = reveal(n);
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
    set(v) { desc.set.call(this, foldOn ? viewOf(String(v)) : v); render(); },
  });
  ta.addEventListener('input', render);
  ta.addEventListener('scroll', scroll);
  if (gutter) {
    ['keyup', 'click', 'focus', 'select'].forEach((ev) => ta.addEventListener(ev, markActive));
    document.addEventListener('selectionchange', () => { if (document.activeElement === ta) markActive(); });
  }
  if (foldOn) {
    // Arrows in the gutter; mousedown, so the caret stays where it was.
    gutter.addEventListener('mousedown', (e) => {
      const t = e.target.closest && e.target.closest('.ed-fold');
      if (!t || t.classList.contains('none')) return;
      e.preventDefault();
      toggleLine(+t.dataset.l);
    });
    // A click on a "⋯" pill unfolds it.
    ta.addEventListener('click', (e) => {
      if (ta.selectionStart !== ta.selectionEnd) return;
      const pills = pre.querySelectorAll('.hl-fold');
      for (let k = 0; k < pills.length; k++) {
        const r = pills[k].getBoundingClientRect();
        if (e.clientX >= r.left - 2 && e.clientX <= r.right + 2 && e.clientY >= r.top && e.clientY <= r.bottom) {
          const pos = marksIn(ta.value, 0, ta.value.length)[k];
          if (pos != null) unfoldAt([pos]);
          return;
        }
      }
    });
    // Ctrl+Shift+[ folds the block on the caret's line (or the innermost one
    // around the caret); Ctrl+Shift+] unfolds the caret's line. ⌘⌥ on a Mac.
    ta.addEventListener('keydown', (e) => {
      if (!(e.ctrlKey || e.metaKey) || !(e.shiftKey || e.altKey)) return;
      if (e.code !== 'BracketLeft' && e.code !== 'BracketRight') return;
      e.preventDefault();
      const v = ta.value, p = ta.selectionStart;
      const line = v.slice(0, p).split('\n').length - 1;
      const s = lineStart(v, line);
      let end = v.indexOf('\n', p);
      if (end < 0) end = v.length;
      if (e.code === 'BracketRight') { unfoldAt(marksIn(v, s, end)); return; }
      const r = rangeByLine.get(line) || ranges.filter((x) => x.s <= p && p <= x.e).sort((a, b) => b.s - a.s)[0];
      if (r) foldBlocks([r]);
    });
    // Backspace / Delete on a marker unfolds it instead of deleting the block.
    ta.addEventListener('beforeinput', (e) => {
      if (busy || ta.selectionStart !== ta.selectionEnd) return;
      const s = ta.selectionStart;
      const p = e.inputType === 'deleteContentBackward' ? s - 1 : e.inputType === 'deleteContentForward' ? s : -1;
      if (p >= 0 && folds.has(ta.value[p])) { e.preventDefault(); unfoldAt([p]); }
    });
  }
  // Copy and cut put out the full text, never marker characters, passed
  // through opts.copyText(text) when given (the editor adds the figure's
  // scale there).
  const copyOut = (e, cut) => {
    const s = ta.selectionStart, en = ta.selectionEnd, part = ta.value.slice(s, en);
    const full = opts.copyText ? opts.copyText(expand(part)) : expand(part);
    if (full === part || !e.clipboardData) return;
    e.preventDefault();
    e.clipboardData.setData('text/plain', full);
    if (cut) replace(s, en, '', (q) => (q <= s ? q : q >= en ? q - (en - s) : s));
  };
  ta.addEventListener('copy', (e) => copyOut(e, false));
  ta.addEventListener('cut', (e) => copyOut(e, true));
  if (window.ResizeObserver) new ResizeObserver(fit).observe(ta);
  new MutationObserver(() => pre.classList.toggle('off', ta.disabled)).observe(ta, { attributes: true, attributeFilter: ['disabled'] });
  // Wrap long lines (the gutter follows); no horizontal scrollbar then.
  const setWrap = (on) => {
    wrapOn = !!on;
    wrap.classList.toggle('wrap', wrapOn);
    fit();
  };
  // text(): the full text — what the textarea shows, with folds put back.
  ta._edHl = { render, gotoLine, setWrap, text: () => expand(ta.value), foldAll, unfoldAll };
  render();
}
