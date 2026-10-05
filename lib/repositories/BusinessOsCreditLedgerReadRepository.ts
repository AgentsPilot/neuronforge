// lib/repositories/BusinessOsCreditLedgerReadRepository.ts
//
// READ-ONLY access to the Business OS credit ledger: `business_os_credit_charges`
// (charge and adjustment rows) and `business_os_credit_totals` (one running
// total per account and billing period).
//
// Schema:   supabase/migrations/20261015_business_os_credit_charges.sql
// Workplan: docs/workplans/BUSINESS_OS_CREDIT_DEDUCTION_SLICE_4_WORKPLAN.md §4.4 (SA Q-3)
//
// ── WHY A SEPARATE, READ-ONLY REPOSITORY (SA Q-3) ────────────────────────────
// The ledger's writer repository is guarded so that only the AI charge recorder
// may name it. Adding reads there would force every reader onto that guard's
// allow-list and make "who writes the ledger" unreadable. So the readers get
// this file, and it cannot write: it has no write method, and its test pins
// that the source names no insert, update, upsert, delete or rpc call.
//
// ── SERVICE ROLE (intentional RLS bypass, documented per CLAUDE.md) ─────────
// The callers are the operator cost report
// (`lib/business-os/credits/creditReport.ts`), reached only from an admin route
// that runs `requireAdmin` before anything else, and the leak check (slice 4b,
// wired in `lib/business-os/credits/creditLeakCheckDeps.ts`), reached from that
// admin door and from a fail-closed cron; and the admin AI Activity view
// (Gap B slice B1a, wired in `lib/business-os/credits/aiActivityDeps.ts`),
// reached only from `app/api/admin/business-os/ai-activity`, which runs
// `requireAdmin` first; and its drill-down (Gap B slice B2a, wired in
// `lib/business-os/credits/aiActivityDrillDownDeps.ts`), reached only from
// `app/api/admin/business-os/ai-activity/drill-down` after `requireAdmin`.
// Owners cannot read the cost
// columns at all (per-column grants, slice 3), so this read cannot be served
// through the owner's RLS client: every select here names a cost column the
// owner holds no grant on. Owner-facing reads therefore use their own
// repository, `BusinessOsCreditOwnerReadRepository` (slice 6a, C-S6-2), which
// takes the RLS client and selects only owner-granted columns.
//
// Slice 8a adds a third admin caller: the admin Businesses list's "Credits
// left" column (`lib/business-os/credits/adminCreditPercent.ts`), reached only
// from `GET /api/admin/users` after `requireAdmin`. It reads OTHER accounts'
// figures, which no owner RLS client can, so it is service role too — but its
// method (`listTotalsForAccountsInRange`) selects no cost column at all.
//
// ── ACCOUNT SCOPE, BY SIGNATURE ──────────────────────────────────────────────
// Every account method REQUIRES an account id, or a non-empty list of them, and
// refuses a malformed one before querying (CLAUDE.md rule 4). Every read that
// is NOT scoped to an account is reached by calling a differently NAMED method,
// never by leaving an argument out (the TokenUsageRepository convention):
//   - ALL ACCOUNTS: `listTotalsForPeriodsInRange` (the cost report) and
//     `listChargesAllAccountsInWindow` (the Activity list; deleted accounts
//     excluded, they have their own bucket). Both log at info.
//   - NO ACCOUNT: `listChargesOfDeletedAccountsInWindow`, the charges whose
//     account was deleted (`user_id` NULL, ON DELETE SET NULL). Logs at info.
//   - BY UNIQUE ID: `findChargesByActionIds` (an adjustment's original, and
//     the Activity drill-down's ENTRY read, B2a) and
//     `listAdjustmentsForActionIds` (the adjustments of a page of charges). A
//     lookup by id is not an ownership proof: their callers check each row's
//     account against the row it belongs to (`resolveEffectiveFields`). For
//     the drill-down, the row found by its action id is the one fact the
//     request supplies; that row's OWN account and grouping id then scope
//     every later read (SA-RC-11), after `requireAdmin`.
//   - ACCOUNT-SCOPED GROUP READ: `listChargesOfGroupForAccount` (B2a) requires
//     an account AND a grouping id, both taken by its caller from a charge row
//     it has already read, never from a request. It has no time bound: a
//     group's charges belong together whenever they were written.
// The two Activity list methods share ONE private builder, `chargeQuery`, whose
// unscoped forms are reachable only from the named methods (the `pageTotals`
// precedent).
//
// ── COLUMNS ──────────────────────────────────────────────────────────────────
// Only the allow-listed columns below are ever selected (exported and tested).
// The ledger holds no owner text by design; the allow-list keeps it that way if
// a column is ever added.
//
// ── NEVER FILTERS OR GROUPS ON `service` (requirement N-10, KI-14) ───────────
// An adjustment row carries `service` NULL and inherits the service of the
// charge it corrects, so a query on the raw column would silently drop every
// correction. Effective fields are resolved in Node
// (`lib/business-os/credits/effectiveFields.ts`); a source test enforces it.
//
// Methods never throw: they return `{ data, error }`.

import type { SupabaseClient } from '@supabase/supabase-js';
import { supabaseServer as defaultSupabase } from '@/lib/supabaseServer';
import { createLogger, type Logger } from '@/lib/logger';
import type { AgentRepositoryResult as RepositoryResult } from './types';

/** One ledger row, as read. Numeric columns may arrive as strings from PostgREST. */
export interface CreditLedgerRow {
  id: string;
  kind: 'charge' | 'adjustment';
  /** NULL on adjustment rows. */
  action_id: string | null;
  /** NULL on charge rows. */
  adjusts_action_id: string | null;
  reason_code: string | null;
  /** NULL only when the account was deleted (ON DELETE SET NULL). */
  user_id: string | null;
  period_start: string;
  group_id: string | null;
  credits: number | string;
  cost_usd: number | string;
  credit_value_version: number;
  is_fallback_priced: boolean;
  /** NULL on adjustment rows, which inherit it. Never filter or group on it. */
  service: string | null;
  action_type: string | null;
  triggered_by: string | null;
  outcome: string | null;
  created_at: string;
}

/** One totals row, as read. */
export interface CreditTotalsRow {
  user_id: string;
  period_start: string;
  credits_total: number | string;
  credits_owner: number | string;
  credits_scheduled: number | string;
  credits_external: number | string;
  credits_adjustment: number | string;
  cost_usd_total: number | string;
  charge_count: number;
  fallback_priced_count: number;
  updated_at: string;
}

/**
 * A HALF-OPEN range on `period_start`: `from <= period_start < to`.
 *
 * Why exclusive at the top (SA CR-B1): `period_start` is a microsecond
 * `timestamptz` (it derives from `period_anchor DEFAULT now()`), while a JS
 * `Date` holds milliseconds. An inclusive bound built from a `Date` would be
 * the value truncated to the millisecond, which is BELOW the real value, so
 * `<=` would drop that very row. Callers pass a whole-day exclusive end, which
 * no truncation can move.
 */
export interface CreditPeriodStartRange {
  from: Date;
  /** Exclusive. */
  to: Date;
}

export interface CreditLedgerPageOptions {
  pageSize: number;
  ceiling: number;
}

export interface CreditLedgerPagedResult<T> {
  rows: T[];
  /**
   * True when `ceiling` rows were read. Both reads use the same rule (`>=`):
   * exactly `ceiling` rows is treated as "may be incomplete", never as
   * complete, because the read cannot tell a full last page from a cut one.
   */
  reachedCeiling: boolean;
}

/** The only columns this repository selects. Exported for the tests. */
export const CREDIT_LEDGER_ROW_COLUMNS =
  'id, kind, action_id, adjusts_action_id, reason_code, user_id, period_start, group_id, credits, cost_usd, ' +
  'credit_value_version, is_fallback_priced, service, action_type, triggered_by, outcome, created_at';

export const CREDIT_TOTALS_COLUMNS =
  'user_id, period_start, credits_total, credits_owner, credits_scheduled, credits_external, credits_adjustment, ' +
  'cost_usd_total, charge_count, fallback_priced_count, updated_at';

/**
 * The admin "Credits left" column's columns (slice 8a, SA SQ-42): what an
 * account used per period, and nothing else — no cost column, even internally.
 */
export const CREDIT_TOTALS_POSITION_COLUMNS = 'user_id, period_start, credits_total';

/** One totals row as the admin "Credits left" column reads it. */
export interface CreditTotalsPositionRow {
  user_id: string;
  period_start: string;
  credits_total: number | string;
}

export const CREDIT_LEDGER_READ_LIMITS = {
  /** PostgREST's default `max-rows`; a larger page would be silently cut. */
  MAX_PAGE_SIZE: 1000,
  MAX_CEILING: 20_000,
  /** Ids per `.in()` request, so the URL stays well under any proxy limit. */
  MAX_IDS_PER_REQUEST: 200,
} as const;

// ── The Activity list (admin AI Activity view, Gap B slice B1a) ──────────────

/** The two orders the Activity list offers. Both tie-break on `id DESC` (FR-B11). */
export type ChargeListSort = 'created_at' | 'cost_usd';

/** The charge-row filters of the Activity list. Charge rows only: adjustments are never list rows. */
export interface ChargeListFilter {
  /** HALF-OPEN on `created_at`: `from <= created_at < to` (a microsecond column, see `CreditPeriodStartRange`). */
  range: CreditPeriodStartRange;
  /** The area's action types, passed in as plain data. Non-empty when present. */
  actionTypes?: readonly string[];
  outcome?: 'succeeded' | 'failed';
  triggeredBy?: 'owner' | 'scheduled' | 'external';
  /** GROSS charge cost floor, a decimal string: `numeric(16,10)` is never round-tripped through a float. */
  minCostUsd?: string;
}

export interface ChargeListOptions {
  sort: ChargeListSort;
  /** 1 to `CHARGE_LIST_LIMITS.MAX_LIMIT`, asserted here and applied IN the query (FR-B10). */
  limit: number;
}

export interface ChargeListPage {
  rows: CreditLedgerRow[];
  /**
   * `count: 'exact'` on the identical filters: the honest filtered count
   * (FR-B10). It is a plain count, not an aggregate, so PGRST123 does not
   * apply. NULL when PostgREST returned no count — never coerced to 0, so the
   * caller shows no count rather than a wrong one.
   */
  total: number | null;
}

export const CHARGE_LIST_LIMITS = {
  /** The Activity list's server-side cap (FR-B10). */
  MAX_LIMIT: 100,
  /** More than every declared action type; an area is a handful. */
  MAX_ACTION_TYPES: 64,
  /** Adjustment rows read per `listAdjustmentsForActionIds` call. A charge has 0 or 1 today. */
  ADJUSTMENTS_CEILING: 2000,
} as const;

/** The column's own CHECK format (20261015 `business_os_credit_charges_action_type_format`). */
const ACTION_TYPE_PATTERN = /^[a-z][a-z0-9_]{0,63}$/;
/** Dollars, at most the column's 10 decimal places. */
const COST_PATTERN = /^\d{1,6}(\.\d{1,10})?$/;
const OUTCOMES: readonly string[] = ['succeeded', 'failed'];
const TRIGGERS: readonly string[] = ['owner', 'scheduled', 'external'];
const SORTS: readonly string[] = ['created_at', 'cost_usd'];

/**
 * Who a charge query covers. The two unscoped forms are reachable only from
 * the method NAMED for them (`listChargesAllAccountsInWindow`,
 * `listChargesOfDeletedAccountsInWindow`).
 */
type ChargeScope =
  | { kind: 'account'; userId: string }
  | { kind: 'all_accounts' }
  | { kind: 'deleted_accounts' };

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

class CreditLedgerReadGuardError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CreditLedgerReadGuardError';
  }
}

function isValidDate(value: unknown): value is Date {
  return value instanceof Date && !Number.isNaN(value.getTime());
}

export class BusinessOsCreditLedgerReadRepository {
  private supabase: SupabaseClient;
  private logger: Logger;

  constructor(supabaseClient?: SupabaseClient) {
    // Service role by default: an admin-only, cross-account read. See the header.
    this.supabase = supabaseClient || defaultSupabase;
    this.logger = createLogger({ service: 'BusinessOsCreditLedgerReadRepository' });
  }

  // ============ Guards ============

  private assertAccount(userId: string): void {
    if (typeof userId !== 'string' || !UUID_PATTERN.test(userId)) {
      throw new CreditLedgerReadGuardError('An account id (UUID) is required');
    }
  }

  private assertAccounts(userIds: readonly string[]): void {
    if (!Array.isArray(userIds) || userIds.length === 0) {
      throw new CreditLedgerReadGuardError('At least one account id is required');
    }
    userIds.forEach((id) => this.assertAccount(id));
  }

  private assertRange(range: CreditPeriodStartRange): void {
    if (!range || !isValidDate(range.from) || !isValidDate(range.to) || range.from >= range.to) {
      throw new CreditLedgerReadGuardError('A valid half-open period range (from < to) is required');
    }
  }

  private assertPaging(opts: CreditLedgerPageOptions): void {
    const { MAX_PAGE_SIZE, MAX_CEILING } = CREDIT_LEDGER_READ_LIMITS;
    if (!opts || !Number.isInteger(opts.pageSize) || opts.pageSize < 1 || opts.pageSize > MAX_PAGE_SIZE) {
      throw new CreditLedgerReadGuardError(`pageSize must be an integer from 1 to ${MAX_PAGE_SIZE}`);
    }
    if (!Number.isInteger(opts.ceiling) || opts.ceiling < 1 || opts.ceiling > MAX_CEILING) {
      throw new CreditLedgerReadGuardError(`ceiling must be an integer from 1 to ${MAX_CEILING}`);
    }
  }

  /** The Activity list's filters: every value is checked against the column's own rules before it reaches a query. */
  private assertChargeFilter(filter: ChargeListFilter): void {
    if (!filter) throw new CreditLedgerReadGuardError('A charge filter is required');
    this.assertRange(filter.range);
    if (filter.actionTypes !== undefined) {
      const types = filter.actionTypes;
      if (!Array.isArray(types) || types.length === 0 || types.length > CHARGE_LIST_LIMITS.MAX_ACTION_TYPES) {
        throw new CreditLedgerReadGuardError(
          `actionTypes, when given, must hold 1 to ${CHARGE_LIST_LIMITS.MAX_ACTION_TYPES} action types`
        );
      }
      for (const type of types) {
        if (typeof type !== 'string' || !ACTION_TYPE_PATTERN.test(type)) {
          throw new CreditLedgerReadGuardError('Every action type must match the column format');
        }
      }
    }
    if (filter.outcome !== undefined && !OUTCOMES.includes(filter.outcome)) {
      throw new CreditLedgerReadGuardError('outcome must be succeeded or failed');
    }
    if (filter.triggeredBy !== undefined && !TRIGGERS.includes(filter.triggeredBy)) {
      throw new CreditLedgerReadGuardError('triggeredBy must be owner, scheduled or external');
    }
    if (filter.minCostUsd !== undefined && (typeof filter.minCostUsd !== 'string' || !COST_PATTERN.test(filter.minCostUsd))) {
      throw new CreditLedgerReadGuardError('minCostUsd must be a dollar amount with at most 10 decimals');
    }
  }

  private assertListOptions(opts: ChargeListOptions): void {
    if (!opts || !SORTS.includes(opts.sort)) {
      throw new CreditLedgerReadGuardError('sort must be created_at or cost_usd');
    }
    if (!Number.isInteger(opts.limit) || opts.limit < 1 || opts.limit > CHARGE_LIST_LIMITS.MAX_LIMIT) {
      throw new CreditLedgerReadGuardError(`limit must be an integer from 1 to ${CHARGE_LIST_LIMITS.MAX_LIMIT}`);
    }
  }

  /** Non-empty, at most `MAX_IDS_PER_REQUEST`, every one a UUID. Returns them de-duplicated. */
  private assertActionIds(actionIds: readonly string[]): string[] {
    if (!Array.isArray(actionIds) || actionIds.length === 0) {
      throw new CreditLedgerReadGuardError('At least one action id is required');
    }
    const unique = [...new Set(actionIds)];
    if (unique.length > CREDIT_LEDGER_READ_LIMITS.MAX_IDS_PER_REQUEST) {
      throw new CreditLedgerReadGuardError(`At most ${CREDIT_LEDGER_READ_LIMITS.MAX_IDS_PER_REQUEST} action ids per call`);
    }
    for (const id of unique) {
      if (typeof id !== 'string' || !UUID_PATTERN.test(id)) {
        throw new CreditLedgerReadGuardError('Every action id must be a UUID');
      }
    }
    return unique;
  }

  private fail<T>(method: string, error: unknown): RepositoryResult<T> {
    if (error instanceof CreditLedgerReadGuardError) {
      this.logger.warn({ method, err: error }, 'Credit ledger read refused by its guard');
    } else {
      this.logger.error({ method, err: error }, 'Credit ledger read failed');
    }
    return { data: null, error: error instanceof Error ? error : new Error(String(error)) };
  }

  // ============ Totals ============

  /**
   * The totals rows of EVERY account whose `period_start` falls in the range —
   * the one deliberate cross-account read here, and named so. Admin report
   * only; never call it from an owner-facing path.
   *
   * Logged at info, not debug: it is the only cross-account read in this file.
   */
  async listTotalsForPeriodsInRange(
    range: CreditPeriodStartRange,
    opts: CreditLedgerPageOptions
  ): Promise<RepositoryResult<CreditLedgerPagedResult<CreditTotalsRow>>> {
    const method = 'listTotalsForPeriodsInRange';
    try {
      this.assertRange(range);
      this.assertPaging(opts);
      const result = await this.pageTotals(range, opts, null);
      this.logger.info(
        { method, rows: result.rows.length, reachedCeiling: result.reachedCeiling },
        'Credit totals of all accounts read'
      );
      return { data: result, error: null };
    } catch (error) {
      return this.fail(method, error);
    }
  }

  /** The totals rows of ONE account whose `period_start` falls in the range. */
  async listTotalsForAccountInRange(
    userId: string,
    range: CreditPeriodStartRange,
    opts: CreditLedgerPageOptions
  ): Promise<RepositoryResult<CreditLedgerPagedResult<CreditTotalsRow>>> {
    const method = 'listTotalsForAccountInRange';
    try {
      this.assertAccount(userId);
      this.assertRange(range);
      this.assertPaging(opts);
      const result = await this.pageTotals(range, opts, userId);
      this.logger.debug({ method, rows: result.rows.length, reachedCeiling: result.reachedCeiling }, 'Credit totals read');
      return { data: result, error: null };
    } catch (error) {
      return this.fail(method, error);
    }
  }

  /**
   * The totals rows of the NAMED accounts whose `period_start` falls in the
   * range, selecting only `user_id, period_start, credits_total` — the admin
   * Businesses list's "Credits left" column (slice 8a, SA SQ-42). One request
   * per page for up to `MAX_IDS_PER_REQUEST` accounts; a longer list is
   * REFUSED (the caller chunks), never truncated. Paged and de-duplicated by
   * (account, period) like the other totals reads; `reachedCeiling` means the
   * answer may be incomplete and must not be shown as a figure.
   */
  async listTotalsForAccountsInRange(
    userIds: readonly string[],
    range: CreditPeriodStartRange,
    opts: CreditLedgerPageOptions
  ): Promise<RepositoryResult<CreditLedgerPagedResult<CreditTotalsPositionRow>>> {
    const method = 'listTotalsForAccountsInRange';
    try {
      this.assertAccounts(userIds);
      if (userIds.length > CREDIT_LEDGER_READ_LIMITS.MAX_IDS_PER_REQUEST) {
        throw new CreditLedgerReadGuardError(
          `At most ${CREDIT_LEDGER_READ_LIMITS.MAX_IDS_PER_REQUEST} account ids per call`
        );
      }
      this.assertRange(range);
      this.assertPaging(opts);

      const ids = [...new Set(userIds)];
      const rows: CreditTotalsPositionRow[] = [];
      const seen = new Set<string>();
      for (let from = 0; rows.length < opts.ceiling; from += opts.pageSize) {
        const to = from + Math.min(opts.pageSize, opts.ceiling - from) - 1;
        const { data, error } = await this.supabase
          .from('business_os_credit_totals')
          .select(CREDIT_TOTALS_POSITION_COLUMNS)
          .in('user_id', ids)
          .gte('period_start', range.from.toISOString())
          .lt('period_start', range.to.toISOString())
          .order('period_start', { ascending: false })
          .order('user_id', { ascending: true })
          .range(from, to);
        if (error) throw error;

        const page = (data ?? []) as unknown as CreditTotalsPositionRow[];
        for (const row of page) {
          const key = `${row.user_id}|${row.period_start}`;
          if (seen.has(key)) continue;
          seen.add(key);
          rows.push(row);
        }
        if (page.length < to - from + 1) break;
        if (from + opts.pageSize >= opts.ceiling) break;
      }

      const result = { rows: rows.slice(0, opts.ceiling), reachedCeiling: rows.length >= opts.ceiling };
      this.logger.debug(
        { method, accounts: ids.length, rows: result.rows.length, reachedCeiling: result.reachedCeiling },
        'Credit totals of named accounts read'
      );
      return { data: result, error: null };
    } catch (error) {
      return this.fail(method, error);
    }
  }

  /**
   * Pages the totals table. `userId` null is reachable only from the named
   * all-accounts method above; the public account method always passes one.
   */
  private async pageTotals(
    range: CreditPeriodStartRange,
    opts: CreditLedgerPageOptions,
    userId: string | null
  ): Promise<CreditLedgerPagedResult<CreditTotalsRow>> {
    const rows: CreditTotalsRow[] = [];
    const seen = new Set<string>();

    for (let from = 0; rows.length < opts.ceiling; from += opts.pageSize) {
      const to = from + Math.min(opts.pageSize, opts.ceiling - from) - 1;
      let query = this.supabase
        .from('business_os_credit_totals')
        .select(CREDIT_TOTALS_COLUMNS)
        .gte('period_start', range.from.toISOString())
        .lt('period_start', range.to.toISOString());
      if (userId !== null) query = query.eq('user_id', userId);
      const { data, error } = await query
        .order('period_start', { ascending: false })
        .order('user_id', { ascending: true })
        .range(from, to);
      if (error) throw error;

      const page = (data ?? []) as unknown as CreditTotalsRow[];
      for (const row of page) {
        const key = `${row.user_id}|${row.period_start}`;
        if (seen.has(key)) continue;
        seen.add(key);
        rows.push(row);
      }
      if (page.length < to - from + 1) break;
      if (from + opts.pageSize >= opts.ceiling) break;
    }

    return { rows: rows.slice(0, opts.ceiling), reachedCeiling: rows.length >= opts.ceiling };
  }

  // ============ Ledger rows ============

  /**
   * Every ledger row (charges AND adjustments) of the named accounts whose
   * `period_start` falls in the range, newest first, paged, de-duplicated by
   * id, up to `ceiling` rows across all accounts. The caller keeps only the
   * (account, period) pairs it asked about.
   */
  async listRowsForAccountPeriods(
    userIds: readonly string[],
    range: CreditPeriodStartRange,
    opts: CreditLedgerPageOptions
  ): Promise<RepositoryResult<CreditLedgerPagedResult<CreditLedgerRow>>> {
    const method = 'listRowsForAccountPeriods';
    try {
      this.assertAccounts(userIds);
      this.assertRange(range);
      this.assertPaging(opts);

      const unique = [...new Set(userIds)];
      const rows: CreditLedgerRow[] = [];
      const seen = new Set<string>();
      let reachedCeiling = false;

      chunks: for (let i = 0; i < unique.length; i += CREDIT_LEDGER_READ_LIMITS.MAX_IDS_PER_REQUEST) {
        const chunk = unique.slice(i, i + CREDIT_LEDGER_READ_LIMITS.MAX_IDS_PER_REQUEST);
        for (let from = 0; ; from += opts.pageSize) {
          const room = opts.ceiling - rows.length;
          if (room <= 0) {
            reachedCeiling = true;
            break chunks;
          }
          const size = Math.min(opts.pageSize, room);
          const { data, error } = await this.supabase
            .from('business_os_credit_charges')
            .select(CREDIT_LEDGER_ROW_COLUMNS)
            .in('user_id', chunk)
            .gte('period_start', range.from.toISOString())
            .lt('period_start', range.to.toISOString())
            .order('created_at', { ascending: false })
            .order('id', { ascending: false })
            .range(from, from + size - 1);
          if (error) throw error;

          const page = (data ?? []) as unknown as CreditLedgerRow[];
          for (const row of page) {
            // A row inserted during paging shifts an older one onto the next
            // page: it is read twice, never skipped. Keep the first copy.
            const key = String(row.id);
            if (seen.has(key)) continue;
            seen.add(key);
            rows.push(row);
          }
          if (page.length < size) break;
        }
      }

      if (rows.length >= opts.ceiling) reachedCeiling = true;
      this.logger.debug({ method, accounts: unique.length, rows: rows.length, reachedCeiling }, 'Credit ledger rows read');
      return { data: { rows: rows.slice(0, opts.ceiling), reachedCeiling }, error: null };
    } catch (error) {
      return this.fail(method, error);
    }
  }

  /**
   * Every ledger row (charges AND adjustments) of ONE account whose
   * `created_at` falls in the HALF-OPEN range `from <= created_at < to`,
   * newest first, paged, de-duplicated by id, up to `ceiling` rows.
   *
   * For the leak check (slice 4b, workplan §5.2 step 2), which matches an
   * account's charges against its `token_usage` calls by the time they were
   * written. Exclusive at the top for the reason `CreditPeriodStartRange`
   * gives: `created_at` is a microsecond `timestamptz` too.
   */
  async listRowsForAccountCreatedInRange(
    userId: string,
    range: CreditPeriodStartRange,
    opts: CreditLedgerPageOptions
  ): Promise<RepositoryResult<CreditLedgerPagedResult<CreditLedgerRow>>> {
    const method = 'listRowsForAccountCreatedInRange';
    try {
      this.assertAccount(userId);
      this.assertRange(range);
      this.assertPaging(opts);

      const rows: CreditLedgerRow[] = [];
      const seen = new Set<string>();

      for (let from = 0; rows.length < opts.ceiling; from += opts.pageSize) {
        const size = Math.min(opts.pageSize, opts.ceiling - rows.length);
        const { data, error } = await this.supabase
          .from('business_os_credit_charges')
          .select(CREDIT_LEDGER_ROW_COLUMNS)
          .eq('user_id', userId)
          .gte('created_at', range.from.toISOString())
          .lt('created_at', range.to.toISOString())
          .order('created_at', { ascending: false })
          .order('id', { ascending: false })
          .range(from, from + size - 1);
        if (error) throw error;

        const page = (data ?? []) as unknown as CreditLedgerRow[];
        for (const row of page) {
          // A row inserted during paging shifts an older one onto the next
          // page: it is read twice, never skipped. Keep the first copy.
          const key = String(row.id);
          if (seen.has(key)) continue;
          seen.add(key);
          rows.push(row);
        }
        if (page.length < size) break;
      }

      const reachedCeiling = rows.length >= opts.ceiling;
      this.logger.debug({ method, rows: rows.length, reachedCeiling }, 'Credit ledger rows of one account read by time');
      return { data: { rows: rows.slice(0, opts.ceiling), reachedCeiling }, error: null };
    } catch (error) {
      return this.fail(method, error);
    }
  }

  /**
   * The CHARGE rows with these action ids (unique per charge), at most
   * `MAX_IDS_PER_REQUEST` per call. Serves an adjustment's original when it
   * sits in a period that was not read. The caller checks each row's account
   * against the adjustment's: a lookup by id is not an ownership proof.
   *
   * Also the Activity drill-down's ENTRY read (Gap B slice B2a): one admin-
   * supplied action id, after `requireAdmin`. The row it returns is the only
   * thing the request decides; that row's own `user_id` and `group_id` become
   * the scope of every later read (SA-RC-11). A row of no account (deleted)
   * or of a platform account is refused by the caller, never opened.
   */
  async findChargesByActionIds(actionIds: readonly string[]): Promise<RepositoryResult<CreditLedgerRow[]>> {
    const method = 'findChargesByActionIds';
    try {
      if (!Array.isArray(actionIds) || actionIds.length === 0) {
        throw new CreditLedgerReadGuardError('At least one action id is required');
      }
      const unique = [...new Set(actionIds)];
      if (unique.length > CREDIT_LEDGER_READ_LIMITS.MAX_IDS_PER_REQUEST) {
        throw new CreditLedgerReadGuardError(
          `At most ${CREDIT_LEDGER_READ_LIMITS.MAX_IDS_PER_REQUEST} action ids per call`
        );
      }
      for (const id of unique) {
        if (typeof id !== 'string' || !UUID_PATTERN.test(id)) {
          throw new CreditLedgerReadGuardError('Every action id must be a UUID');
        }
      }

      const { data, error } = await this.supabase
        .from('business_os_credit_charges')
        .select(CREDIT_LEDGER_ROW_COLUMNS)
        .eq('kind', 'charge')
        .in('action_id', unique);
      if (error) throw error;

      const rows = (data ?? []) as unknown as CreditLedgerRow[];
      this.logger.debug({ method, requested: unique.length, found: rows.length }, 'Credit charges read by action id');
      return { data: rows, error: null };
    } catch (error) {
      return this.fail(method, error);
    }
  }

  // ============ The Activity drill-down (admin AI Activity view, slice B2a) ============

  /**
   * The CHARGE rows of ONE account that share one grouping id, at ANY time,
   * newest first (`created_at DESC, id DESC`), paged, de-duplicated by id, up
   * to `ceiling`. Served by `business_os_credit_charges_group_idx`.
   *
   * Account-scoped by signature: both the account and the group come from a
   * charge row the caller has already read, never from a request (SA-RC-11).
   * A grouping id may be shared by several accounts (a chat turn id comes from
   * a client header, F-28), so the account filter is what keeps another
   * business's charges out. Logged at debug.
   */
  async listChargesOfGroupForAccount(
    userId: string,
    groupId: string,
    opts: CreditLedgerPageOptions
  ): Promise<RepositoryResult<CreditLedgerPagedResult<CreditLedgerRow>>> {
    const method = 'listChargesOfGroupForAccount';
    try {
      this.assertAccount(userId);
      if (typeof groupId !== 'string' || !UUID_PATTERN.test(groupId)) {
        throw new CreditLedgerReadGuardError('A grouping id (UUID) is required');
      }
      this.assertPaging(opts);

      const rows: CreditLedgerRow[] = [];
      const seen = new Set<string>();

      for (let from = 0; rows.length < opts.ceiling; from += opts.pageSize) {
        const size = Math.min(opts.pageSize, opts.ceiling - rows.length);
        const { data, error } = await this.supabase
          .from('business_os_credit_charges')
          .select(CREDIT_LEDGER_ROW_COLUMNS)
          .eq('kind', 'charge')
          .eq('user_id', userId)
          .eq('group_id', groupId)
          .order('created_at', { ascending: false })
          .order('id', { ascending: false })
          .range(from, from + size - 1);
        if (error) throw error;

        const page = (data ?? []) as unknown as CreditLedgerRow[];
        for (const row of page) {
          // A row inserted during paging shifts an older one onto the next
          // page: it is read twice, never skipped. Keep the first copy.
          const key = String(row.id);
          if (seen.has(key)) continue;
          seen.add(key);
          rows.push(row);
        }
        if (page.length < size) break;
      }

      const reachedCeiling = rows.length >= opts.ceiling;
      this.logger.debug({ method, rows: rows.length, reachedCeiling }, 'Credit charges of one group of one account read');
      return { data: { rows: rows.slice(0, opts.ceiling), reachedCeiling }, error: null };
    } catch (error) {
      return this.fail(method, error);
    }
  }

  // ============ The Activity list (admin AI Activity view, slice B1a) ============

  /**
   * The CHARGE rows of EVERY account written in the window, filtered, ordered
   * (`sort` DESC, then `id` DESC) and capped IN the query at `limit`, with the
   * exact filtered count. Charges of deleted accounts are excluded: they have
   * their own bucket (`listChargesOfDeletedAccountsInWindow`, FR-B8).
   *
   * Cross-account by NAME (see the header). Admin Activity view only; never
   * call it from an owner-facing path. Logged at info.
   */
  async listChargesAllAccountsInWindow(
    filter: ChargeListFilter,
    opts: ChargeListOptions
  ): Promise<RepositoryResult<ChargeListPage>> {
    const method = 'listChargesAllAccountsInWindow';
    try {
      this.assertChargeFilter(filter);
      this.assertListOptions(opts);
      const page = await this.pageOfCharges(filter, { kind: 'all_accounts' }, opts);
      this.logger.info(
        { method, sort: opts.sort, limit: opts.limit, rows: page.rows.length, total: page.total },
        'Credit charges of all accounts listed'
      );
      return { data: page, error: null };
    } catch (error) {
      return this.fail(method, error);
    }
  }

  /** The same list for ONE account. Refuses a malformed account id before querying. */
  async listChargesForAccountInWindow(
    userId: string,
    filter: ChargeListFilter,
    opts: ChargeListOptions
  ): Promise<RepositoryResult<ChargeListPage>> {
    const method = 'listChargesForAccountInWindow';
    try {
      this.assertAccount(userId);
      this.assertChargeFilter(filter);
      this.assertListOptions(opts);
      const page = await this.pageOfCharges(filter, { kind: 'account', userId }, opts);
      this.logger.debug(
        { method, sort: opts.sort, limit: opts.limit, rows: page.rows.length, total: page.total },
        'Credit charges of one account listed'
      );
      return { data: page, error: null };
    } catch (error) {
      return this.fail(method, error);
    }
  }

  /**
   * The ADJUSTMENT rows that point at these charges (`adjusts_action_id`),
   * written at ANY time: a correction made in a later period still nets onto
   * its charge (FR-B12), so this read has no `created_at` bound. At most
   * `MAX_IDS_PER_REQUEST` ids per call; up to `ADJUSTMENTS_CEILING` rows,
   * newest first, de-duplicated by id.
   *
   * Like `findChargesByActionIds`, a lookup by id is not an ownership proof:
   * the caller checks each adjustment's account against its charge's
   * (`resolveEffectiveFields` refuses a cross-account pair).
   */
  async listAdjustmentsForActionIds(
    actionIds: readonly string[]
  ): Promise<RepositoryResult<CreditLedgerPagedResult<CreditLedgerRow>>> {
    const method = 'listAdjustmentsForActionIds';
    try {
      const unique = this.assertActionIds(actionIds);
      const pageSize = CREDIT_LEDGER_READ_LIMITS.MAX_PAGE_SIZE;
      const ceiling = CHARGE_LIST_LIMITS.ADJUSTMENTS_CEILING;
      const rows: CreditLedgerRow[] = [];
      const seen = new Set<string>();

      for (let from = 0; rows.length < ceiling; from += pageSize) {
        const size = Math.min(pageSize, ceiling - rows.length);
        const { data, error } = await this.supabase
          .from('business_os_credit_charges')
          .select(CREDIT_LEDGER_ROW_COLUMNS)
          .eq('kind', 'adjustment')
          .in('adjusts_action_id', unique)
          .order('created_at', { ascending: false })
          .order('id', { ascending: false })
          .range(from, from + size - 1);
        if (error) throw error;

        const page = (data ?? []) as unknown as CreditLedgerRow[];
        for (const row of page) {
          const key = String(row.id);
          if (seen.has(key)) continue;
          seen.add(key);
          rows.push(row);
        }
        if (page.length < size) break;
      }

      const reachedCeiling = rows.length >= ceiling;
      this.logger.debug(
        { method, requested: unique.length, found: rows.length, reachedCeiling },
        'Credit adjustments read by the action ids they correct'
      );
      return { data: { rows: rows.slice(0, ceiling), reachedCeiling }, error: null };
    } catch (error) {
      return this.fail(method, error);
    }
  }

  /**
   * The CHARGE rows whose account was DELETED (`user_id` NULL) written in the
   * window, with the same filters as the list, newest first, paged up to
   * `ceiling`, plus their exact count (FR-B8). Named for its purpose (SA-R12):
   * these rows belong to no account, so this is not an account read.
   *
   * The count is requested on the FIRST page only (SA optimisation note): one
   * count per read, not one per page. Logged at info.
   *
   * `reachedCeiling` here is EXACT, unlike the `>=` rule of the other paged
   * reads (QA E-1): the read asks for ONE row past the ceiling, so it is true
   * only when more rows exist than were returned. Exactly `ceiling` matching
   * rows are all summed by the caller, and must not read as "at least".
   */
  async listChargesOfDeletedAccountsInWindow(
    filter: ChargeListFilter,
    opts: CreditLedgerPageOptions
  ): Promise<RepositoryResult<CreditLedgerPagedResult<CreditLedgerRow> & { total: number | null }>> {
    const method = 'listChargesOfDeletedAccountsInWindow';
    try {
      this.assertChargeFilter(filter);
      this.assertPaging(opts);

      const rows: CreditLedgerRow[] = [];
      const seen = new Set<string>();
      let total: number | null = null;

      // One row past the ceiling: the only way to tell "exactly the ceiling" from "more".
      const want = opts.ceiling + 1;
      for (let from = 0; rows.length < want; from += opts.pageSize) {
        const size = Math.min(opts.pageSize, want - rows.length);
        const { data, error, count } = await this.chargeQuery(filter, { kind: 'deleted_accounts' }, from === 0)
          .order('created_at', { ascending: false })
          .order('id', { ascending: false })
          .range(from, from + size - 1);
        if (error) throw error;
        if (from === 0) total = typeof count === 'number' ? count : null;

        const page = (data ?? []) as unknown as CreditLedgerRow[];
        for (const row of page) {
          const key = String(row.id);
          if (seen.has(key)) continue;
          seen.add(key);
          rows.push(row);
        }
        if (page.length < size) break;
      }

      const reachedCeiling = rows.length > opts.ceiling;
      this.logger.info(
        { method, rows: Math.min(rows.length, opts.ceiling), total, reachedCeiling },
        'Credit charges of deleted accounts read'
      );
      return { data: { rows: rows.slice(0, opts.ceiling), reachedCeiling, total }, error: null };
    } catch (error) {
      return this.fail(method, error);
    }
  }

  /** One capped, ordered page of charges with its exact count. Callers have run every guard. */
  private async pageOfCharges(
    filter: ChargeListFilter,
    scope: ChargeScope,
    opts: ChargeListOptions
  ): Promise<ChargeListPage> {
    const { data, error, count } = await this.chargeQuery(filter, scope, true)
      .order(opts.sort, { ascending: false })
      .order('id', { ascending: false })
      .range(0, opts.limit - 1);
    if (error) throw error;
    return {
      rows: (data ?? []) as unknown as CreditLedgerRow[],
      total: typeof count === 'number' ? count : null,
    };
  }

  /**
   * The ONE filter builder of the Activity reads (charge rows, half-open
   * `created_at` window, the list filters, the scope). The unscoped scopes are
   * reachable only from the named methods above.
   */
  private chargeQuery(filter: ChargeListFilter, scope: ChargeScope, withCount: boolean) {
    let query = this.supabase
      .from('business_os_credit_charges')
      .select(CREDIT_LEDGER_ROW_COLUMNS, withCount ? { count: 'exact' } : undefined)
      .eq('kind', 'charge')
      .gte('created_at', filter.range.from.toISOString())
      .lt('created_at', filter.range.to.toISOString());
    if (scope.kind === 'account') query = query.eq('user_id', scope.userId);
    else if (scope.kind === 'all_accounts') query = query.not('user_id', 'is', null);
    else query = query.is('user_id', null);
    if (filter.actionTypes !== undefined) query = query.in('action_type', [...filter.actionTypes]);
    if (filter.outcome !== undefined) query = query.eq('outcome', filter.outcome);
    if (filter.triggeredBy !== undefined) query = query.eq('triggered_by', filter.triggeredBy);
    if (filter.minCostUsd !== undefined) query = query.gte('cost_usd', filter.minCostUsd);
    return query;
  }
}

/** Singleton for convenience, matching the rest of the repository layer. */
export const businessOsCreditLedgerReadRepository = new BusinessOsCreditLedgerReadRepository();
