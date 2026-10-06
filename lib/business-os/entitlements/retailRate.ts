// lib/business-os/entitlements/retailRate.ts
//
// THE RETAIL (BASE) RATE — how many credits one US dollar buys at the standard
// rate, computed from the credit value and the markup.
//
// Business OS credits boost, slice 1 (requirement §8.1, FR-42, SA T-3a).
//
//   credits per dollar = 1 / (usdPerCredit × (1 + markup))
//
// It is never typed anywhere: a copy of the figure in the catalogue is exactly
// the drift FR-42 forbids. The plans sell at the same rate (pricing doc §3).
//
// ── INTEGERS, OR NO ANSWER ──────────────────────────────────────────────────
// The rate is required to be a whole number of credits per dollar, and a price
// is required to convert to a whole number of credits. Anything else is refused
// rather than rounded: a rounded figure is a price nobody decided. Money stays
// in minor units and is converted through `minorUnitsPerMajor` (NFR-9).
//
// Pure: no I/O, no logging (the caller logs).

import { minorUnitsPerMajor } from '@/lib/payments/refundMath';
import { currentCreditValue, type CreditValueVersion } from './config/creditValue';
import { currentCreditRetail, type CreditRetailVersion } from './config/creditRetail';

export interface RetailRate {
  /** The `CREDIT_RETAIL_HISTORY` entry the rate was computed from. */
  retailVersion: number;
  /** The `CREDIT_VALUE_HISTORY` entry the rate was computed from. */
  creditValueVersion: number;
  /** Credits one US dollar buys at the standard rate. Always a positive integer. */
  creditsPerUsd: number;
}

export type RetailRateResult = { ok: true; rate: RetailRate } | { ok: false; issue: string };

/** How close a computed rate must be to a whole number to count as one (relative). */
const WHOLE_NUMBER_TOLERANCE = 1e-9;

/**
 * The rate for one markup entry against one credit value entry. Refuses a
 * pairing the markup was not decided against, and a rate that is not a whole
 * number of credits per dollar.
 */
export function retailRateFor(retail: CreditRetailVersion, value: CreditValueVersion): RetailRateResult {
  if (retail.creditValueVersion !== value.version) {
    return {
      ok: false,
      issue: `retail version ${retail.version} was decided against credit value version ${retail.creditValueVersion}, not ${value.version}`,
    };
  }
  if (!Number.isFinite(retail.markup) || retail.markup < 0) {
    return { ok: false, issue: `retail version ${retail.version} has an invalid markup` };
  }
  if (!Number.isFinite(value.usdPerCredit) || value.usdPerCredit <= 0) {
    return { ok: false, issue: `credit value version ${value.version} has an invalid value` };
  }
  const raw = 1 / (value.usdPerCredit * (1 + retail.markup));
  const whole = Math.round(raw);
  if (!Number.isFinite(raw) || whole < 1 || Math.abs(raw - whole) > WHOLE_NUMBER_TOLERANCE * whole) {
    return { ok: false, issue: `rate is not a whole number of credits per dollar (${raw})` };
  }
  return {
    ok: true,
    rate: { retailVersion: retail.version, creditValueVersion: value.version, creditsPerUsd: whole },
  };
}

/**
 * The rate new sales use: the last markup entry against the CURRENT credit
 * value. Appending a credit value without deciding the markup against it makes
 * this refuse, so nothing sells at a rate nobody decided (fails closed).
 */
export function currentRetailRate(): RetailRateResult {
  return retailRateFor(currentCreditRetail(), currentCreditValue());
}

/**
 * Whole credits a price buys at the rate, or `null` when the price is not a
 * positive whole number of minor units or does not convert exactly.
 */
export function baseCreditsFor(priceMinor: number, currency: string, rate: RetailRate): number | null {
  if (!Number.isSafeInteger(priceMinor) || priceMinor <= 0) return null;
  // The rate is per US dollar; any other currency would need an exchange rate,
  // and there is none anywhere in the platform (FR-28).
  // The exact literal, as the catalogue schema requires (no case or space folding).
  if (currency !== 'USD') return null;
  const perMajor = minorUnitsPerMajor(currency);
  const scaled = priceMinor * rate.creditsPerUsd;
  if (!Number.isSafeInteger(scaled) || scaled % perMajor !== 0) return null;
  return scaled / perMajor;
}
