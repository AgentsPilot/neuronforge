/**
 * Number formatting for the finance page. Ledger cost is USD by construction
 * and is always labelled USD (AC-14); a lower bound always keeps "At least".
 */

import { AT_LEAST, TAKINGS_UNKNOWN_CURRENCY } from './financeCopy';

/**
 * A layer-B money figure with its currency (slice 2a, SA-WR-18): "USD 1,234.56",
 * "Unknown currency 12.00", "EUR -5.00". Exactly two decimals, fixed: the
 * server sends a whole number of hundredths divided by 100 once, and this
 * prints it exactly. The page never adds or subtracts money; net comes from
 * the server.
 */
export function formatMoney(amount: number, currency: string | null): string {
  const text = amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: true });
  return `${currency ?? TAKINGS_UNKNOWN_CURRENCY} ${text}`;
}

export function formatUsd(value: number): string {
  return `USD ${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4 })}`;
}

export function formatCredits(value: number): string {
  return value.toLocaleString('en-US', { maximumFractionDigits: 2 });
}

export function formatCount(value: number): string {
  return value.toLocaleString('en-US');
}

/** "At least X" when the figure is a lower bound (AGG-3). */
export function atLeast(text: string, exact: boolean): string {
  return exact ? text : `${AT_LEAST} ${text}`;
}
