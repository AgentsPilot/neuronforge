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

// Force dynamic rendering - no caching at page level
export const dynamic = 'force-dynamic';
export const revalidate = 0;

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
    // Always use no-store to ensure fresh data after reordering/editing
    // Cache invalidation via revalidateTag wasn't working reliably
    const response = await fetch(`${baseUrl}/api/website/public/${subdomain}`, {
      cache: 'no-store',
      headers: {
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Pragma': 'no-cache'
      }
    });

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

  // Coming Soon page
  if (data.status === 'coming_soon') {
    return <ComingSoonPage subdomain={subdomain} locale={locale} />;
  }

  // Live website
  const theme = data.page?.theme || undefined;
  const blocks = (data.blocks || []) as BlockData[];

  // Build font links - always use Heebo as the primary font
  const fontFamilies = new Set<string>();
  // Always include Heebo as the platform font
  fontFamilies.add('Heebo');
  // Add any additional theme fonts if specified and different from Heebo
  if (theme?.fonts?.heading && theme.fonts.heading !== 'Heebo') fontFamilies.add(theme.fonts.heading);
  if (theme?.fonts?.body && theme.fonts.body !== 'Heebo') fontFamilies.add(theme.fonts.body);

  const fontLinks = Array.from(fontFamilies)
    .map(font => {
      const subsets = font === 'Heebo' ? 'hebrew,latin' : 'latin';
      return `https://fonts.googleapis.com/css2?family=${font.replace(/ /g, '+')}:wght@400;500;600;700&subset=${subsets}&display=swap`;
    })
    .join(',');

  return (
    <>
      {/* Google Fonts */}
      {fontLinks && (
        // eslint-disable-next-line @next/next/no-page-custom-font
        <link rel="stylesheet" href={fontLinks} />
      )}

      {/* Global styles from theme */}
      <style>
        {`
          :root {
            --website-primary: ${theme?.colors?.primary || '#4F6EF7'};
            --website-secondary: ${theme?.colors?.secondary || '#6366F1'};
            --website-accent: ${theme?.colors?.accent || '#EC4899'};
            --website-background: ${theme?.colors?.background || '#FFFFFF'};
            --website-surface: ${theme?.colors?.surface || '#F9FAFB'};
            --website-text: ${theme?.colors?.text || '#111827'};
            --website-text-secondary: ${theme?.colors?.textSecondary || '#6B7280'};
            --website-border-radius: ${theme?.borderRadius || '0.5rem'};
            --website-font-heading: Heebo, ${theme?.fonts?.heading || 'Inter'}, sans-serif;
            --website-font-body: Heebo, ${theme?.fonts?.body || 'Inter'}, sans-serif;
          }

          body {
            background-color: var(--website-background);
            color: var(--website-text);
            font-family: var(--website-font-body);
          }

          h1, h2, h3, h4, h5, h6 {
            font-family: var(--website-font-heading);
          }

          @media (prefers-color-scheme: dark) {
            :root {
              --website-background: ${theme?.colors?.background || '#0F172A'};
              --website-surface: ${theme?.colors?.surface || '#1E293B'};
              --website-text: ${theme?.colors?.text || '#F9FAFB'};
              --website-text-secondary: ${theme?.colors?.textSecondary || '#94A3B8'};
            }
          }
        `}
      </style>

      <main
        dir={isRTL ? 'rtl' : 'ltr'}
        className="min-h-screen"
        style={{
          backgroundColor: 'var(--website-background)',
          color: 'var(--website-text)'
        }}
      >
        <WebsiteBlocks
          blocks={blocks}
          theme={theme}
          locale={locale}
          bookingUrl={`/site/${subdomain}/book`}
          subdomain={subdomain}
        />
      </main>
    </>
  );
}

// Coming Soon Component
function ComingSoonPage({ subdomain, locale }: { subdomain: string; locale: Locale }) {
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
    <main
      dir={locale === 'he' ? 'rtl' : 'ltr'}
      className="min-h-screen flex items-center justify-center bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900"
    >
      <div className="text-center px-4">
        {/* Animated Logo */}
        <div className="relative mb-8">
          <div className="w-24 h-24 mx-auto rounded-2xl bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center shadow-2xl animate-pulse">
            <span className="text-4xl">🚀</span>
          </div>
        </div>

        <h1 className="text-4xl sm:text-5xl font-bold text-white mb-4">
          {t.title}
        </h1>

        <p className="text-xl text-gray-300 mb-2">
          {t.subtitle}
        </p>

        <p className="text-gray-400 max-w-md mx-auto mb-8">
          {t.message}
        </p>

        {/* Subdomain badge */}
        <div className="inline-flex items-center gap-2 px-4 py-2 bg-white/10 backdrop-blur-sm rounded-full border border-white/20">
          <div className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
          <span className="text-gray-300 text-sm font-mono">
            {subdomain}.agentpilot.io
          </span>
        </div>
      </div>
    </main>
  );
}
