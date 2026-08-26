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
import { CATALOG_VERSION } from '@/lib/business-os/catalog';
import type { ComputeQuery, FindQuery, Query } from '../types';
import { normalizePlan, validatePlan } from './validatePlan';
import { buildPlanTool, PLANNER_SYSTEM_PROMPT } from './planTool';
import {
  guessRelevantEntities,
  renderCatalogForPrompt,
  renderUserVocabulary,
} from './catalogPrompt';
import { getPlanCache, type CacheLayer } from '../cache/PlanCache';

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
  /** BCP-47-ish language hint. Only used to tell the model which language to answer in. */
  language?: string;
  timezone?: string;
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
function coerceSteps(raw: unknown): { steps: Query[]; dropped: number } {
  if (!Array.isArray(raw)) return { steps: [], dropped: 0 };

  const usable = raw.filter((step) => {
    const s = step as Record<string, unknown> | null;
    return Boolean(s && typeof s === 'object' && typeof s.entity === 'string' && s.entity);
  });

  return {
    steps: usable.map((step) => {
      const s = step as Record<string, unknown>;
      return s.op === 'compute'
        ? (s as unknown as ComputeQuery)
        : (s as unknown as FindQuery);
    }),
    dropped: raw.length - usable.length,
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
    const cache = getPlanCache();
    const cached = await cache.lookup(request.message, request.language ?? 'en', request.userId);

    if (cached.plan) {
      // A cached plan is still validated: the catalog may have changed in ways
      // the version hash did not capture, and serving a stale plan unchecked is
      // how a cache turns a saving into a wrong answer.
      const problems = validatePlan(cached.plan, request.message);

      if (problems.length === 0) {
        logger.debug({ layer: cached.layer }, 'Served plan from cache');
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

    // Scope the catalog when we can identify the subject, purely to save tokens.
    // A miss falls back to the whole catalog, so this never costs correctness.
    const guessed = guessRelevantEntities(request.message);
    const entities = guessed.length > 0 ? guessed : undefined;

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

    const system =
      `${PLANNER_SYSTEM_PROMPT}\n\nCATALOG\n${catalogText}` +
      (vocabulary ? `\n\nTHIS USER'S CONFIGURED VALUES\n${vocabulary}` : '');
    const user = request.language
      ? `Answer in language: ${request.language}\n\nRequest: ${request.message}`
      : `Request: ${request.message}`;

    const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ];

    let repairAttempted = false;
    let promptTokens: number | undefined;
    let completionTokens: number | undefined;

    for (let attempt = 0; attempt < 2; attempt++) {
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
            // A plan is small — a handful of steps and one sentence. Without a
            // cap the model can run away: one Hebrew case produced 16,384
            // output tokens of invalid JSON, costing ~40x a normal turn and
            // still failing. Capping makes a runaway fail fast and cheaply
            // instead of expensively.
            max_tokens: MAX_PLAN_TOKENS,
          },
          { userId: request.userId, feature: 'business-os-chat', component: 'BizQLPlanner' }
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
        answer: raw.answer as AnswerSpec | undefined,
      };

      // Canonicalise unambiguous variations (`>` -> `gt`) before judging the
      // plan, so a repair pass is spent on real problems only.
      normalizePlan(plan);
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
        const hasWrite = plan.steps.some((s) => s.op === 'mutate');
        if (!hasWrite) {
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

      if (attempt === 0) {
        // Feed the exact problems back. A machine-readable repair message is far
        // more effective than "that was wrong, try again".
        repairAttempted = true;
        logger.warn({ problems }, 'Plan failed validation; attempting one repair');

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
