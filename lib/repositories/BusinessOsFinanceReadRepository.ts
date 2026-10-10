// lib/repositories/BusinessOsFinanceReadRepository.ts
//
// READ-ONLY access for the admin finance & business health page (slice 1a,
// workplan docs/workplans/BUSINESS_OS_FINANCE_HEALTH_SLICE_1A_WORKPLAN.md,
// reads R-c, R-c′ and R-d).
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
// ── SERVICE ROLE (intentional RLS bypass, documented per CLAUDE.md) ─────────
// The one caller is the finance page's production wiring
// (`lib/business-os/finance/financeHealthDeps.ts`), reached only from
// `app/api/admin/business-os/finance` after `requireAdmin`. It is an admin
// read ACROSS accounts, which no owner RLS client can serve, and the billing
// tables are server-write-only with no client grant at all.
//
// ── ACCOUNT SCOPE, BY SIGNATURE ──────────────────────────────────────────────
// The account-scoped read requires an account id and refuses a malformed one
// before querying (CLAUDE.md rule 4). A read that is not scoped to one account
// is reached only by calling a differently NAMED method, never by leaving an
// argument out (the TokenUsageRepository convention):
//   - ALL ACCOUNTS: `listLiveBillingStatusesAllAccounts` (R-c). Logs at info.
//   - ONE ACCOUNT: `findLiveBillingStatusForAccount` (R-c′).
//   - PLATFORM-WIDE EXISTENCE: `countLiveRevenueRows` (R-d), two head counts
//     that read no account and no amount.
//
// ── LIVE MODE ONLY ───────────────────────────────────────────────────────────
// Test-mode Stripe rows share these tables. Every read here filters
// `livemode = true`, so a test purchase can never count as revenue or as a
// paying account.
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
} as const;

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
}

/** Singleton for convenience, matching the rest of the repository layer. */
export const businessOsFinanceReadRepository = new BusinessOsFinanceReadRepository();
