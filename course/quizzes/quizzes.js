// ─── Quiz set registry ────────────────────────────────────────────────────────
// To add a new quiz:
//   1. Add its problem bank to course/quizzes/quizN.js
//   2. Load that file in index.html (before quizzes.js)
//   3. Set enabled: true and point problems: to the array
//
// ─── Problem ids vs. problem numbers ─────────────────────────────────────────
// Every problem has an `id` ("P1", "P47", ...). The id is the PERMANENT key
// under which all history is stored (attempts, Solve-All progress, forum
// threads, math cache). It is never shown to users and it never has to match
// the problem's position — so problems can be reordered and new ones inserted
// anywhere without touching anybody's history.
//
// What users SEE ("P12") is the problem's current 1-based position in the
// quiz's `problems` array — see problemLabel() below.
//
// Rules:
//   • An id is unique within its quiz, and is NEVER reused for a different
//     problem, even after the original is removed.
//   • To stop serving a problem (Random quiz / Solve-All / pickers) but keep it
//     openable from attempt review, forum threads and stats: MOVE its object,
//     unchanged, from Quiz_N_Problems to Quiz_N_Retired (same file). It then
//     shows as "DEL" everywhere. Moving it back restores its attempt history and forum thread (Solve-All progress is not kept while retired).
//   • Never delete a problem object outright if anyone may have attempted it.
//   • New problem: give it a fresh id (next unused number) and put it at the
//     position you want it to appear at.
const QUIZZES = [
  { name: "Kinematics & Dynamics", problems: Quiz_1_Problems, retired: (typeof Quiz_1_Retired !== "undefined" ? Quiz_1_Retired : []), enabled: true  },
  { name: "Energy, Momentum & Rotation", problems: Quiz_2_Problems, retired: (typeof Quiz_2_Retired !== "undefined" ? Quiz_2_Retired : []), enabled: true },
  { name: "Gravity and Waves",       problems: Quiz_3_Problems, retired: (typeof Quiz_3_Retired !== "undefined" ? Quiz_3_Retired : []), enabled: true },
  { name: "",       problems: Quiz_4_Problems, retired: (typeof Quiz_4_Retired !== "undefined" ? Quiz_4_Retired : []), enabled: false },
];

// ─── Problem lookup + display helpers ────────────────────────────────────────
// Everything that turns a stored (quizNum, problemId) back into something
// visible goes through these, so the id→number mapping lives in ONE place.
// quizNum is 1-based, matching QUIZZES[quizNum - 1] and "q2_P18" forum keys.
//
// Built once at load: QUIZZES is static for the page's lifetime.
const _problemIndex = QUIZZES.map((q) => {
  const number  = new Map();  // active id -> 1-based position
  const byId    = new Map();  // active + retired id -> problem object
  const retired = new Set();  // retired ids
  (q.problems || []).forEach((p, i) => { number.set(p.id, i + 1); byId.set(p.id, p); });
  (q.retired  || []).forEach((p)    => { retired.add(p.id); if (!byId.has(p.id)) byId.set(p.id, p); });
  return { number, byId, retired };
});

// 1-based position of an ACTIVE problem, or null (retired / unknown id).
function problemNumber(quizNum, problemId) {
  const ix = _problemIndex[quizNum - 1];
  return (ix && ix.number.get(problemId)) || null;
}

// The problem object for an id — active first, then retired, else null.
// Use this wherever a stored id must resolve back to content (attempt review,
// forum context panel). Use QUIZZES[n].problems when you want only what is
// currently being served.
function getQuizProblem(quizNum, problemId) {
  const ix = _problemIndex[quizNum - 1];
  return (ix && ix.byId.get(problemId)) || null;
}

// True for an id that is not an active problem (retired, or removed outright).
function isProblemRetired(quizNum, problemId) {
  return problemNumber(quizNum, problemId) === null;
}

// What the user sees: "P12" for an active problem, "DEL" otherwise.
function problemLabel(quizNum, problemId) {
  const n = problemNumber(quizNum, problemId);
  return n === null ? "DEL" : "P" + n;
}

// Load-time sanity check (console only, never throws): catches the two
// mistakes that would silently corrupt history if they ever shipped.
(function validateProblemIds() {
  QUIZZES.forEach((q, qi) => {
    const seen = new Set();
    [["problems", q.problems || []], ["retired", q.retired || []]].forEach(([where, list]) => {
      list.forEach((p) => {
        if (!p || typeof p.id !== "string" || !p.id) {
          console.error(`[quizzes] Quiz ${qi + 1} ${where}: problem without a string id`, p);
        } else if (seen.has(p.id)) {
          console.error(`[quizzes] Quiz ${qi + 1}: id "${p.id}" appears more than once (problems/retired) — history would be shared between two problems.`);
        } else {
          seen.add(p.id);
        }
      });
    });
  });
})();
