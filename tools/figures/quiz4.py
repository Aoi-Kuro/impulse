"""Quiz 4 problem figures, redrawn as theme-aware SVG."""
import math
from svgkit import Fig, INK, PAPER, BLUE, RED, GOLD, DARK, pt, n, FONT
from quiz2 import dim_h, dim_v


def f00():  # cracked bar between fixed supports, buckled up by x when heated
    g = Fig(300, 184)
    for y0 in (20, 124):
        g.rect(6, y0, 60, 48, fill=BLUE, fop=0.45, w=1.2)
        g.rect(234, y0, 60, 48, fill=BLUE, fop=0.45, w=1.2)
    # before: straight bar with a crack at the centre
    g.rect(66, 20, 168, 8, fill=RED, fop=0.55, w=1)
    g.line(150, 20, 150, 28, w=1)
    dim_h(g, 48, 66, 234, 'L', 150, 38, tick=0)
    # after: the two halves rise to meet at height x
    apex = (150, 88)
    for x_end in (66, 234):
        ux, uy = apex[0] - x_end, apex[1] - 124
        L = math.hypot(ux, uy)
        nx, ny = -uy / L * 8, ux / L * 8
        if x_end > 150:
            nx, ny = -nx, -ny
        g.poly([(x_end, 124), apex, (apex[0] + nx, apex[1] + ny), (x_end + nx, 124 + ny)], fill=RED, fop=0.55, w=1)
    g.arrow(150, 108, 150, 97, w=1.1, size=7)
    g.arrow(150, 108, 150, 123, w=1.1, size=7)
    g.line(136, 124, 164, 124, w=0.9, dash='3 2', op=0.7)
    g.text(160, 114, 'x', 16)  # under the right half, clear of the bar
    dim_h(g, 152, 66, 234, 'L', 150, 166, tick=0)
    return g


def f01():  # composite rod: piece A of length L_A, piece B
    g = Fig(362, 84)
    g.rect(6, 46, 226, 26, fill=RED, fop=0.45, w=1.4)
    g.rect(232, 46, 124, 26, fill=BLUE, fop=0.35, w=1.4)
    g.text(119, 59, 'A', 16, italic=False)
    g.text(294, 59, 'B', 16, italic=False)
    g.arrow(119, 30, 7, 30, w=1.1, size=9)
    g.arrow(119, 30, 231, 30, w=1.1, size=9)
    g.sub(119, 14, 'L', 'A', 17)
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
    A, B, C, D = (137, 160), (237, 160), (237, 88), (137, 88)
    sides = ((A, D, 0.5, BLUE), (D, C, 0.5, BLUE), (C, B, 0.5, BLUE), (B, A, 0.5, BLUE),
             (D, B, 0.25, RED), (A, C, 0.25, RED))
    for a, b, t, col in sides:
        g.line(*a, *b, col, 2.2)
    for a, b, t, col in sides:
        mid_head(g, a, b, col, t)
    g.text(122, 162, 'A', 17)
    g.text(252, 162, 'B', 17)
    g.text(252, 86, 'C', 17)
    g.text(122, 86, 'D', 17)
    g.sub(40, 160, 'p', '1', 16)
    g.sub(40, 88, 'p', '2', 16)
    g.sub(A[0], oy + 18, 'V', '1', 16)
    g.sub(B[0], oy + 18, 'V', '2', 16)
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
    g.line(*a, *c, BLUE, 2.4)
    g.line(*b, *a, BLUE, 2.4)
    g.path(bez_d(curve), RED, 2.4)
    mid_head(g, a, c, BLUE)
    mid_head(g, b, a, BLUE)
    x, y, ux, uy = bez_point(curve, 0.5)
    g.head(x - ux * 6, y - uy * 6, -ux, -uy, RED, 11)
    for p in (a, b, c):
        g.circle(*p, 5, stroke=None, fill=INK)
    unit_label(g, a[0] - 18, a[1], 'a', '', size=18)
    unit_label(g, b[0] - 18, b[1], 'b', '', size=18)
    unit_label(g, c[0] + 18, c[1], 'c', '', size=18)
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
    g.line(*a, *b, BLUE, 2.6)
    g.line(*b, *c, RED, 2.6)
    mid_head(g, a, b, BLUE)
    mid_head(g, b, c, RED)
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
    g.line(*D, *A, RED, 3)
    g.line(*B, *D, RED, 3)
    g.arrow(106, 134, 106, 110, w=1.6, size=8)
    g.arrow(196, 178, 172, 178, w=1.6, size=8)
    for p in (A, D, B):
        g.circle(*p, 4.5, stroke=None, fill=INK)
    g.text(A[0] + 14, A[1], 'A', 16, italic=False)
    g.text(D[0] - 10, D[1] + 14, 'D', 16, italic=False)
    g.text(B[0] + 8, B[1] - 16, 'B', 16, italic=False)
    g.sub(30, A[1], 'P', 'A', 17)
    g.sub(30, B[1], 'P', 'B', 17)
    return g


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
    g.line(*p1, *p2, BLUE, 2.4)
    g.path(bez_d(curve), RED, 2.4)
    g.line(*p3, *p1, BLUE, 2.4)
    mid_head(g, p1, p2, BLUE)
    mid_head(g, p3, p1, BLUE)
    x, y, ux, uy = bez_point(curve, 0.5)
    g.head(x + ux * 6, y + uy * 6, ux, uy, RED, 11)
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
