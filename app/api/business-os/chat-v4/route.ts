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
import { resolveUserCurrency } from '@/lib/business-os/userCurrency';
import { supabaseServer } from '@/lib/supabaseServer';
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
import {
  labelForRow,
  renderAnswer,
  type RenderedAnswer,
} from '@/lib/business-os/bizql/render/AnswerRenderer';
import { getPlanCache, type CacheLayer } from '@/lib/business-os/bizql/cache/PlanCache';
import {
  getConversationMemory,
  type ConversationContext,
} from '@/lib/business-os/bizql/memory/ConversationMemory';
import { executeMutate, requiresConfirmation } from '@/lib/business-os/bizql/mutate/MutateExecutor';
import { MissingFieldsError } from '@/lib/business-os/bizql/types';
import { checkBudget } from '@/lib/business-os/bizql/telemetry/ChatBudget';
import {
  getConfirmationStore,
  readConfirmationReply,
} from '@/lib/business-os/bizql/mutate/ConfirmationStore';
import { executeForEach } from '@/lib/business-os/bizql/mutate/ForEachExecutor';
import { applyFrozenWrites } from '@/lib/business-os/bizql/mutate/applyWrites';
import { resolveEmailBranding } from '@/lib/email/branding';
import {
  hasDescribedReferences,
  needsTargetResolution,
  resolveDescribedReferences,
  resolveMutateTarget,
  withResolvedTarget,
} from '@/lib/business-os/bizql/mutate/resolveTarget';
import type {
  FindQuery,
  FindResult,
  ForEachQuery,
  MutateQuery,
  QueryRow,
} from '@/lib/business-os/bizql/types';
import { CATALOG, CATALOG_VERSION } from '@/lib/business-os/catalog';
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
  /**
   * Set when a write named a row that resolved to none, or to more than one.
   *
   * Carries the FACTS only — which entity, how many matched — and no sentence.
   * The client owns the wording, because it already owns a translation
   * dictionary; a message written here would need one string per language per
   * outcome, which is the pattern this stack replaced.
   */
  choice?: { kind: 'none' | 'ambiguous'; entity: string; total: number };
  /**
   * How much of today's allowance is left.
   *
   * Present on EVERY response, not only when the limit is hit — a wall the user
   * did not see coming reads as a broken product, so the client can warn early.
   * Counted in questions rather than tokens because cost per question is nearly
   * constant here, and a person can act on questions.
   */
  budget?: {
    used: number;
    limit: number;
    remaining: number;
    warn: boolean;
    blocked: boolean;
    resetsAt: string;
  };
  /**
   * Set when a write is missing values the action requires.
   *
   * Field labels are resolved from the catalog in the user's language, so the
   * client supplies one framing sentence and never a string per field.
   */
  needs?: {
    entity: string;
    action: string;
    fields: Array<{ key: string; label: string }>;
  };
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
  // `x-correlation-id` is supplied by the caller and need not be a uuid, but
  // `token_usage.session_id` is a uuid column — a free-form value is dropped, and
  // with it the ability to group a turn's cost. Keep the caller's id for log
  // correlation, and use a uuid for the turn.
  const incomingCorrelationId = request.headers.get('x-correlation-id');
  const isUuid = (v: string | null): v is string =>
    !!v && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

  const turnId = isUuid(incomingCorrelationId) ? incomingCorrelationId : crypto.randomUUID();
  const correlationId = incomingCorrelationId ?? turnId;
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
    // Derived, not read off the profile: there is no currency column there, so
    // `profile.currency` was always undefined and every sum in the chat rendered
    // in dollars — including for a business invoicing in shekels.
    const currency = await resolveUserCurrency(supabaseServer, user.id);

    // 3b. Budget. Checked BEFORE planning, because planning is the cost — and
    //     before the pending-write branch, so a user at their limit can still
    //     confirm or cancel something already parked. Refusing a "yes" would
    //     leave a write in limbo through no fault of theirs.
    const budget = await checkBudget(user.id);

    const budgetPayload = {
      used: budget.turnsUsed,
      limit: budget.turnsLimit,
      remaining: budget.turnsRemaining,
      warn: budget.warn,
      blocked: !budget.allowed,
      resetsAt: budget.resetsAt,
    };

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
            collapsed: 0,
          },
        });
      }

      if (reply === 'confirm') {
        await confirmations.clear(user.id);

        // Replay the FROZEN steps. Deliberately not re-planned: the user
        // approved these exact writes against these exact rows, and re-deriving
        // them could act on a set that changed in between.
        //
        // Shared with the saved-plan re-run path — see applyWrites.ts. The two
        // must never drift on whether rows are re-queried.
        const { applied } = await applyFrozenWrites({
          steps: pending.steps as Array<MutateQuery | ForEachQuery>,
          frozenRows: pending.frozenRows as Record<string, QueryRow[]> | undefined,
          userId: user.id,
          planId: pending.confirmationId,
          timezone,
          language,
        });

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
            collapsed: 0,
          },
        });
      }

      // Anything else: drop the stale confirmation and treat this as a new
      // request. Leaving it parked would let a later "yes" apply to it.
      await confirmations.clear(user.id);
    }

    // 4b. Out of allowance. Refused here, after the confirm/cancel branch above
    //     and before any model call — so nothing is charged, and the reply says
    //     what happened and when it comes back rather than failing vaguely.
    //
    //     The message is composed by the CLIENT from these facts: it owns the
    //     translation dictionary, and a sentence written here would need one
    //     string per language for an outcome the user meets rarely.
    if (!budget.allowed) {
      requestLogger.warn(
        {
          userId: user.id,
          exceeded: budget.exceeded,
          turnsUsed: budget.turnsUsed,
          tokensUsed: budget.tokensUsed,
        },
        'Chat turn refused: daily allowance exhausted'
      );

      return NextResponse.json({
        success: true,
        answer: {
          text: '',
          rows: [],
          truncated: false,
          approximate: false,
          collapsed: 0,
        },
        // No `debug` here: it is built from the planner's own outputs — model,
        // token counts, the plan — and on this path the planner never ran. It is
        // also declared further down, so naming it here threw a ReferenceError
        // and turned the one branch whose whole job is to refuse gracefully into
        // a 500.
        budget: budgetPayload,
      });
    }

    // 5. Plan, with whatever the conversation has established so far.
    const conversation = getConversationMemory();
    const context = await conversation.load(user.id);

    const planningStart = Date.now();
    const outcome = await getBizQLPlanner().plan({
      message,
      userId: user.id,
      language,
      timezone,
      context,
      // Groups every usage row for this one question — the planner call, any
      // repair, and the zero-cost row written when the cache serves it.
      turnId,
    });

    /** Roll the window forward, keeping what the next turn will need. */
    const remember = (summary: string, extra: Partial<ConversationContext> = {}) => {
      void conversation
        .save(user.id, {
          ...context,
          ...extra,
          turns: [...context.turns, { utterance: message, summary, at: new Date().toISOString() }],
        })
        .catch((err) => requestLogger.debug({ err }, 'Context save failed (non-blocking)'));
    };

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
        // Surface WHY when the planner named a missing capability. "I couldn't
        // work out how to answer that" is useless feedback for "add a service"
        // when the real answer is "I can't create services yet" — the user has
        // no way to tell a misunderstanding from an unimplemented feature.
        const detail = outcome.error ?? '';
        const capabilityGap =
          /has no action|not implemented yet|unknown entity|unknown field/i.test(detail);

        return NextResponse.json(
          {
            success: false,
            error: capabilityGap
              ? `I can't do that yet — ${detail
                  .split('\n')
                  .pop()
                  ?.replace(/^steps\[\d+\][^:]*:\s*/, '')
                  .trim()}`
              : "I couldn't work out how to answer that. Could you rephrase it?",
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
      // Record the question. Without this the user's reply arrives as a fresh,
      // context-free request and the assistant asks the same thing again —
      // exactly the loop that made this unusable.
      remember(`asked: ${clarification}`, { pendingQuestion: clarification });
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

      // Resolve any described target ("invoice INV-00002") to a concrete row
      // FIRST, so everything downstream — preview, confirmation card, execution —
      // works on a literal id the user was shown.
      //
      // Ambiguity is a question, never a guess: two matching invoices means we
      // ask which, not that we pick one or write to both.
      // Each entry carries the step AND the human names resolved for it, so the
      // confirmation card can read "mark as paid: INV-00002 — contact: אופיר עמר"
      // rather than naming uuids the user has no way to check.
      interface ResolvedWrite {
        step: MutateQuery | ForEachQuery;
        targetName?: string;
        referenceNames?: Record<string, string>;
      }

      const resolved: ResolvedWrite[] = [];

      const resolveCtx = { userId: user.id, timezone, consumer: 'chat' as const };

      const askAbout = (
        kind: 'none' | 'ambiguous',
        entityKey: string,
        total: number,
        candidates: QueryRow[]
      ) => {
        const rendered = renderAnswer(
          undefined,
          [{ id: 'r', op: 'find', entity: entityKey } as FindQuery],
          [
            {
              op: 'find',
              entity: entityKey,
              rows: candidates,
              truncated: false,
            } as FindResult,
          ],
          { language, timezone, currency }
        );

        return NextResponse.json({
          success: true,
          answer: { ...rendered, text: '' },
          choice: { kind, entity: entityKey, total },
          budget: budgetPayload,
        debug,
        });
      };

      for (const step of writes) {
        if (step.op !== 'mutate') {
          resolved.push({ step });
          continue;
        }

        let current: MutateQuery = step;
        // Names, not ids, for the confirmation card the user actually reads.
        let targetName: string | undefined;
        let referenceNames: Record<string, string> | undefined;

        // A described foreign key — "an invoice FOR Ofir" — resolves the same way
        // a target does, and for the same reason: the planner has never seen a
        // row id and must not invent one.
        if (hasDescribedReferences(current)) {
          const refs = await resolveDescribedReferences(current, resolveCtx, language);

          if (refs.status !== 'resolved') {
            return askAbout(
              refs.status,
              refs.entity,
              refs.status === 'ambiguous' ? refs.total : 0,
              refs.status === 'ambiguous' ? refs.rows : []
            );
          }

          current = { ...current, data: refs.data as MutateQuery['data'] };
          referenceNames = refs.labels;
        }

        if (!needsTargetResolution(current)) {
          resolved.push({ step: current, referenceNames });
          continue;
        }

        const outcome = await resolveMutateTarget(current, {
          userId: user.id,
          timezone,
          consumer: 'chat',
        });

        // Neither outcome below writes prose. The server says WHAT happened —
        // nothing matched, or several did — and the client phrases it from its
        // own translation dictionary. A message written here would need one
        // string per language per outcome, which is the pattern this stack
        // replaced.
        if (outcome.status !== 'resolved') {
          return askAbout(
            outcome.status,
            step.entity,
            outcome.status === 'ambiguous' ? outcome.total : 0,
            outcome.status === 'ambiguous' ? outcome.rows : []
          );
        }

        targetName = labelForRow(step.entity, outcome.row, { language, timezone, currency });
        resolved.push({
          step: withResolvedTarget(current, outcome.id),
          targetName,
          referenceNames,
        });
      }

      for (const { step, targetName, referenceNames } of resolved) {
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
        try {
          const result = await executeMutate(
            step,
            { userId: user.id, timezone, consumer: 'chat' },
            { dryRun: true, language, targetName, referenceNames, utterance: message }
          );
          previews.push(result.preview ?? `${step.entity}.${step.action}`);
        } catch (err) {
          // "add a new service" is a reasonable thing to say — it just does not
          // yet contain a name or a duration. Asking is the correct outcome, and
          // deciding it here rather than in the prompt is what makes it happen
          // every time instead of most of the time.
          if (!(err instanceof MissingFieldsError)) throw err;

          const entity = CATALOG.entities[err.entity];

          return NextResponse.json({
            success: true,
            answer: {
              text: '',
              rows: [],
              entity: err.entity,
              truncated: false,
              approximate: false,
              collapsed: 0,
            },
            needs: {
              entity: err.entity,
              action: err.action,
              // Labelled from the catalog, in the user's language, so the client
              // needs one framing sentence rather than a string per field.
              fields: err.fields.map((key) => ({
                key,
                label:
                  entity?.fields[key]?.labels[language as 'en'] ??
                  entity?.fields[key]?.labels.en ??
                  key,
              })),
            },
            budget: budgetPayload,
        debug,
          });
        }
      }

      // Fan-out ALWAYS confirms, whatever the action's own policy says. Acting
      // on many rows at once is categorically different from acting on one.
      const needsConfirmation =
        writes.some((s) => s.op === 'for_each') ||
        writes.some((s) => s.op === 'mutate' && requiresConfirmation(s));

      if (needsConfirmation) {
        const parked = await confirmations.park({
          userId: user.id,
          steps: resolved.map((r) => r.step),
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
          budget: budgetPayload,
        debug,
        });
      }

      // Low-risk and explicitly targeted: apply directly. Only single mutates
      // reach here — fan-out always went through confirmation above.
      //
      // Iterates the RESOLVED writes, not the originals. Iterating `writes` here
      // would hand the executor a target it had already refused to accept
      // unresolved, so every low-risk update naming its row — "change Yael's
      // phone number" — would have thrown after the preview had just succeeded.
      const applied: string[] = [];
      for (const { step, targetName, referenceNames } of resolved) {
        if (step.op === 'for_each') continue;
        const result = await executeMutate(
          step,
          { userId: user.id, timezone, consumer: 'chat' },
          { language, targetName, referenceNames, utterance: message }
        );
        applied.push(result.preview ?? `${step.entity}.${step.action}`);
      }

      return NextResponse.json({
        success: true,
        answer: {
          text: `Done — ${applied.join('; ')}.`,
          rows: [],
          truncated: false,
          approximate: false,
          collapsed: 0,
        },
        budget: budgetPayload,
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

    // Remember what was shown, so "it" / "him" / "the second one" resolve next
    // turn. Ids and labels only — this is context, not a copy of the data.
    const primary = results.find((r) => r.op === 'find');
    remember(
      plan.steps.map((step) => `${step.op} ${step.entity}`).join(', '),
      {
        pendingQuestion: undefined,
        lastRows:
          primary?.op === 'find' && answer.rows.length > 0
            ? {
                entity: primary.entity,
                items: answer.rows.map((r) => ({ id: r.id, label: r.label })),
                at: new Date().toISOString(),
              }
            : context.lastRows,
      }
    );

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
      // The turn just consumed one, so report the state INCLUDING it rather
      // than the stale pre-turn count — otherwise the last question before the
      // limit still shows one remaining.
      budget: { ...budgetPayload, used: budget.turnsUsed + 1, remaining: Math.max(0, budget.turnsRemaining - 1) },
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
