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
// The table is server-write-only with no client grant at all. The one caller
// is the Subscriptions route's wiring (`lib/admin/billing/subscriptionsDeps.ts`),
// reached only from `app/api/admin/business-os/billing/subscriptions` after
// `requireAdmin`. It is an admin read ACROSS accounts, by a differently NAMED
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
// Methods never throw: they return `{ data, error }`.

import type { SupabaseClient } from '@supabase/supabase-js';
import { supabaseServer as defaultSupabase } from '@/lib/supabaseServer';
import { createLogger, type Logger } from '@/lib/logger';
import type { AgentRepositoryResult as RepositoryResult } from './types';

/** The only columns the admin billing reads select (P8A-R3). Exported for the tests. */
export const ADMIN_BILLING_ROW_COLUMNS =
  'id, user_id, livemode, subscription_status, bought_tier, current_period_end, cancel_at_period_end, pending_tier, last_paid_at, last_payment_failed_at, failed_attempts, founder_discount_applied_at, ended_at';

export const ADMIN_BILLING_READ_LIMITS = {
  /** PostgREST's `max-rows`; a larger page would be silently cut (FF-1d). */
  PAGE_SIZE: 1000,
  CEILING: 20_000,
} as const;

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
}

/** Singleton for convenience, matching the rest of the repository layer. */
export const businessOsBillingAdminReadRepository = new BusinessOsBillingAdminReadRepository();
