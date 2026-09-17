/**
 * What an account has used — per-feature and per-day token totals — computed
 * exactly the way the owner's usage card computes them.
 *
 * Extracted from `app/api/business-os/usage/route.ts` (Layer 1.1 FR-23) so the
 * admin LLM usage report's Check 5 uses the SAME computation as the card, not a
 * copy of it. No behaviour change: the route's response is pinned by
 * `app/api/business-os/usage/__tests__/route.test.ts`.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * DATABASE FIRST, ROWS AS FALLBACK
 *
 * `business_os_usage_summary` does the sums in Postgres and returns a handful of
 * rows. The old path — paging every matching `token_usage` row into Node — is
 * kept as a FALLBACK, narrowed to three columns, for an environment whose
 * migration has not run yet. The fallback says so in the log when it runs.
 *
 * The paging stays. PostgREST caps a page at 1,000 rows, and a query that
 * stopped there silently understated one real account by 52%.
 *
 * The function has no end bound: totals run from `since` to the time of the
 * read (Layer 1.1 M-1).
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * @module lib/business-os/usage/usageSummary
 */

import { supabaseServer } from '@/lib/supabaseServer';
import { ConfigRepository } from '@/lib/repositories/ConfigRepository';
import {
  tokenUsageRepository,
  type TokenUsageRepository,
  type UsageSummaryRpcRow,
} from '@/lib/repositories/TokenUsageRepository';
import { summariseUsageByCategory } from '@/lib/business-os/usage/usageCategories';

/** What the card needs, however it was obtained. */
export interface UsageSummary {
  totalTokens: number;
  totalCalls: number;
  /** feature name → its totals. */
  byFeature: Map<string, { tokens: number; calls: number }>;
  /** YYYY-MM-DD (UTC) → tokens that day. */
  byDay: Map<string, number>;
}

export type UsageSummedBy = 'database' | 'rows';

/** The one logger method this module needs; a request's child logger fits. */
export interface UsageSummaryLogger {
  warn: (ctx: Record<string, unknown>, msg: string) => void;
}

export interface UsageSummaryDeps {
  tokenUsage: Pick<TokenUsageRepository, 'usageSummaryByFeatureAndDay' | 'listSummaryRowsPage'>;
}

export interface TokensPerCreditDeps {
  config: Pick<ConfigRepository, 'getSystemConfig'>;
}

/** The documented default when `tokens_per_pilot_credit` is missing or invalid. */
export const DEFAULT_TOKENS_PER_CREDIT = 10;

const SUMMARY_PAGE_SIZE = 1000;

function emptySummary(): UsageSummary {
  return { totalTokens: 0, totalCalls: 0, byFeature: new Map(), byDay: new Map() };
}

/**
 * The totals from the function's rows.
 *
 * BIGINT arrives as a string from PostgREST once it is large enough, and
 * `'12' + 5` is '125', so values are coerced on the way in. Totals come from
 * the FEATURE rows alone: both buckets cover the same rows, so adding the day
 * rows as well would double everything.
 */
export function summaryFromRpcRows(rows: readonly UsageSummaryRpcRow[]): UsageSummary {
  const summary = emptySummary();

  for (const row of rows) {
    const tokens = Number(row.tokens) || 0;
    const calls = Number(row.calls) || 0;

    if (row.bucket === 'feature') {
      summary.byFeature.set(row.key, { tokens, calls });
      summary.totalTokens += tokens;
      summary.totalCalls += calls;
    } else if (row.bucket === 'day') {
      summary.byDay.set(row.key, tokens);
    }
  }

  return summary;
}

/**
 * The totals, summed in Postgres.
 *
 * Returns null — never throws and never a zeroed summary — when the function is
 * not there, so the caller can tell "no usage" apart from "not migrated yet".
 * Reporting a missing migration as zero consumption would draw a full gauge for
 * a business that has used its whole allowance.
 */
async function summaryFromDatabase(
  userId: string,
  since: Date,
  log: UsageSummaryLogger,
  deps: UsageSummaryDeps
): Promise<UsageSummary | null> {
  const { data, error } = await deps.tokenUsage.usageSummaryByFeatureAndDay(userId, since);

  if (error) {
    log.warn(
      { err: error },
      'business_os_usage_summary unavailable — falling back to reading the rows. Run supabase/migrations/20260929_usage_summary.sql'
    );
    return null;
  }

  return summaryFromRpcRows(data ?? []);
}

/** The same totals, computed the old way. Throws on a page read error, as it always has. */
async function summaryFromRows(userId: string, since: Date, deps: UsageSummaryDeps): Promise<UsageSummary> {
  const summary = emptySummary();

  for (let from = 0; ; from += SUMMARY_PAGE_SIZE) {
    const { data, error } = await deps.tokenUsage.listSummaryRowsPage(
      userId,
      since,
      from,
      from + SUMMARY_PAGE_SIZE - 1
    );

    if (error) throw error;

    const rows = data ?? [];

    for (const row of rows) {
      const tokens = row.total_tokens || 0;
      const feature = row.feature || 'unknown';

      summary.totalTokens += tokens;
      summary.totalCalls += 1;

      const existing = summary.byFeature.get(feature) ?? { tokens: 0, calls: 0 };
      existing.tokens += tokens;
      existing.calls += 1;
      summary.byFeature.set(feature, existing);

      const day = new Date(row.created_at).toISOString().slice(0, 10);
      summary.byDay.set(day, (summary.byDay.get(day) ?? 0) + tokens);
    }

    if (rows.length < SUMMARY_PAGE_SIZE) break;
  }

  return summary;
}

/**
 * One account's usage since `since`: the database function first, the rows
 * when the function is unavailable. `summedBy` says which ran.
 */
export async function readUsageSummary(
  userId: string,
  since: Date,
  log: UsageSummaryLogger,
  deps: UsageSummaryDeps = { tokenUsage: tokenUsageRepository }
): Promise<{ summary: UsageSummary; summedBy: UsageSummedBy }> {
  const fromDatabase = await summaryFromDatabase(userId, since, log, deps);
  if (fromDatabase) return { summary: fromDatabase, summedBy: 'database' };
  return { summary: await summaryFromRows(userId, since, deps), summedBy: 'rows' };
}

/** A positive integer, else the documented 10. */
export function parseTokensPerCredit(value: unknown): number {
  const parsed = parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_TOKENS_PER_CREDIT;
}

/**
 * Tokens per Pilot Credit, from system config, with the SERVICE-ROLE client.
 *
 * `ConfigRepository` defaults to the browser client, so the server client is
 * passed in explicitly. Any failure (no row, several rows, an error, a throw)
 * falls back to 10, exactly as the route's direct read did.
 */
export async function readTokensPerCredit(
  deps: TokensPerCreditDeps = { config: new ConfigRepository(supabaseServer) }
): Promise<number> {
  try {
    const { data } = await deps.config.getSystemConfig('tokens_per_pilot_credit');
    return parseTokensPerCredit(data);
  } catch {
    return DEFAULT_TOKENS_PER_CREDIT;
  }
}

/** Tokens → Pilot Credits, rounded the way the card rounds. */
export function toCredits(tokens: number, tokensPerCredit: number): number {
  return Math.round(tokens / tokensPerCredit);
}

export interface CardBreakdownLine {
  key: string;
  credits: number;
  calls: number;
  share: number;
}

/** The card's category breakdown: categories with tokens, by credits, largest first. */
export function buildCardBreakdown(usage: UsageSummary, tokensPerCredit: number): CardBreakdownLine[] {
  const byCategory = summariseUsageByCategory(usage.byFeature);

  return [...byCategory.entries()]
    .filter(([, v]) => v.tokens > 0)
    .map(([key, v]) => ({
      key,
      credits: toCredits(v.tokens, tokensPerCredit),
      calls: v.calls,
      share: usage.totalTokens ? Number((v.tokens / usage.totalTokens).toFixed(4)) : 0,
    }))
    .sort((a, b) => b.credits - a.credits);
}
