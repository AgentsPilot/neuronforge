/**
 * WebsiteContentRepository
 * Repository for website_content table
 *
 * This table stores central content for all website sections.
 * Templates define WHICH sections to show; this stores the CONTENT.
 * Content persists across template changes.
 */

import { SupabaseClient } from '@supabase/supabase-js';
import { createLogger } from '@/lib/logger';

const logger = createLogger({ service: 'WebsiteContentRepository' });

// Section content types
export interface HeroContent {
  headline: string;
  subheadline: string;
  cta_text: string;
  cta_url: string;
  background_image: string;
  alignment: 'left' | 'center' | 'right';
}

export interface AboutContent {
  title: string;
  about_text: string;
  image: string;
  mission: string;
  years_experience: number | null;
}

export interface ServiceItem {
  name: string;
  description: string;
  icon: string;
  price?: string;
  duration?: string;
  hidden?: boolean;
}

export interface ServicesContent {
  title: string;
  subtitle: string;
  layout: 'grid' | 'list' | 'cards';
  items: ServiceItem[];
}

export interface TestimonialItem {
  quote: string;
  author: string;
  role?: string;
  image?: string;
  rating?: number;
}

export interface TestimonialsContent {
  title: string;
  subtitle: string;
  items: TestimonialItem[];
}

export interface FAQItem {
  question: string;
  answer: string;
}

export interface FAQContent {
  title: string;
  subtitle: string;
  items: FAQItem[];
}

export interface TeamMember {
  name: string;
  role: string;
  bio: string;
  image?: string;
  social?: Record<string, string>;
}

export interface TeamContent {
  title: string;
  subtitle: string;
  members: TeamMember[];
}

export interface ContactContent {
  title: string;
  subtitle: string;
  email: string;
  phone: string;
  address: string;
  show_map: boolean;
}

export interface ProcessStep {
  title: string;
  description: string;
  icon?: string;
}

export interface ProcessContent {
  title: string;
  subtitle: string;
  steps: ProcessStep[];
}

export interface FeatureItem {
  title: string;
  description: string;
  icon?: string;
}

export interface FeaturesContent {
  title: string;
  subtitle: string;
  items: FeatureItem[];
}

export interface StatItem {
  value: string;
  label: string;
  icon?: string;
}

export interface StatsContent {
  items: StatItem[];
}

export interface PricingPlan {
  name: string;
  price: string;
  description: string;
  features: string[];
  cta_text: string;
  highlighted?: boolean;
}

export interface PricingContent {
  title: string;
  subtitle: string;
  plans: PricingPlan[];
}

export interface GalleryContent {
  title: string;
  images: string[];
}

export interface CTAContent {
  title: string;
  description: string;
  button_text: string;
  button_url: string;
}

export interface NewsletterContent {
  title: string;
  subtitle: string;
  placeholder: string;
}

export interface LogoCloudContent {
  title: string;
  logos: string[];
}

export interface VideoContent {
  title: string;
  video_url: string;
  thumbnail: string;
}

export interface BookingWidgetContent {
  title: string;
  subtitle: string;
  service_ids: string[];
}

export interface PaymentButtonContent {
  title: string;
  description: string;
  amount: number | null;
  currency: string;
}

export interface IntakeFormContent {
  title: string;
  subtitle: string;
  fields: Array<{
    name: string;
    type: string;
    label: string;
    required: boolean;
  }>;
}

// Full website content record
export interface WebsiteContent {
  id: string;
  user_id: string;
  hero: HeroContent;
  about: AboutContent;
  services: ServicesContent;
  testimonials: TestimonialsContent;
  faq: FAQContent;
  team: TeamContent;
  contact: ContactContent;
  process: ProcessContent;
  features: FeaturesContent;
  stats: StatsContent;
  pricing: PricingContent;
  gallery: GalleryContent;
  cta: CTAContent;
  newsletter: NewsletterContent;
  logo_cloud: LogoCloudContent;
  video: VideoContent;
  booking_widget: BookingWidgetContent;
  payment_button: PaymentButtonContent;
  intake_form: IntakeFormContent;
  created_at: string;
  updated_at: string;
}

// Section types for type-safe access
export type SectionType =
  | 'hero' | 'about' | 'services' | 'testimonials' | 'faq'
  | 'team' | 'contact' | 'process' | 'features' | 'stats'
  | 'pricing' | 'gallery' | 'cta' | 'newsletter' | 'logo_cloud'
  | 'video' | 'booking_widget' | 'payment_button' | 'intake_form';

export interface RepositoryResult<T> {
  data: T | null;
  error: Error | null;
}

export class WebsiteContentRepository {
  constructor(private supabase: SupabaseClient) {}

  /**
   * Get website content for a user (creates default if not exists)
   */
  async getOrCreate(userId: string): Promise<RepositoryResult<WebsiteContent>> {
    try {
      // Try to find existing
      const { data: existing, error: findError } = await this.supabase
        .from('website_content')
        .select('*')
        .eq('user_id', userId)
        .single();

      if (existing && !findError) {
        return { data: existing as WebsiteContent, error: null };
      }

      // Create new if not found
      if (findError?.code === 'PGRST116') {
        logger.info({ userId }, 'Creating new website content record');

        const { data: created, error: createError } = await this.supabase
          .from('website_content')
          .insert({ user_id: userId })
          .select()
          .single();

        if (createError) throw createError;
        return { data: created as WebsiteContent, error: null };
      }

      if (findError) throw findError;
      return { data: null, error: null };
    } catch (error) {
      logger.error({ err: error, userId }, 'Failed to get/create website content');
      return { data: null, error: error as Error };
    }
  }

  /**
   * Get website content for a user
   */
  async findByUserId(userId: string): Promise<RepositoryResult<WebsiteContent>> {
    try {
      const { data, error } = await this.supabase
        .from('website_content')
        .select('*')
        .eq('user_id', userId)
        .single();

      if (error) {
        if (error.code === 'PGRST116') {
          return { data: null, error: null };
        }
        throw error;
      }

      return { data: data as WebsiteContent, error: null };
    } catch (error) {
      logger.error({ err: error, userId }, 'Failed to find website content');
      return { data: null, error: error as Error };
    }
  }

  /**
   * Update a specific section's content
   */
  async updateSection<T extends SectionType>(
    userId: string,
    section: T,
    content: Partial<WebsiteContent[T]>
  ): Promise<RepositoryResult<WebsiteContent>> {
    try {
      // First get current content to merge
      const current = await this.findByUserId(userId);

      if (!current.data) {
        // Create new record if doesn't exist
        const createResult = await this.getOrCreate(userId);
        if (createResult.error || !createResult.data) {
          throw createResult.error || new Error('Failed to create content');
        }
      }

      // Merge with existing section content
      const existingSection = current.data?.[section] || {};
      const mergedContent = { ...existingSection, ...content };

      const { data, error } = await this.supabase
        .from('website_content')
        .update({ [section]: mergedContent })
        .eq('user_id', userId)
        .select()
        .single();

      if (error) throw error;

      logger.info({ userId, section }, 'Updated website section content');
      return { data: data as WebsiteContent, error: null };
    } catch (error) {
      logger.error({ err: error, userId, section }, 'Failed to update section');
      return { data: null, error: error as Error };
    }
  }

  /**
   * Replace a section's content entirely
   */
  async replaceSection<T extends SectionType>(
    userId: string,
    section: T,
    content: WebsiteContent[T]
  ): Promise<RepositoryResult<WebsiteContent>> {
    try {
      // Ensure record exists
      await this.getOrCreate(userId);

      const { data, error } = await this.supabase
        .from('website_content')
        .update({ [section]: content })
        .eq('user_id', userId)
        .select()
        .single();

      if (error) throw error;

      logger.info({ userId, section }, 'Replaced website section content');
      return { data: data as WebsiteContent, error: null };
    } catch (error) {
      logger.error({ err: error, userId, section }, 'Failed to replace section');
      return { data: null, error: error as Error };
    }
  }

  /**
   * Update multiple sections at once
   */
  async updateMultipleSections(
    userId: string,
    sections: Partial<Pick<WebsiteContent, SectionType>>
  ): Promise<RepositoryResult<WebsiteContent>> {
    try {
      // Ensure record exists
      await this.getOrCreate(userId);

      const { data, error } = await this.supabase
        .from('website_content')
        .update(sections)
        .eq('user_id', userId)
        .select()
        .single();

      if (error) throw error;

      logger.info({ userId, sections: Object.keys(sections) }, 'Updated multiple website sections');
      return { data: data as WebsiteContent, error: null };
    } catch (error) {
      logger.error({ err: error, userId }, 'Failed to update multiple sections');
      return { data: null, error: error as Error };
    }
  }

  /**
   * Get specific section content
   */
  async getSection<T extends SectionType>(
    userId: string,
    section: T
  ): Promise<RepositoryResult<WebsiteContent[T]>> {
    try {
      const { data, error } = await this.supabase
        .from('website_content')
        .select(section)
        .eq('user_id', userId)
        .single();

      if (error) {
        if (error.code === 'PGRST116') {
          return { data: null, error: null };
        }
        throw error;
      }

      return { data: data[section] as WebsiteContent[T], error: null };
    } catch (error) {
      logger.error({ err: error, userId, section }, 'Failed to get section');
      return { data: null, error: error as Error };
    }
  }

  /**
   * Sync services from Scheduling capability
   * Preserves hidden flags from existing services
   */
  async syncServicesFromScheduling(
    userId: string,
    schedulingServices: Array<{
      name: string;
      description: string;
      icon: string;
      price?: string;
      duration?: string;
    }>
  ): Promise<RepositoryResult<WebsiteContent>> {
    try {
      // Get current services to preserve hidden flags
      const current = await this.getSection(userId, 'services');
      const existingItems = current.data?.items || [];

      // Create map of existing items by name for hidden flag lookup
      const hiddenMap = new Map<string, boolean>();
      existingItems.forEach(item => {
        if (item.hidden !== undefined) {
          hiddenMap.set(item.name, item.hidden);
        }
      });

      // Merge with new services, preserving hidden flags
      const mergedItems: ServiceItem[] = schedulingServices.map(service => ({
        ...service,
        hidden: hiddenMap.get(service.name) ?? false
      }));

      return this.updateSection(userId, 'services', { items: mergedItems });
    } catch (error) {
      logger.error({ err: error, userId }, 'Failed to sync services');
      return { data: null, error: error as Error };
    }
  }
}
