'use client';

/**
 * The marker that pins a tip to a place on the journey map.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY IT IS NOT AN EXCLAMATION MARK
 *
 * It was. With several tips the marker is their number, which the map and the
 * tip card both show so the reader can look one up against the other. With a
 * single tip there is no number worth printing — "1" beside another digit is
 * noise — so it fell back to "!".
 *
 * And "!" is a warning glyph. The card it sits in is not a warning: it is a
 * pointer at a station on the map, saying "the thing to read is HERE". An
 * alarm bell where a signpost belongs tells the reader something is wrong, and
 * then says nothing about what or where — which is the vaguest a marker can be.
 *
 * A pin says the one thing the marker is for, in every language, with no word
 * in it: this is a place.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY IT IS SHARED
 *
 * `FunnelMap` draws this marker on the station, and `TipsStepper` repeats it
 * inside the tip's badge so the badge reads as a reference to the map rather
 * than as part of the sentence beside it. That only works while the two are
 * identical, and they were two copies of the same ternary in two files —
 * `tips.length > 1 ? String(tip.n) : '!'` — which is exactly the shape that
 * drifts the next time one of them is improved.
 *
 * One definition, two callers. The glyph decision lives here.
 * ─────────────────────────────────────────────────────────────────────────────
 */

export interface TipGlyphProps {
  /** This tip's index, 1-based, as the map numbers them. */
  n: number;
  /** How many tips there are. Below two, the number means nothing. */
  total: number;
  /** The circle's diameter in px; the glyph is sized from it. */
  size: number;
}

/**
 * What goes inside the marker's circle.
 *
 * The caller owns the circle — its colour, size and position differ between the
 * map's station and the card's inline badge — and this owns only what is drawn
 * in it, which is the part that has to agree.
 */
export function TipGlyph({ n, total, size }: TipGlyphProps) {
  if (total > 1) {
    return <>{n}</>;
  }

  /*
   * Inline rather than an icon package: neither caller imports one, and both
   * style with inline objects. `currentColor` so the circle keeps deciding the
   * colour, which is what lets the same glyph sit on the map's solid marker and
   * in the badge's translucent one.
   */
  const glyph = Math.round(size * 0.62);

  return (
    <svg
      width={glyph}
      height={glyph}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="3"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      style={{ display: 'block' }}
    >
      {/* A pin: the teardrop, and the hole that makes it read as one at 9px. */}
      <path d="M12 21s7-6.2 7-11a7 7 0 1 0-14 0c0 4.8 7 11 7 11Z" />
      <circle cx="12" cy="10" r="2.4" />
    </svg>
  );
}
