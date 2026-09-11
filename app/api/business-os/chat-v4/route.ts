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
import { loadUserEnumLabels } from '@/lib/business-os/bizql/planner/catalogPrompt';
import { recipientSummary } from '@/lib/business-os/bizql/mutate/previewSummary';
import { parseSpokenDate } from '@/lib/business-os/bizql/mutate/spokenDate';
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
import {
  describePlan,
  type Alternative,
  type Understanding,
} from '@/lib/business-os/bizql/render/describePlan';
import { applyAlternative } from '@/lib/business-os/bizql/render/applyAlternative';
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
import {
  getPendingFillStore,
  isCancelMessage,
} from '@/lib/business-os/bizql/mutate/PendingFillStore';
import { analyse } from '@/lib/business-os/bizql/analyse/AnalysisService';
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

/**
 * What a completed write is called, in the reader's language.
 *
 * The planner writes its answers in the user's language, so a Hebrew
 * conversation ended in a Hebrew sentence — except after a confirmed write,
 * where this route composed "Done — …" itself and the one English word in the
 * thread was the one confirming money or records had changed.
 */
const WRITE_DONE: Record<string, string> = {
  en: 'Done',
  he: 'בוצע',
  es: 'Hecho',
};

/** And what DECLINING one is called — the other half of the same exchange. */
const WRITE_CANCELLED: Record<string, string> = {
  en: 'Cancelled — nothing was changed.',
  he: 'בוטל — שום דבר לא שונה.',
  es: 'Cancelado — no se cambió nada.',
};

function writeDone(language: string): string {
  return WRITE_DONE[language] ?? WRITE_DONE.en;
}

function writeCancelled(language: string): string {
  return WRITE_CANCELLED[language] ?? WRITE_CANCELLED.en;
}

/**
 * Name the fields a write is still missing, in the reader's language.
 *
 * The label is what the user is shown; the column is where the answer is
 * written. Both come from the catalog, so neither is spelled out here — asking
 * for "title" and then writing to `title` are the same fact, and keeping them
 * together is what stops a rename from silently breaking the fill.
 */
function describeFields(
  entityKey: string,
  keys: string[],
  language: string
): Array<{ key: string; label: string }> {
  const entity = CATALOG.entities[entityKey];

  return keys.map((key) => ({
    key,
    label: entity?.fields[key]?.labels[language as 'en'] ?? entity?.fields[key]?.labels.en ?? key,
  }));
}

/**
 * What the chat says when it cannot answer, in the reader's language.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Every one of these was English, and two spliced the validator's own words
 * into the reply. A Hebrew conversation ended in:
 *
 *   "I can't do that yet — 'emails' has no action 'send'. Available: none."
 *
 * which names internal entities and actions the user has never heard of and
 * reads like the platform broke. It did not: the request was for something the
 * product genuinely cannot do yet, and saying so plainly is the whole job.
 *
 * The technical detail is not lost — it stays in the logs and in the dev-only
 * `debug` block, where the people who can act on it will look. What reaches the
 * user is one clear sentence about what happened and what to try.
 * ─────────────────────────────────────────────────────────────────────────────
 */
type ChatErrorKey = 'cannotYet' | 'notUnderstood' | 'tooMuchData' | 'unexpected';

const CHAT_ERRORS: Record<ChatErrorKey, Record<string, string>> = {
  /** The request was understood; the product cannot do it. */
  cannotYet: {
    en: "I can't do that yet. It isn't something I can handle at the moment — try asking for it a different way, or do it from the relevant screen.",
    he: 'זה עדיין לא משהו שאני יודע לעשות. אפשר לנסח את הבקשה אחרת, או לבצע את הפעולה מהמסך המתאים.',
    es: 'Todavía no puedo hacer eso. Prueba a pedirlo de otra forma, o hazlo desde la pantalla correspondiente.',
  },
  /** The request was not understood well enough to plan. */
  notUnderstood: {
    en: "I didn't quite follow that. Could you say it another way?",
    he: 'לא הצלחתי להבין את הבקשה. אפשר לנסח אותה אחרת?',
    es: 'No terminé de entenderlo. ¿Puedes decirlo de otra manera?',
  },
  /** Understood, but too broad to answer safely. */
  tooMuchData: {
    en: 'That covers too much data to answer in one go. Try narrowing it — a date range, or a specific status.',
    he: 'הבקשה מכסה יותר מדי נתונים לתשובה אחת. כדאי לצמצם — טווח תאריכים, או סטטוס מסוים.',
    es: 'Eso abarca demasiados datos para responder de una vez. Prueba a acotarlo — un rango de fechas, o un estado concreto.',
  },
  /**
   * Something actually went wrong on our side.
   *
   * Worded as a delay, not a fault. "Something went wrong" / "משהו השתבש"
   * reads as breakage to someone whose business records are in here, and
   * invites them to worry about their data rather than simply try again — a
   * transient failure should not sound like a lost invoice.
   */
  unexpected: {
    en: "I couldn't complete that just now. Please try again in a moment.",
    he: 'לא הצלחתי להשלים את הבקשה כרגע. אפשר לנסות שוב בעוד רגע.',
    es: 'No pude completarlo ahora mismo. Inténtalo de nuevo en un momento.',
  },
};

function chatError(key: ChatErrorKey, language: string): string {
  return CHAT_ERRORS[key][language] ?? CHAT_ERRORS[key].en;
}

const logger = createLogger({ module: 'BusinessChatV4' });
const auditTrail = AuditTrailService.getInstance();

const RequestSchema = z.object({
  message: z.string().min(1).max(2000),
  /** Optional override; otherwise taken from the user's business profile. */
  language: z.enum(['en', 'he', 'es']).optional(),
  /**
   * A tap on one of the alternatives offered beside the last answer.
   *
   * Deliberately tiny: which step, which field, which value. The PLAN it
   * applies to is the one this server stored for this user — never one posted
   * by the client — and every field here is checked against the catalog before
   * anything runs. See applyAlternative.
   */
  alternative: z
    .object({
      stepId: z.string().min(1).max(8),
      field: z.string().min(1).max(64),
      value: z.string().min(1).max(64),
      kind: z.enum(['enum', 'aggregate_field']),
      label: z.string().max(120).optional(),
    })
    .optional(),
});

interface ChatV4Response {
  success: boolean;
  answer?: RenderedAnswer;
  /** Set when a write is parked awaiting an explicit yes. */
  confirmation?: { id: string; message: string; preview: string[] };
  /** Set when the request was too ambiguous to plan — ask, never guess. */
  clarification?: string;
  /**
   * What the query actually did, and how to correct it in one tap.
   *
   * Present only when it earns its place — there is something to correct, the
   * answer came back empty, or this turn WAS a correction. On a plainly
   * successful turn it would be noise beside an answer nobody doubts.
   */
  understood?: Understanding;
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

  /*
   * The reader's language, reachable from the catch below.
   *
   * `language` is resolved inside the try, after the profile is read — so the
   * error paths that matter most, the unexpected ones, had no way to know what
   * language to apologise in. Held out here and assigned as soon as it is
   * known, defaulting to English only if the failure happened before that.
   */
  let resolvedLanguage = 'en';

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
    const { message, alternative } = parsed.data;

    // 3. Load presentation preferences. Language, currency and timezone drive
    //    the renderer, so no formatting is hardcoded per locale.
    const profileResult = await businessProfileRepository.findByUserId(user.id);
    const profile = profileResult.data;
    const language = parsed.data.language ?? (profile?.language as 'en' | 'he' | 'es') ?? 'en';
    resolvedLanguage = language;
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

    const confirmations = getConfirmationStore();

    /*
     * 4a. A write already under way takes precedence over EVERYTHING, planning
     *     included. While one is parked, the next message is a value — not a
     *     request to be interpreted.
     *
     * This is the difference between a state machine and a guess, and the guess
     * lost: "הוסף משימה לדויד המלך" -> "which title?" -> "לוודא שהוחזר הכסף"
     * used to come back as a list of refunds, because that reply is also a
     * perfectly good question about refunds. Carrying the pending question into
     * the prompt and asking the model to combine the two was tried first and
     * failed every one of nine runs across three phrasings.
     *
     * So nothing is inferred here. Mid-write, a reply fills the field; the only
     * way out is to cancel, which is a thing the user does on purpose.
     */
    const fills = getPendingFillStore();
    const inProgress = await fills.take(user.id);

    if (inProgress) {
      if (isCancelMessage(message)) {
        await fills.clear(user.id);
        return NextResponse.json({
          success: true,
          answer: {
            text: writeCancelled(language),
            rows: [],
            truncated: false,
            approximate: false,
            collapsed: 0,
          },
          budget: budgetPayload,
        });
      }

      const [answering, ...rest] = inProgress.remaining;
      const spoken = message.trim();

      /*
       * A date field takes a DATE, not the sentence someone answered with.
       *
       * "when is it due?" -> "9 בספטמבר" was stored as those five characters and
       * rejected by the column, so the same question was asked again for an
       * answer that could not have been clearer. `parseSpokenDate` reads it with
       * `Intl` month and weekday names in the reader's own language, and returns
       * null on anything ambiguous — where the old behaviour stands and the user
       * is asked again, which is the right outcome for a date nobody is sure of.
       */
      const answeringField =
        CATALOG.entities[inProgress.step.entity]?.fields[answering.key];
      const wantsDate =
        answeringField?.type === 'datetime' || answeringField?.format === 'date';

      const value: unknown =
        (wantsDate ? parseSpokenDate(spoken, language, timezone) : null) ?? spoken;

      /*
       * Keyed by FIELD KEY, not column.
       *
       * `executeMutate` runs `mapWritableData` over `data`, which looks every
       * key up in `entity.fields` and throws `unknown field` on a miss. A value
       * written under its column would therefore be rejected outright for any
       * field whose column differs from its key — invisible on `title`, where
       * the two match, and broken on the first field where they do not.
       */
      const filled = {
        ...inProgress.step,
        data: { ...(inProgress.step.data ?? {}), [answering.key]: value },
      } as MutateQuery;

      /*
       * The utterance ACCUMULATES, and it has to.
       *
       * `executeMutate` checks that a required text value is traceable to what
       * the user actually said — the guard that stops a model inventing a task
       * called "new task". Validating the completed write against only the
       * original request would find the title ungrounded, report it missing
       * again, and ask for the same field forever.
       *
       * The parked utterance is therefore the request as assembled so far, which
       * is also the honest thing to record in the audit trail.
       */
      // The words the user SAID, not the parsed value — this is what grounds a
      // written text field, and what the audit trail should read back as.
      const utterance = `${inProgress.utterance} ${spoken}`.trim();

      // Still more to ask for. Park the progress and ask for the next one by
      // name rather than trying to split one free-text answer across two fields.
      if (rest.length > 0) {
        await fills.park({
          userId: user.id,
          step: filled,
          remaining: rest,
          utterance,
          language,
          targetName: inProgress.targetName,
          referenceNames: inProgress.referenceNames,
        });

        return NextResponse.json({
          success: true,
          answer: {
            text: '',
            rows: [],
            entity: filled.entity,
            truncated: false,
            approximate: false,
            collapsed: 0,
          },
          needs: {
            entity: filled.entity,
            action: filled.action,
            fields: rest.map((f) => ({ key: f.key, label: f.label })),
          },
          budget: budgetPayload,
        });
      }

      // Complete, as far as we know. Validate before claiming so.
      try {
        const dry = await executeMutate(
          filled,
          { userId: user.id, timezone, consumer: 'chat' },
          {
            dryRun: true,
            language,
            targetName: inProgress.targetName,
            referenceNames: inProgress.referenceNames,
            utterance,
          }
        );

        // A completed write still obeys the action's own confirmation policy.
        // Finishing a sentence is not the same as approving what it now says.
        if (requiresConfirmation(filled)) {
          await fills.clear(user.id);
          const parked = await confirmations.park({
            userId: user.id,
            steps: [filled],
            preview: [dry.preview ?? `${filled.entity}.${filled.action}`],
            utterance,
            language,
            names: [
              {
                targetName: inProgress.targetName,
                referenceNames: inProgress.referenceNames,
              },
            ],
          });

          return NextResponse.json({
            success: true,
            confirmation: {
              id: parked.confirmationId,
              // Deliberately blank, NOT the preview. The card renders the
              // message AND the preview list, so passing the same string to
              // both printed the change twice. The client supplies the asking
              // sentence from its own dictionary, which is also the only way it
              // comes out in the reader's language.
              message: '',
              preview: [dry.preview ?? `${filled.entity}.${filled.action}`],
            },
            budget: budgetPayload,
          });
        }

        await fills.clear(user.id);
        const result = await executeMutate(
          filled,
          { userId: user.id, timezone, consumer: 'chat' },
          {
            language,
            targetName: inProgress.targetName,
            referenceNames: inProgress.referenceNames,
            utterance,
          }
        );

        return NextResponse.json({
          success: true,
          answer: {
            text: `${writeDone(language)} — ${result.preview ?? `${filled.entity}.${filled.action}`}.`,
            rows: [],
            truncated: false,
            approximate: false,
            collapsed: 0,
          },
          budget: budgetPayload,
        });
      } catch (err) {
        // Another field turned out to be missing — a value can be supplied and
        // still leave the write incomplete. Ask for that one; do not fall
        // through to the planner, which would drop the write on the floor.
        if (!(err instanceof MissingFieldsError)) {
          await fills.clear(user.id);
          throw err;
        }

        const next = describeFields(err.entity, err.fields, language);
        await fills.park({
          userId: user.id,
          step: filled,
          remaining: next,
          utterance,
          language,
          targetName: inProgress.targetName,
          referenceNames: inProgress.referenceNames,
        });

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
            fields: next.map((f) => ({ key: f.key, label: f.label })),
          },
          budget: budgetPayload,
        });
      }
    }

    // 4. A pending write takes precedence over planning.
    //
    // Checked first, and ONLY when something is actually parked, so a bare "yes"
    // can never be interpreted in isolation. An unrecognised reply falls through
    // to the planner rather than being read as approval.
    const pending = await confirmations.take(user.id);

    if (pending) {
      const reply = readConfirmationReply(message);

      if (reply === 'cancel') {
        await confirmations.clear(user.id);
        return NextResponse.json({
          success: true,
          answer: {
            text: writeCancelled(language),
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
          // Frozen at preview time. Re-rendering without them reports the id.
          names: pending.names,
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
            text: `${writeDone(language)} — ${applied.join('; ')}.`,
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

    /*
     * 5a. A tapped correction re-runs the stored plan. No model call at all.
     *
     * Falls through to normal planning on any mismatch — an expired context, a
     * value the catalog does not declare, a plan that no longer validates —
     * because answering the question again is always better than answering a
     * half-substituted one.
     */
    const corrected = alternative
      ? applyAlternative(context.lastPlan?.steps, alternative as Alternative)
      : null;

    if (alternative && !corrected) {
      requestLogger.warn(
        { userId: user.id, alternative },
        'Could not apply the tapped alternative; planning the turn instead'
      );
    }

    const planningStart = Date.now();
    const outcome = corrected
      ? {
          ok: true as const,
          plan: corrected.plan,
          clarification: undefined,
          diagnostics: {
            model: 'none (corrected)',
            catalogVersion: CATALOG_VERSION,
            entitiesOffered: [],
            repairAttempted: false,
            durationMs: 0,
            cache: 'miss' as CacheLayer,
          },
        }
      : await getBizQLPlanner().plan({
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
            // The detail names entities and actions, which is engineering
            // vocabulary. It stays in the log line above and in `debug`.
            error: chatError(capabilityGap ? 'cannotYet' : 'notUnderstood', language),
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
        { success: false, error: chatError('notUnderstood', language), debug },
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

          previews.push(
            recipientSummary(
              preview.attempted,
              preview.items.map((i) => i.target ?? i.id),
              language
            )
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

          // Labelled from the catalog, in the user's language, so the client
          // needs one framing sentence rather than a string per field.
          const wanted = describeFields(err.entity, err.fields, language);

          /*
           * Park the write. This branch used to return `needs` and keep NOTHING
           * — not the question, not even the turn — which is the whole bug: the
           * user's answer came back as a fresh request and was planned instead
           * of filled. See PendingFillStore for why context in the prompt was
           * not enough to fix it.
           *
           * `step` is the right thing to park rather than the planner's original:
           * its target and references are already resolved, so finishing the
           * write later cannot re-resolve "דויד המלך" onto a different contact.
           */
          if (step.op === 'mutate') {
            await fills.park({
              userId: user.id,
              step,
              remaining: wanted,
              utterance: message,
              language,
              targetName,
              referenceNames,
            });
          }

          // Recorded for the same reason the `clarification` branch does it:
          // the transcript should show that a question was asked. The fill above
          // is what actually resolves the next turn.
          remember(`asked for: ${wanted.map((f) => f.label).join(', ')}`, {
            pendingQuestion: wanted.map((f) => f.label).join(', '),
          });

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
              fields: wanted,
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
          // Positionally aligned with `steps` above — same array, same order.
          names: resolved.map((r) => ({
            targetName: r.targetName,
            referenceNames: r.referenceNames,
          })),
        });

        return NextResponse.json({
          success: true,
          confirmation: {
            id: parked.confirmationId,
            // Empty rather than an English fallback: the client asks in the
            // reader's language. A hardcoded sentence here is how a Hebrew
            // conversation ended with "Confirm this change?" in it.
            message: plan.answer?.text || '',
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
      const actionResults: QueryResult[] = [];
      const actionSteps: Array<{ id?: string }> = [];

      for (const { step, targetName, referenceNames } of resolved) {
        if (step.op === 'for_each') continue;
        const result = await executeMutate(
          step,
          { userId: user.id, timezone, consumer: 'chat' },
          { language, targetName, referenceNames, utterance: message }
        );
        applied.push(result.preview ?? `${step.entity}.${step.action}`);
        actionResults.push(result as QueryResult);
        actionSteps.push({ id: step.id });
      }

      /*
       * A READ action answers a question; it does not confirm a change.
       *
       * Everything here previously ended as "בוצע — <the parameters it was
       * given>", which for `open_time` meant the user asked how many hours were
       * free tomorrow and was told, in effect, that a date had been supplied.
       * The figures were fetched and then thrown away.
       *
       * So when nothing was actually changed, the planner's own sentence is
       * rendered against the action's result — `{s1.result.freeMinutes}` and its
       * siblings, declared in the catalog under `returns`. Falls back to the
       * confirmation line if the sentence does not resolve, which is the same
       * rule every other answer follows.
       */
      const isReadOnly = resolved.every(
        ({ step }) =>
          step.op === 'mutate' &&
          CATALOG.entities[step.entity]?.actions?.[step.action]?.risk === 'read'
      );

      if (isReadOnly && plan.answer?.text) {
        const rendered = renderAnswer(plan.answer.text, actionSteps, actionResults, {
          language,
          currency,
          timezone,
        });

        if (rendered.text) {
          return NextResponse.json({
            success: true,
            answer: rendered,
            budget: budgetPayload,
            debug,
          });
        }
      }

      return NextResponse.json({
        success: true,
        answer: {
          text: `${writeDone(language)} — ${applied.join('; ')}.`,
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

    /*
     * ONE list, used for both executing and rendering.
     *
     * `results` was built from the steps minus mutates while `renderAnswer` was
     * handed the full list, so it paired result[i] with step[i] across two
     * different arrays: any plan with a write before a read mapped a result onto
     * the wrong step's id, and the sentence would quote the wrong number without
     * anything failing. Only the rule against mixing writes with unrelated reads
     * kept it from biting. An `analyse` step, which produces no result at all,
     * would have made the same misalignment ordinary.
     */
    const readSteps = plan.steps.filter((s) => s.op !== 'mutate' && s.op !== 'analyse');

    try {
      for (const step of readSteps) {
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

    /*
     * 8. Render — substitution into the planner's own sentence, no templates.
     *
     * The business's own enum words are loaded here rather than taken from the
     * planning step: a cache hit skips planning entirely, and that is exactly
     * the path most answers take. Loading it there would have left the labels
     * missing on every cached turn — the common case, not the rare one.
     *
     * Scoped to the entities actually being rendered, so it is one small query
     * for the vocabularies the answer can possibly show.
     */
    const enumLabels = await loadUserEnumLabels(
      user.id,
      supabaseServer,
      [...new Set(readSteps.map((step) => step.entity))]
    );

    /*
     * 7.5. Say something about the numbers, now that the numbers exist.
     *
     * The planner writes its sentence BEFORE anything is fetched, which is fine
     * for stating a figure and impossible for describing one. Asked "how much
     * did my revenue drop", it has to guess which way the numbers went — and it
     * showed, producing "ירדו ב-8.33$" on one run and "ירדו ב--8.33$" on the
     * next. Dropped by minus eight is not a sentence anyone means.
     *
     * This layer sees the values, so a direction is something it can check. It
     * still never computes: it composes `{= ... }` and the server evaluates,
     * which is why a figure here can only be wrong if our arithmetic is.
     *
     * Returns null on any failure, and the planner's sentence stands. An
     * improvement to an answer that already exists must never be able to remove
     * one.
     */
    /*
     * ONLY when the planner asked for it.
     *
     * It briefly triggered on any plan containing an aggregate, which meant
     * "how many bookings do I have" — a question whose answer is one number and
     * needs no interpretation — paid for a second model call on every turn.
     * The planner knows whether a question needs relating or merely reporting;
     * that judgement belongs in the plan, not in a guess made here.
     */
    const wantsAnalysis = plan.steps.some((step) => step.op === 'analyse');

    const analysed = wantsAnalysis
      ? await analyse({
          question: message,
          language,
          currency,
          userId: user.id,
          steps: readSteps,
          results,
          turnId: correlationId,
        })
      : null;

    const answer = renderAnswer(analysed ?? plan.answer?.text, readSteps, results, {
      language,
      currency,
      timezone,
      enumLabels,
    });

    /*
     * 8a. Say what the query DID, and offer the one-tap corrections.
     *
     * Deterministic, free, and the only defence this system has against its
     * worst failure: a valid plan that answers a question nobody asked. See
     * describePlan for the argument.
     *
     * Shown only when it earns its place:
     *   - there is something to correct (a sibling status, a rival total)
     *   - the answer came back EMPTY, where "why zero" is the actual question.
     *     "עמודים: 0" for "show me my website" is technically true and reads as
     *     a bug; naming the filter that produced the zero answers it.
     *   - this turn WAS a correction, where the sentence is deliberately absent
     *     and this line is what says which query the number belongs to.
     */
    const understanding = describePlan(readSteps, { language, enumLabels });

    const emptyResult =
      answer.rows.length === 0 &&
      results.every(
        (r) =>
          (r.op === 'find' && (r.rows?.length ?? 0) === 0) ||
          (r.op === 'compute' && !r.groups?.length && !r.value)
      );

    const understood =
      understanding &&
      (understanding.alternatives.length > 0 || emptyResult || Boolean(corrected))
        ? understanding
        : undefined;

    // Remember what was shown, so "it" / "him" / "the second one" resolve next
    // turn. Ids and labels only — this is context, not a copy of the data.
    const primary = results.find((r) => r.op === 'find');

    /*
     * A GROUPED answer names its subject too.
     *
     * "Your most profitable service is X" identifies a service as surely as a
     * find does — but only `find` results were remembered, so the next turn had
     * nothing to point at and fell back to `context.lastRows`: whatever was
     * listed by some earlier question. Asked "how much have we earned from this
     * service", the chat answered about a service from a different question
     * thirteen minutes earlier, and returned 0 with complete confidence.
     *
     * Carrying the previous rows forward is right for a genuine follow-up. It
     * is wrong once a later turn has established a different subject, and a
     * grouped compute is exactly that.
     *
     * Only groups that carry an `id` qualify: a date bucket or a raw enum value
     * is not a row anything can be asked about.
     */
    const groupedSubject = results.find(
      (r): r is typeof r & { groups: Array<{ key: string; value: number; id?: string }> } =>
        r.op === 'compute' && Array.isArray((r as { groups?: unknown[] }).groups) &&
        ((r as { groups: Array<{ id?: string }> }).groups ?? []).some((g) => g.id)
    );

    const groupedEntity = (() => {
      if (!groupedSubject) return undefined;
      const step = plan.steps.find(
        (s) => s.op === 'compute' && s.entity === groupedSubject.entity
      );
      const relationKey = (step as { group_by?: unknown } | undefined)?.group_by;
      if (typeof relationKey !== 'string') return undefined;
      return CATALOG.entities[groupedSubject.entity]?.relations?.[relationKey]?.target;
    })();

    remember(
      // An analyse step has no entity — it describes the others.
      plan.steps
        .map((step) => (step.op === 'analyse' ? step.op : `${step.op} ${step.entity}`))
        .join(', '),
      {
        pendingQuestion: undefined,
        /*
         * The plan behind this answer, so a tapped correction costs no model
         * call. Reads only — ConversationMemory strips writes on the way in,
         * and applyAlternative refuses them again on the way out.
         */
        lastPlan: { steps: readSteps, answer: plan.answer, at: new Date().toISOString() },
        /*
         * A choice the user made by tapping, kept for the conversation.
         *
         * "When I say revenue I mean net" is a standing fact, and asking again
         * next turn would be the same ambiguity with extra steps. A status swap
         * establishes nothing of the kind, so only the aggregate choice is
         * remembered — see applyAlternative.
         */
        preferences: corrected?.preference
          ? { ...context.preferences, [corrected.preference.key]: corrected.preference.value }
          : context.preferences,
        lastRows:
          primary?.op === 'find' && answer.rows.length > 0
            ? {
                entity: primary.entity,
                items: answer.rows.map((r) => ({ id: r.id, label: r.label })),
                at: new Date().toISOString(),
              }
            : groupedSubject && groupedEntity
              ? {
                  entity: groupedEntity,
                  items: groupedSubject.groups
                    .filter((g): g is { key: string; value: number; id: string } => Boolean(g.id))
                    .map((g) => ({ id: g.id, label: g.key })),
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
      understood,
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
              : chatError('notUnderstood', resolvedLanguage),
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
          error: chatError('tooMuchData', resolvedLanguage),
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
            : chatError('unexpected', resolvedLanguage),
      },
      { status: 500 }
    );
  }
}
