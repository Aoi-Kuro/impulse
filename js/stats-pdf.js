// ─── Stats PDF (loaded on demand by js/stats-export.js) ────────────────────
// buildStatsPdf() saves the practice exam record as an A4 PDF in the same
// style as the Entire Set PDF (js/pdf-build.js, whose helpers it uses):
//   page 1     the course logo and name (a link to the site), the
//              identicon in a rounded tile, the nickname, the date
//   page 2 on  "Stats" with a one-line summary, a per-set overview table,
//              two black-and-white charts, then every attempt in a table
//   last       the logo's jump and a closing box with a link and a QR code
//              to the site
//   from p. 2  the logo and name at the bottom left, the page number at
//              the bottom right
//
// The charts are black and white so they survive printing: black outlines,
// a grey fill and a diagonal hatch for the bars, filled and open markers for
// the two modes. Scores are shown as a share of the attempt's maximum, so
// sets with different maxima compare.

const SPDF_GREY = '#8f8f8f', SPDF_INK = '#1a1a1a', SPDF_HAIR = '#d4d4d4';

function _spdfPct(a) { return a.maxScore ? (100 * a.score) / a.maxScore : 0; }

function _spdfDay(d) {
  return new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

function _spdfTotalTime(sec) {
  const m = Math.round(sec / 60);
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)} h ${m % 60} min`;
}

async function buildStatsPdf() {
  const attempts = (typeof loadStats === 'function' ? loadStats() : [])
    .slice().sort((a, b) => new Date(a.date) - new Date(b.date));     // oldest first
  const appName = typeof APP_NAME === 'string' ? APP_NAME : 'Impulse';
  const brand = typeof BRAND_NAME === 'string' ? BRAND_NAME : appName.toUpperCase();
  const siteUrl = pdfxSiteUrl();
  const siteShort = siteUrl.replace(/^https?:\/\//, '').replace(/\/$/, '');
  const nickname = (typeof getForumNickname === 'function' && getForumNickname()) || '';
  const now = new Date();
  const theme = PDFB_THEMES.light;
  const setName = n => (typeof QUIZZES !== 'undefined' && QUIZZES[n - 1] && QUIZZES[n - 1].name) || '';

  await _pdfbLoadTools();
  const fonts = await _pdfbLoadFonts();
  const logo = await _pdfbLogo().catch(() => null);
  const avatar = nickname ? await _pdfbAvatar(nickname) : null;

  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: 'pt', format: 'a4', compress: true });
  fonts.forEach(f => { doc.addFileToVFS(f.file, f.data); doc.addFont(f.file, f.family, f.style); });
  const W = PDFB_PAGE_W, H = PDFB_PAGE_H, L = PDFB_MARGIN_X, R = W - PDFB_MARGIN_X, TW = R - L;
  const bottom = H - PDFB_BOTTOM;
  const S = { y: PDFB_TOP };

  const color = (hex, kind) => {
    const [r, g, b] = _pdfbRgb(hex);
    if (kind === 'fill') doc.setFillColor(r, g, b);
    else if (kind === 'draw') doc.setDrawColor(r, g, b);
    else doc.setTextColor(r, g, b);
  };
  const font = (style, size) => { doc.setFont(PDFB_FONT, style || 'normal'); doc.setFontSize(size); };
  const textW = (s, style, size) => { font(style, size); return doc.getTextWidth(s); };
  const fit = (s, style, size, maxW) => {
    if (textW(s, style, size) <= maxW) return s;
    let t = s;
    while (t.length > 1 && textW(t + '…', style, size) > maxW) t = t.slice(0, -1);
    return t.trimEnd() + '…';
  };
  const brandFont = size => { doc.setFont(PDFB_BRAND_FONT, 'normal'); doc.setFontSize(size); };
  const drawSvg = (el, x, y, w, h) => doc.svg(el.cloneNode(true), { x, y, width: w, height: h });
  const newPage = () => { doc.addPage('a4', 'portrait'); S.y = PDFB_TOP; };
  const ensure = h => { if (S.y + h > bottom) { newPage(); return true; } return false; };
  const line = (x1, y1, x2, y2, w, hex) => { doc.setLineWidth(w); color(hex || SPDF_INK, 'draw'); doc.line(x1, y1, x2, y2); };
  const heading = (text) => {
    ensure(40);
    font('bold', 13); color(theme.fg);
    doc.text(text, L, S.y + 12);
    S.y += 24;
  };

  // Diagonal hatch inside a rectangle, as real lines clipped by hand (prints
  // the same everywhere, unlike a pattern fill).
  const hatch = (x, y, w, h, step) => {
    doc.setLineWidth(0.9); color(SPDF_INK, 'draw');
    for (let t = -h; t < w; t += step) {
      const u0 = Math.max(0, -t), u1 = Math.min(h, w - t);
      if (u1 <= u0) continue;
      doc.line(x + t + u0, y + h - u0, x + t + u1, y + h - u1);
    }
  };
  // A bar: grey fill or hatch, always a black outline.
  const bar = (x, y, w, h, kind) => {
    if (h <= 0) { line(x, y, x + w, y, 0.9); return; }
    if (kind === 'grey') { color(SPDF_GREY, 'fill'); doc.rect(x, y, w, h, 'F'); }
    else { color('#ffffff', 'fill'); doc.rect(x, y, w, h, 'F'); hatch(x, y, w, h, 5); }
    doc.setLineWidth(0.9); color(SPDF_INK, 'draw'); doc.rect(x, y, w, h, 'S');
  };
  // r: smaller when a panel holds many attempts, so the dots stay apart.
  const marker = (x, y, open, r = 2.3) => {
    doc.setLineWidth(r < 1.6 ? 0.5 : 0.8); color(SPDF_INK, 'draw');
    color(open ? '#ffffff' : SPDF_INK, 'fill');
    doc.circle(x, y, r, 'FD');
  };

  // ── Page 1: cover, as the Entire Set PDF's ──
  {
    const logoH = 170, top = 180;
    let y = top;
    const lw = logo ? logoH * logo.ratio : 0;
    if (logo) await drawSvg(logo.el, (W - lw) / 2, y, lw, logoH);
    y += logoH + 76;
    const size = 56, cs = size * 0.03;
    brandFont(size); color(theme.fg);
    const ww = doc.getTextWidth(brand) + cs * (brand.length - 1);
    doc.text(brand, (W - ww) / 2, y, { charSpace: cs });
    const linkW = Math.max(ww, lw) + 20;
    doc.link((W - linkW) / 2, top - 6, linkW, y - top + 20, { url: siteUrl });
    y += 64;
    if (nickname) {
      const nameFs = 13, av = 20, padA = 4, tile = av + padA * 2, gap = 10;
      const nameW = textW(nickname, 'normal', nameFs);
      const gw = (avatar ? tile + gap : 0) + nameW;
      let x = (W - gw) / 2;
      if (avatar) {
        const ty = y - nameFs * 0.33 - tile / 2;
        color(theme.tile, 'fill'); color(theme.rule, 'draw');
        doc.setLineWidth(0.6);
        doc.roundedRect(x, ty, tile, tile, 4.5, 4.5, 'FD');
        await drawSvg(avatar, x + padA, ty + padA, av, av);
        x += tile + gap;
      }
      font('normal', nameFs); color(theme.fg);
      doc.text(nickname, x, y);
      y += 28;
    }
    font('italic', 11); color(theme.fg);
    doc.text('Practice exam stats', W / 2, y, { align: 'center' });
    y += 20;
    font('normal', 9.5); color(theme.muted);
    doc.text(_pdfbDateLine(now), W / 2, y, { align: 'center' });
  }

  // ── Page 2: title and summary ──
  newPage();
  {
    font('bold', 22); color(theme.fg);
    doc.text('Stats', L, S.y + 20);
    font('normal', 13);
    let sub = 'No practice exams yet';
    if (attempts.length) {
      const total = attempts.reduce((s, a) => s + (a.duration || 0), 0);
      const first = _spdfDay(attempts[0].date), last = _spdfDay(attempts[attempts.length - 1].date);
      sub = `${attempts.length} practice exam${attempts.length === 1 ? '' : 's'} | `
        + (first === last ? first : `${first} to ${last}`) + ` | ${_spdfTotalTime(total)} in all`;
    }
    doc.text(fit(sub, 'normal', 13, TW), L, S.y + 42);
    line(L, S.y + 56, R, S.y + 56, 0.6, theme.rule);
    S.y += 74;
  }

  // Per set: attempts, average, best, last.
  const sets = [];
  for (let n = 1; n <= (typeof QUIZZES !== 'undefined' ? QUIZZES.length : 4); n++) {
    const list = attempts.filter(a => a.quizNum === n);
    if (!list.length) continue;
    const pcts = list.map(_spdfPct);
    sets.push({
      n, list,
      avg: pcts.reduce((s, v) => s + v, 0) / pcts.length,
      best: Math.max(...pcts),
      last: pcts[pcts.length - 1],
    });
  }

  if (sets.length) {
    // ── Overview table ──
    ensure(24 + 17 * (sets.length + 1) + 30);
    heading('By set');
    const cols = [
      { t: 'Set', w: TW - 4 * 66, a: 'left' },
      { t: 'Attempts', w: 66, a: 'right' }, { t: 'Average', w: 66, a: 'right' },
      { t: 'Best', w: 66, a: 'right' }, { t: 'Last', w: 66, a: 'right' },
    ];
    const row = (cells, style, rule) => {
      let x = L;
      font(style, 9.5); color(theme.fg);
      cells.forEach((c, i) => {
        const col = cols[i];
        const s = i === 0 ? fit(c, style, 9.5, col.w - 8) : c;
        if (col.a === 'right') doc.text(s, x + col.w, S.y + 10, { align: 'right' });
        else doc.text(s, x, S.y + 10);
        x += col.w;
      });
      S.y += 15;
      if (rule) line(L, S.y - 2, R, S.y - 2, rule.w, rule.c);
    };
    row(cols.map(c => c.t), 'bold', { w: 0.8, c: SPDF_INK });
    S.y += 2;
    sets.forEach(s => row([`Set ${s.n}: ${setName(s.n)}`, String(s.list.length),
      `${Math.round(s.avg)}%`, `${Math.round(s.best)}%`, `${Math.round(s.last)}%`], 'normal', null));
    line(L, S.y + 1, R, S.y + 1, 0.8, SPDF_INK);
    S.y += 24;

    // ── Chart 1: average and best per set ──
    {
      const h = 150, axisW = 30, plotW = TW - axisW, legendH = 16, headroom = 14;
      ensure(24 + legendH + headroom + h + 30);
      heading('Average and best score per set');
      // Legend
      font('normal', 8.5); color(theme.fg);
      let lx = L + axisW;
      bar(lx, S.y + 1, 14, 9, 'grey'); color(theme.fg); doc.text('Average', lx + 19, S.y + 9); lx += 70;
      bar(lx, S.y + 1, 14, 9, 'hatch'); color(theme.fg); doc.text('Best', lx + 19, S.y + 9);
      const top = S.y + legendH + headroom, x0 = L + axisW, yOf = p => top + h * (1 - p / 100);
      // Axis and ticks
      font('normal', 8); color(theme.fg);
      [0, 25, 50, 75, 100].forEach(p => {
        line(x0 - 4, yOf(p), x0, yOf(p), 0.7);
        doc.text(`${p}%`, x0 - 7, yOf(p) + 2.8, { align: 'right' });
        if (p) line(x0, yOf(p), R, yOf(p), 0.3, SPDF_HAIR);
      });
      line(x0, top, x0, top + h, 0.9);
      line(x0, top + h, R, top + h, 0.9);
      // Bars
      const slot = plotW / sets.length;
      const bw = Math.min(26, slot / 3.2);
      sets.forEach((s, i) => {
        const cx = x0 + slot * (i + 0.5);
        [[s.avg, 'grey', cx - bw - 2], [s.best, 'hatch', cx + 2]].forEach(([v, kind, x]) => {
          bar(x, yOf(v), bw, top + h - yOf(v), kind);
          font('normal', 8); color(theme.fg);
          doc.text(`${Math.round(v)}%`, x + bw / 2, yOf(v) - 4, { align: 'center' });
        });
        font('normal', 9); color(theme.fg);
        doc.text(`Set ${s.n}`, cx, top + h + 13, { align: 'center' });
      });
      S.y = top + h + 30;
    }

    // ── Chart 2: every attempt, one panel per set ──
    {
      ensure(24 + 20 + 22 + 6 + 96 + 22);
      heading('Every attempt, in order');
      font('normal', 8.5); color(theme.fg);
      let lx = L;
      marker(lx + 3, S.y + 6, false); doc.text('Single Set', lx + 10, S.y + 9); lx += 70;
      marker(lx + 3, S.y + 6, true); color(theme.fg); doc.text('Sets 1–N', lx + 10, S.y + 9); lx += 66;
      doc.setLineDashPattern([2.5, 2], 0); line(lx, S.y + 6, lx + 16, S.y + 6, 0.8);
      doc.setLineDashPattern([], 0); color(theme.fg); doc.text('Average', lx + 21, S.y + 9);
      S.y += 20;

      const gapX = 26, pw = (TW - gapX) / 2, ph = 96, axisW = 26, titleH = 22, below = 22;
      for (let i = 0; i < sets.length; i += 2) {
        ensure(titleH + 6 + ph + below);
        const rowTop = S.y;
        for (let k = 0; k < 2 && i + k < sets.length; k++) {
          const s = sets[i + k];
          const px = L + k * (pw + gapX);
          font('bold', 9.5); color(theme.fg);
          doc.text(fit(`Set ${s.n}: ${setName(s.n)}`, 'bold', 9.5, pw), px, rowTop + 9);
          const top = rowTop + titleH + 6, x0 = px + axisW, iw = pw - axisW - 4;
          const yOf = p => top + ph * (1 - p / 100);
          font('normal', 7.5); color(theme.fg);
          [0, 50, 100].forEach(p => {
            line(x0 - 3, yOf(p), x0, yOf(p), 0.6);
            doc.text(`${p}%`, x0 - 5, yOf(p) + 2.5, { align: 'right' });
            if (p) line(x0, yOf(p), x0 + iw, yOf(p), 0.3, SPDF_HAIR);
          });
          line(x0, top, x0, top + ph, 0.8);
          line(x0, top + ph, x0 + iw, top + ph, 0.8);
          const n = s.list.length;
          const xOf = j => n === 1 ? x0 + iw / 2 : x0 + 6 + (iw - 12) * j / (n - 1);
          // Attempt numbers under the axis: first, last and a few between.
          const tickEvery = Math.max(1, Math.ceil(n / 8));
          for (let j = 0; j < n; j++) {
            if (j % tickEvery && j !== n - 1) continue;
            if (j !== n - 1 && n - 1 - j < tickEvery / 2) continue;
            line(xOf(j), top + ph, xOf(j), top + ph + 3, 0.6);
            doc.text(String(j + 1), xOf(j), top + ph + 11, { align: 'center' });
          }
          doc.setLineDashPattern([2.5, 2], 0);
          line(x0, yOf(s.avg), x0 + iw, yOf(s.avg), 0.8);
          doc.setLineDashPattern([], 0);
          // Dots shrink as the attempts crowd: 2.3 pt up to about 25 attempts,
          // down to 1 pt; the line thins with them.
          const spacing = n > 1 ? (iw - 12) / (n - 1) : iw;
          const r = Math.max(1, Math.min(2.3, spacing * 0.42));
          if (n > 1) {
            doc.setLineWidth(r < 1.6 ? 0.5 : 1); color(SPDF_INK, 'draw');
            for (let j = 1; j < n; j++) doc.line(xOf(j - 1), yOf(_spdfPct(s.list[j - 1])), xOf(j), yOf(_spdfPct(s.list[j])));
          }
          s.list.forEach((a, j) => marker(xOf(j), yOf(_spdfPct(a)), a.mode === 'cumulative', r));
        }
        S.y = rowTop + titleH + 6 + ph + below;
      }
      font('italic', 8.5); color(theme.muted);
      doc.text('Across: attempt number in each set, oldest first.', L, S.y + 4);
      S.y += 26;
    }

    // ── Every attempt ──
    ensure(24 + 16 + 14.5 * 3);
    heading('All attempts, newest first');
    {
      const cols = [
        { t: '#', w: 24, a: 'right' }, { t: 'Set', w: 0, a: 'left' }, { t: 'Mode', w: 64, a: 'left' },
        { t: 'Date and time', w: 108, a: 'left' }, { t: 'Duration', w: 52, a: 'right' }, { t: 'Score', w: 54, a: 'right' },
      ];
      cols[1].w = TW - cols.reduce((s, c) => s + c.w, 0) - 10;
      const gaps = [0, 10, 0, 0, 0, 0];
      const rowH = 14.5;
      const head = () => {
        let x = L;
        font('bold', 9); color(theme.fg);
        cols.forEach((c, i) => {
          x += gaps[i];
          if (c.a === 'right') doc.text(c.t, x + c.w, S.y + 10, { align: 'right' });
          else doc.text(c.t, x, S.y + 10);
          x += c.w;
        });
        S.y += 14;
        line(L, S.y - 1, R, S.y - 1, 0.8);
        S.y += 2;
      };
      head();
      const newest = attempts.slice().reverse();
      newest.forEach((a, idx) => {
        if (S.y + rowH > bottom) { newPage(); head(); }
        const d = new Date(a.date);
        const cells = [
          String(newest.length - idx),
          `Set ${a.quizNum}: ${setName(a.quizNum)}`,
          a.mode === 'cumulative' ? `Sets 1–${a.quizNum}` : 'Single Set',
          `${_spdfDay(d)}, ${d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`,
          typeof fmtDuration === 'function' ? fmtDuration(a.duration) : `${a.duration || 0}s`,
          `${a.score} / ${a.maxScore}`,
        ];
        let x = L;
        font('normal', 9); color(theme.fg);
        cols.forEach((c, i) => {
          x += gaps[i];
          const s = i === 1 ? fit(cells[i], 'normal', 9, c.w - 4) : cells[i];
          if (c.a === 'right') doc.text(s, x + c.w, S.y + 10, { align: 'right' });
          else doc.text(s, x, S.y + 10);
          x += c.w;
        });
        S.y += rowH;
        if ((idx + 1) % 5 === 0 && idx + 1 < newest.length) line(L, S.y - 2, R, S.y - 2, 0.3, SPDF_HAIR);
      });
      line(L, S.y + 1, R, S.y + 1, 0.8);
      S.y += 10;
    }
  } else {
    font('italic', 11); color(theme.muted);
    doc.text('Take a practice exam and it shows up here.', L, S.y + 10);
    S.y += 30;
  }

  // ── The logo's jump, then the closing box (as in the Entire Set PDF) ──
  {
    const s = 11, arc = 52;
    const need = arc + 3.4 * s + 40;
    const boxNeed = 96 + 32 + 6;
    if (S.y + 28 + need + boxNeed > bottom) newPage(); else S.y += 28;
    const ground = S.y + need - 14;
    const x0 = L + 3 * s, x1 = R - 3 * s;
    const restBottom = Math.max(..._pdfbCubeFaces(0).flatMap(f => f.pts.map(p => p[1])));
    const cube = (t, opacity) => {
      const faces = _pdfbCubeFaces(_pdfbTumbleEase(t));
      const cx = x0 + (x1 - x0) * t;
      const dy = -arc * 4 * t * (1 - t);
      doc.setGState(new doc.GState({ opacity, 'stroke-opacity': opacity }));
      faces.forEach(f => {
        const pts = f.pts.map(p => [cx + p[0] * s, ground + (p[1] - restBottom) * s + dy]);
        color(f.c, 'fill');
        doc.setDrawColor(0, 0, 0);
        doc.setLineWidth(0.35);
        const d = pts.slice(1).map((p, i) => [p[0] - pts[i][0], p[1] - pts[i][1]]);
        doc.lines(d, pts[0][0], pts[0][1], [1, 1], 'FD', true);
      });
    };
    for (let k = 1; k < 60; k++) if (k % 6) cube(k / 60, 0.05);
    for (let k = 1; k < 10; k++) cube(k / 10, 0.2);
    cube(0, 1);
    cube(1, 1);
    doc.setGState(new doc.GState({ opacity: 1, 'stroke-opacity': 1 }));
    S.y = ground + 14;
  }
  {
    const qrSize = 90, pad = 16;
    const colW = TW - pad * 3 - qrSize;
    S.y += 6;
    const top = S.y;
    S.y = top + pad;
    font('bold', 13); color(theme.fg);
    doc.text('Keep going.', L + pad, S.y + 11);
    S.y += 24;
    const body = `Every practice exam you take on ${appName} adds to these pages. Check answers instantly, `
      + 'work through whole sets and follow your progress.';
    font('normal', 10); color(theme.fg);
    doc.splitTextToSize(body, colW).forEach(ln => { doc.text(ln, L + pad, S.y + 9); S.y += 14.2; });
    S.y += 6;
    doc.textWithLink(siteShort, L + pad, S.y + 9, { url: siteUrl });
    line(L + pad, S.y + 10.5, L + pad + textW(siteShort, 'normal', 10), S.y + 10.5, 0.4);
    S.y += 16;
    const boxBottom = Math.max(S.y, top + pad + qrSize + 14) + pad;
    line(L, top, R, top, 0.8); line(L, boxBottom, R, boxBottom, 0.8);
    line(L, top, L, boxBottom, 0.8); line(R, top, R, boxBottom, 0.8);
    const code = qrcode(0, 'L');
    code.addData(siteUrl, 'Byte');
    code.make();
    const n = code.getModuleCount();
    const quiet = 4 * qrSize / (n + 8), cell = (qrSize - quiet * 2) / n;
    const qx = R - pad - qrSize, qy = top + pad;
    doc.setFillColor(255, 255, 255); doc.rect(qx, qy, qrSize, qrSize, 'F');
    doc.setFillColor(0, 0, 0);
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
      if (code.isDark(r, c)) doc.rect(qx + quiet + c * cell, qy + quiet + r * cell, cell + 0.02, cell + 0.02, 'F');
    }
    doc.link(qx, qy, qrSize, qrSize, { url: siteUrl });
    font('normal', 7.5); color(theme.muted);
    doc.text(appName, qx + qrSize / 2, qy + qrSize + 10, { align: 'center' });
    S.y = boxBottom;
  }

  // ── Footers from page 2 ──
  const pages = doc.getNumberOfPages();
  for (let i = 2; i <= pages; i++) {
    doc.setPage(i);
    const y = H - 30, lh = 11;
    let x = L;
    if (logo) { await drawSvg(logo.el, x, y - lh + 1.5, lh * logo.ratio, lh); x += lh * logo.ratio + 5; }
    const bfs = 9.5, bcs = bfs * 0.03;
    brandFont(bfs); color(theme.fg);
    doc.text(brand, x, y, { charSpace: bcs });
    const bw = doc.getTextWidth(brand) + bcs * (brand.length - 1);
    doc.link(L, y - lh, x - L + bw, lh + 3, { url: siteUrl });
    font('normal', 8); color(theme.muted);
    doc.text(`${i} / ${pages}`, R, y, { align: 'right' });
    doc.text(nickname ? `Stats | ${fit(nickname, 'normal', 8, 160)}` : 'Stats', W / 2, y, { align: 'center' });
  }

  doc.setProperties({
    title: `${appName} stats${nickname ? ', ' + nickname : ''}`,
    subject: `${typeof COURSE_CODE_DISPLAY === 'string' ? COURSE_CODE_DISPLAY + ' ' : ''}practice exam record`,
    author: nickname || appName,
    creator: `${appName} (${siteUrl})`,
  });
  // "Impulse_stats_20261124_143005.pdf"
  const two = v => String(v).padStart(2, '0');
  const stamp = `${now.getFullYear()}${two(now.getMonth() + 1)}${two(now.getDate())}_${two(now.getHours())}${two(now.getMinutes())}${two(now.getSeconds())}`;
  doc.save(`${appName}_stats_${stamp}.pdf`);
  return { pages };
}
