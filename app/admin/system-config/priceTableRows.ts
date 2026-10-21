/**
 * The one Model pricing table (AI model price review slice 4, user decision
 * UF-5): the comparison read joined to the stored price list. Pure.
 *
 * The comparison is the single source of every displayed price, gap, status,
 * area and flag. The stored list (`GET /api/admin/system-config/pricing`)
 * supplies only the row ids, the dates and the retired rows; its
 * per-token numbers are never displayed.
 *
 *   - compared:     every comparison row. Joined to its stored row by
 *                   `currentRowId` (SA N-1); a missing match (the two reads
 *                   raced) leaves `stored` null.
 *   - starts_later: a stored, non-retired row that no comparison row points at
 *                   and whose effective date is after the SERVER date (the
 *                   comparison's `generatedAt`, never the browser clock): it
 *                   will be charged (SA NR-1).
 *   - superseded:   the same, but already in effect: an older row "newest
 *                   wins" never charges (SA NR-1).
 *   - retired:      `retired_date` set (SA RC-4).
 *
 * Retired and other stored-only rows always sort after the compared rows.
 */

import type { ComparisonModel, ComparisonRow } from '@/lib/ai/pricing-research/comparisonModel';

import type { PriceSortMode } from '@/app/admin/system-config/priceReviewCopy';

/** The fields of a stored price row this table needs. */
export interface StoredPriceRowLike {
  id: string;
  provider: string;
  model_name: string;
  effective_date: string;
  retired_date?: string | null;
}

export type PriceTableRow<T extends StoredPriceRowLike> =
  | { kind: 'compared'; key: string; comparison: ComparisonRow; stored: T | null }
  | { kind: 'starts_later'; key: string; stored: T; startsOn: string }
  | { kind: 'superseded'; key: string; stored: T }
  | { kind: 'retired'; key: string; stored: T; retiredOn: string };

/** "YYYY-MM-DD" from a date or a timestamp, as text (no Date, no time zone). */
function dateOnly(value: string): string {
  return value.slice(0, 10);
}

export function buildPriceTableRows<T extends StoredPriceRowLike>(
  stored: readonly T[],
  comparison: ComparisonModel
): PriceTableRow<T>[] {
  const byId = new Map(stored.map((row) => [row.id, row] as const));
  const joined = new Set<string>();
  const today = dateOnly(comparison.generatedAt);

  const compared: PriceTableRow<T>[] = comparison.rows.map((row) => {
    const match = row.currentRowId ? byId.get(row.currentRowId) ?? null : null;
    if (match) joined.add(match.id);
    return { kind: 'compared', key: `c:${row.kind}:${row.provider ?? ''}:${row.modelName}`, comparison: row, stored: match };
  });

  const rest: PriceTableRow<T>[] = [];
  for (const row of stored) {
    if (joined.has(row.id)) continue;
    const key = `s:${row.id}`;
    if (row.retired_date) {
      rest.push({ kind: 'retired', key, stored: row, retiredOn: dateOnly(row.retired_date) });
    } else if (dateOnly(row.effective_date) > today) {
      rest.push({ kind: 'starts_later', key, stored: row, startsOn: dateOnly(row.effective_date) });
    } else {
      rest.push({ kind: 'superseded', key, stored: row });
    }
  }

  const restOrder: Record<string, number> = { starts_later: 0, superseded: 1, retired: 2 };
  rest.sort(
    (a, b) =>
      restOrder[a.kind] - restOrder[b.kind] ||
      a.stored!.provider.localeCompare(b.stored!.provider) ||
      a.stored!.model_name.localeCompare(b.stored!.model_name)
  );
  return [...compared, ...rest];
}

/** The highest unit gap of a row (furthest above the provider), or null. */
export function bestGapBasisPoints(row: ComparisonRow): number | null {
  let best: number | null = null;
  for (const unit of row.units) {
    if (unit.gapBasisPoints === null) continue;
    if (best === null || unit.gapBasisPoints > best) best = unit.gapBasisPoints;
  }
  return best;
}

function byName(a: ComparisonRow, b: ComparisonRow): number {
  return (a.provider ?? '').localeCompare(b.provider ?? '') || a.modelName.localeCompare(b.modelName);
}

/** Null gaps last; `direction` 1 ascending, -1 descending. */
function byGap(a: number | null, b: number | null, direction: 1 | -1): number {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return (a - b) * direction;
}

/**
 * Sorts the compared rows only; stored-only rows keep their place at the end.
 * "recommended" is the server's order (red first, then models Business OS
 * uses, then the worst gap).
 */
export function sortPriceTableRows<T extends StoredPriceRowLike>(
  rows: readonly PriceTableRow<T>[],
  mode: PriceSortMode
): PriceTableRow<T>[] {
  const compared = rows.filter((row): row is Extract<PriceTableRow<T>, { kind: 'compared' }> => row.kind === 'compared');
  const rest = rows.filter((row) => row.kind !== 'compared');
  if (mode === 'recommended') return [...compared, ...rest];

  const sorted = [...compared].sort((a, b) => {
    if (mode === 'undercharged') {
      // Red rows first (SA F-3): a "Not priced" row has no gap, and a red unit
      // under 1 bp rounds to a 0 gap; both are still undercharging. Then the
      // gap, null last, then the name.
      const isRed = (row: ComparisonRow) => (row.colour === 'red' ? 1 : 0);
      const redFirst = isRed(b.comparison) - isRed(a.comparison);
      return (
        redFirst || byGap(a.comparison.worstGapBasisPoints, b.comparison.worstGapBasisPoints, 1) || byName(a.comparison, b.comparison)
      );
    }
    return byGap(bestGapBasisPoints(a.comparison), bestGapBasisPoints(b.comparison), -1) || byName(a.comparison, b.comparison);
  });
  return [...sorted, ...rest];
}
