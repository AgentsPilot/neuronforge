/**
 * Number formatting for the finance page. Ledger cost is USD by construction;
 * a lower bound always keeps "At least".
 *
 * Money MK-5a (KPI restructure review §3.4 USD-1 to USD-6, SA-9, BD-47): a US
 * dollar amount prints with the `$` sign ("$1,234.56", "-$5.00"), never
 * "USD 1,234.56". Any other currency keeps its own code on its own line
 * ("ILS 230.30"), never converted (USD-3); nothing here adds two currencies.
 * The tiles print only through `formatUsdSign`, which takes ONE US-dollar line
 * and refuses any other (SA-9). The copy guard (`usdCopy.source.guard.test.ts`)
 * keeps "USD " money strings out of the page.
 */

import { AT_LEAST, TAKINGS_UNKNOWN_CURRENCY } from './financeCopy';

/** The one currency code shown with a sign (BD-47). */
const US_DOLLAR = 'USD';

const isUsDollar = (currency: string | null): boolean => currency !== null && currency.trim().toUpperCase() === US_DOLLAR;

/** `$1,234.56` / `-$1,234.56` for a US-dollar amount with the given decimals. */
function dollars(amount: number, minimumFractionDigits: number, maximumFractionDigits: number): string {
  const text = Math.abs(amount).toLocaleString('en-US', { minimumFractionDigits, maximumFractionDigits, useGrouping: true });
  return amount < 0 ? `-$${text}` : `$${text}`;
}

/**
 * A money figure with its currency (slice 2a, SA-WR-18; MK-5a): "$1,234.56"
 * for US dollars, "Unknown currency 12.00", "EUR -5.00" for any other.
 * Exactly two decimals, fixed: the server sends a whole number of hundredths
 * divided by 100 once, and this prints it exactly. The page never adds or
 * subtracts money; net comes from the server.
 */
export function formatMoney(amount: number, currency: string | null): string {
  if (isUsDollar(currency)) return dollars(amount, 2, 2);
  const text = amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: true });
  return `${currency ?? TAKINGS_UNKNOWN_CURRENCY} ${text}`;
}

/** Ledger cost, US dollars by construction: "$0.0012" keeps up to four decimals (a small AI cost is never $0.00). */
export function formatUsd(value: number): string {
  return dollars(value, 2, 4);
}

/**
 * SA-9 (MK-5a): ONE US-dollar line as `$…`, for the KPI tiles. Any other code,
 * an unknown code or a missing one gives `null`, so a tile can never print
 * another currency's figure as its value (USD-5); the caller shows the
 * "other currencies" note instead. `maxDecimals` is for AI cost only (4).
 */
export function formatUsdSign(line: { currency: string | null; amount: number }, opts: { maxDecimals?: 2 | 4 } = {}): string | null {
  if (!isUsDollar(line.currency) || !Number.isFinite(line.amount)) return null;
  return dollars(line.amount, 2, opts.maxDecimals ?? 2);
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
