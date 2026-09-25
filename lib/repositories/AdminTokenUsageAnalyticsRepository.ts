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
//     (`.eq('user_id', userId)`) is replaced by the caller's gate: the ONLY
//     permitted caller is `app/api/admin/token-usage/drill-down/route.ts`,
//     which runs `requireAdmin` before it reaches this class. A source guard
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
} as const;

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
}

export const adminTokenUsageAnalyticsRepository = new AdminTokenUsageAnalyticsRepository();
