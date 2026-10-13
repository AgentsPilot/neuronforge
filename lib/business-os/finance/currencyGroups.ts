/**
 * The currency-grouping helper (finance & business health slice 2a, CUR-1,
 * CUR-2, S2-CUR-1 to S2-CUR-7, AC-13). Workplan
 * docs/workplans/BUSINESS_OS_FINANCE_HEALTH_SLICE_2A_WORKPLAN.md § Money maths.
 *
 * PURE: no clock, no I/O, no repository, no entitlements import. Every money
 * figure of layer B goes through here.
 *
 *   - A currency code is trimmed and upper-cased; anything that is not then
 *     exactly three letters A to Z is the "Unknown currency" line (null). It is
 *     never assumed to be USD, and no ISO list is kept.
 *   - Amounts are integer HUNDREDTHS (scale 100, SA-Q13: every layer-B money
 *     column is declared with two decimals), converted once through the
 *     existing `toUnits`. An unreadable amount is `null`, never 0: the caller
 *     counts it, and the line records it.
 *   - One line per normalised currency, sorted by code, the Unknown line last.
 *     NOTHING here adds two lines together (S2-CUR-1, BD-12): the module's
 *     exports are pinned by its test, and none returns a cross-currency total.
 *     No exchange rate exists anywhere in the platform (CUR-3).
 *
 * @module lib/business-os/finance/currencyGroups
 */

import { toUnits } from '@/lib/business-os/credits/creditReport';

/** Two decimals: the declared scale of every layer-B money column (SA-Q13). */
export const CURRENCY_SCALE = 100;

const CODE = /^[A-Z]{3}$/;

/** CUR-2: trimmed, upper-cased, exactly three letters A to Z; anything else is null ("Unknown currency"). */
export function normaliseCurrencyCode(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const code = raw.trim().toUpperCase();
  return CODE.test(code) ? code : null;
}

/**
 * S2-CUR-3: one amount as an integer number of hundredths, or null when it is
 * unreadable: missing, not finite, not a whole number of hundredths, or past
 * the safe-integer range.
 *
 * The whole-hundredths test is `abs(n * 100 - round(n * 100)) <= tolerance`
 * on the same parsed `n` that `toUnits` rounds. The tolerance is the
 * requirement's 1e-6, widened only where a double's own spacing is larger
 * than that: from about 1.1e9 hundredths up, `n * 100` of a valid two-decimal
 * value can be off by more than 1e-6 through float rounding alone (a refund
 * column holds up to 9,999,999,999.99). The widening stays at a few units in
 * the last place, far below the 0.5 of a third decimal, so a value with a
 * third decimal is still unreadable.
 */
export function toHundredths(raw: unknown): number | null {
  if (typeof raw !== 'number' && typeof raw !== 'string') return null;
  const units = toUnits(raw, CURRENCY_SCALE);
  if (!Number.isSafeInteger(units)) return null;
  const n = typeof raw === 'number' ? raw : Number(raw);
  const scaled = n * CURRENCY_SCALE;
  const tolerance = Math.max(1e-6, Math.abs(scaled) * Number.EPSILON * 4);
  return Math.abs(scaled - units) <= tolerance ? units : null;
}

/** One line per normalised currency. There is no function here that returns a total across lines. */
export interface CurrencyLine<F extends string> {
  /** Null = the "Unknown currency" line. */
  currency: string | null;
  /** Integer hundredths per field, summed in this currency only. Unreadable amounts are not in it. */
  sums: Record<F, number>;
  /** Entries per field whose amount could not be read (excluded from `sums`, never counted as 0). */
  unreadable: Record<F, number>;
  /**
   * A field's sum left the safe-integer range. It cannot happen at today's
   * volumes (the reads stop at 5,000 rows), but it is never silent: the
   * caller treats the line as inexact.
   */
  overflow: boolean;
}

/**
 * Groups entries by normalised currency; sorted by code, the Unknown line
 * last. An entry with `hundredths: null` (unreadable) still creates its line
 * and is counted in `unreadable`; it adds nothing to `sums`.
 */
export function groupByCurrency<F extends string>(
  entries: Iterable<{ currency: unknown; field: F; hundredths: number | null }>,
  fields: readonly F[]
): CurrencyLine<F>[] {
  const zeros = (): Record<F, number> => Object.fromEntries(fields.map((f) => [f, 0])) as Record<F, number>;
  const lines = new Map<string | null, CurrencyLine<F>>();
  for (const entry of entries) {
    const currency = normaliseCurrencyCode(entry.currency);
    let line = lines.get(currency);
    if (!line) {
      line = { currency, sums: zeros(), unreadable: zeros(), overflow: false };
      lines.set(currency, line);
    }
    if (entry.hundredths === null) {
      line.unreadable[entry.field] += 1;
      continue;
    }
    const sum = line.sums[entry.field] + entry.hundredths;
    if (!Number.isSafeInteger(sum)) line.overflow = true;
    line.sums[entry.field] = sum;
  }
  return [...lines.values()].sort(compareCurrencies);
}

/** S2-CUR-5: by code ascending, the Unknown line (null) last. Not exported: callers sort through `groupByCurrency`. */
function compareCurrencies(a: { currency: string | null }, b: { currency: string | null }): number {
  if (a.currency === b.currency) return 0;
  if (a.currency === null) return 1;
  if (b.currency === null) return -1;
  return a.currency < b.currency ? -1 : 1;
}
