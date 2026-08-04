'use client';

/**
 * Landing Page Preview (Embedded)
 * Renders landing page blocks from URL-encoded data or sessionStorage
 * Used by LandingPageWizard to show actual block preview
 */

import { useState, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { WebsiteBlocks, type BlockData } from '@/components/website/blocks';
import type { PageTheme } from '@/components/website/blocks/types';
import type { Locale } from '@/lib/i18n/config';
import { getDirection, isValidLocale, defaultLocale } from '@/lib/i18n/config';

// Translations for loading/error states
const LABELS = {
  en: {
    loadingPreview: 'Loading preview...',
    noPreviewData: 'No preview data',
    previewDataNotFound: 'Preview data not found',
    noDataKey: 'No preview data key provided',
    failedToLoad: 'Failed to load preview'
  },
  es: {
    loadingPreview: 'Cargando vista previa...',
    noPreviewData: 'Sin datos de vista previa',
    previewDataNotFound: 'Datos de vista previa no encontrados',
    noDataKey: 'No se proporcionó clave de datos de vista previa',
    failedToLoad: 'Error al cargar la vista previa'
  },
  he: {
    loadingPreview: 'טוען תצוגה מקדימה...',
    noPreviewData: 'אין נתוני תצוגה מקדימה',
    previewDataNotFound: 'נתוני תצוגה מקדימה לא נמצאו',
    noDataKey: 'לא סופק מפתח נתוני תצוגה מקדימה',
    failedToLoad: 'שגיאה בטעינת התצוגה המקדימה'
  }
};

interface PreviewData {
  blocks: BlockData[];
  theme: PageTheme;
  language: Locale;
  subdomain?: string;
}

export default function LandingPreviewPage() {
  const searchParams = useSearchParams();
  const [loading, setLoading] = useState(true);
  const [errorKey, setErrorKey] = useState<keyof typeof LABELS['en'] | null>(null);
  const [apiError, setApiError] = useState<string | null>(null);
  const [previewData, setPreviewData] = useState<PreviewData | null>(null);

  // Detect browser language for loading/error states
  // Initialize synchronously to avoid flash of English during loading
  const [browserLocale, setBrowserLocale] = useState<Locale>(() => {
    if (typeof window !== 'undefined') {
      const browserLang = navigator.language?.split('-')[0] || defaultLocale;
      return isValidLocale(browserLang) ? browserLang : defaultLocale;
    }
    return defaultLocale;
  });

  // Update browser locale after hydration if needed
  useEffect(() => {
    const browserLang = navigator.language?.split('-')[0] || defaultLocale;
    const detectedLocale = isValidLocale(browserLang) ? browserLang : defaultLocale;
    if (detectedLocale !== browserLocale) {
      setBrowserLocale(detectedLocale);
    }
  }, [browserLocale]);

  useEffect(() => {
    loadPreviewData();
  }, []);

  const loadPreviewData = async () => {
    try {
      setLoading(true);
      setErrorKey(null);
      setApiError(null);

      // Check for data key in URL - data is stored in sessionStorage
      const dataKey = searchParams.get('dataKey');
      if (!dataKey) {
        setErrorKey('noDataKey');
        return;
      }

      // Get data from sessionStorage
      const storedData = sessionStorage.getItem(dataKey);
      if (!storedData) {
        setErrorKey('previewDataNotFound');
        return;
      }

      const previewInput = JSON.parse(storedData);

      // Call API to get rendered blocks
      const response = await fetch('/api/website/landing-pages/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(previewInput)
      });

      const result = await response.json();

      if (!result.success) {
        setApiError(result.error);
        setErrorKey('failedToLoad');
        return;
      }

      setPreviewData({
        blocks: result.blocks,
        theme: result.theme,
        language: result.language || 'en',
        subdomain: result.subdomain
      });
    } catch (err) {
      console.error('Failed to load preview:', err);
      setErrorKey('failedToLoad');
    } finally {
      setLoading(false);
    }
  };

  // Use browser locale for loading/error states
  const loadingLabels = LABELS[browserLocale as keyof typeof LABELS] || LABELS.en;
  const loadingIsRTL = getDirection(browserLocale) === 'rtl';

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white" dir={loadingIsRTL ? 'rtl' : 'ltr'}>
        <div className="text-center space-y-3">
          <Loader2 className="w-8 h-8 animate-spin text-blue-500 mx-auto" />
          <p className="text-gray-500">{loadingLabels.loadingPreview}</p>
        </div>
      </div>
    );
  }

  if (errorKey || !previewData) {
    // Show translated error message, or API error, or fallback to noPreviewData
    const errorMessage = errorKey ? loadingLabels[errorKey] : (apiError || loadingLabels.noPreviewData);
    return (
      <div className="min-h-screen flex items-center justify-center bg-white" dir={loadingIsRTL ? 'rtl' : 'ltr'}>
        <p className="text-gray-500">{errorMessage}</p>
      </div>
    );
  }

  const { blocks, theme, language, subdomain } = previewData;
  const isRTL = getDirection(language) === 'rtl';

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
    });

  return (
    <div className="min-h-full">
      {/* Google Fonts */}
      {fontLinks.map((link, i) => (
        // eslint-disable-next-line @next/next/no-page-custom-font
        <link key={i} rel="stylesheet" href={link} />
      ))}

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
        <WebsiteBlocks
          blocks={blocks}
          theme={theme}
          locale={language}
          useLiveData={false}
          isPreview={true}
          subdomain={subdomain}
          bookingUrl={subdomain ? `/site/${subdomain}/book` : undefined}
        />
      </main>
    </div>
  );
}
