"""Quiz 2 problem figures, redrawn as theme-aware SVG."""
import math
from svgkit import Fig, INK, PAPER, BLUE, RED, GOLD, DARK, pt, n


def ceiling(g, x1, x2, y=4, h=15):
    g.rect(x1, y, x2 - x1, h, fill=INK, fop=0.1, stroke=None)
    parts = []
    x = x1 + h * 0.7
    while x <= x2:
        parts.append(f'M{n(x)},{y} L{n(x - h * 0.7)},{y + h}')
        x += 6
    g.path(' '.join(parts), INK, 0.8, op=0.55)
    g.line(x1, y + h, x2, y + h, w=1.5)


def bullet(x, y):
    return (f'<path d="M{n(x)},{n(y - 5)} L{n(x + 9)},{n(y - 5)} C{n(x + 13)},{n(y - 5)} {n(x + 16)},{n(y - 2)} '
            f'{n(x + 17)},{y} C{n(x + 16)},{n(y + 2)} {n(x + 13)},{n(y + 5)} {n(x + 9)},{n(y + 5)} L{n(x)},{n(y + 5)} Z" '
            f'fill="{RED}"/>')


def f00():  # ballistic pendulum: before and after
    g = Fig(540, 246)
    # before
    ceiling(g, 14, 252)
    for x in (115, 185):
        g.line(x, 23, x, 130, w=1)
        g.circle(x, 22, 3.6, fill=PAPER, w=1.1)
    g.rect(88, 130, 122, 50, fill=RED, fop=0.45, w=1.2)
    g.raw(bullet(8, 155))
    g.arrow(34, 155, 80, 155, BLUE, w=2.2, size=10)
    # after: block swung right and up, bullet inside
    ceiling(g, 292, 530)
    for x0, x1 in ((337, 409), (407, 479)):
        g.line(x0, 23, x1, 98, w=1)
        g.circle(x0, 22, 3.6, fill=PAPER, w=1.1)
    g.rect(382, 98, 122, 50, fill=RED, fop=0.45, w=1.2)
    g.raw(bullet(434, 123))
    # h between the two block bottoms
    g.line(214, 180, 440, 180, w=1, dash='5 4', op=0.75)
    g.line(258, 148, 376, 148, w=1, dash='5 4', op=0.75)
    g.arrow(322, 112, 322, 147, w=1.2, size=9)
    g.arrow(322, 216, 322, 181, w=1.2, size=9)
    g.text(322, 232, 'h', 17)
    return g


def f01():  # particle pulled over a half-cylinder by F
    g = Fig(460, 230)
    cx, cy, R = 230, 200, 150
    g.rect(0, cy, 460, 26, fill=INK, fop=0.13, stroke=None)
    g.path(f'M{cx - R},{cy} A{R},{R} 0 0 1 {cx + R},{cy} Z', INK, 1.2, fill=BLUE, fop=0.16)
    g.line(0, cy, 460, cy, w=1.4)
    th = 48
    g.arc(cx, cy, R + 4, th, 90, w=1.6)
    g.line(cx, cy - R - 4, 160, cy - R - 4, w=1.6)
    g.arrow(162, cy - R - 4, 92, cy - R - 4, RED, w=2.8, size=13)
    g.vec(126, cy - R - 26, 'F', 17)
    px, py = pt(cx, cy, R + 9, th)
    g.circle(px, py, 9, fill=RED, fop=0.85, w=1.1)
    g.text(*pt(cx, cy, R + 36, th - 6), 'm', 17)
    g.line(cx, cy, *pt(cx, cy, R, th), w=1.1)
    g.text(*pt(cx, cy, 88, th + 12), 'R', 17)
    g.arc(cx, cy, 52, 0, th, w=1.1)
    g.text(*pt(cx, cy, 68, th / 2), 'θ', 17)
    return g


def f02():  # tractor pulls a sled of firewood with a chain at φ
    g = Fig(372, 172)
    gy = 158
    g.line(0, gy, 372, gy, w=1, op=0.5)
    # sled with a stack of logs
    for row in range(5):
        y = 128 - 13 * row
        off = 7 if row % 2 else 0
        x = 20 + off
        while x <= 132:
            g.circle(x, y, 6.6, fill=RED, fop=0.35, w=0.8)
            g.circle(x, y, 2.6, w=0.6)
            x += 14
    for x in (10, 46, 82, 118, 134):
        g.rect(x, 62, 5, 76, fill=RED, fop=0.75, w=0.8)
    g.rect(8, 138, 134, 8, fill=RED, fop=0.6, w=1)
    g.path('M6,154 L138,154 Q150,154 156,142', INK, 2.6)
    g.line(20, 146, 20, 154, w=2)
    g.line(124, 146, 124, 154, w=2)
    # chain at φ to the hitch behind the rear wheel
    hx, hy = 154, 138
    ex, ey = 214, 110
    g.chain(hx, hy, ex, ey, link=6.5)
    phi = math.degrees(math.atan2(hy - ey, ex - hx))
    g.line(hx, hy, hx + 48, hy, w=0.9, dash='4 3', op=0.8)
    g.arc(hx, hy, 30, 0, phi, w=1, end_head=True, size=5.5)
    g.text(hx + 30, hy + 14, 'φ', 16)
    # tractor
    rx, ry, rr = 244, 112, 42
    fx, fy, fr = 338, 134, 22
    g.rect(250, 106, 92, 10, fill=INK, fop=0.3, w=0.8)
    g.path('M268,104 L268,70 L344,70 C350,70 354,74 354,80 L354,104 Z', INK, 1.2, fill=BLUE, fop=0.3)
    g.path(' '.join(f'M{x},74 L{x},100' for x in range(346, 353, 3)), INK, 0.8)
    g.rect(300, 40, 5, 30, fill=INK, fop=0.55, w=0.8)
    g.rect(298, 36, 9, 5, fill=INK, fop=0.7, stroke=None, rx=1)
    g.poly([(209, 22), (255, 22), (262, 64), (206, 64)], stroke=None, fill=BLUE, fop=0.12)
    g.circle(230, 36, 6, fill=INK, fop=0.55, stroke=None)
    g.path('M220,64 L222,48 Q230,42 238,48 L242,64 Z', None, fill=INK, fop=0.55)
    g.line(242, 52, 254, 47, w=2)
    g.line(206, 66, 210, 18, w=3)
    g.line(262, 66, 256, 18, w=3)
    g.rect(198, 10, 70, 9, fill=BLUE, fop=0.55, w=1.1, rx=2)
    g.rect(200, 62, 70, 10, fill=BLUE, fop=0.4, w=1)
    for (cx, cy, r) in ((rx, ry, rr), (fx, fy, fr)):
        g.circle(cx, cy, r, fill=DARK, w=1.3)
        lugs = ' '.join(f'M{n(pt(cx, cy, r - 4, a)[0])},{n(pt(cx, cy, r - 4, a)[1])} '
                        f'L{n(pt(cx, cy, r, a)[0])},{n(pt(cx, cy, r, a)[1])}' for a in range(0, 360, 18))
        g.path(lugs, INK, 1.4, op=0.8)
        g.circle(cx, cy, r * 0.56, fill=PAPER, w=1)
        g.circle(cx, cy, r * 0.56, stroke=None, fill=BLUE, fop=0.3)
        g.circle(cx, cy, r * 0.18, fill=INK, fop=0.6, w=0.8)
    g.path(f'M{rx - 50},{ry + 2} A52,52 0 0 1 {rx + 50},{ry - 8}', INK, 5)
    g.path(f'M{rx - 50},{ry + 2} A52,52 0 0 1 {rx + 50},{ry - 8}', BLUE, 3)
    return g


def f04():  # two equal forces at ±45°, displacement d
    g = Fig(372, 200)
    ox, oy = 22, 100
    g.line(ox, oy, 354, oy, BLUE, 1.6, dash='6 4')
    g.line(356, 89, 356, 111, BLUE, 2)
    g.text(190, 86, 'd', 17)
    for a, lab, dy in ((45, '1', -14), (-45, '2', 18)):
        ex, ey = pt(ox, oy, 128, a)
        g.arrow(ox, oy, ex, ey, RED, w=2.2, size=11)
        g.arc(ox, oy, 80, 0, a, w=1.3, end_head=True, start_head=True, size=8)
        g.text(*pt(ox, oy, 56, a / 2), '45°', 14, italic=False)
        lx, ly = pt(ox, oy, 62, a)
        g.sub(lx - 18, ly + dy, 'F', lab, 16)  # beside the arrow, on the outer side
    g.circle(ox, oy, 6, stroke=None, fill=INK)
    return g


def f05():  # suitcase pulled up a ramp by F
    g = Fig(250, 150)
    th = 28
    a = math.radians(th)
    x0, y0 = 12, 138
    ux, uy = math.cos(a), -math.sin(a)
    nx, ny = -math.sin(a), -math.cos(a)
    P = lambda s, h: (x0 + ux * s + nx * h, y0 + uy * s + ny * h)
    top = P(245, 0)
    g.poly([(x0, y0), (top[0], y0), top], stroke=None, fill=INK, fop=0.1)
    g.line(4, y0, 246, y0, w=1.3)
    g.line(x0, y0, *top, w=1.5)
    sx, sy = P(66, 0)
    g.raw(f'<g transform="translate({n(sx)} {n(sy)}) rotate({-th})">'
          f'<path d="M20,-34 L20,-41 L36,-41 L36,-34" stroke="{INK}" stroke-width="2.2"/>'
          f'<rect x="0" y="-34" width="56" height="34" rx="4" fill="{BLUE}" fill-opacity=".5" stroke="{INK}" stroke-width="1.2"/>'
          f'<path d="M12,-34 L12,0 M44,-34 L44,0" stroke="{INK}" stroke-width=".8" opacity=".6"/></g>')
    fx0, fy0 = P(124, 17)
    fx1, fy1 = P(192, 17)
    g.arrow(fx0, fy0, fx1, fy1, RED, w=2.4, size=11)
    g.vec(fx1 + nx * 16 - 4, fy1 + ny * 16, 'F', 15)
    g.arc(x0, y0, 42, 0, th, w=1.1)
    g.text(*pt(x0, y0, 56, th / 2), 'θ', 15)
    return g


def f06():  # engine hauls a block up an incline via a pulley at the top
    g = Fig(430, 205)
    th = 34
    a = math.radians(th)
    x0, y0 = 12, 196
    ux, uy = math.cos(a), -math.sin(a)
    nx, ny = -math.sin(a), -math.cos(a)
    P = lambda s, h: (x0 + ux * s + nx * h, y0 + uy * s + ny * h)
    sc = (215 - x0) / ux
    cx_, cy_ = P(sc, 0)
    g.poly([(x0, y0), (cx_, cy_), (420, cy_), (420, y0)], fill=INK, fop=0.12, w=1.2)
    r = 12
    pc = P(sc + 20, 22 + r)
    g.rect(pc[0] - 3.5, pc[1], 7, cy_ - pc[1] + 2, fill=INK, fop=0.45, w=0.8)
    tx, ty = pc[0] - nx * r, pc[1] - ny * r
    g.line(*P(82, 22), tx, ty, w=1.3)
    g.circle(*pc, r, stroke=BLUE, fill=PAPER, w=2.2)
    g.circle(*pc, 4.5, stroke=None, fill=INK)
    g.poly([P(22, 0), P(82, 0), P(82, 52), P(22, 52)], fill=RED, fop=0.5, w=1.2)
    g.circle(*P(84, 22), 2.6, fill=PAPER, w=1)
    g.arc(x0, y0, 46, 0, th, w=1.1)
    g.text(*pt(x0, y0, 60, th / 2 - 3), 'θ', 16)
    return g


def f07():  # box with gravel on a roof, cable over a pulley to a bucket of concrete
    g = Fig(330, 245)
    g.rect(4, 96, 220, 140, fill=INK, fop=0.08, stroke=None)
    g.line(4, 96, 224, 96, w=1.6)
    g.line(224, 96, 224, 236, w=1.4)
    pcx, pcy, r = 257, 80, 16
    g.line(156, pcy - r, pcx, pcy - r, w=1.3)
    g.line(pcx + r, pcy, pcx + r, 152, w=1.3)
    g.poly([(pcx, pcy), (224, 100), (198, 96)], stroke=None, fill=INK, fop=0.35)
    g.circle(pcx, pcy, r, fill=PAPER, w=2.2)
    g.circle(pcx, pcy, 6, stroke=None, fill=INK)
    g.path('M90,52 C91,38 99,28 110,26 C118,18 132,19 139,26 C150,28 155,40 154,52 Z', INK, 1.1, fill=RED, fop=0.25)
    g.path(' '.join(f'M{x},{y} l.1,0' for x, y in ((104, 36), (118, 30), (130, 34), (142, 40), (112, 46), (136, 47), (124, 42))),
           INK, 2.2, op=0.55)
    g.rect(90, 52, 64, 44, fill=RED, fop=0.5, w=1.2)
    g.circle(157, pcy - r, 2.8, fill=PAPER, w=1)
    g.text(122, 76, 'Box', 15, italic=False)
    g.text(122, 39, 'Gravel', 14, italic=False)
    g.path(f'M{pcx + r - 16},172 Q{pcx + r},140 {pcx + r + 16},172', INK, 1.2)
    bx = pcx + r
    g.poly([(bx - 18, 170), (bx + 18, 170), (bx + 13, 206), (bx - 13, 206)], fill=BLUE, fop=0.35, w=1.2)
    g.ellipse(bx, 170, 18, 4, fill=BLUE, fop=0.55, w=1.1)
    g.text(bx, 226, 'Concrete', 15, italic=False)
    g.sub(64, 132, 'μ', 's', 17)
    g.sub(64, 164, 'μ', 'k', 17)
    return g


def wall_floor(g, x_wall, y_floor, x_end, top=10):
    g.rect(x_wall - 6, top, 6, y_floor - top + 6, fill=INK, fop=0.2, w=1)
    g.line(x_wall, y_floor, x_end, y_floor, w=1.6)


def spring_block(g, y_floor=120, x_wall=12, bx=210, arrow=True):
    wall_floor(g, x_wall, y_floor, 300)
    g.spring(x_wall, bx, y_floor - 25, 10, amp=13, w=1.3)
    g.rect(bx, y_floor - 52, 52, 52, fill=RED, fop=0.5, w=1.2)
    if arrow:
        g.arrow(bx - 2, y_floor - 25, bx - 58, y_floor - 25, BLUE, w=3, size=12)
    g.text(92, y_floor - 62, 'k', 17)
    g.text(bx + 18, y_floor - 64, 'm', 17)


def f08():  # spring launches a block toward an incline at θ
    g = Fig(470, 140)
    spring_block(g)
    th = math.degrees(math.atan2(108, 162))
    g.poly([(300, 120), (462, 12), (462, 120)], stroke=None, fill=INK, fop=0.12)
    g.line(300, 120, 462, 12, w=1.5)
    g.line(300, 120, 466, 120, w=1, dash='5 4', op=0.8)
    g.arc(300, 120, 72, 0, th, w=1.1, end_head=True)
    g.text(*pt(300, 120, 88, th / 2), 'θ', 17)
    return g


def f10():  # spring pushes a block (1), block slides away (2)
    g = Fig(470, 160)
    spring_block(g)
    g.text(236, 144, '1', 16, italic=False)
    g.line(318, 120, 466, 120, w=1.6)
    g.rect(350, 68, 52, 52, fill=RED, fop=0.5, w=1.2)
    g.arrow(404, 95, 460, 95, BLUE, w=3, size=12)
    g.text(376, 144, '2', 16, italic=False)
    return g


def dim_v(g, x, y1, y2, label, lx, ly, tick=10):
    if tick:
        g.line(x - tick, y1, x + tick, y1, w=0.9, op=0.75)
        g.line(x - tick, y2, x + tick, y2, w=0.9, op=0.75)
    g.arrow(x, (y1 + y2) / 2, x, y1 + 1, w=1.1, size=9)
    g.arrow(x, (y1 + y2) / 2, x, y2 - 1, w=1.1, size=9)
    g.text(lx, ly, label, 17)


def dim_h(g, y, x1, x2, label, lx, ly, tick=10):
    if tick:
        g.line(x1, y - tick, x1, y + tick, w=0.9, op=0.75)
        g.line(x2, y - tick, x2, y + tick, w=0.9, op=0.75)
    g.arrow((x1 + x2) / 2, y, x1 + 1, y, w=1.1, size=9)
    g.arrow((x1 + x2) / 2, y, x2 - 1, y, w=1.1, size=9)
    g.text(lx, ly, label, 17)


def f11():  # block released at height h on a track, rough flat part L
    g = Fig(460, 200)
    g.path('M20,32 C20,100 52,142 102,142 L360,142 C410,142 440,100 442,26', BLUE, 3)
    g.rect(8, 6, 26, 26, fill=RED, fop=0.6, w=1.2, rx=2)
    g.line(36, 32, 132, 32, w=0.9, op=0.75)
    g.arrow(102, 87, 102, 33, w=1.1, size=9)
    g.arrow(102, 87, 102, 141, w=1.1, size=9)
    g.text(118, 87, 'h', 17)
    dim_h(g, 176, 102, 360, 'L', 231, 160, tick=12)
    return g


def f12():  # stone slides down a hill from A to B, then a rough flat stretch
    g = Fig(440, 236)
    by = 200
    hill = 'M40,40 C52,40 60,70 72,92 C88,118 120,112 136,142 C150,170 160,196 182,200'
    g.path(hill + f' L40,{by} Z', None, fill=BLUE, fop=0.2)
    g.path(hill, INK, 1.6)
    g.line(40, 40, 40, by, w=1, op=0.5)
    g.line(182, by, 414, by, w=1.6)
    g.hatch(182, 414, by, op=0.45)
    g.line(414, 176, 414, by, w=2)
    g.vhatch(414, 176, by, op=0.45)
    g.spring(386, 414, 190, 4, amp=5, w=1.1, lead=3)
    g.blob([(42, 30), (48, 22), (58, 21), (64, 28), (62, 38), (52, 41), (44, 38)], fill=RED, fop=0.85, w=1.1)
    g.text(26, 24, 'A', 17)
    g.text(194, 184, 'B', 17)
    dim_v(g, 26, 40, by, 'h', 12, 122, tick=6)
    dim_h(g, 214, 40, 182, 'L', 111, 228, tick=6)
    g.text(300, 220, 'Rough', 15, italic=False)
    return g


def coaster_car(x, y, ang):
    """Small coaster car; (x,y) is where its wheels meet the rail, ang turns its 'up'."""
    return (f'<g transform="translate({n(x)} {n(y)}) rotate({n(ang)})">'
            f'<path d="M-10,-3 L-10,-11 Q-10,-13 -8,-13 L-3,-13 L-1,-9 L8,-9 Q10,-9 10,-7 L10,-3 Z" '
            f'fill="{RED}" fill-opacity=".75" stroke="{INK}" stroke-width=".9"/>'
            f'<circle cx="-5.5" cy="-2" r="2.2" fill="{DARK}" stroke="{INK}" stroke-width=".7"/>'
            f'<circle cx="5.5" cy="-2" r="2.2" fill="{DARK}" stroke="{INK}" stroke-width=".7"/></g>')


def f14():  # roller coaster: start at A, height h, loop of radius R with points B and C
    g = Fig(345, 216)
    gy = 206
    P0, C1, C2, P1 = (62, 24), (70, 132), (120, 188), (200, 188)
    lc, lr = (200, 126), 62

    def bez(t):
        x = (1 - t) ** 3 * P0[0] + 3 * (1 - t) ** 2 * t * C1[0] + 3 * (1 - t) * t * t * C2[0] + t ** 3 * P1[0]
        y = (1 - t) ** 3 * P0[1] + 3 * (1 - t) ** 2 * t * C1[1] + 3 * (1 - t) * t * t * C2[1] + t ** 3 * P1[1]
        dx = 3 * (1 - t) ** 2 * (C1[0] - P0[0]) + 6 * (1 - t) * t * (C2[0] - C1[0]) + 3 * t * t * (P1[0] - C2[0])
        dy = 3 * (1 - t) ** 2 * (C1[1] - P0[1]) + 6 * (1 - t) * t * (C2[1] - C1[1]) + 3 * t * t * (P1[1] - C2[1])
        L = math.hypot(dx, dy)
        return x, y, dx / L, dy / L

    entry = f'M{P0[0]},{P0[1]} C{C1[0]},{C1[1]} {C2[0]},{C2[1]} {P1[0]},{P1[1]}'
    # lattice under the drop (clipped to the area left of the track)
    g.raw(f'<clipPath id="q2coaster-lat"><path d="M40,{P0[1]} L{P0[0]},{P0[1]} '
          f'C{C1[0]},{C1[1]} {C2[0]},{C2[1]} {P1[0]},{P1[1]} L{P1[0]},{gy} L40,{gy} Z"/></clipPath>')
    lat = []
    for k in range(-12, 16):
        x = 40 + k * 16
        lat.append(f'M{x},{gy} L{x + 190},{gy - 190} M{x},{P0[1]} L{x + 190},{P0[1] + 190}')
    g.raw(f'<g clip-path="url(#q2coaster-lat)">')
    g.path(' '.join(lat), INK, 0.9, op=0.45)
    g.raw('</g>')
    g.line(40, P0[1], 40, gy, w=1.6, op=0.8)
    g.line(40, P0[1], P0[0], P0[1], w=1.6, op=0.8)
    g.path(f'M150,{gy} L{n(lc[0] - 50)},{n(lc[1] + 36)} M250,{gy} L{n(lc[0] + 50)},{n(lc[1] + 36)} '
           f'M150,{gy} L250,{gy - 18}', INK, 1, op=0.6)
    g.line(10, gy, 340, gy, w=1.3)
    # the loop as two half circles (one arc between coincident points draws nothing)
    track = entry + f' M{lc[0]},{lc[1] + lr} A{lr},{lr} 0 0 0 {lc[0]},{lc[1] - lr} A{lr},{lr} 0 0 0 {lc[0]},{lc[1] + lr} ' \
                    f'M{P1[0]},{P1[1]} C255,188 300,178 340,168'
    g.path(track, INK, 8)
    g.path(track, PAPER, 4.4)
    # cars and their directions of travel
    x, y, ux, uy = bez(0.16)
    nx, ny = uy, -ux
    g.raw(coaster_car(x + nx * 4, y + ny * 4, math.degrees(math.atan2(nx, -ny))))
    g.arrow(x + nx * 18 + ux * 6, y + ny * 18 + uy * 6, x + nx * 18 + ux * 26, y + ny * 18 + uy * 26, BLUE, w=2.2, size=8)
    g.text(x + nx * 26 + 4, y + ny * 26 - 12, 'A', 16)
    g.raw(coaster_car(lc[0], lc[1] - lr + 4, 180))
    g.arrow(lc[0] + 4, lc[1] - lr + 24, lc[0] - 20, lc[1] - lr + 30, BLUE, w=2.2, size=8)
    g.text(lc[0] + 18, lc[1] - lr + 30, 'B', 16)
    g.raw(coaster_car(lc[0] - lr + 4, lc[1], 90))
    g.arrow(lc[0] - lr + 22, lc[1] + 4, lc[0] - lr + 26, lc[1] + 26, BLUE, w=2.2, size=8)
    g.text(lc[0] - lr + 36, lc[1] - 8, 'C', 16)
    g.circle(*lc, 3.4, stroke=None, fill=INK)
    g.arrow(*lc, *pt(*lc, lr - 6, 30), w=1.4, size=9)
    g.text(*pt(*lc, 26, -18), 'R', 16)
    dim_v(g, 22, P0[1], P1[1], 'h', 10, 106, tick=6)
    return g


def f16():  # block heading for a hill with a pit on the far side
    g = Fig(282, 160)
    by = 135
    g.path(f'M8,{by} L40,{by} C70,{by} 100,110 128,88 C140,78 148,50 152,22 L172,22 L172,{by} Z', INK, 1.3, fill=INK, fop=0.14)
    g.poly([(218, by), (218, 58), (276, 58), (276, by)], INK, 1.3, fill=INK, fop=0.14)
    g.line(0, by, 282, by, w=1.4)
    g.rect(12, by - 14, 15, 14, fill=RED, fop=0.8, w=1)
    g.arrow(8, by - 24, 38, by - 24, BLUE, w=2.4, size=9)
    g.arrow(162, 79, 162, 23, w=1.1, size=8)
    g.arrow(162, 79, 162, by - 1, w=1.1, size=8)
    g.sub(146, 82, 'h', '1', 17)
    g.arrow(262, 97, 262, 59, w=1.1, size=8)
    g.arrow(262, 97, 262, by - 1, w=1.1, size=8)
    g.sub(244, 98, 'h', '2', 17)
    g.arrow(195, 120, 173, 120, w=1.1, size=8)
    g.arrow(195, 120, 217, 120, w=1.1, size=8)
    g.text(195, 104, 'd', 17)
    return g


def f19():  # two blocks held together over a compressed spring, then flying apart
    g = Fig(360, 392)
    for fy in (126, 362):
        g.rect(4, fy, 352, 24, fill=INK, fop=0.1, stroke=None)
        g.line(4, fy, 356, fy, w=1.5)
    # held together
    g.spring(140, 226, 104, 7, amp=11, w=1.3, lead=9)
    g.rope('M140,70 L226,70')
    g.rect(96, 62, 44, 64, fill=RED, fop=0.45, w=1.2)
    g.rect(226, 28, 100, 98, fill=BLUE, fop=0.3, w=1.2)
    g.sub(118, 92, 'm', '1', 17)
    g.sub(276, 76, 'm', '2', 17)
    # released
    g.spring(108, 234, 346, 7, amp=11, w=1.3, lead=10)
    g.rope('M66,306 C80,304 86,296 92,286')
    g.rope('M234,298 C220,296 214,288 208,278')
    g.rect(22, 298, 44, 64, fill=RED, fop=0.45, w=1.2)
    g.rect(234, 264, 100, 98, fill=BLUE, fop=0.3, w=1.2)
    g.sub(44, 330, 'm', '1', 17)
    g.sub(284, 312, 'm', '2', 17)
    g.arrow(128, 232, 26, 232, BLUE, w=3.2, size=14)
    g.arrow(246, 232, 334, 232, BLUE, w=3.2, size=14)
    g.sub(78, 200, 'v', '1', 28)
    g.sub(290, 200, 'v', '2', 28)
    return g


def f21():  # ball M rolls with V, then up an incline a distance d
    g = Fig(330, 132)
    th = 30
    a = math.radians(th)
    bx, by = 160, 122
    ux, uy = math.cos(a), -math.sin(a)
    nx, ny = -math.sin(a), -math.cos(a)
    top = (322, by - 162 * math.tan(a))
    g.poly([(bx, by), (322, by), top], stroke=None, fill=INK, fop=0.13)
    g.line(4, by, 322, by, w=1.4)
    g.line(bx, by, *top, w=1.5)
    g.arc(bx, by, 32, 0, th, w=1)
    g.text(*pt(bx, by, 46, th / 2), 'θ', 15)
    g.circle(40, by - 10, 10, fill=RED, fop=0.8, w=1.1)
    g.text(20, by - 10, 'M', 15)
    g.arrow(56, by - 10, 104, by - 10, BLUE, w=2.2, size=10)
    g.text(116, by - 10, 'V', 15)
    s = 122
    g.circle(bx + ux * s + nx * 10, by + uy * s + ny * 10, 10, fill=RED, fop=0.8, w=1.1)
    h = 34
    g.line(bx, by, bx + nx * (h + 8), by + ny * (h + 8), w=0.9, dash='3 3', op=0.8)
    p1 = (bx + nx * h, by + ny * h)
    p2 = (bx + ux * s + nx * h, by + uy * s + ny * h)
    g.arrow((p1[0] + p2[0]) / 2, (p1[1] + p2[1]) / 2, *p1, w=1.1, size=8)
    g.arrow((p1[0] + p2[0]) / 2, (p1[1] + p2[1]) / 2, *p2, w=1.1, size=8)
    g.text(bx + ux * s / 2 + nx * (h + 13), by + uy * s / 2 + ny * (h + 13), 'd', 16)
    return g


def wood(g, x1, y1, x2, y2, w=6):
    """Pale wooden plank: ink outline, paper core with a light ink tint (like the original's beige frame)."""
    g.line(x1, y1, x2, y2, INK, w + 2)
    g.line(x1, y1, x2, y2, PAPER, w)
    g.line(x1, y1, x2, y2, INK, w, op=0.14)


def f23():  # grindstone seen three-quarter from the front, axe pressed on the rim (as in the original)
    g = Fig(360, 292)
    # stone: front face centred c, tilted 52°; back face offset by t (up-left)
    c, a, b, tilt = (262, 128), 98, 66, 52
    t = (-36, -28)
    u = (math.cos(math.radians(tilt)), -math.sin(math.radians(tilt)))
    v = (-u[1], u[0])
    P = lambda cc, th: (cc[0] + a * math.cos(th) * u[0] + b * math.sin(th) * v[0],
                        cc[1] + a * math.cos(th) * u[1] + b * math.sin(th) * v[1])
    cb = (c[0] + t[0], c[1] + t[1])
    # tangent points: where the face outline runs parallel to the axle offset t
    tang = []
    for k in range(3600):
        th = 2 * math.pi * k / 3600
        dx = -a * math.sin(th) * u[0] + b * math.cos(th) * v[0]
        dy = -a * math.sin(th) * u[1] + b * math.cos(th) * v[1]
        tang.append((abs(dx * t[1] - dy * t[0]) / math.hypot(dx, dy), th))
    tang.sort()
    th1 = tang[0][1]
    th2 = next(th for _, th in tang if abs(math.remainder(th - th1, 2 * math.pi)) > 1)
    ell = lambda cc, extra='': (f'<ellipse cx="{n(cc[0])}" cy="{n(cc[1])}" rx="{a}" ry="{b}" '
                                f'transform="rotate({-tilt} {n(cc[0])} {n(cc[1])})"{extra}/>')
    # back beam and back legs (behind the stone)
    wood(g, 40, 132, 14, 262)
    wood(g, 290, 86, 280, 244)
    wood(g, 36, 126, 296, 80, w=8)
    # stone: back face, rim band, front face
    g.raw(ell(cb, f' fill="{PAPER}" stroke="{INK}" stroke-width="1.3"'))
    g.raw(ell(cb, f' fill="{RED}" fill-opacity=".7"'))
    g.raw(ell(cb, f' fill="{DARK}" fill-opacity=".22"'))
    f1, f2 = P(c, th1), P(c, th2)
    b1, b2 = (f1[0] + t[0], f1[1] + t[1]), (f2[0] + t[0], f2[1] + t[1])
    g.poly([f1, b1, b2, f2], stroke=None, fill=PAPER)
    g.poly([f1, b1, b2, f2], stroke=None, fill=RED, fop=0.7)
    g.poly([f1, b1, b2, f2], stroke=None, fill=DARK, fop=0.22)
    g.line(*f1, *b1, w=1.3)
    g.line(*f2, *b2, w=1.3)
    g.raw(ell(c, f' fill="{PAPER}"'))
    g.raw(ell(c, f' fill="{RED}" fill-opacity=".5" stroke="{INK}" stroke-width="1.3"'))
    g.raw(f'<ellipse cx="{c[0]}" cy="{c[1]}" rx="17" ry="12" transform="rotate({-tilt} {c[0]} {c[1]})" '
          f'fill="{PAPER}" stroke="{INK}" stroke-width="1.1"/>')
    # axle axis (dashed) through the hole
    g.line(c[0] + t[0] * 0.7, c[1] + t[1] * 0.7, c[0] - t[0] * 1.6, c[1] - t[1] * 1.6, w=1, dash='5 3 1 3')
    # front beam (square timber: top face + front face), front legs, stretcher
    p1, p2, d, h = (96, 170), (350, 122), (-11, -9), 11
    wood(g, 104, 176, 70, 288)
    wood(g, 114, 176, 146, 288)
    wood(g, 342, 128, 328, 284)
    wood(g, 84, 252, 334, 212, w=5)
    g.poly([p1, p2, (p2[0] + d[0], p2[1] + d[1]), (p1[0] + d[0], p1[1] + d[1])], fill=PAPER, w=1.1)
    g.poly([p1, p2, (p2[0] + d[0], p2[1] + d[1]), (p1[0] + d[0], p1[1] + d[1])], stroke=None, fill=INK, fop=0.08)
    g.poly([p1, p2, (p2[0], p2[1] + h), (p1[0], p1[1] + h)], fill=PAPER, w=1.1)
    g.poly([p1, p2, (p2[0], p2[1] + h), (p1[0], p1[1] + h)], stroke=None, fill=INK, fop=0.2)
    # bearing on the beam, crank and treadle rod
    g.line(272, 136, 248, 170, INK, 3.2)
    g.line(248, 170, 196, 290, INK, 1.3)
    g.rect(243, 167, 9, 6, fill=PAPER, w=1, rx=2)
    g.raw(f'<rect x="262" y="124" width="14" height="13" rx="3" transform="rotate({-tilt + 90 - 38} 269 130)" '
          f'fill="{PAPER}" stroke="{INK}" stroke-width="1.1"/>')
    # axe: blade pressed on the rim at the left, handle up to the left
    # blade on the left part of the rim, level with the original's (a little above the hole)
    left = [q for q in (P(c, k * math.pi / 180) for k in range(360)) if q[0] < c[0]]
    lf = min(left, key=lambda q: abs(q[1] - (c[1] - 6)))
    mx, my = lf[0] + t[0] * 0.45 + 2, lf[1] + t[1] * 0.45 + 2
    blade = [(mx + 2, my - 20), (mx + 6, my + 16), (mx - 26, my + 10), (mx - 30, my - 12)]
    hx0, hy0 = mx - 28, my - 6
    g.line(hx0, hy0, 24, 18, INK, 9)
    g.line(hx0, hy0, 24, 18, PAPER, 6.5)
    g.line(hx0, hy0, 24, 18, INK, 6.5, op=0.14)
    g.poly(blade, fill=PAPER, w=1.2)
    g.poly(blade, stroke=None, fill=INK, fop=0.3)
    g.line(mx + 2, my - 20, mx + 6, my + 16, PAPER, 2.2, op=0.9)
    # hands: sleeve (blue) into a simple hand on the handle, another pressing the blade
    def hand(x, y, ang, sx, sy):
        # forearm: blue sleeve, then a bare wrist, then the hand
        L = math.hypot(x - sx, y - sy)
        wx, wy = x - (x - sx) / L * 12, y - (y - sy) / L * 12
        g.line(wx, wy, x, y, INK, 13)
        g.line(wx, wy, x, y, PAPER, 11)
        g.line(sx, sy, wx, wy, INK, 17, cap='butt')
        g.line(sx, sy, wx, wy, PAPER, 15, cap='butt')
        g.line(sx, sy, wx, wy, BLUE, 15, op=0.4, cap='butt')
        g.raw(f'<g transform="translate({n(x)} {n(y)}) rotate({n(ang)}) scale(.82)">'
              f'<path d="M-4,-10 C6,-14 20,-12 26,-6 C30,-2 30,6 25,9 C18,13 6,12 -4,10 Z" '
              f'fill="{PAPER}" stroke="{INK}" stroke-width="1.2"/>'
              f'<path d="M12,-11 C16,-6 16,4 13,10 M19,-9 C22,-4 22,4 20,9" stroke="{INK}" stroke-width=".8" fill="none"/></g>')
    k = 0.45
    hand(hx0 + (24 - hx0) * k + 2, hy0 + (18 - hy0) * k - 4, 34, 4, 50)
    hand(mx - 26, my + 9, -16, 4, 214)  # pressing on the blade, as in the original
    # normal force: horizontal, through the blade toward the axle
    g.arrow(70, my - 2, c[0] + t[0] * 0.55 - 4, my - 2, RED, w=2.4, size=12)
    # ω: curved arrow just above the top of the rim, turning to the left
    mc = (c[0] + t[0] * 0.5, c[1] + t[1] * 0.5)
    top = min(P(cb, k_ * math.pi / 180)[1] for k_ in range(360))
    rr = mc[1] - top + 12
    g.arc(*mc, rr, 62, 98, BLUE, 1.8, end_head=True, size=10)
    g.text(*pt(*mc, rr + 14, 56), 'ω', 18)
    return g


def f24():  # spherical shell with four small masses, spin axis through two of them
    g = Fig(176, 176)
    cx, cy, r = 78, 92, 56
    g.circle(cx, cy, r, fill=BLUE, fop=0.55, stroke=None)
    # shade the lower right: the sphere minus a circle shifted up-left (dark in both modes)
    g.raw(f'<clipPath id="q2shell-clip"><circle cx="{cx}" cy="{cy}" r="{r}"/></clipPath>')
    g.raw(f'<path clip-path="url(#q2shell-clip)" fill-rule="evenodd" fill="{DARK}" fill-opacity=".28" '
          f'd="M{cx - r},{cy} a{r},{r} 0 1 0 {2 * r},0 a{r},{r} 0 1 0 {-2 * r},0 Z '
          f'M{cx - r - 14},{cy - 12} a{r + 4},{r + 4} 0 1 0 {2 * r + 8},0 a{r + 4},{r + 4} 0 1 0 {-2 * r - 8},0 Z"/>')
    g.circle(cx, cy, r, w=1.2)
    g.path(f'M{cx - r},{cy} A{r},13 0 0 0 {cx + r},{cy}', INK, 0.9, op=0.7)
    g.path(f'M{cx - r},{cy} A{r},13 0 0 1 {cx + r},{cy}', INK, 0.9, dash='3 3', op=0.45)
    g.line(cx, 8, cx, 172, w=1.3, dash='5 4')
    for x, y in ((cx, cy - r), (cx, cy + r), (cx - r, cy), (cx + r, cy)):
        g.circle(x, y, 5, fill=RED, w=0.9)
    g.text(cx + 10, 14, 'Spin axis', 13, italic=False, anchor='start')
    return g


def f26():  # three forces on a wheel
    g = Fig(232, 292)
    cx, cy, r = 80, 176, 58
    g.circle(cx, cy, r, fill=BLUE, fop=0.35, w=1.3)
    rad = 52
    qx, qy = pt(cx, cy, r, rad)
    g.line(cx, cy, qx, qy, w=1.1)
    g.line(qx, qy, *pt(cx, cy, r + 44, rad), w=1, dash='4 3', op=0.8)
    g.circle(cx, cy, 2.6, stroke=None, fill=INK)
    g.text(62, 164, 'R', 16)
    g.arrow(cx, 44, cx, cy - r - 1, RED, w=2.6, size=12)
    g.vecsub(cx + 6, 24, 'F', '1')
    f2 = rad - 48
    ex, ey = pt(qx, qy, 84, f2)
    g.arrow(qx, qy, ex, ey, RED, w=2.6, size=12)
    g.vecsub(ex - 6, ey - 20, 'F', '2')
    g.arc(qx, qy, 30, f2, rad, w=1)
    g.text(*pt(qx, qy, 42, (f2 + rad) / 2), 'θ', 15)
    g.arrow(cx + r, 270, cx + r, cy + 1, RED, w=2.6, size=12)
    g.vecsub(cx + r - 22, 270, 'F', '3')
    return g


def f27():  # bullet fired past the axis of a cylinder at distance d
    g = Fig(300, 205)
    cx, cy, r = 192, 92, 72
    g.circle(cx, cy, r, fill=BLUE, fop=0.12, w=1.2)
    g.line(4, cy, 296, cy, w=1, dash='5 4', op=0.75)
    g.circle(cx, cy, 2.8, stroke=None, fill=INK)
    g.text(cx, cy + 16, 'Axis', 13, italic=False)
    g.arrow(cx, cy - 36, cx, cy - r + 1, w=1.1, size=8)
    g.arrow(cx, cy - 36, cx, cy - 3, w=1.1, size=8)
    g.text(cx + 12, cy - 38, 'r', 16)
    by = 44
    g.circle(22, by, 3.6, stroke=None, fill=RED)
    g.arrow(30, by, 104, by, BLUE, w=2.4, size=11)
    g.sub(66, by - 16, 'v', '0', 16)
    g.arrow(42, (by + cy) / 2, 42, by + 1, w=1.1, size=8)
    g.arrow(42, (by + cy) / 2, 42, cy - 1, w=1.1, size=8)
    g.text(30, (by + cy) / 2, 'd', 16)
    g.arc(cx, cy, r + 12, -28, -82, BLUE, 1.6, end_head=True, size=10)
    g.text(*pt(cx, cy, r + 26, -96), 'ω', 17)
    return g


def f28():  # student walking on a rotating platform
    g = Fig(282, 282)
    cx, cy, rx, ry = 140, 178, 122, 58
    g.line(cx, 8, cx, cy, w=1.6, dash='2 3')
    g.ellipse(cx, cy, rx, ry, fill=BLUE, fop=0.16, w=1.6)
    g.line(cx, cy, cx, 274, w=1.6, dash='2 3')
    g.line(cx, cy - 40, cx, cy, w=1.6, dash='2 3')
    g.circle(cx, cy, 3.4, stroke=None, fill=INK)
    ex, ey = cx + rx * math.cos(math.radians(160)), cy - ry * math.sin(math.radians(160))
    g.arrow(cx, cy, ex + 2, ey, w=1.3, size=10)
    g.text((cx + ex) / 2 - 4, (cy + ey) / 2 - 14, 'r', 18)
    # rotation arrow round the axis
    erx, ery, ecy = 32, 10, 56
    p = lambda t: (cx + erx * math.cos(math.radians(t)), ecy - ery * math.sin(math.radians(t)))
    (x0, y0), (x1, y1) = p(120), p(60)
    g.path(f'M{n(x0)},{n(y0)} A{erx},{ery} 0 1 0 {n(x1)},{n(y1)}', BLUE, 1.6)
    t = math.radians(60)
    dx, dy = -erx * math.sin(t), -ery * math.cos(t)
    L = math.hypot(dx, dy)
    g.head(x1, y1, dx / L, dy / L, BLUE, 9)
    # student standing on the platform near its far edge (feet inside the rim, as in the original)
    fx, fy = cx + 0.42 * rx, cy - 0.36 * ry
    s = 1.35
    g.path(f'M{n(fx - 7 * s)},{n(fy + 1)} L{n(fx - 1 * s)},{n(fy - 16 * s)} L{n(fx + 6 * s)},{n(fy)} '
           f'M{n(fx - 1 * s)},{n(fy - 16 * s)} L{n(fx + 1 * s)},{n(fy - 34 * s)} '
           f'M{n(fx - 9 * s)},{n(fy - 20 * s)} L{n(fx + 0.5 * s)},{n(fy - 29 * s)} L{n(fx + 10 * s)},{n(fy - 21 * s)}', RED, 2.4)
    g.circle(fx + 1.5 * s, fy - 41 * s, 7 * s, stroke=RED, fill=PAPER, w=2.2)
    return g


def f30():  # block slides down a curved track and sticks to a hanging rod
    g = Fig(296, 236)
    fy = 218
    ox, oy = 128, 16
    g.line(4, fy, 292, fy, w=1.4)
    th = 35
    g.raw(f'<g transform="rotate({th} {ox} {oy})" opacity=".75">'
          f'<rect x="{ox - 5}" y="{oy}" width="10" height="200" fill="none" stroke="{INK}" stroke-width="1" stroke-dasharray="4 3"/>'
          f'<rect x="{ox - 9}" y="{oy + 186}" width="22" height="22" fill="none" stroke="{INK}" stroke-width="1" stroke-dasharray="4 3"/></g>')
    g.line(ox, oy, ox, oy + 120, w=0.9, dash='4 3', op=0.6)
    g.arc(ox, oy, 70, -90, -90 - th, w=1.1)
    g.text(*pt(ox, oy, 84, -90 - th / 2), 'θ', 16)
    g.rect(ox - 5, oy, 10, 200, fill=RED, fop=0.5, w=1.1)
    g.circle(ox, oy + 4, 2.6, fill=PAPER, w=1)
    g.text(ox + 14, oy - 4, 'O', 15)
    g.text(ox + 30, 80, 'M, l', 16)
    tc, tr = (152, 128), 88
    g.arc(*tc, tr, 0, -90, w=2.6)
    g.rect(140, 196, 20, 20, w=1, extra=' stroke-dasharray="4 3" opacity=".75"')
    g.rect(tc[0] + tr - 24, 108, 22, 22, fill=BLUE, fop=0.45, w=1.2)
    g.text(tc[0] + tr - 36, 118, 'm', 16)
    g.arc(*tc, tr - 16, -22, -62, BLUE, 1.8, end_head=True, size=9)
    g.line(tc[0] + tr + 6, 108, tc[0] + tr + 28, 108, w=0.9, op=0.75)
    g.line(tc[0] + tr + 6, fy, tc[0] + tr + 28, fy, w=0.9, op=0.75)
    g.arrow(tc[0] + tr + 20, 163, tc[0] + tr + 20, 109, w=1.1, size=8)
    g.arrow(tc[0] + tr + 20, 163, tc[0] + tr + 20, fy - 1, w=1.1, size=8)
    g.text(tc[0] + tr + 34, 163, 'h', 16)
    return g


def f31():  # toy plane hits a hinged bar a distance l below its top
    g = Fig(240, 192)
    fy = 158
    g.rect(4, fy, 232, 10, fill=INK, fop=0.12, stroke=None)
    g.line(4, fy, 236, fy, w=1.3)
    g.rect(146, 14, 9, 144, fill=RED, fop=0.55, w=1.1)
    g.circle(150.5, fy, 3.6, stroke=None, fill=INK)
    g.line(140, 172, 148, 162, w=0.8)
    g.text(122, 180, 'Hinge', 13, italic=False)
    yl = 58
    g.line(106, 14, 140, 14, w=0.9, op=0.75)
    g.arrow(116, 36, 116, 15, w=1.1, size=8)
    g.arrow(116, 36, 116, yl - 1, w=1.1, size=8)
    g.text(102, 36, 'l', 17)
    g.line(96, yl, 146, yl, w=1, dash='2 3')
    g.arrow(20, yl, 92, yl, BLUE, w=2.6, size=12)
    # fletching: two feathers at the tail, angled back like the original's
    g.path(f'M30,{yl} L22,{yl - 7} M30,{yl} L22,{yl + 7} M38,{yl} L30,{yl - 7} M38,{yl} L30,{yl + 7}', RED, 2.4)
    return g


def f33():  # block revolving on a frictionless table, string pulled down through a hole
    g = Fig(320, 282)
    cx, cy = 165, 108
    pts = []
    for k in range(28):
        t = 2 * math.pi * k / 28
        rr = 1 + 0.05 * math.sin(9 * t) + 0.025 * math.sin(5 * t + 1)
        pts.append((cx + 142 * rr * math.cos(t), cy + 84 * rr * math.sin(t)))
    g.blob(pts, INK, 1.1, fill=INK, fop=0.1)
    g.ellipse(cx, cy - 4, 86, 34, BLUE, 1.8)
    g.ellipse(cx, cy - 4, 6, 3, fill=DARK, w=1)
    a = math.radians(150)
    bx, by = cx + 86 * math.cos(a), cy - 4 - 34 * math.sin(a)
    g.line(bx, by, cx, cy - 4, w=1.2)
    g.poly([(bx - 10, by - 5), (bx - 2, by - 12), (bx + 16, by - 12), (bx + 8, by - 5)], fill=RED, fop=0.45, w=1)
    g.poly([(bx + 8, by - 5), (bx + 16, by - 12), (bx + 16, by + 6), (bx + 8, by + 13)], fill=RED, fop=0.6, w=1)
    g.rect(bx - 10, by - 5, 18, 18, fill=RED, fop=0.75, w=1)
    g.circle(bx + 3, by + 4, 1.8, stroke=None, fill=INK)
    g.arrow(bx + 18, by - 14, bx + 66, by - 26, BLUE, w=3, size=12)
    g.line(cx, cy - 1, cx, 190, w=1.2, dash='4 3')
    g.arrow(cx, 192, cx, 272, RED, w=3, size=13)
    return g


# (image number, function, caption, problem count)
FIGURES = [
    (0, f00, 'Ballistic pendulum: block before and after, rise h', 1),
    (1, f01, 'Particle pulled over a half-cylinder by F', 2),
    (2, f02, 'Tractor pulling a sled of firewood, chain at φ', 1),
    (3, f02, 'Tractor pulling a sled of firewood (same drawing as unnamed(2))', 1),
    (4, f04, 'Two equal forces at ±45°, displacement d', 1),
    (5, f05, 'Suitcase pulled up a ramp by F', 3),
    (6, f06, 'Block hauled up an incline over a pulley', 1),
    (7, f07, 'Box with gravel, cable over a pulley to a bucket of concrete', 2),
    (8, f08, 'Spring launches a block toward an incline at θ', 1),
    (9, f08, 'Spring and incline (same drawing as unnamed(8))', 1),
    (10, f10, 'Spring pushes a block (1), block slides away (2)', 2),
    (11, f11, 'Track with drop h and rough flat part L', 1),
    (12, f12, 'Stone slides down a hill from A to B, then a rough stretch', 1),
    (13, f10, 'Spring and block (same drawing as unnamed(10))', 1),
    (14, f14, 'Roller coaster: start A at height h, loop of radius R', 1),
    (15, f14, 'Roller coaster (same drawing as unnamed(14))', 1),
    (16, f16, 'Hill of height h₁ with a pit of width d', 1),
    (17, f16, 'Hill with a pit (same drawing as unnamed(16))', 1),
    (18, f00, 'Ballistic pendulum (same drawing as unnamed.webp)', 1),
    (19, f19, 'Two blocks pushed apart by a spring', 1),
    (20, f19, 'Two blocks and a spring (same drawing as unnamed(19))', 1),
    (21, f21, 'Ball M rolls with V, then up an incline a distance d', 1),
    (22, f21, 'Ball and incline (same drawing as unnamed(21))', 1),
    (23, f23, 'Axe pressed on a spinning grindstone', 2),
    (24, f24, 'Spherical shell with four small masses', 1),
    (25, f24, 'Spherical shell (same drawing as unnamed(24))', 1),
    (26, f26, 'Three forces on a wheel', 1),
    (27, f27, 'Bullet fired past the axis of a cylinder', 1),
    (28, f28, 'Student walking on a rotating platform', 1),
    (29, f28, 'Rotating platform (same drawing as unnamed(28))', 1),
    (30, f30, 'Block slides down and sticks to a hanging rod', 2),
    (31, f31, 'Toy plane hits a hinged bar', 1),
    (32, f31, 'Hinged bar (same drawing as unnamed(31))', 1),
    (33, f33, 'Block revolving round a hole, string pulled from below', 2),
]
