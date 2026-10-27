/**
 * @jest-environment jsdom
 *
 * Client payments in approximate dollars on the Finance page (FIN BD-56,
 * slice 1b; requirement ADMIN_CLIENT_PAYMENTS_USD_REQUIREMENT.md §5, §7.2,
 * AC-13 to AC-20; SA-RR-CPU SA-Q-5; SA-WP-CPU1B B-1, B-2). Workplan
 * docs/workplans/CLIENT_PAYMENTS_USD_1B_WORKPLAN.md §8.2.
 *
 * Renders the Client payments block (`TakingsSection`) with and without the
 * server's `takings.usd`. The strip never reads the section (AC-19): that is
 * proved by Pin B, unedited, and by the 1a leak guard, which fails any strip
 * file naming it. Fixtures come from the plain helper module beside this file
 * (SA-Q-1B-6), never from another test file.
 */

import '@testing-library/jest-dom';
import * as fs from 'fs';
import * as path from 'path';
import { fireEvent, render, screen, within } from '@testing-library/react';

import { stripComments } from '@/tests/helpers/source-scan';
import { KPI_INDICATOR_WORDS } from '@/app/admin/components/layout/KpiStrip';
import { TakingsSection } from '../components/TakingsSection';
import { CLIENT_PAYMENTS_USD, EXCHANGE_RATES_TAB_HREF, TAKINGS_NO_PAYMENTS } from '../financeCopy';
import { EXCHANGE_RATES_PURPOSE } from '../../exchange-rates/components/ExchangeRatesView';
import { takingsFigures, takingsLine, takingsSectionWith, usdMissingEur, usdOk, usdRow } from './clientPaymentsUsdFixtures';
import type { FinanceClientPaymentsUsd, FinanceTakingsSection } from '@/lib/business-os/finance/financeTypes';

const show = (takings: FinanceTakingsSection) =>
  render(<TakingsSection takings={takings} windowLabel="This month" onRetry={() => undefined} />);

/** The block's text outside the "Converted to $" breakdown and the headline (the untouched tables). */
function existingTablesText(container: HTMLElement): string {
  const ids = ['takings-lines', 'takings-refunds', 'takings-fees', 'takings-processors', 'takings-cannot'];
  return ids.map((id) => within(container).queryByTestId(id)?.textContent ?? `<${id} absent>`).join(' | ');
}

describe('BD-56: the Client payments block with takings.usd (slice 1b)', () => {
  it('U-1 (AC-13): two headlines; the businesses count unchanged and leading; the new figure lagging, with its note', () => {
    show(takingsSectionWith(usdOk()));
    const headlines = screen.getByTestId('takings-headlines');
    expect(within(headlines).getByTestId('takings-businesses-kpi')).toHaveTextContent('Leading');
    const tile = within(headlines).getByTestId('takings-usd-kpi');
    expect(tile).toHaveAttribute('role', 'group');
    expect(tile).toHaveAttribute('aria-label', `${CLIENT_PAYMENTS_USD.label}, ≈ $12,346`);
    expect(screen.getByTestId('takings-usd')).toHaveTextContent('≈ $12,346');
    expect(tile).toHaveTextContent('Lagging');
    expect(screen.getByTestId('takings-usd-note')).toHaveTextContent("Our customers' revenue, not ours");
    expect(screen.queryByTestId('takings-usd-chip')).toBeNull();
    expect(screen.getByTestId('takings-usd-line')).toHaveTextContent('Converted at admin rates · 49 payments in 2 currencies');
  });

  it('U-2 (AC-14): the pill names the definition from one constant, and the tooltip carries the lagging line', () => {
    show(takingsSectionWith(usdOk()));
    const pill = screen.getByRole('button', { name: `${KPI_INDICATOR_WORDS.lagging.name}. ${CLIENT_PAYMENTS_USD.definition}` });
    fireEvent.mouseEnter(screen.getByTestId('takings-usd-indicator'));
    expect(pill).toBeInTheDocument();
    expect(screen.getByText(CLIENT_PAYMENTS_USD.definition)).toBeInTheDocument();
    expect(screen.getByText(KPI_INDICATOR_WORDS.lagging.line)).toBeInTheDocument();
  });

  it('U-3 (AC-15): a currency with no rate gives "At least" and the not-converted note', () => {
    show(takingsSectionWith(usdMissingEur()));
    expect(screen.getByTestId('takings-usd')).toHaveTextContent('At least ≈ $12,346');
    expect(screen.getByTestId('takings-usd-not-converted')).toHaveTextContent(
      'plus 3 payments in other currencies, not converted (no rate)'
    );
    expect(screen.getByTestId('takings-usd-total')).toHaveTextContent('At least ≈ $12,346.32');
  });

  it('U-3b (B-1): payments exist but none converted: "Not converted", never "At least ≈ $0", with the reason', () => {
    const noEurRate: FinanceClientPaymentsUsd = {
      status: 'partial',
      totalUsd: 0,
      rows: [usdRow({ currency: 'EUR', payments: 2, gross: 80, state: 'no_rate' })],
      converted: { payments: 0, currencies: 0 },
      notConverted: { payments: 2, currencies: 1 },
      ratesRead: 'ok',
      stale: false,
    };
    const { unmount } = show(takingsSectionWith(noEurRate, takingsFigures({ lines: [takingsLine('EUR', 2, 80)] })));
    expect(screen.getByTestId('takings-usd')).toHaveTextContent(CLIENT_PAYMENTS_USD.notConverted);
    expect(screen.getByTestId('takings-usd-block')).not.toHaveTextContent('≈ $0');
    expect(screen.getByTestId('takings-usd-not-converted')).toHaveTextContent('plus 2 payments in other currencies, not converted (no rate)');
    expect(screen.getByTestId('takings-usd-total')).toHaveTextContent(CLIENT_PAYMENTS_USD.notConverted);
    unmount();

    // The rates read failed and there is no US-dollar payment.
    show(takingsSectionWith({ ...noEurRate, ratesRead: 'failed' }, takingsFigures({ lines: [takingsLine('EUR', 2, 80)] })));
    expect(screen.getByTestId('takings-usd')).toHaveTextContent(CLIENT_PAYMENTS_USD.notConverted);
    expect(screen.getByTestId('takings-usd-block')).not.toHaveTextContent('≈ $0');
    expect(screen.getByTestId('takings-usd-not-converted')).toHaveTextContent(
      'Exchange rates could not be read; 2 payments in other currencies not converted'
    );
  });

  it('U-4: the rates read failed with US-dollar payments: "At least", and the reason', () => {
    const ok = usdOk();
    show(
      takingsSectionWith({
        ...ok,
        status: 'partial',
        ratesRead: 'failed',
        totalUsd: 122,
        rows: [usdRow({ currency: 'ILS', payments: 42, gross: 45230, state: 'no_rate' }), ok.rows[1]],
        converted: { payments: 7, currencies: 1 },
        notConverted: { payments: 42, currencies: 1 },
      })
    );
    expect(screen.getByTestId('takings-usd')).toHaveTextContent('At least ≈ $122');
    expect(screen.getByTestId('takings-usd-not-converted')).toHaveTextContent('Exchange rates could not be read; 42 payments');
  });

  it('U-5 (AC-15, SA-Q-1B-3): no client payments: "None", no "≈ $0", no table; the block’s own empty message shows', () => {
    const none: FinanceClientPaymentsUsd = { ...usdOk(), totalUsd: 0, rows: [], converted: { payments: 0, currencies: 0 } };
    show(takingsSectionWith(none, takingsFigures({ lines: [], countedPayments: 0, processors: [], businesses: 0, empty: true })));
    expect(screen.getByTestId('takings-usd')).toHaveTextContent(CLIENT_PAYMENTS_USD.none);
    expect(screen.getByTestId('takings-usd-block')).not.toHaveTextContent('≈ $0');
    expect(screen.queryByTestId('takings-usd-table')).toBeNull();
    expect(screen.getByTestId('takings-no-payments')).toHaveTextContent(TAKINGS_NO_PAYMENTS);
  });

  it('U-6 (AC-16, SA-Q-5): a stale rate: an amber chip in words, not a link; the Exchange rates link beside it', () => {
    const ok = usdOk();
    show(
      takingsSectionWith({
        ...ok,
        stale: true,
        rows: [{ ...ok.rows[0], state: 'stale', rateUpdatedAt: '2026-09-01T00:00:00+00:00' }, ok.rows[1]],
      })
    );
    const chip = screen.getByTestId('takings-usd-chip');
    expect(chip).toHaveTextContent(CLIENT_PAYMENTS_USD.staleChip);
    expect(chip.closest('a')).toBeNull();
    const link = within(screen.getByTestId('takings-usd-line')).getByRole('link', { name: CLIENT_PAYMENTS_USD.ratesLink });
    expect(link).toHaveAttribute('href', EXCHANGE_RATES_TAB_HREF);
    expect(EXCHANGE_RATES_TAB_HREF).toBe('/admin/finance?tab=exchange-rates');
    expect(screen.getByTestId('takings-usd-state-ILS')).toHaveTextContent('Stale');
  });

  it('U-7 (AC-17): the "Converted to $" table, row by row, and its total equal to the headline to the cent', () => {
    show(takingsSectionWith(usdMissingEur()));
    const table = screen.getByRole('table', { name: CLIENT_PAYMENTS_USD.table });
    const headers = within(table).getAllByRole('columnheader').map((th) => th.textContent);
    expect(headers).toEqual(Object.values(CLIENT_PAYMENTS_USD.columns));
    const ils = screen.getByTestId('takings-usd-row-ILS');
    expect(ils).toHaveTextContent('ILS 45,230.00');
    expect(ils).toHaveTextContent('3.700 per $1');
    expect(ils).toHaveTextContent('2026-10-20 09:15 UTC');
    expect(screen.getByTestId('takings-usd-amount-ILS')).toHaveTextContent('≈ $12,224.32');
    const usdLine = screen.getByTestId('takings-usd-row-USD');
    expect(within(usdLine).getAllByText('—')).toHaveLength(2);
    expect(screen.getByTestId('takings-usd-amount-USD')).toHaveTextContent('≈ $122.00');
    expect(screen.getByTestId('takings-usd-state-EUR')).toHaveTextContent('No rate');
    expect(screen.getByTestId('takings-usd-amount-EUR')).toHaveTextContent('Not converted');
    expect(screen.getByTestId('takings-usd-total')).toHaveTextContent('≈ Total');
    expect(screen.getByTestId('takings-usd-footer')).toHaveTextContent(CLIENT_PAYMENTS_USD.footer);
    expect(within(screen.getByTestId('takings-usd-footer')).getByRole('link')).toHaveAttribute('href', EXCHANGE_RATES_TAB_HREF);
  });

  it('SA-Q-1B-5: the state words; only Stale is a warning', () => {
    const ok = usdOk();
    show(
      takingsSectionWith({
        ...ok,
        status: 'partial',
        rows: [
          usdRow({ currency: 'GBP', state: 'disabled', rate: '0.790000' }),
          usdRow({ currency: 'JPY', state: 'unusable', rate: '0.000000' }),
          usdRow({ currency: null, state: 'unusable' }),
          ...ok.rows,
        ],
      })
    );
    expect(screen.getByTestId('takings-usd-state-GBP')).toHaveTextContent('Rate off');
    expect(screen.getByTestId('takings-usd-state-JPY')).toHaveTextContent('Not usable');
    expect(screen.getByTestId('takings-usd-state-unknown')).toHaveTextContent('Not usable');
    expect(screen.getByTestId('takings-usd-row-unknown')).toHaveTextContent('Unknown currency');
  });

  // ── QA B-1 (1b): a converted total under one dollar is shown to the cent, never "≈ $0" ──
  const usdOnly = (cents: number, extra: Partial<FinanceClientPaymentsUsd> = {}): FinanceClientPaymentsUsd => ({
    status: 'ok',
    totalUsd: cents / 100,
    rows: [usdRow({ currency: 'USD', payments: 1, gross: cents / 100, rate: '1', state: 'converted', usd: cents / 100 })],
    converted: { payments: 1, currencies: 1 },
    notConverted: { payments: 0, currencies: 0 },
    ratesRead: 'ok',
    stale: false,
    ...extra,
  });
  const usdLines = (gross: number) => takingsFigures({ lines: [takingsLine('USD', 1, gross)] });

  it('QA B-1: one USD payment of $0.30 reads "≈ $0.30", and the total row agrees', () => {
    show(takingsSectionWith(usdOnly(30), usdLines(0.3)));
    expect(screen.getByTestId('takings-usd')).toHaveTextContent('≈ $0.30');
    expect(screen.getByTestId('takings-usd-total')).toHaveTextContent('≈ $0.30');
    expect(screen.getByTestId('takings-usd').textContent).not.toMatch(/\$0$/);
  });

  it('QA B-1: a converted $0.00 payment reads "≈ $0.00" (payments exist, so never "None" and never "≈ $0")', () => {
    show(takingsSectionWith(usdOnly(0), usdLines(0)));
    expect(screen.getByTestId('takings-usd').textContent).toBe('≈ $0.00');
    expect(screen.getByTestId('takings-usd')).not.toHaveTextContent(CLIENT_PAYMENTS_USD.none);
  });

  it('QA B-1: $0.30 USD plus EUR 100 with no rate reads "At least ≈ $0.30", with the no-rate note', () => {
    const withEur = usdOnly(30, {
      status: 'partial',
      rows: [usdRow({ currency: 'EUR', payments: 1, gross: 100, state: 'no_rate' }), ...usdOnly(30).rows],
      notConverted: { payments: 1, currencies: 1 },
    });
    show(takingsSectionWith(withEur, takingsFigures({ lines: [takingsLine('EUR', 1, 100), takingsLine('USD', 1, 0.3)] })));
    expect(screen.getByTestId('takings-usd').textContent).toBe('At least ≈ $0.30');
    expect(screen.getByTestId('takings-usd-not-converted')).toHaveTextContent('plus 1 payment in other currencies, not converted (no rate)');
    expect(screen.getByTestId('takings-usd-total')).toHaveTextContent('At least ≈ $0.30');
  });

  it('QA B-1: from one dollar up the headline stays in whole dollars', () => {
    show(takingsSectionWith(usdOnly(100), usdLines(1)));
    expect(screen.getByTestId('takings-usd').textContent).toBe('≈ $1');
  });

  it.each(['abc', '', '-3.7', '3.7e2', 'NaN', '0'])('QA L-1: a not-usable rate %p shows "—", never the stored text', (junk) => {
    const ok = usdOk();
    show(takingsSectionWith({ ...ok, status: 'partial', rows: [usdRow({ currency: 'JPY', state: 'unusable', rate: junk }), ...ok.rows] }));
    const row = screen.getByTestId('takings-usd-row-JPY');
    const rateCell = within(row).getAllByRole('cell')[2];
    expect(rateCell.textContent).toBe('—');
    expect(row).not.toHaveTextContent('per $1');
    expect(screen.getByTestId('takings-usd-state-JPY')).toHaveTextContent('Not usable');
  });

  it('U-8 (AC-18): the existing tables read the same with and without the section', () => {
    const without = show(takingsSectionWith(undefined));
    const before = existingTablesText(without.container);
    without.unmount();
    const withUsd = show(takingsSectionWith(usdOk()));
    expect(existingTablesText(withUsd.container)).toBe(before);
  });

  it('U-10 (AC-20, EX-3): no "USD <amount>" in the block, and every converted amount carries "≈"', () => {
    const { container } = show(takingsSectionWith(usdMissingEur()));
    expect(container.textContent).not.toMatch(/USD -?\d/);
    for (const code of ['ILS', 'USD']) expect(screen.getByTestId(`takings-usd-amount-${code}`).textContent).toMatch(/^≈ \$/);
    expect(screen.getByTestId('takings-usd').textContent).toMatch(/≈ \$/);
  });

  it('U-11: one business picked: the figure shows for it, the same way', () => {
    show({ ...takingsSectionWith(usdOk()), scope: 'one' });
    expect(screen.getByTestId('takings-usd')).toHaveTextContent('≈ $12,346');
  });

  it('U-12 (SA-Q-1B-1): with no takings.usd the block is today’s: one headline, no wrapper, no line, no table', () => {
    show(takingsSectionWith(undefined));
    expect(screen.getByTestId('takings-businesses-kpi')).toBeInTheDocument();
    for (const id of ['takings-headlines', 'takings-usd-kpi', 'takings-usd-line', 'takings-usd-table', 'takings-usd-note']) {
      expect({ id, present: screen.queryByTestId(id) !== null }).toEqual({ id, present: false });
    }
  });

  it('U-13 (SA-Q-1A-8): the Exchange rates tab sentence names the one conversion and keeps "per 1 USD"', () => {
    expect(EXCHANGE_RATES_PURPOSE).toBe(
      'Rates an admin keeps by hand, in units of each currency per 1 USD. They convert one admin figure only: the approximate-dollar total of client payments on Finance.'
    );
  });
});

// ── B-2: the page does no arithmetic on the converted figures (R-9) ─────────
const ROOT = process.cwd();
const PAGE_FILES = ['app/admin/finance/components/TakingsSection.tsx', 'app/admin/components/layout/BlockKpi.tsx', 'app/admin/finance/financeFormat.ts'];
/** An arithmetic operator applied directly to `.totalUsd` / `.usd`, on either side. JSX `</` is not an operator use. */
const USD_ARITHMETIC = /\.(?:totalUsd|usd)\b\s*[-+*/%](?![=>])|[-+*%]\s*[\w.?]*\.(?:totalUsd|usd)\b|(?<![<])\/\s*[\w.?]*\.(?:totalUsd|usd)\b/;
const arithmeticIn = (code: string) => code.split('\n').filter((line) => USD_ARITHMETIC.test(line));

describe('B-2: no arithmetic on totalUsd or usd in the page files', () => {
  it.each(PAGE_FILES)('%s', (file) => {
    const code = stripComments(fs.readFileSync(path.join(ROOT, file), 'utf8').replace(/\r\n/g, '\n'));
    expect({ file, hits: arithmeticIn(code) }).toEqual({ file, hits: [] });
  });

  it('non-vacuity: TakingsSection really reads both fields', () => {
    const code = stripComments(fs.readFileSync(path.join(ROOT, PAGE_FILES[0]), 'utf8'));
    expect(code).toMatch(/\.totalUsd\b/);
    expect(code).toMatch(/\brow\.usd\b/);
  });

  it.each(['usd.totalUsd * 100', 'row.usd + 1', '1 - usd.totalUsd', 'a / row.usd', 'usd.totalUsd/100'])(
    'planted: %s is caught',
    (planted) => {
      expect(arithmeticIn(planted)).toHaveLength(1);
    }
  );

  it.each([
    '{usd.totalUsd}</span>',
    'usd?.totalUsd ?? null',
    "formatMoney(row.usd, 'USD')",
    'row.usd !== null',
    '<td>{row.usd}</td>',
    'usd.totalUsd === null',
    'const t = x => row.usd;',
  ])('precision: %s is not caught', (clean) => {
    expect(arithmeticIn(clean)).toEqual([]);
  });
});
