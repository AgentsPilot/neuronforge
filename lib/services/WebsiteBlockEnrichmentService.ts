/**
 * WebsiteBlockEnrichmentService
 * Enriches website blocks with real business data from user's profile,
 * services, contacts, bookings, etc.
 *
 * Used when:
 * 1. Applying a template to create blocks with real data
 * 2. Manual "Sync with Business Data" action
 */

import { createLogger } from '@/lib/logger';
import { SupabaseClient } from '@supabase/supabase-js';
import { SchedulingServiceRepository, SchedulingService } from '@/lib/repositories/SchedulingRepository';
import { CRMContactRepository } from '@/lib/repositories/CRMContactRepository';
import { BusinessProfileRepository } from '@/lib/repositories/BusinessProfileRepository';
import { UserCapabilityRepository } from '@/lib/repositories/UserCapabilityRepository';
import { websiteAIContentService, type WebsiteLanguage } from './WebsiteAIContentService';

const logger = createLogger({ service: 'WebsiteBlockEnrichmentService' });

// Block content types
export interface ServiceBlockContent {
  title?: string;
  subtitle?: string;
  services: Array<{
    name: string;
    description: string;
    icon?: string;
    price?: string;
    duration?: string;
  }>;
}

export interface AboutBlockContent {
  title?: string;
  about_text?: string;
  image?: string;
  features?: Array<{
    title: string;
    description: string;
    icon?: string;
  }>;
}

export interface StatsBlockContent {
  title?: string;
  subtitle?: string;
  stats: Array<{
    value: string;
    label: string;
    description?: string;
  }>;
}

export interface TestimonialsBlockContent {
  title?: string;
  subtitle?: string;
  testimonials: Array<{
    quote: string;
    author: string;
    role?: string;
    company?: string;
    image?: string;
    rating?: number;
  }>;
}

export interface HeroBlockContent {
  headline?: string;
  subheadline?: string;
  cta_text?: string;
  cta_link?: string;
  image?: string;
}

export interface ContactFormBlockContent {
  title?: string;
  subtitle?: string;
  fields?: Array<{
    name: string;
    type: string;
    label: string;
    required?: boolean;
  }>;
  submit_text?: string;
  // Business contact info for sidebar
  business_email?: string;
  business_phone?: string;
  business_address?: string;
  business_hours?: string;
}

export interface PricingBlockContent {
  title?: string;
  subtitle?: string;
  plans: Array<{
    name: string;
    price: string;
    period?: string;
    description?: string;
    features: string[];
    popular?: boolean;
    cta_text: string;
    cta_link: string;
  }>;
}

export interface ProcessBlockContent {
  title?: string;
  subtitle?: string;
  steps: Array<{
    title: string;
    description: string;
    icon?: string;
    number?: number;
    capability_key?: string;
    capability_link?: string;
    auto_generated?: boolean;
  }>;
  layout?: 'numbered' | 'timeline' | 'horizontal' | 'cards';
}

export interface EnrichmentResult<T> {
  content: T;
  enriched: boolean;
  source: 'database' | 'template' | 'generated' | 'ai';
  enrichedFields: string[];
}

export class WebsiteBlockEnrichmentService {
  private supabase: SupabaseClient;
  private serviceRepo: SchedulingServiceRepository;
  private contactRepo: CRMContactRepository;
  private profileRepo: BusinessProfileRepository;
  private capabilityRepo: UserCapabilityRepository;

  constructor(supabaseClient: SupabaseClient) {
    this.supabase = supabaseClient;
    this.serviceRepo = new SchedulingServiceRepository(supabaseClient);
    this.contactRepo = new CRMContactRepository(supabaseClient);
    this.profileRepo = new BusinessProfileRepository();
    this.capabilityRepo = new UserCapabilityRepository();
  }

  /**
   * Enrich a single block based on its type
   * @param userId - User ID
   * @param blockType - Block type (e.g., 'services', 'hero', 'process')
   * @param templateContent - Existing content to enrich
   * @param language - Target language for AI-generated content
   * @param useAI - Whether to use AI for content generation (default: false for backwards compatibility)
   * @param userEmail - Optional user email address for contact info enrichment
   */
  async enrichBlock(
    userId: string,
    blockType: string,
    templateContent: Record<string, unknown>,
    language: WebsiteLanguage = 'en',
    useAI: boolean = false,
    userEmail?: string
  ): Promise<EnrichmentResult<Record<string, unknown>>> {
    logger.info({ userId, blockType, language, useAI }, 'Enriching block');

    switch (blockType) {
      case 'services':
        return this.enrichServicesBlock(userId, templateContent as ServiceBlockContent, language);
      case 'about':
        return useAI
          ? this.enrichAboutBlockWithAI(userId, templateContent as AboutBlockContent, language)
          : this.enrichAboutBlock(userId, templateContent as AboutBlockContent, language);
      case 'stats':
        return this.enrichStatsBlock(userId, templateContent as StatsBlockContent, language);
      case 'hero':
        return useAI
          ? this.enrichHeroBlockWithAI(userId, templateContent as HeroBlockContent, language)
          : this.enrichHeroBlock(userId, templateContent as HeroBlockContent, language);
      case 'pricing':
        return this.enrichPricingBlock(userId, templateContent as PricingBlockContent, language);
      case 'contact_form':
        return this.enrichContactFormBlock(userId, templateContent as ContactFormBlockContent, language, userEmail);
      case 'process':
        return this.enrichProcessBlock(userId, templateContent as ProcessBlockContent, language);
      case 'faq':
        return useAI
          ? this.enrichFAQBlockWithAI(userId, templateContent, language)
          : { content: templateContent, enriched: false, source: 'template', enrichedFields: [] };
      case 'features':
        return useAI
          ? this.enrichFeaturesBlockWithAI(userId, templateContent, language)
          : { content: templateContent, enriched: false, source: 'template', enrichedFields: [] };
      default:
        // For blocks without enrichment, return template content as-is
        return {
          content: templateContent,
          enriched: false,
          source: 'template',
          enrichedFields: []
        };
    }
  }

  /**
   * Enrich multiple blocks
   * @param userId - User ID
   * @param blocks - Array of blocks to enrich
   * @param language - Target language for AI-generated content
   * @param useAI - Whether to use AI for content generation
   * @param userEmail - Optional user email address for contact info enrichment
   */
  async enrichBlocks(
    userId: string,
    blocks: Array<{ block_type: string; content: Record<string, unknown>; position: number }>,
    language: WebsiteLanguage = 'en',
    useAI: boolean = false,
    userEmail?: string
  ): Promise<Array<{ block_type: string; content: Record<string, unknown>; position: number; enriched: boolean }>> {
    const enrichedBlocks = await Promise.all(
      blocks.map(async (block) => {
        const result = await this.enrichBlock(userId, block.block_type, block.content, language, useAI, userEmail);
        return {
          ...block,
          content: result.content,
          enriched: result.enriched
        };
      })
    );

    const enrichedCount = enrichedBlocks.filter(b => b.enriched).length;
    logger.info({ userId, totalBlocks: blocks.length, enrichedCount, language, useAI }, 'Blocks enrichment complete');

    return enrichedBlocks;
  }

  /**
   * Enrich Services block with real services from scheduling_services
   */
  private async enrichServicesBlock(
    userId: string,
    templateContent: ServiceBlockContent,
    language: WebsiteLanguage = 'en'
  ): Promise<EnrichmentResult<ServiceBlockContent>> {
    try {
      const servicesResult = await this.serviceRepo.listAll(userId, true); // activeOnly = true

      if (!servicesResult.data || servicesResult.data.length === 0) {
        logger.debug({ userId }, 'No services found, using template content');
        return {
          content: templateContent,
          enriched: false,
          source: 'template',
          enrichedFields: []
        };
      }

      // Map real services to block format using Lucide icon names
      const services = servicesResult.data.map((service: SchedulingService) => ({
        name: service.service_name,
        description: service.description || '',
        icon: websiteAIContentService.getServiceIcon(service.service_name),
        price: service.price ? this.formatPrice(service.price, service.currency) : undefined,
        duration: service.duration_minutes ? this.formatDuration(service.duration_minutes, language) : undefined
      }));

      // Localized titles
      const titles: Record<WebsiteLanguage, string> = {
        en: 'Our Services',
        es: 'Nuestros Servicios',
        he: 'השירותים שלנו'
      };

      const subtitles: Record<WebsiteLanguage, string> = {
        en: 'Discover how we can help you',
        es: 'Descubre cómo podemos ayudarte',
        he: 'גלה כיצד נוכל לעזור לך'
      };

      logger.info({ userId, serviceCount: services.length }, 'Services block enriched');

      return {
        content: {
          ...templateContent,
          title: templateContent.title || titles[language],
          subtitle: templateContent.subtitle || subtitles[language],
          services
        },
        enriched: true,
        source: 'database',
        enrichedFields: ['services', 'title', 'subtitle']
      };
    } catch (error) {
      logger.error({ err: error, userId }, 'Failed to enrich services block');
      return {
        content: templateContent,
        enriched: false,
        source: 'template',
        enrichedFields: []
      };
    }
  }

  /**
   * Format duration with language support
   */
  private formatDuration(minutes: number, language: WebsiteLanguage): string {
    const formats: Record<WebsiteLanguage, string> = {
      en: `${minutes} min`,
      es: `${minutes} min`,
      he: `${minutes} דק׳`
    };
    return formats[language];
  }

  /**
   * Enrich About block with business profile data (database only, no AI)
   */
  private async enrichAboutBlock(
    userId: string,
    templateContent: AboutBlockContent,
    language: WebsiteLanguage = 'en'
  ): Promise<EnrichmentResult<AboutBlockContent>> {
    try {
      const profileResult = await this.profileRepo.findByUserId(userId);

      if (!profileResult.data) {
        return {
          content: templateContent,
          enriched: false,
          source: 'template',
          enrichedFields: []
        };
      }

      const profile = profileResult.data;
      const enrichedFields: string[] = [];
      const content = { ...templateContent };

      // Localized about titles
      const aboutTitles: Record<WebsiteLanguage, (name: string) => string> = {
        en: (name) => `About ${name}`,
        es: (name) => `Sobre ${name}`,
        he: (name) => `אודות ${name}`
      };

      // Use company name in title if available
      if (profile.company_name && !content.title) {
        content.title = aboutTitles[language](profile.company_name);
        enrichedFields.push('title');
      }

      // Use description if available
      if ((profile as any).description && !content.about_text) {
        content.about_text = (profile as any).description;
        enrichedFields.push('about_text');
      }

      logger.info({ userId, enrichedFields }, 'About block enriched');

      return {
        content,
        enriched: enrichedFields.length > 0,
        source: enrichedFields.length > 0 ? 'database' : 'template',
        enrichedFields
      };
    } catch (error) {
      logger.error({ err: error, userId }, 'Failed to enrich about block');
      return {
        content: templateContent,
        enriched: false,
        source: 'template',
        enrichedFields: []
      };
    }
  }

  /**
   * Enrich About block with AI-generated content
   */
  private async enrichAboutBlockWithAI(
    userId: string,
    templateContent: AboutBlockContent,
    language: WebsiteLanguage
  ): Promise<EnrichmentResult<AboutBlockContent>> {
    try {
      const profileResult = await this.profileRepo.findByUserId(userId);

      if (!profileResult.data) {
        return {
          content: templateContent,
          enriched: false,
          source: 'template',
          enrichedFields: []
        };
      }

      const generatedContent = await websiteAIContentService.generateBlockContent({
        blockType: 'about',
        targetLanguage: language,
        businessProfile: {
          company_name: profileResult.data.company_name,
          vertical: profileResult.data.vertical,
          sub_vertical: profileResult.data.sub_vertical,
          website_url: profileResult.data.website_url,
          website_analysis: profileResult.data.website_analysis
        },
        existingContent: templateContent
      });

      return {
        content: { ...templateContent, ...generatedContent } as AboutBlockContent,
        enriched: true,
        source: 'ai',
        enrichedFields: Object.keys(generatedContent)
      };
    } catch (error) {
      logger.error({ err: error, userId }, 'Failed to enrich about block with AI');
      return this.enrichAboutBlock(userId, templateContent, language);
    }
  }

  /**
   * Enrich Stats block with real data from bookings/contacts
   */
  private async enrichStatsBlock(
    userId: string,
    templateContent: StatsBlockContent,
    language: WebsiteLanguage = 'en'
  ): Promise<EnrichmentResult<StatsBlockContent>> {
    try {
      // Get client count
      const contactsResult = await this.contactRepo.count(userId, { stage: 'client' });
      const clientCount = contactsResult.data || 0;

      // Get total bookings count
      const { count: bookingsCount, error: bookingsError } = await this.supabase
        .from('scheduling_bookings')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', userId)
        .eq('status', 'completed');

      if (bookingsError) {
        throw bookingsError;
      }

      // Only enrich if we have real data
      if (clientCount === 0 && (bookingsCount || 0) === 0) {
        return {
          content: templateContent,
          enriched: false,
          source: 'template',
          enrichedFields: []
        };
      }

      // Localized stat labels
      const clientLabels: Record<WebsiteLanguage, { label: string; description: string }> = {
        en: { label: 'Happy Clients', description: 'Satisfied customers' },
        es: { label: 'Clientes Felices', description: 'Clientes satisfechos' },
        he: { label: 'לקוחות מרוצים', description: 'לקוחות מרוצים' }
      };

      const sessionLabels: Record<WebsiteLanguage, { label: string; description: string }> = {
        en: { label: 'Sessions Completed', description: 'Successful appointments' },
        es: { label: 'Sesiones Completadas', description: 'Citas exitosas' },
        he: { label: 'פגישות שהושלמו', description: 'פגישות מוצלחות' }
      };

      const titles: Record<WebsiteLanguage, string> = {
        en: 'Our Impact',
        es: 'Nuestro Impacto',
        he: 'ההשפעה שלנו'
      };

      // Build stats array with real data
      const stats: StatsBlockContent['stats'] = [];

      if (clientCount > 0) {
        stats.push({
          value: clientCount.toString() + '+',
          label: clientLabels[language].label,
          description: clientLabels[language].description
        });
      }

      if ((bookingsCount || 0) > 0) {
        stats.push({
          value: (bookingsCount || 0).toString() + '+',
          label: sessionLabels[language].label,
          description: sessionLabels[language].description
        });
      }

      // Keep any additional template stats that aren't client/booking related
      const templateStats = templateContent.stats || [];
      for (const stat of templateStats) {
        const isClientStat = stat.label.toLowerCase().includes('client') || stat.label.includes('לקוח');
        const isBookingStat = stat.label.toLowerCase().includes('session') || stat.label.toLowerCase().includes('booking') || stat.label.includes('פגיש');
        if (!isClientStat && !isBookingStat) {
          stats.push(stat);
        }
      }

      logger.info({ userId, statsCount: stats.length, clientCount, bookingsCount }, 'Stats block enriched');

      return {
        content: {
          ...templateContent,
          title: templateContent.title || titles[language],
          stats
        },
        enriched: true,
        source: 'database',
        enrichedFields: ['stats', 'title']
      };
    } catch (error) {
      logger.error({ err: error, userId }, 'Failed to enrich stats block');
      return {
        content: templateContent,
        enriched: false,
        source: 'template',
        enrichedFields: []
      };
    }
  }

  /**
   * Enrich Hero block with business profile data (database only, no AI)
   */
  private async enrichHeroBlock(
    userId: string,
    templateContent: HeroBlockContent,
    language: WebsiteLanguage = 'en'
  ): Promise<EnrichmentResult<HeroBlockContent>> {
    try {
      const profileResult = await this.profileRepo.findByUserId(userId);

      if (!profileResult.data) {
        return {
          content: templateContent,
          enriched: false,
          source: 'template',
          enrichedFields: []
        };
      }

      const profile = profileResult.data;
      const enrichedFields: string[] = [];
      const content = { ...templateContent };

      // Localized welcome messages
      const welcomeMessages: Record<WebsiteLanguage, (name: string) => string> = {
        en: (name) => `Welcome to ${name}`,
        es: (name) => `Bienvenido a ${name}`,
        he: (name) => `ברוכים הבאים ל${name}`
      };

      // Use company name in headline if available
      if (profile.company_name && (!content.headline || content.headline.includes('Welcome') || content.headline.includes('ברוכים'))) {
        content.headline = welcomeMessages[language](profile.company_name);
        enrichedFields.push('headline');
      }

      logger.info({ userId, enrichedFields }, 'Hero block enriched');

      return {
        content,
        enriched: enrichedFields.length > 0,
        source: enrichedFields.length > 0 ? 'database' : 'template',
        enrichedFields
      };
    } catch (error) {
      logger.error({ err: error, userId }, 'Failed to enrich hero block');
      return {
        content: templateContent,
        enriched: false,
        source: 'template',
        enrichedFields: []
      };
    }
  }

  /**
   * Enrich Hero block with AI-generated content
   */
  private async enrichHeroBlockWithAI(
    userId: string,
    templateContent: HeroBlockContent,
    language: WebsiteLanguage
  ): Promise<EnrichmentResult<HeroBlockContent>> {
    try {
      const profileResult = await this.profileRepo.findByUserId(userId);

      if (!profileResult.data) {
        return {
          content: templateContent,
          enriched: false,
          source: 'template',
          enrichedFields: []
        };
      }

      const generatedContent = await websiteAIContentService.generateBlockContent({
        blockType: 'hero',
        targetLanguage: language,
        businessProfile: {
          company_name: profileResult.data.company_name,
          vertical: profileResult.data.vertical,
          sub_vertical: profileResult.data.sub_vertical,
          website_url: profileResult.data.website_url,
          website_analysis: profileResult.data.website_analysis
        },
        existingContent: templateContent
      });

      return {
        content: { ...templateContent, ...generatedContent } as HeroBlockContent,
        enriched: true,
        source: 'ai',
        enrichedFields: Object.keys(generatedContent)
      };
    } catch (error) {
      logger.error({ err: error, userId }, 'Failed to enrich hero block with AI');
      return this.enrichHeroBlock(userId, templateContent, language);
    }
  }

  /**
   * Enrich Pricing block with real services that have prices
   */
  private async enrichPricingBlock(
    userId: string,
    templateContent: PricingBlockContent,
    language: WebsiteLanguage = 'en'
  ): Promise<EnrichmentResult<PricingBlockContent>> {
    try {
      const servicesResult = await this.serviceRepo.listAll(userId, true);

      if (!servicesResult.data || servicesResult.data.length === 0) {
        return {
          content: templateContent,
          enriched: false,
          source: 'template',
          enrichedFields: []
        };
      }

      // Only include services with prices
      const pricedServices = servicesResult.data.filter(s => s.price && s.price > 0);

      if (pricedServices.length === 0) {
        return {
          content: templateContent,
          enriched: false,
          source: 'template',
          enrichedFields: []
        };
      }

      // Localized labels
      const ctaTexts: Record<WebsiteLanguage, string> = {
        en: 'Book Now',
        es: 'Reservar',
        he: 'הזמן עכשיו'
      };

      const sessionTexts: Record<WebsiteLanguage, (min: number) => string> = {
        en: (min) => `${min} min session`,
        es: (min) => `Sesión de ${min} min`,
        he: (min) => `פגישה של ${min} דק׳`
      };

      const titles: Record<WebsiteLanguage, string> = {
        en: 'Pricing',
        es: 'Precios',
        he: 'מחירים'
      };

      const subtitles: Record<WebsiteLanguage, string> = {
        en: 'Transparent pricing for all our services',
        es: 'Precios transparentes para todos nuestros servicios',
        he: 'מחירים שקופים לכל השירותים שלנו'
      };

      // Convert services to pricing plans
      const plans: PricingBlockContent['plans'] = pricedServices.map(service => ({
        name: service.service_name,
        price: this.formatPrice(service.price!, service.currency),
        period: service.duration_minutes ? sessionTexts[language](service.duration_minutes) : undefined,
        description: service.description || undefined,
        features: this.generateServiceFeatures(service, language),
        popular: false,
        cta_text: ctaTexts[language],
        cta_link: '/booking'
      }));

      // Mark the middle plan as popular (common pattern)
      if (plans.length >= 3) {
        plans[Math.floor(plans.length / 2)].popular = true;
      } else if (plans.length > 0) {
        plans[0].popular = true;
      }

      logger.info({ userId, plansCount: plans.length }, 'Pricing block enriched');

      return {
        content: {
          ...templateContent,
          title: templateContent.title || titles[language],
          subtitle: templateContent.subtitle || subtitles[language],
          plans
        },
        enriched: true,
        source: 'database',
        enrichedFields: ['plans', 'title', 'subtitle']
      };
    } catch (error) {
      logger.error({ err: error, userId }, 'Failed to enrich pricing block');
      return {
        content: templateContent,
        enriched: false,
        source: 'template',
        enrichedFields: []
      };
    }
  }

  /**
   * Enrich Contact Form block with business contact info
   * Populates the sidebar with user's email from auth
   */
  private async enrichContactFormBlock(
    userId: string,
    templateContent: ContactFormBlockContent,
    language: WebsiteLanguage = 'en',
    userEmail?: string
  ): Promise<EnrichmentResult<ContactFormBlockContent>> {
    try {
      const profileResult = await this.profileRepo.findByUserId(userId);
      const profile = profileResult.data;

      const enrichedFields: string[] = [];
      const content = { ...templateContent };

      // Localized contact titles
      const contactTitles: Record<WebsiteLanguage, (name: string) => string> = {
        en: (name) => `Contact ${name}`,
        es: (name) => `Contactar ${name}`,
        he: (name) => `צור קשר עם ${name}`
      };

      const subtitles: Record<WebsiteLanguage, string> = {
        en: "We'd love to hear from you",
        es: 'Nos encantaría saber de ti',
        he: 'נשמח לשמוע ממך'
      };

      const submitTexts: Record<WebsiteLanguage, string> = {
        en: 'Send Message',
        es: 'Enviar Mensaje',
        he: 'שלח הודעה'
      };

      // Use company name in title if available
      if (profile?.company_name && (!content.title || content.title.includes('Contact') || content.title.includes('צור קשר'))) {
        content.title = contactTitles[language](profile.company_name);
        enrichedFields.push('title');
      }

      if (!content.subtitle) {
        content.subtitle = subtitles[language];
        enrichedFields.push('subtitle');
      }

      if (!content.submit_text) {
        content.submit_text = submitTexts[language];
        enrichedFields.push('submit_text');
      }

      // Add business contact info for sidebar
      // Use provided userEmail or existing content value
      if (userEmail && !content.business_email) {
        content.business_email = userEmail;
        enrichedFields.push('business_email');
      }

      // Keep existing business contact info if already set in content
      // These can be set manually in the website editor or via templates

      return {
        content,
        enriched: enrichedFields.length > 0,
        source: enrichedFields.length > 0 ? 'database' : 'template',
        enrichedFields
      };
    } catch (error) {
      logger.error({ err: error, userId }, 'Failed to enrich contact form block');
      return {
        content: templateContent,
        enriched: false,
        source: 'template',
        enrichedFields: []
      };
    }
  }

  /**
   * Enrich Process block from user-defined steps or capabilities
   * Priority: 1. User-defined steps (from business_profiles.process_steps)
   *           2. Auto-generated from capabilities
   *           3. Template defaults
   */
  private async enrichProcessBlock(
    userId: string,
    templateContent: ProcessBlockContent,
    language: WebsiteLanguage = 'en'
  ): Promise<EnrichmentResult<ProcessBlockContent>> {
    try {
      // Localized titles
      const titles: Record<WebsiteLanguage, string> = {
        en: 'How It Works',
        es: 'Cómo Funciona',
        he: 'איך זה עובד'
      };

      const subtitles: Record<WebsiteLanguage, string> = {
        en: 'Simple steps to get started',
        es: 'Pasos sencillos para comenzar',
        he: 'צעדים פשוטים להתחיל'
      };

      // PRIORITY 1: Check for user-defined process steps in business profile
      const profileResult = await this.profileRepo.findByUserId(userId);
      const userDefinedSteps = (profileResult.data as any)?.process_steps as Array<{
        title: string;
        description: string;
        icon?: string;
        number?: number;
      }> | undefined;

      if (userDefinedSteps && userDefinedSteps.length > 0) {
        // User has defined their own steps - use them
        const steps = userDefinedSteps.map((step, index) => ({
          title: step.title,
          description: step.description,
          icon: step.icon || 'CheckCircle',
          number: step.number || index + 1,
          auto_generated: false
        }));

        logger.info({ userId, stepCount: steps.length }, 'Process block enriched from user-defined steps');

        return {
          content: {
            ...templateContent,
            title: templateContent.title || titles[language],
            subtitle: templateContent.subtitle || subtitles[language],
            steps,
            layout: templateContent.layout || 'numbered'
          },
          enriched: true,
          source: 'database',
          enrichedFields: ['steps', 'title', 'subtitle']
        };
      }

      // PRIORITY 2: Generate steps from user's active capabilities
      const capabilitiesResult = await this.capabilityRepo.getActiveCapabilityKeys(userId);

      if (!capabilitiesResult.data || capabilitiesResult.data.length === 0) {
        logger.debug({ userId }, 'No active capabilities found, using template content');
        return {
          content: templateContent,
          enriched: false,
          source: 'template',
          enrichedFields: []
        };
      }

      // Generate steps from capabilities
      const steps = websiteAIContentService.generateProcessStepsFromCapabilities(
        capabilitiesResult.data,
        language
      );

      if (steps.length === 0) {
        return {
          content: templateContent,
          enriched: false,
          source: 'template',
          enrichedFields: []
        };
      }

      logger.info({ userId, stepCount: steps.length, capabilityCount: capabilitiesResult.data.length }, 'Process block enriched from capabilities');

      return {
        content: {
          ...templateContent,
          title: templateContent.title || titles[language],
          subtitle: templateContent.subtitle || subtitles[language],
          steps,
          layout: templateContent.layout || 'numbered'
        },
        enriched: true,
        source: 'generated',
        enrichedFields: ['steps', 'title', 'subtitle']
      };
    } catch (error) {
      logger.error({ err: error, userId }, 'Failed to enrich process block');
      return {
        content: templateContent,
        enriched: false,
        source: 'template',
        enrichedFields: []
      };
    }
  }

  /**
   * Enrich FAQ block with AI-generated content
   */
  private async enrichFAQBlockWithAI(
    userId: string,
    templateContent: Record<string, unknown>,
    language: WebsiteLanguage
  ): Promise<EnrichmentResult<Record<string, unknown>>> {
    try {
      const [profileResult, servicesResult] = await Promise.all([
        this.profileRepo.findByUserId(userId),
        this.serviceRepo.listAll(userId, true)
      ]);

      if (!profileResult.data) {
        return {
          content: templateContent,
          enriched: false,
          source: 'template',
          enrichedFields: []
        };
      }

      const generatedContent = await websiteAIContentService.generateBlockContent({
        blockType: 'faq',
        targetLanguage: language,
        businessProfile: {
          company_name: profileResult.data.company_name,
          vertical: profileResult.data.vertical,
          sub_vertical: profileResult.data.sub_vertical,
          website_url: profileResult.data.website_url,
          website_analysis: profileResult.data.website_analysis
        },
        services: servicesResult.data?.map(s => ({
          service_name: s.service_name,
          description: s.description,
          price: s.price,
          currency: s.currency,
          duration_minutes: s.duration_minutes
        })),
        existingContent: templateContent
      });

      return {
        content: { ...templateContent, ...generatedContent },
        enriched: true,
        source: 'ai',
        enrichedFields: Object.keys(generatedContent)
      };
    } catch (error) {
      logger.error({ err: error, userId }, 'Failed to enrich FAQ block with AI');
      return {
        content: templateContent,
        enriched: false,
        source: 'template',
        enrichedFields: []
      };
    }
  }

  /**
   * Enrich Features block with AI-generated content
   */
  private async enrichFeaturesBlockWithAI(
    userId: string,
    templateContent: Record<string, unknown>,
    language: WebsiteLanguage
  ): Promise<EnrichmentResult<Record<string, unknown>>> {
    try {
      const [profileResult, servicesResult] = await Promise.all([
        this.profileRepo.findByUserId(userId),
        this.serviceRepo.listAll(userId, true)
      ]);

      if (!profileResult.data) {
        return {
          content: templateContent,
          enriched: false,
          source: 'template',
          enrichedFields: []
        };
      }

      const generatedContent = await websiteAIContentService.generateBlockContent({
        blockType: 'features',
        targetLanguage: language,
        businessProfile: {
          company_name: profileResult.data.company_name,
          vertical: profileResult.data.vertical,
          sub_vertical: profileResult.data.sub_vertical,
          website_url: profileResult.data.website_url,
          website_analysis: profileResult.data.website_analysis
        },
        services: servicesResult.data?.map(s => ({
          service_name: s.service_name,
          description: s.description,
          price: s.price,
          currency: s.currency,
          duration_minutes: s.duration_minutes
        })),
        existingContent: templateContent
      });

      return {
        content: { ...templateContent, ...generatedContent },
        enriched: true,
        source: 'ai',
        enrichedFields: Object.keys(generatedContent)
      };
    } catch (error) {
      logger.error({ err: error, userId }, 'Failed to enrich features block with AI');
      return {
        content: templateContent,
        enriched: false,
        source: 'template',
        enrichedFields: []
      };
    }
  }

  // ==================== HELPER METHODS ====================

  /**
   * Format price with currency symbol
   */
  private formatPrice(price: number, currency: string): string {
    const symbols: Record<string, string> = {
      USD: '$',
      EUR: '€',
      ILS: '₪',
      GBP: '£'
    };
    const symbol = symbols[currency] || currency + ' ';
    return `${symbol}${price}`;
  }


  /**
   * Generate feature list for a service
   */
  private generateServiceFeatures(service: SchedulingService, language: WebsiteLanguage = 'en'): string[] {
    const features: string[] = [];

    const durationFeatures: Record<WebsiteLanguage, (min: number) => string> = {
      en: (min) => `${min} minute session`,
      es: (min) => `Sesión de ${min} minutos`,
      he: (min) => `פגישה של ${min} דקות`
    };

    const flexibleScheduling: Record<WebsiteLanguage, string> = {
      en: 'Flexible scheduling',
      es: 'Horarios flexibles',
      he: 'גמישות בזמנים'
    };

    const advanceBooking: Record<WebsiteLanguage, string> = {
      en: 'Book up to a month in advance',
      es: 'Reserva hasta un mes por adelantado',
      he: 'הזמן עד חודש מראש'
    };

    const professionalService: Record<WebsiteLanguage, string> = {
      en: 'Professional service',
      es: 'Servicio profesional',
      he: 'שירות מקצועי'
    };

    const onlineBooking: Record<WebsiteLanguage, string> = {
      en: 'Online booking available',
      es: 'Reserva en línea disponible',
      he: 'הזמנה מקוונת זמינה'
    };

    if (service.duration_minutes) {
      features.push(durationFeatures[language](service.duration_minutes));
    }

    if (service.buffer_minutes && service.buffer_minutes > 0) {
      features.push(flexibleScheduling[language]);
    }

    if (service.advance_booking_days && service.advance_booking_days >= 30) {
      features.push(advanceBooking[language]);
    }

    // Add generic features if we don't have enough
    if (features.length < 3) {
      features.push(professionalService[language]);
    }
    if (features.length < 3) {
      features.push(onlineBooking[language]);
    }

    return features;
  }

  /**
   * Get enrichment summary for UI display
   */
  async getEnrichmentSummary(userId: string): Promise<{
    hasServices: boolean;
    serviceCount: number;
    hasProfile: boolean;
    hasClients: boolean;
    clientCount: number;
    hasBookings: boolean;
    bookingCount: number;
  }> {
    try {
      const [servicesResult, profileResult, contactsResult] = await Promise.all([
        this.serviceRepo.listAll(userId, true),
        this.profileRepo.findByUserId(userId),
        this.contactRepo.count(userId, { stage: 'client' })
      ]);

      const { count: bookingsCount } = await this.supabase
        .from('scheduling_bookings')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', userId)
        .eq('status', 'completed');

      return {
        hasServices: (servicesResult.data?.length || 0) > 0,
        serviceCount: servicesResult.data?.length || 0,
        hasProfile: !!profileResult.data,
        hasClients: (contactsResult.data || 0) > 0,
        clientCount: contactsResult.data || 0,
        hasBookings: (bookingsCount || 0) > 0,
        bookingCount: bookingsCount || 0
      };
    } catch (error) {
      logger.error({ err: error, userId }, 'Failed to get enrichment summary');
      return {
        hasServices: false,
        serviceCount: 0,
        hasProfile: false,
        hasClients: false,
        clientCount: 0,
        hasBookings: false,
        bookingCount: 0
      };
    }
  }
}

// Singleton export
import { supabaseServer } from '@/lib/supabaseServer';
export const websiteBlockEnrichmentService = new WebsiteBlockEnrichmentService(supabaseServer);
