/**
 * Public Website Rendering Page
 * Server-side rendered page for public websites by subdomain
 * No authentication required
 */

import { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { headers } from 'next/headers';
import { WebsiteBlocks, type BlockData } from '@/components/website/blocks';
import type { PageTheme } from '@/components/website/blocks/types';
import type { Locale } from '@/lib/i18n/config';
import { isValidLocale, defaultLocale, getDirection } from '@/lib/i18n/config';
import { PageViewTracker } from '@/components/website/PageViewTracker';
import { PublicThemeStyle } from '@/components/public/PublicThemeStyle';
import { PublicFontLinks } from '@/components/public/PublicFontLinks';
import { DEFAULT_PUBLIC_THEME } from '@/lib/branding/theme';
import { siteFetchOptions } from '@/lib/website-builder/siteCache';

/*
 * Cached, and tagged so an edit can throw it away — see lib/website-builder/
 * siteCache.ts for why the previous `force-dynamic` + `revalidate = 0` was what
 * BROKE invalidation rather than working around it.
 *
 * A LITERAL, not the shared constant. Next reads route-segment config by static
 * analysis before any module is evaluated, so an imported value fails the build
 * with "Invalid revalidate value". The duplication is forced; the test in
 * lib/website-builder/__tests__/siteCache.test.ts is what stops it drifting.
 */
export const revalidate = 60; // must equal SITE_CACHE_TTL_SECONDS

interface PageProps {
  params: Promise<{ subdomain: string }>;
}

interface WebsiteData {
  success: boolean;
  status: 'live' | 'coming_soon';
  subdomain: string;
  page?: {
    title: string;
    meta_description: string | null;
    theme: PageTheme | null;
    favicon_url: string | null;
    og_image_url: string | null;
    website_language?: Locale;
  };
  blocks?: BlockData[];
}

async function getWebsiteData(subdomain: string): Promise<WebsiteData | null> {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';

  try {
    const response = await fetch(
      `${baseUrl}/api/website/public/${subdomain}`,
      siteFetchOptions(subdomain)
    );

    if (!response.ok) {
      return null;
    }

    return await response.json();
  } catch (error) {
    console.error('Failed to fetch website data:', error);
    return null;
  }
}

// Generate metadata for SEO
export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { subdomain } = await params;
  const data = await getWebsiteData(subdomain);

  if (!data || data.status === 'coming_soon' || !data.page) {
    return {
      title: 'Coming Soon',
      description: 'This website is coming soon.'
    };
  }

  return {
    title: data.page.title,
    description: data.page.meta_description || undefined,
    openGraph: {
      title: data.page.title,
      description: data.page.meta_description || undefined,
      images: data.page.og_image_url ? [data.page.og_image_url] : undefined
    },
    icons: data.page.favicon_url ? { icon: data.page.favicon_url } : undefined
  };
}

export default async function PublicWebsitePage({ params }: PageProps) {
  const { subdomain } = await params;
  const data = await getWebsiteData(subdomain);

  if (!data) {
    notFound();
  }

  // Use page's configured language (fallback to browser's accept-language for coming_soon)
  const pageLocale = data.page?.website_language;
  let locale: Locale;

  if (pageLocale && isValidLocale(pageLocale)) {
    locale = pageLocale;
  } else {
    // Fallback to browser preference for coming_soon or if page language not set
    const headersList = await headers();
    const acceptLanguage = headersList.get('accept-language') || '';
    const browserLocale = acceptLanguage.split(',')[0]?.split('-')[0] || defaultLocale;
    locale = isValidLocale(browserLocale) ? browserLocale : defaultLocale;
  }

  const isRTL = getDirection(locale) === 'rtl';

  /*
   * Coming Soon page.
   *
   * Given the business's own theme rather than a hardcoded dark gradient. This
   * is often the FIRST thing a visitor sees of a business — the address is
   * live and shared before the site is finished — and it was the one public
   * surface that looked like the platform instead of the business.
   */
  if (data.status === 'coming_soon') {
    return (
      <ComingSoonPage
        subdomain={subdomain}
        locale={locale}
        theme={data.page?.theme || DEFAULT_PUBLIC_THEME}
      />
    );
  }

  /*
   * Live website.
   *
   * One theme object, used for both the CSS variables and the blocks. It used
   * to be two: `pageTheme` fed the emitter while the raw, possibly-undefined
   * `theme` was handed to the blocks. A page with no stored theme therefore got
   * the default archetype's colours from the emitter but `undefined` inside
   * every block — so `theme.layouts` was absent, `resolveBlockLayout` had
   * nothing to read, and each section fell back to its default arrangement on a
   * page that looked, from its variables, like it had a design.
   */
  const pageTheme = data.page?.theme || DEFAULT_PUBLIC_THEME;
  const blocks = (data.blocks || []) as BlockData[];

  return (
    <>
      {/* Records the visit from the browser. Server-side tracking read the
          headers of the internal data fetch, so every visitor looked identical. */}
      <PageViewTracker subdomain={subdomain} />

      {/*
        The theme, emitted by the one component that does this.

        This page carried its own copy of a `<style>` block and its own font
        link builder, and so did `/landing-preview` and `/website-preview/[id]`
        — three near-identical copies, each with `Heebo` hardcoded at the FRONT
        of the font stack. Heebo covers Latin as well as Hebrew, so it always
        won: no template's typeface has ever rendered on a website or a landing
        page, whichever of the thirty-three was chosen.

        `PublicThemeStyle` puts Hebrew first only for a Hebrew page, and the
        template's face first otherwise. It also emits the `--website-*` names
        the blocks already read, so nothing below changes.
      */}
      {/* Always emitted. A page with no stored theme previously still got a full
          set of hardcoded defaults from the deleted `<style>` block; the same
          guarantee now comes from the one default the platform already has. */}
      <PublicFontLinks theme={pageTheme} />
      <PublicThemeStyle theme={pageTheme} locale={locale} scope="[data-ap-site]" />

      {/*
        The document itself, painted.

        The variables are scoped to `[data-ap-site]`, which is the `<main>`
        below — so everything inside it is themed and the `html` and `body`
        around it keep the browser's white. On a near-black template that shows
        as a white frame around the page, and anywhere the main does not reach
        (the overscroll area, a short page) it is white again.

        This page owns its whole document — unlike the in-app preview, which
        renders the same blocks inside the editor and must NOT repaint the app
        around them. So the rule lives here rather than in the shared emitter.
      */}
      <style
        dangerouslySetInnerHTML={{
          __html: `html,body{background:${pageTheme.colors.background};margin:0}`,
        }}
      />

      {/* `data-ap-site` is what the style above hangs the variables off. Custom
          properties inherit, so every block inside sees them. */}
      <main
        data-ap-site=""
        dir={isRTL ? 'rtl' : 'ltr'}
        className="min-h-screen"
      >
        <WebsiteBlocks
          blocks={blocks}
          theme={pageTheme}
          locale={locale}
          bookingUrl={`/site/${subdomain}/book`}
          subdomain={subdomain}
        />
      </main>
    </>
  );
}

// Coming Soon Component
function ComingSoonPage({
  subdomain,
  locale,
  theme,
}: {
  subdomain: string;
  locale: Locale;
  theme: PageTheme;
}) {
  const labels = {
    en: {
      title: 'Coming Soon',
      subtitle: 'This website is under construction.',
      message: 'We\'re working hard to bring you something amazing. Check back soon!'
    },
    es: {
      title: 'Próximamente',
      subtitle: 'Este sitio web está en construcción.',
      message: 'Estamos trabajando duro para traerte algo increíble. ¡Vuelve pronto!'
    },
    he: {
      title: 'בקרוב',
      subtitle: 'אתר זה נמצא בבנייה.',
      message: 'אנחנו עובדים קשה כדי להביא לך משהו מדהים. חזור בקרוב!'
    }
  };

  const t = labels[locale] || labels.en;

  return (
    <>
      <PublicFontLinks theme={theme} />
      <PublicThemeStyle theme={theme} locale={locale} scope="[data-ap-site]" />
      <main
        data-ap-site=""
        dir={locale === 'he' ? 'rtl' : 'ltr'}
        className="min-h-screen flex items-center justify-center"
      >
        <div className="text-center px-4">
          <div className="relative mb-8">
            <div
              className="w-24 h-24 mx-auto flex items-center justify-center animate-pulse"
              style={{
                background: 'var(--ap-brand)',
                borderRadius: 'var(--ap-radius-lg)',
                boxShadow: 'var(--ap-shadow-lg)',
              }}
            >
              <span className="text-4xl">🚀</span>
            </div>
          </div>

          <h1
            className="font-bold mb-4"
            style={{ fontSize: 'var(--ap-scale-h1)', color: 'var(--ap-text)' }}
          >
            {t.title}
          </h1>

          <p className="mb-2" style={{ fontSize: 'var(--ap-scale-h3)', color: 'var(--ap-text)' }}>
            {t.subtitle}
          </p>

          <p className="max-w-md mx-auto mb-8" style={{ color: 'var(--ap-text-muted)' }}>
            {t.message}
          </p>

          <div
            className="inline-flex items-center gap-2 px-4 py-2"
            style={{
              background: 'var(--ap-surface)',
              border: '1px solid var(--ap-border)',
              borderRadius: 'var(--ap-radius-lg)',
            }}
          >
            <div
              className="w-2 h-2 rounded-full animate-pulse"
              style={{ background: 'var(--ap-brand)' }}
            />
            <span className="text-sm font-mono" style={{ color: 'var(--ap-text-muted)' }}>
              {subdomain}.agentpilot.io
            </span>
          </div>
        </div>
      </main>
    </>
  );
}
