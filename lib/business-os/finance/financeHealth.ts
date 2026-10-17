/**
 * The admin finance & business health page's builder (slices 1a, 1b, 2a, 2b
 * and 4a). Workplans docs/workplans/BUSINESS_OS_FINANCE_HEALTH_SLICE_1A_WORKPLAN.md,
 * docs/workplans/BUSINESS_OS_FINANCE_HEALTH_SLICE_1B_WORKPLAN.md,
 * docs/workplans/BUSINESS_OS_FINANCE_HEALTH_SLICE_2A_WORKPLAN.md,
 * docs/workplans/BUSINESS_OS_FINANCE_HEALTH_SLICE_2B_WORKPLAN.md,
 * docs/workplans/BUSINESS_OS_FINANCE_HEALTH_SLICE_4A_WORKPLAN.md and
 * docs/workplans/BUSINESS_OS_FINANCE_HEALTH_SLICE_5A_MONEY_M1_M2_WORKPLAN.md.
 *
 * ONE ORCHESTRATOR, SETTLED SECTIONS (SA-Q8). Every independent read starts at
 * once through `settle`, so a read that throws becomes `{ error }` and never
 * rejects. Each section derives its own status (`ok` / `partial` / `unknown`)
 * from its own reads: one failing read never fails another section, and never
 * makes the request a 500.
 *
 * ACCOUNT SCOPE (SEC-3, SA-W1, tenant-isolation-guard). The only caller-
 * supplied id is `accountId`, already validated as a UUID by the route. When
 * it is present:
 *   1. it is checked FIRST against the plan table (no row → `account_not_found`,
 *      a failed read → `account_check_failed`), before any other read;
 *   2. every account-scoped read then receives exactly that id;
 *   3. NO all-accounts method is called (`pagePlans`, the all-accounts ledger
 *      read, the all-accounts billing read, the all-accounts lot read, since
 *      slice 2a the all-accounts client payment and refund reads, and since
 *      slice 2b the all-accounts overdue and client plan reads and the
 *      platform-wide reminder queue read, since slice 4a the all-accounts
 *      boost purchase read, and since slice 5a the all-accounts plan payment
 *      read, and since M-4 the all-accounts usage-log cost read). The
 *      platform-wide revenue head count is not called with a
 *      business picked either (SA-Q35, slice 5a): the picked view makes no
 *      platform-wide read at all.
 * Slice 1c (BD-14, BD-15, BD-16): the billing and revenue reads count test
 * and real rows together; a paying Founding Partner is grouped by its paid
 * tier; one billing row per account is assumed, and two make the paying read
 * fail (Section 1 then shows "Tier set"), never a guessed group.
 * Business names are looked up only for ids taken from rows already read
 * (ledger rows for Section 3, plan rows for Section 4, client payment and
 * refund rows for the takings block, overdue rows for the payment problems
 * block).
 *
 * TAKINGS (slice 2a, Section 2 block B). The client payment and refund reads
 * run beside every other read, settled on their own. The pure `buildTakings`
 * does the money maths (integer hundredths per currency, never across
 * currencies); this file only adds the names of the rows shown. A failed
 * payments read makes the block unknown and touches no other section.
 *
 * CLIENT PAYMENT PROBLEMS (slice 2b, Section 6 block B). The overdue invoice,
 * overdue instalment and client plan reads run beside every other read,
 * settled on their own, as of today's UTC date (computed once from `now`).
 * The reminder figures come from the injected `readReminderFigures` (the
 * route binds the jobs & queues read, SA-Q14) under an explicit 2 s deadline
 * inside the same `Promise.all`, and only when no business is picked. The
 * pure `paymentProblems.ts` does the counting; this file adds the names of
 * the rows shown. Each part has its own status; the block is never unknown.
 *
 * OUR REVENUE (slice 4a). The boost purchases paid in the window run beside
 * every other read, settled on their own (R-k, or R-k′ with exactly the picked
 * id). The pure `buildBoostRevenue` does the money maths (integer minor units
 * per currency, never across currencies) and gives K-5 its money, so the tile
 * and the section show the same figure from the same read (SA-Q25). No names
 * are looked up for boosts: the block shows no business.
 *
 * OUR REVENUE, PLANS (slice 5a, §11D.4). The paid plan invoices in the window
 * run beside every other read, settled on their own (R-m, or R-m′ with exactly
 * the picked id). The pure `buildPlanRevenue` does the money maths (integer
 * minor units per currency, tax included, never across currencies); the plan's
 * label comes from a callback built here from the config this file is given,
 * so no file adds an entitlements import (SA-W65). Names are looked up for the
 * shown by-business rows only, with all businesses (SA-W73). The pure
 * `combineOurRevenue` adds boost net and plans received WITHIN one currency
 * only (SA-Q40, E-34): K-5 and the summary's "Paid us, total" both come from
 * it. R-d (`countRevenueRows`) still sets `state` with all businesses and is
 * NOT called with a business picked (SA-Q35, E-36). The section is unknown only
 * when the boosts AND the plans reads failed (SA-W62).
 *
 * SECTION 4, CREDITS (slice 1b). The credit-position pass starts as soon as the
 * plan walk has its account list, beside the ledger reads; a failed or capped
 * walk runs NO pass (AC-37, SA-W11). The pass's failure makes the section
 * unknown and K-2 unavailable, but K-4 depends only on the lots read and still
 * shows (SA-W12). The lots arrive already narrowed by the wiring (SA-W14): no
 * admin-written text reaches this file.
 *
 * The plan read's override rows (admin `reason` text) never reach this file:
 * the wiring maps the result to `{ plan }` (SA-WR-1), and the dep's type has
 * no room for them.
 *
 * ACCOUNT ECONOMICS (slice 6a, Money M-3, §11E). NO NEW READ and no change to
 * the one `Promise.all`: the pure `buildAccountEconomics` groups the rows this
 * file already holds (R-a through the Section 3 pass's non-wire `units` map,
 * R-k, R-m, the plan walk and Section 4's rows before their cap). It runs ONLY
 * with `accountsTab` and no business picked (SA-Q42); then ONE more names call,
 * for the shown rows only (at most 200 ids, never a platform id). With a
 * business picked, `buildAccountMargin` runs on R-a′ / R-k′ / R-m′ for the
 * summary's margin line (M3-FR-8), with no names call. Without the tab and
 * with no business picked, neither runs and the payload is unchanged (AC-145).
 *
 * RECORDED AI COST (Money M-4, OV-5, §11F). The usage log is reached ONLY
 * through the two route-injected functions, `readRecordedAllAccounts` (no
 * business picked) and `readRecordedForAccount` (exactly the picked, checked
 * id): this file names no usage-log reader. One more entry in the one
 * `Promise.all`, under `RECORDED_DEADLINE_MS`; the account read takes no
 * signal, so it is raced only and a late result is dropped (E-57). On the
 * Accounts tab neither is called and `aiCost.recorded` is absent (AC-167).
 * The pure `buildRecordedAiCost` decides exactness and the difference; this
 * file hands it Section 3's integer units and never adds the two measures.
 *
 * READ-ONLY: no write, no LLM call, no audit entry. Logs read failures only,
 * with the read's name: never a figure, a name or an account id.
 *
 * @module lib/business-os/finance/financeHealth
 */

import type { BusinessOsAccountPlan, BusinessOsAccountPlanRepository } from '@/lib/repositories/BusinessOsAccountPlanRepository';
import type {
  BusinessOsCreditLedgerReadRepository,
  CreditLedgerPagedResult,
  CreditLedgerRow,
  CreditPeriodStartRange,
} from '@/lib/repositories/BusinessOsCreditLedgerReadRepository';
import type {
  BusinessOsFinanceReadRepository,
  FinanceBillingStatusRow,
  FinanceRevenueCounts,
} from '@/lib/repositories/BusinessOsFinanceReadRepository';
import { cutoverClamp, settle } from '@/lib/business-os/credits/aiActivity';
import { ReadDeadlineError, underDeadline, type DeadlineRead, type ReadTiming } from '@/lib/admin/readUnderDeadline';
import { todayUtc } from '@/app/admin/components/adminWindowPresets';
import { CREDIT_REPORT_LIMITS } from '@/lib/business-os/credits/creditReport';
import { isPayingBillingRow } from '@/lib/business-os/billing/payingSubscriptionStatuses';
import { missingOriginalIds, sumCostUsd, summariseAiCost } from './aiCost';
import { readAdminCreditPositions, type AdminCreditPercentDeps, type AdminCreditPositionsPass } from '@/lib/business-os/credits/adminCreditPercent';
import { buildCreditsSection, type FinanceLot } from './creditsSection';
import { buildTakings } from './takings';
import { buildBoostRevenue } from './boostRevenue';
import { buildPlanRevenue } from './planRevenue';
import { combineOurRevenue } from './ourRevenue';
import { buildAccountEconomics, buildAccountMargin } from './accountEconomics';
import { buildRecordedAiCost, type RecordedReadInput, type RecordedRowInput } from './recordedCost';
import type { AiCostUnits } from './aiCost';
import {
  buildClientPlans,
  buildOverdue,
  mapReminderFigures,
  paymentProblemsStatus,
  type FinanceReminderFiguresInput,
  type OverdueBuilt,
} from './paymentProblems';
import {
  colourFarOverAllowanceTile,
  colourFinanceTile,
  farOverAllowancePercentOf,
  FEE_ESTIMATE_CURRENCY,
  FINANCE_METRIC_PARAMS,
  FINANCE_RULES,
  K4_INFORMATION_HEADLINE,
  STRIPE_FEE_ESTIMATE,
  stripeFeeEntryOf,
  type FinanceMeasurement,
  type FinanceRuleSet,
} from './financeRules';
import { isEmptySpan, k1Spans, type FinanceSpan, type ResolvedFinanceWindow } from './financeWindow';
import { classifyAccounts, tierLabelForGroup, type ClassifyInput } from './planGroups';
import type {
  FinanceAccountEconomicsSection,
  FinanceAccountMargin,
  FinanceAccountsSection,
  FinanceAccountsTabQuery,
  FinanceAiCostSection,
  FinanceCreditRow,
  FinanceCreditsSection,
  FinanceDuePart,
  FinanceDueRow,
  FinanceGroupKey,
  FinancePaymentProblemsSection,
  FinancePayload,
  FinancePlanAccountRow,
  FinanceRevenueSection,
  FinanceTakingsRow,
  FinanceTakingsSection,
  FinanceTile,
  FinanceTopAccount,
} from './financeTypes';

type RepoResult<T> = { data: T | null; error: Error | null };

/** The takings table's displayed-rows limit, shared by the plans by-business table (SA-W72). */
const TABLE_ROWS_SHOWN = 200;

export const FINANCE_LIMITS = {
  LEDGER_PAGE_SIZE: 1000,
  LEDGER_CEILING: 20_000,
  /** The shadow report's own page size and cap (SA-Q3). */
  PLAN_PAGE_SIZE: 500,
  PLAN_CEILING: 20_000,
  ORIGINALS_MAX: CREDIT_REPORT_LIMITS.ORIGINALS_MAX,
  ORIGINALS_PER_REQUEST: CREDIT_REPORT_LIMITS.ORIGINALS_PER_REQUEST,
  /** Section 4 rows shown (SA-W15): one names request (the identity read's 200-id chunk). Counts cover every account. */
  CREDIT_ROWS_SHOWN: 200,
  /** Takings rows shown (S2-FR-7): one names request. Every figure above the table covers every row. */
  TAKINGS_ROWS_SHOWN: TABLE_ROWS_SHOWN,
  /** Plans by business (slice 5a, M2-FR-2, SA-W72): the takings table's limit; one names request. */
  PLAN_ACCOUNTS_SHOWN: TABLE_ROWS_SHOWN,
  /** The Accounts tab (slice 6a, M3-FR-6): the takings table's limit; one names request. */
  ACCOUNT_ROWS_SHOWN: TABLE_ROWS_SHOWN,
  /** One business's plan payments (M2-FR-3, SA-W72): a defensive cap (a monthly plan pays at most four times in 92 days). */
  PLAN_PAYMENTS_SHOWN: 50,
  /** Rows shown per overdue table (slice 2b): both tables share ONE names request (at most 100 ids, SA-W38). */
  OVERDUE_ROWS_SHOWN: 50,
  /**
   * The reminder read's own deadline (S2-F9, SA-WR-23): explicit, and shorter
   * than the admin default, so a slow queue cannot hold the page. Written as
   * a product on purpose.
   */
  REMINDER_DEADLINE_MS: 2 * 1000,
  /**
   * The recorded AI cost read's deadline (M-4, M4-FR-8, SA-W100): the
   * reminder precedent. Changed only by SA ruling after QA times a 92-day
   * window (SA-WR-49), never tuned silently.
   */
  RECORDED_DEADLINE_MS: 2 * 1000,
} as const;

/** K-5's information lines (slice 4a, S4-FR-7; slice 5a, SA-W60): nothing in the window, or what the figure is. */
export const K5_NO_DATA_YET = 'No data yet';
export const K5_REVENUE_HEADLINE = 'Boosts net of refunds and disputes, plus plans received';

/** Ascending text, NULL last: the SA-W66 tie-breaks of the plans by-business table. */
function compareText(a: string | null, b: string | null): number {
  if (a === b) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return a < b ? -1 : 1;
}

export interface FinanceHealthLogger {
  error: (ctx: Record<string, unknown>, msg: string) => void;
  warn: (ctx: Record<string, unknown>, msg: string) => void;
  /** The credit-position pass logs one line: counts and timing only. */
  info: (ctx: Record<string, unknown>, msg: string) => void;
}

export interface FinanceHealthDeps {
  plans: Pick<BusinessOsAccountPlanRepository, 'pagePlans'>;
  /**
   * The picked business's plan row, and nothing else (SA-WR-1): the wiring
   * strips the override rows that the underlying read embeds.
   */
  findPlanForAccount: (accountId: string) => Promise<RepoResult<{ plan: BusinessOsAccountPlan | null }>>;
  ledger: Pick<
    BusinessOsCreditLedgerReadRepository,
    'listRowsOfAllAccountsCreatedInRange' | 'listRowsForAccountCreatedInRange' | 'findChargesByActionIds'
  >;
  finance: Pick<
    BusinessOsFinanceReadRepository,
    | 'listBillingStatusesAllAccounts'
    | 'findBillingStatusForAccount'
    | 'countRevenueRows'
    | 'listClientPaymentsAllAccountsPaidInRange'
    | 'listClientPaymentsForAccountPaidInRange'
    | 'listClientRefundsAllAccountsCreatedInRange'
    | 'listClientRefundsForAccountCreatedInRange'
    | 'listOverdueClientInvoicesAllAccounts'
    | 'listOverdueClientInvoicesForAccount'
    | 'listOverdueClientInstalmentsAllAccounts'
    | 'listOverdueClientInstalmentsForAccount'
    | 'listClientPlansAllAccounts'
    | 'listClientPlansForAccount'
    | 'listBoostPurchasesAllAccountsPaidInRange'
    | 'listBoostPurchasesForAccountPaidInRange'
    | 'listPlanPaymentsAllAccountsPaidInRange'
    | 'listPlanPaymentsForAccountPaidInRange'
  >;
  /** Business names for display. Injected by the admin route (admin identity reads stay in `app/api/admin/**`). */
  findNames: (accountIds: readonly string[]) => Promise<RepoResult<Array<{ user_id: string; company_name: string | null }>>>;
  /**
   * The reminder queue's figures (slice 2b, R-j). Injected by the admin route,
   * which binds the jobs & queues read to this request's admin context
   * (SA-Q14): one definition of stuck and dead-lettered, never copied here.
   * Called only when no business is picked, under `REMINDER_DEADLINE_MS`; the
   * signal reaches every query.
   */
  readReminderFigures: (now: Date, signal: AbortSignal) => Promise<RepoResult<FinanceReminderFiguresInput>>;
  /**
   * M-4 (§11F.7): every account's Business OS usage-log costs in the half-open
   * span `[from, to)`. Route-bound (the route converts the end, SA-Q52).
   * Called only with no business picked and no tab, under
   * `RECORDED_DEADLINE_MS`; the signal stops its paging.
   */
  readRecordedAllAccounts: (
    span: FinanceSpan,
    signal: AbortSignal
  ) => Promise<RepoResult<{ rows: RecordedRowInput[]; completed: boolean }>>;
  /**
   * M-4: ONE account's Business OS usage-log costs in `[from, to)`. Called
   * only with that business picked (after the plan check). No signal
   * (SA-Q53): raced against the deadline only.
   */
  readRecordedForAccount: (
    accountId: string,
    span: FinanceSpan
  ) => Promise<RepoResult<{ rows: RecordedRowInput[]; reachedCeiling: boolean }>>;
  /** The entitlement config, passed to the pure classifier (SA-WR-4). */
  config: ClassifyInput['config'];
  isPlatformAccount: (accountId: string) => boolean;
  /** Injected in tests (AC-20); production uses `FINANCE_RULES`. */
  rules?: FinanceRuleSet;
  /**
   * The credit-position pass's reads (slice 1b, SA-W13). Production wires
   * them with `adminCreditPercentDeps()`, so the pass reads the real
   * entitlement service; tests also inject `getSnapshots` (SA-WR-10).
   */
  credits: AdminCreditPercentDeps;
  /**
   * The two lot reads, mapped narrow by the wiring (SA-W14). Read only.
   * `allAccounts` only when no business is picked; `forAccount` gets exactly
   * the picked id.
   */
  lots: {
    allAccounts: () => Promise<RepoResult<FinanceLot[]>>;
    forAccount: (accountId: string) => Promise<RepoResult<FinanceLot[]>>;
  };
  /** Injected in tests (SA-W10); production uses `FINANCE_METRIC_PARAMS`. */
  metricParams?: unknown;
  /** Slice 6b (FE-4, SA-Q81): injected in tests; production uses `STRIPE_FEE_ESTIMATE`. */
  feeEstimate?: unknown;
}

export interface FinanceHealthInput {
  window: ResolvedFinanceWindow;
  /** Validated UUID, or null for all businesses. */
  accountId: string | null;
  /** The request's one clock. */
  now: Date;
  /**
   * Slice 6a (SA-Q42): the Accounts tab's validated sort and filters, or null
   * for the Overview. The route refuses it with a business picked (SA-W84).
   */
  accountsTab: FinanceAccountsTabQuery | null;
}

/** How the route logs the group filter (SA-W83): its kind, never a tier id. */
export type FinanceGroupFilterKind = 'all' | 'trial' | 'founding_partner' | 'comped' | 'tier' | 'unknown_held' | 'tier_set' | 'other';

/** Counts only, for the route's one info line (SA-Q11). Never a figure or a name. */
export interface FinanceHealthCounts {
  accounts: number | null;
  plansCapped: boolean;
  ledgerRows: number;
  reachedCeiling: boolean;
  deletedRows: number;
  unreadableAmounts: number;
  unresolvedAdjustments: number;
  topAccounts: number;
  namesFound: number;
  /** Section 4 (slice 1b): accounts the pass answered for; null when no pass ran (SA-WR-13). */
  creditAccounts: number | null;
  /** `skipped`: the plan walk failed or was capped, so no pass ran (SA-W11). */
  creditsPass: AdminCreditPositionsPass['outcome'] | 'skipped';
  /** Positions by kind; null when the pass did not answer. */
  creditPositions: { position: number; no_allowance: number; unknown: number } | null;
  /** Lot rows read; null when the lots read failed. */
  creditLots: number | null;
  creditRowsShown: number;
  creditNamesFound: number;
  /** Takings (slice 2a): counts and booleans only, never an amount, a currency or a name (SEC-8). */
  takings: {
    /** Rows read; null when that read failed. */
    payments: number | null;
    refunds: number | null;
    paymentsCeiling: boolean;
    refundsCeiling: boolean;
    otherStatusPayments: number;
    refundsNotCompleted: number;
    unreadableAmounts: number;
    unreadableFees: number;
    currencies: number;
    rowsShown: number;
    rowsTotal: number;
    namesFound: number;
  };
  /** Client payment problems (slice 2b): counts, booleans and a state word only, never an amount, a currency, a date or a name. */
  paymentProblems: {
    /** Rows read; null when that read failed. */
    invoices: number | null;
    instalments: number | null;
    plans: number | null;
    invoicesCeiling: boolean;
    instalmentsCeiling: boolean;
    plansCeiling: boolean;
    unreadableAmounts: number;
    unexpectedRows: number;
    overdueRowsShown: number;
    reminders: FinancePaymentProblemsSection['reminders']['state'];
    /** How long the reminder read took; null when it was not called (a business picked). */
    reminderMs: number | null;
    namesFound: number;
  };
  /** Our revenue, boosts (slice 4a): counts and booleans only, never an amount, a currency, a package or a name. */
  boosts: {
    /** Rows read; null when the read failed. */
    rows: number | null;
    ceiling: boolean;
    counted: number;
    otherStatus: number;
    unreadable: number;
    unreadableCredits: number;
    currencies: number;
    packages: number;
    deletedAccountPurchases: number;
  };
  /** Our revenue, plans (slice 5a): counts and booleans only, never an amount, a currency, a tier or a name (M2-FR-11). */
  plans: {
    /** Rows read; null when the read failed. */
    rows: number | null;
    ceiling: boolean;
    payments: number;
    zeroAmount: number;
    unreadable: number;
    otherKind: number;
    currencies: number;
    accountsShown: number;
    accountsTotal: number;
    deletedAccountPayments: number;
    paymentsTotal: number;
    namesFound: number;
  };
  /** R-d (SA-Q35): read with all businesses, `not_called` with a business picked, `failed` when it failed. */
  revenueExistence: 'read' | 'failed' | 'not_called';
  /**
   * The Accounts tab (slice 6a, M3-FR-14): counts, booleans and enum words
   * only, never an amount, a name, a currency or a tier id (`group` is its kind).
   */
  accountEconomics:
    | { built: false }
    | {
        built: true;
        status: FinanceAccountEconomicsSection['status'];
        accounts: number;
        matching: number;
        shown: number;
        deletedRow: boolean;
        noPlanRow: number;
        namesFound: number;
        sort: FinanceAccountsTabQuery['sort'];
        group: FinanceGroupFilterKind;
        show: FinanceAccountsTabQuery['show'];
      };
  /**
   * The recorded AI cost read (M-4, M4-FR-9): which read ran, how it ended,
   * counts and flags only, never an amount, a difference, a feature value, a
   * session id or a name. `{ built: false }` on the Accounts tab.
   */
  aiRecorded:
    | { built: false }
    | {
        built: true;
        read: 'all_accounts' | 'account';
        outcome: 'ok' | 'failed' | 'deadline';
        /** Rows read; null when the read failed. */
        rows: number | null;
        /** The all-accounts read's flag; null for the account read or a failed read. */
        completed: boolean | null;
        /** The account read's flag; null for the all-accounts read or a failed read. */
        reachedCeiling: boolean | null;
        unreadable: number;
        ms: number | null;
      };
}

const GROUP_KINDS: ReadonlySet<string> = new Set(['trial', 'founding_partner', 'comped', 'unknown_held', 'tier_set']);

/** SA-W83: the group filter as its kind; a tier key is logged as `tier`, never its id. */
function groupFilterKind(group: string | null): FinanceGroupFilterKind {
  if (group === null) return 'all';
  if (group.startsWith('tier:')) return 'tier';
  return GROUP_KINDS.has(group) ? (group as FinanceGroupFilterKind) : 'other';
}

export type FinanceHealthResult =
  | { kind: 'ok'; payload: FinancePayload; counts: FinanceHealthCounts }
  | { kind: 'account_not_found' }
  | { kind: 'account_check_failed' };

interface PlanWalk {
  rows: BusinessOsAccountPlan[];
  capped: boolean;
}

const ledgerOpts = { pageSize: FINANCE_LIMITS.LEDGER_PAGE_SIZE, ceiling: FINANCE_LIMITS.LEDGER_CEILING };
const EMPTY_LEDGER: RepoResult<CreditLedgerPagedResult<CreditLedgerRow>> = {
  data: { rows: [], reachedCeiling: false },
  error: null,
};

/** The all-accounts plan walk (SA-Q3): keyset, stop on a short page, capped with `>=`. */
async function walkPlans(plans: FinanceHealthDeps['plans']): Promise<RepoResult<PlanWalk>> {
  const rows: BusinessOsAccountPlan[] = [];
  let after: string | null = null;
  for (;;) {
    const page = await plans.pagePlans({ afterUserId: after, limit: FINANCE_LIMITS.PLAN_PAGE_SIZE });
    if (page.error || !page.data) return { data: null, error: page.error ?? new Error('Plan page returned no data') };
    rows.push(...page.data);
    if (rows.length >= FINANCE_LIMITS.PLAN_CEILING) {
      return { data: { rows: rows.slice(0, FINANCE_LIMITS.PLAN_CEILING), capped: true }, error: null };
    }
    if (page.data.length < FINANCE_LIMITS.PLAN_PAGE_SIZE) return { data: { rows, capped: false }, error: null };
    after = page.data[page.data.length - 1].user_id;
  }
}

export async function buildFinanceHealth(
  input: FinanceHealthInput,
  logger: FinanceHealthLogger,
  deps: FinanceHealthDeps
): Promise<FinanceHealthResult> {
  const { window, accountId, now } = input;
  const rules = deps.rules ?? FINANCE_RULES;
  const failed = (read: string, err: Error | null) => logger.error({ read, err }, 'Finance read failed');

  // ── 1. The picked business exists, before anything else is read (SEC-3) ──
  let pickedPlan: BusinessOsAccountPlan | null = null;
  if (accountId !== null) {
    const check = await settle(() => deps.findPlanForAccount(accountId));
    if (check.error || !check.data) {
      failed('plan_for_account', check.error);
      return { kind: 'account_check_failed' };
    }
    if (check.data.plan === null) return { kind: 'account_not_found' };
    pickedPlan = check.data.plan;
  }

  // ── 2. Every independent read, at once, each settled ──────────────────────
  const readLedger = (range: CreditPeriodStartRange) =>
    settle(() =>
      accountId !== null
        ? deps.ledger.listRowsForAccountCreatedInRange(accountId, range, ledgerOpts)
        : deps.ledger.listRowsOfAllAccountsCreatedInRange(range, ledgerOpts)
    );
  const readSpan = (span: FinanceSpan) => (isEmptySpan(span) ? Promise.resolve(EMPTY_LEDGER) : readLedger(span));

  const clamp = cutoverClamp(window.start, window.end);
  const spans = k1Spans(now);

  const plansPromise: Promise<RepoResult<PlanWalk>> =
    accountId !== null
      ? Promise.resolve<RepoResult<PlanWalk>>({ data: { rows: [pickedPlan as BusinessOsAccountPlan], capped: false }, error: null })
      : settle(() => walkPlans(deps.plans));
  // Chained on the walk so it starts as soon as the account list exists. A
  // failed or capped walk runs NO pass: never a partial count (AC-37, SA-W11).
  // The ids are the walk's own rows, or the one picked (and checked) business.
  // The pass is documented never to throw, but the page must not depend on
  // it: any throw becomes a FAILED pass (Section 4 unknown, K-2 unavailable),
  // never a 500. K-4 rests on the lots read only and still shows (SA-W12).
  const positionsPromise: Promise<AdminCreditPositionsPass | null> = plansPromise.then(async (walk) => {
    if (!walk.data || walk.data.capped) return null;
    const ids = walk.data.rows.map((row) => row.user_id);
    try {
      return await readAdminCreditPositions(ids, deps.credits, logger, { now });
    } catch (err) {
      failed('credit_positions', err instanceof Error ? err : new Error(String(err)));
      return { outcome: 'failed', byUserId: new Map(ids.map((id) => [id, { kind: 'unknown' as const }])) };
    }
  });

  // Takings (slice 2a) and boosts (slice 4a): the selected window, half-open, like every other window read.
  const windowRange = { from: window.start, to: window.end };
  // Payment problems (slice 2b): as of now, by today's UTC date, computed once.
  const today = todayUtc(now);
  const reminderTimings: ReadTiming[] = [];
  const NOT_NARROWED: DeadlineRead<FinanceReminderFiguresInput> | null = null;
  // SA-Q35: R-d is platform-wide, so with a business picked it is not called (E-36).
  const NOT_CALLED_REVENUE: RepoResult<FinanceRevenueCounts> | null = null;

  // ── M-4 recorded read (wiring): start ──
  // §11F.7: the recorded AI cost. On the Accounts tab neither read runs (AC-167); with a business
  // picked only the account read, with exactly the checked id (AC-157); otherwise only the
  // all-accounts read. The builder asks for the half-open window; the route converts the end
  // (SA-Q52). Each result's flags travel by spread: they are read in recordedCost.ts only (E-53).
  const recordedSpan: FinanceSpan = { from: window.start, to: window.end };
  const recordedTimings: ReadTiming[] = [];
  const NOT_BUILT: DeadlineRead<RecordedReadInput> | null = null;
  const noRecordedData = () => new Error('Recorded read returned no data');
  const readRecordedAll = (signal: AbortSignal) =>
    settle<RecordedReadInput>(async () => {
      const result = await deps.readRecordedAllAccounts(recordedSpan, signal);
      return result.error || !result.data
        ? { data: null, error: result.error ?? noRecordedData() }
        : { data: { kind: 'all_accounts', ...result.data }, error: null };
    });
  const readRecordedOne = (id: string) =>
    settle<RecordedReadInput>(async () => {
      const result = await deps.readRecordedForAccount(id, recordedSpan);
      return result.error || !result.data
        ? { data: null, error: result.error ?? noRecordedData() }
        : { data: { kind: 'account', ...result.data }, error: null };
    });
  // ── M-4 recorded read (wiring): end ──

  const [
    plansResult,
    payingResult,
    revenueResult,
    windowResult,
    k1Current,
    k1Previous,
    lotsResult,
    positionsPass,
    clientPayments,
    clientRefunds,
    overdueInvoices,
    overdueInstalments,
    clientPlans,
    reminderRead,
    boostPurchases,
    planPayments,
    recordedRead,
  ] = await Promise.all([
    plansPromise,
    accountId !== null
      ? settle<FinanceBillingStatusRow[]>(async () => {
          const one = await deps.finance.findBillingStatusForAccount(accountId);
          return one.error ? { data: null, error: one.error } : { data: one.data ? [one.data] : [], error: null };
        })
      : settle(() => deps.finance.listBillingStatusesAllAccounts()),
    accountId !== null ? Promise.resolve(NOT_CALLED_REVENUE) : settle<FinanceRevenueCounts>(() => deps.finance.countRevenueRows()),
    clamp.readFrom === null ? Promise.resolve(EMPTY_LEDGER) : readLedger({ from: clamp.readFrom, to: window.end }),
    readSpan(spans.current),
    spans.previousBeforeCutover ? Promise.resolve(null) : readSpan(spans.previous),
    settle<FinanceLot[]>(() => (accountId !== null ? deps.lots.forAccount(accountId) : deps.lots.allAccounts())),
    positionsPromise,
    settle(() =>
      accountId !== null
        ? deps.finance.listClientPaymentsForAccountPaidInRange(accountId, windowRange)
        : deps.finance.listClientPaymentsAllAccountsPaidInRange(windowRange)
    ),
    settle(() =>
      accountId !== null
        ? deps.finance.listClientRefundsForAccountCreatedInRange(accountId, windowRange)
        : deps.finance.listClientRefundsAllAccountsCreatedInRange(windowRange)
    ),
    settle(() =>
      accountId !== null
        ? deps.finance.listOverdueClientInvoicesForAccount(accountId, today)
        : deps.finance.listOverdueClientInvoicesAllAccounts(today)
    ),
    settle(() =>
      accountId !== null
        ? deps.finance.listOverdueClientInstalmentsForAccount(accountId, today)
        : deps.finance.listOverdueClientInstalmentsAllAccounts(today)
    ),
    settle(() => (accountId !== null ? deps.finance.listClientPlansForAccount(accountId) : deps.finance.listClientPlansAllAccounts())),
    // R-j: platform-wide, so never called with a business picked (AC-65); in
    // this same Promise.all, under its own explicit deadline (SA-WR-23).
    accountId !== null
      ? Promise.resolve(NOT_NARROWED)
      : underDeadline(
          'reminders',
          reminderTimings,
          (signal) => deps.readReminderFigures(now, signal),
          FINANCE_LIMITS.REMINDER_DEADLINE_MS
        ),
    // R-k / R-k′ (slice 4a): our boost purchases paid in the window; R-k never with a business picked (AC-96).
    settle(() =>
      accountId !== null
        ? deps.finance.listBoostPurchasesForAccountPaidInRange(accountId, windowRange)
        : deps.finance.listBoostPurchasesAllAccountsPaidInRange(windowRange)
    ),
    // R-m / R-m′ (slice 5a): our paid plan invoices in the window; R-m never with a business picked (AC-123).
    settle(() =>
      accountId !== null
        ? deps.finance.listPlanPaymentsForAccountPaidInRange(accountId, windowRange)
        : deps.finance.listPlanPaymentsAllAccountsPaidInRange(windowRange)
    ),
    // M-4 (M4-FR-8, SA-W100): the recorded read, in this same Promise.all, under its own deadline.
    // The account read is raced only (E-57): it takes no signal, and a late result is dropped
    // (`underDeadline` swallows its settlement, and `settle` means it never rejects).
    input.accountsTab !== null
      ? Promise.resolve(NOT_BUILT)
      : accountId !== null
        ? underDeadline('recorded', recordedTimings, () => readRecordedOne(accountId), FINANCE_LIMITS.RECORDED_DEADLINE_MS)
        : underDeadline('recorded', recordedTimings, (signal) => readRecordedAll(signal), FINANCE_LIMITS.RECORDED_DEADLINE_MS),
  ]);

  if (plansResult.error) failed('plans', plansResult.error);
  if (payingResult.error) failed('paying_status', payingResult.error);
  if (revenueResult?.error) failed('revenue_existence', revenueResult.error);
  if (windowResult.error) failed('ledger_window', windowResult.error);
  if (k1Current.error) failed('ledger_k1_current', k1Current.error);
  if (k1Previous?.error) failed('ledger_k1_previous', k1Previous.error);
  if (lotsResult.error) failed('credit_lots', lotsResult.error);
  if (clientPayments.error) failed('client_payments', clientPayments.error);
  if (clientRefunds.error) failed('client_refunds', clientRefunds.error);
  if (overdueInvoices.error) failed('client_overdue_invoices', overdueInvoices.error);
  if (overdueInstalments.error) failed('client_overdue_instalments', overdueInstalments.error);
  if (clientPlans.error) failed('client_plans', clientPlans.error);
  if (boostPurchases.error) failed('boost_purchases', boostPurchases.error);
  if (planPayments.error) failed('plan_payments', planPayments.error);
  // Logged as `{ err }`, like every other finance read (CLAUDE.md logging standard). It cannot
  // carry client data: R-j is head counts filtered by fixed statuses and server-computed times,
  // and its repository wraps a PostgREST error to its message and code only; a deadline is the
  // fixed ReadDeadlineError. `DeadlineRead`'s "never logged as text" is about showing it to a
  // user, which this file never does.
  if (reminderRead !== null && !reminderRead.ok) failed('reminders', reminderRead.error ?? null);

  // ── 3. Section 1 ──────────────────────────────────────────────────────────
  // Test and real billing rows count together (BD-14); one row per account
  // (BD-16): two rows make the read itself fail, so they never reach here.
  const payingRows = payingResult.data ? payingResult.data.filter(isPayingBillingRow) : null;
  const payingIds = payingRows ? new Set(payingRows.map((row) => row.user_id)) : null;
  // SA-Q20 fallback for a paying Founding Partner with no plan tier: the
  // bought tier of the PAYING row only, validated by the classifier against
  // config.tierOrder. Never logged.
  const paidTierHints = new Map<string, string>();
  for (const row of payingRows ?? []) {
    if (row.bought_tier) paidTierHints.set(row.user_id, row.bought_tier);
  }
  const classified = plansResult.data
    ? classifyAccounts({ rows: plansResult.data.rows, payingIds, paidTierHints, window, now, config: deps.config })
    : null;
  const accounts: FinanceAccountsSection = {
    status: !classified ? 'unknown' : plansResult.data?.capped ? 'partial' : 'ok',
    scope: accountId !== null ? 'one' : 'all',
    figures: classified?.figures ?? null,
  };

  // ── 4. Section 3 ──────────────────────────────────────────────────────────
  let aiCost: FinanceAiCostSection;
  let topAccounts: FinanceTopAccount[] = [];
  let namesFound = 0;
  // Slice 6a (SA-Q46): the same pass's non-wire per-account units; null when the ledger read failed.
  let aiCostUnits: AiCostUnits | null = null;
  if (!windowResult.data) {
    aiCost = { status: 'unknown', coverage: clamp.coverage, figures: null };
  } else {
    const rows = windowResult.data.rows;
    const originals = await readOriginals(rows, deps, logger);
    const groupByAccount = classified?.groupByAccount ?? null;
    const summary = summariseAiCost({
      rows,
      reachedCeiling: windowResult.data.reachedCeiling,
      originals,
      groupOf: groupByAccount ? (id) => groupByAccount.get(id) : null,
      groupsComplete: !plansResult.data?.capped,
      tierLabelOf: (key: FinanceGroupKey) => tierLabelForGroup(deps.config, key),
      isPlatform: deps.isPlatformAccount,
    });
    aiCostUnits = summary.units;

    // Names only for ids taken from the rows just read, and never for a
    // platform account (labelled as such, SA-WR-5).
    const nameIds = summary.top.filter((t) => !t.isPlatform).map((t) => t.accountId);
    const names = nameIds.length > 0 ? await settle(() => deps.findNames(nameIds)) : { data: [], error: null };
    if (names.error) failed('names', names.error);
    const nameOf = new Map((names.data ?? []).map((n) => [n.user_id, n.company_name]));
    namesFound = nameOf.size;

    topAccounts = summary.top.map((t) => ({
      accountId: t.accountId,
      costUsd: t.costUsd,
      credits: t.credits,
      ...(t.isPlatform
        ? { name: null, nameStatus: 'platform' as const }
        : !names.data
          ? { name: null, nameStatus: 'unavailable' as const }
          : nameOf.get(t.accountId)
            ? { name: nameOf.get(t.accountId) as string, nameStatus: 'found' as const }
            : { name: null, nameStatus: 'missing' as const }),
    }));

    aiCost = {
      status: summary.figures.exact ? 'ok' : 'partial',
      coverage: clamp.coverage,
      figures: { ...summary.figures, topAccounts },
    };
  }

  // ── 4b. M-4 recorded section: start ──
  // §11F.5: the recorded AI cost beside Section 3's charged one, never added (BD-18). Section 3's
  // own units (R-a, or R-a′ with a business picked, whose deleted bucket is 0 by construction) and
  // its own exactness (SA-W102); null when the ledger read failed (R4-9). Section 3's figures and
  // status are not touched: the recorded result is one more key on the same object.
  let recordedCounts: FinanceHealthCounts['aiRecorded'] = { built: false };
  if (recordedRead !== null) {
    if (!recordedRead.ok) failed('recorded_ai_cost', recordedRead.error ?? null);
    const builtRecorded = buildRecordedAiCost({
      read: recordedRead.ok ? recordedRead.value : { kind: 'failed' },
      coverage: clamp.coverage,
      charged:
        aiCostUnits && aiCost.figures
          ? { totalUnits: aiCostUnits.total.cost, deletedUnits: aiCostUnits.deleted.cost, exact: aiCost.figures.exact }
          : null,
    });
    aiCost = { ...aiCost, recorded: builtRecorded.recorded };
    recordedCounts = {
      built: true,
      read: accountId !== null ? 'account' : 'all_accounts',
      outcome: recordedRead.ok ? 'ok' : recordedRead.error instanceof ReadDeadlineError ? 'deadline' : 'failed',
      ...builtRecorded.counts,
      ms: recordedTimings[0]?.ms ?? null,
    };
  }
  // ── 4b. M-4 recorded section: end ──

  // ── 5. Our revenue (S1-FR-25..27; slice 4a S4-FR-1 to S4-FR-10; slice 5a §11D.4) ──
  // Boosts from R-k / R-k′, plans from R-m / R-m′. R-d (all businesses only)
  // sets `state`; with a business picked `state` comes from that business's own
  // two reads (E-36). The section's status comes from the two money parts only (SA-W62).
  const scope = accountId !== null ? 'one' : 'all';
  const builtBoosts = buildBoostRevenue({ purchases: boostPurchases.data, scope });
  // SA-W65: a tier outside the config's tier order is "Unknown plan" (null), never its raw id.
  const tierOrder: readonly string[] = deps.config.tierOrder;
  const planLabelOf = (tier: string | null): string | null =>
    tier !== null && tierOrder.includes(tier) ? tierLabelForGroup(deps.config, `tier:${tier}`) : null;
  const builtPlanRevenue = buildPlanRevenue({
    payments: planPayments.data,
    scope,
    planLabelOf,
    limits: { accountsShown: FINANCE_LIMITS.PLAN_ACCOUNTS_SHOWN, paymentsShown: FINANCE_LIMITS.PLAN_PAYMENTS_SHOWN },
  });

  // Names for the shown by-business rows only (SA-W73), ids taken from the plan
  // rows just read (all businesses only: with a business picked there is no
  // table); never for a platform account (labelled, SA-WR-5).
  let planAccountRows: FinancePlanAccountRow[] | null = null;
  let planNamesFound = 0;
  if (builtPlanRevenue.accounts !== null) {
    const shown = builtPlanRevenue.accounts;
    const planNameIds = [...new Set(shown.filter((row) => !deps.isPlatformAccount(row.accountId)).map((row) => row.accountId))];
    const planNames = planNameIds.length > 0 ? await settle(() => deps.findNames(planNameIds)) : { data: [], error: null };
    if (planNames.error) failed('plan_names', planNames.error);
    const planNameOf = new Map((planNames.data ?? []).map((n) => [n.user_id, n.company_name]));
    planNamesFound = planNameIds.filter((id) => planNameOf.get(id)).length;
    const named: FinancePlanAccountRow[] = shown.map((row) => ({
      ...row,
      ...(deps.isPlatformAccount(row.accountId)
        ? { name: null, nameStatus: 'platform' as const }
        : !planNames.data
          ? { name: null, nameStatus: 'unavailable' as const }
          : planNameOf.get(row.accountId)
            ? { name: planNameOf.get(row.accountId) as string, nameStatus: 'found' as const }
            : { name: null, nameStatus: 'missing' as const }),
    }));
    // SA-W66: currency (Unknown last), received highest first, then the name,
    // then the id. Received is compared only between rows of ONE currency. The
    // name tie-break applies among the shown rows (names are read after the cap).
    planAccountRows = [...named].sort(
      (a, b) =>
        compareText(a.currency, b.currency) ||
        (a.currency === b.currency && a.received !== b.received ? (a.received > b.received ? -1 : 1) : 0) ||
        compareText(a.name, b.name) ||
        compareText(a.accountId, b.accountId)
    );
  }

  // SA-Q40 / E-34: boost net plus plans received, within one currency only.
  const combined = combineOurRevenue({
    boosts: {
      lines:
        builtBoosts.status === 'unknown'
          ? null
          : builtBoosts.netMinorByCurrency.map((line) => ({ currency: line.currency, minor: line.netMinor })),
      cutOff: builtBoosts.notes ? !builtBoosts.notes.exact : false,
    },
    plans: {
      lines:
        builtPlanRevenue.receivedMinorByCurrency === null
          ? null
          : builtPlanRevenue.receivedMinorByCurrency.map((line) => ({ currency: line.currency, minor: line.receivedMinor })),
      cutOff: builtPlanRevenue.counts.ceiling,
    },
  });

  const revenueData = revenueResult?.data ?? null;
  const boostsFailed = builtBoosts.status === 'unknown';
  const plansFailed = builtPlanRevenue.status === 'unknown';
  let state: FinanceRevenueSection['state'];
  if (accountId === null) {
    // R-d unchanged: any paid plan invoice or paid boost, platform-wide, test and real alike.
    state = !revenueData
      ? 'unknown'
      : revenueData.planInvoicesPaid > 0 || revenueData.boostsPaid > 0
        ? 'recorded'
        : 'none_yet';
  } else {
    // E-36: this business's own reads (R-k′, R-m′), never a platform-wide one.
    state =
      boostsFailed || plansFailed
        ? 'unknown'
        : builtPlanRevenue.counts.invoices > 0 || builtBoosts.counts.counted > 0
          ? 'recorded'
          : 'none_yet';
  }
  const revenue: FinanceRevenueSection = {
    status:
      boostsFailed && plansFailed
        ? 'unknown'
        : boostsFailed || plansFailed || builtBoosts.status !== 'ok' || builtPlanRevenue.status !== 'ok'
          ? 'partial'
          : 'ok',
    state,
    plans: {
      status: builtPlanRevenue.status,
      scope,
      lines: builtPlanRevenue.lines,
      accounts: planAccountRows,
      accountsTotal: builtPlanRevenue.accountsTotal,
      payments: builtPlanRevenue.payments,
      paymentsTotal: builtPlanRevenue.paymentsTotal,
      deletedAccounts: builtPlanRevenue.deletedAccounts,
      notes: builtPlanRevenue.notes,
    },
    boosts: {
      status: builtBoosts.status,
      scope,
      lines: builtBoosts.lines,
      packages: builtBoosts.packages,
      deletedAccounts: builtBoosts.deletedAccounts,
      notes: builtBoosts.notes,
    },
    totals: combined.totals,
  };

  // ── 6. Section 4, credits (slice 1b) ─────────────────────────────────────
  const metricParams = deps.metricParams ?? FINANCE_METRIC_PARAMS;
  const farOverAllowancePercent = farOverAllowancePercentOf(metricParams);
  const creditAccountIds =
    plansResult.data && !plansResult.data.capped ? plansResult.data.rows.map((row) => row.user_id) : null;
  const groupOfAccount = classified?.groupByAccount ?? null;
  const builtCredits = buildCreditsSection({
    accountIds: creditAccountIds,
    groupOf: (id) => groupOfAccount?.get(id),
    tierLabelOf: (key: FinanceGroupKey) => tierLabelForGroup(deps.config, key),
    positions: positionsPass?.outcome === 'ok' ? positionsPass.byUserId : null,
    lots: lotsResult.data,
    window: { start: window.start, end: window.end },
    now,
    farOverAllowancePercent,
    displayCap: FINANCE_LIMITS.CREDIT_ROWS_SHOWN,
  });

  // Names for the rows shown only, ids taken from the plan rows already read;
  // never for a platform account (labelled, SA-WR-5).
  let creditRows: FinanceCreditRow[] = [];
  let creditNamesFound = 0;
  if (builtCredits.figures) {
    const shownRows = builtCredits.figures.rows;
    const creditNameIds = shownRows.filter((row) => !deps.isPlatformAccount(row.accountId)).map((row) => row.accountId);
    const creditNames =
      creditNameIds.length > 0 ? await settle(() => deps.findNames(creditNameIds)) : { data: [], error: null };
    if (creditNames.error) failed('credit_names', creditNames.error);
    const creditNameOf = new Map((creditNames.data ?? []).map((n) => [n.user_id, n.company_name]));
    creditNamesFound = creditNameOf.size;
    creditRows = shownRows.map((row) => ({
      ...row,
      ...(deps.isPlatformAccount(row.accountId)
        ? { name: null, nameStatus: 'platform' as const }
        : !creditNames.data
          ? { name: null, nameStatus: 'unavailable' as const }
          : creditNameOf.get(row.accountId)
            ? { name: creditNameOf.get(row.accountId) as string, nameStatus: 'found' as const }
            : { name: null, nameStatus: 'missing' as const }),
    }));
  }
  const credits: FinanceCreditsSection = {
    status: builtCredits.figures ? 'ok' : 'unknown',
    scope: accountId !== null ? 'one' : 'all',
    farOverAllowancePercent,
    figures: builtCredits.figures ? { ...builtCredits.figures, rows: creditRows } : null,
    gifted: builtCredits.gifted,
  };

  // ── 6a. The Accounts tab, or the picked business's margin (slice 6a, §11E) ──
  // No new read: R-a (through `units`), R-k, R-m, the walk and Section 4's rows.
  // Slice 6b: the fee estimate config is data (FE-4); an invalid one is logged once,
  // naming no value (SA-W-6b-9), and every margin after fees reads Unknown (E-73).
  const feeEstimate = deps.feeEstimate ?? STRIPE_FEE_ESTIMATE;
  const economicsReads = {
    coverage: clamp.coverage,
    aiCost: aiCostUnits && windowResult.data ? { units: aiCostUnits, reachedCeiling: windowResult.data.reachedCeiling } : null,
    boosts: boostPurchases.data,
    plans: planPayments.data,
    feeEstimate,
  };
  if ((accountId !== null || input.accountsTab !== null) && stripeFeeEntryOf(feeEstimate, FEE_ESTIMATE_CURRENCY) === null) {
    logger.error({ read: 'fee_estimate' }, 'Finance Stripe fee estimate config is invalid');
  }
  let accountEconomics: FinanceAccountEconomicsSection | null = null;
  let accountEconomicsCounts: FinanceHealthCounts['accountEconomics'] = { built: false };
  let accountMargin: FinanceAccountMargin | null = null;
  if (accountId !== null) {
    // M3-FR-8: the same functions over R-a′ / R-k′ / R-m′, which already carry exactly this id.
    accountMargin = buildAccountMargin({ ...economicsReads, accountId });
  } else if (input.accountsTab !== null) {
    const groupByAccountForTab = classified?.groupByAccount ?? null;
    const built = buildAccountEconomics({
      ...economicsReads,
      walk: plansResult.data
        ? { accountIds: plansResult.data.rows.map((row) => row.user_id), capped: plansResult.data.capped }
        : null,
      groupOf: (id) => groupByAccountForTab?.get(id),
      foundingPartner: (id) => classified?.foundingPartnerNote.has(id) ?? false,
      tierLabelOf: (key: FinanceGroupKey) => tierLabelForGroup(deps.config, key),
      credits: builtCredits.rowByAccount,
      isPlatform: deps.isPlatformAccount,
      query: input.accountsTab,
      cap: FINANCE_LIMITS.ACCOUNT_ROWS_SHOWN,
      groupOptions: (classified?.figures.groups ?? []).map((group) => ({ key: group.key, tierLabel: group.tierLabel })),
      refundOrDispute: builtBoosts.notes?.refundOrDispute ?? false,
    });
    // ONE names call for the shown rows only (at most 200 ids, one chunk), ids taken from the
    // rows just read; never a platform account (the builder leaves them out) or a NULL id.
    const economicsNames =
      built.shownIds.length > 0 ? await settle(() => deps.findNames(built.shownIds)) : { data: [], error: null };
    if (economicsNames.error) failed('account_names', economicsNames.error);
    const economicsNameOf = new Map((economicsNames.data ?? []).map((n) => [n.user_id, n.company_name]));
    const economicsNamesFound = built.shownIds.filter((id) => economicsNameOf.get(id)).length;
    accountEconomics = {
      ...built.section,
      rows: built.section.rows.map((row) => ({
        ...row,
        ...(row.kind === 'platform'
          ? { name: null, nameStatus: 'platform' as const }
          : !economicsNames.data
            ? { name: null, nameStatus: 'unavailable' as const }
            : economicsNameOf.get(row.accountId)
              ? { name: economicsNameOf.get(row.accountId) as string, nameStatus: 'found' as const }
              : { name: null, nameStatus: 'missing' as const }),
      })),
    };
    accountEconomicsCounts = {
      built: true,
      status: built.section.status,
      accounts: built.counts.accounts,
      matching: built.counts.matching,
      shown: built.counts.shown,
      deletedRow: built.counts.deletedRow,
      noPlanRow: built.counts.noPlanRow,
      namesFound: economicsNamesFound,
      sort: input.accountsTab.sort,
      group: groupFilterKind(input.accountsTab.group),
      show: input.accountsTab.show,
    };
  }

  // ── 6b. Section 2 block B, takings (slice 2a) ─────────────────────────────
  const builtTakings = buildTakings({
    payments: clientPayments.data,
    refunds: clientRefunds.data,
    isPlatformAccount: deps.isPlatformAccount,
    displayCap: FINANCE_LIMITS.TAKINGS_ROWS_SHOWN,
  });
  // Names for the rows shown only, ids taken from the payment and refund rows
  // just read (with a business picked, those rows came only from R-e′ / R-f′);
  // never for a platform account (labelled, SA-WR-5) or a NULL id.
  let takingsRows: FinanceTakingsRow[] = [];
  let takingsNamesFound = 0;
  if (builtTakings.figures) {
    const shown = builtTakings.figures.rows;
    const takingsNameIds = [
      ...new Set(shown.filter((row) => row.accountId !== null && !row.isPlatform).map((row) => row.accountId as string)),
    ];
    const takingsNames =
      takingsNameIds.length > 0 ? await settle(() => deps.findNames(takingsNameIds)) : { data: [], error: null };
    if (takingsNames.error) failed('takings_names', takingsNames.error);
    const takingsNameOf = new Map((takingsNames.data ?? []).map((n) => [n.user_id, n.company_name]));
    takingsNamesFound = takingsNameIds.filter((id) => takingsNameOf.get(id)).length;
    takingsRows = shown.map(({ isPlatform, ...row }) => ({
      ...row,
      ...(row.accountId === null
        ? { name: null, nameStatus: 'unknown_business' as const }
        : isPlatform
          ? { name: null, nameStatus: 'platform' as const }
          : !takingsNames.data
            ? { name: null, nameStatus: 'unavailable' as const }
            : takingsNameOf.get(row.accountId)
              ? { name: takingsNameOf.get(row.accountId) as string, nameStatus: 'found' as const }
              : { name: null, nameStatus: 'missing' as const }),
    }));
  }
  const takings: FinanceTakingsSection = {
    status: builtTakings.status,
    scope: accountId !== null ? 'one' : 'all',
    figures: builtTakings.figures ? { ...builtTakings.figures, rows: takingsRows } : null,
  };

  // ── 6c. Section 6 block B, client payment problems (slice 2b) ─────────────
  const builtInvoices = buildOverdue({
    kind: 'invoice',
    read: overdueInvoices.data,
    todayUtc: today,
    isPlatformAccount: deps.isPlatformAccount,
    displayCap: FINANCE_LIMITS.OVERDUE_ROWS_SHOWN,
  });
  const builtInstalments = buildOverdue({
    kind: 'instalment',
    read: overdueInstalments.data,
    todayUtc: today,
    isPlatformAccount: deps.isPlatformAccount,
    displayCap: FINANCE_LIMITS.OVERDUE_ROWS_SHOWN,
  });
  const builtPlans = buildClientPlans({ read: clientPlans.data, window: { start: window.start, end: window.end }, now });
  // SA-W35: a malformed result is a failed part, never a 0.
  const reminderFigures = reminderRead !== null && reminderRead.ok ? mapReminderFigures(reminderRead.value) : null;
  if (reminderRead !== null && reminderRead.ok && reminderFigures === null) {
    failed('reminders', new Error('Reminder figures were malformed'));
  }
  const reminders: FinancePaymentProblemsSection['reminders'] =
    reminderRead === null
      ? { status: 'ok', state: 'not_narrowed', figures: null }
      : reminderFigures === null
        ? { status: 'unknown', state: 'failed', figures: null }
        : { status: 'ok', state: 'read', figures: reminderFigures };

  // ONE names call for the rows shown in both tables (SA-W38), ids taken only
  // from the overdue rows just read (with a business picked, those came only
  // from R-g′ / R-h′); never for a platform account or a NULL id.
  const shownDue = [...(builtInvoices.figures?.rows ?? []), ...(builtInstalments.figures?.rows ?? [])];
  const dueNameIds = [
    ...new Set(shownDue.filter((row) => row.accountId !== null && !row.isPlatform).map((row) => row.accountId as string)),
  ];
  const dueNames = dueNameIds.length > 0 ? await settle(() => deps.findNames(dueNameIds)) : { data: [], error: null };
  if (dueNames.error) failed('overdue_names', dueNames.error);
  const dueNameOf = new Map((dueNames.data ?? []).map((n) => [n.user_id, n.company_name]));
  const dueNamesFound = dueNameIds.filter((id) => dueNameOf.get(id)).length;
  const namedPart = (built: OverdueBuilt): FinanceDuePart => ({
    status: built.status,
    figures: built.figures
      ? {
          ...built.figures,
          rows: built.figures.rows.map(({ isPlatform, ...row }): FinanceDueRow => ({
            ...row,
            ...(row.accountId === null
              ? { name: null, nameStatus: 'unknown_business' as const }
              : isPlatform
                ? { name: null, nameStatus: 'platform' as const }
                : !dueNames.data
                  ? { name: null, nameStatus: 'unavailable' as const }
                  : dueNameOf.get(row.accountId)
                    ? { name: dueNameOf.get(row.accountId) as string, nameStatus: 'found' as const }
                    : { name: null, nameStatus: 'missing' as const }),
          })),
        }
      : null,
  });
  const paymentProblems: FinancePaymentProblemsSection = {
    status: paymentProblemsStatus([builtInvoices.status, builtInstalments.status, builtPlans.status, reminders.status]),
    scope: accountId !== null ? 'one' : 'all',
    today,
    failedPayments: { state: 'not_stored' },
    overdueInvoices: namedPart(builtInvoices),
    overdueInstalments: namedPart(builtInstalments),
    clientPlans: { status: builtPlans.status, figures: builtPlans.figures },
    reminders,
  };

  // ── 7. Tiles ──────────────────────────────────────────────────────────────
  const onRuleError = (problem: { tile: string; ruleId: string | null; reason: string }) =>
    logger.error({ read: 'rules', ...problem }, 'Finance tile rule list is invalid');

  // An unreadable amount makes the figure unknown, never a green 0-filled sum (SA-1 / QA-1).
  const k1Measured = (r: RepoResult<CreditLedgerPagedResult<CreditLedgerRow>> | null) => {
    if (!r?.data) return null;
    const sum = sumCostUsd(r.data.rows);
    return sum.unreadableAmounts > 0 ? null : { value: sum.costUsd, exact: !r.data.reachedCeiling };
  };
  const current = k1Measured(k1Current);
  const previous = spans.previousBeforeCutover ? null : k1Measured(k1Previous);
  const k1Measurement: FinanceMeasurement | null =
    current === null
      ? null
      : spans.previousBeforeCutover
        ? { metrics: { aiCostMonth: current }, notEnoughHistory: true }
        : previous === null
          ? null
          : { metrics: { aiCostMonth: current, aiCostPrevSpan: previous } };
  const k1Colour = colourFinanceTile('k1_ai_cost', rules.k1_ai_cost, k1Measurement, { onRuleError });

  const k3Value = classified
    ? { value: classified.figures.foundingNoEndDate, exact: !plansResult.data?.capped }
    : null;
  const k3Colour = colourFinanceTile(
    'k3_founding_no_end_date',
    rules.k3_founding_no_end_date,
    k3Value ? { metrics: { foundingNoEndDate: k3Value } } : null,
    { onRuleError }
  );

  // K-5 (slice 4a, SA-W47; slice 5a, SA-W60): boost net plus plans received in ONE currency, from the
  // combiner (the same `totals` the account summary reads). Information only (no rule, never green).
  // Either money read failing is "Unknown"; R-d failing changes `state` only, never K-5.
  const k5Money = combined.k5;
  const k5Colour = colourFinanceTile(
    'k5_our_revenue',
    rules.k5_our_revenue,
    k5Money.kind === 'unknown' && k5Money.reason === 'failed'
      ? null
      : { metrics: {}, information: k5Money.kind === 'none' ? K5_NO_DATA_YET : K5_REVENUE_HEADLINE },
    { onRuleError }
  );

  // K-2 (SA-WR-8): an account that could not be read makes the count a lower bound.
  const creditFigures = credits.figures;
  const k2Measured =
    creditFigures && creditFigures.farOverAllowance !== null
      ? { farOverAllowance: creditFigures.farOverAllowance, unknownAccounts: creditFigures.unknownAccounts }
      : null;
  const k2Colour = colourFarOverAllowanceTile(rules.k2_far_over_allowance, k2Measured, metricParams, { onRuleError });
  const k2Value =
    k2Measured && k2Colour.status !== 'unavailable'
      ? { value: k2Measured.farOverAllowance, exact: k2Measured.unknownAccounts === 0 }
      : null;

  // K-4 never needs the pass: only the lots read (SA-W12). Information only, never green.
  const k4Outstanding = credits.gifted?.outstanding ?? null;
  const k4Colour = colourFinanceTile(
    'k4_gifted_outstanding',
    rules.k4_gifted_outstanding,
    k4Outstanding === null ? null : { metrics: {}, information: K4_INFORMATION_HEADLINE },
    { onRuleError }
  );

  const tile = (
    id: FinanceTile['id'],
    colour: { status: FinanceTile['status']; headline: string },
    value: FinanceTile['value'],
    prev: FinanceTile['previous'] = null
  ): FinanceTile => ({ id, status: colour.status, headline: colour.headline, value, previous: prev });

  const figures = aiCost.figures;
  const payload: FinancePayload = {
    generatedAt: now.toISOString(),
    window: {
      preset: window.preset,
      from: window.from,
      to: window.to,
      start: window.start.toISOString(),
      end: window.end.toISOString(),
    },
    accountId,
    tiles: {
      k1: tile('k1_ai_cost', k1Colour, current, previous),
      k2: tile('k2_far_over_allowance', k2Colour, k2Value),
      k3: tile('k3_founding_no_end_date', k3Colour, k3Value),
      k4: tile('k4_gifted_outstanding', k4Colour, k4Outstanding === null ? null : { value: k4Outstanding, exact: true }),
      k5: { ...tile('k5_our_revenue', k5Colour, null), money: k5Money },
    },
    revenue,
    accounts,
    aiCost,
    credits,
    takings,
    paymentProblems,
    // Slice 6a (SA-W74): optional keys, ABSENT (not null) when not built, so the Overview payload is unchanged.
    ...(accountEconomics ? { accountEconomics } : {}),
    ...(accountMargin ? { accountMargin } : {}),
  };

  // Counts by kind for the route's one line: never a figure.
  let creditPositions: FinanceHealthCounts['creditPositions'] = null;
  if (positionsPass?.outcome === 'ok') {
    const tally = { position: 0, no_allowance: 0, unknown: 0 };
    for (const value of positionsPass.byUserId.values()) tally[value.kind] += 1;
    creditPositions = tally;
  }

  return {
    kind: 'ok',
    payload,
    counts: {
      accounts: classified ? classified.figures.total : null,
      plansCapped: plansResult.data?.capped ?? false,
      ledgerRows: figures?.rows ?? 0,
      reachedCeiling: windowResult.data?.reachedCeiling ?? false,
      deletedRows: figures?.deleted.rows ?? 0,
      unreadableAmounts: figures?.unreadableAmounts ?? 0,
      unresolvedAdjustments: figures?.unresolvedAdjustments ?? 0,
      topAccounts: topAccounts.length,
      namesFound,
      creditAccounts: positionsPass ? positionsPass.byUserId.size : null,
      creditsPass: positionsPass ? positionsPass.outcome : 'skipped',
      creditPositions,
      creditLots: lotsResult.data ? lotsResult.data.length : null,
      creditRowsShown: creditRows.length,
      creditNamesFound,
      takings: {
        payments: clientPayments.data ? clientPayments.data.rows.length : null,
        refunds: clientRefunds.data ? clientRefunds.data.rows.length : null,
        paymentsCeiling: clientPayments.data?.reachedCeiling ?? false,
        refundsCeiling: clientRefunds.data?.reachedCeiling ?? false,
        otherStatusPayments: takings.figures?.otherStatusPayments ?? 0,
        refundsNotCompleted: takings.figures?.refundsNotCompleted ?? 0,
        unreadableAmounts: takings.figures?.unreadableAmounts ?? 0,
        unreadableFees: takings.figures?.unreadableFees ?? 0,
        currencies: takings.figures?.lines.length ?? 0,
        rowsShown: takingsRows.length,
        rowsTotal: takings.figures?.rowsTotal ?? 0,
        namesFound: takingsNamesFound,
      },
      paymentProblems: {
        invoices: overdueInvoices.data ? overdueInvoices.data.rows.length : null,
        instalments: overdueInstalments.data ? overdueInstalments.data.rows.length : null,
        plans: clientPlans.data ? clientPlans.data.rows.length : null,
        invoicesCeiling: overdueInvoices.data?.reachedCeiling ?? false,
        instalmentsCeiling: overdueInstalments.data?.reachedCeiling ?? false,
        plansCeiling: clientPlans.data?.reachedCeiling ?? false,
        unreadableAmounts:
          (builtInvoices.figures?.unreadableAmounts ?? 0) + (builtInstalments.figures?.unreadableAmounts ?? 0),
        unexpectedRows: builtInvoices.unexpectedRows + builtInstalments.unexpectedRows,
        overdueRowsShown: shownDue.length,
        reminders: reminders.state,
        reminderMs: reminderTimings[0]?.ms ?? null,
        namesFound: dueNamesFound,
      },
      boosts: {
        rows: boostPurchases.data ? boostPurchases.data.rows.length : null,
        ceiling: boostPurchases.data?.reachedCeiling ?? false,
        counted: builtBoosts.counts.counted,
        otherStatus: builtBoosts.notes?.otherStatusPurchases ?? 0,
        unreadable: builtBoosts.notes?.unreadablePurchases ?? 0,
        unreadableCredits: builtBoosts.counts.unreadableCredits,
        currencies: builtBoosts.lines?.length ?? 0,
        packages: builtBoosts.packages?.length ?? 0,
        deletedAccountPurchases: builtBoosts.counts.deletedAccountPurchases,
      },
      plans: {
        rows: planPayments.data ? planPayments.data.rows.length : null,
        ceiling: builtPlanRevenue.counts.ceiling,
        payments: builtPlanRevenue.counts.payments,
        zeroAmount: builtPlanRevenue.counts.zeroAmount,
        unreadable: builtPlanRevenue.counts.unreadable,
        otherKind: builtPlanRevenue.counts.otherKind,
        currencies: builtPlanRevenue.counts.currencies,
        accountsShown: planAccountRows?.length ?? 0,
        accountsTotal: builtPlanRevenue.counts.accountsTotal,
        deletedAccountPayments: builtPlanRevenue.counts.deletedAccountPayments,
        paymentsTotal: builtPlanRevenue.counts.paymentsTotal,
        namesFound: planNamesFound,
      },
      revenueExistence: revenueResult === null ? 'not_called' : revenueResult.data ? 'read' : 'failed',
      accountEconomics: accountEconomicsCounts,
      aiRecorded: recordedCounts,
    },
  };
}

/**
 * The charges, outside the read set, that its adjustments correct: by unique
 * action id, in chunks, capped (the cost report's limits). A failed chunk
 * leaves those adjustments unresolved (counted), never dropped. A lookup by id
 * is not an ownership proof: `resolveEffectiveFields` checks the account.
 */
async function readOriginals(
  rows: readonly CreditLedgerRow[],
  deps: FinanceHealthDeps,
  logger: FinanceHealthLogger
): Promise<CreditLedgerRow[]> {
  const ids = missingOriginalIds(rows).slice(0, FINANCE_LIMITS.ORIGINALS_MAX);
  const found: CreditLedgerRow[] = [];
  for (let i = 0; i < ids.length; i += FINANCE_LIMITS.ORIGINALS_PER_REQUEST) {
    const chunk = ids.slice(i, i + FINANCE_LIMITS.ORIGINALS_PER_REQUEST);
    const result = await settle(() => deps.ledger.findChargesByActionIds(chunk));
    if (result.error || !result.data) {
      logger.warn({ read: 'adjustment_originals', err: result.error }, 'Finance read of adjustment originals failed');
      continue;
    }
    found.push(...result.data);
  }
  return found;
}
