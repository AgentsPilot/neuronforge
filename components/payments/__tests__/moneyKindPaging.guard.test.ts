/**
 * The orders list asks the server for one kind, and does not re-split the page.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE BUG THIS PINS
 *
 * `/business-os/orders` offers two views, Orders and "invoices without an
 * order", because a booking CONTAINS its money while a standalone invoice IS
 * the money. The server pages the MERGED list ten rows at a time, and the
 * browser used to pick its view's rows out of whatever ten arrived:
 *
 *     const bookingItems = items.filter(item => item.kind === 'booking');
 *     const otherItems   = items.filter(item => item.kind !== 'booking');
 *
 * So each view showed its share of one mixed page. Measured on a real account —
 * 19 bookings, 3 standalone invoices — the pages came out as 9+1, 10+0, 0+2:
 * page 2 rendered "invoices without an order" completely EMPTY while the pager
 * still offered three pages, and page 3 emptied the Orders view instead.
 * Nothing on screen hinted that the rows existed one page away.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY A SOURCE GUARD
 *
 * jsdom renders whatever rows the component is handed, so a render test passes
 * either way: the fault is in which ten rows were requested. The companion
 * guard on the route itself is
 * `app/api/payments/money/__tests__/summaryTotals.guard.test.ts`.
 *
 * COMMENTS ARE STRIPPED BEFORE MATCHING. The explanation beside the fix quotes
 * the very expression being forbidden, as this file does, and a guard that
 * matched its own prose would fail on the code it is protecting.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import fs from 'fs';
import path from 'path';

const source = fs.readFileSync(path.join(process.cwd(), 'components/payments/MoneyList.tsx'), 'utf8');

/** Code only: every fix in this area is explained by quoting what it replaced. */
const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

describe('the money list pages within the view it is showing', () => {
  it('strips comments before matching, or it would fail on its own explanation', () => {
    expect(source).toContain("items.filter(item => item.kind === 'booking')");
    expect(code).not.toContain("items.filter(item => item.kind === 'booking')");
  });

  it('sends the view kind to the API', () => {
    expect(code).toMatch(/kind: kindView === 'bookings' \? 'booking' : 'standalone'/);
  });

  it('does not split the fetched page by kind in the browser', () => {
    // Either direction of the old split, with or without spaces.
    expect(code).not.toMatch(/items\s*\.filter\(\s*item\s*=>\s*item\.kind/);
    expect(code).toMatch(/const visibleItems = items;/);
  });

  it('refetches when the view changes, rather than re-slicing what it holds', () => {
    // The kind is part of the request, so it has to be part of what invalidates
    // it. Without this the switch would show the previous view's rows.
    const loadDeps = code.slice(code.indexOf('const load = useCallback'), code.indexOf('useEffect(() => {\n    load();'));
    expect(loadDeps).toMatch(/\[page, filter, sort, searchQuery, kindView\]/);
  });

  it('returns to the first page when the view changes', () => {
    // Three pages of orders is commonly one page of standalone invoices, and
    // staying on page 3 of a one-page set shows nothing — the same empty view
    // this whole guard is about.
    expect(code).toMatch(/setPage\(0\);\s*\}, \[filter, sort, searchQuery, kindView\]\)/);
  });

  it('judges "this business has no money at all" by the summary, not by the view', () => {
    /*
     * `items.length === 0` stopped meaning that the moment the kind went to the
     * API: standing on an empty standalone view, a business with nineteen
     * orders looked like a business with nothing and the ledger export went
     * dark. `summaryCount` is the whole book under the search alone.
     */
    expect(code).toMatch(/const bookIsEmpty = summaryCount === 0;/);
    expect(code).toMatch(/knownEmpty: bookIsEmpty && !searchQuery\.trim\(\)/);
    expect(code).not.toMatch(/knownEmpty: items\.length === 0/);
  });
});
