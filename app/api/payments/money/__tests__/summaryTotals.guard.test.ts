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
    expect(route).toMatch(/const filtered = searched\.filter\(/);
    expect(route).toContain('matchesFilter(item, filter)');
  });

  it('paginates on the filtered count, not the summarised one', () => {
    // The list narrows when a KPI is clicked even though the strip does not;
    // these two counts are meant to disagree.
    expect(route).toMatch(/total: filtered\.length/);
    expect(route).toMatch(/summaryCount: searched\.length/);
  });
});

/**
 * The page window is cut per KIND, which is a second instance of the same
 * mistake as the one above.
 *
 * The orders page shows two views — a booking contains its money, an invoice
 * with no booking is the money — and the split used to happen in the browser,
 * over the ten rows this route had already chosen from the mixed list. So each
 * view showed its share of one page. Measured on a real account: 19 bookings
 * and 3 standalone invoices, which put ten bookings and nothing else on page 2,
 * so "invoices without an order" rendered EMPTY while the pager still offered
 * three pages. Page 3 was the mirror image, with the orders view blank.
 *
 * Structural for the same reason as the guard above: the component renders
 * whatever rows it is handed, so no component test can see this, and the whole
 * fault is which set the page window is taken from.
 */
describe('the money route pages within the chosen kind', () => {
  it('accepts a kind, defaulting to the mixed list for callers that send none', () => {
    // 'all' matters: the CRM drawer's `fetchContactMoney` sends no kind and
    // must keep seeing both.
    expect(route).toMatch(/kind: z\s*\n?\s*\.enum\(\['all', 'booking', 'standalone'\]\)|kind: z\.enum\(\['all', 'booking', 'standalone'\]\)/);
    expect(route).toContain(".default('all')");
    expect(route).toMatch(/kind: url\.searchParams\.get\('kind'\)/);
  });

  it('narrows the LIST by kind, so the pager offers the pages that view has', () => {
    const filtered = route.slice(route.indexOf('const filtered ='), route.indexOf('const sorted ='));
    expect(filtered).toContain("kind === 'all' || item.kind === kind");
  });

  it('does NOT narrow the summary by kind, which describes the whole book', () => {
    // Same invariant as the KPI filter: figures that re-derive from the view
    // offering them cannot be compared against each other.
    const searched = route.slice(route.indexOf('const searched ='), route.indexOf('const filtered ='));
    expect(searched).not.toContain('item.kind');
  });
});
