/**
 * Client payments in approximate US dollars: the converter (FIN BD-56;
 * requirement ADMIN_CLIENT_PAYMENTS_USD_REQUIREMENT.md §6, SA-RR-CPU SA-Q-3;
 * workplan docs/workplans/CLIENT_PAYMENTS_USD_1A_WORKPLAN.md §2.3).
 *
 * THE ONE EXCEPTION to "never sum money across currencies" (EX-1 to EX-6):
 * client payments only, admin only, labelled as converted, worked out on read,
 * never stored, never charged, never added to our revenue. Its one caller is
 * the admin finance route (pinned by clientPaymentsUsd.source.guard).
 *
 * PURE: no I/O, no clock (`readAt` is passed in), no logger, no server-only.
 *
 *   - Each currency's Gross (the takings line, `succeeded` + `refunded`,
 *     before fees, D-3 / D-4) is re-read as integer hundredths through the
 *     builder's own exact reader, and converted ONCE: hundredths ÷ (currency
 *     per $1) = US cents, by `divideHalfUp` (BigInt, half away from zero).
 *   - The rate is text. It must pass `isPositiveRate` first, so a zero, a
 *     negative or junk text is never divided by, and is never taken as 1
 *     (XR D-4). USD converts at 1 without a rate row (BASE_CURRENCY).
 *   - Codes are matched normalised (CPU-2), so a stored `ils` matches `ILS`.
 *     The "Unknown currency" line is never converted.
 *   - A stale rate (over 35 days) is still converted and flagged (D-5).
 *   - CPU-1: no float touches an amount or a rate. The only number
 *     conversions are `toHundredths` (via `readLineHundredths`) and
 *     `centsToWire`, the one edge to the wire (SA-Q-1A-1).
 *
 * @module lib/admin/exchangeRates/clientPaymentsUsd
 */

import { parseDecimal } from '@/lib/ai/pricing-research/decimal';
import { CURRENCY_SCALE, normaliseCurrencyCode, toHundredths } from '@/lib/business-os/finance/currencyGroups';
import type {
  FinanceClientPaymentsUsd,
  FinanceClientPaymentsUsdRow,
  FinanceSectionStatus,
  FinanceTakingsSection,
} from '@/lib/business-os/finance/financeTypes';

import { BASE_CURRENCY, isPositiveRate, isRateStale } from './exchangeRateRules';
import { divideHalfUp } from './rateMath';

/** One rate as the wiring reads it: the code raw, the rate as TEXT, never a JS number. */
export interface ClientPaymentRate {
  code: string;
  rate: string;
  enabled: boolean;
  lastUpdatedAt: string | null;
}

/** The wiring's answer. It never throws: a failed read is `failed`. */
export type ClientPaymentRatesRead = { status: 'ok'; rates: ClientPaymentRate[] } | { status: 'failed' };

export interface ClientPaymentsUsdInput {
  /** The takings section the builder made; `figures` null = the payments read failed. */
  takings: Pick<FinanceTakingsSection, 'figures'>;
  rates: ClientPaymentRatesRead;
  /** The request's one clock, ISO. */
  readAt: string;
}

const ZERO = BigInt(0);
const MAX_SAFE_CENTS = BigInt(Number.MAX_SAFE_INTEGER);

/** A takings line's Gross as integer hundredths, through the builder's own exact reader; null = unreadable (overflow). */
export function readLineHundredths(gross: number): number | null {
  return toHundredths(gross);
}

/**
 * THE edge to the wire (SA-Q-1A-1): integer cents → the major-unit number the
 * finance wire carries, as `toMoney` does. Null outside the safe-integer range,
 * so a figure is never a wrong number. The only `Number(` in this file.
 */
export function centsToWire(cents: bigint): number | null {
  if (cents > MAX_SAFE_CENTS || cents < -MAX_SAFE_CENTS) return null;
  return Number(cents) / CURRENCY_SCALE;
}

type RateMatch =
  | { kind: 'usable'; rate: ClientPaymentRate }
  | { kind: 'no_rate' }
  | { kind: 'disabled'; rate: ClientPaymentRate }
  | { kind: 'unusable'; rate: ClientPaymentRate | null };

function matchRate(code: string, rates: readonly ClientPaymentRate[]): RateMatch {
  const found = rates.filter((rate) => normaliseCurrencyCode(rate.code) === code);
  if (found.length === 0) return { kind: 'no_rate' };
  // Two rows for one code after normalising: which one is meant cannot be known.
  if (found.length > 1) return { kind: 'unusable', rate: null };
  const [rate] = found;
  if (!rate.enabled) return { kind: 'disabled', rate };
  if (!isPositiveRate(rate.rate)) return { kind: 'unusable', rate };
  return { kind: 'usable', rate };
}

export function buildClientPaymentsUsd(input: ClientPaymentsUsdInput): FinanceClientPaymentsUsd {
  const { takings, rates, readAt } = input;
  const ratesRead = rates.status === 'ok' ? 'ok' : 'failed';
  const figures = takings.figures;
  if (figures === null) {
    return {
      status: 'unknown',
      totalUsd: null,
      rows: [],
      converted: { payments: 0, currencies: 0 },
      notConverted: { payments: 0, currencies: 0 },
      ratesRead,
      stale: false,
    };
  }

  let totalCents = ZERO;
  let unreadablePayments = false;
  const rows: FinanceClientPaymentsUsdRow[] = [];

  // A line with no counted payment holds only refunds: not in this figure (U-3).
  for (const line of figures.lines.filter((l) => l.payments > 0)) {
    const code = normaliseCurrencyCode(line.currency);
    const base = { currency: code, payments: line.payments, gross: line.gross };
    const notConverted = (
      state: 'no_rate' | 'disabled' | 'unusable',
      rate: ClientPaymentRate | null
    ): FinanceClientPaymentsUsdRow => ({
      ...base,
      rate: rate ? rate.rate : null,
      rateUpdatedAt: rate ? rate.lastUpdatedAt : null,
      state,
      usd: null,
    });

    const hundredths = readLineHundredths(line.gross);
    if (code === null || hundredths === null) {
      rows.push(notConverted('unusable', null));
      continue;
    }

    let cents: bigint;
    let rateText: string;
    let rateUpdatedAt: string | null;
    let stale: boolean;
    if (code === BASE_CURRENCY) {
      cents = BigInt(hundredths);
      rateText = '1';
      rateUpdatedAt = null;
      stale = false;
    } else {
      if (rates.status !== 'ok') {
        rows.push(notConverted('no_rate', null));
        continue;
      }
      const match = matchRate(code, rates.rates);
      if (match.kind === 'no_rate') {
        rows.push(notConverted('no_rate', null));
        continue;
      }
      if (match.kind !== 'usable') {
        rows.push(notConverted(match.kind, match.rate));
        continue;
      }
      // isPositiveRate has passed, so the divisor is never zero (W-1, T-9).
      cents = divideHalfUp({ units: BigInt(hundredths), scale: 0 }, parseDecimal(match.rate.rate), 0).units;
      rateText = match.rate.rate;
      rateUpdatedAt = match.rate.lastUpdatedAt;
      stale = isRateStale({ currencyCode: code, lastUpdatedAt: match.rate.lastUpdatedAt }, readAt);
    }

    const usd = centsToWire(cents);
    const nextTotal = totalCents + cents;
    if (usd === null || centsToWire(nextTotal) === null) {
      rows.push(notConverted('unusable', null));
      continue;
    }
    totalCents = nextTotal;
    if (line.unreadablePayments > 0) unreadablePayments = true;
    rows.push({ ...base, rate: rateText, rateUpdatedAt, state: stale ? 'stale' : 'converted', usd });
  }

  const convertedRows = rows.filter((row) => row.state === 'converted' || row.state === 'stale');
  const otherRows = rows.filter((row) => row.state !== 'converted' && row.state !== 'stale');
  const count = (list: FinanceClientPaymentsUsdRow[]) => ({
    payments: list.reduce((n, row) => n + row.payments, 0),
    currencies: list.length,
  });
  // Refunds and fees are not in this figure, so their state never makes it partial (D-3, D-4).
  const partial = otherRows.length > 0 || !figures.paymentsExact || unreadablePayments;
  const status: FinanceSectionStatus = partial ? 'partial' : 'ok';

  return {
    status,
    totalUsd: centsToWire(totalCents),
    rows,
    converted: count(convertedRows),
    notConverted: count(otherRows),
    ratesRead,
    stale: convertedRows.some((row) => row.state === 'stale'),
  };
}
