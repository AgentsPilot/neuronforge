/**
 * @jest-environment jsdom
 *
 * What each service refunded, in its own column.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * `serviceRevenueMap` has always netted refunds off revenue and then thrown the
 * figure away. The netted number cannot be read backwards: a service that took
 * 2,000 and gave 1,000 back prints exactly the same as one that took 1,000 and
 * refunded nothing, and those are different businesses. The owner asked for the
 * column after reading a table where the two were indistinguishable.
 *
 * Two rules this pins, both of which the `lost` column already follows and
 * which are easy to lose when copying a column:
 *
 *   · NOT ADDED to revenue. It is already subtracted, so a reader who sums the
 *     row must not be shown the same money twice.
 *   · A missing field is "not known", not zero. Stored summaries written before
 *     this existed carry no `refunded`, and a confident 0 down the column would
 *     be an assertion nobody can stand behind.
 */

import React from 'react';
import { render, screen, within } from '@testing-library/react';
import '@testing-library/jest-dom';

jest.mock('@/lib/business-os/LanguageContext', () => ({
  useLanguage: () => ({
    language: 'en',
    t: (key: string) =>
      ({
        'reports.col_service': 'Service',
        'reports.col_payments': 'Payments',
        'reports.col_revenue': 'Revenue',
        'reports.col_lost': 'Lost',
        'reports.col_refunded': 'Refunded',
        'reports.col_total': 'Total',
      })[key] ?? key,
  }),
}));

import { ServiceTable, type ServiceRow } from '@/components/business-os/reports/ServiceTable';

const money = (amount: number) => `₪${amount.toLocaleString()}`;

/** Service, payments, revenue, lost, refunded. */
const REFUNDED_CELL = 4;

const row = (over: Partial<ServiceRow>): ServiceRow => ({
  service_id: 'svc-1',
  service_name: 'Consultation',
  revenue: 1000,
  count: 4,
  ...over,
});

describe('the column', () => {
  it('is there, and headed as refunded', () => {
    render(<ServiceTable services={[row({ refunded: 250 })]} money={money} />);
    expect(screen.getByRole('columnheader', { name: 'Refunded' })).toBeInTheDocument();
  });

  it('shows what came back, on the service it came back from', () => {
    render(
      <ServiceTable
        services={[
          row({ service_id: 'a', service_name: 'Renovation quote', revenue: 2175, refunded: 4167 }),
          row({ service_id: 'b', service_name: 'Parent guidance', revenue: 150, refunded: 0 }),
        ]}
        money={money}
      />
    );

    const renovation = screen.getByText('Renovation quote').closest('tr')!;
    expect(within(renovation).getByText('₪4,167')).toBeInTheDocument();

    /* Nothing back prints a dash, the same "no figure" the rest of these cards
       use. A column of zeroes teaches the reader to skip it.
     *
     * Asserted on the CELL rather than by text: `lost` is unknown on this
     * fixture and prints its own dash, so a row-wide text match finds two. */
    const guidance = screen.getByText('Parent guidance').closest('tr') as HTMLElement;
    expect(guidance.querySelectorAll('td')[REFUNDED_CELL]).toHaveTextContent('—');
  });

  it('does not touch revenue, which is already net of it', () => {
    render(<ServiceTable services={[row({ revenue: 1000, refunded: 400 })]} money={money} />);

    const line = screen.getByText('Consultation').closest('tr')!;
    /* 1,000 stands. Not 1,400, and not 600. */
    expect(within(line).getByText('₪1,000')).toBeInTheDocument();
    expect(within(line).getByText('₪400')).toBeInTheDocument();
  });
});

describe('the total row', () => {
  it('sums the column from the rows on screen', () => {
    render(
      <ServiceTable
        services={[
          row({ service_id: 'a', revenue: 2175, refunded: 4167 }),
          row({ service_id: 'b', revenue: 1000, refunded: 1000 }),
          row({ service_id: 'c', revenue: 500, refunded: 0 }),
        ]}
        money={money}
      />
    );

    const total = screen.getByText('Total').closest('tr')!;
    expect(within(total).getByText('₪5,167')).toBeInTheDocument();
  });

  it('prints a dash when no row knows the figure, rather than inventing zero', () => {
    render(
      <ServiceTable
        services={[row({ service_id: 'a', revenue: 900 }), row({ service_id: 'b', revenue: 100 })]}
        money={money}
      />
    );

    const total = screen.getByText('Total').closest('tr')!;
    /* Two dashes on this row: lost and refunded, neither of them known. */
    expect(within(total).getAllByText('—')).toHaveLength(2);
  });
});

describe('the columns beside it still read as they did', () => {
  it('keeps service, payments, revenue and lost', () => {
    render(<ServiceTable services={[row({ lost: 300, refunded: 100 })]} money={money} />);

    for (const header of ['Service', 'Payments', 'Revenue', 'Lost', 'Refunded']) {
      expect(screen.getByRole('columnheader', { name: header })).toBeInTheDocument();
    }
  });
});
