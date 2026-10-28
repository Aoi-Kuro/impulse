/* ═══════════════════════════════════════════════════════════════════
   share-card.js  ·  The link-preview card for a shared solution
   ───────────────────────────────────────────────────────────────────
   Builds the card (laid out at 1920×1080, stored as a 1280×720 JPEG) that
   a shared solution link will show as its
   preview: IMPULSE | PHYS 161 | Q1 P136 and the problem's condition on
   the left, the figure's last step on the right — or, for a solution
   without a figure, the start of the solution text. Always drawn in the
   Ocean dark theme, whatever theme the page itself is in (the colours
   are set on the card, see editor/share-card.css).

   ShareCard.build(host, data) empties `host`, draws the card into it and
   resolves once fonts, maths and the figure are in place. `host` must be
   in the page and not display:none (the figure and the text are
   measured); scaling it down with a transform is fine.

   data: { brand, course, label, condition, steps, solution }
     brand      'IMPULSE'
     course     'PHYS 161'
     label      'Q1 P136'
     condition  the problem's `text` (HTML with $…$ maths; its picture
                is dropped, the card shows the solution's figure instead)
     steps      figure.steps from the solution row; may be empty
     solution   the solution row's text; shown only when there is no
                figure

   ShareCard.toJpeg(card) turns the result into the stored image, and
   ShareCard.linkText() gives the link's title and description.

   Requires MathJax (configured as on the site), js/figure.js,
   js/solution-render.js, DOMPurify and vendor/html-to-image.
   ─────────────────────────────────────────────────────────────────── */

const ShareCard = (function () {
  'use strict';

  const W = 1920, H = 1080;

  // Longest condition shown, in visible characters (maths counted roughly
  // as what it draws, not its source). Today's longest problem is ~650 and
  // fits whole at the smallest size, so this only bites on a future one;
  // past it the text ends in "…".
  // A long condition first steps down through TEXT_SIZES; whatever still
  // overflows at the smallest (lots of tall maths) is trimmed word by word
  // until it fits.
  const TEXT_CAP = 680;
  const TEXT_SIZES = [44, 40, 36, 32];   // px

  // $$…$$, \[…\], \(…\) and $…$ are never split; everything else splits
  // at whitespace.
  const TOKEN_RE = /\$\$[\s\S]+?\$\$|\\\[[\s\S]+?\\\]|\\\([\s\S]+?\\\)|\$(?:\\.|[^$\\])+\$|\s+|[^\s$]+|\$/g;
  const isMath = (t) => /^(\$|\\[([])/.test(t) && t.length > 1;

  /** Plain text of a problem's HTML, without its picture. */
  function conditionText(html) {
    const doc = new DOMParser().parseFromString(`<div>${html || ''}</div>`, 'text/html');
    doc.querySelectorAll('.fig-img-wrap, img, svg, figure').forEach((el) => el.remove());
    return (doc.body.textContent || '').replace(/\s+/g, ' ').trim();
  }

  function visibleLength(token) {
    if (!isMath(token)) return token.length;
    return token
      .replace(/^(\$\$|\$|\\\(|\\\[)|(\$\$|\$|\\\)|\\\])$/g, '')
      .replace(/\\[a-zA-Z]+/g, 'x')            // \times, \mu … draw one glyph
      .replace(/[{}^_\s]/g, '')
      .length;
  }

  /** The first `count` tokens, ending in "…" when that is not all of them. */
  function joinTokens(tokens, count) {
    const text = tokens.slice(0, count).join('');
    return count >= tokens.length ? text : text.replace(/[\s,;:–—-]+$/, '') + '…';
  }

  function tokensWithinCap(tokens) {
    let len = 0;
    for (let i = 0; i < tokens.length; i++) {
      len += visibleLength(tokens[i]);
      if (len > TEXT_CAP) return i;
    }
    return tokens.length;
  }

  async function typeset(el) {
    if (window.MathJaxReady) await window.MathJaxReady;
    if (window.MathJax && MathJax.typesetPromise) {
      MathJax.typesetClear([el]);
      await MathJax.typesetPromise([el]).catch((err) => console.error('MathJax render error:', err));
    }
  }

  /** Fills `el` (inside `box`, which centres it) with as much of the
      condition as fits in `box`. */
  async function fitCondition(box, el, text) {
    const tokens = text.match(TOKEN_RE) || [];
    let count = tokensWithinCap(tokens);
    const show = async (n) => { el.textContent = joinTokens(tokens, n); await typeset(el); };
    const overflows = () => el.offsetHeight > box.clientHeight + 1;

    for (const size of TEXT_SIZES) {
      box.style.fontSize = size + 'px';
      await show(count);
      if (!overflows()) return;
    }
    // Binary search for the most tokens that still fit.
    let lo = 0, hi = count;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      await show(mid);
      if (overflows()) hi = mid; else lo = mid;
    }
    await show(lo);
  }

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  // Soft circular blobs behind everything: [left, top, diameter, colour].
  // Kept off the middle of the figure's side: a figure's filled areas are
  // the flat page colour and would show as boxes over a bubble.
  const BUBBLES = [
    [-320, -360, 1000, 'c1'], [260, 180, 760, 'white'], [-180, 640, 620, 'white'],
    [560, -120, 380, 'white'], [420, 820, 440, 'c1'],
    [1640, -540, 800, 'white'], [1580, 820, 900, 'c1'],
  ];

  // Most of the solution ever typeset, in source characters: more could
  // never fit, and MathJax would only spend time on it.
  const SOLUTION_CAP = 1500;
  const SOLUTION_MATH_MIN = 0.6;   // smallest a too-wide equation is scaled to

  /** The start of the solution: centred when it all fits, otherwise it
      fills the column and fades away at the bottom. */
  async function drawSolution(panel, source) {
    const box = el('div', 'sc-sol');
    const inner = el('div', 'sc-sol-inner');
    const body = el('div', 'sol-text');
    inner.append(el('div', 'sc-sol-label', 'Solution'), body);
    box.appendChild(inner);
    panel.appendChild(box);

    let used = 0, capped = false;
    for (const block of splitSolutionBlocks(source)) {
      if (used >= SOLUTION_CAP) { capped = true; break; }
      used += block.length;
      body.appendChild(el('div', 'sol-line', block));
    }
    await typeset(body);

    // An equation wider than the column is scaled down to fit, not cut.
    body.querySelectorAll('mjx-container[display="true"]').forEach((m) => {
      const k = body.clientWidth / m.scrollWidth;
      if (k < 1) m.style.fontSize = Math.max(SOLUTION_MATH_MIN, k) * 100 + '%';
    });

    if (capped || inner.offsetHeight > box.clientHeight + 1) box.classList.add('sc-sol-cut');
  }

  function drawFigure(panel, steps) {
    const last = steps[steps.length - 1];
    const box = el('div', 'sc-fig fig');
    box.innerHTML = figSanitizeSvg(last.svg);   // inlined, so always sanitized
    panel.appendChild(box);
    figCropToContent(box);
    if (steps.length > 1) panel.appendChild(el('div', 'sc-step', `${steps.length} / ${steps.length}`));
  }

  // Control characters can't be in XML, and the picture is made from the
  // card serialized into an SVG (toJpeg): one stray character in the text
  // (which MathJax also copies into attributes) and no picture is made.
  const printable = (s) => String(s || '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, '');

  async function build(host, data) {
    const steps = (data.steps || []).filter((s) => s && typeof s.svg === 'string' && s.svg.trim());
    const solution = steps.length ? '' : printable(data.solution).trim();

    const card = el('div', 'sc-card' + (steps.length || solution ? '' : ' sc-solo'));
    const bg = el('div', 'sc-bubbles');
    BUBBLES.forEach(([x, y, d, c]) => {
      const b = el('div', 'sc-bubble sc-bubble-' + c);
      b.style.cssText = `left:${x}px;top:${y}px;width:${d}px;height:${d}px`;
      bg.appendChild(b);
    });
    card.appendChild(bg);

    const left = el('div', 'sc-left');
    const head = el('div', 'sc-head');
    head.append(el('span', 'sc-brand', data.brand), el('span', 'sc-sep'),
      el('span', 'sc-course', data.course), el('span', 'sc-sep'), el('span', 'sc-label', data.label));
    const text = el('div', 'sc-text');
    const textInner = el('div', 'sc-text-inner');
    text.appendChild(textInner);
    left.append(head, text);
    card.appendChild(left);

    let panel = null;
    if (steps.length || solution) {
      panel = el('div', 'sc-panel');
      card.appendChild(panel);
    }

    host.textContent = '';
    host.appendChild(card);

    // Measuring before the fonts arrive would fit the text in the
    // fallback font's metrics.
    await Promise.all(['italic 900 64px Kanit', '600 40px "IBM Plex Mono"', '40px "STIX Two Text"']
      .map((f) => document.fonts.load(f).catch(() => {})));
    if (steps.length) drawFigure(panel, steps);
    else if (solution) await drawSolution(panel, solution);
    await fitCondition(text, textInner, printable(conditionText(data.condition)));
    await document.fonts.ready;
    return card;
  }

  /* ── The stored image and the link's text ─────────────────────────── */

  // Bump when the card's look changes: the editor then offers to redraw
  // every stored image made with an older design (share.design).
  // 2: the stored image is 1280×720 instead of 1920×1080.
  // 3: Ocean dark instead of Ocean light.
  const DESIGN = 3;
  const JPEG_QUALITY = 0.9;

  // The card is laid out at W×H but stored at 1280×720: apps show it at
  // a few hundred pixels wide anyway, and it is about half the bytes.
  // Keep in step with og:image:width/height in netlify/edge-functions/share.ts.
  const IMAGE_W = 1280;

  // The card's Google fonts. html-to-image embeds the page's own fonts
  // (MathJax, TikZ) by itself but can't read this cross-origin stylesheet,
  // and a font missing from the image falls back to another one, drawn
  // over a layout measured with the real one. Only the subsets the card's
  // text can need, as each is a separate file inlined into every image.
  const FONT_CSS_URL = 'https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@600'
    + '&family=IBM+Plex+Sans:wght@400;600&family=STIX+Two+Text:ital,wght@0,400;1,400'
    + '&family=Kanit:ital,wght@1,900&display=swap';
  const FONT_SUBSETS = ['latin', 'latin-ext', 'greek'];
  let fontCSS = null;

  const dataUrl = (blob) => new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });

  /** @font-face rules for the Google fonts with the files inlined, fetched
      once per page. */
  function googleFontCSS() {
    fontCSS = fontCSS || (async () => {
      const res = await fetch(FONT_CSS_URL);
      if (!res.ok) throw new Error('could not load the card fonts');
      // Each rule follows a /* subset */ comment.
      const rules = (await res.text()).split('/* ').slice(1)
        .filter((block) => FONT_SUBSETS.includes(block.slice(0, block.indexOf(' */'))))
        .map((block) => block.slice(block.indexOf('*/') + 2));
      return (await Promise.all(rules.map(async (rule) => {
        const url = (rule.match(/url\((https:[^)]+)\)/) || [])[1];
        if (!url) return rule;
        const file = await fetch(url);
        if (!file.ok) throw new Error('could not load the card fonts');
        return rule.replace(url, await dataUrl(await file.blob()));
      }))).join('\n');
    })().catch((e) => { fontCSS = null; throw e; });
    return fontCSS;
  }

  /** A card from build() as a JPEG data: URL. html-to-image redraws the
      DOM inside an SVG and paints that onto a canvas. */
  async function toJpeg(card) {
    const [own, google] = await Promise.all([htmlToImage.getFontEmbedCSS(card), googleFontCSS()]);
    return htmlToImage.toJpeg(card, {
      width: W, height: H, pixelRatio: IMAGE_W / W, quality: JPEG_QUALITY,
      backgroundColor: getComputedStyle(card).getPropertyValue('--bg').trim(),
      fontEmbedCSS: own + '\n' + google,
    });
  }

  const SYMBOLS = {
    times: '×', cdot: '·', pm: '±', mp: '∓', circ: '°', infty: '∞', to: '→', rightarrow: '→',
    le: '≤', leq: '≤', ge: '≥', geq: '≥', ne: '≠', neq: '≠', approx: '≈', sim: '∼', propto: '∝',
    partial: '∂', nabla: '∇', degree: '°', ell: 'ℓ', hbar: 'ħ', sqrt: '√', int: '∫', sum: 'Σ',
    alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', epsilon: 'ε', varepsilon: 'ε', zeta: 'ζ',
    eta: 'η', theta: 'θ', vartheta: 'θ', kappa: 'κ', lambda: 'λ', mu: 'μ', nu: 'ν', xi: 'ξ',
    pi: 'π', rho: 'ρ', sigma: 'σ', tau: 'τ', phi: 'φ', varphi: 'φ', chi: 'χ', psi: 'ψ', omega: 'ω',
    Gamma: 'Γ', Delta: 'Δ', Theta: 'Θ', Lambda: 'Λ', Pi: 'Π', Sigma: 'Σ', Phi: 'Φ', Psi: 'Ψ', Omega: 'Ω',
  };
  const SUP = { 0: '⁰', 1: '¹', 2: '²', 3: '³', 4: '⁴', 5: '⁵', 6: '⁶', 7: '⁷', 8: '⁸', 9: '⁹', '-': '⁻', '+': '⁺' };
  const SUB = { 0: '₀', 1: '₁', 2: '₂', 3: '₃', 4: '₄', 5: '₅', 6: '₆', 7: '₇', 8: '₈', 9: '₉' };
  const script = (s, map, mark) => ([...s].every((c) => map[c]) ? [...s].map((c) => map[c]).join('') : mark + s);

  /** LaTeX maths as readable plain text, for the link description (which
      apps show as text, not typeset). Good enough for what problems use:
      symbols, \text{}, fractions, simple powers and indices. */
  function mathToText(tex) {
    let s = tex;
    for (let i = 0; i < 4; i++) {           // innermost groups first
      s = s.replace(/\\(?:text|mathrm|mathbf|mathit|operatorname|vb|vu|mathsf)\{([^{}]*)\}/g, '$1')
        .replace(/\\(?:dd)\{([^{}]*)\}/g, 'd$1')
        .replace(/\\frac\{([^{}]*)\}\{([^{}]*)\}/g, '($1)/($2)')
        .replace(/\\sqrt\{([^{}]*)\}/g, '√($1)')
        .replace(/\^\{([^{}]*)\}/g, (m, x) => script(x, SUP, '^'))
        .replace(/_\{([^{}]*)\}/g, (m, x) => script(x, SUB, '_'));
    }
    return s
      .replace(/\^([0-9])/g, (m, x) => SUP[x]).replace(/_([0-9])/g, (m, x) => SUB[x])
      .replace(/\\([A-Za-z]+)/g, (m, name) => SYMBOLS[name] || '')
      .replace(/\\[,;:! ]/g, ' ').replace(/\\%/g, '%')
      .replace(/\((\w)\)\/\((\w)\)/g, '$1/$2')   // (a)/(b) -> a/b for single letters
      .replace(/[{}]/g, '').replace(/\\/g, '')
      .replace(/\s+/g, ' ').trim();
  }

  /** og:title and og:description for a shared link to this solution. */
  function linkText({ app, label, condition }) {
    const plain = conditionText(condition)
      .replace(/\$\$([\s\S]+?)\$\$|\\\[([\s\S]+?)\\\]|\\\(([\s\S]+?)\\\)|\$((?:\\.|[^$\\])+)\$/g,
        (m, a, b, c, d) => mathToText(a || b || c || d))
      .replace(/\s+/g, ' ').trim();
    const description = plain.length > 200 ? plain.slice(0, 200).replace(/\s+\S*$/, '') + '…' : plain;
    return { title: `${label} · Solution | ${app}`, description };
  }

  return { W, H, TEXT_CAP, DESIGN, build, toJpeg, linkText, conditionText };
})();
