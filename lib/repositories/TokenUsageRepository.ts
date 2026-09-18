// lib/repositories/TokenUsageRepository.ts
// Read-only access to the `token_usage` ledger.
//
// INTENTIONAL SERVICE-ROLE CLIENT (RLS bypass). CLAUDE.md Rule 4 is enforced by
// SIGNATURE instead: every method REQUIRES an account id or a non-empty list of
// account ids — with ONE deliberate, named exception below. Callers:
//   - the owner usage card (`lib/business-os/usage/usageSummary.ts`), which
//     passes the session user's own id;
//   - the admin LLM usage report (`lib/business-os/usage/llmUsageReport.ts`),
//     whose routes are admin-gated through AdminAccessService before any read;
//   - the admin chat usage report (`lib/business-os/bizql/telemetry/usageReport.ts`).
//
// THE ONE ALL-ACCOUNTS READ is `listChatCallsAllAccountsInWindow`. "All
// accounts" is reached by calling a differently NAMED method, never by leaving
// an argument out, which is the mistake the rule exists to prevent. No other
// method has, or may gain, an optional account filter
// (lib/business-os/usage/__tests__/tokenUsageRepository.contract.test.ts).
//
// Deliberately imports nothing from `lib/business-os/**` (Layer 1.1 RC-7): the
// feature lists, prefixes and account ids are passed in as plain data. Importing
// the call catalog here would pull `lib/repositories/index.ts`, and every file
// that imports the barrel, into the `typecheck:bos-llm` gate.
//
// Only allow-listed columns are ever selected (`TOKEN_USAGE_COLUMNS`). Request
// and response payloads, metadata and error message text are never read.
//
// Methods never throw: they return `{ data, error }`.

import type { SupabaseClient } from '@supabase/supabase-js';
import { supabaseServer as defaultSupabase } from '@/lib/supabaseServer';
import { createLogger, type Logger } from '@/lib/logger';
import type { AgentRepositoryResult as RepositoryResult } from './types';

export interface TokenUsageWindow {
  start: Date;
  end: Date;
}

/** Rows whose feature starts with `featurePrefix`, OR is one of `features`. */
export interface TokenUsageFeatureFilter {
  featurePrefix: string;
  features: readonly string[];
}

export type TokenUsageMatch =
  | { kind: 'row_filter'; filter: TokenUsageFeatureFilter }
  | { kind: 'features'; features: readonly string[] }
  | { kind: 'label'; feature: string; component: string };

/** One ledger call, narrowed to what the verification checks display. */
export interface LedgerCallRow {
  /** uuid (see the Layer 1.1 workplan §11, WC-10). Only used to de-duplicate pages. */
  id: string;
  created_at: string;
  feature: string | null;
  component: string | null;
  session_id: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
  /** numeric; PostgREST may return it as a string. */
  cost_usd: number | string | null;
  success: boolean | null;
  error_code: string | null;
}

/** One chat-telemetry ledger row (Layer 1.5 F-1). No payloads, metadata or error text. */
export interface LedgerChatRow {
  /** uuid. Only used to de-duplicate pages. */
  id: string;
  user_id: string;
  session_id: string | null;
  activity_type: string | null;
  activity_name: string | null;
  model_name: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
  /** numeric; PostgREST may return it as a string. */
  cost_usd: number | string | null;
  latency_ms: number | null;
  success: boolean | null;
  created_at: string;
}

export interface LedgerLabelRow {
  created_at: string;
  feature: string | null;
  component: string | null;
}

export interface LedgerSummaryRow {
  feature: string | null;
  total_tokens: number | null;
  created_at: string;
}

/** A row of `business_os_usage_summary`. BIGINT columns may arrive as strings. */
export interface UsageSummaryRpcRow {
  bucket: string;
  key: string;
  tokens: number | string;
  calls: number | string;
}

/** The only column lists this repository selects. Exported for the allow-list test. */
export const TOKEN_USAGE_COLUMNS = {
  call: 'id, created_at, feature, component, session_id, input_tokens, output_tokens, cost_usd, success, error_code',
  label: 'created_at, feature, component',
  summary: 'feature, total_tokens, created_at',
  count: 'id',
  /**
   * Chat telemetry (Layer 1.5 F-1): the account and the activity, model and
   * latency dimensions the chat report groups by. `id` only de-duplicates pages.
   * Payloads, metadata and error_message stay excluded.
   */
  chat: 'id, user_id, session_id, activity_type, activity_name, model_name, input_tokens, output_tokens, cost_usd, latency_ms, success, created_at',
} as const;

export const TOKEN_USAGE_READ_LIMITS = {
  MAX_PAGE_SIZE: 1000,
  MAX_CEILING: 5000,
  MAX_LABEL_LIMIT: 500,
} as const;

/**
 * The chat report's own limits (Layer 1.5 RC-12d). They are the caps the
 * report already used (10,000 rows for usage, 50,000 for pricing), kept AS
 * THEY WERE: deliberately above MAX_CEILING, which bounds the per-account
 * verification reads, and not silently raised. A read that reaches its ceiling
 * says so (`reachedCeiling`), and the report surfaces it as truncated.
 */
export const TOKEN_USAGE_CHAT_READ_LIMITS = {
  PAGE_SIZE: 1000,
  USAGE_CEILING: 10_000,
  PRICING_CEILING: 50_000,
} as const;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Feature values and the prefix are interpolated into a PostgREST `or` filter.
// They come from code constants today; this keeps a future caller from turning
// that into a filter-syntax injection.
const LABEL_PATTERN = /^[a-z0-9-]+$/;
// Components are only ever used with `.eq()` (a single operator argument).
const COMPONENT_PATTERN = /^[A-Za-z0-9_-]+$/;

class TokenUsageGuardError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TokenUsageGuardError';
  }
}

function isValidDate(value: Date): boolean {
  return value instanceof Date && !Number.isNaN(value.getTime());
}

export class TokenUsageRepository {
  private supabase: SupabaseClient;
  private logger: Logger;

  constructor(supabaseClient?: SupabaseClient) {
    this.supabase = supabaseClient || defaultSupabase;
    this.logger = createLogger({ service: 'TokenUsageRepository' });
  }

  // ============ Guards (run before any query) ============

  private assertAccount(userId: string): void {
    if (typeof userId !== 'string' || !UUID_PATTERN.test(userId)) {
      throw new TokenUsageGuardError('An account id (UUID) is required');
    }
  }

  private assertAccounts(userIds: readonly string[]): void {
    if (!Array.isArray(userIds) || userIds.length === 0) {
      throw new TokenUsageGuardError('At least one account id is required');
    }
    userIds.forEach((id) => this.assertAccount(id));
  }

  private assertWindow(window: TokenUsageWindow): void {
    if (!window || !isValidDate(window.start) || !isValidDate(window.end) || window.start > window.end) {
      throw new TokenUsageGuardError('A valid window (start <= end) is required');
    }
  }

  private assertFilter(filter: TokenUsageFeatureFilter): void {
    if (!filter || !LABEL_PATTERN.test(filter.featurePrefix)) {
      throw new TokenUsageGuardError('Invalid feature prefix');
    }
    this.assertFeatures(filter.features, true);
  }

  private assertFeatures(features: readonly string[], allowEmpty: boolean): void {
    if (!Array.isArray(features) || (!allowEmpty && features.length === 0)) {
      throw new TokenUsageGuardError('At least one feature value is required');
    }
    for (const feature of features) {
      if (typeof feature !== 'string' || !LABEL_PATTERN.test(feature)) {
        throw new TokenUsageGuardError('Invalid feature value');
      }
    }
  }

  private assertMatch(match: TokenUsageMatch): void {
    switch (match?.kind) {
      case 'row_filter':
        this.assertFilter(match.filter);
        return;
      case 'features':
        this.assertFeatures(match.features, false);
        return;
      case 'label':
        if (!LABEL_PATTERN.test(match.feature) || !COMPONENT_PATTERN.test(match.component)) {
          throw new TokenUsageGuardError('Invalid label');
        }
        return;
      default:
        throw new TokenUsageGuardError('A match is required');
    }
  }

  private assertIntRange(value: number, min: number, max: number, name: string): void {
    if (!Number.isInteger(value) || value < min || value > max) {
      throw new TokenUsageGuardError(`${name} must be an integer between ${min} and ${max}`);
    }
  }

  private static orExpression(filter: TokenUsageFeatureFilter): string {
    const like = `feature.like.${filter.featurePrefix}*`;
    if (filter.features.length === 0) return like;
    return `${like},feature.in.(${filter.features.map((f) => `"${f}"`).join(',')})`;
  }

  // PostgREST builder chains are structurally typed per call; `applyMatch`
  // only chains filter methods, so a minimal shape keeps it strict.
  private static applyMatch<Q extends MatchableQuery<Q>>(query: Q, match: TokenUsageMatch): Q {
    switch (match.kind) {
      case 'row_filter':
        return query.or(TokenUsageRepository.orExpression(match.filter));
      case 'features':
        return query.in('feature', [...match.features]);
      case 'label':
        return query.eq('feature', match.feature).eq('component', match.component);
    }
  }

  private fail<T>(method: string, error: unknown, readErrorLevel: 'warn' | 'debug' = 'warn'): RepositoryResult<T> {
    if (error instanceof TokenUsageGuardError) {
      this.logger.warn({ method, reason: error.message }, 'Token usage read refused by guard');
    } else {
      this.logger[readErrorLevel]({ err: error, method }, 'Token usage read failed');
    }
    return { data: null, error: error instanceof Error ? error : new Error(String(error)) };
  }

  // ============ Usage card (owner) ============

  /** The card's totals function. It has no end bound (Layer 1.1 M-1). */
  async usageSummaryByFeatureAndDay(
    userId: string,
    since: Date
  ): Promise<RepositoryResult<UsageSummaryRpcRow[]>> {
    try {
      this.assertAccount(userId);
      if (!isValidDate(since)) throw new TokenUsageGuardError('A valid start time is required');

      const { data, error } = await this.supabase.rpc('business_os_usage_summary', {
        p_user_id: userId,
        p_since: since.toISOString(),
      });
      if (error) throw error;

      const rows = (data ?? []) as UsageSummaryRpcRow[];
      this.logger.debug({ method: 'usageSummaryByFeatureAndDay', rows: rows.length }, 'Usage summary read');
      return { data: rows, error: null };
    } catch (error) {
      // debug, not warn: an unavailable function is an expected state (migration
      // pending) that the caller already reports once, with the fix, at warn.
      // Warning here too would double the card's log line on every load.
      return this.fail('usageSummaryByFeatureAndDay', error, 'debug');
    }
  }

  /** One page (inclusive range) of the card's row fallback, newest first. */
  async listSummaryRowsPage(
    userId: string,
    since: Date,
    from: number,
    to: number
  ): Promise<RepositoryResult<LedgerSummaryRow[]>> {
    try {
      this.assertAccount(userId);
      if (!isValidDate(since)) throw new TokenUsageGuardError('A valid start time is required');
      this.assertIntRange(from, 0, Number.MAX_SAFE_INTEGER, 'from');
      this.assertIntRange(to - from + 1, 1, TOKEN_USAGE_READ_LIMITS.MAX_PAGE_SIZE, 'page size');

      const { data, error } = await this.supabase
        .from('token_usage')
        .select(TOKEN_USAGE_COLUMNS.summary)
        .eq('user_id', userId)
        .gte('created_at', since.toISOString())
        .order('created_at', { ascending: false })
        .range(from, to);
      if (error) throw error;

      return { data: (data ?? []) as LedgerSummaryRow[], error: null };
    } catch (error) {
      return this.fail('listSummaryRowsPage', error);
    }
  }

  // ============ LLM usage verification (admin) ============

  /**
   * Every matching call of ONE account in the window, newest first
   * (`created_at DESC, id DESC`), paged, up to `ceiling` rows.
   * `reachedCeiling` is true when `ceiling` rows were read: the result may be
   * incomplete and a caller must not report it as proven.
   */
  async listCallsInWindow(
    userId: string,
    window: TokenUsageWindow,
    filter: TokenUsageFeatureFilter,
    opts: { pageSize: number; ceiling: number }
  ): Promise<RepositoryResult<{ rows: LedgerCallRow[]; reachedCeiling: boolean }>> {
    try {
      this.assertAccount(userId);
      this.assertWindow(window);
      this.assertFilter(filter);
      this.assertIntRange(opts?.pageSize, 1, TOKEN_USAGE_READ_LIMITS.MAX_PAGE_SIZE, 'pageSize');
      this.assertIntRange(opts?.ceiling, 1, TOKEN_USAGE_READ_LIMITS.MAX_CEILING, 'ceiling');

      const rows: LedgerCallRow[] = [];
      const seen = new Set<string>();
      let pages = 0;

      for (let from = 0; rows.length < opts.ceiling; from += opts.pageSize) {
        const to = from + Math.min(opts.pageSize, opts.ceiling - from) - 1;
        const { data, error } = await this.supabase
          .from('token_usage')
          .select(TOKEN_USAGE_COLUMNS.call)
          .eq('user_id', userId)
          .gte('created_at', window.start.toISOString())
          .lte('created_at', window.end.toISOString())
          .or(TokenUsageRepository.orExpression(filter))
          .order('created_at', { ascending: false })
          .order('id', { ascending: false })
          .range(from, to);
        if (error) throw error;
        pages++;

        const page = (data ?? []) as LedgerCallRow[];
        for (const row of page) {
          // A row inserted during paging can shift an older row onto the next
          // page; it is read twice, never skipped. Keep the first copy.
          const key = String(row.id);
          if (seen.has(key)) continue;
          seen.add(key);
          rows.push(row);
        }

        if (page.length < to - from + 1) break;
        if (from + opts.pageSize >= opts.ceiling) break;
      }

      const reachedCeiling = rows.length >= opts.ceiling;
      this.logger.debug(
        { method: 'listCallsInWindow', rows: rows.length, pages, reachedCeiling },
        'Ledger calls read'
      );
      return { data: { rows: rows.slice(0, opts.ceiling), reachedCeiling }, error: null };
    } catch (error) {
      return this.fail('listCallsInWindow', error);
    }
  }

  // ============ Chat telemetry (admin chat usage report) ============

  /**
   * Chat calls of ONE account in the window, newest first, paged, up to
   * `ceiling` rows. `feature` is the chat feature value, passed in as data so
   * this module never imports the call catalog.
   */
  async listChatCallsForAccountInWindow(
    userId: string,
    window: TokenUsageWindow,
    feature: string,
    opts: { pageSize: number; ceiling: number }
  ): Promise<RepositoryResult<{ rows: LedgerChatRow[]; reachedCeiling: boolean }>> {
    const method = 'listChatCallsForAccountInWindow';
    try {
      this.assertAccount(userId);
      this.assertChatRead(window, feature, opts);
      const result = await this.pageChatCalls(method, window, feature, opts, userId);
      this.logger.debug({ method, rows: result.rows.length, reachedCeiling: result.reachedCeiling }, 'Chat calls read');
      return { data: result, error: null };
    } catch (error) {
      return this.fail(method, error);
    }
  }

  /**
   * Chat calls of EVERY account in the window — the one deliberate all-accounts
   * read in this repository, and named so.
   *
   * Callers: `getChatUsage` / `getChatPricing` in
   * lib/business-os/bizql/telemetry/usageReport.ts, reached only from
   * `app/api/admin/chat-usage/route.ts` (admin-gated through AdminAccessService
   * before any read) and the operator CLI `scripts/chat-usage-report.ts`.
   * Never call it from an owner-facing path.
   *
   * Logged at info, not debug: it is the only cross-tenant read here.
   */
  async listChatCallsAllAccountsInWindow(
    window: TokenUsageWindow,
    feature: string,
    opts: { pageSize: number; ceiling: number }
  ): Promise<RepositoryResult<{ rows: LedgerChatRow[]; reachedCeiling: boolean }>> {
    const method = 'listChatCallsAllAccountsInWindow';
    try {
      this.assertChatRead(window, feature, opts);
      const result = await this.pageChatCalls(method, window, feature, opts, null);
      this.logger.info(
        { method, rows: result.rows.length, reachedCeiling: result.reachedCeiling },
        'Chat calls read across all accounts'
      );
      return { data: result, error: null };
    } catch (error) {
      return this.fail(method, error);
    }
  }

  private assertChatRead(window: TokenUsageWindow, feature: string, opts: { pageSize: number; ceiling: number }): void {
    this.assertWindow(window);
    this.assertFeatures([feature], false);
    this.assertIntRange(opts?.pageSize, 1, TOKEN_USAGE_READ_LIMITS.MAX_PAGE_SIZE, 'pageSize');
    this.assertIntRange(opts?.ceiling, 1, TOKEN_USAGE_CHAT_READ_LIMITS.PRICING_CEILING, 'ceiling');
  }

  /**
   * The shared pager behind the two named chat reads. Private on purpose: the
   * `accountId: null` branch is reachable only through the method whose name
   * says "AllAccounts". Same order, paging and de-duplication as
   * `listCallsInWindow`.
   */
  private async pageChatCalls(
    method: string,
    window: TokenUsageWindow,
    feature: string,
    opts: { pageSize: number; ceiling: number },
    accountId: string | null
  ): Promise<{ rows: LedgerChatRow[]; reachedCeiling: boolean }> {
    const rows: LedgerChatRow[] = [];
    const seen = new Set<string>();

    for (let from = 0; rows.length < opts.ceiling; from += opts.pageSize) {
      const to = from + Math.min(opts.pageSize, opts.ceiling - from) - 1;
      let query = this.supabase
        .from('token_usage')
        .select(TOKEN_USAGE_COLUMNS.chat)
        .eq('feature', feature)
        .gte('created_at', window.start.toISOString())
        .lte('created_at', window.end.toISOString());
      if (accountId !== null) query = query.eq('user_id', accountId);

      const { data, error } = await query
        .order('created_at', { ascending: false })
        .order('id', { ascending: false })
        .range(from, to);
      if (error) throw error;

      const page = (data ?? []) as LedgerChatRow[];
      for (const row of page) {
        const key = String(row.id);
        if (seen.has(key)) continue;
        seen.add(key);
        rows.push(row);
      }

      if (page.length < to - from + 1) break;
      if (from + opts.pageSize >= opts.ceiling) break;
    }

    const reachedCeiling = rows.length >= opts.ceiling;
    if (reachedCeiling) this.logger.warn({ method, ceiling: opts.ceiling }, 'Chat calls read reached its ceiling');
    return { rows: rows.slice(0, opts.ceiling), reachedCeiling };
  }

  /** Exact number of matching rows for the given accounts in the window. */
  async countInWindow(
    userIds: readonly string[],
    window: TokenUsageWindow,
    match: TokenUsageMatch
  ): Promise<RepositoryResult<number>> {
    try {
      this.assertAccounts(userIds);
      this.assertWindow(window);
      this.assertMatch(match);

      const query = this.supabase
        .from('token_usage')
        .select(TOKEN_USAGE_COLUMNS.count, { count: 'exact', head: true })
        .in('user_id', [...userIds])
        .gte('created_at', window.start.toISOString())
        .lte('created_at', window.end.toISOString());

      const { count, error } = await TokenUsageRepository.applyMatch(query, match);
      if (error) throw error;

      this.logger.debug({ method: 'countInWindow', kind: match.kind, count }, 'Ledger count read');
      return { data: count ?? 0, error: null };
    } catch (error) {
      return this.fail('countInWindow', error);
    }
  }

  /** Newest-first labels (time, feature, component) of matching rows, capped at `limit`. */
  async listLabelsInWindow(
    userIds: readonly string[],
    window: TokenUsageWindow,
    match: TokenUsageMatch,
    limit: number
  ): Promise<RepositoryResult<LedgerLabelRow[]>> {
    try {
      this.assertAccounts(userIds);
      this.assertWindow(window);
      this.assertMatch(match);
      this.assertIntRange(limit, 1, TOKEN_USAGE_READ_LIMITS.MAX_LABEL_LIMIT, 'limit');

      const query = this.supabase
        .from('token_usage')
        .select(TOKEN_USAGE_COLUMNS.label)
        .in('user_id', [...userIds])
        .gte('created_at', window.start.toISOString())
        .lte('created_at', window.end.toISOString());

      const { data, error } = await TokenUsageRepository.applyMatch(query, match)
        .order('created_at', { ascending: false })
        .limit(limit);
      if (error) throw error;

      return { data: (data ?? []) as LedgerLabelRow[], error: null };
    } catch (error) {
      return this.fail('listLabelsInWindow', error);
    }
  }
}

/** The filter methods `applyMatch` chains; satisfied by the supabase-js filter builder. */
interface MatchableQuery<Q> {
  or(filters: string): Q;
  in(column: string, values: string[]): Q;
  eq(column: string, value: string): Q;
}

// Singleton instance for convenience
export const tokenUsageRepository = new TokenUsageRepository();
