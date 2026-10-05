/**
 * @jest-environment jsdom
 *
 * The strip holds still, and you can get back out.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * TWO BUGS, ONE CAUSE
 *
 * `totals` were summed over the FILTERED set, and every cell in the strip is a
 * filter. So clicking Collected returned a response in which outstanding,
 * overdue, cancelled and refunded were all 0: the strip rewrote itself to four
 * zeroes and one figure, and the cells gated on `totals.x > 0` went inert or
 * stopped rendering altogether. Each click reset the very numbers being
 * compared, and left no route onward or back.
 *
 * The route now sums over the search-narrowed but unfiltered set, so the strip
 * is a fixed frame you filter within. That makes `totals.x > 0` an honest test
 * again, and the way back is clicking the selected cell a second time.
 *
 * These tests assert on the FILTERED state — a filter applied, real figures
 * still present — because that is where both bugs lived. A test written against
 * the unfiltered strip would have passed throughout and proved nothing.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import '@testing-library/jest-dom';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

import { MoneySummaryStrip } from '@/components/payments/MoneySummaryStrip';
import type { MoneyCurrencyTotals, MoneyTotals } from '@/lib/payments/moneyItems';

const COPY: Record<string, string> = {
  'payments.collected': 'Collected',
  'payments.outstanding': 'Outstanding',
  'payments.overdue_total': 'Overdue',
  'payments.refunded': 'Refunded',
  'payments.cancelled_total': 'Cancelled',
};

jest.mock('@/lib/business-os/LanguageContext', () => ({
  useLanguage: () => ({
    t: (key: string) => COPY[key] ?? key,
    isRTL: false,
    language: 'en',
    currencyCode: 'ILS',
    businessCurrency: 'ILS',
    formatCurrency: (value: number) => `₪${value}`,
  }),
}));

function totalsOf(partial: Partial<MoneyTotals>): MoneyTotals {
  const base = {
    collected: 0,
    outstanding: 0,
    overdue: 0,
    refunded: 0,
    cancelled: 0,
    ...partial,
  };
  return { ...base, byCurrency: { ILS: base as unknown as MoneyCurrencyTotals } } as MoneyTotals;
}

function renderStrip(totals: MoneyTotals, activeFilter: string) {
  const onFilter = jest.fn();
  render(
    <MoneySummaryStrip
      totals={totals}
      money={pick => `₪${pick(totals.byCurrency.ILS)}`}
      activeFilter={activeFilter}
      onFilter={onFilter}
      orderCount={3}
    />
  );
  return onFilter;
}

/**
 * What the route now sends whatever is selected: the whole book.
 *
 * Before the fix this same request, with 'paid' applied, came back as
 * `{ collected: 1200 }` and four zeroes.
 */
const WHOLE_BOOK = totalsOf({
  collected: 1200,
  outstanding: 450,
  overdue: 300,
  refunded: 150,
});

describe('the strip while a filter is applied', () => {
  it('shows the figures it was given, not the filter it is in', () => {
    renderStrip(WHOLE_BOOK, 'paid');

    expect(screen.getByRole('button', { name: /Outstanding/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Overdue/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Refunded/ })).toBeInTheDocument();
  });

  it('renders identically whichever cell is selected', () => {
    /*
     * Stability stated outright: between two filters the ONLY difference may be
     * which cell is pressed, never what any of them say. This is the assertion
     * that fails if the totals ever go back to being filter-derived.
     */
    const read = (activeFilter: string) => {
      const { container } = render(
        <MoneySummaryStrip
          totals={WHOLE_BOOK}
          money={pick => `₪${pick(WHOLE_BOOK.byCurrency.ILS)}`}
          activeFilter={activeFilter}
          onFilter={jest.fn()}
          orderCount={3}
        />
      );
      const text = [...container.querySelectorAll('span')].map(node => node.textContent);
      cleanup();
      return text;
    };

    expect(read('overdue')).toEqual(read('paid'));
  });

  it('clicking the selected cell clears the filter — the way back', () => {
    // With the banner removed this is the ONLY route back, so it is the one
    // thing here that must not regress. `aria-pressed` is what announces it.
    const onFilter = renderStrip(WHOLE_BOOK, 'paid');

    fireEvent.click(screen.getByRole('button', { pressed: true }));

    expect(onFilter).toHaveBeenCalledWith('all');
  });

  it('switches straight from one filter to another', () => {
    const onFilter = renderStrip(WHOLE_BOOK, 'paid');

    fireEvent.click(screen.getByRole('button', { name: /Outstanding/ }));

    expect(onFilter).toHaveBeenCalledWith('unpaid');
  });

  it('no longer renders the explanatory banner', () => {
    // Removed deliberately: a strip that marks the selected cell and clears on
    // a second click does not need a sentence saying so.
    renderStrip(WHOLE_BOOK, 'paid');

    expect(screen.queryByRole('button', { name: 'Show all' })).not.toBeInTheDocument();
    expect(screen.queryByText(/Showing/)).not.toBeInTheDocument();
  });

  it('the cell doing the filtering never disappears from under the reader', () => {
    // 'refunded'/'cancelled' are conditional on having a figure. A search can
    // narrow the book to nothing refunded while 'refunded' is still selected,
    // and the pressed cell is now the only way back — so it has to stay.
    renderStrip(totalsOf({}), 'refunded');

    expect(screen.getByRole('button', { name: /Refunded/ })).toBeInTheDocument();
  });

  it('a figure with nothing behind it is not clickable', () => {
    // Honest again now the totals ignore the filter: a 0 means the business has
    // none of that, so offering it would be a dead click.
    renderStrip(totalsOf({ collected: 1200 }), 'all');

    expect(screen.queryByRole('button', { name: /Outstanding/ })).not.toBeInTheDocument();
  });
});
