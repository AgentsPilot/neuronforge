/**
 * The admin finance & business health page's builder (slices 1a, 1b and 2a).
 * Workplans docs/workplans/BUSINESS_OS_FINANCE_HEALTH_SLICE_1A_WORKPLAN.md,
 * docs/workplans/BUSINESS_OS_FINANCE_HEALTH_SLICE_1B_WORKPLAN.md and
 * docs/workplans/BUSINESS_OS_FINANCE_HEALTH_SLICE_2A_WORKPLAN.md.
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
 *      read, the all-accounts billing read, the all-accounts lot read, and
 *      since slice 2a the all-accounts client payment and refund reads). The
 *      platform-wide revenue head count is the one deliberate exception: it
 *      reads no account and no amount.
 * Business names are looked up only for ids taken from rows already read
 * (ledger rows for Section 3, plan rows for Section 4, client payment and
 * refund rows for the takings block).
 *
 * TAKINGS (slice 2a, Section 2 block B). The client payment and refund reads
 * run beside every other read, settled on their own. The pure `buildTakings`
 * does the money maths (integer hundredths per currency, never across
 * currencies); this file only adds the names of the rows shown. A failed
 * payments read makes the block unknown and touches no other section.
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
import { CREDIT_REPORT_LIMITS } from '@/lib/business-os/credits/creditReport';
import { isPayingBillingRow } from '@/lib/business-os/billing/payingSubscriptionStatuses';
import { missingOriginalIds, sumCostUsd, summariseAiCost } from './aiCost';
import { readAdminCreditPositions, type AdminCreditPercentDeps, type AdminCreditPositionsPass } from '@/lib/business-os/credits/adminCreditPercent';
import { buildCreditsSection, type FinanceLot } from './creditsSection';
import { buildTakings } from './takings';
import {
  colourFarOverAllowanceTile,
  colourFinanceTile,
  farOverAllowancePercentOf,
  FINANCE_COULD_NOT_CHECK_HEADLINE,
  FINANCE_METRIC_PARAMS,
  FINANCE_RULES,
  K4_INFORMATION_HEADLINE,
  type FinanceMeasurement,
  type FinanceRuleSet,
} from './financeRules';
import { isEmptySpan, k1Spans, type FinanceSpan, type ResolvedFinanceWindow } from './financeWindow';
import { classifyAccounts, tierLabelForGroup, type ClassifyInput } from './planGroups';
import type {
  FinanceAccountsSection,
  FinanceAiCostSection,
  FinanceCreditRow,
  FinanceCreditsSection,
  FinanceGroupKey,
  FinancePayload,
  FinanceRevenueSection,
  FinanceTakingsRow,
  FinanceTakingsSection,
  FinanceTile,
  FinanceTopAccount,
} from './financeTypes';

type RepoResult<T> = { data: T | null; error: Error | null };

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
  TAKINGS_ROWS_SHOWN: 200,
} as const;

/** The revenue panel's "none yet" and "recorded" headlines for K-5 (S1-FR-26). */
export const K5_NONE_YET = 'None yet';
export const K5_RECORDED = 'Revenue recorded, not yet shown';

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
    | 'listLiveBillingStatusesAllAccounts'
    | 'findLiveBillingStatusForAccount'
    | 'countLiveRevenueRows'
    | 'listClientPaymentsAllAccountsPaidInRange'
    | 'listClientPaymentsForAccountPaidInRange'
    | 'listClientRefundsAllAccountsCreatedInRange'
    | 'listClientRefundsForAccountCreatedInRange'
  >;
  /** Business names for display. Injected by the admin route (admin identity reads stay in `app/api/admin/**`). */
  findNames: (accountIds: readonly string[]) => Promise<RepoResult<Array<{ user_id: string; company_name: string | null }>>>;
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
}

export interface FinanceHealthInput {
  window: ResolvedFinanceWindow;
  /** Validated UUID, or null for all businesses. */
  accountId: string | null;
  /** The request's one clock. */
  now: Date;
}

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

  // Takings (slice 2a): the selected window, half-open, like every other window read.
  const takingsRange = { from: window.start, to: window.end };

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
  ] = await Promise.all([
    plansPromise,
    accountId !== null
      ? settle<FinanceBillingStatusRow[]>(async () => {
          const one = await deps.finance.findLiveBillingStatusForAccount(accountId);
          return one.error ? { data: null, error: one.error } : { data: one.data ? [one.data] : [], error: null };
        })
      : settle(() => deps.finance.listLiveBillingStatusesAllAccounts()),
    settle<FinanceRevenueCounts>(() => deps.finance.countLiveRevenueRows()),
    clamp.readFrom === null ? Promise.resolve(EMPTY_LEDGER) : readLedger({ from: clamp.readFrom, to: window.end }),
    readSpan(spans.current),
    spans.previousBeforeCutover ? Promise.resolve(null) : readSpan(spans.previous),
    settle<FinanceLot[]>(() => (accountId !== null ? deps.lots.forAccount(accountId) : deps.lots.allAccounts())),
    positionsPromise,
    settle(() =>
      accountId !== null
        ? deps.finance.listClientPaymentsForAccountPaidInRange(accountId, takingsRange)
        : deps.finance.listClientPaymentsAllAccountsPaidInRange(takingsRange)
    ),
    settle(() =>
      accountId !== null
        ? deps.finance.listClientRefundsForAccountCreatedInRange(accountId, takingsRange)
        : deps.finance.listClientRefundsAllAccountsCreatedInRange(takingsRange)
    ),
  ]);

  if (plansResult.error) failed('plans', plansResult.error);
  if (payingResult.error) failed('paying_status', payingResult.error);
  if (revenueResult.error) failed('revenue_existence', revenueResult.error);
  if (windowResult.error) failed('ledger_window', windowResult.error);
  if (k1Current.error) failed('ledger_k1_current', k1Current.error);
  if (k1Previous?.error) failed('ledger_k1_previous', k1Previous.error);
  if (lotsResult.error) failed('credit_lots', lotsResult.error);
  if (clientPayments.error) failed('client_payments', clientPayments.error);
  if (clientRefunds.error) failed('client_refunds', clientRefunds.error);

  // ── 3. Section 1 ──────────────────────────────────────────────────────────
  const payingIds = payingResult.data
    ? new Set(payingResult.data.filter(isPayingBillingRow).map((row) => row.user_id))
    : null;
  const classified = plansResult.data
    ? classifyAccounts({ rows: plansResult.data.rows, payingIds, window, now, config: deps.config })
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

  // ── 5. Revenue panel (S1-FR-25..27) ──────────────────────────────────────
  const revenue: FinanceRevenueSection = !revenueResult.data
    ? { status: 'unknown', state: 'unknown' }
    : {
        status: 'ok',
        state: revenueResult.data.planInvoicesPaid > 0 || revenueResult.data.boostsPaid > 0 ? 'recorded' : 'none_yet',
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

  const k5Colour = colourFinanceTile(
    'k5_our_revenue',
    rules.k5_our_revenue,
    revenue.state === 'unknown' ? null : { metrics: {}, information: revenue.state === 'recorded' ? K5_RECORDED : K5_NONE_YET },
    { onRuleError, unavailableHeadline: FINANCE_COULD_NOT_CHECK_HEADLINE }
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
      k5: tile('k5_our_revenue', k5Colour, null),
    },
    revenue,
    accounts,
    aiCost,
    credits,
    takings,
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
