// ─── Adaptive ML ────────────────────────────────────────────────────────
// Picks problems for one student from a model trained on every student's
// answers (course/adaptive-model.js), shown as the "Adaptive ML" filter tab of
// a Random N draw and as an order for Solve them all.
//
// The model is penalized logistic regression:
//   P(right) = sigmoid(intercept + easiness of the problem
//                      + the student's skill: overall, in the set, in the topic
//                      + weights x 9 learning features)
// The problem terms and the 9 weights come fixed in the model file. The
// student's own terms are fitted here, in the browser, from the attempts in
// Stats (loadStats), with the same penalties the model was trained with, so a
// student with 2 answers in a topic is not judged on them alone. Nothing is
// sent anywhere. The features are rebuilt exactly as in training:
//   - answers right / wrong earlier in the topic and in the set (log of 1 + count)
//   - the previous attempt's accuracy in the set, and whether there was one
//   - on this very problem: missed before, solved before, both
// Only earlier attempts count; an attempt that is all blank is skipped, and
// blanks after the last answered problem are left out (the student stopped).
//
// A course without a model, or with one below the bar (_adaptiveModelReady),
// never shows any of this.

const ADAPTIVE_GOALS = [
  { key: 'weak',      label: 'Weak spots',   hint: 'Your weakest topics, with problems you have a fair chance on.' },
  { key: 'exam',      label: 'Exam ready',   hint: 'A draw like the real one, with your likely score.' },
  { key: 'mistakes',  label: 'Fix mistakes', hint: 'Problems you missed, and new versions of them.' },
  { key: 'new',       label: 'New problems', hint: 'Types of problem you have not met yet, across all topics.' },
  { key: 'warmup',    label: 'Warm up',      hint: 'Problems you will very likely solve.' },
  { key: 'challenge', label: 'Challenge',    hint: 'The hardest problems for you right now.' },
];

// The goal a Random N draw last used, per set.
function _adaptiveGoalKey(quizNum) { return STORAGE_PREFIX + '_adaptivegoal_q' + quizNum; }

// The bar a course's model must pass before any of Adaptive ML shows: it
// must be trained on this course's own answers, enough of them from enough
// students, and predict well on attempts it did not see (held-out AUC,
// written by the study's export_model.py). Below it the model file still
// ships, and the mode appears by itself once a retrained model passes.
const ADAPTIVE_MIN_ANSWERS = 5000;
const ADAPTIVE_MIN_STUDENTS = 100;
const ADAPTIVE_MIN_AUC = 0.68;

function _adaptiveModelReady(m) {
  return !!(m && m.problems && !m.prior
    && m.answers >= ADAPTIVE_MIN_ANSWERS && m.students >= ADAPTIVE_MIN_STUDENTS
    && typeof m.auc === 'number' && m.auc >= ADAPTIVE_MIN_AUC);
}

function _adaptiveModel() {
  const m = typeof ADAPTIVE_MODEL !== 'undefined' ? ADAPTIVE_MODEL : null;
  return _adaptiveModelReady(m) ? m : null;
}

function adaptiveAvailable(quizNum) {
  const m = _adaptiveModel();
  return !!(m && Array.isArray(m.sets) && m.sets.includes(quizNum));
}

function getAdaptiveGoal(quizNum) {
  try {
    const g = localStorage.getItem(_adaptiveGoalKey(quizNum));
    if (ADAPTIVE_GOALS.some(x => x.key === g)) return g;
  } catch (e) { /* storage blocked: default below */ }
  return 'weak';
}

function setAdaptiveGoal(quizNum, goal) {
  try { localStorage.setItem(_adaptiveGoalKey(quizNum), goal); } catch (e) { /* not remembered, still used */ }
}

function _adaptiveEsc(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function _adaptiveSig(z) { return 1 / (1 + Math.exp(-Math.max(-30, Math.min(30, z)))); }

function _adaptiveIsBlank(a) { return String(a && a.entered_value != null ? a.entered_value : '').trim() === ''; }

// ── Replaying the student's attempts ────────────────────────────────────

function _adaptiveNewState() {
  return {
    topic: new Map(),    // "set:topic" -> [right, wrong]
    set: new Map(),      // set -> [right, wrong]
    lastAcc: new Map(),  // set -> { right, n } of the latest attempt in it
    seen: new Map(),     // "set:id" -> times answered
    right: new Map(),    // "set:id" -> times right
    lastY: new Map(),    // "set:id" -> 1 / 0, latest result
  };
}

function _adaptiveFeatures(st, key, topicKey, setQ) {
  const m = _adaptiveModel();
  const [tr, tw] = st.topic.get(topicKey) || [0, 0];
  const [sr, sw] = st.set.get(setQ) || [0, 0];
  const la = st.lastAcc.get(setQ);
  const seen = st.seen.get(key) || 0;
  const right = st.right.get(key) || 0;
  return [
    Math.log1p(tr), Math.log1p(tw), Math.log1p(sr), Math.log1p(sw),
    la ? la.right / la.n - m.lastAccCenter : 0, la ? 1 : 0,
    seen > 0 && right === 0 ? 1 : 0,
    right > 0 ? 1 : 0,
    seen > 0 && right > 0 && right < seen ? 1 : 0,
  ];
}

// An attempt that was not a real try, which Adaptive ML leaves out (it stays
// in Stats): nothing right, and either answered faster than 20 s a problem
// or the same value typed into 4+ problems. In the 5,195 phys161 attempts up
// to 26 Nov, even the fastest real ones with 5+ right took 28 s a problem,
// and a real 0 took 4.5 min (median). The training data (build_table.py)
// leaves the same attempts out.
const ADAPTIVE_JUNK_SECONDS_PER_ANSWER = 20;
const ADAPTIVE_JUNK_SAME_VALUE = 4;
function adaptiveIsJunkAttempt(a) {
  const ans = Array.isArray(a.answers) ? a.answers : [];
  const typed = ans.filter(x => !_adaptiveIsBlank(x));
  if (!typed.length) return true;
  if (typed.some(x => Number(x.points) >= 0.9)) return false;
  const dur = Number(a.duration);
  if (dur > 0 && dur / typed.length < ADAPTIVE_JUNK_SECONDS_PER_ANSWER) return true;
  const counts = new Map();
  typed.forEach(x => {
    const v = String(x.entered_value).trim().toLowerCase().replace(/\s+/g, '');
    counts.set(v, (counts.get(v) || 0) + 1);
  });
  return Math.max(...counts.values()) >= ADAPTIVE_JUNK_SAME_VALUE;
}

// Every stored attempt, oldest first, as training rows (features as they
// were at the start of that attempt) plus the state after the last one.
// Attempts that were not a real try (adaptiveIsJunkAttempt) are left out.
// With `beforeMs`, only the attempts made before that moment: what the model
// knew just before a past attempt.
function _adaptiveReplay(beforeMs) {
  const m = _adaptiveModel();
  const attempts = (typeof loadStats === 'function' ? loadStats() : [])
    .filter(a => Array.isArray(a.answers) && a.answers.length)
    .filter(a => beforeMs == null || Date.parse(a.date) < beforeMs)
    .filter(a => !adaptiveIsJunkAttempt(a))
    .sort((a, b) => Date.parse(a.date) - Date.parse(b.date));
  const st = _adaptiveNewState();
  const rows = [];
  attempts.forEach(a => {
    const blank = a.answers.map(_adaptiveIsBlank);
    const last = blank.lastIndexOf(false);
    if (last < 0) return;
    const items = [];
    for (let i = 0; i <= last; i++) {
      const ans = a.answers[i];
      const key = `${ans.quiz_num}:${ans.problem_id}`;
      const mp = m.problems[key];
      if (!mp) continue;
      items.push({ key, topicKey: `${ans.quiz_num}:${mp[1]}`, y: !blank[i] && Number(ans.points) >= 0.9 ? 1 : 0 });
    }
    if (!items.length) return;
    const setQ = a.quizNum;
    items.forEach(it => rows.push({ ...it, setQ, f: _adaptiveFeatures(st, it.key, it.topicKey, setQ) }));
    let right = 0;
    items.forEach(it => {
      const t = st.topic.get(it.topicKey) || [0, 0]; t[it.y ? 0 : 1]++; st.topic.set(it.topicKey, t);
      const s = st.set.get(setQ) || [0, 0]; s[it.y ? 0 : 1]++; st.set.set(setQ, s);
      st.seen.set(it.key, (st.seen.get(it.key) || 0) + 1);
      if (it.y) st.right.set(it.key, (st.right.get(it.key) || 0) + 1);
      st.lastY.set(it.key, it.y);
      right += it.y;
    });
    st.lastAcc.set(setQ, { right, n: items.length });
  });
  return { rows, st };
}

// ── Fitting the student's own terms ─────────────────────────────────────

// Solves A x = b for a small dense symmetric positive definite A (Cholesky).
function _adaptiveSolve(A, b) {
  const n = b.length;
  const L = A.map(r => new Float64Array(n));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j <= i; j++) {
      let s = A[i][j];
      for (let k = 0; k < j; k++) s -= L[i][k] * L[j][k];
      if (i === j) L[i][i] = Math.sqrt(Math.max(s, 1e-12));
      else L[i][j] = s / L[j][j];
    }
  }
  const y = new Float64Array(n);
  for (let i = 0; i < n; i++) { let s = b[i]; for (let k = 0; k < i; k++) s -= L[i][k] * y[k]; y[i] = s / L[i][i]; }
  const x = new Float64Array(n);
  for (let i = n - 1; i >= 0; i--) { let s = y[i]; for (let k = i + 1; k < n; k++) s -= L[k][i] * x[k]; x[i] = s / L[i][i]; }
  return x;
}

// Maximum of the penalized likelihood (Newton steps) over: overall skill,
// one term per set and one per topic the student has answered in.
function _adaptiveFit(rows) {
  const m = _adaptiveModel();
  const index = new Map([['all', 0]]);
  const pen = [m.penalty.student];
  const idOf = (k, lam) => { if (!index.has(k)) { index.set(k, index.size); pen.push(lam); } return index.get(k); };
  const prepared = rows.map(r => {
    let off = m.intercept + m.problems[r.key][0];
    for (let k = 0; k < m.weights.length; k++) off += m.weights[k] * r.f[k];
    return { off, y: r.y, ix: [0, idOf('set:' + r.setQ, m.penalty.set), idOf('topic:' + r.topicKey, m.penalty.topic)] };
  });
  const n = index.size;
  const th = new Float64Array(n);
  for (let it = 0; it < 30 && prepared.length; it++) {
    const g = new Float64Array(n);
    const H = Array.from({ length: n }, () => new Float64Array(n));
    for (let i = 0; i < n; i++) { g[i] = pen[i] * th[i]; H[i][i] = pen[i]; }
    prepared.forEach(r => {
      const p = _adaptiveSig(r.off + th[r.ix[0]] + th[r.ix[1]] + th[r.ix[2]]);
      const d = p - r.y, w = p * (1 - p);
      r.ix.forEach(a => { g[a] += d; r.ix.forEach(b => { H[a][b] += w; }); });
    });
    const step = _adaptiveSolve(H, g);
    let big = 0;
    for (let i = 0; i < n; i++) { th[i] -= step[i]; big = Math.max(big, Math.abs(step[i])); }
    if (big < 1e-7) break;
  }
  const get = k => (index.has(k) ? th[index.get(k)] : 0);
  return { overall: th[0], set: q => get('set:' + q), topic: t => get('topic:' + t) };
}

// Solve them all progress for a set (status per problem id), or {}.
function _adaptiveSolveAllStatus(quizNum) {
  try {
    const raw = JSON.parse(localStorage.getItem(`${STORAGE_PREFIX}_sa_q${quizNum}_s`) || 'null');
    return (raw && raw.checkedById) || {};
  } catch (e) { return {}; }
}

// Everything a draw or an order needs about one student and one set.
function _adaptiveContext(quizNum, beforeMs) {
  const { rows, st } = _adaptiveReplay(beforeMs);
  const fit = _adaptiveFit(rows);
  const sa = _adaptiveSolveAllStatus(quizNum);
  const answersInSet = rows.filter(r => r.setQ === quizNum).length;
  return { quizNum, rows, st, fit, sa, answersInSet };
}

// ── Predicting and explaining ───────────────────────────────────────────

function _adaptivePredict(ctx, p) {
  const m = _adaptiveModel();
  const q = ctx.quizNum;
  const key = `${q}:${p.id}`;
  const mp = m.problems[key];
  if (!mp) return null;
  const topicKey = `${q}:${mp[1]}`;
  const f = _adaptiveFeatures(ctx.st, key, topicKey, q);
  const w = m.weights;
  // The sum split into the parts the "why" line can name.
  const parts = {
    problem: mp[0],
    skill: ctx.fit.overall,
    set: ctx.fit.set(q),
    recent: w[2] * f[2] + w[3] * f[3] + w[4] * f[4] + w[5] * f[5],
    topic: ctx.fit.topic(topicKey) + w[0] * f[0] + w[1] * f[1],
    before: w[6] * f[6] + w[7] * f[7] + w[8] * f[8],
  };
  const z = m.intercept + Object.values(parts).reduce((a, b) => a + b, 0);
  const seen = ctx.st.seen.get(key) || 0;
  const right = ctx.st.right.get(key) || 0;
  const saStatus = ctx.sa[p.id];
  return {
    p, key, topicKey, topic: mp[1], family: mp[4], firstShare: mp[2], z, chance: _adaptiveSig(z), parts, f,
    seen, right,
    touched: seen > 0 || !!saStatus,
    solved: right > 0 || saStatus === 'correct' || saStatus === 'partial',
    missed: (seen > 0 && ctx.st.lastY.get(key) === 0 && saStatus !== 'correct' && saStatus !== 'partial')
      || saStatus === 'wrong' || saStatus === 'revealed',
  };
}

// Average first-time solve share over a set's problems (what "most" means).
const _adaptiveShareCache = new Map();
function _adaptiveSetShare(quizNum) {
  if (!_adaptiveShareCache.has(quizNum)) {
    const shares = Object.entries(_adaptiveModel().problems)
      .filter(([k, v]) => k.startsWith(quizNum + ':') && v[2] != null).map(([, v]) => v[2]);
    _adaptiveShareCache.set(quizNum, shares.length ? shares.reduce((a, b) => a + b, 0) / shares.length : 0.75);
  }
  return _adaptiveShareCache.get(quizNum);
}

function _adaptiveReason(name, v, pr, ctx) {
  const up = v > 0;
  const q = ctx.quizNum;
  const pct = x => Math.round(x * 100) + '%';
  switch (name) {
    case 'problem': {
      if (pr.firstShare == null) return up ? 'easier than most problems' : 'harder than most problems';
      // The model's difficulty also allows for who tried a problem, so it can
      // disagree with the raw share; "easier/harder than most" only when both agree.
      const agrees = up === (pr.firstShare >= _adaptiveSetShare(ctx.quizNum));
      return (agrees ? `${up ? 'easier' : 'harder'} than most: ` : '') + `${pct(pr.firstShare)} of students solve it the first time`;
    }
    case 'skill': return up ? 'your results so far are above average' : 'your results so far are below average';
    case 'set': return up ? `Set #${q} goes better for you than your other sets` : `Set #${q} has gone less well for you than your other sets`;
    case 'recent': {
      const la = ctx.st.lastAcc.get(q);
      if (la) return `your last attempt in Set #${q}: ${la.right} of ${la.n}`;
      const [sr, sw] = ctx.st.set.get(q) || [0, 0];
      return `${sr} of ${sr + sw} right in Set #${q} so far`;
    }
    case 'topic': {
      const [tr, tw] = ctx.st.topic.get(pr.topicKey) || [0, 0];
      return tr + tw ? `${pr.topic}: ${tr} of ${tr + tw} right so far` : `no ${pr.topic} answers yet`;
    }
    case 'before':
      if (pr.f[8]) return 'you have both solved and missed this one before';
      if (pr.f[7]) return 'you solved this one before';
      return 'you missed this one before, and second tries usually go better';
    default: return '';
  }
}

// The parts that differ between problems of one draw. Overall skill, the set
// term and recent form are the same on every card, so they explain nothing
// about why this problem; they still count in the chance itself.
const _ADAPTIVE_CARD_REASONS = ['problem', 'topic', 'before'];

// One short line behind a card's chip: why it was picked (the goal's lead),
// then the two parts that move its chance most. The chip itself says how
// likely it is (adaptiveChipHtml).
function _adaptiveWhy(pr, ctx, lead) {
  const effects = Object.entries(pr.parts)
    .filter(([k]) => _ADAPTIVE_CARD_REASONS.includes(k))
    .map(([k, v]) => [k, v, pr.chance - _adaptiveSig(pr.z - v)])
    .filter(([, , e]) => Math.abs(e) >= 0.02)
    .sort((a, b) => Math.abs(b[2]) - Math.abs(a[2]))
    .slice(0, 2);
  const reasons = effects.map(([k, v]) => _adaptiveReason(k, v, pr, ctx)).filter(Boolean).join(' | ');
  const text = [lead, reasons && reasons[0].toUpperCase() + reasons.slice(1)]
    .filter(Boolean).join('. ');
  return _adaptiveEsc(text);
}

// The chance of each score 0..n when problem i is solved with chance c[i]
// (Poisson binomial).
function _adaptiveDist(chances) {
  let d = [1];
  chances.forEach(c => {
    const nd = new Array(d.length + 1).fill(0);
    d.forEach((v, k) => { nd[k] += v * (1 - c); nd[k + 1] += v * c; });
    d = nd;
  });
  return d;
}

// Central range of the score holding >= cover of its probability, from the
// per-problem chances, or from a score distribution itself.
function _adaptiveScoreRange(chances, cover = 0.8, dist) {
  const d = dist || _adaptiveDist(chances);
  const lowQ = (1 - cover) / 2, highQ = 1 - lowQ;
  let acc = 0, lo = 0, hi = d.length - 1, loSet = false;
  for (let k = 0; k < d.length; k++) {
    acc += d[k];
    if (!loSet && acc >= lowQ) { lo = k; loSet = true; }
    if (acc >= highQ) { hi = k; break; }
  }
  return [lo, hi];
}

// ── Picking ─────────────────────────────────────────────────────────────

function _adaptiveJitter() { return Math.random() * 0.04; }

// Takes from `sorted` until n are chosen, one problem per template family
// (a twin of a picked problem says little new), skipping `avoid` keys
// while enough others remain.
function _adaptiveTake(sorted, n, chosen, families, avoid) {
  const pass = (skipAvoid) => {
    for (const pr of sorted) {
      if (chosen.length >= n) return;
      if (chosen.some(c => c.key === pr.key) || families.has(pr.family)) continue;
      if (skipAvoid && avoid && avoid.has(pr.key)) continue;
      chosen.push(pr); families.add(pr.family);
    }
  };
  pass(true);
  if (chosen.length < n) pass(false);
  return chosen;
}

function _adaptiveWeakPicks(preds, n, chosen, families, avoid, ctx, leads) {
  const byTopic = new Map();
  preds.forEach(pr => { if (!byTopic.has(pr.topic)) byTopic.set(pr.topic, []); byTopic.get(pr.topic).push(pr); });
  const topics = [...byTopic.entries()]
    .map(([t, list]) => [t, list.reduce((a, b) => a + b.chance, 0) / list.length, list])
    .sort((a, b) => a[1] - b[1]);
  const weakest = topics.slice(0, 3);
  const quota = weakest.map((_, i) => Math.floor(n / 3) + (i < n % 3 ? 1 : 0));
  weakest.forEach(([t, , list], i) => {
    const sorted = list
      .map(pr => [pr, Math.abs(pr.chance - 0.7) + (pr.solved ? 0.3 : 0) + _adaptiveJitter()])
      .sort((a, b) => a[1] - b[1]).map(x => x[0]);
    const before = chosen.length;
    _adaptiveTake(sorted, Math.min(n, before + quota[i]), chosen, families, avoid);
    chosen.slice(before).forEach(pr => leads.set(pr.key, `Weak spot: ${pr.topic}`));
  });
  // A topic with too few problems: the rest from the next weakest topics.
  for (const [, , list] of topics.slice(3)) {
    if (chosen.length >= n) break;
    const before = chosen.length;
    const sorted = list.map(pr => [pr, Math.abs(pr.chance - 0.7) + _adaptiveJitter()]).sort((a, b) => a[1] - b[1]).map(x => x[0]);
    _adaptiveTake(sorted, n, chosen, families, avoid);
    chosen.slice(before).forEach(pr => leads.set(pr.key, `Weak spot: ${pr.topic}`));
  }
  return weakest.map(x => x[0]);
}

// What the info box above the cards says about the current Adaptive ML draw
// (quiz-engine.js _filterInfo): { goal, text, extra }, or null before one.
let _adaptiveNote = null;
function adaptiveNote() { return _adaptiveNote; }

// The Random N draw for a goal: `size` problem objects from QUIZZES, each a
// copy carrying _adaptiveWhy (the line shown on its card).
function adaptivePick(quizNum, goal, size, avoidKeys) {
  const ctx = _adaptiveContext(quizNum);
  const problems = QUIZZES[quizNum - 1].problems;
  const preds = problems.map(p => _adaptivePredict(ctx, p)).filter(Boolean);
  const avoid = new Set([...(avoidKeys || [])].map(k => {
    const m = /^q(\d+)_(.+)$/.exec(k); return m ? `${m[1]}:${m[2]}` : k;
  }));
  const n = Math.min(size, preds.length);
  const chosen = [], families = new Set(), leads = new Map();
  const goalLabel = (ADAPTIVE_GOALS.find(g => g.key === goal) || ADAPTIVE_GOALS[0]).label;
  const hideTopics = document.documentElement.classList.contains('settings-hide-topic-while-active');
  let note = '';

  if (goal === 'exam') {
    const sorted = preds.map(pr => [pr, Math.random()]).sort((a, b) => a[1] - b[1]).map(x => x[0]);
    _adaptiveTake(sorted, n, chosen, families, avoid);
    const [lo, hi] = _adaptiveScoreRange(chosen.map(pr => pr.chance));
    note = `likely ${lo === hi ? lo : lo + '–' + hi} of ${n}` + (ctx.answersInSet < 14 ? ' (a rough guess until you have more answers in this set)' : '');
  } else if (goal === 'mistakes') {
    const missed = preds.filter(pr => pr.missed);
    const missedFam = new Set(missed.map(pr => pr.family));
    const twins = preds.filter(pr => !pr.touched && missedFam.has(pr.family));
    missed.forEach(pr => leads.set(pr.key, 'You missed this one'));
    twins.forEach(pr => leads.set(pr.key, 'A new version of one you missed'));
    const sorted = [...missed, ...twins]
      .map(pr => [pr, Math.abs(pr.chance - 0.65) + _adaptiveJitter()]).sort((a, b) => a[1] - b[1]).map(x => x[0]);
    _adaptiveTake(sorted, n, chosen, families, avoid);
    const k = chosen.length;
    if (k < n) _adaptiveWeakPicks(preds, n, chosen, families, avoid, ctx, leads);
    note = k === 0 ? 'no misses yet, so these are your weak spots'
      : k < n ? `${k} from your misses, ${n - k} from your weak spots` : `${k} from your misses`;
  } else if (goal === 'new') {
    const famTouched = new Set(preds.filter(pr => pr.touched).map(pr => pr.family));
    const fresh = preds.filter(pr => !famTouched.has(pr.family));
    const topicSeen = new Map();
    preds.forEach(pr => { if (pr.touched) topicSeen.set(pr.topic, (topicSeen.get(pr.topic) || 0) + 1); });
    // Least-covered topics first, one problem per family.
    const sorted = fresh
      .map(pr => [pr, (topicSeen.get(pr.topic) || 0) * 0.05 + Math.abs(pr.chance - 0.7) + _adaptiveJitter()])
      .sort((a, b) => a[1] - b[1]).map(x => x[0]);
    const byTopic = new Map();
    sorted.forEach(pr => { if (!byTopic.has(pr.topic)) byTopic.set(pr.topic, []); byTopic.get(pr.topic).push(pr); });
    const rounds = [];
    let more = true;
    for (let r = 0; more; r++) {
      more = false;
      byTopic.forEach(list => { if (list[r]) { rounds.push(list[r]); more = true; } });
    }
    _adaptiveTake(rounds, n, chosen, families, avoid);
    chosen.forEach(pr => leads.set(pr.key, 'A type of problem you have not met yet'));
    const k = chosen.length;
    if (k < n) {
      const rest = preds.filter(pr => !pr.touched).map(pr => [pr, Math.abs(pr.chance - 0.7) + _adaptiveJitter()])
        .sort((a, b) => a[1] - b[1]).map(x => x[0]);
      _adaptiveTake(rest, n, chosen, families, avoid);
      if (chosen.length < n) _adaptiveTake(preds.slice().sort(() => Math.random() - 0.5), n, chosen, families, avoid);
    }
    const left = new Set(fresh.map(pr => pr.family)).size;
    note = left ? `${left} type${left === 1 ? '' : 's'} of problem left to meet` : 'you have met every type of problem in this set';
  } else if (goal === 'warmup') {
    const sorted = preds.map(pr => [pr, -pr.chance - (pr.touched ? 0 : 0.05) - _adaptiveJitter()]).sort((a, b) => a[1] - b[1]).map(x => x[0]);
    _adaptiveTake(sorted, n, chosen, families, avoid);
    note = 'problems you will very likely solve';
  } else if (goal === 'challenge') {
    const sorted = preds.map(pr => [pr, pr.chance + (pr.solved ? 0.3 : 0) + _adaptiveJitter()]).sort((a, b) => a[1] - b[1]).map(x => x[0]);
    _adaptiveTake(sorted, n, chosen, families, avoid);
    note = 'the hardest problems for you right now';
  } else {
    _adaptiveWeakPicks(preds, n, chosen, families, avoid, ctx, leads);
    // The topics actually drawn, weakest first (a small topic can run out of
    // problem types, and the next weakest fills in).
    note = hideTopics ? 'your weakest topics' : [...new Set(chosen.map(pr => pr.topic))].join(' | ');
  }

  // How likely the drawn problems are for this student: the one line in the
  // info box that sums up the chips on the cards.
  const mixCounts = ADAPTIVE_BINS.map(() => 0);
  chosen.forEach(pr => { mixCounts[_adaptiveBin(pr.chance)]++; });
  const mix = ADAPTIVE_BINS.map((b, i) => (mixCounts[i] ? `${mixCounts[i]} ${b.label.replace(' for you', '').toLowerCase()}` : ''))
    .filter(Boolean).join(' | ');
  _adaptiveNote = {
    goal: goalLabel,
    text: note[0].toUpperCase() + note.slice(1),
    mix: mix ? 'Picked for you: ' + mix : '',
    extra: ctx.rows.length ? '' : 'No attempts yet, so this uses how all students did. It becomes personal after your first attempt.',
  };
  return chosen.map(pr => ({ ...pr.p, _adaptiveWhy: _adaptiveWhy(pr, ctx, leads.get(pr.key) || ''), _adaptiveChance: pr.chance }));
}

// Solve them all in Adaptive ML order: every problem, most useful first.
//  1. one problem from each type (template family) not met yet, topics taken in turn
//  2. problems missed and not solved since
//  3. the other problems not met yet
//  4. problems solved already, and near-certain ones, last
function adaptiveSolveAllOrder(quizNum, problems) {
  const ctx = _adaptiveContext(quizNum);
  const preds = problems.map(p => ({ p, pr: _adaptivePredict(ctx, p) }));
  const known = preds.filter(x => x.pr).map(x => x.pr);
  const unknown = preds.filter(x => !x.pr).map(x => x.p);
  const famTouched = new Set(known.filter(pr => pr.touched).map(pr => pr.family));
  const fit07 = pr => Math.abs(pr.chance - 0.7);
  const used = new Set();
  const tiers = [[], [], [], []];
  const leads = new Map();

  // 1: the best representative of each untouched family, topics interleaved.
  const reps = new Map();
  known.forEach(pr => {
    if (famTouched.has(pr.family) || pr.chance >= 0.95) return;
    const cur = reps.get(pr.family);
    if (!cur || fit07(pr) < fit07(cur)) reps.set(pr.family, pr);
  });
  const byTopic = new Map();
  [...reps.values()].sort((a, b) => fit07(a) - fit07(b)).forEach(pr => {
    if (!byTopic.has(pr.topic)) byTopic.set(pr.topic, []);
    byTopic.get(pr.topic).push(pr);
  });
  for (let r = 0, more = true; more; r++) {
    more = false;
    byTopic.forEach(list => { if (list[r]) { tiers[0].push(list[r]); used.add(list[r].key); more = true; } });
  }
  tiers[0].forEach(pr => leads.set(pr.key, 'A type of problem you have not met yet'));

  known.forEach(pr => {
    if (used.has(pr.key)) return;
    if (pr.missed && !pr.solved) { tiers[1].push(pr); leads.set(pr.key, 'You missed this one'); }
    else if (!pr.touched && !pr.solved && pr.chance < 0.95) tiers[2].push(pr);
    else { tiers[3].push(pr); leads.set(pr.key, pr.solved ? 'Solved already' : ''); }
  });
  tiers[1].sort((a, b) => Math.abs(a.chance - 0.65) - Math.abs(b.chance - 0.65));
  tiers[2].sort((a, b) => fit07(a) - fit07(b));
  tiers[2].forEach(pr => leads.set(pr.key, 'A twin of a type you have met'));
  tiers[3].sort((a, b) => (a.solved - b.solved) || (a.chance - b.chance));

  return [...tiers.flat().map(pr => ({ ...pr.p, _adaptiveWhy: _adaptiveWhy(pr, ctx, leads.get(pr.key) || ''), _adaptiveChance: pr.chance })), ...unknown];
}

// ── The filter tab's settings area ──────────────────────────────────────

// One bordered list with a radio row per goal: its name and what it does on
// the same row, like the Settings screen.
function adaptiveRenderConfig(quizIdx, area) {
  const quizNum = quizIdx + 1;
  const goal = getAdaptiveGoal(quizNum);
  const block = document.createElement('div');
  block.className = 'adaptive-block';
  block.innerHTML = `
    <div class="adaptive-list" role="radiogroup" aria-label="Goal">
      ${ADAPTIVE_GOALS.map(g => `<button type="button" class="adaptive-row" role="radio" aria-checked="${g.key === goal}"
        tabindex="${g.key === goal ? 0 : -1}" data-goal="${g.key}"><span class="adaptive-radio" aria-hidden="true"></span>
        <span class="adaptive-name">${g.label}</span><span class="adaptive-hint">${_adaptiveEsc(g.hint)}</span></button>`).join('')}
    </div>`;
  area.appendChild(block);
  const rows = [...block.querySelectorAll('.adaptive-row')];
  const choose = (btn, focus) => {
    setAdaptiveGoal(quizNum, btn.dataset.goal);
    rows.forEach(b => {
      const on = b === btn;
      b.setAttribute('aria-checked', String(on));
      b.tabIndex = on ? 0 : -1;
    });
    if (focus) btn.focus();
    // The filter's bar names the goal (quiz-engine.js).
    if (typeof updateFilterActiveNote === 'function') updateFilterActiveNote();
  };
  rows.forEach((btn, i) => {
    btn.addEventListener('click', () => choose(btn, false));
    // Arrow keys move between goals, as in any radio group.
    btn.addEventListener('keydown', e => {
      const step = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 }[e.key];
      if (!step) return;
      e.preventDefault();
      choose(rows[(i + step + rows.length) % rows.length], true);
    });
  });
}

// ── The forecast in the score panel ─────────────────────────────────────
// After an Adaptive ML attempt is checked and saved, the score panel shows
// what the model now expects: for the next draw it has already picked (and
// which New exam / Apply filter will then give), for any random draw from
// the set, and how its forecasts before this set's recent attempts compare
// with the scores. quiz-engine.js renders it (onAttemptRecorded) and keeps
// the plan.

// The score distribution of a random draw of `size` distinct problems,
// averaged over many draws.
// With `seed`, the same draws every time (the Stats card is re-drawn often
// and its range should not flicker).
function _adaptiveRandomDrawDist(chances, size, reps = 600, seed) {
  const n = Math.min(size, chances.length);
  const acc = new Array(n + 1).fill(0);
  let t = seed >>> 0;
  const rand = seed == null ? Math.random : () => {
    t = (t + 0x6D2B79F5) >>> 0;
    let x = Math.imul(t ^ (t >>> 15), 1 | t);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
  for (let r = 0; r < reps; r++) {
    const pool = chances.slice();
    const pick = [];
    for (let i = 0; i < n; i++) pick.push(pool.splice(Math.floor(rand() * pool.length), 1)[0]);
    _adaptiveDist(pick).forEach((v, k) => { acc[k] += v / reps; });
  }
  return acc;
}

// Picks the next draw now, without touching the note of the draw on screen.
function adaptivePlanNext(quizNum, goal, size, avoidKeys) {
  const shown = _adaptiveNote;
  const picks = adaptivePick(quizNum, goal, size, avoidKeys);
  const note = _adaptiveNote;
  _adaptiveNote = shown;
  return { quizNum, goal, size, picks, note };
}

// Uses a plan made by adaptivePlanNext as the draw on screen.
function adaptiveUsePlan(plan) {
  _adaptiveNote = plan.note;
  return plan.picks;
}

// Everything the score panel shows. `plan` is the already picked next draw.
function adaptiveForecast(quizNum, plan) {
  const size = plan.size;
  const ctx = _adaptiveContext(quizNum);
  const chances = QUIZZES[quizNum - 1].problems.map(p => _adaptivePredict(ctx, p)).filter(Boolean).map(pr => pr.chance);
  const nextChances = plan.picks.map(p => p._adaptiveChance).filter(c => c != null);
  const next = { dist: _adaptiveDist(nextChances), expected: nextChances.reduce((a, b) => a + b, 0), size: nextChances.length };
  const any = { dist: _adaptiveRandomDrawDist(chances, size), expected: size * chances.reduce((a, b) => a + b, 0) / chances.length, size };
  // Before each of this set's recent attempts: the expected score for the
  // very problems it had, from what the model knew just before it.
  const m = _adaptiveModel();
  const recent = (typeof loadStats === 'function' ? loadStats() : [])
    .filter(a => a.quizNum === quizNum && a.mode === 'single' && Array.isArray(a.answers) && a.answers.length)
    .sort((a, b) => Date.parse(a.date) - Date.parse(b.date))
    .slice(-8);
  const trend = recent.map((a, i) => {
    const before = _adaptiveContext(quizNum, Date.parse(a.date));
    let expected = 0;
    a.answers.forEach(ans => {
      if (ans.quiz_num !== quizNum || !m.problems[`${quizNum}:${ans.problem_id}`]) return;
      const p = QUIZZES[quizNum - 1].problems.find(x => x.id === ans.problem_id) || { id: ans.problem_id };
      const pr = _adaptivePredict(before, p);
      if (pr) expected += pr.chance;
    });
    const scored = a.answers.filter(ans => !_adaptiveIsBlank(ans) && Number(ans.points) >= 0.9).length;
    return { n: i + 1, expected, scored, size: a.answers.length, date: a.date, junk: adaptiveIsJunkAttempt(a) };
  });
  return { next, any, trend, goal: (ADAPTIVE_GOALS.find(g => g.key === plan.goal) || ADAPTIVE_GOALS[0]).label };
}

// The forecast section's markup: two figures for the next and any draw, the
// chance of each score for both, and forecast against score for recent
// attempts. SVG drawn in the site's own colours (currentColor and CSS vars).
function adaptiveForecastHtml(f) {
  const pct = x => Math.round(x * 100) + '%';
  const range = d => { const [lo, hi] = _adaptiveScoreRange(null, 0.8, d); return lo === hi ? `${lo}` : `${lo}–${hi}`; };
  const size = f.next.size || f.any.size;
  const stat = (label, part) => `<div class="rf-stat"><div class="rf-stat-label">${label}</div>
      <div class="rf-stat-value">${pct(part.expected / Math.max(1, part.size))}</div>
      <div class="rf-stat-sub">likely ${range(part.dist)} of ${part.size}</div></div>`;

  // chance of each score: the next draw solid, any random draw outlined
  const W = 320, H = 150, pl = 6, pr = 6, pt = 18, pb = 22;
  const n = Math.max(f.next.dist.length, f.any.dist.length) - 1;
  const top = Math.max(...f.next.dist, ...f.any.dist, 0.01);
  const gw = (W - pl - pr) / (n + 1), bw = Math.min(14, gw / 2 - 2);
  const y = v => pt + (H - pt - pb) * (1 - v / top);
  let bars = '';
  for (let k = 0; k <= n; k++) {
    const cx = pl + gw * k + gw / 2;
    const a = f.next.dist[k] || 0, b = f.any.dist[k] || 0;
    bars += `<rect class="rf-bar-next" x="${cx - bw - 1}" y="${y(a)}" width="${bw}" height="${Math.max(0, H - pb - y(a))}" rx="2"><title>${k} of ${n}, next draw: ${pct(a)}</title></rect>`;
    bars += `<rect class="rf-bar-any" x="${cx + 1}" y="${y(b)}" width="${bw}" height="${Math.max(0, H - pb - y(b))}" rx="2"><title>${k} of ${n}, any random draw: ${pct(b)}</title></rect>`;
    bars += `<text x="${cx}" y="${H - pb + 14}" text-anchor="middle">${k}</text>`;
  }
  const histo = `<svg class="rf-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Chance of each score, next draw and any random draw">${bars}
    <line x1="${pl}" x2="${W - pr}" y1="${H - pb}" y2="${H - pb}" class="rf-axis"/></svg>`;

  // forecast before each recent attempt against the score
  let trend = '', trendNote = '';
  if (f.trend.length >= 2) {
    const t = f.trend, W2 = 320, H2 = 150, l2 = 22, r2 = 12, t2 = 12, b2 = 22;
    const max = Math.max(...t.map(p => p.size), size);
    const xs = i => l2 + (W2 - l2 - r2) * (i / (t.length - 1));
    const ys = v => t2 + (H2 - t2 - b2) * (1 - v / max);
    let g = `<line x1="${l2}" x2="${W2 - r2}" y1="${ys(0)}" y2="${ys(0)}" class="rf-axis"/><text x="${l2 - 6}" y="${ys(0) + 4}" text-anchor="end">0</text>
      <line x1="${l2}" x2="${W2 - r2}" y1="${ys(max)}" y2="${ys(max)}" class="rf-grid"/><text x="${l2 - 6}" y="${ys(max) + 4}" text-anchor="end">${max}</text>`;
    // The line joins the counted attempts only; one that was not a real try
    // is a faint cross at its score.
    const counted = t.map((p, i) => [p, i]).filter(([p]) => !p.junk);
    if (counted.length) g += `<path class="rf-line" d="${counted.map(([p, i], k) => `${k ? 'L' : 'M'}${xs(i).toFixed(1)},${ys(p.expected).toFixed(1)}`).join(' ')}"/>`;
    t.forEach((p, i) => {
      if (p.junk) {
        const x = xs(i), yy = ys(p.scored), r = 4;
        g += `<path class="rf-junk" d="M${x - r},${yy - r} L${x + r},${yy + r} M${x + r},${yy - r} L${x - r},${yy + r}"><title>Attempt ${p.n}: ${p.scored} of ${p.size}, not counted (not a real try)</title></path>`;
        return;
      }
      const tip = `<title>Attempt ${p.n}: forecast ${p.expected.toFixed(1)}, scored ${p.scored} of ${p.size}</title>`;
      g += `<circle class="rf-scored" cx="${xs(i)}" cy="${ys(p.scored)}" r="4.5">${tip}</circle>`;
      g += `<circle class="rf-forecast" cx="${xs(i)}" cy="${ys(p.expected)}" r="4">${tip}</circle>`;
    });
    const skipped = t.filter(p => p.junk).length;
    if (skipped) trendNote = `<span><i class="rf-key rf-key-junk"></i>Not counted (${skipped})</span>`;
    trend = `<div class="rf-panel"><div class="rf-panel-title">Before each attempt here: forecast and score</div>
      <svg class="rf-chart" viewBox="0 0 ${W2} ${H2}" role="img" aria-label="Forecast before each recent attempt and its score">${g}</svg>
      <div class="rf-legend"><span><i class="rf-key rf-key-line"></i>Forecast</span><span><i class="rf-key rf-key-scored"></i>Your score</span>${trendNote}</div></div>`;
  }

  return `<div class="rf-head">Adaptive ML forecast</div>
    <div class="rf-stats">${stat(`Next draw | ${_adaptiveEsc(f.goal)}`, f.next)}${stat('Any random draw', f.any)}</div>
    <div class="rf-charts">
      <div class="rf-panel"><div class="rf-panel-title">Chance of each score</div>${histo}
        <div class="rf-legend"><span><i class="rf-key rf-key-next"></i>Next draw</span><span><i class="rf-key rf-key-any"></i>Any random draw</span></div></div>
      ${trend}
    </div>`;
}

// ── The chance map in Stats (Problems card, js/stats.js) ────────────────
// Every problem of a set as a small square in five chance groups, a row per
// topic (weakest first, easiest last in each row), dots for solved and rings
// for missed; above it one bar with the share of each group, the legend
// carrying the percentages. No interpretation text, only the picture.

const ADAPTIVE_BINS = [
  { below: 0.45, label: 'Hard for you' },
  { below: 0.6, label: 'Real stretch' },
  { below: 0.75, label: 'Fair stretch' },
  { below: 0.9, label: 'Likely' },
  { below: Infinity, label: 'Very likely' },
];
function _adaptiveBin(c) { return ADAPTIVE_BINS.findIndex(b => c < b.below); }

function adaptiveProblemMapHtml(quizNum) {
  if (!adaptiveAvailable(quizNum)) return '';
  const ctx = _adaptiveContext(quizNum);
  const preds = QUIZZES[quizNum - 1].problems.map(p => _adaptivePredict(ctx, p)).filter(Boolean);
  if (!preds.length) return '';
  const pct = x => Math.round(x * 100) + '%';
  const counts = ADAPTIVE_BINS.map(() => 0);
  preds.forEach(pr => { counts[_adaptiveBin(pr.chance)]++; });
  const total = preds.length;
  const share = i => Math.round(counts[i] / total * 100) + '%';

  // The key, twice; the card shows one by its width (css/stats.css): a
  // column beside the map with a vertical share bar on a wide card, five
  // tiles above it on a narrow one (Solved / Missed then go under the map).
  const short = l => l.replace(' for you', '');
  const marks = '<span><i class="am-key am-mark-solved"></i>Solved</span><span><i class="am-key am-mark-missed"></i>Missed</span>';
  const tiles = ADAPTIVE_BINS.map((b, i) => `<div class="am-tile"><i class="am-key am-b${i}"></i><b>${share(i)}</b><span>${short(b.label)}</span></div>`).join('');
  const vbar = ADAPTIVE_BINS.map((b, i) => counts[i]
    ? `<span class="am-b${i}" style="flex:${counts[i]}" title="${b.label}: ${counts[i]} of ${total} problems (${share(i)})"></span>` : '').join('');
  const sideList = ADAPTIVE_BINS.map((b, i) => `<div class="am-side-item"><i class="am-key am-b${i}"></i><span>${short(b.label)}</span><b>${share(i)}</b></div>`)
    .reverse().join('');

  // Practice exams only, like everything else on the Stats screen: Entire Set
  // progress (which the draws do use) would mark problems solved there that
  // were never solved in an exam.
  const status = pr => (pr.right > 0 ? 'solved'
    : pr.seen > 0 && ctx.st.lastY.get(pr.key) === 0 ? 'missed' : pr.seen > 0 ? 'seen' : 'new');
  const statusWords = { solved: 'You solved it', missed: 'You missed it last time', seen: 'You have tried it', new: 'Not tried yet' };
  const byTopic = new Map();
  preds.forEach(pr => { if (!byTopic.has(pr.topic)) byTopic.set(pr.topic, []); byTopic.get(pr.topic).push(pr); });
  const rows = [...byTopic.entries()]
    .map(([topic, list]) => [topic, list, list.reduce((a, b) => a + b.chance, 0) / list.length])
    .sort((a, b) => a[2] - b[2])
    .map(([topic, list]) => {
      const cells = list.slice().sort((a, b) => a.chance - b.chance).map(pr => {
        const st = status(pr);
        const num = typeof problemNumber === 'function' ? problemNumber(quizNum, pr.p.id) : pr.p.id;
        // Read by the hover box (_adaptiveMapTip below); the label says the
        // same for screen readers.
        const bin = _adaptiveBin(pr.chance);
        const all = pr.firstShare != null ? pct(pr.firstShare) : '';
        const label = `P${num}, ${pr.topic}: ${ADAPTIVE_BINS[bin].label}, your chance ${pct(pr.chance)}`
          + (all ? `, students overall ${all}` : '') + `. ${statusWords[st]}`;
        return `<span class="am-cell am-b${bin}${st === 'solved' || st === 'missed' ? ' am-' + st : ''}" role="img"`
          + ` aria-label="${_adaptiveEsc(label)}" data-num="${num}" data-topic="${_adaptiveEsc(pr.topic)}" data-group="${ADAPTIVE_BINS[bin].label}"`
          + ` data-you="${pct(pr.chance)}" data-all="${all}" data-status="${statusWords[st]}"></span>`;
      }).join('');
      return `<div class="am-row"><div class="am-name">${_adaptiveEsc(topic)}</div><div class="am-cells">${cells}</div></div>`;
    }).join('');

  // Under a line at the foot of the card: what the map adds up to.
  const size = Math.min(typeof QUIZ_SIZE !== 'undefined' ? QUIZ_SIZE : 7, preds.length);
  const chances = preds.map(pr => pr.chance);
  const expected = size * chances.reduce((a, b) => a + b, 0) / chances.length;
  const drawDist = _adaptiveRandomDrawDist(chances, size, 1500, 20261127 + quizNum);
  const full = drawDist[size] || 0;
  const fullText = full < 0.005 ? '<1%' : full > 0.995 ? '>99%' : Math.round(full * 100) + '%';
  // A ring for each: the expected grade as a share of the full score, and
  // the chance of the full score.
  const ring = frac => {
    const r = 15, c = 2 * Math.PI * r, f = Math.max(0, Math.min(1, frac));
    return `<svg class="am-ring" viewBox="0 0 40 40" aria-hidden="true"><circle cx="20" cy="20" r="${r}" class="am-ring-bg"/>`
      + (f > 0 ? `<circle cx="20" cy="20" r="${r}" class="am-ring-fg" stroke-dasharray="${(f * c).toFixed(2)} ${c.toFixed(2)}" transform="rotate(-90 20 20)"/>` : '')
      + '</svg>';
  };
  const statsHtml = `<div class="am-stats">
        <div class="am-stat">${ring(expected / size)}<div><b>${expected.toFixed(1)}<small>/${size}</small></b><span>Expected grade</span></div></div>
        <div class="am-stat">${ring(full)}<div><b>${fullText}</b><span>Full score probability</span></div></div>
      </div>`;

  return `<div class="am">
      <div class="am-tiles">${tiles}</div>
      <div class="am-main">
        <div class="am-rows">${rows}</div>
        <aside class="am-side">
          <div class="am-vbar" aria-hidden="true">${vbar}</div>
          <div class="am-side-list">${sideList}<div class="am-side-marks">${marks}</div></div>
        </aside>
      </div>
      <div class="am-foot-marks">${marks}</div>
      ${statsHtml}
    </div>`;
}

// The chip on a card picked by Adaptive ML: its group on the chance map
// (Hard ... Very likely), in the map's colours. Tapping it opens the reason
// line under the header (adaptiveWhyHtml); a chip with no reason is a label.
function adaptiveChipHtml(p) {
  if (!p || p._adaptiveChance == null) return '';
  const bin = _adaptiveBin(p._adaptiveChance);
  const label = ADAPTIVE_BINS[bin].label.replace(' for you', '');
  if (!p._adaptiveWhy) return `<span class="adaptive-chip ac-b${bin}">${label}</span>`;
  return `<button type="button" class="adaptive-chip ac-b${bin}" aria-expanded="false" title="${p._adaptiveWhy}">${label}</button>`;
}
function adaptiveWhyHtml(p) {
  if (!p || p._adaptiveChance == null || !p._adaptiveWhy) return '';
  return `<div class="adaptive-why-fold"><div class="adaptive-why-inner"><div class="adaptive-why">${p._adaptiveWhy}</div></div></div>`;
}
document.addEventListener('click', (e) => {
  const chip = e.target.closest && e.target.closest('button.adaptive-chip');
  if (!chip) return;
  const card = chip.closest('.problem-card');
  const fold = card && card.querySelector('.adaptive-why-fold');
  if (!fold) return;
  const open = !fold.classList.contains('open');
  fold.classList.toggle('open', open);
  chip.setAttribute('aria-expanded', String(open));
});

// The hover box of the chance map: problem and topic, its group, your chance
// and that of students overall (share solving it the first time), and what
// you did with it. Follows a mouse pointer; a tap shows it on touch screens
// and the next tap elsewhere hides it.
let _adaptiveMapTip = null;
function _adaptiveMapTipShow(cell, x, y) {
  if (!_adaptiveMapTip) {
    _adaptiveMapTip = document.createElement('div');
    _adaptiveMapTip.className = 'am-tip';
    _adaptiveMapTip.setAttribute('aria-hidden', 'true');
    document.body.appendChild(_adaptiveMapTip);
  }
  const d = cell.dataset;
  _adaptiveMapTip.innerHTML = `<div class="am-tip-head"><b>P${_adaptiveEsc(d.num)}</b> | ${_adaptiveEsc(d.topic)}</div>
    <div class="am-tip-group"><i class="am-key ${[...cell.classList].find(c => /^am-b\d$/.test(c)) || ''}"></i>${_adaptiveEsc(d.group)}</div>
    <div class="am-tip-row"><span>Your chance</span><b>${_adaptiveEsc(d.you)}</b></div>
    ${d.all ? `<div class="am-tip-row"><span>Students overall</span><b>${_adaptiveEsc(d.all)}</b></div>` : ''}
    <div class="am-tip-status">${_adaptiveEsc(d.status)}</div>`;
  _adaptiveMapTip.classList.add('visible');
  const w = _adaptiveMapTip.offsetWidth, h = _adaptiveMapTip.offsetHeight;
  let left = x + 14, top = y + 14;
  if (left + w > window.innerWidth - 8) left = x - w - 14;
  if (top + h > window.innerHeight - 8) top = y - h - 14;
  _adaptiveMapTip.style.left = Math.max(8, left) + 'px';
  _adaptiveMapTip.style.top = Math.max(8, top) + 'px';
}
function _adaptiveMapTipHide() { if (_adaptiveMapTip) _adaptiveMapTip.classList.remove('visible'); }

document.addEventListener('pointermove', (e) => {
  if (e.pointerType === 'touch') return;
  const cell = e.target.closest && e.target.closest('.am-cell');
  if (cell) _adaptiveMapTipShow(cell, e.clientX, e.clientY); else _adaptiveMapTipHide();
}, { passive: true });
document.addEventListener('pointerdown', (e) => {
  if (e.pointerType !== 'touch') return;
  const cell = e.target.closest && e.target.closest('.am-cell');
  if (cell) {
    const r = cell.getBoundingClientRect();
    _adaptiveMapTipShow(cell, r.right, r.bottom);
  } else _adaptiveMapTipHide();
}, { passive: true });
window.addEventListener('scroll', () => { _adaptiveMapTipHide(); }, { passive: true });
