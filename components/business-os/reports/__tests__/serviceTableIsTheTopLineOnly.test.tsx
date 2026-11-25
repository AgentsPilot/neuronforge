/**
 * @jest-environment jsdom
 *
 * What people buy: the service, how many were booked, and what it earned.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS REPLACED TWO FILES
 *
 * This table used to carry five columns: service, payments, revenue, lost and
 * refunded. Two test files existed to pin the last two, and both were deleted
 * with the columns — every assertion in them was about a cell that no longer
 * renders. Deleting them without putting anything back would have left the
 * table's shape unguarded, which is how a column creeps back.
 *
 * So this pins the shape itself, and the one substitution that is easy to get
 * wrong.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ORDERS ARE NOT PAYMENTS, AND THE ROW ALREADY CARRIED BOTH
 *
 * `count` is money ROWS — "transactions plus unsettled invoices" — so a service
 * paid in three instalments counts three times. That is the right number beside
 * a money column and the wrong answer to "how many people bought this", which
 * is the question this card asks. `booked` is the new one, counted from
 * `scheduling_bookings` with cancellations left out so it agrees with the
 * revenue beside it.
 *
 * Both fields are still on `ServiceRow`, which is exactly why this is worth a
 * test: rendering `count` again would look right, compile, and silently answer
 * a different question.
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
        'reports.col_bookings': 'Bookings',
        'reports.col_revenue': 'Revenue',
        'reports.col_total': 'Total',
      })[key] ?? key,
  }),
}));

import { ServiceTable, type ServiceRow } from '@/components/business-os/reports/ServiceTable';

const money = (amount: number) => `₪${amount.toLocaleString()}`;

const row = (over: Partial<ServiceRow>): ServiceRow => ({
  service_id: 'svc-1',
  service_name: 'Consultation',
  revenue: 1000,
  /* Deliberately DIFFERENT from `booked` in every fixture, so a test cannot
     pass by rendering the wrong one. */
  count: 7,
  booked: 3,
  ...over,
});

describe('the top line, and nothing else', () => {
  it('heads exactly three columns', () => {
    render(<ServiceTable services={[row({})]} money={money} />);

    const headers = screen.getAllByRole('columnheader').map(h => h.textContent?.trim());
    expect(headers).toEqual(['Service', 'Bookings', 'Revenue']);
  });

  it('no longer heads payments, lost or refunded', () => {
    render(<ServiceTable services={[row({ lost: 250, refunded: 100 })]} money={money} />);

    const headers = screen.getAllByRole('columnheader').map(h => h.textContent?.trim());
    expect(headers).not.toContain('Payments');
    expect(headers).not.toContain('Lost');
    expect(headers).not.toContain('Refunded');
  });

  it('gives every row three cells, carrying lost and refunded or not', () => {
    render(
      <ServiceTable
        services={[row({ service_name: 'With money facts', lost: 250, refunded: 100 })]}
        money={money}
      />
    );

    const line = screen.getByText('With money facts').closest('tr');
    expect(within(line as HTMLElement).getAllByRole('cell')).toHaveLength(3);
  });
});

describe('the count is of orders, not of payments', () => {
  it('shows `booked`, never `count`', () => {
    render(<ServiceTable services={[row({ count: 7, booked: 3 })]} money={money} />);

    const line = screen.getByText('Consultation').closest('tr');
    const cells = within(line as HTMLElement).getAllByRole('cell');
    expect(cells[1]).toHaveTextContent('3');
    expect(cells[1]).not.toHaveTextContent('7');
  });

  it('reads a summary written before the field existed as none, not as a payment count', () => {
    /* `booked` is optional: an older stored summary has no such field. The
       cell prints 0 rather than falling back to `count`, which would quietly
       report instalments as orders. */
    const older = row({ booked: undefined, count: 7 });
    render(<ServiceTable services={[older]} money={money} />);

    const line = screen.getByText('Consultation').closest('tr');
    const cells = within(line as HTMLElement).getAllByRole('cell');
    expect(cells[1]).toHaveTextContent('0');
    expect(cells[1]).not.toHaveTextContent('7');
  });

  it('totals the orders from the rows on screen', () => {
    render(
      <ServiceTable
        services={[
          row({ service_id: 'a', service_name: 'A', booked: 3, count: 7, revenue: 1000 }),
          row({ service_id: 'b', service_name: 'B', booked: 4, count: 9, revenue: 500 }),
        ]}
        money={money}
      />
    );

    const totalLine = screen.getByText('Total').closest('tr');
    const cells = within(totalLine as HTMLElement).getAllByRole('cell');
    expect(cells).toHaveLength(3);
    expect(cells[1]).toHaveTextContent('7');
    expect(cells[2]).toHaveTextContent('₪1,500');
  });
});
