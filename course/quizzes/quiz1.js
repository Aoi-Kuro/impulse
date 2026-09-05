const Quiz_1_Problems = [

  // ──────────────────── Units ────────────────────

  { id:"P1", topic:"Units", answer:0.04167, units:["m"],
    text:"The critical mass of some fissionable material is about 6 kg. This element has a density of 19.8 g cm$^{-3}$. What would be the radius of a sphere of this material that has a critical mass?" },

  { id:"P2", topic:"Units", answer:5.46415, units:["g/cm^3"],
    text:"The critical mass of some fissionable material is about 6 kg, and at critical mass it forms a sphere of radius 6.4 cm. What is the density of this element? Give the answer in g cm$^{-3}$." },

  { id:"P3", topic:"Units", answer:18.307, units:["in^3"],
    text:"According to the label on a bottle of salad dressing, the volume of the contents is 0.3 L. Using the conversions 1 L = 1000 cm$^{3}$ and 1 in = 2.54 cm, express this volume in cubic inches." },

  { id:"P4", topic:"Units", answer:2.032, units:["ns"],
    text:"How many nanoseconds (ns) does it take light to travel 2 ft in a vacuum? The speed of light is $v = 3 \\times 10^8$ m s$^{-1}$, 1 ft = 0.3048 m." },

  { id:"P5", topic:"Units", answer:4.998, units:["L"],
    text:"A powerful engine has a displacement of 305 cubic inches. Express this displacement in liters (L) by using conversions 1 L = 1000 cm$^{3}$ and 1 in = 2.54 cm." },

  { id:"P6", topic:"Units", answer:4.86, units:["hectares"],
    text:"A square field measuring 100 m by 100 m has an area of 1 hectare. An acre has an area of 43600 ft$^{2}$. If a country lot has an area of 12 acres, what is the area in hectares? 1 ft = 0.3048 m. Use \"hectares\" for units in the answer." },

  { id:"P7", topic:"Units", answer:993.6, units:["m^3"],
    text:"2 astronauts are in a spherical space station. If, as is typical, each of them breathes about 500 cm$^{3}$ of air with each breath, what volume of air (in cubic meters) do these astronauts breathe in 69 days? Assume 10 breaths per minute." },

  { id:"P8", topic:"Units", answer:37.7595, units:[],
    text:"4 astronauts are in a spherical space station whose internal radius is 6 m. Each of them breathes about 520 cm³ of air with each breath, at 8 breaths per minute. After how many days will the astronauts have breathed a total volume of air equal to the internal volume of the station? (enter only numerical answer with no units)" },

  // ──────────────────── Uncertainty ────────────────────

  { id:"P9", topic:"Uncertainty", answer:5.1546e-06, units:[],
    text:"If a train travels 970 km from Berlin to Paris and then overshoots the end of the track by 5 m, what is the relative error in the total distance covered?" },

  { id:"P10", topic:"Uncertainty", answer:2.772, units:["m"],
    text:"A train travels 770 km from Berlin to Paris and then overshoots the end of the track. If the relative error in the total distance covered must not exceed $3.6 \\times 10^{-6}$, what is the largest overshoot that is acceptable? Give the answer in meters." },

  { id:"P11", topic:"Uncertainty", answer:0.075, units:["cm^2"],
    text:"A rectangular piece of aluminum is 5.70 ± 0.01 cm long and 1.80 ± 0.01 cm wide. If the area is in $A \\pm \\delta A$ format. Find the maximum possible uncertainty in the area $\\delta A$." },

  { id:"P12", topic:"Uncertainty", answer:0.06, units:["cm"],
    text:"A rectangular piece of aluminum is 8.55 ± 0.02 cm long and 2.7 ± 0.01 cm wide. If the perimeter is written in $P \\pm \\delta P$ format, find the maximum possible uncertainty in the perimeter $\\delta P$." },

  { id:"P13", topic:"Uncertainty", answer:0.2066875, units:["cm^3"],
    text:"A chocolate cookie is a circular disk with a diameter of 8.60 ± 0.03 cm and a thickness of 0.080 ± 0.003 cm. If the volume is in $V \\pm \\delta V$ format, find the maximum possible uncertainty in the volume $\\delta V$." },

  { id:"P14", topic:"Uncertainty", answer:0.452389, units:["cm^2"],
    text:"A chocolate cookie is a circular disk with a diameter of 9.6 ± 0.03 cm and a thickness of 0.1 ± 0.002 cm. If the area of its top circular face is written in $A \\pm \\delta A$ format, find the maximum possible uncertainty in that area $\\delta A$." },

  // ──────────────────── Vectors ────────────────────

  { id:"P15", topic:"Vectors", answer:6.8926, units:["m"],
    text:"For the vectors $\\vec{A}$ and $\\vec{B}$, find the magnitude of the vector sum $\\vec{A} + \\vec{B}$. Vector $\\vec{A}$ is 7 m and vector $\\vec{B}$ is 12 m long. <div class=\"fig-img-wrap\"><img src=\"course/images/quiz_1/unnamed.png\" alt=\"figure\"></div>" },

  { id:"P16", topic:"Vectors", answer:17.418, units:["m"],
    text:"For the vectors $\\vec{A}$ and $\\vec{B}$, find the magnitude of the vector difference $\\vec{A} - \\vec{B}$. Vector $\\vec{A}$ is 7 m and vector $\\vec{B}$ is 11 m long. <div class=\"fig-img-wrap\"><img src=\"course/images/quiz_1/unnamed.png\" alt=\"figure\"></div>" },

  { id:"P17", topic:"Vectors", answer:3.5, units:["m"],
    text:"Vector $\\vec{B}$ is 7 m long, see image below. Find the $x$-component of the vector $\\vec{B} = x\\mathbf{\\hat{i}} + y\\mathbf{\\hat{j}}$. <div class=\"fig-img-wrap\"><img src=\"course/images/quiz_1/unnamed.png\" alt=\"figure\"></div>" },

  { id:"P18", topic:"Vectors", answer:4.6904, units:[],
    text:"Given vector $\\vec{B} = 3\\mathbf{\\hat{i}} + 2\\mathbf{\\hat{j}} + 3\\mathbf{\\hat{k}}$, find its magnitude." },

  { id:"P19", topic:"Vectors", answer:37.13489, units:["m"],
    text:"Given the two displacements $\\vec{D} = 8\\mathbf{\\hat{i}} + 10\\mathbf{\\hat{j}} - 10\\mathbf{\\hat{k}}$ m and $\\vec{E} = 5\\mathbf{\\hat{i}} - 3\\mathbf{\\hat{j}} + 7\\mathbf{\\hat{k}}$ m, find the magnitude of the displacement $2\\vec{D}-\\vec{E}$." },

  { id:"P20", topic:"Vectors", answer:10.518, units:["m"],
    text:"Given the two displacements $\\vec{D} = 5\\mathbf{\\hat{i}} + 7\\mathbf{\\hat{j}} - 7\\mathbf{\\hat{k}}$ m and $\\vec{E} = 5\\mathbf{\\hat{i}} + 3\\mathbf{\\hat{j}} - 6\\mathbf{\\hat{k}}$ m, find the magnitude of the component of $\\vec{D}$ along the direction of $\\vec{E}$." },

  { id:"P21", topic:"Vectors", answer:18.8959, units:[],
    text:"Find the scalar product $\\vec{A} \\cdot \\vec{B}$ of the two vectors in figure below. The magnitudes of the vectors are $|\\vec{A}|$ = 7 and $|\\vec{B}|$ = 12. <div class=\"fig-img-wrap\"><img src=\"course/images/quiz_1/unnamed(1).png\" alt=\"figure\" width=\"300px\"></div>" },

  { id:"P22", topic:"Vectors", answer:81.8471, units:[],
    text:"Find the magnitude of the vector product $\\vec{A} \\times \\vec{B}$ of the two vectors in the figure below. The magnitudes of the vectors are $|\\vec{A}|$ = 8 and $|\\vec{B}|$ = 10.5. <div class=\"fig-img-wrap\"><img src=\"course/images/quiz_1/unnamed(1).png\" alt=\"figure\" width=\"300px\"></div>" },

  { id:"P23", topic:"Vectors", answer:2.0521, units:["rad"],
    text:"Find the angle (in radians) between the two vectors $\\vec{A} = 4\\mathbf{\\hat{i}} + 5\\mathbf{\\hat{j}} + 3\\mathbf{\\hat{k}}$ and $\\vec{B} = -2\\mathbf{\\hat{i}} + 1\\mathbf{\\hat{j}} - 4\\mathbf{\\hat{k}}$." },

  { id:"P24", topic:"Vectors", answer:33.4215, units:[],
    text:"Given the two vectors $\\vec{A} = 5\\mathbf{\\hat{i}} + 2\\mathbf{\\hat{j}} + 3\\mathbf{\\hat{k}}$ and $\\vec{B} = -4\\mathbf{\\hat{i}} + 4\\mathbf{\\hat{j}} - 3\\mathbf{\\hat{k}}$, find the magnitude of their vector product $\\vec{A} \\times \\vec{B}$." },

  { id:"P25", topic:"Vectors", answer:36.3731, units:[],
    text:"Vector $\\vec{A}$ has a magnitude of 3 units and is in the direction of the $+x$-axis. Vector $\\vec{B}$ has magnitude of 14 units and lies in the $xy$-plane, making an angle of 60° with the $+x$-axis. Find the magnitude of the vector product $\\vec{A} \\times \\vec{B}$." },

  { id:"P26", topic:"Vectors", answer:78.9882, units:[],
    text:"Vector $\\vec{A}$ has a magnitude of 7.5 units and is in the direction of the $+x$-axis. Vector $\\vec{B}$ has magnitude of 17.5 units and lies in the $xy$-plane, making an angle of 53° with the $+x$-axis. Find the magnitude of the scalar product $\\vec{A} \\cdot \\vec{B}$." },

  { id:"P27", topic:"Vectors", answer:0.104949, units:["rad"],
    text:"Two vectors $\\vec{A}$ and $\\vec{B}$ have magnitude $|\\vec{A}|$ = 6 and $|\\vec{B}|$ = 18. Their vector product is $\\vec{A} \\times \\vec{B} = 8\\mathbf{\\hat{i}} + 8\\mathbf{\\hat{j}}$. What is the angle (in radians) between $\\vec{A}$ and $\\vec{B}$?" },

  { id:"P28", topic:"Vectors", answer:122.484, units:[],
    text:"Two vectors $\\vec{A}$ and $\\vec{B}$ have magnitudes $|\\vec{A}|$ = 6.5 and $|\\vec{B}|$ = 19. Their vector product is $\\vec{A} \\times \\vec{B}$ = $9\\mathbf{\\hat{i}} + 13\\mathbf{\\hat{j}}$. What is the magnitude of their scalar product $\\vec{A} \\cdot \\vec{B}$?" },

  // ──────────────────── Kinematics of 1D motion ────────────────────

  { id:"P29", topic:"Kinematics of 1D motion", answer:4.0, units:["km/h"],
    text:"On a 44 km bike ride, the first 22 km were covered at an average speed of 12 km h$^{-1}$. What must the average speed over the next 22 km be to have your average speed for the total 44 km be 6 km h$^{-1}$? Use \"km h$^{-1}$\" units in the answer." },

  { id:"P30", topic:"Kinematics of 1D motion", answer:4.0650406504, units:["m/s^2"],
    text:"A world-class sprinter accelerated to his maximum in 3 s. He then maintains this speed for the remainder of a 100-m race, finishing with a total time of 9.7 s. What is the runner's average acceleration during the first 3 s?" },

  { id:"P31", topic:"Kinematics of 1D motion", answer:1.2786088735456, units:["m/s^2"],
    text:"A world-class sprinter accelerated to his maximum in 4 s. He then maintains this speed for the remainder of a 100-m race, finishing with a total time of 9.9 s. What is the runner's average acceleration for the entire race?" },

  { id:"P32", topic:"Kinematics of 1D motion", answer:21.3836, units:["m"],
    text:"A world-class sprinter accelerates uniformly from rest to his maximum speed in 3.4 s. He then maintains this speed for the remainder of a 100-m race, finishing with a total time of 9.65 s. What distance does the runner cover during the first 3.4 s?" },

  { id:"P33", topic:"Kinematics of 1D motion", answer:8.3927638888889, units:["m/s"],
    text:"Locations A and B are 19 km apart and a bird is making a round trip A-B-A. When traveling from A to B, the bird flies against the wind, while on the return trip it goes along the wind. The speed of the bird in stationary air is 32 km h$^{-1}$. Determine the average speed of the bird with respect to the ground in the round trip if the wind had a constant speed of 2.1 m s$^{-1}$ for the entire time. Provide the answer in units m s$^{-1}$." },

  { id:"P34", topic:"Kinematics of 1D motion", answer:22.9631681167722, units:["m"],
    text:"When the Sun is directly overhead, an eagle flies toward the ground with a constant velocity of 13 km h$^{-1}$ at 58° below the horizontal line. Calculate the distance its shadow traveled on the level ground in 12 s." },

  { id:"P35", topic:"Kinematics of 1D motion", answer:29.3535, units:["m"],
    text:"An eagle flies toward the ground with a constant velocity of 14 km h$^{-1}$ at 57° below the horizontal line. Calculate the vertical distance the eagle descends in 9 s." },

  { id:"P36", topic:"Kinematics of 1D motion", answer:1.5211348322352, units:["s"],
    text:"A metal key is dropped down from the bridge. When it passes by a height $h$ = 41 m, its speed is 19.5 m s$^{-1}$. How long after this moment the key will hit the ground? The gravitational acceleration is $g$ = 9.8 m s$^{-2}$." },

  { id:"P37", topic:"Kinematics of 1D motion", answer:4.80919, units:["s"],
    text:"A metal key is thrown straight up from a bridge. On its way up it passes a point at height $h$ = 46 m above the ground with a speed of 14 m s$^{-1}$. How long after this moment will the key hit the ground? The gravitational acceleration is $g$ = 9.8 m s$^{-2}$." },

  { id:"P38", topic:"Kinematics of 1D motion", answer:3.1559467676119, units:["m/s"],
    text:"A lunar lander is making its descent to Moon Base. The engine is cut off when the lander is 3 m above the surface and has a downward speed of 0.6 m s$^{-1}$. With the engine off, the lander is in free fall. What is the speed of the lander just before it touches the surface? The acceleration due to gravity on the moon is 1.6 m s$^{-2}$." },

  { id:"P39", topic:"Kinematics of 1D motion", answer:3.52908, units:["s"],
    text:"A lunar lander is making its descent to Moon Base. The engine is cut off when the lander is 8.5 m above the surface and has an upward speed of 0.45 m s$^{-1}$. With the engine off, the lander is in free fall. How long after the engine cutoff does the lander touch the surface? The acceleration due to gravity on the Moon is 1.62 m s$^{-2}$." },

  { id:"P40", topic:"Kinematics of 1D motion", answer:64.05, units:["m"],
    text:"A motorcyclist heading east through a small city accelerates after he passes the signpost marking the city limits. His acceleration is a constant 3.9 m s$^{-2}$. At time $t$ = 0 he is 4.5 m east of the signpost, moving east at 14 m s$^{-1}$. Find his position with respect to the signpost at time $t$ = 3 s." },

  { id:"P41", topic:"Kinematics of 1D motion", answer:28.9, units:["m/s"],
    text:"A motorcyclist heading east through a small city accelerates after he passes the signpost marking the city limits. His acceleration is a constant 4.3 m s$^{-2}$. At time $t$ = 0 he is 5 m east of the signpost, moving east at 16 m s$^{-1}$. Find his velocity at time $t$ = 3 s." },

  { id:"P42", topic:"Kinematics of 1D motion", answer:6.8144897959184, units:["m/s"],
    text:"A particle slows down with an acceleration of 1.8 m s$^{-2}$ for 4.9 s moving straight for 55 m long. Find the speed of the particle at the end of the distance." },

  { id:"P43", topic:"Kinematics of 1D motion", answer:13.77, units:["m/s"],
    text:"A particle slows down uniformly with an acceleration of magnitude 1.3 m s$^{-2}$ for 5.8 s while moving in a straight line a distance of 58 m. Find the speed of the particle at the beginning of this distance." },

  { id:"P44", topic:"Kinematics of 1D motion", answer:2.7560855863193, units:["m/s"],
    text:"A person walks 88.1 m at a speed of 1.22 m s$^{-1}$ and then runs 244.2 m at a speed of 5.05 m s$^{-1}$ along a straight track. Compute the average speed." },

  { id:"P45", topic:"Kinematics of 1D motion", answer:1.07538, units:["m/s"],
    text:"A person walks 94.3 m at a speed of 1.33 m s$^{-1}$ along a straight track and then immediately runs back along the same track, in the opposite direction, a distance of 218.5 m at a speed of 4.9 m s$^{-1}$. Compute the magnitude of the average velocity for the whole trip." },

  { id:"P46", topic:"Kinematics of 1D motion", answer:147.27272727273, units:["m"],
    text:"A motorist traveling with a constant speed of 18 m s$^{-1}$ passes a school-crossing corner, where the speed limit is 11 m s$^{-1}$. Just as the motorist passes, a police officer on a motorcycle at the corner starts off in pursuit with constant acceleration of 4.4 m s$^{-2}$. What is the distance they have traveled from the corner to the point where the officer catches up with the motorist?" },

  { id:"P47", topic:"Kinematics of 1D motion", answer:36.0, units:["m/s"],
    text:"A motorist traveling with a constant speed of 18 m s$^{-1}$ passes a school-crossing corner, where the speed limit is 10 m s$^{-1}$. Just as the motorist passes, a police officer on a motorcycle standing at the corner starts off in pursuit with constant acceleration of 3.6 m s$^{-2}$. What is the officer's speed at the moment he catches up with the motorist?" },

  { id:"P48", topic:"Kinematics of 1D motion", answer:7.2727272727273, units:["s"],
    text:"A motorist traveling with a constant speed of 16 m s$^{-1}$ passes a school-crossing corner, where the speed limit is 10 m s$^{-1}$. Just as the motorist passes, a police officer on a motorcycle at the corner starts off in pursuit with constant acceleration of 4.4 m s$^{-2}$. How much time elapses before the officer catches with the motorist?" },

  { id:"P49", topic:"Kinematics of 1D motion", answer:33.75, units:["m"],
    text:"A motorist traveling with a constant speed of 18 m s$^{-1}$ passes a school-crossing corner. Just as the motorist passes, a police officer on a motorcycle at the corner starts off in pursuit with constant acceleration of 4.8 m s$^{-2}$. What is the maximum distance by which the motorist gets ahead of the officer?" },

  { id:"P50", topic:"Kinematics of 1D motion", answer:26.076809620811, units:["m/s"],
    text:"An airport for small planes has a runway of 200 m long. One kind of airplane that might use this airfield can accelerate at 1.7 m s$^{-2}$. Calculate the speed this airplane can reach before takeoff?" },

  { id:"P51", topic:"Kinematics of 1D motion", answer:195.11136363636, units:["m"],
    text:"One kind of airplane must reach a speed before takeoff of at least 29.3 m s$^{-1}$, and can accelerate at 2.2 m s$^{-2}$. What minimum length must the runway have in order for the airplane to be able to reach this speed before takeoff? <div class=\"fig-img-wrap\"><img src=\"course/images/quiz_1/unnamed(2).png\" alt=\"figure\" width=\"400px\"></div>" },

  { id:"P52", topic:"Kinematics of 1D motion", answer:4.5643546458764, units:["s"],
    text:"How long does it take a car to cross a 25 m-wide intersection after the light turns green, if the car accelerates from rest at a constant acceleration of 2.4 m s$^{-2}$?" },

  { id:"P53", topic:"Kinematics of 1D motion", answer:2.53838, units:["s"],
    text:"How long does it take a car to cross a 21 m-wide intersection if the car enters the intersection already moving at 5.1 m s$^{-1}$ and accelerates at a constant 2.5 m s$^{-2}$?" },

  // ──────────────────── Kinematics of 2D straight line motion ────────────────────

  { id:"P54", topic:"Kinematics of 2D straight line motion", answer:4.2047592083257, units:["m/s"],
    text:"A river flows due south with a speed of 1.8 m s$^{-1}$. A man steers a motorboat across the river; his velocity relative to the water is 3.8 m s$^{-1}$ due east. What is the magnitude of the velocity of man relative to the earth?" },

  { id:"P55", topic:"Kinematics of 2D straight line motion", answer:3.85746, units:["m/s"],
    text:"A river flows due south with a speed of 1.9 m s$^{-1}$. A man steers a motorboat across the river; the speed of the boat relative to the water is 4.3 m s$^{-1}$, and he steers so that he travels due east relative to the earth. What is the magnitude of his velocity relative to the earth?" },

  { id:"P56", topic:"Kinematics of 2D straight line motion", answer:242.5, units:["s"],
    text:"A river flows due south with a speed of 1.8 m s$^{-1}$. A man steers a motorboat across the river; his velocity relative to the water is 4 m s$^{-1}$ due east. The river is 970 m wide. How much time is required to cross the river?" },

  { id:"P57", topic:"Kinematics of 2D straight line motion", answer:237.356, units:["s"],
    text:"A river flows due south with a speed of 2.3 m s$^{-1}$ and is 1000 m wide. A man steers a motorboat so that his velocity relative to the earth is due east; the speed of the boat relative to the water is 4.8 m s$^{-1}$. How much time is required to cross the river?" },

  { id:"P58", topic:"Kinematics of 2D straight line motion", answer:513.333, units:["m"],
    text:"A river flows due south with a speed of 2.2 m s$^{-1}$. A man steers a motorboat across the river; his velocity relative to the water is 3.3 m s$^{-1}$ due east. The river is 770 m wide. How far downstream from his starting point does he land?" },

  // ──────────────────── Kinematics of projectile motion ────────────────────

  { id:"P59", topic:"Kinematics of projectile motion", answer:7290.5381227112, units:["m"],
    text:"To start an avalanche on a mountain slope, an artillery shell is fired with an initial velocity of 291 m s$^{-1}$ at 57° above the horizontal. It explodes on the mountainside 46 s after firing. What is the horizontal coordinate of the shell where it explodes relative to its firing point?" },

  { id:"P60", topic:"Kinematics of projectile motion", answer:2556.7818058073, units:["m"],
    text:"To start an avalanche on a mountain slope, an artillery shell is fired with an initial velocity of 301 m s$^{-1}$ at 61° above the horizontal. It explodes on the mountainside 41 s after firing. What is the vertical distance of the shell where it explodes relative to its firing point?" },

  { id:"P61", topic:"Kinematics of projectile motion", answer:161.174, units:["m/s"],
    text:"To start an avalanche on a mountain slope, an artillery shell is fired with an initial velocity of 296 m s$^{-1}$ at 62° above the horizontal. It explodes on the mountainside 35 s after firing. What is the speed of the shell at the moment it explodes? The gravitational acceleration is $g$ = 9.8 m s$^{-2}$." },

  { id:"P62", topic:"Kinematics of projectile motion", answer:26.435095919879, units:["m"],
    text:"A ball is tossed from an upper-story window of a building. The ball is given an initial velocity of 5.5 m s$^{-1}$ at an angle of 16° below the horizontal. It strikes the ground 5 s later. How far horizontally from the base of the building does the ball strike the ground? The gravitational acceleration is $g$ = 9.8 m s$^{-2}$." },

  { id:"P63", topic:"Kinematics of projectile motion", answer:133.7381978, units:["m"],
    text:"A ball is tossed from an upper-story window of a building. The ball is given an initial velocity of 6 m s$^{-1}$ at an angle of 22° below the horizontal. It strikes the ground 5 s later. Find the height from which the ball was thrown. The gravitational acceleration is $g$ = 9.8 m s$^{-2}$." },

  { id:"P64", topic:"Kinematics of projectile motion", answer:133.243, units:["m"],
    text:"A ball is tossed from an upper-story window of a building. The ball is given an initial velocity of 6 m s$^{-1}$ at an angle of 27° above the horizontal. It strikes the ground 5.5 s later. Find the height from which the ball was thrown. The gravitational acceleration is $g$ = 9.8 m s$^{-2}$." },

  { id:"P65", topic:"Kinematics of projectile motion", answer:182.18112244898, units:["m"],
    text:"During a fireworks display, a shell is shot into the air with an initial speed of 69 m s$^{-1}$ at an angle of 60° above the horizontal. The fuse is timed to ignite the shell just as it reaches its highest point above the ground. Calculate the height at which the shell explodes. The gravitational acceleration is $g$ = 9.8 m s$^{-2}$." },

  { id:"P66", topic:"Kinematics of projectile motion", answer:8.7422747172345, units:["s"],
    text:"During a fireworks display, a shell is shot into the air with an initial speed of 87 m s$^{-1}$ at an angle of 80° above the horizontal. The fuse is timed to ignite the shell just as it reaches its highest point above the ground. How much time passes between the launch of the shell and the explosion? The gravitational acceleration is $g$ = 9.8 m s$^{-2}$. <div class=\"fig-img-wrap\"><img src=\"course/images/quiz_1/unnamed(3).png\" alt=\"figure\"></div>" },

  { id:"P67", topic:"Kinematics of projectile motion", answer:196.416, units:["m"],
    text:"During a fireworks display, a shell is shot into the air with an initial speed of 83 m s$^{-1}$ at an angle of 75° above the horizontal. The fuse is timed to ignite the shell 3 s after launch. Calculate the height at which the shell explodes. The gravitational acceleration is $g$ = 9.8 m s$^{-2}$." },

  { id:"P68", topic:"Kinematics of projectile motion", answer:3.5774604860727, units:["m/s"],
    text:"In a local café, a customer slides an empty mug down the counter for a refill. The mug slides off the counter and strikes the floor $x_{\\text{f}}$ = 1.49 m from the base of the counter. If the height of the counter is $y_{i}$ = 85 cm, what is the magnitude of the velocity with which the mug left the counter? The gravitational acceleration is $g$ = 9.8 m s$^{-2}$. <div class=\"fig-img-wrap\"><img src=\"course/images/quiz_1/unnamed(4).png\" alt=\"figure\" width=\"300px\"></div>" },

  { id:"P69", topic:"Kinematics of projectile motion", answer:5.05558, units:["m/s"],
    text:"In a local café, a customer slides an empty mug down the counter for a refill. The mug slides off the counter and strikes the floor $x^{\\text{f}}$ = 1.26 m from the base of the counter. The height of the counter is $y_{i}$ = 82 cm. What is the magnitude of the velocity with which the mug strikes the floor? The gravitational acceleration is $g$ = 9.8 m s$^{-2}$." },

  { id:"P70", topic:"Kinematics of projectile motion", answer:40.4622, units:[],
    text:"In a local café, a customer slides an empty mug down the counter for a refill. The mug slides off the counter and strikes the floor $x^{\\text{f}}$ = 2.04 m from the base of the counter. The height of the counter is $y_{i}$ = 87 cm. At what angle below the horizontal does the mug strike the floor? Give the answer in degrees. The gravitational acceleration is $g$ = 9.8 m s$^{-2}$." },

  // ──────────────────── Kinematics of 2D and 3D motion in vectors form ────────────────────

  { id:"P71", topic:"Kinematics of 2D and 3D motion in vectors form", answer:164.03333333333, units:["m"],
    text:"A rocket moves in the $xy$-plane. The rocket's acceleration has components $a_{x}(t) = \\alpha t^{2}$ and $a_{y}(t) = \\beta - \\gamma t$, where $\\alpha$ = 2.4 m s$^{-4}$, $\\beta$ = 9 m s$^{-2}$, and $\\gamma$ = 1.6 m s$^{-3}$. At $t$ = 0 the rocket is at the origin and has velocity $\\vec{v}_{0} = v_{0x}\\mathbf{\\hat{i}} + v_{0y}\\mathbf{\\hat{j}}$, with $v_{0x}$ = 1.3 m s$^{-1}$ and $v_{0y}$ = 5 m s$^{-1}$. Calculate the position of the rocket along the vertical axis at $t$ = 7 s." },

  { id:"P72", topic:"Kinematics of 2D and 3D motion in vectors form", answer:47.866666666667, units:["m"],
    text:"A rocket moves in the $xy$-plane. The rocket's acceleration has components $a_{x}(t) = \\alpha t^{2}$ and $a_{y}(t) = \\beta - \\gamma t$, where $\\alpha$ = 2 m s$^{-4}$, $\\beta$ = 7.5 m s$^{-2}$, and $\\gamma$ = 1.4 m s$^{-3}$. At $t$ = 0 the rocket is at the origin and has velocity $\\vec{v}_{0} = v_{0x}\\mathbf{\\hat{i}} + v_{0y}\\mathbf{\\hat{j}}$, with $v_{0x}$ = 1.3 m s$^{-1}$ and $v_{0y}$ = 8 m s$^{-1}$. Calculate the position of the rocket along horizontal axis at $t$ = 4 s." },

  { id:"P73", topic:"Kinematics of 2D and 3D motion in vectors form", answer:60.797843529008, units:["m/s"],
    text:"A rocket moves in the $xy$-plane. The rocket's acceleration has components $a_{x}(t) = \\alpha t^{2}$ and $a_{y}(t) = \\beta - \\gamma t$, where $\\alpha$ = 2.3 m s$^{-4}$, $\\beta$ = 9 m s$^{-2}$, and $\\gamma$ = 1.1 m s$^{-3}$. At $t$ = 0 the rocket is at the origin and has velocity $\\vec{v}_{0} = v_{0x}\\mathbf{\\hat{i}} + v_{0y}\\mathbf{\\hat{j}}$, with $v_{0x}$ = 1.2 m s$^{-1}$ and $v_{0y}$ = 7 m s$^{-1}$. Calculate the magnitude of the velocity at $t$ = 4 s." },

  { id:"P74", topic:"Kinematics of 2D and 3D motion in vectors form", answer:0.19611613513818, units:["m/s^2"],
    text:"A fish swimming in a horizontal plane has velocity $\\vec{v}_{i} = -3\\mathbf{\\hat{i}} + 3\\mathbf{\\hat{j}}$ m s$^{-1}$ at a point in the ocean. After the fish swims with constant acceleration for 26 s, its velocity is $\\vec{v} = -2\\mathbf{\\hat{i}} + 8\\mathbf{\\hat{j}}$ m s$^{-1}$. What is the magnitude of the acceleration?" },

  { id:"P75", topic:"Kinematics of 2D and 3D motion in vectors form", answer:45.0, units:[],
    text:"A fish swimming in a horizontal plane has velocity $\\vec{v}_{i} = -5\\mathbf{\\hat{i}} + 1\\mathbf{\\hat{j}}$ m s$^{-1}$ at a point in the ocean. After the fish swims with constant acceleration for 29 s, its velocity is $\\vec{v} = 4\\mathbf{\\hat{i}} + 10\\mathbf{\\hat{j}}$ m s$^{-1}$. What is the angle of the acceleration vector, measured counterclockwise from the $+x$ axis? Give the answer in degrees." },

  { id:"P76", topic:"Kinematics of 2D and 3D motion in vectors form", answer:-107.53846153846, units:["m"],
    text:"A fish swimming in a horizontal plane has velocity $\\vec{v}_{i} = 2\\mathbf{\\hat{i}} + 6\\mathbf{\\hat{j}}$ m s$^{-1}$ at a point in the ocean where the position relative to a certain rock is $\\vec{r}_{i} = -6\\mathbf{\\hat{i}} + 4\\mathbf{\\hat{j}}$ m. After the fish swims with constant acceleration for 13 s, its velocity is $\\vec{v} = -2\\mathbf{\\hat{i}} + 2\\mathbf{\\hat{j}}$ m s$^{-1}$. If the fish maintains constant acceleration, what is its horizontal position at $t$ = 33 s?" },

  { id:"P77", topic:"Kinematics of 2D and 3D motion in vectors form", answer:227.076923, units:["m"],
    text:"A fish swimming in a horizontal plane has velocity $\\vec{v}_{i} = 3\\mathbf{\\hat{i}} + 1\\mathbf{\\hat{j}}$ m s$^{-1}$ at a point in the ocean where the position relative to a certain rock is $\\vec{r}_{i} = 3\\mathbf{\\hat{i}} + 4\\mathbf{\\hat{j}}$ m. After the fish swims with constant acceleration for 13 s, its velocity is $\\vec{v} = 8\\mathbf{\\hat{i}} + 7\\mathbf{\\hat{j}}$ m s$^{-1}$. If the fish maintains constant acceleration, what is its vertical position at $t$ = 29 s?" },

  { id:"P78", topic:"Kinematics of 2D and 3D motion in vectors form", answer:81.334863373587, units:["m"],
    text:"A particle starts from the origin at $t$ = 0 with an initial velocity having an x component of -3 m s$^{-1}$ and a y component of $-5$ m s$^{-1}$. The particle moves in the $xy$ plane with an x component of acceleration only, given by $a_{x}$ = 5.2 m s$^{-2}$. Determine the distance from the origin at $t$ = 6 s." },

  { id:"P79", topic:"Kinematics of 2D and 3D motion in vectors form", answer:251.58895047279, units:["m/s"],
    text:"A spaceship is traveling at a constant velocity of $v = 255 \\mathbf{\\vec{i}}$ m s$^{-1}$ when its engines fire up, giving it constant acceleration $\\vec{a} = -2\\mathbf{\\hat{i}} + 12\\mathbf{\\hat{k}}$ m s$^{-2}$. What is the magnitude of the spaceship's velocity 3 s after the engines fired?" },

  { id:"P80", topic:"Kinematics of 2D and 3D motion in vectors form", answer:816.106, units:["m"],
    text:"A spaceship is traveling at a constant velocity of $v = 275 \\mathbf{\\vec{i}}$ m s$^{-1}$ when its engines fire up, giving it constant acceleration $\\vec{a} = -2.2\\mathbf{\\hat{i}} + 9\\mathbf{\\hat{k}}$ m s$^{-2}$. What is the magnitude of the spaceship's displacement 3 s after the engines fired?" },

  // ──────────────────── Circular motion ────────────────────

  { id:"P81", topic:"Circular motion", answer:0.3501886215, units:["m/s^2$"],
    text:"The car passes over a rise in the roadway such that the top of the rise is shaped like a circle of radius 530 m. At the moment the car is at the top of the rise, its velocity is 24 km h$^{-1}$ and constant acceleration parallel to the roadway is 0.34 m s$^{-2}$. What is the magnitude of the total acceleration vector for the car at this instant? <div class=\"fig-img-wrap\"><img src=\"course/images/quiz_1/unnamed(5).png\" alt=\"figure\" width=\"300px\"></div>" },

  { id:"P82", topic:"Circular motion", answer:0.192103, units:["m/s^2"],
    text:"A car passes over a rise in the roadway such that the top of the rise is shaped like a circle of radius 580 m. The car moves at a constant speed of 38 km h$^{-1}$. What is the magnitude of the total acceleration of the car at the moment it is at the top of the rise?" },

  { id:"P83", topic:"Circular motion", answer:2905.0, units:["N"],
    text:"A car of mass 1430 kg starts from rest on a horizontal circular track of radius 61 m. Its speed is increased uniformly and in 49 seconds it makes it a full circle. What was the net force acting on the car at the moment when it completed the first semicircle?" },

  { id:"P84", topic:"Circular motion", answer:2.788, units:["m/s"],
    text:"A bucket of water whirls around a vertical circle of radius 79.3 cm. What is the minimum speed that the bucket must have at the top of its circular motion if the water is not to spill out of the upside-down bucket? Take the gravitational acceleration $g$ = 9.8 m s$^{-2}$." },

  { id:"P85", topic:"Circular motion", answer:1.65509, units:["s"],
    text:"A bucket of water is whirled around a vertical circle of radius 68 cm. What is the maximum period of revolution the bucket can have if the water is not to spill out of the upside-down bucket at the top of the circle? Take the gravitational acceleration $g$ = 9.8 m s$^{-2}$." },

  { id:"P86", topic:"Circular motion", answer:14.7, units:["m/s"],
    text:"A ball of 0.45 kg is attached at the end of a cord and revolves in a circle of radius 1.3 m on a frictionless horizontal surface. The cord will break if the tension in it exceeds 75 N. What is the maximum speed the ball can have without breaking the cord?" },

  { id:"P87", topic:"Circular motion", answer:18.9169, units:["m/s"],
    text:"A ball of 0.35 kg is attached at the end of a cord and revolves in a vertical circle of radius 1.75 m. The cord will break if the tension in it exceeds 75 N. What is the maximum speed the ball can have at the lowest point of the circle without breaking the cord? Take the gravitational acceleration $g$ = 9.8 m s$^{-2}$." },

  { id:"P88", topic:"Circular motion", answer:0.779, units:[],
    text:"A bicycle accelerates uniformly along a circular path at a flat horizontal surface. Bicycle is initially at rest and the tangential acceleration is 1.2 m s$^{-2}$. The bicycle makes one half of the circle before it skids off the circular path. Calculate coefficient of static friction between the bicycle and the surface taking gravitational acceleration $g$ = 9.8 m s$^{-2}$." },

  { id:"P89", topic:"Circular motion", answer:1.63845, units:["m/s^2"],
    text:"A bicycle initially at rest accelerates uniformly along a circular path at a flat horizontal surface. The bicycle makes one third of the circle before it skids off the circular path. If the coefficient of static friction between the bicycle and the surface is known and equals 0.72, find the tangential acceleration taking gravitational acceleration $g$ = 9.8 m s$^{-2}$." },

  { id:"P90", topic:"Circular motion", answer:1.627, units:["m/s"],
    text:"A block of mass $m$ = 1 kg is moving with constant speed in a circle with radius $r$ = 0.18 m on a frictionless table. The block is attached to 1.5 kg mass, $M$, by a cord through a hole in the table. Find the speed with which m must move for M to stay at rest. Take gravitational acceleration $g$ = 9.8 m s$^{-2}$. <div class=\"fig-img-wrap\"><img src=\"course/images/quiz_1/unnamed(6).png\" alt=\"figure\"></div>" },

  { id:"P91", topic:"Circular motion", answer:3.00752, units:["kg"],
    text:"A block of mass $m$ = 1.4 kg is moving with constant speed $v$ = 2 m s$^{-1}$ in a circle of radius $r$ = 0.19 m on a frictionless table. The block is attached to a hanging mass $M$ by a cord passing through a hole in the table. Find the mass $M$ that stays at rest. Take the gravitational acceleration $g$ = 9.8 m s$^{-2}$." },

  { id:"P92", topic:"Circular motion", answer:0.721, units:["m/s"],
    text:"A ball suspended from a pivot on a string of length $L$ = 88 cm revolves in a horizontal plane with constant speed $v$. The string maintains an angle of $\\theta$ = 14° with respect to the vertical. Find $v$ taking gravitational acceleration $g$ = 9.8 m s$^{-2}$.<div class=\"fig-svg-wrap\"><svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 75.13 86.657\" width=\"250\"><g opacity=\".7\"><ellipse cx=\"37.842\" cy=\"70.493\" rx=\"27.296\" ry=\"11.65\" fill=\"none\" stroke=\"currentColor\" stroke-dasharray=\"1.989 1.989\" stroke-miterlimit=\"10\" stroke-width=\".3\"/></g><line x1=\"37.842\" y1=\"1.276\" x2=\"37.842\" y2=\"70.493\" fill=\"none\" opacity=\".7\" stroke=\"currentColor\" stroke-dasharray=\"4\" stroke-miterlimit=\"10\" stroke-width=\".3\"/><path d=\"M1.421,73.919c3.671,7.143,18.584,12.488,36.421,12.488\" fill=\"none\" stroke=\"var(--svg-blue)\" stroke-miterlimit=\"10\" stroke-width=\".5\"/><polygon points=\".555 70.493 0 75.838 1.62 74.135 3.902 74.698 .555 70.493\" fill=\"var(--svg-blue)\"/><circle cx=\"37.842\" cy=\"70.493\" r=\"1.276\" fill=\"currentColor\"/><line x1=\"37.842\" y1=\"1.276\" x2=\"59.831\" y2=\"77.657\" fill=\"none\" stroke=\"currentColor\" stroke-miterlimit=\"10\" stroke-width=\".6\"/><circle cx=\"37.842\" cy=\"1.276\" r=\"1.276\" fill=\"currentColor\"/><circle cx=\"59.831\" cy=\"77.657\" r=\"5.669\" fill=\"var(--svg-red)\"/><g fill=\"currentColor\"><text transform=\"translate(53.454 46.616)\" font-family=\"STIXTwoText-Italic, 'STIX Two Text'\" font-size=\"10\" font-style=\"italic\"><tspan x=\"0\" y=\"0\">L</tspan></text><text transform=\"translate(39.955 41.829)\" font-family=\"STIXTwoText-Italic, 'STIX Two Text'\" font-size=\"10\" font-style=\"italic\"><tspan x=\"0\" y=\"0\">θ</tspan></text></g><path d=\"M46.641,31.84c-1.426.411-2.879.721-4.349.928s-2.952.312-4.436.313\" fill=\"none\" opacity=\".7\" stroke=\"currentColor\" stroke-miterlimit=\"10\" stroke-width=\".3\"/></svg></div>" },

  { id:"P93", topic:"Circular motion", answer:0.47177751, units:["rad"],
    text:"A car of mass $m$ = 1200 kg travels around a circular, banked road of radius $R$ = 80 m. The road is inclined at an angle $\\theta$ above the horizontal, as shown in the figure. The car travels at a constant speed of $v$ = 20 m s$^{-1}$. Assume that friction between the tires and the road is negligible. Determine the required banking angle $\\theta$ (in radians) so that the car can travel around the curve without relying on friction. The gravitational acceleration is $g$ = 9.8 m s$^{-2}$. <div class=\"fig-img-wrap\"><img src=\"course/images/quiz_1/unnamed(8).png\" alt=\"figure\"></div>" },

  // ──────────────────── Friction ────────────────────

  { id:"P94", topic:"Friction", answer:0.305, units:[],
    text:"Figure shows a block with mass $m_{1}$ = 3.561 kg on a horizontal surface, connected by a massless string to a hook where mass $m_{2}$ can be increased smoothly. The pulley has a negligible mass and no friction. When $m_{2}$ = 2.92 kg it begins to accelerate downwards at a rate of 1.645 m s$^{-2}$. Calculate the difference between static and kinetic coefficients of friction, $\\mu_{\\text{s}} - \\mu_{\\text{k}}$, between $m_{1}$ and the surface. Take gravitational acceleration $g$ = 9.8 m s$^{-2}$. <div class=\"fig-img-wrap\"><img src=\"course/images/quiz_1/unnamed(9).png\" alt=\"figure\"></div>" },

  { id:"P95", topic:"Friction", answer:2.24824, units:["m/s^2"],
    text:"Figure shows a block with mass $m_1$ = 4 kg on a horizontal surface, connected by a massless string over a massless frictionless pulley to a hanging mass $m_2$ = 2.8 kg. The coefficient of kinetic friction between $m_1$ and the surface is 0.31. Calculate the magnitude of the acceleration of the blocks. The gravitational acceleration is $g$ = 9.8 m s$^{-2}$. <div class=\"fig-img-wrap\"><img src=\"course/images/quiz_1/unnamed(9).png\" alt=\"figure\"></div>" },

  { id:"P96", topic:"Friction", answer:6.55, units:["m/s^2"],
    text:"Figure shows a block with mass $m_{1}$ = 26.2 kg on a horizontal surface, connected to a $m_{2}$ = 4.3 kg block by a massless string. The pulley is massless and frictionless. A force of 302.2 N acts on $m_{1}$ at an angle of 30.9°. The coefficient of kinetic friction between $m_{1}$ and the surface is 0.17. Determine the upward acceleration of $m_{2}$. Take gravitational acceleration $g$ = 9.8 m s$^{-2}$. <div class=\"fig-img-wrap\"><img src=\"course/images/quiz_1/unnamed(10).png\" alt=\"figure\"></div>" },

  { id:"P97", topic:"Friction", answer:9.507, units:["m/s"],
    text:"A force of magnitude 23.2 N is applied in the horizontal direction to a block of mass 4.4 kg placed on the horizontal surface. Taking the coefficient of kinetic friction between the block and the surface equal 0.15, calculate the speed of the block 2.5 seconds after it started moving. Take gravitational acceleration $g$ = 9.8 m s$^{-2}$." },

  { id:"P98", topic:"Friction", answer:23.1964, units:["m/s"],
    text:"A force of magnitude 46.5 N is applied at an angle of 27° above the horizontal to a block of mass 4.7 kg resting on a horizontal surface. Taking the coefficient of kinetic friction between the block and the surface equal to 0.1, calculate the speed of the block 2.8 s after it starts moving. Take the gravitational acceleration $g$ = 9.8 m s$^{-2}$." },

  { id:"P99", topic:"Friction", answer:749.53631, units:["N"],
    text:"Figure shows two blocks with masses $m_{1}$ = 20.6 kg and $m_{2}$ = 61.2 kg; the blocks are free to move. The surface beneath $m_{2}$ is frictionless and the coefficient of static friction between the blocks is 0.36. Find the minimal force $F$ required to hold $m_{1}$ against $m_{2}$? <div class=\"fig-img-wrap\"><img src=\"course/images/quiz_1/unnamed(11).png\" alt=\"figure\"></div>" },

  { id:"P100", topic:"Friction", answer:9.56522, units:["m/s^2"],
    text:"Figure shows two blocks with masses $m_1$ = 21 kg and $m_2$ = 59.5 kg. A horizontal force $F$ = 770 N presses $m_1$ against the vertical face of $m_2$, and the coefficient of static friction between the blocks is large enough that $m_1$ does not slip down. The surface beneath $m_2$ is frictionless. Find the magnitude of the acceleration of the two blocks. <div class=\"fig-img-wrap\"><img src=\"course/images/quiz_1/unnamed(11).png\" alt=\"figure\"></div>" },

  // ──────────────────── Newton’s 2nd law ────────────────────

  { id:"P101", topic:"Newton’s 2nd law", answer:0.7071, units:["m/s^2"],
    text:"A cord exerts a force $F$ = 5 N at an angle $\\theta$ = 45° above the horizontal to a block of mass 5 kg, pulling the block along a horizontal frictionless floor. What is the magnitude of the acceleration of the block?" },

  { id:"P102", topic:"Newton’s 2nd law", answer:42.2897, units:["N"],
    text:"A cord exerts a force $F$ = 12 N at an angle $\\theta$ = 34° above the horizontal to a block of mass 5 kg, pulling the block along a horizontal frictionless floor. What is the magnitude of the normal force exerted on the mass by the floor? <div class=\"fig-img-wrap\"><img src=\"course/images/quiz_1/unnamed(12).png\" alt=\"figure\"></div>" },

  { id:"P103", topic:"Newton’s 2nd law", answer:56.6792, units:["N"],
    text:"A rod exerts a force $F$ = 10.5 N at an angle $\\theta$ = 47° below the horizontal on a block of mass 5 kg, pushing the block along a horizontal frictionless floor. What is the magnitude of the normal force exerted on the block by the floor? The gravitational acceleration is $g$ = 9.8 m s$^{-2}$." },

  { id:"P104", topic:"Newton’s 2nd law", answer:1326.76923, units:["N"],
    text:"The weight of an astronaut plus his space suit on the Moon is 220 N. The acceleration due to gravity on the surface of the Moon is 1.625 m s$^{-2}$. How much does the suited astronaut weigh on Earth? The gravitational acceleration on Earth is $g$ = 9.8 m s$^{-2}$." },

  { id:"P105", topic:"Newton’s 2nd law", answer:122.222, units:["kg"],
    text:"The weight of an astronaut plus his space suit on the Moon is 198 N. The acceleration due to gravity on the surface of the Moon is 1.62 m s$^{-2}$. What is the mass of the suited astronaut on the Earth, where the gravitational acceleration is $g$ = 9.8 m s$^{-2}$?" },

  { id:"P106", topic:"Newton’s 2nd law", answer:6250.0, units:["N"],
    text:"The driver in the car with a mass of 1300 kg applies the brakes when the car is moving at 90 km h$^{-1}$, and the car comes to rest after traveling 65 m. What is the magnitude of the net force on the car causing its deceleration of the motion?" },

  { id:"P107", topic:"Newton’s 2nd law", answer:0.317864, units:[],
    text:"The driver of a car of mass 1440 kg applies the brakes when the car is moving at 73 km h$^{-1}$, and the car comes to rest after traveling 66 m. What is the coefficient of kinetic friction between the tires and the road? The gravitational acceleration is $g$ = 9.8 m s$^{-2}$." },

  { id:"P108", topic:"Newton’s 2nd law", answer:14.4, units:["N"],
    text:"A force $F$ lifts vertically a chain consisting of five links, each of mass 0.6 kg. The chain is lifted with a constant acceleration of magnitude $a$ = 2.2 m s$^{-2}$. What is the magnitude of the force that link 3 exerts on link 2. The gravitational acceleration is $g$ = 9.8 m s$^{-2}$. <div class=\"fig-img-wrap\"><img src=\"course/images/quiz_1/unnamed(13).png\" alt=\"figure\"></div>" },

  { id:"P109", topic:"Newton’s 2nd law", answer:5.95, units:["N"],
    text:"A force $F$ lifts vertically a chain consisting of five links, each of mass 0.1 kg. The chain is lifted with a constant acceleration of magnitude $a$ = 2.1 m s$^{-2}$. Find the magnitude of the force $|\\vec{F}|$ that must be exerted on the top link to achieve this acceleration? The gravitational acceleration is $g$ = 9.8 m s$^{-2}$. <div class=\"fig-img-wrap\"><img src=\"course/images/quiz_1/unnamed(13).png\" alt=\"figure\"></div>" },

  { id:"P110", topic:"Newton’s 2nd law", answer:19.965, units:["N"],
    text:"A force $F$ lifts vertically a chain consisting of five links, each of mass 0.55 kg, numbered as in the figure: link 1 at the bottom and link 5 at the top. The chain is lifted with a constant acceleration of magnitude $a$ = 2.3 m s$^{-2}$. What is the magnitude of the force that link 4 exerts on link 3? The gravitational acceleration is $g$ = 9.8 m s$^{-2}$. <div class=\"fig-img-wrap\"><img src=\"course/images/quiz_1/unnamed(13).png\" alt=\"figure\"></div>" },

  { id:"P111", topic:"Newton’s 2nd law", answer:10.0, units:["N"],
    text:"A force $F$ lifts vertically a chain consisting of five links, each of mass 0.2 kg, numbered as in the figure: link 1 at the bottom and link 5 at the top. The chain is lifted with a constant acceleration of magnitude $a$ = 2.7 m s$^{-2}$. What is the magnitude of the force that link 5 exerts on link 4? The gravitational acceleration is $g$ = 9.8 m s$^{-2}$. <div class=\"fig-img-wrap\"><img src=\"course/images/quiz_1/unnamed(13).png\" alt=\"figure\"></div>" },

  { id:"P112", topic:"Newton’s 2nd law", answer:2.70111, units:["s"],
    text:"There is a banana at the top of a 9.12 m long rope. A monkey of mass $m$ = 10.9 kg starts to climb up to reach a banana. The rope will snap if the tension exceeds 134.07 N. Calculate the least amount of time the monkey could take to reach the banana without breaking the rope. The gravitational acceleration is $g$ = 9.8 m s$^{-2}$." },

  { id:"P113", topic:"Newton’s 2nd law", answer:130.452, units:["N"],
    text:"There is a banana at the top of a 10 m long rope. A monkey of mass $m$ = 10.4 kg starts from rest at the bottom and climbs to the banana in 2.7 s with constant acceleration. What is the tension in the rope? The gravitational acceleration is $g$ = 9.8 m s$^{-2}$." },

  { id:"P114", topic:"Newton’s 2nd law", answer:31.5, units:["m"],
    text:"A particle of mass 2 kg is acted on by a single force $F =14 \\mathbf{\\hat{i}}$ N. If the particle starts at rest, how far does it travel in the first 3 s?" },

  { id:"P115", topic:"Newton’s 2nd law", answer:87.0, units:["m"],
    text:"A particle of mass 2 kg is acted on by a single force $F =14 \\mathbf{\\hat{i}}$ N. At $t$ = 0 the particle has velocity $\\vec{v}_{0} = -6.5\\mathbf{\\hat{i}}$ m s$^{-1}$. What is the magnitude of its displacement during the first 6 s?" },

  { id:"P116", topic:"Newton’s 2nd law", answer:66.0468, units:["kg"],
    text:"An elevator accelerating upward carries a man standing on a weighing scale indicating $F_{1}$ = 678.9 N. The scale reads $F_{2}$ = 767.3 N when the man picks up a 8.6 kg box. Find the man's mass." },

  { id:"P117", topic:"Newton’s 2nd law", answer:2.78503, units:["m/s^2"],
    text:"A man of mass 73.5 kg stands on a weighing scale in an elevator that is accelerating upward. The scale reads 925 N. Find the magnitude of the acceleration of the elevator. The gravitational acceleration is $g$ = 9.8 m s$^{-2}$." },

  { id:"P118", topic:"Newton’s 2nd law", answer:13.491, units:["N"],
    text:"Particle moves with constant velocity $\\vec{v} = 2\\mathbf{\\hat{i}} - 7\\mathbf{\\hat{j}}$ m s$^{-1}$ under the combined action of three forces. Two of the forces acting on this particle are $\\vec{F}_{1} = 6\\mathbf{\\hat{i}} + 7\\mathbf{\\hat{j}} - 10\\mathbf{\\hat{k}}$ N and $\\vec{F}_{2} = -9\\mathbf{\\hat{i}} - 9\\mathbf{\\hat{j}} - 3\\mathbf{\\hat{k}}$ N. What is the third vector magnitude?" },

  { id:"P119", topic:"Newton’s 2nd law", answer:1.09756, units:["m/s^2"],
    text:"The friction is very small for ice skating and can be neglected. Find the acceleration magnitude of an ice dancer A of mass 53.3 kg pushing his partner B of mass 66.4 kg with the force 58.5 N." },

  { id:"P120", topic:"Newton’s 2nd law", answer:0.979133, units:["m/s^2"],
    text:"The friction is very small for ice skating and can be neglected. Find the magnitude of the acceleration of ice dancer B of mass 62.3 kg while her partner A of mass 54.3 kg pushes her with a force of 61 N." },

  // ──────────────────── Application of Newton’s laws ────────────────────

  { id:"P121", topic:"Application of Newton’s laws", answer:5399.518, units:["N"],
    text:"Two ropes are connected to a steel cable that supports a hanging weight. If the maximum tension either rope can sustain without breaking is 4200 N, determine the maximum value of the hanging weight that those ropes can safely support. Ignore the weight of the ropes and the steel cable. <div class=\"fig-img-wrap\"><img src=\"course/images/quiz_1/unnamed(14).png\" alt=\"figure\"></div>" },

  { id:"P122", topic:"Application of Newton’s laws", answer:1954.7, units:["N"],
    text:"Two ropes are connected to a steel cable that supports a hanging weight of 3850 N. The ropes make angles of 60° and 40° with the ceiling, as shown in the figure. Determine the tension in the rope that makes the 40° angle with the ceiling. Ignore the weight of the ropes and the steel cable. <div class=\"fig-img-wrap\"><img src=\"course/images/quiz_1/unnamed(14).png\" alt=\"figure\"></div>" },

  { id:"P123", topic:"Application of Newton’s laws", answer:220.0, units:["N"],
    text:"A worker lifts a weight of 440 N by pulling down on a rope with a force $F$. Find the magnitude of the force $F$ if the weight is lifted at a constant speed. Assume that the rope, pulleys, and chains all have negligible weights. <div class=\"fig-img-wrap\"><img src=\"course/images/quiz_1/unnamed(15).png\" alt=\"figure\"></div>" },

  { id:"P124", topic:"Application of Newton’s laws", answer:230.714, units:["N"],
    text:"A worker lifts a weight of 380 N using the arrangement of pulleys shown in the figure, by pulling down on a rope with a force $F$. Find the magnitude of the force $F$ if the weight is lifted with a constant upward acceleration of 2.1 m s$^{-2}$. Assume that the rope, pulleys, and chains all have negligible weight. The gravitational acceleration is $g$ = 9.8 m s$^{-2}$. <div class=\"fig-img-wrap\"><img src=\"course/images/quiz_1/unnamed(15).png\" alt=\"figure\"></div>" },

  { id:"P125", topic:"Application of Newton’s laws", answer:10.666, units:["N"],
    text:"The clothesline has a mass 600 g, and each end makes an angle 16° with horizontal. What is the tension at each end of the clothesline? The gravitational acceleration is $g$ = 9.8 m s$^{-2}$. <div class=\"fig-img-wrap\"><img src=\"course/images/quiz_1/unnamed(16).png\" alt=\"figure\"></div>" },

  { id:"P126", topic:"Application of Newton’s laws", answer:14.078, units:["N"],
    text:"A clothesline has a mass of 840 g, and each end makes an angle of 73° with the vertical. What is the tension at each end of the clothesline? The gravitational acceleration is $g$ = 9.8 m s$^{-2}$." },

  { id:"P127", topic:"Application of Newton’s laws", answer:195.7938, units:["kg"],
    text:"A block with mass $m_{1}$ = 280 kg is placed on an inclined plane with slope angle $\\alpha$ = 39° and is connected to a second hanging block with mass $m_{2}$ by a cord passing over a small, frictionless pulley. The coefficient of kinetic friction is 0.09. Find the mass $m_{2}$ for which block $m_{1}$ moves up the plane at constant speed once it is set in motion. <div class=\"fig-img-wrap\"><img src=\"course/images/quiz_1/unnamed(17).png\" alt=\"figure\"></div>" },

  { id:"P128", topic:"Application of Newton’s laws", answer:62.75, units:["kg"],
    text:"A block with mass $m_{1}$ = 150 kg is placed on an inclined plane with slope angle $\\alpha$ = 29° and is connected to a second hanging block with mass $m_{2}$ by a cord passing over a small, frictionless pulley. The coefficient of kinetic friction is 0.076. Find the mass $m_{2}$ for which block $m_{1}$ moves down the plane at constant speed once it is set in motion. <div class=\"fig-img-wrap\"><img src=\"course/images/quiz_1/unnamed(17).png\" alt=\"figure\"></div>" },

  { id:"P129", topic:"Application of Newton’s laws", answer:165.928, units:["kg"],
    text:"A block with mass $m_1$ = 185 kg is placed on an inclined plane with slope angle $\\alpha$ = 33° and is connected to a second hanging block with mass $m_2$ by a cord passing over a small, frictionless pulley. The coefficient of kinetic friction between $m_1$ and the incline is 0.12. Find the mass $m_2$ for which $m_1$ moves up the plane with a constant acceleration of 1.3 m s$^{-2}$. The gravitational acceleration is $g$ = 9.8 m s$^{-2}$." },

  { id:"P130", topic:"Application of Newton’s laws", answer:1590.14, units:["N"],
    text:"A block with mass $m_1$ = 225 kg is placed on an inclined plane with slope angle $\\alpha$ = 42° and is connected to a second hanging block by a cord passing over a small, frictionless pulley. The coefficient of kinetic friction between $m_1$ and the incline is 0.07. Find the tension in the cord for which $m_1$ moves up the plane at constant speed once it is set in motion. The gravitational acceleration is $g$ = 9.8 m s$^{-2}$. <div class=\"fig-img-wrap\"><img src=\"course/images/quiz_1/unnamed(17).png\" alt=\"figure\"></div>" },

  { id:"P131", topic:"Application of Newton’s laws", answer:10.1567, units:["N"],
    text:"Block $A$ weighs 72 N. The coefficient of static friction between the block and the surface on which it rests is 0.29. Angle of the cord with horizontal is $\\alpha$ = 52°. The weight $w$ is 13 N and the system is in equilibrium. Find the friction force exerted on block $A$. <div class=\"fig-img-wrap\"><img src=\"course/images/quiz_1/unnamed(18).png\" alt=\"figure\"></div>" },

  { id:"P132", topic:"Application of Newton’s laws", answer:17.76, units:["N"],
    text:"Block $A$ weighs 74 N. The coefficient of static friction between the block and the surface on which it rests is 0.24. Angle of the cord with horizontal is $\\alpha$ = 45°. Find the maximum weight $w$ for which the system will remain in equilibrium. <div class=\"fig-img-wrap\"><img src=\"course/images/quiz_1/unnamed(18).png\" alt=\"figure\"></div>" },

  { id:"P133", topic:"Application of Newton’s laws", answer:0.176374, units:[],
    text:"Block $A$ weighs 62 N and rests on a horizontal surface. The angle of the cord with the horizontal is $\\alpha$ = 58°. The weight $w$ is 17.5 N and the system is in equilibrium. What is the minimum coefficient of static friction between block $A$ and the surface on which it rests? <div class=\"fig-img-wrap\"><img src=\"course/images/quiz_1/unnamed(18).png\" alt=\"figure\"></div>" },

  { id:"P134", topic:"Application of Newton’s laws", answer:0.748, units:["N"],
    text:"Block $A$ weighs 1.3 N and $B$ weighs 3.1 N. The coefficient of kinetic friction between block $B$ and the surfaces is 0.17, and coefficient of static friction between block $A$ and block $B$ is 0.17. Find the magnitude of the horizontal force $F$ necessary to drag block $B$ to the left at constant speed if $A$ rests on $B$ and moves with it. <div class=\"fig-img-wrap\"><img src=\"course/images/quiz_1/unnamed(19).png\" alt=\"figure\"></div>" },

  { id:"P135", topic:"Application of Newton’s laws", answer:1.32, units:["N"],
    text:"Block $A$ weighs 1.1 N and $B$ weighs 3.3 N. The coefficient of kinetic friction between all surfaces is 0.24. Find the magnitude of the horizontal force $F$ necessary to drag block $B$ to the left at constant speed if $A$ is held at rest. <div class=\"fig-img-wrap\"><img src=\"course/images/quiz_1/unnamed(20).png\" alt=\"figure\"></div>" },

  { id:"P136", topic:"Application of Newton’s laws", answer:0.731, units:["N"],
    text:"Block $A$ weighs 1.15 N and block $B$ weighs 3.15 N. The coefficient of kinetic friction between block $B$ and the floor is 0.17. The cord shown in the figure connecting block $A$ to the wall has been cut, so block $A$ rests freely on top of $B$ and moves together with it. Find the magnitude of the horizontal force $F$ necessary to drag block $B$ to the left at constant speed. <div class=\"fig-img-wrap\"><img src=\"course/images/quiz_1/unnamed(19).png\" alt=\"figure\"></div>" },

  { id:"P137", topic:"Application of Newton’s laws", answer:18.245804831566, units:["N"],
    text:"A window washer pushes his scrub brush up a vertical window at constant speed by applying a force $F$ at an angle $\\alpha$ = 58.8°. The brush weighs 14 N and the coefficient of kinetic friction is $\\mu_{\\text{k}}$ = 0.17. Calculate the magnitude of the force $F$. <div class=\"fig-img-wrap\"><img src=\"course/images/quiz_1/unnamed(21).png\" alt=\"figure\"></div>" },

  { id:"P138", topic:"Application of Newton’s laws", answer:7.0445, units:["N"],
    text:"A window washer pushes his scrub brush up a vertical window at constant speed by applying a force $F$ at an angle $\\alpha$ = 54.8°. The brush weighs 9 N and the coefficient of kinetic friction is $\\mu_{\\text{k}}$ = 0.14. Calculate the normal force exerted by the window on the brush. <div class=\"fig-img-wrap\"><img src=\"course/images/quiz_1/unnamed(21).png\" alt=\"figure\"></div>" },

  { id:"P139", topic:"Application of Newton’s laws", answer:16.3772, units:["N"],
    text:"A window washer pushes his scrub brush up a vertical window with a constant upward acceleration of 1 m s$^{-2}$ by applying a force $F$ at an angle $\\alpha$ = 53.8° above the horizontal. The brush weighs 10.5 N and the coefficient of kinetic friction is $\\mu_{\\text{k}}$ = 0.17. Calculate the magnitude of the force $F$. The gravitational acceleration is $g$ = 9.8 m s$^{-2}$." },

  { id:"P140", topic:"Application of Newton’s laws", answer:797.88, units:["N"],
    text:"You are standing on a bathroom scale in an elevator in a tall building. Your mass is 61 kg. The elevator starts from rest and travels upwards with a speed that varies with time according to $v(t) = (2 \\text{ m s}^{-2})t + (0.16 \\text{ m s}^{-3})t^{2}$. When $t$ = 4 s, what is the reading of the bathroom scale? The gravitational acceleration is $g$ = 9.8 m s$^{-2}$." },

  { id:"P141", topic:"Application of Newton’s laws", answer:3.7618675, units:["m/s^2"],
    text:"A hammer is hanging by a light rope from the ceiling of a bus. The ceiling of the bus is parallel to the roadway. The bus is traveling in a straight line on a horizontal street. You observe that the hammer hangs at rest with respect to the bus when the angle between the rope and the ceiling of the bus is 69°. What is the acceleration of the bus? The gravitational acceleration is $g$ = 9.8 m s$^{-2}$." },

  { id:"P142", topic:"Application of Newton’s laws", answer:5.77264, units:["m/s^2"],
    text:"A hammer is hanging by a light rope from the ceiling of a bus. The ceiling of the bus is parallel to the roadway. The bus is traveling in a straight line on a horizontal street. You observe that the hammer hangs at rest with respect to the bus when the angle between the rope and the vertical direction is 30.5°. What is the acceleration of the bus? The gravitational acceleration is $g$ = 9.8 m s$^{-2}$." },

  { id:"P143", topic:"Application of Newton’s laws", answer:84.58, units:["N"],
    text:"A small remote-control car with mass 2 kg moves at a constant speed of $v$ = 11.4 m s$^{-1}$ in a vertical circle inside a hollow metal cylinder that has a radius of 4 m. What is the magnitude of the normal force exerted on the car by the walls of the cylinder at point $A$? The gravitational acceleration is $g$ = 9.8 m s$^{-2}$. <div class=\"fig-img-wrap\"><img src=\"course/images/quiz_1/unnamed(22).png\" alt=\"figure\"></div>" },

  { id:"P144", topic:"Application of Newton’s laws", answer:67.1495, units:["N"],
    text:"A small remote-control car with mass 2.2 kg moves at a constant speed of $v$ = 12.7 m s$^{-1}$ in a vertical circle inside a hollow metal cylinder that has a radius of 4 m. What is the magnitude of the normal force exerted on the car by the walls of the cylinder at point $B$? The gravitational acceleration is $g$ = 9.8 m s$^{-2}$. <div class=\"fig-img-wrap\"><img src=\"course/images/quiz_1/unnamed(23).png\" alt=\"figure\"></div>" },

  { id:"P145", topic:"Application of Newton’s laws", answer:6.49153, units:["m/s"],
    text:"A small remote-control car with mass 1.9 kg moves in a vertical circle inside a hollow metal cylinder that has a radius of 4.3 m. What is the minimum speed the car must have at point $B$ in order to maintain contact with the wall of the cylinder? The gravitational acceleration is $g$ = 9.8 m s$^{-2}$. <div class=\"fig-img-wrap\"><img src=\"course/images/quiz_1/unnamed(23).png\" alt=\"figure\"></div>" },

  { id:"P146", topic:"Application of Newton’s laws", answer:40.818, units:["m/s"],
    text:"Find the terminal velocity of a 72-kg skydiver falling in a spread-eagle position. Assume the density of air is $\\rho$ = 1.21 kg m$^{-3}$, a skydiver descending in a spread-eagle position has a cross-sectional area of $A$ = 0.7 m$^{2}$ and a drag coefficient of $C$ = 1. The gravitational acceleration is $g$ = 9.8 m s$^{-2}$." },

  { id:"P147", topic:"Application of Newton’s laws", answer:0.738381, units:["m^2"],
    text:"A 73-kg skydiver falling in a spread-eagle position has a drag coefficient of $C$ = 0.8 and reaches a terminal velocity of 45.5 m s$^{-1}$. The density of air is $\\rho$ = 1.17 kg m$^{-3}$. What is the skydiver's cross-sectional area? The gravitational acceleration is $g$ = 9.8 m s$^{-2}$." },

  { id:"P148", topic:"Application of Newton’s laws", answer:495.61, units:["N"],
    text:"A 74-kg person rides in a 33-kg cart moving at 11 m s$^{-1}$ at the top of a hill that is in the shape of an arc of a circle with a radius of 39 m. What is the apparent weight of the person as the cart passes over the top of the hill? The gravitational acceleration is $g$ = 9.8 m s$^{-2}$." },

  { id:"P149", topic:"Application of Newton’s laws", answer:20.765, units:["m/s"],
    text:"A 74-kg person rides in a 23-kg cart moving at 12 m s$^{-1}$ at the top of a hill that is in the shape of an arc of a circle with a radius of 44 m. Determine the maximum speed that the cart may travel at the top of the hill without losing contact with the surface. The gravitational acceleration is $g$ = 9.8 m s$^{-2}$." },

  { id:"P150", topic:"Application of Newton’s laws", answer:1084.74, units:["N"],
    text:"A 82-kg person rides in a 37-kg cart moving at 12 m s$^{-1}$ at the bottom of a valley that is in the shape of an arc of a circle with a radius of 42 m. What is the apparent weight of the person as the cart passes through the lowest point of the valley? The gravitational acceleration is $g$ = 9.8 m s$^{-2}$." },

];