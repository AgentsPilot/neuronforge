/**
 * Plan cache — L1 exact, L2 semantic.
 *
 * The layered cost model this implements:
 *
 *   L1  exact hash on the normalised utterance    0 LLM calls, 1 indexed SELECT
 *   L2  pgvector cosine ≥ threshold               1 embedding (~1/1000 of a call)
 *   L3  the planner                               1 small completion
 *
 * Caching the PLAN and never the result is what makes this both cheap and safe:
 * a plan is a query shape, so it stays correct as data changes, and it carries
 * no one's data. Combined with the compiler's unconditional `user_id` injection,
 * a plan shared between tenants still executes strictly within the caller's own
 * scope.
 *
 * Everything here degrades to a miss. If the migration has not been applied, or
 * embeddings fail, or Postgres is briefly unavailable, the turn costs one
 * planning call — the same as before the cache existed. A cache must never be
 * able to break the feature it accelerates.
 *
 * @module lib/business-os/bizql/cache
 */

import { createLogger } from '@/lib/logger';
import { supabaseServer } from '@/lib/supabaseServer';
import { SystemConfigService } from '@/lib/services/SystemConfigService';
import { EmbeddingService } from '@/lib/services/EmbeddingService';
import { CATALOG_VERSION } from '@/lib/business-os/catalog';
import type { Plan } from '../planner/Planner';
import {
  cacheKey,
  dehydratePlan,
  isPlanPortable,
  normalizeUtterance,
  rehydratePlan,
  type ExtractedLiteral,
} from './normalize';

const logger = createLogger({ module: 'BizQLPlanCache' });

const TABLE = 'business_chat_plan_cache';

export type CacheLayer = 'exact' | 'semantic' | 'miss';

export interface CacheLookup {
  layer: CacheLayer;
  plan?: Plan;
  /** Row id, so the outcome can be recorded against the entry that served it. */
  entryId?: string;
  similarity?: number;
  /** Tokens spent looking (the L2 embedding). Zero for L1 and for a miss. */
  embeddingTokens?: number;
}

/**
 * Set once per process when the table turns out to be missing.
 *
 * Without this every turn would retry a query that cannot succeed. One warning
 * and a clean bypass is better than a per-request error log that trains people
 * to ignore the logs.
 */
let cacheUnavailable = false;

function isMissingTable(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  // undefined_table, or PostgREST failing to find it in its schema cache.
  return error.code === '42P01' || /does not exist|schema cache/i.test(error.message ?? '');
}

async function threshold(): Promise<number> {
  // Higher than the help bot's 0.85. A wrong support answer is wrong; a wrong
  // PLAN silently queries something the user did not ask about.
  return SystemConfigService.getNumber(
    supabaseServer,
    'bizchat_plan_semantic_threshold',
    0.92
  );
}

async function semanticEnabled(): Promise<boolean> {
  return SystemConfigService.getBoolean(
    supabaseServer,
    'bizchat_plan_semantic_cache_enabled',
    true
  );
}

export class PlanCache {
  /**
   * Look for a usable plan.
   *
   * Never throws: every failure path returns a miss.
   */
  async lookup(
    utterance: string,
    language: string,
    userId: string
  ): Promise<CacheLookup & { literals: ExtractedLiteral[]; normalized: string }> {
    const { normalized, literals } = normalizeUtterance(utterance);
    const miss = { layer: 'miss' as const, literals, normalized };

    if (cacheUnavailable) return miss;

    const key = cacheKey(normalized, language, CATALOG_VERSION);

    // ---- L1: exact ---------------------------------------------------------
    try {
      const { data, error } = await supabaseServer
        .from(TABLE)
        .select('id, plan, user_id, success_count, failure_count')
        .eq('utterance_hash', key)
        .or(`user_id.is.null,user_id.eq.${userId}`)
        // Prefer this user's own entry over the shared one when both exist.
        .order('user_id', { ascending: false, nullsFirst: false })
        .limit(1);

      if (isMissingTable(error)) {
        cacheUnavailable = true;
        logger.warn(
          { table: TABLE },
          'Plan cache table not found — running without a cache. ' +
            'Apply supabase/migrations/20260826_business_chat_plan_cache.sql to enable it.'
        );
        return miss;
      }

      const row = data?.[0] as
        | { id: string; plan: Plan; failure_count: number; success_count: number }
        | undefined;

      if (row && !(row.failure_count >= 2 && row.success_count === 0)) {
        logger.debug({ layer: 'exact', normalized }, 'Plan cache hit');
        return {
          layer: 'exact',
          plan: rehydratePlan(row.plan, literals),
          entryId: row.id,
          literals,
          normalized,
        };
      }
    } catch (err) {
      logger.warn({ err }, 'Plan cache L1 lookup failed; treating as a miss');
      return miss;
    }

    // ---- L2: semantic ------------------------------------------------------
    if (!(await semanticEnabled())) return miss;

    try {
      const embeddingService = new EmbeddingService(
        process.env.OPENAI_API_KEY!,
        supabaseServer
      );
      const { embedding, tokens } = await embeddingService.generateEmbedding(normalized);

      const { data, error } = await supabaseServer.rpc(
        'search_business_chat_plans_semantic',
        {
          query_embedding: JSON.stringify(embedding),
          p_catalog_version: CATALOG_VERSION,
          p_language: language,
          p_user_id: userId,
          similarity_threshold: await threshold(),
          result_limit: 1,
        }
      );

      if (error) {
        logger.warn({ err: error }, 'Semantic plan search unavailable; treating as a miss');
        return { ...miss, embeddingTokens: tokens };
      }

      const match = data?.[0] as
        | { id: string; plan: Plan; similarity: number; utterance_normalized: string }
        | undefined;

      if (match) {
        logger.info(
          { similarity: match.similarity, matched: match.utterance_normalized, normalized },
          'Plan cache semantic hit'
        );
        return {
          layer: 'semantic',
          plan: rehydratePlan(match.plan, literals),
          entryId: match.id,
          similarity: match.similarity,
          embeddingTokens: tokens,
          literals,
          normalized,
        };
      }

      return { ...miss, embeddingTokens: tokens };
    } catch (err) {
      logger.warn({ err }, 'Plan cache L2 lookup failed; treating as a miss');
      return miss;
    }
  }

  /**
   * Store a plan that answered successfully.
   *
   * Only ever called after a turn the user did not cancel or correct. Caching a
   * plan the user rejected would serve that mistake to everyone.
   */
  async store(args: {
    normalized: string;
    literals: ExtractedLiteral[];
    language: string;
    userId: string;
    plan: Plan;
    model?: string;
  }): Promise<void> {
    if (cacheUnavailable) return;

    const { normalized, literals, language, userId, plan, model } = args;

    try {
      const dehydrated = dehydratePlan(plan, literals);

      // Two independent portability checks: the utterance scrubber caught what
      // the user typed, this catches what the planner produced. A plan that
      // resolved a name into a row id is tenant-specific even if the question
      // looked generic.
      const { portable: utterancePortable } = normalizeUtterance(normalized);
      const planPortability = isPlanPortable(dehydrated);
      const portable = utterancePortable && planPortability.portable;

      if (!portable) {
        logger.debug(
          { reason: planPortability.reason ?? 'utterance names a person or record' },
          'Storing plan privately rather than globally'
        );
      }

      let embedding: number[] | null = null;
      try {
        const service = new EmbeddingService(process.env.OPENAI_API_KEY!, supabaseServer);
        embedding = (await service.generateEmbedding(normalized)).embedding;
      } catch (err) {
        // An entry without an embedding still serves L1, which is the cheaper
        // and more common path anyway.
        logger.warn({ err }, 'Could not embed plan; storing without semantic search');
      }

      const entities = [...new Set((plan.steps ?? []).map((s) => s.entity))];

      const hash = cacheKey(normalized, language, CATALOG_VERSION);
      const scope = portable ? null : userId;

      const row = {
        user_id: scope,
        utterance_normalized: normalized,
        utterance_hash: hash,
        language,
        catalog_version: CATALOG_VERSION,
        plan: dehydrated,
        param_slots: literals.map((l) => ({ slot: l.slot, kind: l.kind })),
        entities,
        embedding: embedding ? JSON.stringify(embedding) : null,
        created_by_model: model,
        last_seen: new Date().toISOString(),
      };

      // Deliberately NOT an upsert.
      //
      // The unique index is on (utterance_hash, COALESCE(user_id, …)) — an
      // EXPRESSION index, because a plain unique over a nullable user_id would
      // let every portable entry duplicate (Postgres treats each NULL as
      // distinct). Postgres cannot match an expression index to an ON CONFLICT
      // written with plain column names, so upsert fails with 42P10.
      //
      // Select-then-write costs one extra round trip and needs no schema change.
      const scopeQuery = supabaseServer.from(TABLE).select('id').eq('utterance_hash', hash);

      // A portable entry is identified by user_id IS NULL, a private one by
      // equality — `.is()` cannot express the latter, `.eq()` cannot express
      // the former.
      const existing = await (scope === null
        ? scopeQuery.is('user_id', null)
        : scopeQuery.eq('user_id', scope)
      ).limit(1);

      let error = existing.error;

      if (isMissingTable(error)) {
        cacheUnavailable = true;
        return;
      }

      const found = (existing.data as Array<{ id: string }> | null)?.[0];

      if (found) {
        ({ error } = await supabaseServer.from(TABLE).update(row).eq('id', found.id));
      } else {
        ({ error } = await supabaseServer.from(TABLE).insert(row));

        // A concurrent turn may have inserted the same shape first. The unique
        // index doing its job is not a failure worth reporting.
        if (error && /duplicate key/i.test(error.message)) return;
      }

      if (isMissingTable(error)) {
        cacheUnavailable = true;
        return;
      }
      if (error) logger.warn({ err: error }, 'Could not store plan in cache');
    } catch (err) {
      logger.warn({ err }, 'Plan cache store failed; continuing');
    }
  }

  /**
   * Record whether a served plan actually worked.
   *
   * This is what stops a bad entry being served forever: two failures with no
   * successes and the search function skips it.
   */
  async recordOutcome(entryId: string, success: boolean): Promise<void> {
    if (cacheUnavailable) return;
    try {
      await supabaseServer.rpc('record_business_chat_plan_outcome', {
        p_id: entryId,
        p_success: success,
      });
    } catch (err) {
      logger.debug({ err }, 'Could not record plan outcome (non-blocking)');
    }
  }
}

let singleton: PlanCache | null = null;

export function getPlanCache(): PlanCache {
  if (!singleton) singleton = new PlanCache();
  return singleton;
}

/** Test seam — also clears the "table missing" latch. */
export function resetPlanCache(): void {
  singleton = null;
  cacheUnavailable = false;
}
