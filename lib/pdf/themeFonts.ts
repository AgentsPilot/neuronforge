/**
 * Register a business's theme font with react-pdf.
 *
 * WHY THIS IS NOT JUST A fontFamily STRING
 *
 * react-pdf ships four built-in families (Helvetica and friends). Anything else
 * has to be registered from an actual font file before it can be named in a
 * style — naming an unregistered family silently falls back, so a themed
 * invoice would quietly look exactly like an unthemed one.
 *
 * Google Fonts serves TTF only to clients that look old enough not to
 * understand WOFF2, so the CSS is requested with an ancient user agent and the
 * .ttf URL is read out of it. Each family is fetched once per process.
 *
 * HEBREW
 *
 * Latin display faces mostly carry no Hebrew glyphs, so applying a theme font
 * to a Hebrew invoice replaces readable text with empty boxes. Hebrew keeps
 * Rubik, which the RTL setup already registers. That is a real limit of the
 * font, not a shortcut.
 *
 * @module lib/pdf/themeFonts
 */

import { Font } from '@react-pdf/renderer';
import { createLogger } from '@/lib/logger';

const logger = createLogger({ module: 'PDFThemeFonts' });

/** Families already registered (or known to be unavailable) this process. */
const attempted = new Map<string, string | null>();

/** Asking as an old browser is what makes Google return a TTF rather than WOFF2. */
const LEGACY_UA = 'Mozilla/4.0 (compatible; MSIE 6.0; Windows NT 5.1)';

function cssUrl(family: string): string {
  return `https://fonts.googleapis.com/css?family=${encodeURIComponent(family)}:400,700`;
}

/**
 * Make a theme font usable in a PDF.
 *
 * @returns the family name to put in styles, or null to keep the default.
 *          Never throws: an invoice must render even when a font does not.
 */
export async function registerThemeFont(family: string | undefined | null): Promise<string | null> {
  if (!family) return null;

  const trimmed = family.trim();
  if (!trimmed) return null;
  if (attempted.has(trimmed)) return attempted.get(trimmed)!;

  try {
    const response = await fetch(cssUrl(trimmed), { headers: { 'User-Agent': LEGACY_UA } });
    if (!response.ok) throw new Error(`Google Fonts returned ${response.status}`);

    const css = await response.text();
    const sources = [...css.matchAll(/src:\s*url\((https:\/\/[^)]+\.ttf)\)/g)].map(m => m[1]);
    if (sources.length === 0) throw new Error('No TTF source in the stylesheet');

    // First declaration is regular; a second, when present, is the bold face.
    Font.register({
      family: trimmed,
      fonts: [
        { src: sources[0], fontWeight: 400 },
        ...(sources[1] ? [{ src: sources[1], fontWeight: 700 }] : []),
      ],
    });

    attempted.set(trimmed, trimmed);
    logger.info({ family: trimmed, faces: sources.length }, 'Registered theme font for PDF');
    return trimmed;
  } catch (err) {
    // A missing font is a cosmetic loss; falling back is the correct outcome.
    attempted.set(trimmed, null);
    logger.warn({ err, family: trimmed }, 'Could not register theme font; using the default');
    return null;
  }
}
