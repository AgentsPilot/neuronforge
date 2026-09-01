/**
 * Run a saved plan.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THIS ROUTE NEVER WRITES.
 *
 * It re-validates the stored plan, resolves who it applies to RIGHT NOW, freezes
 * that set, and parks a confirmation. The user approves in the chat, and the
 * existing confirm path applies it — the same code, the same idempotency, the
 * same honest partial-failure reporting.
 *
 * Deliberately not a second approval mechanism. A saved plan that could execute
 * on its own would be a second, less-tested path to sending real email, and the
 * one thing this system has learned repeatedly is that a second path is where
 * the guarantees quietly stop holding.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * @module app/api/business-os/saved-plans/[id]/run
 */

import { NextRequest, NextResponse } from 'next/server';
import { getUser } from '@/lib/auth';
import { createLogger } from '@/lib/logger';
import { businessProfileRepository } from '@/lib/repositories/BusinessProfileRepository';
import { runBusinessQuery } from '@/lib/business-os/bizql';
import { executeMutate } from '@/lib/business-os/bizql/mutate/MutateExecutor';
import { executeForEach } from '@/lib/business-os/bizql/mutate/ForEachExecutor';
import { getConfirmationStore } from '@/lib/business-os/bizql/mutate/ConfirmationStore';
import {
  getSavedPlanStore,
  SavedPlanStaleError,
} from '@/lib/business-os/bizql/saved/SavedPlanStore';
import type {
  ForEachQuery,
  MutateQuery,
  QueryRow,
} from '@/lib/business-os/bizql/types';

const logger = createLogger({ module: 'SavedPlanRunAPI' });

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId });

  try {
    const user = await getUser();
    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await params;
    const store = getSavedPlanStore();
    const plan = await store.get(user.id, id);

    if (!plan) {
      return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 });
    }

    if (!plan.is_active) {
      return NextResponse.json(
        { success: false, error: plan.disabled_reason ?? 'That saved plan is disabled.' },
        { status: 409 }
      );
    }

    const profile = (await businessProfileRepository.findByUserId(user.id)).data;
    const language = (profile?.language as 'en' | 'he' | 'es') ?? 'en';
    const timezone = profile?.timezone ?? 'UTC';

    // 1. Re-validate against the LIVE catalog. A version match would not prove
    //    this — CATALOG_VERSION does not hash maxFanout or requiredFields.
    let steps;
    try {
      steps = await store.validateForRun(plan);
    } catch (err) {
      if (err instanceof SavedPlanStaleError) {
        return NextResponse.json(
          {
            success: false,
            error: 'That saved plan no longer works and has been turned off.',
            details: err.problems,
          },
          { status: 409 }
        );
      }
      throw err;
    }

    const ctx = { userId: user.id, timezone, consumer: 'chat' as const };

    // 2. Resolve who it applies to NOW. This is the whole point of storing the
    //    plan unresolved — March's run finds March's people.
    const readResults = new Map<string, QueryRow[]>();
    for (const step of steps) {
      if (step.op === 'mutate' || step.op === 'for_each') continue;
      const result = await runBusinessQuery(step, ctx);
      if (result.op === 'find') readResults.set(step.id ?? '', result.rows);
    }

    const writes = steps.filter(
      (s): s is MutateQuery | ForEachQuery => s.op === 'mutate' || s.op === 'for_each'
    );

    if (writes.length === 0) {
      return NextResponse.json(
        { success: false, error: 'That saved plan has nothing to apply.' },
        { status: 400 }
      );
    }

    // 3. Preview, without performing anything.
    const previews: string[] = [];
    const frozenRows: Record<string, QueryRow[]> = {};
    let totalTargets = 0;

    for (const step of writes) {
      if (step.op === 'for_each') {
        const rows = readResults.get(step.over) ?? [];
        frozenRows[step.id ?? ''] = rows;

        const preview = await executeForEach(step, rows, ctx, {
          planId: 'preview',
          dryRun: true,
          language,
        });

        totalTargets += preview.attempted;

        // attempted, NOT rows.length: ForEachExecutor dedupes by recipient, so
        // 7 invoices can be 4 emails. Showing the row count would have the user
        // approve a number that never happens.
        previews.push(
          `${preview.attempted} recipient${preview.attempted === 1 ? '' : 's'}` +
            (preview.items.length
              ? ` — ${preview.items.slice(0, 5).map((i) => i.target ?? i.id).join(', ')}` +
                (preview.attempted > 5 ? ', …' : '')
              : '')
        );
        continue;
      }

      const result = await executeMutate(step, ctx, { dryRun: true, language, utterance: plan.utterance });
      previews.push(result.preview ?? `${step.entity}.${step.action}`);
      totalTargets += 1;
    }

    // Nothing to do is a real answer, and a common one for a saved plan. Say so
    // rather than parking an empty confirmation the user has to dismiss.
    if (totalTargets === 0) {
      await store.recordRun(user.id, plan, 'nothing to do');
      return NextResponse.json({
        success: true,
        data: { nothingToDo: true, name: plan.name },
      });
    }

    // 4. Park it. Approval goes through the chat's existing confirm path.
    const parked = await getConfirmationStore().park({
      userId: user.id,
      steps: writes,
      preview: previews,
      utterance: plan.utterance,
      language,
      frozenRows,
    });

    await store.recordRun(user.id, plan, `proposed ${previews.join('; ')}`);

    requestLogger.info(
      { userId: user.id, planId: plan.id, targets: totalTargets },
      'Saved plan resolved and parked for approval'
    );

    return NextResponse.json({
      success: true,
      data: {
        confirmationId: parked.confirmationId,
        name: plan.name,
        preview: previews,
      },
    });
  } catch (error) {
    requestLogger.error({ err: error }, 'Failed to run saved plan');
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
