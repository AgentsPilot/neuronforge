/**
 * POST /api/scheduling/services/generate
 *
 * AI Business Architect endpoint that generates draft scheduling services
 * based on the user's Business Blueprint (from onboarding).
 *
 * This endpoint:
 * 1. Reads the user's business profile
 * 2. Uses AI to determine appropriate services
 * 3. Creates draft services that user can review and customize
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getUser } from '@/lib/auth';
import { createLogger } from '@/lib/logger';
import { businessProfileRepository } from '@/lib/repositories/BusinessProfileRepository';
import { schedulingServiceRepository } from '@/lib/repositories/SchedulingRepository';
import { serviceGeneratorService, type BusinessBlueprint } from '@/lib/services/ServiceGeneratorService';
import { AuditTrailService } from '@/lib/services/AuditTrailService';

const logger = createLogger({ module: 'GenerateServicesAPI' });
const auditTrail = AuditTrailService.getInstance();

// Optional request body for manual override
const generateServicesSchema = z.object({
  // Allow passing a custom blueprint (for testing or manual override)
  blueprint: z.object({
    vertical: z.string(),
    sub_vertical: z.string().optional(),
    company_name: z.string().optional(),
    services: z.array(z.string()).optional(),
    clients_per_week: z.number().optional(),
    revenue_tier: z.string().optional()
  }).optional(),
  // If true, regenerate even if drafts already exist
  force: z.boolean().optional()
}).optional();

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

    // 2. Parse optional body
    let body: z.infer<typeof generateServicesSchema> = {};
    try {
      const rawBody = await request.text();
      if (rawBody) {
        body = generateServicesSchema.parse(JSON.parse(rawBody));
      }
    } catch {
      // Empty body is fine
    }

    requestLogger.info({ userId: user.id, hasCustomBlueprint: !!body?.blueprint }, 'Generating draft services');

    // 3. Check if drafts already exist (unless force regenerate)
    if (!body?.force) {
      const existingDrafts = await schedulingServiceRepository.listDrafts(user.id);
      if (existingDrafts.data && existingDrafts.data.length > 0) {
        requestLogger.info({ userId: user.id, existingCount: existingDrafts.data.length }, 'Draft services already exist');
        return NextResponse.json({
          success: true,
          services: existingDrafts.data,
          message: 'Draft services already exist. Use force=true to regenerate.',
          already_existed: true
        });
      }
    }

    // 4. Get or build business blueprint
    let blueprint: BusinessBlueprint;

    if (body?.blueprint) {
      // Use custom blueprint from request
      blueprint = body.blueprint;
    } else {
      // Load from business profile
      const profileResult = await businessProfileRepository.findByUserId(user.id);

      if (profileResult.error || !profileResult.data) {
        requestLogger.warn({ userId: user.id }, 'No business profile found, using defaults');
        blueprint = {
          vertical: 'generic',
          language: 'en'
        };
      } else {
        const profile = profileResult.data;
        blueprint = {
          vertical: profile.vertical || 'generic',
          sub_vertical: profile.sub_vertical || undefined,
          company_name: profile.company_name || undefined,
          services: profile.services || [],
          clients_per_week: profile.clients_per_week || undefined,
          revenue_tier: profile.revenue_tier || undefined,
          scheduling_availability: profile.scheduling_availability || undefined,
          language: profile.language || 'en'
        };
      }
    }

    // 5. Generate services using AI Business Architect
    const generationResult = await serviceGeneratorService.generateServices(blueprint, user.id);

    if (!generationResult.success || generationResult.services.length === 0) {
      requestLogger.warn({ userId: user.id, error: generationResult.error }, 'Service generation failed or returned empty');
      return NextResponse.json(
        { success: false, error: generationResult.error || 'Failed to generate services' },
        { status: 500 }
      );
    }

    // 6. Create draft services in database
    const insertData = generationResult.services.map(service => ({
      user_id: user.id,
      service_name: service.service_name,
      description: service.description,
      duration_minutes: service.duration_minutes,
      price: service.price,
      buffer_minutes: service.buffer_minutes,
      min_notice_hours: service.min_notice_hours,
      advance_booking_days: service.advance_booking_days,
      is_active: false,
      status: 'draft' as const,
      source: 'ai_generated' as const,
      ai_suggestions: service.ai_suggestions
    }));

    const createResult = await schedulingServiceRepository.createMany(insertData);

    if (createResult.error) {
      requestLogger.error({ err: createResult.error, userId: user.id }, 'Failed to save draft services');
      return NextResponse.json(
        { success: false, error: 'Failed to save draft services' },
        { status: 500 }
      );
    }

    // 7. Audit log (non-blocking)
    auditTrail.log({
      action: 'SCHEDULING_SERVICES_GENERATED',
      userId: user.id,
      entityType: 'scheduling_service',
      entityId: createResult.data?.[0]?.id || 'batch',
      resourceName: `${createResult.data?.length || 0} draft services generated`,
      metadata: {
        vertical: blueprint.vertical,
        services_count: createResult.data?.length || 0,
        tokens_used: generationResult.tokensUsed
      },
      request
    }).catch(err => requestLogger.error({ err }, 'Audit failed'));

    // 8. Return success
    requestLogger.info({
      userId: user.id,
      servicesCreated: createResult.data?.length || 0,
      tokensUsed: generationResult.tokensUsed
    }, 'Draft services generated successfully');

    return NextResponse.json({
      success: true,
      services: createResult.data,
      tokens_used: generationResult.tokensUsed,
      message: `Generated ${createResult.data?.length || 0} draft services based on your business profile. Review and publish them to start accepting bookings.`
    });

  } catch (error) {
    requestLogger.error({ err: error }, 'Generate services request failed');
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
