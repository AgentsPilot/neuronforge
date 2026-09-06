/**
 * Record a chat turn that cost nothing.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY A ZERO-TOKEN ROW IS THE POINT
 *
 * `token_usage` records CALLS MADE. A cache hit makes no call, so it writes no
 * row — which means the table can tell you what was spent but never what was
 * served. Those are different questions, and the second is the one that matters:
 *
 *   - cost per TURN needs a count of turns, and turns are the missing denominator
 *   - cache hit rate is unmeasurable when hits are, by construction, invisible
 *   - a cheaper prompt and a better hit rate both reduce spend, and without this
 *     you cannot tell which one moved
 *
 * So every turn writes at least one row. A cached turn writes this one: zero
 * tokens, zero cost, tagged with which layer served it. `turns = count(distinct
 * session_id)` then holds for the whole table, and hit rate is a ratio over rows
 * that all exist.
 *
 * Deliberately in `token_usage` rather than a second table. One store means one
 * query answers "what did chat cost per question", instead of a join between a
 * table of calls and a table of turns that must be kept consistent.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * @module lib/business-os/bizql/telemetry
 */

import { createLogger } from '@/lib/logger';
import { AIAnalyticsService } from '@/lib/analytics/aiAnalytics';
import { supabaseServer } from '@/lib/supabaseServer';

const logger = createLogger({ module: 'BizQLTurnUsage' });

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * One instance, created lazily.
 *
 * The service has no singleton export and every caller constructs its own, so
 * this follows the house pattern rather than inventing a shared one — but it is
 * built once rather than per turn.
 */
let analytics: AIAnalyticsService | null = null;

function getAnalytics(): AIAnalyticsService {
  // The client is REQUIRED: constructed without one, trackAICall logs a warning
  // and returns, so every turn would be silently unrecorded — which is how this
  // was broken for its first three test runs.
  if (!analytics) analytics = new AIAnalyticsService(supabaseServer);
  return analytics;
}

/**
 * Which layer answered.
 *
 * Deliberately the SAME names the cache and its logs already use
 * (`CacheLayer` in cache/PlanCache.ts). A second vocabulary for one concept —
 * l1/l2 versus exact/semantic — is how two descriptions of the same thing drift
 * apart, which this codebase has paid for more than once.
 */
export type ServedBy = 'exact' | 'semantic';

export interface CachedTurnArgs {
  userId: string;
  /** The turn id — the route's correlationId. Groups every row for one question. */
  turnId: string;
  servedBy: ServedBy;
  /** How long the turn took, so a cached turn's latency is comparable to a planned one. */
  latencyMs?: number;
  /**
   * Model the CACHED plan was originally produced by, when known. Recorded so a
   * hit is attributable to the model that paid for it, not left blank.
   */
  originalModel?: string;
}

/**
 * Record a turn served without calling a model.
 *
 * Never throws and never blocks: telemetry that can fail a user's turn is worse
 * than telemetry that occasionally misses a row.
 */
export async function recordCachedTurn(args: CachedTurnArgs): Promise<void> {
  try {
    // `session_id` is a uuid column. A free-form turn id is silently dropped,
    // which would leave the row present but ungroupable — the exact failure this
    // module exists to prevent. Better to log the mismatch than record a turn
    // that cannot be counted.
    if (!UUID.test(args.turnId)) {
      logger.warn({ turnId: args.turnId }, 'Turn id is not a uuid; usage row would be ungroupable');
      return;
    }

    await getAnalytics().trackAICall({
      user_id: args.userId,
      provider: 'cache',
      // Not a model name, and deliberately not left empty: a reader grouping by
      // model should see that nothing was invoked.
      model_name: args.originalModel ? `cache:${args.originalModel}` : 'cache',
      input_tokens: 0,
      output_tokens: 0,
      cost_usd: 0,
      session_id: args.turnId,
      feature: 'business-os-chat',
      component: 'BizQLPlanCache',
      request_type: 'chat',
      activity_type: 'cache_hit',
      activity_name: args.servedBy,
      latency_ms: args.latencyMs,
      success: true,
    });
  } catch (err) {
    logger.warn({ err, turnId: args.turnId }, 'Failed to record cached turn (non-blocking)');
  }
}
