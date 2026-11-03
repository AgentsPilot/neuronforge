/**
 * @jest-environment jsdom
 *
 * What each service earned, beside what it lost.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Revenue alone names the winners. A service can sit at the top of this table
 * on ₪9,000 while ₪4,000 more was agreed against it and called off, and nothing
 * on the page said so — the owner reads their best earner and never learns it
 * is also where the business leaks.
 *
 * Two rules decide whether the column helps or becomes wallpaper:
 *
 *   nothing lost prints a DASH, never a zero. A column of zeroes down the
 *   healthy services teaches the reader to skip it, and the one row that
 *   matters goes with it;
 *
 *   an ABSENT figure prints a dash too. A summary stored before this existed
 *   has no such field, and "we did not measure it" must not render as "nothing
 *   was lost" — the same discipline `healthRowsNeverInventsAZero` keeps.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * EVERY ASSERTION IS SCOPED TO ONE ROW, AND HAS TO BE
 *
 * The table grew a totals row above the services. These fixtures are a single
 * service, so its total IS its own figure, and every `screen.getByText` here
 * matched twice and threw — five failures against a component doing exactly
 * what it should.
 *
 * Scoping is not a workaround for that. This file's subject is what is shown
 * AGAINST A SERVICE, and a query that accepts a match anywhere on screen was
 * never asserting that: the dash tests in particular would have passed on the
 * totals row alone, with the service's own cell saying anything at all.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import '@testing-library/jest-dom';
import { render, screen, within } from '@testing-library/react';

jest.mock('@/lib/business-os/LanguageContext', () => {
  const { translations } = jest.requireActual('@/lib/business-os/LanguageContext');
  return {
    useLanguage: () => ({
      language: 'en',
      isRTL: false,
      t: (key: string) => translations.en[key] || key,
      formatCurrency: (amount: number) => String(amount),
    }),
  };
});

import { ServiceTable, type ServiceRow } from '@/components/business-os/reports/ServiceTable';

const money = (amount: number) => `ILS ${amount}`;

const row = (over: Partial<ServiceRow> = {}): ServiceRow => ({
  service_id: 'svc-1',
  service_name: 'Deep tissue massage',
  revenue: 9000,
  count: 12,
  ...over,
});

/**
 * The row drawn for one service, by the name in its first cell.
 *
 * Named rather than indexed: a row found by position would silently become the
 * totals row the moment anything is inserted above it, and the assertion would
 * keep passing while testing the wrong thing.
 */
const serviceRow = (name = 'Deep tissue massage') => {
  const cell = screen.getByText(name);
  const tr = cell.closest('tr');

  expect(tr).not.toBeNull();
  return within(tr as HTMLElement);
};

describe('the lost column', () => {
  it('shows what was written off against a service', () => {
    render(<ServiceTable services={[row({ lost: 4166.66 })]} money={money} />);

    expect(serviceRow().getByText('ILS 9000')).toBeInTheDocument();
    expect(serviceRow().getByText('ILS 4166.66')).toBeInTheDocument();
  });

  it('prints a dash when nothing was lost, never a zero', () => {
    render(<ServiceTable services={[row({ lost: 0 })]} money={money} />);

    expect(serviceRow().getByText('—')).toBeInTheDocument();
    expect(serviceRow().queryByText('ILS 0')).not.toBeInTheDocument();
  });

  it('prints a dash when the figure is absent entirely', () => {
    /* A stored summary from before the column existed. Not knowing is not the
       same as nothing having been lost. */
    render(<ServiceTable services={[row()]} money={money} />);

    expect(serviceRow().getByText('—')).toBeInTheDocument();
  });

  it('heads the column, so the number is not a mystery', () => {
    const { translations } = jest.requireActual('@/lib/business-os/LanguageContext') as {
      translations: { en: Record<string, string> };
    };

    render(<ServiceTable services={[row({ lost: 50 })]} money={money} />);
    expect(screen.getByText(translations.en['reports.col_lost'])).toBeInTheDocument();
  });

  it('does not let a loss move the payments count', () => {
    /* `count` heads the table as payments. A service with one payment and three
       cancellations reads "1", not "4". */
    render(<ServiceTable services={[row({ count: 1, lost: 3000 })]} money={money} />);

    expect(serviceRow().getByText('1')).toBeInTheDocument();
  });

  it('still renders a service that only ever lost money', () => {
    /* Zero revenue is a real row here: everything agreed for it fell through,
       which is the single most worth knowing. */
    render(
      <ServiceTable
        services={[row({ service_name: 'Quotation offering', revenue: 0, count: 0, lost: 2000 })]}
        money={money}
      />
    );

    expect(screen.getByText('Quotation offering')).toBeInTheDocument();
    expect(serviceRow('Quotation offering').getByText('ILS 2000')).toBeInTheDocument();
  });

  it('sums the column above the rows, from the rows themselves', () => {
    /*
     * The totals row that made every query above ambiguous, asserted rather
     * than merely worked around — otherwise the scoping reads as a trick to
     * silence a failure instead of what it is.
     *
     * Two services, so the total is a sum and not a copy of one row: the
     * single-service fixtures elsewhere in this file cannot tell those apart.
     */
    render(
      <ServiceTable
        services={[
          row({ service_id: 'a', service_name: 'One', revenue: 100, count: 1, lost: 10 }),
          row({ service_id: 'b', service_name: 'Two', revenue: 200, count: 2, lost: 5 }),
        ]}
        money={money}
      />
    );

    const totals = within(screen.getByText('Total').closest('tr') as HTMLElement);

    expect(totals.getByText('3')).toBeInTheDocument();
    expect(totals.getByText('ILS 300')).toBeInTheDocument();
    expect(totals.getByText('ILS 15')).toBeInTheDocument();
  });

  it('prints a dash for the total when no row knows what was lost', () => {
    /* The same rule as a service row, at the foot of the column: an older
       stored summary carries no figure, and a confident 0 would be a claim
       nobody made. */
    render(
      <ServiceTable
        services={[row({ service_id: 'a', service_name: 'One' }), row({ service_id: 'b', service_name: 'Two' })]}
        money={money}
      />
    );

    const totals = within(screen.getByText('Total').closest('tr') as HTMLElement);

    expect(totals.getByText('—')).toBeInTheDocument();
  });
});
