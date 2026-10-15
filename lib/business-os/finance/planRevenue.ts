/**
 * "Our revenue", plans (finance & business health slice 5a, §11D.4 M2-W-1 to
 * M2-W-8, M2-FR-1 to M2-FR-11). Workplan
 * docs/workplans/BUSINESS_OS_FINANCE_HEALTH_SLICE_5A_MONEY_M1_M2_WORKPLAN.md
 * § M2.2 and § M2.3.
 *
 * PURE (SA-WR-4): every input is a parameter; no clock, no I/O. Its input type
 * is STRUCTURAL (SA-W22): this file imports nothing from the data layer, so the
 * finance read repository's one-caller pin is unchanged, and the builder
 * passes the read's rows, which fit this shape. The plan's label arrives as a
 * callback (SA-Q37, SA-W65), so this file imports nothing from the entitlements
 * module and names no tier.
 *
 * What it counts:
 *   - A row is COUNTED only when its kind is exactly the paid invoice kind
 *     (M2-W-2; the read already filters it, this is a defence). Any other kind,
 *     NULL included, is counted as "another kind" and nowhere else (DF-7).
 *   - The window was decided by the read (`paid_at`, half-open). This file
 *     counts each row it is given once and reads `paid_at` only to order and
 *     show the one-business list (AC-118).
 *   - MINOR UNITS, EXACT (M2-W-4, SA-W54). The amounts are integer minor units,
 *     tax included. They are used AS IS as integer hundredths, and that is
 *     correct only because a row is readable only when `minorUnitsPerMajor(code)`
 *     (the one definition of currency decimals) is 100. No amount is ever
 *     scaled up or converted through a decimal helper. Each sum is divided by
 *     `CURRENCY_SCALE` once, at the edge.
 *   - UNREADABLE IS DECIDED PER ROW (SA-W48, SA-W64). A counted row whose
 *     currency is not a three-letter code with two decimals, whose amount or
 *     tax is not a JSON number that is a safe integer >= 0 (a numeric string or
 *     NULL included), or whose tax exceeds its amount, is NOT a payment: it adds
 *     no money, is counted on its currency line, and makes that line, its
 *     by-business row and the block "At least" / partial. A NULL tier is not
 *     unreadable ("Unknown plan"); a NULL period is not unreadable ("Not recorded").
 *   - A readable invoice of 0 is not a payment (M2-W-5): it is counted on its
 *     own and adds nothing; a currency with only those has no line.
 *   - Lines come from `groupByCurrency`: one per normalised code, Unknown last.
 *     NOTHING here adds two currencies (BD-12). K-5 and "Paid us, total" are
 *     combined per currency in `ourRevenue.ts`, never here.
 *
 * Slice 6a (Money M-3, SA-Q45, E-44): `readPlanMoney` is EXPORTED, unchanged,
 * so the per-account economics builder reads an invoice's money through the
 * one reader instead of naming its columns.
 *
 * @module lib/business-os/finance/planRevenue
 */

import { minorUnitsPerMajor } from '@/lib/payments/refundMath';
import { CURRENCY_SCALE, groupByCurrency, normaliseCurrencyCode, type CurrencyLine } from './currencyGroups';
import type {
  FinancePlanAccountRow,
  FinancePlanDeletedLine,
  FinancePlanLine,
  FinancePlanNotes,
  FinancePlanPaymentListRow,
  FinanceSectionStatus,
} from './financeTypes';

/** One paid plan invoice, structurally (SA-W22): the read's row fits it. */
export interface PlanPaymentInput {
  id: string;
  /** NULL: a payment of a deleted account. */
  user_id: string | null;
  kind: string | null;
  tier: string | null;
  /** Integer minor units, tax included, as JSON numbers. Anything else is unreadable (SA-W64). */
  amount_minor: unknown;
  amount_tax_minor: unknown;
  currency: unknown;
  period_start: string | null;
  period_end: string | null;
  paid_at: string | null;
}

/** M2-W-2: the one kind that counts (also filtered by the query; a defence here). */
export const PLAN_PAYMENT_KIND = 'invoice_paid';

const MONEY_FIELDS = ['received', 'tax'] as const;
type MoneyField = (typeof MONEY_FIELDS)[number];

export interface PlanRevenueResult {
  status: FinanceSectionStatus;
  /** Null only when `status` is `unknown` (the read failed). */
  lines: FinancePlanLine[] | null;
  /** All businesses: the table rows BEFORE names (the builder adds them), sorted and capped. */
  accounts: Array<Omit<FinancePlanAccountRow, 'name' | 'nameStatus'>> | null;
  accountsTotal: number | null;
  payments: FinancePlanPaymentListRow[] | null;
  paymentsTotal: number | null;
  deletedAccounts: FinancePlanDeletedLine[] | null;
  notes: FinancePlanNotes | null;
  /**
   * NON-WIRE input for the per-currency combiner (SA-Q40): one entry per line,
   * the received integer minor units, or null when the line is not exact.
   */
  receivedMinorByCurrency: Array<{ currency: string | null; receivedMinor: number | null }> | null;
  /** For the route's info line and the picked business's `state` (E-36): counts only. */
  counts: {
    rows: number;
    ceiling: boolean;
    /** Rows of the paid invoice kind (any amount, readable or not). */
    invoices: number;
    payments: number;
    zeroAmount: number;
    unreadable: number;
    otherKind: number;
    currencies: number;
    accountsTotal: number;
    deletedAccountPayments: number;
    paymentsTotal: number;
  };
}

/** A whole, non-negative number of minor units sent as a JSON number; anything else is null (SA-W64). */
function minorOf(raw: unknown): number | null {
  return typeof raw === 'number' && Number.isSafeInteger(raw) && raw >= 0 ? raw : null;
}

/**
 * SA-W64: one row's money in integer minor units, or null when any part is unreadable.
 * Exported (slice 6a, SA-Q45): the account economics builder's one reader of plan money.
 */
export function readPlanMoney(row: PlanPaymentInput): { code: string; amount: number; tax: number } | null {
  const code = normaliseCurrencyCode(row.currency);
  // Only a normalised, non-null code reaches `minorUnitsPerMajor` (it trims its input).
  if (code === null || minorUnitsPerMajor(code) !== 100) return null;
  const amount = minorOf(row.amount_minor);
  const tax = minorOf(row.amount_tax_minor);
  if (amount === null || tax === null || tax > amount) return null;
  return { code, amount, tax };
}

/** Minor units → the wire number, once. Valid because a readable row has two decimals. */
const toMoney = (minor: number): number => minor / CURRENCY_SCALE;

interface Counted {
  row: PlanPaymentInput;
  /** Null: unreadable (not a payment, adds no money). */
  money: { code: string; amount: number; tax: number } | null;
}

type Entry = { currency: unknown; field: MoneyField; hundredths: number | null };

/** The groupByCurrency entries of payments (amount above 0) and unreadable rows; a zero invoice adds none. */
function entriesOf(items: readonly Counted[]): Entry[] {
  return items.flatMap((item): Entry[] => {
    if (item.money === null) return [{ currency: item.row.currency, field: 'received', hundredths: null }];
    if (item.money.amount === 0) return [];
    return [
      { currency: item.row.currency, field: 'received', hundredths: item.money.amount },
      { currency: item.row.currency, field: 'tax', hundredths: item.money.tax },
    ];
  });
}

const isPayment = (item: Counted): boolean => item.money !== null && item.money.amount > 0;

/** Count the items per normalised currency that satisfy `test`. */
function countBy(items: readonly Counted[], test: (item: Counted) => boolean): Map<string | null, number> {
  const out = new Map<string | null, number>();
  for (const item of items) {
    if (!test(item)) continue;
    const currency = normaliseCurrencyCode(item.row.currency);
    out.set(currency, (out.get(currency) ?? 0) + 1);
  }
  return out;
}

/** Ascending, NULL last. */
function compareNullable(a: string | null, b: string | null): number {
  if (a === b) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return a < b ? -1 : 1;
}

/** A line is exact when the read was not cut off and nothing on it was left out. */
const lineExact = (line: CurrencyLine<MoneyField>, cutOff: boolean): boolean =>
  !cutOff && line.unreadable.received === 0 && !line.overflow;

export function buildPlanRevenue(input: {
  /** Null: the read failed. */
  payments: { rows: readonly PlanPaymentInput[]; reachedCeiling: boolean } | null;
  scope: 'all' | 'one';
  /** SA-Q37 / SA-W65: the plan's display label, or null for "Unknown plan". Built by the caller. */
  planLabelOf: (tier: string | null) => string | null;
  limits: { accountsShown: number; paymentsShown: number };
}): PlanRevenueResult {
  const { payments, scope, planLabelOf, limits } = input;
  if (payments === null) {
    return {
      status: 'unknown',
      lines: null,
      accounts: null,
      accountsTotal: null,
      payments: null,
      paymentsTotal: null,
      deletedAccounts: null,
      notes: null,
      receivedMinorByCurrency: null,
      counts: {
        rows: 0, ceiling: false, invoices: 0, payments: 0, zeroAmount: 0, unreadable: 0, otherKind: 0,
        currencies: 0, accountsTotal: 0, deletedAccountPayments: 0, paymentsTotal: 0,
      },
    };
  }

  const cutOff = payments.reachedCeiling;
  const counted: Counted[] = payments.rows
    .filter((row) => row.kind === PLAN_PAYMENT_KIND)
    .map((row) => ({ row, money: readPlanMoney(row) }));
  const otherKind = payments.rows.length - counted.length;
  const paid = counted.filter(isPayment);
  const unreadable = counted.filter((item) => item.money === null).length;
  const zeroAmount = counted.filter((item) => item.money !== null && item.money.amount === 0).length;

  // ── Per currency (M2-FR-1) ────────────────────────────────────────────────
  const grouped = groupByCurrency(entriesOf(counted), MONEY_FIELDS);
  const paymentsBy = countBy(counted, isPayment);
  const zeroBy = countBy(counted, (item) => item.money !== null && item.money.amount === 0);
  const businessesBy = new Map<string | null, Set<string>>();
  for (const item of paid) {
    if (item.row.user_id === null) continue;
    const currency = normaliseCurrencyCode(item.row.currency);
    const set = businessesBy.get(currency) ?? new Set<string>();
    set.add(item.row.user_id);
    businessesBy.set(currency, set);
  }
  const lines: FinancePlanLine[] = grouped.map((line) => ({
    currency: line.currency,
    payments: paymentsBy.get(line.currency) ?? 0,
    received: toMoney(line.sums.received),
    tax: toMoney(line.sums.tax),
    businesses: businessesBy.get(line.currency)?.size ?? 0,
    zeroAmountInvoices: zeroBy.get(line.currency) ?? 0,
    unreadable: line.unreadable.received,
    exact: lineExact(line, cutOff),
  }));
  const receivedMinorByCurrency = grouped.map((line) => ({
    currency: line.currency,
    receivedMinor: lineExact(line, cutOff) ? line.sums.received : null,
  }));
  const overflow = grouped.some((line) => line.overflow);

  // ── By business, all businesses (M2-FR-2, SA-W66) ────────────────────────
  let accounts: PlanRevenueResult['accounts'] = null;
  let accountsTotal: number | null = null;
  let deletedAccounts: FinancePlanDeletedLine[] | null = null;
  if (scope === 'all') {
    const byAccount = new Map<string, Counted[]>();
    for (const item of counted) {
      if (item.row.user_id === null) continue;
      const list = byAccount.get(item.row.user_id) ?? [];
      list.push(item);
      byAccount.set(item.row.user_id, list);
    }
    const rows: Array<Omit<FinancePlanAccountRow, 'name' | 'nameStatus'> & { receivedMinor: number }> = [];
    for (const [accountId, items] of byAccount) {
      const perCurrency = countBy(items, isPayment);
      for (const line of groupByCurrency(entriesOf(items), MONEY_FIELDS)) {
        rows.push({
          accountId,
          currency: line.currency,
          payments: perCurrency.get(line.currency) ?? 0,
          received: toMoney(line.sums.received),
          exact: lineExact(line, cutOff),
          receivedMinor: line.sums.received,
        });
      }
    }
    // SA-W66: currency (Unknown last), received highest first (within one currency only), then the
    // account id. The builder re-sorts the SHOWN rows by name within equal received once names exist.
    rows.sort(
      (a, b) =>
        compareNullable(a.currency, b.currency) ||
        b.receivedMinor - a.receivedMinor ||
        compareNullable(a.accountId, b.accountId)
    );
    accountsTotal = rows.length;
    accounts = rows.slice(0, limits.accountsShown).map((row) => ({
      accountId: row.accountId,
      currency: row.currency,
      payments: row.payments,
      received: row.received,
      exact: row.exact,
    }));

    // ── Deleted accounts (M2-W-8): never named ───────────────────────────────
    const deleted = counted.filter((item) => item.row.user_id === null);
    const deletedPayments = countBy(deleted, isPayment);
    deletedAccounts = groupByCurrency(entriesOf(deleted), MONEY_FIELDS).map((line) => ({
      currency: line.currency,
      payments: deletedPayments.get(line.currency) ?? 0,
      received: toMoney(line.sums.received),
      exact: lineExact(line, cutOff),
    }));
  }

  // ── One business's payments, newest first (M2-FR-3) ──────────────────────
  let list: FinancePlanPaymentListRow[] | null = null;
  let paymentsTotal: number | null = null;
  if (scope === 'one') {
    const timeOf = (item: Counted): number => {
      const ms = item.row.paid_at === null ? Number.NaN : Date.parse(item.row.paid_at);
      return Number.isFinite(ms) ? ms : Number.NEGATIVE_INFINITY;
    };
    const ordered = [...paid].sort((a, b) => timeOf(b) - timeOf(a) || compareNullable(a.row.id, b.row.id));
    paymentsTotal = ordered.length;
    list = ordered.slice(0, limits.paymentsShown).map((item) => {
      const money = item.money as { code: string; amount: number; tax: number };
      return {
        id: item.row.id,
        paidAt: item.row.paid_at,
        planLabel: planLabelOf(item.row.tier),
        received: toMoney(money.amount),
        tax: toMoney(money.tax),
        currency: money.code,
        periodStart: item.row.period_start,
        periodEnd: item.row.period_end,
      };
    });
  }

  const notes: FinancePlanNotes = {
    empty: paid.length === 0 && unreadable === 0,
    exact: !cutOff,
    zeroAmountInvoices: zeroAmount,
    unreadable,
    otherKind,
  };
  const partial = cutOff || unreadable > 0 || overflow || otherKind > 0;

  return {
    status: partial ? 'partial' : 'ok',
    lines,
    accounts,
    accountsTotal,
    payments: list,
    paymentsTotal,
    deletedAccounts,
    notes,
    receivedMinorByCurrency,
    counts: {
      rows: payments.rows.length,
      ceiling: cutOff,
      invoices: counted.length,
      payments: paid.length,
      zeroAmount,
      unreadable,
      otherKind,
      currencies: lines.length,
      accountsTotal: accountsTotal ?? 0,
      deletedAccountPayments: counted.filter((item) => item.row.user_id === null && isPayment(item)).length,
      paymentsTotal: paymentsTotal ?? 0,
    },
  };
}
