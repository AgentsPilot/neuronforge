/**
 * @jest-environment jsdom
 *
 * The Costs & credits tab on the admin layout standard, slice L-9a (workplan
 * §6.3 C-1 to C-8, C-12): the shared filter bar with the business picker
 * (C-1), the URL contract (C-2 to C-5), Refresh and Try again across midnight
 * (C-6), the platform-account notice (C-7, SA M-2), the empty state (C-8) and
 * the KPI strip (C-12, SA M-1).
 *
 * `useSearchParams` follows `window.location` here, as Next does once
 * `replaceState(null, …)` has been delivered (the `activityLayout.render`
 * harness). The sections and the leak panel (C-9 to C-11) are L-9b.
 */

import '@testing-library/jest-dom';
import { act, fireEvent, render, waitFor, within } from '@testing-library/react';

jest.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(window.location.search),
}));

import BusinessOsLlmSettingsPage from '../page';
import { COSTS_EMPTY, COSTS_PLATFORM_ACCOUNT } from '../costCopy';
import { formatUsd } from '../costFormat';
import type { CostPeriodFigures, CostReportPayload } from '../costTypes';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const PAGE = '/admin/business-os-llm';
const REPORT_PATH = '/api/admin/business-os/credits/report';
const DAY_MS = 86_400_000;

const figures = (over: Partial<CostPeriodFigures> = {}): CostPeriodFigures => ({
  creditsTotal: 4,
  creditsOwner: 3,
  creditsScheduled: 1,
  creditsExternal: 0,
  creditsAdjustment: 0,
  costUsd: 0.004,
  charges: 4,
  fallbackPriced: 1,
  ...over,
});

function report(over: Partial<CostReportPayload> = {}): CostReportPayload {
  return {
    generatedAt: '2026-10-02T12:00:00.000Z',
    window: { from: '2026-09-03', to: '2026-10-02', start: '2026-09-03T00:00:00.000Z', end: '2026-10-03T00:00:00.000Z' },
    accountFilter: null,
    periodLookbackDays: 31,
    incomplete: false,
    incompleteReasons: [],
    limits: { totalsCeiling: 2000, rowsCeiling: 20000, originalsMax: 1000, fallbackListMax: 50, fewExamplesBelow: 10 },
    sections: { totals: 'ok', rows: 'ok', names: 'ok', originals: 'ok' },
    rowsRead: 9,
    accounts: [
      { accountId: A, companyName: 'Alpha Studio' },
      { accountId: B, companyName: 'Beta Bakery' },
    ],
    periods: [
      { accountId: A, companyName: 'Alpha Studio', periodStart: '2026-09-05T00:00:00+00:00', stored: figures(), fromRows: figures(), matches: true },
      {
        accountId: B,
        companyName: 'Beta Bakery',
        periodStart: '2026-09-01T00:00:00+00:00',
        stored: figures({ creditsTotal: 3 }),
        fromRows: figures({ creditsTotal: 2.9 }),
        matches: false,
      },
    ],
    grandTotal: { stored: figures({ creditsTotal: 7.25, costUsd: 0.007, charges: 1234 }), fromRows: figures() },
    mismatchedPeriods: 1,
    breakdowns: { byActionType: [], byArea: [], byService: [], byTrigger: [] },
    unresolvedCorrections: { count: 0, credits: 0, costUsd: 0 },
    fallback: {
      count: 2,
      reconciled: 1,
      items: [],
    },
    spreads: [],
    unreadableAmounts: 0,
    ...over,
  };
}

type Answer = { status: number; body: unknown };
const ok = (data: CostReportPayload): Answer => ({ status: 200, body: { success: true, data } });

function stub(answer: (url: string) => Answer | Promise<Answer>) {
  const fetchMock = jest.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    const { status, body } =
      url.split('?')[0] === REPORT_PATH
        ? await answer(url)
        : { status: 200, body: { success: true, data: { areas: [], generatedAt: '2026-10-02T09:00:00.000Z' } } };
    return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
  });
  global.fetch = fetchMock as unknown as typeof fetch;
  return fetchMock;
}

const reportCalls = (fetchMock: jest.Mock) =>
  fetchMock.mock.calls.map((c) => String(c[0])).filter((url) => url.split('?')[0] === REPORT_PATH);
const paramsOf = (url: string) => new URLSearchParams(url.split('?')[1]);
const spanOf = (url: string) => {
  const params = paramsOf(url);
  return (Date.parse(`${params.get('to')}T00:00:00Z`) - Date.parse(`${params.get('from')}T00:00:00Z`)) / DAY_MS;
};
const costs = () => document.getElementById('bos-llm-panel-costs') as HTMLElement;
const flush = () => act(async () => {});

function openAt(search: string) {
  window.history.replaceState(null, '', `${PAGE}${search}`);
  return render(<BusinessOsLlmSettingsPage />);
}

beforeEach(() => {
  jest.restoreAllMocks();
  window.history.replaceState(null, '', PAGE);
});

describe('C-1: the bar (§5.5, D-2 (b), SA-R-11, D-15)', () => {
  it('the windows in order with 30 days pressed, the Business picker, Clear disabled, Refresh named, Read at', async () => {
    stub(() => ok(report()));
    openAt('?tab=costs');
    await within(costs()).findByTestId('costs-periods');
    const bar = within(costs()).getByRole('search', { name: 'Filters' });
    const windowGroup = within(bar).getByRole('group', { name: 'Window' });
    expect(within(windowGroup).getAllByRole('button').map((button) => button.textContent)).toEqual([
      'Today',
      '7 days',
      '30 days',
      'This month',
      'Custom',
      '90 days',
    ]);
    expect(within(windowGroup).getByRole('button', { name: '30 days' })).toHaveAttribute('aria-pressed', 'true');
    // From / To only under Custom (they were always shown before L-9a).
    expect(within(bar).queryByLabelText('From (UTC)')).toBeNull();
    expect(within(bar).getByLabelText('Business')).toHaveAttribute('role', 'combobox');
    expect(within(bar).getByRole('button', { name: 'Clear' })).toBeDisabled();
    expect(within(bar).getByRole('button', { name: 'Refresh the cost report' })).toBeEnabled();
    expect(within(bar).getByText('Read at 12:00 UTC')).toBeInTheDocument();
    expect(within(costs()).queryByTestId('costs-account-filter')).toBeNull();
    expect(within(costs()).queryByTestId('costs-controls')).toBeNull();
  });
});

describe('the URL contract (§5.6)', () => {
  it('C-2: an inbound custom window and business read once with those values, and the controls show them', async () => {
    const fetchMock = stub(() => ok(report({ accountFilter: A })));
    const search = `?tab=costs&range=custom&from=2026-07-01&to=2026-07-31&account=${A}`;
    openAt(search);
    await within(costs()).findByTestId('costs-periods');
    await flush();
    const calls = reportCalls(fetchMock);
    expect(calls).toHaveLength(1);
    expect(Object.fromEntries(paramsOf(calls[0]))).toEqual({ from: '2026-07-01', to: '2026-07-31', accountId: A });
    expect(within(costs()).getByRole('button', { name: 'Custom' })).toHaveAttribute('aria-pressed', 'true');
    expect(within(costs()).getByLabelText('From (UTC)')).toHaveValue('2026-07-01');
    expect(within(costs()).getByLabelText('To (UTC)')).toHaveValue('2026-07-31');
    // No lookup (RC-6): the report's own name for that account.
    expect(within(costs()).getByTestId('business-filter-chip')).toHaveTextContent('Business: Alpha Studio');
    // Nothing to rewrite: the link was already the projection.
    expect(window.location.search).toBe(search);
  });

  it.each([
    ['an unknown range', 'range=48h'],
    ['an Activity extra', 'range=yesterday'],
    ['an account that is not a UUID', 'account=not-a-uuid'],
    ['a minute bound (linked window)', 'range=custom&from=2026-10-01T10:00&to=2026-10-02'],
    ['a one-sided window', 'to=2026-10-01'],
  ])('C-3: %s is ignored (U-4): one default read, and the address bar is cleaned', async (_name, query) => {
    const fetchMock = stub(() => ok(report()));
    openAt(`?tab=costs&${query}`);
    await within(costs()).findByTestId('costs-periods');
    await flush();
    const calls = reportCalls(fetchMock);
    expect(calls).toHaveLength(1);
    expect(spanOf(calls[0])).toBe(29);
    expect(paramsOf(calls[0]).has('accountId')).toBe(false);
    expect(within(costs()).getByRole('button', { name: '30 days' })).toHaveAttribute('aria-pressed', 'true');
    expect(within(costs()).getByRole('button', { name: 'Clear' })).toBeDisabled();
    await waitFor(() => expect(window.location.search).toBe('?tab=costs'));
  });

  it('C-4: a preset writes by replaceState(null, …) keeping tab and omitting the default; Clear removes every Costs key with one read', async () => {
    const fetchMock = stub(() => ok(report()));
    openAt(`?tab=costs&range=7d&account=${A}`);
    await within(costs()).findByTestId('costs-periods');
    await flush();
    const spy = jest.spyOn(window.history, 'replaceState');

    fireEvent.click(within(costs()).getByRole('button', { name: '90 days' }));
    await waitFor(() => expect(reportCalls(fetchMock)).toHaveLength(2));
    expect(spy).toHaveBeenLastCalledWith(null, '', `${PAGE}?tab=costs&range=90d&account=${A}`);

    fireEvent.click(within(costs()).getByRole('button', { name: '30 days' }));
    await waitFor(() => expect(reportCalls(fetchMock)).toHaveLength(3));
    expect(window.location.search).toBe(`?tab=costs&account=${A}`);

    fireEvent.click(within(costs()).getByRole('button', { name: 'Clear' }));
    await waitFor(() => expect(reportCalls(fetchMock)).toHaveLength(4));
    await flush();
    expect(window.location.search).toBe('?tab=costs');
    expect(reportCalls(fetchMock)).toHaveLength(4);
    expect([...paramsOf(reportCalls(fetchMock)[3]).keys()]).toEqual(['from', 'to']);
  });

  it('C-5: From after To is refused inline: no read, no URL write (F-73)', async () => {
    const fetchMock = stub(() => ok(report()));
    openAt('?tab=costs');
    await within(costs()).findByTestId('costs-periods');
    await flush();
    const spy = jest.spyOn(window.history, 'replaceState');

    fireEvent.click(within(costs()).getByRole('button', { name: 'Custom' }));
    fireEvent.change(within(costs()).getByLabelText('From (UTC)'), { target: { value: '2026-07-31' } });
    fireEvent.change(within(costs()).getByLabelText('To (UTC)'), { target: { value: '2026-07-01' } });
    fireEvent.click(within(costs()).getByRole('button', { name: 'Apply' }));
    await flush();

    expect(within(costs()).getByRole('alert')).toHaveTextContent('The start date must not be after the end date');
    expect(reportCalls(fetchMock)).toHaveLength(1);
    expect(spy).not.toHaveBeenCalled();
    expect(window.location.search).toBe('?tab=costs');
  });
});

describe('C-6: Refresh and Try again (§5.10, D-15)', () => {
  afterEach(() => jest.useRealTimers());

  it('re-send the same dates across midnight; content kept and marked busy', async () => {
    // Only the clock is faked: every timer stays real for the async UI.
    jest.useFakeTimers({
      doNotFake: [
        'hrtime',
        'nextTick',
        'performance',
        'queueMicrotask',
        'requestAnimationFrame',
        'cancelAnimationFrame',
        'requestIdleCallback',
        'cancelIdleCallback',
        'setImmediate',
        'clearImmediate',
        'setInterval',
        'clearInterval',
        'setTimeout',
        'clearTimeout',
      ],
    });
    jest.setSystemTime(new Date('2026-10-31T23:59:30.000Z'));
    let hold: ((value: Answer) => void) | null = null;
    let fail = false;
    const fetchMock = stub(() =>
      fail
        ? { status: 500, body: { success: false, error: 'boom' } }
        : hold === null
          ? ok(report())
          : new Promise<Answer>((resolve) => (hold = resolve))
    );
    openAt('?tab=costs');
    await within(costs()).findByTestId('costs-periods');
    const first = reportCalls(fetchMock)[0];
    expect(paramsOf(first).get('from')).toBe('2026-10-02');
    expect(paramsOf(first).get('to')).toBe('2026-10-31');

    jest.setSystemTime(new Date('2026-11-01T00:00:30.000Z'));
    hold = () => undefined;
    fireEvent.click(within(costs()).getByRole('button', { name: 'Refresh the cost report' }));
    await waitFor(() => expect(reportCalls(fetchMock)).toHaveLength(2));
    expect(reportCalls(fetchMock)[1]).toBe(first);
    expect(within(costs()).getByTestId('costs-content')).toHaveAttribute('aria-busy', 'true');
    expect(within(costs()).getByTestId('costs-periods')).toBeInTheDocument();
    const release = hold as unknown as (value: Answer) => void;
    await act(async () => release(ok(report())));
    await waitFor(() => expect(within(costs()).getByTestId('costs-content')).toHaveAttribute('aria-busy', 'false'));

    hold = null;
    fail = true;
    fireEvent.click(within(costs()).getByRole('button', { name: 'Refresh the cost report' }));
    expect(await within(costs()).findByTestId('costs-error')).toHaveTextContent('boom');
    fail = false;
    fireEvent.click(within(costs()).getByRole('button', { name: 'Try again' }));
    await within(costs()).findByTestId('costs-periods');
    const calls = reportCalls(fetchMock);
    expect(calls).toHaveLength(4);
    expect(calls[3]).toBe(first);
  });
});

describe('the shared states (§5.10)', () => {
  it('C-7: a platform account gets the Costs sentence (SA M-2), no Try again, and no strip', async () => {
    stub(() => ({ status: 409, body: { success: false, error: 'platform_account' } }));
    openAt(`?tab=costs&account=${A}`);
    const notice = await within(costs()).findByTestId('costs-platform-account');
    expect(notice.textContent).toBe(COSTS_PLATFORM_ACCOUNT);
    expect(within(costs()).queryByTestId('costs-error')).toBeNull();
    expect(within(costs()).queryByRole('button', { name: 'Try again' })).toBeNull();
    expect(within(costs()).queryByTestId('kpi-placeholder')).toBeNull();
    expect(within(costs()).queryByTestId('costs-kpi-credits')).toBeNull();
  });

  it('C-8: an empty report offers Clear filters only while a business is picked', async () => {
    const empty = report({ periods: [], accounts: [], mismatchedPeriods: 0, rowsRead: null });
    const fetchMock = stub(() => ok(empty));
    const { unmount } = openAt('?tab=costs');
    expect(await within(costs()).findByTestId('costs-empty')).toHaveTextContent(COSTS_EMPTY);
    expect(within(costs()).queryByRole('button', { name: 'Clear filters' })).toBeNull();
    unmount();

    openAt(`?tab=costs&account=${A}`);
    await within(costs()).findByTestId('costs-empty');
    const before = reportCalls(fetchMock).length;
    fireEvent.click(within(costs()).getByRole('button', { name: 'Clear filters' }));
    await waitFor(() => expect(reportCalls(fetchMock)).toHaveLength(before + 1));
    expect(paramsOf(reportCalls(fetchMock)[before]).has('accountId')).toBe(false);
    await flush();
    expect(window.location.search).toBe('?tab=costs');
  });
});

describe('C-12: the KPI strip (§7.12, K-1 to K-10, SA M-1)', () => {
  const tile = (testId: string) => within(costs()).getByTestId(testId);
  const TOTALS_TILES = ['costs-kpi-credits', 'costs-kpi-cost', 'costs-kpi-charges', 'costs-kpi-fallback'];
  const ALL_TILES = [...TOTALS_TILES, 'costs-kpi-periods'];

  it('values and formats; Periods not matching red "Needs action" at 1; anchors to rendered sections', async () => {
    stub(() => ok(report()));
    openAt('?tab=costs');
    await within(costs()).findByTestId('costs-periods');
    expect(tile('costs-kpi-credits')).toHaveAttribute('aria-label', 'Credits charged, 7.25');
    expect(tile('costs-kpi-cost')).toHaveAttribute('aria-label', `Cost (USD), ${formatUsd(0.007)}`);
    expect(tile('costs-kpi-charges')).toHaveAttribute('aria-label', 'Charges, 1,234');
    expect(tile('costs-kpi-fallback')).toHaveAttribute('aria-label', 'Fallback-priced, 2');
    expect(tile('costs-kpi-fallback')).toHaveTextContent('1 reconciled');
    const periods = tile('costs-kpi-periods');
    expect(periods).toHaveAttribute('aria-label', 'Periods not matching, 1, needs action');
    expect(periods).toHaveAttribute('data-status', 'red');
    expect(periods).toHaveTextContent('Needs action');
    for (const testId of TOTALS_TILES) expect(tile(testId)).toHaveAttribute('data-status', 'neutral');

    expect(tile('costs-kpi-credits')).toHaveAttribute('href', '#costs-periods');
    expect(tile('costs-kpi-cost')).toHaveAttribute('href', '#costs-periods');
    expect(tile('costs-kpi-charges')).toHaveAttribute('href', '#costs-breakdowns');
    expect(tile('costs-kpi-fallback')).toHaveAttribute('href', '#costs-fallback');
    expect(periods).toHaveAttribute('href', '#costs-periods');
    for (const target of ['costs-periods', 'costs-breakdowns', 'costs-fallback']) {
      expect(document.getElementById(target)).toHaveAttribute('data-testid', target);
    }
  });

  it('neutral at no mismatch; "of N checked" when some periods were not checked; "Not checked" when none was', async () => {
    const [first, second] = report().periods;
    const fetchMock = stub((url) =>
      paramsOf(url).get('accountId') === A
        ? ok(report({ mismatchedPeriods: 0, periods: [first, { ...second, matches: null }] }))
        : paramsOf(url).get('accountId') === B
          ? ok(report({ mismatchedPeriods: 0, periods: [{ ...first, matches: null }, { ...second, matches: null }] }))
          : ok(report({ mismatchedPeriods: 0, periods: [first, { ...second, matches: true }] }))
    );
    const { unmount } = openAt('?tab=costs');
    await within(costs()).findByTestId('costs-periods');
    expect(tile('costs-kpi-periods')).toHaveAttribute('aria-label', 'Periods not matching, 0');
    expect(tile('costs-kpi-periods')).toHaveAttribute('data-status', 'neutral');
    expect(tile('costs-kpi-periods')).not.toHaveTextContent('checked');
    unmount();

    const second_ = openAt(`?tab=costs&account=${A}`);
    await within(costs()).findByTestId('costs-periods');
    expect(tile('costs-kpi-periods')).toHaveTextContent('of 1 checked');
    expect(tile('costs-kpi-periods')).toHaveAttribute('data-status', 'neutral');
    second_.unmount();

    openAt(`?tab=costs&account=${B}`);
    await within(costs()).findByTestId('costs-periods');
    expect(tile('costs-kpi-periods')).toHaveAttribute('aria-label', 'Periods not matching, Not checked');
    expect(tile('costs-kpi-periods')).toHaveAttribute('data-status', 'neutral');
    expect(reportCalls(fetchMock)).toHaveLength(3);
  });

  it('SA M-1: an incomplete report puts "may be incomplete" on all five tiles, turns none amber, and keeps Periods red', async () => {
    stub(() => ok(report({ incomplete: true, incompleteReasons: ['rows_ceiling'] })));
    openAt('?tab=costs');
    await within(costs()).findByTestId('costs-incomplete');
    for (const testId of ALL_TILES) {
      const element = tile(testId);
      const sub = document.getElementById(element.getAttribute('aria-describedby') ?? '');
      expect(sub?.textContent).toContain('may be incomplete');
      expect(element).not.toHaveTextContent('Needs a look');
    }
    for (const testId of TOTALS_TILES) expect(tile(testId)).toHaveAttribute('data-status', 'neutral');
    expect(tile('costs-kpi-periods')).toHaveAttribute('data-status', 'red');
    expect(tile('costs-kpi-fallback')).toHaveTextContent('1 reconciled; may be incomplete');
  });

  it('"Unknown" for failed sections; no anchors when no section renders', async () => {
    const fetchMock = stub((url) =>
      paramsOf(url).get('accountId') === A
        ? ok(report({ breakdowns: null, sections: { totals: 'ok', rows: 'failed', names: 'ok', originals: 'skipped' } }))
        : ok(report({ periods: [], sections: { totals: 'failed', rows: 'skipped', names: 'skipped', originals: 'skipped' } }))
    );
    const { unmount } = openAt('?tab=costs');
    await within(costs()).findByTestId('costs-totals-failed');
    for (const testId of ALL_TILES) {
      expect(tile(testId).getAttribute('aria-label')).toMatch(/, Unknown$/);
      expect(tile(testId)).not.toHaveAttribute('href');
      expect(tile(testId)).toHaveAttribute('data-status', 'neutral');
    }
    unmount();

    openAt(`?tab=costs&account=${A}`);
    await within(costs()).findByTestId('costs-fallback-failed');
    expect(tile('costs-kpi-fallback')).toHaveAttribute('aria-label', 'Fallback-priced, Unknown');
    expect(tile('costs-kpi-credits')).toHaveAttribute('aria-label', 'Credits charged, 7.25');
    expect(tile('costs-kpi-fallback')).toHaveAttribute('href', '#costs-fallback');
    expect(reportCalls(fetchMock)).toHaveLength(2);
  });

  it('an empty report: the tiles have no target (K-6)', async () => {
    stub(() => ok(report({ periods: [], mismatchedPeriods: 0 })));
    openAt('?tab=costs');
    await within(costs()).findByTestId('costs-empty');
    for (const testId of ALL_TILES) {
      expect(tile(testId).tagName).toBe('DIV');
      expect(tile(testId)).toHaveAttribute('role', 'group');
    }
  });

  it('five placeholders on the first read (K-10); hidden on an error', async () => {
    let release: (value: Answer) => void = () => {};
    stub(() => new Promise<Answer>((resolve) => (release = resolve)));
    const { unmount } = openAt('?tab=costs');
    await waitFor(() => expect(within(costs()).getAllByTestId('kpi-placeholder')).toHaveLength(5));
    await act(async () => release({ status: 500, body: { success: false, error: 'boom' } }));
    await within(costs()).findByTestId('costs-error');
    expect(within(costs()).queryByTestId('kpi-placeholder')).toBeNull();
    expect(within(costs()).queryByTestId('costs-kpi-credits')).toBeNull();
    unmount();
  });
});
