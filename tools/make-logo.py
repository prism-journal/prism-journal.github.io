"""Draw the PRISM mark.

    python3 tools/make-logo.py

Regenerates every logo file in the repository from the optics, so the mark is
reproducible rather than a binary nobody can re-derive. Nothing here is drawn by
hand: the ray path is traced through real glass with the Sellmeier equation and
Snell's law at both faces, and the artwork is then fitted to each frame.

The mark is a ray refracted through an equilateral prism and dispersed into six
lines, one per section of the journal. 656 nm, the Vol. 1 issue colour, is the
H-alpha line, and it is the least deviated of the six, so it rides at the top of
the fan. Violet bends hardest and falls furthest.

Two liberties, both deliberate and both bounded:

  - The fan's angular spread is magnified about its own mean. Real dispersion
    through 60 degrees of N-BK7 is 1.39 degrees across the visible band, which
    at icon size is one line, not six. The spacing *between* the rays is left
    at its physical ratio, so the fan keeps the real nonlinearity.
  - The six wavelengths are chosen to sit near the six section colours the site
    already defines, rather than the other way round.

What the mark may not become is a hollow triangle on a black square with a
continuous rainbow leaving it. That is the Dark Side of the Moon cover: famous,
actively licensed, and not available to this journal however well it fits the
name. The solid prism, the separated lines and the paper ground are what keep
this mark its own.
"""
import math
from pathlib import Path

import math

# N-BK7, Schott catalogue Sellmeier coefficients (lambda in micrometres)
B = (1.03961212, 0.231792344, 1.01046945)
C = (0.00600069867, 0.0200179144, 103.560653)

APEX = 60.0          # equilateral
THETA1 = 50.0        # incidence; ~minimum deviation for this glass

# the six section colours, in wavelength order. 656 nm is the Vol.1 issue line.
BANDS = [
    (405, "#6E3AD6", "violet"),
    (450, "#2E5FE0", "blue"),
    (488, "#0E93B8", "cyan"),
    (532, "#2E9B4F", "green"),
    (589, "#D89A16", "amber"),
    (656, "#D2542E", "red"),
]


def index(nm):
    l2 = (nm / 1000.0) ** 2
    return math.sqrt(1 + sum(b * l2 / (l2 - c) for b, c in zip(B, C)))


def trace(nm):
    """Return (n, theta2, theta4, deviation) in degrees, or None on TIR."""
    n = index(nm)
    t1 = math.radians(THETA1)
    t2 = math.asin(math.sin(t1) / n)
    t3 = math.radians(APEX) - t2
    s4 = n * math.sin(t3)
    if abs(s4) > 1:
        return None
    t4 = math.asin(s4)
    dev = THETA1 + math.degrees(t4) - APEX
    return n, math.degrees(t2), math.degrees(t4), dev


PLATE, LIGHT, PAPER = "#0B090A", "#F6F2F3", "#FBFAF9"
EXIT = [(nm, col, 30.0 - trace(nm)[2]) for nm, col, _ in BANDS]
MEAN = sum(a for _, _, a in EXIT) / len(EXIT)
SPREAD = max(a for _, _, a in EXIT) - min(a for _, _, a in EXIT)
IN_ANGLE = -30.0 + THETA1
SIDE = 100.0


def geometry(mag, ray_len, beam_len):
    h = SIDE * math.sqrt(3) / 2
    A, B, C = (0, 2 * h / 3), (-SIDE / 2, -h / 3), (SIDE / 2, -h / 3)
    P = ((B[0] + A[0]) / 2, (B[1] + A[1]) / 2)
    Q = ((A[0] + C[0]) / 2, (A[1] + C[1]) / 2)
    d = math.radians(IN_ANGLE)
    I = (P[0] - math.cos(d) * beam_len, P[1] - math.sin(d) * beam_len)
    rays = []
    for nm, col, ang in EXIT:
        a = math.radians(MEAN + (ang - MEAN) * mag)
        rays.append((nm, col, Q, (Q[0] + math.cos(a) * ray_len,
                                  Q[1] + math.sin(a) * ray_len)))
    return A, B, C, P, Q, I, rays


def render(w, h, mag, *, ray_len=1.62, beam_len=1.30, pad_frac=0.055,
           glass=PLATE, beam=PLATE, inner=PAPER, bg=None, idp="m",
           sw_ray=0.155, sw_beam=0.135, sw_in=0.075, gap=0.17, show_inner=True):
    A, B, C, P, Q, I, rays = geometry(mag, ray_len * SIDE, beam_len * SIDE)
    half = max(sw_ray, sw_beam) * SIDE / 2
    xs = [p[0] for p in (A, B, C, I)] + [r[3][0] for r in rays]
    ys = [p[1] for p in (A, B, C, I)] + [r[3][1] for r in rays]
    x0, x1 = min(xs) - half, max(xs) + half
    y0, y1 = min(ys) - half, max(ys) + half
    pad = pad_frac * max(w, h)
    k = min((w - 2 * pad) / (x1 - x0), (h - 2 * pad) / (y1 - y0))
    ox = (w - (x1 - x0) * k) / 2 - x0 * k
    oy = (h + (y1 - y0) * k) / 2 + y0 * k

    def T(p):
        return (ox + p[0] * k, oy - p[1] * k)

    a, b, c, p, q, i = map(T, (A, B, C, P, Q, I))
    o = []
    if bg:
        o.append(f'<rect width="{w}" height="{h}" fill="{bg}"/>')
    o.append(f'<defs><linearGradient id="{idp}b" x1="{i[0]:.2f}" y1="{i[1]:.2f}" '
             f'x2="{p[0]:.2f}" y2="{p[1]:.2f}" gradientUnits="userSpaceOnUse">'
             f'<stop offset="0" stop-color="{beam}" stop-opacity="0.2"/>'
             f'<stop offset="1" stop-color="{beam}" stop-opacity="1"/>'
             f'</linearGradient></defs>')
    o.append(f'<line x1="{i[0]:.2f}" y1="{i[1]:.2f}" x2="{p[0]:.2f}" y2="{p[1]:.2f}" '
             f'stroke="url(#{idp}b)" stroke-width="{sw_beam * SIDE * k:.2f}" '
             f'stroke-linecap="round"/>')
    for nm, col, s, e in rays:
        s, e = T(s), T(e)
        vx, vy = e[0] - s[0], e[1] - s[1]
        L = math.hypot(vx, vy)
        o.append(f'<line x1="{s[0] + vx / L * gap * SIDE * k:.2f}" '
                 f'y1="{s[1] + vy / L * gap * SIDE * k:.2f}" '
                 f'x2="{e[0]:.2f}" y2="{e[1]:.2f}" stroke="{col}" '
                 f'stroke-width="{sw_ray * SIDE * k:.2f}" stroke-linecap="round"/>')
    o.append(f'<path d="M {a[0]:.2f} {a[1]:.2f} L {c[0]:.2f} {c[1]:.2f} '
             f'L {b[0]:.2f} {b[1]:.2f} Z" fill="{glass}"/>')
    if show_inner:
        o.append(f'<line x1="{p[0]:.2f}" y1="{p[1]:.2f}" x2="{q[0]:.2f}" y2="{q[1]:.2f}" '
                 f'stroke="{inner}" stroke-width="{sw_in * SIDE * k:.2f}" '
                 f'stroke-linecap="round"/>')
    return "".join(o)


HD = ('<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}" '
      'viewBox="0 0 {w} {h}" role="img" aria-label="PRISM"><title>PRISM</title>')


OUT = Path(__file__).resolve().parent.parent
PLATE, LIGHT, PAPER, INK = "#0B090A", "#F6F2F3", "#FBFAF9", "#1A1416"

MARK = dict(ray_len=0.62, beam_len=0.52, mag=36, gap=0.05,
            sw_ray=0.125, sw_beam=0.115, sw_in=0.055, pad_frac=0.03)
ICON = dict(ray_len=0.52, beam_len=0.40, mag=44, gap=0.05,
            sw_ray=0.140, sw_beam=0.130, sw_in=0.062, pad_frac=0.085)


def aspect(**kw):
    A, B, C, P, Q, I, rays = geometry(kw["mag"], kw["ray_len"] * SIDE,
                                      kw["beam_len"] * SIDE)
    half = max(kw["sw_ray"], kw["sw_beam"]) * SIDE / 2
    xs = [p[0] for p in (A, B, C, I)] + [r[3][0] for r in rays]
    ys = [p[1] for p in (A, B, C, I)] + [r[3][1] for r in rays]
    return (max(xs) - min(xs) + 2 * half) / (max(ys) - min(ys) + 2 * half)


DESC = (f"A ray refracted through an equilateral prism and dispersed into six lines, "
        f"one for each section of the journal. The path is traced through N-BK7 glass "
        f"at {THETA1:.0f} degrees incidence on a {APEX:.0f} degree apex, close enough to "
        f"minimum deviation that the ray inside the glass runs parallel to the base. The "
        f"fan's angular spread is magnified about its mean for legibility; the spacing "
        f"between the six lines is left at its physical ratio, so red crowds and violet "
        f"runs wide, as it does in the real spectrum.")


def svg(w, h, body, extra=""):
    return (f'<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}" '
            f'viewBox="0 0 {w} {h}" role="img" aria-label="PRISM"{extra}>'
            f'<title>PRISM</title><desc>{DESC}</desc>{body}</svg>\n')


def write(rel, text):
    p = OUT / rel
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(text, encoding="utf-8")
    print(f"  {rel:34s} {len(text):6d} B")


def main():
    print("logo files:")
    ar = aspect(**MARK)
    W, H = round(512 * ar), 512

    write("assets/logo.svg",
          svg(W, H, render(W, H, glass=PLATE, beam=PLATE, inner=PAPER, idp="l", **MARK)))
    write("assets/logo-inverse.svg",
          svg(W, H, render(W, H, glass=LIGHT, beam=LIGHT, inner=PLATE, idp="li", **MARK)))
    # The icon sits on paper, not on a black plate. On a light page the square
    # edge disappears and the mark floats; on a dark one it reads as a card. A
    # black square behind a triangle and a spectrum is also the one composition
    # this journal cannot use, for reasons that have nothing to do with optics.
    write("assets/icon.svg",
          svg(512, 512, render(512, 512, glass=PLATE, beam=PLATE, inner=PAPER,
                               bg=PAPER, idp="i", **ICON)))
    write("favicon.svg",
          svg(512, 512, render(512, 512, glass=PLATE, beam=PLATE, inner=PAPER,
                               bg=PAPER, idp="f", **ICON)))

    # inline variant: colours come from the page, so it follows the theme
    # The ray inside the glass has to match whatever the page sits on, and the
    # site uses two token names for that: --paper on the journal pages, --bg on
    # the article pages. An unresolved var() with no fallback computes to
    # stroke:none, which would delete the ray silently, so the chain ends in a
    # literal.
    inline = render(W, H, glass="currentColor", beam="currentColor",
                    inner="var(--paper, var(--bg, #FBFAF9))", idp="rm", **MARK)
    write("assets/logo-inline.svg", svg(W, H, inline))

    print(f"\n  mark aspect   {ar:.3f} : 1  ({W} x {H})")
    print(f"  fan, mark     {SPREAD * MARK['mag']:.1f} deg ({MARK['mag']}x the physical {SPREAD:.3f} deg)")
    print(f"  fan, icon     {SPREAD * ICON['mag']:.1f} deg ({ICON['mag']}x)")
    print(f"  ray angles    " + "  ".join(f"{nm}nm {MEAN + (a - MEAN) * MARK['mag']:+.1f}"
                                          for nm, _, a in EXIT))


if __name__ == "__main__":
    main()
