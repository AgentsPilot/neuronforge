/**
 * Section 6 block A, "Our payment problems (boosts)", and held now (finance &
 * business health slice 4b.2, FR-4B-4, FR-4B-12, S4-FR-15 to S4-FR-17).
 * Workplan docs/workplans/BUSINESS_OS_FINANCE_HEALTH_SLICE_4B2_REVERSAL_DISPLAY_WORKPLAN.md § 5.2.
 *
 * PURE (SA-WR-4): every input is a parameter; no clock, no I/O. Its input is
 * STRUCTURAL: the rows R-l / R-l′ return, as of NOW (the window does not apply).
 *
 *   - HELD NOW (BD-17, FR-4B-4): a purchase in status `disputed` right now holds
 *     its total minus what was already refunded. That remainder is computed by
 *     ONE function, `heldNowOf` (pinned by the finance source guard). It is shown
 *     as its own figure and is never subtracted from any window's net.
 *   - NOT CREDITED: a purchase in status `flagged_mismatch` was paid at Stripe
 *     but gave no credits; its recorded total is shown, where recorded.
 *   - Each with the date it started: an open dispute's opened date (from its
 *     `dispute_opened` event, read by the repository), a purchase not credited's
 *     oldest status change. Dates are compared as stored ISO text, never parsed.
 *   - Money in integer minor units, behind the `minorUnitsPerMajor === 100`
 *     gate (S4-W-4), per currency through `groupByCurrency`. NOTHING here adds
 *     two currencies (BD-12).
 *   - Lost disputes are not repeated here: they are in revenue, in the month
 *     they were lost (FR-4B-12).
 *
 * Nothing here writes, and nothing touches a credit lot (BQ-13: no take-back).
 *
 * @module lib/business-os/finance/boostProblems
 */

import { minorUnitsPerMajor } from '@/lib/payments/refundMath';
import { CURRENCY_SCALE, groupByCurrency, normaliseCurrencyCode } from './currencyGroups';
import type { FinanceBoostProblemsLine, FinanceBoostProblemsPart } from './financeTypes';

/** One purchase that needs attention now, structurally (R-l / R-l′). */
export interface BoostAttentionInput {
  id: string;
  user_id: string | null;
  status: string | null;
  currency: unknown;
  amount_total_minor: unknown;
  amount_refunded_minor: unknown;
  status_changed_at: string | null;
  disputeOpenedAt: string | null;
}

export interface BoostProblemsResult {
  part: FinanceBoostProblemsPart;
  /** Held now per currency, in integer minor units (for `buildBoostRevenue`); null when the read failed. */
  heldNow: Array<{ currency: string | null; disputes: number; amountMinor: number | null }> | null;
  /** K-5's measurement (S4-FR-17): open disputes now; null when the read failed. */
  openDisputes: { value: number; exact: boolean } | null;
  /** For the route's info line: counts only. */
  counts: { rows: number; openDisputes: number; notCredited: number; openedDates: 'read' | 'failed' | null };
}

const DISPUTED = 'disputed';
const NOT_CREDITED = 'flagged_mismatch';
const FIELDS = ['held', 'notCredited'] as const;

/** A whole, non-negative number of minor units sent as a JSON number; anything else is null. */
function minorOf(raw: unknown): number | null {
  return typeof raw === 'number' && Number.isSafeInteger(raw) && raw >= 0 ? raw : null;
}

function twoDecimals(raw: unknown): boolean {
  const code = normaliseCurrencyCode(raw);
  return code !== null && minorUnitsPerMajor(code) === 100;
}

/**
 * FR-4B-4: what a disputed purchase holds NOW, in integer minor units: its
 * total minus what was already refunded. The ONLY code that computes the
 * held-now remainder. Null: unreadable (or refunded above the total).
 */
function heldNowOf(row: BoostAttentionInput): number | null {
  if (row.status !== DISPUTED || !twoDecimals(row.currency)) return null;
  const total = minorOf(row.amount_total_minor);
  const refunded = minorOf(row.amount_refunded_minor);
  if (total === null || refunded === null || refunded > total) return null;
  return total - refunded;
}

/** A recorded total of a purchase not credited; it may be absent on a flagged row (null, unreadable). */
function notCreditedTotalOf(row: BoostAttentionInput): number | null {
  return twoDecimals(row.currency) ? minorOf(row.amount_total_minor) : null;
}

const earliest = (a: string | null, b: string | null): string | null => (a === null ? b : b === null ? a : a < b ? a : b);

/** Minor units → the wire number, once, behind the two-decimal gate. */
const toMoney = (minor: number): number => minor / CURRENCY_SCALE;

export function buildBoostProblems(input: {
  /** Null: the read failed. */
  attention: { rows: readonly BoostAttentionInput[]; reachedCeiling: boolean; openedDates: 'read' | 'failed' } | null;
  /** From the revenue builder (FR-4B-8, SA-Q74); null when the event read failed. */
  eventsOnUnpaidPurchases: number | null;
  overTotal: number | null;
}): BoostProblemsResult {
  const { attention } = input;
  if (attention === null) {
    return {
      part: { status: 'unknown', figures: null },
      heldNow: null,
      openDisputes: null,
      counts: { rows: 0, openDisputes: 0, notCredited: 0, openedDates: null },
    };
  }

  const disputed = attention.rows.filter((row) => row.status === DISPUTED);
  const notCredited = attention.rows.filter((row) => row.status === NOT_CREDITED);

  const lines = groupByCurrency(
    [
      ...disputed.map((row) => ({ currency: row.currency, field: 'held' as const, hundredths: heldNowOf(row) })),
      ...notCredited.map((row) => ({ currency: row.currency, field: 'notCredited' as const, hundredths: notCreditedTotalOf(row) })),
    ],
    FIELDS
  );

  const byCurrency = (rows: readonly BoostAttentionInput[], currency: string | null) =>
    rows.filter((row) => normaliseCurrencyCode(row.currency) === currency);

  const figuresLines: FinanceBoostProblemsLine[] = lines.map((line) => {
    const open = byCurrency(disputed, line.currency);
    const flagged = byCurrency(notCredited, line.currency);
    const exactLine = !line.overflow;
    return {
      currency: line.currency,
      openDisputes: open.length,
      held: exactLine && line.unreadable.held === 0 ? toMoney(line.sums.held) : null,
      oldestDisputeOpenedAt: open.reduce<string | null>((acc, row) => earliest(acc, row.disputeOpenedAt), null),
      notCredited: flagged.length,
      notCreditedAmount: exactLine && line.unreadable.notCredited === 0 ? toMoney(line.sums.notCredited) : null,
      oldestNotCreditedAt: flagged.reduce<string | null>((acc, row) => earliest(acc, row.status_changed_at), null),
    };
  });

  const exact = !attention.reachedCeiling;
  const unreadable = lines.some((line) => line.overflow || line.unreadable.held > 0 || line.unreadable.notCredited > 0);
  const partial =
    !exact || unreadable || (disputed.length > 0 && attention.openedDates === 'failed') || input.eventsOnUnpaidPurchases === null;

  return {
    part: {
      status: partial ? 'partial' : 'ok',
      figures: {
        empty: disputed.length === 0 && notCredited.length === 0,
        exact,
        lines: figuresLines,
        openDisputes: disputed.length,
        notCredited: notCredited.length,
        openedDates: attention.openedDates,
        eventsOnUnpaidPurchases: input.eventsOnUnpaidPurchases,
        overTotal: input.overTotal,
      },
    },
    heldNow: lines
      .map((line) => ({
        currency: line.currency,
        disputes: byCurrency(disputed, line.currency).length,
        amountMinor: !line.overflow && line.unreadable.held === 0 ? line.sums.held : null,
      }))
      .filter((line) => line.disputes > 0),
    openDisputes: { value: disputed.length, exact },
    counts: {
      rows: attention.rows.length,
      openDisputes: disputed.length,
      notCredited: notCredited.length,
      openedDates: attention.openedDates,
    },
  };
}
