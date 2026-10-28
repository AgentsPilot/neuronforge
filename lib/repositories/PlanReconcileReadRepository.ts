// lib/repositories/PlanReconcileReadRepository.ts
//
// READ-ONLY access for the nightly plan reconcile pass (plan payments P-8b.2,
// workplan docs/workplans/BUSINESS_OS_PLAN_PAYMENTS_P8B_WORKPLAN.md §4.2; SA
// rulings 8 and 9). Three reads, three tables, no write of any kind (its test
// pins that the source names no insert, update, upsert, delete or rpc call):
//
//   - `listRecentReconcileRunsAllJobs`: the recent finished runs of the
//     `bos-billing-reconcile` job in `bos_cron_runs`, so the pass can anchor
//     its replay window on the last run whose plan pass finished all its work
//     (SA ruling 8). Read here, not through `BosCronRunRepository`: that one is
//     the recorder's writer and only the recorder may name it.
//   - `listPlanSubscriptionRowsAllAccounts`: every billing row of ONE Stripe
//     mode that holds a subscription, for Step B (Stripe vs our record).
//   - `findRecordedPlanPaymentsAllAccounts`: which of some Stripe events (or
//     invoices) already left a row in the money history, for Step C (a paid
//     invoice with no plan assignment).
//
// ── WHY ITS OWN FILE (SA ruling 9, the P-8a D-1 convention) ─────────────────
// The billing WRITER repositories keep their exact caller lists: this file is
// not on them, and imports neither. Methods that read across accounts say so
// in their names (`…AllAccounts` / `…AllJobs`).
//
// ── SERVICE ROLE (intentional RLS bypass, documented per CLAUDE.md) ─────────
// A cron has no user session, and the question ("which subscriptions does
// Stripe hold that we do not, platform-wide") has no per-tenant answer, so
// CLAUDE.md rule 4 is replaced by: the only caller is the pass's wiring
// (`lib/business-os/billing/planReconcileDeps.ts`), which takes no account id
// from any input (SR-8). Every billing read filters `livemode` (PF-15).
// `bos_cron_runs` holds no tenant data at all.
//
// ── COLUMNS ─────────────────────────────────────────────────────────────────
// Only what the comparison needs: no checkout lock, no bearer invoice link, no
// money. The money history read selects ids and the kind only.
//
// Methods never throw: they return `{ data, error }`.

import type { SupabaseClient } from '@supabase/supabase-js';
import { supabaseServer as defaultSupabase } from '@/lib/supabaseServer';
import { createLogger, type Logger } from '@/lib/logger';
import type { AgentRepositoryResult as RepositoryResult } from './types';

/** The job whose runs anchor the window. Equal to its id in `lib/cron/bosCronJobs.ts` (test-pinned). */
export const PLAN_RECONCILE_JOB = 'bos-billing-reconcile';

/** The only columns the run read selects. */
export const RECONCILE_RUN_COLUMNS = 'started_at, outcome, counts';

/** The only columns the Step B billing read selects. */
export const PLAN_RECONCILE_BILLING_COLUMNS =
  'id, user_id, livemode, stripe_subscription_id, subscription_status, bought_tier, current_period_end, cancel_at_period_end, ended_at';

/** The only columns the Step C money history read selects. */
export const PLAN_RECONCILE_EVENT_COLUMNS = 'stripe_event_id, stripe_invoice_id, kind';

export const PLAN_RECONCILE_READ_LIMITS = {
  /** A daily job read over 30 days (Stripe's event retention): about 31 runs; 50 is ample. */
  RUNS: 50,
  /** PostgREST's `max-rows`; a larger page would be silently cut. */
  PAGE_SIZE: 1000,
  /** Reaching it is an ERROR, never a partial list (a cut list would hide subscriptions). */
  CEILING: 20_000,
  /** The most ids one `.in()` filter carries. */
  IN_CHUNK: 100,
} as const;

/** One finished run of the job. `counts` is the run record's own numbers. */
export interface PlanReconcileRunRow {
  started_at: string;
  outcome: 'succeeded' | 'partial';
  counts: Record<string, unknown> | null;
}

/** One billing row holding a subscription, as Step B compares it. */
export interface PlanReconcileBillingRow {
  id: string;
  /** NULL: the account was deleted and the row detached (ON DELETE SET NULL). */
  user_id: string | null;
  livemode: boolean;
  stripe_subscription_id: string;
  subscription_status: string | null;
  bought_tier: string | null;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
  ended_at: string | null;
}

/** What Step C learns: the event ids and the invoice ids already in the money history. */
export interface RecordedPlanPayments {
  /** Events that wrote a row of any kind (a payment, or a recorded refusal). */
  eventIds: string[];
  /** Invoices that hold an `invoice_paid` row. */
  invoiceIds: string[];
}

export interface PlanReconcileReadOptions {
  pageSize?: number;
  ceiling?: number;
}

const EVENT_ID_PATTERN = /^evt_[A-Za-z0-9]{1,251}$/;
const INVOICE_ID_PATTERN = /^in_[A-Za-z0-9]{1,252}$/;
const ISO_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?Z$/;

class PlanReconcileReadGuardError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PlanReconcileReadGuardError';
  }
}

/** The read reached its ceiling: an ERROR, never a partial list. */
export class PlanReconcileReadCeilingError extends Error {
  constructor(ceiling: number) {
    super(`Billing rows reached the read ceiling of ${ceiling}`);
    this.name = 'PlanReconcileReadCeilingError';
  }
}

function chunks<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export class PlanReconcileReadRepository {
  private supabase: SupabaseClient;
  private logger: Logger;

  constructor(supabaseClient?: SupabaseClient) {
    // Service role by default: a cron's cross-account read. See the header.
    this.supabase = supabaseClient || defaultSupabase;
    this.logger = createLogger({ service: 'PlanReconcileReadRepository' });
  }

  private fail(method: string, error: unknown): RepositoryResult<never> {
    if (error instanceof PlanReconcileReadGuardError) {
      this.logger.warn({ method, err: error }, 'Plan reconcile read refused by its guard');
    } else {
      this.logger.error({ method, err: error }, 'Plan reconcile read failed');
    }
    return { data: null, error: error instanceof Error ? error : new Error(String(error)) };
  }

  /**
   * The job's runs that FINISHED (`succeeded` or `partial`) and started at or
   * after `sinceIso`, newest first, at most 50. The pass decides which one
   * anchors its window from their counts (SA ruling 8); a `running` or
   * `failed` run is never returned.
   */
  async listRecentReconcileRunsAllJobs(sinceIso: string): Promise<RepositoryResult<PlanReconcileRunRow[]>> {
    const method = 'listRecentReconcileRunsAllJobs';
    try {
      if (typeof sinceIso !== 'string' || !ISO_PATTERN.test(sinceIso)) {
        throw new PlanReconcileReadGuardError('sinceIso must be an ISO UTC timestamp');
      }
      const { data, error } = await this.supabase
        .from('bos_cron_runs')
        .select(RECONCILE_RUN_COLUMNS)
        .eq('job', PLAN_RECONCILE_JOB)
        .in('outcome', ['succeeded', 'partial'])
        .gte('started_at', sinceIso)
        .order('started_at', { ascending: false })
        .limit(PLAN_RECONCILE_READ_LIMITS.RUNS);
      if (error) throw error;
      const rows = (data ?? []) as unknown as PlanReconcileRunRow[];
      this.logger.debug({ method, rows: rows.length }, 'Recent billing reconcile runs read');
      return { data: rows, error: null };
    } catch (error) {
      return this.fail(method, error);
    }
  }

  /**
   * Every billing row of ONE Stripe mode that holds a subscription (ended or
   * not), all accounts, keyset-paged on `id`. Counts only in the log.
   */
  async listPlanSubscriptionRowsAllAccounts(
    livemode: boolean,
    opts?: PlanReconcileReadOptions
  ): Promise<RepositoryResult<PlanReconcileBillingRow[]>> {
    const method = 'listPlanSubscriptionRowsAllAccounts';
    try {
      if (typeof livemode !== 'boolean') throw new PlanReconcileReadGuardError('livemode must be a boolean');
      const pageSize = opts?.pageSize ?? PLAN_RECONCILE_READ_LIMITS.PAGE_SIZE;
      const ceiling = opts?.ceiling ?? PLAN_RECONCILE_READ_LIMITS.CEILING;
      if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > PLAN_RECONCILE_READ_LIMITS.PAGE_SIZE) {
        throw new PlanReconcileReadGuardError(`pageSize must be an integer from 1 to ${PLAN_RECONCILE_READ_LIMITS.PAGE_SIZE}`);
      }
      if (!Number.isInteger(ceiling) || ceiling < 1 || ceiling > PLAN_RECONCILE_READ_LIMITS.CEILING) {
        throw new PlanReconcileReadGuardError(`ceiling must be an integer from 1 to ${PLAN_RECONCILE_READ_LIMITS.CEILING}`);
      }

      const rows: PlanReconcileBillingRow[] = [];
      let last: string | null = null;
      for (;;) {
        let query = this.supabase
          .from('business_os_billing_accounts')
          .select(PLAN_RECONCILE_BILLING_COLUMNS)
          .eq('livemode', livemode)
          .not('stripe_subscription_id', 'is', null);
        if (last !== null) query = query.gt('id', last);
        const { data, error } = await query.order('id', { ascending: true }).limit(pageSize);
        if (error) throw error;

        const page = (data ?? []) as unknown as PlanReconcileBillingRow[];
        rows.push(...page);
        // `>=`: exactly the ceiling cannot be told from a cut list.
        if (rows.length >= ceiling) throw new PlanReconcileReadCeilingError(ceiling);
        if (page.length < pageSize) break;
        last = page[page.length - 1].id;
      }

      this.logger.info({ method, livemode, rows: rows.length }, 'Billing rows holding a subscription read');
      return { data: rows, error: null };
    } catch (error) {
      return this.fail(method, error);
    }
  }

  /**
   * Which of these events wrote a money history row (any kind), and which of
   * these invoices hold an `invoice_paid` row, in ONE mode. Ids are checked
   * before any query; an empty input makes no query. Chunks of at most 100 ids:
   * both columns are UNIQUE (`stripe_event_id`; `stripe_invoice_id` where the
   * kind is `invoice_paid`), so a chunk can never return more rows than ids.
   */
  async findRecordedPlanPaymentsAllAccounts(
    livemode: boolean,
    ids: { eventIds: readonly string[]; invoiceIds: readonly string[] }
  ): Promise<RepositoryResult<RecordedPlanPayments>> {
    const method = 'findRecordedPlanPaymentsAllAccounts';
    try {
      if (typeof livemode !== 'boolean') throw new PlanReconcileReadGuardError('livemode must be a boolean');
      const eventIds = [...new Set(ids?.eventIds ?? [])];
      const invoiceIds = [...new Set(ids?.invoiceIds ?? [])];
      if (!eventIds.every((id) => typeof id === 'string' && EVENT_ID_PATTERN.test(id))) {
        throw new PlanReconcileReadGuardError('every event id must be a Stripe event id');
      }
      if (!invoiceIds.every((id) => typeof id === 'string' && INVOICE_ID_PATTERN.test(id))) {
        throw new PlanReconcileReadGuardError('every invoice id must be a Stripe invoice id');
      }

      const foundEvents = new Set<string>();
      for (const chunk of chunks(eventIds, PLAN_RECONCILE_READ_LIMITS.IN_CHUNK)) {
        const { data, error } = await this.supabase
          .from('business_os_billing_events')
          .select(PLAN_RECONCILE_EVENT_COLUMNS)
          .eq('livemode', livemode)
          .in('stripe_event_id', chunk);
        if (error) throw error;
        for (const row of (data ?? []) as Array<{ stripe_event_id: string | null }>) {
          if (row.stripe_event_id) foundEvents.add(row.stripe_event_id);
        }
      }

      const foundInvoices = new Set<string>();
      for (const chunk of chunks(invoiceIds, PLAN_RECONCILE_READ_LIMITS.IN_CHUNK)) {
        const { data, error } = await this.supabase
          .from('business_os_billing_events')
          .select(PLAN_RECONCILE_EVENT_COLUMNS)
          .eq('livemode', livemode)
          .eq('kind', 'invoice_paid')
          .in('stripe_invoice_id', chunk);
        if (error) throw error;
        for (const row of (data ?? []) as Array<{ stripe_invoice_id: string | null }>) {
          if (row.stripe_invoice_id) foundInvoices.add(row.stripe_invoice_id);
        }
      }

      this.logger.debug(
        { method, livemode, events: eventIds.length, invoices: invoiceIds.length },
        'Plan payment records read'
      );
      return { data: { eventIds: [...foundEvents], invoiceIds: [...foundInvoices] }, error: null };
    } catch (error) {
      return this.fail(method, error);
    }
  }
}

export const planReconcileReadRepository = new PlanReconcileReadRepository();
