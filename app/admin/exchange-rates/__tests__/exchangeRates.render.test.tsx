/**
 * @jest-environment jsdom
 *
 * What an admin sees and does on /admin/exchange-rates (Admin Exchange Rates
 * slice 1a, FR-1 to FR-4, FR-8, FR-9, SQ-7, SA-R8, SA O-5): the stale chip and
 * the stale KPI, saving a rate, a refused save that keeps the old value, the
 * on/off switch, and the USD row that offers neither.
 */

import '@testing-library/jest-dom';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';

import { ADMIN_NETWORK_ERROR } from '@/app/admin/components/layout/readAdminResponse';
import type { ExchangeRateWire, ExchangeRatesPayload } from '@/lib/admin/exchangeRates/exchangeRateRules';

import ExchangeRatesPage from '../page';
import { REFRESH_AFTER_SAVE_FAILED } from '../components/ExchangeRatesView';

const READ_AT = '2026-10-19T12:00:00.000Z';
const FRESH = '2026-10-18T09:00:00.000Z';
const OLD = '2025-11-05T10:00:00.000Z';

function rate(code: string, overrides: Partial<ExchangeRateWire> = {}): ExchangeRateWire {
  return {
    currencyCode: code,
    currencyName: `${code} name`,
    currencySymbol: code === 'USD' ? '$' : '¤',
    rateToUsd: '3.650000',
    isEnabled: true,
    decimalPlaces: 2,
    lastUpdatedAt: OLD,
    updatedBy: null,
    ...overrides,
  };
}

function payload(): ExchangeRatesPayload {
  return {
    rates: [
      rate('EUR', { rateToUsd: '0.920000' }),
      rate('ILS'),
      rate('JPY', { isEnabled: false, rateToUsd: '150.000000' }),
      rate('USD', { rateToUsd: '1.000000', lastUpdatedAt: FRESH }),
    ],
    history: [
      {
        id: 'h1',
        currencyCode: 'ILS',
        oldRate: '3.600000',
        newRate: '3.650000',
        changedBy: 'aaaaaaaa-1111-4111-8111-111111111111',
        changedAt: OLD,
        changeReason: null,
      },
    ],
    readAt: READ_AT,
  };
}

interface Answer {
  status: number;
  body: unknown;
}

type Call = { url: string; method: string; body: unknown };

/** GETs answer `get()`; PATCHes answer `patch(call)`. Every call is recorded. */
function stubFetch(get: () => Answer, patch: (call: Call) => Answer | Error) {
  const calls: Call[] = [];
  global.fetch = jest.fn(async (url: string, init?: RequestInit) => {
    const call: Call = {
      url,
      method: init?.method ?? 'GET',
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    };
    calls.push(call);
    const answer = call.method === 'PATCH' ? patch(call) : get();
    if (answer instanceof Error) throw answer;
    return { ok: answer.status >= 200 && answer.status < 300, status: answer.status, json: async () => answer.body };
  }) as unknown as typeof fetch;
  return calls;
}

const ok = (data: unknown): Answer => ({ status: 200, body: { success: true, data } });

async function renderPage(get: () => Answer = () => ok(payload()), patch: (call: Call) => Answer | Error = () => ok(null)) {
  const calls = stubFetch(get, patch);
  render(<ExchangeRatesPage />);
  await screen.findByTestId('exchange-rates-content');
  return calls;
}

describe('reading', () => {
  it('reads only the admin route, and shows every currency with its stored rate', async () => {
    const calls = await renderPage();
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual(['GET /api/admin/exchange-rates']);
    expect(screen.getByRole('heading', { level: 1, name: 'Exchange rates' })).toBeInTheDocument();
    expect(screen.getByTestId('rate-value-EUR')).toHaveTextContent('0.920000');
    expect(screen.getByTestId('rate-value-JPY')).toHaveTextContent('150.000000');
    expect(screen.getByTestId('enabled-JPY')).toHaveTextContent('Disabled');
    expect(screen.getByTestId('enabled-EUR')).toHaveTextContent('Enabled');
  });

  it('marks stale rows in words and counts only enabled stale rates in the KPI', async () => {
    await renderPage();
    expect(screen.getByTestId('stale-EUR')).toHaveTextContent('Stale');
    expect(screen.getByTestId('stale-JPY')).toHaveTextContent('Stale');
    expect(screen.queryByTestId('stale-USD')).toBeNull();
    const kpi = screen.getByTestId('kpi-stale-rates');
    // EUR + ILS stale and enabled; JPY is disabled; USD is fresh.
    expect(kpi).toHaveTextContent('Stale rates');
    expect(kpi).toHaveTextContent('2');
    // USD is left out of "enabled" (review B-1).
    expect(kpi).toHaveTextContent('of 2 enabled, not updated in 35 days');
  });

  it('shows the history panel without a Reason column', async () => {
    await renderPage();
    const history = screen.getByTestId('rate-history');
    expect(within(history).getByText('3.600000')).toBeInTheDocument();
    expect(within(history).queryByText(/reason/i)).toBeNull();
  });

  it('a failed read shows the route error', async () => {
    stubFetch(() => ({ status: 500, body: { success: false, error: 'Failed to read exchange rates' } }), () => ok(null));
    render(<ExchangeRatesPage />);
    expect(await screen.findByTestId('page-error')).toHaveTextContent('Failed to read exchange rates');
  });

  it('a rejected fetch reads as the network sentence', async () => {
    global.fetch = jest.fn(async () => {
      throw new TypeError('Failed to fetch');
    }) as unknown as typeof fetch;
    render(<ExchangeRatesPage />);
    expect(await screen.findByTestId('page-error')).toHaveTextContent(ADMIN_NETWORK_ERROR);
    expect(document.body.textContent).not.toContain('Failed to fetch');
  });
});

describe('the base currency is never stale (review B-1)', () => {
  it('USD dated 2025-11-05 shows no Stale chip and is left out of the KPI figures', async () => {
    const withOldUsd = payload();
    withOldUsd.rates = withOldUsd.rates.map((r) => (r.currencyCode === 'USD' ? { ...r, lastUpdatedAt: OLD } : r));
    await renderPage(() => ok(withOldUsd));
    expect(screen.queryByTestId('stale-USD')).toBeNull();
    const kpi = screen.getByTestId('kpi-stale-rates');
    // EUR and ILS: enabled and stale. JPY: disabled. USD: excluded from both figures.
    expect(kpi).toHaveTextContent('2');
    expect(kpi).toHaveTextContent('of 2 enabled, not updated in 35 days');
  });

  it('the KPI reaches 0 once every editable enabled rate is fresh, whatever the USD date', async () => {
    const allFresh = payload();
    allFresh.rates = allFresh.rates.map((r) =>
      r.currencyCode === 'USD' ? { ...r, lastUpdatedAt: OLD } : { ...r, lastUpdatedAt: FRESH }
    );
    await renderPage(() => ok(allFresh));
    const kpi = screen.getByTestId('kpi-stale-rates');
    expect(kpi).toHaveTextContent('0');
    expect(kpi).toHaveTextContent('of 2 enabled, not updated in 35 days');
  });
});

describe('the USD row (FR-4, SA-R8)', () => {
  it('offers no edit and no switch-off', async () => {
    await renderPage();
    const row = screen.getByTestId('rate-row-USD');
    expect(within(row).getByTestId('base-currency-note')).toHaveTextContent('Base currency, fixed at 1');
    expect(within(row).queryByRole('button', { name: /edit rate/i })).toBeNull();
    expect(within(row).queryByRole('button', { name: /switch/i })).toBeNull();
  });
});

describe('editing a rate (FR-2, FR-9)', () => {
  it('saves through PATCH, replaces the row and clears its Stale chip', async () => {
    // The server's state: the GET after the save (the view re-reads for the new history row) sees it.
    const saved = rate('ILS', { rateToUsd: '3.710000', lastUpdatedAt: READ_AT });
    let current = payload();
    const calls = await renderPage(
      () => ok(current),
      () => {
        current = { ...current, rates: current.rates.map((r) => (r.currencyCode === 'ILS' ? saved : r)) };
        return ok({ rate: saved, unchanged: false });
      }
    );
    fireEvent.click(screen.getByRole('button', { name: 'Edit rate for ILS' }));
    const input = screen.getByRole('textbox', { name: 'Rate to USD for ILS' });
    expect(input).toHaveValue('3.650000');
    fireEvent.change(input, { target: { value: '3.71' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(screen.getByTestId('rate-value-ILS')).toHaveTextContent('3.710000'));
    expect(screen.queryByTestId('stale-ILS')).toBeNull();
    expect(calls.filter((c) => c.method === 'GET')).toHaveLength(2);
    const patchCall = calls.find((c) => c.method === 'PATCH');
    expect(patchCall).toEqual({ url: '/api/admin/exchange-rates/ILS', method: 'PATCH', body: { field: 'rate', rate: '3.71' } });
  });

  it('a failed re-read after a save keeps the data and shows a short notice, not a page error (review item 4)', async () => {
    const saved = rate('ILS', { rateToUsd: '3.710000', lastUpdatedAt: READ_AT });
    let reads = 0;
    await renderPage(
      () => {
        reads += 1;
        return reads === 1 ? ok(payload()) : { status: 500, body: { success: false, error: 'Failed to read exchange rates' } };
      },
      () => ok({ rate: saved, unchanged: false })
    );
    fireEvent.click(screen.getByRole('button', { name: 'Edit rate for ILS' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Rate to USD for ILS' }), { target: { value: '3.71' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByTestId('refresh-after-save-notice')).toHaveTextContent(REFRESH_AFTER_SAVE_FAILED);
    expect(REFRESH_AFTER_SAVE_FAILED).toBe('Saved; could not refresh history');
    expect(screen.queryByTestId('page-error')).toBeNull();
    expect(screen.getByTestId('rate-value-ILS')).toHaveTextContent('3.710000');
    expect(screen.getByTestId('rate-history')).toBeInTheDocument();
  });

  it('a refused save shows the message and keeps the stored rate', async () => {
    await renderPage(
      () => ok(payload()),
      () => ({ status: 400, body: { success: false, error: 'Invalid input' } })
    );
    fireEvent.click(screen.getByRole('button', { name: 'Edit rate for ILS' }));
    const input = screen.getByRole('textbox', { name: 'Rate to USD for ILS' });
    fireEvent.change(input, { target: { value: '3.9' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByTestId('row-error-ILS')).toHaveTextContent('Invalid input');
    // Still editing, with the typed value; Cancel shows the stored rate unchanged.
    expect(screen.getByRole('textbox', { name: 'Rate to USD for ILS' })).toHaveValue('3.9');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByTestId('rate-value-ILS')).toHaveTextContent('3.650000');
  });

  it('a network failure on save shows the network sentence', async () => {
    await renderPage(() => ok(payload()), () => new TypeError('Failed to fetch'));
    fireEvent.click(screen.getByRole('button', { name: 'Edit rate for EUR' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Rate to USD for EUR' }), { target: { value: '0.93' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByTestId('row-error-EUR')).toHaveTextContent(ADMIN_NETWORK_ERROR);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByTestId('rate-value-EUR')).toHaveTextContent('0.920000');
  });

  it('Save is disabled while the typed value cannot be a rate', async () => {
    await renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Edit rate for ILS' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Rate to USD for ILS' }), { target: { value: '0' } });
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    fireEvent.change(screen.getByRole('textbox', { name: 'Rate to USD for ILS' }), { target: { value: '1000000' } });
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  });
});

describe('switching a currency on or off (FR-3)', () => {
  it('sends one enabled change and shows the result in words', async () => {
    const calls = await renderPage(
      () => ok(payload()),
      () => ok({ rate: rate('EUR', { rateToUsd: '0.920000', isEnabled: false, lastUpdatedAt: READ_AT }), unchanged: false })
    );
    fireEvent.click(screen.getByRole('button', { name: 'Switch off EUR' }));
    await waitFor(() => expect(screen.getByTestId('enabled-EUR')).toHaveTextContent('Disabled'));
    expect(calls.filter((c) => c.method === 'PATCH')).toEqual([
      { url: '/api/admin/exchange-rates/EUR', method: 'PATCH', body: { field: 'enabled', isEnabled: false } },
    ]);
  });
});
