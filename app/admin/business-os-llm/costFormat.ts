/**
 * Number and date rendering for the Costs & credits tab.
 *
 * A Business OS action often costs less than a cent — an embedding-only action
 * is about $0.0000002 — so a two-decimal USD format would print "$0.00" for a
 * real, non-zero charge. `formatUsd` keeps enough decimals to show the first
 * two significant digits, up to the ledger's own 10 decimal places.
 *
 * UTC throughout, for the reason `format.ts` gives: two admins reading the same
 * figure must read the same date.
 */

/** The ledger stores cost at 10 decimal places; nothing finer is STORED. */
const MAX_USD_DECIMALS = 10;
/** The ledger stores credits at 6 decimal places. */
const MAX_CREDIT_DECIMALS = 6;
/** `toLocaleString` accepts at most 20 fraction digits. */
const MAX_FRACTION_DIGITS = 20;

/** Zeros between the decimal point and the first significant digit of `abs` (0 < abs < 1). */
function leadingZeros(abs: number): number {
  return Math.floor(-Math.log10(abs));
}

/**
 * Decimals that show two significant digits of `abs` (at least 2, at most 10).
 * A non-zero value below the stored precision (an interpolated p50 / p90 can
 * be) gets the decimals its two significant digits need instead, so it never
 * prints as `$0.00` (QA edge 6).
 */
function usdDecimals(abs: number): number {
  if (abs >= 1) return 2;
  if (abs === 0) return 2;
  const wanted = Math.max(2, leadingZeros(abs) + 2);
  return abs < 10 ** -MAX_USD_DECIMALS ? Math.min(MAX_FRACTION_DIGITS, wanted) : Math.min(MAX_USD_DECIMALS, wanted);
}

/** `$1,234.56`, `$0.0042`, `$0.00000021`, `-$0.30`, `$0`. `—` for null. */
export function formatUsd(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  if (value === 0) return '$0';
  const abs = Math.abs(value);
  const decimals = usdDecimals(abs);
  const text = abs.toLocaleString('en-US', {
    minimumFractionDigits: abs >= 1 ? 2 : Math.min(decimals, 2),
    maximumFractionDigits: decimals,
    useGrouping: true,
  });
  return `${value < 0 ? '-' : ''}$${text}`;
}

/**
 * Credits at up to 6 decimals (the ledger's precision), trailing zeros dropped.
 * A non-zero value below that precision (an interpolated percentile) keeps two
 * significant digits instead of printing as `0` (QA edge 6).
 */
export function formatCredits(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  const abs = Math.abs(value);
  const decimals =
    abs !== 0 && abs < 10 ** -MAX_CREDIT_DECIMALS
      ? Math.min(MAX_FRACTION_DIGITS, leadingZeros(abs) + 2)
      : MAX_CREDIT_DECIMALS;
  return value.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: decimals });
}

/** A count with thousands separators. */
export function formatCount(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  return value.toLocaleString('en-US');
}

/** `2026-09-05` from any instant; the input as-is when it cannot be read. */
export function formatDay(at: string): string {
  const ms = Date.parse(at);
  return Number.isNaN(ms) ? at : new Date(ms).toISOString().slice(0, 10);
}

/** `YYYY-MM-DD` of today minus `days`, UTC. */
export function utcDateDaysAgo(days: number, now: Date = new Date()): string {
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}
