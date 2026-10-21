// lib/repositories/BusinessOsBillingAdminReadRepository.ts
//
// READ-ONLY access to `business_os_billing_accounts` for the admin
// Subscriptions page (plan payments P-8a.1, workplan
// docs/workplans/BUSINESS_OS_PLAN_PAYMENTS_P8A_WORKPLAN.md §5.1, SA-WP-P8a
// P8A-R2 and P8A-R3).
//
// ── WHY ITS OWN FILE (deviation D-1 from the workplan) ───────────────────────
// The workplan put this read in the finance read repository (SA-F2: admin
// money reads are never on a writer's caller list). That file's code may never
// name the mode column, and the finance source guard pins that. P-8a must
// filter on the CURRENT mode (PF-15), so the read lives here instead. The
// SA-F2 rule still holds: the billing-account WRITER repository and its exact
// caller list are untouched, and this file has no write method (its test pins
// that the source names no insert, update, upsert, delete or rpc call).
//
// ── SERVICE ROLE (intentional RLS bypass, documented per CLAUDE.md) ─────────
// The table is server-write-only with no client grant at all. The callers are
// the Subscriptions route's wiring (`lib/admin/billing/subscriptionsDeps.ts`,
// R-p) and the billing panel route (`app/api/admin/business-os/billing/
// accounts/[accountId]`, R-p′, P-8a.2), both only after `requireAdmin`. It is an admin read ACROSS accounts, by a differently NAMED
// method (`...AllAccounts`), never by leaving an account id out.
//
// ── MODE ─────────────────────────────────────────────────────────────────────
// Every read filters `livemode` (PF-15). There are at most one row per account
// per mode: UNIQUE (user_id, livemode), 20261025.
//
// ── PAGING (P8A-R2, FF-1d) ───────────────────────────────────────────────────
// Keyset on `id` (the PK): rows detached from a deleted account (`user_id`
// NULL) are included, which a keyset on `user_id` could not step over. At most
// 1,000 rows per request (PostgREST's `max-rows`). Reaching the ceiling is an
// ERROR, never a partial list: a cut list would silently drop paying
// subscriptions from MRR.
//
// ── COLUMNS (P8A-R3) ─────────────────────────────────────────────────────────
// No checkout lock (`open_checkout_*`), no `action_required_invoice_url` (a
// bearer link to the owner's invoice), no Stripe customer, subscription or
// invoice id: the list shows none of them.
//
// ── MONEY MK-5b: THE FIRST PLAN PAYMENT (SA-10, KPI restructure review §5.1) ──
// One more READ, of `business_os_billing_events` this time: the earliest
// `invoice_paid` above zero per account, in ONE mode, for a given list of
// account ids (`listFirstPlanPaymentsForAccounts`). It lives here and not in
// the finance read repository for the same reason as D-1: it filters the mode
// column. A boost never writes a billing event (PAY SR-6), so the kind filter
// alone leaves boosts out; `amount_minor > 0` leaves out a zero invoice. The
// `.in()` list is chunked at 100 ids, each chunk keyset-paged on `id` at
// 1,000 rows, and reaching the ceiling is an ERROR. Tenant isolation: only the
// given ids are read, and a row for any other id is an error, never kept. The
// one caller is `lib/admin/billing/firstPlanPayments.ts`, reached from the
// admin finance route after `requireAdmin`.
//
// Methods never throw: they return `{ data, error }`.

import type { SupabaseClient } from '@supabase/supabase-js';
import { supabaseServer as defaultSupabase } from '@/lib/supabaseServer';
import { createLogger, type Logger } from '@/lib/logger';
import type { AgentRepositoryResult as RepositoryResult } from './types';

/** The only columns the admin billing reads select (P8A-R3). Exported for the tests. */
export const ADMIN_BILLING_ROW_COLUMNS =
  'id, user_id, livemode, subscription_status, bought_tier, current_period_end, cancel_at_period_end, pending_tier, last_paid_at, last_payment_failed_at, failed_attempts, founder_discount_applied_at, ended_at';

/**
 * R-p′ (the billing panel, P-8a.2) also reads the Stripe customer id: the
 * server builds the dashboard link from it (SA-WP-P8a Q-4, P8A-R3). Still no
 * checkout lock, no bearer invoice link, no subscription or invoice id.
 */
export const ADMIN_BILLING_PANEL_COLUMNS = `${ADMIN_BILLING_ROW_COLUMNS}, stripe_customer_id`;

/** One account's billing row for the panel: the list row plus the customer id. */
export interface AdminBillingPanelRow extends AdminBillingRow {
  stripe_customer_id: string;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const ADMIN_BILLING_READ_LIMITS = {
  /** PostgREST's `max-rows`; a larger page would be silently cut (FF-1d). */
  PAGE_SIZE: 1000,
  CEILING: 20_000,
  /** MK-5b (SA-10): the most account ids one `.in()` filter carries. */
  IN_CHUNK: 100,
} as const;

/** MK-5b: the only columns the first-payment read selects. No Stripe id, no amount, no tier. */
export const FIRST_PLAN_PAYMENT_COLUMNS = 'id, user_id, paid_at';

/** MK-5b: one account's earliest plan payment above zero in one mode. */
export interface AdminFirstPlanPaymentRow {
  user_id: string;
  /** ISO timestamptz of that payment. */
  paid_at: string;
}

/** MK-5b: a row came back for an account that was not asked for. An error, never kept. */
export class AdminBillingReadIsolationError extends Error {
  constructor() {
    super('A billing event row came back for an account that was not asked for');
    this.name = 'AdminBillingReadIsolationError';
  }
}

/** One billing row as the admin Subscriptions page reads it. Statuses are plain strings. */
export interface AdminBillingRow {
  id: string;
  /** NULL: the account was deleted and the row detached (ON DELETE SET NULL). */
  user_id: string | null;
  livemode: boolean;
  subscription_status: string | null;
  bought_tier: string | null;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
  pending_tier: string | null;
  last_paid_at: string | null;
  last_payment_failed_at: string | null;
  failed_attempts: number;
  founder_discount_applied_at: string | null;
  ended_at: string | null;
}

/** For tests (a small page or ceiling); production uses the defaults. */
export interface AdminBillingReadOptions {
  pageSize?: number;
  ceiling?: number;
}

class AdminBillingReadGuardError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AdminBillingReadGuardError';
  }
}

/** The read reached its ceiling: an ERROR, never a partial list. */
export class AdminBillingReadCeilingError extends Error {
  constructor(ceiling: number) {
    super(`Billing rows reached the read ceiling of ${ceiling}`);
    this.name = 'AdminBillingReadCeilingError';
  }
}

export class BusinessOsBillingAdminReadRepository {
  private supabase: SupabaseClient;
  private logger: Logger;

  constructor(supabaseClient?: SupabaseClient) {
    // Service role by default: an admin-only, cross-account read. See the header.
    this.supabase = supabaseClient || defaultSupabase;
    this.logger = createLogger({ service: 'BusinessOsBillingAdminReadRepository' });
  }

  /**
   * R-p. Every billing row of ONE Stripe mode, all accounts, keyset-paged on
   * `id`. Logged at info: it is a cross-account read. Counts only, no ids.
   */
  async listBillingRowsForModeAllAccounts(
    livemode: boolean,
    opts?: AdminBillingReadOptions
  ): Promise<RepositoryResult<AdminBillingRow[]>> {
    const method = 'listBillingRowsForModeAllAccounts';
    const startedAt = Date.now();
    try {
      if (typeof livemode !== 'boolean') throw new AdminBillingReadGuardError('livemode must be a boolean');
      const pageSize = opts?.pageSize ?? ADMIN_BILLING_READ_LIMITS.PAGE_SIZE;
      const ceiling = opts?.ceiling ?? ADMIN_BILLING_READ_LIMITS.CEILING;
      if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > ADMIN_BILLING_READ_LIMITS.PAGE_SIZE) {
        throw new AdminBillingReadGuardError(`pageSize must be an integer from 1 to ${ADMIN_BILLING_READ_LIMITS.PAGE_SIZE}`);
      }
      if (!Number.isInteger(ceiling) || ceiling < 1 || ceiling > ADMIN_BILLING_READ_LIMITS.CEILING) {
        throw new AdminBillingReadGuardError(`ceiling must be an integer from 1 to ${ADMIN_BILLING_READ_LIMITS.CEILING}`);
      }

      const rows: AdminBillingRow[] = [];
      let last: string | null = null;
      for (;;) {
        let query = this.supabase
          .from('business_os_billing_accounts')
          .select(ADMIN_BILLING_ROW_COLUMNS)
          .eq('livemode', livemode);
        if (last !== null) query = query.gt('id', last);
        const { data, error } = await query.order('id', { ascending: true }).limit(pageSize);
        if (error) throw error;

        const page = (data ?? []) as unknown as AdminBillingRow[];
        rows.push(...page);
        // `>=`: exactly the ceiling cannot be told from a cut list.
        if (rows.length >= ceiling) throw new AdminBillingReadCeilingError(ceiling);
        if (page.length < pageSize) break;
        last = page[page.length - 1].id;
      }

      this.logger.info({ method, livemode, rows: rows.length, durationMs: Date.now() - startedAt }, 'Billing rows of one mode read');
      return { data: rows, error: null };
    } catch (error) {
      if (error instanceof AdminBillingReadGuardError) {
        this.logger.warn({ method, err: error }, 'Admin billing read refused by its guard');
      } else {
        this.logger.error({ method, err: error }, 'Admin billing read failed');
      }
      return { data: null, error: error instanceof Error ? error : new Error(String(error)) };
    }
  }

  /**
   * R-p′. ONE account's billing row in ONE Stripe mode, or `null` when it has
   * none (P-8a.2). `.eq('user_id')` and `.eq('livemode')`: UNIQUE (user_id,
   * livemode) makes `maybeSingle` safe. The account id is refused before any
   * query unless it is a UUID (CLAUDE.md rule 4).
   */
  async findBillingRowForAccount(
    accountId: string,
    livemode: boolean
  ): Promise<RepositoryResult<AdminBillingPanelRow | null>> {
    const method = 'findBillingRowForAccount';
    try {
      if (typeof accountId !== 'string' || !UUID_PATTERN.test(accountId)) {
        throw new AdminBillingReadGuardError('An account id (UUID) is required');
      }
      if (typeof livemode !== 'boolean') throw new AdminBillingReadGuardError('livemode must be a boolean');
      const { data, error } = await this.supabase
        .from('business_os_billing_accounts')
        .select(ADMIN_BILLING_PANEL_COLUMNS)
        .eq('user_id', accountId)
        .eq('livemode', livemode)
        .maybeSingle();
      if (error) throw error;
      const row = (data ?? null) as unknown as AdminBillingPanelRow | null;
      this.logger.debug({ method, livemode, found: row !== null }, 'Billing row of one account read');
      return { data: row, error: null };
    } catch (error) {
      if (error instanceof AdminBillingReadGuardError) {
        this.logger.warn({ method, err: error }, 'Admin billing read refused by its guard');
      } else {
        this.logger.error({ method, err: error }, 'Admin billing read failed');
      }
      return { data: null, error: error instanceof Error ? error : new Error(String(error)) };
    }
  }

  /**
   * MK-5b (SA-10). For each of `accountIds`, its EARLIEST paid plan invoice
   * above zero in ONE Stripe mode, or nothing when it has none. Ids are checked
   * as UUIDs, lower-cased and de-duplicated before any query; an empty list
   * makes no query. Each chunk of at most 100 ids is keyset-paged on `id`, at
   * most 1,000 rows per request; all chunks together reaching the ceiling is
   * an ERROR. A row for an id not asked for, or with an unreadable `paid_at`,
   * is an error: never a guess, never a hidden earlier payment. Logged at info
   * with counts only, never an id.
   */
  async listFirstPlanPaymentsForAccounts(
    accountIds: readonly string[],
    livemode: boolean,
    opts?: AdminBillingReadOptions
  ): Promise<RepositoryResult<AdminFirstPlanPaymentRow[]>> {
    const method = 'listFirstPlanPaymentsForAccounts';
    const startedAt = Date.now();
    try {
      if (typeof livemode !== 'boolean') throw new AdminBillingReadGuardError('livemode must be a boolean');
      if (!Array.isArray(accountIds) || !accountIds.every((id) => typeof id === 'string' && UUID_PATTERN.test(id))) {
        throw new AdminBillingReadGuardError('Account ids (UUIDs) are required');
      }
      const pageSize = opts?.pageSize ?? ADMIN_BILLING_READ_LIMITS.PAGE_SIZE;
      const ceiling = opts?.ceiling ?? ADMIN_BILLING_READ_LIMITS.CEILING;
      if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > ADMIN_BILLING_READ_LIMITS.PAGE_SIZE) {
        throw new AdminBillingReadGuardError(`pageSize must be an integer from 1 to ${ADMIN_BILLING_READ_LIMITS.PAGE_SIZE}`);
      }
      if (!Number.isInteger(ceiling) || ceiling < 1 || ceiling > ADMIN_BILLING_READ_LIMITS.CEILING) {
        throw new AdminBillingReadGuardError(`ceiling must be an integer from 1 to ${ADMIN_BILLING_READ_LIMITS.CEILING}`);
      }

      const ids = [...new Set(accountIds.map((id) => id.toLowerCase()))].sort();
      const earliest = new Map<string, { at: number; iso: string }>();
      let rowsRead = 0;
      let chunks = 0;
      for (let start = 0; start < ids.length; start += ADMIN_BILLING_READ_LIMITS.IN_CHUNK) {
        const chunk = ids.slice(start, start + ADMIN_BILLING_READ_LIMITS.IN_CHUNK);
        const asked = new Set(chunk);
        chunks += 1;
        let last: string | null = null;
        for (;;) {
          let query = this.supabase
            .from('business_os_billing_events')
            .select(FIRST_PLAN_PAYMENT_COLUMNS)
            .eq('livemode', livemode)
            .eq('kind', 'invoice_paid')
            .gt('amount_minor', 0)
            .not('paid_at', 'is', null)
            .in('user_id', chunk);
          if (last !== null) query = query.gt('id', last);
          const { data, error } = await query.order('id', { ascending: true }).limit(pageSize);
          if (error) throw error;

          const page = (data ?? []) as unknown as Array<{ id: string; user_id: string | null; paid_at: string | null }>;
          rowsRead += page.length;
          // `>=`: exactly the ceiling cannot be told from a cut list.
          if (rowsRead >= ceiling) throw new AdminBillingReadCeilingError(ceiling);
          for (const row of page) {
            const owner = typeof row.user_id === 'string' ? row.user_id.toLowerCase() : null;
            if (owner === null || !asked.has(owner)) throw new AdminBillingReadIsolationError();
            const at = typeof row.paid_at === 'string' ? Date.parse(row.paid_at) : Number.NaN;
            if (!Number.isFinite(at)) throw new Error('A paid plan invoice has an unreadable paid_at');
            const seen = earliest.get(owner);
            if (!seen || at < seen.at) earliest.set(owner, { at, iso: row.paid_at as string });
          }
          if (page.length < pageSize) break;
          last = page[page.length - 1].id;
        }
      }

      const result = [...earliest.entries()]
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([user_id, first]) => ({ user_id, paid_at: first.iso }));
      this.logger.info(
        { method, livemode, accounts: ids.length, chunks, rows: rowsRead, found: result.length, durationMs: Date.now() - startedAt },
        'First plan payments of one mode read'
      );
      return { data: result, error: null };
    } catch (error) {
      if (error instanceof AdminBillingReadGuardError) {
        this.logger.warn({ method, err: error }, 'Admin billing read refused by its guard');
      } else {
        this.logger.error({ method, err: error }, 'Admin billing read failed');
      }
      return { data: null, error: error instanceof Error ? error : new Error(String(error)) };
    }
  }
}

/** Singleton for convenience, matching the rest of the repository layer. */
export const businessOsBillingAdminReadRepository = new BusinessOsBillingAdminReadRepository();
