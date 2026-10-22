"""Tiny SVG drawing kit for the redrawn problem figures (tools/figures/export.py).

Colours are theme variables, resolved by css/style.css (.fig-redrawn):
  ink    -> currentColor          lines and labels (the theme's --text)
  paper  -> var(--svg-fill-white) the card surface
  blue   -> var(--svg-blue)       the theme accent: vectors, velocities
  red    -> var(--svg-red)        the theme accent 2: forces
  dark   -> var(--svg-dark)       dark in both modes (tyres)
  gold   -> var(--svg-gold)       a third colour, only where two accents are
                                  not enough (the brass rod)
Objects are tints of whichever accent complements a figure's arrows, so each
figure uses both accents. Grey fills are ink at low opacity.
Coordinates: SVG user units, y down. Angles in degrees, maths convention
(0 = east, 90 = north), converted here.
"""
import math

INK = 'currentColor'
PAPER = 'var(--svg-fill-white)'
BLUE = 'var(--svg-blue)'
RED = 'var(--svg-red)'
GOLD = 'var(--svg-gold)'
DARK = 'var(--svg-dark)'  # dark in both modes (tyres): --text in light, --bg in dark
FONT = "'STIX Two Text', 'Times New Roman', serif"


def n(v):
    s = f'{v:.2f}'.rstrip('0').rstrip('.')
    return '0' if s == '-0' else s


def pt(cx, cy, r, a):
    t = math.radians(a)
    return cx + r * math.cos(t), cy - r * math.sin(t)


class Fig:
    def __init__(self, w, h):
        self.w, self.h, self.parts = w, h, []

    def raw(self, s):
        self.parts.append(s)

    def svg(self):
        return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {n(self.w)} {n(self.h)}" '
                f'fill="none" stroke-linecap="round" stroke-linejoin="round">' + ''.join(self.parts) + '</svg>')

    # ── primitives ──
    def line(self, x1, y1, x2, y2, c=INK, w=1.3, dash=None, op=None, cap=None):
        a = f' stroke-dasharray="{dash}"' if dash else ''
        a += f' opacity="{op}"' if op is not None else ''
        a += f' stroke-linecap="{cap}"' if cap else ''
        self.raw(f'<line x1="{n(x1)}" y1="{n(y1)}" x2="{n(x2)}" y2="{n(y2)}" stroke="{c}" stroke-width="{w}"{a}/>')

    def path(self, d, stroke=INK, w=1.3, fill='none', fop=None, dash=None, op=None, extra=''):
        a = f' fill-opacity="{fop}"' if fop is not None else ''
        a += f' stroke-dasharray="{dash}"' if dash else ''
        a += f' opacity="{op}"' if op is not None else ''
        s = f' stroke="{stroke}" stroke-width="{w}"' if stroke else ''
        self.raw(f'<path d="{d}" fill="{fill}"{a}{s}{extra}/>')

    def poly(self, pts, stroke=INK, w=1.3, fill='none', fop=None, op=None):
        d = 'M' + ' L'.join(f'{n(x)},{n(y)}' for x, y in pts) + ' Z'
        self.path(d, stroke, w, fill, fop, op=op)

    def rect(self, x, y, w_, h_, stroke=INK, w=1.3, fill='none', fop=None, rx=0, extra=''):
        a = f' fill-opacity="{fop}"' if fop is not None else ''
        a += f' rx="{n(rx)}"' if rx else ''
        s = f' stroke="{stroke}" stroke-width="{w}"' if stroke else ''
        self.raw(f'<rect x="{n(x)}" y="{n(y)}" width="{n(w_)}" height="{n(h_)}" fill="{fill}"{a}{s}{extra}/>')

    def circle(self, cx, cy, r, stroke=INK, w=1.3, fill='none', fop=None):
        a = f' fill-opacity="{fop}"' if fop is not None else ''
        s = f' stroke="{stroke}" stroke-width="{w}"' if stroke else ''
        self.raw(f'<circle cx="{n(cx)}" cy="{n(cy)}" r="{n(r)}" fill="{fill}"{a}{s}/>')

    def disc(self, cx, cy, r, fill, fop, w=1.2):
        """Opaque tinted disc: paper first, so lines behind it don't show through the tint."""
        self.circle(cx, cy, r, stroke=None, fill=PAPER)
        self.circle(cx, cy, r, fill=fill, fop=fop, w=w)

    def ellipse(self, cx, cy, rx, ry, stroke=INK, w=1.3, fill='none', fop=None, dash=None, extra=''):
        a = f' fill-opacity="{fop}"' if fop is not None else ''
        a += f' stroke-dasharray="{dash}"' if dash else ''
        s = f' stroke="{stroke}" stroke-width="{w}"' if stroke else ''
        self.raw(f'<ellipse cx="{n(cx)}" cy="{n(cy)}" rx="{n(rx)}" ry="{n(ry)}" fill="{fill}"{a}{s}{extra}/>')

    # ── arrows ──
    def head(self, tx, ty, ux, uy, c, size):
        """Filled arrowhead with its tip at (tx,ty), pointing along unit (ux,uy)."""
        hl, hw = size, size * 0.4
        bx, by = tx - ux * hl, ty - uy * hl
        px, py = -uy, ux
        nx_, ny_ = tx - ux * hl * 0.72, ty - uy * hl * 0.72
        self.raw(f'<path d="M{n(tx)},{n(ty)} L{n(bx + px * hw)},{n(by + py * hw)} '
                 f'L{n(nx_)},{n(ny_)} L{n(bx - px * hw)},{n(by - py * hw)} Z" fill="{c}"/>')

    def arrow(self, x1, y1, x2, y2, c=INK, w=1.3, size=None, both=False):
        size = size or max(7.0, w * 3.6)
        L = math.hypot(x2 - x1, y2 - y1)
        ux, uy = (x2 - x1) / L, (y2 - y1) / L
        sx, sy = (x1 + ux * size * 0.6, y1 + uy * size * 0.6) if both else (x1, y1)
        self.line(sx, sy, x2 - ux * size * 0.6, y2 - uy * size * 0.6, c, w, cap='butt')
        self.head(x2, y2, ux, uy, c, size)
        if both:
            self.head(x1, y1, -ux, -uy, c, size)

    def arc(self, cx, cy, r, a0, a1, c=INK, w=1.1, dash=None, end_head=False, op=None, size=6.5, start_head=False):
        x0, y0 = pt(cx, cy, r, a0)
        x1, y1 = pt(cx, cy, r, a1)
        large = 1 if abs(a1 - a0) > 180 else 0
        sweep = 0 if a1 > a0 else 1
        self.path(f'M{n(x0)},{n(y0)} A{n(r)},{n(r)} 0 {large} {sweep} {n(x1)},{n(y1)}', c, w, dash=dash, op=op)
        sgn = 1 if a1 > a0 else -1
        if end_head:
            t = math.radians(a1)
            # tangent in screen coords for increasing angle: (-sin, -cos)
            self.head(x1, y1, -math.sin(t) * sgn, -math.cos(t) * sgn, c, size)
        if start_head:
            t = math.radians(a0)
            self.head(x0, y0, math.sin(t) * sgn, math.cos(t) * sgn, c, size)

    # ── text ──
    def text(self, x, y, s, size=15, italic=True, anchor='middle', c=INK, weight=None, op=None):
        a = ' font-style="italic"' if italic else ''
        a += f' font-weight="{weight}"' if weight else ''
        a += f' opacity="{op}"' if op is not None else ''
        self.raw(f'<text x="{n(x)}" y="{n(y)}" font-family="{FONT}" font-size="{size}" text-anchor="{anchor}" '
                 f'dominant-baseline="central" fill="{c}" stroke="none"{a}>{s}</text>')

    def rtext(self, x, y, s, angle, size=15, italic=False, c=INK):
        """Text centred on (x,y), rotated by angle degrees (clockwise on screen)."""
        a = ' font-style="italic"' if italic else ''
        self.raw(f'<text transform="translate({n(x)} {n(y)}) rotate({n(angle)})" font-family="{FONT}" '
                 f'font-size="{size}" text-anchor="middle" dominant-baseline="central" fill="{c}" stroke="none"{a}>{s}</text>')

    def sub(self, x, y, base, s, size=15, anchor='middle', c=INK):
        """Italic base letter with an upright subscript, e.g. m₁, v₀, y_i."""
        self.raw(f'<text x="{n(x)}" y="{n(y)}" font-family="{FONT}" font-size="{size}" text-anchor="{anchor}" '
                 f'dominant-baseline="central" fill="{c}" stroke="none"><tspan font-style="italic">{base}</tspan>'
                 f'<tspan font-size="{n(size * 0.7)}" dy="{n(size * 0.3)}">{s}</tspan></text>')

    def vec(self, x, y, s, size=16, c=INK):
        """Italic letter with a small arrow over it (\\vec{A})."""
        self.text(x, y, s, size, True, c=c)
        ay = y - size * 0.72
        self.arrow(x - size * 0.26, ay, x + size * 0.42, ay, c, w=size * 0.065, size=size * 0.26)

    def vecsub(self, x, y, base, s, size=16, c=INK):
        """\\vec{F}_1: italic letter, upright subscript, arrow over the letter only."""
        self.sub(x, y, base, s, size, c=c)
        bx = x - size * 0.22  # the letter sits left of centre once the subscript is added
        ay = y - size * 0.72
        self.arrow(bx - size * 0.3, ay, bx + size * 0.38, ay, c, w=size * 0.065, size=size * 0.26)

    # ── springs, ropes, chains ──
    def spring(self, x1, x2, y, turns, amp=10, c=INK, w=1.4, lead=6):
        """Horizontal coil spring from x1 to x2 centred on y (looped helix, seen side-on)."""
        x0 = x1 + lead
        a = (x2 - lead - x0) / turns   # pitch per turn
        loop = min(a * 0.45, amp * 0.6)  # loop overhang: coils overlap like a helix seen side-on
        steps = 20
        pts = [(x1, y)]
        for i in range(turns * steps + 1):
            t = i / steps * 2 * math.pi
            pts.append((x0 + a * i / steps + loop * (math.cos(t) - 1), y + amp * math.sin(t)))
        pts.append((x2, y))
        d = 'M' + ' L'.join(f'{n(px)},{n(py)}' for px, py in pts)
        self.path(d, c, w)

    def rope(self, d, w=2.6):
        """A twisted-rope look: solid stroke with a light dashed core."""
        self.path(d, INK, w)
        self.path(d, PAPER, w * 0.4, dash='2 2.2')

    def chain(self, x1, y1, x2, y2, link=7, c=INK, w=1.1):
        """Chain of alternating open links (ovals) and edge-on links (bars) between two points."""
        L = math.hypot(x2 - x1, y2 - y1)
        ux, uy = (x2 - x1) / L, (y2 - y1) / L
        ang = math.degrees(math.atan2(uy, ux))
        k, s = 0, 0.0
        while s + link <= L + 0.01:
            cx, cy = x1 + ux * (s + link / 2), y1 + uy * (s + link / 2)
            if k % 2 == 0:
                self.ellipse(cx, cy, link * 0.72, link * 0.36, w=w, extra=f' transform="rotate({n(ang)} {n(cx)} {n(cy)})"')
            else:
                self.line(cx - ux * link * 0.55, cy - uy * link * 0.55, cx + ux * link * 0.55, cy + uy * link * 0.55, c, w * 2)
            s += link * 0.78
            k += 1

    def blob(self, pts, stroke=INK, w=1.2, fill='none', fop=None):
        """Smooth closed outline through pts (Catmull-Rom converted to cubic Béziers)."""
        m = len(pts)
        d = f'M{n(pts[0][0])},{n(pts[0][1])}'
        for i in range(m):
            p0, p1, p2, p3 = pts[i - 1], pts[i], pts[(i + 1) % m], pts[(i + 2) % m]
            c1 = (p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6)
            c2 = (p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6)
            d += f' C{n(c1[0])},{n(c1[1])} {n(c2[0])},{n(c2[1])} {n(p2[0])},{n(p2[1])}'
        self.path(d + ' Z', stroke, w, fill, fop)

    # ── scenery ──
    def hatch(self, x1, x2, y, side=1, step=7, length=7, c=INK, w=0.8, op=0.7):
        """Ground/ceiling hatching below (side=1) or above (side=-1) a line."""
        x = x1 + 3
        parts = []
        while x < x2:
            parts.append(f'M{n(x)},{n(y)} L{n(x - length * 0.7)},{n(y + side * length)}')
            x += step
        self.path(' '.join(parts), c, w, op=op)

    def vhatch(self, x, y1, y2, side=1, step=7, length=7, c=INK, w=0.8, op=0.7):
        """Wall hatching right (side=1) or left (side=-1) of a vertical line."""
        y = y1 + 3
        parts = []
        while y < y2:
            parts.append(f'M{n(x)},{n(y)} L{n(x + side * length)},{n(y - length * 0.7)}')
            y += step
        self.path(' '.join(parts), c, w, op=op)
