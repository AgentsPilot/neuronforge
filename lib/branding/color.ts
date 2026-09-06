/**
 * Colour maths for branded surfaces.
 *
 * WHY THIS EXISTS
 *
 * Every public page derives shades from the business's one chosen colour —
 * a hover state, a tint behind a selected day, the text colour that sits on top
 * of a brand-filled button. Those derivations were being done by hand, per file,
 * with string concatenation: `${primary}30` for a tint, and white text on the
 * button no matter what the button was.
 *
 * White-on-brand is wrong for a real fraction of the catalogue. Templates like
 * `beauty_glamour_studio` (#B8860B) and `photographer_wedding` (#8B7355) are
 * light enough that white text on them fails contrast, so a business that picked
 * one shipped an unreadable primary button and nothing in the codebase was in a
 * position to notice.
 *
 * Everything here is pure and synchronous so it can run in a server component,
 * in the token layer, and in a unit test over all 33 templates.
 *
 * @module lib/branding/color
 */

/** Parsed sRGB channels, 0-255. */
interface Rgb {
  r: number;
  g: number;
  b: number;
}

/**
 * Parse `#rgb` or `#rrggbb`, tolerating a missing `#`.
 *
 * Returns null rather than throwing: these values come out of a JSONB column
 * that nothing validates, and a malformed colour must degrade to "use the
 * fallback", never take a customer's invoice down.
 */
function parseHex(hex: string | null | undefined): Rgb | null {
  if (!hex || typeof hex !== 'string') return null;

  const value = hex.trim().replace(/^#/, '');
  const expanded =
    value.length === 3
      ? value
          .split('')
          .map(c => c + c)
          .join('')
      : value;

  if (!/^[0-9a-fA-F]{6}$/.test(expanded)) return null;

  return {
    r: parseInt(expanded.slice(0, 2), 16),
    g: parseInt(expanded.slice(2, 4), 16),
    b: parseInt(expanded.slice(4, 6), 16),
  };
}

/** Normalise to `#rrggbb`, or null when unparseable. */
export function normalizeHex(hex: string | null | undefined): string | null {
  const rgb = parseHex(hex);
  if (!rgb) return null;
  const part = (n: number) => n.toString(16).padStart(2, '0');
  return `#${part(rgb.r)}${part(rgb.g)}${part(rgb.b)}`;
}

/** WCAG relative luminance, 0 (black) to 1 (white). */
export function relativeLuminance(hex: string): number {
  const rgb = parseHex(hex);
  if (!rgb) return 1; // Treat the unreadable as light: dark text is the safer guess.

  const channel = (value: number) => {
    const c = value / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };

  return 0.2126 * channel(rgb.r) + 0.7152 * channel(rgb.g) + 0.0722 * channel(rgb.b);
}

/** WCAG contrast ratio between two colours, 1 to 21. */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const lighter = Math.max(la, lb);
  const darker = Math.min(la, lb);
  return (lighter + 0.05) / (darker + 0.05);
}

/** Blend `amount` (0-1) of `b` into `a`. */
export function mix(a: string, b: string, amount: number): string {
  const ca = parseHex(a);
  const cb = parseHex(b);
  if (!ca || !cb) return a;

  const t = Math.max(0, Math.min(1, amount));
  const blend = (x: number, y: number) => Math.round(x + (y - x) * t);
  const part = (n: number) => n.toString(16).padStart(2, '0');

  return `#${part(blend(ca.r, cb.r))}${part(blend(ca.g, cb.g))}${part(blend(ca.b, cb.b))}`;
}

/** Near-black rather than pure black: pure black on a mid tone reads harsh. */
const DARK_INK = '#111827';
const LIGHT_INK = '#FFFFFF';

/** WCAG AA for body text. */
const MIN_CONTRAST = 4.5;

/**
 * The text colour to put ON a brand-filled surface.
 *
 * Every public page's primary button used to hardcode white here, which is
 * wrong for the paler half of the template catalogue.
 *
 * The candidates are tried in preference order rather than picked by a single
 * comparison, because the best of white-and-near-black is not always good
 * enough. `photographer_wedding` (#8B7355) is a warm mid-tone taupe: white
 * reaches 4.49 against it and `#111827` is worse, so a "pick the better of two"
 * rule ships that template a hundredth short of legible with nowhere to go.
 * Pure black clears it at 4.68 — the answer was the direction the comparison
 * had just ruled out. Hence: prefer the softer inks, fall back to the pure
 * extremes, and only if nothing reaches AA take the highest available.
 */
export function onColor(background: string): string {
  const preferLight = contrastRatio(background, LIGHT_INK) >= contrastRatio(background, DARK_INK);

  const candidates = preferLight
    ? [LIGHT_INK, DARK_INK, '#000000']
    : [DARK_INK, LIGHT_INK, '#000000'];

  for (const candidate of candidates) {
    if (contrastRatio(background, candidate) >= MIN_CONTRAST) return candidate;
  }

  // A background no ink clears AA against — return the best available rather
  // than nothing.
  return candidates.reduce((best, candidate) =>
    contrastRatio(background, candidate) > contrastRatio(background, best) ? candidate : best
  );
}

/** Whether a background wants a light-on-dark treatment. */
export function isDarkColor(hex: string): boolean {
  return relativeLuminance(hex) < 0.4;
}

/**
 * `hex` at `alpha` (0-1), as an 8-digit hex.
 *
 * The same trick the website blocks do inline (`${primary}30`), except the
 * suffix is computed rather than eyeballed, and a malformed input returns the
 * colour untouched instead of producing a 9-character string no browser parses.
 */
export function withAlpha(hex: string, alpha: number): string {
  const normalized = normalizeHex(hex);
  if (!normalized) return hex;
  const clamped = Math.max(0, Math.min(1, alpha));
  return `${normalized}${Math.round(clamped * 255)
    .toString(16)
    .padStart(2, '0')}`;
}

/**
 * A pressed/hover shade of the brand colour.
 *
 * Darkens a light brand and lightens a dark one, so the state change stays
 * visible at both ends of the catalogue — darkening `lawyer_criminal_defense`
 * (#0D0D0D) produces no perceptible hover at all.
 */
export function hoverShade(hex: string): string {
  return isDarkColor(hex) ? mix(hex, '#FFFFFF', 0.18) : mix(hex, '#000000', 0.14);
}

/**
 * A gradient built from the brand's two colours.
 *
 * Copied from `HeroBlock`'s private `generateGradient` rather than imported:
 * the website blocks are deliberately out of scope for this work, so the
 * duplication is the price of not editing them. Keep the two in step if the
 * hero's gradient is ever changed.
 */
export function brandGradient(
  primary: string,
  secondary: string,
  variant: 'subtle' | 'bold' | 'mesh' = 'subtle'
): string {
  if (variant === 'bold') {
    return `linear-gradient(135deg, ${primary} 0%, ${secondary} 100%)`;
  }

  if (variant === 'mesh') {
    return [
      `radial-gradient(at 40% 20%, ${withAlpha(primary, 0.19)} 0px, transparent 50%)`,
      `radial-gradient(at 80% 0%, ${withAlpha(secondary, 0.25)} 0px, transparent 50%)`,
      `radial-gradient(at 0% 50%, ${withAlpha(primary, 0.13)} 0px, transparent 50%)`,
      `radial-gradient(at 80% 100%, ${withAlpha(secondary, 0.13)} 0px, transparent 50%)`,
    ].join(', ');
  }

  return `linear-gradient(135deg, ${withAlpha(primary, 0)} 0%, ${withAlpha(secondary, 0.19)} 50%, ${withAlpha(primary, 0.08)} 100%)`;
}
