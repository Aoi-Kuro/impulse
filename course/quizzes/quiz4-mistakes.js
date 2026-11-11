// Common wrong answers for Quiz 4. Same format as quiz3-mistakes.js:
//
//   v  the wrong value, in the problem's answer unit (matched within ±1%,
//      at any power of ten; see matchMistake)
//   s  how that value is shown, in LaTeX
//   n  the reason: quick to read, clear even to someone who did not make
//      the mistake, and never the correct final answer
//   c  how many students entered it, which sets the order (0 = a known
//      trap in the wording, added before any attempts were counted)
//
// Keyed by problem id, like the rest of the course data, so renumbering
// or retiring a problem never moves a note.
const Quiz_4_Mistakes = {
  // P74
  P74: [
    { v: 1.01866798509978, s: "$1.019$", n: "40 trips across 6 m really make 480 m, but the problem says to use 240 m in total", c: 0 },
  ],
};
