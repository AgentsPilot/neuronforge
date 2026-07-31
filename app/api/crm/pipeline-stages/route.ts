/**
 * GET /api/crm/pipeline-stages - Get user's pipeline stages
 * POST /api/crm/pipeline-stages - Create a new stage or seed defaults
 */

import { NextRequest, NextResponse } from 'next/server';
import { getUser } from '@/lib/auth';
import { createLogger } from '@/lib/logger';
import { crmPipelineStagesRepository } from '@/lib/repositories/CRMPipelineStagesRepository';
import { z } from 'zod';

const logger = createLogger({ module: 'CRMPipelineStagesAPI' });

// Validation schemas
const createStageSchema = z.object({
  stage_key: z.string().min(1).max(50),
  stage_label: z.string().min(1).max(100),
  position: z.number().int().min(0),
  color: z.string().max(20).optional().nullable(),
  vertical: z.string().min(1).max(50)
});

const seedDefaultsSchema = z.object({
  action: z.literal('seed_defaults'),
  vertical: z.string().min(1).max(50)
});

const createCustomSchema = z.object({
  action: z.literal('create_custom'),
  stages: z.array(z.object({
    stage_key: z.string().min(1).max(50),
    stage_label: z.string().min(1).max(100),
    color: z.string().max(20).optional().nullable()
  })).min(2).max(15)
});

export async function GET(request: NextRequest) {
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

    requestLogger.info({ userId: user.id }, 'Fetching pipeline stages');

    // 2. Get stages
    const result = await crmPipelineStagesRepository.list(user.id);

    if (result.error) {
      requestLogger.error({ err: result.error, userId: user.id }, 'Failed to fetch pipeline stages');
      return NextResponse.json(
        { success: false, error: 'Failed to fetch pipeline stages' },
        { status: 500 }
      );
    }

    // 3. Return success
    return NextResponse.json({
      success: true,
      stages: result.data
    });

  } catch (error) {
    requestLogger.error({ err: error }, 'Request failed');
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

    // 2. Parse body
    const body = await request.json();

    // Check if this is a seed defaults request
    if (body.action === 'seed_defaults') {
      const validated = seedDefaultsSchema.parse(body);
      requestLogger.info({ userId: user.id, vertical: validated.vertical }, 'Seeding default pipeline stages');

      const result = await crmPipelineStagesRepository.seedDefaults(user.id, validated.vertical);

      if (result.error) {
        requestLogger.error({ err: result.error, userId: user.id }, 'Failed to seed default stages');
        return NextResponse.json(
          { success: false, error: 'Failed to seed default stages' },
          { status: 500 }
        );
      }

      return NextResponse.json({
        success: true,
        stages: result.data
      });
    }

    // Check if this is a create custom stages request (from onboarding)
    if (body.action === 'create_custom') {
      const validated = createCustomSchema.parse(body);
      requestLogger.info({ userId: user.id, count: validated.stages.length }, 'Creating custom pipeline stages');

      // Build stages with positions
      const stagesToCreate = validated.stages.map((stage, index) => ({
        user_id: user.id,
        vertical: 'custom',
        stage_key: stage.stage_key,
        stage_label: stage.stage_label,
        position: index,
        color: stage.color || null
      }));

      const result = await crmPipelineStagesRepository.createMany(stagesToCreate);

      if (result.error) {
        requestLogger.error({ err: result.error, userId: user.id }, 'Failed to create custom stages');
        return NextResponse.json(
          { success: false, error: 'Failed to create custom stages' },
          { status: 500 }
        );
      }

      return NextResponse.json({
        success: true,
        stages: result.data
      });
    }

    // Otherwise, create a single stage
    const validated = createStageSchema.parse(body);

    requestLogger.info({ userId: user.id, stageKey: validated.stage_key }, 'Creating pipeline stage');

    const result = await crmPipelineStagesRepository.create({
      user_id: user.id,
      ...validated
    });

    if (result.error) {
      requestLogger.error({ err: result.error, userId: user.id }, 'Failed to create pipeline stage');
      return NextResponse.json(
        { success: false, error: 'Failed to create pipeline stage' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      stage: result.data
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

    requestLogger.error({ err: error }, 'Request failed');
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
