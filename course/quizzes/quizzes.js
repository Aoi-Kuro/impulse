// ─── Quiz set registry ────────────────────────────────────────────────────────
// To add a new quiz:
//   1. Add its problem bank to course/quizzes/quizN.js
//   2. Load that file in index.html (before quizzes.js)
//   3. Set enabled: true and point problems: to the array
const QUIZZES = [
  { name: "Kinematics & Dynamics", problems: Quiz_1_Problems, enabled: true  },
  { name: "", problems: Quiz_2_Problems, enabled: false },
  { name: "",       problems: Quiz_3_Problems, enabled: false },
  { name: "",       problems: Quiz_4_Problems, enabled: false },
];
