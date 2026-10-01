/**
 * The owner credit card's payload (credit deduction slice 6a, FR-28, SA SQ-27).
 *
 * CLIENT-SAFE: types only, no value import (a source guard pins it), so the
 * card can import it without pulling server code into the browser bundle.
 *
 * What is deliberately NOT here: no account id, no tokens, no dollars, no
 * cost, no model, no agent-platform credit unit and no fallback flag. The payload test holds the
 * exact key set and scans every key for those words.
 *
 * @module lib/business-os/credits/ownerCreditUsageTypes
 */

/**
 * `monthly`: the plan's own billing period, from its anchor.
 * `trial_total`: a one-off allowance, summed from the anchor.
 * `calendar_month`: no plan row; the charge recorder's calendar-month rule.
 */
export type OwnerCreditPeriodKind = 'monthly' | 'trial_total' | 'calendar_month';

export interface OwnerCreditAllowance {
  amount: number;
  per: 'month' | 'total';
}

export interface OwnerCreditUsage {
  period: {
    kind: OwnerCreditPeriodKind;
    /** When the next period starts (ISO instant), display only. Null whenever there is no allowance, and for a trial. */
    resetsOn: string | null;
  };
  /** Null means "no allowance": the card shows usage with no gauge, never "0 of 0". */
  allowance: OwnerCreditAllowance | null;
  /** Exact, 6 decimal places. */
  used: number;
  usedByOwner: number;
  usedAutomatic: number;
  /** Always 0 until grants exist (slice 11). The card ignores it. */
  granted: number;
  /** max(0, allowance + granted - used), unrounded; null without an allowance. */
  remaining: number | null;
}
