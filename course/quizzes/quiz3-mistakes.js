// Common wrong answers for Quiz 3, from the attempts up to 6 Nov 2026.
// Each mistake was recomputed from the problem's own numbers and matched
// to what at least 2 students typed. js/common-mistakes.js shows them.
// A problem's mistakes are in order, most common first.
//
//   v  the wrong value, in the problem's answer unit (matched within ±1%,
//      at any power of ten; see matchMistake)
//   s  how that value is shown, in LaTeX
//   n  the reason: quick to read, clear even to someone who did not make
//      the mistake, and never the correct final answer
//   c  how many students entered it, which sets the order
//
// Keyed by problem id, like the rest of the course data, so renumbering
// or retiring a problem never moves a note.
const Quiz_3_Mistakes = {
  // P1
  P1i: [
    { v: 1638860.0, s: "$1.64\\times10^{6}$", n: "The working is right, but this is in metres and the question asks for km", c: 5 },
  ],
  // P2
  P106i: [
    { v: 8171990.0, s: "$8.17\\times10^{6}$", n: "This is the distance from Earth's centre. Altitude is that minus the radius", c: 2 },
  ],
  // P3
  P2i: [
    { v: 8.80494, s: "$8.80$", n: "Gravity falls with distance squared, so the ratio $R/(R+h)$ must be squared: $g\\propto 1/r^2$", c: 8 },
    { v: 9.79779, s: "$9.798$", n: "This treats 720 km as 720 m. Convert it to metres first", c: 3 },
  ],
  // P4
  P3i: [
    { v: 12.8598, s: "$12.86$", n: "This is the rim speed $v$. The question asks for angular speed: $\\omega=v/r$", c: 6 },
    { v: 0.404145, s: "$0.4041$", n: "The ring is 45 m in diameter, so its radius is half of that", c: 2 },
  ],
  // P5
  P107i: [
    { v: 0.65359, s: "$0.654$", n: "This is the angular speed $\\omega$. The question asks for rim speed: $v=\\omega r$", c: 4 },
    { v: 18.0242, s: "$18.02$", n: "The ring is 39 m in diameter, so its radius is half of that", c: 2 },
  ],
  // P6
  P4i: [
    { v: 2908.37, s: "$2908$", n: "Escape speed grows with the square root of $M/R$, not with $M/R$ itself: $v=\\sqrt{2GM/R}$", c: 4 },
    { v: 1056.84, s: "$1057$", n: "The ratio is upside down: a heavier, smaller planet has a higher escape speed", c: 2 },
    { v: 2449.29, s: "$2449$", n: "The root covers the radius too: $v\\propto\\sqrt{M/R}$", c: 2 },
    { v: 4050.66, s: "$4051$", n: "That scaling is for $g\\propto M/R^2$. Escape speed goes as $\\sqrt{M/R}$", c: 2 },
  ],
  // P7
  P108i: [
    { v: 1.91398, s: "$1.91$", n: "Surface gravity depends on the radius squared, so square the radius ratio: $g=GM/R^2$", c: 5 },
  ],
  // P8
  P5i: [
    { v: 6.57791e-11, s: "$6.58\\times10^{-11}$", n: "Forces are vectors. The side masses partly cancel, so only their components along the axis add", c: 2 },
  ],
  // P9
  P6i: [
    { v: 7.05775e-09, s: "$7.05\\times10^{-9}$", n: "This treats the sphere as solid. The removed hollow would pull too, so subtract its force", c: 5 },
    { v: 6.17553e-09, s: "$6.18\\times10^{-9}$", n: "The remaining $7M/8$ is not centred. Subtract the hollow's force at its own distance instead", c: 3 },
  ],
  // P10
  P7i: [
    { v: 10.1263, s: "$10.13$", n: "This is the centre of mass. Zero force needs $M_1/x^2=M_2/(d-x)^2$", c: 5 },
  ],
  // P13
  P9i: [
    { v: 472332000000.0, s: "$4.72\\times10^{11}$", n: "This is the potential energy at the height. Lifting needs the change: $\\Delta U=GMm(1/R-1/r)$", c: 8 },
    { v: 500504000000.0, s: "$5.01\\times10^{11}$", n: "This is the potential energy at the surface. Lifting needs the difference between the two heights", c: 3 },
    { v: 29792000.0, s: "$2.98\\times10^{7}$", n: "The height is in km, and $mgh$ only works close to the ground. Use $\\Delta U$", c: 2 },
    { v: 972836000000.0, s: "$9.73\\times10^{11}$", n: "The two potential energies must be subtracted, not added", c: 2 },
  ],
  // P14
  P110i: [
    { v: 7670.02, s: "$7670$", n: "This is the orbital speed at that height. Just reaching it comes from energy conservation", c: 2 },
    { v: 15579.0, s: "$15579$", n: "The two energy terms are subtracted: $v^2=2GM(1/R-1/r)$", c: 2 },
  ],
  // P15
  P10i: [
    { v: 8089.28, s: "$8089$", n: "The object slows as it climbs, so the launch speed must be higher: $v_0^2=v^2+2GM/R$", c: 5 },
    { v: 13800.0, s: "$13800$", n: "This is the speed far away. The launch speed must be larger, because gravity slows the object", c: 4 },
  ],
  // P16
  P111i: [
    { v: 4651810.0, s: "$4.65\\times10^{6}$", n: "The object also starts with potential energy. Include $-GMm/R$ on the launch side", c: 5 },
    { v: 15096600.0, s: "$1.51\\times10^{7}$", n: "This is the distance from Earth's centre. Subtract the radius to get the height", c: 3 },
    { v: 21467600.0, s: "$2.15\\times10^{7}$", n: "The height is this distance minus Earth's radius, not plus", c: 3 },
  ],
  // P17
  P11i: [
    { v: 10072.0, s: "$10072$", n: "Two pulls at $60^\\circ$ add as vectors, and the orbit radius is $s/\\sqrt{3}$", c: 3 },
    { v: 9373.07, s: "$9373$", n: "The orbit radius is $s/\\sqrt{3}$, not the side $s$", c: 2 },
    { v: 225217.0, s: "$2.25\\times10^{5}$", n: "The side is given in km. Convert it to metres before using $G$", c: 2 },
  ],
  // P18
  P12i: [
    { v: 17277.1, s: "$17277$", n: "Escaping costs $GMm/R$, which puts $2GM/R$ in $v^2$: $v^2=v_0^2-2GM/R$", c: 4 },
    { v: 22045.5, s: "$22045$", n: "Gravity slows the object, so the term is subtracted: $v^2=v_0^2-2GM/R$", c: 3 },
  ],
  // P21
  P14i: [
    { v: 998618000.0, s: "$9.99\\times10^{8}$", n: "Gravity uses distance squared: $F=GMm/R^2$, not $GMm/R$", c: 6 },
  ],
  // P23
  P113i: [
    { v: 164.346, s: "$164$", n: "Kepler's third law links $T^2$ to $r^3$, so the radius is cubed: $T=2\\pi\\sqrt{r^3/GM}$", c: 4 },
    { v: 1783540.0, s: "$1.78\\times10^{6}$", n: "The factor is $4\\pi^2$: the $\\pi$ is squared in $T^2=4\\pi^2r^3/GM$", c: 2 },
  ],
  // P24
  P16i: [
    { v: 112.911, s: "$112.9$", n: "This is the speed for a low orbit. Escape needs a factor of $\\sqrt{2}$: $v=\\sqrt{2GM/R}$", c: 7 },
    { v: 0.15968, s: "$0.1597$", n: "The radius is in km. Convert it to metres before using $G$", c: 2 },
  ],
  // P25
  P114i: [
    { v: 0.0182647, s: "$0.01826$", n: "The volume of a sphere has a $\\pi$: $M=\\frac{4}{3}\\pi\\rho R^3$", c: 2 },
  ],
  // P26
  P17i: [
    { v: 51002.9, s: "$51003$", n: "$v=\\sqrt{GM/r}$ holds only for circular orbits. A comet is on an ellipse, so use energy conservation", c: 8 },
    { v: 72129.1, s: "$72129$", n: "This is the escape speed from that point. The comet has its own energy, so use conservation", c: 3 },
    { v: 55221.5, s: "$55221$", n: "$v\\propto 1/\\sqrt{r}$ holds only for circular orbits. Use energy conservation", c: 2 },
  ],
  // P27
  P115i: [
    { v: 35653400000.0, s: "$3.57\\times10^{10}$", n: "$r=GM/v^2$ holds only for circular orbits. A comet is on an ellipse, so use energy conservation", c: 6 },
  ],
  // P28
  P18i: [
    { v: 1.04219e+28, s: "$1.04\\times10^{28}$", n: "$r$ is each star's orbit radius. They are on opposite sides, so they are $2r$ apart", c: 10 },
    { v: 2.60547e+33, s: "$2.61\\times10^{33}$", n: "The radius is given in km. Convert it to metres before using $G$", c: 8 },
    { v: 2.6055, s: "$2.606$", n: "The value is right, but the power of ten was dropped when entering it", c: 4 },
    { v: 1.04219e+34, s: "$1.04\\times10^{34}$", n: "Two slips: the radius is in km, and the stars are $2r$ apart", c: 4 },
  ],
  // P29
  P19i: [
    { v: 577495.0, s: "$5.77\\times10^{5}$", n: "The radius is given in km. Convert it to metres before using $G$", c: 9 },
    { v: 36524.0, s: "$36524$", n: "Gravity acts across $2r$, but each star circles with radius $r$: $Gm^2/(2r)^2=mv^2/r$", c: 6 },
    { v: 51652.7, s: "$51653$", n: "This is an escape speed. A bound orbit follows from $Gm^2/(2r)^2=mv^2/r$", c: 4 },
  ],
  // P30
  P20i: [
    { v: 12309400.0, s: "$1.23\\times10^{7}$", n: "Gravity acts across $2r$, but each star circles with radius $r$: $Gm^2/(2r)^2=mv^2/r$", c: 8 },
    { v: 778.515, s: "$779$", n: "The radius is given in km. Convert it to metres before using $G$", c: 4 },
    { v: 17408100.0, s: "$1.74\\times10^{7}$", n: "The 2 in the separation is squared too: $(2r)^2=4r^2$", c: 2 },
  ],
  // P31
  P21i: [
    { v: 2.668e+39, s: "$2.67\\times10^{39}$", n: "This is the potential energy alone. The stars already have orbital KE, so less is needed", c: 7 },
    { v: 1.334e+42, s: "$1.33\\times10^{42}$", n: "The radius is given in km. Convert it to metres before using $G$", c: 7 },
    { v: 5.336e+39, s: "$5.34\\times10^{39}$", n: "The stars are $2r$ apart, not $r$, and their orbital KE also reduces the energy needed", c: 5 },
  ],
  // P32
  P22i: [
    { v: 1.32285, s: "$1.323$", n: "The value is right, but the power of ten was dropped when entering it", c: 3 },
    { v: 1.61905e-05, s: "$1.62\\times10^{-5}$", n: "This is how fast they approach each other. The 24 kg sphere moves only part of that", c: 2 },
    { v: 6.26304e-06, s: "$6.26\\times10^{-6}$", n: "Combine momentum and energy conservation. The reduced mass does not give one sphere's speed", c: 2 },
  ],
  // P33
  P116i: [
    { v: 6.67054e-06, s: "$6.67\\times10^{-6}$", n: "Relative motion uses the total mass, not the reduced mass: $m_1+m_2$", c: 3 },
    { v: 1.65034, s: "$1.65$", n: "The value is right, but the power of ten was dropped when entering it", c: 2 },
  ],
  // P34
  P23i: [
    { v: 8.02245e-06, s: "$8.02\\times10^{-6}$", n: "Relative motion uses the total mass, not the reduced mass: $v^2=2G(m_1+m_2)(1/r-1/r_0)$", c: 4 },
    { v: 3.82407e-06, s: "$3.82\\times10^{-6}$", n: "This is the speed of the heavier sphere. Relative speed adds both speeds", c: 2 },
    { v: 2.065, s: "$2.065$", n: "The value is right, but the power of ten was dropped when entering it", c: 2 },
  ],
  // P35
  P24i: [
    { v: 7.302, s: "$7.302$", n: "This is measured from the heavier sphere. The question starts from the 20 kg sphere", c: 3 },
  ],
  // P36
  P25i: [
    { v: 6809450.0, s: "$6.81\\times10^{6}$", n: "This is the orbit radius, measured from Earth's centre. For height, subtract $R_{\\mathrm{E}}$", c: 4 },
  ],
  // P37
  P26i: [
    { v: 11.8435, s: "$11.84$", n: "The period is squared: $g=4\\pi^2L/T^2$", c: 2 },
  ],
  // P38
  P117i: [
    { v: 1.08358, s: "$1.08$", n: "This uses $g=9.8$ out of habit. This pendulum is at a place where $g=11.3$", c: 7 },
    { v: 0.0655727, s: "$0.06557$", n: "The period is time per swing: 58.5 s divided by 28, not the other way round", c: 3 },
    { v: 49.3258, s: "$49.33$", n: "Missing the $4\\pi^2$: $L=gT^2/4\\pi^2$", c: 3 },
  ],
  // P41
  P29i: [
    { v: 14.6987, s: "$14.70$", n: "0.961 is the factor for amplitude. Energy goes as $A^2$, so each cycle multiplies it by $0.961^2$", c: 4 },
    { v: 9.75963, s: "$9.76$", n: "This is the number of cycles. Multiply by the period to get the time", c: 2 },
    { v: 29.396, s: "$29.4$", n: "Energy changes by the amplitude factor squared each cycle, not by its root", c: 2 },
  ],
  // P42
  P118i: [
    { v: 15.1, s: "$15.2$", n: "0.94 is the factor for amplitude. Energy goes as $A^2$, so each cycle multiplies it by $0.94^2$", c: 9 },
    { v: 7.0, s: "$7$", n: "The energy reaches 0.39 part-way through a cycle, so keep the decimals", c: 4 },
    { v: 5.32624, s: "$5.326$", n: "This is a time in seconds. The question asks for the number of oscillations", c: 3 },
  ],
  // P43
  P30i: [
    { v: 1290.83, s: "$1291$", n: "The period gives the total mass on the springs. The car alone is that minus the passengers", c: 6 },
  ],
  // P46
  P33i: [
    { v: 0.527219, s: "$0.5272$", n: "This is the period of the 171 g mass. That mass only gives $k$; the 476 g bob is what oscillates", c: 2 },
  ],
  // P48
  P34i: [
    { v: 30.0367, s: "$30.04$", n: "Missing the 2: $\\omega=2\\pi/T$", c: 2 },
  ],
  // P50
  P35i: [
    { v: 1.88315, s: "$1.88$", n: "The person only gives the spring constant. The whole car and person oscillate together", c: 4 },
  ],
  // P51
  P121i: [
    { v: 64.7245, s: "$64.72$", n: "The oscillating mass is car plus person, so the person's mass appears on both sides", c: 3 },
  ],
  // P52
  P36i: [
    { v: 2698.24, s: "$2698$", n: "This is $\\omega$ in rad/s. The question asks for $f=\\omega/2\\pi$", c: 3 },
    { v: 1349.12, s: "$1349$", n: "Missing the $\\pi$: $v_{\\max}=2\\pi fA$", c: 2 },
  ],
  // P53
  P122i: [
    { v: 2.96127, s: "$2.961$", n: "The amplitude is in mm. Convert it to metres", c: 2 },
  ],
  // P54
  P37i: [
    { v: 0.0441, s: "$0.0441$", n: "Both blocks move together, so the spring accelerates the total mass $M_1+M_2$", c: 3 },
  ],
  // P55
  P38i: [
    { v: 13.6817, s: "$13.68$", n: "The rock lifts off when $\\omega^2A=g$. That gives $\\omega^2$, so take the root before $f=\\omega/2\\pi$", c: 4 },
    { v: 0.67769, s: "$0.6777$", n: "This is the period. Frequency is $f=1/T$", c: 2 },
  ],
  // P56
  P39i: [
    { v: 1.48588, s: "$1.486$", n: "This is the period. Frequency is $f=1/T$", c: 2 },
  ],
  // P57
  P40i: [
    { v: 0.471239, s: "$0.4712$", n: "0.03 m is a position, not a radius. Use $v^2=\\omega^2(A^2-x^2)$", c: 2 },
    { v: 4.19438, s: "$4.194$", n: "This is $\\omega$. The period is $T=2\\pi/\\omega$", c: 2 },
  ],
  // P60
  P42i: [
    { v: 0.0918367, s: "$0.092$", n: "0.3 m/s is the speed at $x=0.06$ m, not the maximum. Find $\\omega$ from $v^2=\\omega^2(A^2-x^2)$", c: 4 },
  ],
  // P61
  P43i: [
    { v: 2.64202e+25, s: "$2.64\\times10^{25}$", n: "Swinging from one side to the other is half a period, so the period is twice 1.55 s", c: 4 },
    { v: 7.68023e+17, s: "$7.68\\times10^{17}$", n: "The radius is squared: $M=gR^2/G$", c: 2 },
  ],
  // P62
  P44i: [
    { v: 2.19866, s: "$2.20$", n: "In an accelerating rocket the pendulum feels stronger gravity: $g_{\\mathrm{eff}}=g+a$", c: 6 },
    { v: 3.20916, s: "$3.209$", n: "The rocket adds to gravity, so use $g+a$, not $a$ alone", c: 3 },
    { v: 1.02513, s: "$1.025$", n: "Effective gravity adds the two: $g+a$, not their product", c: 2 },
    { v: 3.01834, s: "$3.018$", n: "Upward acceleration adds to gravity: $g+a$, not $g-a$", c: 2 },
  ],
  // P63
  P45i: [
    { v: 0.590839, s: "$0.591$", n: "A sticking collision loses energy. Use momentum first, then the KE just after the collision", c: 6 },
    { v: 0.835573, s: "$0.836$", n: "The masses stick, so momentum halves the speed. Use the speed after the collision", c: 5 },
    { v: 0.218182, s: "$0.2182$", n: "Missing the root: $A=v\\sqrt{m/k}$", c: 3 },
    { v: 0.29542, s: "$0.2954$", n: "Both masses oscillate after sticking, so use the total mass", c: 3 },
  ],
  // P64
  P124i: [
    { v: 28.665, s: "$28.7$", n: "A sticking collision loses energy. Use momentum first, then the KE just after the collision", c: 7 },
  ],
  // P66
  P47i: [
    { v: 0.0772015, s: "$0.0772$", n: "The ratio is upside down: $f=\\frac{1}{2\\pi}\\sqrt{k/m}$", c: 2 },
  ],
  // P67
  P48i: [
    { v: 1.25007, s: "$1.25$", n: "The bucket oscillates too. Use the bucket plus the remaining water", c: 4 },
  ],
  // P68
  P125i: [
    { v: 4622.22, s: "$4622$", n: "This is the time for all the water to leak. Half full means half of that mass", c: 5 },
    { v: 2.31111, s: "$2.311$", n: "The rate is in g/s. Convert it to kg/s, or the mass to grams", c: 3 },
  ],
  // P69
  P49i: [
    { v: 0.2216, s: "$0.2216$", n: "The rate is in g/s. Convert it to kg/s", c: 3 },
    { v: 0.00018589, s: "$1.86\\times10^{-4}$", n: "Use the bucket plus half the water, not the full 10.8 kg", c: 2 },
  ],
  // P70
  P50i: [
    { v: 0.371362, s: "$0.371$", n: "The ball bounces on the stretched wire, so it is a mass on a spring: $k=mg/\\Delta L$", c: 8 },
    { v: 33.5909, s: "$33.59$", n: "The stretch is 2.2 mm, which is 0.0022 m", c: 2 },
  ],
  // P71
  P126i: [
    { v: 10.0658, s: "$10.07$", n: "The first ball only gives the spring constant. The frequency uses the ball now hanging", c: 4 },
  ],
  // P72
  P51i: [
    { v: 1.38, s: "$1.38$", n: "The value is right, but the power of ten was dropped when entering it", c: 2 },
  ],
  // P73
  P52i: [
    { v: 43.9766, s: "$43.98$", n: "This is the angular frequency $\\omega$ in rad/s. The question asks for $f=\\omega/2\\pi$ in Hz", c: 6 },
  ],
  // P74
  P127i: [
    { v: 1.31081, s: "$1.311$", n: "The time constant for amplitude is $2m/b$, not $m/2b$", c: 2 },
  ],
  // P75
  P53i: [
    { v: 246.684, s: "$246.7$", n: "The spring acts too, so the driving force covers the difference: $F=A\\,(m\\omega^2-k)$", c: 4 },
  ],
  // P77
  P54i: [
    { v: 9.16717, s: "$9.167$", n: "This is $\\omega$ in rad/s. The question asks for $f=\\omega/2\\pi$", c: 3 },
    { v: 0.410936, s: "$0.4109$", n: "Above resonance the terms add: $\\omega^2=\\omega_0^2+F/mA$", c: 2 },
  ],
  // P78
  P55i: [
    { v: 0.018237, s: "$0.01824$", n: "This is a fraction. The question asks for a percentage", c: 3 },
  ],
  // P79
  P56i: [
    { v: 67.7367, s: "$67.7$", n: "This is the destructive condition. Constructive needs a path difference of $\\lambda$", c: 6 },
  ],
  // P81
  P57i: [
    { v: 143.219, s: "$143.2$", n: "This is the lowest frequency, $\\Delta=\\lambda$. The second-lowest has $\\Delta=2\\lambda$", c: 6 },
    { v: 214.828, s: "$214.8$", n: "$\\Delta=3\\lambda/2$ is a minimum. The second maximum is $\\Delta=2\\lambda$", c: 3 },
  ],
  // P82
  P58i: [
    { v: 129.691, s: "$129.7$", n: "This is the constructive condition. A minimum needs a path difference of $\\lambda/2$", c: 4 },
    { v: 260.507, s: "$260.5$", n: "The path from the far speaker is the hypotenuse: $\\sqrt{x^2+L^2}$, not $\\sqrt{x^2-L^2}$", c: 4 },
    { v: 194.536, s: "$194.5$", n: "This is the second minimum. The lowest has $\\Delta=\\lambda/2$", c: 3 },
  ],
  // P83
  P59i: [
    { v: 207.223, s: "$207.2$", n: "$\\Delta=2\\lambda$ is a maximum. Minima fall at $\\lambda/2$, then $3\\lambda/2$", c: 8 },
    { v: 103.611, s: "$103.6$", n: "$\\Delta=\\lambda$ is a maximum. Minima fall at $\\lambda/2$, then $3\\lambda/2$", c: 5 },
    { v: 259.028, s: "$259$", n: "This is the third minimum. The second is at $\\Delta=3\\lambda/2$", c: 3 },
    { v: 310.834, s: "$310.8$", n: "$\\Delta=3\\lambda$ is a maximum. Minima fall at $\\lambda/2$, then $3\\lambda/2$", c: 3 },
  ],
  // P86
  P61i: [
    { v: 0.0715891, s: "$0.0716$", n: "This is the time to reach the object. The echo also has to come back", c: 6 },
  ],
  // P91
  P132i: [
    { v: 475.373, s: "$475$", n: "This is the wave speed $v=\\sqrt{FL/m}$. The question asks for the time: $t=L/v$", c: 4 },
    { v: 3.36578, s: "$3.366$", n: "This is in milliseconds. The answer is in seconds", c: 3 },
    { v: 0.106435, s: "$0.1064$", n: "The mass is in grams. Convert it to kilograms", c: 2 },
  ],
  // P93
  P133i: [
    { v: 19.5, s: "$19.5$", n: "The third harmonic has $\\lambda=2L/3$, so divide by 3 instead of multiplying", c: 2 },
  ],
  // P94
  P66i: [
    { v: 136.24, s: "$136.2$", n: "The fundamental fits half a wave on the string, so $\\lambda=2L$, not $L$", c: 5 },
  ],
  // P95
  P134i: [
    { v: 346.512, s: "$346.5$", n: "Same tension means same wave speed, so $f=v/2L$ goes as $1/L$, not $1/\\sqrt{L}$", c: 6 },
  ],
  // P96
  P67i: [
    { v: 24.9682, s: "$24.97$", n: "The fundamental has $\\lambda=2L$, so $v=2Lf$", c: 2 },
  ],
  // P98
  P69i: [
    { v: 0.00199953, s: "$0.00200$", n: "The phase $kx-\\omega t$ is in radians, but the calculator was in degree mode", c: 8 },
    { v: 6.505e-05, s: "$6.51\\times10^{-5}$", n: "The amplitude is 2 mm, which is 0.002 m", c: 2 },
  ],
  // P99
  P135i: [
    { v: 768800.0, s: "$7.69\\times10^{5}$", n: "Wave speed is not particle speed. A particle in SHM has $a_{\\max}=\\omega^2A$", c: 6 },
    { v: 0.141554, s: "$0.1416$", n: "This is the maximum speed $\\omega A$. Acceleration is $\\omega^2A$", c: 3 },
    { v: 4.00753, s: "$4.008$", n: "Missing the 2: $\\omega=2\\pi v/\\lambda$", c: 2 },
    { v: 16030.1, s: "$16030$", n: "The amplitude is in mm. Convert it to metres", c: 2 },
  ],
  // P100
  P70i: [
    { v: 0.173595, s: "$0.174$", n: "Velocity is the derivative of $y$, so $\\cos$ becomes $\\sin$: $v_y=\\omega A\\sin(kx-\\omega t)$", c: 4 },
    { v: 0.00134507, s: "$0.00135$", n: "This is the displacement $y$. The question asks for the transverse velocity", c: 4 },
  ],
  // P101
  P71i: [
    { v: 191.425, s: "$191.4$", n: "The second overtone has $\\lambda=2L/3$ on the string, not $2L$", c: 3 },
    { v: 1828.83, s: "$1829$", n: "344 m/s is the speed in air, not on the string", c: 2 },
  ],
  // P103
  P72i: [
    { v: 286.667, s: "$286.7$", n: "344 m/s is the speed in air, not on the string. Use it with the sound wavelength to find $f$", c: 5 },
    { v: 860.0, s: "$860$", n: "344 m/s is the speed in air, so it cannot be used with the wavelength on the string", c: 3 },
    { v: 30.991, s: "$30.99$", n: "The sound wavelength is 3.7 cm, which is 0.037 m", c: 3 },
  ],
  // P104
  P73i: [
    { v: 0.00563938, s: "$0.00564$", n: "The mass density is in kg/cm. Convert it to kg/m before $v=\\sqrt{F/\\mu}$", c: 11 },
    { v: 0.16917, s: "$0.1692$", n: "Each piece is 58 cm long. Use that for each piece, not the whole 174 cm", c: 2 },
  ],
  // P107
  P76i: [
    { v: 5.38, s: "$5.38$", n: "This is in milliseconds. The answer is in seconds", c: 2 },
  ],
  // P108
  P137i: [
    { v: 66.5912, s: "$66.59$", n: "The fundamental has $\\lambda=2L$, so $f=v/2L$", c: 2 },
  ],
  // P112
  P79i: [
    { v: 2513.87, s: "$2514$", n: "$\\lambda=2L$ is the fundamental. The first overtone fits a full wave, so $\\lambda=L$", c: 4 },
    { v: 301.665, s: "$301.7$", n: "Use the mass per length $\\mu$, not the total mass", c: 2 },
  ],
  // P113
  P139i: [
    { v: 0.0165894, s: "$0.01659$", n: "This is the mass per length $\\mu$. Multiply by the length to get the mass", c: 3 },
    { v: 0.0325153, s: "$0.03252$", n: "This uses the diameter as the radius", c: 2 },
    { v: 8.12883, s: "$8.129$", n: "This is in grams. The answer is in kilograms", c: 2 },
  ],
  // P115
  P81i: [
    { v: 50.4758, s: "$50.5$", n: "Neither frequency is the true one. Approach and departure are both shifted from $f_0$", c: 5 },
  ],
  // P116
  P82i: [
    { v: 2.35023, s: "$2.35$", n: "The wall reflects a sound that is already shifted, so it shifts twice: $f_{\\mathrm{b}}\\approx 2fv/c$", c: 4 },
  ],
  // P117
  P83i: [
    { v: 0.0166, s: "$0.0166$", n: "The frequency is 20 Hz, not 20 kHz", c: 3 },
    { v: 6640.0, s: "$6640$", n: "Wavelength is $\\lambda=v/f$, not $vf$", c: 2 },
  ],
  // P119
  P85i: [
    { v: 0.000768791, s: "$7.69\\times10^{-4}$", n: "This is the intensity $I$. The question asks for the level: $\\beta=10\\log(I/I_0)$", c: 5 },
    { v: 91.8684, s: "$91.87$", n: "Missing the $\\frac{1}{2}$: $I=p^2/2\\rho v$", c: 3 },
  ],
  // P120
  P140i: [
    { v: 7.818, s: "$7.82$", n: "The value is right, but the $\\times10^{-4}$ was dropped when entering it", c: 6 },
  ],
  // P124
  P88i: [
    { v: 0.92973, s: "$0.93$", n: "Odd harmonics mean one end is closed, so the fundamental has $L=\\lambda/4$, not $\\lambda/2$", c: 13 },
    { v: 1.85946, s: "$1.86$", n: "This is the wavelength of the fundamental. In a closed pipe $L=\\lambda/4$", c: 7 },
  ],
  // P126
  P89i: [
    { v: 0.4433, s: "$0.4433$", n: "Harmonics 3 and 4 of the same fundamental mean both ends are open, so $L=\\lambda/2$", c: 2 },
    { v: 1.7732, s: "$1.773$", n: "This is the wavelength of the fundamental. With both ends open, $L=\\lambda/2$", c: 2 },
  ],
  // P128
  P143i: [
    { v: 0.163304, s: "$0.163$", n: "Decibels are logarithmic, so the level is not divided: $\\beta_2=\\beta_1-20\\log(r_2/r_1)$", c: 4 },
    { v: 59.7484, s: "$59.75$", n: "Intensity goes as $1/r^2$, which gives $20\\log(r_2/r_1)$, not $10\\log$", c: 2 },
  ],
  // P129
  P91i: [
    { v: 0.008232, s: "$0.00823$", n: "Intensity goes as pressure squared, so take the root: $p=\\sqrt{2\\rho vI}$", c: 3 },
    { v: 0.0641561, s: "$0.06416$", n: "Missing the 2: $p=\\sqrt{2\\rho vI}$", c: 2 },
  ],
  // P130
  P92i: [
    { v: 1.04167, s: "$1.04$", n: "These pipes are closed at one end, so $f=v/4L$, not $v/2L$", c: 5 },
    { v: 2.08333, s: "$2.083$", n: "Missing the 4: closed pipes have $f=v/4L$", c: 3 },
  ],
  // P131
  P144i: [
    { v: 120.213, s: "$120.2$", n: "This pipe is closed at one end, so $f=v/4L$, not $v/2L$", c: 4 },
    { v: 961.702, s: "$961.7$", n: "Upside down: $f=v/4L$, not $4v/L$", c: 2 },
  ],
  // P132
  P93i: [
    { v: 342.694, s: "$342.7$", n: "That is close to the speed of sound. The 8 Hz comes from two small shifts: $\\Delta f\\approx 2fv/c$", c: 3 },
  ],
  // P133
  P145i: [
    { v: 2157.06, s: "$2157$", n: "This is the reflected frequency $f'$. The beat is the difference: $f'-f$", c: 7 },
    { v: 3.52662, s: "$3.53$", n: "The wall reflects a sound that is already shifted, so it shifts twice: $f_{\\mathrm{b}}\\approx 2fv/c$", c: 4 },
  ],
  // P134
  P94i: [
    { v: 14.6383, s: "$14.64$", n: "Divide by the source frequency: $f'=f(1-u/v)$", c: 3 },
  ],
  // P135
  P146i: [
    { v: 77.5115, s: "$77.5$", n: "The alarm is at rest and the listener moves, so $f'=f(1+u/v)$, not the moving-source formula", c: 6 },
    { v: 43.7171, s: "$43.72$", n: "That formula is for a wave that shifts twice, like an echo. Here only the listener moves", c: 2 },
  ],
  // P138
  P147i: [
    { v: 4852.75, s: "$4853$", n: "This is the frequency of the out-of-tune note. The question asks for its wavelength", c: 2 },
  ],
  // P139
  P97i: [
    { v: 2420000.0, s: "$2.42\\times10^{6}$", n: "The speed is squared: $B=\\rho v^2$", c: 2 },
  ],
  // P140
  P98i: [
    { v: 14418600.0, s: "$1.44\\times10^{7}$", n: "The speed is squared: $E=\\rho v^2$", c: 3 },
  ],
  // P141
  P99i: [
    { v: 0.169792, s: "$0.170$", n: "Check the exponent: the problem gives $E=9\\times10^{10}$ Pa, not $9\\times10^{9}$ Pa", c: 11 },
  ],
  // P145
  P102i: [
    { v: 0.690335, s: "$0.690$", n: "This is the string length. The question asks for the radius, from the breaking stress", c: 6 },
  ],
  // P146
  P103i: [
    { v: 14.9558, s: "$14.96$", n: "This is $f/v$. Wavelength is the other way round: $\\lambda=v/f$", c: 4 },
  ],
  // P147
  P149i: [
    { v: 0.557045, s: "$0.557$", n: "This is one way only. The pulse also has to come back", c: 2 },
  ],
  // P148
  P104i: [
    { v: 60.6855, s: "$60.7$", n: "The whale hears a shifted sound and reflects it shifted again, so $\\Delta f\\approx 2fv/c$", c: 14 },
    { v: 20939.5, s: "$20939$", n: "This is a frequency. The question asks for the difference between the two frequencies", c: 3 },
  ],
};
