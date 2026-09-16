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

import { useState, useEffect, useRef } from 'react';
import { useRouter, useParams, useSearchParams } from 'next/navigation';
import { ArrowLeft, Monitor, Tablet, Smartphone, Loader2, Globe } from 'lucide-react';
import { createLogger } from '@/lib/logger';
import { WebsiteBlocks, type BlockData } from '@/components/website/blocks';
import { PublicThemeStyle } from '@/components/public/PublicThemeStyle';
import { PublicFontLinks } from '@/components/public/PublicFontLinks';
import { DEFAULT_PUBLIC_THEME } from '@/lib/branding/theme';
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

  /*
   * An embedded preview that reports its own height.
   *
   * Opt-in rather than implied by `embedded`, because the setup wizard already
   * embeds this page in fixed-height iframes and must keep scrolling inside
   * them. Only the device-frame view below asks for auto-height.
   */
  const isAutoHeight = searchParams.get('autoheight') === '1';
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
   * Whether this business can actually take a card.
   *
   * The preview showed a payment step for a business with no Stripe connection,
   * because it never asked and `BookingModal` defaults an unanswered question
   * to "yes" — deliberately, so a caller that cannot answer does not remove a
   * step the business could honour. Both real booking pages DO resolve it and
   * drop the step; only the preview disagreed, which made it the one surface
   * showing a journey no client would ever walk.
   */
  const [paymentsEnabled, setPaymentsEnabled] = useState<boolean | undefined>(undefined);
  /*
   * The height the embedded document reported, for the device frame.
   *
   * A starting value rather than 0 so the frame has a sensible size during the
   * instant before the first message arrives, and so a preview still shows
   * something if the message never comes at all.
   */
  const [frameHeight, setFrameHeight] = useState(900);

  /*
   * The rendered page, for measuring.
   *
   * NOT `document.documentElement`: html is always at least the iframe's
   * viewport tall, so once the parent sized the frame to the reported height,
   * `scrollHeight` could never report anything smaller again. A one-way ratchet
   * — a page shorter than the frame kept the frame, and the difference showed
   * as dead space under the last section. This element wraps only the sections,
   * so it shrinks when they do.
   */
  const contentRef = useRef<HTMLDivElement>(null);

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

  /*
   * INSIDE the frame: tell the parent how tall this page is.
   *
   * The device frame is an iframe, so the parent cannot measure its content —
   * and the page above it scrolls in the document rather than in an inner box,
   * which means the frame has to BE the height of the page instead of scrolling
   * within a shorter one.
   *
   * A ResizeObserver rather than a one-shot measure on load: fonts land late,
   * images land later, and a hero that grows 200px after the webfont swaps
   * would otherwise leave the last section clipped.
   */
  useEffect(() => {
    if (!isAutoHeight || typeof window === 'undefined' || window.parent === window) return;

    const content = contentRef.current;
    if (!content) return;

    const report = () => {
      window.parent.postMessage(
        { type: 'ap-preview-height', height: content.getBoundingClientRect().height },
        window.location.origin
      );
    };

    report();
    const observer = new ResizeObserver(report);
    observer.observe(content);
    return () => observer.disconnect();
  }, [isAutoHeight, blocks, loading]);

  /*
   * OUTSIDE the frame: size the iframe to what it reported.
   *
   * The origin is checked because a preview renders a business's own copy and
   * this listener is live on a page inside the product; a message from anywhere
   * else has no business resizing anything.
   */
  useEffect(() => {
    if (isEmbedded) return;

    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      const data = event.data as { type?: string; height?: number } | null;
      if (data?.type !== 'ap-preview-height' || typeof data.height !== 'number') return;
      setFrameHeight(Math.max(320, Math.ceil(data.height)));
    };

    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [isEmbedded]);

  // Track preview view for analytics
  useEffect(() => {
    /*
     * Counted once, by whoever actually renders the page.
     *
     * The device-frame view now delegates to an embedded copy of this same
     * route, so both would fire and every preview would count as two. The
     * embedded copy is the one doing the rendering, so it is the one that
     * reports.
     */
    if (!isEmbedded) return;

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
  }, [pageId, isEmbedded]);

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

      setPaymentsEnabled(result.paymentsEnabled === true);

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

  /*
   * One theme for both the variables and the blocks. Passing the raw, possibly
   * undefined value to the blocks while the emitter got the default meant a
   * page without a stored theme showed a design in its colours and none in its
   * arrangement.
   */
  const pageTheme = pageData?.theme || DEFAULT_PUBLIC_THEME;

  // Embedded mode: render only the content without toolbar/chrome
  if (isEmbedded) {
    return (
      <div ref={contentRef} className={isAutoHeight ? undefined : 'min-h-full'}>
        {/* The same emitter the published site uses — this file carried TWO
            copies of it, one here and one in the toolbar view below. */}
        <PublicFontLinks theme={pageTheme} />
        <PublicThemeStyle theme={pageTheme} locale={locale} scope="[data-ap-site]" />
        {/*
          The document's own ground and its scrollbar.

          This set margins and no BACKGROUND, so every part of the frame the
          sections did not cover fell through to the browser default — a white
          band under the last block, which on a near-black template read as a
          section somebody had added. The theme paints `[data-ap-site]`, and
          `html`/`body` sit outside that scope, so they have to be told.

          The scrollbar goes only in auto-height mode, where the frame is already
          the height of its content and the canvas outside does the scrolling —
          a bar that can never move is just a second one to look at. Hidden by
          styling the scrollbar rather than by `overflow: hidden`, which would
          silently kill `position: sticky` for the site's own header. The
          wizard's fixed-height embeds scroll for real and keep theirs.
        */}
        <style>{[
          'html, body { margin: 0; padding: 0; background: ' + pageTheme.colors.background + '; }',
          /*
            No visible bar, in either mode.
            It used to be hidden only in auto-height embeds, where the frame
            could not scroll anyway. Now that the page scrolls inside the frame
            — which is what lets its header freeze — the bar would appear down
            the middle of the canvas, inside the device outline, where the
            published site does not have one. Hidden by styling the scrollbar
            rather than with `overflow: hidden`, which would silently kill the
            sticky header this arrangement exists to show.
          */
          'html { scrollbar-width: none; }',
          'html::-webkit-scrollbar { display: none; }',
        ].join('\n')}</style>

        <main
          data-ap-site=""
          dir={isRTL ? 'rtl' : 'ltr'}
          /*
            `100vh` inside an auto-height frame is circular: the frame is sized
            from the content, and the content would be sized from the frame. The
            wizard's fixed-height iframes still want the floor, so it stays for
            them and goes only where the height is being reported.
          */
          style={isAutoHeight ? undefined : { minHeight: '100vh' }}
        >
          {blocks.length > 0 ? (
            <WebsiteBlocks
              blocks={blocks}
              theme={pageTheme}
              locale={locale}
              useLiveData={true}
              pageId={pageId}
              bookingUrl={pageData?.subdomain ? `/site/${pageData.subdomain}/book` : undefined}
              subdomain={pageData?.subdomain || undefined}
              isPreview={true}
              paymentsEnabled={paymentsEnabled}
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
    /*
      Exactly one viewport tall, and it does not scroll — the canvas below does.

      `min-h-screen` sets a floor and no ceiling, so the shell grew to fit the
      page, `flex-1 overflow-auto` on the canvas had no height to be constrained
      to, and the DOCUMENT scrolled — carrying the toolbar off the top. Capping
      the shell at the viewport makes the canvas the only scroller, which is what
      keeps the bar in place while the page moves under it.
    */
    <div className="h-screen overflow-hidden bg-[var(--v2-bg,#f3f4f6)] flex flex-col">
      {/* Heebo is loaded by the root layout through `next/font`, so the toolbar
          needs no font link of its own. The preview frame below requests the
          template's faces through `PublicFontLinks`. */}
      {/* Preview Toolbar */}
      {/*
        The bar takes the page's direction, so `justify-between` mirrors on its
        own: the title and back control sit at the start edge and the device
        switcher at the end, in either language.

        It had no `dir` at all and patched one group with `flex-row-reverse`,
        which reverses that group's children while leaving the bar itself
        left-to-right — so on a Hebrew preview the title and the device buttons
        both ended up on the right with the back arrow adrift between them.
      */}
      <div
        dir={isRTL ? 'rtl' : 'ltr'}
        /*
          `shrink-0` so a tall canvas cannot squeeze the bar. It needs no
          `sticky`: its parent is capped at the viewport and does not scroll, so
          the bar has nowhere to scroll to.
        */
        className="shrink-0 bg-gray-800 border-b border-gray-700 px-4 py-3 flex items-center justify-between"
      >
        <div className="flex items-center gap-4">
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
      {/*
        The canvas is the toolbar's own grey, so the chrome reads as one surface
        and the page sits ON it rather than bleeding into it.

        It has been three things. Grey around a WHITE frame put a white border
        around a near-black template, so a dark page showed white on every side
        before its own background began. Painting the canvas in the page's own
        background fixed that and removed the edge entirely — with nothing to
        see, switching device widths changed nothing but the reflow. Taking the
        chrome's colour keeps both properties: never a white surround, and
        always a visible boundary, for a template of any colour.
      */}
      {/*
        The canvas no longer scrolls — the PAGE inside the frame does.

        It used to: the iframe was sized to its own reported content height and
        this container scrolled it as one tall image. That gives one scrollbar
        in a natural place, and it makes a frozen header impossible. A sticky
        element sticks to its nearest scrollport, and in an auto-height iframe
        the scrollport is the whole document — it never moves, so the header
        never pins. What the owner saw was a preview disagreeing with production
        about the one thing they were checking.

        `overflow-hidden` and a frame that fills the height put the scroll back
        inside the page, where production has it. The preview is then not an
        approximation of the published site's scrolling behaviour; it is the
        same behaviour.
      */}
      <div className="flex-1 overflow-hidden p-4 flex justify-center bg-gray-800">
        {/*
          ───────────────────────────────────────────────────────────────────────
          WHY THE DEVICE FRAME IS AN IFRAME

          It was a div sized to 375px in THIS document, and a media query
          measures the browser window, not a div. So on a wide screen every
          desktop breakpoint matched inside the phone frame: the contact section
          rendered its two columns at about 150px each, an email address broke
          one character to a line, and a phone number ran outside its own panel.

          The composition stylesheet was fixed by making the public surface a CSS
          container — but the blocks carry 268 Tailwind responsive prefixes
          (`sm:`, `lg:`), and those compile to media queries this page cannot
          reach. Rewriting all 268 would be a large, risky sweep that only holds
          until somebody types `md:` again.

          An iframe has its OWN viewport. At 375px wide, `lg:` stops matching,
          `100vw` is 375px, and a media query finally answers the question it is
          being asked — for every block at once, including ones not written yet.
          This is what makes the preview worth trusting: not an approximation of
          production, the same calculation.

          It renders this same route in `embedded` mode, which already exists for
          the setup wizard, so there is one preview renderer rather than two.
        */}
        <iframe
          key={deviceMode}
          /*
            No `autoheight`: the frame takes the canvas's height and the page
            scrolls within it, which is what lets the site's own header freeze.
          */
          src={`/website-preview/${pageId}?embedded=true&lang=${uiLocale}`}
          title={pageData?.title || labels.previewMode}
          className="shadow-2xl transition-all duration-300"
          style={{
            background: pageTheme.colors.background,
            width: DEVICE_WIDTHS[deviceMode],
            maxWidth: '100%',
            /*
              The frame is the height of the CANVAS, not of the page.
              The document inside it scrolls, exactly as the published site
              does, which is the only arrangement in which its header can
              freeze.
            */
            height: '100%',
            borderRadius: deviceMode !== 'desktop' ? '16px' : '0',
            /*
              The page bounds, drawn thin.

              A hairline rather than a colour taken from the template: it
              separates the page from the chrome, and the chrome is a constant,
              so this can be too — a light line reads against the grey behind it
              whether the page it outlines is white or near-black.
            */
            border: '1px solid rgba(255, 255, 255, 0.22)',
          }}
        />
      </div>
    </div>
  );
}
