// lib/repositories/AdminTokenUsageAnalyticsRepository.ts
// Cross-account reads of the `token_usage` ledger for the admin Cost Analytics
// screen ("AI cost & usage", /admin/analytics).
//
// ADMIN-ONLY, CROSS-ACCOUNT BY DESIGN. This is the first admin-only
// repository (ADMIN_IDENTIFICATION_AND_ACCESS.md OI-9 names it as the
// template), so the rules are written down here:
//
//   - SERVICE-ROLE CLIENT, ON PURPOSE. The read spans every account. RLS has no
//     "a platform admin reads every ledger row" policy to lean on, and the
//     owner policy would return one account at most. CLAUDE.md Rule 4
//     (`.eq('user_id', userId)`) is replaced by the caller's gate. The ONLY
//     permitted callers are `app/api/admin/token-usage/drill-down/route.ts`
//     (Cost Analytics) and `app/api/admin/health-summary/route.ts` (the Health
//     landing, admin reorganisation slice 4: the count and the paged cost read
//     below). Both run `requireAdmin` before they reach this class. A source guard
//     (lib/repositories/__tests__/AdminTokenUsageAnalyticsRepository.test.ts)
//     fails if anything outside `app/api/admin/**` imports it.
//   - "All accounts" is in the METHOD NAME, never an omitted argument
//     (the same rule as TokenUsageRepository).
//   - It imports nothing from `lib/business-os/**` (RC-7). The Business OS row
//     filter arrives as data, and the expression is built by
//     TokenUsageRepository's exported `buildFeatureFilterOrExpression`, whose
//     guard refuses any value that could inject filter syntax.
//   - Only allow-listed columns are selected: never payloads, metadata or
//     error text.
//   - Every method takes an AdminReadContext FIRST and REQUIRED: the request's
//     correlation id and the admin's id go on every log line, so the read can
//     be joined to the route's own log line (who read how much, for which
//     request). Required, not optional, because an unattributed cross-tenant
//     read is exactly what the accountability trail exists to prevent.
//   - Methods never throw: they return `{ data, error }`.
//
// KNOWN AND PARKED (user, 2026-09-25; slice 2 workplan, Open Issues OI-P1):
// the read is a single unpaged request, exactly as the route's inline read was,
// so PostgREST's 1,000-row cap applies and a busier window is truncated. The
// screen says so. Paging was deliberately NOT added in this change.

import type { SupabaseClient } from '@supabase/supabase-js';
import { supabaseServer as defaultSupabase } from '@/lib/supabaseServer';
import { createLogger, type Logger } from '@/lib/logger';
import {
  buildFeatureFilterOrExpression,
  type TokenUsageFeatureFilter,
} from './TokenUsageRepository';
import type { AgentRepositoryResult as RepositoryResult } from './types';

/**
 * The only column lists this repository selects. `aggregate` is exactly the set
 * of fields the drill-down aggregation reads (verified live 2026-09-25 with a
 * zero-row select); `totals` is what the previous-period comparison sums.
 */
export const ADMIN_ANALYTICS_COLUMNS = {
  aggregate:
    'id, created_at, user_id, agent_id, execution_id, provider, model_name, activity_type, ' +
    'activity_name, category, request_type, feature, component, endpoint, input_tokens, ' +
    'output_tokens, cost_usd',
  totals: 'cost_usd, input_tokens, output_tokens',
  /** The Health spend tile (slice 4): what a sum per sub-window needs, plus the paging key. */
  cost: 'id, created_at, cost_usd',
} as const;

/**
 * Limits of the paged Health spend read (admin reorganisation slice 4, F-1).
 * Same shape as the chat report's all-accounts read. The ceiling is NOT to be
 * raised: past it the figure is labelled a lower bound, and the fix is an index
 * or an RPC (slice 4 workplan §7.4), not a bigger loop.
 */
export const ADMIN_HEALTH_READ_LIMITS = {
  PAGE_SIZE: 1000,
  CEILING: 10_000,
} as const;

/** One row of the paged cost read. numeric may arrive as a string. */
export interface AdminCostPointRow {
  id: string;
  created_at: string;
  cost_usd: number | string | null;
}

/** The paged cost read's result. `completed` = the last page was short (nothing left to read). */
export interface AdminCostPointsPage {
  rows: AdminCostPointRow[];
  reachedCeiling: boolean;
  completed: boolean;
  pages: number;
}

export type AdminAnalyticsColumns = keyof typeof ADMIN_ANALYTICS_COLUMNS;

/** PostgREST's default max-rows. A read that returns this many may be truncated. */
export const ADMIN_ANALYTICS_UNPAGED_CAP = 1000;

/** One ledger row as the drill-down aggregates it. numeric may arrive as a string. */
export interface AdminAnalyticsRow {
  id?: string;
  created_at?: string;
  user_id?: string | null;
  agent_id?: string | null;
  execution_id?: string | null;
  provider?: string | null;
  model_name?: string | null;
  activity_type?: string | null;
  activity_name?: string | null;
  category?: string | null;
  request_type?: string | null;
  feature?: string | null;
  component?: string | null;
  endpoint?: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
  cost_usd: number | string | null;
}

/**
 * The filters the screen can stack. Every value reaches a single-operator
 * method (`.eq`, `.is`), never a filter string — except `featureFilter`, which
 * goes through the guarded builder.
 */
export interface AdminAnalyticsFilters {
  provider?: string;
  model?: string;
  activity?: string;
  requestType?: string;
  feature?: string;
  component?: string;
  endpoint?: string;
  /** An account id, or 'system' for rows with no account. */
  user?: string;
  /** An agent id, or 'no-agent' for rows with no agent. */
  agent?: string;
  /** Only rows that belong to an execution. */
  executionOnly?: boolean;
  /** e.g. bosRowFilter(): prefix OR listed feature values. */
  featureFilter?: TokenUsageFeatureFilter;
}

/** Who is reading, for which request. Put on every log line of the read. */
export interface AdminReadContext {
  correlationId: string;
  /** The admin's user id (from `requireAdmin`). Never an email. */
  adminId: string;
}

/** An ISO window. `start <= end`. */
export interface AdminAnalyticsWindow {
  start: string;
  end: string;
}

// Supabase's builder types are structurally different per chain; the only
// methods used are these filters, so a minimal shape keeps this strict.
interface FilterableQuery<Q> {
  eq(column: string, value: unknown): Q;
  is(column: string, value: null): Q;
  not(column: string, operator: string, value: null): Q;
  or(filters: string): Q;
}

export class AdminTokenUsageAnalyticsRepository {
  private supabase: SupabaseClient;
  private logger: Logger;

  constructor(supabaseClient?: SupabaseClient) {
    this.supabase = supabaseClient || defaultSupabase;
    this.logger = createLogger({ service: 'AdminTokenUsageAnalyticsRepository' });
  }

  private static applyFilters<Q extends FilterableQuery<Q>>(query: Q, filters: AdminAnalyticsFilters): Q {
    let q = query;
    if (filters.provider) q = q.eq('provider', filters.provider);
    if (filters.model) q = q.eq('model_name', filters.model);
    if (filters.activity) q = q.eq('activity_type', filters.activity);
    if (filters.requestType) q = q.eq('request_type', filters.requestType);
    if (filters.feature) q = q.eq('feature', filters.feature);
    if (filters.component) q = q.eq('component', filters.component);
    if (filters.endpoint) q = q.eq('endpoint', filters.endpoint);
    if (filters.user) q = filters.user === 'system' ? q.is('user_id', null) : q.eq('user_id', filters.user);
    if (filters.agent) q = filters.agent === 'no-agent' ? q.is('agent_id', null) : q.eq('agent_id', filters.agent);
    if (filters.executionOnly) q = q.not('execution_id', 'is', null);
    if (filters.featureFilter) q = q.or(buildFeatureFilterOrExpression(filters.featureFilter));
    return q;
  }

  /**
   * Every matching ledger row, all accounts, in the window. One unpaged request
   * (see the header: capped at ADMIN_ANALYTICS_UNPAGED_CAP rows by PostgREST).
   */
  async listRowsAllAccountsInWindow(
    context: AdminReadContext,
    window: AdminAnalyticsWindow,
    filters: AdminAnalyticsFilters,
    columns: AdminAnalyticsColumns = 'aggregate'
  ): Promise<RepositoryResult<AdminAnalyticsRow[]>> {
    const log = this.logger.child({
      correlationId: context?.correlationId,
      adminId: context?.adminId,
      method: 'listRowsAllAccountsInWindow',
    });
    try {
      if (!context?.correlationId || !context?.adminId) {
        throw new Error('An admin read context (correlationId, adminId) is required');
      }
      if (!window || !window.start || !window.end || Date.parse(window.start) > Date.parse(window.end)) {
        throw new Error('A valid window (start <= end) is required');
      }

      const base = this.supabase
        .from('token_usage')
        .select(ADMIN_ANALYTICS_COLUMNS[columns])
        .gte('created_at', window.start)
        .lte('created_at', window.end);

      const { data, error } = await AdminTokenUsageAnalyticsRepository.applyFilters(base, filters);
      if (error) throw error;

      const rows = (data ?? []) as unknown as AdminAnalyticsRow[];
      // info, not debug: this is a cross-tenant read, and who read how much is
      // the accountability trail. No values from the rows are logged.
      log.info(
        {
          columns,
          rows: rows.length,
          scoped: !!filters.featureFilter,
          possiblyTruncated: rows.length >= ADMIN_ANALYTICS_UNPAGED_CAP,
        },
        'Admin analytics ledger read'
      );
      return { data: rows, error: null };
    } catch (error) {
      log.warn({ err: error }, 'Admin analytics ledger read failed');
      return { data: null, error: error instanceof Error ? error : new Error(String(error)) };
    }
  }
  private static assertReadContext(context: AdminReadContext, window: AdminAnalyticsWindow): void {
    if (!context?.correlationId || !context?.adminId) {
      throw new Error('An admin read context (correlationId, adminId) is required');
    }
    if (!window || !window.start || !window.end || Date.parse(window.start) > Date.parse(window.end)) {
      throw new Error('A valid window (start <= end) is required');
    }
  }

  /**
   * Exact number of matching ledger rows, all accounts, in the window
   * (`count: 'exact', head: true`: no row is returned). Health spend tile.
   */
  async countAllAccountsInWindow(
    context: AdminReadContext,
    window: AdminAnalyticsWindow,
    filters: AdminAnalyticsFilters,
    opts: { signal?: AbortSignal } = {}
  ): Promise<RepositoryResult<number>> {
    const log = this.logger.child({
      correlationId: context?.correlationId,
      adminId: context?.adminId,
      method: 'countAllAccountsInWindow',
    });
    try {
      AdminTokenUsageAnalyticsRepository.assertReadContext(context, window);

      const base = this.supabase
        .from('token_usage')
        .select('id', { count: 'exact', head: true })
        .gte('created_at', window.start)
        .lte('created_at', window.end);

      let query = AdminTokenUsageAnalyticsRepository.applyFilters(base, filters);
      if (opts.signal) query = query.abortSignal(opts.signal);
      const { count, error } = await query;
      if (error) throw error;

      log.info({ count: count ?? 0, scoped: !!filters.featureFilter }, 'Admin ledger count read');
      return { data: count ?? 0, error: null };
    } catch (error) {
      log.warn({ err: error }, 'Admin ledger count read failed');
      return { data: null, error: error instanceof Error ? error : new Error(String(error)) };
    }
  }

  /**
   * `id, created_at, cost_usd` of every matching row, all accounts, in the
   * window: newest first (`created_at DESC, id DESC`), paged, de-duplicated by
   * id, up to `ceiling` rows. Health spend tile.
   *
   * The read is newest-first, so a ceiling-truncated read drops the OLDEST rows;
   * the caller decides per sub-window whether its figure is exact (SA C-1).
   *
   * DEADLINE (SA C-4): `signal` is checked BETWEEN pages and attached to each
   * request, so an expired deadline stops work instead of only stopping the
   * wait. An aborted read returns `{ data: null, error }` like any failure.
   */
  async listCostPointsAllAccountsInWindow(
    context: AdminReadContext,
    window: AdminAnalyticsWindow,
    filters: AdminAnalyticsFilters,
    opts: { pageSize: number; ceiling: number; signal?: AbortSignal }
  ): Promise<RepositoryResult<AdminCostPointsPage>> {
    const log = this.logger.child({
      correlationId: context?.correlationId,
      adminId: context?.adminId,
      method: 'listCostPointsAllAccountsInWindow',
    });
    try {
      AdminTokenUsageAnalyticsRepository.assertReadContext(context, window);
      const pageSize = Math.trunc(opts?.pageSize);
      const ceiling = Math.trunc(opts?.ceiling);
      if (!(pageSize >= 1 && pageSize <= ADMIN_HEALTH_READ_LIMITS.PAGE_SIZE)) {
        throw new Error('pageSize is out of range');
      }
      if (!(ceiling >= 1 && ceiling <= ADMIN_HEALTH_READ_LIMITS.CEILING)) {
        throw new Error('ceiling is out of range');
      }

      const rows: AdminCostPointRow[] = [];
      const seen = new Set<string>();
      let pages = 0;
      let completed = false;

      for (let from = 0; rows.length < ceiling; from += pageSize) {
        if (opts.signal?.aborted) throw new Error('Read deadline passed');
        const to = from + Math.min(pageSize, ceiling - from) - 1;
        const base = this.supabase
          .from('token_usage')
          .select(ADMIN_ANALYTICS_COLUMNS.cost)
          .gte('created_at', window.start)
          .lte('created_at', window.end);

        let query = AdminTokenUsageAnalyticsRepository.applyFilters(base, filters)
          .order('created_at', { ascending: false })
          .order('id', { ascending: false })
          .range(from, to);
        if (opts.signal) query = query.abortSignal(opts.signal);

        const { data, error } = await query;
        if (error) throw error;
        pages += 1;

        const page = (data ?? []) as unknown as AdminCostPointRow[];
        for (const row of page) {
          const key = String(row.id);
          if (seen.has(key)) continue;
          seen.add(key);
          rows.push(row);
        }

        if (page.length < to - from + 1) {
          completed = true;
          break;
        }
        if (from + pageSize >= ceiling) break;
      }

      const reachedCeiling = !completed && rows.length >= ceiling;
      // info: a cross-tenant read. Counts only, never row values.
      log.info(
        { rows: rows.length, pages, completed, reachedCeiling, scoped: !!filters.featureFilter },
        'Admin ledger cost points read'
      );
      return { data: { rows: rows.slice(0, ceiling), reachedCeiling, completed, pages }, error: null };
    } catch (error) {
      log.warn({ err: error }, 'Admin ledger cost points read failed');
      return { data: null, error: error instanceof Error ? error : new Error(String(error)) };
    }
  }
}

export const adminTokenUsageAnalyticsRepository = new AdminTokenUsageAnalyticsRepository();
