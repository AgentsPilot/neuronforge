// lib/repositories/BusinessOsFinanceReadRepository.ts
//
// READ-ONLY access for the admin finance & business health page (slice 1a,
// workplan docs/workplans/BUSINESS_OS_FINANCE_HEALTH_SLICE_1A_WORKPLAN.md,
// reads R-c, R-c′ and R-d; slice 2a, workplan
// docs/workplans/BUSINESS_OS_FINANCE_HEALTH_SLICE_2A_WORKPLAN.md, reads R-e,
// R-e′, R-f and R-f′: the businesses' client payments and refunds, layer B).
//
// ── WHY A SEPARATE REPOSITORY (SA-F2) ────────────────────────────────────────
// The money tables read here each have a writer repository whose callers are
// pinned by an exact list (the billing-account repository, the billing-event
// repository and the boost purchase repository). Adding a read method there
// would put an admin read page on a money writer's caller list and make "who
// may touch the money tables" unreadable. So this file reads them, and it
// cannot write: it has no write method, and its test pins that the source
// names no insert, update, upsert, delete or rpc call. Those repositories are
// named here in words only, never by class name: their caller guards match the
// text, comments included.
//
// The same holds for the layer-B client payment tables (slice 2a): they have
// writer and owner-scoped repositories (the client payment repository, the
// refund repository and the client plan repository), several of them pinned
// by the Stripe webhook placement guards. The admin reads of those tables
// therefore live here, read-only, and those repositories are named in words
// only too (pinned by a test, SA-WR-19).
//
// ── SERVICE ROLE (intentional RLS bypass, documented per CLAUDE.md) ─────────
// The one caller is the finance page's production wiring
// (`lib/business-os/finance/financeHealthDeps.ts`), reached only from
// `app/api/admin/business-os/finance` after `requireAdmin`. It is an admin
// read ACROSS accounts, which no owner RLS client can serve, and the billing
// tables are server-write-only with no client grant at all.
//
// ── ACCOUNT SCOPE, BY SIGNATURE ──────────────────────────────────────────────
// The account-scoped reads require an account id and refuse a malformed one
// before querying (CLAUDE.md rule 4). A read that is not scoped to one account
// is reached only by calling a differently NAMED method, never by leaving an
// argument out (the TokenUsageRepository convention):
//   - ALL ACCOUNTS: `listLiveBillingStatusesAllAccounts` (R-c),
//     `listClientPaymentsAllAccountsPaidInRange` (R-e) and
//     `listClientRefundsAllAccountsCreatedInRange` (R-f). Logged at info.
//   - ONE ACCOUNT: `findLiveBillingStatusForAccount` (R-c′),
//     `listClientPaymentsForAccountPaidInRange` (R-e′) and
//     `listClientRefundsForAccountCreatedInRange` (R-f′), with
//     `.eq('user_id')` on every page.
//   - PLATFORM-WIDE EXISTENCE: `countLiveRevenueRows` (R-d), two head counts
//     that read no account and no amount.
//
// ── LIVE MODE (layer A only) ─────────────────────────────────────────────────
// Test-mode Stripe rows share the billing and boost tables. Every layer-A read
// here (R-c, R-c′, R-d) filters `livemode = true`, so a test purchase can
// never count as revenue or as a paying account. The client-payment reads
// (R-e to R-f′) have no such column and, by decision BD-13, no mode filter:
// the businesses' test and real client payments are shown together.
//
// ── PAGING ───────────────────────────────────────────────────────────────────
// R-c pages by keyset on `user_id`, and reaching its ceiling is an ERROR. The
// layer-B reads page by keyset on `id`, read every status (the caller counts
// the others), and at their ceiling (the `>=` rule) return the rows read with
// `reachedCeiling: true`, so the page says "At least".
//
// Methods never throw: they return `{ data, error }`.

import type { SupabaseClient } from '@supabase/supabase-js';
import { supabaseServer as defaultSupabase } from '@/lib/supabaseServer';
import { createLogger, type Logger } from '@/lib/logger';
import type { AgentRepositoryResult as RepositoryResult } from './types';

/** One billing-account row, as the finance page reads it: who, which status, ended or not. */
export interface FinanceBillingStatusRow {
  user_id: string;
  /**
   * A plain string: this repository imports no type from the billing-account
   * repository (see the header). The caller narrows it with
   * `isPayingBillingRow` (`lib/business-os/billing/payingSubscriptionStatuses.ts`).
   */
  subscription_status: string | null;
  ended_at: string | null;
}

/** Whether any live revenue row exists, platform-wide. Counts only, never an amount. */
export interface FinanceRevenueCounts {
  planInvoicesPaid: number;
  boostsPaid: number;
}

/** The only columns the billing-status reads select. Exported for the tests. */
export const FINANCE_BILLING_STATUS_COLUMNS = 'user_id, subscription_status, ended_at';

export const FINANCE_READ_LIMITS = {
  /** PostgREST's default `max-rows`; a larger page would be silently cut. */
  BILLING_PAGE_SIZE: 1000,
  BILLING_CEILING: 20_000,
  /** Layer-B reads (slice 2a, SA-Q15): PostgREST's `max-rows` page; "At least" at the ceiling. */
  CLIENT_PAGE_SIZE: 1000,
  CLIENT_CEILING: 5_000,
} as const;

/**
 * The client-payment columns R-e / R-e′ select (slice 2a). No client data
 * (`contact_id`, `metadata`) and no Stripe id.
 */
export const FINANCE_CLIENT_PAYMENT_COLUMNS =
  'id, user_id, amount, currency, status, paid_at, processor_fee, fee_currency, processor_type';

/** The refund columns R-f / R-f′ select. `amount`, never `amount_minor` (SA-Q13). */
export const FINANCE_CLIENT_REFUND_COLUMNS = 'id, user_id, amount, currency, status, created_at';

/**
 * One client payment, as the takings block reads it. The money columns are
 * NUMERIC: PostgREST may send a number or a numeric string, so they stay
 * `number | string` here and the caller converts them once.
 */
export interface FinanceClientPaymentRow {
  id: string;
  user_id: string | null;
  amount: number | string | null;
  currency: string | null;
  status: string | null;
  paid_at: string | null;
  processor_fee: number | string | null;
  fee_currency: string | null;
  processor_type: string | null;
}

/** One client refund, as the takings block reads it. */
export interface FinanceClientRefundRow {
  id: string;
  user_id: string | null;
  amount: number | string | null;
  currency: string | null;
  status: string | null;
  created_at: string;
}

/**
 * The rows read, and whether the ceiling was reached. `>=`: exactly the
 * ceiling counts as "may be incomplete", because a full last page cannot be
 * told from a cut one. The page then says "At least".
 */
export interface FinanceClientReadResult<T> {
  rows: T[];
  reachedCeiling: boolean;
}

/** A half-open instant range, `from <= column < to`. */
export interface FinanceClientRange {
  from: Date;
  to: Date;
}

/** For tests (a small ceiling); production uses the defaults. */
export interface FinanceClientReadOptions {
  pageSize?: number;
  ceiling?: number;
}

/** What a layer-B read starts from: `.from('<literal table>').select(<columns>)`. */
type ClientQuery = ReturnType<ReturnType<SupabaseClient['from']>['select']>;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

class FinanceReadGuardError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FinanceReadGuardError';
  }
}

/**
 * The all-accounts billing read reached its ceiling. Returned as an ERROR, never
 * as a partial list: a cut list would silently turn paying accounts into
 * comped ones (workplan R-c).
 */
export class FinanceReadCeilingError extends Error {
  constructor(ceiling: number) {
    super(`Live billing rows reached the read ceiling of ${ceiling}`);
    this.name = 'FinanceReadCeilingError';
  }
}

export class BusinessOsFinanceReadRepository {
  private supabase: SupabaseClient;
  private logger: Logger;

  constructor(supabaseClient?: SupabaseClient) {
    // Service role by default: an admin-only, cross-account read. See the header.
    this.supabase = supabaseClient || defaultSupabase;
    this.logger = createLogger({ service: 'BusinessOsFinanceReadRepository' });
  }

  private fail<T>(method: string, error: unknown): RepositoryResult<T> {
    if (error instanceof FinanceReadGuardError) {
      this.logger.warn({ method, err: error }, 'Finance read refused by its guard');
    } else {
      this.logger.error({ method, err: error }, 'Finance read failed');
    }
    return { data: null, error: error instanceof Error ? error : new Error(String(error)) };
  }

  /**
   * R-c. The live billing status of EVERY account that has a live billing row,
   * keyset-paged on `user_id`. Rows detached from a deleted account
   * (`user_id` NULL) are skipped in the query: keyset paging cannot step over
   * NULLs, and an unattributable row cannot classify an account.
   *
   * Reaching the ceiling is an ERROR (`FinanceReadCeilingError`), never a
   * partial list. Logged at info: it is a cross-account read.
   */
  async listLiveBillingStatusesAllAccounts(opts?: {
    pageSize?: number;
    ceiling?: number;
  }): Promise<RepositoryResult<FinanceBillingStatusRow[]>> {
    const method = 'listLiveBillingStatusesAllAccounts';
    const startedAt = Date.now();
    try {
      const pageSize = opts?.pageSize ?? FINANCE_READ_LIMITS.BILLING_PAGE_SIZE;
      const ceiling = opts?.ceiling ?? FINANCE_READ_LIMITS.BILLING_CEILING;
      if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > FINANCE_READ_LIMITS.BILLING_PAGE_SIZE) {
        throw new FinanceReadGuardError(`pageSize must be an integer from 1 to ${FINANCE_READ_LIMITS.BILLING_PAGE_SIZE}`);
      }
      if (!Number.isInteger(ceiling) || ceiling < 1 || ceiling > FINANCE_READ_LIMITS.BILLING_CEILING) {
        throw new FinanceReadGuardError(`ceiling must be an integer from 1 to ${FINANCE_READ_LIMITS.BILLING_CEILING}`);
      }

      const rows: FinanceBillingStatusRow[] = [];
      let last: string | null = null;
      for (;;) {
        const size = Math.min(pageSize, ceiling - rows.length);
        let query = this.supabase
          .from('business_os_billing_accounts')
          .select(FINANCE_BILLING_STATUS_COLUMNS)
          .eq('livemode', true)
          .not('user_id', 'is', null);
        if (last !== null) query = query.gt('user_id', last);
        const { data, error } = await query.order('user_id', { ascending: true }).limit(size);
        if (error) throw error;

        const page = (data ?? []) as unknown as FinanceBillingStatusRow[];
        rows.push(...page);
        if (rows.length >= ceiling) throw new FinanceReadCeilingError(ceiling);
        if (page.length < size) break;
        last = page[page.length - 1].user_id;
      }

      this.logger.info({ method, rows: rows.length, durationMs: Date.now() - startedAt }, 'Live billing statuses of all accounts read');
      return { data: rows, error: null };
    } catch (error) {
      return this.fail(method, error);
    }
  }

  /**
   * R-c′. The live billing status of ONE account, or `null` when it has no
   * live billing row. One row at most: `(user_id, livemode)` is unique.
   */
  async findLiveBillingStatusForAccount(accountId: string): Promise<RepositoryResult<FinanceBillingStatusRow | null>> {
    const method = 'findLiveBillingStatusForAccount';
    try {
      if (typeof accountId !== 'string' || !UUID_PATTERN.test(accountId)) {
        throw new FinanceReadGuardError('An account id (UUID) is required');
      }
      const { data, error } = await this.supabase
        .from('business_os_billing_accounts')
        .select(FINANCE_BILLING_STATUS_COLUMNS)
        .eq('user_id', accountId)
        .eq('livemode', true)
        .maybeSingle();
      if (error) throw error;

      const row = (data ?? null) as unknown as FinanceBillingStatusRow | null;
      this.logger.debug({ method, found: row !== null }, 'Live billing status of one account read');
      return { data: row, error: null };
    } catch (error) {
      return this.fail(method, error);
    }
  }

  /**
   * R-d. Whether ANY live revenue row exists, platform-wide: paid plan
   * invoices and paid boost purchases. Two head counts — no row, no account
   * and no amount is read. A count PostgREST did not return is an error,
   * never a 0 (the page then says "Could not check").
   */
  async countLiveRevenueRows(): Promise<RepositoryResult<FinanceRevenueCounts>> {
    const method = 'countLiveRevenueRows';
    try {
      const [invoices, boosts] = await Promise.all([
        this.supabase
          .from('business_os_billing_events')
          .select('id', { count: 'exact', head: true })
          .eq('livemode', true)
          .eq('kind', 'invoice_paid'),
        this.supabase
          .from('business_os_boost_purchases')
          .select('id', { count: 'exact', head: true })
          .eq('livemode', true)
          .not('paid_at', 'is', null),
      ]);
      if (invoices.error) throw invoices.error;
      if (boosts.error) throw boosts.error;
      if (typeof invoices.count !== 'number' || typeof boosts.count !== 'number') {
        throw new Error('A revenue head count came back without a count');
      }

      const counts = { planInvoicesPaid: invoices.count, boostsPaid: boosts.count };
      this.logger.info({ method, ...counts }, 'Live revenue rows counted');
      return { data: counts, error: null };
    } catch (error) {
      return this.fail(method, error);
    }
  }

  /**
   * R-e. Every account's client payments PAID in the range, keyset on `id`.
   * Every status is read: the caller counts the other statuses. No mode
   * filter (BD-13). Logged at info: it is a cross-account read.
   */
  async listClientPaymentsAllAccountsPaidInRange(
    range: FinanceClientRange,
    opts?: FinanceClientReadOptions
  ): Promise<RepositoryResult<FinanceClientReadResult<FinanceClientPaymentRow>>> {
    return this.pageClientRows<FinanceClientPaymentRow>(
      'listClientPaymentsAllAccountsPaidInRange',
      () => this.supabase.from('payment_transactions').select(FINANCE_CLIENT_PAYMENT_COLUMNS),
      'paid_at',
      range,
      null,
      opts
    );
  }

  /** R-e′. ONE account's client payments paid in the range; the id is checked before any query. */
  async listClientPaymentsForAccountPaidInRange(
    accountId: string,
    range: FinanceClientRange,
    opts?: FinanceClientReadOptions
  ): Promise<RepositoryResult<FinanceClientReadResult<FinanceClientPaymentRow>>> {
    return this.pageClientRows<FinanceClientPaymentRow>(
      'listClientPaymentsForAccountPaidInRange',
      () => this.supabase.from('payment_transactions').select(FINANCE_CLIENT_PAYMENT_COLUMNS),
      'paid_at',
      range,
      { accountId },
      opts
    );
  }

  /**
   * R-f. Every account's refunds CREATED in the range (SA-Q19), keyset on
   * `id`. Every status is read. Logged at info.
   */
  async listClientRefundsAllAccountsCreatedInRange(
    range: FinanceClientRange,
    opts?: FinanceClientReadOptions
  ): Promise<RepositoryResult<FinanceClientReadResult<FinanceClientRefundRow>>> {
    return this.pageClientRows<FinanceClientRefundRow>(
      'listClientRefundsAllAccountsCreatedInRange',
      () => this.supabase.from('payment_refunds').select(FINANCE_CLIENT_REFUND_COLUMNS),
      'created_at',
      range,
      null,
      opts
    );
  }

  /** R-f′. ONE account's refunds created in the range; the id is checked before any query. */
  async listClientRefundsForAccountCreatedInRange(
    accountId: string,
    range: FinanceClientRange,
    opts?: FinanceClientReadOptions
  ): Promise<RepositoryResult<FinanceClientReadResult<FinanceClientRefundRow>>> {
    return this.pageClientRows<FinanceClientRefundRow>(
      'listClientRefundsForAccountCreatedInRange',
      () => this.supabase.from('payment_refunds').select(FINANCE_CLIENT_REFUND_COLUMNS),
      'created_at',
      range,
      { accountId },
      opts
    );
  }

  /**
   * The layer-B paging shared by R-e to R-f′. Each caller passes its own
   * `.from('<literal table>')`, so the source guard can list every table this
   * file reads. The account id, the range and the options are checked BEFORE
   * the first query. Then pages by keyset on `id` (`.gt` as its own filter),
   * stopping on a short page, or at the ceiling (`>=`), where the rows read
   * are returned with `reachedCeiling: true`, never an error.
   */
  private async pageClientRows<T extends { id: string }>(
    method: string,
    start: () => ClientQuery,
    dateColumn: 'paid_at' | 'created_at',
    range: FinanceClientRange,
    scope: { accountId: string } | null,
    opts?: FinanceClientReadOptions
  ): Promise<RepositoryResult<FinanceClientReadResult<T>>> {
    const startedAt = Date.now();
    try {
      if (scope !== null && (typeof scope.accountId !== 'string' || !UUID_PATTERN.test(scope.accountId))) {
        throw new FinanceReadGuardError('An account id (UUID) is required');
      }
      const isValidDate = (d: unknown): d is Date => d instanceof Date && !Number.isNaN(d.getTime());
      if (!range || !isValidDate(range.from) || !isValidDate(range.to) || range.from.getTime() >= range.to.getTime()) {
        throw new FinanceReadGuardError('A valid range with from before to is required');
      }
      const pageSize = opts?.pageSize ?? FINANCE_READ_LIMITS.CLIENT_PAGE_SIZE;
      const ceiling = opts?.ceiling ?? FINANCE_READ_LIMITS.CLIENT_CEILING;
      if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > FINANCE_READ_LIMITS.CLIENT_PAGE_SIZE) {
        throw new FinanceReadGuardError(`pageSize must be an integer from 1 to ${FINANCE_READ_LIMITS.CLIENT_PAGE_SIZE}`);
      }
      if (!Number.isInteger(ceiling) || ceiling < 1 || ceiling > FINANCE_READ_LIMITS.CLIENT_CEILING) {
        throw new FinanceReadGuardError(`ceiling must be an integer from 1 to ${FINANCE_READ_LIMITS.CLIENT_CEILING}`);
      }
      const from = range.from.toISOString();
      const to = range.to.toISOString();

      const rows: T[] = [];
      let reachedCeiling = false;
      let last: string | null = null;
      for (;;) {
        const size = Math.min(pageSize, ceiling - rows.length);
        let query = start().gte(dateColumn, from).lt(dateColumn, to);
        if (scope !== null) query = query.eq('user_id', scope.accountId);
        if (last !== null) query = query.gt('id', last);
        const { data, error } = await query.order('id', { ascending: true }).limit(size);
        if (error) throw error;

        const page = (data ?? []) as unknown as T[];
        rows.push(...page);
        if (rows.length >= ceiling) {
          reachedCeiling = true;
          break;
        }
        if (page.length < size) break;
        last = page[page.length - 1].id;
      }

      // Counts and timing only: never an amount, a currency or an id.
      const what = dateColumn === 'paid_at' ? 'Client payment rows' : 'Client refund rows';
      if (scope === null) {
        this.logger.info(
          { method, rows: rows.length, reachedCeiling, durationMs: Date.now() - startedAt },
          `${what} of all accounts read`
        );
      } else {
        this.logger.debug({ method, rows: rows.length, reachedCeiling }, `${what} of one account read`);
      }
      return { data: { rows, reachedCeiling }, error: null };
    } catch (error) {
      return this.fail(method, error);
    }
  }
}

/** Singleton for convenience, matching the rest of the repository layer. */
export const businessOsFinanceReadRepository = new BusinessOsFinanceReadRepository();
