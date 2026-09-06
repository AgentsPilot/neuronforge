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

import { useState } from 'react';
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
import { IntakeFormBlock } from './IntakeFormBlock';
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
  IntakeFormBlock,
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
const BLOCK_REGISTRY: Record<BlockType, React.ComponentType<BlockRendererProps>> = {
  header: HeaderBlock,
  hero: HeroBlock,
  services: ServicesBlock,
  cta: CTABlock,
  testimonials: TestimonialsBlock,
  contact_form: ContactFormBlock,
  intake_form: IntakeFormBlock,
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

// Block display names (for UI)
export const BLOCK_DISPLAY_NAMES: Record<BlockType, { en: string; es: string; he: string }> = {
  header: { en: 'Header', es: 'Encabezado', he: 'כותרת עליונה' },
  hero: { en: 'Hero', es: 'Héroe', he: 'כותרת ראשית' },
  services: { en: 'Services', es: 'Servicios', he: 'שירותים' },
  cta: { en: 'Call to Action', es: 'Llamada a la Acción', he: 'קריאה לפעולה' },
  testimonials: { en: 'Testimonials', es: 'Testimonios', he: 'המלצות' },
  contact_form: { en: 'Contact Form', es: 'Formulario de Contacto', he: 'טופס יצירת קשר' },
  intake_form: { en: 'Intake Form', es: 'Formulario de Admisión', he: 'טופס קליטה' },
  pricing: { en: 'Pricing', es: 'Precios', he: 'מחירון' },
  faq: { en: 'FAQ', es: 'Preguntas Frecuentes', he: 'שאלות נפוצות' },
  about: { en: 'About', es: 'Acerca de', he: 'אודות' },
  features: { en: 'Features', es: 'Características', he: 'תכונות' },
  stats: { en: 'Statistics', es: 'Estadísticas', he: 'סטטיסטיקות' },
  booking_widget: { en: 'Booking', es: 'Reservas', he: 'הזמנת תור' },
  payment_button: { en: 'Payment', es: 'Pago', he: 'תשלום' },
  team: { en: 'Team', es: 'Equipo', he: 'צוות' },
  process: { en: 'Process', es: 'Proceso', he: 'תהליך' },
  process_flow: { en: 'Booking Flow', es: 'Flujo de Reserva', he: 'תהליך הזמנה' },
  gallery: { en: 'Gallery', es: 'Galería', he: 'גלריה' },
  newsletter: { en: 'Newsletter', es: 'Boletín', he: 'ניוזלטר' },
  logo_cloud: { en: 'Logo Cloud', es: 'Logos', he: 'לוגואים' },
  video: { en: 'Video', es: 'Video', he: 'וידאו' },
  footer: { en: 'Footer', es: 'Pie de Página', he: 'כותרת תחתונה' }
};

// Block icons (for UI)
export const BLOCK_ICONS: Record<BlockType, string> = {
  header: '🧭',
  hero: '🎯',
  services: '📋',
  cta: '📢',
  testimonials: '💬',
  contact_form: '✉️',
  intake_form: '📝',
  pricing: '💰',
  faq: '❓',
  about: '👤',
  features: '✨',
  stats: '📊',
  booking_widget: '📅',
  payment_button: '💳',
  team: '👥',
  process: '🔄',
  process_flow: '🎯',
  gallery: '🖼️',
  newsletter: '📰',
  logo_cloud: '🏢',
  video: '🎬',
  footer: '📍'
};

/**
 * Get block display name in specified locale
 */
export function getBlockDisplayName(blockType: BlockType, locale: Locale): string {
  return BLOCK_DISPLAY_NAMES[blockType]?.[locale] || BLOCK_DISPLAY_NAMES[blockType]?.en || blockType;
}

/**
 * Check if a block type is valid
 */
export function isValidBlockType(type: string): type is BlockType {
  return type in BLOCK_REGISTRY;
}

/**
 * Get all available block types
 */
export function getAvailableBlockTypes(): BlockType[] {
  return Object.keys(BLOCK_REGISTRY) as BlockType[];
}

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

export function renderBlock({
  blockType,
  content,
  styles,
  theme,
  locale = 'en',
  className,
  useLiveData,
  blockId,
  pageId,
  clientFlow,
  bookingUrl
}: RenderBlockOptions): React.ReactNode {
  const BlockComponent = BLOCK_REGISTRY[blockType];

  if (!BlockComponent) {
    // Using console.warn here is intentional for development debugging
    // eslint-disable-next-line no-console
    console.warn(`Unknown block type: ${blockType}`);
    return null;
  }

  const isRTL = getDirection(locale) === 'rtl';

  return (
    <BlockComponent
      content={content}
      styles={styles}
      theme={theme}
      locale={locale}
      isRTL={isRTL}
      className={className}
      useLiveData={useLiveData}
      blockId={blockId}
      pageId={pageId}
      clientFlow={clientFlow}
      bookingUrl={bookingUrl}
    />
  );
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
  isPreview = false
}: RenderBlocksOptions): React.ReactNode {
  const isRTL = getDirection(locale) === 'rtl';
  const [bookingModalOpen, setBookingModalOpen] = useState(false);
  const [selectedService, setSelectedService] = useState<SelectedServiceData | null>(null);

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
        const BlockComponent = BLOCK_REGISTRY[block.block_type];

        if (!BlockComponent) {
          // Using console.warn here is intentional for development debugging
          // eslint-disable-next-line no-console
          console.warn(`Unknown block type: ${block.block_type}`);
          return null;
        }

        // Get anchor ID for this block type (for menu navigation)
        const anchorId = getAnchorId(block.block_type);

        return (
          <div key={block.id} id={anchorId}>
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
        />
      )}
    </div>
  );
}

/**
 * Default blocks for new pages (can be customized per template)
 */
export const DEFAULT_BLOCKS: Omit<BlockData, 'id'>[] = [
  {
    block_type: 'hero',
    position: 0,
    enabled: true,
    content: {
      headline: 'Welcome',
      subheadline: 'Your professional service provider',
      cta_text: 'Get Started',
      cta_link: '#contact'
    }
  },
  {
    block_type: 'services',
    position: 1,
    enabled: true,
    content: {
      title: 'Services',
      subtitle: 'How we can help you',
      services: [],
      layout: 'grid'
    }
  },
  {
    block_type: 'contact_form',
    position: 2,
    enabled: true,
    content: {
      title: 'Get in Touch',
      fields: [
        { name: 'name', type: 'text', label: 'Name', required: true },
        { name: 'email', type: 'email', label: 'Email', required: true },
        { name: 'message', type: 'textarea', label: 'Message', required: true }
      ]
    }
  }
];
