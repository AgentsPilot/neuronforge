// lib/repositories/BusinessOsFinanceReadRepository.ts
//
// READ-ONLY access for the admin finance & business health page (slice 1a,
// workplan docs/workplans/BUSINESS_OS_FINANCE_HEALTH_SLICE_1A_WORKPLAN.md,
// reads R-c, R-c′ and R-d; slice 2a, workplan
// docs/workplans/BUSINESS_OS_FINANCE_HEALTH_SLICE_2A_WORKPLAN.md, reads R-e,
// R-e′, R-f and R-f′: the businesses' client payments and refunds, layer B;
// slice 2b, workplan docs/workplans/BUSINESS_OS_FINANCE_HEALTH_SLICE_2B_WORKPLAN.md,
// reads R-g, R-g′, R-h, R-h′, R-i and R-i′: the businesses' overdue client
// invoices and instalments, and their client plans, layer B too; slice 4a,
// workplan docs/workplans/BUSINESS_OS_FINANCE_HEALTH_SLICE_4A_WORKPLAN.md,
// reads R-k and R-k′: the platform's own credit boost purchases paid in the
// window, layer A; slice 5a, workplan
// docs/workplans/BUSINESS_OS_FINANCE_HEALTH_SLICE_5A_MONEY_M1_M2_WORKPLAN.md,
// reads R-m and R-m′: the platform's own paid plan invoices in the window,
// layer A; slice 4b.2, workplan
// docs/workplans/BUSINESS_OS_FINANCE_HEALTH_SLICE_4B2_REVERSAL_DISPLAY_WORKPLAN.md,
// reads R-n and R-n′: the dated boost reversal events recorded in the window,
// and R-l and R-l′: the boost purchases that need attention now, layer A).
//
// ── THE REVERSAL EVENTS (slice 4b.2, BD-17) ─────────────────────────────────
// `business_os_boost_reversal_events` has NO account column: an event belongs
// to an account through its purchase (the tenant-isolation "parent-owned"
// shape). So R-n′ reads the account's purchases first (`.eq('user_id')` on
// every page), then only the events whose `purchase_id` is in that set, and
// drops any event outside it (fail closed). No caller ever supplies an id
// list: every id list is built here from rows this file just read. Id lists
// go out in chunks of at most `FINANCE_ID_CHUNK` (E-69), and every request,
// each chunk included, keyset-pages at 1,000 rows (PostgREST's `max-rows`,
// the C-1 lesson): no read relies on one large response. Before the table
// exists (migration 20261076 not applied), the read fails with a typed
// `FinanceReadTableAbsentError`, logged at warn (SA-W121).
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
// Slice 2b adds the client invoices, the plan instalments and the client plans.
// They too have writer and owner-scoped repositories (the client payment
// repository for invoices, the payment plan repository, the client plan
// repository and the payment reminder repository), named here in words only
// (pinned by a test, SA-W40).
//
// THIS FILE NEVER READS THE REMINDER QUEUE. The jobs & queues admin read owns
// it (R-j: one definition of stuck and dead-lettered); the finance route
// injects that read, so nothing here duplicates it.
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
//   - ALL ACCOUNTS: `listBillingStatusesAllAccounts` (R-c),
//     `listClientPaymentsAllAccountsPaidInRange` (R-e),
//     `listClientRefundsAllAccountsCreatedInRange` (R-f),
//     `listOverdueClientInvoicesAllAccounts` (R-g),
//     `listOverdueClientInstalmentsAllAccounts` (R-h),
//     `listClientPlansAllAccounts` (R-i),
//     `listBoostPurchasesAllAccountsPaidInRange` (R-k),
//     `listPlanPaymentsAllAccountsPaidInRange` (R-m),
//     `listBoostReversalEventsAllAccountsRecordedInRange` (R-n) and
//     `listBoostPurchasesNeedingAttentionAllAccounts` (R-l). Logged at info.
//   - ONE ACCOUNT: `findBillingStatusForAccount` (R-c′),
//     `listClientPaymentsForAccountPaidInRange` (R-e′),
//     `listClientRefundsForAccountCreatedInRange` (R-f′),
//     `listOverdueClientInvoicesForAccount` (R-g′),
//     `listOverdueClientInstalmentsForAccount` (R-h′),
//     `listClientPlansForAccount` (R-i′),
//     `listBoostPurchasesForAccountPaidInRange` (R-k′),
//     `listPlanPaymentsForAccountPaidInRange` (R-m′) and
//     `listBoostPurchasesNeedingAttentionForAccount` (R-l′), with
//     `.eq('user_id')` on every page; and
//     `listBoostReversalEventsForAccountRecordedInRange` (R-n′), scoped
//     through the account's own purchases (see THE REVERSAL EVENTS).
//   - PLATFORM-WIDE EXISTENCE: `countRevenueRows` (R-d), two head counts
//     that read no account and no amount.
//
// ── TEST AND LIVE MODE (BD-13, BD-14, BD-16) ─────────────────────────────────
// No read in this file filters by mode. Layer A (R-c, R-c′, R-d, R-k, R-k′,
// R-m, R-m′) counts test and real Stripe rows together and treats them as real (BD-14, slice 1c);
// layer B (R-e to R-i′) has no mode at all (BD-13). One billing record per
// account is assumed (BD-16): if an account ever has two, R-c and R-c′ return
// an ERROR, never a figure. This file's code never names the mode column
// (pinned by the finance source guard).
//
// ── PAGING ───────────────────────────────────────────────────────────────────
// R-c pages by keyset on `user_id` (unique while one row per account holds),
// and reaching its ceiling, or reading one `user_id` twice, is an ERROR. The
// layer-B reads page by keyset on `id`, and at their ceiling (the `>=` rule)
// return the rows read with `reachedCeiling: true`, so the page says "At
// least". R-e to R-m′ use one pager, with the same CLIENT_* page size and
// ceiling (SA-W49, SA-Q36): R-e / R-f / R-k filter a range and read every status (the
// caller counts the others); R-g / R-h filter by the stored status and a
// validated UTC date; R-i reads every row; R-m / R-m′ filter the paid plan
// invoice kind and a `paid_at` range on every page (slice 5a).
//
// Methods never throw: they return `{ data, error }`.

import type { SupabaseClient } from '@supabase/supabase-js';
import { supabaseServer as defaultSupabase } from '@/lib/supabaseServer';
import { createLogger, type Logger } from '@/lib/logger';
import type { AgentRepositoryResult as RepositoryResult } from './types';

/**
 * One billing-account row, as the finance page reads it: who, which status,
 * ended or not, which tier was bought. Test or real mode (BD-14), one per
 * account (BD-16).
 */
export interface FinanceBillingStatusRow {
  user_id: string;
  /**
   * A plain string: this repository imports no type from the billing-account
   * repository (see the header). The caller narrows it with
   * `isPayingBillingRow` (`lib/business-os/billing/payingSubscriptionStatuses.ts`).
   */
  subscription_status: string | null;
  ended_at: string | null;
  /**
   * The tier named by the paid price (SA-Q20 fallback). Free text here: the
   * classifier compares it with the entitlement config's tier order only.
   */
  bought_tier: string | null;
}

/** Whether any revenue row exists, platform-wide (BD-14). Counts only, never an amount. */
export interface FinanceRevenueCounts {
  planInvoicesPaid: number;
  boostsPaid: number;
}

/** The only columns the billing-status reads select. Exported for the tests. */
export const FINANCE_BILLING_STATUS_COLUMNS = 'user_id, subscription_status, ended_at, bought_tier';

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
 * The invoice columns R-g / R-g′ select (slice 2b, AC-64). No client data
 * (`contact_id`, the client name / email / phone columns, `notes`,
 * `internal_notes`, `line_items`, `invoice_number`, `metadata`), no Stripe id
 * and no `refunded_amount`: the block shows the full invoice amount.
 */
export const FINANCE_CLIENT_INVOICE_DUE_COLUMNS = 'id, user_id, amount, currency, status, due_date';

/** The instalment columns R-h / R-h′ select (SA-W34: no `subscription_id`, no `contact_id`, no retry column). */
export const FINANCE_CLIENT_INSTALMENT_DUE_COLUMNS = 'id, user_id, amount, currency, status, due_date';

/** The client plan columns R-i / R-i′ select (SA-W34: no `currency`, no amount, no card or Stripe column, no `contact_id`). */
export const FINANCE_CLIENT_PLAN_COLUMNS =
  'id, user_id, status, cancelled_at, completed_at, next_charge_at, last_failure_at';

/**
 * The boost purchase columns R-k / R-k′ select (slice 4a, §11C.6). No Stripe
 * id, no receipt URL, no flag reason, no lot id (S4-FR-9), no mode column
 * (BD-14) and no `created_at` (never a revenue date, S4-W-1). Slice 4b.2
 * (SA-W119): no refunded amount either; refunds are dated by their events (R-n).
 */
export const FINANCE_BOOST_PURCHASE_COLUMNS =
  'id, user_id, status, package_id, package_version, currency, amount_total_minor, amount_tax_minor, credits_total, paid_at';

/** Slice 4b.2 (E-69): the most ids sent in one `.in()` filter. */
export const FINANCE_ID_CHUNK = 100;

/**
 * The reversal event columns R-n / R-n′ select (slice 4b.2, §11I.7). No Stripe
 * dispute id, no mode column (BD-14), no status around the step, no cumulative.
 */
export const FINANCE_REVERSAL_EVENT_COLUMNS = 'id, purchase_id, kind, amount_minor, currency, recorded_at';

/** The purchase columns an event needs (R-n's second read; R-n′'s first read). */
export const FINANCE_REVERSAL_PURCHASE_COLUMNS =
  'id, user_id, package_id, package_version, amount_total_minor, amount_tax_minor, paid_at';

/** The purchase columns R-l / R-l′ select (§11C.6). No Stripe id, no flag reason, no lot. */
export const FINANCE_BOOST_ATTENTION_COLUMNS =
  'id, user_id, status, currency, amount_total_minor, amount_refunded_minor, status_changed_at';

/** The opened-date columns of a dispute's opening event. */
const DISPUTE_OPENED_COLUMNS = 'id, purchase_id, recorded_at';

/** R-l / R-l′: the two statuses that need attention now (S4-FR-15). */
const ATTENTION_STATUSES = ['disputed', 'flagged_mismatch'] as const;

/** The purchase fields an event carries (null: the purchase was not found). */
export interface FinanceReversalPurchase {
  /** NULL: the account was deleted. */
  user_id: string | null;
  package_id: string | null;
  package_version: number | null;
  /** For the SA-Q74 note only (refunded plus lost above the total). */
  amount_total_minor: number | null;
  amount_tax_minor: number | null;
  /**
   * False: the purchase was never paid (a flagged purchase, FR-4B-8). A
   * boolean, not the date: the builders read no date (AC-88).
   */
  paid: boolean;
}

/** One reversal event, as R-n / R-n′ return it, with its purchase's fields. */
export interface FinanceBoostReversalRow {
  id: string;
  purchase_id: string;
  kind: string | null;
  amount_minor: number | null;
  currency: string | null;
  recorded_at: string | null;
  purchase: FinanceReversalPurchase | null;
}

/** One purchase that needs attention now (R-l / R-l′), plus its open dispute's opened date. */
export interface FinanceBoostAttentionRow {
  id: string;
  user_id: string | null;
  status: string | null;
  currency: string | null;
  amount_total_minor: number | null;
  amount_refunded_minor: number | null;
  status_changed_at: string | null;
  /** The latest `dispute_opened` event of a disputed purchase; null when none was found or the dates failed. */
  disputeOpenedAt: string | null;
}

export interface FinanceBoostAttentionResult {
  rows: FinanceBoostAttentionRow[];
  reachedCeiling: boolean;
  /** `failed`: the opened dates could not be read (for example, the events table is absent); the rows still stand. */
  openedDates: 'read' | 'failed';
}

/**
 * One boost purchase, as "Our revenue" reads it (slice 4a). The amounts are
 * INTEGER minor units, sent as JSON numbers; `credits_total` is NUMERIC, so a
 * number or a numeric string. No Stripe id, no receipt, no lot.
 */
export interface FinanceBoostPurchaseRow {
  id: string;
  /** NULL: the account was deleted (ON DELETE SET NULL). */
  user_id: string | null;
  status: string | null;
  package_id: string | null;
  package_version: number | null;
  currency: string | null;
  amount_total_minor: number | null;
  amount_tax_minor: number | null;
  credits_total: number | string | null;
  paid_at: string | null;
}

/**
 * The plan payment columns R-m / R-m′ select (slice 5a, §11D.6). No Stripe id,
 * no refusal reason, no plan_written, no mode column (BD-14, M2-FR-10) and no
 * created_at (never a revenue date, M2-W-1).
 */
export const FINANCE_PLAN_PAYMENT_COLUMNS =
  'id, user_id, kind, tier, amount_minor, amount_tax_minor, currency, period_start, period_end, paid_at';

/**
 * One paid plan invoice, as "Our revenue" reads it (slice 5a). The amounts are
 * INTEGER minor units, sent as JSON numbers; the caller still checks each one.
 */
export interface FinancePlanPaymentRow {
  id: string;
  /** NULL: a payment of a deleted account (ON DELETE SET NULL). */
  user_id: string | null;
  kind: string | null;
  /** The stored tier id, or NULL ("Unknown plan" on the page). */
  tier: string | null;
  /** Stripe's amount paid: tax INCLUDED. */
  amount_minor: number | null;
  amount_tax_minor: number | null;
  currency: string | null;
  period_start: string | null;
  period_end: string | null;
  /** Decides the window, in the query only. */
  paid_at: string | null;
}

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
 * One overdue (or past-due) client invoice or instalment, as the payment
 * problems block reads it. `amount` is NUMERIC (number or numeric string);
 * `due_date` is a SQL DATE, sent as `YYYY-MM-DD` text: the caller never passes
 * it through `new Date` (S2-F5).
 */
export interface FinanceClientDueRow {
  id: string;
  user_id: string | null;
  amount: number | string | null;
  currency: string | null;
  status: string | null;
  due_date: string | null;
}

/** One client plan (a business's client on a payment plan), as the block reads it. No amount. */
export interface FinanceClientPlanRow {
  id: string;
  user_id: string | null;
  status: string | null;
  cancelled_at: string | null;
  completed_at: string | null;
  next_charge_at: string | null;
  last_failure_at: string | null;
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

/** What the pager calls inside its `try`: checks its arguments, then returns the read's own filter. */
type ClientFilter = () => (query: ClientQuery) => ClientQuery;

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * SA-WR-25: today's UTC date as `YYYY-MM-DD`, and nothing else. The strict
 * pattern means only digits and dashes can reach the `.or()` filter text; the
 * round trip refuses a date that does not exist (2026-02-30).
 */
function isUtcDateOnly(value: unknown): value is string {
  if (typeof value !== 'string' || !DATE_ONLY.test(value)) return false;
  const ms = Date.parse(`${value}T00:00:00.000Z`);
  return !Number.isNaN(ms) && new Date(ms).toISOString().slice(0, 10) === value;
}

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
    super(`Billing rows reached the read ceiling of ${ceiling}`);
    this.name = 'FinanceReadCeilingError';
  }
}

/**
 * SA-WR-27 (BD-16): the all-accounts billing read met one account more than
 * once. One billing record per account is assumed, so a second row is
 * returned as an ERROR, never folded into a figure. Counts only, no id.
 */
export class FinanceReadDuplicateError extends Error {
  constructor(duplicateAccounts: number) {
    super(`Billing rows named ${duplicateAccounts} account(s) more than once; one row per account is assumed`);
    this.name = 'FinanceReadDuplicateError';
  }
}

/**
 * Slice 4b.2 (§7, SA-W121): the reversal events table does not exist yet
 * (migration 20261076 not applied). A deploy state, not a failure: logged at
 * warn, and the page shows the dated figures as Unknown.
 */
export class FinanceReadTableAbsentError extends Error {
  constructor() {
    super('The boost reversal events table is not available');
    this.name = 'FinanceReadTableAbsentError';
  }
}

/** 42P01: relation does not exist. PGRST205: PostgREST has no such table in its schema cache. */
const TABLE_ABSENT_CODES: ReadonlySet<string> = new Set(['42P01', 'PGRST205']);

function isTableAbsent(error: unknown): boolean {
  const code = typeof error === 'object' && error !== null ? (error as { code?: unknown }).code : undefined;
  return typeof code === 'string' && TABLE_ABSENT_CODES.has(code);
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
    } else if (error instanceof FinanceReadTableAbsentError) {
      this.logger.warn({ method, reason: 'table_absent' }, 'Finance read: the reversal events table is not available');
    } else {
      this.logger.error({ method, err: error }, 'Finance read failed');
    }
    return { data: null, error: error instanceof Error ? error : new Error(String(error)) };
  }

  /**
   * NOT WIRED since Finance R4 (2026-10-18): with a test row and a live row for
   * one account this read fails on the duplicate (P8A-R4). The finance wiring
   * now reads status for the current Stripe mode through
   * `lib/admin/billing/currentModeBillingStatus.ts`. Kept only as the
   * source of the deps type; removal is follow-up R4-FU-1.
   *
   * R-c. The billing status of EVERY account that has a billing row, test or
   * real mode (BD-14), keyset-paged on `user_id`. Rows detached from a deleted
   * account (`user_id` NULL) are skipped in the query: keyset paging cannot
   * step over NULLs, and an unattributable row cannot classify an account.
   *
   * Reaching the ceiling is an ERROR (`FinanceReadCeilingError`), never a
   * partial list. One row per account is assumed (BD-16): a `user_id` read
   * twice is an ERROR too (`FinanceReadDuplicateError`, SA-WR-27), never a
   * guess. Logged at info: it is a cross-account read.
   */
  async listBillingStatusesAllAccounts(opts?: {
    pageSize?: number;
    ceiling?: number;
  }): Promise<RepositoryResult<FinanceBillingStatusRow[]>> {
    const method = 'listBillingStatusesAllAccounts';
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

      // SA-WR-27. With `.gt('user_id', last)` paging a repeat is caught only
      // within one page. Residual (recorded in the workplan): a second row just
      // past a page boundary is skipped by `.gt` and not seen here.
      const accounts = new Set(rows.map((row) => row.user_id));
      if (accounts.size !== rows.length) throw new FinanceReadDuplicateError(rows.length - accounts.size);

      this.logger.info({ method, rows: rows.length, durationMs: Date.now() - startedAt }, 'Billing statuses of all accounts read');
      return { data: rows, error: null };
    } catch (error) {
      return this.fail(method, error);
    }
  }

  /**
   * NOT WIRED since Finance R4 (2026-10-18), for the same reason as R-c: with
   * two rows `maybeSingle` errors (P8A-R4). Kept only as the deps type source;
   * removal is follow-up R4-FU-1.
   *
   * R-c′. The billing status of ONE account, test or real mode (BD-14), or
   * `null` when it has no billing row. One row per account is assumed (BD-16):
   * with two, `maybeSingle` fails and the error is RETURNED, never thrown, so
   * the page shows its fallback instead of a figure.
   */
  async findBillingStatusForAccount(accountId: string): Promise<RepositoryResult<FinanceBillingStatusRow | null>> {
    const method = 'findBillingStatusForAccount';
    try {
      if (typeof accountId !== 'string' || !UUID_PATTERN.test(accountId)) {
        throw new FinanceReadGuardError('An account id (UUID) is required');
      }
      const { data, error } = await this.supabase
        .from('business_os_billing_accounts')
        .select(FINANCE_BILLING_STATUS_COLUMNS)
        .eq('user_id', accountId)
        .maybeSingle();
      if (error) throw error;

      const row = (data ?? null) as unknown as FinanceBillingStatusRow | null;
      this.logger.debug({ method, found: row !== null }, 'Billing status of one account read');
      return { data: row, error: null };
    } catch (error) {
      return this.fail(method, error);
    }
  }

  /**
   * R-d. Whether ANY revenue row exists, platform-wide, test or real mode
   * (BD-14): paid plan invoices and paid boost purchases. Two head counts —
   * no row, no account and no amount is read. A count PostgREST did not
   * return is an error, never a 0 (the page then says "Could not check").
   */
  async countRevenueRows(): Promise<RepositoryResult<FinanceRevenueCounts>> {
    const method = 'countRevenueRows';
    try {
      const [invoices, boosts] = await Promise.all([
        this.supabase
          .from('business_os_billing_events')
          .select('id', { count: 'exact', head: true })
          .eq('kind', 'invoice_paid'),
        this.supabase
          .from('business_os_boost_purchases')
          .select('id', { count: 'exact', head: true })
          .not('paid_at', 'is', null),
      ]);
      if (invoices.error) throw invoices.error;
      if (boosts.error) throw boosts.error;
      if (typeof invoices.count !== 'number' || typeof boosts.count !== 'number') {
        throw new Error('A revenue head count came back without a count');
      }

      const counts = { planInvoicesPaid: invoices.count, boostsPaid: boosts.count };
      this.logger.info({ method, ...counts }, 'Revenue rows counted');
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
      this.rangeFilter('paid_at', range),
      'Client payment rows',
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
      this.rangeFilter('paid_at', range),
      'Client payment rows',
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
      this.rangeFilter('created_at', range),
      'Client refund rows',
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
      this.rangeFilter('created_at', range),
      'Client refund rows',
      { accountId },
      opts
    );
  }

  /**
   * R-g. Every account's OVERDUE client invoices, as of today's UTC date: the
   * ones marked `overdue`, and the `sent` ones whose due date is before today
   * (S2-FR-17). The status literals are fixed text here, and `todayUtc` is
   * checked as a strict `YYYY-MM-DD` before it joins the filter (SA-Q15,
   * SA-WR-25). No mode filter (BD-13). Logged at info.
   */
  async listOverdueClientInvoicesAllAccounts(
    todayUtc: string,
    opts?: FinanceClientReadOptions
  ): Promise<RepositoryResult<FinanceClientReadResult<FinanceClientDueRow>>> {
    return this.pageClientRows<FinanceClientDueRow>(
      'listOverdueClientInvoicesAllAccounts',
      () => this.supabase.from('payment_invoices').select(FINANCE_CLIENT_INVOICE_DUE_COLUMNS),
      this.overdueFilter((today) => `status.eq.overdue,and(status.eq.sent,due_date.lt.${today})`, todayUtc),
      'Overdue client invoice rows',
      null,
      opts
    );
  }

  /** R-g′. ONE account's overdue client invoices; the id is checked before any query. */
  async listOverdueClientInvoicesForAccount(
    accountId: string,
    todayUtc: string,
    opts?: FinanceClientReadOptions
  ): Promise<RepositoryResult<FinanceClientReadResult<FinanceClientDueRow>>> {
    return this.pageClientRows<FinanceClientDueRow>(
      'listOverdueClientInvoicesForAccount',
      () => this.supabase.from('payment_invoices').select(FINANCE_CLIENT_INVOICE_DUE_COLUMNS),
      this.overdueFilter((today) => `status.eq.overdue,and(status.eq.sent,due_date.lt.${today})`, todayUtc),
      'Overdue client invoice rows',
      { accountId },
      opts
    );
  }

  /**
   * R-h. Every account's OVERDUE plan instalments, as of today's UTC date: the
   * ones marked `overdue`, and the `pending` ones due before today
   * (S2-FR-18). Same rules as R-g. Logged at info.
   */
  async listOverdueClientInstalmentsAllAccounts(
    todayUtc: string,
    opts?: FinanceClientReadOptions
  ): Promise<RepositoryResult<FinanceClientReadResult<FinanceClientDueRow>>> {
    return this.pageClientRows<FinanceClientDueRow>(
      'listOverdueClientInstalmentsAllAccounts',
      () => this.supabase.from('payment_plan_installments').select(FINANCE_CLIENT_INSTALMENT_DUE_COLUMNS),
      this.overdueFilter((today) => `status.eq.overdue,and(status.eq.pending,due_date.lt.${today})`, todayUtc),
      'Overdue client instalment rows',
      null,
      opts
    );
  }

  /** R-h′. ONE account's overdue plan instalments; the id is checked before any query. */
  async listOverdueClientInstalmentsForAccount(
    accountId: string,
    todayUtc: string,
    opts?: FinanceClientReadOptions
  ): Promise<RepositoryResult<FinanceClientReadResult<FinanceClientDueRow>>> {
    return this.pageClientRows<FinanceClientDueRow>(
      'listOverdueClientInstalmentsForAccount',
      () => this.supabase.from('payment_plan_installments').select(FINANCE_CLIENT_INSTALMENT_DUE_COLUMNS),
      this.overdueFilter((today) => `status.eq.overdue,and(status.eq.pending,due_date.lt.${today})`, todayUtc),
      'Overdue client instalment rows',
      { accountId },
      opts
    );
  }

  /**
   * R-i. Every account's client plans, every status, no filter (S2-FR-19):
   * the caller counts them by status, by the window and by now. Logged at info.
   */
  async listClientPlansAllAccounts(
    opts?: FinanceClientReadOptions
  ): Promise<RepositoryResult<FinanceClientReadResult<FinanceClientPlanRow>>> {
    return this.pageClientRows<FinanceClientPlanRow>(
      'listClientPlansAllAccounts',
      () => this.supabase.from('payment_plan_subscriptions').select(FINANCE_CLIENT_PLAN_COLUMNS),
      () => (query) => query,
      'Client plan rows',
      null,
      opts
    );
  }

  /** R-i′. ONE account's client plans; the id is checked before any query. */
  async listClientPlansForAccount(
    accountId: string,
    opts?: FinanceClientReadOptions
  ): Promise<RepositoryResult<FinanceClientReadResult<FinanceClientPlanRow>>> {
    return this.pageClientRows<FinanceClientPlanRow>(
      'listClientPlansForAccount',
      () => this.supabase.from('payment_plan_subscriptions').select(FINANCE_CLIENT_PLAN_COLUMNS),
      () => (query) => query,
      'Client plan rows',
      { accountId },
      opts
    );
  }

  /**
   * R-k. Every account's credit boost purchases PAID in the range (slice 4a),
   * test or real mode (BD-14), keyset on `id`. Every status is read: the caller
   * applies the paid family and counts the others (S4-W-2). Rows of deleted
   * accounts (`user_id` NULL) are included. Logged at info.
   */
  async listBoostPurchasesAllAccountsPaidInRange(
    range: FinanceClientRange,
    opts?: FinanceClientReadOptions
  ): Promise<RepositoryResult<FinanceClientReadResult<FinanceBoostPurchaseRow>>> {
    return this.pageClientRows<FinanceBoostPurchaseRow>(
      'listBoostPurchasesAllAccountsPaidInRange',
      () => this.supabase.from('business_os_boost_purchases').select(FINANCE_BOOST_PURCHASE_COLUMNS),
      this.rangeFilter('paid_at', range),
      'Boost purchase rows',
      null,
      opts
    );
  }

  /** R-k′. ONE account's credit boost purchases paid in the range; the id is checked before any query. */
  async listBoostPurchasesForAccountPaidInRange(
    accountId: string,
    range: FinanceClientRange,
    opts?: FinanceClientReadOptions
  ): Promise<RepositoryResult<FinanceClientReadResult<FinanceBoostPurchaseRow>>> {
    return this.pageClientRows<FinanceBoostPurchaseRow>(
      'listBoostPurchasesForAccountPaidInRange',
      () => this.supabase.from('business_os_boost_purchases').select(FINANCE_BOOST_PURCHASE_COLUMNS),
      this.rangeFilter('paid_at', range),
      'Boost purchase rows',
      { accountId },
      opts
    );
  }

  /**
   * R-m. Every account's PAID plan invoices in the range (slice 5a, §11D.6),
   * test or real mode (BD-14), keyset on `id`: `kind = invoice_paid` and
   * `from <= paid_at < to` on every page (M2-W-1, M2-W-2), so a refused or any
   * other kind is never read (DF-7). Rows of deleted accounts (`user_id` NULL)
   * are included. Logged at info.
   */
  async listPlanPaymentsAllAccountsPaidInRange(
    range: FinanceClientRange,
    opts?: FinanceClientReadOptions
  ): Promise<RepositoryResult<FinanceClientReadResult<FinancePlanPaymentRow>>> {
    return this.pageClientRows<FinancePlanPaymentRow>(
      'listPlanPaymentsAllAccountsPaidInRange',
      () => this.supabase.from('business_os_billing_events').select(FINANCE_PLAN_PAYMENT_COLUMNS),
      this.paidInvoiceFilter(range),
      'Plan payment rows',
      null,
      opts
    );
  }

  /** R-m′. ONE account's paid plan invoices in the range; the id is checked before any query. */
  async listPlanPaymentsForAccountPaidInRange(
    accountId: string,
    range: FinanceClientRange,
    opts?: FinanceClientReadOptions
  ): Promise<RepositoryResult<FinanceClientReadResult<FinancePlanPaymentRow>>> {
    return this.pageClientRows<FinancePlanPaymentRow>(
      'listPlanPaymentsForAccountPaidInRange',
      () => this.supabase.from('business_os_billing_events').select(FINANCE_PLAN_PAYMENT_COLUMNS),
      this.paidInvoiceFilter(range),
      'Plan payment rows',
      { accountId },
      opts
    );
  }

  /** R-m / R-m′: kind invoice_paid AND paid_at in the half-open range, on every page. */
  private paidInvoiceFilter(range: FinanceClientRange): ClientFilter {
    const inRange = this.rangeFilter('paid_at', range);
    return () => {
      // Refuses a bad range before any query (inside the pager's try).
      const applyRange = inRange();
      return (query) => applyRange(query.eq('kind', 'invoice_paid'));
    };
  }

  /** R-e to R-f′, R-k to R-n′: a valid half-open range on the read's own column, as ISO strings. Checked inside the pager. */
  private rangeFilter(dateColumn: 'paid_at' | 'created_at' | 'recorded_at', range: FinanceClientRange): ClientFilter {
    return () => {
      const isValidDate = (d: unknown): d is Date => d instanceof Date && !Number.isNaN(d.getTime());
      if (!range || !isValidDate(range.from) || !isValidDate(range.to) || range.from.getTime() >= range.to.getTime()) {
        throw new FinanceReadGuardError('A valid range with from before to is required');
      }
      const from = range.from.toISOString();
      const to = range.to.toISOString();
      return (query) => query.gte(dateColumn, from).lt(dateColumn, to);
    };
  }

  /**
   * R-g / R-h: one `.or()` on a SELECT, built from the caller's fixed status
   * literals and today's UTC date, which must be a strict, real `YYYY-MM-DD`
   * (SA-Q15, SA-WR-25). Anything else is refused before any query.
   */
  private overdueFilter(build: (today: string) => string, todayUtc: string): ClientFilter {
    return () => {
      if (!isUtcDateOnly(todayUtc)) {
        throw new FinanceReadGuardError('todayUtc must be a real UTC date written YYYY-MM-DD');
      }
      const filter = build(todayUtc);
      return (query) => query.or(filter);
    };
  }

  /**
   * The paging shared by R-e to R-i′ (SA-W28) and R-k / R-k′ (SA-W49). Each caller passes its
   * own `.from('<literal table>')`, so the source guard can list every table
   * this file reads, and its own filter. The account id, then the read's own
   * arguments (`prepare`, called inside the `try`, so a refusal is
   * `{ data: null, error }` and never a throw), then the options are checked
   * BEFORE the first query. Then pages by keyset on `id` (`.gt` as its own
   * filter), stopping on a short page, or at the ceiling (`>=`), where the
   * rows read are returned with `reachedCeiling: true`, never an error.
   */
  private async pageClientRows<T extends { id: string }>(
    method: string,
    start: () => ClientQuery,
    prepare: ClientFilter,
    noun: string,
    scope: { accountId: string } | null,
    opts?: FinanceClientReadOptions
  ): Promise<RepositoryResult<FinanceClientReadResult<T>>> {
    const startedAt = Date.now();
    try {
      if (scope !== null && (typeof scope.accountId !== 'string' || !UUID_PATTERN.test(scope.accountId))) {
        throw new FinanceReadGuardError('An account id (UUID) is required');
      }
      const filter = prepare();
      const { pageSize, ceiling } = this.limitsOf(opts);
      const { rows, reachedCeiling } = await this.collect<T>(start, filter, scope?.accountId ?? null, pageSize, ceiling);

      // Counts and timing only: never an amount, a currency, a date or an id.
      if (scope === null) {
        this.logger.info(
          { method, rows: rows.length, reachedCeiling, durationMs: Date.now() - startedAt },
          `${noun} of all accounts read`
        );
      } else {
        this.logger.debug({ method, rows: rows.length, reachedCeiling }, `${noun} of one account read`);
      }
      return { data: { rows, reachedCeiling }, error: null };
    } catch (error) {
      return this.fail(method, error);
    }
  }

  /** The page size and ceiling of a layer-B read, checked (a refusal is a guard error). */
  private limitsOf(opts?: FinanceClientReadOptions): { pageSize: number; ceiling: number } {
    const pageSize = opts?.pageSize ?? FINANCE_READ_LIMITS.CLIENT_PAGE_SIZE;
    const ceiling = opts?.ceiling ?? FINANCE_READ_LIMITS.CLIENT_CEILING;
    if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > FINANCE_READ_LIMITS.CLIENT_PAGE_SIZE) {
      throw new FinanceReadGuardError(`pageSize must be an integer from 1 to ${FINANCE_READ_LIMITS.CLIENT_PAGE_SIZE}`);
    }
    if (!Number.isInteger(ceiling) || ceiling < 1 || ceiling > FINANCE_READ_LIMITS.CLIENT_CEILING) {
      throw new FinanceReadGuardError(`ceiling must be an integer from 1 to ${FINANCE_READ_LIMITS.CLIENT_CEILING}`);
    }
    return { pageSize, ceiling };
  }

  /**
   * The keyset loop itself (no logging): `.gt('id', last)`, ascending, at most
   * `pageSize` (<= 1,000) per request, until a short page or the ceiling (`>=`).
   * `accountId` puts `.eq('user_id')` on EVERY page. Throws the query error.
   */
  private async collect<T extends { id: string }>(
    start: () => ClientQuery,
    filter: (query: ClientQuery) => ClientQuery,
    accountId: string | null,
    pageSize: number,
    ceiling: number
  ): Promise<FinanceClientReadResult<T>> {
    const rows: T[] = [];
    let reachedCeiling = false;
    let last: string | null = null;
    for (;;) {
      const size = Math.min(pageSize, ceiling - rows.length);
      let query = filter(start());
      if (accountId !== null) query = query.eq('user_id', accountId);
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
    return { rows, reachedCeiling };
  }

  /**
   * Slice 4b.2 (E-69, 4B2-R1): `.in(column, chunk)` with at most
   * `FINANCE_ID_CHUNK` ids per chunk, and EACH chunk keyset-paged at
   * `pageSize` like any other read. The ceiling is shared across the chunks.
   * The ids are always ones this file just read, never a caller's.
   */
  private async collectByIdChunks<T extends { id: string }>(
    start: () => ClientQuery,
    column: 'id' | 'purchase_id',
    ids: readonly string[],
    filter: (query: ClientQuery) => ClientQuery,
    pageSize: number,
    ceiling: number
  ): Promise<FinanceClientReadResult<T>> {
    const rows: T[] = [];
    for (let i = 0; i < ids.length; i += FINANCE_ID_CHUNK) {
      const chunk = ids.slice(i, i + FINANCE_ID_CHUNK);
      const part = await this.collect<T>(start, (query) => filter(query.in(column, chunk)), null, pageSize, ceiling - rows.length);
      rows.push(...part.rows);
      if (part.reachedCeiling) return { rows, reachedCeiling: true };
    }
    return { rows, reachedCeiling: false };
  }

  /** Runs a read of the events table; its "no such table" error becomes the typed absent error (§7). */
  private async eventsRead<T>(read: () => Promise<T>): Promise<T> {
    try {
      return await read();
    } catch (error) {
      if (isTableAbsent(error)) throw new FinanceReadTableAbsentError();
      throw error;
    }
  }

  /**
   * R-n. Every account's boost reversal events RECORDED in the range (slice
   * 4b.2, BD-17), every kind, keyset on `id`, then their purchases by id in
   * chunks of 100 (E-69). An event whose purchase is not found carries
   * `purchase: null`. Logged at info: counts and timing only.
   */
  async listBoostReversalEventsAllAccountsRecordedInRange(
    range: FinanceClientRange,
    opts?: FinanceClientReadOptions
  ): Promise<RepositoryResult<FinanceClientReadResult<FinanceBoostReversalRow>>> {
    const method = 'listBoostReversalEventsAllAccountsRecordedInRange';
    const startedAt = Date.now();
    try {
      const inRange = this.rangeFilter('recorded_at', range)();
      const { pageSize, ceiling } = this.limitsOf(opts);
      const events = await this.eventsRead(() =>
        this.collect<ReversalEventRaw>(
          () => this.supabase.from('business_os_boost_reversal_events').select(FINANCE_REVERSAL_EVENT_COLUMNS),
          inRange,
          null,
          pageSize,
          ceiling
        )
      );
      const purchaseIds = [...new Set(events.rows.map((event) => event.purchase_id))];
      const purchases = await this.collectByIdChunks<ReversalPurchaseRaw>(
        () => this.supabase.from('business_os_boost_purchases').select(FINANCE_REVERSAL_PURCHASE_COLUMNS),
        'id',
        purchaseIds,
        (query) => query,
        pageSize,
        FINANCE_READ_LIMITS.CLIENT_CEILING
      );
      const byId = new Map(purchases.rows.map((purchase) => [purchase.id, purchase]));
      const rows = events.rows.map((event) => withPurchase(event, byId.get(event.purchase_id) ?? null));

      this.logger.info(
        {
          method,
          rows: rows.length,
          purchases: byId.size,
          reachedCeiling: events.reachedCeiling,
          durationMs: Date.now() - startedAt,
        },
        'Boost reversal events of all accounts read'
      );
      return { data: { rows, reachedCeiling: events.reachedCeiling }, error: null };
    } catch (error) {
      return this.fail(method, error);
    }
  }

  /**
   * R-n′. ONE account's boost reversal events recorded in the range. The id is
   * checked before any query; the account's purchases are read first
   * (`.eq('user_id')` on every page, every status), then only the events of
   * those purchases (chunks of 100), and any event outside that set is
   * dropped (fail closed, 4B2-R2).
   */
  async listBoostReversalEventsForAccountRecordedInRange(
    accountId: string,
    range: FinanceClientRange,
    opts?: FinanceClientReadOptions
  ): Promise<RepositoryResult<FinanceClientReadResult<FinanceBoostReversalRow>>> {
    const method = 'listBoostReversalEventsForAccountRecordedInRange';
    try {
      if (typeof accountId !== 'string' || !UUID_PATTERN.test(accountId)) {
        throw new FinanceReadGuardError('An account id (UUID) is required');
      }
      const inRange = this.rangeFilter('recorded_at', range)();
      const { pageSize, ceiling } = this.limitsOf(opts);
      const purchases = await this.collect<ReversalPurchaseRaw>(
        () => this.supabase.from('business_os_boost_purchases').select(FINANCE_REVERSAL_PURCHASE_COLUMNS),
        (query) => query,
        accountId,
        pageSize,
        ceiling
      );
      const owned = new Map(purchases.rows.map((purchase) => [purchase.id, purchase]));
      const events = await this.eventsRead(() =>
        this.collectByIdChunks<ReversalEventRaw>(
          () => this.supabase.from('business_os_boost_reversal_events').select(FINANCE_REVERSAL_EVENT_COLUMNS),
          'purchase_id',
          [...owned.keys()],
          inRange,
          pageSize,
          ceiling
        )
      );
      const kept = events.rows.filter((event) => owned.has(event.purchase_id));
      const rows = kept.map((event) => withPurchase(event, owned.get(event.purchase_id) ?? null));
      const reachedCeiling = purchases.reachedCeiling || events.reachedCeiling;

      this.logger.debug(
        { method, rows: rows.length, purchases: owned.size, dropped: events.rows.length - kept.length, reachedCeiling },
        'Boost reversal events of one account read'
      );
      return { data: { rows, reachedCeiling }, error: null };
    } catch (error) {
      return this.fail(method, error);
    }
  }

  /**
   * R-l. Every account's boost purchases that need attention NOW (slice 4b.2,
   * S4-FR-15): status disputed or flagged_mismatch, keyset on `id`; then each
   * disputed purchase's latest `dispute_opened` event (chunks of 100). The
   * opened dates failing never fails the read (`openedDates: 'failed'`), so
   * the K-5 rule still counts the disputes. Logged at info.
   */
  async listBoostPurchasesNeedingAttentionAllAccounts(
    opts?: FinanceClientReadOptions
  ): Promise<RepositoryResult<FinanceBoostAttentionResult>> {
    return this.readAttention('listBoostPurchasesNeedingAttentionAllAccounts', null, opts);
  }

  /** R-l′. ONE account's boost purchases that need attention now; the id is checked before any query. */
  async listBoostPurchasesNeedingAttentionForAccount(
    accountId: string,
    opts?: FinanceClientReadOptions
  ): Promise<RepositoryResult<FinanceBoostAttentionResult>> {
    return this.readAttention('listBoostPurchasesNeedingAttentionForAccount', accountId, opts);
  }

  private async readAttention(
    method: string,
    accountId: string | null,
    opts?: FinanceClientReadOptions
  ): Promise<RepositoryResult<FinanceBoostAttentionResult>> {
    const startedAt = Date.now();
    try {
      if (accountId !== null && (typeof accountId !== 'string' || !UUID_PATTERN.test(accountId))) {
        throw new FinanceReadGuardError('An account id (UUID) is required');
      }
      const { pageSize, ceiling } = this.limitsOf(opts);
      const purchases = await this.collect<AttentionRaw>(
        () => this.supabase.from('business_os_boost_purchases').select(FINANCE_BOOST_ATTENTION_COLUMNS),
        (query) => query.in('status', [...ATTENTION_STATUSES]),
        accountId,
        pageSize,
        ceiling
      );

      const disputedIds = purchases.rows.filter((row) => row.status === ATTENTION_STATUSES[0]).map((row) => row.id);
      const openedAt = new Map<string, string>();
      let openedDates: FinanceBoostAttentionResult['openedDates'] = 'read';
      try {
        const opened = await this.eventsRead(() =>
          this.collectByIdChunks<OpenedRaw>(
            () => this.supabase.from('business_os_boost_reversal_events').select(DISPUTE_OPENED_COLUMNS),
            'purchase_id',
            disputedIds,
            (query) => query.eq('kind', 'dispute_opened'),
            pageSize,
            FINANCE_READ_LIMITS.CLIENT_CEILING
          )
        );
        if (opened.reachedCeiling) openedDates = 'failed';
        for (const event of opened.rows) {
          const previous = openedAt.get(event.purchase_id);
          if (typeof event.recorded_at === 'string' && (previous === undefined || event.recorded_at > previous)) {
            openedAt.set(event.purchase_id, event.recorded_at);
          }
        }
      } catch (error) {
        openedDates = 'failed';
        if (error instanceof FinanceReadTableAbsentError) {
          this.logger.warn({ method, reason: 'table_absent' }, 'Finance read: dispute opened dates are not available');
        } else {
          this.logger.error({ method, err: error }, 'Finance read: dispute opened dates failed');
        }
      }

      const rows: FinanceBoostAttentionRow[] = purchases.rows.map((row) => ({
        id: row.id,
        user_id: row.user_id,
        status: row.status,
        currency: row.currency,
        amount_total_minor: row.amount_total_minor,
        amount_refunded_minor: row.amount_refunded_minor,
        status_changed_at: row.status_changed_at,
        disputeOpenedAt: openedDates === 'read' ? openedAt.get(row.id) ?? null : null,
      }));

      // Counts and timing only: never an amount, a currency, a date or an id.
      const ctx = { method, rows: rows.length, reachedCeiling: purchases.reachedCeiling, openedDates };
      if (accountId === null) {
        this.logger.info({ ...ctx, durationMs: Date.now() - startedAt }, 'Boost purchases needing attention of all accounts read');
      } else {
        this.logger.debug(ctx, 'Boost purchases needing attention of one account read');
      }
      return { data: { rows, reachedCeiling: purchases.reachedCeiling, openedDates }, error: null };
    } catch (error) {
      return this.fail(method, error);
    }
  }
}

/** Raw rows of the 4b.2 reads, before the purchase is attached. */
type ReversalEventRaw = Omit<FinanceBoostReversalRow, 'purchase'>;
type ReversalPurchaseRaw = Omit<FinanceReversalPurchase, 'paid'> & { id: string; paid_at: string | null };
type AttentionRaw = Omit<FinanceBoostAttentionRow, 'disputeOpenedAt'>;
type OpenedRaw = { id: string; purchase_id: string; recorded_at: string | null };

/** Field by field: only the §11I.7 columns cross, never a spread of the raw row. */
function withPurchase(event: ReversalEventRaw, purchase: ReversalPurchaseRaw | null): FinanceBoostReversalRow {
  return {
    id: event.id,
    purchase_id: event.purchase_id,
    kind: event.kind,
    amount_minor: event.amount_minor,
    currency: event.currency,
    recorded_at: event.recorded_at,
    purchase:
      purchase === null
        ? null
        : {
            user_id: purchase.user_id,
            package_id: purchase.package_id,
            package_version: purchase.package_version,
            amount_total_minor: purchase.amount_total_minor,
            amount_tax_minor: purchase.amount_tax_minor,
            paid: purchase.paid_at !== null,
          },
  };
}

/** Singleton for convenience, matching the rest of the repository layer. */
export const businessOsFinanceReadRepository = new BusinessOsFinanceReadRepository();
