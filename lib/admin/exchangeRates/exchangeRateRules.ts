/**
 * Exchange rates admin, slice 1a: the pure rules shared by the admin route and
 * the admin page (requirement ADMIN_EXCHANGE_RATES_REQUIREMENT.md, §13 SQ-3,
 * SQ-5 as amended by SA O-1, SA-R8, FR-8).
 *
 * Pure: no I/O, no React, no server-only import, so the `'use client'` page may
 * import it. Nothing here converts money (D-5): a rate is only validated,
 * compared with another rate, and shown.
 *
 * Rates travel as DECIMAL STRINGS end to end and are never parsed into a JS
 * number, so no float rounding can reach the `numeric(12,6)` column.
 */

import { z } from 'zod';

/** The base currency. Its rate is fixed at 1; it cannot be edited or disabled (FR-4, SA-R8). */
export const BASE_CURRENCY = 'USD';

/** A rate older than this many days is stale (R-3, D-2: one rate per month, with grace). */
export const STALE_AFTER_DAYS = 35;

/** The words the page shows for a stale rate (SA O-5: "not updated", never "not confirmed"). */
export const STALE_LABEL = 'Stale';
export const STALE_DESCRIPTION = `not updated in ${STALE_AFTER_DAYS} days`;

/**
 * How many history rows the GET returns (SA-R4). Fixed: never caller-supplied.
 * The one source: `ExchangeRatesRepository` imports it.
 */
export const HISTORY_LIMIT = 50;

/**
 * SA O-1 (amends SQ-5): the live column is `numeric(12,6)`, so at most 6
 * integer digits and 6 decimals. The pattern alone caps the value at
 * 999,999.999999: nothing that passes it can overflow the column.
 */
export const RATE_PATTERN = /^\d{1,6}(\.\d{1,6})?$/;

/** The largest storable rate. For tests and the page hint only, never a second rule (SA O-1). */
export const RATE_MAX = '999999.999999';

/** Three upper-case letters (SQ-3); the live column carries the same CHECK. */
export const CURRENCY_CODE_PATTERN = /^[A-Z]{3}$/;

export const currencyCodeSchema = z.string().regex(CURRENCY_CODE_PATTERN);

/** `> 0` decided on the string: a rate that passed RATE_PATTERN is positive iff it has a non-zero digit. */
export function isPositiveRate(rate: string): boolean {
  return RATE_PATTERN.test(rate) && /[1-9]/.test(rate);
}

export const rateStringSchema = z
  .string()
  .regex(RATE_PATTERN, 'Use up to 6 digits, optionally a point and up to 6 decimals')
  .refine((rate) => /[1-9]/.test(rate), 'The rate must be greater than 0');

/** One change per request, the field named in the body (SQ-3). Unknown keys are refused. */
export const patchBodySchema = z.discriminatedUnion('field', [
  z.object({ field: z.literal('rate'), rate: rateStringSchema }).strict(),
  z.object({ field: z.literal('enabled'), isEnabled: z.boolean() }).strict(),
]);

export type ExchangeRatePatchBody = z.infer<typeof patchBodySchema>;

/** Canonical form of a decimal string: no leading integer zeros, no trailing fraction zeros. */
export function normaliseRate(rate: string): string {
  const [rawInt, rawFrac = ''] = rate.trim().split('.');
  const intPart = rawInt.replace(/^0+/, '') || '0';
  const fracPart = rawFrac.replace(/0+$/, '');
  return fracPart ? `${intPart}.${fracPart}` : intPart;
}

/** True when two decimal strings are the same number ("3.65" and "3.650000"). */
export function sameRate(a: string | null, b: string | null): boolean {
  if (a === null || b === null) return a === b;
  return normaliseRate(a) === normaliseRate(b);
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * True when the rate was last updated more than STALE_AFTER_DAYS before
 * `readAt` (the server clock from the GET). A missing or unreadable date is
 * stale: nothing proves the rate is current.
 */
export function isStale(lastUpdatedAt: string | null, readAt: string): boolean {
  if (!lastUpdatedAt) return true;
  const updated = Date.parse(lastUpdatedAt);
  const now = Date.parse(readAt);
  if (Number.isNaN(updated) || Number.isNaN(now)) return true;
  return now - updated > STALE_AFTER_DAYS * DAY_MS;
}

/**
 * Whether a currency's rate needs attention (FR-8). The base currency never
 * does: its rate is fixed at 1 and cannot be edited (SA-R8), so a Stale chip
 * on it could never be cleared (review finding B-1).
 */
export function isRateStale(rate: { currencyCode: string; lastUpdatedAt: string | null }, readAt: string): boolean {
  if (rate.currencyCode === BASE_CURRENCY) return false;
  return isStale(rate.lastUpdatedAt, readAt);
}

/** Whole days between the last update and `readAt`, for the age line; null when unknown. */
export function ageInDays(lastUpdatedAt: string | null, readAt: string): number | null {
  if (!lastUpdatedAt) return null;
  const updated = Date.parse(lastUpdatedAt);
  const now = Date.parse(readAt);
  if (Number.isNaN(updated) || Number.isNaN(now)) return null;
  return Math.max(0, Math.floor((now - updated) / DAY_MS));
}

// ── Wire types (GET / PATCH payloads) ───────────────────────────────────────

export interface ExchangeRateWire {
  currencyCode: string;
  currencyName: string;
  currencySymbol: string;
  /** The stored `numeric` as text, exactly as the database holds it. */
  rateToUsd: string;
  /** `null` in the database reads as `false` (SA §10 additional ruling 1). */
  isEnabled: boolean;
  /** A display hint (0..4), NOT the rate's scale (SA §10 additional ruling 3). */
  decimalPlaces: number | null;
  lastUpdatedAt: string | null;
  updatedBy: string | null;
}

export interface ExchangeRateHistoryWire {
  id: string;
  currencyCode: string;
  oldRate: string | null;
  newRate: string;
  changedBy: string | null;
  changedAt: string;
  /** Present on the table but never written by the trigger; the page shows no Reason column. */
  changeReason: string | null;
}

export interface ExchangeRatesPayload {
  rates: ExchangeRateWire[];
  history: ExchangeRateHistoryWire[];
  /** Server clock at the read; the page's stale rule measures against it. */
  readAt: string;
}

export interface ExchangeRatePatchResult {
  rate: ExchangeRateWire;
  /** The save carried the stored value: "confirmed for this month" (SA-R7). */
  unchanged: boolean;
}
