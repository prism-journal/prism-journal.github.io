// Generates og.png — the card shown when a PRISM link is shared.
//
// The dispersion is not drawn by hand: it is traced with the same Snell's law
// and Cauchy dispersion used by the cover on the live site, so the card and the
// page show the same beam rather than two artists' impressions of one.
//
//   node tools/make-og-image.mjs
//
// Requires sharp (dev-only, not shipped): npm i sharp

import { writeFileSync } from "node:fs";
import sharp from "sharp";

const W = 1200, H = 630;

/* ---- optics, identical to the cover ------------------------------------ */
const CAUCHY_A = 1.470, CAUCHY_B = 24000;
const PRISM_ROT = 19 * Math.PI / 180;
const SCENE_ROT = -43.8 * Math.PI / 180;
const nOf = (lam) => CAUCHY_A + CAUCHY_B / (lam * lam);

const norm = (v) => { const l = Math.hypot(v[0], v[1]); return [v[0] / l, v[1] / l]; };
const rot = (p, o, a) => {
  const c = Math.cos(a), s = Math.sin(a), x = p[0] - o[0], y = p[1] - o[1];
  return [o[0] + x * c - y * s, o[1] + x * s + y * c];
};
function refract(I, N, eta) {
  const cosi = -(I[0] * N[0] + I[1] * N[1]);
  const k = 1 - eta * eta * (1 - cosi * cosi);
  if (k < 0) return null;
  const c = eta * cosi - Math.sqrt(k);
  return norm([eta * I[0] + c * N[0], eta * I[1] + c * N[1]]);
}
function hitSeg(P, d, A, B) {
  const ex = B[0] - A[0], ey = B[1] - A[1];
  const den = d[0] * ey - d[1] * ex;
  if (Math.abs(den) < 1e-9) return null;
  const t = ((A[0] - P[0]) * ey - (A[1] - P[1]) * ex) / den;
  const u = ((A[0] - P[0]) * d[1] - (A[1] - P[1]) * d[0]) / den;
  if (t <= 1e-6 || u < -1e-4 || u > 1 + 1e-4) return null;
  return [P[0] + d[0] * t, P[1] + d[1] * t];
}
function rgbOf(lam) {
  let r = 0, g = 0, b = 0;
  if (lam < 440)      { r = -(lam - 440) / 60; b = 1; }
  else if (lam < 490) { g = (lam - 440) / 50;  b = 1; }
  else if (lam < 510) { g = 1; b = -(lam - 510) / 20; }
  else if (lam < 580) { r = (lam - 510) / 70; g = 1; }
  else if (lam < 645) { r = 1; g = -(lam - 645) / 65; }
  else                { r = 1; }
  let f = 1;
  if (lam < 420)      f = 0.3 + 0.7 * (lam - 380) / 40;
  else if (lam > 645) f = 0.3 + 0.7 * (700 - lam) / 55;
  const ch = (c) => Math.round(255 * Math.pow(Math.max(0, Math.min(1, c * f)), 0.8));
  return [ch(r), ch(g), ch(b)];
}

/* ---- scene ------------------------------------------------------------- */
const cx = W * 0.36, cy = H * 0.68, s = 128;
const h = s * Math.sqrt(3) / 2, C = [cx, cy];

const T  = rot([cx, cy - 2 * h / 3], C, PRISM_ROT);
const BL = rot([cx - s / 2, cy + h / 3], C, PRISM_ROT);
const BR = rot([cx + s / 2, cy + h / 3], C, PRISM_ROT);

let nL = norm([-(BL[1] - T[1]), BL[0] - T[0]]); if (nL[0] > 0) nL = [-nL[0], -nL[1]];
let nR = norm([-(BR[1] - T[1]), BR[0] - T[0]]); if (nR[0] < 0) nR = [-nR[0], -nR[1]];

const P0 = [T[0] + (BL[0] - T[0]) * 0.5, T[1] + (BL[1] - T[1]) * 0.5];
const far = Math.hypot(W, H) * 1.4;
const R = (p) => rot(p, C, SCENE_ROT);

// The rays fan apart as they travel, so too few of them read as discrete
// stripes at the right edge rather than a continuous spectrum.
const N_RAYS = 260;
const rays = [];
for (let i = 0; i < N_RAYS; i++) {
  const lam = 400 + 300 * (i / (N_RAYS - 1));
  const n = nOf(lam);
  const t1 = refract([1, 0], nL, 1 / n);           if (!t1) continue;
  const P1 = hitSeg(P0, t1, T, BR);                if (!P1) continue;
  const t2 = refract(t1, [-nR[0], -nR[1]], n);     if (!t2) continue;
  rays.push({ c: rgbOf(lam), a: R(P1), b: R([P1[0] + t2[0] * far, P1[1] + t2[1] * far]) });
}
if (rays.length !== N_RAYS) throw new Error(`only ${rays.length}/${N_RAYS} rays traced — check the geometry`);

const beamLen = Math.min(W, H) * 0.42;
const entry = R([P0[0] - beamLen, P0[1]]);
const glass = R(P0);
const [rT, rBL, rBR] = [R(T), R(BL), R(BR)];
const f2 = (p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`;

/* ---- card -------------------------------------------------------------- */
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <linearGradient id="beam" x1="${entry[0]}" y1="${entry[1]}" x2="${glass[0]}" y2="${glass[1]}"
                    gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#FFFDFA" stop-opacity="0"/>
      <stop offset="1" stop-color="#FFFDFA" stop-opacity="0.95"/>
    </linearGradient>
    <linearGradient id="scrim" x1="0" y1="0" x2="${W}" y2="0" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#0B090A" stop-opacity="0.95"/>
      <stop offset="0.42" stop-color="#0B090A" stop-opacity="0.55"/>
      <stop offset="0.72" stop-color="#0B090A" stop-opacity="0"/>
    </linearGradient>
  </defs>

  <rect width="${W}" height="${H}" fill="#0B090A"/>

  <g>
    ${rays.map((r) => {
      const col = `rgb(${r.c[0]},${r.c[1]},${r.c[2]})`;
      return `<line x1="${r.a[0].toFixed(1)}" y1="${r.a[1].toFixed(1)}" x2="${r.b[0].toFixed(1)}" y2="${r.b[1].toFixed(1)}" stroke="${col}" stroke-width="11" stroke-opacity="0.028" stroke-linecap="round"/>`;
    }).join("\n    ")}
    ${rays.map((r) => {
      const col = `rgb(${r.c[0]},${r.c[1]},${r.c[2]})`;
      return `<line x1="${r.a[0].toFixed(1)}" y1="${r.a[1].toFixed(1)}" x2="${r.b[0].toFixed(1)}" y2="${r.b[1].toFixed(1)}" stroke="${col}" stroke-width="3.4" stroke-opacity="0.30" stroke-linecap="round"/>`;
    }).join("\n    ")}
  </g>

  <line x1="${entry[0].toFixed(1)}" y1="${entry[1].toFixed(1)}" x2="${glass[0].toFixed(1)}" y2="${glass[1].toFixed(1)}"
        stroke="url(#beam)" stroke-width="7" stroke-opacity="0.16" stroke-linecap="round"/>
  <line x1="${entry[0].toFixed(1)}" y1="${entry[1].toFixed(1)}" x2="${glass[0].toFixed(1)}" y2="${glass[1].toFixed(1)}"
        stroke="url(#beam)" stroke-width="1.8" stroke-linecap="round"/>

  <polygon points="${f2(rT)} ${f2(rBR)} ${f2(rBL)}"
           fill="#FFFFFF" fill-opacity="0.03" stroke="#FFFAF5" stroke-opacity="0.42" stroke-width="1.2"/>

  <rect width="${W}" height="${H}" fill="url(#scrim)"/>

  <text x="76" y="238" font-family="Hoefler Text, Iowan Old Style, Palatino, Georgia, serif"
        font-size="150" letter-spacing="9" fill="#F6F2F3">PRISM</text>

  <text x="80" y="300" font-family="Hoefler Text, Iowan Old Style, Palatino, Georgia, serif"
        font-size="31" fill="#F6F2F3" fill-opacity="0.86">A multidisciplinary journal of</text>
  <text x="80" y="344" font-family="Hoefler Text, Iowan Old Style, Palatino, Georgia, serif"
        font-size="31" fill="#F6F2F3" fill-opacity="0.86">secondary-school research</text>

  <line x1="80" y1="392" x2="270" y2="392" stroke="#C4213D" stroke-width="3"/>

  <text x="80" y="440" font-family="SF Mono, Menlo, ui-monospace, monospace"
        font-size="19" letter-spacing="2.4" fill="#F6F2F3" fill-opacity="0.5">OPEN ACCESS</text>
  <text x="80" y="472" font-family="SF Mono, Menlo, ui-monospace, monospace"
        font-size="19" letter-spacing="2.4" fill="#F6F2F3" fill-opacity="0.5">TRANSPARENT REVIEW</text>
  <text x="80" y="504" font-family="SF Mono, Menlo, ui-monospace, monospace"
        font-size="19" letter-spacing="2.4" fill="#F6F2F3" fill-opacity="0.5">NO FEES</text>

  <text x="80" y="574" font-family="SF Mono, Menlo, ui-monospace, monospace"
        font-size="17" letter-spacing="1.6" fill="#F6F2F3" fill-opacity="0.33">prism-journal.github.io</text>
</svg>`;

writeFileSync(new URL("../og.svg", import.meta.url), svg);
const info = await sharp(Buffer.from(svg)).png({ compressionLevel: 9 }).toFile(
  new URL("../og.png", import.meta.url).pathname);
console.log(`og.png  ${info.width}x${info.height}  ${(info.size / 1024).toFixed(0)} KB  ${rays.length} rays`);
