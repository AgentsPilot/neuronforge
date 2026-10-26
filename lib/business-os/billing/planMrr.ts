/**
 * MRR: the ONE rule for monthly recurring revenue from Business OS plan
 * subscriptions (plan payments P-8a.1, AM-3; workplan
 * docs/workplans/BUSINESS_OS_PLAN_PAYMENTS_P8A_WORKPLAN.md §4, SA-WP-P8a).
 *
 * The admin Subscriptions page uses it now and the Finance page (FIN slice 5b)
 * imports it later. Neither may define a second one (BD-19).
 *
 * PURE: no clock, no I/O, no data-layer import (this directory's placement
 * rule) and no entitlements import. The mode and the price of each tier are
 * PARAMETERS:
 *   - `livemode` is the CURRENT Stripe mode (PF-15: "admin lists and MRR filter
 *     on the current mode"). A row of the other mode is never money here; it
 *     is only counted in `otherModeExcluded`.
 *   - `priceOf(tier)` is the tier's monthly LIST price, excluding tax (BQ-P5),
 *     as integer hundredths with its currency. The wiring passes the catalog
 *     price that `check-bos-plan-prices` holds equal to the Stripe price
 *     (SA-P12). Why not the last paid invoice: `amount_minor` is Stripe's
 *     `amount_paid`, with tax and any prorated upgrade charge in it, so it is
 *     not the monthly amount (SA-WP-P8a (d)).
 *
 * What counts (workplan §4):
 *   - a row of the current mode that is PAYING (`isPayingBillingRow`: `active`
 *     or `past_due`, not ended; SA-Q5's set, adopted, never redefined);
 *   - cancelling at period end: counted until it ends, and shown as
 *     "of which cancelling" (BQ-P8a-3, settled);
 *   - `past_due`: counted and shown as "of which past due" while
 *     `MRR_COUNTS_PAST_DUE` is true. This is BQ-P8a-4, answered with its default
 *     (past due counted, shown apart). A "no" is this ONE constant;
 *   - a row with a founder discount (`founder_discount_applied_at`, only P-11
 *     sets it): never at list price. It goes in `discountUnknown` until P-11
 *     records the discounted price (BQ-P1 terms, SA-WP-P8a);
 *   - a tier with no monthly price: `unpriced`, counted by number, never 0 and
 *     never guessed.
 * Trials, free Founding Partners and admin-assigned plans have no paying
 * subscription row, so they are never in it.
 *
 * Money: one line per currency through `groupByCurrency`. NOTHING here adds
 * two currencies together (BD-12, CLAUDE.md "never sum money across currencies").
 *
 * @module lib/business-os/billing/planMrr
 */

import { isPayingBillingRow } from '@/lib/business-os/billing/payingSubscriptionStatuses';
import { groupByCurrency, normaliseCurrencyCode } from '@/lib/business-os/finance/currencyGroups';

/**
 * BQ-P8a-4 (open with the user; default built): does a `past_due` subscription
 * count in MRR? `true` = counted and shown as "of which past due". If the user
 * says no, set this to `false`. Nothing else changes.
 */
export const MRR_COUNTS_PAST_DUE = true;

/** The billing-row columns the rule reads. Plain strings: no import from the data layer. */
export interface MrrBillingRow {
  livemode: boolean;
  subscription_status: string | null;
  ended_at: string | null;
  cancel_at_period_end: boolean;
  bought_tier: string | null;
  founder_discount_applied_at: string | null;
}

/** A tier's monthly list price, excluding tax, in integer hundredths of `currency`. */
export interface MrrPrice {
  currency: string;
  monthlyHundredths: number;
}

export interface MrrInputs {
  /** The current Stripe mode (PF-15). */
  livemode: boolean;
  /** The monthly list price of a tier, or `null` when the tier has none. */
  priceOf: (tier: string) => MrrPrice | null;
  /** Defaults to `MRR_COUNTS_PAST_DUE`. A parameter only so the test can show the switch works. */
  countPastDue?: boolean;
}

/** How one row counts. */
export type MrrTreatment =
  | { kind: 'counted'; price: MrrPrice; cancelling: boolean; pastDue: boolean }
  | { kind: 'other_mode' }
  | { kind: 'not_paying' }
  | { kind: 'discount_unknown' }
  | { kind: 'unpriced' };

/** One currency's MRR. All amounts are integer hundredths of that currency. */
export interface MrrLine {
  /** Null = the "Unknown currency" line (a price with an unreadable code). */
  currency: string | null;
  totalHundredths: number;
  /** Of `totalHundredths`: subscriptions set to cancel at the period end. */
  cancellingHundredths: number;
  /** Of `totalHundredths`: `past_due` subscriptions (0 when they are not counted). */
  pastDueHundredths: number;
  subscriptions: number;
  /** A sum left the safe-integer range: the line is not exact (never silent). */
  overflow: boolean;
}

export interface MrrResult {
  lines: MrrLine[];
  unpriced: number;
  discountUnknown: number;
  otherModeExcluded: number;
  /** Whether `past_due` was counted (BQ-P8a-4), so the page can say so. */
  pastDueCounted: boolean;
}

const FIELDS = ['total', 'cancelling', 'pastDue'] as const;
type Field = (typeof FIELDS)[number];

/** How one billing row counts in MRR. Exported so the list and Finance 5b give the same answer per row. */
export function mrrTreatment(row: MrrBillingRow, inputs: MrrInputs): MrrTreatment {
  if (row.livemode !== inputs.livemode) return { kind: 'other_mode' };
  if (!isPayingBillingRow(row)) return { kind: 'not_paying' };
  const pastDue = row.subscription_status === 'past_due';
  const countPastDue = inputs.countPastDue ?? MRR_COUNTS_PAST_DUE;
  if (pastDue && !countPastDue) return { kind: 'not_paying' };
  if (row.founder_discount_applied_at !== null) return { kind: 'discount_unknown' };
  const price = row.bought_tier === null ? null : inputs.priceOf(row.bought_tier);
  if (price === null || !Number.isSafeInteger(price.monthlyHundredths) || price.monthlyHundredths < 0) {
    return { kind: 'unpriced' };
  }
  return { kind: 'counted', price, cancelling: row.cancel_at_period_end, pastDue };
}

/** MRR of the rows given, one line per currency. */
export function computeMrr(rows: Iterable<MrrBillingRow>, inputs: MrrInputs): MrrResult {
  const entries: Array<{ currency: unknown; field: Field; hundredths: number | null }> = [];
  const subscriptions = new Map<string | null, number>();
  let unpriced = 0;
  let discountUnknown = 0;
  let otherModeExcluded = 0;

  for (const row of rows) {
    const treatment = mrrTreatment(row, inputs);
    if (treatment.kind === 'other_mode') otherModeExcluded += 1;
    else if (treatment.kind === 'unpriced') unpriced += 1;
    else if (treatment.kind === 'discount_unknown') discountUnknown += 1;
    else if (treatment.kind === 'counted') {
      const { currency, monthlyHundredths } = treatment.price;
      entries.push({ currency, field: 'total', hundredths: monthlyHundredths });
      if (treatment.cancelling) entries.push({ currency, field: 'cancelling', hundredths: monthlyHundredths });
      if (treatment.pastDue) entries.push({ currency, field: 'pastDue', hundredths: monthlyHundredths });
      const code = normaliseCurrencyCode(currency);
      subscriptions.set(code, (subscriptions.get(code) ?? 0) + 1);
    }
  }

  const lines = groupByCurrency(entries, FIELDS).map(
    (line): MrrLine => ({
      currency: line.currency,
      totalHundredths: line.sums.total,
      cancellingHundredths: line.sums.cancelling,
      pastDueHundredths: line.sums.pastDue,
      subscriptions: subscriptions.get(line.currency) ?? 0,
      overflow: line.overflow,
    })
  );

  return {
    lines,
    unpriced,
    discountUnknown,
    otherModeExcluded,
    pastDueCounted: inputs.countPastDue ?? MRR_COUNTS_PAST_DUE,
  };
}
