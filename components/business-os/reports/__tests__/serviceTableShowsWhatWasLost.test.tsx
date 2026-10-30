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
 * ─────────────────────────────────────────────────────────────────────────────
 */

import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/react';

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

describe('the lost column', () => {
  it('shows what was written off against a service', () => {
    render(<ServiceTable services={[row({ lost: 4166.66 })]} money={money} />);

    expect(screen.getByText('ILS 9000')).toBeInTheDocument();
    expect(screen.getByText('ILS 4166.66')).toBeInTheDocument();
  });

  it('prints a dash when nothing was lost, never a zero', () => {
    render(<ServiceTable services={[row({ lost: 0 })]} money={money} />);

    expect(screen.getByText('—')).toBeInTheDocument();
    expect(screen.queryByText('ILS 0')).not.toBeInTheDocument();
  });

  it('prints a dash when the figure is absent entirely', () => {
    /* A stored summary from before the column existed. Not knowing is not the
       same as nothing having been lost. */
    render(<ServiceTable services={[row()]} money={money} />);

    expect(screen.getByText('—')).toBeInTheDocument();
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

    expect(screen.getByText('1')).toBeInTheDocument();
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
    expect(screen.getByText('ILS 2000')).toBeInTheDocument();
  });
});
