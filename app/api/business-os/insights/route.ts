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
import { enqueueInsightActions } from '@/lib/business-os/insight/automation/InsightActionEnqueuer';
import { TRIGGERABLE_PROCESSES } from '@/lib/business-os/insight/kernel/TriggerableProcesses';
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
  includeCorrelated: z.coerce.boolean().optional().default(true),
  includeHealthSummary: z.coerce.boolean().optional().default(true),
  includeVectorMaturity: z.coerce.boolean().optional().default(true),
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

    // Get correlated insights (unified story-driven insights)
    let correlatedInsights: Awaited<ReturnType<typeof repository.getCorrelatedInsights>>['data'] = [];
    if (params.includeCorrelated) {
      const correlatedResult = await repository.getCorrelatedInsights(user.id);
      correlatedInsights = correlatedResult.data || [];
    }

    // Get business health summary
    let healthSummary: Awaited<ReturnType<typeof repository.getLatestHealthSummary>>['data'] = null;
    if (params.includeHealthSummary) {
      const healthResult = await repository.getLatestHealthSummary(user.id);
      healthSummary = healthResult.data;
    }

    // Get vector maturity data (progressive data revelation)
    let vectorMaturity: Awaited<ReturnType<typeof repository.getVectorMaturity>>['data'] = null;
    if (params.includeVectorMaturity) {
      const vectorResult = await repository.getVectorMaturity(user.id);
      vectorMaturity = vectorResult.data;
    }

    // Returning an insight to the dashboard is the moment it reaches the user,
    // so it counts as surfaced. Detector cooldowns key off last_surfaced_at;
    // leaving it to the "opened it" action alone meant a detection nobody
    // clicked was re-detected every fifteen minutes for weeks.
    if (insights.length > 0) {
      await repository.markManySurfaced(insights, user.id);
    }

    // Also get autonomous work feed
    const workFeed = new AutonomousWorkFeed(supabaseServer);
    const myDayData = await workFeed.getMyDayData(user.id);

    requestLogger.info(
      {
        userId: user.id,
        insightCount: insights.length,
        correlatedCount: correlatedInsights?.length || 0,
        hasHealthSummary: !!healthSummary,
        maturityLevel: vectorMaturity?.maturityLevel,
        litVectors: vectorMaturity?.litCount,
      },
      'Fetched insights'
    );

    return NextResponse.json({
      success: true,
      data: {
        // Vector maturity (progressive data revelation - which vectors are active)
        vectorMaturity,
        // Correlated insights first (the "WOW" story-driven insights)
        correlatedInsights,
        // Health summary (executive overview)
        healthSummary,
        // Individual insights (non-correlated)
        insights: insightsWithProjections,
        // Autonomous work done by the system
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
        /*
         * Queue the work, do not call the kernel.
         *
         * This used to call `KernelTrigger.trigger()`, which ends at a throw —
         * 'Kernel process is not implemented; refusing rather than reporting
         * fabricated work'. The standing-automation path was moved onto the
         * durable queue; this manual button was left behind, so "Handle it for
         * me" returned an error every time it was pressed.
         *
         * Scope is unchanged and deliberate: THESE entities, from this insight,
         * once. A standing rule is the `automate` action below.
         */
        if (!insight.paired_process_id) {
          return NextResponse.json(
            { success: false, error: 'No action available for this insight' },
            { status: 400 }
          );
        }

        const queued = await enqueueInsightActions({
          userId: user.id,
          processId: insight.paired_process_id,
          detectorId: insight.detector_id,
          insightId: insight.id,
          detection: {
            affectedEntityType: insight.affected_entity_type,
            affectedEntityIds: insight.affected_entity_ids ?? [],
          } as never,
          parameters: params.parameters || insight.process_parameters || {},
        });

        if (queued.skipped) {
          /*
           * A refusal the owner should see rather than a silent success. The
           * enqueuer declines when a detector is wired to a process it cannot
           * target, which is a wiring fault, not a quiet day.
           */
          requestLogger.warn(
            { userId: user.id, insightId: insight.id, reason: queued.skipped },
            'Insight action could not be queued'
          );
          return NextResponse.json({ success: false, error: queued.skipped }, { status: 400 });
        }

        await repository.markActed(insight.id, user.id);

        requestLogger.info(
          { userId: user.id, insightId: insight.id, queued: queued.queued, duplicates: queued.duplicates },
          'Insight action queued'
        );

        return NextResponse.json({
          success: true,
          data: {
            /*
             * Reported as QUEUED, never as done. Nothing has been sent yet, and
             * the dispatcher re-checks every row before it sends — an invoice
             * paid in the meantime is skipped. Saying "sent" here would be the
             * same invention this module has already had to remove once.
             */
            queued: queued.queued,
            alreadyQueued: queued.duplicates,
            status: 'queued',
          },
        });
      }

      case 'automate': {
        /*
         * A standing rule, rather than one run over today's entities.
         *
         * Previously a placeholder that answered "coming in Phase 4" with
         * success: true, so the UI showed the automation as created and nothing
         * existed. `AutomationManager.runDueAutomations` already drains this
         * table, and `journeyAnchors.runningAutomations` already counts it — the
         * row was the only missing piece.
         */
        if (!insight.paired_process_id) {
          return NextResponse.json(
            { success: false, error: 'This insight has no process to automate' },
            { status: 400 }
          );
        }

        /*
         * Having a process is not the same as that process being automatable.
         *
         * `AutomationManager.createFromInsight` checks this and is not on the
         * API path, so this branch would happily create a standing automation
         * for a process marked `eligibleForAutomation: false` — one that then
         * runs every hour forever, produces no work, and tells nobody.
         *
         * Read from the process registry rather than the insight's own column:
         * whether a KIND of work may run unattended is a property of the work,
         * not of the row that happened to surface it.
         */
        const process = TRIGGERABLE_PROCESSES[insight.paired_process_id];

        if (!process?.eligibleForAutomation) {
          return NextResponse.json(
            { success: false, error: 'This one cannot be set up to run on its own' },
            { status: 400 }
          );
        }

        const created = await repository.createAutomation({
          userId: user.id,
          detectorId: insight.detector_id,
          processId: insight.paired_process_id,
          parameters: params.parameters || insight.process_parameters || {},
          insightId: insight.id,
        });

        if (created.error) {
          requestLogger.error(
            { err: created.error, userId: user.id, insightId: insight.id },
            'Could not create the standing automation'
          );
          return NextResponse.json(
            { success: false, error: 'Could not turn this on' },
            { status: 500 }
          );
        }

        await repository.markAutomated(insight.id, user.id);

        requestLogger.info(
          { userId: user.id, insightId: insight.id, detectorId: insight.detector_id },
          'Standing automation created'
        );

        return NextResponse.json({ success: true, data: { automationId: created.data?.id } });
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
        /*
         * Two different questions, answered differently.
         *
         * HOW MANY TIMES has this been put in front of the owner — every time,
         * because that is what the number means and what the card's "first time
         * I've seen this" line reads. Detector cooldowns depend on it too.
         *
         * HAS IT BEEN SEEN AT ALL — once. `updateStatus` writes a row into
         * `owner_insight_history`, and repeating that on every dashboard load
         * would bury the actions worth counting (acted, dismissed, snoozed)
         * under a view entry per page load. That history is the only thing that
         * can ever answer "does anyone do anything about what we surface", so
         * it must not be filled with noise.
         */
        await repository.markSurfaced(insight.id, user.id);

        if (insight.status === 'new') {
          await repository.updateStatus(insight.id, user.id, 'viewed');
        }

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
