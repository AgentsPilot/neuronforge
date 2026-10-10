/**
 * The admin finance & business health page's builder (slice 1a). Workplan
 * docs/workplans/BUSINESS_OS_FINANCE_HEALTH_SLICE_1A_WORKPLAN.md.
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
 *      read, the all-accounts billing read). The platform-wide revenue head
 *      count is the one deliberate exception: it reads no account and no amount.
 * Business names are looked up only for ids taken from ledger rows already read.
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
import { colourFinanceTile, FINANCE_COULD_NOT_CHECK_HEADLINE, FINANCE_RULES, type FinanceMeasurement, type FinanceRuleSet } from './financeRules';
import { isEmptySpan, k1Spans, type FinanceSpan, type ResolvedFinanceWindow } from './financeWindow';
import { classifyAccounts, tierLabelForGroup, type ClassifyInput } from './planGroups';
import type {
  FinanceAccountsSection,
  FinanceAiCostSection,
  FinanceGroupKey,
  FinancePayload,
  FinanceRevenueSection,
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
} as const;

/** The revenue panel's "none yet" and "recorded" headlines for K-5 (S1-FR-26). */
export const K5_NONE_YET = 'None yet';
export const K5_RECORDED = 'Revenue recorded, not yet shown';

export interface FinanceHealthLogger {
  error: (ctx: Record<string, unknown>, msg: string) => void;
  warn: (ctx: Record<string, unknown>, msg: string) => void;
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
    'listLiveBillingStatusesAllAccounts' | 'findLiveBillingStatusForAccount' | 'countLiveRevenueRows'
  >;
  /** Business names for display. Injected by the admin route (admin identity reads stay in `app/api/admin/**`). */
  findNames: (accountIds: readonly string[]) => Promise<RepoResult<Array<{ user_id: string; company_name: string | null }>>>;
  /** The entitlement config, passed to the pure classifier (SA-WR-4). */
  config: ClassifyInput['config'];
  isPlatformAccount: (accountId: string) => boolean;
  /** Injected in tests (AC-20); production uses `FINANCE_RULES`. */
  rules?: FinanceRuleSet;
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

  const [plansResult, payingResult, revenueResult, windowResult, k1Current, k1Previous] = await Promise.all([
    accountId !== null
      ? Promise.resolve<RepoResult<PlanWalk>>({ data: { rows: [pickedPlan as BusinessOsAccountPlan], capped: false }, error: null })
      : settle(() => walkPlans(deps.plans)),
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
  ]);

  if (plansResult.error) failed('plans', plansResult.error);
  if (payingResult.error) failed('paying_status', payingResult.error);
  if (revenueResult.error) failed('revenue_existence', revenueResult.error);
  if (windowResult.error) failed('ledger_window', windowResult.error);
  if (k1Current.error) failed('ledger_k1_current', k1Current.error);
  if (k1Previous?.error) failed('ledger_k1_previous', k1Previous.error);

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

  // ── 6. Tiles ──────────────────────────────────────────────────────────────
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
      k3: tile('k3_founding_no_end_date', k3Colour, k3Value),
      k5: tile('k5_our_revenue', k5Colour, null),
    },
    revenue,
    accounts,
    aiCost,
  };

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
