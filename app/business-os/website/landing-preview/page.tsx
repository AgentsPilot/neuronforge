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
import { getDirection } from '@/lib/i18n/config';

interface PreviewData {
  blocks: BlockData[];
  theme: PageTheme;
  language: Locale;
  subdomain?: string;
}

export default function LandingPreviewPage() {
  const searchParams = useSearchParams();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [previewData, setPreviewData] = useState<PreviewData | null>(null);

  useEffect(() => {
    loadPreviewData();
  }, []);

  const loadPreviewData = async () => {
    try {
      setLoading(true);
      setError(null);

      // Check for data key in URL - data is stored in sessionStorage
      const dataKey = searchParams.get('dataKey');
      if (!dataKey) {
        setError('No preview data key provided');
        return;
      }

      // Get data from sessionStorage
      const storedData = sessionStorage.getItem(dataKey);
      if (!storedData) {
        setError('Preview data not found');
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
        setError(result.error || 'Failed to load preview');
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
      setError('Failed to load preview');
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white">
        <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
      </div>
    );
  }

  if (error || !previewData) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white">
        <p className="text-gray-500">{error || 'No preview data'}</p>
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
