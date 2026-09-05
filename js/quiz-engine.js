let selectedQuizNum = 1;
let selectedMode    = 'quiz'; // 'quiz' | 'solveall'
let selectedCumulativeMode = 'single'; // 'single' | 'cumulative'
let ACTIVE_PROBLEMS = QUIZZES[selectedQuizNum - 1].problems;


// ─── Number parser (Moodle rules) ────────────────────────────────────────────
function parseMoodleNumber(raw) {
  if (!raw) return NaN;
  const s = raw.trim();
  if (s.includes(",")) return NaN;
  if (/^[+-]?\d+(\.\d*)?$/.test(s) || /^[+-]?\.\d+$/.test(s)) return parseFloat(s);
  if (/[Ee]/.test(s)) {
    if (/^[+-]?\d+(\.\d*)?[Ee][+-]?\d+$/.test(s)) return parseFloat(s);
    return NaN;
  }
  const m1 = s.match(/^([+-]?\d+(\.\d*)?)\*10\^([+-]?\d+)$/);
  if (m1) return parseFloat(m1[1]) * Math.pow(10, parseInt(m1[3], 10));
  const m2 = s.match(/^([+-]?)10\^([+-]?\d+)$/);
  if (m2) return (m2[1] === "-" ? -1 : 1) * Math.pow(10, parseInt(m2[2], 10));
  return NaN;
}

function numberCorrect(userVal, expected, unitScale) {
  const u = parseMoodleNumber(userVal);
  if (isNaN(u)) return false;
  const scaled = u * (unitScale === undefined ? 1 : unitScale);
  const tol = Math.abs(expected) * 0.01 + 1e-10;
  return Math.abs(scaled - expected) <= tol;
}

// ─── Unit algebra engine (Moodle / course rules) ──────────────────────────────

// SI prefixes this course's unit boxes understand, checked longest-symbol-first.
// "mc" / "mk" are ASCII aliases for micro (common transliteration of "мк").
const SI_PREFIXES = [
  { sym: "da", factor: 1e1  },
  { sym: "mc", factor: 1e-6 },
  { sym: "mk", factor: 1e-6 },
  { sym: "Y",  factor: 1e24 },
  { sym: "Z",  factor: 1e21 },
  { sym: "E",  factor: 1e18 },
  { sym: "P",  factor: 1e15 },
  { sym: "T",  factor: 1e12 },
  { sym: "G",  factor: 1e9  },
  { sym: "M",  factor: 1e6  },
  { sym: "k",  factor: 1e3  },
  { sym: "h",  factor: 1e2  },
  { sym: "d",  factor: 1e-1 },
  { sym: "c",  factor: 1e-2 },
  { sym: "m",  factor: 1e-3 },
  { sym: "u",  factor: 1e-6 },
  { sym: "n",  factor: 1e-9 },
  { sym: "p",  factor: 1e-12 },
  { sym: "f",  factor: 1e-15 },
  { sym: "a",  factor: 1e-18 },
  { sym: "z",  factor: 1e-21 },
  { sym: "y",  factor: 1e-24 },
];

// Units a prefix is allowed to attach to. Deliberately excludes "kg" (which
// already has "kilo" baked in — stacking a second prefix on it is ambiguous)
// and "rad"/"turns" (counting units; not a real use case in this course).
const PREFIXABLE_UNITS = new Set([
  "N", "C", "m", "s", "J", "V", "A", "T", "W", "H", "Hz", "Pa", "Wb", "Ohm", "F"
]);

// Splits a raw symbol like "mT" into { base: "T", scale: 0.001 }. Exact
// single-letter units (T, m, H, F, A, ...) are protected automatically: a
// prefix candidate the same length as the symbol itself can never leave a
// valid remainder, so e.g. bare "T" always stays Tesla, never "tera-nothing".
function decomposeUnitToken(sym) {
  for (const { sym: pfx, factor } of SI_PREFIXES) {
    if (sym.length > pfx.length && sym.startsWith(pfx)) {
      const rest = sym.slice(pfx.length);
      if (PREFIXABLE_UNITS.has(rest)) return { base: rest, scale: factor };
    }
  }
  return { base: sym, scale: 1 }; // no recognized prefix — treat as-is (old behavior)
}

// Some unit strings (accepted answers, or things a user pastes/types) use real
// Unicode superscript characters, e.g. "cm²" or "s⁻¹", instead of "cm^2" /
// "s^-1". Normalize those to caret notation up front so the rest of the
// parser (which only understands "^N") can handle them uniformly.
const SUPERSCRIPT_MAP = { "⁰":"0","¹":"1","²":"2","³":"3","⁴":"4","⁵":"5","⁶":"6","⁷":"7","⁸":"8","⁹":"9","⁻":"-","⁺":"+" };
function normalizeSuperscripts(str) {
  return str.replace(/([A-Za-z])([⁰¹²³⁴⁵⁶⁷⁸⁹⁻⁺]+)/g, (_, letter, supers) => {
    let out = "";
    for (const c of supers) out += SUPERSCRIPT_MAP[c];
    return letter + "^" + out;
  });
}

function parseUnitToMap(raw) {
  if (!raw) return { map: new Map(), valid: true, scale: 1 };
  let s = normalizeSuperscripts(raw.trim());
  if (s === "" || s === "(none)" || s === "none" || s === "rad")
    return { map: new Map(), valid: true, scale: 1 };
  if (/[*·×⋅]/.test(s)) return { map: null, valid: false, scale: 1 };
  const stripped = s.replace(/\^\([+-]?\d+\)/g, "");
  if (/[()]/.test(stripped)) return { map: null, valid: false, scale: 1 };
  s = s.replace(/\^\(([+-]?\d+)\)/g, "^$1");
  const slashIdx = s.indexOf("/");
  const numStr = slashIdx === -1 ? s : s.slice(0, slashIdx);
  const denStr = slashIdx === -1 ? "" : s.slice(slashIdx + 1);

  const map = new Map();
  let scale = 1;
  function applyTokens(tokenStr, sign) {
    for (const tok of tokenStr.trim().split(/\s+/).filter(Boolean)) {
      const m = tok.match(/^([A-Za-z]+)(?:\^([+-]?\d+))?$/);
      if (!m) return false;
      const exp = m[2] !== undefined ? parseInt(m[2], 10) : 1;
      const { base, scale: pfxScale } = decomposeUnitToken(m[1]);
      const signedExp = sign * exp;
      map.set(base, (map.get(base) || 0) + signedExp);
      scale *= Math.pow(pfxScale, signedExp);
    }
    return true;
  }
  if (applyTokens(numStr, +1) === false || applyTokens(denStr, -1) === false)
    return { map: null, valid: false, scale: 1 };

  for (const [k, v] of map) if (v === 0) map.delete(k);
  return { map, valid: true, scale };
}

// Some problems store `answer` already expressed in a prefixed unit (e.g.
// answer: 326.9, units:["nm"] — the stored number IS a nanometer count, not
// meters). So the SI-prefix conversion must be *relative to whatever unit the
// answer was actually written in* (units[0]), not an absolute conversion to
// base SI. Typing the exact same unit as units[0] must always be a 1:1 match
// no matter what prefix it carries; typing a different (but dimensionally
// equivalent) prefixed unit should convert relative to that reference.
function unitConversionFactor(userRaw, acceptedList) {
  const list = (!acceptedList || acceptedList.length === 0) ? [""] : acceptedList;
  const { valid: userValid, scale: userScale } = parseUnitToMap(userRaw);
  if (!userValid) return 1; // malformed unit — don't let it corrupt the number check
  const { valid: refValid, scale: refScale } = parseUnitToMap(list[0]);
  if (!refValid || !refScale) return 1;
  return userScale / refScale;
}

function serializeUnitMap(map) {
  if (!map || map.size === 0) return "";
  return [...map.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([sym, exp]) => exp === 1 ? sym : `${sym}^${exp}`)
    .join(" ");
}

function unitStatus(userRaw, acceptedList) {
  // units:[] (empty array) means "dimensionless", same as units:[""].
  const list = (!acceptedList || acceptedList.length === 0) ? [""] : acceptedList;
  const { map, valid } = parseUnitToMap(userRaw);
  if (!valid) return "invalid";
  const canonical = serializeUnitMap(map);
  const match = list.some(a => {
    const { map: am, valid: av } = parseUnitToMap(a);
    return av && serializeUnitMap(am) === canonical;
  });
  return match ? "ok" : "wrong";
}

function fmt(n) {
  if (n === 0) return "0";
  const abs = Math.abs(n);
  if (abs >= 1e-3 && abs < 1e7) return +n.toPrecision(7) + "";
  return n.toExponential(5);
}

function fmtUnit(units) {
  const u = units[0];
  if (!u || u === "" || u === "(none)") return "dimensionless";
  return u;
}

// ─── State ───────────────────────────────────────────────────────────────────
let quiz = [];
let checked = false;
let selectedTopics = [];
// Per-quiz topic selections for cumulative mode: { quizIdx -> Set of topics }
let cumulativeTopics = {};
// Per-quiz filter type: 'none' | 'topic' | 'number' | 'type', cumulative mode only
let cumulativeFilterMode = {};
let cumulativeNumFilter  = {}; // quizIdx -> { incexc: 'include'|'exclude', ranges: Set<number> }
// Per-quiz "Type" filter (attempt-status based): quizIdx -> Set of
// 'unattempted' | 'wrong' | 'partial' | 'correct'
let cumulativeTypeFilter = {};

// The four attempt-status checks the "Type" filter offers, in display order.
// Internal keys line up with the score classification problemPassesFilter
// and the Stats "Problems overview" grid both already use (1 / 0.9 / other).
// `cls` is that same grid's .score-box-* class, reused here (see
// renderFilterConfigArea's 'type' branch) as a small colored swatch next to
// each label — so a box's color out in the quiz/Stats views can be matched
// straight back to the checkbox that controls it.
const FILTER_TYPE_STATUS_OPTIONS = [
  { key: 'unattempted', label: 'Not attempted',            cls: 'score-box-unattempted' },
  { key: 'wrong',        label: 'Attempted wrong',          cls: 'score-box-wrong' },
  { key: 'partial',      label: 'Attempted almost correct', cls: 'score-box-partial' },
  { key: 'correct',      label: 'Attempted correct',        cls: 'score-box-correct' },
];

// Parses "5-6, 3, 15-19" into a Set of integers
function parseNumRanges(raw) {
  const set = new Set();
  if (!raw) return set;
  raw.split(',').forEach(part => {
    part = part.trim();
    if (!part) return;
    const m = part.match(/^(\d+)\s*-\s*(\d+)$/);
    if (m) {
      let a = parseInt(m[1], 10), b = parseInt(m[2], 10);
      if (a > b) [a, b] = [b, a];
      for (let n = a; n <= b; n++) set.add(n);
    } else if (/^\d+$/.test(part)) {
      set.add(parseInt(part, 10));
    }
  });
  return set;
}

// Lazily-built, per-batch cache of problem attempt scores for the "Type"
// filter — invalidated (see below) at the start of every newQuiz()/
// _filterNarrowsCurrentPool() pass instead of being rebuilt on every single
// problemPassesFilter() call within that pass (which, across a whole
// cumulative-mode pool, can be called hundreds of times). Reads whichever
// of Last-attempt/Best-ever js/stats.js's own Problems-overview switch
// (_poMode) is currently set to, so "attempted correct" etc. here means the
// same thing it means over there — one shared notion of "correct" rather
// than a second, independent one.
let _typeFilterScoresCache = null;
function _invalidateTypeFilterScoresCache() { _typeFilterScoresCache = null; }
function _typeFilterScores() {
  if (_typeFilterScoresCache) return _typeFilterScoresCache;
  const useBest = typeof _poMode !== 'undefined' && _poMode === 'best';
  _typeFilterScoresCache = useBest && typeof _buildBestProblemScores === 'function'
    ? _buildBestProblemScores()
    : (typeof _buildLatestProblemScores === 'function' ? _buildLatestProblemScores() : new Map());
  return _typeFilterScoresCache;
}
function _problemAttemptStatus(p, quizNum) {
  const rec = _typeFilterScores().get(`${quizNum}_${p.id}`);
  if (!rec) return 'unattempted';
  return rec.points === 1 ? 'correct' : rec.points === 0.9 ? 'partial' : 'wrong';
}

// Whether problem p passes quizIdx's active filter.
function problemPassesFilter(p, quizIdx) {
  const mode = cumulativeFilterMode[quizIdx] || 'topic';
  if (mode === 'none') return true;
  if (mode === 'number') {
    const nf = cumulativeNumFilter[quizIdx];
    if (!nf) return true;
    const num = parseInt(String(p.id).replace(/\D/g, ''), 10);
    const inSet = nf.ranges.has(num);
    return nf.incexc === 'exclude' ? !inSet : inSet;
  }
  if (mode === 'type') {
    const sel = cumulativeTypeFilter[quizIdx];
    if (!sel || sel.size === 0) return true;
    return sel.has(_problemAttemptStatus(p, quizIdx + 1));
  }
  const filter = cumulativeTopics[quizIdx];
  return !filter || filter.size === 0 || filter.has(p.topic);
}

// ── Reset button: tap-to-arm confirmation instead of a blocking confirm()
// dialog ── First tap arms it: label swaps to "Sure?" and a red ring traces
// out of its border over RESET_CONFIRM_MS (see _armResetConfirm/css
// .reset-confirm-ring) as a visual countdown. A second tap while armed
// commits the reset; letting the ring finish (no second tap) just disarms
// back to normal — same "nothing happens unless you mean it" guarantee the
// old confirm() gave, without stopping the page to ask.
const RESET_CONFIRM_MS = 3000;
let _resetConfirmArmed = false;
let _resetConfirmTimer = null;

function handleResetClick() {
  const btn = document.getElementById('filterResetBtn');
  if (!btn) return;
  if (_resetConfirmArmed) {
    _disarmResetConfirm(btn);
    doResetFilterPreferences();
    return;
  }
  _armResetConfirm(btn);
}

function _armResetConfirm(btn) {
  _resetConfirmArmed = true;
  btn.classList.add('confirming');
  btn.title = 'Tap again to confirm reset';
  const label = btn.querySelector('.filter-reset-label');
  if (label) label.textContent = 'Sure?';

  // Size the ring's rect to the button's *actual* current border box —
  // same width/height, and the same corner radius the button's own CSS is
  // using right now (read live via getComputedStyle rather than a
  // hardcoded rx), inset by exactly half the stroke width so the stroke
  // centers on the button's real edge. That's what keeps the line looking
  // like the button's own border animating, instead of a separate,
  // differently-sized-and-rounded shape sitting on top of it.
  const ring = btn.querySelector('.reset-confirm-ring');
  const rect = ring && ring.querySelector('rect');
  if (ring && rect) {
    const w = btn.offsetWidth, h = btn.offsetHeight;
    const strokeW = 1.5;
    const inset = strokeW / 2;
    const radius = parseFloat(getComputedStyle(btn).borderTopLeftRadius) || 0;
    ring.setAttribute('viewBox', `0 0 ${w} ${h}`);
    rect.setAttribute('x', inset);
    rect.setAttribute('y', inset);
    rect.setAttribute('width', Math.max(0, w - inset * 2));
    rect.setAttribute('height', Math.max(0, h - inset * 2));
    rect.setAttribute('rx', Math.max(0, radius - inset));
    const len = rect.getTotalLength();
    rect.style.transition = 'none';
    rect.style.strokeDasharray = len;
    rect.style.strokeDashoffset = 0; // fully visible outline (the "full 2π")
    void rect.getBoundingClientRect(); // force reflow before transitioning
    rect.style.transition = `stroke-dashoffset ${RESET_CONFIRM_MS}ms linear`;
    // One dash the length of the whole perimeter, offset all the way around
    // it: the visible portion recedes from the start point instead of the
    // outline just fading, i.e. it un-draws itself back down to nothing.
    requestAnimationFrame(() => { rect.style.strokeDashoffset = len; });
  }

  clearTimeout(_resetConfirmTimer);
  _resetConfirmTimer = setTimeout(() => _disarmResetConfirm(btn), RESET_CONFIRM_MS);
}

function _disarmResetConfirm(btn) {
  _resetConfirmArmed = false;
  clearTimeout(_resetConfirmTimer);
  _resetConfirmTimer = null;
  // Removing "confirming" is also what hides the ring (opacity, css/
  // style.css .reset-confirm-ring) — visibility is gated purely on that
  // class rather than on the rect's own left-over stroke-dashoffset value,
  // so there's no stale "fully drawn but nobody hid it" state to get stuck
  // showing a permanent outline after the first arm/disarm cycle.
  btn.classList.remove('confirming');
  btn.title = 'Reset all filter preferences';
  const label = btn.querySelector('.filter-reset-label');
  if (label) label.textContent = '↺ Reset';
}

function doResetFilterPreferences() {
  Object.keys(localStorage).forEach(k => {
    if (k.startsWith(STORAGE_PREFIX + '_topics_q') || k.startsWith(STORAGE_PREFIX + '_filtermode_q') ||
        k.startsWith(STORAGE_PREFIX + '_numfilter_q') || k.startsWith(STORAGE_PREFIX + '_typefilter_q')) {
      localStorage.removeItem(k);
    }
  });
  // initTopics() clears and rebuilds #topicSelector's own children in
  // place (same element, not a replacement one) — exactly what
  // _animateHeightChange expects, so switching from whatever filter was
  // showing back down to "No filter" (now much shorter — see the mode
  // fallback above) animates smoothly instead of the container snapping
  // straight to its new, shorter height.
  const container = document.getElementById('topicSelector');
  _animateHeightChange(container, () => initTopics());
}

function loadTopicsForQuiz(quizIdx) {
  const problems = QUIZZES[quizIdx].problems;
  const allTopics = [...new Set(problems.map(p => p.topic))].sort();
  const key = STORAGE_PREFIX + '_topics_q' + (quizIdx + 1);
  let saved;
  try { saved = JSON.parse(localStorage.getItem(key)); } catch(e) {}
  let sel = Array.isArray(saved) ? saved.filter(t => allTopics.includes(t)) : [];
  if (sel.length === 0) sel = [...allTopics];
  return { allTopics, sel };
}

// Loads (or defaults, all-checked, same convention as topics) this quiz's
// saved Type-filter selection.
function loadTypeFilterForQuiz(quizIdx) {
  const key = STORAGE_PREFIX + '_typefilter_q' + (quizIdx + 1);
  const allKeys = FILTER_TYPE_STATUS_OPTIONS.map(o => o.key);
  let saved;
  try { saved = JSON.parse(localStorage.getItem(key)); } catch(e) {}
  let sel = Array.isArray(saved) ? saved.filter(k => allKeys.includes(k)) : [];
  if (sel.length === 0) sel = [...allKeys];
  return sel;
}

// Animates `el` between its pre- and post-mutation heights instead of
// letting a fresh innerHTML swap just pop to the new size — measures the
// real before/after heights (rather than guessing) so it holds up for any
// combination of filter blocks (a one-line number input vs. a wrapping
// grid of topic/type chips) without per-case tuning.
function _animateHeightChange(el, mutateFn) {
  if (!el) { mutateFn(); return; }
  const startH = el.getBoundingClientRect().height;
  mutateFn();
  const endH = el.scrollHeight;
  if (Math.abs(endH - startH) < 1) return; // nothing worth animating
  el.style.overflow = 'hidden';
  el.style.height = startH + 'px';
  void el.offsetHeight; // force reflow so the next assignment transitions
  el.style.transition = 'height 0.32s ease';
  requestAnimationFrame(() => { el.style.height = endH + 'px'; });
  const cleanup = () => {
    el.style.transition = '';
    el.style.height = '';
    el.style.overflow = '';
    el.removeEventListener('transitionend', cleanup);
  };
  el.addEventListener('transitionend', cleanup);
  // Belt-and-braces cleanup in case transitionend never fires (e.g. the
  // element got hidden/removed mid-transition).
  setTimeout(cleanup, 400);
}

// Builds the config block for whichever filter type is currently active —
// nothing for "No filter", topic chips, the number-range input, or the
// Type (attempt-status) chips. Re-invoked (inside _animateHeightChange)
// every time the 4-way switch changes; the individual chip/input change
// handlers below patch their own state in place instead of re-calling this.
function renderFilterConfigArea(quizIdx, area) {
  const mode = cumulativeFilterMode[quizIdx] || 'topic';
  area.innerHTML = '';
  if (mode === 'none') return;

  if (mode === 'topic') {
    const { allTopics } = loadTopicsForQuiz(quizIdx);
    const topicKey = STORAGE_PREFIX + '_topics_q' + (quizIdx + 1);
    const block = document.createElement('div');
    block.className = 'topic-chip-block';
    allTopics.forEach(topic => {
      const isChecked = cumulativeTopics[quizIdx].has(topic);
      const lbl = document.createElement('label');
      lbl.className = 'topic-chip' + (isChecked ? ' active' : '');
      lbl.innerHTML = `<input type="checkbox" value="${topic}" ${isChecked ? 'checked' : ''}>${topic}`;
      lbl.querySelector('input').addEventListener('change', e => {
        if (e.target.checked) { cumulativeTopics[quizIdx].add(topic); lbl.classList.add('active'); }
        else { cumulativeTopics[quizIdx].delete(topic); lbl.classList.remove('active'); }
        localStorage.setItem(topicKey, JSON.stringify([...cumulativeTopics[quizIdx]]));
        updateFilterActiveNote();
      });
      block.appendChild(lbl);
    });
    area.appendChild(block);
    return;
  }

  if (mode === 'number') {
    const numKey = STORAGE_PREFIX + '_numfilter_q' + (quizIdx + 1);
    // Displays the raw text last typed (rangesRaw), not a string rebuilt
    // from the parsed Set — rebuilding would flatten "5-6, 3, 15-19" into
    // individual enumerated numbers on every switch away and back.
    const numMeta = { incexc: cumulativeNumFilter[quizIdx]?.incexc || 'include',
                       ranges: cumulativeNumFilter[quizIdx]?.rangesRaw || '' };
    const block = document.createElement('div');
    block.className = 'num-filter-block';
    block.innerHTML = `
      <div class="incexc-row">
        <span class="filter-mode-option${numMeta.incexc !== 'exclude' ? ' active' : ''}" data-opt="include">Include</span>
        <div class="mode-toggle-track small${numMeta.incexc === 'exclude' ? ' on' : ''}" id="incExcToggle_${quizIdx}"><div class="mode-toggle-knob"></div></div>
        <span class="filter-mode-option${numMeta.incexc === 'exclude' ? ' active' : ''}" data-opt="exclude">Exclude</span>
      </div>
      <input type="text" class="num-filter-input" id="numRangesInput_${quizIdx}" placeholder="e.g. 5-6, 3, 15-19" value="${numMeta.ranges || ''}">`;
    area.appendChild(block);
    const track = block.querySelector(`#incExcToggle_${quizIdx}`);
    const [includeLbl, excludeLbl] = block.querySelectorAll('.filter-mode-option');
    track.addEventListener('click', () => {
      const next = cumulativeNumFilter[quizIdx].incexc === 'exclude' ? 'include' : 'exclude';
      cumulativeNumFilter[quizIdx].incexc = next;
      localStorage.setItem(numKey, JSON.stringify({ incexc: next, ranges: cumulativeNumFilter[quizIdx].rangesRaw }));
      track.classList.toggle('on', next === 'exclude');
      includeLbl.classList.toggle('active', next !== 'exclude');
      excludeLbl.classList.toggle('active', next === 'exclude');
      updateFilterActiveNote();
    });
    block.querySelector(`#numRangesInput_${quizIdx}`).addEventListener('input', e => {
      cumulativeNumFilter[quizIdx].rangesRaw = e.target.value;
      cumulativeNumFilter[quizIdx].ranges = parseNumRanges(e.target.value);
      localStorage.setItem(numKey, JSON.stringify({ incexc: cumulativeNumFilter[quizIdx].incexc, ranges: e.target.value }));
      updateFilterActiveNote();
    });
    return;
  }

  if (mode === 'type') {
    const typeKey = STORAGE_PREFIX + '_typefilter_q' + (quizIdx + 1);
    // Three-column grid (checkbox / label / sample score-box) instead of
    // the topic filter's wrapping chips — a fixed column layout reads
    // better here since every row needs to line up with the others, and
    // the third column doubles as a color key back to the score-box grid
    // (Stats "Problems overview") and in-quiz score boxes: same classes,
    // same colors, just a stand-in "P0" id since no real problem applies.
    // One shared parent grid (not four independent per-row grids) is what
    // actually keeps column 3 aligned regardless of how long each row's
    // label text runs — each row is a `label` element kept in normal flow
    // via `display: contents` (css/style.css .type-filter-row) so its three
    // children slot directly into the parent's three grid columns while the
    // label itself still toggles its checkbox on a click anywhere in the row.
    const block = document.createElement('div');
    block.className = 'type-filter-grid';
    FILTER_TYPE_STATUS_OPTIONS.forEach(opt => {
      const isChecked = cumulativeTypeFilter[quizIdx].has(opt.key);
      const lbl = document.createElement('label');
      lbl.className = 'type-filter-row';
      lbl.innerHTML = `
        <input type="checkbox" class="type-filter-checkbox" value="${opt.key}" ${isChecked ? 'checked' : ''}>
        <span class="type-filter-label">${opt.label}</span>
        <span class="score-box ${opt.cls} type-filter-swatch">P0</span>`;
      lbl.querySelector('input').addEventListener('change', e => {
        if (e.target.checked) cumulativeTypeFilter[quizIdx].add(opt.key);
        else cumulativeTypeFilter[quizIdx].delete(opt.key);
        localStorage.setItem(typeKey, JSON.stringify([...cumulativeTypeFilter[quizIdx]]));
        updateFilterActiveNote();
      });
      block.appendChild(lbl);
    });
    area.appendChild(block);
    return;
  }
}

// Switches quizIdx's filter type (No filter / Topic / Number / Type),
// persists it, re-syncs every button's active state, and animates the
// config area to its new content's height instead of letting it jump.
function setFilterMode(quizIdx, mode, tabsRow) {
  cumulativeFilterMode[quizIdx] = mode;
  localStorage.setItem(STORAGE_PREFIX + '_filtermode_q' + (quizIdx + 1), mode);
  tabsRow.querySelectorAll('.filter-type-tab').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.mode === mode);
  });
  const area = document.getElementById(`filterConfigArea_${quizIdx}`);
  _animateHeightChange(area, () => renderFilterConfigArea(quizIdx, area));
  updateFilterActiveNote();
}

function buildQuizTopicBlock(container, quizIdx, label) {
  const { sel } = loadTopicsForQuiz(quizIdx);
  cumulativeTopics[quizIdx] = new Set(sel);
  cumulativeTypeFilter[quizIdx] = new Set(loadTypeFilterForQuiz(quizIdx));

  const modeKey = STORAGE_PREFIX + '_filtermode_q' + (quizIdx + 1);
  const numKey  = STORAGE_PREFIX + '_numfilter_q'  + (quizIdx + 1);

  const savedMode = localStorage.getItem(modeKey);
  // Default (no saved preference — including right after Reset, which wipes
  // this same key) is "No filter", not "Topic": resetting should hand back
  // the full, unfiltered pool rather than silently re-opting into one
  // particular filter type.
  const mode = ['none', 'topic', 'number', 'type'].includes(savedMode) ? savedMode : 'none';
  let numMeta;
  try { numMeta = JSON.parse(localStorage.getItem(numKey)); } catch(e) {}
  if (!numMeta || typeof numMeta !== 'object') numMeta = { incexc: 'include', ranges: '' };

  cumulativeFilterMode[quizIdx] = mode;
  cumulativeNumFilter[quizIdx]  = { incexc: numMeta.incexc, ranges: parseNumRanges(numMeta.ranges), rangesRaw: numMeta.ranges || '' };

  const header = document.createElement('div');
  header.className = 'topic-selector-header';
  header.textContent = label;
  container.appendChild(header);

  // ── Filter-type tabs: No filter / Topic / Number / Type ──
  const tabsRow = document.createElement('div');
  tabsRow.className = 'filter-type-tabs';
  tabsRow.innerHTML = [
    { key: 'none',   label: 'No filter' },
    { key: 'topic',  label: 'Topic' },
    { key: 'number', label: 'Number' },
    { key: 'type',   label: 'Type' },
  ].map(t => `<button type="button" class="filter-type-tab${mode === t.key ? ' active' : ''}" data-mode="${t.key}">${t.label}</button>`).join('');
  container.appendChild(tabsRow);
  tabsRow.querySelectorAll('.filter-type-tab').forEach(btn => {
    btn.addEventListener('click', () => setFilterMode(quizIdx, btn.dataset.mode, tabsRow));
  });

  // ── Config area for whichever tab is active ──
  const area = document.createElement('div');
  area.className = 'filter-config-area';
  area.id = `filterConfigArea_${quizIdx}`;
  container.appendChild(area);
  renderFilterConfigArea(quizIdx, area);
}

function initTopics() {
  const container = document.getElementById("topicSelector");
  container.innerHTML = '';
  cumulativeTopics = {};
  cumulativeFilterMode = {};
  cumulativeNumFilter = {};
  cumulativeTypeFilter = {};
  _invalidateTypeFilterScoresCache();

  if (selectedCumulativeMode === 'cumulative' && selectedQuizNum >= 2) {
    for (let i = 0; i < selectedQuizNum; i++) {
      buildQuizTopicBlock(container, i, `Quiz #${i + 1} · ${QUIZZES[i].name}`);
    }
  } else {
    // Single quiz mode — shares the same filter block (and localStorage
    // keys) as this quiz number's slot in cumulative mode, via the same
    // quizIdx = selectedQuizNum - 1. Every filter type here (No filter/
    // Topic/Number/Type) therefore already applies identically whichever
    // mode the quiz itself is drawn in.
    buildQuizTopicBlock(container, selectedQuizNum - 1, 'Problem Pool Filter');
  }
}

function pickRandom(arr, n) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a.slice(0, n);
}

// Whether the active Topic/Number filter is actually excluding at least
// one problem from the pool this newQuiz() draw pulls from. Covers both
// single mode (just the selected quiz) and cumulative mode (every quiz
// number folded into the draw, same range newQuiz()'s prevPool/currPool
// loop below covers) — so the header note reflects whichever quizzes are
// actually contributing to this attempt, not just the one currently
// selected.
function _filterNarrowsCurrentPool() {
  const indices = (selectedCumulativeMode === 'cumulative' && selectedQuizNum >= 2)
    ? Array.from({ length: selectedQuizNum }, (_, i) => i)
    : [selectedQuizNum - 1];
  return indices.some(i => {
    const problems = QUIZZES[i].problems;
    const passing = problems.filter(p => problemPassesFilter(p, i)).length;
    return passing < problems.length;
  });
}

function updateFilterActiveNote() {
  const note = document.getElementById('filterActiveNote');
  if (!note) return;
  note.style.display = _filterNarrowsCurrentPool() ? '' : 'none';
}

function newQuiz() {
  // A fresh draw should reflect any attempt just recorded (checkAll()) —
  // e.g. a "Not attempted" Type-filter pool shrinking now that the
  // previous round's problems have a status. Cheap: just clears the cache,
  // the first problemPassesFilter() call below rebuilds it once.
  _invalidateTypeFilterScoresCache();
  if (selectedCumulativeMode === 'cumulative' && selectedQuizNum >= 2) {
    let prevPool = [];
    for (let i = 0; i < selectedQuizNum - 1; i++) {
      QUIZZES[i].problems
        .filter(p => problemPassesFilter(p, i))
        .forEach(p => prevPool.push({ ...p, _quizNum: i + 1 }));
    }
    let currPool = ACTIVE_PROBLEMS.filter(p => problemPassesFilter(p, selectedQuizNum - 1));
    if (currPool.length === 0) currPool = [...ACTIVE_PROBLEMS];
    currPool = currPool.map(p => ({ ...p, _quizNum: selectedQuizNum }));

    if (prevPool.length === 0) prevPool = [];
    const prevPick = pickRandom(prevPool, QUIZ_CUMULATIVE_PREV_COUNT);
    const currPick = pickRandom(currPool, QUIZ_SIZE - QUIZ_CUMULATIVE_PREV_COUNT);
    quiz = pickRandom([...prevPick, ...currPick], QUIZ_SIZE);
  } else {
    let pool = ACTIVE_PROBLEMS.filter(p => problemPassesFilter(p, selectedQuizNum - 1));
    if (pool.length === 0) pool = ACTIVE_PROBLEMS;
    quiz = pickRandom(pool, Math.min(QUIZ_SIZE, pool.length));
  }

  checked = false;
  document.getElementById("resultPanel").classList.remove("show");
  document.getElementById("recentAttemptsPanel").classList.remove("show");
  document.getElementById("checkBtn").disabled = false;
  document.getElementById("resultMaxScore").textContent = "Final Score";
  updateFilterActiveNote();
  render();
  // Mirrors the reveal in checkAll() — new attempt, nothing checked yet,
  // so the FAB goes back to hidden per syncForumFabVisibility()'s
  // plain-Random-6 rule.
  if (typeof syncForumFabVisibility === 'function') syncForumFabVisibility();
  // New attempt means the just-hidden per-problem buttons have nothing to
  // poll for right now — stop, mirroring exitSolveAll()'s stop call.
  // Idempotent, and startForumProblemCountsPolling() above will restart it
  // once this attempt gets checked.
  if (typeof stopForumProblemCountsPolling === 'function') stopForumProblemCountsPolling();
  // ── Stats: start timer for this attempt (Random 6 mode only) ──
  if (typeof startAttemptTimer !== 'undefined') startAttemptTimer();
}

function render() {
  const container = document.getElementById("quizContainer");
  container.innerHTML = "";
  quiz.forEach((p, i) => {
    const isCumulative = selectedCumulativeMode === 'cumulative' && p._quizNum != null;
    const numDisplay   = isCumulative ? `${p.id} · Quiz #${p._quizNum}` : p.id;
    const card = document.createElement("div");
    card.className = "problem-card";
    card.id = "card-" + i;
    card.innerHTML = `
      <div class="card-header">
        <span class="problem-num">${numDisplay}</span>
        <span class="problem-topic">${p.topic}</span>
      </div>
      <div class="problem-text">${p.text}</div>
      <div class="answer-row">
        <span class="answer-label">Value =</span>
        <input class="answer-input" id="ans-${i}" type="text" placeholder="e.g. 3.2e-8" autocomplete="off" spellcheck="false">
        <span class="sep">·</span>
        <input class="unit-input" id="unit-${i}" type="text" placeholder="e.g. N/C" autocomplete="off" spellcheck="false">
      </div>
      <div class="feedback" id="fb-${i}"></div>
      <div class="card-check-row" id="forum-row-${i}" style="display:none;">
        <button class="forum-problem-btn" id="rq-forum-btn-${i}" title="Forum thread for ${p.id}"
          onclick="openForumForProblem(${p._quizNum || selectedQuizNum}, '${p.id}')">
          💬 <span id="rq-forum-total-${i}"></span>
          <span class="forum-problem-btn-badge" id="rq-forum-badge-${i}" style="display:none;"></span>
          <span class="forum-problem-btn-at" id="rq-forum-at-${i}" style="display:none;">@</span>
        </button>
      </div>
    `;
    container.appendChild(card);

    card.querySelector(`#ans-${i}`).addEventListener("keydown", e => {
      if (e.key === "Enter") document.getElementById(`unit-${i}`).focus();
    });
    card.querySelector(`#unit-${i}`).addEventListener("keydown", e => {
      if (e.key === "Enter") {
        const next = document.getElementById(`ans-${i+1}`);
        if (next) next.focus(); else checkAll();
      }
    });
  });
  renderMathIn(container);
}

function checkAll() {
  if (checked) return;
  checked = true;
  document.getElementById("checkBtn").disabled = true;

  let totalPts = 0;
  const breakdown = [];
  const answers = []; // per-problem entered value/unit/points, for the synced attempt (js/attempts-sync.js) and its review screen

  quiz.forEach((p, i) => {
    const ansEl  = document.getElementById("ans-"  + i);
    const unitEl = document.getElementById("unit-" + i);
    const card   = document.getElementById("card-" + i);
    const fb     = document.getElementById("fb-"   + i);

    const numOk  = numberCorrect(ansEl.value, p.answer, unitConversionFactor(unitEl.value, p.units));
    const uStat  = unitStatus(unitEl.value, p.units);
    const unitOk = uStat === "ok";
    const pts    = numOk ? (unitOk ? 1 : 0.9) : 0;
    totalPts    += pts;

    ansEl.classList.add(numOk ? "correct-input" : "wrong-input");

    if (numOk) {
      unitEl.classList.add(unitOk ? "correct-unit" : "partial-unit");
    } else {
      unitEl.classList.add("wrong-unit");
    }

    if      (pts === 1)   card.classList.add("correct");
    else if (pts === 0.9) card.classList.add("partial");
    else                  card.classList.add("wrong");

    const forumRow = document.getElementById("forum-row-" + i);
    if (forumRow) forumRow.style.display = "";

    fb.classList.add("show");
    if (pts === 1) {
      fb.classList.add("correct-fb");
      fb.innerHTML = `✓ Correct <span class="pts-badge pts-full">+1 pt</span>`;
    } else if (pts === 0.9) {
      fb.classList.add("partial-fb");
      const unitHint = uStat === "invalid"
        ? `unit format invalid — use spaces to multiply, e.g. <strong>${fmtUnit(p.units)}</strong>`
        : `unit should be <strong>${fmtUnit(p.units)}</strong>`;
      fb.innerHTML = `✓ Value correct, but ${unitHint} <span class="pts-badge pts-partial">+0.9 pt</span>`;
    } else {
      fb.classList.add("wrong-fb");
      fb.innerHTML = `✗ Expected ≈ <strong>${fmt(p.answer)}</strong> ${fmtUnit(p.units)} <span class="pts-badge pts-zero">+0 pt</span>`;
    }

    breakdown.push({ id: p.id, pts });
    answers.push({
      problem_id: p.id,
      quiz_num: p._quizNum || selectedQuizNum,
      entered_value: ansEl.value,
      entered_unit: unitEl.value,
      points: pts
    });
  });

  const panel = document.getElementById("resultPanel");
  const disp  = Number.isInteger(totalPts) ? totalPts : totalPts.toFixed(1);
  document.getElementById("resultScore").innerHTML =
    `<span class="result-score-num">${disp}</span><span class="result-score-den">/${quiz.length}</span>`;
  document.getElementById("resultBreakdown").innerHTML =
    breakdown.map(b => {
      const cls = b.pts === 1 ? "score-box-correct" : b.pts === 0.9 ? "score-box-partial" : "score-box-wrong";
      return `<span class="score-box ${cls}" title="${b.pts} pt">${b.id}</span>`;
    }).join("");
  panel.classList.add("show");
  panel.scrollIntoView({ behavior: "smooth", block: "nearest" });
  // ── Forum: FAB and per-problem "Discuss" buttons only make sense once
  // there's something to discuss — see syncForumFabVisibility() in
  // forum.js, which now hides the FAB during a plain Random 6 attempt but
  // not once `checked` is true. No such check while the quiz is still in
  // progress (no class mutation happens just from setting `checked`, so
  // this call is what actually reveals it now).
  if (typeof syncForumFabVisibility === 'function') syncForumFabVisibility();
  // Per-problem forum buttons just came into view for the first time this
  // attempt (forum-row-i display was flipped on above) — start the same
  // 5s counts poll solve-all uses so their totals/unread badges are filled
  // in and kept current, rather than sitting empty until some other screen
  // happens to start it. Idempotent (see startForumProblemCountsPolling),
  // so this is safe to call even if it's already running.
  if (typeof startForumProblemCountsPolling === 'function') startForumProblemCountsPolling();
  // ── Stats: record this attempt ──
  if (typeof recordAttemptFromQuiz !== 'undefined') {
    recordAttemptFromQuiz(
      Number.isInteger(totalPts) ? totalPts : parseFloat(totalPts.toFixed(1)),
      quiz.length,
      selectedCumulativeMode,
      answers
    );
  }
}

// ─── Recent attempts mini-panel (last 5, shown under the result panel) ─────
// recordAttemptFromQuiz() (js/stats.js) is async — its localStorage save
// only actually lands after an `await crypto.subtle.digest(...)` call, so
// the freshly-finished attempt is NOT yet in loadStats() synchronously
// right here in checkAll(). renderRecentAttemptsMini() is instead called
// from onAttemptRecorded(), a hook stats.js fires right after it saves —
// see that file. Calling it once here too would just flash a version of
// the list missing the attempt that was literally just taken.
function onAttemptRecorded() {
  renderRecentAttemptsMini();
}

function renderRecentAttemptsMini() {
  const panel = document.getElementById('recentAttemptsPanel');
  const list  = document.getElementById('recentAttemptsList');
  if (!panel || !list || typeof loadStats !== 'function') return;

  // Most recent 5 across every quiz/mode — loadStats() is append-ordered
  // (oldest first), so the tail is the newest.
  const recent = loadStats().slice(-5).reverse();

  if (recent.length === 0) {
    list.innerHTML = '<div class="recent-attempts-empty">No previous attempts yet.</div>';
  } else {
    list.innerHTML = recent.map(a => {
      const quizName = (typeof QUIZZES !== 'undefined' && QUIZZES[a.quizNum - 1]) ? QUIZZES[a.quizNum - 1].name : '';
      const dateStr = new Date(a.date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
      const scoreStr = Number.isInteger(a.score) ? a.score : a.score.toFixed(1);
      const boxes = (a.answers || []).map(ans => {
        const cls = ans.points === 1 ? 'score-box-correct' : ans.points === 0.9 ? 'score-box-partial' : 'score-box-wrong';
        const problemId = String(ans.problem_id || '').replace(/'/g, "\\'");
        return `<span class="score-box score-box-sm ${cls} recent-attempt-problem" title="Open ${ans.problem_id} forum" role="button" tabindex="0" onclick="openForumForProblem(${ans.quiz_num || a.quizNum}, '${problemId}')" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();this.click();}">${ans.problem_id}</span>`;
      }).join('');
      return `
        <div class="recent-attempt-row">
          <span class="recent-attempt-meta">
            <span class="score">${scoreStr}/${a.maxScore}</span> · Q${a.quizNum}${quizName ? ' · ' + quizName : ''} · ${dateStr}
          </span>
          <span class="recent-attempt-boxes">${boxes}</span>
        </div>`;
    }).join('');
  }

  panel.classList.add('show');
}

// Safely leaves the active quiz screen and lands on the full Stats screen —
// openStatsScreen() (js/stats.js) assumes it's being called from the
// landing screen (it only fades *that* out), so appPage needs to be hidden
// here first or the quiz would keep showing underneath it. Mirrors the
// "leaving appPage" half of goToMainMenu()'s fromApp branch, just without
// the "go to landing" second half.
function openFullStatsFromQuiz() {
  const appPage = document.getElementById('appPage');
  if (!appPage.classList.contains('visible')) {
    if (typeof openStatsScreen === 'function') openStatsScreen();
    return;
  }
  appPage.classList.add('fading-out');
  setTimeout(() => {
    appPage.classList.remove('visible', 'fading-out');
    if (typeof stopForumProblemCountsPolling === 'function') stopForumProblemCountsPolling();
    if (typeof openStatsScreen === 'function') openStatsScreen();
  }, 280);
}

// ─── Solve-all mode ──────────────────────────────────────────────────────────
let solveAllProblems = [];
let solveAllChecked = new Map(); // index -> 'correct' | 'partial' | 'wrong' | 'revealed'
let solveAllLocked  = new Set();
let solveAllAnswers = {};        // problemId -> { ans, unit } — persisted typed answers

// Problem ids (P1, P2, ...) are only unique *within* a quiz, not across
// quizzes — every quiz reuses P1, P2, etc. The math cache is a single
// shared store, so a bare p.id would let quiz 3's "P1" overwrite quiz 2's
// "P1" entry. Scope the key by quiz number (falling back to p._quizNum for
// cumulative-mode problems, which carry their origin quiz) so each quiz's
// entries live independently.
function mathCacheKeyFor(p) {
  return `q${p._quizNum || selectedQuizNum}_${p.id}`;
}

function saStorageKey() {
  // Unique key per quiz + cumulative setting
  const cum = selectedCumulativeMode === 'cumulative' ? 'c' : 's';
  return `${STORAGE_PREFIX}_sa_q${selectedQuizNum}_${cum}`;
}

function saveSolveAllProgress() {
  localStorage.setItem(saStorageKey(), JSON.stringify(buildSolveAllSnapshot()));
}

// Wipes every locally-stored Solve-All progress snapshot (every quiz +
// cumulative/single combination — see saStorageKey()). Called when a
// nickname is exited on this device (js/forum.js submitForumExitDevice),
// same reasoning as clearLocalAttemptsCache() in js/stats.js: this
// progress is synced to the outgoing identity, not owned by the device
// itself, so it shouldn't still be sitting there for whoever uses this
// device next.
function clearLocalSolveAllProgress() {
  Object.keys(localStorage).forEach(k => {
    if (k.startsWith(STORAGE_PREFIX + '_sa_q')) localStorage.removeItem(k);
  });
}

// Same shape as what used to be built inline in saveSolveAllProgress —
// pulled out so js/solve-all-sync.js can grab the current live state to
// push, without duplicating this logic.
function buildSolveAllSnapshot() {
  const checkedById = {};
  const answersById = {};
  solveAllChecked.forEach((status, idx) => {
    const p = solveAllProblems[idx];
    if (!p) return;
    checkedById[p.id] = status;
    // Save the typed answer text so it persists across reloads
    const ansEl  = document.getElementById('sa-ans-'  + idx);
    const unitEl = document.getElementById('sa-unit-' + idx);
    if (ansEl || unitEl) {
      answersById[p.id] = {
        ans:  ansEl  ? ansEl.value  : '',
        unit: unitEl ? unitEl.value : ''
      };
    }
  });
  const lockedIds = [...solveAllLocked].map(idx => solveAllProblems[idx]?.id).filter(Boolean);
  return {
    order: solveAllProblems.map(p => p.id),
    checkedById,
    lockedIds,
    answersById
  };
}

// Applies a server snapshot (already union-merged against the current live
// state via mergeSolveAllSnapshots, js/solve-all-sync.js) onto the live
// maps, re-rendering only the cards whose status actually changed — i.e.
// problems solved on another device that this one hadn't seen yet.
function applySolveAllMerge(serverSnapshot) {
  if (typeof mergeSolveAllSnapshots !== 'function') return;
  const merged = mergeSolveAllSnapshots(buildSolveAllSnapshot(), serverSnapshot);

  solveAllAnswers = { ...solveAllAnswers, ...merged.answersById };
  const lockedIdSet = new Set(merged.lockedIds);

  solveAllProblems.forEach((p, idx) => {
    const newStatus = merged.checkedById[p.id];
    if (!newStatus || newStatus === solveAllChecked.get(idx)) return;

    solveAllChecked.set(idx, newStatus);
    if (lockedIdSet.has(p.id)) solveAllLocked.add(idx);

    // Only touch the DOM if this card has actually been rendered — if not,
    // renderSolveAll's own batch loop will read solveAllChecked at draw
    // time and pick this up correctly on its own.
    const card = document.getElementById('sa-card-' + idx);
    if (!card) return;
    resetCardVisuals(idx);
    restoreSolveAllCard(idx, p, newStatus, solveAllAnswers[p.id]);
    if (newStatus === 'correct' || newStatus === 'revealed') {
      document.getElementById('sa-btnrow-' + idx)?.querySelectorAll('.btn-retry, .btn-see-answer').forEach(el => el.remove());
    }
  });

  updateStickyScore();
  saveSolveAllProgress();
}

// Zeroes the live in-memory progress (and any already-rendered cards) back
// to "nothing solved" — called as the first step of
// handleRemoteSolveAllReset() below whenever a sync discovers this exact
// session was reset on another device. Doesn't touch the screen itself
// (leaving/exiting is the caller's job) — this function only clears state,
// same as it always has, since it's also reused there rather than
// duplicated.
function applySolveAllReset() {
  solveAllProblems.forEach((p, idx) => {
    if (!solveAllChecked.has(idx)) return;
    const card = document.getElementById('sa-card-' + idx);
    if (!card) return;
    resetCardVisuals(idx);
    document.getElementById('sa-btnrow-' + idx)?.querySelectorAll('.btn-retry, .btn-see-answer').forEach(el => el.remove());
    const btn = document.getElementById('sa-check-btn-' + idx);
    if (btn) { btn.textContent = 'Check'; btn.classList.remove('checked'); btn.disabled = false; }
  });
  solveAllChecked = new Map();
  solveAllLocked  = new Set();
  solveAllAnswers = {};
  updateStickyScore();
  saveSolveAllProgress();
}

function loadSolveAllProgress() {
  try {
    const raw = localStorage.getItem(saStorageKey());
    if (!raw) return null;
    return JSON.parse(raw);
  } catch(e) { return null; }
}

function clearSolveAllProgress() {
  localStorage.removeItem(saStorageKey());
}

function openSolveAllModal() {
  const n = ACTIVE_PROBLEMS.length;
  const saved = loadSolveAllProgress();
  // Support both new (checkedById) and old (checked array) storage formats
  const hasSaved = saved && (
    (saved.checkedById && Object.keys(saved.checkedById).length > 0) ||
    (saved.checked && saved.checked.length > 0)
  );
  document.getElementById('solveAllModalDesc').textContent =
    `All ${n} problems will be shown at once. Choose how you'd like them ordered.`;
  document.getElementById('solveAllOrderedLabel').textContent = `1 → ${n}`;
  const progressHint = hasSaved ? 'progress kept' : 'ordered';
  const shuffleHint  = hasSaved ? 'progress kept' : 'random order';
  document.getElementById('solveAllOrderedSub').textContent = progressHint;
  document.getElementById('solveAllShuffledSub').textContent = shuffleHint;
  document.getElementById('solveAllResumeRow').style.display = hasSaved ? '' : 'none';
  fadeInScreen(document.getElementById('choicePage'), 380);
}

function closeSolveAllModal() {
  const choice  = document.getElementById('choicePage');
  const landing = document.getElementById('landingScreen');
  fadeOutScreen(choice, 280, () => fadeInScreen(landing, 380));
}

function startSolveAll(order) {
  // Transition: fade out choice page, fade in app page
  const choicePage = document.getElementById('choicePage');
  fadeOutScreen(choicePage, 280, () => {
    const appPage = document.getElementById('appPage');
    appPage.classList.add('visible');
    _startSolveAllCore(order);
  });
}

function _startSolveAllCore(order) {
  const pool  = [...ACTIVE_PROBLEMS];
  const saved = loadSolveAllProgress();

  if (order === 'resume' && saved && saved.order) {
    // Restore exact saved order
    const idMap = new Map(pool.map(p => [p.id, p]));
    solveAllProblems = saved.order.map(id => idMap.get(id)).filter(Boolean);
    const savedIds = new Set(saved.order);
    pool.forEach(p => { if (!savedIds.has(p.id)) solveAllProblems.push(p); });
  } else {
    // Fresh order (1→N or shuffled)
    solveAllProblems = [...pool];
    if (order === 'unordered') {
      for (let i = solveAllProblems.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [solveAllProblems[i], solveAllProblems[j]] = [solveAllProblems[j], solveAllProblems[i]];
      }
    }
  }

  // Apply saved progress by problem ID (order-independent)
  solveAllChecked = new Map();
  solveAllLocked  = new Set();
  solveAllAnswers = saved && saved.answersById ? { ...saved.answersById } : {};
  if (saved) {
    // Build ID-based maps from whatever format was saved
    const checkedById = saved.checkedById ? { ...saved.checkedById } : {};
    const lockedIdSet = new Set(saved.lockedIds || []);

    // Backward compat: old format stored checked as [[index, status], ...] with order array
    if (!saved.checkedById && saved.checked && saved.order) {
      saved.checked.forEach(([idx, status]) => {
        const id = saved.order[idx];
        if (id) checkedById[id] = status;
      });
      (saved.locked || []).forEach(idx => {
        const id = saved.order[idx];
        if (id) lockedIdSet.add(id);
      });
    }

    solveAllProblems.forEach((p, idx) => {
      if (checkedById[p.id]) solveAllChecked.set(idx, checkedById[p.id]);
      if (lockedIdSet.has(p.id)) solveAllLocked.add(idx);
    });
  }

  // Hide normal quiz UI
  document.querySelector('main').style.display = 'none';
  document.querySelector('.actions').style.display = 'none';
  document.querySelector('.topic-selector-wrap').style.display = 'none';
  document.getElementById('resultPanel').style.display = 'none';
  document.getElementById('recentAttemptsPanel').style.display = 'none';
  document.getElementById('guideMain').style.display = 'none';
  document.querySelector('.quiz-top-row').style.display = 'none';
  document.querySelector('header').style.display = 'none';

  // Show solve-all mode
  const modeEl = document.getElementById('solveAllMode');
  modeEl.classList.add('active');

  renderSolveAll();

  if (typeof startForumProblemCountsPolling === 'function') startForumProblemCountsPolling();

  // Show sticky score
  const sticky = document.getElementById('stickyScore');
  sticky.classList.add('visible');
  updateStickyScore();
  saveSolveAllProgress();

  if (typeof syncSolveAllOnOpen === 'function') {
    syncSolveAllOnOpen(selectedQuizNum, selectedCumulativeMode === 'cumulative');
  }
}

// Just the screen teardown + in-memory state clear — no network call. Split
// out of exitSolveAll() so handleRemoteSolveAllReset() below can reuse it
// without also triggering exitSolveAll's own final push (see that
// function's comment for why pushing right after a reset would be
// counterproductive here).
function _exitSolveAllScreenDom() {
  document.querySelector('main').style.display = '';
  document.querySelector('.actions').style.display = '';
  document.querySelector('.topic-selector-wrap').style.display = '';
  document.getElementById('resultPanel').style.display = '';
  document.getElementById('recentAttemptsPanel').style.display = '';
  document.getElementById('guideMain').style.display = '';
  document.querySelector('.quiz-top-row').style.display = '';
  document.querySelector('header').style.display = '';

  document.getElementById('solveAllMode').classList.remove('active');
  document.getElementById('stickyScore').classList.remove('visible');

  solveAllChecked = new Map();
  solveAllLocked  = new Set();
  solveAllProblems = [];
  solveAllAnswers = {};
  updateStickyScore();
}

function exitSolveAll() {
  if (typeof stopForumProblemCountsPolling === 'function') stopForumProblemCountsPolling();

  // Best-effort final push, catching whatever the last 15s tick missed —
  // must happen before solveAllProblems etc. get cleared below.
  if (typeof stopSolveAllSync === 'function') stopSolveAllSync();
  if (typeof pushSolveAllProgress === 'function' && solveAllProblems.length) {
    pushSolveAllProgress(selectedQuizNum, selectedCumulativeMode === 'cumulative', buildSolveAllSnapshot());
  }

  _exitSolveAllScreenDom();
}

// Called by js/solve-all-sync.js's _saSyncRoundTrip when a sync (on open, on
// the 15s tick, or right after the tab regains focus) discovers this exact
// session was reset on another device. Mirrors resetSolveAll()'s own UX
// exactly — fade out, land back on the choice/order picker — rather than
// applySolveAllReset()'s plain "zero everything in place, stay on this
// screen" behavior, which reads as the screen having quietly turned back
// into a brand-new session instead of communicating "this got reset."
// Deliberately does NOT push afterward the way exitSolveAll() does: the
// server row was JUST set to a tombstone (data:null) specifically so a
// stale device can tell "reset" apart from "never synced" — pushing our
// own (now-emptied) snapshot right back would immediately overwrite that
// tombstone with a real, if empty, row, which isn't needed here since
// nothing new happened locally worth saving.
function handleRemoteSolveAllReset() {
  applySolveAllReset();
  if (typeof stopForumProblemCountsPolling === 'function') stopForumProblemCountsPolling();
  if (typeof stopSolveAllSync === 'function') stopSolveAllSync();

  const appPage = document.getElementById('appPage');
  appPage.classList.add('fading-out');
  setTimeout(() => {
    _exitSolveAllScreenDom();
    appPage.classList.remove('visible', 'fading-out');
    openSolveAllModal();
  }, 280);
}

function resetSolveAll() {
  if (!confirm('Reset all progress? This cannot be undone.')) return;
  clearSolveAllProgress();
  // Fires immediately (not queued for the next periodic push) and as a
  // tombstone rather than a delete, so another device's stale local copy
  // gets told "this was reset" instead of silently resurrecting itself the
  // next time it syncs — see js/solve-all-sync.js.
  if (typeof resetSolveAllProgressOnServer === 'function') {
    resetSolveAllProgressOnServer(selectedQuizNum, selectedCumulativeMode === 'cumulative');
  }
  if (typeof broadcastSolveAllReset === 'function') {
    broadcastSolveAllReset(selectedQuizNum, selectedCumulativeMode === 'cumulative');
  }
  // Same fade-out-then-swap pattern as goToMainMenu: appPage (the quiz
  // screen underneath solve-all) must actually be hidden before the order
  // selector shows, or its filter panel/buttons are left visible behind it.
  const appPage = document.getElementById('appPage');
  appPage.classList.add('fading-out');
  setTimeout(() => {
    exitSolveAll();
    appPage.classList.remove('visible', 'fading-out');
    openSolveAllModal();
  }, 280);
}

// solveAllChecked: index -> 'correct' | 'partial' | 'wrong' | 'revealed'
// solveAllLocked:  Set of indices permanently locked (answer was revealed)

function renderSolveAll() {
  const container = document.getElementById('solveAllContainer');
  const screen = document.getElementById('solveAllLoadingScreen');
  const subEl  = document.getElementById('solveAllLoadingSub');

  // Make sure the persistent render cache (see math-cache.js) has finished
  // loading from IndexedDB before we check it per-card below — on a normal
  // page load this resolves almost immediately since it's kicked off as
  // soon as math-cache.js runs, so this is usually a no-op wait.
  initMathCache().then(() => {
    // Only show the "first time takes longer" hint when it's actually true
    // for this batch — a fully-cached repeat visit shouldn't imply a wait
    // that isn't coming.
    if (subEl) {
      const hasUncached = solveAllProblems.some(p => getCachedMathHTML(mathCacheKeyFor(p), p.text) === null);
      subEl.classList.toggle('show', hasUncached);
    }
    runWithLoadingScreen(screen, container, () => buildSolveAllCards(container), cacheTypesetBatch)
      .then(persistMathCacheStyles);
  });
}

// Manual "Rerender Equations" action: forces every problem in the current
// Solve-All set to be re-typeset from scratch, discarding (and then
// replacing) whatever's in the persistent render cache for them. This is
// a lighter fix than clearing the whole cache — it only touches the set
// that's actually on screen — and reuses the exact same loading-screen /
// chunked-typesetting pipeline as a normal open, so the familiar loading
// bar plays and answered/checked progress is restored afterward exactly
// as it is on any other rebuild (see buildSolveAllCards).
function rerenderSolveAllEquations() {
  const btn = document.querySelector('.btn-rerender-eqs');
  if (btn) btn.disabled = true;

  initMathCache().then(() => {
    for (const p of solveAllProblems) deleteCachedMathHTML(mathCacheKeyFor(p));

    const container = document.getElementById('solveAllContainer');
    const screen = document.getElementById('solveAllLoadingScreen');
    const subEl  = document.getElementById('solveAllLoadingSub');
    // Every card is a guaranteed cache miss now, so this pass always
    // re-typesets the full set — show the "first time" hint accordingly.
    if (subEl) subEl.classList.add('show');

    runWithLoadingScreen(screen, container, () => buildSolveAllCards(container), cacheTypesetBatch)
      .then(persistMathCacheStyles)
      .finally(() => { if (btn) btn.disabled = false; });
  });
}

// Called after each batch of cards actually gets typeset by MathJax (i.e.
// excluding cards restored from cache). Captures the fresh output so the
// next time solve-all is opened — even after a reload — these same cards
// can skip MathJax entirely.
function cacheTypesetBatch(batch) {
  for (const card of batch) {
    const idx = card.id.replace('sa-card-', '');
    const p = solveAllProblems[idx];
    if (!p) continue;
    const textEl = card.querySelector('.problem-text');
    if (!textEl) continue;
    storeCachedMathHTML(mathCacheKeyFor(p), mathCacheHashOf(p.text), textEl.innerHTML);
  }
}

// Builds solve-all cards in small batches, yielding a frame between
// each — a plain forEach over 100+ cards is fast in absolute terms but
// still blocks the main thread long enough to freeze the loading
// animation (see runWithLoadingScreen in math-render.js for why that
// matters). Returns a promise so the caller can wait for it to finish.
function buildSolveAllCards(container, batchSize = 12) {
  container.innerHTML = '';

  return new Promise((resolve, reject) => {
    let i = 0;

    function step() {
      try {
        const frag = document.createDocumentFragment();
        const end = Math.min(i + batchSize, solveAllProblems.length);
        const batchStart = i;

        for (; i < end; i++) {
          const p = solveAllProblems[i];
          const card = document.createElement('div');
          card.className = 'problem-card';
          card.id = 'sa-card-' + i;

          // If this exact problem text was already typeset in a previous
          // visit, reuse that HTML directly and skip MathJax for this card
          // entirely (see math-cache.js). A 'mj-cached' card whose text
          // hasn't changed since caching needs no re-typesetting; if the
          // text has changed, getCachedMathHTML returns null and we fall
          // back to the normal raw-text path below.
          const cachedText = getCachedMathHTML(mathCacheKeyFor(p), p.text);
          if (cachedText !== null) card.classList.add('mj-cached');

          card.innerHTML = `
            <div class="card-header">
              <span class="problem-num">${p.id}</span>
              <span class="problem-topic">${p.topic}</span>
            </div>
            <div class="problem-text">${cachedText !== null ? cachedText : p.text}</div>
            <div class="answer-row">
              <span class="answer-label">Value =</span>
              <input class="answer-input" id="sa-ans-${i}" type="text" placeholder="e.g. 3.2e-8" autocomplete="off" spellcheck="false">
              <span class="sep">·</span>
              <input class="unit-input" id="sa-unit-${i}" type="text" placeholder="e.g. N/C" autocomplete="off" spellcheck="false">
            </div>
            <div class="feedback" id="sa-fb-${i}"></div>
            <div class="card-check-row" id="sa-btnrow-${i}">
              <button class="forum-problem-btn" id="sa-forum-btn-${i}" title="Forum thread for ${p.id}"
                onclick="openForumForProblem(${p._quizNum || selectedQuizNum}, '${p.id}')">
                💬 <span id="sa-forum-total-${i}"></span>
                <span class="forum-problem-btn-badge" id="sa-forum-badge-${i}" style="display:none;"></span>
                <span class="forum-problem-btn-at" id="sa-forum-at-${i}" style="display:none;">@</span>
              </button>
              <button class="check-problem-btn" id="sa-check-btn-${i}" onclick="checkSingleProblem(${i})">Check</button>
            </div>
          `;

          frag.appendChild(card);

          // `i` is declared once, outside this for-loop, and shared across
          // the whole step() (it's how the function tracks progress across
          // requestAnimationFrame batches) — so a listener closing over it
          // directly would see whatever `i` has advanced to by the time
          // Enter is actually pressed, not this card's own index. Capture
          // it per-iteration so each card's listener checks itself.
          const idx = i;
          card.querySelector(`#sa-ans-${i}`).addEventListener('keydown', e => {
            if (e.key === 'Enter') { e.preventDefault(); document.getElementById(`sa-unit-${idx}`).focus(); }
          });
          card.querySelector(`#sa-unit-${i}`).addEventListener('keydown', e => {
            if (e.key === 'Enter') { e.preventDefault(); checkSingleProblem(idx); }
          });
        }

        // Attach this batch to the live DOM *before* restoring any saved
        // state below — restoreSolveAllCard looks elements up by ID via
        // document.getElementById, which only finds nodes that are
        // actually in the document (not ones still sitting in a fragment).
        container.appendChild(frag);

        for (let j = batchStart; j < end; j++) {
          const p = solveAllProblems[j];
          const status = solveAllChecked.get(j);
          if (status) restoreSolveAllCard(j, p, status, solveAllAnswers[p.id]);
        }

        if (i < solveAllProblems.length) {
          requestAnimationFrame(step);
        } else {
          resolve();
        }
      } catch (err) {
        reject(err);
      }
    }

    requestAnimationFrame(step);
  });
}

function restoreSolveAllCard(i, p, status, savedAnswer) {
  const card   = document.getElementById('sa-card-' + i);
  const ansEl  = document.getElementById('sa-ans-' + i);
  const unitEl = document.getElementById('sa-unit-' + i);
  const fb     = document.getElementById('sa-fb-' + i);
  const btn    = document.getElementById('sa-check-btn-' + i);
  const btnRow = document.getElementById('sa-btnrow-' + i);

  fb.classList.add('show');

  if (status === 'correct') {
    card.classList.add('correct');
    // Restore typed answer; fall back to correct answer if missing
    ansEl.value  = savedAnswer ? savedAnswer.ans  : fmt(p.answer);
    unitEl.value = savedAnswer ? savedAnswer.unit : fmtUnit(p.units);
    ansEl.disabled = unitEl.disabled = true;
    ansEl.classList.add('correct-input');
    unitEl.classList.add('correct-unit');
    fb.classList.add('correct-fb');
    fb.innerHTML = `✓ Correct <span class="pts-badge pts-full">+1 pt</span>`;
    btn.textContent = '✓ Correct'; btn.classList.add('checked'); btn.disabled = true;

  } else if (status === 'partial') {
    card.classList.add('partial');
    ansEl.value  = savedAnswer ? savedAnswer.ans  : '';
    unitEl.value = savedAnswer ? savedAnswer.unit : '';
    ansEl.disabled = unitEl.disabled = false;
    ansEl.classList.add('correct-input');
    unitEl.classList.add('partial-unit');
    fb.classList.add('partial-fb');
    fb.innerHTML = `✓ Value correct, but unit needs fixing <span class="pts-badge pts-partial">+0.9 pt</span>`;
    btn.textContent = '↺ Try again'; btn.disabled = false;
    if (!btnRow.querySelector('.btn-see-answer')) {
      const seeBtn = document.createElement('button');
      seeBtn.className = 'btn-see-answer'; seeBtn.textContent = 'See correct answer';
      seeBtn.onclick = () => revealAnswer(i);
      btnRow.insertBefore(seeBtn, btn);
    }

  } else if (status === 'wrong') {
    card.classList.add('wrong');
    ansEl.value  = savedAnswer ? savedAnswer.ans  : '';
    unitEl.value = savedAnswer ? savedAnswer.unit : '';
    ansEl.disabled = unitEl.disabled = false;
    ansEl.classList.add('wrong-input');
    unitEl.classList.add('wrong-unit');
    fb.classList.add('wrong-fb');
    fb.innerHTML = `✗ Wrong answer <span class="pts-badge pts-zero">+0 pt</span>`;
    btn.textContent = '↺ Try again'; btn.disabled = false;
    if (!btnRow.querySelector('.btn-see-answer')) {
      const seeBtn = document.createElement('button');
      seeBtn.className = 'btn-see-answer'; seeBtn.textContent = 'See correct answer';
      seeBtn.onclick = () => revealAnswer(i);
      btnRow.insertBefore(seeBtn, btn);
    }

  } else if (status === 'revealed') {
    card.classList.add('wrong');
    ansEl.value = fmt(p.answer); unitEl.value = fmtUnit(p.units);
    ansEl.disabled = unitEl.disabled = true;
    ansEl.classList.add('wrong-input'); unitEl.classList.add('wrong-unit');
    fb.classList.add('wrong-fb');
    fb.innerHTML = `👁 Answer revealed — no points awarded <span class="pts-badge pts-zero">+0 pt</span>`;
    btn.textContent = '✗ Revealed'; btn.classList.add('checked'); btn.disabled = true;
  }
}

function resetCardVisuals(i) {
  const card   = document.getElementById('sa-card-' + i);
  const ansEl  = document.getElementById('sa-ans-' + i);
  const unitEl = document.getElementById('sa-unit-' + i);
  const fb     = document.getElementById('sa-fb-' + i);

  card.classList.remove('correct', 'partial', 'wrong');
  ansEl.classList.remove('correct-input', 'partial-input', 'wrong-input');
  unitEl.classList.remove('correct-unit', 'partial-unit', 'wrong-unit');
  fb.classList.remove('show', 'correct-fb', 'partial-fb', 'wrong-fb');
  fb.innerHTML = '';
  ansEl.disabled  = false;
  unitEl.disabled = false;
  ansEl.value  = '';
  unitEl.value = '';
}

function checkSingleProblem(i) {
  // Permanently locked (answer was revealed)
  if (solveAllLocked.has(i)) return;

  const p      = solveAllProblems[i];
  const card   = document.getElementById('sa-card-' + i);
  const ansEl  = document.getElementById('sa-ans-' + i);
  const unitEl = document.getElementById('sa-unit-' + i);
  const fb     = document.getElementById('sa-fb-' + i);
  const btn    = document.getElementById('sa-check-btn-' + i);
  const btnRow = document.getElementById('sa-btnrow-' + i);

  const numOk  = numberCorrect(ansEl.value, p.answer, unitConversionFactor(unitEl.value, p.units));
  const uStat  = unitStatus(unitEl.value, p.units);
  const unitOk = uStat === 'ok';
  const pts    = numOk ? (unitOk ? 1 : 0.9) : 0;

  // Reset previous styling before re-applying
  card.classList.remove('correct', 'partial', 'wrong');
  ansEl.classList.remove('correct-input', 'partial-input', 'wrong-input');
  unitEl.classList.remove('correct-unit', 'partial-unit', 'wrong-unit');
  fb.classList.remove('correct-fb', 'partial-fb', 'wrong-fb');

  // Disable inputs while showing result
  ansEl.disabled  = true;
  unitEl.disabled = true;

  // Style inputs
  ansEl.classList.add(numOk ? 'correct-input' : 'wrong-input');
  if (numOk) {
    unitEl.classList.add(unitOk ? 'correct-unit' : 'partial-unit');
  } else {
    unitEl.classList.add('wrong-unit');
  }

  // Card border
  if      (pts === 1)   card.classList.add('correct');
  else if (pts === 0.9) card.classList.add('partial');
  else                  card.classList.add('wrong');

  // Feedback + build button row
  fb.classList.add('show');

  if (pts === 1) {
    // ── Correct: lock permanently ──────────────────────────────────────────
    fb.classList.add('correct-fb');
    fb.innerHTML = `✓ Correct <span class="pts-badge pts-full">+1 pt</span>`;

    solveAllChecked.set(i, 'correct');
    solveAllLocked.add(i);

    btn.textContent = '✓ Correct';
    btn.classList.add('checked');
    btn.disabled = true;
    // Remove any old retry/see-answer buttons
    btnRow.querySelectorAll('.btn-retry, .btn-see-answer').forEach(el => el.remove());

  } else {
    // ── Wrong or partial: allow retry ──────────────────────────────────────
    const resultType = pts === 0.9 ? 'partial' : 'wrong';
    solveAllChecked.set(i, resultType);

    if (pts === 0.9) {
      fb.classList.add('partial-fb');
      const unitHint = uStat === 'invalid'
        ? `unit format invalid — use spaces to multiply, e.g. <strong>${fmtUnit(p.units)}</strong>`
        : `unit should be <strong>${fmtUnit(p.units)}</strong>`;
      fb.innerHTML = `✓ Value correct, but ${unitHint} <span class="pts-badge pts-partial">+0.9 pt</span>`;
    } else {
      fb.classList.add('wrong-fb');
      fb.innerHTML = `✗ Wrong answer <span class="pts-badge pts-zero">+0 pt</span>`;
    }

    // Update check button label but keep it active for retry
    btn.textContent = '↺ Try again';
    btn.classList.remove('checked');
    btn.disabled = false;
    // Re-enable inputs for retry
    ansEl.disabled  = false;
    unitEl.disabled = false;

    // Add "See correct answer" button if not already there
    if (!btnRow.querySelector('.btn-see-answer')) {
      const seeBtn = document.createElement('button');
      seeBtn.className = 'btn-see-answer';
      seeBtn.textContent = 'See correct answer';
      seeBtn.onclick = () => revealAnswer(i);
      btnRow.insertBefore(seeBtn, btn);
    }
  }

  updateStickyScore();
  saveSolveAllProgress();
  if (typeof broadcastSolveAllChange === 'function') broadcastSolveAllChange();
}

function revealAnswer(i) {
  const p      = solveAllProblems[i];
  const card   = document.getElementById('sa-card-' + i);
  const ansEl  = document.getElementById('sa-ans-' + i);
  const unitEl = document.getElementById('sa-unit-' + i);
  const fb     = document.getElementById('sa-fb-' + i);
  const btn    = document.getElementById('sa-check-btn-' + i);
  const btnRow = document.getElementById('sa-btnrow-' + i);

  // Lock permanently
  solveAllLocked.add(i);
  solveAllChecked.set(i, 'revealed');

  // Show the answer in the fields
  ansEl.value    = fmt(p.answer);
  unitEl.value   = fmtUnit(p.units);
  ansEl.disabled  = true;
  unitEl.disabled = true;

  // Style as revealed (use wrong colour to mark it wasn't solved)
  card.classList.remove('correct', 'partial', 'wrong');
  card.classList.add('wrong');
  ansEl.classList.remove('correct-input', 'partial-input', 'wrong-input');
  ansEl.classList.add('wrong-input');
  unitEl.classList.remove('correct-unit', 'partial-unit', 'wrong-unit');
  unitEl.classList.add('wrong-unit');

  // Feedback
  fb.classList.remove('correct-fb', 'partial-fb', 'wrong-fb');
  fb.classList.add('show', 'wrong-fb');
  fb.innerHTML = `👁 Answer revealed — no points awarded <span class="pts-badge pts-zero">+0 pt</span>`;

  // Lock check button
  btn.textContent = '✗ Revealed';
  btn.classList.add('checked');
  btn.disabled = true;

  // Remove see-answer button
  btnRow.querySelectorAll('.btn-retry, .btn-see-answer').forEach(el => el.remove());

  updateStickyScore();
  saveSolveAllProgress();
  if (typeof broadcastSolveAllChange === 'function') broadcastSolveAllChange();
}

function updateStickyScore() {
  const total = solveAllProblems.length;
  const done  = solveAllChecked.size;
  let nCorrect = 0, nPartial = 0, nWrong = 0;
  for (const v of solveAllChecked.values()) {
    if      (v === 'correct')               nCorrect++;
    else if (v === 'partial')               nPartial++;
    else  /* 'wrong' | 'revealed' */        nWrong++;
  }
  document.getElementById('stickyNum').textContent     = done;
  document.getElementById('stickyDen').textContent     = total;
  document.getElementById('stickyCorrect').textContent = nCorrect;
  document.getElementById('stickyPartial').textContent = nPartial;
  document.getElementById('stickyWrong').textContent   = nWrong;

  // Show retry-mistakes button only when there are mistakes
  const retryBtn = document.getElementById('stickyRetryBtn');
  retryBtn.classList.toggle('visible', nWrong > 0);
  if (nWrong > 0) retryBtn.textContent = `📋 Quiz: wrong problems (${nWrong})`;
}

// ─── Mistakes quiz mode ───────────────────────────────────────────────────────
let mistakesProblems  = [];
let mistakesChecked   = new Map();
let mistakesLocked    = new Set();

function getMistakeProblems() {
  // Collect problems that are wrong or revealed from the solve-all session
  const bad = [];
  for (const [idx, status] of solveAllChecked.entries()) {
    if (status === 'wrong' || status === 'revealed' || status === 'partial') {
      bad.push(solveAllProblems[idx]);
    }
  }
  return bad;
}

function openMistakesModal() {
  const bad = getMistakeProblems();
  document.getElementById('mistakesModalDesc').textContent =
    `You have ${bad.length} problem${bad.length !== 1 ? 's' : ''} to retry. Choose order.`;
  document.getElementById('mistakesModal').classList.add('open');
}

function closeMistakesModal() {
  document.getElementById('mistakesModal').classList.remove('open');
}

function startMistakes(order) {
  closeMistakesModal();

  mistakesProblems = getMistakeProblems();
  if (order === 'unordered') {
    for (let i = mistakesProblems.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [mistakesProblems[i], mistakesProblems[j]] = [mistakesProblems[j], mistakesProblems[i]];
    }
  }
  mistakesChecked = new Map();
  mistakesLocked  = new Set();

  // Hide solve-all mode, keep sticky score hidden
  document.getElementById('solveAllMode').style.display = 'none';
  document.getElementById('stickyScore').classList.remove('visible');

  // Show mistakes mode
  document.getElementById('mistakesMode').classList.add('active');

  renderMistakes();
}

function exitMistakes() {
  document.getElementById('mistakesMode').classList.remove('active');
  document.getElementById('mistakesMode').querySelector('#mistakesContainer').innerHTML = '';

  // Restore solve-all mode
  document.getElementById('solveAllMode').style.display = '';
  document.getElementById('stickyScore').classList.add('visible');

  mistakesProblems = [];
  mistakesChecked  = new Map();
  mistakesLocked   = new Set();
}

function renderMistakes() {
  const container = document.getElementById('mistakesContainer');
  container.innerHTML = '';

  mistakesProblems.forEach((p, i) => {
    const card = document.createElement('div');
    card.className = 'problem-card';
    card.id = 'mk-card-' + i;

    card.innerHTML = `
      <div class="card-header">
        <span class="problem-num">${p.id}</span>
        <span class="problem-topic">${p.topic}</span>
      </div>
      <div class="problem-text">${p.text}</div>
      <div class="answer-row">
        <span class="answer-label">Value =</span>
        <input class="answer-input" id="mk-ans-${i}" type="text" placeholder="e.g. 3.2e-8" autocomplete="off" spellcheck="false">
        <span class="sep">·</span>
        <input class="unit-input" id="mk-unit-${i}" type="text" placeholder="e.g. N/C" autocomplete="off" spellcheck="false">
      </div>
      <div class="feedback" id="mk-fb-${i}"></div>
      <div class="card-check-row" id="mk-btnrow-${i}">
        <button class="check-problem-btn" id="mk-check-btn-${i}" onclick="checkMistakeProblem(${i})">Check</button>
      </div>
    `;

    container.appendChild(card);

    card.querySelector(`#mk-ans-${i}`).addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); document.getElementById(`mk-unit-${i}`).focus(); }
    });
    card.querySelector(`#mk-unit-${i}`).addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); checkMistakeProblem(i); }
    });
  });
  renderMathIn(container);
}

function checkMistakeProblem(i) {
  if (mistakesLocked.has(i)) return;

  const p      = mistakesProblems[i];
  const card   = document.getElementById('mk-card-' + i);
  const ansEl  = document.getElementById('mk-ans-' + i);
  const unitEl = document.getElementById('mk-unit-' + i);
  const fb     = document.getElementById('mk-fb-' + i);
  const btn    = document.getElementById('mk-check-btn-' + i);
  const btnRow = document.getElementById('mk-btnrow-' + i);

  const numOk  = numberCorrect(ansEl.value, p.answer, unitConversionFactor(unitEl.value, p.units));
  const uStat  = unitStatus(unitEl.value, p.units);
  const unitOk = uStat === 'ok';
  const pts    = numOk ? (unitOk ? 1 : 0.9) : 0;

  card.classList.remove('correct', 'partial', 'wrong');
  ansEl.classList.remove('correct-input', 'partial-input', 'wrong-input');
  unitEl.classList.remove('correct-unit', 'partial-unit', 'wrong-unit');
  fb.classList.remove('correct-fb', 'partial-fb', 'wrong-fb');

  ansEl.disabled  = true;
  unitEl.disabled = true;

  ansEl.classList.add(numOk ? 'correct-input' : 'wrong-input');
  if (numOk) {
    unitEl.classList.add(unitOk ? 'correct-unit' : 'partial-unit');
  } else {
    unitEl.classList.add('wrong-unit');
  }

  if      (pts === 1)   card.classList.add('correct');
  else if (pts === 0.9) card.classList.add('partial');
  else                  card.classList.add('wrong');

  fb.classList.add('show');

  if (pts === 1) {
    fb.classList.add('correct-fb');
    fb.innerHTML = `✓ Correct <span class="pts-badge pts-full">+1 pt</span>`;

    mistakesChecked.set(i, 'correct');
    mistakesLocked.add(i);

    btn.textContent = '✓ Correct';
    btn.classList.add('checked');
    btn.disabled = true;
    btnRow.querySelectorAll('.btn-see-answer').forEach(el => el.remove());

  } else {
    const resultType = pts === 0.9 ? 'partial' : 'wrong';
    mistakesChecked.set(i, resultType);

    if (pts === 0.9) {
      fb.classList.add('partial-fb');
      const unitHint = uStat === 'invalid'
        ? `unit format invalid — use spaces to multiply, e.g. <strong>${fmtUnit(p.units)}</strong>`
        : `unit should be <strong>${fmtUnit(p.units)}</strong>`;
      fb.innerHTML = `✓ Value correct, but ${unitHint} <span class="pts-badge pts-partial">+0.9 pt</span>`;
    } else {
      fb.classList.add('wrong-fb');
      fb.innerHTML = `✗ Wrong answer <span class="pts-badge pts-zero">+0 pt</span>`;
    }

    btn.textContent = '↺ Try again';
    btn.classList.remove('checked');
    btn.disabled = false;
    ansEl.disabled  = false;
    unitEl.disabled = false;

    if (!btnRow.querySelector('.btn-see-answer')) {
      const seeBtn = document.createElement('button');
      seeBtn.className = 'btn-see-answer';
      seeBtn.textContent = 'See correct answer';
      seeBtn.onclick = () => revealMistakeAnswer(i);
      btnRow.insertBefore(seeBtn, btn);
    }
  }
}

function revealMistakeAnswer(i) {
  const p      = mistakesProblems[i];
  const card   = document.getElementById('mk-card-' + i);
  const ansEl  = document.getElementById('mk-ans-' + i);
  const unitEl = document.getElementById('mk-unit-' + i);
  const fb     = document.getElementById('mk-fb-' + i);
  const btn    = document.getElementById('mk-check-btn-' + i);
  const btnRow = document.getElementById('mk-btnrow-' + i);

  mistakesLocked.add(i);
  mistakesChecked.set(i, 'revealed');

  ansEl.value    = fmt(p.answer);
  unitEl.value   = fmtUnit(p.units);
  ansEl.disabled  = true;
  unitEl.disabled = true;

  card.classList.remove('correct', 'partial', 'wrong');
  card.classList.add('wrong');
  ansEl.classList.remove('correct-input', 'partial-input', 'wrong-input');
  ansEl.classList.add('wrong-input');
  unitEl.classList.remove('correct-unit', 'partial-unit', 'wrong-unit');
  unitEl.classList.add('wrong-unit');

  fb.classList.remove('correct-fb', 'partial-fb', 'wrong-fb');
  fb.classList.add('show', 'wrong-fb');
  fb.innerHTML = `👁 Answer revealed — no points awarded <span class="pts-badge pts-zero">+0 pt</span>`;

  btn.textContent = '✗ Revealed';
  btn.classList.add('checked');
  btn.disabled = true;

  btnRow.querySelectorAll('.btn-see-answer').forEach(el => el.remove());
}

// ─── Theme toggle ─────────────────────────────────────────────────────────────
function toggleTheme() {
  if (window.themeFadeTick) themeFadeTick();
  const isLight = document.body.classList.toggle('light');
  document.getElementById('themeTrack').classList.toggle('on', isLight);
  localStorage.setItem(STORAGE_PREFIX + '-theme', isLight ? 'light' : 'dark');
  if (window.__applyCustomOnModeChange) window.__applyCustomOnModeChange();
  // Day/night also flips --accent/--correct/--partial/--wrong for preset
  // themes (not just custom, which __applyCustomOnModeChange already
  // covers above) — recompute text-on-color contrast either way.
  if (window.__updateOnColorVars) window.__updateOnColorVars();
  if (window.__onModeChanged) window.__onModeChanged();
}

// Restore saved preference
(function () {
  if (localStorage.getItem(STORAGE_PREFIX + '-theme') === 'light') {
    document.body.classList.add('light');
    document.getElementById('themeTrack').classList.add('on');
  }
  if (window.__applyCustomOnModeChange) window.__applyCustomOnModeChange();
  if (window.__updateOnColorVars) window.__updateOnColorVars();
})();

// ─── Guide hint toggle (reusable for main quiz + solve-all mode) ──────────────
// Hidden by default (see .is-collapsed in the markup) — no auto-hide timer;
// the hint stays exactly as the user left it until they click to toggle it.
function createHintGuide(guideEl, recallWrapEl) {
  function hide() {
    guideEl.classList.add('is-collapsed');
    recallWrapEl.classList.add('visible');
  }

  function show() {
    guideEl.classList.remove('is-collapsed');
    recallWrapEl.classList.remove('visible');
  }

  return { hide, show };
}

const mainHintGuide = createHintGuide(
  document.getElementById('guideMain'),
  document.getElementById('hintRecallWrap')
);
const solveHintGuide = createHintGuide(
  document.getElementById('guideSolve'),
  document.getElementById('hintRecallWrapSolve')
);

window.hideGuideManual      = () => mainHintGuide.hide();
window.showGuide            = () => mainHintGuide.show();
window.hideGuideManualSolve = () => solveHintGuide.hide();
window.showGuideSolve       = () => solveHintGuide.show();

// ─── Landing screen ───────────────────────────────────────────────────────────
function renderQuizButtons() {
  const grid = document.getElementById('quizSelectGrid');
  grid.innerHTML = '';
  QUIZZES.forEach((q, idx) => {
    const n = idx + 1;
    const btn = document.createElement('div');
    btn.id = 'quizBtn' + n;
    btn.className = 'quiz-select-btn' +
      (n === selectedQuizNum ? ' selected' : '') +
      (!q.enabled ? ' disabled' : '');
    btn.onclick = () => selectQuiz(n);
    btn.innerHTML = `Quiz #${n}<span class="quiz-select-name">${
      q.enabled ? q.name : 'Coming soon'
    }</span>`;
    grid.appendChild(btn);
  });
}

function toggleCumulativeMode() {
  selectedCumulativeMode = (selectedCumulativeMode === 'single') ? 'cumulative' : 'single';
  document.getElementById('cumulativeToggle').classList.toggle('on', selectedCumulativeMode === 'cumulative');
  document.getElementById('cumLabelSingle').classList.toggle('active', selectedCumulativeMode === 'single');
  document.getElementById('cumLabelCumulative').classList.toggle('active', selectedCumulativeMode === 'cumulative');

  // Cumulative is incompatible with solve-all — switch back to Random 6
  if (selectedCumulativeMode === 'cumulative' && selectedMode === 'solveall') {
    selectedMode = 'quiz';
    document.getElementById('modeToggle').classList.remove('on');
    document.getElementById('modeLabelQuiz').classList.add('active');
    document.getElementById('modeLabelSolveAll').classList.remove('active');
  }
}

function selectQuiz(n) {
  const q = QUIZZES[n - 1];
  if (!q.enabled) return; // disabled / not yet available

  selectedQuizNum = n;
  ACTIVE_PROBLEMS = q.problems;

  // Update button styling
  for (let i = 1; i <= QUIZZES.length; i++) {
    const btn = document.getElementById('quizBtn' + i);
    if (btn) btn.classList.toggle('selected', i === n);
  }

  // Show/hide cumulative switch (only for quiz 2+)
  const cWrap = document.getElementById('cumulativeSwitchWrap');
  if (cWrap) cWrap.classList.toggle('visible', n >= 2);

  // Reset cumulative mode to single when switching to quiz 1
  if (n === 1 && selectedCumulativeMode === 'cumulative') {
    selectedCumulativeMode = 'single';
    document.getElementById('cumulativeToggle').classList.remove('on');
    document.getElementById('cumLabelSingle').classList.add('active');
    document.getElementById('cumLabelCumulative').classList.remove('active');
  }

  // Update titles to reflect the chosen quiz's exam name — all three
  // title locations (landing page, Practice-mode header, Solve-All
  // header) are separate DOM elements and each needs setting explicitly.
  // The old `document.querySelector('header h1')` only ever reached the
  // Practice-mode one (first <header> in document order); the Solve-All
  // header was silently never updated at all, regardless of which quiz
  // was selected.
  const titleHtml = `${q.name} <span>Quiz</span>`;
  document.getElementById('landingTitle').innerHTML = titleHtml;
  const quizHeaderH1 = document.querySelector('#quizHeader h1');
  if (quizHeaderH1) quizHeaderH1.innerHTML = titleHtml;
  const solveAllHeaderH1 = document.querySelector('#solveAllHeader h1');
  if (solveAllHeaderH1) solveAllHeaderH1.innerHTML = titleHtml;
}

function toggleMode() {
  selectedMode = (selectedMode === 'quiz') ? 'solveall' : 'quiz';
  document.getElementById('modeToggle').classList.toggle('on', selectedMode === 'solveall');
  document.getElementById('modeLabelQuiz').classList.toggle('active', selectedMode === 'quiz');
  document.getElementById('modeLabelSolveAll').classList.toggle('active', selectedMode === 'solveall');

  // Solve-all is incompatible with cumulative — turn it off
  if (selectedMode === 'solveall' && selectedCumulativeMode === 'cumulative') {
    selectedCumulativeMode = 'single';
    document.getElementById('cumulativeToggle').classList.remove('on');
    document.getElementById('cumLabelSingle').classList.add('active');
    document.getElementById('cumLabelCumulative').classList.remove('active');
  }
}

// ─── Screen scroll helpers ───────────────────────────────────────────────────
// Full-screen views are normal in-flow pages, so hiding one while the window
// is scrolled leaves window.scrollY unchanged. When the replacement view is
// shown, that old offset can therefore land the user halfway down the new
// page. Keep the host page's exact position and explicitly start replacement
// views at the top.
function captureScreenScroll() {
  return window.scrollY || window.pageYOffset || 0;
}

function scrollScreenToTop() {
  window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
}

function restoreScreenScroll(y) {
  const top = Number.isFinite(y) ? y : 0;
  // Wait until the restored screen is back in flow so the browser has a real
  // document height to scroll against. Two frames also covers browsers that
  // defer layout after a display/class change.
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      window.scrollTo({ top, left: 0, behavior: 'auto' });
    });
  });
}

// ─── Screen transition helpers ────────────────────────────────────────────────
function fadeOutScreen(el, duration, callback) {
  if (!el || el.classList.contains('hidden')) { if (callback) callback(); return; }
  el.classList.add('fading-out');
  setTimeout(() => {
    el.classList.remove('fading-out');
    el.classList.add('hidden');
    if (callback) callback();
  }, duration);
}

function fadeInScreen(el, duration) {
  el.classList.remove('hidden', 'fading-out');
  el.style.opacity    = '0';
  el.style.transition = '';
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      el.style.transition = `opacity ${duration}ms ease`;
      el.style.opacity    = '1';
      setTimeout(() => { el.style.transition = ''; el.style.opacity = ''; }, duration + 20);
    });
  });
}

// Quiz attempts now sync to a claimed forum identity (js/attempts-sync.js),
// so starting a quiz needs one to exist first — same identity system the
// forum already uses (js/forum.js), not a separate account system. A
// device that's never claimed a name sees the "Getting Started!" screen
// first (js/forum.js openGettingStartedModal — what a nickname is, why
// it's needed, an FAQ), and only after tapping through that gets the
// claim modal itself, in its 'create' mode. startSelected() only actually
// proceeds once a name is resolved (or immediately, if one's already
// claimed on this device).
function startSelected() {
  if (typeof getForumNickname === 'function' && !getForumNickname()) {
    openGettingStartedModal(() => openForumClaimModal('create', '', () => startSelected()));
    return;
  }
  const landing = document.getElementById('landingScreen');
  fadeOutScreen(landing, 300, () => {
    if (selectedMode === 'solveall') {
      // appPage may still be visible from a previous mode (Random 6,
      // Mistakes) or a previous solve-all session — same reasoning as
      // resetSolveAll()/handleRemoteSolveAllReset() above. #choicePage is
      // position:fixed now (see its CSS), so this is defense in depth
      // rather than the only thing preventing the picker from landing
      // off-screen, but there's no reason to leave a mismatched .visible
      // page sitting underneath it either.
      const appPage = document.getElementById('appPage');
      appPage.classList.remove('visible', 'fading-out');
      openSolveAllModal();
    } else {
      const appPage = document.getElementById('appPage');
      appPage.classList.add('visible');
      initTopics();
      newQuiz();
    }
  });
}

function goToMainMenu() {
  // Forum and Stats screens used to only ever be opened from the landing
  // screen, so if either was open, closing it *was* going to the main menu —
  // nothing else could be active underneath it. That's no longer quite true
  // for the Forum: the floating Forum button (forum.js) can now open it from
  // mid-quiz (Solve-all/Mistakes) or Stats too, hiding that screen instead of
  // landing. Tapping the main-menu logo while the Forum is open should still
  // always land you back on the landing screen either way — a distinct, more
  // explicit "take me all the way home" than the Forum's own ✕ Close button,
  // which instead returns to wherever it was actually opened from — so this
  // passes `true` ("force landing") rather than just closing it plainly.
  const forum = document.getElementById('forumScreen');
  if (forum && forum.classList.contains('visible')) {
    closeForumScreen(true);
    return;
  }

  const stats = document.getElementById('statsScreen');
  if (stats.classList.contains('visible')) {
    closeStatsScreen();
    return;
  }

  const manual = document.getElementById('manualScreen');
  if (manual && manual.classList.contains('visible')) {
    closeManualScreen(true);
    return;
  }

  exitAppOrChoiceToLanding();
}

// Hides whichever of appPage/choicePage is currently showing (exiting
// solve-all/mistakes mode first if needed) and fades the landing screen back
// in. Pulled out of goToMainMenu() as its own function so forum.js can reuse
// it too: closing the Forum via the main-menu logo (rather than its own ✕
// button) after it was opened mid-quiz by the floating Forum button needs
// this exact same cleanup — not just "hide forum, reveal landing" — or
// solve-all/mistakes state would be left stale for next time.
function exitAppOrChoiceToLanding() {
  const appPage   = document.getElementById('appPage');
  const choice    = document.getElementById('choicePage');
  const landing   = document.getElementById('landingScreen');

  // Determine which screen is currently visible and fade it out
  const fromApp    = appPage.classList.contains('visible');
  const fromChoice = !choice.classList.contains('hidden');

  function showLanding() {
    // Exit mistakes/solve-all mode only once appPage is hidden/faded,
    // so the underlying quiz-mode UI never flashes into view mid-fade.
    if (document.getElementById('mistakesMode').classList.contains('active')) {
      exitMistakes();
    }
    if (document.getElementById('solveAllMode').classList.contains('active')) {
      exitSolveAll();
    }
    // Covers leaving a *checked* plain Random 6 attempt too — exitSolveAll()
    // above only stops the poll it itself started. Idempotent either way.
    if (typeof stopForumProblemCountsPolling === 'function') stopForumProblemCountsPolling();
    appPage.classList.remove('visible', 'fading-out');
    choice.classList.add('hidden');
    if (typeof showNewSplash === 'function') showNewSplash();
    fadeInScreen(landing, 380);
  }

  if (fromApp) {
    appPage.classList.add('fading-out');
    setTimeout(() => showLanding(), 280);
  } else if (fromChoice) {
    fadeOutScreen(choice, 280, showLanding);
  } else {
    showLanding();
  }
}

// ─── Boot ─────────────────────────────────────────────────────────────────────
// Deliberately NOT gated on DOMContentLoaded. That event only fires once the
// parser reaches the end of the document — which, with every <script> tag
// down here being a plain blocking one (no defer/async), means waiting on
// EVERY script listed after this one too: forum.js, manual.js,
// push-notifications.js, and the external jsdelivr-hosted supabase-js CDN
// script in particular. On a slow connection that CDN fetch alone can take
// a while, and none of those scripts have anything to do with the quiz
// button grid. Meanwhile <script src="js/quiz-engine.js"> itself sits near
// the end of <body>, after the landing screen's markup (#quizSelectGrid,
// #modeLabelQuiz, etc.) and after the course/quizzes/*.js data files that
// feed QUIZZES/QUIZ_SIZE — so by the time THIS script is executing, the DOM
// nodes below already exist and the data they need is already loaded. No
// need to wait for anything past this point: run it right here, inline.
{
  // Render quiz selection buttons from the QUIZZES registry
  renderQuizButtons();
  // Sync the landing title / header <h1> to the actually-selected quiz's
  // real name (selectQuiz's side effects are otherwise only ever run on
  // click) — without this, the page loads showing whatever name was
  // hardcoded into index.html's static markup regardless of which
  // course/quiz that actually is, until the user clicks a quiz button.
  selectQuiz(selectedQuizNum);
  // "Random 6" label reflects this course's actual quiz size
  // (QUIZ_SIZE from course-config.js) instead of a hardcoded "6" —
  // courses with a different exam size get the label right for free.
  const modeLabelQuiz = document.getElementById('modeLabelQuiz');
  if (modeLabelQuiz) modeLabelQuiz.textContent = `🎯 Random ${QUIZ_SIZE}`;
  // Landing screen is shown by default; quiz is initialized when user hits Start
}

// ─── Version checker ──────────────────────────────────────────────────────────
// This page's current version. Bump this string whenever you publish an update.
const CURRENT_VERSION = '10.0.0';

// How often to poll the manifest (milliseconds). Default: every 5 minutes.
const VERSION_CHECK_INTERVAL = 5 * 60 * 1000;

// URL of the tiny JSON manifest file you host next to this HTML.
// Create a file called version.json with content: {"version":"1.0.0"}
// Update the version string there whenever you publish a new release.
const VERSION_MANIFEST_URL = 'version.json';

let _updateDismissed = false;

// Update always takes top priority — it has no hider, since nothing outranks it.
BannerManager.register('update', () => {
  document.getElementById('update-banner').classList.add('visible');
});

async function checkForUpdate() {
  if (_updateDismissed) return; // user already dismissed; stop bothering them this session
  try {
    const res = await fetch(VERSION_MANIFEST_URL + '?_=' + Date.now(), { cache: 'no-store' });
    if (!res.ok) return; // server unavailable — fail silently
    const data = await res.json();
    const latest = (data.version || '').trim();
    if (latest && latest !== CURRENT_VERSION) {
      document.getElementById('banner-new-version').textContent = latest;
      BannerManager.request('update');
    }
  } catch (_) {
    // Network error or JSON parse failure — fail silently
  }
}

function dismissUpdate() {
  _updateDismissed = true;
  document.getElementById('update-banner').classList.remove('visible');
  BannerManager.release('update');
}

// ─── Bug report nudge banner ("Report on Telegram") ───────────────────────────
// Shows once a day, after ~10 minutes of active use — not on a repeating timer.
const BUG_NUDGE_KEY = STORAGE_PREFIX + '-bug-nudge-shown';
const BUG_NUDGE_INTERVAL = 24 * 60 * 60 * 1000; // at most once a day
const BUG_NUDGE_DELAY = 10 * 60 * 1000;         // after 10 min of usage

BannerManager.register('bug',
  () => { // show
    const banner = document.getElementById('bug-report-banner');
    if (!banner) return;
    banner.classList.remove('hiding');
    banner.classList.add('visible');
  },
  () => { // hide (preempted by a higher-priority banner)
    const banner = document.getElementById('bug-report-banner');
    if (banner) banner.classList.remove('visible', 'hiding');
  }
);

function showBugBanner() {
  const last = +localStorage.getItem(BUG_NUDGE_KEY) || 0;
  if (Date.now() - last < BUG_NUDGE_INTERVAL) return;
  BannerManager.request('bug');
}

function dismissBugBanner() {
  const banner = document.getElementById('bug-report-banner');
  if (!banner) return;
  localStorage.setItem(BUG_NUDGE_KEY, String(Date.now()));
  banner.classList.add('hiding');
  banner.addEventListener('animationend', () => {
    banner.classList.remove('visible', 'hiding');
  }, { once: true });
  BannerManager.release('bug');
}

// Run immediately on load, then on the set interval
window.addEventListener('DOMContentLoaded', () => {
  checkForUpdate();
  setInterval(checkForUpdate, VERSION_CHECK_INTERVAL);

  // Telegram/bug-report nudge: once a day, after 10 minutes of usage.
  setTimeout(showBugBanner, BUG_NUDGE_DELAY);
});
