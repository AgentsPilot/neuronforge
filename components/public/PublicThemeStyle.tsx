// components/public/PublicThemeStyle.tsx

import { hoverShade, isDarkColor, mix, onColor, withAlpha } from '@/lib/branding/color';
import type { PublicBrand } from '@/lib/branding/publicBranding';
import type { PageTheme } from '@/components/website/blocks/types';
import { baseCss, compositionFor, templateCss } from '@/components/public/compositions';

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

/** Where the variables land. The document, unless a page scopes them itself. */
const DOCUMENT_SCOPE = 'html[data-public-surface]';

interface ThemeStyleFields {
  theme: PageTheme;
  locale: string;
  colorScheme?: 'light' | 'dark';
  /**
   * A selector to hang the variables off, for a surface that is not a whole
   * document.
   *
   * The five brand surfaces — smart links, invoices, proposals, booking
   * management, the unavailable page — own their document and use the default.
   * The website, landing and preview pages render inside the app shell, so they
   * scope to their own wrapper instead. Custom properties inherit, so anything
   * under that element sees them.
   */
  scope?: string;
}

type PublicThemeStyleProps =
  | ({ brand: PublicBrand } & { scope?: string })
  | ThemeStyleFields;

/**
 * A business's theme, as CSS custom properties. THE one place this happens.
 *
 * Everything a public page or a shared block needs is derived here — hover
 * shades, tints, borders mixed from the palette, and the text colour that sits
 * on top of the brand — so no component does colour maths inline and no
 * component carries a hardcoded fallback hex of its own.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY IT TAKES A THEME AND NOT ONLY A BRAND
 *
 * This served five surfaces and three others carried their own copy of it:
 * `/site/[subdomain]`, `/landing-preview` and `/website-preview/[id]` each
 * emitted a near-identical `<style>` block, and each of those three carried the
 * same bug — `Heebo` hardcoded at the FRONT of the font stack. Heebo covers
 * Latin as well as Hebrew, so it always won and no template's typeface ever
 * rendered on a website or a landing page.
 *
 * Taking a `PageTheme` rather than a whole `PublicBrand` is what lets those
 * three drop their copies: they have a theme on the page row, but no brand.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export function PublicThemeStyle(props: PublicThemeStyleProps) {
  const theme = 'brand' in props ? props.brand.theme : props.theme;
  const locale = 'brand' in props ? props.brand.locale : props.locale;
  const scope = props.scope ?? DOCUMENT_SCOPE;

  /*
   * On a document-scoped surface the variables also go on `:root`.
   *
   * `html[data-public-surface]` only matches once `PublicDirScript` has run —
   * and that is a client script. The server render carries no attribute, so
   * every `var(--ap-*)` on the page resolved to nothing and the browser painted
   * white: a white frame around a near-black smart link, invoice or landing
   * page until hydration, and permanently if the script never ran.
   *
   * `:root` always matches, so the colours are correct in the first byte. The
   * attribute still does its own job — it gates the body and heading rules in
   * `globals.css` and tells the page it is a public surface — it is simply no
   * longer what decides whether a business has any colours at all.
   */
  const variableScope = scope === DOCUMENT_SCOPE ? `:root, ${scope}` : scope;

  const { colors, fonts, borderRadius, spacing } = theme;
  const dark = isDarkColor(colors.background);

  /*
   * The page decides, or the palette does.
   *
   * A brand carries a resolved `colorScheme`; a page row carries only the
   * theme, so it is read off the background — the same test the brand resolver
   * makes.
   */
  const colorScheme =
    ('brand' in props ? props.brand.colorScheme : props.colorScheme) ?? (dark ? 'dark' : 'light');

  const radius = parseFloat(borderRadius) || 8;
  const radiusUnit = borderRadius.replace(/[\d.]/g, '') || 'px';
  const step = 4 * (SPACING_SCALE[spacing] ?? 1);

  /*
   * The Hebrew face, where the Latin one has none.
   *
   * Montserrat and Josefin Sans carry no Hebrew glyphs at all, so a Hebrew page
   * set in one falls back per glyph and renders a single paragraph in two
   * faces. An archetype names the Hebrew equivalent it was designed against and
   * this picks by locale; a theme that names none keeps its own face, which is
   * every theme stored before archetypes existed.
   */
  const headingFamily = (locale === 'he' && fonts.hebrewHeading) || fonts.heading;
  const bodyFamily = (locale === 'he' && fonts.hebrewBody) || fonts.body;

  const headingStack = fontStack(headingFamily, locale);
  const bodyStack = fontStack(bodyFamily, locale);

  /*
   * The type scale.
   *
   * `clamp()` so a page scales between phone and desktop without a media query
   * per block — and so an archetype can be genuinely louder or quieter than
   * another, which is most of what separates them once the palette is set.
   *
   * The middle term is `cqi`, not `vw`. `vw` is 1% of the BROWSER WINDOW, and
   * the editor previews a phone by putting the page in a 375px-wide div in its
   * own document — so on a wide screen the headline resolved at its full
   * desktop size inside the phone frame and broke to one word a line. `cqi`
   * measures the container the public surface declares, which is the page's own
   * width in the preview and in production alike.
   *
   * The fallback is Stone's, which is the platform default archetype: a theme
   * stored before scales existed gets sizes close to what its blocks hardcoded.
   */
  const scale = theme.scale ?? {
    h1: 'clamp(32px, 5cqi, 64px)',
    h2: 'clamp(26px, 3.2cqi, 42px)',
    h3: '21px',
    body: '16.5px',
    small: '13px',
  };

  const css = `
    ${variableScope} {
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

      --ap-font-heading: ${headingStack};
      --ap-font-body: ${bodyStack};

      --ap-scale-h1: ${scale.h1};
      --ap-scale-h2: ${scale.h2};
      --ap-scale-h3: ${scale.h3};
      --ap-scale-body: ${scale.body};
      --ap-scale-small: ${scale.small};

      /*
       * The website blocks' own names, aliased.
       *
       * Twenty-six block components read \`--website-*\` today. Aliasing rather
       * than renaming means they keep working untouched and can be migrated one
       * at a time — and every page published before this change keeps rendering.
       */
      --website-primary: var(--ap-brand);
      --website-secondary: var(--ap-brand-secondary);
      --website-accent: var(--ap-accent);
      --website-background: var(--ap-bg);
      --website-surface: var(--ap-surface-2);
      --website-text: var(--ap-text);
      --website-text-secondary: var(--ap-text-muted);
      --website-border-radius: var(--ap-radius-md);
      --website-font-heading: var(--ap-font-heading);
      --website-font-body: var(--ap-font-body);

      /* Native controls, scrollbars and autofill follow the business's
         palette rather than the customer's operating system. */
      color-scheme: ${colorScheme};
    }
${
  scope === DOCUMENT_SCOPE
    ? ''
    : `
    /* Only for a scoped surface. The document scope gets these from
       globals.css, which already styles \`html[data-public-surface]\`. */
    ${scope} {
      background-color: var(--ap-bg);
      color: var(--ap-text);
      font-family: var(--ap-font-body);
    }
    ${scope} h1, ${scope} h2, ${scope} h3,
    ${scope} h4, ${scope} h5, ${scope} h6 {
      font-family: var(--ap-font-heading);
    }`
}
  `;

  /*
   * The composition's rules, after the variables and in the same scope.
   *
   * Emitted here rather than shipped as a stylesheet so that a surface cannot
   * end up with one and not the other: every mount site already passes a theme,
   * and the composition is read off that theme. A theme that names no
   * composition — every theme stored before compositions existed — resolves to
   * `stone`, which is the arrangement those pages already render in.
   */
  /*
   * The shape defaults always; the composition only when the theme names a
   * design.
   *
   * A theme that is only a palette gets `baseCss` alone, which restores the
   * radius its blocks used to carry inline and changes nothing else. A theme
   * that names an archetype gets its bones on top.
   */
  const composition = compositionFor(theme);
  const layer = composition ? templateCss(theme.id, composition, scope) : baseCss(scope);

  return <style dangerouslySetInnerHTML={{ __html: `${css}\n${layer}` }} />;
}
