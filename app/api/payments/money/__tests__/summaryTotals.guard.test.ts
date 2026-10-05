/**
 * The summary strip's figures must not be derived from the filter it offers.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THIS PINS, AND WHY IT IS A SOURCE GUARD
 *
 * Every cell of the orders summary strip is a filter. While `totals` were
 * summed over the FILTERED set, clicking Collected returned outstanding,
 * overdue, cancelled and refunded as 0, so the strip rewrote itself to four
 * zeroes and one figure. Each click reset the numbers it existed to compare.
 *
 * The component suite cannot catch this: the strip takes `totals` as a prop and
 * faithfully renders whatever it is handed. The bug lives entirely in which set
 * this route sums — a one-word change (`searched` → `sorted`) that leaves every
 * other test green. That exact mutation was tried: 544 tests passed.
 *
 * Extracting the pipeline into a pure function would allow a behavioural test
 * and is the better long-term shape, but it is a refactor of a money endpoint.
 * Until then this guards the invariant the way the codebase already guards
 * others (`planSurfaces.guard`, `mutationOrSelect.guard`): structurally, on the
 * source.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import fs from 'fs';
import path from 'path';

const route = fs.readFileSync(
  path.join(process.cwd(), 'app/api/payments/money/route.ts'),
  'utf8'
);

describe('the money route separates what it summarises from what it lists', () => {
  it('sums the totals over the UNFILTERED set', () => {
    // The whole bug in one line. `sorted`/`filtered` here is the regression.
    expect(route).toMatch(/const totals = totalMoney\(searched\)/);
    expect(route).not.toMatch(/const totals = totalMoney\((?:sorted|filtered)\)/);
  });

  it('builds `searched` from the search alone, never the filter', () => {
    const searched = route.slice(
      route.indexOf('const searched ='),
      route.indexOf('const filtered =')
    );

    expect(searched).toContain('needle');
    // `matchesFilter` belongs to the row list, not to the summary.
    expect(searched).not.toContain('matchesFilter');
  });

  it('applies the filter on top of the search, so the two stay nested', () => {
    // `filtered` must be a subset of `searched` — if it were built from
    // `allItems` instead, searching would stop narrowing the rows.
    expect(route).toMatch(/const filtered = searched\.filter\(item => matchesFilter\(item, filter\)\)/);
  });

  it('paginates on the filtered count, not the summarised one', () => {
    // The list narrows when a KPI is clicked even though the strip does not;
    // these two counts are meant to disagree.
    expect(route).toMatch(/total: filtered\.length/);
    expect(route).toMatch(/summaryCount: searched\.length/);
  });
});
