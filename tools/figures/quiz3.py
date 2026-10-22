"""Quiz 3 problem figures, redrawn as theme-aware SVG."""
import math
from svgkit import Fig, INK, PAPER, BLUE, RED, GOLD, DARK, pt, n
from quiz2 import ceiling, dim_h, dim_v


def f00():  # five masses M on a semicircle, m at the centre
    g = Fig(372, 252)
    cx, cy, R = 172, 206, 130
    g.arc(cx, cy, R, 0, 180, w=1, op=0.7)
    g.arrow(cx, cy, cx, 18, w=1.1, size=10)
    g.text(cx - 14, 22, 'y', 17)
    g.arrow(cx, cy, 352, cy, w=1.1, size=10)
    g.text(356, cy + 18, 'x', 17)
    for a in (0, 45, 90, 135, 180):
        g.disc(*pt(cx, cy, R, a), 14, BLUE, 0.55)
    for (x, y) in ((cx + R + 22, cy - 24), (pt(cx, cy, R + 32, 45)), (cx + 26, cy - R - 20),
                   (pt(cx, cy, R + 32, 135)), (cx - R - 30, cy)):
        g.text(x, y, 'M', 17)
    g.disc(cx, cy, 10, RED, 0.75, w=1.1)
    g.text(cx, cy + 26, 'm', 17)
    return g


def f01():  # lead sphere with a spherical hollow, small sphere m at distance d
    g = Fig(320, 262)
    cx, cy, R = 95, 132, 70
    mx, mr = 262, 32
    g.line(cx, 24, cx, cy, w=0.9, dash='3 3', op=0.7)
    g.line(mx, 24, mx, cy - mr, w=0.9, dash='3 3', op=0.7)
    g.circle(cx, cy, R, fill=BLUE, fop=0.3, w=1.6)
    g.circle(cx - R / 2, cy, R / 2, fill=PAPER, w=1.6)
    g.circle(mx, cy, mr, fill=RED, fop=0.5, w=1.6)
    g.text(mx, cy + mr + 16, 'm', 17)
    g.circle(cx, cy, 2.4, stroke=None, fill=INK)
    dim_h(g, 30, cx, mx, 'd', (cx + mx) / 2, 16, tick=0)
    g.line(cx, cy, cx, 240, w=0.9, dash='3 3', op=0.7)
    g.line(cx + R, cy, cx + R, 240, w=0.9, dash='3 3', op=0.7)
    dim_h(g, 232, cx, cx + R, 'R', cx + R / 2, 250, tick=0)
    return g


def f02():  # three stars revolving round their centre, 120° apart
    g = Fig(300, 300)
    cx, cy, R = 150, 156, 112
    g.path(f'M{cx - R},{cy} a{R},{R} 0 1 0 {2 * R},0 a{R},{R} 0 1 0 {-2 * R},0', INK, 1.1, dash='5 4', op=0.6)
    for a in (90, 210, 330):
        x, y = pt(cx, cy, R, a)
        g.line(cx, cy, x, y, w=1, dash='7 5', op=0.6)
    for a in (90, 210, 330):
        g.arc(cx, cy, R, a + 13, a + 42, BLUE, 2.4, end_head=True, size=10)
        g.disc(*pt(cx, cy, R, a), 16, RED, 0.75)
    for a, r in ((150, 40), (30, 40), (270, 32)):
        g.text(*pt(cx, cy, r, a), '120°', 15, italic=False)
    return g


def f03():  # two stars M orbiting their centre of mass
    g = Fig(250, 192)
    cx, cy, R = 125, 96, 78
    g.circle(cx, cy, R, stroke=BLUE, w=1.8)
    g.line(cx - R, cy, cx + R, cy, w=1.8)
    for x in (cx - R, cx + R):
        g.disc(x, cy, 8, RED, 0.85)
    g.circle(cx, cy, 4, stroke=None, fill=INK)
    g.text(cx, cy - 15, 'cm', 15, italic=False)
    g.text(cx - R / 2, cy - 13, 'R', 16)
    g.text(cx + R / 2, cy - 13, 'R', 16)
    g.text(cx - R - 18, cy + 12, 'M', 16)
    g.text(cx + R + 18, cy + 12, 'M', 16)
    return g


def zigzag(x1, x2, y, teeth=6, amp=7, lead=8):
    d = f'M{n(x1)},{n(y)} L{n(x1 + lead)},{n(y)}'
    step = (x2 - x1 - 2 * lead) / (teeth * 2)
    x = x1 + lead
    for i in range(teeth * 2):
        x += step
        d += f' L{n(x - step / 2)},{n(y + (amp if i % 2 else -amp))} L{n(x)},{n(y)}'
    return d + f' L{n(x2)},{n(y)}'


def f04():  # horizontal spring and block, x to the right
    g = Fig(312, 122)
    y = 96
    g.line(16, 6, 16, 112, w=2)
    g.vhatch(16, 6, 112, side=-1, op=0.6)
    g.arrow(16, y, 304, y, w=1.3, size=11)
    g.path(zigzag(16, 166, y, 6, 8, 18), BLUE, 1.6)
    g.rect(166, 80, 42, 26, fill=RED, fop=0.5, w=1.2)
    g.text(92, 72, 'k', 17)
    g.text(187, 64, 'm', 17)
    return g


def f05():  # spring from a brick wall to block M2 with M1 on top
    g = Fig(372, 118)
    fy = 96
    g.rect(0, fy, 372, 16, fill=INK, fop=0.14, stroke=None)
    g.line(0, fy, 372, fy, w=1.4)
    g.rect(4, 6, 22, fy - 6, fill=INK, fop=0.12, w=1.1)
    rows = []
    for k, y in enumerate(range(6, fy, 9)):
        rows.append(f'M4,{y} L26,{y}')
        x = 11 if k % 2 else 15
        rows.append(f'M{x},{y} L{x},{min(y + 9, fy)}')
    g.path(' '.join(rows), INK, 0.7, op=0.6)
    g.spring(26, 240, 60, 13, amp=19, w=1.3, lead=8)
    g.rect(240, 34, 102, 62, fill=BLUE, fop=0.32, w=1.2)
    g.rect(270, 10, 38, 24, fill=RED, fop=0.55, w=1.2)
    g.sub(289, 22, 'M', '1', 15)
    g.sub(291, 66, 'M', '2', 17)
    g.text(132, 24, 'k', 17)
    return g


def megaphone(g, x, y):
    g.poly([(x - 21, y), (x + 21, y), (x + 9, y + 16), (x - 9, y + 16)], fill=RED, fop=0.55, w=1.1)
    g.rect(x - 9, y + 16, 18, 8, fill=INK, fop=0.6, w=1)


def f06():  # two megaphones a distance x apart, listener A at distance L
    g = Fig(330, 270)
    y0 = 186
    xs = (92, 240)
    for x in xs:
        for r in (40, 64, 88):
            g.arc(x, y0, r, 22, 158, BLUE, 1.8)
    for x in xs:
        megaphone(g, x, y0)
    ax = xs[1]
    g.circle(ax, 18, 4, stroke=None, fill=INK)
    g.text(ax + 20, 18, 'A', 17)
    g.arrow(ax, 100, ax, 25, w=1, size=8)
    g.arrow(ax, 100, ax, y0 - 4, w=1, size=8)
    g.text(ax + 14, 111, 'L', 17)  # in the gap between the two outer wave arcs
    dim_h(g, 232, xs[0], xs[1], 'x', (xs[0] + xs[1]) / 2, 250, tick=0)
    return g


def f07():  # two posts inclined at θ, held by a wire across their tops
    g = Fig(332, 232)
    gy = 182
    g.rect(0, gy, 332, 14, fill=INK, fop=0.12, stroke=None)
    g.line(0, gy, 332, gy, w=1.4)
    th, L = 62, 170
    p1, p2 = (110, gy), (222, gy)
    t1 = pt(*p1, L, 180 - th)
    t2 = pt(*p2, L, th)
    g.line(*t1, *t2, BLUE, 1.8)
    g.text((t1[0] + t2[0]) / 2, t1[1] - 14, 'Wire', 16, italic=False)
    for p, t in ((p1, t1), (p2, t2)):
        g.line(*p, *t, INK, 11)
        g.line(*p, *t, RED, 8.6, op=0.75)
    g.arc(*p1, 42, 180, 180 - th, w=1.1, end_head=True)
    g.text(*pt(*p1, 56, 180 - th / 2), 'θ', 17)
    g.arc(*p2, 42, 0, th, w=1.1, end_head=True)
    g.text(*pt(*p2, 56, th / 2), 'θ', 17)
    for p in (p1, p2):
        g.circle(*p, 6.5, fill=PAPER, w=1.4)
        g.circle(*p, 2, stroke=None, fill=INK)
    g.line(150, 210, 116, 190, w=1)
    g.line(182, 210, 216, 190, w=1)
    g.text(166, 220, 'Pivots', 16, italic=False)
    return g


def f08():  # beam hanging from two vertical wires, weight W off-centre
    g = Fig(330, 272)
    ceiling(g, 8, 322, y=4, h=16)
    xa, xb, by = 72, 252, 178
    for x, lab in ((xa, 'A'), (xb, 'B')):
        g.line(x, 20, x, by, w=1.3)
        g.head(x, 132, 0, -1, RED, 10)
        g.text(x - 14, 96, lab, 16)
    g.rect(xa - 4, by, xb - xa + 8, 10, fill=BLUE, fop=0.45, w=1.1)
    wx = xa + (xb - xa) / 3
    g.arrow(wx, by + 10, wx, 252, RED, w=2.2, size=11)
    g.text(wx + 16, 246, 'W', 16)
    return g


def f09():  # bar on two wires A and B, lead cube 3/4 of the way to B
    g = Fig(320, 152)
    g.rect(4, 4, 312, 12, fill=INK, fop=0.14, stroke=None)
    g.line(4, 16, 316, 16, w=1.4)
    xa, xb, by = 30, 290, 134
    for x in (xa, xb):
        g.line(x, 16, x, by, w=1.3)
    g.text(14, 86, 'A', 17)
    g.text(306, 86, 'B', 17)
    g.rect(xa - 2, by, xb - xa + 4, 8, fill=RED, fop=0.5, w=1.1)
    cx = xa + 0.75 * (xb - xa)
    g.rect(cx - 9, by - 18, 18, 18, fill=BLUE, fop=0.55, w=1.1)
    g.text(cx, by - 32, 'Cube', 15, italic=False)
    g.text(128, by - 14, 'Bar', 15, italic=False)
    return g


FIGURES = [
    (0, f00, 'Five masses M on a semicircle, m at the centre', 1),
    (1, f01, 'Lead sphere with a spherical hollow, small sphere m at distance d', 1),
    (2, f02, 'Three stars 120° apart on one orbit', 1),
    (3, f03, 'Two stars M orbiting their centre of mass', 4),
    (4, f04, 'Horizontal spring k and block m', 2),
    (5, f05, 'Spring k to block M₂ with M₁ on top', 1),
    (6, f06, 'Two megaphones a distance x apart, listener A at L', 5),
    (7, f07, 'Two posts at θ held by a wire', 2),
    (8, f08, 'Beam hanging from wires A and B, weight W', 2),
    (9, f09, 'Bar on wires A and B with a lead cube', 2),
]
