/**
 * Section 2 block B, "Takings through the platform" (finance & business health
 * slice 2a, S2-FR-1 to S2-FR-11). Workplan
 * docs/workplans/BUSINESS_OS_FINANCE_HEALTH_SLICE_2A_WORKPLAN.md § The takings
 * builder.
 *
 * PURE (SA-WR-4): every input is a parameter; no clock, no I/O. Its input
 * types are STRUCTURAL (SA-W22): this file imports nothing from a repository,
 * so the finance read repository's one-caller pin is unchanged, and the
 * builder passes the repository rows, which fit these shapes.
 *
 * What it counts:
 *   - A payment is COUNTED when its stored status is exactly `succeeded` or
 *     `refunded` (SA-WR-15: no trim, no case change, so the page and SQL
 *     check 7 cannot differ). Any other status, NULL included, is only
 *     counted as "another status" and left out of every figure (SA-W18).
 *   - A refund counts only when its status is exactly `succeeded`; any other
 *     is "not completed" and its amount is left out (S2-FR-3).
 *   - Every money sum is integer HUNDREDTHS in its own currency, through the
 *     currency helper; each figure is divided by 100 once, at the end
 *     (SA-W26). Nothing adds two currencies (S2-CUR-1).
 *   - Fees are grouped by FEE currency and never deducted (S2-CUR-4, S2-CUR-6).
 *   - Lines and table rows are the union of the keys seen in counted payments
 *     and in succeeded refunds (SA-W19).
 *
 * Honesty: net is shown only when it is exact (S2-FR-8, SA-W20). It is null
 * when the payments read reached its ceiling, the refunds read failed or
 * reached its ceiling, or the line (or row) has an unreadable amount. A lower
 * bound minus a figure is never shown.
 *
 * @module lib/business-os/finance/takings
 */

import { CURRENCY_SCALE, groupByCurrency, normaliseCurrencyCode, toHundredths } from './currencyGroups';
import type {
  FinanceFeeLine,
  FinanceRefundLine,
  FinanceSectionStatus,
  FinanceTakingsFigures,
  FinanceTakingsLine,
} from './financeTypes';

/** One client payment, structurally (SA-W22): the repository's row fits it. */
export interface TakingsPaymentInput {
  id: string;
  user_id: string | null;
  amount: unknown;
  currency: unknown;
  status: string | null;
  processor_fee: unknown;
  fee_currency: unknown;
  processor_type: string | null;
}

/** One client refund, structurally (SA-W22). */
export interface TakingsRefundInput {
  id: string;
  user_id: string | null;
  amount: unknown;
  currency: unknown;
  status: string | null;
}

export interface TakingsInput {
  /** Null: the payments read failed. */
  payments: { rows: readonly TakingsPaymentInput[]; reachedCeiling: boolean } | null;
  /** Null: the refunds read failed. */
  refunds: { rows: readonly TakingsRefundInput[]; reachedCeiling: boolean } | null;
  isPlatformAccount: (accountId: string) => boolean;
  /** `FINANCE_LIMITS.TAKINGS_ROWS_SHOWN`. */
  displayCap: number;
}

/** A table row before names: the builder adds the name from rows already read. */
export interface TakingsRowBuilt {
  accountId: string | null;
  isPlatform: boolean;
  currency: string | null;
  payments: number;
  gross: number;
  refunded: number | null;
  net: number | null;
  unreadablePayments: number;
}

export type TakingsFiguresBuilt = Omit<FinanceTakingsFigures, 'rows'> & { rows: TakingsRowBuilt[] };

export interface TakingsResult {
  status: FinanceSectionStatus;
  /** Null only when `status` is `unknown` (the payments read failed). */
  figures: TakingsFiguresBuilt | null;
}

/** SA-WR-15: the stored value, matched exactly. */
const isCountedPayment = (status: string | null): boolean => status === 'succeeded' || status === 'refunded';
const isCompletedRefund = (status: string | null): boolean => status === 'succeeded';

/** SA-W21: the stored processor, trimmed and lower-cased; NULL or empty → null ("Not recorded"). */
function processorKey(raw: string | null): string | null {
  if (typeof raw !== 'string') return null;
  const key = raw.trim().toLowerCase();
  return key === '' ? null : key;
}

/** Hundredths → the wire number, once (SA-W26). */
const toMoney = (hundredths: number): number => hundredths / CURRENCY_SCALE;

interface RowAcc {
  accountId: string | null;
  currency: string | null;
  payments: number;
  gross: number;
  refunded: number;
  unreadable: number;
  unreadablePayments: number;
}

export function buildTakings(input: TakingsInput): TakingsResult {
  const { payments, refunds, isPlatformAccount, displayCap } = input;
  if (payments === null) return { status: 'unknown', figures: null };

  const paymentsExact = !payments.reachedCeiling;
  const refundsState: FinanceSectionStatus = refunds === null ? 'unknown' : refunds.reachedCeiling ? 'partial' : 'ok';
  // Net needs both sides exact (S2-FR-8): never a lower bound minus a figure.
  const netPossible = paymentsExact && refundsState === 'ok';

  const counted = payments.rows.filter((p) => isCountedPayment(p.status));
  const otherStatusPayments = payments.rows.length - counted.length;
  const completedRefunds = refunds ? refunds.rows.filter((r) => isCompletedRefund(r.status)) : [];
  const refundsNotCompleted = refunds ? refunds.rows.length - completedRefunds.length : null;

  // ── Amounts, once each ──────────────────────────────────────────────────
  const paymentCents = counted.map((p) => toHundredths(p.amount));
  const refundCents = completedRefunds.map((r) => toHundredths(r.amount));
  const unreadableAmounts =
    paymentCents.filter((c) => c === null).length + refundCents.filter((c) => c === null).length;

  // ── Takings per currency (S2-FR-2, S2-FR-6, SA-W19) ─────────────────────
  const lineSums = groupByCurrency(
    [
      ...counted.map((p, i) => ({ currency: p.currency, field: 'gross' as const, hundredths: paymentCents[i] })),
      ...completedRefunds.map((r, i) => ({ currency: r.currency, field: 'refunded' as const, hundredths: refundCents[i] })),
    ],
    ['gross', 'refunded'] as const
  );
  const paymentsByCurrency = new Map<string | null, number>();
  const businessesByCurrency = new Map<string | null, Set<string>>();
  const businesses = new Set<string>();
  for (const p of counted) {
    const currency = normaliseCurrencyCode(p.currency);
    paymentsByCurrency.set(currency, (paymentsByCurrency.get(currency) ?? 0) + 1);
    if (p.user_id !== null) {
      businesses.add(p.user_id);
      const set = businessesByCurrency.get(currency) ?? new Set<string>();
      set.add(p.user_id);
      businessesByCurrency.set(currency, set);
    }
  }
  let overflow = false;
  const lines: FinanceTakingsLine[] = lineSums.map((line) => {
    if (line.overflow) overflow = true;
    const unreadable = line.unreadable.gross + line.unreadable.refunded;
    const exact = netPossible && unreadable === 0 && !line.overflow;
    return {
      currency: line.currency,
      payments: paymentsByCurrency.get(line.currency) ?? 0,
      gross: toMoney(line.sums.gross),
      refunded: refunds === null ? null : toMoney(line.sums.refunded),
      net: exact ? toMoney(line.sums.gross - line.sums.refunded) : null,
      businesses: businessesByCurrency.get(line.currency)?.size ?? 0,
      unreadable,
      unreadablePayments: line.unreadable.gross,
    };
  });

  // ── Refunds per refund currency (S2-FR-3) ───────────────────────────────
  let refundLines: FinanceRefundLine[] | null = null;
  if (refunds !== null) {
    const refundCounts = new Map<string | null, number>();
    for (const r of completedRefunds) {
      const currency = normaliseCurrencyCode(r.currency);
      refundCounts.set(currency, (refundCounts.get(currency) ?? 0) + 1);
    }
    refundLines = groupByCurrency(
      completedRefunds.map((r, i) => ({ currency: r.currency, field: 'refunded' as const, hundredths: refundCents[i] })),
      ['refunded'] as const
    ).map((line) => {
      if (line.overflow) overflow = true;
      return { currency: line.currency, refunds: refundCounts.get(line.currency) ?? 0, refunded: toMoney(line.sums.refunded) };
    });
  }

  // ── Recorded fees, by FEE currency (S2-FR-4, S2-CUR-4) ──────────────────
  let unreadableFees = 0;
  const feeEntries: Array<{ currency: unknown; field: 'fees'; hundredths: number }> = [];
  for (const p of counted) {
    if (p.processor_fee === null || p.processor_fee === undefined) continue; // not yet known: never assumed 0
    const fee = toHundredths(p.processor_fee);
    if (fee === null) {
      unreadableFees += 1;
      continue;
    }
    feeEntries.push({ currency: p.fee_currency, field: 'fees', hundredths: fee });
  }
  const feeCounts = new Map<string | null, number>();
  for (const entry of feeEntries) {
    const currency = normaliseCurrencyCode(entry.currency);
    feeCounts.set(currency, (feeCounts.get(currency) ?? 0) + 1);
  }
  const feeLines: FinanceFeeLine[] = groupByCurrency(feeEntries, ['fees'] as const).map((line) => {
    if (line.overflow) overflow = true;
    return { currency: line.currency, fees: toMoney(line.sums.fees), payments: feeCounts.get(line.currency) ?? 0 };
  });

  // ── Payments by processor (S2-FR-5, SA-W21): counts only ────────────────
  const processorCounts = new Map<string | null, number>();
  for (const p of counted) {
    const key = processorKey(p.processor_type);
    processorCounts.set(key, (processorCounts.get(key) ?? 0) + 1);
  }
  const processors = [...processorCounts.entries()]
    .map(([processorType, count]) => ({ processorType, payments: count }))
    .sort((a, b) => compareNullableAsc(a.processorType, b.processorType));

  // ── Per-business rows (S2-FR-7, SA-W19) ─────────────────────────────────
  const rowsByKey = new Map<string, RowAcc>();
  const rowFor = (accountId: string | null, rawCurrency: unknown): RowAcc => {
    const currency = normaliseCurrencyCode(rawCurrency);
    const key = JSON.stringify([accountId, currency]);
    let row = rowsByKey.get(key);
    if (!row) {
      row = { accountId, currency, payments: 0, gross: 0, refunded: 0, unreadable: 0, unreadablePayments: 0 };
      rowsByKey.set(key, row);
    }
    return row;
  };
  counted.forEach((p, i) => {
    const row = rowFor(p.user_id, p.currency);
    row.payments += 1;
    const cents = paymentCents[i];
    if (cents === null) {
      row.unreadable += 1;
      row.unreadablePayments += 1;
    } else row.gross += cents;
  });
  completedRefunds.forEach((r, i) => {
    const row = rowFor(r.user_id, r.currency);
    const cents = refundCents[i];
    if (cents === null) row.unreadable += 1;
    else row.refunded += cents;
  });
  // Sorted by currency in the lines' own order (Unknown last), then gross highest first, then id.
  const currencyRank = new Map(lines.map((line, index) => [line.currency, index]));
  const allRows = [...rowsByKey.values()].sort(
    (a, b) =>
      (currencyRank.get(a.currency) ?? lines.length) - (currencyRank.get(b.currency) ?? lines.length) ||
      b.gross - a.gross ||
      compareNullableAsc(a.accountId, b.accountId)
  );
  const rows: TakingsRowBuilt[] = allRows.slice(0, Math.max(0, displayCap)).map((row) => ({
    accountId: row.accountId,
    isPlatform: row.accountId !== null && isPlatformAccount(row.accountId),
    currency: row.currency,
    payments: row.payments,
    gross: toMoney(row.gross),
    refunded: refunds === null ? null : toMoney(row.refunded),
    net:
      netPossible && row.unreadable === 0 && Number.isSafeInteger(row.gross - row.refunded)
        ? toMoney(row.gross - row.refunded)
        : null,
    unreadablePayments: row.unreadablePayments,
  }));

  const partial =
    !paymentsExact || refundsState !== 'ok' || unreadableAmounts > 0 || unreadableFees > 0 || overflow;

  return {
    status: partial ? 'partial' : 'ok',
    figures: {
      empty: counted.length === 0 && completedRefunds.length === 0,
      paymentsExact,
      refundsState,
      lines,
      refundLines,
      refundsNotCompleted,
      feeLines,
      feesRecordedOn: feeEntries.length,
      countedPayments: counted.length,
      unreadableFees,
      processors,
      businesses: businesses.size,
      otherStatusPayments,
      unreadableAmounts,
      rows,
      rowsTotal: allRows.length,
    },
  };
}

/** Ascending, NULL last: a deterministic order for processors and for rows of equal gross. */
function compareNullableAsc(a: string | null, b: string | null): number {
  if (a === b) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return a < b ? -1 : 1;
}
