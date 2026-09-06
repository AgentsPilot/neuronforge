'use client';

/**
 * Website Preview — /website-preview/[pageId]
 *
 * Preview a page without publishing it.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * DELIBERATELY OUTSIDE /business-os.
 *
 * This used to live at /business-os/website/preview/[id], which put it under
 * `app/business-os/layout.tsx` — and that layout renders the platform header
 * and tab bar around everything beneath it. The wizard shows this page in a
 * 320px iframe, so the Business OS header and tabs were rendered a SECOND time
 * inside the preview, on top of the site being previewed. `?embedded=true`
 * could not help: it strips this page's own toolbar, and a child route cannot
 * opt out of an ancestor layout in Next.
 *
 * Moved rather than wrapped in a route group, which would have meant relocating
 * all nine business-os pages into a `(chrome)` group for one route's benefit.
 *
 * Not served from `app/site/[subdomain]` either — that resolves published pages
 * by subdomain, and a draft in the wizard has neither.
 *
 * Access is unchanged: the data comes from
 * /api/website/pages/[id]/blocks-with-content, which authenticates and checks
 * ownership. Being outside the segment costs nothing there.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { useState, useEffect } from 'react';
import { useRouter, useParams, useSearchParams } from 'next/navigation';
import { ArrowLeft, Monitor, Tablet, Smartphone, Loader2, Globe } from 'lucide-react';
import { createLogger } from '@/lib/logger';
import { WebsiteBlocks, type BlockData } from '@/components/website/blocks';
import type { PageTheme } from '@/components/website/blocks/types';
import type { Locale } from '@/lib/i18n/config';
import { getDirection, isValidLocale, defaultLocale } from '@/lib/i18n/config';

const logger = createLogger({ module: 'WebsitePreview' });

type DeviceMode = 'desktop' | 'tablet' | 'mobile';

const DEVICE_WIDTHS: Record<DeviceMode, string> = {
  desktop: '100%',
  tablet: '768px',
  mobile: '375px'
};

// Translations for loading/error states
const LABELS = {
  en: {
    loadingPreview: 'Loading preview...',
    pageNotFound: 'Page not found',
    failedToLoad: 'Failed to load preview',
    goBack: 'Go Back',
    previewMode: 'Preview Mode',
    noBlocks: 'No blocks to display',
    addSections: 'Add sections to your website to see them here'
  },
  es: {
    loadingPreview: 'Cargando vista previa...',
    pageNotFound: 'Página no encontrada',
    failedToLoad: 'Error al cargar la vista previa',
    goBack: 'Volver',
    previewMode: 'Modo Vista Previa',
    noBlocks: 'No hay bloques para mostrar',
    addSections: 'Agrega secciones a tu sitio web para verlas aquí'
  },
  he: {
    loadingPreview: 'טוען תצוגה מקדימה...',
    pageNotFound: 'הדף לא נמצא',
    failedToLoad: 'שגיאה בטעינת התצוגה המקדימה',
    goBack: 'חזור',
    previewMode: 'מצב תצוגה מקדימה',
    noBlocks: 'אין בלוקים להצגה',
    addSections: 'הוסף מקטעים לאתר שלך כדי לראות אותם כאן'
  }
};

export default function WebsitePreviewPage() {
  const params = useParams<{ id: string }>();
  const searchParams = useSearchParams();
  const pageId = params.id;
  const isEmbedded = searchParams.get('embedded') === 'true';
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deviceMode, setDeviceMode] = useState<DeviceMode>('desktop');
  const [pageData, setPageData] = useState<{
    title: string;
    theme: PageTheme | null;
    subdomain: string | null;
    website_language: Locale;
  } | null>(null);
  const [blocks, setBlocks] = useState<BlockData[]>([]);

  /*
   * The platform's language, from `?lang=`.
   *
   * This was `useState` seeded from `window.location.search`, which does not
   * exist during the server render — so the first paint was always English and
   * only corrected after hydration. For a fast page that IS the whole visible
   * lifetime of the loading state, which is why "Loading preview..." stayed in
   * English for a Hebrew business.
   *
   * Derived from the search params instead, so the URL decides immediately and
   * the server and client agree. The browser's language is only a fallback for
   * a link that carried no `lang`, and it settles after mount because it cannot
   * be read on the server.
   */
  const langParam = searchParams.get('lang');
  const [browserLocale, setBrowserLocale] = useState<Locale>(defaultLocale);

  useEffect(() => {
    const browserLang = navigator.language?.split('-')[0];
    if (browserLang && isValidLocale(browserLang)) setBrowserLocale(browserLang);
  }, []);

  const uiLocale: Locale = langParam && isValidLocale(langParam) ? langParam : browserLocale;

  useEffect(() => {
    if (pageId) {
      fetchPreviewData();
    }
  }, [pageId]);

  // Track preview view for analytics
  useEffect(() => {
    if (pageId) {
      // Track view via dedicated tracking endpoint
      fetch('/api/website/analytics/track', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          page_id: pageId,
          source: 'preview'
        })
      }).catch(() => {/* ignore */});
    }
  }, [pageId]);

  const fetchPreviewData = async () => {
    try {
      setLoading(true);
      setError(null);

      // Fetch page with blocks and merged central content
      // This endpoint merges template content with central content and live services
      const response = await fetch(`/api/website/pages/${pageId}/blocks-with-content`);
      const result = await response.json();

      if (!result.success || !result.page) {
        setError('Page not found');
        return;
      }

      setPageData({
        title: result.page.title,
        theme: result.page.theme,
        subdomain: result.page.subdomain,
        website_language: result.page.website_language || 'en'
      });

      // Blocks with merged content are included in the response
      if (result.blocks) {
        // Only show enabled blocks, sorted by position
        const enabledBlocks = (result.blocks || [])
          .filter((b: BlockData & { enabled?: boolean }) => b.enabled !== false)
          .sort((a: BlockData, b: BlockData) => a.position - b.position);
        setBlocks(enabledBlocks);
      }
    } catch (err) {
      logger.error({ err }, 'Failed to fetch preview data');
      setError('Failed to load preview');
    } finally {
      setLoading(false);
    }
  };

  // Use page's language when loaded, otherwise fall back to UI locale (from URL param or browser)
  const locale = pageData?.website_language || uiLocale;
  const labels = LABELS[locale as keyof typeof LABELS] || LABELS.en;
  const isRTL = getDirection(locale) === 'rtl';

  if (loading) {
    // Use UI locale for loading state (pageData not yet available)
    const loadingLabels = LABELS[uiLocale as keyof typeof LABELS] || LABELS.en;
    const loadingIsRTL = getDirection(uiLocale) === 'rtl';
    return (
      // The dark full-height panel belongs to the standalone preview, where it
      // is the page. Inside the wizard's 320px iframe it is a black rectangle
      // flashing where the site is about to appear, so the embedded state stays
      // light and fills only the frame it was given.
      <div
        className={`flex items-center justify-center ${
          isEmbedded ? 'h-full min-h-[240px] bg-white' : 'min-h-screen bg-gray-900'
        }`}
        dir={loadingIsRTL ? 'rtl' : 'ltr'}
      >
        <div className="text-center space-y-4">
          <Loader2 className={`w-12 h-12 animate-spin mx-auto ${isEmbedded ? 'text-[#4F6EF7]' : 'text-blue-500'}`} />
          <p className={isEmbedded ? 'text-gray-500' : 'text-gray-400'}>{loadingLabels.loadingPreview}</p>
        </div>
      </div>
    );
  }

  if (error) {
    // Use UI locale for error state (pageData may not be available)
    const errorLabels = LABELS[uiLocale as keyof typeof LABELS] || LABELS.en;
    const errorIsRTL = getDirection(uiLocale) === 'rtl';
    return (
      <div
        className={`flex items-center justify-center ${
          isEmbedded ? 'h-full min-h-[240px] bg-white' : 'min-h-screen bg-gray-900'
        }`}
        dir={errorIsRTL ? 'rtl' : 'ltr'}
      >
        <div className="text-center space-y-4">
          <div className="w-16 h-16 rounded-full bg-red-500/20 flex items-center justify-center mx-auto">
            <Globe className="w-8 h-8 text-red-500" />
          </div>
          <p className="text-red-400 text-lg">{error === 'Page not found' ? errorLabels.pageNotFound : errorLabels.failedToLoad}</p>
          <button
            onClick={() => router.back()}
            className="px-4 py-2 text-gray-400 hover:text-white transition-colors"
          >
            {errorLabels.goBack}
          </button>
        </div>
      </div>
    );
  }

  const theme = pageData?.theme || undefined;

  // Heebo font link (platform standard)
  const heeboFontLink = 'https://fonts.googleapis.com/css2?family=Heebo:wght@400;500;600;700&subset=hebrew,latin&display=swap';

  // Embedded mode: render only the content without toolbar/chrome
  if (isEmbedded) {
    return (
      <div className="min-h-full">
        {/* Google Fonts - Heebo (platform standard) */}
        {/* eslint-disable-next-line @next/next/no-page-custom-font */}
        <link rel="stylesheet" href={heeboFontLink} />
        {/* Apply theme styles */}
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
              margin: 0;
              padding: 0;
            }
          `}
        </style>
        <main
          dir={isRTL ? 'rtl' : 'ltr'}
          style={{
            backgroundColor: 'var(--website-background)',
            color: 'var(--website-text)',
            fontFamily: 'var(--website-font-body)',
            minHeight: '100vh'
          }}
        >
          {blocks.length > 0 ? (
            <WebsiteBlocks
              blocks={blocks}
              theme={theme}
              locale={locale}
              useLiveData={true}
              pageId={pageId}
              bookingUrl={pageData?.subdomain ? `/site/${pageData.subdomain}/book` : undefined}
              subdomain={pageData?.subdomain || undefined}
              isPreview={true}
            />
          ) : (
            <div className="min-h-[400px] flex items-center justify-center text-gray-400">
              <div className="text-center">
                <Globe className="w-12 h-12 mx-auto mb-4 opacity-50" />
                <p>{labels.noBlocks}</p>
                <p className="text-sm">{labels.addSections}</p>
              </div>
            </div>
          )}
        </main>
      </div>
    );
  }

  // Full preview mode with toolbar
  return (
    // Light canvas, dark toolbar. The whole shell was gray-900, so a website —
    // which is a light document — sat in a black frame that read as part of the
    // design rather than as the tool around it.
    <div className="min-h-screen bg-[var(--v2-bg,#f3f4f6)] flex flex-col">
      {/* Google Fonts - Heebo (platform standard) */}
      {/* eslint-disable-next-line @next/next/no-page-custom-font */}
      <link rel="stylesheet" href={heeboFontLink} />
      {/* Preview Toolbar */}
      <div className="bg-gray-800 border-b border-gray-700 px-4 py-3 flex items-center justify-between">
        <div className={`flex items-center gap-4 ${isRTL ? 'flex-row-reverse' : ''}`}>
          <button
            onClick={() => router.back()}
            className="p-2 text-gray-400 hover:text-white hover:bg-gray-700 rounded-lg transition-all"
          >
            <ArrowLeft className={`w-5 h-5 ${isRTL ? 'rotate-180' : ''}`} />
          </button>
          <div>
            <h1 className="text-white font-medium">{pageData?.title || 'Preview'}</h1>
            <p className="text-gray-500 text-sm">{labels.previewMode}</p>
          </div>
        </div>

        {/* Device Toggle */}
        <div className="flex items-center gap-1 bg-gray-700 rounded-lg p-1">
          {[
            { mode: 'desktop' as DeviceMode, icon: Monitor, label: 'Desktop' },
            { mode: 'tablet' as DeviceMode, icon: Tablet, label: 'Tablet' },
            { mode: 'mobile' as DeviceMode, icon: Smartphone, label: 'Mobile' }
          ].map(({ mode, icon: Icon, label }) => (
            <button
              key={mode}
              onClick={() => setDeviceMode(mode)}
              className={`p-2 rounded-md transition-all ${
                deviceMode === mode
                  ? 'bg-blue-600 text-white'
                  : 'text-gray-400 hover:text-white'
              }`}
              title={label}
            >
              <Icon className="w-5 h-5" />
            </button>
          ))}
        </div>
      </div>

      {/* Preview Frame */}
      <div className="flex-1 overflow-auto p-4 flex justify-center bg-gray-100 dark:bg-gray-800">
        <div
          className="bg-white shadow-2xl transition-all duration-300 overflow-auto"
          style={{
            width: DEVICE_WIDTHS[deviceMode],
            maxWidth: '100%',
            minHeight: 'calc(100vh - 120px)',
            borderRadius: deviceMode !== 'desktop' ? '16px' : '0'
          }}
        >
          {/* Apply theme styles */}
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
            `}
          </style>

          <main
            dir={isRTL ? 'rtl' : 'ltr'}
            style={{
              backgroundColor: 'var(--website-background)',
              color: 'var(--website-text)',
              fontFamily: 'var(--website-font-body)'
            }}
          >
            {blocks.length > 0 ? (
              <WebsiteBlocks
                blocks={blocks}
                theme={theme}
                locale={locale}
                useLiveData={true}
                pageId={pageId}
                bookingUrl={pageData?.subdomain ? `/site/${pageData.subdomain}/book` : undefined}
                subdomain={pageData?.subdomain || undefined}
                isPreview={true}
              />
            ) : (
              <div className="min-h-[400px] flex items-center justify-center text-gray-400">
                <div className="text-center">
                  <Globe className="w-12 h-12 mx-auto mb-4 opacity-50" />
                  <p>{labels.noBlocks}</p>
                  <p className="text-sm">{labels.addSections}</p>
                </div>
              </div>
            )}
          </main>
        </div>
      </div>
    </div>
  );
}
