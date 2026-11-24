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
// SheetJS build). PDF comes from js/stats-pdf.js, in the same style as the
// Entire Set PDF (js/pdf-build.js): black-and-white charts, STIX fonts, a
// link and a QR code to the site. All of it is vendored under vendor/ and
// loaded on demand, so visitors who never export never download it.
// ═══════════════════════════════════════════════════════════════════════════

const EXPORT_COLUMNS = [
  { key: 'quiz',     label: 'Set' },
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
    quiz: `Set ${a.quizNum}: ${name}`,
    mode: a.mode === 'cumulative' ? `Sets 1–${a.quizNum}` : 'Single Set',
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
// Built by js/stats-pdf.js in the Entire Set PDF's style, with that PDF's
// tools (js/pdf-build.js): both are loaded only when someone exports.

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
    <text x="50" y="52" text-anchor="middle" dominant-baseline="central" font-family="STIXTwoText" font-weight="bold" font-size="46" fill="#ffffff">${initial}</text>
  </svg>`;
}

// pdf-build.js may already be here from an Entire Set PDF: its top-level
// consts can't be declared twice, so it loads only once, through the same
// loader js/pdf-export.js uses.
async function exportStatsPdf() {
  const load = typeof pdfxLoadScript === 'function' ? pdfxLoadScript : _loadScript;
  if (typeof buildProblemsPdf !== 'function') await load('js/pdf-build.js');
  if (typeof buildStatsPdf !== 'function') await load('js/stats-pdf.js');
  await buildStatsPdf();
}
