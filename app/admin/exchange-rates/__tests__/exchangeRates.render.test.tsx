/**
 * @jest-environment jsdom
 *
 * What an admin sees and does on /admin/exchange-rates (Admin Exchange Rates
 * slice 1a, FR-1 to FR-4, FR-8, FR-9, SQ-7, SA-R8, SA O-5): the stale chip and
 * the KPI tiles (1c.1: enabled currencies, last rate change), saving a rate, a refused save that keeps the old value, the
 * on/off switch, and the USD row that offers neither.
 *
 * Slice 1c.1 (FR-18 to FR-22, SQ-12 to SQ-15, SA Q-1 to Q-3, W-3, W-6): the two
 * KPI tiles (Enabled currencies, Last rate change) with no Stale tile, the
 * "Changed by" label, the caption forms, and one currency's own history read.
 *
 * Slice 1c.2: the page opens on "Enabled only", so the tests that read the
 * disabled JPY row choose Show "All" first (`showAll`). The filter bar itself
 * is tested in `exchangeRatesFilters.render.test.tsx`.
 */

import '@testing-library/jest-dom';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

import { ADMIN_NETWORK_ERROR } from '@/app/admin/components/layout/readAdminResponse';
import {
  HISTORY_LIMIT,
  UNKNOWN_USER_LABEL,
  type ExchangeRateHistoryPayload,
  type ExchangeRateHistoryWire,
  type ExchangeRateWire,
  type ExchangeRatesPayload,
} from '@/lib/admin/exchangeRates/exchangeRateRules';

// The view's client logger, so a test can prove a retired request logs nothing (SA C-2).
const mockClientWarn = jest.fn();
jest.mock('@/lib/logger/client', () => {
  const logger: Record<string, unknown> = {
    info: () => undefined,
    warn: (...args: unknown[]) => mockClientWarn(...args),
    error: () => undefined,
    debug: () => undefined,
  };
  logger.child = () => logger;
  return { clientLogger: logger };
});

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
        changedByLabel: 'Anna Admin',
        changedAt: OLD,
        changeReason: null,
      },
    ],
    nameLookup: 'ok',
    readAt: READ_AT,
  };
}

const EDITOR = 'aaaaaaaa-1111-4111-8111-111111111111';

function change(id: string, code: string, overrides: Partial<ExchangeRateHistoryWire> = {}): ExchangeRateHistoryWire {
  return {
    id,
    currencyCode: code,
    oldRate: '3.600000',
    newRate: '3.650000',
    changedBy: EDITOR,
    changedByLabel: 'Anna Admin',
    changedAt: OLD,
    changeReason: null,
    ...overrides,
  };
}

/** One currency's own read (SQ-12): its rows tagged with the code, so a test can tell which answer is shown. */
function currencyPayload(code: string, count = 2): ExchangeRateHistoryPayload {
  return {
    currencyCode: code,
    history: Array.from({ length: count }, (_, i) => change(`${code}-${i}`, code, { newRate: `${code.length}.${i}00000` })),
    nameLookup: 'ok',
    readAt: READ_AT,
  };
}

interface Answer {
  status: number;
  body: unknown;
}

type Call = { url: string; method: string; body: unknown };

type CurrencyAnswer = (code: string, call: Call) => Answer | Error | Promise<Answer>;

const defaultCurrency: CurrencyAnswer = (code) => ok(currencyPayload(code));

/**
 * Plain GETs answer `get()`; one-currency GETs (`?currency=`) answer
 * `currency(code)`, which may return a promise the test resolves later;
 * PATCHes answer `patch(call)`. Every call is recorded.
 */
type PatchAnswer = (call: Call) => Answer | Error | Promise<Answer>;

function stubFetch(get: () => Answer, patch: PatchAnswer, currency: CurrencyAnswer = defaultCurrency) {
  const calls: Call[] = [];
  global.fetch = jest.fn(async (url: string, init?: RequestInit) => {
    const call: Call = {
      url,
      method: init?.method ?? 'GET',
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    };
    calls.push(call);
    const code = call.method === 'GET' ? new URL(url, 'http://localhost').searchParams.get('currency') : null;
    const answer = call.method === 'PATCH' ? await patch(call) : code ? await currency(code, call) : get();
    if (answer instanceof Error) throw answer;
    return { ok: answer.status >= 200 && answer.status < 300, status: answer.status, json: async () => answer.body };
  }) as unknown as typeof fetch;
  return calls;
}

const ok = (data: unknown): Answer => ({ status: 200, body: { success: true, data } });

async function renderPage(
  get: () => Answer = () => ok(payload()),
  patch: PatchAnswer = () => ok(null),
  currency: CurrencyAnswer = defaultCurrency
) {
  const calls = stubFetch(get, patch, currency);
  const view = render(<ExchangeRatesPage />);
  await screen.findByTestId('exchange-rates-content');
  return Object.assign(calls, { unmount: view.unmount });
}

/** Slice 1c.2: the default view hides disabled rows; these tests read JPY. */
function showAll() {
  fireEvent.change(screen.getByLabelText('Show'), { target: { value: 'all' } });
}

describe('reading', () => {
  it('reads only the admin route, and shows every currency with its stored rate', async () => {
    const calls = await renderPage();
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual(['GET /api/admin/exchange-rates']);
    expect(screen.getByRole('heading', { level: 1, name: 'Exchange rates' })).toBeInTheDocument();
    showAll();
    expect(screen.getByTestId('rate-value-EUR')).toHaveTextContent('0.920000');
    expect(screen.getByTestId('rate-value-JPY')).toHaveTextContent('150.000000');
    expect(screen.getByTestId('enabled-JPY')).toHaveTextContent('Disabled');
    expect(screen.getByTestId('enabled-EUR')).toHaveTextContent('Enabled');
  });

  it('marks stale rows in words; there is no Stale tile (FR-22)', async () => {
    await renderPage();
    showAll();
    expect(screen.getByTestId('stale-EUR')).toHaveTextContent('Stale');
    expect(screen.getByTestId('stale-JPY')).toHaveTextContent('Stale');
    expect(screen.queryByTestId('stale-USD')).toBeNull();
    expect(screen.queryByTestId('kpi-stale-rates')).toBeNull();
    expect(screen.queryByText('Stale rates')).toBeNull();
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
  it('USD dated 2025-11-05 shows no Stale chip, while the other old rows keep theirs', async () => {
    const withOldUsd = payload();
    withOldUsd.rates = withOldUsd.rates.map((r) => (r.currencyCode === 'USD' ? { ...r, lastUpdatedAt: OLD } : r));
    await renderPage(() => ok(withOldUsd));
    expect(screen.queryByTestId('stale-USD')).toBeNull();
    expect(screen.getByTestId('stale-EUR')).toHaveTextContent('Stale');
    expect(screen.getByTestId('stale-ILS')).toHaveTextContent('Stale');
  });

  it('fresh rows lose the chip, whatever the USD date', async () => {
    const allFresh = payload();
    allFresh.rates = allFresh.rates.map((r) =>
      r.currencyCode === 'USD' ? { ...r, lastUpdatedAt: OLD } : { ...r, lastUpdatedAt: FRESH }
    );
    await renderPage(() => ok(allFresh));
    showAll();
    // SA C-2: the JPY row is on screen, so its null Stale check below is not vacuous.
    expect(screen.getByTestId('rate-row-JPY')).toBeInTheDocument();
    for (const code of ['EUR', 'ILS', 'JPY', 'USD']) expect(screen.queryByTestId(`stale-${code}`)).toBeNull();
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

// ── Slice 1c.1 ──────────────────────────────────────────────────────────────

const historyButton = (code: string) => screen.getByRole('button', { name: `History for ${code}` });
const currencyGets = (calls: Call[], code: string) =>
  calls.filter((c) => c.method === 'GET' && c.url === `/api/admin/exchange-rates?currency=${code}`);

/**
 * Deliver a late answer and let React commit whatever it causes. Inside `act`,
 * so a state update the view should NOT have made is rendered before the
 * assertion runs; a bare timer tick can leave it scheduled and the test
 * vacuous (SA C-2).
 */
async function late(deliver: () => void) {
  await act(async () => {
    deliver();
    await new Promise((r) => setTimeout(r, 0));
  });
}

/** A promise the test settles by hand: the late answer of SA W-3. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

describe('the KPI strip (FR-20 to FR-22, SA-1c-2)', () => {
  it('exactly two tiles: Enabled currencies "N of X" with USD counted, and the Last rate change', async () => {
    await renderPage();
    const tiles = screen.getAllByTestId(/^kpi-(?!.*-(box|indicator)$)/);
    expect(tiles.map((tile) => tile.getAttribute('data-testid'))).toEqual(['kpi-enabled-currencies', 'kpi-last-rate-change']);
    // EUR, ILS, USD enabled; JPY not: 3 of 4.
    const enabled = screen.getByTestId('kpi-enabled-currencies');
    expect(enabled).toHaveTextContent('Enabled currencies');
    expect(enabled).toHaveTextContent('3 of 4');
    const last = screen.getByTestId('kpi-last-rate-change');
    expect(last).toHaveTextContent('Last rate change');
    // The stored strings exactly as sent: no rounding, no difference, no percentage (D-5).
    expect(last).toHaveTextContent('ILS 3.600000 → 3.650000');
    expect(last).toHaveTextContent('by Anna Admin, 2025-11-05');
    expect(last.textContent).not.toMatch(/%/);
  });

  it('an old rate of null reads "set to"', async () => {
    const first = payload();
    first.history = [change('h9', 'EUR', { oldRate: null, newRate: '0.930000' })];
    await renderPage(() => ok(first));
    expect(screen.getByTestId('kpi-last-rate-change')).toHaveTextContent('EUR set to 0.930000');
  });

  it('no history: "No changes yet"', async () => {
    const none = payload();
    none.history = [];
    await renderPage(() => ok(none));
    expect(screen.getByTestId('kpi-last-rate-change')).toHaveTextContent('No changes yet');
    expect(screen.getByTestId('rate-history-empty')).toBeInTheDocument();
  });

  it('a failed name lookup shows the short id in the tile and the table, never "Unknown user"', async () => {
    const failed = payload();
    failed.nameLookup = 'failed';
    failed.history = [change('h1', 'ILS', { changedByLabel: null })];
    await renderPage(() => ok(failed));
    expect(screen.getByTestId('kpi-last-rate-change')).toHaveTextContent('by aaaaaaaa…');
    const cell = screen.getByTestId('rate-history-changed-by');
    expect(cell).toHaveTextContent('aaaaaaaa…');
    expect(cell).toHaveAttribute('title', EDITOR);
    expect(document.body.textContent).not.toContain(UNKNOWN_USER_LABEL);
  });

  it('a row with no editor id shows "Unknown user" (SA Q-1)', async () => {
    const nobody = payload();
    nobody.history = [change('h1', 'ILS', { changedBy: null, changedByLabel: UNKNOWN_USER_LABEL })];
    await renderPage(() => ok(nobody));
    expect(screen.getByTestId('rate-history-changed-by')).toHaveTextContent(UNKNOWN_USER_LABEL);
    expect(screen.getByTestId('kpi-last-rate-change')).toHaveTextContent(`by ${UNKNOWN_USER_LABEL}`);
  });

  it('the table shows the name, with the editor id as hover text', async () => {
    await renderPage();
    const cell = screen.getByTestId('rate-history-changed-by');
    expect(cell).toHaveTextContent('Anna Admin');
    expect(cell).toHaveAttribute('title', EDITOR);
  });

  it('a currency history whose first row differs leaves the tiles as they were (SA-1c-2)', async () => {
    await renderPage(undefined, undefined, (code) =>
      ok({ ...currencyPayload(code), history: [change('x1', code, { oldRate: '9.000000', newRate: '9.500000' })] })
    );
    fireEvent.click(historyButton('EUR'));
    await screen.findByText('9.500000');
    expect(screen.getByTestId('kpi-last-rate-change')).toHaveTextContent('ILS 3.600000 → 3.650000');
    expect(screen.getByTestId('kpi-enabled-currencies')).toHaveTextContent('3 of 4');
  });
});

describe('the history caption (SA Q-2)', () => {
  it('below the cap: "{n} change(s), newest first"', async () => {
    await renderPage();
    expect(screen.getByTestId('rate-history-count')).toHaveTextContent('1 change, newest first');
  });

  it(`at the cap: "The newest ${HISTORY_LIMIT} changes"`, async () => {
    const full = payload();
    full.history = Array.from({ length: HISTORY_LIMIT }, (_, i) => change(`h${i}`, 'ILS'));
    await renderPage(() => ok(full));
    expect(screen.getByTestId('rate-history-count')).toHaveTextContent(`The newest ${HISTORY_LIMIT} changes`);
  });

  it('one currency: the same forms, prefixed with the code', async () => {
    await renderPage(undefined, undefined, (code) =>
      ok(code === 'EUR' ? currencyPayload(code, HISTORY_LIMIT) : currencyPayload(code, 2))
    );
    fireEvent.click(historyButton('ILS'));
    await waitFor(() => expect(screen.getByTestId('rate-history-count')).toHaveTextContent('ILS: 2 changes, newest first'));
    fireEvent.click(historyButton('EUR'));
    await waitFor(() =>
      expect(screen.getByTestId('rate-history-count')).toHaveTextContent(`EUR: The newest ${HISTORY_LIMIT} changes`)
    );
  });
});

describe("one currency's history (SQ-12)", () => {
  it("History reads that currency's own list from the route, and Show all returns to the overall list", async () => {
    const calls = await renderPage();
    fireEvent.click(historyButton('ILS'));
    await waitFor(() => expect(screen.getByTestId('rate-history-count')).toHaveTextContent('ILS: 2 changes'));
    expect(currencyGets(calls, 'ILS')).toHaveLength(1);
    expect(screen.getByText('3.000000')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Show all currencies' }));
    expect(screen.getByTestId('rate-history-count')).toHaveTextContent('1 change, newest first');
    expect(screen.queryByRole('button', { name: 'Show all currencies' })).toBeNull();
  });

  it('a failed read shows its error inside the panel only, with Retry', async () => {
    let fail = true;
    const calls = await renderPage(undefined, undefined, (code) =>
      fail ? { status: 500, body: { success: false, error: 'Failed to read exchange rates' } } : ok(currencyPayload(code))
    );
    fireEvent.click(historyButton('ILS'));
    expect(await screen.findByTestId('rate-history-error')).toHaveTextContent('Failed to read exchange rates');
    expect(screen.queryByTestId('page-error')).toBeNull();
    expect(screen.getByTestId('kpi-enabled-currencies')).toBeInTheDocument();
    fail = false;
    fireEvent.click(within(screen.getByTestId('rate-history')).getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(screen.getByTestId('rate-history-count')).toHaveTextContent('ILS: 2 changes'));
    expect(currencyGets(calls, 'ILS')).toHaveLength(2);
  });

  it('a late answer for an earlier currency is dropped (SA W-3)', async () => {
    const ils = deferred<Answer>();
    await renderPage(undefined, undefined, (code) => (code === 'ILS' ? ils.promise : ok(currencyPayload(code))));
    fireEvent.click(historyButton('ILS'));
    fireEvent.click(historyButton('EUR'));
    await waitFor(() => expect(screen.getByTestId('rate-history-count')).toHaveTextContent('EUR: 2 changes'));
    await late(() => ils.resolve(ok(currencyPayload('ILS', 1))));
    expect(screen.getByTestId('rate-history-count')).toHaveTextContent('EUR: 2 changes');
  });

  it('Show all, then the late ILS answer: the panel stays closed (SA W-3)', async () => {
    const ils = deferred<Answer>();
    await renderPage(undefined, undefined, () => ils.promise);
    fireEvent.click(historyButton('ILS'));
    fireEvent.click(screen.getByRole('button', { name: 'Show all currencies' }));
    await late(() => ils.resolve(ok(currencyPayload('ILS', 1))));
    expect(screen.queryByRole('button', { name: 'Show all currencies' })).toBeNull();
    expect(screen.getByTestId('rate-history-count')).toHaveTextContent('1 change, newest first');
  });

  it('ILS, Show all, ILS again: the first answer arriving last is dropped, the second stays (SA C-2)', async () => {
    const first = deferred<Answer>();
    const second = deferred<Answer>();
    let ilsReads = 0;
    await renderPage(undefined, undefined, () => {
      ilsReads += 1;
      return ilsReads === 1 ? first.promise : second.promise;
    });
    fireEvent.click(historyButton('ILS'));
    fireEvent.click(screen.getByRole('button', { name: 'Show all currencies' }));
    fireEvent.click(historyButton('ILS'));
    second.resolve(ok(currencyPayload('ILS', 2)));
    await waitFor(() => expect(screen.getByTestId('rate-history-count')).toHaveTextContent('ILS: 2 changes'));
    await late(() => first.resolve(ok(currencyPayload('ILS', 1))));
    expect(screen.getByTestId('rate-history-count')).toHaveTextContent('ILS: 2 changes');
    expect(screen.getAllByTestId('rate-history-changed-by')).toHaveLength(2);
  });

  it('a failed answer after unmount is dropped: nothing is logged and no state is set (SA W-3, C-2)', async () => {
    const ils = deferred<Answer>();
    const errors = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const calls = await renderPage(undefined, undefined, () => ils.promise);
    fireEvent.click(historyButton('ILS'));
    calls.unmount();
    mockClientWarn.mockClear();
    await late(() => ils.resolve({ status: 500, body: { success: false, error: 'Failed to read exchange rates' } }));
    expect(mockClientWarn).not.toHaveBeenCalledWith(expect.anything(), 'Exchange rate history read failed');
    expect(mockClientWarn).not.toHaveBeenCalled();
    expect(errors).not.toHaveBeenCalled();
    errors.mockRestore();
  });

  it('the control: the same 500 while mounted is logged (the unmount test is not vacuous)', async () => {
    mockClientWarn.mockClear();
    await renderPage(undefined, undefined, () => ({ status: 500, body: { success: false, error: 'Failed to read exchange rates' } }));
    fireEvent.click(historyButton('ILS'));
    await screen.findByTestId('rate-history-error');
    expect(mockClientWarn).toHaveBeenCalledWith(expect.objectContaining({ currencyCode: 'ILS' }), 'Exchange rate history read failed');
  });
});

describe('re-reading the open panel (SA Q-3)', () => {
  it('a successful rate save re-reads the open currency panel', async () => {
    const saved = rate('ILS', { rateToUsd: '3.710000', lastUpdatedAt: READ_AT });
    const calls = await renderPage(undefined, () => ok({ rate: saved, unchanged: false }));
    fireEvent.click(historyButton('ILS'));
    await waitFor(() => expect(currencyGets(calls, 'ILS')).toHaveLength(1));
    fireEvent.click(screen.getByRole('button', { name: 'Edit rate for ILS' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Rate to USD for ILS' }), { target: { value: '3.71' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(currencyGets(calls, 'ILS')).toHaveLength(2));
    expect(calls.filter((c) => c.method === 'GET' && c.url === '/api/admin/exchange-rates')).toHaveLength(2);
  });

  // SA C-1: the panel to re-read is the one open when the save FINISHES, not when Save was clicked.
  async function saveIlsWhile(during: () => void) {
    const saved = rate('ILS', { rateToUsd: '3.710000', lastUpdatedAt: READ_AT });
    const patchAnswer = deferred<Answer>();
    const calls = await renderPage(undefined, () => patchAnswer.promise);
    fireEvent.click(historyButton('ILS'));
    await waitFor(() => expect(screen.getByTestId('rate-history-count')).toHaveTextContent('ILS: 2 changes'));
    fireEvent.click(screen.getByRole('button', { name: 'Edit rate for ILS' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Rate to USD for ILS' }), { target: { value: '3.71' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    during();
    patchAnswer.resolve(ok({ rate: saved, unchanged: false }));
    await waitFor(() => expect(calls.filter((c) => c.method === 'GET' && c.url === '/api/admin/exchange-rates')).toHaveLength(2));
    await new Promise((r) => setTimeout(r, 0));
    return calls;
  }

  it('Show all during the save: the panel stays closed and ILS is not read again (SA C-1)', async () => {
    const calls = await saveIlsWhile(() => fireEvent.click(screen.getByRole('button', { name: 'Show all currencies' })));
    expect(currencyGets(calls, 'ILS')).toHaveLength(1);
    expect(screen.queryByRole('button', { name: 'Show all currencies' })).toBeNull();
    expect(screen.getByTestId('rate-history-count')).toHaveTextContent('1 change, newest first');
  });

  it('switching to EUR during the save: EUR stays open and is re-read, ILS is not (SA C-1)', async () => {
    const calls = await saveIlsWhile(() => fireEvent.click(historyButton('EUR')));
    await waitFor(() => expect(currencyGets(calls, 'EUR')).toHaveLength(2));
    expect(currencyGets(calls, 'ILS')).toHaveLength(1);
    expect(screen.getByTestId('rate-history-count')).toHaveTextContent('EUR: 2 changes');
  });

  it('a same-currency re-read keeps the rows on screen and marks the panel busy (SA O-1)', async () => {
    const reread = deferred<Answer>();
    let ilsReads = 0;
    await renderPage(undefined, undefined, (code) => {
      ilsReads += 1;
      return ilsReads === 1 ? ok(currencyPayload(code)) : reread.promise;
    });
    fireEvent.click(historyButton('ILS'));
    await waitFor(() => expect(screen.getByTestId('rate-history-count')).toHaveTextContent('ILS: 2 changes'));
    expect(screen.getByTestId('rate-history')).toHaveAttribute('aria-busy', 'false');
    fireEvent.click(screen.getByRole('button', { name: /refresh/i }));
    await waitFor(() => expect(screen.getByTestId('rate-history')).toHaveAttribute('aria-busy', 'true'));
    expect(screen.getAllByTestId('rate-history-changed-by')).toHaveLength(2);
    reread.resolve(ok(currencyPayload('ILS')));
    await waitFor(() => expect(screen.getByTestId('rate-history')).toHaveAttribute('aria-busy', 'false'));
  });

  it('Refresh re-reads the open currency panel too', async () => {
    const calls = await renderPage();
    fireEvent.click(historyButton('ILS'));
    await waitFor(() => expect(currencyGets(calls, 'ILS')).toHaveLength(1));
    fireEvent.click(screen.getByRole('button', { name: /refresh/i }));
    await waitFor(() => expect(currencyGets(calls, 'ILS')).toHaveLength(2));
  });

  it('an on/off switch re-reads nothing', async () => {
    const calls = await renderPage(undefined, () =>
      ok({ rate: rate('EUR', { rateToUsd: '0.920000', isEnabled: false, lastUpdatedAt: READ_AT }), unchanged: false })
    );
    fireEvent.click(historyButton('EUR'));
    await waitFor(() => expect(currencyGets(calls, 'EUR')).toHaveLength(1));
    fireEvent.click(screen.getByRole('button', { name: 'Switch off EUR' }));
    await waitFor(() => expect(screen.getByTestId('enabled-EUR')).toHaveTextContent('Disabled'));
    await new Promise((r) => setTimeout(r, 0));
    expect(calls.filter((c) => c.method === 'GET')).toHaveLength(2);
  });

  it('a failed re-read after a save shows its error in the panel; the save stands and no page notice appears', async () => {
    const saved = rate('ILS', { rateToUsd: '3.710000', lastUpdatedAt: READ_AT });
    let currencyReads = 0;
    // The server's state: the plain GET after the save sees the saved rate.
    let current = payload();
    await renderPage(
      () => ok(current),
      () => {
        current = { ...current, rates: current.rates.map((r) => (r.currencyCode === 'ILS' ? saved : r)) };
        return ok({ rate: saved, unchanged: false });
      },
      (code) => {
        currencyReads += 1;
        return currencyReads === 1
          ? ok(currencyPayload(code))
          : { status: 500, body: { success: false, error: 'Failed to read exchange rates' } };
      }
    );
    fireEvent.click(historyButton('ILS'));
    await waitFor(() => expect(screen.getByTestId('rate-history-count')).toHaveTextContent('ILS: 2 changes'));
    fireEvent.click(screen.getByRole('button', { name: 'Edit rate for ILS' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Rate to USD for ILS' }), { target: { value: '3.71' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByTestId('rate-history-error')).toHaveTextContent('Failed to read exchange rates');
    await waitFor(() => expect(screen.getByTestId('rate-value-ILS')).toHaveTextContent('3.710000'));
    expect(screen.queryByTestId('row-error-ILS')).toBeNull();
    expect(screen.queryByTestId('refresh-after-save-notice')).toBeNull();
    expect(screen.queryByTestId('page-error')).toBeNull();
  });
});
