// Handouts students were given during an exam, keyed by quiz number.
// js/handout.js puts a button right after the number of every problem of
// that quiz (in a mixed quiz too) and shows the handout over the page, at
// any time, a Random quiz attempt included: it was allowed in the exam.
//
//   title    shown at the top of the handout and on the button's tooltip
//   note     one line under the title
//   image    the original handout, shown while Settings › Study › Redrawn
//            figures is off
//   figures  the REDRAWN_FIGURES set holding the drawings (course/figures/,
//            made by tools/figures/<figures>.py)
//   items    the handout's entries in reading order: the drawing's name in
//            that set, what the body is, and its formula in LaTeX
const QUIZ_HANDOUTS = {
  2: {
    title: 'Moments of inertia',
    note: 'The table handed out in the exam. Every axis passes through the centre of mass, except the rod turning about its end.',
    image: 'course/images/quiz_2/handout-inertia.webp',
    figures: 'inertia',
    items: [
      { fig: 'hoop',            name: 'Hoop or thin cylindrical shell', formula: 'I_{\\rm CM} = MR^2' },
      { fig: 'hollow-cylinder', name: 'Hollow cylinder',                formula: 'I_{\\rm CM} = \\tfrac{1}{2}M\\left(R_1^2 + R_2^2\\right)' },
      { fig: 'solid-cylinder',  name: 'Solid cylinder or disk',         formula: 'I_{\\rm CM} = \\tfrac{1}{2}MR^2' },
      { fig: 'plate',           name: 'Rectangular plate',              formula: 'I_{\\rm CM} = \\tfrac{1}{12}M\\left(a^2 + b^2\\right)' },
      { fig: 'rod-center',      name: 'Long, thin rod, axis through its centre', formula: 'I_{\\rm CM} = \\tfrac{1}{12}ML^2' },
      { fig: 'rod-end',         name: 'Long, thin rod, axis through one end',    formula: 'I = \\tfrac{1}{3}ML^2' },
      { fig: 'solid-sphere',    name: 'Solid sphere',                   formula: 'I_{\\rm CM} = \\tfrac{2}{5}MR^2' },
      { fig: 'thin-shell',      name: 'Thin spherical shell',           formula: 'I_{\\rm CM} = \\tfrac{2}{3}MR^2' },
    ],
  },
};
