/**
 * Account economics and AI margin (finance & business health slice 6a, Money
 * M-3, §11E, M3-W-1 to M3-W-9, M3-FR-1 to M3-FR-16). Workplan
 * docs/workplans/BUSINESS_OS_FINANCE_HEALTH_SLICE_6A_MONEY_M3_WORKPLAN.md
 * § M3.3.
 *
 * PURE (SA-WR-4): every input is a parameter; no clock, no I/O. Its input is
 * STRUCTURAL (SA-W22): it takes the rows the orchestrator already read, the AI
 * cost as the non-wire `units` map of the Section 3 pass (SA-Q46), Section 4's
 * rows before their cap (SA-W78) and the plan groups as callbacks. It names no
 * ledger row type and no table.
 *
 * PAID US, AFTER TAX (M3-W-2, E-45, BD-22). Money is read ONLY through the two
 * exported readers (SA-Q45), filtered by the exported paid family and kind
 * (never a status or kind literal here), in integer minor units of its own
 * currency:
 *   - a plan invoice: amount minus tax (a zero invoice is not a payment);
 *   - a boost: with net = total minus refunded, held and lost: net 0 is 0; no
 *     refund gives net minus tax, and tax above net is INEXACT (SA-W81 (i));
 *     no tax gives net; any other row (a partial refund of a taxed boost) is
 *     INEXACT (SA-Q47). The rule reads the reader's result only: no status.
 * Lines come from `groupByCurrency`. NOTHING here adds two currencies (BD-12).
 *
 * THE MARGIN (SA-W75). Revenue is integer minor units (two decimals, behind
 * the readers' `minorUnitsPerMajor === 100` gate); the charged cost is integer
 * ledger units at COST_SCALE. The one common scale is the ledger's:
 * MINOR_TO_COST_UNITS = COST_SCALE / CURRENCY_SCALE = 1e8, an exact integer.
 * The subtraction is integer and checked with Number.isSafeInteger; leaving
 * the safe range (about USD 900,719 for revenue times 1e8 and for cost units
 * alike, the same bound aiCost.ts has) gives Unknown, never a wrong figure
 * (SA-WR-41). The result is divided ONCE, by COST_SCALE, at the edge.
 *
 * PRECEDENCE (SA-W82), rows and the platform line alike: Not available (the
 * window starts before the charging cut-over) > n/a, different currency (any
 * normalised non-USD line) > Unknown (a failed or ceiling read, an inexact
 * cost or USD line, an Unknown-currency line, an overflow) > the figure.
 *
 * SLICE 6b (§11K, FE-1 to FE-17, E-72 to E-74): "Margin after Stripe fees
 * (estimate)", BESIDE the AI margin, never replacing it. A charge is a counted
 * plan payment above 0 or a paid-family boost with a total above 0 (E-72); its
 * fee is estimated on the GROSS charged (tax included), per charge, by
 * `estimateChargeFeeMinor` from the config passed in (`feeEstimate`: data, no
 * fee number here, SA-WR-4). The fee belongs to the CHARGE: a refund or a
 * dispute never removes or re-dates it (FE-5 to FE-7, SA-W-6b-11). The fee is
 * subtracted from the revenue in minor units BEFORE the one scale step, through
 * the one `marginUnitsOf` (E-74), so `(r − f)·k − c` equals `(r·k − c) − f·k`
 * exactly and the AI margin's value is unchanged. When the AI margin is not a
 * figure, the margin after fees takes its word; an invalid config is Unknown
 * (E-73). Sort and filter still read the AI margin (FE-15).
 *
 * @module lib/business-os/finance/accountEconomics
 */

import { COST_SCALE } from '@/lib/business-os/credits/creditReport';
import { BOOST_PAID_FAMILY, readMoney, type BoostPurchaseInput } from './boostRevenue';
import { PLAN_PAYMENT_KIND, readPlanMoney, type PlanPaymentInput } from './planRevenue';
import { CURRENCY_SCALE, groupByCurrency, normaliseCurrencyCode, type CurrencyLine } from './currencyGroups';
import type { AiCostUnitBucket, AiCostUnits } from './aiCost';
import type { CreditsSectionRow } from './creditsSection';
import { estimateChargeFeeMinor, feeEstimateNoteOf, stripeFeeEntryOf, type FeeEstimateEntry } from './financeRules';
import type {
  FinanceAccountEconomicsSection,
  FinanceAccountMargin,
  FinanceAccountsTabQuery,
  FinanceCoverage,
  FinanceEconomicsCost,
  FinanceEconomicsCredits,
  FinanceEconomicsDeletedRow,
  FinanceEconomicsPaid,
  FinanceEconomicsPaidLine,
  FinanceEconomicsRow,
  FinanceGroupKey,
  FinanceMarginAfterFeesValue,
  FinanceMarginValue,
} from './financeTypes';

/** BD-12 / BD-22: the only currency a margin exists in (the ledger is USD by construction, CUR-5). */
const MARGIN_CURRENCY = 'USD';

/** SA-W75: minor units (hundredths) → ledger cost units. 1e10 / 1e2 = 1e8, exact. */
const MINOR_TO_COST_UNITS = COST_SCALE / CURRENCY_SCALE;

const PAID_FAMILY: ReadonlySet<string> = new Set<string>(BOOST_PAID_FAMILY);

const FIELDS = ['planAfterTax', 'boostsAfterTax', 'afterTax'] as const;
type Field = (typeof FIELDS)[number];
type Entry = { currency: unknown; field: Field; hundredths: number | null };

/** The one division of revenue to the wire, valid because the readers admit two-decimal currencies only. */
const moneyOfMinor = (minor: number): number => minor / CURRENCY_SCALE;
/** The one division of ledger units to USD on the wire (Section 3's own conversion). */
const usdOfUnits = (units: number): number => units / COST_SCALE;

/** The structural input. A null read is a failed read. */
export interface AccountEconomicsInput {
  /** Section 3's coverage, from the charging cut-over clamp. */
  coverage: FinanceCoverage;
  aiCost: { units: AiCostUnits; reachedCeiling: boolean } | null;
  boosts: { rows: readonly BoostPurchaseInput[]; reachedCeiling: boolean } | null;
  plans: { rows: readonly PlanPaymentInput[]; reachedCeiling: boolean } | null;
  /** The plan walk's ids; null when the walk failed. */
  walk: { accountIds: readonly string[]; capped: boolean } | null;
  groupOf: (accountId: string) => FinanceGroupKey | undefined;
  foundingPartner: (accountId: string) => boolean;
  tierLabelOf: (key: FinanceGroupKey) => string | null;
  /** Section 4's rows before the cap; null when no positions pass ran or it failed. */
  credits: ReadonlyMap<string, CreditsSectionRow> | null;
  isPlatform: (accountId: string) => boolean;
  query: FinanceAccountsTabQuery;
  cap: number;
  groupOptions: ReadonlyArray<{ key: FinanceGroupKey; tierLabel: string | null }>;
  /** The S4-W-3 condition, from the boost builder over the same read (one definition). */
  refundOrDispute: boolean;
  /** Slice 6b (FE-4): the assumed card fee config, as data; validated here, never trusted. */
  feeEstimate: unknown;
}

/** One account's money entries, before grouping. */
interface MoneyOf {
  entries: Entry[];
  /** Normalised currency → boost rows on it that are inexact (SA-Q47, SA-W81 (i)). */
  inexact: Map<string | null, number>;
  /** Counted revenue rows (a paid-family boost, a plan payment above 0, or an unreadable one). */
  revenueRows: number;
  /** Slice 6b (FE-1, E-72): the gross minor units of each readable charge above 0, tax included. */
  charges: number[];
}

const emptyMoney = (): MoneyOf => ({ entries: [], inexact: new Map(), revenueRows: 0, charges: [] });

/**
 * E-45 for one readable boost, in minor units, or null when inexact. Reads the
 * reader's result only (no status, no column).
 */
function boostAfterTax(money: NonNullable<ReturnType<typeof readMoney>>): number | null {
  const net = money.total - money.refunded - money.held - money.lost;
  if (net === 0) return 0;
  if (money.refunded === 0) return money.tax > net ? null : net - money.tax;
  if (money.tax === 0) return net;
  return null;
}

function addBoost(target: MoneyOf, row: BoostPurchaseInput): void {
  target.revenueRows += 1;
  const money = readMoney(row);
  if (money === null) {
    target.entries.push({ currency: row.currency, field: 'boostsAfterTax', hundredths: null });
    target.entries.push({ currency: row.currency, field: 'afterTax', hundredths: null });
    return;
  }
  // FE-5 / FE-6: the fee is on the gross charge, whatever happened to it later (E-72: a total of 0 is no charge).
  if (money.total > 0) target.charges.push(money.total);
  const afterTax = boostAfterTax(money);
  if (afterTax === null) {
    const code = normaliseCurrencyCode(row.currency);
    target.inexact.set(code, (target.inexact.get(code) ?? 0) + 1);
    // The line exists, and its total and boost part read Unknown (M3-W-6).
    target.entries.push({ currency: row.currency, field: 'boostsAfterTax', hundredths: 0 });
    return;
  }
  target.entries.push({ currency: row.currency, field: 'boostsAfterTax', hundredths: afterTax });
  target.entries.push({ currency: row.currency, field: 'afterTax', hundredths: afterTax });
}

function addPlan(target: MoneyOf, row: PlanPaymentInput): void {
  const money = readPlanMoney(row);
  if (money === null) {
    target.revenueRows += 1;
    target.entries.push({ currency: row.currency, field: 'planAfterTax', hundredths: null });
    target.entries.push({ currency: row.currency, field: 'afterTax', hundredths: null });
    return;
  }
  // M2-W-5: a readable invoice of 0 is not a payment; it adds nothing and makes no line.
  if (money.amount === 0) return;
  target.revenueRows += 1;
  // FE-2: the gross invoice amount, tax included.
  target.charges.push(money.amount);
  const afterTax = money.amount - money.tax;
  target.entries.push({ currency: row.currency, field: 'planAfterTax', hundredths: afterTax });
  target.entries.push({ currency: row.currency, field: 'afterTax', hundredths: afterTax });
}

/** The read state a figure depends on. */
interface ReadState {
  coverage: FinanceCoverage;
  ledgerFailed: boolean;
  ledgerCeiling: boolean;
  boostsFailed: boolean;
  boostsCeiling: boolean;
  plansFailed: boolean;
  plansCeiling: boolean;
}

interface BuiltPaid {
  wire: FinanceEconomicsPaid;
  /** USD after tax in minor units, exact; null when there is no exact USD line. */
  usdMinor: number | null;
  /** Whether a USD line exists. */
  hasUsd: boolean;
  /** A normalised non-USD line exists. */
  otherCurrency: boolean;
  /** An Unknown-currency line exists. */
  unknownCurrency: boolean;
  /** Any line is not exact, or Unknown. */
  inexact: boolean;
  /** Lines in the comparator's shape: USD first, then other codes ascending. */
  lines: Array<{ currency: string | null; afterTaxMinor: number | null }>;
}

function buildPaid(money: MoneyOf, reads: ReadState): BuiltPaid {
  const failed = reads.boostsFailed || reads.plansFailed;
  const cutOff = reads.boostsCeiling || reads.plansCeiling;
  const grouped: CurrencyLine<Field>[] = groupByCurrency(money.entries, FIELDS);
  let usdMinor: number | null = null;
  let hasUsd = false;
  let otherCurrency = false;
  let unknownCurrency = false;
  let inexact = false;
  const lines: BuiltPaid['lines'] = [];
  const wireLines: FinanceEconomicsPaidLine[] = grouped.map((line) => {
    const inexactRefunds = money.inexact.get(line.currency) ?? 0;
    const unknown = failed || inexactRefunds > 0 || line.currency === null || line.overflow;
    const exact = !cutOff && line.unreadable.afterTax === 0;
    if (unknown || !exact) inexact = true;
    if (line.currency === null) unknownCurrency = true;
    else if (line.currency === MARGIN_CURRENCY) {
      hasUsd = true;
      if (!unknown && exact) usdMinor = line.sums.afterTax;
    } else otherCurrency = true;
    lines.push({ currency: line.currency, afterTaxMinor: unknown ? null : line.sums.afterTax });
    return {
      currency: line.currency,
      afterTax: unknown ? null : moneyOfMinor(line.sums.afterTax),
      exact,
      planAfterTax: reads.plansFailed ? null : moneyOfMinor(line.sums.planAfterTax),
      boostsAfterTax: reads.boostsFailed || inexactRefunds > 0 ? null : moneyOfMinor(line.sums.boostsAfterTax),
    };
  });
  return { wire: { lines: wireLines, failed }, usdMinor, hasUsd, otherCurrency, unknownCurrency, inexact, lines };
}

interface BuiltCost {
  wire: FinanceEconomicsCost;
  /** Integer ledger units when the cost is a figure; null otherwise. */
  units: number | null;
  exact: boolean;
}

function buildCost(bucket: AiCostUnitBucket | undefined, reads: ReadState): BuiltCost {
  if (reads.ledgerFailed) return { wire: { kind: 'unknown' }, units: null, exact: false };
  if (reads.coverage === 'entirely_before_cutover') return { wire: { kind: 'before_cutover' }, units: null, exact: false };
  const cost = bucket?.cost ?? 0;
  if ((bucket?.unreadable ?? 0) > 0 || !Number.isSafeInteger(cost)) return { wire: { kind: 'unknown' }, units: null, exact: false };
  const exact = !reads.ledgerCeiling;
  return { wire: { kind: 'figure', costUsd: usdOfUnits(cost), exact }, units: cost, exact };
}

/**
 * SA-W75's integer subtraction, the ONE scale step (E-74): revenue in minor
 * units to ledger units, minus the cost. Null when either leaves the safe range.
 */
function marginUnitsOf(revenueMinor: number, costUnits: number): number | null {
  const revenueUnits = revenueMinor * MINOR_TO_COST_UNITS;
  const marginUnits = revenueUnits - costUnits;
  if (!Number.isSafeInteger(revenueUnits) || !Number.isSafeInteger(marginUnits)) return null;
  return marginUnits;
}

/** Slice 6b (FE-2, SA-Q83): every charge's fee, rounded per charge, then summed; null when not exact. */
function buildFees(charges: readonly number[], entry: FeeEstimateEntry | null): number | null {
  if (entry === null) return null;
  let total = 0;
  for (const gross of charges) {
    const fee = estimateChargeFeeMinor(gross, entry);
    if (fee === null) return null;
    total += fee;
    if (!Number.isSafeInteger(total)) return null;
  }
  return total;
}

interface BuiltMargins {
  margin: FinanceMarginValue;
  marginAfterFees: FinanceMarginAfterFeesValue;
}

/**
 * SA-W82's precedence, then SA-W75's integer subtraction; then (6b) the same
 * subtraction with the estimated fees taken off the revenue first (E-74). The
 * margin after fees is a figure only when the AI margin is one (FE-9).
 */
function buildMargins(paid: BuiltPaid, cost: BuiltCost, reads: ReadState, charges: readonly number[], entry: FeeEstimateEntry | null): BuiltMargins {
  const word = (kind: 'not_available' | 'other_currency' | 'unknown'): BuiltMargins => ({ margin: { kind }, marginAfterFees: { kind } });
  if (reads.coverage !== 'after_cutover') return word('not_available');
  if (paid.otherCurrency) return word('other_currency');
  const readsCut =
    reads.ledgerFailed || reads.ledgerCeiling || reads.boostsFailed || reads.boostsCeiling || reads.plansFailed || reads.plansCeiling;
  if (readsCut || !cost.exact || cost.units === null || paid.unknownCurrency) return word('unknown');
  if (paid.hasUsd && paid.usdMinor === null) return word('unknown');
  const revenueMinor = paid.usdMinor ?? 0;
  const marginUnits = marginUnitsOf(revenueMinor, cost.units);
  if (marginUnits === null) return word('unknown');
  const noRevenue = !paid.hasUsd;
  const margin: FinanceMarginValue = { kind: 'figure', marginUsd: usdOfUnits(marginUnits), noRevenue };
  const fees = buildFees(charges, entry);
  const afterFeesUnits = fees === null ? null : marginUnitsOf(revenueMinor - fees, cost.units);
  if (fees === null || afterFeesUnits === null) return { margin, marginAfterFees: { kind: 'unknown' } };
  return {
    margin,
    marginAfterFees: { kind: 'figure', afterFeesUsd: usdOfUnits(afterFeesUnits), feesUsd: moneyOfMinor(fees), currency: MARGIN_CURRENCY, noRevenue },
  };
}

function creditsCell(id: string, noPlanRow: boolean, credits: ReadonlyMap<string, CreditsSectionRow> | null): FinanceEconomicsCredits {
  if (noPlanRow) return { kind: 'no_plan_row' };
  const row = credits?.get(id);
  if (!row) return { kind: 'unknown' };
  if (row.kind === 'no_allowance') return { kind: 'no_allowance' };
  if (row.kind !== 'position' || row.used === null || row.allowance === null || row.usedTenths === null) return { kind: 'unknown' };
  return { kind: 'position', used: row.used, allowance: row.allowance, usedTenths: row.usedTenths };
}

/** The reads a margin depends on: the same four for the tab and for the picked business, plus the 6b fee config. */
type MarginReads = Pick<AccountEconomicsInput, 'coverage' | 'aiCost' | 'boosts' | 'plans' | 'feeEstimate'>;

function readStateOf(input: MarginReads): ReadState {
  return {
    coverage: input.coverage,
    ledgerFailed: input.aiCost === null,
    ledgerCeiling: input.aiCost?.reachedCeiling ?? false,
    boostsFailed: input.boosts === null,
    boostsCeiling: input.boosts?.reachedCeiling ?? false,
    plansFailed: input.plans === null,
    plansCeiling: input.plans?.reachedCeiling ?? false,
  };
}

/** Every counted money row, per account id (NULL = deleted accounts), plus the platform-wide entries. */
function moneyByAccount(input: AccountEconomicsInput): { byAccount: Map<string | null, MoneyOf>; all: MoneyOf } {
  const byAccount = new Map<string | null, MoneyOf>();
  const all = emptyMoney();
  const of = (id: string | null): MoneyOf => {
    const existing = byAccount.get(id);
    if (existing) return existing;
    const created = emptyMoney();
    byAccount.set(id, created);
    return created;
  };
  for (const row of input.boosts?.rows ?? []) {
    if (row.status === null || !PAID_FAMILY.has(row.status)) continue;
    addBoost(of(row.user_id), row);
    addBoost(all, row);
  }
  for (const row of input.plans?.rows ?? []) {
    if (row.kind !== PLAN_PAYMENT_KIND) continue;
    addPlan(of(row.user_id), row);
    addPlan(all, row);
  }
  return { byAccount, all };
}

interface RowWork {
  row: Omit<FinanceEconomicsRow, 'name' | 'nameStatus'>;
  paid: BuiltPaid;
  cost: BuiltCost;
  active: boolean;
}

// ── Sorting (SA-W87): every comparison on the server, before the cap ───────

const byId = (a: RowWork, b: RowWork): number => (a.row.accountId < b.row.accountId ? -1 : a.row.accountId > b.row.accountId ? 1 : 0);

/** AI cost highest first, in integer units; anything that is not a figure last. */
function compareCost(a: RowWork, b: RowWork): number {
  if (a.cost.units === null || b.cost.units === null) return (a.cost.units === null ? 1 : 0) - (b.cost.units === null ? 1 : 0);
  return b.cost.units - a.cost.units;
}

function compareMargin(a: RowWork, b: RowWork): number {
  const fa = a.row.margin.kind === 'figure' ? a.row.margin.marginUsd : null;
  const fb = b.row.margin.kind === 'figure' ? b.row.margin.marginUsd : null;
  if (fa !== null && fb !== null) return fa - fb;
  if (fa !== null) return -1;
  if (fb !== null) return 1;
  return compareCost(a, b);
}

/** 0: all USD; 1: any non-USD line; 2: no revenue. */
function paidClass(work: RowWork): number {
  if (work.paid.lines.length === 0) return 2;
  return work.paid.lines.every((line) => line.currency === MARGIN_CURRENCY) ? 0 : 1;
}

/** Highest first; Unknown after every figure. */
const compareAmountDesc = (a: number | null, b: number | null): number =>
  a === null || b === null ? (a === null ? 1 : 0) - (b === null ? 1 : 0) : b - a;

function comparePaid(a: RowWork, b: RowWork): number {
  const ca = paidClass(a);
  const cb = paidClass(b);
  if (ca !== cb) return ca - cb;
  if (ca === 0) return compareAmountDesc(a.paid.lines[0].afterTaxMinor, b.paid.lines[0].afterTaxMinor);
  if (ca === 1) {
    const lowest = (w: RowWork) => w.paid.lines.find((line) => line.currency !== MARGIN_CURRENCY) as BuiltPaid['lines'][number];
    const la = lowest(a);
    const lb = lowest(b);
    if (la.currency !== lb.currency) {
      if (la.currency === null) return 1;
      if (lb.currency === null) return -1;
      return la.currency < lb.currency ? -1 : 1;
    }
    return compareAmountDesc(la.afterTaxMinor, lb.afterTaxMinor);
  }
  return 0;
}

const CREDIT_ORDER: Record<FinanceEconomicsCredits['kind'], number> = { position: 0, no_allowance: 1, unknown: 2, no_plan_row: 2 };

function compareCredits(a: RowWork, b: RowWork): number {
  const ka = CREDIT_ORDER[a.row.credits.kind];
  const kb = CREDIT_ORDER[b.row.credits.kind];
  if (ka !== kb) return ka - kb;
  if (a.row.credits.kind === 'position' && b.row.credits.kind === 'position') return b.row.credits.usedTenths - a.row.credits.usedTenths;
  return 0;
}

const COMPARATORS: Record<FinanceAccountsTabQuery['sort'], (a: RowWork, b: RowWork) => number> = {
  ai_cost: compareCost,
  margin: compareMargin,
  paid: comparePaid,
  credits: compareCredits,
};

const isNegative = (margin: FinanceMarginValue): boolean => margin.kind === 'figure' && margin.marginUsd < 0;

interface AccountEconomicsBuilt {
  /** The wire section without names: the orchestrator adds them for the shown rows only. */
  section: Omit<FinanceAccountEconomicsSection, 'rows'> & { rows: Array<Omit<FinanceEconomicsRow, 'name' | 'nameStatus'>> };
  /** The non-platform ids of the shown rows (at most the cap), for the one names call. */
  shownIds: string[];
  /** For the route's info line: counts only. */
  counts: { accounts: number; matching: number; shown: number; deletedRow: boolean; noPlanRow: number };
}

/** The Accounts tab (all businesses). */
export function buildAccountEconomics(input: AccountEconomicsInput): AccountEconomicsBuilt {
  const reads = readStateOf(input);
  const feeEntry = stripeFeeEntryOf(input.feeEstimate, MARGIN_CURRENCY);
  const units = input.aiCost?.units ?? null;
  const { byAccount: money, all } = moneyByAccount(input);

  // ── Which accounts (M3-FR-2, SA-Q49) ───────────────────────────────────────
  const walkComplete = input.walk !== null && !input.walk.capped;
  const walkIds = new Set(walkComplete && input.walk ? input.walk.accountIds : []);
  const ids = new Set<string>(walkIds);
  for (const id of units?.byAccount.keys() ?? []) ids.add(id);
  for (const id of money.keys()) if (id !== null) ids.add(id);

  const works: RowWork[] = [...ids].map((id) => {
    const noPlanRow = walkComplete && !walkIds.has(id);
    const group: FinanceGroupKey | null = noPlanRow ? 'unknown_held' : input.groupOf(id) ?? null;
    const accountMoney = money.get(id) ?? emptyMoney();
    const paid = buildPaid(accountMoney, reads);
    const cost = buildCost(units?.byAccount.get(id), reads);
    const ledgerRows = units?.byAccount.get(id)?.rows ?? 0;
    return {
      row: {
        accountId: id,
        kind: input.isPlatform(id) ? 'platform' : 'account',
        group,
        tierLabel: group === null ? null : input.tierLabelOf(group),
        foundingPartner: !noPlanRow && input.foundingPartner(id),
        noPlanRow,
        paid: paid.wire,
        aiCost: cost.wire,
        ...buildMargins(paid, cost, reads, accountMoney.charges, feeEntry),
        credits: creditsCell(id, noPlanRow, input.credits),
      },
      paid,
      cost,
      active: accountMoney.revenueRows > 0 || ledgerRows > 0,
    };
  });

  // ── The platform line, over EVERY account and the Deleted row, before any filter (E-47) ──
  const platformPaid = buildPaid(all, reads);
  const platformCost = buildCost(units?.total, reads);
  const deletedMoney = money.get(null);
  const deletedExists = (units?.deleted.rows ?? 0) > 0 || deletedMoney !== undefined;
  const platform = {
    paid: platformPaid.wire,
    aiCost: platformCost.wire,
    ...buildMargins(platformPaid, platformCost, reads, all.charges, feeEntry),
    accountsCovered: works.length,
    includesDeleted: deletedExists,
  };

  // ── Filter, sort, cap (M3-FR-4 to M3-FR-6) ────────────────────────────────
  const { query } = input;
  const matching = works
    .filter((work) => query.group === null || work.row.group === query.group)
    .filter((work) => query.show === 'all' || (query.show === 'active' ? work.active : isNegative(work.row.margin)))
    .sort((a, b) => COMPARATORS[query.sort](a, b) || byId(a, b));
  const shown = matching.slice(0, input.cap);

  // ── The Deleted row (SA-W86): last, outside the cap and the count ─────────
  let deleted: FinanceEconomicsDeletedRow | null = null;
  if (deletedExists && query.group === null) {
    const deletedOrEmpty = deletedMoney ?? emptyMoney();
    const paid = buildPaid(deletedOrEmpty, reads);
    const cost = buildCost(units?.deleted, reads);
    const { margin, marginAfterFees } = buildMargins(paid, cost, reads, deletedOrEmpty.charges, feeEntry);
    if (query.show !== 'negative' || isNegative(margin)) deleted = { paid: paid.wire, aiCost: cost.wire, margin, marginAfterFees };
  }

  // ── Status (M3-FR-10) ──────────────────────────────────────────────────────
  const unreadableOrInexact = platformPaid.inexact || (units?.total.unreadable ?? 0) > 0;
  const status: FinanceAccountEconomicsSection['status'] =
    reads.ledgerFailed && reads.boostsFailed && reads.plansFailed
      ? 'unknown'
      : reads.ledgerFailed ||
          reads.ledgerCeiling ||
          reads.boostsFailed ||
          reads.boostsCeiling ||
          reads.plansFailed ||
          reads.plansCeiling ||
          unreadableOrInexact ||
          !walkComplete ||
          input.credits === null
        ? 'partial'
        : 'ok';

  return {
    section: {
      status,
      coverage: input.coverage,
      query,
      platform,
      rows: shown.map((work) => work.row),
      deleted,
      counts: { accounts: works.length, matching: matching.length, shown: shown.length, notListed: matching.length - shown.length },
      groupOptions: input.groupOptions.map((option) => ({ key: option.key, tierLabel: option.tierLabel })),
      feeEstimate: feeEstimateNoteOf(input.feeEstimate, MARGIN_CURRENCY),
      notes: {
        walkIncomplete: !walkComplete,
        ledgerFailed: reads.ledgerFailed,
        boostsFailed: reads.boostsFailed,
        plansFailed: reads.plansFailed,
        creditsUnavailable: input.credits === null,
        refundOrDispute: input.refundOrDispute,
      },
    },
    shownIds: shown.filter((work) => work.row.kind !== 'platform').map((work) => work.row.accountId),
    counts: {
      accounts: works.length,
      matching: matching.length,
      shown: shown.length,
      deletedRow: deleted !== null,
      noPlanRow: works.filter((work) => work.row.noPlanRow).length,
    },
  };
}

/**
 * The picked business's line (M3-FR-8): the SAME functions over that
 * business's own reads, so the summary and the tab row cannot differ (AC-142).
 * No names, no sort.
 */
export function buildAccountMargin(input: MarginReads & { accountId: string }): FinanceAccountMargin {
  const reads = readStateOf(input);
  const accountMoney = emptyMoney();
  for (const row of input.boosts?.rows ?? []) {
    if (row.user_id !== input.accountId || row.status === null || !PAID_FAMILY.has(row.status)) continue;
    addBoost(accountMoney, row);
  }
  for (const row of input.plans?.rows ?? []) {
    if (row.user_id !== input.accountId || row.kind !== PLAN_PAYMENT_KIND) continue;
    addPlan(accountMoney, row);
  }
  const paid = buildPaid(accountMoney, reads);
  const cost = buildCost(input.aiCost?.units.byAccount.get(input.accountId), reads);
  return { paid: paid.wire, aiCost: cost.wire, ...buildMargins(paid, cost, reads, accountMoney.charges, stripeFeeEntryOf(input.feeEstimate, MARGIN_CURRENCY)) };
}
