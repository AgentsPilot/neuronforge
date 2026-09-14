/**
 * A landing page at its own address.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS ROUTE HAD TO EXIST
 *
 * There was one public route, `/site/[subdomain]`, and landing pages share the
 * business's single subdomain with its homepage. So a landing page was only
 * reachable if it happened to be the one row the subdomain lookup returned —
 * which meant a business could publish a website OR a landing page, never both.
 * Publishing the second did not shadow the first; it made the address ambiguous
 * and, before the lookup was made deterministic, took the whole site down.
 *
 * The `slug` column has been on every page row since the table was created and
 * nothing read it publicly. This is that read: same rendering, same theme, same
 * blocks — addressed by name.
 *
 * `/site/[subdomain]/book` keeps working: Next matches the static segment
 * before this dynamic one.
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

// Force dynamic rendering - no caching at page level
export const dynamic = 'force-dynamic';
export const revalidate = 0;

interface PageProps {
  params: Promise<{ subdomain: string; slug: string }>;
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

async function getWebsiteData(subdomain: string, slug: string): Promise<WebsiteData | null> {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';

  try {
    // Always use no-store to ensure fresh data after reordering/editing
    // Cache invalidation via revalidateTag wasn't working reliably
    const response = await fetch(
      `${baseUrl}/api/website/public/${subdomain}?slug=${encodeURIComponent(slug)}`,
      {
      cache: 'no-store',
      headers: {
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Pragma': 'no-cache'
      }
      }
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
  const { subdomain, slug } = await params;
  const data = await getWebsiteData(subdomain, slug);

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

export default async function PublicLandingPage({ params }: PageProps) {
  const { subdomain, slug } = await params;
  const data = await getWebsiteData(subdomain, slug);

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
  /*
   * A named page that is not there is Not Found.
   *
   * The subdomain route answers a miss with Coming Soon, which says "this
   * business has no site yet" — a true and useful statement about an address
   * with nothing behind it. Here the address named a particular page, so the
   * honest answer is that this page does not exist.
   */
  if (data.status === 'coming_soon' || !data.page) {
    notFound();
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

      {/* Same reason as the website route: the variables are scoped to the
          `<main>` below, so without this the document around it keeps the
          browser's white — a white frame around a near-black landing page. */}
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