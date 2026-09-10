import type { ServicePaymentPlan } from '@/lib/business-os/servicePaymentPlan';
/**
 * Website Block Renderer Types
 * Shared types for all block renderers with i18n/RTL support
 */

import type { Locale } from '@/lib/i18n/config';

export type BlockType =
  | 'header'
  | 'hero'
  | 'cta'
  | 'services'
  | 'testimonials'
  | 'contact_form'
  | 'pricing'
  | 'faq'
  | 'about'
  | 'features'
  | 'stats'
  | 'booking_widget'
  | 'payment_button'
  | 'team'
  | 'process'
  | 'process_flow'
  | 'gallery'
  | 'newsletter'
  | 'logo_cloud'
  | 'video'
  | 'footer';

// Header menu item interface
export interface HeaderMenuItem {
  label: string;
  anchor: string;
  icon?: string;
}

export interface BlockStyles {
  padding?: string;
  background?: string;
  text_color?: string;
  alignment?: 'left' | 'center' | 'right';
  columns?: number;
  max_width?: string;
  button_color?: string;
  aspect_ratio?: string;
  layout?: string;
}

export interface PageTheme {
  colors: {
    primary: string;
    secondary: string;
    accent: string;
    background: string;
    surface: string;
    text: string;
    textSecondary: string;
  };
  fonts: {
    heading: string;
    body: string;
  };
  borderRadius: string;
  spacing: 'compact' | 'normal' | 'spacious';
}

/**
 * Client flow steps - defines what happens when a client clicks on a service
 *
 * New steps (recommended):
 * - 'scheduling' = Date/time slot selection (optional - not needed for courses/products)
 * - 'client_info' = Client information collection (name, email, phone)
 * - 'payment' = Payment processing
 * - 'intake' = Intake form
 * - 'confirmation' = Success confirmation
 *
 * Legacy step (deprecated, for backward compatibility):
 * - 'booking' = Maps to ['scheduling', 'client_info']
 */
export type FlowStep =
  | 'scheduling'
  | 'client_info'
  | 'booking'
  | 'request'
  | 'payment'
  | 'intake'
  | 'confirmation';

/**
 * Normalizes a client flow array by expanding legacy 'booking' step
 * into ['scheduling', 'client_info'] for backward compatibility.
 *
 * @param flow - The original flow steps array
 * @returns Normalized flow with 'booking' expanded to 'scheduling' + 'client_info'
 */
export function normalizeClientFlow(flow: FlowStep[]): FlowStep[] {
  return flow.flatMap(step =>
    step === 'booking' ? ['scheduling', 'client_info'] as FlowStep[] : [step]
  );
}

/**
 * Checks if the flow includes scheduling (date/time selection)
 * This is true if flow has 'scheduling' or legacy 'booking'
 */
export function flowHasScheduling(flow: FlowStep[]): boolean {
  return flow.includes('scheduling') || flow.includes('booking');
}

/**
 * Checks if the flow includes client info collection
 * This is true if flow has 'client_info', 'scheduling', or legacy 'booking'
 * (scheduling implies client info is needed)
 */
export function flowHasClientInfo(flow: FlowStep[]): boolean {
  return flow.includes('client_info') || flow.includes('scheduling') || flow.includes('booking');
}

/** What a public block needs to know to resolve a service's journey. */
export interface JourneyServiceFacts {
  name?: string;
  /** Does booking this involve picking a time? */
  is_scheduled?: boolean | null;
  /** How the money arrives, or null where the service is free. */
  collection?: 'online' | 'invoice' | null;
  /**
   * Bought outright, or quoted per job.
   *
   * `proposal` ends the journey at a request — there is no price to publish
   * and no card to take until the owner has quoted the work.
   */
  sale_mode?: 'direct' | 'proposal' | null;
  priceRaw?: number | null;
  hidden?: boolean;
}

export interface BlockRendererProps {
  content: Record<string, unknown>;
  styles?: BlockStyles;
  theme?: PageTheme;
  locale: Locale;
  isRTL: boolean;
  className?: string;
  /** When true, block fetches live data from API instead of using stored content */
  useLiveData?: boolean;
  /** Block ID for API calls */
  blockId?: string;
  /** Page ID for API calls */
  pageId?: string;
  /** Client flow configuration - steps that happen after clicking a service */
  clientFlow?: FlowStep[];
  /**
   * The services the page offers, reduced to the two facts that decide each
   * one's journey.
   *
   * The page used to narrate a single stored `client_flow` — one story for the
   * whole site — while the booking widget resolved the journey per service. A
   * business selling an appointment paid by card and an invoiced programme had
   * a page describing neither.
   */
  journeyServices?: JourneyServiceFacts[];
  /** Booking page URL */
  bookingUrl?: string;
  /** Website subdomain - used for public API calls */
  subdomain?: string;
  /** User code - used for standalone conversion pages (alternative to subdomain) */
  userCode?: string;
  /** Preview mode - enables in-page booking modal instead of navigation */
  isPreview?: boolean;
  /** Callback when booking modal should open (preview mode) - receives selected service */
  /**
   * Open the booking flow.
   *
   * `null` means no service chosen yet — a header or hero CTA is not about any
   * one service, so the modal opens at its catalogue step and the client picks.
   */
  onOpenBooking?: (service: SelectedServiceData | null) => void;
}

/** Service data passed when opening booking modal */
export interface SelectedServiceData {
  id: string;
  name: string;
  description: string | null;
  duration_minutes: number;
  price: number | null;
  currency: string;
  /**
   * The two facts that decide this service's journey.
   *
   * They were not here, so the booking modal could not know whether the thing
   * the client had just picked needed a time or took a card — it fell back to a
   * page-level flow and, failing that, to a hardcoded
   * ['scheduling','client_info','payment','confirmation']. The service CARD
   * beside it was already printing the correct journey from these same two
   * facts, so a client could read "no booking needed · pay by card" and then be
   * asked to choose an appointment slot.
   *
   * Optional because an older page's blocks do not carry them; the modal falls
   * back to the stored flow when they are absent.
   */
  is_scheduled?: boolean | null;
  collection?: 'online' | 'invoice' | null;
  /**
   * Bought outright, or quoted per job.
   *
   * The third of the same kind. `proposal` ends this client's journey at a
   * request: there is no price to charge and no date to agree until the owner
   * has quoted the work.
   */
  sale_mode?: 'direct' | 'proposal' | null;
  /**
   * How this service may be paid over time.
   *
   * Travels with the service for the same reason the two facts above do: the
   * payment step has to describe what the client is agreeing to, and a plan
   * that stops at the pricing card never reaches the modal that takes the card.
   */
  paymentPlan?: ServicePaymentPlan;
}

// Common service type
export interface ServiceItem {
  name: string;
  description: string;
  icon?: string;
  price?: string;
  duration?: string;
}

// Common testimonial type
export interface TestimonialItem {
  quote: string;
  author: string;
  role?: string;
  company?: string;
  image?: string;
  rating?: number;
}

// Common FAQ type
export interface FAQItem {
  question: string;
  answer: string;
}

// Common team member type
export interface TeamMemberItem {
  name: string;
  role: string;
  bio?: string;
  image?: string;
  social?: {
    linkedin?: string;
    twitter?: string;
    email?: string;
  };
}

// Common feature type
export interface FeatureItem {
  title: string;
  description: string;
  icon?: string;
}

// Common step/process type
export interface ProcessStep {
  number?: number;
  title: string;
  description: string;
  icon?: string;
  /** Link to capability in Business OS (e.g., '/business-os/crm') */
  capability_link?: string;
  /** Whether this step was auto-generated from user capabilities */
  auto_generated?: boolean;
}

// Common stat type
export interface StatItem {
  value: string;
  label: string;
  description?: string;
}

// Common pricing plan type
export interface PricingPlan {
  name: string;
  price: string;
  period?: string;
  description?: string;
  features: string[];
  popular?: boolean;
  cta_text: string;
  cta_link: string;
}

// Common gallery image type
export interface GalleryImage {
  url: string;
  alt: string;
  caption?: string;
}

// Common form field type
export interface FormField {
  name: string;
  type: 'text' | 'email' | 'tel' | 'textarea' | 'select' | 'checkbox' | 'radio' | 'date';
  label: string;
  placeholder?: string;
  required?: boolean;
  options?: string[];
}

// Capability config for integrated blocks
export interface CapabilityConfig {
  service_ids?: string[];
  price_id?: string;
  product_id?: string;
  calendar_id?: string;
  intake_form_id?: string;
}
