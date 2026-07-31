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
  | 'intake_form'
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
  | 'video';

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

/** Client flow steps - defines what happens when a client clicks on a service */
export type FlowStep = 'booking' | 'payment' | 'intake' | 'confirmation';

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
  /** Booking page URL */
  bookingUrl?: string;
  /** Website subdomain - used for public API calls */
  subdomain?: string;
  /** Preview mode - enables in-page booking modal instead of navigation */
  isPreview?: boolean;
  /** Callback when booking modal should open (preview mode) - receives selected service */
  onOpenBooking?: (service: SelectedServiceData) => void;
}

/** Service data passed when opening booking modal */
export interface SelectedServiceData {
  id: string;
  name: string;
  description: string | null;
  duration_minutes: number;
  price: number | null;
  currency: string;
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
