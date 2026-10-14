/**
 * "Our revenue", credit boosts (finance & business health slice 4a, S4-W-1 to
 * S4-W-8, S4-FR-1 to S4-FR-14). Workplan
 * docs/workplans/BUSINESS_OS_FINANCE_HEALTH_SLICE_4A_WORKPLAN.md § The boost
 * revenue builder.
 *
 * PURE (SA-WR-4): every input is a parameter; no clock, no I/O. Its input type
 * is STRUCTURAL (SA-W22): this file imports nothing from the data layer, so the
 * finance read repository's one-caller pin is unchanged, and the builder
 * passes the read's rows, which fit this shape.
 *
 * What it counts:
 *   - A purchase is COUNTED when its stored status is exactly one of the paid
 *     family (S4-W-2, SA-WR-15: no trim, no case change). Any other status,
 *     NULL included, is only counted as "another status". The window was
 *     decided by the read (by the paid date, half-open); this file counts each
 *     row it is given once and never looks at a date (AC-88).
 *   - MINOR UNITS, EXACT (S4-W-4, SA-Q26, SA-W54). The amounts are integer
 *     minor units. They are used AS IS as integer hundredths, and that is
 *     correct only because a purchase is readable only when
 *     `minorUnitsPerMajor(code)` (the one definition of currency decimals) is
 *     100. No amount is ever scaled up or converted through the decimal
 *     helpers. Each sum is divided by `CURRENCY_SCALE` once, at the edge.
 *   - UNREADABLE IS DECIDED PER PURCHASE (SA-W48). A counted purchase whose
 *     currency is not a three-letter code, whose currency does not have two
 *     decimals, or whose total, tax or refunded amount is not a JSON number
 *     that is a safe integer >= 0 (a numeric string included: the columns are
 *     integers, so a string means the column changed), or whose refund exceeds
 *     its total, adds NO money anywhere. It is counted, makes that line's and
 *     that package row's net (and held, lost) Unknown, and the block partial.
 *     Its credits still count when they can be read: credits are not money.
 *   - Credits sold go through `toUnits` once, at the credit scale (6 dp).
 *   - Lines come from `groupByCurrency`: one per normalised code, Unknown last.
 *     NOTHING here adds two currencies (S4-W-5, BD-12).
 *
 * Honesty: net (and held, lost) is shown only when exact (S4-W-8). It is null
 * when the read reached its ceiling, or the line or row has an unreadable
 * purchase or an overflow. A lower bound minus a figure is never shown.
 *
 * DF-5: refunds and disputes count in the purchase's own window. That rule is
 * one function, `refundsAndDisputesOf`, below.
 *
 * @module lib/business-os/finance/boostRevenue
 */

import { minorUnitsPerMajor } from '@/lib/payments/refundMath';
import { CREDIT_SCALE, toUnits } from '@/lib/business-os/credits/creditReport';
import { CURRENCY_SCALE, groupByCurrency, normaliseCurrencyCode, type CurrencyLine } from './currencyGroups';
import type {
  FinanceBoostDeletedLine,
  FinanceBoostLine,
  FinanceBoostNotes,
  FinanceBoostPackageRow,
  FinanceSectionStatus,
} from './financeTypes';

/** One boost purchase, structurally (SA-W22): the read's row fits it. */
export interface BoostPurchaseInput {
  id: string;
  /** NULL: the account was deleted. */
  user_id: string | null;
  status: string | null;
  package_id: string | null;
  package_version: number | null;
  currency: unknown;
  /** Integer minor units, as JSON numbers. Anything else is unreadable (SA-W48). */
  amount_total_minor: unknown;
  amount_tax_minor: unknown;
  amount_refunded_minor: unknown;
  /** Credits (6 dp): a number or a numeric string. */
  credits_total: number | string | null;
}

/**
 * S4-W-2: the statuses that count, matched exactly (SA-WR-15). Finance's own
 * literal, checked against the migration's CHECKs by a test (the SA-W2
 * precedent): never imported from the boost module.
 */
export const BOOST_PAID_FAMILY = ['paid', 'partially_refunded', 'refunded', 'disputed', 'dispute_lost'] as const;

const PAID_FAMILY: ReadonlySet<string> = new Set<string>(BOOST_PAID_FAMILY);
const PLAIN_PAID: (typeof BOOST_PAID_FAMILY)[number] = BOOST_PAID_FAMILY[0];

const MONEY_FIELDS = ['gross', 'tax', 'refunded', 'held', 'lost'] as const;
type MoneyField = (typeof MONEY_FIELDS)[number];

export interface BoostRevenueResult {
  status: FinanceSectionStatus;
  /** Null only when `status` is `unknown` (the read failed). */
  lines: FinanceBoostLine[] | null;
  packages: FinanceBoostPackageRow[] | null;
  /** Null with a business picked (S4-FR-8) or when the read failed. */
  deletedAccounts: FinanceBoostDeletedLine[] | null;
  notes: FinanceBoostNotes | null;
  /**
   * NON-WIRE input for the per-currency combiner (slice 5a, SA-W59): one entry
   * per line, the net in integer minor units, null exactly when the line's
   * wire `net` is null. K-5 is combined in `ourRevenue.ts` from this and the
   * plans received, never by scaling a wire number back up.
   */
  netMinorByCurrency: Array<{ currency: string | null; netMinor: number | null }>;
  /** For the route's info line: counts only. */
  counts: { counted: number; unreadableCredits: number; deletedAccountPurchases: number };
}

/** One readable purchase's money, in integer minor units of its currency. */
interface ReadableMoney {
  total: number;
  tax: number;
  refunded: number;
  held: number;
  lost: number;
}

interface CountedPurchase {
  row: BoostPurchaseInput;
  /** Null: unreadable (SA-W48), adds no money anywhere. */
  money: ReadableMoney | null;
  /** Integer micro-credits; NaN when unreadable. */
  microCredits: number;
}

/** A whole, non-negative number of minor units sent as a JSON number; anything else is null (SA-W48). */
function minorOf(raw: unknown): number | null {
  return typeof raw === 'number' && Number.isSafeInteger(raw) && raw >= 0 ? raw : null;
}

/**
 * DF-5 (SA-Q28, SA-W53): a boost refund or dispute counts in the window of the
 * PURCHASE (its paid date), as recorded on the purchase today. No refund or
 * dispute date is stored, so a later refund lowers an earlier month. This is
 * the ONLY code that reads the refunded amount or the two dispute statuses
 * (pinned by the finance source guard). If the user chooses "the month the
 * refund happened", this function is fed from a dated refund read instead of
 * the purchase row; nothing else changes.
 *
 * Returns the purchase's refunded, held-in-dispute and lost-in-dispute minor
 * units, or null when the refunded amount is unreadable or exceeds the total.
 */
function refundsAndDisputesOf(
  row: BoostPurchaseInput,
  total: number
): { refunded: number; held: number; lost: number } | null {
  const refunded = minorOf(row.amount_refunded_minor);
  if (refunded === null || refunded > total) return null;
  const remainder = total - refunded;
  return {
    refunded,
    held: row.status === 'disputed' ? remainder : 0,
    lost: row.status === 'dispute_lost' ? remainder : 0,
  };
}

/** SA-W48: the purchase's money, or null when any part of it is unreadable. */
function readMoney(row: BoostPurchaseInput): ReadableMoney | null {
  const code = normaliseCurrencyCode(row.currency);
  // Only a normalised, non-null code reaches `minorUnitsPerMajor` (it trims its input).
  if (code === null || minorUnitsPerMajor(code) !== 100) return null;
  const total = minorOf(row.amount_total_minor);
  const tax = minorOf(row.amount_tax_minor);
  if (total === null || tax === null) return null;
  const afterRefunds = refundsAndDisputesOf(row, total);
  if (afterRefunds === null) return null;
  return { total, tax, ...afterRefunds };
}

/** Hundredths → the wire number, once (SA-W26). Valid because a readable purchase has two decimals. */
const toMoney = (hundredths: number): number => hundredths / CURRENCY_SCALE;

interface Summary {
  currency: string | null;
  purchases: number;
  sums: Record<MoneyField, number>;
  /** Purchases with unreadable money. */
  unreadable: number;
  overflow: boolean;
  microCredits: number;
  unreadableCredits: number;
}

/** Per currency, through `groupByCurrency` (S4-W-5): money in integer minor units, plus counts and credits. */
function summarise(items: readonly CountedPurchase[]): Summary[] {
  type Entry = { currency: unknown; field: MoneyField; hundredths: number | null };
  const entries = items.flatMap((item): Entry[] =>
    item.money === null
      ? [{ currency: item.row.currency, field: 'gross', hundredths: null }]
      : [
          { currency: item.row.currency, field: 'gross', hundredths: item.money.total },
          { currency: item.row.currency, field: 'tax', hundredths: item.money.tax },
          { currency: item.row.currency, field: 'refunded', hundredths: item.money.refunded },
          { currency: item.row.currency, field: 'held', hundredths: item.money.held },
          { currency: item.row.currency, field: 'lost', hundredths: item.money.lost },
        ]
  );
  const lines: CurrencyLine<MoneyField>[] = groupByCurrency(entries, MONEY_FIELDS);

  const extra = new Map<string | null, { purchases: number; microCredits: number; unreadableCredits: number }>();
  for (const item of items) {
    const currency = normaliseCurrencyCode(item.row.currency);
    const acc = extra.get(currency) ?? { purchases: 0, microCredits: 0, unreadableCredits: 0 };
    acc.purchases += 1;
    const next = acc.microCredits + item.microCredits;
    // NaN (unreadable) or past the safe range: counted, never added.
    if (Number.isSafeInteger(next)) acc.microCredits = next;
    else acc.unreadableCredits += 1;
    extra.set(currency, acc);
  }

  return lines.map((line) => {
    const acc = extra.get(line.currency) ?? { purchases: 0, microCredits: 0, unreadableCredits: 0 };
    return {
      currency: line.currency,
      purchases: acc.purchases,
      sums: line.sums,
      unreadable: line.unreadable.gross,
      overflow: line.overflow,
      microCredits: acc.microCredits,
      unreadableCredits: acc.unreadableCredits,
    };
  });
}

/** S4-W-6: net in integer minor units, or null when it cannot be exact (S4-W-8, SA-W48). */
function netOf(summary: Summary, exact: boolean): number | null {
  if (!exact || summary.unreadable > 0 || summary.overflow) return null;
  const { gross, refunded, held, lost } = summary.sums;
  const net = gross - refunded - held - lost;
  return Number.isSafeInteger(net) ? net : null;
}

/** Ascending, NULL last. */
function compareNullable<T extends string | number>(a: T | null, b: T | null): number {
  if (a === b) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return a < b ? -1 : 1;
}

export function buildBoostRevenue(input: {
  /** Null: the read failed. */
  purchases: { rows: readonly BoostPurchaseInput[]; reachedCeiling: boolean } | null;
  scope: 'all' | 'one';
}): BoostRevenueResult {
  const { purchases, scope } = input;
  if (purchases === null) {
    return {
      status: 'unknown',
      lines: null,
      packages: null,
      deletedAccounts: null,
      notes: null,
      netMinorByCurrency: [],
      counts: { counted: 0, unreadableCredits: 0, deletedAccountPurchases: 0 },
    };
  }

  const exact = !purchases.reachedCeiling;
  const counted: CountedPurchase[] = purchases.rows
    .filter((row) => row.status !== null && PAID_FAMILY.has(row.status))
    .map((row) => ({ row, money: readMoney(row), microCredits: toUnits(row.credits_total, CREDIT_SCALE) }));
  const otherStatusPurchases = purchases.rows.length - counted.length;
  const unreadablePurchases = counted.filter((item) => item.money === null).length;

  // ── Per currency (S4-W-5, S4-W-6) ────────────────────────────────────────
  const summaries = summarise(counted);
  const netMinorByCurrency = summaries.map((s) => ({ currency: s.currency, netMinor: netOf(s, exact) }));
  const lines: FinanceBoostLine[] = summaries.map((s) => {
    const net = netOf(s, exact);
    return {
      currency: s.currency,
      purchases: s.purchases,
      gross: toMoney(s.sums.gross),
      tax: toMoney(s.sums.tax),
      refunded: toMoney(s.sums.refunded),
      held: net === null ? null : toMoney(s.sums.held),
      lost: net === null ? null : toMoney(s.sums.lost),
      net: net === null ? null : toMoney(net),
      creditsSold: s.microCredits / CREDIT_SCALE,
      unreadable: s.unreadable,
      unreadableCredits: s.unreadableCredits,
    };
  });

  // ── By package, as stored (S4-FR-3, SA-Q30) ──────────────────────────────
  const byPackage = new Map<string, { packageId: string | null; packageVersion: number | null; items: CountedPurchase[] }>();
  for (const item of counted) {
    const packageId = typeof item.row.package_id === 'string' && item.row.package_id !== '' ? item.row.package_id : null;
    const packageVersion = Number.isSafeInteger(item.row.package_version) ? item.row.package_version : null;
    const key = JSON.stringify([normaliseCurrencyCode(item.row.currency), packageId, packageVersion]);
    const group = byPackage.get(key) ?? { packageId, packageVersion, items: [] };
    group.items.push(item);
    byPackage.set(key, group);
  }
  const packages: FinanceBoostPackageRow[] = [...byPackage.values()]
    .flatMap((group) =>
      // One currency per group, so exactly one summary.
      summarise(group.items).map((s) => {
        const net = netOf(s, exact);
        return {
          currency: s.currency,
          packageId: group.packageId,
          packageVersion: group.packageVersion,
          purchases: s.purchases,
          gross: toMoney(s.sums.gross),
          refunded: toMoney(s.sums.refunded),
          net: net === null ? null : toMoney(net),
          unreadable: s.unreadable,
        };
      })
    )
    .sort(
      (a, b) =>
        compareNullable(a.currency, b.currency) ||
        compareNullable(a.packageId, b.packageId) ||
        compareNullable(a.packageVersion, b.packageVersion)
    );

  // ── Deleted accounts, all businesses only (S4-W-7, S4-FR-8) ─────────────
  const deleted = counted.filter((item) => item.row.user_id === null);
  const deletedAccounts: FinanceBoostDeletedLine[] | null =
    scope === 'one'
      ? null
      : summarise(deleted).map((s) => {
          const net = netOf(s, exact);
          return { currency: s.currency, purchases: s.purchases, net: net === null ? null : toMoney(net), unreadable: s.unreadable };
        });

  // ── Notes, status ────────────────────────────────────────────────────────
  const unreadableCredits = summaries.reduce((n, s) => n + s.unreadableCredits, 0);
  const overflow = summaries.some((s) => s.overflow);
  // The S4-W-3 note: a refund or dispute amount above 0, or one that is unknown on a refund or dispute row.
  const refundOrDispute = counted.some((item) =>
    item.money === null ? item.row.status !== PLAIN_PAID : item.money.refunded > 0 || item.money.held > 0 || item.money.lost > 0
  );
  const notes: FinanceBoostNotes = {
    empty: counted.length === 0,
    exact,
    otherStatusPurchases,
    unreadablePurchases,
    refundOrDispute,
  };
  const partial = !exact || unreadablePurchases > 0 || unreadableCredits > 0 || otherStatusPurchases > 0 || overflow;

  return {
    status: partial ? 'partial' : 'ok',
    lines,
    packages,
    deletedAccounts,
    notes,
    netMinorByCurrency,
    counts: { counted: counted.length, unreadableCredits, deletedAccountPurchases: deleted.length },
  };
}
