/**
 * Business OS chat — v4.
 *
 * POST /api/business-os/chat-v4
 *
 * The whole turn:
 *
 *   message → planner (1 small LLM call) → validate → compile → execute → render
 *
 * Only the first step involves a model. Everything after it is deterministic and
 * catalog-driven, which is what makes the turn cheap, testable and safe.
 *
 * Compared with what it replaces:
 *   chat-v2  1–11 gpt-4o calls/turn, ~285-line prompt re-sent each iteration,
 *            ~10 DB queries of unused context, plus a second call for prose.
 *   chat-v3  1 call, but 33 tool schemas serialised every turn, and a regex
 *            classifier backed by 230 canned sentences.
 *   v4       1 call, ~1,400 input tokens, no phrasing examples anywhere, and the
 *            answer sentence rides in the plan so there is no second call.
 *
 * @module app/api/business-os/chat-v4
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getUser } from '@/lib/auth';
import { createLogger } from '@/lib/logger';
import { AuditTrailService } from '@/lib/services/AuditTrailService';
import { businessProfileRepository } from '@/lib/repositories/BusinessProfileRepository';
import { getBizQLPlanner } from '@/lib/business-os/bizql/planner/Planner';
import { runBusinessQuery } from '@/lib/business-os/bizql';
import {
  BizQLValidationError,
  ResultSetTooLargeError,
  type QueryResult,
} from '@/lib/business-os/bizql/types';
import { renderAnswer, type RenderedAnswer } from '@/lib/business-os/bizql/render/AnswerRenderer';
import { getPlanCache, type CacheLayer } from '@/lib/business-os/bizql/cache/PlanCache';
import { executeMutate, requiresConfirmation } from '@/lib/business-os/bizql/mutate/MutateExecutor';
import {
  getConfirmationStore,
  readConfirmationReply,
} from '@/lib/business-os/bizql/mutate/ConfirmationStore';
import { executeForEach } from '@/lib/business-os/bizql/mutate/ForEachExecutor';
import type { ForEachQuery, MutateQuery, QueryRow } from '@/lib/business-os/bizql/types';
import { CATALOG_VERSION } from '@/lib/business-os/catalog';
import type { Plan } from '@/lib/business-os/bizql/planner/Planner';

const logger = createLogger({ module: 'BusinessChatV4' });
const auditTrail = AuditTrailService.getInstance();

const RequestSchema = z.object({
  message: z.string().min(1).max(2000),
  /** Optional override; otherwise taken from the user's business profile. */
  language: z.enum(['en', 'he', 'es']).optional(),
});

interface ChatV4Response {
  success: boolean;
  answer?: RenderedAnswer;
  /** Set when a write is parked awaiting an explicit yes. */
  confirmation?: { id: string; message: string; preview: string[] };
  /** Set when the request was too ambiguous to plan — ask, never guess. */
  clarification?: string;
  error?: string;
  debug?: {
    catalogVersion: string;
    model: string;
    promptTokens?: number;
    completionTokens?: number;
    repairAttempted: boolean;
    planningMs: number;
    executionMs: number;
    /** Which layer answered: exact / semantic / miss. */
    cache: CacheLayer;
    plan?: unknown;
  };
}

export async function POST(request: NextRequest): Promise<NextResponse<ChatV4Response>> {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId });

  try {
    // 1. Authenticate. userId comes from the session and is the ONLY source of
    //    tenant scoping — the compiler injects it and never reads it from input.
    const user = await getUser();
    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    // 2. Validate input
    const parsed = RequestSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: 'Invalid request' },
        { status: 400 }
      );
    }
    const { message } = parsed.data;

    // 3. Load presentation preferences. Language, currency and timezone drive
    //    the renderer, so no formatting is hardcoded per locale.
    const profileResult = await businessProfileRepository.findByUserId(user.id);
    const profile = profileResult.data;
    const language = parsed.data.language ?? (profile?.language as 'en' | 'he' | 'es') ?? 'en';
    const timezone = profile?.timezone ?? 'UTC';
    const currency = profile?.currency ?? 'USD';

    // 4. A pending write takes precedence over planning.
    //
    // Checked first, and ONLY when something is actually parked, so a bare "yes"
    // can never be interpreted in isolation. An unrecognised reply falls through
    // to the planner rather than being read as approval.
    const confirmations = getConfirmationStore();
    const pending = await confirmations.take(user.id);

    if (pending) {
      const reply = readConfirmationReply(message);

      if (reply === 'cancel') {
        await confirmations.clear(user.id);
        return NextResponse.json({
          success: true,
          answer: {
            text: 'Cancelled — nothing was changed.',
            rows: [],
            truncated: false,
            approximate: false,
          },
        });
      }

      if (reply === 'confirm') {
        await confirmations.clear(user.id);

        // Replay the FROZEN steps. Deliberately not re-planned: the user
        // approved these exact writes against these exact rows, and re-deriving
        // them could act on a set that changed in between.
        const applied: string[] = [];

        for (const step of pending.steps) {
          if (step.op === 'for_each') {
            // The rows were resolved and frozen at preview time and travel with
            // the pending write, so no query runs here. Re-querying is exactly
            // how a user ends up approving 12 recipients and emailing 40.
            const result = await executeForEach(
              step as unknown as ForEachQuery,
              (pending.frozenRows?.[step.id ?? ''] ?? []) as QueryRow[],
              { userId: user.id, timezone, consumer: 'chat' },
              { planId: pending.confirmationId, language }
            );

            applied.push(
              result.failed > 0 || result.skipped > 0
                ? `sent to ${result.succeeded} of ${result.attempted}` +
                    (result.failed ? `, ${result.failed} failed` : '') +
                    (result.skipped ? `, ${result.skipped} already done` : '')
                : `sent to ${result.succeeded}`
            );
            continue;
          }

          const result = await executeMutate(
            step as MutateQuery,
            { userId: user.id, timezone, consumer: 'chat' },
            { language }
          );
          applied.push(result.preview ?? `${step.entity}.${step.action}`);
        }

        auditTrail
          .log({
            action: 'BUSINESS_CHAT_WRITE',
            userId: user.id,
            entityType: 'system',
            entityId: pending.confirmationId,
            resourceName: pending.steps.map((s) => `${s.entity}.${s.action}`).join(','),
            severity: 'warning',
            request,
          })
          .catch((err) => requestLogger.error({ err }, 'Audit failed (non-blocking)'));

        requestLogger.info(
          { userId: user.id, steps: pending.steps.length },
          'Confirmed write applied'
        );

        return NextResponse.json({
          success: true,
          answer: {
            text: `Done — ${applied.join('; ')}.`,
            rows: [],
            truncated: false,
            approximate: false,
          },
        });
      }

      // Anything else: drop the stale confirmation and treat this as a new
      // request. Leaving it parked would let a later "yes" apply to it.
      await confirmations.clear(user.id);
    }

    // 5. Plan. The planner handles its own caching, so a repeated question
    // never reaches the model at all.
    const planningStart = Date.now();
    const outcome = await getBizQLPlanner().plan({
      message,
      userId: user.id,
      language,
      timezone,
    });

    const plannerModel = outcome.diagnostics.model;
    const promptTokens = outcome.diagnostics.promptTokens ?? 0;
    const completionTokens = outcome.diagnostics.completionTokens ?? 0;
    const repairAttempted = outcome.diagnostics.repairAttempted;
    const cacheLayer = outcome.diagnostics.cache;
    const cacheEntryId = outcome.diagnostics.cacheEntryId;

    const clarification = outcome.clarification;
    const plan: Plan | undefined = outcome.plan;

    {
      if (!outcome.ok) {
        requestLogger.warn({ userId: user.id, error: outcome.error }, 'Planning failed');
        return NextResponse.json(
          {
            success: false,
            error: "I couldn't work out how to answer that. Could you rephrase it?",
            debug: process.env.NODE_ENV === 'development'
              ? {
                  catalogVersion: CATALOG_VERSION,
                  model: plannerModel,
                  promptTokens,
                  completionTokens,
                  repairAttempted,
                  planningMs: Date.now() - planningStart,
                  executionMs: 0,
                  cache: cacheLayer,
                }
              : undefined,
          },
          { status: 200 }
        );
      }
    }

    const planningMs = Date.now() - planningStart;

    const debug =
      process.env.NODE_ENV === 'development'
        ? {
            catalogVersion: CATALOG_VERSION,
            model: plannerModel,
            promptTokens,
            completionTokens,
            repairAttempted,
            planningMs,
            executionMs: 0,
            cache: cacheLayer,
            plan: plan?.steps,
          }
        : undefined;

    // The planner may decline to guess — that is a feature, not a failure.
    if (clarification) {
      return NextResponse.json({ success: true, clarification, debug });
    }

    if (!plan) {
      return NextResponse.json(
        { success: false, error: "I couldn't work out how to answer that.", debug },
        { status: 200 }
      );
    }

    // 6. Writes: preview and park rather than execute.
    const writes = plan.steps.filter(
      (s): s is MutateQuery | ForEachQuery => s.op === 'mutate' || s.op === 'for_each'
    );

    if (writes.length > 0) {
      const previews: string[] = [];
      const frozenRows: Record<string, QueryRow[]> = {};

      for (const step of writes) {
        if (step.op === 'for_each') {
          // Resolve the target rows NOW and freeze them. The user must confirm a
          // concrete set of people, not a query that might match a different set
          // by the time they say yes.
          const source = plan.steps.find((s) => s.id === step.over);
          if (!source || source.op !== 'find') {
            throw new BizQLValidationError([
              `for_each 'over' must reference an earlier find step; '${step.over}' is not one.`,
            ]);
          }

          const rows = await runBusinessQuery(source, {
            userId: user.id,
            timezone,
            consumer: 'chat',
          });
          if (rows.op !== 'find') continue;

          frozenRows[step.id ?? ''] = rows.rows;

          const preview = await executeForEach(
            step,
            rows.rows,
            { userId: user.id, timezone, consumer: 'chat' },
            { planId: 'preview', dryRun: true, language }
          );

          const sample = preview.items
            .slice(0, 5)
            .map((i) => i.target ?? i.id)
            .join(', ');

          previews.push(
            `${preview.attempted} recipient${preview.attempted === 1 ? '' : 's'}` +
              (sample ? ` — ${sample}${preview.attempted > 5 ? ', …' : ''}` : '')
          );
          continue;
        }

        // Dry run validates and describes without touching anything.
        const result = await executeMutate(
          step,
          { userId: user.id, timezone, consumer: 'chat' },
          { dryRun: true, language }
        );
        previews.push(result.preview ?? `${step.entity}.${step.action}`);
      }

      // Fan-out ALWAYS confirms, whatever the action's own policy says. Acting
      // on many rows at once is categorically different from acting on one.
      const needsConfirmation =
        writes.some((s) => s.op === 'for_each') ||
        writes.some((s) => s.op === 'mutate' && requiresConfirmation(s));

      if (needsConfirmation) {
        const parked = await confirmations.park({
          userId: user.id,
          steps: writes,
          preview: previews,
          utterance: message,
          language,
          frozenRows,
        });

        return NextResponse.json({
          success: true,
          confirmation: {
            id: parked.confirmationId,
            message: plan.answer?.text || 'Confirm this change?',
            preview: previews,
          },
          debug,
        });
      }

      // Low-risk and explicitly targeted: apply directly. Only single mutates
      // reach here — fan-out always went through confirmation above.
      const applied: string[] = [];
      for (const step of writes) {
        if (step.op === 'for_each') continue;
        const result = await executeMutate(step, {
          userId: user.id,
          timezone,
          consumer: 'chat',
        });
        applied.push(result.preview ?? `${step.entity}.${step.action}`);
      }

      return NextResponse.json({
        success: true,
        answer: {
          text: `Done — ${applied.join('; ')}.`,
          rows: [],
          truncated: false,
          approximate: false,
        },
        debug,
      });
    }

    // 7. Execute reads. Every step is compiled and user-scoped by the compiler.
    const executionStart = Date.now();
    const results: QueryResult[] = [];

    try {
      for (const step of plan.steps.filter((s) => s.op !== 'mutate')) {
        results.push(
          await runBusinessQuery(step, { userId: user.id, timezone, consumer: 'chat' })
        );
      }
    } catch (err) {
      // A cached plan that no longer compiles must be demoted, or it is served
      // forever. Two failures with no successes and it stops being returned.
      if (cacheEntryId) {
        await getPlanCache()
          .recordOutcome(cacheEntryId, false)
          .catch(() => {});
      }
      throw err;
    }
    const executionMs = Date.now() - executionStart;

    // 8. Render — substitution into the planner's own sentence, no templates.
    const answer = renderAnswer(plan.answer?.text, plan.steps, results, {
      language,
      currency,
      timezone,
    });

    // 9. Confirm the served plan actually worked, so a bad entry gets demoted.
    // Storing happens inside the planner, on a fresh successful plan only.
    if (cacheEntryId) {
      getPlanCache()
        .recordOutcome(cacheEntryId, true)
        .catch((err) => requestLogger.debug({ err }, 'Outcome record failed (non-blocking)'));
    }

    // 10. Audit (non-blocking)
    auditTrail
      .log({
        action: 'BUSINESS_CHAT_QUERY',
        userId: user.id,
        entityType: 'system',
        entityId: correlationId,
        resourceName: answer.entity ?? 'query',
        request,
      })
      .catch((err) => requestLogger.error({ err }, 'Audit failed (non-blocking)'));

    requestLogger.info(
      {
        userId: user.id,
        cache: cacheLayer,
        steps: plan.steps.length,
        rows: answer.rows.length,
        promptTokens,
        planningMs,
        executionMs,
      },
      'Chat v4 turn completed'
    );

    return NextResponse.json({
      success: true,
      answer,
      debug: debug ? { ...debug, executionMs } : undefined,
    });
  } catch (error) {
    // A query the catalog rejects is the user's problem to rephrase, not a
    // server fault — and the message names what was wrong, so surface it.
    if (error instanceof BizQLValidationError) {
      requestLogger.warn({ problems: error.problems }, 'Query rejected by the catalog');
      return NextResponse.json(
        {
          success: false,
          error:
            process.env.NODE_ENV === 'development'
              ? error.message
              : "I couldn't run that query. Could you rephrase it?",
        },
        { status: 200 }
      );
    }

    // Refusing an over-large scan is deliberate: a truncated anti-join would
    // produce a confidently wrong answer.
    if (error instanceof ResultSetTooLargeError) {
      requestLogger.warn({ entity: error.entity, count: error.count }, 'Result set too large');
      return NextResponse.json(
        {
          success: false,
          error:
            'That covers too much data to answer in one go. Try narrowing it — ' +
            'a date range, or a specific status.',
        },
        { status: 200 }
      );
    }

    requestLogger.error({ err: error }, 'Chat v4 turn failed');
    return NextResponse.json(
      {
        success: false,
        error:
          process.env.NODE_ENV === 'development'
            ? (error as Error).message
            : 'Internal server error',
      },
      { status: 500 }
    );
  }
}
