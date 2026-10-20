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
 * How many history rows the GET returns, overall and per currency (SA-R4;
 * 10 since slice 1c.1, FR-18). Fixed: never caller-supplied. The one source:
 * `ExchangeRatesRepository` imports it, and the page's captions read it.
 */
export const HISTORY_LIMIT = 10;

/** The "Changed by" label when nobody can be named (FR-19, SQ-13). */
export const UNKNOWN_USER_LABEL = 'Unknown user';

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

/**
 * The GET's query string (slice 1c.1, SQ-12): nothing, or one `currency` code.
 * Strict, so any other key (a `limit`, say) is refused rather than ignored.
 * The route refuses a repeated key before this runs.
 */
export const exchangeRatesQuerySchema = z.object({ currency: currencyCodeSchema.optional() }).strict();

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

/** Decimal places the Last rate change tile shows (user request, 2026-10-20). */
export const KPI_RATE_DECIMALS = 3;

/** Adds one to a string of digits ("0999" → "1000"), carrying as on paper. */
function incrementDigits(digits: string): string {
  const out = digits.split('');
  for (let i = out.length - 1; i >= 0; i -= 1) {
    if (out[i] !== '9') {
      out[i] = String.fromCharCode(out[i].charCodeAt(0) + 1);
      return out.join('');
    }
    out[i] = '0';
  }
  return `1${out.join('')}`;
}

/**
 * A stored rate rounded half-up to `places` decimals for display, always with
 * exactly `places` digits ("3.650000" → "3.650", "0.0005" → "0.001").
 * Done on the digits, never through Number, so no float error creeps in and
 * nothing here is arithmetic on money (D-5). A string that is not a plain
 * decimal is returned unchanged.
 */
export function roundRateForDisplay(rate: string, places: number = KPI_RATE_DECIMALS): string {
  const trimmed = rate.trim();
  if (!/^\d+(\.\d+)?$/.test(trimmed)) return rate;
  const [intPart, fracPart = ''] = trimmed.split('.');
  if (fracPart.length <= places) return `${intPart}.${fracPart.padEnd(places, '0')}`;
  const kept = `${intPart}${fracPart.slice(0, places)}`;
  const roundedUp = fracPart.charCodeAt(places) >= '5'.charCodeAt(0);
  const digits = (roundedUp ? incrementDigits(kept) : kept).padStart(places + 1, '0');
  return `${digits.slice(0, digits.length - places)}.${digits.slice(digits.length - places)}`;
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
  /** The editor's user id: kept for tracing (the cell's hover text), never shown as the label. */
  changedBy: string | null;
  /**
   * Who made the change, resolved on the server (slice 1c.1, SQ-13): name, else
   * admin email, else "Unknown user". Null only when the name lookup failed and
   * this row's editor was looked up; the page then shows the short id.
   */
  changedByLabel: string | null;
  changedAt: string;
  /** Present on the table but never written by the trigger; the page shows no Reason column. */
  changeReason: string | null;
}

/**
 * A history row as the repository maps it, before the route has resolved its
 * label. Only `labelHistory` turns it into the wire type, so no path can send
 * history without having resolved (or explicitly failed) the labels.
 */
export type ExchangeRateHistoryRecord = Omit<ExchangeRateHistoryWire, 'changedByLabel'>;

/** `failed`: the name lookup failed, so looked-up editors carry no label (SQ-13). */
export type NameLookupStatus = 'ok' | 'failed';

export interface ExchangeRatesPayload {
  rates: ExchangeRateWire[];
  history: ExchangeRateHistoryWire[];
  nameLookup: NameLookupStatus;
  /** Server clock at the read; the page's stale rule measures against it. */
  readAt: string;
}

/**
 * `GET ?currency=XXX` (slice 1c.1, SQ-12): one currency's newest changes. A
 * separate type, so the page can never take rates or the Last rate change tile
 * from it.
 */
export interface ExchangeRateHistoryPayload {
  currencyCode: string;
  history: ExchangeRateHistoryWire[];
  nameLookup: NameLookupStatus;
  readAt: string;
}

// ── "Changed by" labels (slice 1c.1, SQ-13 with SA Q-1) ─────────────────────

/** The editors to look up: distinct, non-null ids, taken only from the rows read. */
export function historyEditorIds(records: readonly ExchangeRateHistoryRecord[]): string[] {
  const ids = new Set<string>();
  for (const record of records) {
    if (record.changedBy) ids.add(record.changedBy);
  }
  return [...ids];
}

export type EditorLookup =
  | { status: 'ok'; names: ReadonlyMap<string, string>; emails: ReadonlyMap<string, string> }
  | { status: 'failed' };

/**
 * The one label rule. On `ok`: a trimmed non-empty name, else the admin email,
 * else "Unknown user"; every label is set. On `failed`: every row whose editor
 * was looked up gets `null` (all or nothing: resolved names are never mixed
 * with raw ids), while a row with no editor id is "Unknown user" either way:
 * nothing was looked up for it, so nothing failed (SA Q-1).
 */
export function labelHistory(
  records: readonly ExchangeRateHistoryRecord[],
  lookup: EditorLookup
): ExchangeRateHistoryWire[] {
  return records.map((record) => {
    if (!record.changedBy) return { ...record, changedByLabel: UNKNOWN_USER_LABEL };
    if (lookup.status === 'failed') return { ...record, changedByLabel: null };
    const name = lookup.names.get(record.changedBy)?.trim();
    const email = lookup.emails.get(record.changedBy)?.trim();
    return { ...record, changedByLabel: name || email || UNKNOWN_USER_LABEL };
  });
}

export interface ExchangeRatePatchResult {
  rate: ExchangeRateWire;
  /** The save carried the stored value: "confirmed for this month" (SA-R7). */
  unchanged: boolean;
}
