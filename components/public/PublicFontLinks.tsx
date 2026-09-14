// components/public/PublicFontLinks.tsx

import type { PublicBrand } from '@/lib/branding/publicBranding';
import type { PageTheme } from '@/components/website/blocks/types';

/** Faces the root layout already loads through `next/font`. */
const ALREADY_LOADED = new Set(['heebo']);

/** Faces that need no download. */
const SYSTEM_FACES = new Set(['system-ui', 'sans-serif', 'serif', 'arial', 'helvetica', 'georgia']);

/**
 * The template's fonts, requested once.
 *
 * `next/font` cannot take a family name that is only known at runtime, so a
 * stylesheet link is still the way to load a business's chosen typeface. What
 * this fixes is everything around it: the three pages that did this inline each
 * requested Heebo a second time (it is already loaded by the root layout), none
 * of them preconnected to the font CDN — costing an extra round trip on every
 * public page load — and none deduplicated heading against body, so a business
 * whose heading and body font are the same asked for it twice.
 */
export function PublicFontLinks(
  props: { brand: PublicBrand } | { theme: PageTheme } | { themes: PageTheme[] }
) {
  /*
   * A brand or a bare theme.
   *
   * The website, landing and preview pages have a theme on the page row and no
   * brand, and each of them built this list inline — asking for Heebo a second
   * time, skipping the preconnect, and not deduplicating heading against body.
   * Taking either shape is what lets all three drop their copy.
   */
  /*
   * `themes` is the gallery's case: the website wizard draws every archetype in
   * its own typeface, which needs all of their faces at once. One request for
   * the union beats one request per card — and one preconnect rather than four.
   */
  const themes = 'themes' in props ? props.themes : ['brand' in props ? props.brand.theme : props.theme];

  /*
   * The mono face the Bold composition sets its small print in.
   *
   * It is named by the composition's stylesheet rather than by the theme, so no
   * theme lists it and nothing else would load it — the labels, prices and step
   * numbers would silently fall back to the body face and Bold would lose the
   * one detail that keeps its contrast from reading as shouting.
   */
  const compositionFaces = themes.some(theme => theme.composition === 'bold')
    ? ['IBM Plex Mono']
    : [];

  const families = themes
    .flatMap(theme => [theme.fonts?.heading, theme.fonts?.body])
    .concat(compositionFaces)
    .map(family => family?.trim())
    .filter((family): family is string => Boolean(family))
    .filter(family => {
      const key = family.toLowerCase();
      return !ALREADY_LOADED.has(key) && !SYSTEM_FACES.has(key);
    });

  const unique = [...new Set(families)];
  if (unique.length === 0) return null;

  const query = unique
    .map(family => `family=${encodeURIComponent(family).replace(/%20/g, '+')}:wght@400;500;600;700`)
    .join('&');

  return (
    <>
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
      <link rel="stylesheet" href={`https://fonts.googleapis.com/css2?${query}&display=swap`} />
    </>
  );
}
