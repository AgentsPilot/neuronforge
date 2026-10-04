// lib/repositories/BusinessOsCreditOwnerReadRepository.ts
//
// READ-ONLY access to the Business OS credit ledger for the OWNER'S OWN
// dashboard card and credit history, through the owner's RLS client.
//
// Schema:   supabase/migrations/20261015_business_os_credit_charges.sql
// Workplan: docs/workplans/BUSINESS_OS_CREDIT_DEDUCTION_SLICE_6_WORKPLAN.md §4.3 (SA SQ-21, C-S6-2)
//           docs/workplans/BUSINESS_OS_CREDIT_DEDUCTION_SLICE_7_WORKPLAN.md §4.3 (SA SQ-31: the history's paged read)
//
// ── WHY NOT THE ADMIN LEDGER READER (C-S6-2) ─────────────────────────────────
// The operator report's read repository selects the cost columns (`cost_usd`,
// `is_fallback_priced`, `cost_usd_total`, `fallback_priced_count`). Owners hold
// no grant on those columns (per-column grants, slice 3), so every one of its
// selects fails on the owner's client. It is also service-role by design. This
// repository is the owner's: it selects ONLY the columns the `authenticated`
// GRANT lines name (a test parses the migration and checks each one).
//
// ── THE CLIENT IS REQUIRED (SA SQ-21) ────────────────────────────────────────
// There is no service-role default and no import of the service client: the
// caller passes the session's RLS client, so the owner SELECT policies
// (`auth.uid() = user_id`) apply to every read. An expired session therefore
// fails as a read error, never as "no rows".
//
// `new-repository` checklist, singleton item: N/A BY DESIGN. A singleton would
// need a default client, and the only default that works without a request is
// the service role, which is exactly what this file must never hold.
//
// ── ACCOUNT SCOPE, ON TOP OF RLS ─────────────────────────────────────────────
// Every method REQUIRES the account id, refuses a non-UUID before querying and
// adds `.eq('user_id', accountId)` (CLAUDE.md rule 4). RLS is defence in depth,
// not the only line.
//
// ── NEVER FILTERS OR GROUPS ON `service` (requirement N-10, KI-14) ───────────
// `service` and `action_type` are SELECTED (so the rows satisfy the effective
// fields resolver, SA W6-3), never filtered on. An adjustment row stores
// `service` NULL; `lib/business-os/credits/effectiveFields.ts` resolves it.
//
// ── KEYS ARE STRINGS ─────────────────────────────────────────────────────────
// `period_start` is a microsecond timestamptz. Every period argument is the
// exact string PostgREST returned; nothing here builds one from a `Date`.
//
// Methods never throw: they return `{ data, error }`.

import type { SupabaseClient } from '@supabase/supabase-js';
import { createLogger, type Logger } from '@/lib/logger';
import type { AgentRepositoryResult as RepositoryResult } from './types';

/** One totals row, as the owner may read it. Numeric columns may arrive as strings. */
export interface OwnerCreditTotalsRow {
  period_start: string;
  credits_total: number | string;
  credits_owner: number | string;
  credits_scheduled: number | string;
  credits_external: number | string;
  credits_adjustment: number | string;
}

/** One ledger row, as the owner may read it (granted columns only). */
export interface OwnerCreditChargeRow {
  kind: 'charge' | 'adjustment';
  action_id: string | null;
  adjusts_action_id: string | null;
  credits: number | string;
  triggered_by: string | null;
  period_start: string;
  user_id: string | null;
  /** Selected for the effective-fields resolver only. Never filter or group on it. */
  service: string | null;
  action_type: string | null;
}

/** The only columns selected. Each is in the migration's `authenticated` GRANT (tested). */
export const OWNER_TOTALS_COLUMNS =
  'period_start, credits_total, credits_owner, credits_scheduled, credits_external, credits_adjustment';

export const OWNER_CHARGE_COLUMNS =
  'kind, action_id, adjusts_action_id, credits, triggered_by, period_start, user_id, service, action_type';

/** One ledger row as the credit history reads it (slice 7a, SA SQ-31). Satisfies `EffectiveFieldsInput`. */
export interface OwnerDiaryRow {
  id: string;
  kind: 'charge' | 'adjustment';
  action_id: string | null;
  adjusts_action_id: string | null;
  period_start: string;
  credits: number | string;
  /** Selected for the effective-fields resolver only. Never filter or group on it. */
  service: string | null;
  action_type: string | null;
  triggered_by: string | null;
  outcome: string | null;
  /** The exact string PostgREST returned (microseconds); the keyset carries it verbatim. */
  created_at: string;
  user_id: string | null;
}

/**
 * The credit history's columns (SA SQ-31). Each is in the migration's
 * `authenticated` GRANT (tested). No `group_id`, `reason_code` or
 * `credit_value_version`: a diary line does not need them.
 */
export const OWNER_DIARY_COLUMNS =
  'id, kind, action_id, adjusts_action_id, period_start, credits, service, action_type, triggered_by, outcome, created_at, user_id';

/**
 * The window both the totals read and the ledger-row read use (slice 7a, SA
 * SQ-30): one period key (monthly, calendar month), or every period from the
 * trial anchor on. The caller builds it once; the keys are exact strings.
 */
export type OwnerLedgerWindow =
  | { kind: 'period'; periodStart: string }
  | { kind: 'from'; fromPeriodStart: string };

/** Where the previous page ended: the last row's `created_at` (verbatim) and `id`. */
export interface OwnerDiaryKeyset {
  createdAt: string;
  id: string;
}

export interface OwnerDiaryPage {
  rows: OwnerDiaryRow[];
  /** True when at least one more row follows this page. */
  hasMore: boolean;
}

export const OWNER_CREDIT_READ_LIMITS = {
  /**
   * Totals rows read for a trial total. A trial spans a handful of monthly
   * rows; reaching this is an anomaly the caller reports, never a partial sum.
   */
  TOTALS_CEILING: 24,
  /** Adjustments read for one period. More than this is reported, never cut silently. */
  ADJUSTMENTS_CEILING: 1000,
  /** Ids per `.in()` request, so the URL stays well under any proxy limit. */
  MAX_IDS_PER_REQUEST: 200,
  /** Period keys per adjustments read. */
  MAX_PERIODS_PER_REQUEST: 24,
  /** Most lines one credit-history page may ask for (slice 7a). */
  DIARY_PAGE_CEILING: 100,
} as const;

export interface OwnerCeilingResult<T> {
  rows: T[];
  /** True when the ceiling was reached: the read may be incomplete. */
  reachedCeiling: boolean;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The PostgREST timestamptz shape, strictly. A keyset value is interpolated
 * into an or-expression, so it must be nothing but a timestamp: no comma, no
 * parenthesis, no quote (SA SQ-29). Checked here AND at the route.
 */
export const OWNER_TIMESTAMPTZ_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$/;

class OwnerCreditReadGuardError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OwnerCreditReadGuardError';
  }
}

function assertPeriodKey(value: unknown): asserts value is string {
  // A period key is the string PostgREST returned; anything else is refused.
  if (typeof value !== 'string' || value.length < 10 || Number.isNaN(Date.parse(value))) {
    throw new OwnerCreditReadGuardError('A period key (timestamptz string) is required');
  }
}

export class BusinessOsCreditOwnerReadRepository {
  private supabase: SupabaseClient;
  private logger: Logger;

  /** The caller's RLS client. Required: see the header. */
  constructor(supabaseClient: SupabaseClient) {
    if (!supabaseClient) throw new Error('BusinessOsCreditOwnerReadRepository needs the caller\'s RLS client');
    this.supabase = supabaseClient;
    this.logger = createLogger({ service: 'BusinessOsCreditOwnerReadRepository' });
  }

  // ============ Guards ============

  private assertAccount(accountId: string): void {
    if (typeof accountId !== 'string' || !UUID_PATTERN.test(accountId)) {
      throw new OwnerCreditReadGuardError('An account id (UUID) is required');
    }
  }

  private fail<T>(method: string, error: unknown): RepositoryResult<T> {
    if (error instanceof OwnerCreditReadGuardError) {
      this.logger.warn({ method, err: error }, 'Owner credit read refused by its guard');
    } else {
      this.logger.error({ method, err: error }, 'Owner credit read failed');
    }
    return { data: null, error: error instanceof Error ? error : new Error(String(error)) };
  }

  // ============ Totals ============

  /** The totals row of one period, or null when nothing was charged in it yet. */
  async findTotalsForPeriod(
    accountId: string,
    periodStart: string
  ): Promise<RepositoryResult<OwnerCreditTotalsRow | null>> {
    const method = 'findTotalsForPeriod';
    try {
      this.assertAccount(accountId);
      assertPeriodKey(periodStart);
      const { data, error } = await this.supabase
        .from('business_os_credit_totals')
        .select(OWNER_TOTALS_COLUMNS)
        .eq('user_id', accountId)
        .eq('period_start', periodStart)
        .maybeSingle();
      if (error) throw error;
      return { data: (data ?? null) as unknown as OwnerCreditTotalsRow | null, error: null };
    } catch (error) {
      return this.fail(method, error);
    }
  }

  /**
   * Every totals row from `fromPeriodStart` on (inclusive), oldest first, up to
   * `TOTALS_CEILING`. For a trial's one-off total, summed from the plan anchor.
   */
  async listTotalsFrom(
    accountId: string,
    fromPeriodStart: string
  ): Promise<RepositoryResult<OwnerCeilingResult<OwnerCreditTotalsRow>>> {
    const method = 'listTotalsFrom';
    try {
      this.assertAccount(accountId);
      assertPeriodKey(fromPeriodStart);
      const ceiling = OWNER_CREDIT_READ_LIMITS.TOTALS_CEILING;
      const { data, error } = await this.supabase
        .from('business_os_credit_totals')
        .select(OWNER_TOTALS_COLUMNS)
        .eq('user_id', accountId)
        .gte('period_start', fromPeriodStart)
        .order('period_start', { ascending: true })
        .range(0, ceiling - 1);
      if (error) throw error;
      const rows = (data ?? []) as unknown as OwnerCreditTotalsRow[];
      return { data: { rows, reachedCeiling: rows.length >= ceiling }, error: null };
    } catch (error) {
      return this.fail(method, error);
    }
  }

  // ============ Ledger rows ============

  /**
   * One page of the window's ledger rows — charges AND adjustments — newest
   * first, ordered `(created_at DESC, id DESC)` (slice 7a, SA SQ-29 / SQ-31).
   * Reads `limit + 1` rows to know whether there is more. `after` is the last
   * row of the previous page; its values are re-validated here (defence in
   * depth: the route refused anything else) before they reach the
   * or-expression, where they are double-quoted so a timestamp's `.`, `:` and
   * `+` are never read as PostgREST syntax.
   */
  async listLedgerRowsForWindow(
    accountId: string,
    window: OwnerLedgerWindow,
    after: OwnerDiaryKeyset | null,
    limit: number
  ): Promise<RepositoryResult<OwnerDiaryPage>> {
    const method = 'listLedgerRowsForWindow';
    try {
      this.assertAccount(accountId);
      if (!window || (window.kind !== 'period' && window.kind !== 'from')) {
        throw new OwnerCreditReadGuardError('A ledger window is required');
      }
      const key = window.kind === 'period' ? window.periodStart : window.fromPeriodStart;
      assertPeriodKey(key);
      if (!Number.isInteger(limit) || limit < 1 || limit > OWNER_CREDIT_READ_LIMITS.DIARY_PAGE_CEILING) {
        throw new OwnerCreditReadGuardError(
          `A page size between 1 and ${OWNER_CREDIT_READ_LIMITS.DIARY_PAGE_CEILING} is required`
        );
      }
      if (after !== null) {
        if (
          !after ||
          typeof after.createdAt !== 'string' ||
          !OWNER_TIMESTAMPTZ_PATTERN.test(after.createdAt) ||
          typeof after.id !== 'string' ||
          !UUID_PATTERN.test(after.id)
        ) {
          throw new OwnerCreditReadGuardError('A page position must be a timestamp and a UUID');
        }
      }

      let query = this.supabase
        .from('business_os_credit_charges')
        .select(OWNER_DIARY_COLUMNS)
        .eq('user_id', accountId);
      query = window.kind === 'period' ? query.eq('period_start', key) : query.gte('period_start', key);
      if (after !== null) {
        const t = after.createdAt;
        query = query.or(`created_at.lt."${t}",and(created_at.eq."${t}",id.lt.${after.id})`);
      }
      const { data, error } = await query
        .order('created_at', { ascending: false })
        .order('id', { ascending: false })
        .range(0, limit);
      if (error) throw error;
      const rows = (data ?? []) as unknown as OwnerDiaryRow[];
      return { data: { rows: rows.slice(0, limit), hasMore: rows.length > limit }, error: null };
    } catch (error) {
      return this.fail(method, error);
    }
  }

  /** The adjustment rows of these periods (keys exactly as read from the totals rows). */
  async listAdjustmentsForPeriods(
    accountId: string,
    periodStarts: readonly string[]
  ): Promise<RepositoryResult<OwnerCeilingResult<OwnerCreditChargeRow>>> {
    const method = 'listAdjustmentsForPeriods';
    try {
      this.assertAccount(accountId);
      if (!Array.isArray(periodStarts) || periodStarts.length === 0) {
        throw new OwnerCreditReadGuardError('At least one period key is required');
      }
      const unique = [...new Set(periodStarts)];
      if (unique.length > OWNER_CREDIT_READ_LIMITS.MAX_PERIODS_PER_REQUEST) {
        throw new OwnerCreditReadGuardError(
          `At most ${OWNER_CREDIT_READ_LIMITS.MAX_PERIODS_PER_REQUEST} period keys per call`
        );
      }
      unique.forEach(assertPeriodKey);

      const ceiling = OWNER_CREDIT_READ_LIMITS.ADJUSTMENTS_CEILING;
      const { data, error } = await this.supabase
        .from('business_os_credit_charges')
        .select(OWNER_CHARGE_COLUMNS)
        .eq('user_id', accountId)
        .eq('kind', 'adjustment')
        .in('period_start', unique)
        .order('created_at', { ascending: true })
        .range(0, ceiling - 1);
      if (error) throw error;
      const rows = (data ?? []) as unknown as OwnerCreditChargeRow[];
      return { data: { rows, reachedCeiling: rows.length >= ceiling }, error: null };
    } catch (error) {
      return this.fail(method, error);
    }
  }

  /**
   * The CHARGE rows with these action ids, of this account, chunked. Serves the
   * originals of adjustments; the resolver still checks each row's account.
   */
  async findChargesByActionIds(
    accountId: string,
    actionIds: readonly string[]
  ): Promise<RepositoryResult<OwnerCreditChargeRow[]>> {
    const method = 'findChargesByActionIds';
    try {
      this.assertAccount(accountId);
      if (!Array.isArray(actionIds) || actionIds.length === 0) {
        throw new OwnerCreditReadGuardError('At least one action id is required');
      }
      const unique = [...new Set(actionIds)];
      for (const id of unique) {
        if (typeof id !== 'string' || !UUID_PATTERN.test(id)) {
          throw new OwnerCreditReadGuardError('Every action id must be a UUID');
        }
      }

      const rows: OwnerCreditChargeRow[] = [];
      for (let i = 0; i < unique.length; i += OWNER_CREDIT_READ_LIMITS.MAX_IDS_PER_REQUEST) {
        const chunk = unique.slice(i, i + OWNER_CREDIT_READ_LIMITS.MAX_IDS_PER_REQUEST);
        const { data, error } = await this.supabase
          .from('business_os_credit_charges')
          .select(OWNER_CHARGE_COLUMNS)
          .eq('user_id', accountId)
          .eq('kind', 'charge')
          .in('action_id', chunk);
        if (error) throw error;
        rows.push(...((data ?? []) as unknown as OwnerCreditChargeRow[]));
      }
      return { data: rows, error: null };
    } catch (error) {
      return this.fail(method, error);
    }
  }
}
