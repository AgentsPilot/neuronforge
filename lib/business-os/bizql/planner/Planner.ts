/**
 * The BizQL planner: natural language → one validated plan.
 *
 * This is the ONLY place an LLM is involved in answering a question. Everything
 * downstream — validation, compilation, execution, rendering — is deterministic.
 *
 * Cost shape, versus what came before:
 *
 *   chat-v2  1–11 gpt-4o calls per turn, each re-sending a ~285-line prompt,
 *            plus ~10 DB queries of unused context, plus a SECOND call to write
 *            the final message.       ≈ 20,000–30,000 input tokens/turn
 *   chat-v3  1 call, but all 33 capabilities serialised as tool schemas every
 *            turn.                    ≈ 2,900 input tokens/turn
 *   here     1 call, ~267-token compressed catalog, one small stable tool, and
 *            the answer sentence rides in the plan so there is NO second call.
 *
 * The model is resolved from SystemConfigService, never hardcoded — chat-v3 had
 * `gpt-4o-mini` inline at AIPlanner.ts:122, in violation of the project's own
 * provider-factory rule, which made comparing models a code change.
 *
 * @module lib/business-os/bizql/planner
 */

import { createLogger } from '@/lib/logger';
import { ProviderFactory } from '@/lib/ai/providerFactory';
import { SystemConfigService } from '@/lib/services/SystemConfigService';
import { supabaseServer } from '@/lib/supabaseServer';
import { CATALOG, CATALOG_VERSION } from '@/lib/business-os/catalog';
import { anchorizeInventedDates } from '../dates';
import type { ComputeQuery, FindQuery, Query } from '../types';
import { isSoftProblem, normalizePlan, validatePlan } from './validatePlan';
import { buildPlanTool, plannerSystemPrompt } from './planTool';
import {
  guessRelevantEntities,
  renderCatalogForPrompt,
  renderUserVocabulary,
} from './catalogPrompt';
import { getPlanCache, type CacheLayer } from '../cache/PlanCache';
import { recordCachedTurn } from '../telemetry/turnUsage';
import {
  renderContextForPrompt,
  type ConversationContext,
} from '../memory/ConversationMemory';

const logger = createLogger({ module: 'BizQLPlanner' });

/**
 * Output ceiling for a plan.
 *
 * A real plan is small — the failing Hebrew case that prompted this produces a
 * valid plan in 121 output tokens. The cap exists for the degenerate case: the
 * same request occasionally ran away to 16,384 tokens of invalid JSON, ~40x a
 * normal turn, and still failed.
 *
 * 900 turned out to be too tight (it truncated a legitimate plan into invalid
 * JSON, converting a rare runaway into a common failure). 1500 is generous for
 * anything real and still an order of magnitude below the model's maximum.
 */
const MAX_PLAN_TOKENS = 1500;

export interface AnswerSpec {
  text: string;
  primary_step?: string;
}

export interface Plan {
  steps: Query[];
  answer?: AnswerSpec;
  clarification?: string;
}

export interface PlanRequest {
  message: string;
  userId: string;
  /** Recent turns and last-shown rows, so pronouns and answers resolve. */
  context?: ConversationContext;
  /** BCP-47-ish language hint. Only used to tell the model which language to answer in. */
  language?: string;
  timezone?: string;
  /**
   * Identifies ONE question, across every call it takes to answer it.
   *
   * A turn can be a plan plus a repair, or a cache hit and no call at all.
   * Without this, usage rows are per-API-call and cost-per-question cannot be
   * computed — only cost-per-call, which hides both repair overhead and the
   * savings from a cache hit. The route passes its correlationId.
   */
  turnId?: string;
}

export interface PlanOutcome {
  ok: boolean;
  plan?: Plan;
  /** Set when the model asked for clarification instead of planning. */
  clarification?: string;
  error?: string;
  diagnostics: {
    model: string;
    catalogVersion: string;
    entitiesOffered: string[];
    promptTokens?: number;
    completionTokens?: number;
    repairAttempted: boolean;
    durationMs: number;
    /** Which layer answered: exact / semantic / miss. */
    cache: CacheLayer;
    /** Set on a cache hit, so the caller can report the outcome back. */
    cacheEntryId?: string;
  };
}

async function resolveModel(): Promise<string> {
  return SystemConfigService.getString(
    supabaseServer,
    'bizchat_planner_model',
    'gpt-4o-mini'
  );
}

/**
 * Narrow raw tool arguments into our Query union, leaving real validation to
 * validatePlan.
 *
 * Structurally empty steps are dropped rather than passed on. Models
 * occasionally emit a trailing `{}` or a step with no entity alongside a
 * perfectly good one; failing the whole turn over that punishes the user for a
 * stray token. Anything with content is kept and validated strictly, so this
 * discards noise, never meaning.
 */
function coerceSteps(raw: unknown): {
  steps: Query[];
  dropped: number;
  /**
   * An `answer` the model put INSIDE `steps` instead of beside it.
   *
   * gpt-4o-mini does this on roughly a third of Hebrew aggregate questions:
   *
   *   [ {id:'s1', op:'compute', entity:'transactions', agg:{...}},
   *     {answer:{text:'יש לך סכום הכנסות של {s1.value}.', primary_step:'s1'}} ]
   *
   * The plan itself is perfect. Only its placement is wrong — and the element
   * has no `entity`, so it was silently discarded here while `raw.answer`
   * stayed undefined. The turn then rendered with NO SENTENCE, falling back to
   * a bare "תשלומים: 2" for a question that had asked for revenue.
   *
   * Salvaged rather than dropped: the model wrote a correct answer and we were
   * throwing it away over a misplacement we can see and undo.
   */
  salvagedAnswer?: Record<string, unknown>;
} {
  if (!Array.isArray(raw)) return { steps: [], dropped: 0 };

  let salvagedAnswer: Record<string, unknown> | undefined;

  const usable = raw.filter((step) => {
    const s = step as Record<string, unknown> | null;
    if (!s || typeof s !== 'object') return false;

    // A step-shaped object always names an entity. Anything else that carries
    // an `answer` is the answer spec in the wrong place.
    if (typeof s.entity !== 'string' || !s.entity) {
      if (!salvagedAnswer && s.answer && typeof s.answer === 'object') {
        salvagedAnswer = s.answer as Record<string, unknown>;
      }
      return false;
    }

    return true;
  });

  return {
    steps: usable.map((step) => {
      const s = step as Record<string, unknown>;
      return s.op === 'compute'
        ? (s as unknown as ComputeQuery)
        : (s as unknown as FindQuery);
    }),
    dropped: raw.length - usable.length,
    salvagedAnswer,
  };
}

export class BizQLPlanner {
  /**
   * Plan a single turn.
   *
   * On a validation failure the model gets exactly ONE repair attempt, fed the
   * precise problems. One retry rather than a loop: repeated repair is a strong
   * signal that the catalog is missing a concept, and silently burning calls
   * hides that.
   */
  async plan(request: PlanRequest): Promise<PlanOutcome> {
    const started = Date.now();

    // Cache first. This belongs in the planner rather than the route because
    // caching IS the planner's job — avoiding an LLM call — and putting it here
    // means every caller benefits and the eval harness measures it.
    // A context-dependent turn is deliberately NOT cached, in either direction.
    // "show him" means something different in every conversation, so serving a
    // cached plan for it would apply one user's referent to another's question.
    const contextual = Boolean(
      request.context?.pendingQuestion || request.context?.lastRows?.items.length
    );

    const cache = getPlanCache();
    const cached = contextual
      ? { layer: 'miss' as const, literals: [], normalized: '' }
      : await cache.lookup(
          request.message,
          request.language ?? 'en',
          request.userId,
          request.turnId
        );

    if (cached.plan) {
      // A cached plan is still validated: the catalog may have changed in ways
      // the version hash did not capture, and serving a stale plan unchecked is
      // how a cache turns a saving into a wrong answer.
      const problems = validatePlan(cached.plan, request.message);

      if (problems.length === 0) {
        logger.debug({ layer: cached.layer }, 'Served plan from cache');

        // A turn that cost nothing still happened. Without a row here the cache
        // hit rate is unmeasurable and cost-per-turn divides by the wrong
        // denominator — see telemetry/turnUsage.ts.
        if (request.turnId) {
          void recordCachedTurn({
            userId: request.userId,
            turnId: request.turnId,
            servedBy: cached.layer as 'exact' | 'semantic',
            latencyMs: Date.now() - started,
          });
        }

        return {
          ok: true,
          plan: cached.plan,
          diagnostics: {
            model: 'cache',
            catalogVersion: CATALOG_VERSION,
            entitiesOffered: [],
            promptTokens: cached.embeddingTokens ?? 0,
            completionTokens: 0,
            repairAttempted: false,
            durationMs: Date.now() - started,
            cache: cached.layer,
            cacheEntryId: cached.entryId,
          },
        };
      }

      logger.warn({ problems, layer: cached.layer }, 'Cached plan failed validation; re-planning');
      if (cached.entryId) await cache.recordOutcome(cached.entryId, false);
    }

    /*
     * Scope the catalog when we can identify the subject, to save tokens.
     * A miss falls back to the whole catalog, so this never costs correctness.
     *
     * The guess reads the MESSAGE, and a follow-up does not name its subject —
     * it inherited it from the turn before. "שנה עדיפות לנמוכה" and "change the
     * due date to 30 October" both scope to nothing, so the whole catalog ships
     * on exactly the turns a conversation is mostly made of.
     *
     * The subject is not unknown though: `lastRows.entity` is what the user was
     * just shown, and it is the thing they are talking about. Seeding from it
     * costs nothing and is a better signal than the words in a short reply.
     *
     * It also buys correctness, which the message-only guess was quietly
     * costing: "set the priority to urgent" matched `insights` — whose severity
     * field publishes "urgent" — and NOT `tasks`, so the planner was handed the
     * wrong entity and produced `insights.confirm`, an action that does not
     * exist. Naming the real subject stops that.
     */
    const guessed = new Set(guessRelevantEntities(request.message));

    const subject = request.context?.lastRows?.entity;
    if (subject && CATALOG.entities[subject]) {
      guessed.add(subject);
      // Its relations too, matching what the message-based guess does: a reply
      // about a task may still need the contact it belongs to.
      for (const relation of Object.values(CATALOG.entities[subject].relations ?? {})) {
        guessed.add(relation.target);
      }
    }

    const entities = guessed.size > 0 ? [...guessed] : undefined;

    // Writes are now expressible, so the planner must see which actions exist
    // and which of them require confirmation.
    const catalogText = renderCatalogForPrompt({ entities, includeActions: true });
    const tool = buildPlanTool(entities);

    // Read this user's own configured values for any data-driven field, so the
    // planner never has to guess them and we never have to enumerate synonyms.
    const [model, vocabulary] = await Promise.all([
      resolveModel(),
      renderUserVocabulary(request.userId, supabaseServer, entities).catch((err) => {
        logger.warn({ err }, 'Could not load user vocabulary; planning without it');
        return '';
      }),
    ]);

    const conversation = request.context ? renderContextForPrompt(request.context) : '';

    /*
     * The action rules are sent only when an action is reachable.
     *
     * Rules 12, 13, 16 and 17 and ~920 tokens of tool schema describe naming a
     * target, acting on many rows and performing a write. If nothing offered to
     * this turn declares an action, none of it can be used — and it was going
     * out on every call regardless, on top of a prompt that is already 69% of
     * what a question costs.
     */
    // `undefined` means the whole catalog was shipped, which certainly includes
    // entities with actions.
    const canAct = (entities ?? Object.keys(CATALOG.entities)).some(
      (key) => Object.keys(CATALOG.entities[key]?.actions ?? {}).length > 0
    );

    const system =
      `${plannerSystemPrompt({ actions: canAct })}\n\nCATALOG\n${catalogText}` +
      (vocabulary ? `\n\nTHIS USER'S CONFIGURED VALUES\n${vocabulary}` : '') +
      (conversation ? `\n\nCONVERSATION SO FAR\n${conversation}` : '');
    /*
     * Today, in the business's own timezone.
     *
     * Needed the moment a user names a day rather than describing one. Asked to
     * set a due date to "30 October" the planner answered 2023-10-30 — a year
     * three in the past, because nothing had ever told it what year it is.
     *
     * It goes in the USER message, not the system prompt, and that placement is
     * the point: `plannerVersion()` hashes the system prompt into the plan-cache
     * key, so a date up there would invalidate every cached plan at midnight,
     * every night.
     */
    const todayInZone = new Intl.DateTimeFormat('en-CA', {
      timeZone: request.timezone ?? 'UTC',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());

    const user =
      `Today is ${todayInZone}.\n` +
      (request.language ? `Answer in language: ${request.language}\n` : '') +
      `\nRequest: ${request.message}`;

    const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ];

    let repairAttempted = false;
    let promptTokens: number | undefined;
    let completionTokens: number | undefined;

    /*
     * Three attempts: the first plan, then up to two repairs.
     *
     * It was one repair, and one was not enough for a failure mode the model
     * repeats. Asked to change a task's status it would emit a mutate step with
     * no `action`, be told exactly that, and do it again — so the user saw "I
     * didn't understand" for a request that succeeded on the very next try.
     *
     * Enumerating `action` in the tool schema took that from roughly half of
     * attempts to about one in eight. A second repair is the cheap half of the
     * remainder: a repair only runs when the turn has ALREADY failed, so this
     * costs nothing on the normal path and turns a visible failure into a
     * slightly slower success.
     */
    for (let attempt = 0; attempt < 3; attempt++) {
      let raw: Record<string, unknown>;

      try {
        const provider = ProviderFactory.getProvider('openai');
        const response = await provider.chatCompletion(
          {
            model,
            messages,
            tools: [tool],
            tool_choice: 'required',
            temperature: 0,
            /*
             * What stops the runaway the cap below only made cheap.
             *
             * Greedy decoding at temperature 0, under an instruction prompt this
             * long, collapses into a repetition loop. It emitted a perfectly
             * good `steps` array, reached `answer`, and then produced
             * `"  " , "  " , "  " ,` until it hit the cap — invalid JSON, so the
             * user was told "I couldn't understand the request" for something as
             * ordinary as "how many meetings do I have tomorrow".
             *
             * Deterministic per question, which is why it looked like a parsing
             * bug rather than a sampling one: count-plus-a-date failed every
             * time, while counting alone and listing with a date were fine.
             *
             * Neither temperature (0.3 recovered 1 run in 4) nor tool_choice nor
             * the schema made any difference. A frequency penalty did, because
             * this is exactly the failure it exists for: measured across eight
             * representative questions, 6/8 parsed without it and 8/8 with it,
             * with nothing that previously worked regressed. Kept low — JSON is
             * legitimately repetitive, and `"field"`/`"op"`/`"value"` must stay
             * cheap to re-emit.
             */
            frequency_penalty: 0.3,
            // A plan is small — a handful of steps and one sentence. Without a
            // cap the model can run away: one Hebrew case produced 16,384
            // output tokens of invalid JSON, costing ~40x a normal turn and
            // still failing. Capping makes a runaway fail fast and cheaply
            // instead of expensively — this is the belt to the penalty's braces.
            max_tokens: MAX_PLAN_TOKENS,
          },
          {
            userId: request.userId,
            feature: 'business-os-chat',
            component: 'BizQLPlanner',
            sessionId: request.turnId,
            // A repair is a SECOND full-prompt call for one question. Tagged so
            // its overhead is visible: repairs were the dominant cost driver at
            // several points during development and looked identical to first
            // attempts in the data.
            activity_type: repairAttempted ? 'repair' : 'plan',
          }
        );

        promptTokens = response.usage?.prompt_tokens ?? promptTokens;
        completionTokens = response.usage?.completion_tokens ?? completionTokens;

        const call = response.choices?.[0]?.message?.tool_calls?.[0];
        if (!call) {
          return this.fail('The planner did not return a plan.', {
            model,
            entities,
            repairAttempted,
            started,
            promptTokens,
            completionTokens,
          });
        }

        try {
          raw = JSON.parse(call.function.arguments) as Record<string, unknown>;
        } catch {
          // Truncated or malformed tool arguments. Worth one retry: it is
          // usually a transient generation artefact, not a real inability.
          if (attempt === 0) {
            repairAttempted = true;
            logger.warn(
              {
                length: call.function.arguments?.length,
                // Keep a prefix: "malformed JSON" alone is unactionable, and the
                // shape of the malformation is what identifies the cause.
                sample: call.function.arguments?.slice(0, 300),
              },
              'Tool arguments were not valid JSON; retrying once'
            );
            messages.push({
              role: 'user',
              content:
                'Your previous tool call was not valid JSON. Call emit_plan again with ' +
                'complete, valid arguments and the fewest possible steps.',
            });
            continue;
          }
          return this.fail('The planner returned malformed arguments twice.', {
            model,
            entities,
            repairAttempted,
            started,
            promptTokens,
            completionTokens,
          });
        }
      } catch (err) {
        logger.error({ err, attempt }, 'Planner call failed');
        return this.fail((err as Error).message, {
          model,
          entities,
          repairAttempted,
          started,
          promptTokens,
          completionTokens,
        });
      }

      // The model may legitimately decline to guess.
      if (typeof raw.clarification === 'string' && raw.clarification.trim()) {
        return {
          ok: true,
          clarification: raw.clarification.trim(),
          diagnostics: this.diagnostics({
            model,
            entities,
            repairAttempted,
            started,
            promptTokens,
            completionTokens,
          }),
        };
      }

      const coerced = coerceSteps(raw.steps);
      if (coerced.dropped > 0) {
        logger.warn({ dropped: coerced.dropped }, 'Dropped structurally empty plan steps');
      }

      const plan: Plan = {
        steps: coerced.steps,
        // The model's own sentence, wherever it put it. `raw.answer` first —
        // that is the declared place — then one recovered from inside `steps`.
        answer: (raw.answer as AnswerSpec | undefined) ??
          (coerced.salvagedAnswer as AnswerSpec | undefined),
      };

      if (!raw.answer && coerced.salvagedAnswer) {
        logger.info(
          { userId: request.userId },
          'Recovered an answer the model placed inside steps'
        );
      }

      // Canonicalise unambiguous variations (`>` -> `gt`) before judging the
      // plan, so a repair pass is spent on real problems only.
      normalizePlan(plan);

      /*
       * Put back the anchor behind a date the model worked out for itself.
       *
       * Runs BEFORE validation, not as a repair of it: the digit rule would
       * reject "2026-09-01" for a request that says only "this month", and two
       * repair rounds do not change the model's mind — 18 of 40 measured
       * failures, and two wasted calls each. The date is `start_of_month` on
       * today's clock, which is a fact rather than an opinion, so we substitute
       * it and spend the repairs on problems we cannot solve ourselves.
       */
      const anchored = anchorizeInventedDates(plan, request.message, request.timezone);
      if (anchored > 0) {
        logger.info({ anchored, userId: request.userId }, 'Restored date anchors in a plan');
      }

      const problems = validatePlan(plan, request.message);

      if (problems.length === 0) {
        logger.info(
          {
            userId: request.userId,
            steps: plan.steps.length,
            entities: entities ?? 'all',
            promptTokens,
            repairAttempted,
          },
          'Plan produced'
        );

        // Store only a freshly planned, valid result. Writes are never cached:
        // a mutate carries a concrete target id, so it is tenant-specific by
        // construction and would be useless — or dangerous — to replay.
        const hasWrite = plan.steps.some((s) => s.op === 'mutate' || s.op === 'for_each');
        if (!hasWrite && !contextual) {
          void cache
            .store({
              normalized: cached.normalized,
              literals: cached.literals,
              language: request.language ?? 'en',
              userId: request.userId,
              plan,
              model,
            })
            .catch(() => {});
        }

        return {
          ok: true,
          plan,
          diagnostics: this.diagnostics({
            model,
            entities,
            repairAttempted,
            started,
            promptTokens,
            completionTokens,
          }),
        };
      }

      // Not `attempt === 0`: with a third iteration available, stopping the
      // repair after the first one would leave the extra attempt unused.
      if (attempt < 2) {
        // Feed the exact problems back. A machine-readable repair message is far
        // more effective than "that was wrong, try again".
        repairAttempted = true;
        logger.warn({ problems, attempt }, 'Plan failed validation; attempting a repair');

        messages.push({
          role: 'assistant',
          content: `emit_plan(${JSON.stringify(raw)})`,
        });
        messages.push({
          role: 'user',
          content:
            `That plan is invalid:\n- ${problems.join('\n- ')}\n\n` +
            `Fix these problems and call emit_plan again. Use only catalog names.`,
        });
        continue;
      }

      /*
       * Repairs are spent. If everything still outstanding is SOFT, ship it.
       *
       * The only soft problem today is a missing answer sentence, and the
       * renderer already has a fallback for exactly that. Refusing here would
       * replace a thin answer with no answer — measured, that was 31 turns of
       * 297 turning into "I didn't quite follow that" where they had shown a
       * bare count. The rule is there to push the model, not to punish the user
       * when it will not move.
       */
      if (problems.every(isSoftProblem)) {
        logger.warn({ problems }, 'Accepting a plan with soft problems after repairs');

        return {
          ok: true,
          plan,
          diagnostics: this.diagnostics({
            model,
            entities,
            repairAttempted,
            started,
            promptTokens,
            completionTokens,
          }),
        };
      }

      return this.fail(`Plan failed validation: ${problems.join('; ')}`, {
        model,
        entities,
        repairAttempted,
        started,
        promptTokens,
        completionTokens,
      });
    }

    return this.fail('Planner exhausted attempts.', {
      model,
      entities,
      repairAttempted,
      started,
      promptTokens,
      completionTokens,
    });
  }

  private diagnostics(args: {
    model: string;
    entities?: string[];
    repairAttempted: boolean;
    started: number;
    promptTokens?: number;
    completionTokens?: number;
  }): PlanOutcome['diagnostics'] {
    return {
      model: args.model,
      catalogVersion: CATALOG_VERSION,
      entitiesOffered: args.entities ?? ['<all>'],
      promptTokens: args.promptTokens,
      completionTokens: args.completionTokens,
      repairAttempted: args.repairAttempted,
      durationMs: Date.now() - args.started,
      cache: 'miss',
    };
  }

  private fail(
    error: string,
    args: {
      model: string;
      entities?: string[];
      repairAttempted: boolean;
      started: number;
      promptTokens?: number;
      completionTokens?: number;
    }
  ): PlanOutcome {
    return { ok: false, error, diagnostics: this.diagnostics(args) };
  }
}

let singleton: BizQLPlanner | null = null;

export function getBizQLPlanner(): BizQLPlanner {
  if (!singleton) singleton = new BizQLPlanner();
  return singleton;
}
