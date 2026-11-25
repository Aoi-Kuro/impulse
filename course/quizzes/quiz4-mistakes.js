// Common wrong answers for Quiz 4, from the attempts up to 26 Nov 2026.
// Each mistake was recomputed from the problem's own numbers and matched
// to what at least 2 students typed. js/common-mistakes.js shows them.
// A problem's mistakes are in order, most common first.
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
  // P1
  P1: [
    { v: 2002100.0, s: "$2.002\\times10^{6}$", n: "1 kcal is 4.186 kJ, which is 4186 J. Dividing the joules by 4.186 gives a number 1000 times too big", c: 2 },
  ],
  // P2
  P2: [
    { v: 89146.3, s: "$89146$", n: "The kilo is counted twice. 1 kcal is already 4186 J, so 1840 kcal is $1840\\times4186$ J, with no extra $\\times1000$", c: 3 },
  ],
  // P3
  P3: [
    { v: 283.245, s: "$283.2$", n: "After the soup freezes, the heat still removed cools the ice below 0 °C. This adds that last drop of about 10 K instead of subtracting it", c: 4 },
    { v: 396.168, s: "$396.2$", n: "Heat is taken out, so the temperature falls. This adds $Q/(mc)$ to 21 °C, and it also skips the freezing at 0 °C", c: 2 },
    { v: 304.095, s: "$304.1$", n: "The last step starts from ice at 0 °C, not from 21 °C, and it lowers the temperature. This adds its 10 K to the starting 21 °C", c: 2 },
    { v: 267.852, s: "$267.9$", n: "Below 0 °C the soup is ice, so it cools with $c_{\\text{ice}}=2090$, not $c_{\\text{water}}$", c: 2 },
  ],
  // P6
  P6: [
    { v: 4.26375, s: "$4.264$", n: "A rise of 30.5 °C is a rise of 30.5 K. Adding 273.15 is only for a temperature itself, never for a change in temperature", c: 4 },
    { v: 2.64228, s: "$2.642$", n: "Each half of the bar is one sloping side, of length $L/2$, with the centre rising above the midpoint. This uses the whole $L$ as that side", c: 2 },
    { v: 0.931774, s: "$0.9318$", n: "With $\\delta$ the stretch of one half, $x^2=(L/2+\\delta)^2-(L/2)^2\\approx L\\delta$. This uses $(L/2)\\,\\delta$, so $x$ comes out $\\sqrt2$ times too small", c: 2 },
  ],
  // P7
  P7: [
    { v: 21.2785, s: "$21.28$", n: "Each sloping side of the triangle is half the rail, 514 m. This uses the whole 1028 m as one side", c: 3 },
    { v: 0.220198, s: "$0.2202$", n: "This is how much the rail lengthens. The height comes from the triangle: half the new length is the slope, half the old length the base", c: 2 },
  ],
  // P9
  P9: [
    { v: 0.493352, s: "$0.4934$", n: "The liquid is the 0.133 kg of water plus the ice that melts. This adds the melted ice to the 0.35 kg of ice instead", c: 3 },
  ],
  // P10
  P10: [
    { v: 0.150834, s: "$0.1508$", n: "This is the ice that melts. The question asks how much of the 0.375 kg is left", c: 5 },
  ],
  // P11
  P11: [
    { v: 0.710269, s: "$0.7103$", n: "The water cools from 83 °C to 0 °C, a drop of 83 K. This uses $83+273.15$", c: 2 },
  ],
  // P12
  P12: [
    { v: 0.0766411, s: "$0.07664$", n: "Warming the ice from −16 °C to 0 °C also takes heat, so $c_{\\text{ice}}\\cdot16$ K adds to $L_f$. Here it was subtracted", c: 2 },
  ],
  // P13
  P13: [
    { v: 29.7545, s: "$29.75$", n: "This is in °C. The question asks for the absolute temperature: add 273.15", c: 3 },
    { v: 282.805, s: "$282.8$", n: "This adds the rise to 0 °C. The ball starts at 20.1 °C", c: 2 },
  ],
  // P15
  P15: [
    { v: 0.00127172, s: "$0.001272$", n: "Kinetic energy is $\\frac12mv^2$. The $\\frac12$ is missing", c: 2 },
  ],
  // P16
  P16: [
    { v: 711.443, s: "$711.4$", n: "The container warms up with the water, so it takes heat too: its $c\\,(7.9)(3.4)$ belongs with the water's heat. Here it was added to the hot piece's side", c: 6 },
    { v: 843.792, s: "$843.8$", n: "The piece cools from 184 °C to the final 17.8 °C, not to the 14.4 °C the water started at", c: 2 },
  ],
  // P17
  P17: [
    { v: 19.1907, s: "$19.19$", n: "A rise of 17 °C is a rise of 17 K. Adding 273.15 is only for a temperature itself, never for a change in temperature", c: 6 },
  ],
  // P19
  P19: [
    { v: 139613.0, s: "$1.396\\times10^{5}$", n: "Steam turning into water gives off $L_v$, the largest part of the heat. That step is missing", c: 2 },
    { v: 544037.0, s: "$5.44\\times10^{5}$", n: "Steam cools only to 100 °C before it condenses, a drop of 47 K. This cools the steam all the way to 0 °C", c: 2 },
  ],
  // P20
  P20: [
    { v: 0.00070949, s: "$7.095\\times10^{-4}$", n: "This uses the diameter, 1.5 cm, as the radius. The radius is half of it", c: 10 },
    { v: 1.77373, s: "$1.774$", n: "This is the area in cm². 1 cm² is $10^{-4}$ m²", c: 4 },
    { v: 6.5799e-07, s: "$6.58\\times10^{-7}$", n: "This is how much the hole grows. The question asks for its new area", c: 2 },
  ],
  // P22
  P22: [
    { v: 8.82917e-05, s: "$8.829\\times10^{-5}$", n: "This is one face. A cube has 6 faces", c: 2 },
    { v: 0.000264845, s: "$2.648\\times10^{-4}$", n: "An area grows by $2\\alpha\\Delta T$, since both of its sides stretch. This uses $\\alpha\\Delta T$", c: 2 },
    { v: 5.82659e-05, s: "$5.827\\times10^{-5}$", n: "This is the change in volume. The question asks for the surface area", c: 2 },
  ],
  // P23
  P23: [
    { v: 2.65939e-05, s: "$2.659\\times10^{-5}$", n: "This uses a 10 K rise. From 44.5 °C to 55.5 °C is 11 K", c: 5 },
    { v: 0.00022572, s: "$2.257\\times10^{-4}$", n: "This uses the edge, 0.36 m, where the volume $L^3$ belongs: $\\Delta V\\approx3\\alpha L^3\\Delta T$", c: 2 },
    { v: 0.0466853, s: "$0.04669$", n: "This is the new volume. The question asks only for the increase", c: 2 },
    { v: 4.25938e-13, s: "$4.259\\times10^{-13}$", n: "This cubes the change in edge, $(\\Delta L)^3$. The volume grows by $(L+\\Delta L)^3-L^3$, about $3L^2\\Delta L$", c: 2 },
  ],
  // P25
  P25: [
    { v: 45.6237, s: "$45.62$", n: "This is in °C. The question asks for kelvins: add 273.15", c: 4 },
  ],
  // P27
  P27: [
    { v: 357484.0, s: "$3.575\\times10^{5}$", n: "This is the heat in joules. Power is that heat divided by the 1790 s", c: 3 },
  ],
  // P28
  P28: [
    { v: 0.126248, s: "$0.1262$", n: "Once melted, the ice is water. It warms from 0 °C to 33 °C with $c_{\\text{water}}$, not $c_{\\text{ice}}$", c: 5 },
    { v: 0.150323, s: "$0.1503$", n: "The melted ice also warms from 0 °C up to 33 °C. That step is missing", c: 4 },
    { v: 0.135451, s: "$0.1355$", n: "Two slips: the ice first warms from −14 °C to 0 °C, and once melted it warms with $c_{\\text{water}}$, not $c_{\\text{ice}}$", c: 3 },
    { v: 0.115702, s: "$0.1157$", n: "The ice starts at −14 °C, so it first warms to 0 °C. That step is missing", c: 2 },
  ],
  // P29
  P29: [
    { v: 23.75, s: "$23.75$", n: "This is in cm. The answer is in metres", c: 2 },
  ],
  // P30
  P30: [
    { v: 0.211393, s: "$0.2114$", n: "The tension stays the same, but the wire's own mass is spread over a longer length, so $\\mu$ falls too and $f\\propto1/\\sqrt L$. Keeping $\\mu$ fixed gives $f\\propto1/L$, twice the change", c: 3 },
    { v: 0.999754, s: "$0.9998$", n: "This is the ratio $f'/f$. The question asks for the change in Hz", c: 3 },
    { v: 1.09756, s: "$1.098$", n: "A rise of 29 °C is a rise of 29 K. Adding 273.15 is only for a temperature itself, never for a change", c: 2 },
    { v: 428.894, s: "$428.9$", n: "This is the new frequency. The question asks how much it changed", c: 2 },
  ],
  // P31
  P31: [
    { v: 80.9115, s: "$80.91$", n: "This is in °C. The question asks for kelvins: add 273.15", c: 5 },
    { v: 403.876, s: "$403.9$", n: "Heat leaves the junction through both brass and steel, so their $kA/L$ terms add to copper's. Here they were subtracted", c: 3 },
    { v: 130.876, s: "$130.9$", n: "Two slips: the brass and steel terms add to copper's rather than subtract, and the answer is in kelvins", c: 2 },
  ],
  // P32
  P32: [
    { v: 1096420.0, s: "$1.096\\times10^{6}$", n: "This is the heat in joules for the day. Divide by $L_f$ to get the mass of ice", c: 2 },
  ],
  // P33
  P33: [
    { v: 174.225, s: "$174.2$", n: "2.2 cm is 0.022 m. This divides by 0.0022 m", c: 2 },
  ],
  // P34
  P34: [
    { v: 48.1481, s: "$48.15$", n: "$L_v$ is 2.430 kJ = 2430 J per gram. This divides by 2.430", c: 8 },
    { v: 4.81481e-05, s: "$4.815\\times10^{-5}$", n: "This is in kg/s. The answer is in g/s", c: 4 },
    { v: 20.7692, s: "$20.77$", n: "Upside down: grams per second is $P/L_v$. This is $L_v/P$", c: 2 },
  ],
  // P35
  P35: [
    { v: 0.744615, s: "$0.7446$", n: "$L_v$ is 2.42 kJ = 2420 J per gram. This uses 2.42 J", c: 20 },
    { v: 1.34298, s: "$1.343$", n: "Two slips: this is upside down, since the time is the energy over the power, $mL_v/P$; and 2.42 kJ was used as 2.42 J", c: 3 },
  ],
  // P38
  P38: [
    { v: 0.00681056, s: "$0.006811$", n: "A difference of 55 °C is 55 K. Adding 273.15 is only for a temperature itself, never for a difference", c: 10 },
  ],
  // P40
  P40: [
    { v: 0.0106396, s: "$0.01064$", n: "The water is warmer at the top (17.5 °C against 5.5 °C), so the gas also expands by $T_{\\text{top}}/T_{\\text{bottom}}$. That factor is missing", c: 4 },
    { v: 5.26225e-06, s: "$5.262\\times10^{-6}$", n: "This is the bubble's volume in m³. The question asks for its radius, from $V=\\frac43\\pi r^3$", c: 2 },
    { v: 0.107902, s: "$0.1079$", n: "1 cm³ is $10^{-6}$ m³, not $10^{-3}$. That makes the radius 10 times too big", c: 2 },
  ],
  // P41
  P41: [
    { v: 6.68512e-06, s: "$6.685\\times10^{-6}$", n: "This is the volume in m³, written without a unit. The answer is in cm³", c: 2 },
    { v: 0.463831, s: "$0.4638$", n: "Upside down: as the bubble rises, the pressure drops, so it grows. Its volume scales by $P_{\\text{bottom}}/P_{\\text{top}}$", c: 2 },
    { v: 6685120.0, s: "$6.685\\times10^{6}$", n: "This number is in cm³, but the unit says m³", c: 2 },
  ],
  // P42
  P42: [
    { v: 3480.0, s: "$3480$", n: "$v_{\\text{rms}}\\propto1/\\sqrt M$, so the mass ratio 8 goes under a square root", c: 2 },
  ],
  // P43
  P43: [
    { v: 0.35383, s: "$0.3538$", n: "Upside down: lighter helium moves faster, so the factor is above 1", c: 2 },
  ],
  // P44
  P44: [
    { v: 339.675, s: "$339.7$", n: "This uses 36 g/mol, helium plus oxygen. The 485 m/s is the O₂ speed, so use oxygen's 32 g/mol alone", c: 3 },
    { v: 37.7417, s: "$37.74$", n: "This uses helium's 4 g/mol. The 485 m/s is the O₂ speed, so use 32 g/mol", c: 2 },
  ],
  // P45
  P45: [
    { v: 5847.9, s: "$5848$", n: "This is $\\frac32PV$, the energy of the whole gas. Divide by the number of molecules, $nN_A$", c: 3 },
    { v: 1.0116e-21, s: "$1.012\\times10^{-21}$", n: "Translational kinetic energy is $\\frac32kT$ for any gas. The $\\frac52$ also counts the rotation of O₂", c: 2 },
  ],
  // P47
  P47: [
    { v: 13.4556, s: "$13.46$", n: "Molar mass must be in kg/mol: 0.039948, not 39.948", c: 2 },
  ],
  // P49
  P49: [
    { v: 9.9981e-21, s: "$9.998\\times10^{-21}$", n: "This is one atom's energy, $\\frac32kT$. The gas has $nN_A$ atoms", c: 4 },
    { v: 2849.75, s: "$2850$", n: "This is $nRT$. The kinetic energy of a monatomic gas is $\\frac32nRT$", c: 2 },
    { v: 7.09865e-21, s: "$7.099\\times10^{-21}$", n: "This multiplies one atom's energy by $n$ = 0.71. The number of atoms is $nN_A$", c: 2 },
  ],
  // P51
  P51: [
    { v: 546657.0, s: "$5.467\\times10^{5}$", n: "Molar mass must be in kg/mol: 0.002016, not 2.016", c: 3 },
    { v: 819.986, s: "$820$", n: "$v_{\\text{rms}}^2=3RT/M$. Dividing by $2R$ instead of $3R$ gives 1.5 times too much", c: 2 },
  ],
  // P52
  P52: [
    { v: 75.7225, s: "$75.72$", n: "Molar mass must be in kg/mol: 0.002, not 2", c: 2 },
    { v: 757.225, s: "$757.2$", n: "2 g/mol is 0.002 kg/mol. This uses 0.02", c: 2 },
  ],
  // P53
  P53: [
    { v: 550.725, s: "$550.7$", n: "The average translational kinetic energy is $\\frac32kT$. This divides by $k$ alone", c: 4 },
  ],
  // P54
  P54: [
    { v: 103.136, s: "$103.1$", n: "This is the piston's weight in newtons. Divide by $g$ for its mass", c: 2 },
  ],
  // P56
  P56: [
    { v: 133268.0, s: "$1.333\\times10^{5}$", n: "Upside down: once closed, the flask is cooled, so its pressure falls below 1 atm", c: 5 },
  ],
  // P57
  P57: [
    { v: 0.00177179, s: "$0.001772$", n: "This is the mass before warming. Gas escapes while the flask is open at 385 K, and what is left is sealed in then", c: 8 },
    { v: 0.00100528, s: "$0.001005$", n: "The mass is fixed once the stopcock closes at 385 K. Cooling afterwards lowers the pressure, not the mass", c: 2 },
    { v: 1.33459, s: "$1.335$", n: "This is in grams. The answer is in kg", c: 2 },
    { v: 0.00540862, s: "$0.005409$", n: "Use the absolute temperature 385 K in $PV=nRT$, not the 95 K difference", c: 2 },
  ],
  // P58
  P58: [
    { v: 324.1, s: "$324.1$", n: "For a monatomic gas $C_V=\\frac32R$. This uses $R$", c: 6 },
    { v: 306.73, s: "$306.7$", n: "The cylinder is rigid, so the heat goes in at constant volume: $C_V=\\frac32R$, not $C_p=\\frac52R$", c: 4 },
  ],
  // P60
  P60: [
    { v: 1.26914e+25, s: "$1.269\\times10^{25}$", n: "490 mL is $4.9\\times10^{-4}$ m³. This uses 0.49 m³", c: 3 },
  ],
  // P61
  P61: [
    { v: 25.9921, s: "$25.99$", n: "585 mL is $5.85\\times10^{-4}$ m³. This uses 0.585 m³", c: 7 },
  ],
  // P62
  P62: [
    { v: 1.29275, s: "$1.293$", n: "This is air at 1 atm. The pressure here is 1.04 atm", c: 3 },
    { v: 56.7843, s: "$56.78$", n: "This is the molar mass divided by the volume. Density needs the mass of the gas, from $n=PV/RT$", c: 2 },
  ],
  // P63
  P63: [
    { v: 0.0294, s: "$0.0294$", n: "This is in kg/mol. The answer is in g/mol", c: 5 },
  ],
  // P64
  P64: [
    { v: 1.92704e+22, s: "$1.927\\times10^{22}$", n: "Multiplied instead of divided: one molecule's mass is $M/N_A$", c: 3 },
    { v: 5.31385e-23, s: "$5.314\\times10^{-23}$", n: "This is in grams. The answer is in kg", c: 2 },
    { v: 5.31385, s: "$5.314$", n: "The digits are right, but the power of ten was dropped", c: 2 },
  ],
  // P66
  P66: [
    { v: 0.78286, s: "$0.7829$", n: "The molecule's mass is in kg, so $mN_A$ comes out in kg/mol. Labelled g/mol, it is 1000 times too small", c: 2 },
    { v: 21.5875, s: "$21.59$", n: "Divided instead of multiplied: the molar mass is $mN_A$", c: 2 },
  ],
  // P67
  P67: [
    { v: 4618050.0, s: "$4.618\\times10^{6}$", n: "The digits are right, but the power of ten is off: 1 cm³ is $10^{-6}$ m³", c: 2 },
  ],
  // P69
  P69: [
    { v: 19.0686, s: "$19.07$", n: "617 L is 0.617 m³. This uses the volume in litres", c: 2 },
  ],
  // P70
  P70: [
    { v: 131489.0, s: "$1.315\\times10^{5}$", n: "The tank now holds 26.2 + 32.9 kg. This uses only the 32.9 kg that was added", c: 3 },
  ],
  // P72
  P72: [
    { v: 17.8528, s: "$17.85$", n: "This is how much the temperature rises. The question asks for the new temperature", c: 4 },
    { v: 294.368, s: "$294.4$", n: "Scale the absolute temperature, 293.15 K. Scaling 20 °C and then adding 273.15 is not the same", c: 2 },
  ],
  // P73
  P73: [
    { v: 0.0816, s: "$0.0816$", n: "This is a fraction. As a percentage, multiply by 100", c: 3 },
    { v: 16.0, s: "$16$", n: "Square the factor 1.04, not the 4", c: 2 },
    { v: 1.0816, s: "$1.082$", n: "This is the factor $T_2/T_1$. The rise is that minus 1, as a percentage", c: 2 },
  ],
  // P74
  P74: [
    { v: 16.1023, s: "$16.1$", n: "Molar mass must be in kg/mol: 0.032, not 32", c: 2 },
    { v: 1.01840002034831, s: "$1.018$", n: "40 trips across 6 m really make 480 m, but the problem says to use 240 m in total", c: 0 },
  ],
  // P77
  P77: [
    { v: 89.6925, s: "$89.69$", n: "This is $C_p$: all the heat over $n\\Delta T$. $C_V$ uses only the part that raises $U$, $\\Delta U=Q-P\\Delta V$", c: 8 },
    { v: 10.7933, s: "$10.79$", n: "$R$ is missing: $n\\Delta T=P\\Delta V/R$", c: 2 },
    { v: 12.465, s: "$12.46$", n: "It is a real gas, so $C_V$ comes from the data, not from $\\frac32R$", c: 2 },
  ],
  // P78
  P78: [
    { v: 6626.65, s: "$6627$", n: "1 cm³ is $10^{-6}$ m³, not $10^{-3}$", c: 4 },
    { v: 6626660.0, s: "$6.627\\times10^{6}$", n: "The volumes are in cm³. Convert them to m³ first", c: 2 },
  ],
  // P79
  P79: [
    { v: 0.0874992, s: "$0.0875$", n: "1 cm³ is $10^{-6}$ m³, not $10^{-3}$", c: 2 },
    { v: 20.775, s: "$20.78$", n: "It is a real gas, so $C_p$ comes from the data, not from $\\frac52R$", c: 2 },
    { v: 79.1892, s: "$79.19$", n: "This is $C_V$. At constant pressure all the heat counts: $C_p=Q/(n\\Delta T)$", c: 2 },
  ],
  // P80
  P80: [
    { v: 42.8526, s: "$42.85$", n: "The gas does work as it expands, so it keeps less of the heat: $\\Delta U=Q-W$", c: 3 },
    { v: 5515.31, s: "$5515$", n: "1 cm³ is $10^{-6}$ m³, not $10^{-3}$", c: 2 },
  ],
  // P81
  P81: [
    { v: 135.704, s: "$135.7$", n: "Use the initial volume, 1 m³, with the initial temperature. This uses the change in volume", c: 5 },
  ],
  // P86
  P86: [
    { v: 60.1685, s: "$60.17$", n: "Isothermal work is $nRT\\ln(V_1/V_2)$. The $\\ln5$ is missing", c: 5 },
    { v: 75.2106, s: "$75.21$", n: "The pressure rises during the compression, so $P_1\\Delta V$ is too small. Use the isothermal $nRT\\ln5$", c: 3 },
  ],
  // P87
  P87: [
    { v: 0.178986, s: "$0.179$", n: "This is $V_2/V_1$. Reduced by a factor means $V_1/V_2$", c: 5 },
  ],
  // P88
  P88: [
    { v: 630.0, s: "$630$", n: "The pressure falls as the gas expands, so the work is not $P_1\\Delta V$. Isothermal work has a logarithm", c: 8 },
    { v: 384842.0, s: "$3.848\\times10^{5}$", n: "1 L is $10^{-3}$ m³. The volumes were left in litres", c: 2 },
    { v: 1.52288, s: "$1.523$", n: "The temperature is missing: $W=nRT\\ln(V_2/V_1)$, and $nRT=P_1V_1$", c: 2 },
  ],
  // P89
  P89: [
    { v: 789333.0, s: "$7.893\\times10^{5}$", n: "Upside down: expanding at constant temperature lowers the pressure", c: 4 },
  ],
  // P90
  P90: [
    { v: 1621.2, s: "$1621$", n: "This is the whole rectangle. The path ADBA runs along the diagonal DB, so it encloses only a triangle", c: 4 },
  ],
  // P91
  P91: [
    { v: 1215.9, s: "$1216$", n: "This is the whole rectangle. The path ABDA runs along the diagonal BD, so it encloses only a triangle", c: 3 },
  ],
  // P92
  P92: [
    { v: 2431.8, s: "$2432$", n: "The work is the enclosed area, $(p_2-p_1)(V_2-V_1)$, not $p_2V_2-p_1V_1$", c: 2 },
  ],
  // P93
  P93: [
    { v: 11560.0, s: "$11560$", n: "Along the adiabat $cb$ the gas heats up, so work is done on it. That work is negative and subtracts from the work of $ac$", c: 6 },
    { v: 4761.63, s: "$4762$", n: "This is only the work of $ac$. The adiabat $cb$ also has work: $W=-\\Delta U=-nC_V\\Delta T$", c: 2 },
  ],
  // P94
  P94: [
    { v: 0.000581525, s: "$5.815\\times10^{-4}$", n: "The digits are right, but the power of ten is off: the final pressure is $2.36\\times10^{4}$ Pa", c: 2 },
  ],
  // P95
  P95: [
    { v: 306000.0, s: "$3.06\\times10^{5}$", n: "1 L is $10^{-3}$ m³. The volumes were left in litres", c: 2 },
  ],
  // P97
  P97: [
    { v: 64.1396, s: "$64.14$", n: "This divides by $\\frac32R$ = 12.465. $PV=nRT$ needs only $nR$, with $n$ = 0.5 mol", c: 3 },
    { v: 131.408, s: "$131.4$", n: "This is the temperature at $b$. State $c$ has volume $V_c$", c: 2 },
  ],
  // P98
  P98: [
    { v: 45.367, s: "$45.37$", n: "This divides by $\\frac32R$ = 12.465. $PV=nRT$ needs only $nR$, with $n$ = 0.5 mol", c: 2 },
    { v: 187.726, s: "$187.7$", n: "This is the temperature at $c$. The question asks for $b$", c: 2 },
  ],
  // P100
  P100: [
    { v: 440.5, s: "$440.5$", n: "This is the work. The heat also changes the internal energy, $Q=\\Delta U+W$, and here the gas cools", c: 6 },
    { v: 791.5, s: "$791.5$", n: "The gas also cools along $ab$, so $Q_{ab}=\\Delta U_{ab}+W_{ab}$, not just $W_{ab}$", c: 4 },
    { v: 304.0, s: "$304$", n: "Two slips: the work under $ab$ is the whole trapezoid down to the $V$ axis, not just the triangle above $P_b$, and $Q$ also needs $\\Delta U$", c: 2 },
    { v: 199.75, s: "$199.8$", n: "The work under $ab$ is the whole trapezoid down to the $V$ axis. This counts only the triangle above $P_b$", c: 2 },
  ],
  // P102
  P102: [
    { v: 111.369, s: "$111.4$", n: "Rapid compression is adiabatic, not isothermal, so there is no logarithm: $W=\\Delta U$", c: 2 },
    { v: 51.3357, s: "$51.34$", n: "$1/(\\gamma-1)$ is missing: $W=(P_2V_2-P_1V_1)/(\\gamma-1)$", c: 2 },
  ],
  // P103
  P103: [
    { v: 135036.0, s: "$1.35\\times10^{5}$", n: "Pressure follows $PV^\\gamma$, so the factor is $2^\\gamma$. $2^{\\gamma-1}$ is the factor for temperature", c: 4 },
    { v: 204676.0, s: "$2.047\\times10^{5}$", n: "Doubling the pressure is Boyle's law, for constant temperature. A rapid compression also heats the gas, so the pressure more than doubles", c: 2 },
    { v: 362.865, s: "$362.9$", n: "This is the final temperature. The question asks for the pressure", c: 2 },
  ],
  // P104
  P104: [
    { v: 0.90943, s: "$0.9094$", n: "This is the volume in litres. The answer is in m³, and 1 L is $10^{-3}$ m³", c: 3 },
    { v: 0.00633364, s: "$0.006334$", n: "Upside down: at the starting temperature $V\\propto1/P$, and the pressure has gone up, so the volume ends smaller", c: 3 },
    { v: 246006.0, s: "$2.46\\times10^{5}$", n: "This is the pressure after the compression. The question asks for the volume", c: 2 },
  ],
  // P105
  P105: [
    { v: 300.0, s: "$300$", n: "This is $\\Delta U$. The heat also pays for the work: $Q=\\Delta U+W$", c: 3 },
    { v: 100.0, s: "$100$", n: "The gas does work, so $Q=\\Delta U+W$, not $\\Delta U-W$", c: 2 },
  ],
  // P106
  P106: [
    { v: 218.341, s: "$218.3$", n: "The 315 J already includes the $\\ln2$. At constant temperature $\\Delta U=0$, so $Q=W$", c: 2 },
  ],
  // P107
  P107: [
    { v: 500.0, s: "$500$", n: "This is $Q$. The change in internal energy is $Q-W$", c: 6 },
  ],
  // P109
  P109: [
    { v: 68200.0, s: "$68200$", n: "At constant volume $Q=\\Delta U=\\frac32V\\Delta P$. The $\\frac32$ is missing", c: 2 },
    { v: 155100.0, s: "$1.551\\times10^{5}$", n: "Use the change in pressure, 4.7 − 1.6, not the final pressure", c: 2 },
  ],
  // P110
  P110: [
    { v: 133.386, s: "$133.4$", n: "Adiabatic: the work equals the drop in $U=\\frac32nRT$. This divides by $nR$ without the $\\frac32$", c: 8 },
    { v: 9200.0, s: "$9200$", n: "This is the work. The question asks for the temperature change", c: 2 },
  ],
  // P111
  P111: [
    { v: 10500.0, s: "$10500$", n: "This is for all 5.8 mol. The question asks per mole", c: 2 },
  ],
  // P113
  P113: [
    { v: 159058.0, s: "$1.591\\times10^{5}$", n: "$L_v$ is in kJ/kg, so the heat is 3609.6 kJ. This subtracts the work in joules from the heat in kJ", c: 3 },
  ],
  // P115
  P115: [
    { v: 304.384, s: "$304.4$", n: "This is the heat rejected, $Q_C$. The work is $Q_H-Q_C$", c: 3 },
  ],
  // P116
  P116: [
    { v: 803.314, s: "$803.3$", n: "$Q_C/Q_H=T_C/T_H$. This uses $T_C/(T_H-T_C)$, the refrigerator's coefficient", c: 2 },
    { v: 147.624, s: "$147.6$", n: "This is the work. The heat rejected is what is left: $Q_H-W$", c: 2 },
  ],
  // P117
  P117: [
    { v: 333.333, s: "$333.3$", n: "The efficiency applies to $Q_H$, not to the 1000 J taken from the cold side. For a refrigerator $W=Q_C/K$, with $K=T_C/(T_H-T_C)$", c: 3 },
  ],
  // P118
  P118: [
    { v: 0.295775, s: "$0.2958$", n: "This is the engine's efficiency. A refrigerator's coefficient of performance is $T_C/(T_H-T_C)$", c: 4 },
  ],
  // P119
  P119: [
    { v: 130.784, s: "$130.8$", n: "Multiplied instead of divided: $e=1-T_C/T_H$ gives $T_H=T_C/(1-e)$", c: 19 },
  ],
  // P120
  P120: [
    { v: 0.907692, s: "$0.9077$", n: "Carnot efficiency needs kelvins: 42 °C and 455 °C are 315.15 K and 728.15 K", c: 4 },
  ],
  // P122
  P122: [
    { v: 0.24698, s: "$0.247$", n: "This is in kg. The answer is in grams", c: 2 },
  ],
  // P123
  P123: [
    { v: 79158.0, s: "$79158$", n: "This is the heat. The lake's entropy change is $-Q/T$, with $T=273.15$ K", c: 2 },
  ],
  // P124
  P124: [
    { v: 22381.7, s: "$22382$", n: "Use the lake's temperature in kelvins, 287.15 K, not 14", c: 3 },
    { v: 3.56794, s: "$3.568$", n: "The heat is $mc\\Delta T$. The temperature drop of 306 K is missing", c: 2 },
    { v: 528.271, s: "$528.3$", n: "This divides the heat by the lead's 593.15 K. The lake takes it in at its own 287.15 K", c: 2 },
  ],
  // P125
  P125: [
    { v: 561.159, s: "$561.2$", n: "This is the lead's entropy change in J/K. The question asks for the heat, $mc\\Delta T$", c: 3 },
  ],
  // P126
  P126: [
    { v: 264.136, s: "$264.1$", n: "The lead's temperature changes as it cools, so $\\Delta S=mc\\ln(T_2/T_1)$, not $Q/T_1$", c: 8 },
    { v: 545.61, s: "$545.6$", n: "This is $Q/T$ at the lake's temperature, the lake's change. The lead's is $mc\\ln(T_2/T_1)$", c: 7 },
    { v: 1602.18, s: "$1602$", n: "Temperatures in the logarithm must be in kelvins", c: 7 },
  ],
  // P127
  P127: [
    { v: 562.95, s: "$562.9$", n: "The lead cools, so its entropy change is $mc\\ln(T_2/T_1)$. This uses $-Q/T_1$", c: 4 },
  ],
  // P128
  P128: [
    { v: 134.375, s: "$134.4$", n: "This is the heat taken in per cycle. The heat rejected is what is left after the work", c: 11 },
    { v: 860.0, s: "$860$", n: "This is per second. Divide by the 8 cycles per second", c: 2 },
  ],
  // P129
  P129: [
    { v: 1129.41, s: "$1129$", n: "This is per second. Divide by the 13 cycles per second", c: 2 },
  ],
  // P130
  P130: [
    { v: 124.615, s: "$124.6$", n: "This is the heat absorbed per cycle. The work per cycle is the output power over the cycle rate", c: 8 },
  ],
  // P133
  P133: [
    { v: 0.75, s: "$0.75$", n: "The two temperatures belong to the engine. The refrigerator's coefficient is $Q_C/W$, with $W$ from the engine", c: 7 },
    { v: 1.4026, s: "$1.403$", n: "Upside down: the coefficient of performance is heat removed per unit of work, $Q_C/W$", c: 3 },
  ],
  // P134
  P134: [
    { v: 7.14286e-05, s: "$7.143\\times10^{-5}$", n: "The coal is per hour. Divide by 3600 s to match the power in watts", c: 3 },
  ],
  // P135
  P135: [
    { v: 31846.2, s: "$31846$", n: "Only 26% of the coal's heat becomes power, so the plant burns more: divide by the efficiency", c: 6 },
    { v: 34.0237, s: "$34.02$", n: "This is per second. The question asks per hour", c: 4 },
    { v: 2939640.0, s: "$2.94\\times10^{6}$", n: "This is per day. The question asks per hour", c: 2 },
  ],
  // P138
  P138: [
    { v: 195.643, s: "$195.6$", n: "This divides by 273.15 K, the ice side. The boiling water gives the heat away at 373.15 K", c: 4 },
    { v: 534.4, s: "$534.4$", n: "Divide by the temperature in kelvins, 373.15 K, not 100", c: 3 },
    { v: 14321.3, s: "$14321$", n: "The digits are right, but the power of ten is off", c: 2 },
  ],
  // P139
  P139: [
    { v: 52.4302, s: "$52.43$", n: "This is the total for both sides. The ice-water mixture alone gains $Q/T$ at 273.15 K", c: 2 },
  ],
  // P140
  P140: [
    { v: 170.066, s: "$170.1$", n: "This is only the boiling water's share. The total adds the mixture's gain $Q/273.15$ and the water's loss $-Q/373.15$", c: 7 },
    { v: 232.327, s: "$232.3$", n: "This is only the ice-water's gain. The boiling water loses $Q/373.15$ at the same time", c: 2 },
  ],
  // P141
  P141: [
    { v: 281.593, s: "$281.6$", n: "At constant pressure the heat capacity is $C_p=\\frac52R$: $\\Delta S=nC_p\\ln(V_2/V_1)$. This uses $nR$", c: 6 },
    { v: 422.389, s: "$422.4$", n: "The pressure is constant, so use $C_p=\\frac52R$, not $C_V=\\frac32R$", c: 5 },
    { v: 147.329, s: "$147.3$", n: "Two slips: entropy needs $\\ln(V_2/V_1)$, not $\\Delta V/V_1$, and at constant pressure the heat capacity is $C_p$", c: 3 },
    { v: 368.323, s: "$368.3$", n: "Entropy needs $\\ln(V_2/V_1)$. $\\Delta V/V_1$ is only close for small changes", c: 2 },
  ],
  // P144
  P144: [
    { v: 146.027, s: "$146$", n: "Steam condenses at 100 °C, which is 373.15 K. This uses 273.15 K", c: 2 },
    { v: 0.199488, s: "$0.1995$", n: "This is in kg. The answer is in grams", c: 2 },
  ],
  // P145
  P145: [
    { v: 503.644, s: "$503.6$", n: "This is $eT_H$. The cold reservoir is at $T_H(1-e)$", c: 2 },
    { v: 440.536, s: "$440.5$", n: "The Carnot ratio needs kelvins first. This applies it to 491 °C and adds 273.15 afterwards", c: 2 },
  ],
  // P146
  P146: [
    { v: 13820.7, s: "$13821$", n: "The ice gets the heat rejected, $Q_H-W$ per cycle, not the 290 J of work", c: 2 },
  ],
  // P149
  P149: [
    { v: 135.433, s: "$135.4$", n: "This is the new cold temperature. The question asks how much it drops", c: 3 },
  ],
  // P150
  P150: [
    { v: 3660.97, s: "$3661$", n: "Along 3 → 1 the gas cools, so heat leaves it. That heat subtracts", c: 2 },
    { v: 1155.51, s: "$1156$", n: "At constant pressure use $C_p=\\frac72R$. This uses $C_V$ on 3 → 1", c: 2 },
  ],
};
