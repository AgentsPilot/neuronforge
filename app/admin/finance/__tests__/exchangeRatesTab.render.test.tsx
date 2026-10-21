/**
 * @jest-environment jsdom
 *
 * Admin Exchange Rates slice 2a (ADMIN_EXCHANGE_RATES_REQUIREMENT.md §5.3.2,
 * FR-23 to FR-25, SQ-19 to SQ-21, SQ-24, SA-2-6, SA-2a-1 to SA-2a-3): the
 * Exchange rates tab on the Finance page, through the real `FinanceView` and
 * the real rates view.
 *
 * `useSearchParams` follows `window.location` (the `chargeChecks.page.render`
 * harness), and `deliver()` re-renders the page the way Next 14.2 delivers a
 * `replaceState(null, …)` in a later render (the `tabCoexistence.render`
 * precedent), so each of the two hooks owning `currencies` really re-reads the
 * other's write before the next step. Writes are counted on
 * `history.replaceState`.
 *
 * The Finance KPI strip, its placeholders, the Finance filter bar and the
 * Overview sections are stand-ins with their own test ids, so "no Finance strip
 * / bar" can never be confused with the rates view's own shared strip and bar.
 * The rates fixtures are plain literals: nothing here imports the rates wire
 * types (SQ-18, Q-4).
 */

import '@testing-library/jest-dom';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

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

jest.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(window.location.search),
  useRouter: () => ({ replace: jest.fn(), push: jest.fn() }),
  usePathname: () => '/admin/finance',
}));

jest.mock('../components/FinanceKpiStrip', () => ({
  FinanceKpiStrip: () => <div data-testid="finance-kpi-strip" />,
  FinanceKpiPlaceholders: () => <div data-testid="finance-kpi-placeholders" />,
}));
jest.mock('../components/FinanceFilterBar', () => ({
  FinanceFilterBar: () => <div data-testid="finance-filter-bar" />,
}));
jest.mock('../components/AccountHeader', () => ({ AccountHeader: () => <div data-testid="account-header-stub" /> }));
jest.mock('../components/AccountSummary', () => ({ AccountSummary: () => null }));
jest.mock('../components/RevenuePanel', () => ({ RevenuePanel: () => null }));
jest.mock('../components/TakingsSection', () => ({ TakingsSection: () => null }));
jest.mock('../components/AccountsByPlanSection', () => ({
  ...jest.requireActual('../components/AccountsByPlanSection'),
  AccountsByPlanSection: () => null,
}));
jest.mock('../components/AiCostSection', () => ({ AiCostSection: () => null }));
jest.mock('../components/CreditsSection', () => ({ CreditsSection: () => null }));
jest.mock('../components/PaymentProblemsSection', () => ({ PaymentProblemsSection: () => null }));
jest.mock('../components/HistoryBlock', () => ({ HistoryBlock: () => null, HistoryAllBusinessesLine: () => null }));
jest.mock('../components/PlansSubscriptions', () => ({ PlansSubscriptions: () => null }));

import { FinanceView } from '../components/FinanceView';
import { PAGE_TITLE, TAB_ACCOUNTS, TAB_EXCHANGE_RATES, TAB_OVERVIEW, TAB_PLANS } from '../financeCopy';
import { FINANCE_REQUEST_PATH, PIN_ACCOUNT as A, PINNED_REQUESTS } from './financeRequestPins';
// Relative, as FinanceView imports it (SQ-18).
import { EXCHANGE_RATES_PURPOSE } from '../../exchange-rates/components/ExchangeRatesView';

const PAGE = '/admin/finance';
const RATES_PATH = '/api/admin/exchange-rates';
const READ_AT = '2026-10-20T12:00:00.000Z';
const OLD = '2025-11-05T10:00:00.000Z';
/** Row 1: the empty link, the Overview's request. */
const OVERVIEW_REQUEST = PINNED_REQUESTS.find((pin) => pin.row === 1)?.request;

const rate = (code: string, name: string, rateToUsd: string, isEnabled = true) => ({
  currencyCode: code,
  currencyName: name,
  currencySymbol: code === 'USD' ? '$' : '¤',
  rateToUsd,
  isEnabled,
  decimalPlaces: 2,
  lastUpdatedAt: OLD,
  updatedBy: null,
});

/** The rates read: EUR, ILS and USD enabled, JPY disabled; one history row. */
const RATES_PAYLOAD: unknown = {
  rates: [
    rate('EUR', 'Euro', '0.920000'),
    rate('ILS', 'Israeli Shekel', '3.650000'),
    rate('JPY', 'Japanese Yen', '150.000000', false),
    rate('USD', 'US Dollar', '1.000000'),
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

const WINDOW = { preset: 'this_month', from: '2026-10-01', to: '2026-10-14', start: '2026-10-01T00:00:00.000Z', end: '2026-10-15T00:00:00.000Z' };

/** Only what the shell reads (every section is a stand-in), for all businesses or one. */
const financePayload = (accountId: string | null): unknown => ({
  generatedAt: '2026-10-14T10:00:00.000Z',
  window: WINDOW,
  accountId,
  credits: { figures: null, farOverAllowancePercent: 150 },
  aiCost: { figures: null },
  takings: { figures: null },
  paymentProblems: { overdueInvoices: { figures: null }, overdueInstalments: { figures: null } },
});

const respond = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body });

let calls: string[] = [];
let financeMode: 'ok' | 'pending' | 'fail' = 'ok';
let releaseFinance: (() => void) | null = null;

function stubFetch() {
  calls = [];
  releaseFinance = null;
  global.fetch = jest.fn((input: string) => {
    const url = String(input);
    calls.push(url);
    if (url.startsWith(RATES_PATH)) return Promise.resolve(respond({ success: true, data: RATES_PAYLOAD }));
    const accountId = new URLSearchParams(url.split('?')[1] ?? '').get('accountId');
    const ok = respond({ success: true, data: financePayload(accountId) });
    if (financeMode === 'pending') {
      return new Promise((resolve) => {
        releaseFinance = () => resolve(ok);
      });
    }
    if (financeMode === 'fail') return Promise.resolve(respond({ success: false, error: 'The finance read failed.' }, 500));
    return Promise.resolve(ok);
  }) as unknown as typeof fetch;
}

const financeCalls = () => calls.filter((url) => url.startsWith(FINANCE_REQUEST_PATH));
const ratesCalls = () => calls.filter((url) => url.startsWith(RATES_PATH));
const address = () => `${window.location.pathname}${window.location.search}`;

let replaceSpy: jest.SpyInstance;
let view: ReturnType<typeof render>;

/** Arrive at the page with this query, as a link would open it, and render. */
function openAt(search: string) {
  window.history.replaceState(null, '', `${PAGE}${search ? `?${search}` : ''}`);
  view = render(<FinanceView />);
}

/** Next delivers what the address bar now says: the page re-renders and both hooks see it. */
async function deliver() {
  await act(async () => {
    view.rerender(<FinanceView />);
  });
}

/** Let pending promises settle inside act. */
async function flush() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

const tab = (name: string) => screen.getByRole('tab', { name });
const showSelect = () => screen.getByLabelText('Show') as HTMLSelectElement;
const writes = () => replaceSpy.mock.calls.length;

beforeEach(() => {
  financeMode = 'ok';
  stubFetch();
  replaceSpy = jest.spyOn(window.history, 'replaceState');
});

afterEach(() => {
  replaceSpy.mockRestore();
  window.history.replaceState(null, '', PAGE);
});

/** The rates view on screen: table (Enabled only by default, so no JPY), Show, its two KPIs and the history. */
async function expectRatesShown(show: 'enabled' | 'all' = 'enabled') {
  await screen.findByTestId('rate-row-EUR');
  expect(screen.getByTestId('rate-row-ILS')).toBeInTheDocument();
  if (show === 'enabled') expect(screen.queryByTestId('rate-row-JPY')).toBeNull();
  else expect(screen.getByTestId('rate-row-JPY')).toBeInTheDocument();
  expect(screen.getByTestId('kpi-enabled-currencies')).toBeInTheDocument();
  expect(screen.getByTestId('kpi-last-rate-change')).toBeInTheDocument();
  expect(screen.getByTestId('rate-history')).toBeInTheDocument();
}

/** None of the Finance chrome SQ-19 (i) hides on the rates tab. */
function expectNoFinanceChrome() {
  expect(screen.queryByTestId('finance-kpi-strip')).toBeNull();
  expect(screen.queryByTestId('finance-kpi-placeholders')).toBeNull();
  expect(screen.queryByTestId('finance-filter-bar')).toBeNull();
  expect(screen.queryByTestId('finance-error')).toBeNull();
  expect(screen.queryByText(/Reading the finance page/)).toBeNull();
  expect(screen.queryByTestId('as-of')).toBeNull();
  expect(screen.getByTestId('finance-content')).not.toHaveAttribute('aria-busy');
}

/** Exactly one h1, "Finance", followed by the rates sentence (SQ-21). */
function expectOneFinanceH1WithRatesPurpose() {
  const headings = screen.getAllByRole('heading', { level: 1 });
  expect(headings).toHaveLength(1);
  expect(headings[0]).toHaveTextContent(PAGE_TITLE);
  expect(screen.getByText(EXCHANGE_RATES_PURPOSE)).toBeInTheDocument();
}

describe('N-1: selecting the tab (FR-23, FR-24, one write)', () => {
  it('from Overview: exactly one replaceState, ?tab=exchange-rates; the rates show, no Finance chrome, one h1', async () => {
    openAt('');
    await screen.findByRole('tablist');
    expect(screen.getByTestId('finance-kpi-strip')).toBeInTheDocument();
    expect(screen.getByTestId('as-of')).toBeInTheDocument();
    expect(within(screen.getByRole('tablist')).getAllByRole('tab').map((t) => t.textContent)).toEqual([
      TAB_OVERVIEW,
      TAB_ACCOUNTS,
      TAB_PLANS,
      TAB_EXCHANGE_RATES,
    ]);
    replaceSpy.mockClear();

    fireEvent.click(tab(TAB_EXCHANGE_RATES));
    await expectRatesShown();
    await deliver();
    expect(writes()).toBe(1);
    expect(address()).toBe(`${PAGE}?tab=exchange-rates`);
    expect(tab(TAB_EXCHANGE_RATES)).toHaveAttribute('aria-selected', 'true');
    expect(showSelect().value).toBe('enabled');
    expectNoFinanceChrome();
    expectOneFinanceH1WithRatesPurpose();
  });

  it('from Accounts with its keys set: one write, and the Accounts keys go', async () => {
    openAt('tab=accounts&sort=margin&group=trial&show=negative');
    await screen.findByRole('tablist');
    await deliver();
    replaceSpy.mockClear();

    fireEvent.click(tab(TAB_EXCHANGE_RATES));
    await expectRatesShown();
    await deliver();
    expect(writes()).toBe(1);
    expect(address()).toBe(`${PAGE}?tab=exchange-rates`);
  });

  it('from Plans with a status: one write, and status goes', async () => {
    openAt('tab=plans&status=failed');
    await screen.findByRole('tablist');
    await deliver();
    replaceSpy.mockClear();

    fireEvent.click(tab(TAB_EXCHANGE_RATES));
    await expectRatesShown();
    await deliver();
    expect(writes()).toBe(1);
    expect(address()).toBe(`${PAGE}?tab=exchange-rates`);
  });

  it('opening ?tab=exchange-rates selects it', async () => {
    openAt('tab=exchange-rates');
    await expectRatesShown();
    expect(tab(TAB_EXCHANGE_RATES)).toHaveAttribute('aria-selected', 'true');
    expect(tab(TAB_EXCHANGE_RATES)).toHaveAttribute('tabIndex', '0');
    expect(tab(TAB_OVERVIEW)).toHaveAttribute('tabIndex', '-1');
    expectOneFinanceH1WithRatesPurpose();
  });
});

describe('N-2: the rates do not wait on, or fail with, the finance read (FR-25, SQ-19 (i))', () => {
  /** The panel is the tab's, labelled by it. */
  function expectRatesPanel() {
    const panel = screen.getByRole('tabpanel');
    expect(panel).toHaveAttribute('id', 'finance-panel-exchange-rates');
    expect(panel).toHaveAttribute('aria-labelledby', 'finance-tab-exchange-rates');
    expect(within(panel).getByTestId('rate-row-EUR')).toBeInTheDocument();
  }

  it('finance read pending: the rates, the tablist and the panel show; no finance loading, placeholders or busy flag', async () => {
    financeMode = 'pending';
    openAt('tab=exchange-rates');
    await expectRatesShown();
    expect(financeCalls()).toHaveLength(1);
    expect(releaseFinance).not.toBeNull();
    expect(tab(TAB_EXCHANGE_RATES)).toHaveAttribute('aria-selected', 'true');
    expectRatesPanel();
    expectNoFinanceChrome();
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
    expectOneFinanceH1WithRatesPurpose();
    await act(async () => releaseFinance?.());
    await flush();
  });

  it('finance read failed: the rates show; no finance error and no finance Retry (Overview then shows the error, as today)', async () => {
    financeMode = 'fail';
    openAt('tab=exchange-rates');
    await expectRatesShown();
    await waitFor(() => expect(financeCalls()).toHaveLength(1));
    await flush();
    expectRatesPanel();
    expectNoFinanceChrome();
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
    expectOneFinanceH1WithRatesPurpose();

    // The read really failed: leaving the tab shows the finance error and its Retry, with no tablist (DV, SA-2a-1 (b)).
    fireEvent.click(tab(TAB_OVERVIEW));
    expect(await screen.findByTestId('finance-error')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
    expect(screen.queryByRole('tablist')).toBeNull();
  });
});

describe('N-3: currencies (SQ-20)', () => {
  it('?tab=exchange-rates&currencies=all opens All; a Show change is one write and no finance read; leaving is one write with no currencies', async () => {
    openAt('tab=exchange-rates&currencies=all');
    await screen.findByTestId('rate-row-JPY');
    expect(showSelect().value).toBe('all');
    await deliver();
    expect(address()).toBe(`${PAGE}?tab=exchange-rates&currencies=all`);
    const financeBefore = financeCalls().length;
    replaceSpy.mockClear();

    fireEvent.change(showSelect(), { target: { value: 'disabled' } });
    await waitFor(() => expect(address()).toBe(`${PAGE}?tab=exchange-rates&currencies=disabled`));
    await deliver();
    expect(writes()).toBe(1);
    expect(screen.getByTestId('rate-row-JPY')).toBeInTheDocument();
    expect(screen.queryByTestId('rate-row-EUR')).toBeNull();
    await flush();
    expect(financeCalls()).toHaveLength(financeBefore);

    replaceSpy.mockClear();
    fireEvent.click(tab(TAB_OVERVIEW));
    await deliver();
    expect(writes()).toBe(1);
    expect(address()).toBe(PAGE);
    expect(screen.queryByTestId('rate-row-JPY')).toBeNull();
    expect(screen.getByTestId('finance-kpi-strip')).toBeInTheDocument();
  });

  it('?currencies=all on Overview is repaired away', async () => {
    openAt('currencies=all');
    await screen.findByRole('tablist');
    await waitFor(() => expect(address()).toBe(PAGE));
    expect(tab(TAB_OVERVIEW)).toHaveAttribute('aria-selected', 'true');
  });
});

describe('N-4: the business wins (SQ-24)', () => {
  it.each([
    ['tab=exchange-rates', `account=${A}&tab=exchange-rates`],
    ['tab=exchange-rates&currencies=all', `account=${A}&tab=exchange-rates&currencies=all`],
  ])('account + %s → the business view, no tablist, no rates view; the URL keeps account only', async (_label, link) => {
    openAt(link);
    await screen.findByTestId('account-header-stub');
    await waitFor(() => expect(address()).toBe(`${PAGE}?account=${A}`));
    await flush();
    expect(screen.queryByRole('tablist')).toBeNull();
    expect(screen.queryByTestId('rate-row-EUR')).toBeNull();
    expect(screen.queryByText(EXCHANGE_RATES_PURPOSE)).toBeNull();
    expect(ratesCalls()).toEqual([]);
    expect(screen.getByTestId('finance-kpi-strip')).toBeInTheDocument();
  });
});

describe('N-5: the finance request on the tab is the Overview literal (SQ-19 (ii), SA-2a-2)', () => {
  it.each(['tab=exchange-rates', 'tab=exchange-rates&currencies=all'])('%s: exactly one finance-route call, equal to pin row 1', async (link) => {
    openAt(link);
    await expectRatesShown(link.includes('currencies=all') ? 'all' : 'enabled');
    await deliver();
    await flush();
    expect(financeCalls()).toEqual([OVERVIEW_REQUEST]);
    // The rates view's own reads are counted apart and allowed.
    expect(ratesCalls().length).toBeGreaterThanOrEqual(1);
  });
});

describe('N-7: a tab switch keeps keyboard focus (Q-1, SA-2a-1, SA-2a-3)', () => {
  it('Overview → Exchange rates → Overview: the same tab node stays connected, selected and focused both ways', async () => {
    openAt('');
    await screen.findByRole('tablist');
    const overview = tab(TAB_OVERVIEW);
    const rates = tab(TAB_EXCHANGE_RATES);

    overview.focus();
    fireEvent.keyDown(overview, { key: 'ArrowRight' });
    fireEvent.keyDown(tab(TAB_ACCOUNTS), { key: 'ArrowRight' });
    fireEvent.keyDown(tab(TAB_PLANS), { key: 'ArrowRight' });
    expect(rates).toHaveFocus();
    // Enter on a focused tab is the button's own click.
    fireEvent.click(rates);
    await waitFor(() => expect(address()).toBe(`${PAGE}?tab=exchange-rates`));
    await waitFor(() => expect(rates).toHaveAttribute('aria-selected', 'true'));
    await expectRatesShown();
    await deliver();
    expect(rates.isConnected).toBe(true);
    expect(tab(TAB_EXCHANGE_RATES)).toBe(rates);
    expect(rates).toHaveFocus();

    fireEvent.keyDown(rates, { key: 'ArrowLeft' });
    fireEvent.keyDown(tab(TAB_PLANS), { key: 'ArrowLeft' });
    fireEvent.keyDown(tab(TAB_ACCOUNTS), { key: 'ArrowLeft' });
    expect(overview).toHaveFocus();
    fireEvent.click(overview);
    await waitFor(() => expect(address()).toBe(PAGE));
    await waitFor(() => expect(overview).toHaveAttribute('aria-selected', 'true'));
    await deliver();
    expect(overview.isConnected).toBe(true);
    expect(tab(TAB_OVERVIEW)).toBe(overview);
    expect(overview).toHaveFocus();
  });

  it('a finance read that lands while the rates tab is open does not move focus or the tab node', async () => {
    financeMode = 'pending';
    openAt('tab=exchange-rates');
    await expectRatesShown();
    const rates = tab(TAB_EXCHANGE_RATES);
    rates.focus();
    expect(rates).toHaveFocus();

    await act(async () => releaseFinance?.());
    await flush();
    expect(rates.isConnected).toBe(true);
    expect(tab(TAB_EXCHANGE_RATES)).toBe(rates);
    expect(rates).toHaveFocus();
    expectNoFinanceChrome();
  });
});

describe('QA probes (slice 2a QA, 2026-10-20)', () => {
  it('?tab=overview&currencies=all: the unknown tab value and the stray currencies are both gone; Overview is selected', async () => {
    openAt('tab=overview&currencies=all');
    await screen.findByRole('tablist');
    await waitFor(() => expect(address()).toBe(PAGE));
    expect(tab(TAB_OVERVIEW)).toHaveAttribute('aria-selected', 'true');
    expect(screen.queryByTestId('rate-row-EUR')).toBeNull();
    expect(ratesCalls()).toEqual([]);
  });

  it('?tab=accounts&currencies=all and ?tab=plans&currencies=all: currencies is repaired away, the tab stays', async () => {
    openAt('tab=accounts&currencies=all');
    await screen.findByRole('tablist');
    await waitFor(() => expect(address()).toBe(`${PAGE}?tab=accounts`));
    view.unmount();
    openAt('tab=plans&currencies=all');
    await screen.findByRole('tablist');
    await waitFor(() => expect(address()).toBe(`${PAGE}?tab=plans`));
  });

  it('back and forth over every tab: each switch is exactly one replaceState, and currencies never leaves the rates tab', async () => {
    openAt('');
    await screen.findByRole('tablist');
    await deliver();

    const step = async (name: string, expected: string) => {
      replaceSpy.mockClear();
      fireEvent.click(tab(name));
      await waitFor(() => expect(address()).toBe(expected));
      await deliver();
      await flush();
      expect(writes()).toBe(1);
    };
    const toRates = async () => {
      await step(TAB_EXCHANGE_RATES, `${PAGE}?tab=exchange-rates`);
      await expectRatesShown();
      // A non-default Show, so leaving must drop it in the same write.
      replaceSpy.mockClear();
      fireEvent.change(showSelect(), { target: { value: 'all' } });
      await waitFor(() => expect(address()).toBe(`${PAGE}?tab=exchange-rates&currencies=all`));
      await deliver();
      expect(writes()).toBe(1);
    };

    await toRates();
    await step(TAB_ACCOUNTS, `${PAGE}?tab=accounts`);
    await toRates();
    await step(TAB_PLANS, `${PAGE}?tab=plans`);
    await toRates();
    await step(TAB_OVERVIEW, PAGE);
    await step(TAB_EXCHANGE_RATES, `${PAGE}?tab=exchange-rates`);
    await step(TAB_OVERVIEW, PAGE);
    // The finance request never moved off the Overview literal for Overview / rates / Plans.
    expect(financeCalls().every((url) => url === OVERVIEW_REQUEST || url.includes('tab=accounts'))).toBe(true);
  });

  it('finance read pending, then failing, while on the rates tab: the rates stay, no finance error, no Retry', async () => {
    let failFinance: (() => void) | null = null;
    const base = global.fetch;
    global.fetch = jest.fn((input: string) => {
      const url = String(input);
      if (!url.startsWith(FINANCE_REQUEST_PATH)) return (base as unknown as (u: string) => Promise<unknown>)(url);
      calls.push(url);
      return new Promise((resolve) => {
        failFinance = () => resolve(respond({ success: false, error: 'The finance read failed.' }, 500));
      });
    }) as unknown as typeof fetch;

    openAt('tab=exchange-rates');
    await expectRatesShown();
    const rates = tab(TAB_EXCHANGE_RATES);
    expectNoFinanceChrome();
    expect(failFinance).not.toBeNull();

    await act(async () => failFinance?.());
    await flush();
    await expectRatesShown();
    expectNoFinanceChrome();
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
    expect(tab(TAB_EXCHANGE_RATES)).toBe(rates);
    expectOneFinanceH1WithRatesPurpose();
  });

  it('the old accountId alias with tab=exchange-rates: the business still wins', async () => {
    openAt(`accountId=${A}&tab=exchange-rates&currencies=all`);
    await screen.findByTestId('account-header-stub');
    await waitFor(() => expect(address()).toBe(`${PAGE}?account=${A}`));
    await flush();
    expect(screen.queryByRole('tablist')).toBeNull();
    expect(ratesCalls()).toEqual([]);
  });
});
