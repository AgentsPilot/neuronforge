/**
 * @jest-environment jsdom
 *
 * The Costs & credits tab on the admin layout standard, slice L-9a (workplan
 * §6.3 C-1 to C-8, C-12): the shared filter bar with the business picker
 * (C-1), the URL contract (C-2 to C-5), Refresh and Try again across midnight
 * (C-6), the platform-account notice (C-7, SA M-2), the empty state (C-8) and
 * the KPI strip (C-12, SA M-1). L-9b adds the sections and the leak panel on
 * the standard (C-9 to C-11).
 *
 * Money M-5 (finance health §11H.4, SA-W5): the report moved from the Business
 * OS AI page's Costs & credits tab to its own page, Charge checks
 * (`/admin/finance/charges`), which mounts the same `CostsTab`. These cases now
 * mount that page; the assertions are the same, except that the address bar
 * carries no `tab` (the page has none), and a stray `tab` brought by the
 * old-link redirect is kept untouched (SA-W1).
 *
 * `useSearchParams` follows `window.location` here, as Next does once
 * `replaceState(null, …)` has been delivered (the `activityLayout.render`
 * harness).
 */

import '@testing-library/jest-dom';
import { act, fireEvent, render, waitFor, within } from '@testing-library/react';

jest.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(window.location.search),
}));

import ChargeChecksPage from '@/app/admin/finance/charges/page';
import {
  COSTS_EMPTY,
  COSTS_INCOMPLETE,
  COSTS_PLATFORM_ACCOUNT,
  INCOMPLETE_REASON_TEXT,
  NAMES_FAILED,
  UNREADABLE_AMOUNTS,
} from '../costCopy';
import { formatUsd } from '../costFormat';
import type { CostPeriodFigures, CostReportPayload } from '../costTypes';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const PAGE = '/admin/finance/charges';
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
    chargedInWindow: {
      status: 'ok',
      coverage: 'after_cutover',
      costUsd: 0.0065,
      credits: 6.5,
      charges: 5,
      rows: 6,
      deleted: { costUsd: 0.0005, credits: 0.5, rows: 1 },
      unreadableAmounts: 0,
    },
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
const costs = () => document.querySelector('[data-testid="costs-tab"]') as HTMLElement;
/** Money MK-2 (ruled): the default window is This month, the first UTC day of this month to today. */
const thisMonth = () => {
  const today = new Date().toISOString().slice(0, 10);
  return { from: `${today.slice(0, 7)}-01`, to: today };
};
const flush = () => act(async () => {});

function openAt(search: string) {
  window.history.replaceState(null, '', `${PAGE}${search}`);
  return render(<ChargeChecksPage />);
}

beforeEach(() => {
  jest.restoreAllMocks();
  window.history.replaceState(null, '', PAGE);
});

describe('C-1: the bar (§5.5, D-2 (b), SA-R-11, D-15)', () => {
  // Money MK-2 (ruled): This month is pressed by default (was 30 days).
  it('the windows in order with This month pressed, the Business picker, Clear disabled, Refresh named, Read at', async () => {
    stub(() => ok(report()));
    openAt('');
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
    expect(within(windowGroup).getByRole('button', { name: 'This month' })).toHaveAttribute('aria-pressed', 'true');
    expect(within(windowGroup).getByRole('button', { name: '30 days' })).toHaveAttribute('aria-pressed', 'false');
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
    const search = `?range=custom&from=2026-07-01&to=2026-07-31&account=${A}`;
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
    openAt(`?${query}`);
    await within(costs()).findByTestId('costs-periods');
    await flush();
    const calls = reportCalls(fetchMock);
    expect(calls).toHaveLength(1);
    // Money MK-2 (ruled): the default read is This month (was a 29-day span).
    expect({ from: paramsOf(calls[0]).get('from'), to: paramsOf(calls[0]).get('to') }).toEqual(thisMonth());
    expect(spanOf(calls[0])).toBeLessThanOrEqual(30);
    expect(paramsOf(calls[0]).has('accountId')).toBe(false);
    expect(within(costs()).getByRole('button', { name: 'This month' })).toHaveAttribute('aria-pressed', 'true');
    expect(within(costs()).getByRole('button', { name: 'Clear' })).toBeDisabled();
    await waitFor(() => expect(window.location.search).toBe(''));
  });

  it('C-4: a preset writes by replaceState(null, …) only the Costs keys, omitting the default; Clear removes every Costs key with one read', async () => {
    const fetchMock = stub(() => ok(report()));
    openAt(`?range=7d&account=${A}`);
    await within(costs()).findByTestId('costs-periods');
    await flush();
    const spy = jest.spyOn(window.history, 'replaceState');

    fireEvent.click(within(costs()).getByRole('button', { name: '90 days' }));
    await waitFor(() => expect(reportCalls(fetchMock)).toHaveLength(2));
    expect(spy).toHaveBeenLastCalledWith(null, '', `${PAGE}?range=90d&account=${A}`);

    // Money MK-2 (ruled): the default preset is now This month, so it is the one omitted.
    fireEvent.click(within(costs()).getByRole('button', { name: 'This month' }));
    await waitFor(() => expect(reportCalls(fetchMock)).toHaveLength(3));
    expect(window.location.search).toBe(`?account=${A}`);

    fireEvent.click(within(costs()).getByRole('button', { name: 'Clear' }));
    await waitFor(() => expect(reportCalls(fetchMock)).toHaveLength(4));
    await flush();
    expect(window.location.search).toBe('');
    expect(reportCalls(fetchMock)).toHaveLength(4);
    expect([...paramsOf(reportCalls(fetchMock)[3]).keys()]).toEqual(['from', 'to']);
  });

  it('M-5 (SA-W1): a stray tab=costs from the old-link redirect is read past and kept; only the Costs keys change', async () => {
    const fetchMock = stub(() => ok(report()));
    openAt(`?tab=costs&range=7d&account=${A}`);
    await within(costs()).findByTestId('costs-periods');
    await flush();
    const calls = reportCalls(fetchMock);
    expect(calls).toHaveLength(1);
    expect(spanOf(calls[0])).toBe(6);
    expect(paramsOf(calls[0]).get('accountId')).toBe(A);

    fireEvent.click(within(costs()).getByRole('button', { name: '90 days' }));
    await waitFor(() => expect(reportCalls(fetchMock)).toHaveLength(2));
    await flush();
    expect(window.location.search).toBe(`?tab=costs&range=90d&account=${A}`);
  });

  it('C-5: From after To is refused inline: no read, no URL write (F-73)', async () => {
    const fetchMock = stub(() => ok(report()));
    openAt('');
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
    expect(window.location.search).toBe('');
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
    openAt('');
    await within(costs()).findByTestId('costs-periods');
    const first = reportCalls(fetchMock)[0];
    // Money MK-2 (ruled): This month at 2026-10-31 (was 30 days, from 2026-10-02).
    expect(paramsOf(first).get('from')).toBe('2026-10-01');
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
    openAt(`?account=${A}`);
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
    const { unmount } = openAt('');
    expect(await within(costs()).findByTestId('costs-empty')).toHaveTextContent(COSTS_EMPTY);
    expect(within(costs()).queryByRole('button', { name: 'Clear filters' })).toBeNull();
    unmount();

    openAt(`?account=${A}`);
    await within(costs()).findByTestId('costs-empty');
    const before = reportCalls(fetchMock).length;
    fireEvent.click(within(costs()).getByRole('button', { name: 'Clear filters' }));
    await waitFor(() => expect(reportCalls(fetchMock)).toHaveLength(before + 1));
    expect(paramsOf(reportCalls(fetchMock)[before]).has('accountId')).toBe(false);
    await flush();
    expect(window.location.search).toBe('');
  });
});

describe('L-9b: the sections and the leak panel on the standard (C-9 to C-11)', () => {
  const G = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  const ACTION = 'aaaaaaaa-aaaa-4aaa-8aaa-000000000003';
  const sectionsReport = () => {
    const base = report();
    return report({
      periods: [
        ...base.periods,
        { accountId: A, companyName: 'Alpha Studio', periodStart: '2026-08-05T00:00:00+00:00', stored: figures(), fromRows: null, matches: null },
      ],
      breakdowns: {
        byActionType: [{ key: 'chat_turn', unresolved: false, charges: 3, credits: 1.5, costUsd: 0.0015, corrections: 0, correctionCredits: 0, correctionCostUsd: 0, failedCharges: 0 }],
        byArea: [],
        byService: [],
        byTrigger: [],
      },
      fallback: {
        count: 1,
        reconciled: 0,
        items: [
          {
            accountId: A,
            companyName: 'Alpha Studio',
            // An offset instant: the UTC time is 08:00, never the "10:00" a text slice would show (F-74).
            createdAt: '2026-09-18T10:00:00+02:00',
            actionType: 'lead_reply_recommendation',
            groupId: G,
            actionId: ACTION,
            credits: 0.5,
            costUsd: 0.0005,
            reconciled: false,
          },
        ],
      },
      spreads: [
        {
          service: 'chat',
          actionType: 'chat_turn',
          area: 'crm',
          examples: 3,
          failed: 2,
          fallbackExcluded: 0,
          fewExamples: true,
          costUsd: { p50: 0.002, p90: 0.003 },
          credits: { p50: 1, p90: 2 },
        },
      ],
    });
  };

  it('C-9: number cells in tabular figures (never monospace), check chips by tone with icons, fallback time in UTC, no slate-500', async () => {
    stub(() => ok(sectionsReport()));
    openAt('');
    const periods = await within(costs()).findByTestId('costs-periods');

    // Every right-aligned cell of every section table is a tabular, non-monospace number cell (F-71).
    const numberCells = Array.from(costs().querySelectorAll('td')).filter((cell) => cell.className.includes('text-right'));
    expect(numberCells.length).toBeGreaterThan(20);
    for (const cell of numberCells) {
      expect(cell.className).toContain('tabular-nums');
      expect(cell.className).not.toContain('font-mono');
    }
    const [firstRow] = within(periods).getAllByTestId('period-row');
    const firstCells = Array.from(firstRow.querySelectorAll('td'));
    for (const cell of firstCells.slice(2, 10)) expect(cell.className).toContain('tabular-nums');

    // Q-5: matches its rows = ok, mismatch = danger, not checked = unknown; words kept, each with its icon.
    const chips: Array<[string, string, string]> = [
      ['period-check-ok', 'ok', 'matches its rows'],
      ['period-check-mismatch', 'danger', 'mismatch'],
      ['period-check-skipped', 'unknown', 'not checked'],
    ];
    for (const [testId, tone, words] of chips) {
      const chip = within(periods).getByTestId(testId);
      expect(chip.textContent).toBe(words);
      expect(chip).toHaveAttribute('data-tone', tone);
      expect(chip.querySelector('svg')).not.toBeNull();
    }
    const few = within(costs()).getByTestId('spread-few-examples');
    expect(few).toHaveAttribute('data-tone', 'warn');
    expect(few.textContent).toBe('few examples');

    // F-74: through Date, ending in UTC; the group id shortened, the full ids on hover (§5.7 Ids).
    const [fallbackRow] = within(costs()).getAllByTestId('fallback-row');
    expect(fallbackRow).toHaveTextContent('2026-09-18 08:00 UTC');
    const groupCell = within(fallbackRow).getByTestId('fallback-group-id');
    expect(groupCell.textContent).toBe('bbbbbbbb…');
    expect(groupCell.getAttribute('title')).toContain(G);
    expect(groupCell.getAttribute('title')).toContain(ACTION);

    // T-5: no slate-500 anywhere in the tab (sections, bar, strip and leak panel).
    expect(costs().querySelector('[class*="text-slate-500"]')).toBeNull();
  });

  it('C-10: each section carries its id, and every table has a name', async () => {
    stub(() => ok(sectionsReport()));
    openAt('');
    await within(costs()).findByTestId('costs-periods');
    for (const id of ['costs-periods', 'costs-breakdowns', 'costs-fallback', 'costs-spread']) {
      expect(document.getElementById(id)).toHaveAttribute('data-testid', id);
    }
    const names = within(costs())
      .getAllByRole('table')
      .map((table) => table.getAttribute('aria-label'));
    expect(names).toEqual([
      'Per account and billing period',
      'Breakdown by action type',
      'Breakdown by area',
      'Breakdown by service',
      'Breakdown by trigger',
      'Fallback-priced charges',
      'Spread per action type',
    ]);
  });

  it('C-11: the leak panel follows the picked business, and returns to every business when the picker is cleared (SA S-6)', async () => {
    const LEAK_PATH = '/api/admin/business-os/credits/leak-check';
    const fetchMock = jest.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      const path = url.split('?')[0];
      // The leak check answers a refusal here: only the request it was sent matters.
      const body =
        path === REPORT_PATH
          ? { success: true, data: report() }
          : path === LEAK_PATH
            ? { success: false, error: 'stopped in the test' }
            : { success: true, data: { areas: [], generatedAt: '2026-10-02T09:00:00.000Z' } };
      const status = path === LEAK_PATH ? 400 : 200;
      return { ok: status === 200, status, json: async () => body } as Response;
    });
    global.fetch = fetchMock as unknown as typeof fetch;
    const leakCalls = () => fetchMock.mock.calls.map((c) => String(c[0])).filter((url) => url.split('?')[0] === LEAK_PATH);

    openAt(`?account=${A}`);
    await within(costs()).findByTestId('costs-periods');
    expect(within(costs()).getByTestId('leak-scope')).toHaveTextContent('Checking one business: Alpha Studio');
    fireEvent.click(within(costs()).getByTestId('leak-run'));
    await within(costs()).findByTestId('leak-error');
    expect(paramsOf(leakCalls()[0]).get('accountId')).toBe(A);

    fireEvent.click(within(costs()).getByRole('button', { name: 'Remove business' }));
    await waitFor(() => expect(within(costs()).getByTestId('leak-scope')).toHaveTextContent('Checking every Business OS business'));
    fireEvent.click(within(costs()).getByTestId('leak-run'));
    await waitFor(() => expect(leakCalls()).toHaveLength(2));
    expect(paramsOf(leakCalls()[1]).has('accountId')).toBe(false);
  });
});

describe('C-12: the KPI strip (§7.12, K-1 to K-10, SA M-1)', () => {
  const tile = (testId: string) => within(costs()).getByTestId(testId);
  const TOTALS_TILES = ['costs-kpi-credits', 'costs-kpi-cost', 'costs-kpi-charges', 'costs-kpi-fallback'];
  const ALL_TILES = [...TOTALS_TILES, 'costs-kpi-periods'];

  it('values and formats; Periods not matching red "Needs action" at 1; anchors to rendered sections', async () => {
    stub(() => ok(report()));
    openAt('');
    await within(costs()).findByTestId('costs-periods');
    expect(tile('costs-kpi-credits')).toHaveAttribute('aria-label', 'Credits charged, 7.25');
    // Money MK-2 (SA-1, ruled): the cost tile is chargedInWindow (0.0065), not the stored periods' 0.007.
    expect(tile('costs-kpi-cost')).toHaveAttribute('aria-label', `Charged AI cost (USD), ${formatUsd(0.0065)}`);
    expect(tile('costs-kpi-cost')).not.toHaveTextContent(formatUsd(0.007));
    expect(tile('costs-kpi-credits')).toHaveTextContent('whole billing periods');
    expect(tile('costs-kpi-charges')).toHaveTextContent('whole billing periods');
    expect(tile('costs-kpi-charges')).toHaveAttribute('aria-label', 'Charges, 1,234');
    expect(tile('costs-kpi-fallback')).toHaveAttribute('aria-label', 'Fallback-priced, 2');
    expect(tile('costs-kpi-fallback')).toHaveTextContent('1 reconciled');
    const periods = tile('costs-kpi-periods');
    expect(periods).toHaveAttribute('aria-label', 'Periods not matching, 1, needs action');
    expect(periods).toHaveAttribute('data-status', 'red');
    expect(periods).toHaveTextContent('Needs action');
    for (const testId of TOTALS_TILES) expect(tile(testId)).toHaveAttribute('data-status', 'neutral');

    expect(tile('costs-kpi-credits')).toHaveAttribute('href', '#costs-periods');
    expect(tile('costs-kpi-cost')).toHaveAttribute('href', '#costs-charged');
    expect(tile('costs-kpi-charges')).toHaveAttribute('href', '#costs-breakdowns');
    expect(tile('costs-kpi-fallback')).toHaveAttribute('href', '#costs-fallback');
    expect(periods).toHaveAttribute('href', '#costs-periods');
    for (const target of ['costs-charged', 'costs-periods', 'costs-breakdowns', 'costs-fallback']) {
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
    const { unmount } = openAt('');
    await within(costs()).findByTestId('costs-periods');
    expect(tile('costs-kpi-periods')).toHaveAttribute('aria-label', 'Periods not matching, 0');
    expect(tile('costs-kpi-periods')).toHaveAttribute('data-status', 'neutral');
    expect(tile('costs-kpi-periods')).not.toHaveTextContent('checked');
    unmount();

    const second_ = openAt(`?account=${A}`);
    await within(costs()).findByTestId('costs-periods');
    expect(tile('costs-kpi-periods')).toHaveTextContent('of 1 checked');
    expect(tile('costs-kpi-periods')).toHaveAttribute('data-status', 'neutral');
    second_.unmount();

    openAt(`?account=${B}`);
    await within(costs()).findByTestId('costs-periods');
    expect(tile('costs-kpi-periods')).toHaveAttribute('aria-label', 'Periods not matching, Not checked');
    expect(tile('costs-kpi-periods')).toHaveAttribute('data-status', 'neutral');
    expect(reportCalls(fetchMock)).toHaveLength(3);
  });

  // Money MK-2 (ruled): the cost tile has its own read and its own exactness, so the period
  // report's ceiling no longer marks it; the other four tiles keep SA M-1.
  it('SA M-1: an incomplete report puts "may be incomplete" on the four period tiles, turns none amber, and keeps Periods red', async () => {
    stub(() => ok(report({ incomplete: true, incompleteReasons: ['rows_ceiling'] })));
    openAt('');
    await within(costs()).findByTestId('costs-incomplete');
    expect(tile('costs-kpi-cost')).not.toHaveTextContent('may be incomplete');
    for (const testId of ALL_TILES.filter((id) => id !== 'costs-kpi-cost')) {
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
    const { unmount } = openAt('');
    await within(costs()).findByTestId('costs-totals-failed');
    // Money MK-2 (ruled): the cost tile's read is not the totals read, so it keeps its figure.
    expect(tile('costs-kpi-cost')).toHaveAttribute('aria-label', `Charged AI cost (USD), ${formatUsd(0.0065)}`);
    for (const testId of ALL_TILES) {
      if (testId !== 'costs-kpi-cost') expect(tile(testId).getAttribute('aria-label')).toMatch(/, Unknown$/);
      expect(tile(testId)).not.toHaveAttribute('href');
      expect(tile(testId)).toHaveAttribute('data-status', 'neutral');
    }
    unmount();

    openAt(`?account=${A}`);
    await within(costs()).findByTestId('costs-fallback-failed');
    expect(tile('costs-kpi-fallback')).toHaveAttribute('aria-label', 'Fallback-priced, Unknown');
    expect(tile('costs-kpi-credits')).toHaveAttribute('aria-label', 'Credits charged, 7.25');
    expect(tile('costs-kpi-fallback')).toHaveAttribute('href', '#costs-fallback');
    expect(reportCalls(fetchMock)).toHaveLength(2);
  });

  it('an empty report: the tiles have no target (K-6)', async () => {
    stub(() => ok(report({ periods: [], mismatchedPeriods: 0 })));
    openAt('');
    await within(costs()).findByTestId('costs-empty');
    for (const testId of ALL_TILES) {
      expect(tile(testId).tagName).toBe('DIV');
      expect(tile(testId)).toHaveAttribute('role', 'group');
    }
  });

  it('five placeholders on the first read (K-10); hidden on an error', async () => {
    let release: (value: Answer) => void = () => {};
    stub(() => new Promise<Answer>((resolve) => (release = resolve)));
    const { unmount } = openAt('');
    await waitFor(() => expect(within(costs()).getAllByTestId('kpi-placeholder')).toHaveLength(5));
    await act(async () => release({ status: 500, body: { success: false, error: 'boom' } }));
    await within(costs()).findByTestId('costs-error');
    expect(within(costs()).queryByTestId('kpi-placeholder')).toBeNull();
    expect(within(costs()).queryByTestId('costs-kpi-credits')).toBeNull();
    unmount();
  });
});

/*
 * L-10 task 9 (F-120, SA L-10 Q-7 and M-6): the "unreadable amounts" and
 * "names failed" lines are the shared notice, one box each, words unchanged.
 */
describe('F-1: the partial-report lines on the shared notice (F-120)', () => {
  /** The amber `AdminNotice` box holding a test id's text element (RC-3: the id is on the `<p>`). */
  const noticeOf = (testId: string) => {
    const text = within(costs()).getByTestId(testId);
    expect(text.tagName).toBe('P');
    const box = text.parentElement as HTMLElement;
    expect(box.className).toContain('border-amber-500/40');
    expect(box.className).toContain('bg-amber-500/10');
    expect(box.querySelector('svg[aria-hidden="true"]')).not.toBeNull();
    return box;
  };

  it('each line alone is its own notice with its words, never an alert', async () => {
    stub(() => ok(report({ unreadableAmounts: 3 })));
    const first = openAt('');
    await within(costs()).findByTestId('costs-unreadable');
    noticeOf('costs-unreadable');
    expect(within(costs()).getByTestId('costs-unreadable').textContent).toBe(UNREADABLE_AMOUNTS(3));
    expect(within(costs()).queryByTestId('costs-names-failed')).toBeNull();
    expect(within(costs()).queryByRole('alert')).toBeNull();
    first.unmount();

    stub(() => ok(report({ sections: { totals: 'ok', rows: 'ok', names: 'failed', originals: 'ok' } })));
    openAt('');
    await within(costs()).findByTestId('costs-names-failed');
    noticeOf('costs-names-failed');
    expect(within(costs()).getByTestId('costs-names-failed').textContent).toBe(NAMES_FAILED);
    expect(within(costs()).queryByRole('alert')).toBeNull();
  });

  it('all three at once: exactly three notices, in the order incomplete, unreadable, names failed; incomplete unchanged', async () => {
    stub(() =>
      ok(
        report({
          incomplete: true,
          incompleteReasons: ['rows_ceiling'],
          unreadableAmounts: 2,
          sections: { totals: 'ok', rows: 'ok', names: 'failed', originals: 'ok' },
        }),
      ),
    );
    openAt('');
    await within(costs()).findByTestId('costs-names-failed');

    const boxes = ['costs-incomplete', 'costs-unreadable', 'costs-names-failed'].map(noticeOf);
    const allNotices = [...costs().querySelectorAll('div')].filter(
      (element) => element.className.includes('border-amber-500/40') && element.className.includes('bg-amber-500/10'),
    );
    expect(allNotices).toEqual(boxes);

    expect(within(costs()).getByTestId('costs-incomplete')).toHaveTextContent(
      `${COSTS_INCOMPLETE} (${INCOMPLETE_REASON_TEXT.rows_ceiling ?? 'rows_ceiling'})`,
    );
    expect(within(costs()).getByTestId('costs-unreadable').textContent).toBe(UNREADABLE_AMOUNTS(2));
    expect(within(costs()).queryByRole('alert')).toBeNull();
  });
});

// Money MK-2 (SA-1, T-5): the cost tile is charges CREATED in the window (Finance's
// computation), with its own exactness; deleted accounts have their own line; the
// period table is labelled as whole billing periods.
describe('MK-2: one charged AI cost figure', () => {
  const tile = (testId: string) => within(costs()).getByTestId(testId);
  const charged = (over: Partial<CostReportPayload['chargedInWindow']>) => ({ ...report().chargedInWindow, ...over });

  it('the block shows the window figure and the deleted accounts line; the period table says whole billing periods', async () => {
    stub(() => ok(report()));
    openAt('');
    const block = await within(costs()).findByTestId('costs-charged');
    expect(within(block).getByRole('heading', { name: 'Charged AI cost in this window' })).toBeInTheDocument();
    expect(within(block).getByTestId('costs-charged-total')).toHaveTextContent(`${formatUsd(0.0065)} · 6.5 credits · 5 charges`);
    expect(within(block).getByTestId('costs-charged-deleted')).toHaveTextContent(`Deleted accounts: ${formatUsd(0.0005)} (1 ledger row)`);
    expect(within(costs()).getByTestId('costs-whole-periods')).toHaveTextContent(
      'Whole billing periods: can include charges from before the window'
    );
  });

  it('no deleted rows says so; with a business picked there is no deleted line', async () => {
    const fetchMock = stub((url) =>
      paramsOf(url).get('accountId') === A
        ? ok(report({ accountFilter: A, chargedInWindow: charged({ deleted: { costUsd: 0, credits: 0, rows: 0 } }) }))
        : ok(report({ chargedInWindow: charged({ deleted: { costUsd: 0, credits: 0, rows: 0 } }) }))
    );
    const { unmount } = openAt('');
    expect(await within(costs()).findByTestId('costs-charged-deleted')).toHaveTextContent('No charges from deleted accounts');
    unmount();
    openAt(`?account=${A}`);
    await within(costs()).findByTestId('costs-charged');
    expect(within(costs()).queryByTestId('costs-charged-deleted')).toBeNull();
    expect(reportCalls(fetchMock)).toHaveLength(2);
  });

  it('partial reads "at least" on the tile and the block; unknown reads "Unknown" and the block says the read failed', async () => {
    const fetchMock = stub((url) =>
      paramsOf(url).get('accountId') === A
        ? ok(report({ accountFilter: A, chargedInWindow: charged({ status: 'unknown', costUsd: null, credits: null, charges: null, rows: null, deleted: null }) }))
        : ok(report({ chargedInWindow: charged({ status: 'partial' }) }))
    );
    const { unmount } = openAt('');
    await within(costs()).findByTestId('costs-charged');
    expect(tile('costs-kpi-cost')).toHaveTextContent('at least');
    expect(within(costs()).getByTestId('costs-charged-total')).toHaveTextContent(`at least ${formatUsd(0.0065)}`);
    unmount();
    openAt(`?account=${A}`);
    await within(costs()).findByTestId('costs-charged-failed');
    expect(tile('costs-kpi-cost')).toHaveAttribute('aria-label', 'Charged AI cost (USD), Unknown');
    // The period figures are another read and still show.
    expect(tile('costs-kpi-credits')).toHaveAttribute('aria-label', 'Credits charged, 7.25');
    expect(reportCalls(fetchMock)).toHaveLength(2);
  });
});
