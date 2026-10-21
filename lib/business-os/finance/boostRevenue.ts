/**
 * "Our revenue", credit boosts (finance & business health slice 4a, S4-W-1 to
 * S4-W-8, S4-FR-1 to S4-FR-14; slice 4b.2, FR-4B-1 to FR-4B-9, FR-4B-16).
 * Workplans docs/workplans/BUSINESS_OS_FINANCE_HEALTH_SLICE_4A_WORKPLAN.md
 * § The boost revenue builder, and
 * docs/workplans/BUSINESS_OS_FINANCE_HEALTH_SLICE_4B2_REVERSAL_DISPLAY_WORKPLAN.md § 5.1.
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
 *     row it is given once and never looks at a date (AC-88). A purchase gives
 *     the gross, the tax and the credits sold of its window, nothing else.
 *   - BD-17 (slice 4b.2): refunds and lost disputes come from the REVERSAL
 *     EVENTS recorded in the window (R-n / R-n′), whatever month the purchase
 *     was paid in. The one function that reads an event's kind and amount is
 *     `reversalsOf`, below (pinned by the finance source guard). "Held" is NOT
 *     a window figure any more: open disputes are held NOW (R-l, FR-4B-4) and
 *     arrive here as `heldNow`, shown beside the lines, never in a net.
 *   - MINOR UNITS, EXACT (S4-W-4, SA-Q26, SA-W54). The amounts are integer
 *     minor units. They are used AS IS as integer hundredths, and that is
 *     correct only because an amount is readable only when
 *     `minorUnitsPerMajor(code)` (the one definition of currency decimals) is
 *     100. No amount is ever scaled up or converted through the decimal
 *     helpers. Each sum is divided by `CURRENCY_SCALE` once, at the edge.
 *   - UNREADABLE IS DECIDED PER ROW (SA-W48, FR-4B-9). A purchase or an event
 *     whose currency is not a three-letter code with two decimals, or whose
 *     amount is not a JSON number that is a safe integer >= 0, adds NO money
 *     anywhere. It is counted, makes that line's and that package row's net
 *     Unknown, and the block partial. An event whose purchase was not found,
 *     or of a kind this file does not know, is unreadable too.
 *   - An event on a purchase that was never paid (FR-4B-8) is not revenue: it
 *     moves no figure, and is counted for the problems note.
 *   - Lines come from `groupByCurrency`: one per normalised code, Unknown last.
 *     NOTHING here adds two currencies (S4-W-5, BD-12).
 *
 * Honesty: net = gross − refunded − lost (FR-4B-5), shown only when exact
 * (S4-W-8, FR-4B-9). It is null when either read reached its ceiling, the
 * event read failed (FR-4B-16: refunded and lost are null too, and there is
 * NO purchase-month fallback), or the line has an unreadable purchase or
 * event, or an overflow. It may be negative and is never clamped.
 *
 * Slice 6a (SA-Q45): `readMoney` is exported, so the account economics builder
 * reads a purchase's money through the one reader. Slice 4b.2 (SA-W118):
 * `readReversalMoney` is exported for the same reason, so that builder reads
 * an event's money without naming a kind or an amount column.
 *
 * @module lib/business-os/finance/boostRevenue
 */

import { minorUnitsPerMajor } from '@/lib/payments/refundMath';
import { CREDIT_SCALE, toUnits } from '@/lib/business-os/credits/creditReport';
import { CURRENCY_SCALE, groupByCurrency, normaliseCurrencyCode, type CurrencyLine } from './currencyGroups';
import type {
  FinanceBoostDeletedLine,
  FinanceBoostEventsNote,
  FinanceBoostHeldNowLine,
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
  /** Credits (6 dp): a number or a numeric string. */
  credits_total: number | string | null;
}

/** One reversal event (R-n / R-n′), structurally, with its purchase's fields. */
interface BoostReversalInput {
  id: string;
  purchase_id: string;
  kind: string | null;
  amount_minor: unknown;
  currency: unknown;
  /** Null: the purchase was not found (unreadable). */
  purchase: {
    user_id: string | null;
    package_id: string | null;
    package_version: number | null;
    amount_total_minor: unknown;
    amount_tax_minor: unknown;
    /** False: the purchase was never paid (FR-4B-8). */
    paid: boolean;
  } | null;
}

/** One currency's open disputes, held now (from `boostProblems.ts`, FR-4B-4). */
interface HeldNowInput {
  currency: string | null;
  disputes: number;
  /** Integer minor units; null when an amount on this line could not be read. */
  amountMinor: number | null;
}

/**
 * S4-W-2: the statuses that count, matched exactly (SA-WR-15). Finance's own
 * literal, checked against the migration's CHECKs by a test (the SA-W2
 * precedent): never imported from the boost module.
 */
export const BOOST_PAID_FAMILY = ['paid', 'partially_refunded', 'refunded', 'disputed', 'dispute_lost'] as const;

const PAID_FAMILY: ReadonlySet<string> = new Set<string>(BOOST_PAID_FAMILY);

const MONEY_FIELDS = ['gross', 'tax', 'refunded', 'lost'] as const;
type MoneyField = (typeof MONEY_FIELDS)[number];

export interface BoostRevenueResult {
  status: FinanceSectionStatus;
  /** Null only when `status` is `unknown` (the purchase read failed). */
  lines: FinanceBoostLine[] | null;
  packages: FinanceBoostPackageRow[] | null;
  /** Null with a business picked (S4-FR-8) or when the read failed. */
  deletedAccounts: FinanceBoostDeletedLine[] | null;
  notes: FinanceBoostNotes | null;
  /** FR-4B-4 / E-104: held now, per currency. Null when the attention read failed. */
  heldNow: FinanceBoostHeldNowLine[] | null;
  /** FR-4B-9 / FR-4B-16: how the event read went. Null only when the purchase read failed. */
  events: FinanceBoostEventsNote | null;
  /**
   * NON-WIRE input for the per-currency combiner (slice 5a, SA-W59): one entry
   * per line, the net in integer minor units, null exactly when the line's
   * wire `net` is null. K-5 is combined in `ourRevenue.ts` from this and the
   * plans received, never by scaling a wire number back up.
   */
  netMinorByCurrency: Array<{ currency: string | null; netMinor: number | null }>;
  /** For the route's info line: counts only. */
  counts: { counted: number; unreadableCredits: number; deletedAccountPurchases: number; events: number };
}

/** One readable purchase's money, in integer minor units of its currency. */
interface ReadableMoney {
  total: number;
  tax: number;
}

/** A whole, non-negative number of minor units sent as a JSON number; anything else is null (SA-W48). */
function minorOf(raw: unknown): number | null {
  return typeof raw === 'number' && Number.isSafeInteger(raw) && raw >= 0 ? raw : null;
}

/** The normalised code when the currency has two decimals; otherwise null (unreadable). */
function twoDecimalCode(raw: unknown): string | null {
  const code = normaliseCurrencyCode(raw);
  // Only a normalised, non-null code reaches `minorUnitsPerMajor` (it trims its input).
  if (code === null || minorUnitsPerMajor(code) !== 100) return null;
  return code;
}

/**
 * SA-W48: the purchase's money, or null when any part of it is unreadable.
 * Exported (slice 6a, SA-Q45): the account economics builder's one reader of boost money.
 */
export function readMoney(row: BoostPurchaseInput): ReadableMoney | null {
  if (twoDecimalCode(row.currency) === null) return null;
  const total = minorOf(row.amount_total_minor);
  const tax = minorOf(row.amount_tax_minor);
  if (total === null || tax === null) return null;
  return { total, tax };
}

/**
 * BD-17 (FR-4B-2 to FR-4B-4): what ONE reversal event takes off the window it
 * was recorded in. This is the ONLY code that reads an event's kind or amount
 * (pinned by the finance source guard). A refund takes its amount off, a lost
 * dispute takes its amount off; an opened or won dispute is history and moves
 * no money (held is a NOW figure). Null: unreadable (an amount that is not a
 * safe integer >= 0, a currency without two decimals, an unknown kind, or no
 * purchase).
 */
function reversalsOf(event: BoostReversalInput): { refunded: number; lost: number } | null {
  if (event.purchase === null || twoDecimalCode(event.currency) === null) return null;
  const amount = minorOf(event.amount_minor);
  if (amount === null) return null;
  switch (event.kind) {
    case 'refund':
      return { refunded: amount, lost: 0 };
    case 'dispute_lost':
      return { refunded: 0, lost: amount };
    case 'dispute_opened':
    case 'dispute_won':
      return { refunded: 0, lost: 0 };
    default:
      return null;
  }
}

/**
 * Slice 4b.2 (SA-W118): one event's money for the account economics builder.
 * `not_revenue`: the purchase was never paid (FR-4B-8). `tax` is the
 * purchase's tax, or null when unreadable (a taxed or unreadable tax makes the
 * account's after-tax figure inexact, SA-Q47). Null: the event is unreadable.
 */
export function readReversalMoney(
  event: BoostReversalInput
): { kind: 'money'; refunded: number; lost: number; tax: number | null } | { kind: 'not_revenue' } | null {
  const money = reversalsOf(event);
  if (money === null || event.purchase === null) return null;
  if (!event.purchase.paid) return { kind: 'not_revenue' };
  return { kind: 'money', ...money, tax: minorOf(event.purchase.amount_tax_minor) };
}

/** Hundredths → the wire number, once (SA-W26). Valid because a readable amount has two decimals. */
const toMoney = (hundredths: number): number => hundredths / CURRENCY_SCALE;

/** One row's money entries, its package and whether it is a counted purchase. */
interface Item {
  currency: unknown;
  packageId: string | null;
  packageVersion: number | null;
  deleted: boolean;
  entries: Array<{ field: MoneyField; hundredths: number | null }>;
  /** Purchases only: integer micro-credits (NaN when unreadable). Null for an event. */
  microCredits: number | null;
}

interface Summary {
  currency: string | null;
  purchases: number;
  sums: Record<MoneyField, number>;
  /** Purchases with unreadable money. */
  unreadable: number;
  /** Events with unreadable money. */
  unreadableEvents: number;
  overflow: boolean;
  microCredits: number;
  unreadableCredits: number;
}

/** Per currency, through `groupByCurrency` (S4-W-5): money in integer minor units, plus counts and credits. */
function summarise(items: readonly Item[]): Summary[] {
  const lines: CurrencyLine<MoneyField>[] = groupByCurrency(
    items.flatMap((item) => item.entries.map((entry) => ({ currency: item.currency, ...entry }))),
    MONEY_FIELDS
  );

  const extra = new Map<string | null, { purchases: number; microCredits: number; unreadableCredits: number }>();
  for (const item of items) {
    if (item.microCredits === null) continue;
    const currency = normaliseCurrencyCode(item.currency);
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
      unreadableEvents: line.unreadable.refunded,
      overflow: line.overflow,
      microCredits: acc.microCredits,
      unreadableCredits: acc.unreadableCredits,
    };
  });
}

/** FR-4B-5: net in integer minor units, or null when it cannot be exact (S4-W-8, FR-4B-9). */
function netOf(summary: Summary, exact: boolean): number | null {
  if (!exact || summary.unreadable > 0 || summary.unreadableEvents > 0 || summary.overflow) return null;
  const { gross, refunded, lost } = summary.sums;
  const net = gross - refunded - lost;
  return Number.isSafeInteger(net) ? net : null;
}

/** Ascending, NULL last. */
function compareNullable<T extends string | number>(a: T | null, b: T | null): number {
  if (a === b) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return a < b ? -1 : 1;
}

const packageIdOf = (raw: string | null | undefined): string | null => (typeof raw === 'string' && raw !== '' ? raw : null);
const packageVersionOf = (raw: number | null | undefined): number | null =>
  typeof raw === 'number' && Number.isSafeInteger(raw) ? raw : null;

export function buildBoostRevenue(input: {
  /** Null: the read failed. */
  purchases: { rows: readonly BoostPurchaseInput[]; reachedCeiling: boolean } | null;
  /** Null: the event read failed (FR-4B-16). `absent`: it failed because the table does not exist yet (§7). */
  events: { rows: readonly BoostReversalInput[]; reachedCeiling: boolean } | null;
  eventsAbsent?: boolean;
  /** Null: the attention read failed. */
  heldNow: readonly HeldNowInput[] | null;
  scope: 'all' | 'one';
}): BoostRevenueResult {
  const { purchases, events, scope } = input;
  const heldNow: FinanceBoostHeldNowLine[] | null =
    input.heldNow === null
      ? null
      : input.heldNow.map((line) => ({
          currency: line.currency,
          disputes: line.disputes,
          amount: line.amountMinor === null ? null : toMoney(line.amountMinor),
        }));
  if (purchases === null) {
    return {
      status: 'unknown',
      lines: null,
      packages: null,
      deletedAccounts: null,
      notes: null,
      heldNow,
      events: null,
      netMinorByCurrency: [],
      counts: { counted: 0, unreadableCredits: 0, deletedAccountPurchases: 0, events: 0 },
    };
  }

  const eventsRead = events !== null;
  const exact = !purchases.reachedCeiling && eventsRead && !events.reachedCeiling;
  const countedRows = purchases.rows.filter((row) => row.status !== null && PAID_FAMILY.has(row.status));
  const otherStatusPurchases = purchases.rows.length - countedRows.length;

  // ── Purchases: gross, tax, credits (FR-4B-1) ─────────────────────────────
  const items: Item[] = countedRows.map((row) => {
    const money = readMoney(row);
    return {
      currency: row.currency,
      packageId: packageIdOf(row.package_id),
      packageVersion: packageVersionOf(row.package_version),
      deleted: row.user_id === null,
      entries:
        money === null
          ? [{ field: 'gross', hundredths: null }]
          : [
              { field: 'gross', hundredths: money.total },
              { field: 'tax', hundredths: money.tax },
            ],
      microCredits: toUnits(row.credits_total, CREDIT_SCALE),
    };
  });
  const unreadablePurchases = items.filter((item) => item.entries[0].hundredths === null).length;

  // ── Events: refunded and lost by the date we recorded them (FR-4B-2, FR-4B-3) ──
  let unreadableEvents = 0;
  let onUnpaidPurchases = 0;
  let refundEvents = 0;
  const perPurchase = new Map<string, { taken: number; total: number | null }>();
  for (const event of events?.rows ?? []) {
    const money = reversalsOf(event);
    if (money !== null && event.purchase !== null && !event.purchase.paid) {
      onUnpaidPurchases += 1;
      continue;
    }
    if (money === null) unreadableEvents += 1;
    else if (money.refunded > 0) refundEvents += 1;
    items.push({
      currency: event.currency,
      packageId: packageIdOf(event.purchase?.package_id),
      packageVersion: packageVersionOf(event.purchase?.package_version),
      deleted: event.purchase !== null && event.purchase.user_id === null,
      entries:
        money === null
          ? [{ field: 'refunded', hundredths: null }]
          : [
              { field: 'refunded', hundredths: money.refunded },
              { field: 'lost', hundredths: money.lost },
            ],
      microCredits: null,
    });
    if (money !== null && event.purchase !== null) {
      const acc = perPurchase.get(event.purchase_id) ?? { taken: 0, total: minorOf(event.purchase.amount_total_minor) };
      acc.taken += money.refunded + money.lost;
      perPurchase.set(event.purchase_id, acc);
    }
  }
  // SA-Q74: counted as recorded, never clamped; a note says when it happens.
  const overTotal = [...perPurchase.values()].filter((p) => p.total !== null && p.taken > p.total).length;

  // ── Per currency (S4-W-5, FR-4B-5) ───────────────────────────────────────
  const summaries = summarise(items);
  const refundedOf = (s: Summary): number | null => (eventsRead ? toMoney(s.sums.refunded) : null);
  const lostOf = (s: Summary): number | null => (eventsRead ? toMoney(s.sums.lost) : null);
  const netMinorByCurrency = summaries.map((s) => ({ currency: s.currency, netMinor: netOf(s, exact) }));
  const lines: FinanceBoostLine[] = summaries.map((s) => {
    const net = netOf(s, exact);
    return {
      currency: s.currency,
      purchases: s.purchases,
      gross: toMoney(s.sums.gross),
      tax: toMoney(s.sums.tax),
      refunded: refundedOf(s),
      lost: lostOf(s),
      net: net === null ? null : toMoney(net),
      creditsSold: s.microCredits / CREDIT_SCALE,
      unreadable: s.unreadable,
      unreadableEvents: s.unreadableEvents,
      unreadableCredits: s.unreadableCredits,
    };
  });

  // ── By package, as stored on the purchase (S4-FR-3, SA-Q30, FR-4B-7) ─────
  const byPackage = new Map<string, { packageId: string | null; packageVersion: number | null; items: Item[] }>();
  for (const item of items) {
    const key = JSON.stringify([normaliseCurrencyCode(item.currency), item.packageId, item.packageVersion]);
    const group = byPackage.get(key) ?? { packageId: item.packageId, packageVersion: item.packageVersion, items: [] };
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
          refunded: refundedOf(s),
          net: net === null ? null : toMoney(net),
          unreadable: s.unreadable + s.unreadableEvents,
        };
      })
    )
    .sort(
      (a, b) =>
        compareNullable(a.currency, b.currency) ||
        compareNullable(a.packageId, b.packageId) ||
        compareNullable(a.packageVersion, b.packageVersion)
    );

  // ── Deleted accounts, all businesses only (S4-W-7, S4-FR-8, FR-4B-7) ────
  const deleted = items.filter((item) => item.deleted);
  const deletedAccounts: FinanceBoostDeletedLine[] | null =
    scope === 'one'
      ? null
      : summarise(deleted).map((s) => {
          const net = netOf(s, exact);
          return {
            currency: s.currency,
            purchases: s.purchases,
            net: net === null ? null : toMoney(net),
            unreadable: s.unreadable + s.unreadableEvents,
          };
        });

  // ── Notes, status ────────────────────────────────────────────────────────
  const unreadableCredits = summaries.reduce((n, s) => n + s.unreadableCredits, 0);
  const overflow = summaries.some((s) => s.overflow);
  const counted = countedRows.length;
  // FR-4B-6: a refund, lost or held figure is non-zero, or a refund or lost amount is unknown.
  const refundOrDispute =
    summaries.some((s) => s.sums.refunded > 0 || s.sums.lost > 0) ||
    unreadableEvents > 0 ||
    (heldNow ?? []).some((line) => line.disputes > 0);
  const notes: FinanceBoostNotes = {
    // Nothing to show: no counted purchase AND no event of the window (a refund alone is a line, FR-4B-5).
    empty: items.length === 0,
    exact,
    otherStatusPurchases,
    unreadablePurchases,
    refundOrDispute,
  };
  const eventsNote: FinanceBoostEventsNote = {
    state: eventsRead ? 'read' : input.eventsAbsent ? 'not_available' : 'failed',
    exact: eventsRead && !events.reachedCeiling,
    unreadable: unreadableEvents,
    onUnpaidPurchases,
    overTotal,
    refundEvents,
  };
  const partial =
    !exact ||
    !eventsRead ||
    unreadablePurchases > 0 ||
    unreadableEvents > 0 ||
    unreadableCredits > 0 ||
    otherStatusPurchases > 0 ||
    overflow;

  return {
    status: partial ? 'partial' : 'ok',
    lines,
    packages,
    deletedAccounts,
    notes,
    heldNow,
    events: eventsNote,
    netMinorByCurrency,
    counts: {
      counted,
      unreadableCredits,
      deletedAccountPurchases: countedRows.filter((row) => row.user_id === null).length,
      events: events?.rows.length ?? 0,
    },
  };
}
