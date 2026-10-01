/**
 * What is left of a credit allowance (credit deduction slice 6a, SA SQ-27).
 *
 * The ONE place the balance is computed, so slice 9's balance source can call
 * it rather than re-deriving it: `max(0, allowance + granted - used)`, or null
 * when there is no allowance. Never negative — consumption can exceed the
 * allowance, and a negative remainder would draw the card's gauge backwards.
 *
 * No display rounding: the card rounds (`creditDisplay.ts`). Only the ledger's
 * own precision (6 decimal places) is applied, so floating-point noise from the
 * subtraction never reaches a caller.
 *
 * @module lib/business-os/credits/creditBalance
 */

export interface CreditBalanceInput {
  /** Null means no allowance applies. */
  allowance: number | null;
  /** Credits granted on top of the allowance (slice 11). */
  granted: number;
  used: number;
}

const LEDGER_SCALE = 1e6;

export function roundToLedger(value: number): number {
  return Math.round(value * LEDGER_SCALE) / LEDGER_SCALE;
}

export function computeCreditBalance({ allowance, granted, used }: CreditBalanceInput): number | null {
  if (allowance === null) return null;
  // An unreadable figure is never turned into a full allowance: no answer instead.
  if (![allowance, granted, used].every(Number.isFinite)) return null;
  return Math.max(0, roundToLedger(allowance + granted - used));
}
