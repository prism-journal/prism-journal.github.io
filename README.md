# PRISM

The website for **PRISM**, an open-access multidisciplinary journal of secondary-school
research — reviewed by students, decided by faculty, published with the full review record.

**Live site:** https://prism-journal.github.io/

---

## Editing the site

Everything is in one file: **`index.html`**. There is no build step, no framework, and no
dependencies. Open it in a browser to preview, edit it in any text editor, commit, push —
GitHub Pages redeploys within about a minute.

```
index.html          the entire website (HTML + CSS + JS, self-contained)
build.mjs           regenerates the Claude Artifact copy from index.html
prism-journal.html  generated — do not edit by hand
```

---

## Changing the issue colour

This is the part of the identity that is meant to move. Each issue takes one colour, drawn
from a real emission line, and the colours advance along the visible spectrum.

Find these three lines near the top of the `<style>` block in `index.html` and change them:

```css
:root {
  /* --- ISSUE COLOUR — Vol. 1, No. 1 : 656 nm (H-alpha) --- */
  --issue:      #C4213D;   /* the colour itself */
  --issue-ink:  #A3132E;   /* a darker cut, for text on white */
  --issue-wash: #FBEDEF;   /* a pale tint, for filled backgrounds */
}
```

That one change re-skins the whole publication: buttons, the review diagram, section
markers, rules, and the cover dot. The wordmark, the prism, the typography, and the grid
never change — that is what makes an issue recognisable as PRISM rather than as a new
design each time.

There is a matching block under `@media (prefers-color-scheme: dark)` and under
`:root[data-theme="dark"]`; brighten the colour there so it still reads on a dark ground.

Planned sequence:

| Issue          | Wavelength | Line            | Hex       |
| -------------- | ---------- | --------------- | --------- |
| Vol. 1 No. 1   | 656 nm     | Hydrogen alpha  | `#C4213D` |
| Vol. 1 No. 2   | 589 nm     | Sodium D        | `#D89A16` |
| Vol. 1 No. 3   | 546 nm     | Mercury green   | `#2E9B4F` |
| Vol. 2 No. 1   | 486 nm     | Hydrogen beta   | `#0E93B8` |

---

## Placeholders to fill in

Every unresolved value is marked in the HTML with `class="tbd"` and renders with a dotted
underline, so they are easy to find both in the source and on the page:

- host institution / publisher
- ISSN
- launch date for Vol. 1 No. 1
- long-term preservation service (CLOCKSS, Portico, or an institutional archive)
- names for Editor-in-Chief, Managing Editor, Section Editors, Faculty Board

The contact addresses use the placeholder domain `prismjournal.org`. Replace them with
real addresses before announcing the journal.

---

## The cover

The cover is not an image. It is a canvas that traces a beam of white light through a
triangular prism using Snell's law at both faces, with the refractive index given by
Cauchy's equation, `n(λ) = A + B/λ²` — 1.620 at 400 nm falling to 1.519 at 700 nm. Violet
therefore bends further than red, as it must. The whole optical bench is rotated so the
dispersion fan lies horizontally across the frame; refraction is rotation-equivariant, so
the physics stays exact.

It respects `prefers-reduced-motion`, and the ambient shimmer stops when the cover scrolls
out of view.

---

## Publishing the Claude Artifact copy

```
node build.mjs
```

Regenerates `prism-journal.html` from `index.html`. Only needed if you also maintain the
page as a Claude Artifact; the public website does not use it.

---

## Licence

Site content © the PRISM editorial team. Journal articles are published under
[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).
