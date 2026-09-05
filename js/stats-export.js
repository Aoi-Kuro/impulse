// ═══════════════════════════════════════════════════════════════════════════
// stats-export.js — Stats screen export (CSV / TXT / Excel / PDF)
// ───────────────────────────────────────────────────────────────────────────
// Replaces the old encrypted-backup exportStats()/import flow entirely (see
// js/stats.js for the attempt-log data model this reads from). No import
// feature exists anymore — this is export-only, four formats, all built
// from the same attempt-level summary rows: Quiz | Mode | Date & Time |
// Duration | Score.
//
// The export always covers the user's FULL attempt history, regardless of
// whatever quiz/mode filters (sfQuizzes/sfMode) are currently active on the
// live stats screen — same "complete record" semantics the old backup
// export had. This applies to the table in every format and to the PDF's
// chart.
//
// CSV/TXT/Excel are plain client-side generation (Excel via the vendored
// SheetJS build). PDF is the involved one: jsPDF + svg2pdf.js (vector SVG →
// PDF, used for both the avatar and a purpose-built vector chart) +
// jspdf-autotable (paginated table), with IBM Plex Sans/Mono embedded so
// the document's fonts are fixed regardless of the site's active color
// theme. All four PDF libraries plus the embedded-font module are vendored
// locally under vendor/ (no CDN dependency) and lazy-loaded on demand, so
// visitors who never export never pay for the ~2.5MB of PDF/Excel tooling.
// ═══════════════════════════════════════════════════════════════════════════

const EXPORT_COLUMNS = [
  { key: 'quiz',     label: 'Quiz' },
  { key: 'mode',     label: 'Mode' },
  { key: 'dateTime', label: 'Date & Time' },
  { key: 'duration', label: 'Duration' },
  { key: 'score',    label: 'Score' },
];

// ── Export button gating ─────────────────────────────────────────────────
// Enabled only once the user has a claimed forum identity (no claimed
// identity = no avatar/nickname = they can't take quizzes anyway, so
// there'd be nothing to export). Stays disabled, not hidden.
function updateExportButtonState() {
  const btn = document.getElementById('statsExportBtn');
  if (!btn) return;
  const hasIdentity = typeof getForumNickname === 'function' && !!getForumNickname();
  btn.disabled = !hasIdentity;
  btn.title = hasIdentity ? '' : 'Claim a forum nickname to export your stats';
}

// ── Format-picker modal ──────────────────────────────────────────────────
function openExportFormatModal() {
  const btn = document.getElementById('statsExportBtn');
  if (btn && btn.disabled) return;
  const modal = document.getElementById('exportFormatModal');
  if (modal) modal.classList.add('visible');
}

function closeExportFormatModal() {
  const modal = document.getElementById('exportFormatModal');
  if (modal) modal.classList.remove('visible');
}

let _exportInFlight = false;

async function runExport(format) {
  if (_exportInFlight) return;
  closeExportFormatModal();
  _exportInFlight = true;
  const btn = document.getElementById('statsExportBtn');
  const prevLabel = btn ? btn.textContent : null;
  if (btn) { btn.disabled = true; btn.textContent = 'Exporting…'; }
  try {
    if (format === 'csv') exportStatsCsv();
    else if (format === 'txt') exportStatsTxt();
    else if (format === 'xlsx') await exportStatsXlsx();
    else if (format === 'pdf') await exportStatsPdf();
  } catch (err) {
    console.error('[stats-export]', format, 'export failed:', err);
    alert("Sorry — that export didn't work. Please try again.");
  } finally {
    _exportInFlight = false;
    if (btn) { btn.textContent = prevLabel; updateExportButtonState(); }
  }
}

// ── Shared data helpers ──────────────────────────────────────────────────
// Full, unfiltered attempt history, newest first — ignores whatever
// sfQuizzes/sfMode filters are active on the live screen (see file header).
function _exportAttempts() {
  return loadStats().slice().sort((a, b) => new Date(b.date) - new Date(a.date));
}

// Formats one attempt into the shared display row, matching the same
// conventions renderTable() already uses (quiz name lookup, en-GB date,
// fmtDuration, x/y score).
function _exportRow(a) {
  const name = (typeof QUIZZES !== 'undefined' && QUIZZES[a.quizNum - 1] && QUIZZES[a.quizNum - 1].name) || '';
  const d = new Date(a.date);
  const dateStr = d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  const timeStr = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  return {
    quiz: `#${a.quizNum} · ${name}`,
    mode: a.mode === 'cumulative' ? 'Cumulative' : 'Single',
    dateTime: `${dateStr} ${timeStr}`,
    duration: fmtDuration(a.duration),
    score: `${a.score}/${a.maxScore}`,
    quizNum: a.quizNum,
  };
}

function _exportFilename(ext) {
  const nickname = (typeof getForumNickname === 'function' && getForumNickname()) || 'stats';
  const safe = nickname.replace(/[^a-z0-9_-]+/gi, '_');
  const date = new Date().toISOString().slice(0, 10);
  return `examphys-stats-${safe}-${date}.${ext}`;
}

function _downloadBlob(content, mime, filename) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ── CSV ───────────────────────────────────────────────────────────────────
function _csvEscape(v) {
  const s = String(v);
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

function exportStatsCsv() {
  const rows = _exportAttempts().map(_exportRow);
  const lines = [EXPORT_COLUMNS.map(c => _csvEscape(c.label)).join(',')];
  rows.forEach(r => {
    lines.push(EXPORT_COLUMNS.map(c => _csvEscape(r[c.key])).join(','));
  });
  _downloadBlob(lines.join('\r\n') + '\r\n', 'text/csv;charset=utf-8', _exportFilename('csv'));
}

// ── TXT ───────────────────────────────────────────────────────────────────
// Human-readable fixed-width table, not just a renamed CSV.
function exportStatsTxt() {
  const rows = _exportAttempts().map(_exportRow);
  const widths = EXPORT_COLUMNS.map(c =>
    Math.max(c.label.length, ...rows.map(r => String(r[c.key]).length), 1));
  const pad = (s, w) => { s = String(s); return s + ' '.repeat(Math.max(0, w - s.length)); };

  const lines = [];
  lines.push(EXPORT_COLUMNS.map((c, i) => pad(c.label, widths[i])).join('  ').trimEnd());
  lines.push(widths.map(w => '-'.repeat(w)).join('  '));
  rows.forEach(r => {
    lines.push(EXPORT_COLUMNS.map((c, i) => pad(r[c.key], widths[i])).join('  ').trimEnd());
  });

  const nickname = (typeof getForumNickname === 'function' && getForumNickname()) || '';
  const header = `examphys — stats export${nickname ? ' for ' + nickname : ''}\n` +
    `Exported ${new Date().toLocaleString('en-GB')}\n` +
    `${rows.length} attempt${rows.length !== 1 ? 's' : ''}\n\n`;

  _downloadBlob(header + lines.join('\n') + '\n', 'text/plain;charset=utf-8', _exportFilename('txt'));
}

// ── Excel (.xlsx) via vendored SheetJS ───────────────────────────────────
function _loadScript(src) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) { resolve(); return; }
    const s = document.createElement('script');
    s.src = src;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('Failed to load ' + src));
    document.head.appendChild(s);
  });
}

async function _ensureXlsxLib() {
  if (typeof XLSX !== 'undefined') return;
  await _loadScript('vendor/sheetjs/xlsx.full.min.js');
}

async function exportStatsXlsx() {
  await _ensureXlsxLib();
  const rows = _exportAttempts().map(_exportRow);
  const aoa = [
    EXPORT_COLUMNS.map(c => c.label),
    ...rows.map(r => EXPORT_COLUMNS.map(c => r[c.key])),
  ];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws['!cols'] = [{ wch: 28 }, { wch: 12 }, { wch: 20 }, { wch: 10 }, { wch: 8 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Stats');
  XLSX.writeFile(wb, _exportFilename('xlsx'));
}

// ── PDF ───────────────────────────────────────────────────────────────────
// All vector — no raster images anywhere. The avatar and the chart are both
// fed into svg2pdf.js as real <svg> markup and come out as native PDF
// vector objects, not canvas/PNG snapshots.

async function _ensurePdfLibs() {
  const needFonts = !window.PLEX_FONTS;
  const needCore = !(window.jspdf && window.jspdf.jsPDF);
  if (needCore) await _loadScript('vendor/jspdf/jspdf.umd.min.js');
  // svg2pdf and autotable both self-attach to window.jspdf.jsPDF.API at
  // load time, so jspdf.umd.min.js must finish loading first (awaited
  // above) — order between these two doesn't matter.
  if (!(window.jspdf && window.jspdf.jsPDF && window.jspdf.jsPDF.API && window.jspdf.jsPDF.API.autoTable)) {
    await _loadScript('vendor/jspdf/svg2pdf.umd.min.js');
    await _loadScript('vendor/jspdf/jspdf.plugin.autotable.min.js');
  }
  if (needFonts) await _loadScript('vendor/fonts/plex-fonts-embedded.js');
}

// Converts an 'hsl(H S% L%)' string (forumColorForName()'s format) to hex,
// for the rare vector-initials avatar fallback below — kept as a plain hex
// fill since svg2pdf's color-function support is safest to assume as
// hex/rgb/named only.
function _hslToHex(h, s, l) {
  s /= 100; l /= 100;
  const k = n => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = n => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  const toHex = x => Math.round(255 * x).toString(16).padStart(2, '0');
  return `#${toHex(f(0))}${toHex(f(8))}${toHex(f(4))}`;
}

// Raw SVG markup for the exported avatar. Mirrors the same fallback chain
// loadSfpAvatar() in stats.js already uses (cache → live DiceBear fetch →
// initials), but returns SVG source text rather than a DOM element, and the
// final fallback is a hand-built vector initials badge (not the plain
// colored-<div> initials fallback the live UI uses) so the PDF avatar is
// always a real SVG, never something svg2pdf can't consume.
async function _exportAvatarSvgMarkup(nickname) {
  let svg = (typeof getCachedAvatarSvg === 'function') ? getCachedAvatarSvg(nickname) : null;

  if (!svg && typeof fetchForumIdenticonSvg === 'function') {
    try { svg = await fetchForumIdenticonSvg(nickname); } catch (e) { /* fall through to initials */ }
  }

  if (svg) return svg;

  const initial = ((nickname || '?').trim().charAt(0) || '?').toUpperCase();
  let bg = '#6b7280';
  if (typeof forumColorForName === 'function') {
    const m = /hsl\(([\d.]+)\s+([\d.]+)%\s+([\d.]+)%\)/.exec(forumColorForName(nickname || '?'));
    if (m) bg = _hslToHex(parseFloat(m[1]), parseFloat(m[2]), parseFloat(m[3]));
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
    <circle cx="50" cy="50" r="50" fill="${bg}"/>
    <text x="50" y="52" text-anchor="middle" dominant-baseline="central" font-family="PlexSans" font-weight="bold" font-size="46" fill="#ffffff">${initial}</text>
  </svg>`;
}

// Export-only chart, built as SVG markup rather than drawn to a canvas —
// canvas is pixel-only, there's no way to extract vector paths back out of
// it, so this is a second implementation that mirrors drawChart()'s
// geometry/math (same PAD box, same gridlines/axis/per-quiz-line math) but
// emits real SVG elements instead of canvas draw calls. Additive: does not
// touch drawChart() itself.
//
// Always full, unfiltered, all-quiz, all-time history — ignores sfMode/
// sfQuizzes regardless of what's active on the live stats screen.
function _buildExportChartSvg(width, height) {
  const PAD = { top: 18, right: 18, bottom: 40, left: 40 };
  const plotW = width - PAD.left - PAD.right;
  const plotH = height - PAD.top - PAD.bottom;
  const MAX_SCORE = 7;

  const all = (typeof loadStats === 'function') ? loadStats() : [];
  const byQuiz = { 1: [], 2: [], 3: [], 4: [] };
  all.forEach(a => { if (byQuiz[a.quizNum]) byQuiz[a.quizNum].push(a); });

  const maxAttempts = Math.max(...Object.values(byQuiz).map(a => a.length), 2);
  const gridColor = '#cccccc';
  const mutedColor = '#666666';

  const parts = [];
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">`);

  for (let s = 0; s <= MAX_SCORE; s++) {
    const y = PAD.top + plotH * (1 - s / MAX_SCORE);
    parts.push(`<line x1="${PAD.left}" y1="${y.toFixed(2)}" x2="${PAD.left + plotW}" y2="${y.toFixed(2)}" stroke="${gridColor}" stroke-width="1"/>`);
    parts.push(`<text x="${PAD.left - 6}" y="${y.toFixed(2)}" font-family="PlexMono" font-size="10" fill="${mutedColor}" text-anchor="end" dominant-baseline="middle">${s}</text>`);
  }

  const step = maxAttempts <= 8 ? 1 : maxAttempts <= 20 ? 2 : Math.ceil(maxAttempts / 10);
  for (let i = 0; i < maxAttempts; i += step) {
    const x = PAD.left + (i / Math.max(maxAttempts - 1, 1)) * plotW;
    parts.push(`<text x="${x.toFixed(2)}" y="${(PAD.top + plotH + 15).toFixed(2)}" font-family="PlexMono" font-size="10" fill="${mutedColor}" text-anchor="middle">${i + 1}</text>`);
  }
  parts.push(`<text x="${(PAD.left + plotW / 2).toFixed(2)}" y="${(PAD.top + plotH + 32).toFixed(2)}" font-family="PlexMono" font-size="9" fill="${mutedColor}" text-anchor="middle">attempt #</text>`);

  let hasData = false;
  for (let qi = 1; qi <= 4; qi++) {
    const arr = byQuiz[qi];
    if (arr.length === 0) continue;
    hasData = true;
    const color = (typeof quizColor === 'function') ? quizColor(qi - 1) : '#888888';

    const points = arr.map((a, i) => ({
      x: PAD.left + (i / Math.max(maxAttempts - 1, 1)) * plotW,
      y: PAD.top + plotH * (1 - a.score / (a.maxScore || MAX_SCORE)),
    }));

    const pathD = points.map((p, i) => (i === 0 ? 'M' : 'L') + p.x.toFixed(2) + ',' + p.y.toFixed(2)).join(' ');
    parts.push(`<path d="${pathD}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`);

    points.forEach(p => {
      parts.push(`<circle cx="${p.x.toFixed(2)}" cy="${p.y.toFixed(2)}" r="4" fill="${color}" stroke="#ffffff" stroke-width="1.5"/>`);
    });
  }

  if (!hasData) {
    parts.push(`<text x="${(width / 2).toFixed(2)}" y="${(height / 2).toFixed(2)}" font-family="PlexMono" font-size="13" fill="${mutedColor}" text-anchor="middle">No attempts yet</text>`);
  }

  parts.push('</svg>');
  return parts.join('');
}

function _parseSvg(markup) {
  const doc = new DOMParser().parseFromString(markup, 'image/svg+xml');
  if (doc.querySelector('parsererror')) throw new Error('Could not parse SVG for PDF export');
  return doc.documentElement;
}

async function exportStatsPdf() {
  await _ensurePdfLibs();
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });

  // Fixed IBM Plex Sans/Mono regardless of the site's active color theme —
  // jsPDF's only native fonts are Helvetica/Times/Courier, so these are
  // embedded from vendor/fonts/plex-fonts-embedded.js and used for every
  // piece of text in the document, including the vector chart's labels.
  (window.PLEX_FONTS || []).forEach(f => {
    doc.addFileToVFS(f.file, f.data);
    doc.addFont(f.file, f.family, f.style);
  });

  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const marginX = 40;
  const nickname = (typeof getForumNickname === 'function' && getForumNickname()) || '';

  // ── Page 1: title page ──────────────────────────────────────────────
  const avatarSize = 96;
  const avatarSvg = _parseSvg(await _exportAvatarSvgMarkup(nickname));
  await doc.svg(avatarSvg, {
    x: (pageW - avatarSize) / 2,
    y: 170,
    width: avatarSize,
    height: avatarSize,
  });

  doc.setFont('PlexSans', 'bold');
  doc.setFontSize(22);
  doc.setTextColor(20, 20, 20);
  doc.text(nickname || 'Anonymous', pageW / 2, 170 + avatarSize + 40, { align: 'center' });

  doc.setFont('PlexSans', 'normal');
  doc.setFontSize(12);
  doc.setTextColor(110, 110, 110);
  doc.text('Stats export', pageW / 2, 170 + avatarSize + 62, { align: 'center' });

  doc.setFont('PlexMono', 'normal');
  doc.setFontSize(10);
  doc.setTextColor(140, 140, 140);
  doc.text('Exported ' + new Date().toLocaleString('en-GB'), pageW / 2, pageH - 50, { align: 'center' });

  // ── Page 2+: chart, then table starting immediately below it ────────
  doc.addPage();
  const chartW = pageW - marginX * 2;
  const chartH = 220;
  const chartTop = 40;
  const chartSvg = _parseSvg(_buildExportChartSvg(chartW, chartH));
  await doc.svg(chartSvg, { x: marginX, y: chartTop, width: chartW, height: chartH });

  const rows = _exportAttempts().map(_exportRow);
  doc.autoTable({
    startY: chartTop + chartH + 24,
    margin: { left: marginX, right: marginX },
    columns: EXPORT_COLUMNS.map(c => ({ header: c.label, dataKey: c.key })),
    body: rows.map(r => ({
      quiz: r.quiz, mode: r.mode, dateTime: r.dateTime, duration: r.duration, score: r.score,
      _quizNum: r.quizNum,
    })),
    styles: { font: 'PlexMono', fontSize: 9, cellPadding: 5, lineColor: [225, 225, 225] },
    headStyles: { font: 'PlexSans', fontStyle: 'bold', fillColor: [242, 242, 242], textColor: [30, 30, 30] },
    alternateRowStyles: { fillColor: [250, 250, 250] },
    // Table rows are quiz-colored, matching the chart's per-quiz colors.
    didParseCell(data) {
      if (data.section !== 'body') return;
      const qn = data.row.raw._quizNum;
      const hex = (typeof quizColor === 'function') ? quizColor(qn - 1) : null;
      if (hex && typeof hexToRgb === 'function') {
        data.cell.styles.textColor = hexToRgb(hex);
      }
    },
  });

  doc.save(_exportFilename('pdf'));
}
