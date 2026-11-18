// ─── Entire Set → Export PDF, and the PDF check ─────────────────────────────
// The third button on the Entire Set "Choose the order" page opens a window
// of export options (which problems, order, space after each, answers, page
// colour, figures). The PDF itself is built by js/pdf-build.js, which is
// loaded only when someone presses Export, together with its tools (jsPDF,
// svg2pdf, the STIX Two Text fonts, MathJax's SVG output with the STIX2 math
// font, a QR code maker), so a visit that never exports downloads none of it.
//
// ── Is my PDF up to date? ──
// Every exported PDF carries a check code: which set, which problems in which
// order, the set's size at the time, and a 16-bit fingerprint of each problem
// as printed (its text; its answer if the PDF shows answers; its redrawn
// drawing if the PDF uses them). It is printed as a link and a QR code on
// the last page and behind its "Check for updates" buttons
// (https://<site>/check#<code>), and also kept in the PDF's Keywords
// property. Opening that link is the only way in: the page opens the check
// window with the link already in it, recomputes the fingerprints from the
// problems on the site now and lists what changed. Only problems IN the PDF are compared, so an edit to
// a problem the PDF left out raises nothing; a change in the set's size is
// reported as a warning. Nothing is stored on a server: the code is all the
// state there is.
//
// /check is the site's own page (a rewrite in _redirects), so relative paths
// still resolve from the root; a local copy without the rewrite takes
// /#check=<code> instead.
//
// Code layout (bytes, then base64url):
//   [0] version (1)   [1] set number   [2] flags (1 random, 2 answers, 4 redrawn)
//   [3-6] seed (random order; 0 in order)   [7-10] minutes since 2020-01-01 UTC
//   varint: problems in the set at export   varint: problems in the PDF
//   per problem, in PDF order: zigzag varint id-code delta, zigzag varint
//   printed-number delta, 2 bytes fingerprint
//   last 2 bytes: the first 2 bytes of SHA-256 over everything before them
// id-code: "P12" → 24, "P12i" → 25 (every id in the course data has this form).

const PDFX_CODE_VERSION = 1;
const PDFX_EPOCH = Date.UTC(2020, 0, 1);
const PDFX_FLAG_RANDOM = 1, PDFX_FLAG_ANSWERS = 2, PDFX_FLAG_REDRAWN = 4;
const PDFX_OPTS_KEY = (typeof STORAGE_PREFIX === 'string' ? STORAGE_PREFIX : 'site') + '_pdf_export_opts';

// ── Small helpers ───────────────────────────────────────────────────────────
function pdfxLoadScript(src) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[data-pdfx-src="${src}"]`)) { resolve(); return; }
    const s = document.createElement('script');
    s.src = src;
    s.dataset.pdfxSrc = src;
    s.onload = () => resolve();
    s.onerror = () => { s.remove(); reject(new Error('Failed to load ' + src)); };
    document.head.appendChild(s);
  });
}

function pdfxEscape(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function pdfxSiteUrl() {
  return (typeof _display !== 'undefined' && _display.siteUrl) || (location.origin + '/');
}

function pdfxB64url(bytes) {
  let bin = '';
  bytes.forEach(b => { bin += String.fromCharCode(b); });
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function pdfxFromB64url(s) {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function pdfxSha256(bytes) {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
}

// ── Problem fingerprints ────────────────────────────────────────────────────
function pdfxFigureSources(text) {
  const out = [];
  const re = /<img\b[^>]*\bsrc="([^"]+)"/g;
  let m;
  while ((m = re.exec(text || ''))) out.push(m[1]);
  return out;
}

// Exactly what the PDF prints for the problem, as one string.
function pdfxProblemContent(p, flags) {
  const parts = [p.id, p.text || ''];
  if (flags & PDFX_FLAG_ANSWERS) parts.push(String(p.answer), (p.units || []).join('|'));
  if (flags & PDFX_FLAG_REDRAWN) {
    pdfxFigureSources(p.text).forEach(src => {
      parts.push((typeof redrawnSvgFor === 'function' && redrawnSvgFor(src)) || '');
    });
  }
  return parts.join('\u001f');
}

async function pdfxFingerprint(p, flags) {
  const h = await pdfxSha256(new TextEncoder().encode(pdfxProblemContent(p, flags)));
  return (h[0] << 8) | h[1];
}

function pdfxHex4(n) { return n.toString(16).padStart(4, '0'); }

// ── Check code ──────────────────────────────────────────────────────────────
function pdfxIdCode(id) {
  const m = /^P(\d+)(i?)$/.exec(id);
  if (!m) throw new Error('Problem id "' + id + '" has no check-code form');
  return parseInt(m[1], 10) * 2 + (m[2] ? 1 : 0);
}
function pdfxIdFromCode(c) { return 'P' + Math.floor(c / 2) + (c % 2 ? 'i' : ''); }

function pdfxPushVarint(out, n) {
  while (n > 127) { out.push((n & 127) | 128); n = Math.floor(n / 128); }
  out.push(n);
}
function pdfxZigzag(n) { return n >= 0 ? n * 2 : -n * 2 - 1; }
function pdfxUnzigzag(n) { return n % 2 ? -(n + 1) / 2 : n / 2; }

// entries: [{ id, number, fp }] in PDF order.
async function pdfxEncodeCheck({ quizNum, flags, seed, time, total, entries }) {
  const out = [PDFX_CODE_VERSION, quizNum, flags];
  for (let s = 24; s >= 0; s -= 8) out.push((seed >>> s) & 255);
  const minutes = Math.max(0, Math.floor((time - PDFX_EPOCH) / 60000));
  for (let s = 24; s >= 0; s -= 8) out.push((minutes >>> s) & 255);
  pdfxPushVarint(out, total);
  pdfxPushVarint(out, entries.length);
  let prevId = 0, prevNum = 0;
  entries.forEach(e => {
    const code = pdfxIdCode(e.id);
    pdfxPushVarint(out, pdfxZigzag(code - prevId));
    pdfxPushVarint(out, pdfxZigzag(e.number - prevNum));
    out.push((e.fp >> 8) & 255, e.fp & 255);
    prevId = code; prevNum = e.number;
  });
  const sum = await pdfxSha256(new Uint8Array(out));
  out.push(sum[0], sum[1]);
  return pdfxB64url(new Uint8Array(out));
}

// Returns the decoded check, or { error } when the code is damaged.
async function pdfxDecodeCheck(code) {
  let bytes;
  try { bytes = pdfxFromB64url(String(code).trim()); } catch (e) { return { error: 'damaged' }; }
  if (bytes.length < 15) return { error: 'damaged' };
  const sum = await pdfxSha256(bytes.slice(0, bytes.length - 2));
  if (sum[0] !== bytes[bytes.length - 2] || sum[1] !== bytes[bytes.length - 1]) return { error: 'damaged' };
  if (bytes[0] !== PDFX_CODE_VERSION) return { error: 'version' };
  let i = 3;
  const u32 = () => { const v = ((bytes[i] << 24) >>> 0) + (bytes[i + 1] << 16) + (bytes[i + 2] << 8) + bytes[i + 3]; i += 4; return v; };
  const varint = () => {
    let n = 0, mul = 1, b;
    do { if (i >= bytes.length - 2) throw new Error('short'); b = bytes[i++]; n += (b & 127) * mul; mul *= 128; } while (b & 128);
    return n;
  };
  try {
    const quizNum = bytes[1], flags = bytes[2];
    const seed = u32();
    const time = PDFX_EPOCH + u32() * 60000;
    const total = varint();
    const n = varint();
    const entries = [];
    let prevId = 0, prevNum = 0;
    for (let k = 0; k < n; k++) {
      const code = prevId + pdfxUnzigzag(varint());
      const number = prevNum + pdfxUnzigzag(varint());
      if (i + 2 > bytes.length - 2) throw new Error('short');
      const fp = (bytes[i] << 8) | bytes[i + 1];
      i += 2;
      entries.push({ id: pdfxIdFromCode(code), number, fp });
      prevId = code; prevNum = number;
    }
    if (i !== bytes.length - 2) return { error: 'damaged' };
    return { quizNum, flags, seed, time, total, entries };
  } catch (e) {
    return { error: 'damaged' };
  }
}

function pdfxCheckLink(code) {
  return pdfxSiteUrl() + 'check#' + code;
}

// ── Options ─────────────────────────────────────────────────────────────────
const PDFX_DEFAULT_OPTS = {
  scope: 'all',            // 'all' | 'numbers' | 'type' | 'topic'
  numbers: '',
  types: ['unattempted', 'wrong', 'partial', 'correct'],
  // Topics switched off under "By topic". Kept as the ones left out, so every
  // topic starts ticked, in every set, and a set's new topic is ticked too.
  topicsOff: [],
  order: 'ordered',        // 'ordered' | 'random'
  space: 'none',           // 'none' | 'cm' | 'page'
  spaceCm: 4,
  answerLine: false,
  answers: 'none',         // 'none' | 'below' | 'upside'
  pages: 'light',          // 'light' | 'dark'
  figures: 'redrawn',      // 'redrawn' | 'original'
};

function pdfxLoadOpts() {
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(PDFX_OPTS_KEY) || 'null'); } catch (e) { /* private window */ }
  const o = Object.assign({}, PDFX_DEFAULT_OPTS, saved && typeof saved === 'object' ? saved : {});
  if (!Array.isArray(o.types)) o.types = PDFX_DEFAULT_OPTS.types.slice();
  if (!Array.isArray(o.topicsOff)) o.topicsOff = [];
  return o;
}

function pdfxSaveOpts(o) {
  try { localStorage.setItem(PDFX_OPTS_KEY, JSON.stringify(o)); } catch (e) { /* private window */ }
}

// The set's problems the options pick, in set order.
function pdfxSelectedProblems(quizNum, o) {
  const all = (QUIZZES[quizNum - 1] && QUIZZES[quizNum - 1].problems) || [];
  if (o.scope === 'numbers') {
    const set = parseNumRanges(o.numbers);
    return all.filter(p => set.has(problemNumber(quizNum, p.id)));
  }
  if (o.scope === 'type') {
    if (typeof _invalidateTypeFilterScoresCache === 'function') _invalidateTypeFilterScoresCache();
    const want = new Set(o.types);
    return all.filter(p => want.has(_problemAttemptStatus(p, quizNum)));
  }
  if (o.scope === 'topic') {
    const off = new Set(o.topicsOff);
    return all.filter(p => !off.has(pdfxTopicOf(p)));
  }
  return all.slice();
}

function pdfxTopicOf(p) { return (p.topic || '').trim() || 'Other'; }

// The set's topics in the order they first appear, with how many problems each.
function pdfxSetTopics(quizNum) {
  const counts = new Map();
  ((QUIZZES[quizNum - 1] && QUIZZES[quizNum - 1].problems) || []).forEach(p => {
    const k = pdfxTopicOf(p);
    counts.set(k, (counts.get(k) || 0) + 1);
  });
  return [...counts].map(([name, n]) => ({ name, n }));
}

// Deterministic shuffle (mulberry32), so a seed always gives the same order.
function pdfxShuffle(list, seed) {
  let a = seed >>> 0;
  const rnd = () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const out = list.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// ── Export window ───────────────────────────────────────────────────────────
let _pdfxOpts = null;
let _pdfxBuild = null;   // { cancelled } while a PDF is being made

function _pdfxModal() {
  let m = document.getElementById('pdfExportModal');
  if (m) return m;
  m = document.createElement('div');
  m.className = 'stats-modal-backdrop pdfx-backdrop';
  m.id = 'pdfExportModal';
  m.addEventListener('click', e => { if (e.target === m && !_pdfxBuild) closePdfExport(); });
  document.body.appendChild(m);
  return m;
}

function _pdfxRadio(name, value, label, checked, extra) {
  return `<label class="pdfx-choice"><input type="radio" name="${name}" value="${value}"${checked ? ' checked' : ''}><span>${label}</span>${extra || ''}</label>`;
}

// One problem of the set with a figure that has a redrawn version, for the
// two previews under "Figures".
function _pdfxPreviewFigure(quizNum) {
  const all = (QUIZZES[quizNum - 1] && QUIZZES[quizNum - 1].problems) || [];
  for (const p of all) {
    for (const src of pdfxFigureSources(p.text)) {
      if (typeof redrawnSvgFor === 'function' && redrawnSvgFor(src)) return src;
    }
  }
  return null;
}

function openPdfExport() {
  const quizNum = selectedQuizNum;
  const q = QUIZZES[quizNum - 1];
  if (!q) return;
  _pdfxOpts = pdfxLoadOpts();
  const o = _pdfxOpts;
  const m = _pdfxModal();
  const typeBoxes = FILTER_TYPE_STATUS_OPTIONS.map(t =>
    `<label class="pdfx-check"><input type="checkbox" name="pdfxType" value="${t.key}"${o.types.includes(t.key) ? ' checked' : ''}><span class="pdfx-swatch ${t.cls}"></span><span>${t.label}</span></label>`
  ).join('');
  const topicBoxes = pdfxSetTopics(quizNum).map(tp =>
    `<label class="pdfx-check"><input type="checkbox" name="pdfxTopic" value="${pdfxEscape(tp.name)}"${o.topicsOff.includes(tp.name) ? '' : ' checked'}><span>${pdfxEscape(tp.name)} <span class="pdfx-hint">(${tp.n})</span></span></label>`
  ).join('');
  const figSrc = _pdfxPreviewFigure(quizNum);
  let figPreview = '';
  if (figSrc) {
    figPreview = `<div class="pdfx-fig-previews">
      <label class="pdfx-fig-card"><input type="radio" name="pdfxFigures" value="redrawn"${o.figures === 'redrawn' ? ' checked' : ''}>
        <span class="pdfx-fig-thumb pdfx-fig-redrawn" data-src="${pdfxEscape(figSrc)}"></span><span>Redrawn (vector)</span></label>
      <label class="pdfx-fig-card"><input type="radio" name="pdfxFigures" value="original"${o.figures === 'original' ? ' checked' : ''}>
        <span class="pdfx-fig-thumb pdfx-fig-original"><img src="${pdfxEscape(figSrc)}" alt=""></span><span>Originals (low-res)</span></label>
    </div>`;
  } else {
    figPreview = `<div class="pdfx-row">${_pdfxRadio('pdfxFigures', 'redrawn', 'Redrawn (vector)', o.figures === 'redrawn')}${_pdfxRadio('pdfxFigures', 'original', 'Originals (low-res)', o.figures === 'original')}</div>`;
  }
  m.innerHTML = `<div class="stats-modal-box pdfx-box" role="dialog" aria-modal="true" aria-labelledby="pdfxTitle">
    <div class="stats-modal-title" id="pdfxTitle">Export PDF</div>
    <div class="stats-modal-desc pdfx-sub">Set ${quizNum} · ${pdfxEscape(q.name)}</div>
    <form class="pdfx-form" onsubmit="return false">
      <fieldset class="pdfx-group"><legend>Problems</legend>
        ${_pdfxRadio('pdfxScope', 'all', 'All', o.scope === 'all')}
        ${_pdfxRadio('pdfxScope', 'numbers', 'Numbers', o.scope === 'numbers',
          `<input type="text" class="pdfx-input" id="pdfxNumbers" placeholder="1, 2, 5-10" value="${pdfxEscape(o.numbers)}" autocomplete="off" inputmode="numeric">`)}
        ${_pdfxRadio('pdfxScope', 'type', 'By type', o.scope === 'type')}
        <div class="pdfx-types">${typeBoxes}</div>
        ${_pdfxRadio('pdfxScope', 'topic', 'By topic', o.scope === 'topic')}
        <div class="pdfx-topics${o.scope === 'topic' ? '' : ' collapsed'}"${o.scope === 'topic' ? '' : ' inert'}><div class="pdfx-topics-inner">
          <div class="pdfx-topic-all"><button type="button" class="pdfx-link-btn" onclick="pdfxTickTopics(true)">All</button> · <button type="button" class="pdfx-link-btn" onclick="pdfxTickTopics(false)">None</button></div>
          ${topicBoxes}
        </div></div>
        <div class="pdfx-count" id="pdfxCount"></div>
      </fieldset>
      <fieldset class="pdfx-group"><legend>Order</legend>
        <div class="pdfx-row">${_pdfxRadio('pdfxOrder', 'ordered', 'In order', o.order === 'ordered')}${_pdfxRadio('pdfxOrder', 'random', 'Random order', o.order === 'random')}</div>
      </fieldset>
      <fieldset class="pdfx-group"><legend>Space after each problem</legend>
        ${_pdfxRadio('pdfxSpace', 'none', 'None', o.space === 'none')}
        ${_pdfxRadio('pdfxSpace', 'cm', 'Blank space', o.space === 'cm',
          `<input type="number" class="pdfx-input pdfx-cm" id="pdfxSpaceCm" min="1" max="25" step="0.5" value="${pdfxEscape(o.spaceCm)}"><span class="pdfx-unit">cm</span>`)}
        ${_pdfxRadio('pdfxSpace', 'page', 'One problem per page', o.space === 'page')}
        <label class="pdfx-check pdfx-answer-line"><input type="checkbox" id="pdfxAnswerLine"${o.answerLine ? ' checked' : ''}><span>Answer line <span class="pdfx-hint">(Answer: ______)</span></span></label>
      </fieldset>
      <fieldset class="pdfx-group"><legend>Answers</legend>
        ${_pdfxRadio('pdfxAnswers', 'none', 'Problems only', o.answers === 'none')}
        ${_pdfxRadio('pdfxAnswers', 'below', 'Answer under each problem', o.answers === 'below')}
        ${_pdfxRadio('pdfxAnswers', 'upside', 'Answer upside down', o.answers === 'upside')}
      </fieldset>
      <fieldset class="pdfx-group"><legend>Pages</legend>
        <div class="pdfx-row">
          ${_pdfxRadio('pdfxPages', 'light', '<span class="pdfx-page-swatch light"></span>Light', o.pages === 'light')}
          ${_pdfxRadio('pdfxPages', 'dark', '<span class="pdfx-page-swatch dark"></span>Dark', o.pages === 'dark')}
        </div>
      </fieldset>
      <fieldset class="pdfx-group"><legend>Figures</legend>${figPreview}</fieldset>
    </form>
    <div class="pdfx-progress" id="pdfxProgress" hidden>
      <div class="pdfx-bar"><div class="pdfx-bar-fill" id="pdfxBarFill"></div></div>
      <div class="pdfx-progress-text" id="pdfxProgressText">Starting…</div>
    </div>
    <div class="pdfx-error" id="pdfxError" hidden></div>
    <div class="pdfx-estimate" id="pdfxEstimate" aria-live="polite"></div>
    <div class="stats-modal-actions pdfx-actions">
      <button type="button" class="stats-modal-btn pdfx-reset-btn" id="pdfxResetBtn" onclick="resetPdfExport()" title="Back to the default settings">↺ Reset</button>
      <button type="button" class="stats-modal-btn" id="pdfxCancelBtn" onclick="cancelPdfExport()">Cancel</button>
      <button type="button" class="stats-modal-btn primary" id="pdfxGoBtn" onclick="runPdfExport()">Export PDF</button>
    </div>
  </div>`;
  const red = m.querySelector('.pdfx-fig-redrawn');
  if (red && typeof redrawnFigure === 'function') {
    const svg = redrawnFigure(red.dataset.src, 'figure');
    if (svg) red.appendChild(svg);
  }
  m.querySelector('.pdfx-form').addEventListener('input', _pdfxReadForm);
  m.querySelector('.pdfx-form').addEventListener('change', _pdfxReadForm);
  // Typing in a field picks its option.
  const pick = (id, name, value) => {
    const el = m.querySelector('#' + id);
    if (el) el.addEventListener('focus', () => { const r = m.querySelector(`input[name="${name}"][value="${value}"]`); if (r) { r.checked = true; _pdfxReadForm(); } });
  };
  pick('pdfxNumbers', 'pdfxScope', 'numbers');
  pick('pdfxSpaceCm', 'pdfxSpace', 'cm');
  // Ticking a type or a topic picks its option.
  [['pdfxType', 'type'], ['pdfxTopic', 'topic']].forEach(([box, scope]) => {
    m.querySelectorAll(`input[name="${box}"]`).forEach(el => el.addEventListener('change', () => {
      const r = m.querySelector(`input[name="pdfxScope"][value="${scope}"]`);
      if (r) r.checked = true;
    }));
  });
  _pdfxReadForm();
  // The page estimate measures text in STIX: once the font is in, measure again.
  if (document.fonts && document.fonts.load) {
    document.fonts.load(`${PDFX_EST.fs}px 'STIX Two Text'`).then(() => { _pdfxHeightCache.clear(); _pdfxReadForm(); }).catch(() => {});
  }
  // The window was just rebuilt: lay it out once in its closed pose, so
  // the opening transition (css/pdf-export.css) runs from there.
  void m.querySelector('.pdfx-box').offsetWidth;
  m.classList.add('visible');
}

function _pdfxReadForm() {
  const m = document.getElementById('pdfExportModal');
  if (!m || !_pdfxOpts) return;
  const val = name => { const r = m.querySelector(`input[name="${name}"]:checked`); return r ? r.value : null; };
  const o = _pdfxOpts;
  o.scope = val('pdfxScope') || 'all';
  o.numbers = (m.querySelector('#pdfxNumbers') || {}).value || '';
  o.types = [...m.querySelectorAll('input[name="pdfxType"]:checked')].map(el => el.value);
  o.topicsOff = [...m.querySelectorAll('input[name="pdfxTopic"]:not(:checked)')].map(el => el.value);
  o.order = val('pdfxOrder') || 'ordered';
  o.space = val('pdfxSpace') || 'none';
  const cm = parseFloat((m.querySelector('#pdfxSpaceCm') || {}).value);
  o.spaceCm = isFinite(cm) ? Math.min(25, Math.max(0.5, cm)) : 4;
  o.answerLine = !!(m.querySelector('#pdfxAnswerLine') || {}).checked;
  o.answers = val('pdfxAnswers') || 'none';
  o.pages = val('pdfxPages') || 'light';
  o.figures = val('pdfxFigures') || 'redrawn';
  m.querySelector('.pdfx-types').classList.toggle('dim', o.scope !== 'type');
  // The topic list shows only while "By topic" is picked (it slides open and
  // shut, css/pdf-export.css); hidden, it is inert, so Tab skips it.
  const topics = m.querySelector('.pdfx-topics');
  topics.classList.toggle('collapsed', o.scope !== 'topic');
  topics.inert = o.scope !== 'topic';
  const picked = pdfxSelectedProblems(selectedQuizNum, o);
  const n = picked.length;
  const total = QUIZZES[selectedQuizNum - 1].problems.length;
  const count = m.querySelector('#pdfxCount');
  count.textContent = n === 0 ? 'No problems match' : (n === total ? `All ${total} problems` : `${n} of ${total} problems`);
  count.classList.toggle('none', n === 0);
  const est = m.querySelector('#pdfxEstimate');
  if (est) {
    const pages = n ? pdfxEstimatePages(picked, o) : 0;
    est.textContent = n ? `About ${pages} page${pages === 1 ? '' : 's'}` : '';
  }
  const go = m.querySelector('#pdfxGoBtn');
  if (go && !_pdfxBuild) go.disabled = n === 0;
  const reset = m.querySelector('#pdfxResetBtn');
  if (reset && !_pdfxBuild) reset.disabled = _pdfxIsDefault(o);
}

const PDFX_OPT_KEYS = ['scope', 'numbers', 'types', 'topicsOff', 'order', 'space', 'spaceCm', 'answerLine', 'answers', 'pages', 'figures'];

function _pdfxIsDefault(o) {
  return PDFX_OPT_KEYS.every(k => {
    const a = o[k], b = PDFX_DEFAULT_OPTS[k];
    return Array.isArray(b) ? Array.isArray(a) && a.length === b.length && b.every(v => a.includes(v)) : a === b;
  });
}

// "All" / "None" above the topic list: tick or clear every topic (and pick
// "By topic").
function pdfxTickTopics(on) {
  const m = document.getElementById('pdfExportModal');
  if (!m || _pdfxBuild) return;
  m.querySelectorAll('input[name="pdfxTopic"]').forEach(el => { el.checked = on; });
  const r = m.querySelector('input[name="pdfxScope"][value="topic"]');
  if (r) r.checked = true;
  _pdfxReadForm();
}

// Reset: every option back to PDFX_DEFAULT_OPTS, and the saved choices
// forgotten, so the next visit starts from the defaults too.
function resetPdfExport() {
  const m = document.getElementById('pdfExportModal');
  if (!m || _pdfxBuild) return;
  const d = PDFX_DEFAULT_OPTS;
  const pick = (name, v) => { const r = m.querySelector(`input[name="${name}"][value="${v}"]`); if (r) r.checked = true; };
  pick('pdfxScope', d.scope);
  m.querySelector('#pdfxNumbers').value = d.numbers;
  m.querySelectorAll('input[name="pdfxType"]').forEach(el => { el.checked = d.types.includes(el.value); });
  m.querySelectorAll('input[name="pdfxTopic"]').forEach(el => { el.checked = true; });
  pick('pdfxOrder', d.order);
  pick('pdfxSpace', d.space);
  m.querySelector('#pdfxSpaceCm').value = d.spaceCm;
  m.querySelector('#pdfxAnswerLine').checked = d.answerLine;
  pick('pdfxAnswers', d.answers);
  pick('pdfxPages', d.pages);
  pick('pdfxFigures', d.figures);
  try { localStorage.removeItem(PDFX_OPTS_KEY); } catch (e) { /* private window */ }
  _pdfxReadForm();
}

// ── Page estimate ───────────────────────────────────────────────────────────
// A quick guess at the PDF's length for the export window, without loading
// the PDF tools: each problem's height from its text measured in STIX at the
// body size (formulas by a rough glyph count), its figures at the printed
// size, and the chosen extras; then the same page rules as js/pdf-build.js
// (A4, its margins, a problem kept on one page when it fits there, the cover,
// and the jump with the closing box sharing the last page). Keep the numbers
// in step with pdf-build.js's PDFB_* constants and layout.
const PDFX_EST = {
  pageH: 841.89 - 58 - 66,    // A4 minus PDFB_TOP and PDFB_BOTTOM
  textW: 595.28 - 2 * 62,     // minus the side margins
  fs: 11, line: 11 * 1.42,
  head: 18, sep: 19, setHead: 74, closing: 330,
};
let _pdfxMeasure = null;
const _pdfxHeightCache = new Map();

function _pdfxTextWidth(s) {
  if (!_pdfxMeasure) {
    _pdfxMeasure = document.createElement('canvas').getContext('2d');
    _pdfxMeasure.font = `${PDFX_EST.fs}px 'STIX Two Text', 'Times New Roman', serif`;
  }
  return _pdfxMeasure.measureText(s).width;
}

// Roughly how wide a formula prints: commands count as one glyph, braces and
// script markers as none, a fraction stacks.
function _pdfxTexWidth(tex) {
  const glyphs = tex.replace(/\\(?:frac|dfrac)/g, '').replace(/\\[a-zA-Z]+/g, 'x')
    .replace(/[{}^_\\]/g, '').replace(/\s+/g, '').length;
  return glyphs * PDFX_EST.fs * 0.55 * (/\\frac/.test(tex) ? 0.7 : 1);
}

function _pdfxFigureHeight(src, widthAttr, redrawn) {
  let w = widthAttr || 350, ratio = 0.62;
  const svg = redrawn && typeof redrawnSvgFor === 'function' ? redrawnSvgFor(src) : null;
  const vb = svg && /viewBox="\s*[\d.-]+[\s,]+[\d.-]+[\s,]+([\d.]+)[\s,]+([\d.]+)/.exec(svg);
  if (vb) { ratio = parseFloat(vb[2]) / parseFloat(vb[1]); if (!widthAttr) w = parseFloat(vb[1]); }
  let pw = Math.min(PDFX_EST.textW * 0.62, w * 0.62);
  let ph = pw * ratio;
  const maxH = PDFX_EST.pageH * 0.4;
  if (ph > maxH) ph = maxH;
  return ph + 12;
}

// The problem itself (heading, text, formulas, figures), cached by problem.
function _pdfxProblemHeight(p, redrawn) {
  const key = p.id + '|' + redrawn + '|' + (p.text || '').length;
  if (_pdfxHeightCache.has(key)) return _pdfxHeightCache.get(key);
  let text = p.text || '';
  let h = PDFX_EST.head;
  text = text.replace(/<div class="fig-img-wrap">[\s\S]*?<\/div>/g, block => {
    const src = /src="([^"]+)"/.exec(block);
    const wAttr = /width="(\d+)/.exec(block);
    if (src) h += _pdfxFigureHeight(src[1], wAttr ? parseFloat(wAttr[1]) : 0, redrawn) + (/fig-attr-tip/.test(block) ? 22 : 0);
    return ' ';
  });
  text = text.replace(/\$\$([\s\S]+?)\$\$|\\\[([\s\S]+?)\\\]/g, (all, a, b) => {
    h += (/\\frac|\\int|\\sum/.test(a || b) ? 34 : 22) + 12;
    return ' ';
  });
  let width = 0;
  text = text.replace(/\$([^$]+?)\$|\\\(([\s\S]+?)\\\)/g, (all, a, b) => {
    const tex = a || b;
    width += _pdfxTexWidth(tex) + 2;
    if (/\\frac/.test(tex)) h += 4;
    return ' ';
  });
  text = text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  width += _pdfxTextWidth(text);
  h += Math.ceil(width / PDFX_EST.textW * 1.06 + 0.001) * PDFX_EST.line;
  _pdfxHeightCache.set(key, h);
  return h;
}

function pdfxEstimatePages(problems, o) {
  const E = PDFX_EST;
  const extras = (o.space === 'cm' ? o.spaceCm * 28.3465 : 0) + (o.answerLine ? 23 : 0) + (o.answers !== 'none' ? 23 : 0);
  let pages = 2, y = E.setHead;                 // the cover, then page 2 under the set's title
  problems.forEach((p, i) => {
    const body = _pdfxProblemHeight(p, o.figures === 'redrawn');
    if (o.space === 'page') {
      if (i > 0) pages++;
      pages += Math.floor(body / E.pageH);
      y = E.pageH;                                // its page is full: working space to the foot
      return;
    }
    const h = body + extras;
    const fitsOne = body < E.pageH * 0.85;
    if (i > 0) {
      if (fitsOne && y + E.sep + body > E.pageH) { pages++; y = 0; }
      else y += E.sep;
    }
    if (fitsOne && y + body > E.pageH && y > 0) { pages++; y = 0; }
    y += h;
    while (y > E.pageH) { pages++; y -= E.pageH; }
  });
  if (y + E.closing > E.pageH) pages++;
  return pages;
}

function closePdfExport() {
  const m = document.getElementById('pdfExportModal');
  if (m) m.classList.remove('visible');
}

function cancelPdfExport() {
  if (_pdfxBuild) { _pdfxBuild.cancelled = true; return; }
  closePdfExport();
}

function _pdfxSetBusy(busy) {
  const m = document.getElementById('pdfExportModal');
  if (!m) return;
  m.querySelector('.pdfx-form').classList.toggle('busy', busy);
  m.querySelectorAll('.pdfx-form input').forEach(el => { el.disabled = busy; });
  m.querySelector('#pdfxProgress').hidden = !busy;
  m.querySelector('#pdfxGoBtn').disabled = busy;
  m.querySelector('#pdfxResetBtn').disabled = busy;
  if (busy) m.querySelector('#pdfxError').hidden = true;
}

function _pdfxProgress(fraction, text) {
  const fill = document.getElementById('pdfxBarFill');
  const label = document.getElementById('pdfxProgressText');
  if (fill) fill.style.width = Math.round(Math.max(0, Math.min(1, fraction)) * 100) + '%';
  if (label && text) label.textContent = text;
}

async function runPdfExport() {
  if (_pdfxBuild) return;
  _pdfxReadForm();
  const o = Object.assign({}, _pdfxOpts);
  const quizNum = selectedQuizNum;
  let problems = pdfxSelectedProblems(quizNum, o);
  if (!problems.length) return;
  pdfxSaveOpts(o);
  const job = _pdfxBuild = { cancelled: false };
  _pdfxSetBusy(true);
  _pdfxProgress(0, 'Loading the PDF tools…');
  try {
    await pdfxLoadScript('js/pdf-build.js');
    const seed = o.order === 'random' ? (crypto.getRandomValues(new Uint32Array(1))[0] || 1) : 0;
    if (seed) problems = pdfxShuffle(problems, seed);
    await buildProblemsPdf({ quizNum, problems, opts: o, seed, job, progress: _pdfxProgress });
    if (!job.cancelled) closePdfExport();
  } catch (err) {
    if (!job.cancelled) {
      console.error('[pdf-export]', err);
      const box = document.getElementById('pdfxError');
      if (box) {
        box.textContent = navigator.onLine === false
          ? "The PDF tools couldn't load. Exporting needs an internet connection the first time."
          : "Sorry, the PDF couldn't be made. Please try again.";
        box.hidden = false;
      }
    }
  } finally {
    _pdfxBuild = null;
    _pdfxSetBusy(false);
    _pdfxReadForm();
    if (job.cancelled) _pdfxProgress(0, '');
  }
}

// ── Check window ────────────────────────────────────────────────────────────
function _pdfxCheckModal() {
  let m = document.getElementById('pdfCheckModal');
  if (m) return m;
  m = document.createElement('div');
  m.className = 'stats-modal-backdrop pdfx-backdrop';
  m.id = 'pdfCheckModal';
  m.addEventListener('click', e => { if (e.target === m) closePdfCheck(); });
  m.innerHTML = `<div class="stats-modal-box pdfx-box pdfx-check-box" role="dialog" aria-modal="true" aria-labelledby="pdfcTitle">
    <div class="stats-modal-title" id="pdfcTitle">Check a PDF</div>
    <div class="pdfx-link-row">
      <input type="text" class="pdfx-input" id="pdfcLink" placeholder="…/check#…" autocomplete="off" spellcheck="false" aria-label="Check link">
      <button type="button" class="stats-modal-btn" onclick="pdfCheckFromLink()">Check</button>
    </div>
    <div class="pdfx-result" id="pdfcResult" hidden></div>
    <div class="stats-modal-actions">
      <button type="button" class="stats-modal-btn" onclick="closePdfCheck()">Close</button>
    </div>
  </div>`;
  document.body.appendChild(m);
  m.querySelector('#pdfcLink').addEventListener('keydown', e => { if (e.key === 'Enter') pdfCheckFromLink(); });
  return m;
}

// Opens the window with `link` (the address it was opened with) in the field.
function openPdfCheck(link) {
  const m = _pdfxCheckModal();
  m.querySelector('#pdfcResult').hidden = true;
  m.querySelector('#pdfcLink').value = link || '';
  m.classList.add('visible');
}

function closePdfCheck() {
  const m = document.getElementById('pdfCheckModal');
  if (m) m.classList.remove('visible');
  // Opened from a /check link: back to the plain address, so a reload or
  // a bookmark is the ordinary site again.
  if (/\/check$/.test(location.pathname) || /^#check=/.test(location.hash)) {
    try { history.replaceState(null, '', location.pathname.replace(/check$/, '') + location.search); } catch (e) { /* ignore */ }
  }
}

function _pdfcShow(html, cls) {
  const r = document.getElementById('pdfcResult');
  r.className = 'pdfx-result' + (cls ? ' ' + cls : '');
  r.innerHTML = html;
  r.hidden = false;
}

// "…/check#CODE", "#check=CODE" or the bare code. Also says which course's
// site a link points to, so a Flux PDF checked on Impulse gets sent there.
function _pdfcParseLink(text) {
  const s = String(text || '').trim();
  if (!s) return null;
  let host = null;
  try { host = new URL(s).host; } catch (e) { /* not a full URL */ }
  const hash = s.includes('#') ? s.slice(s.indexOf('#') + 1) : s;
  const code = hash.replace(/^check=/, '');
  if (!/^[A-Za-z0-9_-]+$/.test(code)) return null;
  return { code, host };
}

function _pdfcOtherCourse(host) {
  if (typeof COURSES === 'undefined') return null;
  for (const [key, c] of Object.entries(COURSES)) {
    const url = c.display && c.display.siteUrl;
    if (!url) continue;
    if (host && new URL(url).host === host) {
      return key === ACTIVE_COURSE ? null : { name: c.display.appName, url };
    }
  }
  return null;
}

function pdfCheckFromLink() {
  const input = document.getElementById('pdfcLink');
  const parsed = _pdfcParseLink(input && input.value);
  if (!parsed) { _pdfcShow("That doesn't look like a check link. It is printed on the PDF's last page and starts with the site's address followed by <b>/check#</b>.", 'bad'); return; }
  const local = /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(location.host);
  const other = !local && parsed.host && parsed.host !== location.host ? _pdfcOtherCourse(parsed.host) : null;
  if (other) { _pdfcWrongSite(other); return; }
  pdfCheckCode(parsed.code);
}

function _pdfcWrongSite(other) {
  _pdfcShow(`This PDF comes from <b>${pdfxEscape(other.name)}</b>, not ${pdfxEscape(APP_NAME)}. <a href="${pdfxEscape(other.url)}" target="_blank" rel="noopener">Check it on ${pdfxEscape(other.name)}</a>.`, 'warn');
}

function _pdfcDate(ms) {
  const d = new Date(ms);
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) + ', ' +
    d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

async function pdfCheckCode(code) {
  _pdfxCheckModal();
  const c = await pdfxDecodeCheck(code);
  if (c.error) {
    _pdfcShow(c.error === 'version'
      ? 'This PDF was made by a newer version of the site. Reload the page and check again.'
      : 'This check link is damaged or incomplete. Open it again from the PDF.', 'bad');
    return;
  }
  const q = typeof QUIZZES !== 'undefined' && QUIZZES[c.quizNum - 1];
  if (!q) { _pdfcShow(`Set ${c.quizNum} from this PDF is not on the site any more.`, 'bad'); return; }
  const rows = [];
  let changed = 0, removed = 0, moved = 0;
  for (const e of c.entries) {
    const p = getQuizProblem(c.quizNum, e.id);
    const now = p ? problemNumber(c.quizNum, e.id) : null;
    if (!p || now === null) { removed++; rows.push({ e, state: 'removed' }); continue; }
    const fp = await pdfxFingerprint(p, c.flags);
    if (fp !== e.fp) { changed++; rows.push({ e, state: 'changed', now }); continue; }
    if (now !== e.number) { moved++; rows.push({ e, state: 'moved', now }); }
  }
  const totalNow = q.problems.length;
  const n = c.entries.length;
  const facts = [
    `Set ${c.quizNum} · ${pdfxEscape(q.name)}`,
    `${n} problem${n === 1 ? '' : 's'}${c.flags & PDFX_FLAG_RANDOM ? ' · random order (seed ' + c.seed.toString(16).toUpperCase().padStart(8, '0') + ')' : ' · in order'}`,
    `exported ${pdfxEscape(_pdfcDate(c.time))}`,
  ];
  let head;
  if (!changed && !removed) {
    head = `<div class="pdfx-verdict ok">✓ Up to date</div><p>All ${n} problem${n === 1 ? '' : 's'} in this PDF match the site.</p>`;
  } else {
    const parts = [];
    if (changed) parts.push(`${changed} changed`);
    if (removed) parts.push(`${removed} removed from the set`);
    head = `<div class="pdfx-verdict bad">⚠ Out of date</div><p>${parts.join(', ')} since this PDF was made. Use the site's version of ${changed + removed === 1 ? 'that problem' : 'those problems'}, or export a new PDF.</p>`;
  }
  let warn = '';
  if (totalNow !== c.total) {
    warn = `<p class="pdfx-warn">The set had ${c.total} problems when this PDF was made and has ${totalNow} now${n < c.total ? '. Problems left out of the PDF are not compared' : ''}.</p>`;
  }
  const label = { changed: 'changed', removed: 'no longer in the set', moved: 'unchanged, now' };
  const list = rows.length ? `<ul class="pdfx-list">${rows.map(r =>
    `<li class="${r.state}"><b>P${r.e.number}</b> <span class="pdfx-fp">#${pdfxHex4(r.e.fp)}</span> — ${label[r.state]}${r.now && r.now !== r.e.number ? (r.state === 'moved' ? ' ' : ', now ') + 'P' + r.now : ''}</li>`
  ).join('')}</ul>` : '';
  const cls = changed || removed ? 'bad' : (warn ? 'warn' : 'ok');
  _pdfcShow(`${head}${warn}${list}<p class="pdfx-facts">${facts.join('<br>')}</p>`, cls);
}

// Opened from the PDF's link (/check#CODE), or a local copy's /#check=CODE.
function _pdfcFromAddress() {
  let code = null;
  if (/\/check$/.test(location.pathname) && location.hash.length > 1) code = location.hash.slice(1).replace(/^check=/, '');
  else if (/^#check=/.test(location.hash)) code = location.hash.slice(7);
  if (!code) {
    if (/\/check$/.test(location.pathname)) openPdfCheck();
    return;
  }
  openPdfCheck(location.href);
  pdfCheckCode(code);
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', _pdfcFromAddress);
else _pdfcFromAddress();
