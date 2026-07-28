/**
 * ServiceGeneratorService
 *
 * AI Business Architect component that generates scheduling services
 * based on the Business Blueprint extracted from onboarding.
 *
 * This service does NOT create software - it configures existing capabilities.
 * The Scheduling capability already knows how to create services.
 * The AI decides WHICH services fit this business and HOW to configure them.
 */

import { createLogger } from '@/lib/logger';
import { getProviderFactory } from '@/lib/ai/providerFactory';
import type { SchedulingServiceInsert } from '@/lib/repositories/SchedulingRepository';

const logger = createLogger({ service: 'ServiceGeneratorService' });

// Business Blueprint - extracted from onboarding
export interface BusinessBlueprint {
  vertical: string;           // therapist, coach, consultant, lawyer, etc.
  sub_vertical?: string;      // specific type within vertical
  company_name?: string;
  services?: string[];        // services mentioned in bio/conversation
  clients_per_week?: number;
  revenue_tier?: string;      // startup, growing, established
  scheduling_availability?: Record<string, { start: string; end: string }[]>;
  language?: string;
}

// Generated service with AI metadata
export interface GeneratedService {
  service_name: string;
  description: string;
  duration_minutes: number;
  price: number | null;
  buffer_minutes: number;
  min_notice_hours: number;
  advance_booking_days: number;
  ai_suggestions: {
    reasoning: string;
    confidence: number;
    source: 'bio_extraction' | 'vertical_default' | 'industry_standard';
  };
}

// Vertical-specific service templates
const VERTICAL_DEFAULTS: Record<string, Partial<GeneratedService>[]> = {
  therapist: [
    {
      service_name: 'Initial Consultation',
      description: 'First session to understand your needs and discuss how therapy can help.',
      duration_minutes: 50,
      price: null, // Often free or reduced
      buffer_minutes: 10,
      min_notice_hours: 24,
      ai_suggestions: {
        reasoning: 'Initial consultations are standard in therapy to build rapport and assess fit.',
        confidence: 0.9,
        source: 'vertical_default'
      }
    },
    {
      service_name: 'Therapy Session',
      description: 'Individual therapy session.',
      duration_minutes: 50,
      price: null,
      buffer_minutes: 10,
      min_notice_hours: 24,
      ai_suggestions: {
        reasoning: 'Standard 50-minute therapy session is industry standard.',
        confidence: 0.95,
        source: 'vertical_default'
      }
    }
  ],
  coach: [
    {
      service_name: 'Discovery Call',
      description: 'Free introductory call to discuss your goals and how coaching can help.',
      duration_minutes: 30,
      price: 0,
      buffer_minutes: 15,
      min_notice_hours: 24,
      ai_suggestions: {
        reasoning: 'Discovery calls help coaches qualify leads and demonstrate value.',
        confidence: 0.9,
        source: 'vertical_default'
      }
    },
    {
      service_name: 'Coaching Session',
      description: 'One-on-one coaching session to work towards your goals.',
      duration_minutes: 60,
      price: null,
      buffer_minutes: 15,
      min_notice_hours: 24,
      ai_suggestions: {
        reasoning: '60-minute sessions are standard for coaching.',
        confidence: 0.9,
        source: 'vertical_default'
      }
    }
  ],
  consultant: [
    {
      service_name: 'Strategy Call',
      description: 'Initial consultation to understand your business challenges.',
      duration_minutes: 45,
      price: 0,
      buffer_minutes: 15,
      min_notice_hours: 48,
      ai_suggestions: {
        reasoning: 'Strategy calls help consultants understand client needs before proposing solutions.',
        confidence: 0.85,
        source: 'vertical_default'
      }
    },
    {
      service_name: 'Consulting Session',
      description: 'Expert consultation session.',
      duration_minutes: 60,
      price: null,
      buffer_minutes: 15,
      min_notice_hours: 48,
      ai_suggestions: {
        reasoning: 'Hourly sessions are standard billing unit for consultants.',
        confidence: 0.9,
        source: 'vertical_default'
      }
    }
  ],
  lawyer: [
    {
      service_name: 'Initial Consultation',
      description: 'First meeting to discuss your legal matter.',
      duration_minutes: 30,
      price: null,
      buffer_minutes: 15,
      min_notice_hours: 48,
      ai_suggestions: {
        reasoning: 'Initial consultations help lawyers assess cases and discuss fees.',
        confidence: 0.9,
        source: 'vertical_default'
      }
    }
  ],
  course_creator: [
    {
      service_name: 'Mentoring Session',
      description: 'One-on-one mentoring to help you progress.',
      duration_minutes: 45,
      price: null,
      buffer_minutes: 15,
      min_notice_hours: 24,
      ai_suggestions: {
        reasoning: 'Course creators often offer mentoring as premium add-on.',
        confidence: 0.8,
        source: 'vertical_default'
      }
    }
  ],
  fitness: [
    {
      service_name: 'Personal Training Session',
      description: 'One-on-one fitness training session.',
      duration_minutes: 60,
      price: null,
      buffer_minutes: 15,
      min_notice_hours: 12,
      ai_suggestions: {
        reasoning: 'Standard personal training session duration.',
        confidence: 0.9,
        source: 'vertical_default'
      }
    },
    {
      service_name: 'Fitness Assessment',
      description: 'Initial fitness assessment and goal setting.',
      duration_minutes: 45,
      price: null,
      buffer_minutes: 15,
      min_notice_hours: 24,
      ai_suggestions: {
        reasoning: 'Initial assessments help trainers create personalized programs.',
        confidence: 0.85,
        source: 'vertical_default'
      }
    }
  ]
};

// Default service for any vertical
const GENERIC_DEFAULTS: Partial<GeneratedService>[] = [
  {
    service_name: 'Consultation',
    description: 'Initial consultation to discuss your needs.',
    duration_minutes: 30,
    price: 0,
    buffer_minutes: 15,
    min_notice_hours: 24,
    ai_suggestions: {
      reasoning: 'Generic initial consultation for new clients.',
      confidence: 0.7,
      source: 'industry_standard'
    }
  },
  {
    service_name: 'Session',
    description: 'Standard session.',
    duration_minutes: 60,
    price: null,
    buffer_minutes: 15,
    min_notice_hours: 24,
    ai_suggestions: {
      reasoning: 'Generic hourly session.',
      confidence: 0.6,
      source: 'industry_standard'
    }
  }
];

export class ServiceGeneratorService {
  /**
   * Generate draft services based on Business Blueprint
   *
   * This is the AI Business Architect deciding which services fit this business.
   * It personalizes the Scheduling capability configuration.
   */
  async generateServices(
    blueprint: BusinessBlueprint,
    userId: string
  ): Promise<{
    success: boolean;
    services: GeneratedService[];
    tokensUsed?: number;
    error?: string;
  }> {
    try {
      logger.info({
        userId,
        vertical: blueprint.vertical,
        servicesFromBio: blueprint.services?.length || 0
      }, 'Generating services from Business Blueprint');

      // Strategy 1: If services were extracted from bio, use AI to configure them
      if (blueprint.services && blueprint.services.length > 0) {
        return this.generateFromExtractedServices(blueprint, userId);
      }

      // Strategy 2: Use vertical-specific defaults
      return this.generateFromVerticalDefaults(blueprint, userId);

    } catch (error) {
      logger.error({ err: error, userId }, 'Failed to generate services');
      return {
        success: false,
        services: [],
        error: (error as Error).message
      };
    }
  }

  /**
   * Generate services from services mentioned in bio/conversation
   * Uses LLM to determine appropriate configuration
   */
  private async generateFromExtractedServices(
    blueprint: BusinessBlueprint,
    userId: string
  ): Promise<{
    success: boolean;
    services: GeneratedService[];
    tokensUsed?: number;
  }> {
    const factory = getProviderFactory();
    const provider = factory.getProvider('openai');

    const systemPrompt = `You are a Business Architect configuring scheduling services for a business.

Based on the business profile and services mentioned, generate appropriate service configurations.

For each service, determine:
- service_name: Clear, professional name
- description: 1-2 sentence description for clients
- duration_minutes: Appropriate duration (15, 30, 45, 50, 60, 90, 120)
- price: Suggested price in USD (null if you don't have enough info)
- buffer_minutes: Time between appointments (5, 10, 15, 30)
- min_notice_hours: Minimum booking notice (4, 12, 24, 48, 72)
- advance_booking_days: How far ahead clients can book (7, 14, 30, 60, 90)

Consider the business vertical, typical pricing, and industry standards.
Keep descriptions client-friendly and professional.`;

    const userPrompt = `Business Profile:
- Vertical: ${blueprint.vertical}${blueprint.sub_vertical ? ` (${blueprint.sub_vertical})` : ''}
- Company: ${blueprint.company_name || 'Not specified'}
- Services mentioned: ${blueprint.services?.join(', ')}
- Clients per week: ${blueprint.clients_per_week || 'Not specified'}
- Revenue tier: ${blueprint.revenue_tier || 'Not specified'}

Generate service configurations for each service mentioned.
Return as JSON array of services.`;

    try {
      const response = await provider.complete({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        temperature: 0.3,
        response_format: { type: 'json_object' }
      });

      const content = response.choices[0]?.message?.content || '{}';
      const parsed = JSON.parse(content);
      const services = Array.isArray(parsed) ? parsed : (parsed.services || []);

      // Enrich with AI metadata
      const enrichedServices: GeneratedService[] = services.map((s: Partial<GeneratedService>) => ({
        service_name: s.service_name || 'Service',
        description: s.description || '',
        duration_minutes: s.duration_minutes || 60,
        price: s.price ?? null,
        buffer_minutes: s.buffer_minutes || 15,
        min_notice_hours: s.min_notice_hours || 24,
        advance_booking_days: s.advance_booking_days || 30,
        ai_suggestions: {
          reasoning: `Generated from "${blueprint.services?.find(svc =>
            svc.toLowerCase().includes(s.service_name?.toLowerCase().split(' ')[0] || '')
          ) || 'business profile'}" mentioned in your bio.`,
          confidence: 0.8,
          source: 'bio_extraction' as const
        }
      }));

      logger.info({
        userId,
        servicesGenerated: enrichedServices.length,
        tokensUsed: response.usage?.total_tokens
      }, 'Services generated from bio extraction');

      return {
        success: true,
        services: enrichedServices,
        tokensUsed: response.usage?.total_tokens
      };

    } catch (error) {
      logger.warn({ err: error, userId }, 'AI service generation failed, falling back to defaults');
      return this.generateFromVerticalDefaults(blueprint, userId);
    }
  }

  /**
   * Generate services from vertical-specific defaults
   * No LLM call needed - deterministic configuration
   */
  private async generateFromVerticalDefaults(
    blueprint: BusinessBlueprint,
    userId: string
  ): Promise<{
    success: boolean;
    services: GeneratedService[];
  }> {
    const vertical = blueprint.vertical?.toLowerCase() || 'generic';
    const defaults = VERTICAL_DEFAULTS[vertical] || GENERIC_DEFAULTS;

    // Personalize with company name if available
    const services: GeneratedService[] = defaults.map(d => ({
      service_name: d.service_name || 'Service',
      description: d.description || '',
      duration_minutes: d.duration_minutes || 60,
      price: d.price ?? null,
      buffer_minutes: d.buffer_minutes || 15,
      min_notice_hours: d.min_notice_hours || 24,
      advance_booking_days: d.advance_booking_days || 30,
      ai_suggestions: d.ai_suggestions || {
        reasoning: `Default service for ${vertical} businesses.`,
        confidence: 0.7,
        source: 'vertical_default' as const
      }
    }));

    logger.info({
      userId,
      vertical,
      servicesGenerated: services.length
    }, 'Services generated from vertical defaults');

    return {
      success: true,
      services
    };
  }

  /**
   * Convert generated services to database insert format
   */
  toInsertFormat(
    services: GeneratedService[],
    userId: string
  ): SchedulingServiceInsert[] {
    return services.map(s => ({
      user_id: userId,
      service_name: s.service_name,
      description: s.description,
      duration_minutes: s.duration_minutes,
      price: s.price,
      buffer_minutes: s.buffer_minutes,
      min_notice_hours: s.min_notice_hours,
      advance_booking_days: s.advance_booking_days,
      is_active: false // Draft services start as inactive
    }));
  }
}

// Singleton export
export const serviceGeneratorService = new ServiceGeneratorService();
