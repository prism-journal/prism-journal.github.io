# The PRISM mark

A ray refracted through an equilateral prism and dispersed into six lines, one
for each section of the journal. The ray inside the glass runs level because the
prism is drawn at minimum deviation; the six lines leave the second face in
wavelength order, red highest because red bends least.

656 nm — the H-alpha line, and the Vol. 1 issue colour — is the top ray.

Everything here is generated. To change the mark, change the optics:

    python3 tools/make-logo.py

## Files

| File | Use |
| --- | --- |
| `logo.svg` | The mark, cropped to itself. For light backgrounds. 877 × 512. |
| `logo-inverse.svg` | The same, for dark backgrounds. |
| `logo-inline.svg` | Source for pasting into a page: the prism takes `currentColor`, the ray inside it takes `var(--paper)`, so it follows the site's light and dark themes. This is what the homepage rail uses. |
| `icon.svg` | Square, on paper. The favicon and app icon are cut from this. |
| `icon-32.png`, `icon-192.png`, `icon-512.png` | Raster sizes for anything that cannot take SVG. |
| `../favicon.svg`, `../favicon.ico`, `../apple-touch-icon.png` | Wired into every page; `favicon.ico` carries 16, 32 and 48 px. |

## Using it

Set it on paper or on the plate, never on a mid-tone — the prism is a solid and
needs the ground to stay out of its way. Leave clear space of at least the
prism's own height on every side. Scale it as a whole; the fan's geometry is
computed, not drawn, and stretching one axis makes the optics wrong.

Pair it with the wordmark in the serif stack at roughly 1.6 × the glyph's
height, which is the lockup in the homepage rail. There is no lockup *file*,
deliberately: the wordmark is set in system serifs that are not ours to
redistribute as outlines, so the lockup is assembled in HTML and CSS instead.

## What it is not

Not a hollow triangle on a black square with a continuous rainbow coming out of
it. That composition is the *Dark Side of the Moon* cover — famous, actively
licensed, and unavailable to this journal however well it suits the name. The
solid prism, the six separated lines and the paper ground are what keep this
mark its own, and they should survive any redraw.

## The liberty taken

Real dispersion through 60° of N-BK7 spans 1.39° across the visible band. At
icon size that is one line, not six, so the fan's angular spread is magnified
about its mean — 36× for the wide mark, 44× for the icon. The spacing *between*
the rays is left alone, so the fan keeps the real nonlinearity: red crowded at
the top, violet thrown wide. Every figure the generator prints is the traced
one, not an assumed one.
