// components/public/PublicThemeStyle.tsx

import { hoverShade, isDarkColor, mix, onColor, withAlpha } from '@/lib/branding/color';
import type { PublicBrand } from '@/lib/branding/publicBranding';

/** How much the spacing scale stretches or compresses. */
const SPACING_SCALE = { compact: 0.85, normal: 1, spacious: 1.25 } as const;

/**
 * Fonts a public page can request without a network round trip.
 *
 * Heebo is loaded by the root layout through `next/font`, and everything else
 * is a system face, so a page whose template font has not arrived yet still
 * renders in something reasonable rather than in Times.
 */
function fontStack(family: string, locale: string): string {
  const quoted = family.includes(' ') ? `'${family}'` : family;

  // Hebrew first for Hebrew pages. The Latin template faces carry no Hebrew
  // glyphs, so putting one first makes the browser fall back per glyph and an
  // RTL paragraph ends up rendered in two different faces. For every other
  // language the template's choice leads and Heebo covers stray Hebrew — which
  // is what the old "force Heebo first everywhere" hack was approximating, at
  // the cost of throwing away every template's typography.
  return locale === 'he'
    ? `Heebo, ${quoted}, system-ui, -apple-system, sans-serif`
    : `${quoted}, Heebo, system-ui, -apple-system, sans-serif`;
}

/**
 * The business's theme, as CSS custom properties.
 *
 * Emitted once per page by the segment layout. Everything a public page or a
 * shared block needs is derived here — hover shades, tints, and the text
 * colour that sits on top of the brand — so no component has to do colour
 * maths inline, and no component needs a hardcoded fallback hex of its own.
 */
export function PublicThemeStyle({ brand }: { brand: PublicBrand }) {
  const { colors, fonts, borderRadius, spacing } = brand.theme;
  const dark = isDarkColor(colors.background);

  const radius = parseFloat(borderRadius) || 8;
  const radiusUnit = borderRadius.replace(/[\d.]/g, '') || 'px';
  const step = 4 * (SPACING_SCALE[spacing] ?? 1);

  const css = `
    html[data-public-surface] {
      --ap-brand: ${colors.primary};
      --ap-brand-hover: ${hoverShade(colors.primary)};
      --ap-brand-tint: ${withAlpha(colors.primary, 0.1)};
      --ap-brand-ring: ${withAlpha(colors.primary, 0.35)};
      --ap-on-brand: ${onColor(colors.primary)};
      --ap-brand-secondary: ${colors.secondary};
      --ap-accent: ${colors.accent};

      --ap-bg: ${colors.background};
      --ap-surface: ${dark ? mix(colors.background, '#FFFFFF', 0.06) : '#FFFFFF'};
      --ap-surface-2: ${colors.surface};
      --ap-border: ${mix(colors.background, colors.text, dark ? 0.16 : 0.12)};
      --ap-text: ${colors.text};
      --ap-text-muted: ${colors.textSecondary};

      --ap-radius-sm: ${radius / 2}${radiusUnit};
      --ap-radius-md: ${radius}${radiusUnit};
      --ap-radius-lg: ${radius * 2}${radiusUnit};

      /* Neutral, never brand-tinted: a coloured shadow reads as cheap, and on
         a dark template it disappears entirely. */
      --ap-shadow-sm: 0 1px 2px ${withAlpha(colors.text, 0.06)};
      --ap-shadow-md: 0 4px 12px ${withAlpha(colors.text, 0.08)};
      --ap-shadow-lg: 0 12px 32px ${withAlpha(colors.text, 0.12)};

      --ap-space-1: ${step}px;
      --ap-space-2: ${step * 2}px;
      --ap-space-3: ${step * 3}px;
      --ap-space-4: ${step * 4}px;
      --ap-space-6: ${step * 6}px;
      --ap-space-8: ${step * 8}px;

      --ap-font-heading: ${fontStack(fonts.heading, brand.locale)};
      --ap-font-body: ${fontStack(fonts.body, brand.locale)};

      /* Native controls, scrollbars and autofill follow the business's
         palette rather than the customer's operating system. */
      color-scheme: ${brand.colorScheme};
    }
  `;

  return <style dangerouslySetInnerHTML={{ __html: css }} />;
}
