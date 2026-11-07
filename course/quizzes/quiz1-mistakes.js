// Common wrong answers for Quiz 1, from the attempts up to 7 Nov 2026.
// Each mistake was recomputed from the problem's own numbers and matched
// to what at least 2 students typed. js/common-mistakes.js shows them.
// A problem's mistakes are in order, most common first.
//
//   v     the wrong value, in the problem's answer unit (matched within ±1%,
//         at any power of ten; see matchMistake)
//   s     how that value is shown, in LaTeX
//   n     the reason: quick to read, clear even to someone who did not make
//         the mistake, and never the correct final answer
//   c     how many students entered it, which sets the order
//   flip  a sign slip: the right number with the sign reversed, so only
//         that sign matches
//
// Keyed by problem id, like the rest of the course data, so renumbering
// or retiring a problem never moves a note.
const Quiz_1_Mistakes = {
  // P2
  P2: [
    { v: 0.00546415, s: "$0.005464$", n: "That is in kg/cm³. Use the mass in grams", c: 2 },
    { v: 5.46415e-06, s: "$5.46\\times10^{-6}$", n: "The digits are right, but the power of ten is off", c: 2 },
  ],
  // P4
  P4: [
    { v: 2.032e-09, s: "$2.03\\times10^{-9}$", n: "This is already in seconds. In ns the $10^{-9}$ goes", c: 2 },
  ],
  // P6
  P6: [
    { v: 563.168, s: "$563.2$", n: "1 ft² is 0.0929 m², so multiply by it, don't divide", c: 2 },
  ],
  // P9
  P9: [
    { v: 0.00515464, s: "$0.005155$", n: "Use the same unit for both: 970 km is 970000 m", c: 2 },
  ],
  // P12
  P12: [
    { v: 0.03, s: "$0.03$", n: "A perimeter has two lengths and two widths, so double it", c: 2 },
  ],
  // P14
  P14: [
    { v: 4523.89, s: "$4524$", n: "The number is in cm², not m²", c: 2 },
  ],
  // P15
  P15: [
    { v: 18.3982, s: "$18.4$", n: "Put the vectors tail to tail to read the angle between them", c: 2 },
  ],
  // P22
  P22: [
    { v: 83.9597, s: "$83.96$", n: "The calculator was in radians. The angle is in degrees", c: 2 },
  ],
  // P23
  P23: [
    { v: 1.08952, s: "$1.09$", n: "The dot product is negative, so the angle is over 90°", c: 3 },
  ],
  // P27
  P27: [
    { v: 1.46585, s: "$1.466$", n: "A cross product gives $\\sin\\theta$, not $\\cos\\theta$", c: 2 },
  ],
  // P31
  P31: [
    { v: 3.16456, s: "$3.165$", n: "This is the acceleration in the first 4 s. The average covers the whole race", c: 2 },
  ],
  // P33
  P33: [
    { v: 31.8622, s: "$31.86$", n: "Mixed units: convert 32 km/h to m/s first", c: 3 },
  ],
  // P35
  P35: [
    { v: 105.672, s: "$105.7$", n: "The speed is in km/h. Convert it to m/s first", c: 2 },
  ],
  // P36
  P36: [
    { v: 5.50073, s: "$5.501$", n: "The key is moving down, so both terms add", c: 2 },
  ],
  // P41
  P41: [
    { v: 24.1167, s: "$24.12$", n: "This is position over time. Velocity is $v_0+at$", c: 2 },
  ],
  // P42
  P42: [
    { v: 15.6345, s: "$15.63$", n: "This is the speed at the start. The question asks for the end", c: 2 },
  ],
  // P43
  P43: [
    { v: 6.23, s: "$6.23$", n: "This is the speed at the end. The question asks for the start", c: 5 },
  ],
  // P45
  P45: [
    { v: 2.70836, s: "$2.708$", n: "This is average speed. Average velocity uses the displacement", c: 2 },
  ],
  // P46
  P46: [
    { v: 36.8182, s: "$36.82$", n: "That is when their speeds match. Catching up needs equal distances", c: 2 },
  ],
  // P49
  P49: [
    { v: 67.5, s: "$67.5$", n: "This is only the motorist's distance. The gap subtracts the officer's", c: 5 },
    { v: 135.0, s: "$135$", n: "This is where they meet. The gap is largest when their speeds match", c: 4 },
  ],
  // P50
  P50: [
    { v: 680.0, s: "$680$", n: "This is $v^2$. Take the square root", c: 2 },
  ],
  // P54
  P54: [
    { v: 3.34664, s: "$3.347$", n: "His heading and the river are perpendicular, so the squares add", c: 3 },
  ],
  // P55
  P55: [
    { v: 4.70106, s: "$4.701$", n: "To go due east he points upstream, so 4.3 is the hypotenuse", c: 3 },
  ],
  // P56
  P56: [
    { v: 221.141, s: "$221.1$", n: "Only the speed across the river counts. The current doesn't help", c: 2 },
  ],
  // P58
  P58: [
    { v: 925.425, s: "$925.4$", n: "This is the whole path. Downstream is only the south part", c: 2 },
  ],
  // P60
  P60: [
    { v: 10793.7, s: "$10794$", n: "Gravity is missing: subtract $\\frac12gt^2$", c: 3 },
  ],
  // P63
  P63: [
    { v: 111.262, s: "$111.3$", n: "It is thrown downward, so the two parts add", c: 3 },
  ],
  // P69
  P69: [
    { v: 3.08008, s: "$3.08$", n: "This is only the horizontal speed. It also falls", c: 2 },
  ],
  // P72
  P72: [
    { v: 90.722, s: "$90.72$", n: "This is the distance from the origin. The question asks for $x$ only", c: 2 },
  ],
  // P76
  P76: [
    { v: 107.538, s: "$+107.54$", n: "The fish ends on the negative side, so keep the minus sign", c: 3, flip: 1 },
  ],
  // P77
  P77: [
    { v: 223.077, s: "$223.1$", n: "Add the starting position: $y_i=4$ m", c: 2 },
  ],
  // P78
  P78: [
    { v: 75.6, s: "$75.6$", n: "This is only $x$. The distance also needs $y$", c: 4 },
  ],
  // P79
  P79: [
    { v: 382.991, s: "$383$", n: "The starting velocity is along $\\hat{i}$ only", c: 2 },
  ],
  // P81
  P81: [
    { v: 0.446607, s: "$0.4466$", n: "Both parts are squared: $a=\\sqrt{a_t^2+a_c^2}$", c: 2 },
  ],
  // P83
  P83: [
    { v: 1452.33, s: "$1452$", n: "49 s is a full circle. The semicircle comes earlier", c: 2 },
  ],
  // P85
  P85: [
    { v: 16.5509, s: "$16.55$", n: "The radius is 68 cm, which is 0.68 m", c: 2 },
  ],
  // P88
  P88: [
    { v: 0.122449, s: "$0.1224$", n: "Friction also supplies the centripetal part, which grows with speed", c: 2 },
  ],
  // P92
  P92: [
    { v: 1.44441, s: "$1.444$", n: "Missing $\\tan\\theta$: $v^2=gR\\tan\\theta$", c: 3 },
    { v: 7.21, s: "$7.21$", n: "The string is 88 cm, which is 0.88 m", c: 2 },
  ],
  // P98
  P98: [
    { v: 21.9388, s: "$21.94$", n: "The pull lifts a little, so $N=mg-F\\sin\\theta$", c: 5 },
  ],
  // P99
  P99: [
    { v: 560.778, s: "$560.8$", n: "This is the contact force. $F$ also has to accelerate $m_1$", c: 2 },
  ],
  // P102
  P102: [
    { v: 39.0515, s: "$39.05$", n: "The vertical part of $F$ is $F\\sin\\theta$", c: 2 },
  ],
  // P103
  P103: [
    { v: 41.3208, s: "$41.32$", n: "The rod pushes down, so it adds to the normal force", c: 3 },
  ],
  // P105
  P105: [
    { v: 1197.78, s: "$1198$", n: "This is the weight on Earth. Mass is the same everywhere", c: 4 },
  ],
  // P111
  P111: [
    { v: 5.68, s: "$5.68$", n: "It accelerates upward, so use $g+a$", c: 2 },
  ],
  // P117
  P117: [
    { v: 22.385, s: "$22.39$", n: "The scale reading already includes gravity: subtract $g$", c: 3 },
  ],
  // P120
  P120: [
    { v: 1.12339, s: "$1.123$", n: "That uses A's mass. The question is about B", c: 2 },
  ],
  // P121
  P121: [
    { v: 8272.39, s: "$8272$", n: "With 4200 N in the 40° rope the other rope breaks. It reaches the limit first", c: 2 },
  ],
  // P124
  P124: [
    { v: 190.0, s: "$190$", n: "It accelerates, so the pull must also supply $ma$", c: 2 },
  ],
  // P126
  P126: [
    { v: 4.30407, s: "$4.304$", n: "The angle is from the vertical, so use $\\cos73°$", c: 2 },
    { v: 7.8723, s: "$7.872$", n: "The two ends share the weight: $2T\\cos\\theta=mg$", c: 2 },
  ],
  // P127
  P127: [
    { v: 276.582, s: "$276.6$", n: "The calculator was in radians. The angle is in degrees", c: 2 },
  ],
  // P128
  P128: [
    { v: 82.6921, s: "$82.69$", n: "Moving down, friction points up the plane, so it subtracts", c: 6 },
  ],
  // P130
  P130: [
    { v: 114.704, s: "$114.7$", n: "This is only friction. The tension also holds $mg\\sin\\alpha$", c: 2 },
    { v: 162.259, s: "$162.3$", n: "This is the hanging mass. The tension is $m_2g$", c: 2 },
  ],
  // P135
  P135: [
    { v: 1.056, s: "$1.056$", n: "Block A also rubs on B: add its friction", c: 5 },
    { v: 0.792, s: "$0.792$", n: "The floor carries both blocks, and A also rubs on B", c: 4 },
  ],
  // P138
  P138: [
    { v: 12.2209, s: "$12.22$", n: "This is the force $F$. The normal force is its horizontal part", c: 3 },
  ],
  // P140
  P140: [
    { v: 81.4163, s: "$81.42$", n: "This divides by $g$. The reading here is a force, in newtons", c: 2 },
    { v: 200.08, s: "$200.1$", n: "This is only $ma$. The scale also carries the weight", c: 2 },
  ],
  // P141
  P141: [
    { v: 25.5299, s: "$25.53$", n: "The angle is from the ceiling. Use the one from the vertical", c: 4 },
  ],
  // P142
  P142: [
    { v: 16.6371, s: "$16.64$", n: "The angle is from the vertical, so $a=g\\tan\\theta$", c: 2 },
  ],
  // P144
  P144: [
    { v: 110.27, s: "$110.3$", n: "At this point gravity also points to the centre, so the wall pushes less", c: 3 },
  ],
  // P150
  P150: [
    { v: 522.457, s: "$522.5$", n: "At the bottom of a valley the cart curves up, so add $v^2/R$", c: 2 },
  ],
};
