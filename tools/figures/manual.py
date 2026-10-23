"""The manual's own demo drawings (no original image), as theme-aware SVG.

Shown live on the manual's "Figures & animations" page (.manual-fig-demo in
course/manual.json); export.py writes them to course/figures/manual.js, keyed
by name, and course/animations/manual.js animates them.
"""
from svgkit import Fig, PAPER, RED, BLUE


def coupled_springs():  # two equal blocks between three springs, m₁ pulled aside
    g = Fig(360, 122)
    fy, y = 104, 84                 # floor, spring axis
    xl, xr = 24, 336                # wall faces
    bw, bh = 44, 40
    eq = (94, 222)                  # blocks' left edges at rest
    pull = 20                       # m₁ is drawn pulled this far left, about to be let go
    g.line(xl, 36, xl, fy, w=2)
    g.vhatch(xl, 36, fy, side=-1, op=0.6)
    g.line(xr, 36, xr, fy, w=2)
    g.vhatch(xr, 36, fy, side=1, op=0.6)
    g.line(xl, fy, xr, fy, w=1.4)
    g.hatch(xl, xr, fy, op=0.6)
    for x in eq:                    # where each block rests
        g.line(x + bw / 2, 40, x + bw / 2, 58, w=1, dash='3 3', op=0.6)
    x1 = eq[0] - pull
    # data-part/data-geom: course/animations/manual.js redraws each spring from
    # these spring() arguments and moves the blocks and the k labels; block-1's
    # data-geom is the pull, which the animation starts from
    springs = ((xl, x1, 5, 11, 1.4), (x1 + bw, eq[1], 7, 8, 1.1), (eq[1] + bw, xr, 5, 11, 1.4))
    for i, (a, b, turns, amp, w) in enumerate(springs, 1):
        g.raw(f'<g data-part="spring-{i}" data-geom="{a} {b} {y} {turns} {amp} 6">')
        g.spring(a, b, y, turns, amp=amp, w=w, lead=6)
        g.raw('</g>')
    for i, (a, b, *_rest) in enumerate(springs, 1):
        g.raw(f'<g data-part="k-{i}">')
        g.text((a + b) / 2, y - 26, "k′" if i == 2 else 'k', 17)
        g.raw('</g>')
    # one accent each, so the eye can follow the swing passing between them
    for i, (x, tint, op) in enumerate(((x1, RED, 0.5), (eq[1], BLUE, 0.4)), 1):
        geom = f' data-geom="{pull}"' if i == 1 else ''
        g.raw(f'<g data-part="block-{i}"{geom}>')
        g.rect(x, fy - bh, bw, bh, stroke=None, fill=PAPER)
        g.rect(x, fy - bh, bw, bh, fill=tint, fop=op, w=1.2)
        g.text(x + bw / 2, fy - bh / 2, 'm', 17)
        g.raw('</g>')
    return g


# (name, function, caption, problems using it): the same shape as the quizzes'
# FIGURES tables, with a name where they have an image number.
FIGURES = [
    ('coupled-springs', coupled_springs, 'Two equal blocks between three springs, the middle one weak (manual demo)', 0),
]
