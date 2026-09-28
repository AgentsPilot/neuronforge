/**
 * Derive the dark-background wordmark from the light one.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS IS SAFE TO DO MECHANICALLY
 *
 * The lockup is two inks: a near-neutral charcoal (#42403c, saturation ~0.10)
 * for "AGENTS" and half the symbol, and the brand orange (#ef8034, saturation
 * ~0.78) for "PILOT" and the arrow. On a dark surface the charcoal all but
 * disappears while the orange is already legible — so the correct dark variant
 * changes ONE ink and leaves the other exactly as the brand defines it.
 *
 * Saturation separates them by a factor of eight, which is not a close call.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY IT BLENDS RATHER THAN THRESHOLDS
 *
 * Two kinds of edge exist in this file and they are encoded differently:
 *
 *   - glyph against BACKGROUND is anti-aliased in the ALPHA channel, so the RGB
 *     is still charcoal and alpha carries the ramp. Recolouring RGB and keeping
 *     alpha reproduces the ramp correctly in the new ink.
 *   - charcoal against ORANGE, inside the symbol, is anti-aliased in RGB. Those
 *     pixels sit at intermediate saturation, and a hard threshold would cut a
 *     visible stair-step through them.
 *
 * So the mix is proportional to how neutral a pixel is. Pure charcoal goes all
 * the way to the target, pure orange does not move, and the blend between them
 * lands in between — which is what anti-aliasing means.
 *
 * This is a DERIVED asset. It is a faithful ink swap, not a designer's dark
 * lockup; replace it if the brand ever specifies one.
 */
const fs = require('fs');
const { decode, encode } = require('./png');

const [src, dest, targetHex = '#F1F5F9', pureArg = '0.25', mixArg = '0.45'] = process.argv.slice(2);
if (!src || !dest) {
  console.error('usage: recolor-logo.js <src.png> <dest.png> [targetHex] [pureBelow] [mixAbove]');
  process.exit(2);
}

const target = {
  r: parseInt(targetHex.slice(1, 3), 16),
  g: parseInt(targetHex.slice(3, 5), 16),
  b: parseInt(targetHex.slice(5, 7), 16),
};
/*
 * TWO stops, not one.
 *
 * A single ramp from pure-neutral to the cutoff interpolated every pixel FROM
 * its own original value — and the source charcoal is not one colour. It is a
 * spread (#413f3b, #42403c, #43413d, #44423d …) from the original export's
 * compression. Those differences are invisible at luminance 0.25 and obvious at
 * 0.95, so the recoloured glyphs came out visibly speckled.
 *
 * Below PURE the pixel is unambiguously the charcoal ink, so it is SET to the
 * target rather than interpolated — the noise is discarded instead of scaled up.
 * Between PURE and MIX it is a genuine charcoal/orange blend and is interpolated,
 * which is what keeps the symbol's internal edge smooth.
 */
const PURE = Number(pureArg);
const MIX = Number(mixArg);

const img = decode(src);
if (img.ctype !== 6) throw new Error('needs an RGBA source; this one has no alpha channel');

let moved = 0, kept = 0;
for (let i = 0; i < img.w * img.h; i++) {
  const o = i * img.bpp;
  if (img.px[o + 3] === 0) continue; // fully transparent: nothing to recolour

  const r = img.px[o], g = img.px[o + 1], b = img.px[o + 2];
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
  const sat = mx === 0 ? 0 : (mx - mn) / mx;

  // 1 below PURE (snap, discarding source noise), 0 above MIX, linear between.
  const t = sat <= PURE ? 1 : sat >= MIX ? 0 : (MIX - sat) / (MIX - PURE);
  if (t === 0) { kept++; continue; }
  if (t > 0.5) moved++;

  img.px[o] = Math.round(r + (target.r - r) * t);
  img.px[o + 1] = Math.round(g + (target.g - g) * t);
  img.px[o + 2] = Math.round(b + (target.b - b) * t);
}

fs.writeFileSync(dest, encode(img));
console.log(
  `  ${src.split('/').pop()} -> ${dest.split('/').pop()}  ${img.w}x${img.h}  ` +
  `(${moved} px recoloured to ${targetHex}, ${kept} left as brand orange, ${(fs.statSync(dest).size / 1024).toFixed(1)}KB)`
);
