/**
 * POST /api/onboarding/build
 * Build infrastructure for new business-os users
 * - Creates/updates business profile with intelligent extraction
 * - Seeds CRM pipeline stages based on vertical
 * - Creates services from onboarding data
 * - Activates capabilities based on computed configuration
 * - Triggers AI website generation (async)
 * - Marks onboarding as complete
 */

import { NextRequest, NextResponse } from 'next/server';
import { getUser } from '@/lib/auth';
import { createLogger } from '@/lib/logger';
import { businessProfileRepository } from '@/lib/repositories/BusinessProfileRepository';
import { crmPipelineStagesRepository } from '@/lib/repositories/CRMPipelineStagesRepository';
import { schedulingServiceRepository } from '@/lib/repositories/SchedulingRepository';
import { capabilityActivationService } from '@/lib/services/CapabilityActivationService';
import { capabilityConditionEvaluator } from '@/lib/services/CapabilityConditionEvaluator';
import { z } from 'zod';

const logger = createLogger({ module: 'OnboardingBuildAPI' });

// Schema for pipeline stages
const pipelineStageSchema = z.object({
  stage_key: z.string(),
  stage_label: z.string(),
  position: z.number(),
  color: z.string(),
});

// Schema for computed configuration from OnboardingConfigurationService
const computedConfigurationSchema = z.object({
  company_name: z.string(),
  vertical: z.string(),
  description: z.string().optional(),
  clients_per_week: z.number(),
  pain_points: z.array(z.string()),
  goals: z.array(z.string()),
  tools: z.array(z.string()),
  services: z.array(z.object({
    name: z.string(),
    duration_minutes: z.number().nullable().optional(),
    price: z.number().optional(),
    is_scheduled: z.boolean().optional(),
  })),
  online_presence_mode: z.enum(['full_website', 'booking_only', 'website_only', 'none']),
  payment_mode: z.enum(['none', 'upfront', 'invoicing', 'installments']),
  needs_stripe_connect: z.boolean(),
  pipeline_stages: z.array(pipelineStageSchema),
  capabilities: z.array(z.string()),
  building_blocks: z.record(z.array(z.string())),
  capability_reasons: z.record(z.string()).optional(),
});

// Validation schema for the build request (supports both old and new formats)
const buildRequestSchema = z.object({
  // NEW: Computed configuration from smart onboarding
  configuration: computedConfigurationSchema.optional(),

  // LEGACY: Old profile-based format (for backwards compatibility)
  profile: z.object({
    vertical: z.string().optional(),
    sub_vertical: z.string().optional(),
    company_name: z.string().optional(),
    language: z.enum(['en', 'he', 'es']).optional(),
    description: z.string().optional(),
    services: z.array(z.string()).optional(),
    clients_per_week: z.number().optional(),
    tools: z.array(z.string()).optional(),
    website_url: z.string().optional(),
    has_website: z.boolean().optional(),
    has_online_booking: z.boolean().optional(),
    booking_method: z.string().optional(),
    pain_points: z.array(z.string()).optional(),
    goals: z.array(z.string()).optional(),
    profile_completeness: z.number().optional(),
  }).optional(),

  // Services from onboarding chat
  services: z.array(z.object({
    service_name: z.string(),
    duration_minutes: z.number(),
    price: z.number().nullable(),
    currency: z.string().optional(),
  })).optional(),

  // Pipeline stages
  pipelineStages: z.array(pipelineStageSchema).optional(),

  // Legacy capabilities format
  capabilities: z.array(z.object({
    id: z.string(),
    name: z.string(),
    category: z.string(),
  })).optional(),

  locale: z.string().optional(),
  language: z.enum(['en', 'he', 'es']).optional(),
});

export async function POST(request: NextRequest) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId });

  try {
    // 1. Authenticate
    const user = await getUser();
    if (!user) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized' },
        { status: 401 }
      );
    }

    // 2. Parse and validate request body
    const body = await request.json();
    const validated = buildRequestSchema.parse(body);
    const { configuration, profile, services, pipelineStages, capabilities, language } = validated;

    // Determine if using new computed configuration or legacy format
    const useNewFormat = !!configuration;

    // Extract values from either format
    const vertical = configuration?.vertical || profile?.vertical || 'default';
    const companyName = configuration?.company_name || profile?.company_name;
    const description = configuration?.description || profile?.description;
    const clientsPerWeek = configuration?.clients_per_week || profile?.clients_per_week;
    const painPoints = configuration?.pain_points || profile?.pain_points || [];
    const goals = configuration?.goals || profile?.goals || [];
    const tools = configuration?.tools || profile?.tools || [];
    const lang = language || profile?.language || 'en';

    requestLogger.info(
      { userId: user.id, vertical, useNewFormat },
      'Building onboarding infrastructure'
    );

    // 3. Upsert business profile with intelligent data
    const profileData: Record<string, unknown> = {
      user_id: user.id,
      vertical,
      sub_vertical: profile?.sub_vertical || null,
      company_name: companyName || null,
      language: lang,
      description: description || null,
      services: profile?.services || [],
      clients_per_week: clientsPerWeek || null,
      tools,
      website_url: profile?.website_url || null,
      profile_completeness: profile?.profile_completeness || 70,
      onboarding_completed: true,
      // NEW: Intelligent onboarding fields
      pain_points: painPoints,
      goals,
    };

    // Add new configuration fields if using new format
    if (configuration) {
      profileData.payment_mode = configuration.payment_mode;
      profileData.online_presence_mode = configuration.online_presence_mode;
      profileData.needs_stripe_connect = configuration.needs_stripe_connect;
      profileData.extracted_data = configuration; // Store full config for debugging
    }

    const profileResult = await businessProfileRepository.upsert(profileData);

    if (profileResult.error) {
      requestLogger.error({ err: profileResult.error, userId: user.id }, 'Failed to upsert business profile');
      return NextResponse.json(
        { success: false, error: 'Failed to save profile' },
        { status: 500 }
      );
    }

    // 3.5. Activate capabilities based on profile (DATABASE-DRIVEN INTELLIGENCE)
    requestLogger.info({ userId: user.id, vertical }, 'Activating capabilities from profile');

    // Build profile for capability activation
    const activationProfile = {
      vertical,
      clients_per_week: clientsPerWeek,
      tools,
      pain_points: painPoints,
      goals,
      has_website: configuration?.online_presence_mode === 'full_website' ||
                   configuration?.online_presence_mode === 'website_only' ||
                   profile?.has_website
    };

    // If using new format with computed capabilities, create capability objects
    let capabilityObjects = capabilities;
    if (useNewFormat && configuration?.capabilities) {
      capabilityObjects = configuration.capabilities.map(capKey => ({
        id: capKey,
        name: capKey,
        category: 'computed'
      }));
    }

    const capabilityResult = await capabilityActivationService.activateFromProfile(
      user.id,
      activationProfile,
      capabilityObjects,
      'onboarding'
    );

    if (capabilityResult.error) {
      requestLogger.error(
        { err: capabilityResult.error, userId: user.id },
        'Failed to activate capabilities (non-blocking)'
      );
    } else if (capabilityResult.data) {
      requestLogger.info(
        {
          userId: user.id,
          activated: capabilityResult.data.activated,
          skipped: capabilityResult.data.skipped,
          count: capabilityResult.data.activated.length
        },
        'Capabilities activated from profile'
      );
    }

    // 3.6. Activate building blocks based on profile and conditions
    requestLogger.info({ userId: user.id }, 'Activating building blocks from profile');

    const blockResult = await capabilityConditionEvaluator.activateBlocksForProfile(user.id);

    if (blockResult.error) {
      requestLogger.error(
        { err: blockResult.error, userId: user.id },
        'Failed to activate building blocks (non-blocking)'
      );
    } else if (blockResult.data) {
      requestLogger.info(
        {
          userId: user.id,
          activated: blockResult.data.activated,
          skipped: blockResult.data.skipped,
          count: blockResult.data.activated.length
        },
        'Building blocks activated from profile'
      );
    }

    // 4. Seed CRM pipeline stages
    // Priority: configuration.pipeline_stages > pipelineStages > vertical defaults
    let pipelineResult;
    const stagesToUse = configuration?.pipeline_stages || pipelineStages;

    // Check if user already has pipeline stages
    const existingStages = await crmPipelineStagesRepository.list(user.id);
    const hasExistingStages = existingStages.data && existingStages.data.length > 0;

    if (hasExistingStages) {
      // User already has pipeline stages, skip creation
      requestLogger.info({ userId: user.id, existingCount: existingStages.data?.length }, 'User already has pipeline stages, skipping');
      pipelineResult = existingStages;
    } else if (stagesToUse && stagesToUse.length > 0) {
      requestLogger.info({ userId: user.id, stageCount: stagesToUse.length }, 'Creating pipeline stages from configuration');
      // Create stages from configuration
      for (const stage of stagesToUse) {
        await crmPipelineStagesRepository.create({
          user_id: user.id,
          vertical,
          stage_key: stage.stage_key,
          stage_label: stage.stage_label,
          position: stage.position,
          color: stage.color,
        });
      }
      pipelineResult = { data: stagesToUse, error: null };
    } else {
      requestLogger.info({ userId: user.id, vertical }, 'Seeding CRM pipeline stages from vertical defaults');
      pipelineResult = await crmPipelineStagesRepository.seedDefaults(user.id, vertical);

      if (pipelineResult.error) {
        requestLogger.warn({ err: pipelineResult.error, userId: user.id, vertical }, 'Failed to seed pipeline stages (non-blocking)');
      } else {
        requestLogger.info({ userId: user.id, stageCount: pipelineResult.data?.length }, 'Pipeline stages seeded');
      }
    }

    // 5. Create services from onboarding data
    // IMPORTANT: Use ONLY ONE source to avoid duplication
    // Priority: services (legacy format with full data) > configuration.services (new format)
    // The legacy format is populated from the same source but has richer data (currency already set)
    const createdServices = [];

    // Determine currency based on language (fallback)
    const currency = lang === 'he' ? 'ILS' : lang === 'es' ? 'EUR' : 'USD';

    // Determine payment type based on configuration
    const defaultPaymentType = configuration?.payment_mode === 'invoicing' ? 'invoice' :
                               configuration?.payment_mode === 'installments' ? 'installments' : 'one_time';

    // Check if user already has services (prevents duplication on page refresh)
    const existingServices = await schedulingServiceRepository.listAll(user.id);
    const hasExistingServices = existingServices.data && existingServices.data.length > 0;

    if (hasExistingServices) {
      // User already has services, skip creation to prevent duplicates
      requestLogger.info({ userId: user.id, existingCount: existingServices.data?.length }, 'User already has services, skipping creation');
    } else if (services && services.length > 0) {
      // Legacy format: use services array directly (preferred - has currency)
      requestLogger.info({ userId: user.id, serviceCount: services.length }, 'Creating services from legacy format');

      for (const service of services) {
        const serviceResult = await schedulingServiceRepository.create({
          user_id: user.id,
          service_name: service.service_name,
          duration_minutes: service.duration_minutes,
          price: service.price,
          currency: service.currency || currency,
          is_active: true,
        });

        if (serviceResult.error) {
          requestLogger.warn({ err: serviceResult.error, serviceName: service.service_name }, 'Failed to create service (non-blocking)');
        } else if (serviceResult.data) {
          createdServices.push(serviceResult.data);
          requestLogger.info({ serviceId: serviceResult.data.id, serviceName: service.service_name }, 'Service created');
        }
      }
    } else if (configuration?.services && configuration.services.length > 0) {
      // New format (fallback only): convert from configuration.services
      // Only use this if legacy services array is empty
      requestLogger.info({ userId: user.id, serviceCount: configuration.services.length }, 'Creating services from configuration (fallback)');

      for (const service of configuration.services) {
        const serviceResult = await schedulingServiceRepository.create({
          user_id: user.id,
          service_name: service.name,
          duration_minutes: service.duration_minutes || 60,
          price: service.price || 0,
          currency,
          is_active: true,
        });

        if (serviceResult.error) {
          requestLogger.warn({ err: serviceResult.error, serviceName: service.name }, 'Failed to create service (non-blocking)');
        } else if (serviceResult.data) {
          createdServices.push(serviceResult.data);
          requestLogger.info({ serviceId: serviceResult.data.id, serviceName: service.name }, 'Service created');
        }
      }
    }

    // 6. Trigger AI website generation
    // Only trigger if user explicitly wants a website (full_website or website_only mode)
    const shouldGenerateWebsite =
      configuration?.online_presence_mode === 'full_website' ||
      configuration?.online_presence_mode === 'website_only';

    let websiteGenerated = false;
    let websiteError: string | null = null;

    if (shouldGenerateWebsite) {
      requestLogger.info({ userId: user.id, onlinePresenceMode: configuration?.online_presence_mode }, 'Starting AI website generation');

      try {
        // Import and call the service directly instead of making HTTP request
        // This avoids auth cookie issues with internal fetch calls
        const { WebsiteGenerationService } = await import('@/lib/services/WebsiteGenerationService');
        const websiteService = new WebsiteGenerationService();

        // AWAIT the website generation to ensure it completes before returning
        const result = await websiteService.generateWebsite(user.id);

        if (result.success) {
          websiteGenerated = true;
          requestLogger.info(
            { userId: user.id, homepageId: result.homepageId, blocksCreated: result.blocksCreated },
            'Website generation completed successfully'
          );
        } else {
          websiteError = result.error || 'Unknown error';
          requestLogger.warn({ userId: user.id, error: result.error }, 'Website generation failed');
        }
      } catch (err) {
        websiteError = (err as Error).message;
        requestLogger.error({ err, userId: user.id }, 'Website generation error');
      }
    } else {
      requestLogger.info({ userId: user.id, onlinePresenceMode: configuration?.online_presence_mode }, 'Skipping website generation (not requested)');
    }

    // 7. Return success
    requestLogger.info(
      {
        userId: user.id,
        capabilitiesActivated: capabilityResult.data?.activated?.length || 0,
        servicesCreated: createdServices.length,
        pipelineStages: pipelineResult.data?.length || 0,
        useNewFormat
      },
      'Onboarding build completed successfully'
    );

    return NextResponse.json({
      success: true,
      profile: profileResult.data,
      pipeline_stages: pipelineResult.data || [],
      services: createdServices,
      capabilities_enabled: configuration?.capabilities || capabilities?.map(c => c.id) || [],
      building_blocks: configuration?.building_blocks || {},
      online_presence_mode: configuration?.online_presence_mode || 'none',
      payment_mode: configuration?.payment_mode || 'none',
      website_generated: websiteGenerated,
      website_error: websiteError,
      redirect: '/business-os'
    });

  } catch (error) {
    if (error instanceof z.ZodError) {
      requestLogger.warn({ err: error }, 'Validation error');
      return NextResponse.json(
        {
          success: false,
          error: 'Invalid input',
          details: process.env.NODE_ENV === 'development' ? error.errors : undefined
        },
        { status: 400 }
      );
    }

    requestLogger.error({ err: error }, 'Build request failed');
    return NextResponse.json(
      {
        success: false,
        error: 'Internal server error',
        details: process.env.NODE_ENV === 'development' ? (error as Error).message : undefined
      },
      { status: 500 }
    );
  }
}
