/**
 * The AgentsPilot logo, and which file to show where.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY A MANIFEST RATHER THAN A PATH IN EACH HEADER
 *
 * Three headers each wrote `src="/images/AgentPilot_Logo.png" width={120}
 * height={120}`. Two things were wrong with that line and both were invisible:
 *
 *   1. The asset is 109x20 — a 5.45:1 wordmark. Declaring it 120x120 told
 *      Next.js it was square, which is what produced the "width or height
 *      modified, but not the other" warning in the console.
 *   2. 109 source pixels rendered at 120 CSS px is already an upscale; on a 2x
 *      display it is 240 device pixels drawn from 109. That is the blur.
 *
 * A path written at the call site cannot carry its own dimensions, so every
 * call site guessed — and all three guessed the same wrong square. Here the
 * dimensions travel WITH the file, and `<Logo>` reads them.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THE FILES ARE TRIMMED
 *
 * The brand exports sit on square art-boards: the 750x750 source contains a
 * 330x60 wordmark and 96.5% transparent padding. Rendered into any box the
 * glyphs shrink to a fraction of it, off-centre — which is most of what "the
 * logo looks bad" was. `scripts/brand/trim-logo.js` removes the padding, so
 * the file's box IS the logo's box and a height prop means what it says.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * TONE: WHICH BACKGROUND, NOT WHICH COLOUR
 *
 * `light` is the logo for a LIGHT background (dark text), `dark` is for a DARK
 * background (light text). Naming them after the background is deliberate: a
 * variant called "the dark logo" is ambiguous every time it is read.
 *
 * The dark file is DERIVED from the light one by an ink swap rather than drawn
 * — see the note on `WORDMARK.dark`. It is a faithful swap, not a designer's
 * lockup, and is the one asset here worth replacing with a real export.
 */

export interface LogoAsset {
  src: string;
  /** The file's REAL pixel dimensions. Never a guess, never a square. */
  width: number;
  height: number;
}

export interface LogoVariant {
  /** For a light background. Always present — this is the fallback. */
  light: LogoAsset;
  /** For a dark background. Null until a light-text file exists. */
  dark: LogoAsset | null;
}

/**
 * The full horizontal lockup: symbol + "AGENTS PILOT".
 *
 * 330x60 trimmed from the 750x750 export — the highest-resolution source that
 * still carries an alpha channel. The 1024x1024 export holds a larger 728x131
 * wordmark but is RGB with the white art-board baked in, so it would render a
 * white slab on any surface that is not pure white.
 */
export const WORDMARK: LogoVariant = {
  light: { src: '/images/brand/wordmark.png', width: 330, height: 60 },
  /*
   * DERIVED, not designed. Produced by `scripts/brand/recolor-logo.js`, which
   * swaps the charcoal ink for #F1F5F9 and leaves the brand orange untouched —
   * the two are separated by a factor of eight in saturation, so the split is
   * not a judgement call.
   *
   * It exists because there is no light-text export and the charcoal is close
   * to invisible on #0F172A. Replace it the moment the brand specifies a real
   * dark lockup; nothing here needs to change but these three values.
   */
  dark: { src: '/images/brand/wordmark-dark.png', width: 330, height: 60 },
};

/**
 * What to export to finish this properly.
 *
 * Neither is required for the logo to render — the mechanism works today — but
 * both are the difference between "sharp" and "good enough".
 */
export const MISSING_ASSETS = [
  {
    file: 'public/images/brand/wordmark.png (re-export)',
    why: 'The best transparent source yields 330x60. A header 32px tall needs ~96 device pixels on a 3x screen, so it is still being upscaled. An export at 3x (roughly 990x180) with transparency would settle it.',
    then: 'run scripts/brand/trim-logo.js over it and update the dimensions above',
  },
  {
    file: 'public/images/brand/mark.png',
    why: 'The symbol alone (the play glyph), for narrow spaces where a 5.5:1 lockup has to shrink past legibility.',
    then: 'add a MARK variant and give <Logo shape="mark"> something to render',
  },
] as const;

/**
 * Height in CSS pixels per place the logo appears.
 *
 * Only the places this actually renders. A size for a surface nobody uses is a
 * claim the manifest cannot keep — adding one is this line plus its literal
 * class in `Logo.tsx`, and the guard test fails until both exist.
 *
 * Sizes live here rather than at the call sites for the same reason the
 * dimensions do: three headers independently choosing a number is how they
 * ended up disagreeing. Width is never specified — it follows the ratio.
 */
export const LOGO_HEIGHT = {
  /** The Business OS header. */
  header: 28,
  /** Narrow viewports, where the lockup competes with the page title. */
  compact: 22,
} as const;

export type LogoPlacement = keyof typeof LOGO_HEIGHT;

/** Width that preserves the asset's own ratio at a given height. */
export function widthForHeight(asset: LogoAsset, height: number): number {
  return Math.round((asset.width / asset.height) * height);
}
