/**
 * Named accounting periods — "last quarter" as a pair of dates.
 *
 * WHY THIS IS ITS OWN MODULE
 *
 * The export modal already knew how to turn "this quarter" into bounds, but the
 * maths lived inside the component. A capability the chat and the kernel can
 * call has to answer the same question — "send my accountant last quarter's
 * ledger" — and a second copy of quarter arithmetic is a second chance to be
 * off by a day.
 *
 * So it lives here: pure, no imports, usable from the client modal and from
 * server code, and testable on its own.
 *
 * @module lib/payments/ledgerPeriod
 */

/** The periods a caller can name instead of supplying dates. */
export const LEDGER_PERIODS = [
  'this_month',
  'last_month',
  'this_quarter',
  'last_quarter',
  'this_year',
  'last_year',
  'custom',
] as const;

export type LedgerPeriodId = (typeof LEDGER_PERIODS)[number];

export interface LedgerPeriodBounds {
  /** `YYYY-MM-DD`, inclusive. */
  from: string;
  /** `YYYY-MM-DD`, inclusive of the closing day. */
  to: string;
}

export function isLedgerPeriodId(value: unknown): value is LedgerPeriodId {
  return typeof value === 'string' && (LEDGER_PERIODS as readonly string[]).includes(value);
}

/**
 * A date as `YYYY-MM-DD` in the local calendar.
 *
 * Built from local date parts rather than `toISOString`, which converts to UTC
 * first — east of Greenwich that turns "1 March" into "28 February", and a
 * period that starts a day early is a period that double-counts one payment.
 */
const iso = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/**
 * The bounds of a named period.
 *
 * `custom` returns null: it means "the caller supplies the dates", and inventing
 * bounds for it would silently export a period nobody asked for.
 *
 * Day 0 of the following month is the last day of this one, which is how each
 * closing bound is computed — it is right in February and in leap years without
 * a table of month lengths.
 *
 * @param now Injectable so the arithmetic can be tested on a fixed date rather
 *            than only on whatever day the suite happens to run.
 */
export function resolveLedgerPeriod(
  id: LedgerPeriodId,
  now: Date = new Date()
): LedgerPeriodBounds | null {
  const y = now.getFullYear();
  const m = now.getMonth();
  const quarterStart = Math.floor(m / 3) * 3;

  switch (id) {
    case 'this_month':
      return { from: iso(new Date(y, m, 1)), to: iso(new Date(y, m + 1, 0)) };

    case 'last_month':
      return { from: iso(new Date(y, m - 1, 1)), to: iso(new Date(y, m, 0)) };

    case 'this_quarter':
      return {
        from: iso(new Date(y, quarterStart, 1)),
        to: iso(new Date(y, quarterStart + 3, 0)),
      };

    /*
     * The one an accountant actually asks for.
     *
     * `quarterStart - 3` rolls into the previous year on its own when the
     * current quarter is Q1: `new Date(2026, -3, 1)` is 1 October 2025, which is
     * exactly the answer wanted and needs no special case.
     */
    case 'last_quarter':
      return {
        from: iso(new Date(y, quarterStart - 3, 1)),
        to: iso(new Date(y, quarterStart, 0)),
      };

    case 'this_year':
      return { from: iso(new Date(y, 0, 1)), to: iso(new Date(y, 11, 31)) };

    case 'last_year':
      return { from: iso(new Date(y - 1, 0, 1)), to: iso(new Date(y - 1, 11, 31)) };

    case 'custom':
    default:
      return null;
  }
}

/** A short human label for a resolved period, for summaries and subject lines. */
export function ledgerPeriodLabel(bounds: LedgerPeriodBounds): string {
  return bounds.from === bounds.to ? bounds.from : `${bounds.from} – ${bounds.to}`;
}
