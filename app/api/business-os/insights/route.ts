/**
 * Business OS Insights API
 *
 * Endpoints for managing insights:
 * - GET: Fetch active insights for a user
 * - POST: Trigger an action on an insight
 * - PATCH: Update insight status (view, snooze, dismiss)
 *
 * @see docs/INSIGHT_SYSTEM_PLAN.md
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getUser } from '@/lib/auth';
import { createLogger } from '@/lib/logger';
import { supabaseServer } from '@/lib/supabaseServer';
import { InsightRepository } from '@/lib/business-os/insight/repository';
import { KernelTrigger } from '@/lib/business-os/insight/kernel';
import { ImpactProjector } from '@/lib/business-os/insight/projection';
import { AutonomousWorkFeed } from '@/lib/business-os/insight/reporting';

const logger = createLogger({ module: 'InsightsAPI' });

// ===========================
// Schemas
// ===========================

const getInsightsSchema = z.object({
  status: z.enum(['new', 'viewed', 'snoozed', 'dismissed', 'acted', 'automated']).optional(),
  limit: z.coerce.number().min(1).max(50).optional().default(10),
  includeProjection: z.coerce.boolean().optional().default(false),
});

const actionSchema = z.object({
  insightId: z.string().uuid(),
  action: z.enum(['run', 'automate', 'snooze', 'dismiss', 'view']),
  parameters: z.record(z.unknown()).optional(),
  snoozeUntil: z.string().datetime().optional(),
  dismissReason: z.string().optional(),
});

// ===========================
// GET - Fetch insights
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

    const searchParams = Object.fromEntries(request.nextUrl.searchParams);
    const params = getInsightsSchema.parse(searchParams);

    const repository = new InsightRepository(supabaseServer);

    let insights;
    if (params.status) {
      const result = await repository.findByStatus(user.id, params.status, params.limit);
      insights = result.data || [];
    } else {
      const result = await repository.findActive(user.id, params.limit);
      insights = result.data || [];
    }

    // Include projections if requested
    let insightsWithProjections = insights;
    if (params.includeProjection && insights.length > 0) {
      const projector = new ImpactProjector(supabaseServer);
      insightsWithProjections = await Promise.all(
        insights.map(async (insight) => {
          const projection = await projector.project(insight);
          return { ...insight, projection };
        })
      );
    }

    // Also get autonomous work feed
    const workFeed = new AutonomousWorkFeed(supabaseServer);
    const myDayData = await workFeed.getMyDayData(user.id);

    requestLogger.info(
      { userId: user.id, insightCount: insights.length },
      'Fetched insights'
    );

    return NextResponse.json({
      success: true,
      data: {
        insights: insightsWithProjections,
        autonomousWork: myDayData.completedWork,
        stats: myDayData.stats,
      },
    });

  } catch (error) {
    requestLogger.error({ err: error }, 'Failed to fetch insights');

    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { success: false, error: 'Invalid parameters', details: error.errors },
        { status: 400 }
      );
    }

    return NextResponse.json(
      {
        success: false,
        error: 'Failed to fetch insights',
        details: process.env.NODE_ENV === 'development' ? String(error) : undefined,
      },
      { status: 500 }
    );
  }
}

// ===========================
// POST - Take action on insight
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
    const params = actionSchema.parse(body);

    const repository = new InsightRepository(supabaseServer);

    // Get the insight
    const insightResult = await repository.findById(params.insightId, user.id);
    if (!insightResult.data) {
      return NextResponse.json(
        { success: false, error: 'Insight not found' },
        { status: 404 }
      );
    }

    const insight = insightResult.data;

    switch (params.action) {
      case 'run': {
        // Trigger the paired process
        if (!insight.paired_process_id) {
          return NextResponse.json(
            { success: false, error: 'No action available for this insight' },
            { status: 400 }
          );
        }

        const trigger = new KernelTrigger(supabaseServer);
        const result = await trigger.trigger({
          processId: insight.paired_process_id,
          userId: user.id,
          triggeredBy: 'insight',
          insightId: insight.id,
          parameters: params.parameters || insight.process_parameters || {},
          entityIds: insight.affected_entity_ids,
        });

        if (result.status === 'failed') {
          return NextResponse.json(
            { success: false, error: result.error },
            { status: 400 }
          );
        }

        // Mark insight as acted
        await repository.markActed(insight.id, user.id, result.executionId);

        requestLogger.info(
          { userId: user.id, insightId: insight.id, executionId: result.executionId },
          'Insight action triggered'
        );

        return NextResponse.json({
          success: true,
          data: {
            executionId: result.executionId,
            status: result.status,
            summary: result.summary,
            outcome: {
              itemsProcessed: result.itemsProcessed,
              itemsSucceeded: result.itemsSucceeded,
              itemsFailed: result.itemsFailed,
              valueImpact: result.valueImpact,
            },
          },
        });
      }

      case 'automate': {
        // Create standing automation (Phase 4)
        // For now, just return a placeholder
        return NextResponse.json({
          success: true,
          data: {
            message: 'Automation creation coming in Phase 4',
          },
        });
      }

      case 'snooze': {
        if (!params.snoozeUntil) {
          return NextResponse.json(
            { success: false, error: 'snoozeUntil is required for snooze action' },
            { status: 400 }
          );
        }

        await repository.snooze(insight.id, user.id, new Date(params.snoozeUntil));

        requestLogger.info(
          { userId: user.id, insightId: insight.id, until: params.snoozeUntil },
          'Insight snoozed'
        );

        return NextResponse.json({
          success: true,
          data: { status: 'snoozed', until: params.snoozeUntil },
        });
      }

      case 'dismiss': {
        await repository.dismiss(insight.id, user.id, params.dismissReason);

        requestLogger.info(
          { userId: user.id, insightId: insight.id, reason: params.dismissReason },
          'Insight dismissed'
        );

        return NextResponse.json({
          success: true,
          data: { status: 'dismissed' },
        });
      }

      case 'view': {
        await repository.markSurfaced(insight.id, user.id);
        await repository.updateStatus(insight.id, user.id, 'viewed');

        return NextResponse.json({
          success: true,
          data: { status: 'viewed' },
        });
      }

      default:
        return NextResponse.json(
          { success: false, error: 'Unknown action' },
          { status: 400 }
        );
    }

  } catch (error) {
    requestLogger.error({ err: error }, 'Failed to process insight action');

    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { success: false, error: 'Invalid parameters', details: error.errors },
        { status: 400 }
      );
    }

    return NextResponse.json(
      {
        success: false,
        error: 'Failed to process action',
        details: process.env.NODE_ENV === 'development' ? String(error) : undefined,
      },
      { status: 500 }
    );
  }
}
