/**
 * What an account has used in TOKENS — per-feature and per-day token totals,
 * from `token_usage` — for the admin LLM usage report's Check 5 ("Token usage
 * by feature").
 *
 * History: extracted from the owner usage route in Layer 1.1 (FR-23). Since
 * credit deduction slice 6a the owner card reads the credit ledger instead
 * (`lib/business-os/credits/ownerCreditUsage.ts`), so nothing here describes
 * what an owner sees any more; this module serves the admin check only. Its
 * "credits" are the legacy token measure (tokens ÷ `tokens_per_pilot_credit`),
 * not the ledger's credits.
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

/** What Check 5 needs, however it was obtained. */
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

/** Tokens → the legacy token-credit measure, rounded to a whole number (Check 5 only). */
export function toCredits(tokens: number, tokensPerCredit: number): number {
  return Math.round(tokens / tokensPerCredit);
}
