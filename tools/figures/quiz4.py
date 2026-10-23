"""Quiz 4 problem figures, redrawn as theme-aware SVG."""
import math
from svgkit import Fig, INK, PAPER, BLUE, RED, GOLD, DARK, pt, n, FONT
from quiz2 import dim_h, dim_v


def bar_half(x_end, y, apex):
    """One half of the cracked bar, 8 thick under its top edge, from its support at (x_end, y) to the apex."""
    ux, uy = apex[0] - x_end, apex[1] - y
    L = math.hypot(ux, uy)
    nx, ny = -uy / L * 8, ux / L * 8
    if x_end > apex[0]:
        nx, ny = -nx, -ny
    return [(x_end, y), apex, (apex[0] + nx, apex[1] + ny), (x_end + nx, y + ny)]


def f00():  # cracked bar between fixed supports, buckled up by x when heated
    t = 24  # headroom over the top bar: the animation buckles it as high as the lower one
    g = Fig(300, 184 + t)
    for y0 in (20 + t, 124 + t):
        g.rect(6, y0, 60, 48, fill=BLUE, fop=0.45, w=1.2)
        g.rect(234, y0, 60, 48, fill=BLUE, fop=0.45, w=1.2)
    # before: straight bar, its two halves meeting at the crack in the centre.
    # data-part/data-geom (supports' inner ends, crack, bar top, rise):
    # course/animations/quiz4.js heats it until it buckles like the lower one
    g.raw(f'<g data-part="bar" data-geom="66 234 150 {20 + t} 36">')
    for x_end in (66, 234):
        g.poly(bar_half(x_end, 20 + t, (150, 20 + t)), fill=RED, fop=0.55, w=1)
    g.raw('</g>')
    dim_h(g, 48 + t, 66, 234, 'L', 150, 38 + t, tick=0)
    # after: the two halves rise to meet at height x
    for x_end in (66, 234):
        g.poly(bar_half(x_end, 124 + t, (150, 88 + t)), fill=RED, fop=0.55, w=1)
    g.arrow(150, 108 + t, 150, 97 + t, w=1.1, size=7)
    g.arrow(150, 108 + t, 150, 123 + t, w=1.1, size=7)
    g.line(136, 124 + t, 164, 124 + t, w=0.9, dash='3 2', op=0.7)
    g.text(160, 114 + t, 'x', 16)  # under the right half, clear of the bar
    dim_h(g, 152 + t, 66, 234, 'L', 150, 166 + t, tick=0)
    return g


def f01():  # composite rod: piece A of length L_A, piece B
    g = Fig(382, 84)  # room on the right for the rod as the animation heats it
    # data-part: course/animations/quiz4.js lengthens A (and L_A with it)
    # more than B, from the fixed left end
    g.raw('<g data-part="rod-a">')
    g.rect(6, 46, 226, 26, fill=RED, fop=0.45, w=1.4)
    g.raw('</g><g data-part="rod-b">')
    g.rect(232, 46, 124, 26, fill=BLUE, fop=0.35, w=1.4)
    g.raw('</g><g data-part="label-a">')
    g.text(119, 59, 'A', 16, italic=False)
    g.raw('</g><g data-part="label-b">')
    g.text(294, 59, 'B', 16, italic=False)
    g.raw('</g><g data-part="length-a">')
    g.arrow(119, 30, 7, 30, w=1.1, size=9)
    g.arrow(119, 30, 231, 30, w=1.1, size=9)
    g.raw('</g><g data-part="label-a">')
    g.sub(119, 14, 'L', 'A', 17)
    g.raw('</g>')
    return g


def f02():  # Y of copper, brass and steel rods; heat flows from 100 °C to the 0 °C ends
    g = Fig(300, 336)
    top, j = (150, 56), (150, 204)
    le, re = (44, 306), (256, 306)
    rods = ((top, j, RED), (j, le, BLUE), (j, re, GOLD))
    for a, b, c in rods:
        g.line(*a, *b, INK, 7.5)
        g.line(*a, *b, c, 5)
    for a, b, c in rods:  # heat-flow arrows on each rod
        mx, my = a[0] + (b[0] - a[0]) * 0.55, a[1] + (b[1] - a[1]) * 0.55
        L = math.hypot(b[0] - a[0], b[1] - a[1])
        g.head(mx, my, (b[0] - a[0]) / L, (b[1] - a[1]) / L, INK, 17)
    # data-part/data-geom (hot end, junction, steel's end, brass's end): empty
    # at rest; course/animations/quiz4.js runs heat packets through it, under
    # the end dots
    g.raw(f'<g data-part="packets" data-geom="{top[0]} {top[1]} {j[0]} {j[1]} {le[0]} {le[1]} {re[0]} {re[1]}"></g>')
    for p in (top, le, re):
        g.circle(*p, 6.5, stroke=None, fill=INK)
    g.text(150, 32, '100 °C', 18, italic=False)
    g.text(le[0], le[1] + 24, '0 °C', 18, italic=False)
    g.text(re[0], re[1] + 24, '0 °C', 18, italic=False)
    g.text(172, 196, 'T °C', 18, italic=False, anchor='start')
    g.text(166, 122, 'Copper', 17, italic=False, anchor='start')
    g.rtext(78, 236, 'Steel', -43.6, 17)
    g.rtext(224, 236, 'Brass', 43.6, 17)
    return g


def f03():  # glass window of area A and thickness d, faces at T1 and T2
    g = Fig(156, 300)
    fx0, fx1, ytop, ybot = 48, 60, 66, 272
    bx, by = 48, -52  # the back edge sits up and to the right of the front edge
    g.poly([(fx1, ytop), (fx1 + bx, ytop + by), (fx1 + bx, ybot + by), (fx1, ybot)], fill=BLUE, fop=0.2, w=1.1)
    g.poly([(fx0, ytop), (fx1, ytop), (fx1 + bx, ytop + by), (fx0 + bx, ytop + by)], fill=BLUE, fop=0.3, w=1.1)
    g.poly([(fx0, ytop), (fx1, ytop), (fx1, ybot), (fx0, ybot)], fill=BLUE, fop=0.42, w=1.1)
    g.text(88, 92, 'A', 17)
    g.line(32, 172, fx0, 180, w=0.9)
    g.sub(20, 166, 'T', '1', 16)
    g.line(82, 172, fx1, 180, w=0.9)
    g.sub(94, 166, 'T', '2', 16)
    g.line(fx0, ybot + 2, fx0, ybot + 16, w=0.8, op=0.7)
    g.line(fx1, ybot + 2, fx1, ybot + 16, w=0.8, op=0.7)
    g.arrow(26, ybot + 12, fx0 - 1, ybot + 12, w=1, size=7)
    g.arrow(82, ybot + 12, fx1 + 1, ybot + 12, w=1, size=7)
    g.text(54, ybot + 22, 'd', 16)
    return g


def axes(g, ox, oy, xend, ytop, xlab=None, ylab=None):
    g.arrow(ox - 8, oy, xend, oy, w=1.3, size=10)
    g.arrow(ox, oy + 8, ox, ytop, w=1.3, size=10)


def mid_head(g, a, b, c, t=0.5, size=11):
    L = math.hypot(b[0] - a[0], b[1] - a[1])
    g.head(a[0] + (b[0] - a[0]) * t + (b[0] - a[0]) / L * size / 2,
           a[1] + (b[1] - a[1]) * t + (b[1] - a[1]) / L * size / 2,
           (b[0] - a[0]) / L, (b[1] - a[1]) / L, c, size)


# data-part/data-seg/data-geom on the p–V paths: course/animations/quiz4.js
# moves the arrowheads of the path a problem names round it. A segment is
# named by its end states in drawn order, with its line (x0 y0 x1 y1) or
# cubic Bézier (8 numbers); a head names its segment, its place t on it and
# 1 or -1 for pointing with or against the drawn order.
def seg(g, name, *pts):
    g.raw(f'<g data-part="seg" data-seg="{name}" data-geom="{" ".join(n(v) for p in pts for v in p)}">')


def head_tag(g, name, t, sign=1):
    g.raw(f'<g data-part="head" data-seg="{name}" data-geom="{t} {sign}">')


def unit_label(g, x, y, var, unit, anchor='middle', size=16):
    g.raw(f'<text x="{n(x)}" y="{n(y)}" font-family="{FONT}" font-size="{size}" text-anchor="{anchor}" '
          f'dominant-baseline="central" fill="{INK}" stroke="none"><tspan font-style="italic" font-weight="bold">{var}</tspan>'
          f' {unit}</text>')


def f04():  # p-V rectangle ABCD with both diagonals
    g = Fig(362, 236)
    ox, oy = 62, 196
    axes(g, ox, oy, 350, 12)
    unit_label(g, ox + 6, 12, 'p', '(atm)', anchor='start')
    unit_label(g, 346, oy + 22, 'V', '(L)', anchor='end')
    for x in range(87, 340, 50):
        g.line(x, oy - 5, x, oy + 5, w=1)
    for y in (52, 88, 124, 160):
        g.line(ox - 5, y, ox + 5, y, w=1)
    P = {'A': (137, 160), 'B': (237, 160), 'C': (237, 88), 'D': (137, 88)}
    A, B = P['A'], P['B']
    sides = (('AD', 0.5, BLUE), ('DC', 0.5, BLUE), ('CB', 0.5, BLUE), ('BA', 0.5, BLUE),
             ('DB', 0.25, RED), ('AC', 0.25, RED))
    for s, t, col in sides:
        seg(g, s, P[s[0]], P[s[1]])
        g.line(*P[s[0]], *P[s[1]], col, 2.2)
        g.raw('</g>')
    for s, t, col in sides:
        head_tag(g, s, t)
        mid_head(g, P[s[0]], P[s[1]], col, t)
        g.raw('</g>')
    g.text(122, 162, 'A', 17)
    g.text(252, 162, 'B', 17)
    g.text(252, 86, 'C', 17)
    g.text(122, 86, 'D', 17)
    g.sub(40, 160, 'p', '1', 16)
    g.sub(40, 88, 'p', '2', 16)
    g.sub(A[0], oy + 18, 'V', '1', 16)
    g.sub(B[0], oy + 18, 'V', '2', 16)
    gas_inset(g, 175, 20, 36, 90, ox, oy, rod=16, push=34)
    state_dot(g)
    return g


def bez_point(P, t):
    (x0, y0), (x1, y1), (x2, y2), (x3, y3) = P
    x = (1 - t) ** 3 * x0 + 3 * (1 - t) ** 2 * t * x1 + 3 * (1 - t) * t * t * x2 + t ** 3 * x3
    y = (1 - t) ** 3 * y0 + 3 * (1 - t) ** 2 * t * y1 + 3 * (1 - t) * t * t * y2 + t ** 3 * y3
    dx = 3 * (1 - t) ** 2 * (x1 - x0) + 6 * (1 - t) * t * (x2 - x1) + 3 * t * t * (x3 - x2)
    dy = 3 * (1 - t) ** 2 * (y1 - y0) + 6 * (1 - t) * t * (y2 - y1) + 3 * t * t * (y3 - y2)
    L = math.hypot(dx, dy)
    return x, y, dx / L, dy / L


def bez_d(P):
    (x0, y0), (x1, y1), (x2, y2), (x3, y3) = P
    return f'M{n(x0)},{n(y0)} C{n(x1)},{n(y1)} {n(x2)},{n(y2)} {n(x3)},{n(y3)}'


def f05():  # cycle a→c (constant p), c→b (adiabatic), b→a (constant V)
    g = Fig(300, 276)
    ox, oy = 34, 250
    g.line(ox, oy + 12, ox, 18, w=1.6)
    g.line(10, oy, 292, oy, w=1.6)
    unit_label(g, ox, 10, 'p', '')
    unit_label(g, 292, oy + 18, 'V', '', anchor='end')
    unit_label(g, 22, oy + 16, 'O', '')
    a, b, c = (108, 178), (108, 82), (214, 178)
    curve = (b, (132, 140), (162, 170), c)
    seg(g, 'ac', a, c)
    g.line(*a, *c, BLUE, 2.4)
    g.raw('</g>')
    seg(g, 'ba', b, a)
    g.line(*b, *a, BLUE, 2.4)
    g.raw('</g>')
    seg(g, 'bc', *curve)
    g.path(bez_d(curve), RED, 2.4)
    g.raw('</g>')
    head_tag(g, 'ac', 0.5)
    mid_head(g, a, c, BLUE)
    g.raw('</g>')
    head_tag(g, 'ba', 0.5)
    mid_head(g, b, a, BLUE)
    g.raw('</g>')
    x, y, ux, uy = bez_point(curve, 0.5)
    head_tag(g, 'bc', 0.5, -1)
    g.head(x - ux * 6, y - uy * 6, -ux, -uy, RED, 11)
    g.raw('</g>')
    for p in (a, b, c):
        g.circle(*p, 5, stroke=None, fill=INK)
    unit_label(g, a[0] - 18, a[1], 'a', '', size=18)
    unit_label(g, b[0] - 18, b[1], 'b', '', size=18)
    unit_label(g, c[0] + 18, c[1], 'c', '', size=18)
    gas_inset(g, 150, 16, 34, 72, ox, oy, rod=14, push=32)
    state_dot(g)
    return g


def f06():  # a→b (straight, both p and V change), b→c (constant p)
    g = Fig(376, 224)
    ox, oy = 58, 182
    g.line(ox, oy + 12, ox, 16, w=1.8)
    g.line(ox - 8, oy, 312, oy, w=1.8)
    g.raw(f'<text x="{ox - 8}" y="12" font-family="{FONT}" font-size="16" text-anchor="end" dominant-baseline="central" '
          f'fill="{INK}"><tspan font-style="italic" font-weight="bold">p</tspan> (Pa)</text>')
    g.raw(f'<text x="314" y="{oy}" font-family="{FONT}" font-size="16" text-anchor="start" dominant-baseline="central" '
          f'fill="{INK}"><tspan font-style="italic" font-weight="bold">V</tspan> (m<tspan dy="-6" font-size="11">3</tspan>)</text>')
    unit_label(g, ox - 12, oy + 14, 'O', '')
    xs = {'a': 154, 'b': 204, 'c': 254}
    for x in (104, 154, 204, 254):
        g.line(x, oy - 5, x, oy + 5, w=1)
    a, b, c = (xs['a'], 58), (xs['b'], 118), (xs['c'], 118)
    # data-part/data-geom (the V axis): empty at rest; where the problem asks
    # for the work, course/animations/quiz4.js fills the area under the path
    g.raw(f'<g data-part="work" data-geom="{oy}"></g>')
    seg(g, 'ab', a, b)
    g.line(*a, *b, BLUE, 2.6)
    g.raw('</g>')
    seg(g, 'bc', b, c)
    g.line(*b, *c, RED, 2.6)
    g.raw('</g>')
    head_tag(g, 'ab', 0.5)
    mid_head(g, a, b, BLUE)
    g.raw('</g>')
    head_tag(g, 'bc', 0.5)
    mid_head(g, b, c, RED)
    g.raw('</g>')
    for p in (a, b, c):
        g.circle(*p, 5.5, stroke=None, fill=INK)
    unit_label(g, a[0] - 16, a[1] - 2, 'a', '', size=18)
    unit_label(g, b[0] - 14, b[1] + 16, 'b', '', size=18)
    unit_label(g, c[0] + 16, c[1] + 4, 'c', '', size=18)
    g.sub(30, a[1], 'P', 'a', 18)
    g.sub(30, b[1], 'P', 'b', 18)
    for k, x in xs.items():
        g.sub(x, oy + 22, 'V', k, 18)
    return g


def f07():  # compress at constant P from B to D, heat at constant V from D to A; isotherm through A and B
    g = Fig(334, 252)
    ox, oy = 52, 220
    g.line(ox, oy + 6, ox, 10, w=1.3)
    g.line(ox, oy, 322, oy, w=1.3)
    g.text(ox - 8, 12, 'P', 17)
    unit_label(g, 318, oy + 18, 'V', '(L)', anchor='end')
    g.text(ox - 10, oy + 16, '0', 16, italic=False)
    for y in (46, 82, 118, 154, 190):
        g.line(ox, y, ox + 7, y, w=1.1)
    for x in (92, 140, 187, 235, 282):
        g.line(x, oy, x, oy - 7, w=1.1)
    A, D, B = (92, 46), (92, 190), (282, 190)
    pts = []
    for k in range(41):
        v = 34 + (264 - 34) * k / 40
        pts.append((ox + v, oy - 6930 / v))
    g.path('M' + ' L'.join(f'{n(x)},{n(y)}' for x, y in pts), BLUE, 2.4)
    g.line(ox, A[1], A[0], A[1], w=1, dash='5 4', op=0.8)
    g.line(ox, B[1], D[0], D[1], w=1, dash='5 4', op=0.8)
    g.line(D[0], D[1], D[0], oy, w=1, dash='5 4', op=0.8)
    g.line(B[0], B[1], B[0], oy, w=1, dash='5 4', op=0.8)
    seg(g, 'DA', D, A)
    g.line(*D, *A, RED, 3)
    g.raw('</g>')
    seg(g, 'BD', B, D)
    g.line(*B, *D, RED, 3)
    g.raw('</g>')
    g.arrow(106, 134, 106, 110, w=1.6, size=8)
    g.arrow(196, 178, 172, 178, w=1.6, size=8)
    for p in (A, D, B):
        g.circle(*p, 4.5, stroke=None, fill=INK)
    g.text(A[0] + 14, A[1], 'A', 16, italic=False)
    g.text(D[0] - 10, D[1] + 14, 'D', 16, italic=False)
    g.text(B[0] + 8, B[1] - 16, 'B', 16, italic=False)
    g.sub(30, A[1], 'P', 'A', 17)
    g.sub(30, B[1], 'P', 'B', 17)
    gas_inset(g, 150, 30, 44, 110, ox, oy, rod=24, push=30)
    state_dot(g)
    return g


def gas_inset(g, x0, y0, h, len_max, ox, oy, rod=16, push=32):
    """Hidden until played: a cylinder of the gas, closed at x0, for the
    animations of p–V paths (cylinder() in course/animations/quiz4.js).

    Drawn at the path's largest volume (gas length len_max); data-geom also
    gives the diagram's origin (ox, oy), which turns the state's place into a
    volume and a pressure. The animation moves the piston, colours the gas by
    temperature, sizes the arrow on the rod by pressure (pointing in while
    the gas is pushed in from outside, out while the gas pushes the piston
    out), shows the pins that hold the piston while the volume stays the
    same, heat coming in or leaving at the closed end, and an insulating
    jacket while no heat can pass."""
    cy, px = y0 + h / 2, x0 + len_max
    end, mouth = px + 8 + rod, px + 18
    g.raw(f'<g data-part="inset" opacity="0" data-geom="{n(x0)} {n(len_max)} {n(ox)} {n(oy)}">')
    g.raw('<g data-part="jacket" opacity="0">')
    g.path(f'M{n(mouth)},{n(y0 - 5)} L{n(x0 - 5)},{n(y0 - 5)} L{n(x0 - 5)},{n(y0 + h + 5)} L{n(mouth)},{n(y0 + h + 5)}',
           INK, 3.5, dash='1.5 3', op=0.55)
    g.raw('</g><g data-part="gas">')
    g.rect(x0, y0, len_max, h, stroke=None, fill=RED, fop=0.5)
    g.raw('</g>')
    g.path(f'M{n(mouth)},{n(y0)} L{n(x0)},{n(y0)} L{n(x0)},{n(y0 + h)} L{n(mouth)},{n(y0 + h)}', INK, 1.6)
    g.raw('<g data-part="piston">')
    g.rect(px, y0 + 1, 8, h - 2, fill=INK, fop=0.45, w=1.1)
    g.line(px + 8, cy, end, cy, w=2.2)
    g.raw('<g data-part="pins" opacity="0">')   # stops on the walls holding the piston where it is
    g.rect(px + 8, y0, 4, 7, stroke=None, fill=INK)
    g.rect(px + 8, y0 + h - 7, 4, 7, stroke=None, fill=INK)
    g.raw(f'</g><g data-part="push-in" data-geom="{n(end + 3)} {n(cy)}">')   # pushed in from outside (tip)
    g.arrow(end + 3 + push, cy, end + 3, cy, w=2, size=10)
    g.raw(f'</g><g data-part="push-out" opacity="0" data-geom="{n(end + 3)} {n(cy)}">')   # the gas pushes out (tail)
    g.arrow(end + 3, cy, end + 3 + push, cy, w=2, size=10)
    g.raw('</g></g>')
    gap = min(13, h / 3.2)
    for part, inward in (('heat-out', False), ('heat-in', True)):
        g.raw(f'<g data-part="{part}" opacity="0">')   # coloured cool / warm by the animation
        for k in range(3):
            y = cy + (k - 1) * gap
            a, b = (x0 - 30, x0 - 4) if inward else (x0 - 4, x0 - 30)
            g.arrow(a, y, b, y, INK, w=1.6, size=8)
        g.raw('</g>')
    g.raw('</g>')


def state_dot(g):
    """Hidden until played: the gas's state, moved along the path (and
    coloured by temperature) by course/animations/quiz4.js."""
    g.raw('<g data-part="state" opacity="0">')
    g.circle(0, 0, 5.5, stroke=PAPER, w=1.5, fill=RED)
    g.raw('</g>')


def f08():  # engine cycle: 1→2 constant V, 2→3 adiabatic, 3→1 constant p
    g = Fig(300, 250)
    ox, oy = 80, 214
    g.line(ox, oy + 12, ox, 16, w=1.2)
    g.line(ox - 8, oy, 276, oy, w=1.2)
    g.text(ox - 6, 10, 'p', 17)
    g.text(282, oy, 'V', 17, anchor='start')
    g.text(ox - 12, oy + 14, 'O', 16)
    p1, p2, p3 = (124, 170), (124, 48), (224, 170)
    curve = (p2, (142, 110), (172, 150), p3)
    seg(g, '12', p1, p2)
    g.line(*p1, *p2, BLUE, 2.4)
    g.raw('</g>')
    seg(g, '23', *curve)
    g.path(bez_d(curve), RED, 2.4)
    g.raw('</g>')
    seg(g, '31', p3, p1)
    g.line(*p3, *p1, BLUE, 2.4)
    g.raw('</g>')
    head_tag(g, '12', 0.5)
    mid_head(g, p1, p2, BLUE)
    g.raw('</g>')
    head_tag(g, '31', 0.5)
    mid_head(g, p3, p1, BLUE)
    g.raw('</g>')
    x, y, ux, uy = bez_point(curve, 0.5)
    head_tag(g, '23', 0.5)
    g.head(x + ux * 6, y + uy * 6, ux, uy, RED, 11)
    g.raw('</g>')
    for p in (p1, p2, p3):
        g.circle(*p, 5, stroke=None, fill=INK)
    g.line(ox - 5, p1[1], ox + 5, p1[1], w=1.2)
    g.text(ox - 10, p1[1], '1.00 atm', 14, italic=False, anchor='end')
    g.text(p1[0] - 10, p1[1] - 12, '1', 15, italic=False)
    g.sub(p1[0] - 22, p1[1] + 16, 'T', '1', 15)
    g.text(p2[0] - 12, p2[1], '2', 15, italic=False)
    g.sub(p2[0] + 22, p2[1], 'T', '2', 15)
    g.text(p3[0] + 6, p3[1] - 16, '3', 15, italic=False)
    g.sub(p3[0] - 18, p3[1] + 16, 'T', '3', 15)
    gas_inset(g, 184, 14, 30, 58, ox, oy, rod=10, push=30)
    state_dot(g)
    return g


FIGURES = [
    (0, f00, 'Cracked bar between supports, buckling up by x', 1),
    (1, f01, 'Composite rod of metals A and B', 1),
    (2, f02, 'Copper, steel and brass rods joined in a Y', 1),
    (3, f03, 'Glass window of area A and thickness d', 1),
    (4, f04, 'p–V cycle around rectangle ABCD with its diagonals', 3),
    (5, f05, 'Cycle a → c → b → a with an adiabat', 1),
    (6, f06, 'Path a → b → c', 4),
    (7, f07, 'Compression B → D, heating D → A, isotherm through A and B', 1),
    (8, f08, 'Engine cycle 1 → 2 → 3', 1),
]
