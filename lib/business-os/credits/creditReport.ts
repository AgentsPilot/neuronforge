/**
 * The operator cost report — what Business OS actions cost us and what we
 * charged, per account and billing period (credit deduction slice 4a, FR-33,
 * FR-12c, AC-23 report half). Workplan §4.1 to §4.4.
 *
 * READ-ONLY. No write, no LLM call, no audit entry. Reads the ledger through
 * `BusinessOsCreditLedgerReadRepository` and aggregates in Node, with a read
 * ceiling and an explicit "incomplete" state (the `llmUsageReport.ts`
 * approach, SA Q-4); the aggregate RPC is the scale path (R-3).
 *
 * TENANT SCOPE. Called only from the admin-gated report route, after Zod has
 * validated the window and refused a platform account. The all-accounts totals
 * read is used only when no account was chosen. Business names are looked up
 * by the ROUTE (`findNames`, injected): the admin identity reads may be called
 * only from `app/api/admin/**` (repository guard `adminReadMethods`).
 *
 * WHOLE PERIODS. The window selects which periods are shown; each period's
 * figures are the whole period's, so they never depend on where the window
 * edge fell.
 *
 * LIKE WITH LIKE (SA S-7). Each totals row is compared with its rows by the
 * totals row's own rules: owner / scheduled / external over CHARGE rows by
 * their own trigger, adjustment over ADJUSTMENT rows, total and cost over all
 * rows, counts over charge rows. The breakdowns instead put a correction under
 * the charge it corrects (N-10, Q-5) and are labelled "net, including
 * corrections" on the screen.
 *
 * EXACT SUMS. Amounts are summed as integers of the column's own scale
 * (credits 6 dp, cost 10 dp), so the cross-check is an equality, not a
 * tolerance, and cannot flag a float rounding as a mismatch.
 * The bound (SA CR-N1): a JS number holds integers exactly only below 2^53,
 * so each SUM stays exact up to about $900,719 of cost (2^53 / 10^10) and
 * about 9 billion credits (2^53 / 10^6); `Number()` of one numeric string is
 * exact to about 15 significant digits. Far above today's volumes. Before any
 * one sum can approach it, the aggregate RPC (R-3) must take over.
 *
 * ONE READ WINDOW (SA CR-B1). Totals AND rows are read with the same
 * day-granular, half-open window on `period_start`:
 * `[window start - 31 days, window end)`. Never a range rebuilt from the
 * periods read: `period_start` is a microsecond `timestamptz`, a JS Date is
 * milliseconds, and a bound built from a parsed `period_start` lands below the
 * real value and drops that period's rows.
 *
 * NEVER GROUPS ON THE RAW `service` COLUMN (N-10): every grouping goes through
 * `resolveEffectiveFields`. A source test enforces it.
 *
 * @module lib/business-os/credits/creditReport
 */

import {
  businessOsCreditLedgerReadRepository,
  type BusinessOsCreditLedgerReadRepository,
  type CreditLedgerRow,
  type CreditTotalsRow,
} from '@/lib/repositories/BusinessOsCreditLedgerReadRepository';
import { resolveEffectiveFields, type EffectiveFields } from './effectiveFields';
import { FEW_EXAMPLES_BELOW, spreadOf } from './percentiles';
import type {
  CreditBreakdownLine,
  CreditBreakdowns,
  CreditFallbackItem,
  CreditPeriodFigures,
  CreditPeriodLine,
  CreditReport,
  CreditReportIncompleteReason,
  CreditReportSectionStatus,
  CreditSpreadLine,
} from './creditReportTypes';

export const CREDIT_REPORT_LIMITS = {
  MAX_WINDOW_DAYS: 92,
  DEFAULT_WINDOW_DAYS: 30,
  /** A billing period is at most 31 days (anchor + n months, day clamped). */
  PERIOD_LOOKBACK_DAYS: 31,
  PAGE_SIZE: 1000,
  TOTALS_CEILING: 2000,
  ROWS_CEILING: 20_000,
  /** Originals of corrections fetched from other periods, per report. */
  ORIGINALS_MAX: 1000,
  ORIGINALS_PER_REQUEST: 200,
  FALLBACK_LIST_MAX: 50,
} as const;

/** The one reconciliation reason code (part 4c, SA B-2). */
export const FALLBACK_RECONCILED_REASON = 'fallback_price_reconciled';

const DAY_MS = 24 * 60 * 60 * 1000;
const CREDIT_SCALE = 1e6;
const COST_SCALE = 1e10;

export interface CreditReportLogger {
  error: (ctx: Record<string, unknown>, msg: string) => void;
  warn: (ctx: Record<string, unknown>, msg: string) => void;
}

export interface AccountName {
  user_id: string;
  company_name: string | null;
}

type RepoResult<T> = { data: T | null; error: Error | null };

export interface CreditReportDeps {
  /** Defaults to the read repository's singleton. */
  ledger?: Pick<
    BusinessOsCreditLedgerReadRepository,
    'listTotalsForPeriodsInRange' | 'listTotalsForAccountInRange' | 'listRowsForAccountPeriods' | 'findChargesByActionIds'
  >;
  /** Business names for display. Supplied by the admin route; required, no default (see header). */
  findNames: (accountIds: readonly string[]) => Promise<RepoResult<AccountName[]>>;
  now?: () => Date;
}

export interface CreditReportWindow {
  /** Inclusive UTC dates, `YYYY-MM-DD`. */
  from: string;
  to: string;
}

export interface BuildCreditReportInput {
  window: CreditReportWindow;
  accountId: string | null;
}

/** `[start, end)` of an inclusive UTC date window. */
export function windowInstants(window: CreditReportWindow): { start: Date; end: Date } {
  const start = new Date(`${window.from}T00:00:00.000Z`);
  const end = new Date(new Date(`${window.to}T00:00:00.000Z`).getTime() + DAY_MS);
  return { start, end };
}

// ============ Amounts ============

/** Integer units of `scale`; `NaN` for an unreadable value (counted by the caller). */
function toUnits(value: number | string | null | undefined, scale: number): number {
  const n = typeof value === 'number' ? value : typeof value === 'string' && value.trim() !== '' ? Number(value) : NaN;
  return Number.isFinite(n) ? Math.round(n * scale) : NaN;
}

interface UnitFigures {
  creditsTotal: number;
  creditsOwner: number;
  creditsScheduled: number;
  creditsExternal: number;
  creditsAdjustment: number;
  costUsd: number;
  charges: number;
  fallbackPriced: number;
}

const zeroUnits = (): UnitFigures => ({
  creditsTotal: 0,
  creditsOwner: 0,
  creditsScheduled: 0,
  creditsExternal: 0,
  creditsAdjustment: 0,
  costUsd: 0,
  charges: 0,
  fallbackPriced: 0,
});

function toFigures(u: UnitFigures): CreditPeriodFigures {
  return {
    creditsTotal: u.creditsTotal / CREDIT_SCALE,
    creditsOwner: u.creditsOwner / CREDIT_SCALE,
    creditsScheduled: u.creditsScheduled / CREDIT_SCALE,
    creditsExternal: u.creditsExternal / CREDIT_SCALE,
    creditsAdjustment: u.creditsAdjustment / CREDIT_SCALE,
    costUsd: u.costUsd / COST_SCALE,
    charges: u.charges,
    fallbackPriced: u.fallbackPriced,
  };
}

function addUnits(into: UnitFigures, add: UnitFigures): void {
  (Object.keys(into) as (keyof UnitFigures)[]).forEach((k) => {
    into[k] += add[k];
  });
}

function unitsEqual(a: UnitFigures, b: UnitFigures): boolean {
  return (Object.keys(a) as (keyof UnitFigures)[]).every((k) => a[k] === b[k]);
}

const pairKey = (userId: string | null, periodStart: string) => `${userId}|${Date.parse(periodStart)}`;

// ============ The report ============

function emptyReport(
  input: BuildCreditReportInput,
  now: Date,
  sections: CreditReport['sections']
): CreditReport {
  const { start, end } = windowInstants(input.window);
  const zero = toFigures(zeroUnits());
  return {
    generatedAt: now.toISOString(),
    window: { from: input.window.from, to: input.window.to, start: start.toISOString(), end: end.toISOString() },
    accountFilter: input.accountId,
    periodLookbackDays: CREDIT_REPORT_LIMITS.PERIOD_LOOKBACK_DAYS,
    incomplete: false,
    incompleteReasons: [],
    limits: {
      totalsCeiling: CREDIT_REPORT_LIMITS.TOTALS_CEILING,
      rowsCeiling: CREDIT_REPORT_LIMITS.ROWS_CEILING,
      originalsMax: CREDIT_REPORT_LIMITS.ORIGINALS_MAX,
      fallbackListMax: CREDIT_REPORT_LIMITS.FALLBACK_LIST_MAX,
      fewExamplesBelow: FEW_EXAMPLES_BELOW,
    },
    sections,
    rowsRead: null,
    accounts: [],
    periods: [],
    grandTotal: { stored: zero, fromRows: null },
    mismatchedPeriods: 0,
    breakdowns: null,
    unresolvedCorrections: { count: 0, credits: 0, costUsd: 0 },
    fallback: { count: 0, reconciled: 0, items: [] },
    spreads: [],
    unreadableAmounts: 0,
  };
}

export async function buildCreditReport(
  input: BuildCreditReportInput,
  log: CreditReportLogger,
  deps: CreditReportDeps
): Promise<CreditReport> {
  const ledger = deps.ledger ?? businessOsCreditLedgerReadRepository;
  const now = (deps.now ?? (() => new Date()))();
  const { start, end } = windowInstants(input.window);
  // Half-open, whole days: the ONE range both reads use (CR-B1, header).
  const periodRange = {
    from: new Date(start.getTime() - CREDIT_REPORT_LIMITS.PERIOD_LOOKBACK_DAYS * DAY_MS),
    to: end,
  };
  const paging = { pageSize: CREDIT_REPORT_LIMITS.PAGE_SIZE, ceiling: CREDIT_REPORT_LIMITS.TOTALS_CEILING };
  const incompleteReasons: CreditReportIncompleteReason[] = [];
  let unreadable = 0;
  const units = (value: number | string | null | undefined, scale: number): number => {
    const u = toUnits(value, scale);
    if (Number.isNaN(u)) {
      unreadable++;
      return 0;
    }
    return u;
  };

  // ---- 1. Totals: the stored truth, and the list of periods to show ----
  let totalsResult: RepoResult<{ rows: CreditTotalsRow[]; reachedCeiling: boolean }>;
  try {
    totalsResult = input.accountId
      ? await ledger.listTotalsForAccountInRange(input.accountId, periodRange, paging)
      : await ledger.listTotalsForPeriodsInRange(periodRange, paging);
  } catch (err) {
    totalsResult = { data: null, error: err instanceof Error ? err : new Error(String(err)) };
  }
  if (totalsResult.error || !totalsResult.data) {
    log.error({ err: totalsResult.error, read: 'credit totals' }, 'Credit report read failed');
    return emptyReport(input, now, { totals: 'failed', rows: 'skipped', names: 'skipped', originals: 'skipped' });
  }
  // `reachedCeiling` is true at EXACTLY the ceiling too (both reads, `>=`):
  // a full last page cannot be told from a cut one, so it counts as incomplete.
  const totalsIncomplete = totalsResult.data.reachedCeiling;
  if (totalsIncomplete) incompleteReasons.push('totals_ceiling');

  const totals = totalsResult.data.rows;
  if (totals.length === 0) {
    const report = emptyReport(input, now, { totals: 'ok', rows: 'skipped', names: 'skipped', originals: 'skipped' });
    return { ...report, incomplete: incompleteReasons.length > 0, incompleteReasons };
  }

  const accountIds = [...new Set(totals.map((t) => t.user_id))];

  // ---- 2. Rows and names, in parallel; one failing never hides the other ----
  // Each call starts inside its own promise, so even a SYNCHRONOUS throw fails
  // only its own section (QA edge 7), never the whole request.
  const [rowsOutcome, namesOutcome] = await Promise.allSettled([
    Promise.resolve().then(() =>
      ledger.listRowsForAccountPeriods(accountIds, periodRange, {
        pageSize: CREDIT_REPORT_LIMITS.PAGE_SIZE,
        ceiling: CREDIT_REPORT_LIMITS.ROWS_CEILING,
      })
    ),
    Promise.resolve().then(() => deps.findNames(accountIds)),
  ]);

  let rowsStatus: CreditReportSectionStatus = 'ok';
  let rows: CreditLedgerRow[] | null = null;
  let rowsIncomplete = false;
  if (rowsOutcome.status === 'fulfilled' && !rowsOutcome.value.error && rowsOutcome.value.data) {
    rows = rowsOutcome.value.data.rows;
    rowsIncomplete = rowsOutcome.value.data.reachedCeiling;
    if (rowsIncomplete) incompleteReasons.push('rows_ceiling');
  } else {
    rowsStatus = 'failed';
    log.error(
      { err: rowsOutcome.status === 'rejected' ? rowsOutcome.reason : rowsOutcome.value.error, read: 'credit ledger rows' },
      'Credit report read failed'
    );
  }

  let namesStatus: CreditReportSectionStatus = 'ok';
  const names = new Map<string, string | null>();
  if (namesOutcome.status === 'fulfilled' && !namesOutcome.value.error && namesOutcome.value.data) {
    for (const n of namesOutcome.value.data) names.set(n.user_id, n.company_name);
  } else {
    namesStatus = 'failed';
    // Display data only: the report continues without names.
    log.warn(
      { err: namesOutcome.status === 'rejected' ? namesOutcome.reason : namesOutcome.value.error, read: 'business names' },
      'Credit report business-name lookup failed; report continues without names'
    );
  }
  const nameOf = (accountId: string | null) => (accountId ? names.get(accountId) ?? null : null);

  // Only the rows of the accounts being shown. A row of a shown account whose
  // period has NO totals row is an invariant break: it is kept and reported,
  // never dropped (unless the totals read was cut short, CR-S1, below).
  const totalsKeys = new Set(totals.map((t) => pairKey(t.user_id, t.period_start)));
  const accountSet = new Set(accountIds);
  const shownRows = (rows ?? []).filter((r) => r.user_id !== null && accountSet.has(r.user_id));

  // ---- 3. Originals of corrections that sit outside the rows read ----
  const chargesByActionId = new Map<string, CreditLedgerRow>();
  for (const r of shownRows) if (r.kind === 'charge' && r.action_id) chargesByActionId.set(r.action_id, r);

  let originalsStatus: CreditReportSectionStatus = rows ? 'ok' : 'skipped';
  const missing = [
    ...new Set(
      shownRows
        .filter((r) => r.kind === 'adjustment' && r.adjusts_action_id && !chargesByActionId.has(r.adjusts_action_id))
        .map((r) => r.adjusts_action_id as string)
    ),
  ];
  if (missing.length > CREDIT_REPORT_LIMITS.ORIGINALS_MAX) incompleteReasons.push('originals_ceiling');
  const toFetch = missing.slice(0, CREDIT_REPORT_LIMITS.ORIGINALS_MAX);
  for (let i = 0; i < toFetch.length; i += CREDIT_REPORT_LIMITS.ORIGINALS_PER_REQUEST) {
    const chunk = toFetch.slice(i, i + CREDIT_REPORT_LIMITS.ORIGINALS_PER_REQUEST);
    let result: RepoResult<CreditLedgerRow[]>;
    try {
      result = await ledger.findChargesByActionIds(chunk);
    } catch (err) {
      result = { data: null, error: err instanceof Error ? err : new Error(String(err)) };
    }
    if (result.error || !result.data) {
      originalsStatus = 'failed';
      log.error({ err: result.error, read: 'correction originals' }, 'Credit report read failed');
      break;
    }
    for (const r of result.data) if (r.action_id) chargesByActionId.set(r.action_id, r);
  }

  // ---- 4. Periods: stored vs rebuilt, by the totals row's own rules ----
  const rebuilt = new Map<string, UnitFigures>();
  for (const r of shownRows) {
    const key = pairKey(r.user_id, r.period_start);
    const u = rebuilt.get(key) ?? zeroUnits();
    const credits = units(r.credits, CREDIT_SCALE);
    u.creditsTotal += credits;
    u.costUsd += units(r.cost_usd, COST_SCALE);
    if (r.kind === 'adjustment') {
      u.creditsAdjustment += credits;
    } else {
      u.charges += 1;
      if (r.is_fallback_priced) u.fallbackPriced += 1;
      // The charge's OWN trigger: the totals row's rule, not the inherited one.
      if (r.triggered_by === 'owner') u.creditsOwner += credits;
      else if (r.triggered_by === 'scheduled') u.creditsScheduled += credits;
      else if (r.triggered_by === 'external') u.creditsExternal += credits;
    }
    rebuilt.set(key, u);
  }

  const storedUnits = (t: CreditTotalsRow): UnitFigures => ({
    creditsTotal: units(t.credits_total, CREDIT_SCALE),
    creditsOwner: units(t.credits_owner, CREDIT_SCALE),
    creditsScheduled: units(t.credits_scheduled, CREDIT_SCALE),
    creditsExternal: units(t.credits_external, CREDIT_SCALE),
    creditsAdjustment: units(t.credits_adjustment, CREDIT_SCALE),
    costUsd: units(t.cost_usd_total, COST_SCALE),
    charges: Number(t.charge_count) || 0,
    fallbackPriced: Number(t.fallback_priced_count) || 0,
  });

  const canCheck = rows !== null && !rowsIncomplete;
  const grandStored = zeroUnits();
  const grandRows = zeroUnits();
  let mismatched = 0;
  const periods: CreditPeriodLine[] = totals.map((t) => {
    const stored = storedUnits(t);
    addUnits(grandStored, stored);
    const fromRows = rows === null ? null : rebuilt.get(pairKey(t.user_id, t.period_start)) ?? zeroUnits();
    if (fromRows) addUnits(grandRows, fromRows);
    const matches = canCheck && fromRows ? unitsEqual(stored, fromRows) : null;
    if (matches === false) mismatched++;
    return {
      accountId: t.user_id,
      companyName: nameOf(t.user_id),
      periodStart: t.period_start,
      stored: toFigures(stored),
      fromRows: fromRows ? toFigures(fromRows) : null,
      matches,
    };
  });
  for (const [key, u] of rebuilt) {
    if (totalsKeys.has(key)) continue;
    const sample = shownRows.find((r) => pairKey(r.user_id, r.period_start) === key) as CreditLedgerRow;
    addUnits(grandRows, u);
    // CR-S1: when the totals read stopped at its ceiling, a period without a
    // totals row most likely has one that was not read. That is "not checked",
    // never a mismatch. Otherwise it is a real invariant break.
    const orphanMatches = totalsIncomplete ? null : false;
    if (orphanMatches === false) mismatched++;
    periods.push({
      accountId: sample.user_id as string,
      companyName: nameOf(sample.user_id),
      periodStart: sample.period_start,
      stored: null,
      fromRows: toFigures(u),
      matches: orphanMatches,
    });
  }
  periods.sort(
    (a, b) =>
      Date.parse(b.periodStart) - Date.parse(a.periodStart) ||
      (a.companyName ?? '￿').localeCompare(b.companyName ?? '￿') ||
      a.accountId.localeCompare(b.accountId)
  );

  // ---- 5. Breakdowns (net, including corrections), fallback list, spreads ----
  let breakdowns: CreditBreakdowns | null = null;
  const unresolvedUnits = { count: 0, credits: 0, cost: 0 };
  const fallbackRows: CreditLedgerRow[] = [];
  const reconciledIds = new Set<string>();
  const spreadGroups = new Map<
    string,
    { fields: EffectiveFields; cost: number[]; credits: number[]; failed: number; fallbackExcluded: number }
  >();

  if (rows !== null) {
    type Acc = { line: CreditBreakdownLine; credits: number; cost: number; corrCredits: number; corrCost: number };
    const dims = {
      byActionType: new Map<string, Acc>(),
      byArea: new Map<string, Acc>(),
      byService: new Map<string, Acc>(),
      byTrigger: new Map<string, Acc>(),
    };
    const bump = (map: Map<string, Acc>, key: string | null, unresolved: boolean, r: CreditLedgerRow) => {
      const id = unresolved ? '\u0000unresolved' : key === null ? '\u0000none' : key;
      const acc =
        map.get(id) ??
        ({
          line: {
            key: unresolved ? null : key,
            unresolved,
            charges: 0,
            failedCharges: 0,
            corrections: 0,
            credits: 0,
            costUsd: 0,
            correctionCredits: 0,
            correctionCostUsd: 0,
          },
          credits: 0,
          cost: 0,
          corrCredits: 0,
          corrCost: 0,
        } as Acc);
      const credits = toUnits(r.credits, CREDIT_SCALE) || 0;
      const cost = toUnits(r.cost_usd, COST_SCALE) || 0;
      acc.credits += credits;
      acc.cost += cost;
      if (r.kind === 'adjustment') {
        acc.line.corrections += 1;
        acc.corrCredits += credits;
        acc.corrCost += cost;
      } else {
        acc.line.charges += 1;
        if (r.outcome === 'failed') acc.line.failedCharges += 1;
      }
      map.set(id, acc);
    };

    for (const r of shownRows) {
      const f = resolveEffectiveFields(r, chargesByActionId);
      const unresolved = !f.resolved;
      if (unresolved) {
        unresolvedUnits.count += 1;
        unresolvedUnits.credits += toUnits(r.credits, CREDIT_SCALE) || 0;
        unresolvedUnits.cost += toUnits(r.cost_usd, COST_SCALE) || 0;
      }
      bump(dims.byActionType, f.effectiveActionType, unresolved, r);
      bump(dims.byArea, f.effectiveArea, unresolved, r);
      bump(dims.byService, f.effectiveService, unresolved, r);
      bump(dims.byTrigger, f.effectiveTrigger, unresolved, r);

      // Only a RESOLVED correction reconciles a charge: an unresolved one
      // (charge not found, or on another account, D-2) must not mark any
      // account's charge as reconciled (QA Low 4).
      if (r.kind === 'adjustment' && r.reason_code === FALLBACK_RECONCILED_REASON && r.adjusts_action_id && f.resolved) {
        reconciledIds.add(r.adjusts_action_id);
      }
      if (r.kind === 'charge') {
        if (r.is_fallback_priced) fallbackRows.push(r);
        const groupKey = `${f.effectiveService}|${f.effectiveActionType}`;
        const g = spreadGroups.get(groupKey) ?? { fields: f, cost: [], credits: [], failed: 0, fallbackExcluded: 0 };
        if (r.is_fallback_priced) g.fallbackExcluded += 1;
        else if (r.outcome === 'failed') g.failed += 1;
        else if (r.outcome === 'succeeded') {
          g.cost.push((toUnits(r.cost_usd, COST_SCALE) || 0) / COST_SCALE);
          g.credits.push((toUnits(r.credits, CREDIT_SCALE) || 0) / CREDIT_SCALE);
        }
        spreadGroups.set(groupKey, g);
      }
    }

    const finish = (map: Map<string, Acc>): CreditBreakdownLine[] =>
      [...map.values()]
        .map((acc) => ({
          ...acc.line,
          credits: acc.credits / CREDIT_SCALE,
          costUsd: acc.cost / COST_SCALE,
          correctionCredits: acc.corrCredits / CREDIT_SCALE,
          correctionCostUsd: acc.corrCost / COST_SCALE,
        }))
        .sort(
          (a, b) =>
            Number(a.unresolved) - Number(b.unresolved) ||
            b.credits - a.credits ||
            (a.key ?? '').localeCompare(b.key ?? '')
        );
    breakdowns = {
      byActionType: finish(dims.byActionType),
      byArea: finish(dims.byArea),
      byService: finish(dims.byService),
      byTrigger: finish(dims.byTrigger),
    };
  }

  fallbackRows.sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
  const fallbackItems: CreditFallbackItem[] = fallbackRows
    .slice(0, CREDIT_REPORT_LIMITS.FALLBACK_LIST_MAX)
    .map((r) => ({
      accountId: r.user_id as string,
      companyName: nameOf(r.user_id),
      createdAt: r.created_at,
      actionType: r.action_type,
      groupId: r.group_id,
      actionId: r.action_id,
      credits: (toUnits(r.credits, CREDIT_SCALE) || 0) / CREDIT_SCALE,
      costUsd: (toUnits(r.cost_usd, COST_SCALE) || 0) / COST_SCALE,
      reconciled: r.action_id !== null && reconciledIds.has(r.action_id),
    }));

  const spreads: CreditSpreadLine[] = [...spreadGroups.values()]
    .map((g) => {
      const cost = spreadOf(g.cost);
      const credits = spreadOf(g.credits);
      return {
        service: g.fields.effectiveService,
        actionType: g.fields.effectiveActionType,
        area: g.fields.effectiveArea,
        examples: cost.examples,
        failed: g.failed,
        fallbackExcluded: g.fallbackExcluded,
        fewExamples: cost.fewExamples,
        costUsd: { p50: cost.p50, p90: cost.p90 },
        credits: { p50: credits.p50, p90: credits.p90 },
      };
    })
    .sort((a, b) => b.examples - a.examples || (a.actionType ?? '').localeCompare(b.actionType ?? ''));

  const base = emptyReport(input, now, {
    totals: 'ok',
    rows: rowsStatus,
    names: namesStatus,
    originals: originalsStatus,
  });
  const accounts = accountIds
    .map((accountId) => ({ accountId, companyName: nameOf(accountId) }))
    .sort(
      (a, b) =>
        (a.companyName ?? '￿').localeCompare(b.companyName ?? '￿') || a.accountId.localeCompare(b.accountId)
    );

  return {
    ...base,
    incomplete: incompleteReasons.length > 0,
    incompleteReasons,
    rowsRead: rows === null ? null : shownRows.length,
    accounts,
    periods,
    grandTotal: { stored: toFigures(grandStored), fromRows: rows === null ? null : toFigures(grandRows) },
    mismatchedPeriods: mismatched,
    breakdowns,
    unresolvedCorrections: {
      count: unresolvedUnits.count,
      credits: unresolvedUnits.credits / CREDIT_SCALE,
      costUsd: unresolvedUnits.cost / COST_SCALE,
    },
    fallback: {
      count: fallbackRows.length,
      reconciled: fallbackRows.filter((r) => r.action_id !== null && reconciledIds.has(r.action_id)).length,
      items: fallbackItems,
    },
    spreads,
    unreadableAmounts: unreadable,
  };
}
