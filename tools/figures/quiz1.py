"""Quiz 1 problem figures, redrawn as theme-aware SVG."""
import math
from svgkit import Fig, INK, PAPER, BLUE, RED, GOLD, DARK, pt, n


def f00():  # vectors A (down) and B (30° from +y)
    g = Fig(200, 345)
    ox, oy = 45, 200
    g.line(ox, 24, ox, 335, w=1.1)
    g.text(ox, 12, 'y')
    g.line(ox, oy, 168, oy, w=1.1)
    g.text(178, oy, 'x')
    g.arc(ox, oy, 62, 90, 60, w=1)
    g.text(70, 108, '30.0°', 13, italic=False)
    bx, by = ox + 172 * math.sin(math.radians(30)), oy - 172 * math.cos(math.radians(30))
    g.arrow(ox, oy, bx, by, RED, w=3.2, size=13)
    g.arrow(ox, oy, ox, 322, BLUE, w=3.2, size=13)
    g.text(57, 216, 'O')
    g.vec(110, 52, 'B')
    g.vec(66, 304, 'A')
    return g


def f01():  # A at 53°, B at 130°, unit vectors
    g = Fig(420, 268)
    ox, oy = 200, 232
    g.line(8, oy, 398, oy, w=1)
    g.text(410, oy, 'x')
    g.line(ox, 252, ox, 26, w=1)
    g.text(ox, 14, 'y')
    ax, ay = pt(ox, oy, 185, 53)
    bx, by = pt(ox, oy, 200, 130)
    g.arc(ox, oy, 64, 0, 53, w=1, end_head=True)
    g.arc(ox, oy, 106, 0, 130, w=1, end_head=True)
    g.arrow(ox, oy, ax, ay, BLUE, w=2.8, size=12)
    g.arrow(ox, oy, bx, by, RED, w=2.8, size=12)
    g.arrow(ox, oy, ox + 56, oy, INK, w=2.4, size=10)
    g.arrow(ox, oy, ox, oy - 56, INK, w=2.4, size=10)
    g.text(228, 250, 'î', 15, italic=False, weight='bold')
    g.text(213, 190, 'ĵ', 15, italic=False, weight='bold')
    g.text(274, 200, '53.0°', 13, italic=False)
    g.text(232, 113, '130.0°', 13, italic=False)
    g.vec(ax + 4, ay + 26, 'A')
    g.vec(bx + 26, by + 4, 'B')
    return g


PLANE = (
    # fuselage, fin, engine, wing, cockpit, gear — local coords, nose at x≈112, wheels at y≈43
    '<path d="M9,24 L3,5 L11,5 L31,20 Z" fill="{b}" fill-opacity=".45" stroke="{i}" stroke-width="1.1"/>'
    '<path d="M10,23 C30,19 80,18 98,19 C108,20 113,24 112,27 C111,30 104,32 96,32 L22,32 C14,32 9,29 8,26 Z" '
    'fill="{b}" fill-opacity=".3" stroke="{i}" stroke-width="1.1"/>'
    '<ellipse cx="31" cy="17" rx="10" ry="3.6" fill="{p}" stroke="{i}" stroke-width="1"/>'
    '<path d="M50,28 L76,28 L60,36 L45,36 Z" fill="{i}" fill-opacity=".18" stroke="{i}" stroke-width="1"/>'
    '<path d="M98,21 C103,21 107,23 109,25.5 L99,25.5 Z" fill="{i}"/>'
    '<g fill="{i}"><circle cx="57" cy="24" r="1.6"/><circle cx="64" cy="24" r="1.6"/><circle cx="71" cy="24" r="1.6"/>'
    '<circle cx="78" cy="24" r="1.6"/><circle cx="85" cy="24" r="1.6"/></g>'
    '<path d="M52,32 L52,39 M98,32 L98,39" stroke="{i}" stroke-width="1.4"/>'
    '<circle cx="52" cy="40.5" r="2.6" fill="{i}"/><circle cx="98" cy="41" r="2" fill="{i}"/>'
).format(p=PAPER, i=INK, b=BLUE)


def f02():  # takeoff runway, length "?"
    g = Fig(410, 112)
    g.line(62, 72, 382, 72, w=2.6)
    s = 0.95
    g.raw(f'<g transform="translate({n(85 - 52 * s)},{n(72 - 43 * s)}) scale({s})">{PLANE}</g>')
    g.raw(f'<g transform="translate({n(338 - 52 * s)},{n(72 - 43 * s)}) scale({s}) rotate(-8 52 43)">{PLANE}</g>')
    g.arrow(196, 96, 80, 96, w=1)
    g.arrow(226, 96, 362, 96, w=1)
    g.text(211, 96, '?', 18, italic=False, c=RED)
    return g


def f03():  # fireworks shell: launch v0 at θ, burst at the top
    g = Fig(340, 285)
    g.line(10, 262, 330, 262, w=1.2)
    g.hatch(10, 330, 262, op=0.35)
    lx, ly = 40, 262
    axp, ayp = 268, 58
    cx = (lx + axp) / 2
    g.path(f'M{lx},{ly} Q{n(cx)},{ayp} {axp},{ayp}', INK, 1.4, dash='6 5', op=0.75)
    for t in (0.42, 0.78):  # travel direction marks
        x = (1 - t) ** 2 * lx + 2 * (1 - t) * t * cx + t * t * axp
        y = (1 - t) ** 2 * ly + 2 * (1 - t) * t * ayp + t * t * ayp
        dx = 2 * (1 - t) * (cx - lx) + 2 * t * (axp - cx)
        dy = 2 * (1 - t) * (ayp - ly) + 2 * t * (ayp - ayp)
        L = math.hypot(dx, dy)
        g.head(x, y, dx / L, dy / L, INK, 9)
    d = math.hypot(cx - lx, ayp - ly)
    ux, uy = (cx - lx) / d, (ayp - ly) / d
    g.line(lx, ly, lx + 70, ly, w=0.9, dash='3 3', op=0.7)
    ang = math.degrees(math.atan2(-uy, ux))
    g.arc(lx, ly, 30, 0, ang, w=1)
    g.text(*pt(lx, ly, 43, ang / 2), 'θ')
    g.arrow(lx, ly, lx + ux * 66, ly + uy * 66, BLUE, w=2.4, size=11)
    g.sub(lx + ux * 66 - 20, ly + uy * 66 + 4, 'v', '0')
    for k in range(16):  # burst
        a = k * 22.5 + 11
        r1 = 34 if k % 2 == 0 else 26
        c = RED if k % 2 == 0 else BLUE
        x1, y1 = pt(axp, ayp, 9, a)
        x2, y2 = pt(axp, ayp, r1, a)
        g.line(x1, y1, x2, y2, c, w=1.6)
        g.circle(*pt(axp, ayp, r1 + 3.5, a), 2, stroke=None, fill=c)
    g.circle(axp, ayp, 3.2, stroke=None, fill=INK)
    return g


def f04():  # mug sliding off a counter
    g = Fig(330, 250)
    top, gnd, x0 = 46, 212, 98
    g.line(8, top, x0, top, w=1, dash='4 3', op=0.6)
    g.line(8, gnd, x0, gnd, w=1, dash='4 3', op=0.6)
    g.text(8, 22, 'Counter', 16, italic=False, anchor='start')
    g.text(8, 236, 'Ground', 16, italic=False, anchor='start')
    g.arrow(x0, gnd, x0, top, w=1.3, size=10)
    g.arrow(x0, gnd, 290, gnd, w=1.3, size=10)
    g.arrow(x0, top, 218, top, BLUE, w=2.4, size=13)
    lx, ly = 278, 196
    g.path(f'M{x0},{top} Q{n((x0 + lx) / 2)},{top} {lx},{ly}', INK, 1.1)
    g.sub(116, 128, 'y', 'i', 17)
    g.sub(240, 196, 'x', 'f', 17)
    g.raw(f'<g transform="translate(286 196) rotate(-38)">'
          f'<path d="M-11,-12 L9,-12 L8,10 Q8,13 5,13 L-8,13 Q-11,13 -11,10 Z" fill="{RED}" fill-opacity=".45" stroke="{INK}" stroke-width="1.2"/>'
          f'<path d="M9,-6 C16,-6 16,6 8.5,6" stroke="{INK}" stroke-width="1.6"/>'
          f'<ellipse cx="-1" cy="-12" rx="10" ry="2.4" fill="{INK}" fill-opacity=".2" stroke="{INK}" stroke-width="1"/></g>')
    return g


def wheel(cx, cy, r):
    """Side-view wheel: dark tyre, light rim, hub."""
    return (f'<circle cx="{cx}" cy="{cy}" r="{r}" fill="{DARK}" stroke="{INK}" stroke-width="1.2"/>'
            f'<circle cx="{cx}" cy="{cy}" r="{n(r * 0.58)}" fill="{PAPER}" stroke="{INK}" stroke-width=".8"/>'
            f'<circle cx="{cx}" cy="{cy}" r="{n(r * 0.58)}" fill="{INK}" fill-opacity=".22"/>'
            f'<circle cx="{cx}" cy="{cy}" r="{n(r * 0.16)}" fill="{INK}"/>')


# Sedan, side view, facing right. Local coords: wheel centres (36,46) and
# (126,46), r 13, so the tyres touch y = 59.
SEDAN = (
    '<ellipse cx="81" cy="59.5" rx="78" ry="3" fill="{i}" fill-opacity=".22"/>'
    '<path d="M4,50 L3,40 C3,33 5,29 10,28 L32,25 C40,16 48,9 58,7 C70,5 88,5 98,6 C104,7 108,9 112,12 '
    'L123,21 L146,25 C153,26 157,30 158,36 L158,44 C158,48 156,50 152,50 L141.5,50 A16,16 0 1 0 110.5,50 '
    'L51.5,50 A16,16 0 1 0 20.5,50 Z" fill="{g}" fill-opacity=".6" stroke="{i}" stroke-width="1.4"/>'
    '<path d="M38,24 C45,16 50,12 58,10 C64,9 70,9 76,9 L76,23.5 Z M80,9 L97,9 C101,9 104,11 107,13 L116,22 L80,23.5 Z" '
    'fill="{p}" stroke="{i}" stroke-width="1"/>'
    '<path d="M38,24 C45,16 50,12 58,10 C64,9 70,9 76,9 L76,23.5 Z M80,9 L97,9 C101,9 104,11 107,13 L116,22 L80,23.5 Z" '
    'fill="{b}" fill-opacity=".35"/>'
    '<path d="M8,33 C50,31 110,30 150,30" stroke="{i}" stroke-width=".7" opacity=".55"/>'
    '<path d="M78,9 L78,48 M118,23 C116,32 114,40 112,47 M41,25 C43,33 45,40 48,47" stroke="{i}" stroke-width=".8"/>'
    '<path d="M64,31 L70,31 M100,31 L106,31" stroke="{i}" stroke-width="1.8"/>'
    '<path d="M110,15 L116,15 L117,20 L111,20 Z" fill="{g}" stroke="{i}" stroke-width=".8"/>'
    '<path d="M146,27 L155,29.5 L156.5,34 L148,32.5 Z" fill="{p}" stroke="{i}" stroke-width=".8"/>'
    '<rect x="3" y="31" width="5" height="7" rx="1.5" fill="{r}"/>'
    '<path d="M4,44 L18,44 M144,44 L158,44" stroke="{i}" stroke-width="1.2"/>'
).format(p=PAPER, i=INK, b=BLUE, g=RED, r=RED) + wheel(36, 46, 13) + wheel(126, 46, 13)


def f05():  # car over a rise
    g = Fig(460, 150)
    R, cx, top = 700, 230, 112
    y0 = top + R - math.sqrt(R * R - cx * cx)
    g.path(f'M0,150 L0,{n(y0)} A{R},{R} 0 0 1 460,{n(y0)} L460,150 Z', None, fill=INK, fop=0.1)
    g.path(f'M0,{n(y0)} A{R},{R} 0 0 1 460,{n(y0)}', INK, 1.5)
    s = 1.25  # wheels sit on the hill (the hill is ~1 unit lower under them)
    g.raw(f'<g transform="translate({n(cx - 81 * s)} {n(top + 0.8 - 59 * s)}) scale({s})">{SEDAN}</g>')
    g.arrow(345, 70, 420, 70, BLUE, w=3, size=13)
    g.text(382, 52, 'v', 16)
    return g


def f06():  # block m circling on a table, M hanging through a hole
    g = Fig(240, 228)
    g.rect(44, 96, 8, 74, fill=INK, fop=0.12, w=0.9)
    g.rect(188, 96, 8, 74, fill=INK, fop=0.12, w=0.9)
    g.poly([(40, 22), (200, 22), (230, 88), (10, 88)], fill=PAPER, w=1.3)
    g.poly([(10, 88), (230, 88), (230, 97), (10, 97)], fill=INK, fop=0.15, w=1.1)
    g.rect(16, 97, 10, 122, fill=INK, fop=0.12, w=1)
    g.rect(214, 97, 10, 122, fill=INK, fop=0.12, w=1)
    hx, hy = 120, 53
    g.ellipse(hx, hy + 1, 82, 22, w=1, dash='4 3')
    g.head(122, hy + 23, 1, 0, INK, 7)
    g.head(118, hy - 21, -1, 0, INK, 7)
    g.line(50, hy + 1, hx, hy, w=1.1)
    g.ellipse(hx, hy, 4, 2, stroke=None, fill=INK)
    g.rect(27, hy - 6, 24, 13, fill=RED, fop=0.55, w=1.1, rx=2)
    g.text(86, hy - 10, 'r', 15)
    g.text(38, 72, 'm', 15)
    g.line(hx, 97, hx, 150, w=1.1)
    g.path(f'M104,150 L104,192 A16,5 0 0 0 136,192 L136,150', INK, 1.1, fill=BLUE, fop=0.4)
    g.ellipse(120, 150, 16, 5, fill=PAPER, w=1.1)
    g.text(91, 174, 'M', 15)
    return g


def f07():  # conical pendulum: ball on a string of length L at θ to the vertical
    g = Fig(262, 334)
    g.rect(0, 0, 262, 24, fill=INK, fop=0.12, stroke=None)
    g.line(0, 24, 262, 24, w=1.5)
    px, py = 140, 26
    cx, cy, rx, ry = 136, 270, 92, 30
    # rotation: thick curved arrow round the left of the path, front to back
    erx, ery = 120, 48
    e = lambda t: (cx + erx * math.cos(math.radians(t)), cy - ery * math.sin(math.radians(t)))
    (x0, y0), (x1, y1) = e(228), e(152)
    g.path(f'M{n(x0)},{n(y0)} A{erx},{ery} 0 0 1 {n(x1)},{n(y1)}', BLUE, 5.5, extra=' stroke-linecap="butt"')
    tt = math.radians(152)
    dx, dy = erx * math.sin(tt), ery * math.cos(tt)
    L = math.hypot(dx, dy)
    g.head(x1 + dx / L * 10, y1 + dy / L * 10, dx / L, dy / L, BLUE, 17)
    g.ellipse(cx, cy, rx, ry, w=1.2, dash='6 4')
    g.line(px, py, cx, cy, w=1.1, dash='6 4')
    g.circle(cx, cy, 3.4, stroke=None, fill=INK)
    a = math.radians(-26)
    bx, by = cx + rx * math.cos(a), cy - ry * math.sin(a)
    g.line(px, py, bx, by, w=1.6)
    ang = math.degrees(math.atan2(-(by - py), bx - px))
    vert = math.degrees(math.atan2(-(cy - py), cx - px))
    g.arc(px, py, 64, vert, ang, w=1.1)
    g.text(*pt(px, py, 80, (vert + ang) / 2 - 2), 'θ', 18)
    g.text((px + bx) / 2 + 18, (py + by) / 2 - 4, 'L', 19)
    g.disc(bx, by, 19, RED, 0.75, w=1.3)
    g.circle(px, py, 2.6, stroke=None, fill=INK)
    return g


# Car seen from behind. Local coords: bottom centre at (0,0), up is -y.
CAR_REAR = (
    '<rect x="-39" y="-15" width="15" height="15" rx="3" fill="{d}" stroke="{i}" stroke-width="1"/>'
    '<rect x="24" y="-15" width="15" height="15" rx="3" fill="{d}" stroke="{i}" stroke-width="1"/>'
    '<path d="M-36,-34 L-28,-55 C-27,-58 -24,-60 -21,-60 L21,-60 C24,-60 27,-58 28,-55 L36,-34 Z" '
    'fill="{g}" fill-opacity=".6" stroke="{i}" stroke-width="1.3"/>'
    '<path d="M-29,-37 L-23,-54 L23,-54 L29,-37 Z" fill="{p}" stroke="{i}" stroke-width=".9"/>'
    '<path d="M-29,-37 L-23,-54 L23,-54 L29,-37 Z" fill="{b}" fill-opacity=".35"/>'
    '<path d="M-45,-9 L45,-9 L46,-29 C46,-32 44,-34 41,-34 L-41,-34 C-44,-34 -46,-32 -46,-29 Z" '
    'fill="{g}" fill-opacity=".6" stroke="{i}" stroke-width="1.3"/>'
    '<path d="M-37,-38 L-44,-38 L-44,-42 L-36,-42 M37,-38 L44,-38 L44,-42 L36,-42" fill="{g}" stroke="{i}" stroke-width=".8"/>'
    '<rect x="-42" y="-30" width="11" height="7" rx="1.5" fill="{r}"/>'
    '<rect x="31" y="-30" width="11" height="7" rx="1.5" fill="{r}"/>'
    '<rect x="-11" y="-25" width="22" height="8" rx="1" fill="{p}" stroke="{i}" stroke-width=".8"/>'
    '<path d="M-44,-13 L44,-13" stroke="{i}" stroke-width=".8" opacity=".6"/>'
).format(p=PAPER, i=INK, b=BLUE, g=RED, r=RED, d=DARK)


def banked_rear_view(g, x0, y0, w, h):
    """Inset: the banked road seen from behind the car — road and car both tilted by θ."""
    th = 20
    t = math.tan(math.radians(th))
    s = 0.55  # car scale
    g.rect(x0, y0, w, h, fill=PAPER, w=1, rx=8)
    g.text(x0 + w - 10, y0 + 13, 'view from behind', 11.5, italic=False, anchor='end', op=0.75)
    base = y0 + h - 14
    xl, xr, yl = x0 + 12, x0 + 168, y0 + 50
    yr = yl + (xr - xl) * t
    g.poly([(xl, yl), (xr, yr), (xr, base), (xl, base)], stroke=None, fill=INK, fop=0.12)
    g.line(xl, yl, xr, yr, w=1.4)
    g.line(x0 + 6, base, x0 + w - 6, base, w=1.1)
    ax = x0 + w - 22
    g.line(ax, y0 + 24, ax, base, w=1, dash='5 4', op=0.75)
    px = x0 + 66
    py = yl + (px - xl) * t
    ux, uy = math.sin(math.radians(th)), -math.cos(math.radians(th))
    cmx, cmy = px + ux * 30 * s, py + uy * 30 * s
    # guide lines first, so the car hides the parts that cross it
    L = 54
    g.line(px, py, px, py - L, w=0.9, dash='4 3', op=0.8)
    g.line(px, py, px + ux * L, py + uy * L, w=0.9, dash='2 3', op=0.9)
    g.arc(px, py, 47, 90, 90 - th, w=1, end_head=True, size=5.5)
    g.text(*pt(px, py, 57, 90 - th / 2 - 4), 'θ', 14)
    g.arrow(cmx, cmy, ax, cmy, w=1.1, size=8)
    g.text((cmx + 30 + ax) / 2, cmy - 10, 'r', 14)
    g.circle(ax, cmy, 2.4, stroke=None, fill=INK)
    g.raw(f'<g transform="translate({n(px)} {n(py)}) rotate({th}) scale({s})">{CAR_REAR}</g>')
    g.circle(cmx, cmy, 2.2, stroke=PAPER, w=0.8, fill=INK)
    g.line(xr, yr, xr - 52, yr, w=0.9, dash='4 3', op=0.8)
    g.arc(xr, yr, 38, 180, 180 - th, w=1, end_head=True, size=5.5)
    g.text(*pt(xr, yr, 50, 180 - th / 2), 'θ', 14)


def f08():  # car on a banked curve (as in the original) + inset view from behind
    g = Fig(420, 392)
    cx, cy = 396, 140
    g.path(f'M{cx},{cy - 105} A300,105 0 0 0 {cx},{cy + 105} L{cx},{cy + 70} A225,70 0 0 1 {cx},{cy - 70} Z',
           INK, 1.3, fill=INK, fop=0.1)
    posts = []
    for t in range(186, 266, 8):
        x, y = cx + 300 * math.cos(math.radians(t)), cy - 105 * math.sin(math.radians(t))
        posts.append(f'M{n(x)},{n(y)} L{n(x)},{n(y + 8)}')
    g.path(' '.join(posts), INK, 1)
    g.path(f'M{n(cx - 300 * math.cos(math.radians(6)))},{n(cy + 105 * math.sin(math.radians(6)) + 6)} '
           f'A300,105 0 0 0 {n(cx + 300 * math.cos(math.radians(266)))},{n(cy - 105 * math.sin(math.radians(266)) + 6)}',
           INK, 1)
    g.path(f'M{cx},{cy - 88} A262,88 0 0 0 {cx},{cy + 88}', INK, 1, dash='7 5', op=0.55)
    car = (cx - 262, cy)
    g.line(10, cy, car[0], cy, w=1, dash='5 4', op=0.7)
    g.line(car[0], cy, cx, cy, w=1.1)
    g.circle(cx, cy, 3, stroke=None, fill=INK)
    g.text(282, cy - 12, 'r', 16)
    bx, by = pt(car[0], cy, 118, 130)
    g.line(car[0], cy, bx, by, w=1.2)
    g.arc(car[0], cy, 64, 180, 130, w=1, dash='4 3', end_head=True)
    g.text(*pt(car[0], cy, 80, 158), 'θ', 16)
    # small car seen from above, driving along the curve
    g.raw(f'<g transform="translate({car[0]} {cy})">'
          f'<rect x="-8" y="-14" width="16" height="28" rx="5" fill="{RED}" fill-opacity=".6" stroke="{INK}" stroke-width="1"/>'
          f'<path d="M-6,-6 L6,-6 L5,-1 L-5,-1 Z M-5,6 L5,6 L6,10 L-6,10 Z" fill="{BLUE}" fill-opacity=".45" '
          f'stroke="{INK}" stroke-width=".6"/></g>')
    banked_rear_view(g, 70, 262, 280, 124)
    return g


def pulley(g, cx, cy, r, bracket):
    g.poly(bracket, stroke=None, fill=INK, fop=0.3)
    g.circle(cx, cy, r, fill=PAPER, w=2.4)
    g.circle(cx, cy, r * 0.42, stroke=None, fill=INK)


def f09():  # m1 on table, string over pulley, m2 hanging
    g = Fig(322, 190)
    g.line(10, 80, 222, 80, w=3, cap='square')
    g.line(222, 80, 222, 182, w=3, cap='square')
    px, py, r = 248, 48, 18
    g.line(140, py - r, px, py - r, w=1.1)
    g.line(px + r, py, px + r, 118, w=1.1)
    pulley(g, px, py, r, [(px, py), (222, 80), (206, 80)])
    g.rect(70, 24, 70, 56, fill=BLUE, fop=0.35, w=1.2)
    g.sub(105, 52, 'm', '1')
    for k in range(3):
        g.rect(px + r - 18, 118 + 9 * k, 36, 9, fill=RED, fop=0.4, w=0.9)
    g.rect(px + r - 22, 145, 44, 5, stroke=None, fill=INK)
    g.sub(296, 130, 'm', '2', anchor='start')
    return g


def f10():  # m1 pulled by F at θ, string over pulley to m2
    g = Fig(430, 250)
    g.line(30, 140, 335, 140, w=3, cap='square')
    g.line(335, 140, 335, 245, w=3, cap='square')
    px, py, r = 372, 100, 20
    g.line(235, py - r, px, py - r, w=1.1)
    g.line(px + r, py, px + r, 168, w=1.1)
    pulley(g, px, py, r, [(px, py), (335, 140), (316, 140)])
    g.rect(145, 62, 90, 78, fill=BLUE, fop=0.35, w=1.2)
    g.sub(190, 101, 'm', '1')
    g.rect(px + r - 23, 168, 46, 70, fill=BLUE, fop=0.35, w=1.2)
    g.sub(px + r, 203, 'm', '2')
    ax, ay = 145, 100
    g.line(ax, ay, 58, ay, w=1, dash='2 3', op=0.7)
    g.arc(ax, ay, 46, 180, 150, w=1)
    g.text(*pt(ax, ay, 60, 166), 'θ')
    fx, fy = pt(ax, ay, 112, 150)
    g.arrow(ax, ay, fx, fy, RED, w=2.2, size=11)
    g.text(fx - 10, fy - 10, 'F')
    return g


def f11():  # F presses m1 against m2, frictionless floor
    g = Fig(500, 205)
    g.rect(20, 170, 410, 24, fill=INK, fop=0.1, w=1.1)
    g.rect(225, 40, 130, 130, fill=BLUE, fop=0.3, w=1.2)
    g.rect(175, 66, 50, 52, fill=BLUE, fop=0.7, w=1.2)
    g.sub(200, 52, 'm', '1')
    g.sub(290, 26, 'm', '2')
    g.arrow(72, 92, 173, 92, RED, w=2.2, size=11)
    g.text(56, 92, 'F')
    g.text(440, 92, 'No friction', 15, italic=False, anchor='middle')
    g.arrow(420, 106, 362, 166, w=1.1, size=9)
    return g


def f12():  # block pulled by F at θ on a rough floor
    g = Fig(232, 124)
    g.rect(6, 98, 220, 14, fill=INK, fop=0.08, stroke=None)
    g.line(6, 98, 226, 98, w=1.5)
    g.hatch(6, 226, 98, step=8, length=12, op=0.6)
    g.rect(16, 30, 84, 68, fill=BLUE, fop=0.45, w=1.2, rx=5)
    ax, ay = 100, 52
    g.line(ax, ay, 162, ay, w=0.9)
    g.arc(ax, ay, 34, 0, 26, w=1)
    g.text(*pt(ax, ay, 47, 11), 'θ')
    fx, fy = pt(ax, ay, 88, 26)
    g.arrow(ax, ay, fx, fy, RED, w=2.2, size=11)
    g.text(fx + 11, fy - 6, 'F')
    return g


def f13():  # five-link chain lifted by F
    g = Fig(124, 332)
    centers = [290 - 42 * k for k in range(5)]
    for k, c in enumerate(centers):
        g.rect(38, c - 28, 44, 56, stroke=BLUE, w=3, rx=21)
    for k, c in enumerate(centers):
        g.text(60, c, str(k + 1), 17, italic=False, weight='bold')
    g.arrow(60, centers[-1] - 30, 60, 28, RED, w=2.2, size=11)
    g.text(76, 40, 'F')
    return g


def f14():  # two ropes from the ceiling, cable to a weight
    g = Fig(380, 292)
    g.rect(5, 6, 370, 16, fill=INK, fop=0.16, stroke=None)
    g.line(5, 22, 375, 22, w=1.5)
    jx, jy = 155, 160
    lx = jx - (jy - 22) / math.tan(math.radians(60))
    rx = jx + (jy - 22) / math.tan(math.radians(40))
    g.line(lx, 22, jx, jy, BLUE, 2.4)
    g.line(rx, 22, jx, jy, BLUE, 2.4)
    g.line(jx, jy, jx, 228, w=1.4)
    g.circle(jx, jy, 2.5, stroke=None, fill=INK)
    g.rect(133, 228, 44, 46, fill=RED, fop=0.5, w=1.2)
    g.arc(lx, 22, 42, 0, -60, w=1.1, end_head=True)
    g.text(*pt(lx, 22, 62, -24), '60°', 15, italic=False)
    g.arc(rx, 22, 42, 180, 220, w=1.1, end_head=True)
    g.text(*pt(rx, 22, 62, 205), '40°', 15, italic=False)
    return g


def chain(g, x, y1, y2):
    y, k = y1, 0
    while y + 9 < y2:
        if k % 2:
            g.line(x, y + 1, x, y + 8, w=2.2)
        else:
            g.ellipse(x, y + 4.5, 2.6, 5, w=1.1)
        y, k = y + 7, k + 1


def f15():  # movable + fixed pulley, worker pulls with F
    g = Fig(240, 312)
    g.rect(5, 4, 230, 12, fill=INK, fop=0.16, stroke=None)
    g.line(5, 16, 235, 16, w=1.5)
    lx, ly, ux, uy, r = 110, 176, 150, 96, 22
    for cx, cy in ((lx, ly), (ux, uy)):
        g.circle(cx, cy, r, fill=BLUE, fop=0.25, w=1.4)
        g.circle(cx, cy, r - 7, w=0.8)
    g.path(f'M{lx - r},16 L{lx - r},{ly} A{r},{r} 0 0 0 {lx + r},{ly} L{ux - r},{uy} '
           f'A{r},{r} 0 0 1 {ux + r},{uy} L{ux + r},208', INK, 1.6)
    g.rect(ux - 4, 16, 8, uy - 10, fill=INK, fop=0.45, w=0.8, rx=2)
    g.rect(lx - 4, ly - 26, 8, 36, fill=INK, fop=0.45, w=0.8, rx=2)
    g.circle(ux, uy, 4.5, stroke=None, fill=INK)
    g.circle(lx, ly, 4.5, stroke=None, fill=INK)
    chain(g, lx, ly + 10, 268)
    g.poly([(98, 270), (122, 270), (128, 302), (92, 302)], fill=BLUE, fop=0.45, w=1.2)
    g.text(80, 292, 'w')
    g.arrow(ux + r, 210, ux + r, 272, RED, w=2.6, size=12)
    g.vec(ux + r + 16, 246, 'F')
    return g


def f16():  # sagging clothesline, ends at θ
    g = Fig(360, 132)
    g.rect(10, 8, 9, 118, fill=BLUE, fop=0.35, w=1)
    g.rect(341, 8, 9, 118, fill=BLUE, fop=0.35, w=1)
    ax, bx, y = 26, 334, 48
    th = 16
    cyc = y + (180 - ax) * math.tan(math.radians(th))
    g.path(f'M19,{y} L{ax},{y} M{bx},{y} L341,{y}', INK, 1.6)
    g.path(f'M{ax},{y} Q180,{n(cyc)} {bx},{y}', RED, 3.2)
    for sx, sgn in ((ax, 1), (bx, -1)):
        g.line(sx, y, sx + sgn * 70, y, w=0.9, dash='4 3', op=0.75)
        if sgn > 0:
            g.arc(sx, y, 52, 0, -th, w=1, end_head=True, size=6)
        else:
            g.arc(sx, y, 52, 180, 180 + th, w=1, end_head=True, size=6)
        g.text(sx + sgn * 62, y - 12, 'θ')
    return g


def f17():  # block on incline over a pulley, m2 hanging
    g = Fig(410, 252)
    a = math.radians(30)
    x0, y0 = 12, 238
    xt = 300
    yt = y0 - (xt - x0) * math.tan(a)
    ux, uy = math.cos(a), -math.sin(a)
    nx, ny = -math.sin(a), -math.cos(a)
    P = lambda s, h: (x0 + ux * s + nx * h, y0 + uy * s + ny * h)
    g.poly([(x0, y0), (xt, y0), (xt, yt)], fill=INK, fop=0.12, w=1.2)
    r = 17
    cx, cy = xt + ux * 26 + nx * 5, yt + uy * 26 + ny * 5
    off = 5 + r
    tx, ty = cx + nx * r, cy + ny * r
    s1, s2, hb = 118, 182, 50
    g.line(*P(s2, off), tx, ty, w=1.1)
    g.line(cx + r, cy, cx + r, 148, w=1.1)
    g.poly([(cx, cy), P(s2 + 70, 0), (xt, yt + 22)], stroke=None, fill=INK, fop=0.35)
    g.circle(cx, cy, r, fill=PAPER, w=2.2)
    g.circle(cx, cy, 7, stroke=None, fill=INK)
    g.poly([P(s1, 0), P(s2, 0), P(s2, hb), P(s1, hb)], fill=BLUE, fop=0.45, w=1.2)
    g.circle(*P(s2 + 3, off), 3, w=1.1, fill=PAPER)
    g.rect(cx + r - 26, 148, 52, 48, fill=RED, fop=0.5, w=1.2)
    g.sub(*P(s1 - 12, hb + 12), 'm', '1')
    g.sub(cx + r, 216, 'm', '2')
    g.arc(x0, y0, 52, 0, 30, w=1.1, end_head=True)
    g.text(*pt(x0, y0, 70, 12), 'α', 16)
    return g


def f18():  # block A on a table, cord to a knot, cord to the wall at α, weight w
    g = Fig(330, 250)
    g.rect(4, 118, 176, 10, fill=INK, fop=0.22, w=1.1)
    g.rect(12, 128, 160, 122, fill=INK, fop=0.1, w=1.1)
    wx = 300
    g.line(wx, 4, wx, 250, w=2)
    g.vhatch(wx, 4, 250, op=0.45)
    g.rect(58, 82, 52, 36, fill=BLUE, fop=0.5, w=1.2)
    g.text(84, 68, 'A')
    kx, ky = 222, 100
    g.circle(110, ky, 2.6, w=1, fill=PAPER)
    g.line(113, ky, kx, ky, w=1.2)
    al = 42
    ex, ey = wx - 7, ky - (wx - 7 - kx) * math.tan(math.radians(al))
    g.line(kx, ky, ex, ey, w=1.2)
    g.path(f'M{n(ex)},{n(ey)} C{n(ex + 2)},{n(ey - 10)} {n(ex - 6)},{n(ey - 12)} {n(ex - 8)},{n(ey - 6)} '
           f'M{n(ex + 1)},{n(ey - 6)} L{wx},{n(ey - 6)}', INK, 1.5)
    g.line(kx, ky, wx, ky, w=1, dash='5 4', op=0.75)
    g.arc(kx, ky, 34, 0, al, w=1.1, end_head=True)
    g.text(*pt(kx, ky, 50, al / 2), 'α', 16)
    g.line(kx, ky, kx, 172, w=1.2)
    g.poly([(212, 172), (232, 172), (246, 214), (198, 214)], fill=RED, fop=0.5, w=1.2)
    g.text(kx, 232, 'w')
    return g


def blocks_ab(cord):
    g = Fig(200, 100)
    g.line(4, 84, 184, 84, w=1.3)
    g.hatch(4, 184, 84, op=0.45)
    g.line(184, 8, 184, 84, w=1.3)
    g.vhatch(184, 8, 84, op=0.45)
    g.rect(44, 60, 112, 24, fill=BLUE, fop=0.3, w=1.2)
    g.rect(80, 38, 38, 22, fill=BLUE, fop=0.65, w=1.2)
    g.text(99, 26, 'A')
    g.text(166, 72, 'B')
    if cord:
        g.line(118, 47, 184, 47, w=1.1)
    g.arrow(44, 72, 8, 72, RED, w=2.2, size=10)
    g.vec(22, 54, 'F', 15)
    return g


def f19():
    return blocks_ab(False)


def f20():
    return blocks_ab(True)


def f21():  # window washer pushes a brush up the window with F along the pole
    g = Fig(230, 278)
    g.rect(34, 50, 12, 222, fill=INK, fop=0.15, w=1.1)
    hx, hy = 180, 238
    bx, by = 58, 78
    g.line(46, hy, hx, hy, w=1, dash='5 4', op=0.75)
    L = math.hypot(hx - bx, hy - by)
    ux, uy = (bx - hx) / L, (by - hy) / L
    g.line(hx - ux * 22, hy - uy * 22, bx, by, BLUE, w=5)
    g.line(hx - ux * 22, hy - uy * 22, bx, by, INK, w=0.6, op=0.6)
    g.rect(48, 64, 11, 28, fill=BLUE, fop=0.6, w=1.1, rx=3)
    g.path(' '.join(f'M46,{y} L48,{y}' for y in range(67, 91, 3)), INK, 1)
    ang = math.degrees(math.atan2(hy - by, hx - bx))
    g.arc(hx, hy, 58, 180, 180 - ang, w=1.1, end_head=True)
    g.text(*pt(hx, hy, 74, 180 - ang / 2), 'α', 16)
    for t in (0, 22):
        g.circle(hx - ux * t, hy - uy * t, 6.5, fill=PAPER, w=1.1)
    g.arrow(40, 56, 40 + ux * 46, 56 + uy * 46, RED, w=2.4, size=11)
    g.vec(38, 18, 'F', 15)
    return g


TOYCAR = (
    '<path d="M2,18 L4,10 Q5,8 8,8 L14,8 L18,2 L32,2 L37,8 L44,9 Q47,10 47,14 L47,18 Z" '
    'fill="{g}" fill-opacity=".7" stroke="{i}" stroke-width="1"/>'
    '<path d="M19,4 L25,4 L25,8 L16,8 Z M27,4 L31,4 L34,8 L27,8 Z" fill="{p}" stroke="{i}" stroke-width=".6"/>'
    '<path d="M14,8 L14,1" stroke="{i}" stroke-width=".8"/>'
    '<circle cx="12" cy="19" r="4.5" fill="{d}" stroke="{i}" stroke-width=".9"/>'
    '<circle cx="37" cy="19" r="4.5" fill="{d}" stroke="{i}" stroke-width=".9"/>'
    '<circle cx="12" cy="19" r="1.5" fill="{i}"/><circle cx="37" cy="19" r="1.5" fill="{i}"/>'
).format(g=RED, i=INK, p=PAPER, d=DARK)


def loop(bottom):
    g = Fig(300, 332)
    cx, cy, R = 150, 164, 135
    g.path(f'M58,{cy + R + 14} C100,{cy + R + 14} 122,{cy + R + 4} 132,{cy + R - 4} L168,{cy + R - 4} '
           f'C178,{cy + R + 4} 200,{cy + R + 14} 242,{cy + R + 14} Z', None, fill=INK, fop=0.2)
    g.circle(cx, cy, R, w=6, stroke=INK)
    g.raw(f'<circle cx="{cx}" cy="{cy}" r="{R}" fill="none" stroke="{PAPER}" stroke-width="3"/>')
    g.circle(cx, cy, 3.2, stroke=None, fill=INK)
    ex, ey = pt(cx, cy, R - 4, 30)
    g.arrow(cx, cy, ex, ey, w=1.3, size=10)
    g.text(*pt(cx, cy, 68, 48), 'R', 17, italic=False)
    if bottom:
        g.raw(f'<g transform="translate({cx - 24.5} {cy + R - 3 - 23.5})">{TOYCAR}</g>')
        g.arrow(124, cy + R - 44, 178, cy + R - 44, BLUE, w=3, size=12)
        g.text(cx, cy + R + 22, 'A', 16)
    else:
        g.raw(f'<g transform="translate({cx} {cy - R + 3}) rotate(180) translate(-24.5 -23.5)">{TOYCAR}</g>')
        g.arrow(176, cy - R + 44, 122, cy - R + 44, BLUE, w=3, size=12)
        g.text(cx, cy - R - 16, 'B', 16)
    return g


def f22():
    return loop(True)


def f23():
    return loop(False)


# (image number, function, caption, problem count)
FIGURES = [
    (0, f00, 'Vectors A and B, 30.0° from the y-axis', 3),
    (1, f01, 'Vectors A at 53.0° and B at 130.0°, with unit vectors', 2),
    (2, f02, 'Takeoff runway, length unknown', 1),
    (3, f03, 'Firework shell launched at θ, bursting at the top', 1),
    (4, f04, 'Mug sliding off a counter', 1),
    (5, f05, 'Car over the top of a rise', 1),
    (6, f06, 'Block circling on a table, mass M hanging through the hole', 1),
    (7, f07, 'Conical pendulum: ball on a string of length L at θ', 1),
    (8, f08,'Car on a banked curve of radius r, with a view from behind', 1),
    (9, f09, 'Block m₁ on a table, string over a pulley to m₂', 2),
    (10, f10, 'Force F at θ on m₁, string over a pulley to m₂', 1),
    (11, f11, 'Force F presses m₁ against m₂', 2),
    (12, f12, 'Block pulled by F at θ', 1),
    (13, f13, 'Five-link chain lifted by F', 4),
    (14, f14, 'Two ropes at 60° and 40° holding a weight', 2),
    (15, f15, 'Two-pulley hoist, pulled down with F', 2),
    (16, f16, 'Sagging clothesline, ends at θ', 1),
    (17, f17, 'Block on an incline at α, string over a pulley to m₂', 3),
    (18, f18, 'Block A, knot, cord to the wall at α, weight w', 3),
    (19, f19, 'Block A resting on B, B dragged with F', 2),
    (20, f20, 'Block A tied to the wall, B dragged with F', 1),
    (21, f21, 'Window washer pushing the brush with F at α', 2),
    (22, f22, 'Toy car inside a vertical loop, point A', 1),
    (23, f23, 'Toy car upside down at the top, point B', 2),
]
