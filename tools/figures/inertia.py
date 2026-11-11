"""Moments of inertia handout (given out in the Quiz 2 exam), redrawn as theme-aware SVG.

Eight drawings, one per body, all on the same 180 x 170 canvas so they line up
in the handout's grid. Shown by js/handout.js (course/quizzes/handouts.js lists
the bodies with their names and formulas); export.py writes them to
course/figures/inertia.js, keyed by name.

Every body turns about a vertical axis with the same rotation arrow at the
top. Cylinders are red tints, spheres blue tints, the plate and rods grey.
"""
import math
from svgkit import Fig, INK, PAPER, BLUE, RED, DARK, n

W, H, CX = 180, 170, 90


def base():
    return Fig(W, H)


def axis(g, y1=4, y2=H - 4):
    g.line(CX, y1, CX, y2, w=1.1)


def spin(g, y=20, rx=21, ry=6.5):
    """Rotation arrow round the axis, as in the original: most of a turn, head on the right."""
    p = lambda t: (CX + rx * math.cos(math.radians(t)), y - ry * math.sin(math.radians(t)))
    (x0, y0), (x1, y1) = p(118), p(62)
    g.path(f'M{n(x0)},{n(y0)} A{rx},{ry} 0 1 0 {n(x1)},{n(y1)}', INK, 1.6, op=0.8)
    t = math.radians(62)
    dx, dy = -rx * math.sin(t), -ry * math.cos(t)
    L = math.hypot(dx, dy)
    g.head(x1, y1, dx / L, dy / L, INK, 8)


def label_r(g, x1, y1, x2, y2, s, lx, ly, sub=None):
    g.arrow(x1, y1, x2, y2, w=1.1, size=7)
    if sub:
        g.sub(lx, ly, s, sub, 15)
    else:
        g.text(lx, ly, s, 15)


# ── cylinders ──
TOP, RX, RY, HT = 64, 48, 14, 60


def cylinder(g, hole=None):
    """Upright cylinder; hole = inner radius (x) of a hollow one."""
    yb = TOP + HT
    body = f'M{CX - RX},{TOP} L{CX - RX},{yb} A{RX},{RY} 0 0 0 {CX + RX},{yb} L{CX + RX},{TOP} Z'
    g.path(body, None, fill=PAPER)
    g.path(body, None, fill=RED, fop=0.5)
    # a darker band on the right for roundness
    g.raw(f'<clipPath id="inertia-cyl"><path d="{body}"/></clipPath>')
    g.raw(f'<rect clip-path="url(#inertia-cyl)" x="{CX + RX * 0.45}" y="{TOP}" width="{RX}" height="{HT + RY}" '
          f'fill="{DARK}" fill-opacity=".14"/>')
    g.path(body, INK, 1.2)
    g.ellipse(CX, TOP, RX, RY, stroke=None, fill=PAPER)
    g.ellipse(CX, TOP, RX, RY, fill=RED, fop=0.22, w=1.2)
    if hole:
        ry = RY * hole / RX
        g.ellipse(CX, TOP, hole, ry, stroke=None, fill=PAPER)
        # looking into the hole: the far inside wall, shaded
        g.ellipse(CX, TOP, hole, ry, fill=RED, fop=0.6, stroke=None)
        g.ellipse(CX, TOP, hole, ry, fill=DARK, fop=0.3, w=1.1)


def hoop():
    g = base()
    g.line(CX, TOP + HT + RY, CX, H - 4, w=1.1)
    cylinder(g, hole=RX - 4)
    g.line(CX, 4, CX, TOP, w=1.1)
    spin(g)
    t = math.radians(-22)
    label_r(g, CX, TOP, CX + RX * math.cos(t), TOP - RY * math.sin(t), 'R', CX + 22, TOP - 3)
    return g


def hollow_cylinder():
    g = base()
    g.line(CX, TOP + HT + RY, CX, H - 4, w=1.1)
    cylinder(g, hole=24)
    g.line(CX, 4, CX, TOP, w=1.1)
    spin(g)
    t1, t2 = math.radians(40), math.radians(-14)
    ri = 24
    label_r(g, CX, TOP, CX + ri * math.cos(t1), TOP - RY * ri / RX * math.sin(t1), 'R', CX + 30, TOP - 21, '1')
    g.arrow(CX, TOP, CX + RX * math.cos(t2) + 22, TOP - RY * math.sin(t2) + 2, w=1.1, size=7)
    g.sub(CX + RX + 22, TOP + 12, 'R', '2', 15)
    return g


def solid_cylinder():
    g = base()
    g.line(CX, TOP + HT + RY, CX, H - 4, w=1.1)
    cylinder(g)
    g.line(CX, 4, CX, TOP, w=1.1)
    g.circle(CX, TOP, 1.8, stroke=None, fill=INK)
    spin(g)
    t = math.radians(-22)
    label_r(g, CX, TOP, CX + RX * math.cos(t), TOP - RY * math.sin(t), 'R', CX + 22, TOP - 3)
    return g


# ── plate ──
def plate():
    g = base()
    c = (CX, 100)
    A = (72, 20)     # front edge, length a
    B = (36, -26)    # side edge going back, length b
    th = 7
    P0 = (c[0] - A[0] / 2 - B[0] / 2, c[1] - A[1] / 2 - B[1] / 2)
    P1 = (P0[0] + A[0], P0[1] + A[1])
    P2 = (P1[0] + B[0], P1[1] + B[1])
    P3 = (P0[0] + B[0], P0[1] + B[1])
    dn = lambda p: (p[0], p[1] + th)
    axis(g)
    front = [P0, P1, dn(P1), dn(P0)]
    side = [P1, P2, dn(P2), dn(P1)]
    for face, op in ((front, 0.3), (side, 0.4), ([P0, P1, P2, P3], 0.1)):
        g.poly(face, stroke=None, fill=PAPER)
        g.poly(face, fill=INK, fop=op, w=1.1)
    g.line(CX, 4, *c, w=1.1)
    g.circle(*c, 1.8, stroke=None, fill=INK)
    spin(g)
    # a: along the front edge, below it
    off = 16
    a1, a2 = (dn(P0)[0], dn(P0)[1] + off), (dn(P1)[0], dn(P1)[1] + off)
    g.line(dn(P0)[0], dn(P0)[1] + 3, a1[0], a1[1] + 4, w=0.9, op=0.8)
    g.line(dn(P1)[0], dn(P1)[1] + 3, a2[0], a2[1] + 4, w=0.9, op=0.8)
    g.arrow(*a1, *a2, w=1, size=6.5, both=True)
    g.text(a1[0] + (a2[0] - a1[0]) * 0.3, a1[1] + (a2[1] - a1[1]) * 0.3 + 12, 'a', 15)
    # b: along the right edge, beyond it
    ux, uy = A[0] / math.hypot(*A), A[1] / math.hypot(*A)
    o = 14
    b1 = (dn(P1)[0] + ux * o, dn(P1)[1] + uy * o)
    b2 = (dn(P2)[0] + ux * o, dn(P2)[1] + uy * o)
    g.line(dn(P1)[0] + ux * 3, dn(P1)[1] + uy * 3, b1[0] + ux * 4, b1[1] + uy * 4, w=0.9, op=0.8)
    g.line(dn(P2)[0] + ux * 3, dn(P2)[1] + uy * 3, b2[0] + ux * 4, b2[1] + uy * 4, w=0.9, op=0.8)
    g.arrow(*b1, *b2, w=1, size=6.5, both=True)
    g.text((b1[0] + b2[0]) / 2 + 11, (b1[1] + b2[1]) / 2 + 2, 'b', 15)
    return g


# ── rods ──
ROD_ANG, ROD_LEN, ROD_Y = 16, 132, 92


def rod(g, x0, y0):
    """Thin rod from (x0, y0) going up-right at ROD_ANG; returns its far end."""
    t = math.radians(ROD_ANG)
    x1, y1 = x0 + ROD_LEN * math.cos(t), y0 - ROD_LEN * math.sin(t)
    g.line(x0, y0, x1, y1, INK, 9.5)
    g.line(x0, y0, x1, y1, PAPER, 7.3)
    g.line(x0, y0, x1, y1, INK, 7.3, op=0.22)
    g.line(x0 + 2, y0 - 2.6, x1 - 2, y1 - 2, PAPER, 1.4, op=0.8)   # a highlight along the top
    return x1, y1


def rod_dim(g, e0, e1, drop=26, at=0.5):
    for x, y in (e0, e1):
        g.line(x, y + 7, x, y + drop + 4, w=0.9, op=0.8)
    g.arrow(e0[0], e0[1] + drop, e1[0], e1[1] + drop, w=1, size=6.5, both=True)
    mx, my = e0[0] + (e1[0] - e0[0]) * at, e0[1] + (e1[1] - e0[1]) * at + drop
    g.text(mx + 4, my + 12, 'L', 15)


def rod_center():
    g = base()
    axis(g)
    t = math.radians(ROD_ANG)
    e0 = (CX - ROD_LEN / 2 * math.cos(t), ROD_Y + ROD_LEN / 2 * math.sin(t))
    e1 = rod(g, *e0)
    g.line(CX, 4, CX, ROD_Y - 3, w=1.1)
    spin(g)
    rod_dim(g, e0, e1, at=0.3)
    return g


def rod_end():
    g = base()
    global CX
    keep, CX = CX, 36
    axis(g)
    e0 = (CX, ROD_Y + 18)
    e1 = rod(g, *e0)
    g.line(CX, 4, CX, e0[1] - 3, w=1.1)
    spin(g)
    rod_dim(g, e0, e1, drop=24)
    CX = keep
    return g


# ── spheres ──
SY, SR = 98, 50


def sphere_body(g, fop):
    g.circle(CX, SY, SR, stroke=None, fill=PAPER)
    g.circle(CX, SY, SR, fill=BLUE, fop=fop, stroke=None)
    # shade the lower right: the sphere minus a circle shifted up-left (as in quiz 2's shell)
    g.raw(f'<clipPath id="inertia-sph"><circle cx="{CX}" cy="{SY}" r="{SR}"/></clipPath>')
    g.raw(f'<path clip-path="url(#inertia-sph)" fill-rule="evenodd" fill="{DARK}" fill-opacity=".26" '
          f'd="M{CX - SR},{SY} a{SR},{SR} 0 1 0 {2 * SR},0 a{SR},{SR} 0 1 0 {-2 * SR},0 Z '
          f'M{CX - SR - 12},{SY - 11} a{SR + 4},{SR + 4} 0 1 0 {2 * SR + 8},0 a{SR + 4},{SR + 4} 0 1 0 {-2 * SR - 8},0 Z"/>')


def solid_sphere():
    g = base()
    axis(g, 4, SY - SR)
    g.line(CX, SY + SR, CX, H - 4, w=1.1)
    sphere_body(g, 0.5)
    g.circle(CX, SY, SR, w=1.2)
    g.line(CX, SY - SR, CX, SY + SR, w=1, dash='4 3', op=0.7)
    g.circle(CX, SY, 1.8, stroke=None, fill=INK)
    spin(g)
    t = math.radians(-35)
    label_r(g, CX, SY, CX + SR * math.cos(t), SY - SR * math.sin(t), 'R', CX + 12, SY + 22)
    return g


def thin_shell():
    """A shell with its front-right quarter cut away, showing the thin wall and the inside."""
    g = base()
    axis(g, 4, SY - SR)
    g.line(CX, SY + SR, CX, H - 4, w=1.1)
    sphere_body(g, 0.5)
    # the opening: right half of the disc, showing the inside (lighter, shaded at the far wall)
    right = f'M{CX},{SY - SR} A{SR},{SR} 0 0 1 {CX},{SY + SR} Z'
    g.path(right, None, fill=PAPER)
    g.path(right, None, fill=BLUE, fop=0.16)
    g.raw(f'<path clip-path="url(#inertia-sph)" d="{right}" fill="{DARK}" fill-opacity=".08"/>')
    # cut edges: the meridian at the axis (a narrow half-ellipse) and the rim, both a thin wall
    mrx, wall = 13, 3.2
    g.path(f'M{CX},{SY - SR} A{mrx},{SR} 0 0 1 {CX},{SY + SR}', INK, 1)
    g.path(f'M{CX},{SY - SR + wall} A{mrx - wall},{SR - wall} 0 0 1 {CX},{SY + SR - wall}', INK, 0.8, op=0.7)
    g.path(f'M{CX},{SY - SR + wall} A{SR - wall},{SR - wall} 0 0 1 {CX},{SY + SR - wall}', INK, 0.8, op=0.7)
    band = (f'M{CX},{SY - SR} A{SR},{SR} 0 0 1 {CX},{SY + SR} L{CX},{SY + SR - wall} '
            f'A{SR - wall},{SR - wall} 0 0 0 {CX},{SY - SR + wall} Z')
    g.path(band, None, fill=BLUE, fop=0.55)
    g.circle(CX, SY, SR, w=1.2)
    g.line(CX, SY - SR + wall, CX, SY + SR - wall, w=1, dash='4 3', op=0.7)
    g.circle(CX, SY, 1.8, stroke=None, fill=INK)
    spin(g)
    t = math.radians(-30)
    label_r(g, CX, SY, CX + (SR - wall) * math.cos(t), SY - (SR - wall) * math.sin(t), 'R', CX + 26, SY + 4)
    return g


# (name, drawing, caption, count) — the same shape as quizN.py's FIGURES
FIGURES = [
    ('hoop', hoop, 'Hoop or thin cylindrical shell', 1),
    ('hollow-cylinder', hollow_cylinder, 'Hollow cylinder, radii R1 and R2', 1),
    ('solid-cylinder', solid_cylinder, 'Solid cylinder or disk', 1),
    ('plate', plate, 'Rectangular plate a by b, axis through its centre', 1),
    ('rod-center', rod_center, 'Thin rod, axis through its centre', 1),
    ('rod-end', rod_end, 'Thin rod, axis through one end', 1),
    ('solid-sphere', solid_sphere, 'Solid sphere', 1),
    ('thin-shell', thin_shell, 'Thin spherical shell, cut open', 1),
]
