/**
 * The OLD first-plan-payment read, frozen for the MK5B-FU-1 equivalence test
 * (workplan docs/workplans/FINANCE_PAYING_FIRST_PAYMENT_SCALE_WORKPLAN.md §9.4).
 *
 * The method body between the two markers is a VERBATIM copy of
 * `BusinessOsBillingAdminReadRepository.listFirstPlanPaymentsForAccounts` at
 * main `8967888c` (lines 251 to 327): it reads every qualifying raw
 * `business_os_billing_events` row of the asked accounts and keeps the earliest.
 * The equivalence test pins the block's LF sha256, so the copy cannot drift.
 * The constants and error classes above the markers are the ones that method
 * used at that commit.
 *
 * Test-only. Lives outside `__tests__` so Jest does not collect it as a suite.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { AgentRepositoryResult as RepositoryResult } from '@/lib/repositories/types';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const ADMIN_BILLING_READ_LIMITS = { PAGE_SIZE: 1000, CEILING: 20_000, IN_CHUNK: 100 } as const;

const FIRST_PLAN_PAYMENT_COLUMNS = 'id, user_id, paid_at';

interface AdminFirstPlanPaymentRow {
  user_id: string;
  paid_at: string;
}

interface AdminBillingReadOptions {
  pageSize?: number;
  ceiling?: number;
}

export class LegacyAdminBillingReadGuardError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AdminBillingReadGuardError';
  }
}
export class LegacyAdminBillingReadCeilingError extends Error {
  constructor(ceiling: number) {
    super(`Billing rows reached the read ceiling of ${ceiling}`);
    this.name = 'AdminBillingReadCeilingError';
  }
}
export class LegacyAdminBillingReadIsolationError extends Error {
  constructor() {
    super('A billing event row came back for an account that was not asked for');
    this.name = 'AdminBillingReadIsolationError';
  }
}
const AdminBillingReadGuardError = LegacyAdminBillingReadGuardError;
const AdminBillingReadCeilingError = LegacyAdminBillingReadCeilingError;
const AdminBillingReadIsolationError = LegacyAdminBillingReadIsolationError;

/** A silent logger: the old read logged through Pino; the test does not need it. */
const silent = { info: (..._a: unknown[]) => undefined, warn: (..._a: unknown[]) => undefined, error: (..._a: unknown[]) => undefined };

export class LegacyFirstPlanPaymentsReader {
  private supabase: SupabaseClient;
  private logger = silent;

  constructor(supabaseClient: SupabaseClient) {
    this.supabase = supabaseClient;
  }

// ── LEGACY BLOCK START (verbatim, main 8967888c) ──
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
// ── LEGACY BLOCK END ──
}
