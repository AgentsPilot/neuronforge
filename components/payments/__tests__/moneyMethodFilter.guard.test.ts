/**
 * Narrowing the money list by HOW it arrives, and by one word.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THIS IS FOR
 *
 * The advisor card reports "₪510 of invoices open". Orders could not be asked
 * either half of that sentence: every collection method was mixed into one
 * list, and the state words were not readable at all. An owner was shown a
 * figure and given no way to reach the rows behind it.
 *
 * Two things now answer it — a method control beside the view, and the state
 * and method words in the search — and they must not become two answers to the
 * same question. That is what this file guards.
 *
 * WHY SOURCE-LEVEL
 *
 * `MoneyList` is a 900-line client component whose every branch is a fetch.
 * What has to hold is which value reaches the request and which value the
 * controls display — properties of the source. The parsing underneath is tested
 * for real in `lib/payments/__tests__/moneySearchTerms.test.ts`, and the route's
 * own predicate is asserted here against its text.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import fs from 'fs';
import path from 'path';

const read = (file: string) => fs.readFileSync(path.join(process.cwd(), file), 'utf8');

const list = read('components/payments/MoneyList.tsx');
const strip = read('components/payments/MoneySummaryStrip.tsx');
const route = read('app/api/payments/money/route.ts');

describe('the route can be asked how the money arrives', () => {
  it('takes a method of its own, separate from the state', () => {
    /*
     * Its own parameter rather than more `filter` values, because the two have
     * to COMBINE: "outstanding" AND "invoices" is the question, and folding
     * them together would make them mutually exclusive.
     */
    expect(route).toMatch(/method: z\.enum\(\['any', 'invoice', 'direct', 'plan'\]\)\.default\('any'\)/);
    expect(route).toMatch(/method: url\.searchParams\.get\('method'\)/);
  });

  it('counts a mixed row under both methods', () => {
    /*
     * A booking can hold a card-paid session and an invoiced programme, and
     * `moneyItems` marks that row `mixed` rather than picking a side. A plain
     * equality would hide it from Invoices and from Direct alike — findable
     * only under "any", which is the mirror image of the double-counting bug
     * these two lists were merged to fix: instead of appearing twice, it
     * appears nowhere.
     */
    expect(route).toMatch(/item\.method === 'mixed'/);
  });

  it('does not let the method narrow the summary figures', () => {
    /*
     * The strip describes the whole book so its cells stay comparable — the
     * same reason the KPI filter does not narrow it. `totals` is computed from
     * `searched`, which is the search alone.
     */
    expect(route).toMatch(/const totals = totalMoney\(searched\)/);
    const totalsLine = route.indexOf('const totals = totalMoney(searched)');
    const filteredLine = route.indexOf('const filtered = searched.filter');
    expect(filteredLine).toBeLessThan(totalsLine);
    expect(route).not.toMatch(/totalMoney\(filtered\)/);
  });
});

describe('a typed word drives its control, rather than narrowing beside it', () => {
  it('derives the state and the method from the search', () => {
    expect(list).toMatch(/const typedStatus = typedTerms\.find\(term => term\.kind === 'status'\)/);
    expect(list).toMatch(/const typedMethod = typedTerms\.find\(term => term\.kind === 'method'\)/);
    expect(list).toMatch(/typedStatus\?\.kind === 'status' \? typedStatus\.value : filter/);
    expect(list).toMatch(/typedMethod\?\.kind === 'method' \? typedMethod\.value : methodView/);
  });

  it('sends the EFFECTIVE values to the route, not the raw controls', () => {
    /*
     * The whole point. Sending `filter` while the word says otherwise would
     * leave the chip explaining a filter nobody applied — which the search
     * field's own header calls the worst failure available here.
     */
    const builder = list.slice(
      list.indexOf('const queryFor = useCallback('),
      list.indexOf('[effectiveFilter, sort, kindView, effectiveMethod, searchQuery]')
    );
    expect(builder).toMatch(/filter: effectiveFilter/);
    expect(builder).toMatch(/method: effectiveMethod/);
    expect(builder).not.toMatch(/filter,\n/);
  });

  it('shows the state the rows are actually in, and stops offering to set it', () => {
    expect(list).toMatch(/activeFilter=\{effectiveFilter\}/);
    expect(list).toMatch(/selectionLocked=\{Boolean\(typedStatus\)\}/);

    // And the strip honours it, or the lock is decorative.
    expect(strip).toMatch(/hasValue && !selectionLocked/);
  });

  it('does the same for the method buttons', () => {
    const control = list.slice(list.indexOf('{METHOD_VIEWS.map('));
    expect(control).toMatch(/aria-pressed=\{effectiveMethod === option\}/);
    expect(control).toMatch(/disabled=\{Boolean\(typedMethod\)\}/);
  });

  it('reads the search with the same clock the field does', () => {
    /*
     * `today` is passed in rather than derived here. Two components resolving
     * "today" separately is how a chip comes to describe a different span from
     * the one being filtered — the drift this parser exists as one function to
     * prevent.
     */
    expect(list).toMatch(/today\?: string/);
    expect(list).toMatch(/parseMoneySearch\(searchQuery, today\)/);
    expect(read('components/payments/PaymentsView.tsx')).toMatch(/today=\{today\}/);
  });
});

describe('the combined view exists, because the figure has to be reachable', () => {
  it('offers all three views', () => {
    expect(list).toMatch(/type KindView = 'all' \| 'bookings' \| 'standalone'/);
    expect(list).toMatch(/\(\['all', 'bookings', 'standalone'\] as const\)/);
  });

  it('still opens on Orders', () => {
    // Making the total reachable is a separate decision from moving where the
    // page opens, and only the first was asked for.
    expect(list).toMatch(/useState<KindView>\('bookings'\)/);
  });
});
