// lib/email/cssValues.ts
// Check theme-supplied values before they go into an email's inline `style`.

/*
 * A business's colours, corner radius and font names come from its website
 * theme (JSON the owner edits). In an email they are written straight into
 * `style="…"` attributes. Unchecked, a "colour" such as
 * `red;background:url(https://tracker.example/x)` adds a declaration of its
 * own, and a `"` closes the attribute.
 *
 * Each check below accepts exactly the shapes the platform produces (hex from
 * the theme editor and from `lib/branding/color`, `rgb()` for callers that pass
 * one, `<number><unit>` radii from `lib/email/branding`). Anything else falls
 * back to the default the caller names. So every value the platform really
 * sends renders exactly as before.
 */

const HEX_COLOR = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
const CHANNEL = String.raw`\s*\d{1,3}(?:\.\d+)?%?\s*`;
const ALPHA = String.raw`\s*(?:\d*\.?\d+%?)\s*`;
const RGB_COLOR = new RegExp(String.raw`^rgba?\(${CHANNEL},${CHANNEL},${CHANNEL}(?:,${ALPHA})?\)$`);
const CSS_LENGTH = /^\d{1,4}(?:\.\d{1,3})?(?:px|em|rem|%)$/;
/** Letters (any script), digits, spaces, hyphens and underscores. */
const FONT_NAME_UNSAFE = /[^\p{L}\p{N} _-]/gu;

/**
 * `value` if it is a strict hex or `rgb()`/`rgba()` colour, otherwise `fallback`.
 *
 * Empty and missing values also give `fallback`, matching the `value || default`
 * pattern this replaces.
 */
export function safeCssColor(value: string | null | undefined, fallback: string): string {
  if (!value) return fallback;
  return HEX_COLOR.test(value) || RGB_COLOR.test(value) ? value : fallback;
}

/** `value` if it is a plain length (`12px`, `1.5rem`, `50%`), otherwise `fallback`. */
export function safeCssLength(value: string | null | undefined, fallback: string): string {
  if (!value) return fallback;
  return CSS_LENGTH.test(value) ? value : fallback;
}

/**
 * A font family name with quotes and every character outside a safe set
 * removed, trimmed.
 *
 * Real family names (Google Fonts, system faces, Hebrew names) are made of
 * letters, digits, spaces and hyphens, so they pass through unchanged. An empty
 * result means "no usable name": the caller falls back to the system stack.
 */
export function safeFontName(name: string | null | undefined): string {
  if (!name) return '';
  return name.replace(FONT_NAME_UNSAFE, '').trim();
}
