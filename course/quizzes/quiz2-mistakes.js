// Common wrong answers for Quiz 2, from the attempts up to 7 Nov 2026.
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
const Quiz_2_Mistakes = {
  // P2
  P2: [
    { v: 101.286, s: "$101.3$", n: "The calculator was in radians. The angle is in degrees", c: 2 },
  ],
  // P4
  P4: [
    { v: 6.15752, s: "$6.158$", n: "Only the height gained counts, not the length of the arc", c: 2 },
  ],
  // P5
  P5: [
    { v: 14.3162, s: "$14.32$", n: "Only the height gained counts, not the length of the arc", c: 5 },
    { v: 9.114, s: "$+9.114$", n: "Gravity points down while the particle rises, so its work is negative", c: 4, flip: 1 },
  ],
  // P6
  P6: [
    { v: 5.9535, s: "$5.954$", n: "Missing the $\\frac12$: the spring force grows from zero", c: 2 },
    { v: 132.3, s: "$132.3$", n: "This is the force at full stretch. Work is $\\frac12kx^2$", c: 2 },
  ],
  // P7
  P7: [
    { v: 31.6327, s: "$31.63$", n: "The spring force grows from zero, so $W=\\frac12mgx$, not $mgx$", c: 3 },
  ],
  // P8
  P8: [
    { v: 10.6502, s: "$10.65$", n: "The spring force grows from zero, so $W=\\frac12mgx$, not $mgx$", c: 6 },
  ],
  // P10
  P10: [
    { v: 73125.0, s: "$+73125$", n: "Friction acts against the motion, so its work is negative", c: 9, flip: 1 },
  ],
  // P11
  P11: [
    { v: 62.5133, s: "$62.51$", n: "The calculator was in radians. The angle is in degrees", c: 3 },
  ],
  // P12
  P12: [
    { v: 447.368, s: "$447.4$", n: "$F$ acts along the ramp, so no cosine is needed", c: 3 },
  ],
  // P13
  P13: [
    { v: 190.796, s: "$+190.8$", n: "Friction acts against the motion, so its work is negative", c: 8, flip: 1 },
    { v: 216.09, s: "$216.1$", n: "On a ramp the normal force is $mg\\cos\\theta$, not $mg$", c: 5 },
    { v: 545.132, s: "$545.1$", n: "This is normal force times distance. Friction is $\\mu_kN$", c: 2 },
  ],
  // P14
  P14: [
    { v: 372.496, s: "$-372.5$", n: "The question asks for the magnitude, so no minus sign", c: 2, flip: 1 },
  ],
  // P15
  P15: [
    { v: 16767.6, s: "$16768$", n: "Missing the $\\frac12$: $Fd=\\frac12mv^2$", c: 3 },
  ],
  // P16
  P16: [
    { v: 0.000813492, s: "$8.13\\times10^{-4}$", n: "It starts from rest, so its average speed is $v/2$", c: 3 },
  ],
  // P18
  P18: [
    { v: 11520000000.0, s: "$1.15\\times10^{10}$", n: "The speed is in km/s. Convert it to m/s first", c: 4 },
  ],
  // P19
  P19: [
    { v: 1.93355e-19, s: "$1.93\\times10^{-19}$", n: "At the same speed, the heavier proton has more energy", c: 2 },
  ],
  // P20
  P20: [
    { v: 7.8948e-13, s: "$7.89\\times10^{-13}$", n: "At the same momentum $K=p^2/2m$, so the heavier proton has less", c: 2 },
    { v: 2.34205, s: "$2.342$", n: "The value is right, but the power of ten was dropped", c: 2 },
  ],
  // P21
  P21: [
    { v: 42848.6, s: "$42849$", n: "Only the mass ratio goes under the root, not the speed", c: 4 },
  ],
  // P22
  P22: [
    { v: 29.9564, s: "$29.96$", n: "At the same momentum the lighter electron is faster", c: 2 },
  ],
  // P23
  P23: [
    { v: 127.138, s: "$127.1$", n: "Work is a scalar. Add the $x$ and $y$ parts, don't combine them like a vector", c: 4 },
  ],
  // P24
  P24: [
    { v: 16.7882, s: "$16.79$", n: "Subtract the velocities as vectors first, then take the magnitude", c: 5 },
  ],
  // P25
  P25: [
    { v: 3.64769, s: "$3.648$", n: "The push is horizontal, so only $F\\cos\\theta$ acts along the ramp", c: 3 },
  ],
  // P26
  P26: [
    { v: 32498.7, s: "$32499$", n: "The engine also lifts the block: add $mg\\sin\\theta$ to friction", c: 3 },
    { v: 17684.8, s: "$17685$", n: "This is the force. Power is $P=Fv$", c: 2 },
  ],
  // P29
  P29: [
    { v: 135689.0, s: "$1.36\\times10^{5}$", n: "This is the energy for a whole day. Power divides it by the time", c: 3 },
  ],
  // P30
  P30: [
    { v: 0.00432, s: "$0.00432$", n: "This is $U$. The force is $F=-dU/dx$", c: 2 },
    { v: 0.0216, s: "$0.0216$", n: "Missing the 4: the derivative of $x^4$ is $4x^3$", c: 2 },
  ],
  // P31
  P31: [
    { v: 7.4217, s: "$-7.4217$", n: "A conservative force does $W=U_1-U_2$, so mind the order", c: 6, flip: 1 },
    { v: 3.80666, s: "$3.807$", n: "Use $x_1^4-x_2^4$, not $(x_1-x_2)^4$", c: 2 },
    { v: 22.7656, s: "$22.77$", n: "No derivative is needed: the work is the change in $U$", c: 2 },
  ],
  // P32
  P32: [
    { v: 105.0, s: "$+105$", n: "$\\Delta U=-W$: the force does positive work, so $U$ falls", c: 2, flip: 1 },
  ],
  // P33
  P33: [
    { v: 112.0, s: "$-112$", n: "The force points along the motion, so its work is positive", c: 2, flip: 1 },
    { v: 14.0, s: "$14$", n: "This is the change in force. Work is the area under $F(x)$", c: 2 },
  ],
  // P34
  P34: [
    { v: 349.867, s: "$+349.87$", n: "$U=-\\int F\\,dx$, so mind the minus sign", c: 10, flip: 1 },
    { v: 115.2, s: "$115.2$", n: "This is the force at 8 m. $U$ comes from integrating $F$", c: 2 },
  ],
  // P37
  P37: [
    { v: 8.365, s: "$8.365$", n: "This is the heavier block. The question asks for the lighter one", c: 2 },
  ],
  // P39
  P39: [
    { v: 6.26099, s: "$6.261$", n: "The bucket isn't in free fall: it also drags the box", c: 4 },
    { v: 4.64327, s: "$4.643$", n: "The masses differ, so $a\\ne g(1-\\mu_k)$. Use energy with all the moving mass", c: 2 },
  ],
  // P41
  P41: [
    { v: 1.20044, s: "$1.2$", n: "The spring is on the flat part, so the block hasn't climbed yet", c: 2 },
  ],
  // P44
  P44: [
    { v: 2.97739, s: "$2.977$", n: "This uses the energy friction took. The speed comes from the energy left", c: 5 },
    { v: 1.88307, s: "$1.883$", n: "Energy, not speed, falls in step with distance", c: 2 },
  ],
  // P45
  P45: [
    { v: 2.71946, s: "$2.719$", n: "This uses the energy friction took. The speed comes from the energy left", c: 4 },
    { v: 7.39545, s: "$7.395$", n: "That is $v^2$, not $v$, and it uses the energy friction took", c: 2 },
  ],
  // P48
  P48: [
    { v: 19.2977, s: "$19.3$", n: "This is the speed. The question asks for kinetic energy", c: 5 },
  ],
  // P51
  P51: [
    { v: 0.189844, s: "$0.1898$", n: "Missing $\\mu_k$: friction is $\\mu_kmg$", c: 2 },
    { v: 1.58203, s: "$1.582$", n: "Missing the $\\frac12$: the spring stores $\\frac12kx^2$", c: 2 },
  ],
  // P53
  P53: [
    { v: 6.82492, s: "$6.825$", n: "This is the first bounce. The second starts from 64% of the height", c: 4 },
    { v: 11.1929, s: "$11.19$", n: "This adds both bounces. The question asks about the second only", c: 3 },
    { v: 7.76524, s: "$7.765$", n: "This is the energy left after the second bounce, not the energy lost", c: 2 },
  ],
  // P55
  P55: [
    { v: 12.9074, s: "$12.91$", n: "This is the speed at the top. At the bottom it has dropped $2R$ more", c: 3 },
  ],
  // P56
  P56: [
    { v: 12.9103, s: "$12.91$", n: "Friction's work needs the distance along the slope: $d=h/\\sin\\theta$", c: 3 },
    { v: 10.0097, s: "$10.01$", n: "On a slope the normal force is $mg\\cos\\theta$, not $mg$", c: 2 },
  ],
  // P57
  P57: [
    { v: 12.809, s: "$12.81$", n: "Friction is missing. It takes energy too", c: 5 },
    { v: 17.579, s: "$17.58$", n: "Friction and gravity both slow the rock, so they add", c: 2 },
  ],
  // P58
  P58: [
    { v: 34.0059, s: "$34.01$", n: "The block must get over the 79 m top and then clear the pit", c: 2 },
  ],
  // P59
  P59: [
    { v: 21.6887, s: "$21.69$", n: "This is only the speed the height costs: $v^2=v_0^2-2gh$", c: 2 },
  ],
  // P60
  P60: [
    { v: 583.052, s: "$583.1$", n: "At the lowest point the jumper is at rest, so the speed falls to zero", c: 3 },
  ],
  // P61
  P61: [
    { v: 196.52, s: "$196.5$", n: "It bounces back, so the normal velocity changes by $2v\\cos\\theta$", c: 2 },
    { v: 680.16, s: "$680.2$", n: "Only the part of the velocity along the normal changes", c: 2 },
  ],
  // P62
  P62: [
    { v: 389.4, s: "$389.4$", n: "It bounces back, so its velocity changes by $2v$, not $v$", c: 3 },
  ],
  // P63
  P63: [
    { v: 1.674, s: "$1.674$", n: "It bounces back, so its velocity changes by $2v$, not $v$", c: 4 },
  ],
  // P64
  P64: [
    { v: 3.68164, s: "$3.682$", n: "These bullets stop and don't bounce, so each changes by $v$, not $2v$", c: 3 },
  ],
  // P65
  P65: [
    { v: 0.0694242, s: "$0.06942$", n: "The ball reverses direction, so the two speeds add", c: 7 },
    { v: 0.308, s: "$0.308$", n: "This is only the fall. The rebound speed adds to it", c: 3 },
  ],
  // P66
  P66: [
    { v: 0.264758, s: "$0.2648$", n: "Missing the 2: $v=\\sqrt{2gh}$", c: 2 },
    { v: 3.74425, s: "$3.744$", n: "The mass is 51 g, which is 0.051 kg", c: 2 },
  ],
  // P67
  P67: [
    { v: 41.3, s: "$41.3$", n: "The ball reverses direction, so the two speeds add", c: 3 },
    { v: 264.449, s: "$264.4$", n: "Add the two speeds, not the two heights", c: 2 },
  ],
  // P70
  P70: [
    { v: 2.82975, s: "$2.83$", n: "This is the energy lost. Impulse is the change in momentum", c: 2 },
  ],
  // P71
  P71: [
    { v: 1.69344, s: "$1.693$", n: "This is the energy lost in joules. The question asks for a fraction", c: 5 },
    { v: 1.19048, s: "$1.19$", n: "This is $h_1/h_2$. The fraction lost is $1-h_2/h_1$", c: 2 },
  ],
  // P72
  P72: [
    { v: 25.1166, s: "$25.12$", n: "The hit loses energy. Use momentum for the hit, energy for the swing", c: 5 },
    { v: 5546.55, s: "$5547$", n: "The height is 6.6 cm, which is 0.066 m", c: 2 },
  ],
  // P73
  P73: [
    { v: 0.0452597, s: "$0.04526$", n: "The speed is squared: $h=v^2/2g$", c: 3 },
  ],
  // P77
  P77: [
    { v: 2.28, s: "$2.28$", n: "That is a sticking collision. An elastic one bounces", c: 3 },
    { v: 4.56, s: "$4.56$", n: "This is the speed of $M_2$. The question asks for $M_1$", c: 2 },
  ],
  // P80
  P80: [
    { v: 5.21569, s: "$5.216$", n: "Momentum adds as vectors, part by part, not by magnitudes", c: 2 },
  ],
  // P83
  P83: [
    { v: 0.24142, s: "$0.2414$", n: "The combined mass is on both sides of the energy equation, so it cancels", c: 2 },
  ],
  // P84
  P84: [
    { v: 2.717, s: "$+2.717$", n: "Towards the Station is positive, and she moves away", c: 2, flip: 1 },
  ],
  // P85
  P85: [
    { v: 2.97317, s: "$-2.9732$", n: "The question asks for a speed, which has no sign", c: 4, flip: 1 },
  ],
  // P87
  P87: [
    { v: 14.8333, s: "$-14.833$", n: "The question asks for a speed, which has no sign", c: 2, flip: 1 },
    { v: 133.5, s: "$133.5$", n: "The heavier piece moves slower: $m_1v_1=m_2v_2$", c: 2 },
  ],
  // P89
  P89: [
    { v: 36.0454, s: "$36.05$", n: "The angle is from south, so the west part is $p\\sin\\theta$", c: 2 },
  ],
  // P91
  P91: [
    { v: 51.2954, s: "$51.3$", n: "The angle is from south, so the south part is $p\\cos\\theta$", c: 5 },
  ],
  // P92
  P92: [
    { v: 0.0112068, s: "$0.01121$", n: "The exhaust speed is in km/s, so this number is in km/s, not m/s", c: 8 },
  ],
  // P94
  P94: [
    { v: 3.56931, s: "$3.569$", n: "Use $Mg\\frac{L}{2}=\\frac12I\\omega^2$ with $I=\\frac13ML^2$", c: 3 },
    { v: 5.04777, s: "$5.048$", n: "That is a point mass falling $L$. The stick rotates, and its centre falls $L/2$", c: 3 },
    { v: 4.75556, s: "$4.756$", n: "This is $\\omega$. The end's speed is $\\omega L$", c: 2 },
    { v: 8.743, s: "$8.743$", n: "The centre of mass falls $L/2$, not $L$", c: 2 },
  ],
  // P96
  P96: [
    { v: 0.879767, s: "$0.8798$", n: "A sphere's area is $4\\pi R^2$, not $\\pi R^2$", c: 3 },
    { v: 1.3897, s: "$1.39$", n: "A thin shell has $I=\\frac23mR^2$, not $mR^2$", c: 2 },
  ],
  // P97
  P97: [
    { v: 0.1927, s: "$0.1927$", n: "The digits are right, but the power of ten is off", c: 3 },
  ],
  // P98
  P98: [
    { v: 3.6995, s: "$3.7$", n: "This is the radius. The question asks for the diameter", c: 2 },
  ],
  // P99
  P99: [
    { v: 21.831, s: "$21.83$", n: "Centripetal acceleration is $\\omega^2R$, not $\\omega^2/R$", c: 2 },
    { v: 241.802, s: "$241.8$", n: "A disk has $I=\\frac12MR^2$, not $MR^2$", c: 2 },
  ],
  // P101
  P101: [
    { v: 2.55548, s: "$2.555$", n: "Only the small object goes down. The disk's centre stays at the axis", c: 2 },
  ],
  // P102
  P102: [
    { v: 2.58065, s: "$2.581$", n: "Only the small object makes a torque. The disk's weight acts at the axis", c: 2 },
    { v: 1.19136, s: "$1.191$", n: "No square root here: $\\alpha=\\tau/I$", c: 2 },
  ],
  // P103
  P103: [
    { v: 21.66, s: "$21.66$", n: "The mass sits close to this axis. Integrate $x^2\\,dm$ for a triangle", c: 2 },
  ],
  // P104
  P104: [
    { v: 31.2341, s: "$31.23$", n: "The speed is in rev/s. Energy needs rad/s", c: 2 },
    { v: 2466.14, s: "$2466$", n: "Missing the $\\frac12$: $K=\\frac12I\\omega^2$", c: 2 },
  ],
  // P105
  P105: [
    { v: 155.739, s: "$155.7$", n: "The angular speed is squared: $K=\\frac12I\\omega^2$", c: 3 },
  ],
  // P107
  P107: [
    { v: 36.2245, s: "$36.22$", n: "71/1.4 is the average speed in the interval, not the speed at its start", c: 4 },
  ],
  // P111
  P111: [
    { v: 0.127764, s: "$0.1278$", n: "The shape isn't given, so $\\frac25MR^2$ doesn't apply. Get $I$ from energy", c: 5 },
    { v: 3.86155, s: "$3.862$", n: "Include the translational $\\frac12MV^2$ too", c: 2 },
  ],
  // P113
  P113: [
    { v: 25.1327, s: "$25.13$", n: "The angle grows as $\\omega^2$, not $\\omega$", c: 4 },
  ],
  // P116
  P116: [
    { v: 6.33, s: "$6.33$", n: "This is $\\omega$ at 3 s. The average is $\\Delta\\theta/\\Delta t$", c: 4 },
    { v: 3.165, s: "$3.165$", n: "$\\alpha$ isn't constant, so the average isn't $(\\omega_0+\\omega)/2$", c: 3 },
    { v: 2.11, s: "$2.11$", n: "The average comes from $\\theta(3)/3$, not from $\\omega$", c: 3 },
  ],
  // P117
  P117: [
    { v: 7.36, s: "$7.36$", n: "This is the average over 8 s. Take the derivative at $t=8$", c: 2 },
  ],
  // P118
  P118: [
    { v: 5.07246, s: "$5.072$", n: "This is where $\\omega$ is zero. Its maximum is where $\\alpha=0$", c: 3 },
  ],
  // P121
  P121: [
    { v: 131.584, s: "$131.6$", n: "The handle is the lever arm here, not the stone's radius", c: 2 },
    { v: 220.63, s: "$220.6$", n: "Ax friction acts at the rim, so its torque is $\\mu NR$, not $\\mu N$", c: 2 },
  ],
  // P123
  P123: [
    { v: 1.04307, s: "$1.043$", n: "Only axle friction acts here. The ax is off", c: 3 },
  ],
  // P124
  P124: [
    { v: 93.8615, s: "$93.86$", n: "The force acts at the handle, not at the rim", c: 2 },
  ],
  // P130
  P130: [
    { v: 0.2021, s: "$+0.2021$", n: "Friction slows the spin, so its torque is negative here", c: 6, flip: 1 },
  ],
  // P131
  P131: [
    { v: 0.728433, s: "$0.7284$", n: "It's a hollow shell: $I=\\frac23mR^2$, not $\\frac25mR^2$", c: 2 },
    { v: 3.84054, s: "$3.841$", n: "69 cm is the diameter. The radius is half of it", c: 2 },
  ],
  // P132
  P132: [
    { v: 0.111352, s: "$0.1114$", n: "$F_2$ and $F_3$ turn the wheel opposite ways, so subtract", c: 2 },
  ],
  // P133
  P133: [
    { v: 2.01694, s: "$2.017$", n: "The bullet ends on the surface, so it adds $mR^2$. $d$ only sets its angular momentum", c: 9 },
    { v: 19.81, s: "$19.81$", n: "The digits are right, but the power of ten is off", c: 2 },
  ],
  // P136
  P136: [
    { v: 1.09362, s: "$1.094$", n: "Sticking loses energy. Angular momentum is what stays the same", c: 4 },
  ],
  // P138
  P138: [
    { v: 3.94323, s: "$3.943$", n: "Sticking loses energy. Angular momentum is what stays the same", c: 4 },
  ],
  // P139
  P139: [
    { v: 0.27551, s: "$0.2755$", n: "The speed is squared: $h=v^2/2g$", c: 2 },
    { v: 5.95104, s: "$5.951$", n: "The ball is half the bar from the pivot: $r=L/2$", c: 2 },
  ],
  // P140
  P140: [
    { v: 2.96157, s: "$2.962$", n: "About its edge, a board has $I=\\frac13ML^2$, not $\\frac12ML^2$", c: 3 },
    { v: 17.6759, s: "$17.68$", n: "In $I$, use the full side $L$, not half of it", c: 2 },
  ],
  // P142
  P142: [
    { v: 0.0175566, s: "$0.01756$", n: "About its edge, a board has $I=\\frac13ML^2$, not $\\frac12ML^2$", c: 2 },
  ],
  // P145
  P145: [
    { v: 2.34947, s: "$2.349$", n: "This is the bar's angular speed. The question asks for the plane's angular momentum", c: 2 },
  ],
  // P146
  P146: [
    { v: 2.23438, s: "$2.234$", n: "This is just after the hit. The bar then falls and speeds up", c: 4 },
  ],
  // P147
  P147: [
    { v: 0.197754, s: "$0.1978$", n: "The speed changes as the string shortens: $mvr$ stays constant", c: 2 },
  ],
};
