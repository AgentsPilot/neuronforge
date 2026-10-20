/**
 * @jest-environment jsdom
 *
 * The Exchange rates filter bar (Admin Exchange Rates slice 1c.2; requirement
 * §5.5.1, FR-14 to FR-16, §8 slice 1c.2, SQ-8, SQ-9, SA-1c-5, SA workplan
 * review C-1, Q-1 to Q-4). Workplan §7.1 R-1 to R-14.
 *
 * `next/navigation` is mocked with a settable search string, and the real
 * jsdom `history.replaceState` is spied on, as the Businesses suites do. The
 * fake server keeps its own rates, so a PATCH changes what the next GET reads.
 */

import '@testing-library/jest-dom';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

import type { ExchangeRateWire, ExchangeRatesPayload } from '@/lib/admin/exchangeRates/exchangeRateRules';

jest.mock('@/lib/logger/client', () => {
  const logger: Record<string, unknown> = {
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
    debug: () => undefined,
  };
  logger.child = () => logger;
  return { clientLogger: logger };
});

let mockSearch = '';
jest.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(mockSearch),
}));

import { ExchangeRatesView } from '../components/ExchangeRatesView';

const PATH = '/admin/exchange-rates';
const READ_AT = '2026-10-20T12:00:00.000Z';
const OLD = '2025-11-05T10:00:00.000Z';

function rate(code: string, name: string, overrides: Partial<ExchangeRateWire> = {}): ExchangeRateWire {
  return {
    currencyCode: code,
    currencyName: name,
    currencySymbol: code === 'USD' ? '$' : '¤',
    rateToUsd: '3.650000',
    isEnabled: true,
    decimalPlaces: 2,
    lastUpdatedAt: OLD,
    updatedBy: null,
    ...overrides,
  };
}

/** EUR, ILS and USD enabled; JPY disabled. */
function startingRates(): ExchangeRateWire[] {
  return [
    rate('EUR', 'Euro', { rateToUsd: '0.920000' }),
    rate('ILS', 'Israeli Shekel'),
    rate('JPY', 'Japanese Yen', { isEnabled: false, rateToUsd: '150.000000' }),
    rate('USD', 'US Dollar', { rateToUsd: '1.000000', lastUpdatedAt: READ_AT }),
  ];
}

let serverRates: ExchangeRateWire[] = [];

function plainPayload(): ExchangeRatesPayload {
  const change = {
    id: 'h1',
    currencyCode: 'ILS',
    oldRate: '3.600000',
    newRate: '3.650000',
    changedBy: 'aaaaaaaa-1111-4111-8111-111111111111',
    changedByLabel: 'Anna Admin',
    changedAt: OLD,
    changeReason: null,
  };
  return {
    rates: serverRates.map((r) => ({ ...r })),
    history: [change],
    // Slice 1d: the all-time change behind the Last rate change tile.
    lastChange: { ...change },
    nameLookup: 'ok',
    readAt: READ_AT,
  };
}

type Call = { url: string; method: string; body: unknown };
let calls: Call[] = [];

const respond = (data: unknown) => ({ ok: true, status: 200, json: async () => ({ success: true, data }) });

function stubFetch() {
  calls = [];
  global.fetch = jest.fn(async (url: string, init?: RequestInit) => {
    const call: Call = { url, method: init?.method ?? 'GET', body: init?.body ? JSON.parse(String(init.body)) : undefined };
    calls.push(call);
    if (call.method === 'PATCH') {
      const code = decodeURIComponent(url.split('/').pop() ?? '');
      const body = call.body as { field: 'rate'; rate: string } | { field: 'enabled'; isEnabled: boolean };
      serverRates = serverRates.map((r) =>
        r.currencyCode !== code
          ? r
          : body.field === 'enabled'
            ? { ...r, isEnabled: body.isEnabled, lastUpdatedAt: READ_AT }
            : { ...r, rateToUsd: body.rate, lastUpdatedAt: READ_AT }
      );
      const saved = serverRates.find((r) => r.currencyCode === code);
      return respond({ rate: { ...saved }, unchanged: false });
    }
    if (url.includes('?currency=')) {
      return respond({ currencyCode: 'ILS', history: [], nameLookup: 'ok', readAt: READ_AT });
    }
    return respond(plainPayload());
  }) as unknown as typeof fetch;
}

/** Arrive at the page with this query, as a link would open it. */
function arrive(search: string) {
  window.history.replaceState(null, '', `${PATH}${search ? `?${search}` : ''}`);
  mockSearch = search;
}

let replaceSpy: jest.SpyInstance;

beforeEach(() => {
  serverRates = startingRates();
  arrive('');
  stubFetch();
  replaceSpy = jest.spyOn(window.history, 'replaceState');
});

afterEach(() => {
  replaceSpy.mockRestore();
});

const replacedUrls = (): string[] => replaceSpy.mock.calls.map((call) => String(call[2]));
const showSelect = () => screen.getByLabelText('Show') as HTMLSelectElement;
const searchBox = () => screen.getByLabelText('Search') as HTMLInputElement;
const clearButton = () => screen.getByRole('button', { name: 'Clear' }) as HTMLButtonElement;
const refreshButton = () => screen.getByRole('button', { name: 'Refresh the exchange rates' }) as HTMLButtonElement;
const shownCodes = () =>
  screen.queryAllByTestId(/^rate-row-/).map((row) => row.getAttribute('data-testid')?.replace('rate-row-', ''));
const countLine = () => screen.getByTestId('rates-count').textContent;
// Slice 1d: the plain GET carries the history window (`from` / `to`), so match the path and the keys, not the whole URL.
const plainGets = () =>
  calls.filter((c) => {
    if (c.method !== 'GET') return false;
    const parsed = new URL(c.url, 'http://localhost');
    return parsed.pathname === '/api/admin/exchange-rates' && !parsed.searchParams.has('currency');
  });

async function renderPage() {
  render(<ExchangeRatesView />);
  await screen.findByTestId('exchange-rates-content');
}

const choose = (value: 'enabled' | 'disabled' | 'all') => fireEvent.change(showSelect(), { target: { value } });
const type = (value: string) => fireEvent.change(searchBox(), { target: { value } });

async function settled() {
  await waitFor(() => expect(refreshButton().disabled).toBe(false));
}

describe('R-1: the plain URL opens Enabled only', () => {
  it('shows only enabled currencies, Show reads "Enabled only", and currencies is never written', async () => {
    await renderPage();
    expect(shownCodes()).toEqual(['EUR', 'ILS', 'USD']);
    expect(showSelect().value).toBe('enabled');
    expect(showSelect().selectedOptions[0]).toHaveTextContent('Enabled only');
    expect(replacedUrls().some((url) => url.includes('currencies'))).toBe(false);
    expect(window.location.search).not.toContain('currencies');
  });
});

describe('R-2: Disabled only and All are written to the URL', () => {
  it('Disabled only → JPY, ?currencies=disabled; All → four rows, ?currencies=all; back → key removed', async () => {
    await renderPage();
    choose('disabled');
    expect(shownCodes()).toEqual(['JPY']);
    await waitFor(() => expect(window.location.search).toBe('?currencies=disabled'));
    choose('all');
    expect(shownCodes()).toEqual(['EUR', 'ILS', 'JPY', 'USD']);
    await waitFor(() => expect(window.location.search).toBe('?currencies=all'));
    choose('enabled');
    expect(shownCodes()).toEqual(['EUR', 'ILS', 'USD']);
    await waitFor(() => expect(window.location.search).toBe(''));
  });
});

describe('R-3: an inbound link reproduces its view', () => {
  it('currencies=all and currencies=disabled open their views at once', async () => {
    arrive('currencies=all');
    const first = render(<ExchangeRatesView />);
    await screen.findByTestId('exchange-rates-content');
    expect(showSelect().value).toBe('all');
    expect(shownCodes()).toEqual(['EUR', 'ILS', 'JPY', 'USD']);
    first.unmount();

    arrive('currencies=disabled');
    await renderPage();
    expect(showSelect().value).toBe('disabled');
    expect(shownCodes()).toEqual(['JPY']);
  });

  it('an unknown value falls back to Enabled only and the write removes it; an unrelated key is kept', async () => {
    arrive('currencies=bogus&tab=x');
    await renderPage();
    expect(showSelect().value).toBe('enabled');
    expect(shownCodes()).toEqual(['EUR', 'ILS', 'USD']);
    await waitFor(() => expect(window.location.search).toBe('?tab=x'));
  });
});

describe('R-4: Search matches code or name and never reaches the URL', () => {
  it.each([
    ['ils', ['ILS']],
    ['ILS', ['ILS']],
    ['shekel', ['ILS']],
    ['  eur ', ['EUR']],
    ['Dollar', ['USD']],
  ])('"%s" shows %j', async (term, expected) => {
    await renderPage();
    type(term);
    expect(shownCodes()).toEqual(expected);
  });

  it('the typed text is in no replaceState call and not in the address bar', async () => {
    await renderPage();
    choose('all');
    type('shekel');
    await waitFor(() => expect(window.location.search).toBe('?currencies=all'));
    expect(replacedUrls().some((url) => url.toLowerCase().includes('shekel'))).toBe(false);
    expect(window.location.search.toLowerCase()).not.toContain('shekel');
    expect(window.location.search).not.toContain('search');
  });
});

describe('R-5: Clear', () => {
  it('is disabled at the defaults and enabled after a Show change or a search', async () => {
    await renderPage();
    expect(clearButton().disabled).toBe(true);
    choose('all');
    expect(clearButton().disabled).toBe(false);
    choose('enabled');
    expect(clearButton().disabled).toBe(true);
    type('eur');
    expect(clearButton().disabled).toBe(false);
  });

  it('restores Enabled only, an empty search and a clean URL', async () => {
    await renderPage();
    choose('disabled');
    type('jp');
    await waitFor(() => expect(window.location.search).toBe('?currencies=disabled'));
    fireEvent.click(clearButton());
    expect(showSelect().value).toBe('enabled');
    expect(searchBox().value).toBe('');
    expect(shownCodes()).toEqual(['EUR', 'ILS', 'USD']);
    await waitFor(() => expect(window.location.search).toBe(''));
    expect(clearButton().disabled).toBe(true);
  });
});

describe('R-6: Read at and Refresh, as in 1a', () => {
  it('shows Read at; Refresh re-reads the plain GET exactly once', async () => {
    await renderPage();
    expect(screen.getByText(/^Read at /)).toBeInTheDocument();
    expect(plainGets()).toHaveLength(1);
    fireEvent.click(refreshButton());
    await settled();
    expect(plainGets()).toHaveLength(2);
  });
});

describe('R-7 / R-8: the KPIs and the history ignore the filter (FR-16)', () => {
  it('the KPI figures are identical under Enabled only, Disabled only and All, and with a search', async () => {
    await renderPage();
    const kpis = () => [
      screen.getByTestId('kpi-enabled-currencies').textContent,
      screen.getByTestId('kpi-last-rate-change').textContent,
    ];
    const atDefault = kpis();
    expect(screen.getByTestId('kpi-enabled-currencies')).toHaveTextContent('3 of 4');
    choose('disabled');
    expect(kpis()).toEqual(atDefault);
    choose('all');
    expect(kpis()).toEqual(atDefault);
    type('nothing-matches-this');
    expect(kpis()).toEqual(atDefault);
  });

  it('the history list shows the same rows under every Show value', async () => {
    await renderPage();
    const historyText = () => screen.getByTestId('rate-history').textContent;
    const atDefault = historyText();
    expect(within(screen.getByTestId('rate-history')).getByText('3.600000')).toBeInTheDocument();
    choose('disabled');
    expect(historyText()).toEqual(atDefault);
    choose('all');
    expect(historyText()).toEqual(atDefault);
  });
});

describe('R-9 / R-10: the count line and the empty state', () => {
  it('counts what is shown out of every currency', async () => {
    await renderPage();
    expect(countLine()).toBe('Showing 3 of 4 currencies');
    choose('disabled');
    expect(countLine()).toBe('Showing 1 of 4 currencies');
    choose('all');
    expect(countLine()).toBe('Showing 4 of 4 currencies');
  });

  it('a search with no match shows the shared empty state with Clear; the KPIs stay', async () => {
    await renderPage();
    type('zzz');
    const empty = screen.getByTestId('rates-filtered-empty');
    expect(empty).toHaveTextContent('No currencies match these filters.');
    expect(screen.queryByRole('table', { name: 'Exchange rates' })).toBeNull();
    expect(countLine()).toBe('Showing 0 of 4 currencies');
    expect(screen.getByTestId('kpi-enabled-currencies')).toHaveTextContent('3 of 4');
    fireEvent.click(within(empty).getByRole('button'));
    expect(searchBox().value).toBe('');
    expect(shownCodes()).toEqual(['EUR', 'ILS', 'USD']);
  });
});

describe('R-11 / R-12: a switched row is held (SQ-9, SA C-1, Q-4)', () => {
  async function switchOffEur(): Promise<HTMLElement> {
    const button = screen.getByRole('button', { name: 'Switch off EUR' });
    button.focus();
    fireEvent.click(button);
    await waitFor(() => expect(screen.getByTestId('enabled-EUR')).toHaveTextContent('Disabled'));
    return button;
  }

  it('R-11: switched off under Enabled only, the row stays (same node, focus kept) until Refresh', async () => {
    await renderPage();
    const button = await switchOffEur();
    expect(shownCodes()).toEqual(['EUR', 'ILS', 'USD']);
    // The very same element, now named for the opposite action: the row never unmounted.
    expect(screen.getByRole('button', { name: 'Switch on EUR' })).toBe(button);
    expect(document.activeElement).toBe(button);
    expect(countLine()).toBe('Showing 3 of 4 currencies');
    // The KPIs count the whole payload: EUR is now off.
    expect(screen.getByTestId('kpi-enabled-currencies')).toHaveTextContent('2 of 4');

    fireEvent.click(refreshButton());
    await waitFor(() => expect(shownCodes()).toEqual(['ILS', 'USD']));
    expect(countLine()).toBe('Showing 2 of 4 currencies');
  });

  it('R-12 (a): a Show change and back releases it', async () => {
    await renderPage();
    await switchOffEur();
    choose('all');
    expect(shownCodes()).toEqual(['EUR', 'ILS', 'JPY', 'USD']);
    choose('enabled');
    expect(shownCodes()).toEqual(['ILS', 'USD']);
  });

  it('R-12 (b): a search edit releases it, even when cleared again', async () => {
    await renderPage();
    await switchOffEur();
    type('e');
    type('');
    expect(shownCodes()).toEqual(['ILS', 'USD']);
  });

  it('R-12 (c): the re-read after a successful rate save releases it', async () => {
    await renderPage();
    await switchOffEur();
    const before = plainGets().length;
    fireEvent.click(screen.getByRole('button', { name: 'Edit rate for ILS' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Rate to USD for ILS' }), { target: { value: '3.71' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(plainGets().length).toBe(before + 1));
    await waitFor(() => expect(shownCodes()).toEqual(['ILS', 'USD']));
    expect(screen.getByTestId('rate-value-ILS')).toHaveTextContent('3.71');
  });

  it('R-12 (Q-4): switched on under Disabled only, the row stays too', async () => {
    await renderPage();
    choose('disabled');
    const button = screen.getByRole('button', { name: 'Switch on JPY' });
    fireEvent.click(button);
    await waitFor(() => expect(screen.getByTestId('enabled-JPY')).toHaveTextContent('Enabled'));
    expect(shownCodes()).toEqual(['JPY']);
    expect(screen.getByRole('button', { name: 'Switch off JPY' })).toBe(button);
    fireEvent.click(refreshButton());
    await waitFor(() => expect(screen.getByTestId('rates-filtered-empty')).toBeInTheDocument());
  });

  it('a filter change made while the PATCH runs judges the row under the new view (not held under the old one)', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const plain = global.fetch as jest.Mock;
    global.fetch = jest.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === 'PATCH') await gate;
      return plain(url, init);
    }) as unknown as typeof fetch;
    await renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Switch off EUR' }));
    choose('all');
    choose('enabled');
    await act(async () => {
      release();
      await gate;
    });
    await waitFor(() => expect(calls.some((c) => c.method === 'PATCH')).toBe(true));
    // Held under the view current when the PATCH settled: Enabled only now, so EUR stays.
    await waitFor(() => expect(screen.getByTestId('enabled-EUR')).toHaveTextContent('Disabled'));
    expect(shownCodes()).toEqual(['EUR', 'ILS', 'USD']);
  });
});

describe('R-13: the bar follows the layout standard (SA-1c-5)', () => {
  it('is a search landmark named Filters with labelled native controls, and filtering reads nothing', async () => {
    await renderPage();
    const bar = screen.getByRole('search', { name: 'Filters' });
    const select = within(bar).getByLabelText('Show');
    expect(select.tagName).toBe('SELECT');
    expect(within(select).getAllByRole('option').map((o) => o.textContent)).toEqual(['Enabled only', 'Disabled only', 'All']);
    const search = within(bar).getByLabelText('Search');
    expect(search).toHaveAttribute('type', 'search');
    expect(search).toHaveAttribute('placeholder', 'Code or name');
    const before = calls.length;
    choose('all');
    type('yen');
    fireEvent.click(clearButton());
    expect(calls.length).toBe(before);
  });
});

describe('R-14: an inactive view (slice 2 readiness, SQ-8)', () => {
  it('takes the defaults without parsing the URL and never writes it', async () => {
    arrive('currencies=all');
    // The arrival itself went through replaceState; only the view's own writes count.
    replaceSpy.mockClear();
    render(<ExchangeRatesView active={false} />);
    await screen.findByTestId('exchange-rates-content');
    expect(showSelect().value).toBe('enabled');
    expect(showSelect().selectedOptions[0]).toHaveTextContent('Enabled only');
    expect(shownCodes()).toEqual(['EUR', 'ILS', 'USD']);
    choose('disabled');
    expect(shownCodes()).toEqual(['JPY']);
    expect(replaceSpy).not.toHaveBeenCalled();
  });
});

describe('QA probes (slice 1c.2 QA, 2026-10-20)', () => {
  it('Q-A: an inbound currencies=enabled opens Enabled only and is normalised away, never re-written', async () => {
    arrive('currencies=enabled&tab=x');
    // The arrival itself went through replaceState; only the view's own writes count.
    replaceSpy.mockClear();
    await renderPage();
    expect(showSelect().value).toBe('enabled');
    expect(shownCodes()).toEqual(['EUR', 'ILS', 'USD']);
    await waitFor(() => expect(window.location.search).toBe('?tab=x'));
    expect(replacedUrls().every((url) => !url.includes('currencies'))).toBe(true);
    expect(clearButton().disabled).toBe(true);
  });

  it.each(['ALL', 'All', 'Disabled', 'ENABLED'])(
    'Q-B: a mixed-case currencies=%s is ignored (Enabled only) and removed',
    async (value) => {
      arrive(`currencies=${value}`);
      await renderPage();
      expect(showSelect().value).toBe('enabled');
      expect(shownCodes()).toEqual(['EUR', 'ILS', 'USD']);
      await waitFor(() => expect(window.location.search).toBe(''));
    }
  );

  it('Q-C: an inbound ?search= is ignored: the box stays empty and the rows are not narrowed', async () => {
    arrive('search=eur&currencies=all');
    await renderPage();
    expect(searchBox().value).toBe('');
    expect(shownCodes()).toEqual(['EUR', 'ILS', 'JPY', 'USD']);
    expect(clearButton().disabled).toBe(false);
    type('yen');
    expect(shownCodes()).toEqual(['JPY']);
    expect(replacedUrls().some((url) => url.toLowerCase().includes('yen'))).toBe(false);
  });

  it.each(['(', '.*', '[', '+?', '^$'])('Q-D: a regex-like search "%s" neither throws nor matches; empty state shows', async (term) => {
    await renderPage();
    choose('all');
    type(term);
    expect(shownCodes()).toEqual([]);
    expect(screen.getByTestId('rates-filtered-empty')).toHaveTextContent('No currencies match these filters.');
    expect(countLine()).toBe('Showing 0 of 4 currencies');
  });

  it('Q-E: an empty result under a Show value alone (no search) still offers Clear, and Clear restores the default', async () => {
    serverRates = serverRates.map((r) => ({ ...r, isEnabled: true }));
    await renderPage();
    choose('disabled');
    const empty = screen.getByTestId('rates-filtered-empty');
    expect(countLine()).toBe('Showing 0 of 4 currencies');
    fireEvent.click(within(empty).getByRole('button'));
    expect(showSelect().value).toBe('enabled');
    expect(shownCodes()).toEqual(['EUR', 'ILS', 'JPY', 'USD']);
    await waitFor(() => expect(window.location.search).toBe(''));
  });

  it('Q-F: USD never shows under Disabled only, and shows under Enabled only and All', async () => {
    await renderPage();
    expect(shownCodes()).toContain('USD');
    choose('disabled');
    expect(shownCodes()).not.toContain('USD');
    choose('all');
    expect(shownCodes()).toContain('USD');
  });

  it('Q-G: a failed Refresh still releases the held row', async () => {
    await renderPage();
    const button = screen.getByRole('button', { name: 'Switch off EUR' });
    fireEvent.click(button);
    await waitFor(() => expect(screen.getByTestId('enabled-EUR')).toHaveTextContent('Disabled'));
    expect(shownCodes()).toEqual(['EUR', 'ILS', 'USD']);
    global.fetch = jest.fn(async () => {
      throw new Error('offline');
    }) as unknown as typeof fetch;
    fireEvent.click(refreshButton());
    await waitFor(() => expect(screen.getByTestId('page-error')).toBeInTheDocument());
    expect(shownCodes()).not.toContain('EUR');
  });
});
