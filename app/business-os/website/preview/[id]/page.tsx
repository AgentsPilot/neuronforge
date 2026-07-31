'use client';

/**
 * Website Preview Page
 * Preview a website page without publishing
 * Accessible at /business-os/website/preview/[pageId]
 */

import { useState, useEffect } from 'react';
import { useRouter, useParams, useSearchParams } from 'next/navigation';
import { ArrowLeft, Monitor, Tablet, Smartphone, Loader2, Globe } from 'lucide-react';
import { createLogger } from '@/lib/logger';
import { WebsiteBlocks, type BlockData } from '@/components/website/blocks';
import type { PageTheme } from '@/components/website/blocks/types';
import type { Locale } from '@/lib/i18n/config';
import { getDirection } from '@/lib/i18n/config';

const logger = createLogger({ module: 'WebsitePreview' });

type DeviceMode = 'desktop' | 'tablet' | 'mobile';

const DEVICE_WIDTHS: Record<DeviceMode, string> = {
  desktop: '100%',
  tablet: '768px',
  mobile: '375px'
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

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-900 flex items-center justify-center">
        <div className="text-center space-y-4">
          <Loader2 className="w-12 h-12 text-blue-500 animate-spin mx-auto" />
          <p className="text-gray-400">Loading preview...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gray-900 flex items-center justify-center">
        <div className="text-center space-y-4">
          <div className="w-16 h-16 rounded-full bg-red-500/20 flex items-center justify-center mx-auto">
            <Globe className="w-8 h-8 text-red-500" />
          </div>
          <p className="text-red-400 text-lg">{error}</p>
          <button
            onClick={() => router.back()}
            className="px-4 py-2 text-gray-400 hover:text-white transition-colors"
          >
            Go Back
          </button>
        </div>
      </div>
    );
  }

  const theme = pageData?.theme || undefined;
  const locale = pageData?.website_language || 'en';
  const isRTL = getDirection(locale) === 'rtl';

  // Embedded mode: render only the content without toolbar/chrome
  if (isEmbedded) {
    return (
      <div className="min-h-full">
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
              --website-font-heading: ${theme?.fonts?.heading || 'Inter'}, sans-serif;
              --website-font-body: ${theme?.fonts?.body || 'Inter'}, sans-serif;
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
                <p>No blocks to display</p>
                <p className="text-sm">Add sections to your website to see them here</p>
              </div>
            </div>
          )}
        </main>
      </div>
    );
  }

  // Full preview mode with toolbar
  return (
    <div className="min-h-screen bg-gray-900 flex flex-col">
      {/* Preview Toolbar */}
      <div className="bg-gray-800 border-b border-gray-700 px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <button
            onClick={() => router.back()}
            className="p-2 text-gray-400 hover:text-white hover:bg-gray-700 rounded-lg transition-all"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div>
            <h1 className="text-white font-medium">{pageData?.title || 'Preview'}</h1>
            <p className="text-gray-500 text-sm">Preview Mode</p>
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
      <div className="flex-1 overflow-auto p-4 flex justify-center">
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
                --website-font-heading: ${theme?.fonts?.heading || 'Inter'}, sans-serif;
                --website-font-body: ${theme?.fonts?.body || 'Inter'}, sans-serif;
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
                  <p>No blocks to display</p>
                  <p className="text-sm">Add sections to your website to see them here</p>
                </div>
              </div>
            )}
          </main>
        </div>
      </div>
    </div>
  );
}
