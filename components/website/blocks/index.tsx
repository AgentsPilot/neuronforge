'use client';

/**
 * Website Block Renderer Index
 * Central registry for all block types with i18n/RTL support
 *
 * CONTENT ARCHITECTURE:
 * - Templates define WHICH sections to show and their order
 * - Content is stored centrally in website_content table (per user)
 * - When useCentralContent=true, blocks fetch from central store
 * - This ensures content persists across template changes
 */

import { useState, useRef, useEffect } from 'react';
import type { Locale } from '@/lib/i18n/config';
import { getDirection } from '@/lib/i18n/config';
import type { BlockType, BlockStyles, PageTheme, FlowStep, SelectedServiceData, JourneyServiceFacts, BlockRendererProps } from './types';
import { normalizeClientFlow } from './types';

// Block Components
import { HeaderBlock } from './HeaderBlock';
import { HeroBlock } from './HeroBlock';
import { ServicesBlock } from './ServicesBlock';
import { CTABlock } from './CTABlock';
import { TestimonialsBlock } from './TestimonialsBlock';
import { ContactFormBlock } from './ContactFormBlock';
import { PricingBlock } from './PricingBlock';
import { FAQBlock } from './FAQBlock';
import { AboutBlock } from './AboutBlock';
import { FeaturesBlock } from './FeaturesBlock';
import { StatsBlock } from './StatsBlock';
import { BookingWidgetBlock } from './BookingWidgetBlock';
import { PaymentButtonBlock } from './PaymentButtonBlock';
import { TeamBlock } from './TeamBlock';
import { ProcessBlock } from './ProcessBlock';
import { GalleryBlock } from './GalleryBlock';
import { NewsletterBlock } from './NewsletterBlock';
import { LogoCloudBlock } from './LogoCloudBlock';
import { VideoBlock } from './VideoBlock';
import { FooterBlock } from './FooterBlock';
import { ProcessFlowSection } from './ProcessFlowSection';
import { BookingModal } from './BookingModal';

// Export all block components
export {
  HeaderBlock,
  HeroBlock,
  ServicesBlock,
  CTABlock,
  TestimonialsBlock,
  ContactFormBlock,
  PricingBlock,
  FAQBlock,
  AboutBlock,
  FeaturesBlock,
  StatsBlock,
  BookingWidgetBlock,
  PaymentButtonBlock,
  TeamBlock,
  ProcessBlock,
  ProcessFlowSection,
  GalleryBlock,
  NewsletterBlock,
  LogoCloudBlock,
  VideoBlock,
  FooterBlock
};

// Export types
export * from './types';

// Block registry
// Typed from the one contract every block already implements, rather than a
// transcription of it: the copy that used to live here had drifted, and a prop
// added to `BlockRendererProps` was rejected here for not existing.
import { templateRendererFor } from '@/components/website/templates/registry';

const BLOCK_REGISTRY: Record<BlockType, React.ComponentType<BlockRendererProps>> = {
  header: HeaderBlock,
  hero: HeroBlock,
  services: ServicesBlock,
  cta: CTABlock,
  testimonials: TestimonialsBlock,
  contact_form: ContactFormBlock,
  pricing: PricingBlock,
  faq: FAQBlock,
  about: AboutBlock,
  features: FeaturesBlock,
  stats: StatsBlock,
  booking_widget: BookingWidgetBlock,
  payment_button: PaymentButtonBlock,
  team: TeamBlock,
  process: ProcessBlock,
  process_flow: ProcessFlowSection,
  gallery: GalleryBlock,
  newsletter: NewsletterBlock,
  logo_cloud: LogoCloudBlock,
  video: VideoBlock,
  footer: FooterBlock
};

/**
 * Render a single block
 */
interface RenderBlockOptions {
  blockType: BlockType;
  content: Record<string, unknown>;
  styles?: BlockStyles;
  theme?: PageTheme;
  locale?: Locale;
  className?: string;
  /** Enable live data fetching for dynamic blocks like services, stats */
  useLiveData?: boolean;
  blockId?: string;
  pageId?: string;
  /** Client flow configuration */
  clientFlow?: FlowStep[];
  /** Booking page URL */
  bookingUrl?: string;
}

/**
 * Block data structure (as stored in DB)
 */
export interface BlockData {
  id: string;
  block_type: BlockType;
  content: Record<string, unknown>;
  styles?: BlockStyles;
  position: number;
  enabled: boolean;
}

/**
 * Render multiple blocks
 */
interface RenderBlocksOptions {
  blocks: BlockData[];
  theme?: PageTheme;
  locale?: Locale;
  /** Enable live data fetching for dynamic blocks (services, stats, etc.) */
  useLiveData?: boolean;
  pageId?: string;
  /** Client flow configuration - extracted from process block or passed directly */
  clientFlow?: FlowStep[];
  /** Booking page URL */
  bookingUrl?: string;
  /** Website subdomain - used for public API calls */
  subdomain?: string;
  /** Preview mode - enables in-page booking modal instead of navigation */
  isPreview?: boolean;
  /**
   * Whether a card can actually be charged right now.
   *
   * ─────────────────────────────────────────────────────────────────────────
   * A business can have decided in onboarding that clients pay online and still
   * not have connected Stripe — the connection asks for an ID and a bank
   * account, and it happens after setup. Until charges are enabled the payment
   * step has nothing behind it.
   *
   * The smart link has always passed this and correctly drops the step. The
   * website did not pass it at all, and `BookingModal` defaults an unanswered
   * question to "yes" — deliberately, so a caller that cannot answer does not
   * remove a step the business could honour. The website could answer and
   * simply never did, so a client on a published site reached a payment step
   * with no processor behind it.
   *
   * Left undefined, the old optimistic default still applies.
   */
  paymentsEnabled?: boolean;
}

export function WebsiteBlocks({
  blocks,
  theme,
  locale = 'en',
  useLiveData,
  pageId,
  clientFlow: explicitClientFlow,
  bookingUrl: explicitBookingUrl,
  subdomain,
  isPreview = false,
  paymentsEnabled
}: RenderBlocksOptions): React.ReactNode {
  const isRTL = getDirection(locale) === 'rtl';
  const [bookingModalOpen, setBookingModalOpen] = useState(false);
  const [selectedService, setSelectedService] = useState<SelectedServiceData | null>(null);

  /*
   * Where the button that opened the dialog sits on the page.
   *
   * ───────────────────────────────────────────────────────────────────────────
   * The dialog centres itself with `position: fixed`, which anchors to the
   * VIEWPORT. On a published page that is the browser window and is right. In
   * the editor's preview the page now renders inside an iframe sized to its own
   * full height — so the iframe's viewport IS the whole document, and "centre
   * of the viewport" became the middle of a page several thousand pixels tall.
   * Clicking "explore services" halfway down opened a dialog nowhere near it.
   *
   * Captured on the CAPTURE phase so it is recorded before the button's own
   * handler bubbles up and asks for the dialog. A ref rather than state: it
   * must not cause a render of its own, and it is only read at the moment the
   * dialog opens.
   */
  const triggerTopRef = useRef<number | null>(null);
  const [anchorTop, setAnchorTop] = useState<number | null>(null);

  useEffect(() => {
    if (!isPreview) return;

    const remember = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      const control = target?.closest('button, a');
      triggerTopRef.current = control
        ? control.getBoundingClientRect().top + window.scrollY
        : event.clientY + window.scrollY;
    };

    document.addEventListener('click', remember, true);
    return () => document.removeEventListener('click', remember, true);
  }, [isPreview]);

  // Sort by position and filter enabled
  const sortedBlocks = [...blocks]
    .filter(block => block.enabled !== false)
    .sort((a, b) => a.position - b.position);

  // Extract client flow from process block OR booking_widget/pricing/cta blocks (for landing pages)
  const processBlock = sortedBlocks.find(b => b.block_type === 'process');
  const bookingWidgetBlock = sortedBlocks.find(b => b.block_type === 'booking_widget');
  const pricingBlock = sortedBlocks.find(b => b.block_type === 'pricing');
  const ctaBlock = sortedBlocks.find(b => b.block_type === 'cta');
  // When services_only is true, hide booking buttons by returning undefined clientFlow
  const isServicesOnly = processBlock?.content?.services_only === true;
  // Landing pages store client_flow in booking_widget, pricing, or cta block; regular pages use process block
  // Apply normalizeClientFlow to expand legacy 'booking' to ['scheduling', 'client_info'] for backward compatibility
  const rawClientFlow = isServicesOnly
    ? undefined
    : explicitClientFlow
      || (processBlock?.content?.client_flow as FlowStep[] | undefined)
      || (bookingWidgetBlock?.content?.client_flow as FlowStep[] | undefined)
      || (pricingBlock?.content?.client_flow as FlowStep[] | undefined)
      || (ctaBlock?.content?.client_flow as FlowStep[] | undefined)
      || undefined;
  // Normalize the flow to expand legacy 'booking' step to ['scheduling', 'client_info']
  const clientFlow = rawClientFlow ? normalizeClientFlow(rawClientFlow) : undefined;
  // The services this page offers, as the two facts that decide each one's
  // journey. Read from the services block because that is where the page
  // stores its catalogue; a page written before these were carried simply has
  // none, and the blocks fall back to the stored client_flow.
  const servicesBlock = sortedBlocks.find(b => b.block_type === 'services');
  const journeyServices = ((servicesBlock?.content?.services as JourneyServiceFacts[] | undefined) || [])
    .filter(service => !service.hidden);

  // Booking URL must be explicitly provided or stored in process block
  // No default fallback - if not set, booking buttons won't show (handled by ServicesBlock)
  const bookingUrl = explicitBookingUrl || (processBlock?.content?.booking_url as string | undefined);

  /*
   * The one service this page is about, when it is about one.
   *
   * A landing page is built for a single service and its pricing block carries
   * that service's id, name, price, duration and journey — injected live on
   * every read. A website's pricing block carries several, and then there is no
   * single answer.
   *
   * Uses the `pricingBlock` already resolved above for the client flow.
   */
  const pageService: SelectedServiceData | null = (() => {
    const content = pricingBlock?.content as {
      serviceId?: string;
      serviceName?: string;
      currency?: string;
      durationMinutes?: number;
      plans?: Array<Record<string, unknown>>;
    } | undefined;

    const plans = content?.plans || [];
    if (plans.length !== 1) return null;

    const plan = plans[0];
    const id = (plan.serviceId as string) || content?.serviceId;
    if (!id) return null;

    return {
      id,
      name: (plan.serviceName as string) || content?.serviceName || (plan.name as string) || '',
      description: (plan.description as string) ?? null,
      duration_minutes: (plan.durationMinutes as number) || content?.durationMinutes || 60,
      price: (plan.priceRaw as number) ?? null,
      currency: (plan.currency as string) || content?.currency || 'USD',
      is_scheduled: plan.is_scheduled as boolean | null | undefined,
      collection: plan.collection as 'online' | 'invoice' | null | undefined,
      // The split travels with the service, so a page-level CTA opens the same
      // dialog — same terms — as the button on the pricing card.
      paymentPlan: plan.paymentPlan as SelectedServiceData['paymentPlan'],
    };
  })();

  /**
   * @param service The one the client picked, or null from a page-level CTA.
   *
   * A header or hero button on a WEBSITE is not about any particular service,
   * so the modal opens at its catalogue step and the client chooses there. On a
   * landing page it is — the whole page is about one service — and opening the
   * catalogue asked the client to pick from a list the page never mentioned,
   * while the button beside it in the pricing card opened straight onto the
   * service. Same button, same words, two different dialogs.
   */
  const handleOpenBooking = (service: SelectedServiceData | null) => {
    setSelectedService(service ?? pageService);
    setAnchorTop(triggerTopRef.current);
    setBookingModalOpen(true);
  };

  const handleCloseBooking = () => {
    setBookingModalOpen(false);
    setSelectedService(null);
  };

  // Map block types to anchor IDs for navigation
  const getAnchorId = (blockType: BlockType): string => {
    const anchorMap: Partial<Record<BlockType, string>> = {
      hero: 'hero',
      about: 'about',
      services: 'services',
      pricing: 'pricing',
      testimonials: 'testimonials',
      faq: 'faq',
      contact_form: 'contact',
      booking_widget: 'booking',
      process: 'process',
      team: 'team',
      features: 'features',
      gallery: 'gallery',
      cta: 'cta',
      stats: 'stats',
      footer: 'footer'
    };
    return anchorMap[blockType] || blockType.replace('_', '-');
  };

  return (
    <div dir={isRTL ? 'rtl' : 'ltr'}>
      {sortedBlocks.map((block) => {
        /*
         * The template draws the section if it has an opinion about it.
         *
         * A block owns its content and its behaviour; the template owns how
         * that looks. Where a template has a renderer for this section it wins
         * outright — a numbered row is not a restyled card, it is different
         * markup. Where it has none the block draws itself exactly as before,
         * which is what lets sections be converted one at a time.
         */
        const BlockComponent =
          templateRendererFor(theme, block.block_type) ?? BLOCK_REGISTRY[block.block_type];

        if (!BlockComponent) {
          // Using console.warn here is intentional for development debugging
          // eslint-disable-next-line no-console
          console.warn(`Unknown block type: ${block.block_type}`);
          return null;
        }

        // Get anchor ID for this block type (for menu navigation)
        const anchorId = getAnchorId(block.block_type);

        /*
         * ─────────────────────────────────────────────────────────────────────
         * THE HEADER IS FROZEN HERE, NOT IN THE STYLESHEET.
         *
         * `position: sticky` on `.apc-bar` itself does nothing at all, and the
         * reason is this wrapper: a sticky element can only travel within its
         * own parent's box, and every block gets a wrapper exactly as tall as
         * the block inside it. So the bar was pinned inside a container the
         * height of the bar — correct CSS, zero visible effect, which is why it
         * still scrolled away.
         *
         * Moving it to the wrapper gives it the full page to travel: the
         * wrapper's parent is the blocks container, so the bar stays put until
         * the page ends.
         *
         * Sticky and not fixed, still deliberately: the public surface declares
         * `container-type` for its container queries, which makes it the
         * containing block for anything fixed. A fixed bar would resolve
         * against that element — which scrolls with the page — so it would
         * scroll away too, and in the editor's preview frame it would sit
         * somewhere else entirely.
         *
         * Inline rather than a class because these wrappers are rendered in the
         * editor as well as on the published page, and only one of the two is
         * guaranteed to sit inside the scoped stylesheet.
         */
        const isHeader = block.block_type === 'header';

        return (
          /*
            `scroll-margin` so a jump from the menu does not land the section
            underneath the sticky header that sent it there. `scrollIntoView`
            honours it; the old `window.scrollTo` had to subtract 80px by hand,
            which only worked for the one header height it was written against.
          */
          <div
            key={block.id}
            id={anchorId}
            style={{
              scrollMarginBlockStart: '88px',
              /*
               * `top`, not `inset-block-start`.
               *
               * A sticky element with no RESOLVED offset never sticks — it is
               * not an error, it simply behaves as static, silently. The
               * logical property is the tidier spelling and is unsupported in
               * Safari before 14.1 and in several in-app browsers, so on those
               * the offset dropped and the bar scrolled away exactly as if this
               * code were not here. Stickiness is vertical and a page's writing
               * direction never flips top for bottom, so the physical property
               * costs nothing and is understood everywhere.
               */
              ...(isHeader
                ? { position: 'sticky' as const, top: 0, zIndex: 40 }
                : {}),
            }}
          >
            <BlockComponent
              content={block.content}
              styles={block.styles}
              theme={theme}
              locale={locale}
              isRTL={isRTL}
              useLiveData={useLiveData}
              blockId={block.id}
              pageId={pageId}
              clientFlow={clientFlow}
              journeyServices={journeyServices}
              bookingUrl={bookingUrl}
              subdomain={subdomain}
              isPreview={isPreview}
              onOpenBooking={handleOpenBooking}
            />
          </div>
        );
      })}

      {/* Booking Modal for preview mode */}
      {isPreview && (
        <BookingModal
          isOpen={bookingModalOpen}
          onClose={handleCloseBooking}
          theme={theme}
          locale={locale}
          isRTL={isRTL}
          clientFlow={clientFlow}
          pageId={pageId}
          subdomain={subdomain}
          initialService={selectedService}
          anchorTop={anchorTop}
          paymentsEnabled={paymentsEnabled}
        />
      )}
    </div>
  );
}

