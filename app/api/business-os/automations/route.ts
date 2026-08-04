/**
 * Business OS Automations API
 *
 * Endpoints for managing standing automations:
 * - GET: Fetch user's automations
 * - POST: Create a new automation
 *
 * @see docs/INSIGHT_SYSTEM_PLAN.md
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getUser } from '@/lib/auth';
import { createLogger } from '@/lib/logger';
import { supabaseServer } from '@/lib/supabaseServer';
import { AutomationManager } from '@/lib/business-os/insight/automation';
import { InsightRepository } from '@/lib/business-os/insight/repository';

const logger = createLogger({ module: 'AutomationsAPI' });

// ===========================
// Schemas
// ===========================

const createAutomationSchema = z.object({
  insightId: z.string().uuid().optional(),
  detectorId: z.string().optional(),
  processParameters: z.record(z.unknown()).optional(),
  checkIntervalMinutes: z.number().min(5).max(1440).optional(),
  maxItemsPerRun: z.number().min(1).max(100).optional(),
  quietHoursStart: z.number().min(0).max(23).optional(),
  quietHoursEnd: z.number().min(0).max(23).optional(),
});

// ===========================
// GET - Fetch automations
// ===========================

export async function GET(request: NextRequest) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId });

  try {
    const user = await getUser();
    if (!user) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const manager = new AutomationManager(supabaseServer);
    const automations = await manager.getForUser(user.id);

    requestLogger.info(
      { userId: user.id, count: automations.length },
      'Fetched automations'
    );

    return NextResponse.json({
      success: true,
      data: { automations },
    });

  } catch (error) {
    requestLogger.error({ err: error }, 'Failed to fetch automations');

    return NextResponse.json(
      {
        success: false,
        error: 'Failed to fetch automations',
        details: process.env.NODE_ENV === 'development' ? String(error) : undefined,
      },
      { status: 500 }
    );
  }
}

// ===========================
// POST - Create automation
// ===========================

export async function POST(request: NextRequest) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId });

  try {
    const user = await getUser();
    if (!user) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const body = await request.json();
    const params = createAutomationSchema.parse(body);

    const manager = new AutomationManager(supabaseServer);
    let automation;

    if (params.insightId) {
      // Create from insight
      const repository = new InsightRepository(supabaseServer);
      const insightResult = await repository.findById(params.insightId, user.id);

      if (!insightResult.data) {
        return NextResponse.json(
          { success: false, error: 'Insight not found' },
          { status: 404 }
        );
      }

      automation = await manager.createFromInsight(insightResult.data, {
        processParameters: params.processParameters,
        checkIntervalMinutes: params.checkIntervalMinutes,
        maxItemsPerRun: params.maxItemsPerRun,
        quietHoursStart: params.quietHoursStart,
        quietHoursEnd: params.quietHoursEnd,
      });

    } else if (params.detectorId) {
      // Create directly from detector
      automation = await manager.create({
        userId: user.id,
        detectorId: params.detectorId,
        triggerCondition: {},
        processParameters: params.processParameters,
        checkIntervalMinutes: params.checkIntervalMinutes,
        maxItemsPerRun: params.maxItemsPerRun,
        quietHoursStart: params.quietHoursStart,
        quietHoursEnd: params.quietHoursEnd,
      });

    } else {
      return NextResponse.json(
        { success: false, error: 'Either insightId or detectorId is required' },
        { status: 400 }
      );
    }

    if (!automation) {
      return NextResponse.json(
        { success: false, error: 'Failed to create automation - detector may not be eligible' },
        { status: 400 }
      );
    }

    requestLogger.info(
      { userId: user.id, automationId: automation.id },
      'Automation created'
    );

    return NextResponse.json({
      success: true,
      data: { automation },
    });

  } catch (error) {
    requestLogger.error({ err: error }, 'Failed to create automation');

    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { success: false, error: 'Invalid parameters', details: error.errors },
        { status: 400 }
      );
    }

    return NextResponse.json(
      {
        success: false,
        error: 'Failed to create automation',
        details: process.env.NODE_ENV === 'development' ? String(error) : undefined,
      },
      { status: 500 }
    );
  }
}
