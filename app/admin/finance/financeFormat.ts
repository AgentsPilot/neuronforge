/**
 * Number formatting for the finance page. Ledger cost is USD by construction
 * and is always labelled USD (AC-14); a lower bound always keeps "At least".
 */

import { AT_LEAST } from './financeCopy';

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
