/**
 * Saved plans — list and save.
 *
 * A saved plan is a piece of chat work the user can run again. See
 * `lib/business-os/bizql/saved/SavedPlanStore.ts` for why it stores the plan
 * UNRESOLVED.
 *
 * @module app/api/business-os/saved-plans
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getUser } from '@/lib/auth';
import { createLogger } from '@/lib/logger';
import { AuditTrailService } from '@/lib/services/AuditTrailService';
import { getSavedPlanStore } from '@/lib/business-os/bizql/saved/SavedPlanStore';
import { normalizePlan, validatePlan } from '@/lib/business-os/bizql/planner/validatePlan';
import type { Plan } from '@/lib/business-os/bizql/planner/Planner';
import type { Query } from '@/lib/business-os/bizql/types';

const logger = createLogger({ module: 'SavedPlansAPI' });
const auditTrail = AuditTrailService.getInstance();

const SaveSchema = z.object({
  name: z.string().min(1).max(80),
  utterance: z.string().min(1).max(2000),
  steps: z.array(z.record(z.unknown())).min(1).max(5),
  answerText: z.string().max(2000).optional(),
});

export async function GET() {
  try {
    const user = await getUser();
    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const plans = await getSavedPlanStore().list(user.id);

    return NextResponse.json({
      success: true,
      data: plans.map((p) => ({
        id: p.id,
        name: p.name,
        utterance: p.utterance,
        isActive: p.is_active,
        disabledReason: p.disabled_reason,
        runCount: p.run_count,
        lastRunAt: p.last_run_at,
        lastRunSummary: p.last_run_summary,
        // Steps are deliberately not returned: they are an internal IR, and a
        // client that renders them will start depending on their shape.
        writes: p.steps.filter((s) => s.op === 'mutate' || s.op === 'for_each').length,
      })),
    });
  } catch (error) {
    logger.error({ err: error }, 'Failed to list saved plans');
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId });

  try {
    const user = await getUser();
    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const parsed = SaveSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json({ success: false, error: 'Invalid request' }, { status: 400 });
    }

    // Validate BEFORE storing. A plan that cannot run is not worth keeping, and
    // storing one means the failure surfaces later, detached from the action
    // that caused it.
    const candidate = { steps: parsed.data.steps as unknown as Query[] } as Plan;
    normalizePlan(candidate);
    const problems = validatePlan(candidate);

    if (problems.length > 0) {
      requestLogger.warn({ userId: user.id, problems }, 'Refused to save an invalid plan');
      return NextResponse.json(
        { success: false, error: 'That plan is not valid, so it was not saved.', details: problems },
        { status: 400 }
      );
    }

    const saved = await getSavedPlanStore().save({
      userId: user.id,
      name: parsed.data.name,
      utterance: parsed.data.utterance,
      steps: candidate.steps as Query[],
      answerText: parsed.data.answerText,
    });

    if (!saved) {
      return NextResponse.json({ success: false, error: 'Could not save that.' }, { status: 500 });
    }

    auditTrail
      .log({
        action: 'BUSINESS_CHAT_PLAN_SAVED',
        userId: user.id,
        entityType: 'system',
        entityId: saved.id,
        resourceName: saved.name,
        request,
      })
      .catch((err) => requestLogger.error({ err }, 'Audit failed (non-blocking)'));

    return NextResponse.json({ success: true, data: { id: saved.id, name: saved.name } });
  } catch (error) {
    requestLogger.error({ err: error }, 'Failed to save plan');
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
