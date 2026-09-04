// components/public/PublicFontLinks.tsx

import type { PublicBrand } from '@/lib/branding/publicBranding';

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
export function PublicFontLinks({ brand }: { brand: PublicBrand }) {
  const families = [brand.theme.fonts.heading, brand.theme.fonts.body]
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
