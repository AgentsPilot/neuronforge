/**
 * POST /api/onboarding/build
 * Build infrastructure for new business-os users
 * - Creates/updates business profile
 * - Seeds CRM pipeline stages based on vertical
 * - Marks onboarding as complete
 */

import { NextRequest, NextResponse } from 'next/server';
import { getUser } from '@/lib/auth';
import { createLogger } from '@/lib/logger';
import { businessProfileRepository } from '@/lib/repositories/BusinessProfileRepository';
import { crmPipelineStagesRepository } from '@/lib/repositories/CRMPipelineStagesRepository';
import { z } from 'zod';

const logger = createLogger({ module: 'OnboardingBuildAPI' });

// Validation schema for the build request
const buildRequestSchema = z.object({
  profile: z.object({
    vertical: z.string().optional(),
    sub_vertical: z.string().optional(),
    company_name: z.string().optional(),
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
  }),
  capabilities: z.array(z.object({
    id: z.string(),
    name: z.string(),
    category: z.string(),
  })).optional(),
  locale: z.string().optional(),
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
    const { profile, capabilities } = validated;

    requestLogger.info({ userId: user.id, vertical: profile.vertical }, 'Building onboarding infrastructure');

    // 3. Upsert business profile
    const profileResult = await businessProfileRepository.upsert({
      user_id: user.id,
      vertical: profile.vertical || null,
      sub_vertical: profile.sub_vertical || null,
      company_name: profile.company_name || null,
      services: profile.services || [],
      clients_per_week: profile.clients_per_week || null,
      tools: profile.tools || [],
      website_url: profile.website_url || null,
      profile_completeness: profile.profile_completeness || 0,
      onboarding_completed: true,
    });

    if (profileResult.error) {
      requestLogger.error({ err: profileResult.error, userId: user.id }, 'Failed to upsert business profile');
      return NextResponse.json(
        { success: false, error: 'Failed to save profile' },
        { status: 500 }
      );
    }

    // 4. Seed CRM pipeline stages based on vertical
    const vertical = profile.vertical || 'default';
    requestLogger.info({ userId: user.id, vertical }, 'Seeding CRM pipeline stages');

    const pipelineResult = await crmPipelineStagesRepository.seedDefaults(user.id, vertical);

    if (pipelineResult.error) {
      // Log but don't fail - pipeline seeding is not critical
      requestLogger.warn({ err: pipelineResult.error, userId: user.id, vertical }, 'Failed to seed pipeline stages (non-blocking)');
    } else {
      requestLogger.info({ userId: user.id, stageCount: pipelineResult.data?.length }, 'Pipeline stages seeded');
    }

    // 5. Return success
    requestLogger.info({ userId: user.id }, 'Onboarding build completed successfully');

    return NextResponse.json({
      success: true,
      profile: profileResult.data,
      pipeline_stages: pipelineResult.data || [],
      capabilities_enabled: capabilities?.map(c => c.id) || []
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
