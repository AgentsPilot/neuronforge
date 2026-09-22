/**
 * What the Business OS chat costs, per question.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE NUMBER THAT MATTERS IS PER TURN, NOT PER CALL.
 *
 * `token_usage` is a log of API calls. On its own it answers "what did we spend",
 * which is not the question anyone actually has. The useful questions are:
 *
 *   - what does one question from a user cost?
 *   - how often do we answer without spending anything?
 *   - how much are we wasting on repairs?
 *
 * All three need turns, not calls, which is why every turn now writes at least
 * one row (see turnUsage.ts) and why every row for one question shares a
 * `session_id`. Group by that and the answers fall out of one table.
 *
 * A NOTE ON THE HISTORY
 *
 * Rows written before this instrumentation have no `session_id` and no
 * cache-hit rows. Any per-turn figure computed across them divides by the wrong
 * denominator and flatters the result. `turnsCovered` reports how many rows had
 * a turn id, so a reader can see when the series became trustworthy instead of
 * being quietly misled.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * @module lib/business-os/bizql/telemetry
 */

import { createLogger } from '@/lib/logger';
import { BOS_CHAT_FEATURE } from '@/lib/business-os/llm/callCatalog';
// The module path, not the repositories barrel: nothing else needs the chat
// row type, and a smaller barrel surface keeps files out of gates and cycles.
import {
  TOKEN_USAGE_CHAT_READ_LIMITS,
  TokenUsageRepository,
  type LedgerChatRow,
} from '@/lib/repositories/TokenUsageRepository';

const logger = createLogger({ module: 'BizQLUsageReport' });

export interface UsageRow {
  session_id: string | null;
  activity_type: string | null;
  activity_name: string | null;
  model_name: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
  cost_usd: number | null;
  latency_ms: number | null;
  success: boolean | null;
  created_at: string;
}

/**
 * How much of the window a read covered (Layer 1.5 F-1). `truncated` means the
 * read stopped at `cap` rows, so every figure is a floor, not a total.
 */
export interface ReadCoverage {
  truncated: boolean;
  cap: number;
}

/** The summarised figures, before read coverage is attached. */
export interface ChatUsageSummary {
  from: string;
  to: string;

  /** Questions asked — distinct turns, not API calls. */
  turns: number;
  /** Calls made. Higher than `turns` when repairs fire, lower when the cache hits. */
  calls: number;

  /** Everything spent in the window, including calls with no turn id. */
  totalCostUsd: number;
  /**
   * The part of `totalCostUsd` that belongs to identifiable turns.
   *
   * Separate because dividing the WHOLE spend by the ATTRIBUTED turns mixes two
   * populations and produces a number that is wrong by the ratio between them —
   * it read $0.060 per turn against a true $0.0006 when only 1% of rows carried
   * an id. Cost per turn is computed from this, never from the total.
   */
  attributedCostUsd: number;
  /** The headline. Null when no turn is identifiable, rather than a fake zero. */
  costPerTurnUsd: number | null;

  promptTokens: number;
  completionTokens: number;
  /** Prompt dominates in this system, so this is where savings live. */
  promptShare: number | null;

  cache: {
    exact: number;
    semantic: number;
    miss: number;
    /** Share of turns answered without calling a model. */
    hitRate: number | null;
  };

  /** Turns that needed a second full-prompt call. Pure waste. */
  repairs: number;
  repairRate: number | null;

  failures: number;
  medianLatencyMs: number | null;

  /**
   * How much of the window can actually be attributed to turns. Below 1, the
   * per-turn figures are computed over a subset — say so rather than round up.
   */
  turnsCovered: number;
}

export type ChatUsageReport = ChatUsageSummary & ReadCoverage;

/**
 * A failed read is `ok: false` — never an all-zero report that reads as "no
 * usage". A truncated read is `ok: true` with `truncated: true`.
 */
export type ChatUsageResult = { ok: true; report: ChatUsageReport } | { ok: false; error: string };

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

/**
 * Build the report from raw rows.
 *
 * Pure, so it can be tested without a database — the arithmetic here is the part
 * worth being sure about.
 */
export function summarise(rows: UsageRow[], from: string, to: string): ChatUsageSummary {
  const withTurn = rows.filter((r) => r.session_id);
  const turnIds = new Set(withTurn.map((r) => r.session_id!));

  const totalCost = rows.reduce((sum, r) => sum + (r.cost_usd ?? 0), 0);

  // Every per-turn figure is derived from ATTRIBUTED rows only. Mixing in rows
  // with no turn id puts their cost in the numerator while their turns are
  // missing from the denominator.
  const attributedCost = withTurn.reduce((sum, r) => sum + (r.cost_usd ?? 0), 0);
  const prompt = withTurn.reduce((sum, r) => sum + (r.input_tokens ?? 0), 0);
  const completion = withTurn.reduce((sum, r) => sum + (r.output_tokens ?? 0), 0);

  // Cache layers are counted per TURN, not per row: a turn is served by exactly
  // one layer, and counting rows would let a repaired turn vote twice.
  const layerByTurn = new Map<string, 'exact' | 'semantic' | 'miss'>();
  for (const row of withTurn) {
    const id = row.session_id!;
    if (row.activity_type === 'cache_hit') {
      layerByTurn.set(id, row.activity_name === 'semantic' ? 'semantic' : 'exact');
    } else if (!layerByTurn.has(id)) {
      layerByTurn.set(id, 'miss');
    }
  }

  const layers = [...layerByTurn.values()];
  const exact = layers.filter((l) => l === 'exact').length;
  const semantic = layers.filter((l) => l === 'semantic').length;
  const miss = layers.filter((l) => l === 'miss').length;

  const repairTurns = new Set(
    withTurn.filter((r) => r.activity_type === 'repair').map((r) => r.session_id!)
  ).size;

  const latencies = withTurn
    .map((r) => r.latency_ms)
    .filter((n): n is number => typeof n === 'number');

  return {
    from,
    to,
    turns: turnIds.size,
    calls: withTurn.filter((r) => r.activity_type !== 'cache_hit').length,
    totalCostUsd: Number(totalCost.toFixed(6)),
    attributedCostUsd: Number(attributedCost.toFixed(6)),
    costPerTurnUsd: turnIds.size ? Number((attributedCost / turnIds.size).toFixed(6)) : null,
    promptTokens: prompt,
    completionTokens: completion,
    promptShare: prompt + completion ? Number((prompt / (prompt + completion)).toFixed(4)) : null,
    cache: {
      exact,
      semantic,
      miss,
      hitRate: layers.length ? Number(((exact + semantic) / layers.length).toFixed(4)) : null,
    },
    repairs: repairTurns,
    repairRate: turnIds.size ? Number((repairTurns / turnIds.size).toFixed(4)) : null,
    failures: withTurn.filter((r) => r.success === false).length,
    medianLatencyMs: median(latencies),
    turnsCovered: rows.length ? Number((withTurn.length / rows.length).toFixed(4)) : 1,
  };
}

/** The reads this module needs; injectable so the result states can be tested. */
export interface UsageReportDeps {
  tokenUsage: Pick<TokenUsageRepository, 'listChatCallsForAccountInWindow' | 'listChatCallsAllAccountsInWindow'>;
}

// Service role, through the repository: the all-accounts read cannot run under RLS.
const defaultDeps = (): UsageReportDeps => ({ tokenUsage: new TokenUsageRepository() });

/** A ledger row in the shape the summaries take. `cost_usd` numeric may arrive as a string. */
function toUsageRow(row: LedgerChatRow): UsageRow & { user_id: string } {
  const cost = row.cost_usd === null ? null : Number(row.cost_usd);
  return {
    user_id: row.user_id,
    session_id: row.session_id,
    activity_type: row.activity_type,
    activity_name: row.activity_name,
    model_name: row.model_name,
    input_tokens: row.input_tokens,
    output_tokens: row.output_tokens,
    cost_usd: cost !== null && Number.isFinite(cost) ? cost : null,
    latency_ms: row.latency_ms,
    success: row.success,
    created_at: row.created_at,
  };
}

/**
 * Fetch and summarise a window. With `userId`, one account; without it, every
 * account — through the repository's explicitly named all-accounts read.
 */
export async function getChatUsage(
  args: { from: Date; to?: Date; userId?: string },
  deps: UsageReportDeps = defaultDeps()
): Promise<ChatUsageResult> {
  const to = args.to ?? new Date();
  const window = { start: args.from, end: to };
  const cap = TOKEN_USAGE_CHAT_READ_LIMITS.USAGE_CEILING;
  const opts = { pageSize: TOKEN_USAGE_CHAT_READ_LIMITS.PAGE_SIZE, ceiling: cap };

  const { data, error } = args.userId
    ? await deps.tokenUsage.listChatCallsForAccountInWindow(args.userId, window, BOS_CHAT_FEATURE, opts)
    : await deps.tokenUsage.listChatCallsAllAccountsInWindow(window, BOS_CHAT_FEATURE, opts);

  if (error || !data) {
    logger.error({ err: error, scope: args.userId ? 'account' : 'all_accounts' }, 'Failed to read chat usage');
    return { ok: false, error: 'Chat usage could not be read' };
  }

  if (data.reachedCeiling) {
    logger.warn({ cap }, 'Chat usage read reached its cap; figures are a floor');
  }

  const summary = summarise(data.rows.map(toUsageRow), args.from.toISOString(), to.toISOString());
  return { ok: true, report: { ...summary, truncated: data.reachedCeiling, cap } };
}


// =============================================================================
// PRICING — what one user costs, and how confident you can be about it
// =============================================================================

/**
 * Per-user cost, and the distribution across users.
 *
 * WHY A DISTRIBUTION AND NOT AN AVERAGE
 *
 * Pricing on a mean loses money precisely on the users who like the product
 * most. What matters is the tail: if p99 is 10x p50, a flat price has to carry
 * that, and you want to know it before choosing the number rather than after.
 *
 * Two variances are being measured, and they behave very differently:
 *
 *   - cost per TURN, which is nearly constant here — the prompt is the catalog,
 *     the completion is a short plan, and neither depends much on what was asked;
 *   - turns per USER, which is unbounded and is where all the real risk sits.
 *
 * Knowing which one dominates tells you whether to price per seat or per use.
 */
export interface UserCost {
  userId: string;
  turns: number;
  calls: number;
  costUsd: number;
  /** Extrapolated from the observed window. Honest only if the window is representative. */
  projectedMonthlyUsd: number;
  cacheHitRate: number | null;
}

export interface PricingReport {
  from: string;
  to: string;
  windowDays: number;

  users: UserCost[];

  /** Cost per TURN across everyone — the part that barely varies. */
  costPerTurn: { p50: number; p90: number; p99: number; max: number } | null;
  /** Projected monthly cost per USER — the part that does. */
  monthlyPerUser: { p50: number; p90: number; p99: number; max: number } | null;

  meanPromptTokens: number;
  /**
   * Prompt share of all tokens. When this is ~98%, cost tracks prompt size, so
   * the catalog's size — not the user's question — sets the price.
   */
  promptShare: number | null;

  /** Below this, treat every figure as indicative. Pricing needs weeks, not hours. */
  confidence: 'none' | 'indicative' | 'usable';
  confidenceReason: string;
}

function percentiles(values: number[]) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const at = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))];
  return {
    p50: Number(at(0.5).toFixed(6)),
    p90: Number(at(0.9).toFixed(6)),
    p99: Number(at(0.99).toFixed(6)),
    max: Number(sorted[sorted.length - 1].toFixed(6)),
  };
}

/** Rows carry a user; this groups them into something a price can be set against. */
export function summarisePricing(
  rows: Array<UsageRow & { user_id: string }>,
  from: string,
  to: string,
  windowDays: number
): PricingReport {
  const byUser = new Map<string, Array<UsageRow & { user_id: string }>>();
  for (const row of rows) {
    if (!byUser.has(row.user_id)) byUser.set(row.user_id, []);
    byUser.get(row.user_id)!.push(row);
  }

  const users: UserCost[] = [];
  const perTurnCosts: number[] = [];

  for (const [userId, userRows] of byUser) {
    const report = summarise(userRows, from, to);

    // Turns are the billing unit, so extrapolate on turns and re-apply the
    // measured per-turn cost — extrapolating raw spend would carry any
    // unattributed legacy calls into the projection.
    const turnsPerDay = report.turns / Math.max(windowDays, 1);
    const perTurn = report.costPerTurnUsd ?? 0;

    if (report.costPerTurnUsd !== null) perTurnCosts.push(report.costPerTurnUsd);

    users.push({
      userId,
      turns: report.turns,
      calls: report.calls,
      costUsd: Number(report.attributedCostUsd.toFixed(6)),
      projectedMonthlyUsd: Number((turnsPerDay * 30 * perTurn).toFixed(4)),
      cacheHitRate: report.cache.hitRate,
    });
  }

  users.sort((a, b) => b.projectedMonthlyUsd - a.projectedMonthlyUsd);

  const overall = summarise(rows, from, to);
  const attributedRows = rows.filter((r) => r.session_id);

  // State the limits of the sample rather than letting a reader assume it is
  // representative. A price set from two days of one account is a guess wearing
  // a number's clothes.
  let confidence: PricingReport['confidence'] = 'usable';
  let reason = `${users.length} user(s) over ${windowDays} day(s)`;

  if (overall.turns === 0) {
    confidence = 'none';
    reason = 'no attributed turns in this window';
  } else if (users.length < 5 || windowDays < 7 || overall.turns < 100) {
    confidence = 'indicative';
    reason =
      `${users.length} user(s), ${overall.turns} turn(s), ${windowDays} day(s) — ` +
      'too little to price on. Per-turn cost is already stable; per-user VOLUME is not yet known.';
  }

  return {
    from,
    to,
    windowDays,
    users,
    costPerTurn: percentiles(perTurnCosts),
    monthlyPerUser: percentiles(users.map((u) => u.projectedMonthlyUsd)),
    meanPromptTokens: attributedRows.length
      ? Math.round(overall.promptTokens / attributedRows.length)
      : 0,
    promptShare: overall.promptShare,
    confidence,
    confidenceReason: reason,
  };
}

/** Same contract as `ChatUsageResult`: never a zeroed report on a failed read. */
export type ChatPricingResult = { ok: true; report: PricingReport & ReadCoverage } | { ok: false; error: string };

export async function getChatPricing(
  args: { days: number },
  deps: UsageReportDeps = defaultDeps()
): Promise<ChatPricingResult> {
  const to = new Date();
  const from = new Date(Date.now() - args.days * 24 * 60 * 60 * 1000);
  const cap = TOKEN_USAGE_CHAT_READ_LIMITS.PRICING_CEILING;

  // The window now ends at "now"; before, it had no upper bound, which is the
  // same set of rows (none are written in the future).
  const { data, error } = await deps.tokenUsage.listChatCallsAllAccountsInWindow(
    { start: from, end: to },
    BOS_CHAT_FEATURE,
    { pageSize: TOKEN_USAGE_CHAT_READ_LIMITS.PAGE_SIZE, ceiling: cap }
  );

  if (error || !data) {
    logger.error({ err: error }, 'Failed to read pricing data');
    return { ok: false, error: 'Chat pricing data could not be read' };
  }

  if (data.reachedCeiling) {
    logger.warn({ cap }, 'Chat pricing read reached its cap; figures are a floor');
  }

  const report = summarisePricing(data.rows.map(toUsageRow), from.toISOString(), to.toISOString(), args.days);
  return { ok: true, report: { ...report, truncated: data.reachedCeiling, cap } };
}
