/**
 * @jest-environment jsdom
 *
 * Two filter tabs, one address bar (Admin Layout Standard L-9a, workplan §2.2,
 * §6.3 X-1 to X-12, F-113): Costs and Activity both own `range`, `from`, `to`
 * and `account`, both stay mounted once opened, and the address bar describes
 * the visible tab only.
 *
 * Two `useSearchParams` behaviours, chosen per test:
 *
 *   follow   the string follows `window.location` on every render, as Next
 *            does once a write has been delivered (the `activityLayout.render`
 *            harness);
 *   lagging  the string moves to `window.location` only when the test calls
 *            `sync()`, the way Next 14.2 delivers a `replaceState(null, …)` in
 *            a later transition render (§1.3). A tab click's own render
 *            therefore still carries the leaving tab's string.
 */

import '@testing-library/jest-dom';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

let mode: 'follow' | 'lagging' = 'follow';
let synced = '';
jest.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(mode === 'follow' ? window.location.search : synced),
}));

import BusinessOsLlmSettingsPage from '../page';
import { resolvePreset } from '../activityPresets';
import type { ActivityPayload } from '../activityTypes';
import type { CostPeriodFigures, CostReportPayload } from '../costTypes';

const A = '11111111-1111-4111-8111-111111111111';
const ACTION = 'aaaaaaaa-aaaa-4aaa-8aaa-000000000009';
const PAGE = '/admin/business-os-llm';
const REPORT_PATH = '/api/admin/business-os/credits/report';
const LIST_PATH = '/api/admin/business-os/ai-activity';
const BUSINESSES_PATH = '/api/admin/business-os/llm-usage/businesses';
const DAY_MS = 86_400_000;

const figures = (over: Partial<CostPeriodFigures> = {}): CostPeriodFigures => ({
  creditsTotal: 4,
  creditsOwner: 4,
  creditsScheduled: 0,
  creditsExternal: 0,
  creditsAdjustment: 0,
  costUsd: 0.004,
  charges: 4,
  fallbackPriced: 0,
  ...over,
});

function report(): CostReportPayload {
  return {
    generatedAt: '2026-10-02T12:00:00.000Z',
    window: { from: '2026-09-26', to: '2026-10-02', start: '2026-09-26T00:00:00.000Z', end: '2026-10-03T00:00:00.000Z' },
    accountFilter: null,
    periodLookbackDays: 31,
    incomplete: false,
    incompleteReasons: [],
    limits: { totalsCeiling: 2000, rowsCeiling: 20000, originalsMax: 1000, fallbackListMax: 50, fewExamplesBelow: 10 },
    sections: { totals: 'ok', rows: 'ok', names: 'ok', originals: 'ok' },
    rowsRead: 4,
    accounts: [{ accountId: A, companyName: 'Alpha Studio' }],
    periods: [
      { accountId: A, companyName: 'Alpha Studio', periodStart: '2026-09-05T00:00:00+00:00', stored: figures(), fromRows: figures(), matches: true },
    ],
    grandTotal: { stored: figures(), fromRows: figures() },
    mismatchedPeriods: 0,
    breakdowns: { byActionType: [], byArea: [], byService: [], byTrigger: [] },
    unresolvedCorrections: { count: 0, credits: 0, costUsd: 0 },
    fallback: { count: 0, reconciled: 0, items: [] },
    spreads: [],
    unreadableAmounts: 0,
  };
}

function activity(): ActivityPayload {
  return {
    generatedAt: '2026-10-02T12:00:00.000Z',
    window: { from: '2026-10-01', to: '2026-10-02', start: '2026-10-01T00:00:00.000Z', end: '2026-10-03T00:00:00.000Z' },
    cutover: { at: '2026-09-29T16:50:53.914167Z', coverage: 'after_cutover' },
    filters: { accountId: null, area: null, outcome: null, trigger: null, minCostUsd: null },
    sort: 'time',
    limit: 100,
    areas: [{ area: 'chat', actionTypes: ['chat_turn'] }],
    rows: [],
    total: 0,
    capped: false,
    names: 'ok',
    adjustments: 'ok',
    unresolvedAdjustments: 0,
    unreadableAmounts: 0,
    deletedAccounts: null,
    audit: null,
  };
}

function stub() {
  const fetchMock = jest.fn(async (input: RequestInfo | URL) => {
    const path = String(input).split('?')[0];
    const body =
      path === REPORT_PATH
        ? { success: true, data: report() }
        : path === LIST_PATH
          ? { success: true, data: activity() }
          : path === BUSINESSES_PATH
            ? { success: true, data: { businesses: [], limit: 50 } }
            : { success: true, data: { areas: [], generatedAt: '2026-10-02T09:00:00.000Z' } };
    return { ok: true, status: 200, json: async () => body } as Response;
  });
  global.fetch = fetchMock as unknown as typeof fetch;
  return fetchMock;
}

const callsTo = (fetchMock: jest.Mock, target: string) =>
  fetchMock.mock.calls.map((c) => String(c[0])).filter((url) => url.split('?')[0] === target);
const paramsOf = (url: string) => new URLSearchParams(url.split('?')[1]);
const spanOf = (url: string) => {
  const params = paramsOf(url);
  return (Date.parse(`${params.get('to')}T00:00:00Z`) - Date.parse(`${params.get('from')}T00:00:00Z`)) / DAY_MS;
};
const panel = (id: 'costs' | 'activity') => document.getElementById(`bos-llm-panel-${id}`) as HTMLElement;
const flush = () => act(async () => {});

let view: ReturnType<typeof render>;

function openAt(search: string, hash = '') {
  window.history.replaceState(null, '', `${PAGE}${search}${hash}`);
  synced = search.replace(/^\?/, '');
  view = render(<BusinessOsLlmSettingsPage />);
  return view;
}

/** Next delivers what the address bar now says (the lagging harness only). */
async function sync() {
  await act(async () => {
    synced = window.location.search.replace(/^\?/, '');
    view.rerender(<BusinessOsLlmSettingsPage />);
  });
}

let replaceSpy: jest.SpyInstance;

beforeEach(() => {
  jest.restoreAllMocks();
  mode = 'follow';
  window.history.replaceState(null, '', PAGE);
  synced = '';
});

afterEach(() => replaceSpy?.mockRestore());

const watchWrites = () => {
  replaceSpy = jest.spyOn(window.history, 'replaceState');
  return replaceSpy;
};

describe('follow: useSearchParams follows the address bar', () => {
  it('X-1: Costs at 7 days for one business, then Activity: no Costs key on Activity, Activity reads its own default', async () => {
    const fetchMock = stub();
    openAt(`?tab=costs&range=7d&account=${A}`);
    await within(panel('costs')).findByTestId('costs-periods');
    expect(callsTo(fetchMock, REPORT_PATH)).toHaveLength(1);
    const first = callsTo(fetchMock, REPORT_PATH)[0];
    expect(spanOf(first)).toBe(6);
    expect(paramsOf(first).get('accountId')).toBe(A);
    const writes = watchWrites();

    fireEvent.click(screen.getByTestId('tab-activity'));
    await within(panel('activity')).findByTestId('activity-empty');
    await flush();

    expect(window.location.search).toBe('?tab=activity');
    expect(writes).toHaveBeenCalledTimes(1);
    const lists = callsTo(fetchMock, LIST_PATH);
    expect(lists).toHaveLength(1);
    const thisMonth = resolvePreset('this_month', new Date());
    expect(paramsOf(lists[0]).get('from')).toBe(thisMonth.from);
    expect(paramsOf(lists[0]).get('to')).toBe(thisMonth.to);
    expect(paramsOf(lists[0]).has('accountId')).toBe(false);
    expect(callsTo(fetchMock, REPORT_PATH)).toHaveLength(1);
  });

  it('X-2: back to Costs puts its keys back in ONE write, with no read of either kind', async () => {
    const fetchMock = stub();
    openAt(`?tab=costs&range=7d&account=${A}`);
    await within(panel('costs')).findByTestId('costs-periods');
    fireEvent.click(screen.getByTestId('tab-activity'));
    await within(panel('activity')).findByTestId('activity-empty');
    await flush();
    const writes = watchWrites();

    fireEvent.click(screen.getByTestId('tab-costs'));
    await flush();

    expect(window.location.search).toBe(`?tab=costs&range=7d&account=${A}`);
    expect(writes).toHaveBeenCalledTimes(1);
    expect(writes).toHaveBeenCalledWith(null, '', `http://localhost${PAGE}?tab=costs&range=7d&account=${A}`);
    expect(callsTo(fetchMock, REPORT_PATH)).toHaveLength(1);
    expect(callsTo(fetchMock, LIST_PATH)).toHaveLength(1);
    expect(callsTo(fetchMock, BUSINESSES_PATH)).toHaveLength(0);
    expect(within(panel('costs')).getByRole('button', { name: '7 days' })).toHaveAttribute('aria-pressed', 'true');
    expect(within(panel('costs')).getByTestId('business-filter-chip')).toHaveTextContent('Business: Alpha Studio');
  });

  it('X-3: a Costs change while Activity is hidden starts no Activity read, and Activity keeps its own window', async () => {
    const fetchMock = stub();
    openAt('?tab=activity&range=last_week');
    await within(panel('activity')).findByTestId('activity-empty');
    fireEvent.click(screen.getByTestId('tab-costs'));
    await within(panel('costs')).findByTestId('costs-periods');
    expect(window.location.search).toBe('?tab=costs');

    fireEvent.click(within(panel('costs')).getByRole('button', { name: '90 days' }));
    await waitFor(() => expect(callsTo(fetchMock, REPORT_PATH)).toHaveLength(2));
    await flush();
    expect(window.location.search).toBe('?tab=costs&range=90d');
    expect(callsTo(fetchMock, LIST_PATH)).toHaveLength(1);

    fireEvent.click(screen.getByTestId('tab-activity'));
    await flush();
    expect(window.location.search).toBe('?tab=activity&range=last_week');
    expect(within(panel('activity')).getByRole('button', { name: 'Last week' })).toHaveAttribute('aria-pressed', 'true');
    expect(callsTo(fetchMock, LIST_PATH)).toHaveLength(1);
    expect(callsTo(fetchMock, REPORT_PATH)).toHaveLength(2);
  });

  it('X-4: Activity to Settings drops its keys; back to Activity puts them back in one write, no read', async () => {
    const fetchMock = stub();
    openAt('?tab=activity&outcome=failed&range=last_week');
    await within(panel('activity')).findByTestId('activity-empty');
    // The projection order is the spec's: window first.
    await waitFor(() => expect(window.location.search).toBe('?tab=activity&range=last_week&outcome=failed'));
    const writes = watchWrites();

    fireEvent.click(screen.getByTestId('tab-settings'));
    await flush();
    expect(window.location.search).toBe('?tab=settings');

    fireEvent.click(screen.getByTestId('tab-activity'));
    await flush();
    expect(window.location.search).toBe('?tab=activity&range=last_week&outcome=failed');
    expect(writes).toHaveBeenCalledTimes(2);
    expect(callsTo(fetchMock, LIST_PATH)).toHaveLength(1);
    expect(within(panel('activity')).getByLabelText('Outcome')).toHaveValue('failed');
  });

  it.each([
    ['a Costs URL', '?tab=costs&outcome=failed'],
    // SA M-3: a deliberate change from L-8 (§2.10 item 8): a stray key no longer pre-filters Activity's first open.
    ['a Settings URL', '?tab=settings&outcome=failed'],
  ])('X-5: a stray Activity key on %s never survives the switch: Activity opens at its defaults', async (_name, search) => {
    const fetchMock = stub();
    openAt(search);
    await flush();

    fireEvent.click(screen.getByTestId('tab-activity'));
    await within(panel('activity')).findByTestId('activity-empty');
    await flush();

    expect(window.location.search).toBe('?tab=activity');
    const lists = callsTo(fetchMock, LIST_PATH);
    expect(lists).toHaveLength(1);
    expect(paramsOf(lists[0]).has('outcome')).toBe(false);
    expect(within(panel('activity')).getByLabelText('Outcome')).toHaveValue('');
  });

  it('X-6: unrelated parameters survive every switch; the hash is dropped on a switch (SA Q-6)', async () => {
    stub();
    openAt(`?tab=costs&keep=1&actionId=${ACTION}&range=7d`, '#costs-periods');
    await within(panel('costs')).findByTestId('costs-periods');
    await flush();

    fireEvent.click(screen.getByTestId('tab-activity'));
    await flush();
    expect(window.location.search).toBe(`?tab=activity&keep=1&actionId=${ACTION}`);
    expect(window.location.hash).toBe('');

    fireEvent.click(screen.getByTestId('tab-settings'));
    await flush();
    fireEvent.click(screen.getByTestId('tab-costs'));
    await flush();
    expect(window.location.search).toBe(`?tab=costs&keep=1&actionId=${ACTION}&range=7d`);
    expect(window.location.hash).toBe('');
  });

  it('X-12: a deep link to Costs at 90 days reads 90 days once; Activity\'s first visit reads This month, no range in the URL', async () => {
    const fetchMock = stub();
    openAt('?tab=costs&range=90d');
    await within(panel('costs')).findByTestId('costs-periods');
    await flush();
    const reports = callsTo(fetchMock, REPORT_PATH);
    expect(reports).toHaveLength(1);
    expect(spanOf(reports[0])).toBe(89);
    expect(within(panel('costs')).getByRole('button', { name: '90 days' })).toHaveAttribute('aria-pressed', 'true');

    fireEvent.click(screen.getByTestId('tab-activity'));
    await within(panel('activity')).findByTestId('activity-empty');
    await flush();
    const lists = callsTo(fetchMock, LIST_PATH);
    expect(lists).toHaveLength(1);
    const thisMonth = resolvePreset('this_month', new Date());
    expect(paramsOf(lists[0]).get('from')).toBe(thisMonth.from);
    expect(window.location.search).toBe('?tab=activity');
    expect(callsTo(fetchMock, REPORT_PATH)).toHaveLength(1);
  });
});

describe('lagging: useSearchParams catches up only on sync() (Next 14.2 transition delivery)', () => {
  beforeEach(() => {
    mode = 'lagging';
  });

  it('X-7: Activity\'s first visit in the click render reads This month, never the leaving tab\'s 7 days; sync adds nothing', async () => {
    const fetchMock = stub();
    openAt('?tab=costs&range=7d');
    await within(panel('costs')).findByTestId('costs-periods');
    const writes = watchWrites();

    fireEvent.click(screen.getByTestId('tab-activity'));
    await within(panel('activity')).findByTestId('activity-empty');
    await flush();
    const lists = callsTo(fetchMock, LIST_PATH);
    expect(lists).toHaveLength(1);
    const thisMonth = resolvePreset('this_month', new Date());
    expect(paramsOf(lists[0]).get('from')).toBe(thisMonth.from);
    expect(paramsOf(lists[0]).get('to')).toBe(thisMonth.to);
    expect(window.location.search).toBe('?tab=activity');

    await sync();
    await flush();
    expect(callsTo(fetchMock, LIST_PATH)).toHaveLength(1);
    expect(callsTo(fetchMock, REPORT_PATH)).toHaveLength(1);
    expect(writes).toHaveBeenCalledTimes(1);
    expect(window.location.search).toBe('?tab=activity');
  });

  it('X-8: revisiting Costs before sync reads nothing and keeps its state; sync adds nothing; one write', async () => {
    const fetchMock = stub();
    openAt('?tab=costs&range=7d');
    await within(panel('costs')).findByTestId('costs-periods');
    fireEvent.click(screen.getByTestId('tab-activity'));
    await within(panel('activity')).findByTestId('activity-empty');
    await sync();
    await flush();
    const writes = watchWrites();

    fireEvent.click(screen.getByTestId('tab-costs'));
    await flush();
    expect(callsTo(fetchMock, REPORT_PATH)).toHaveLength(1);
    expect(within(panel('costs')).getByRole('button', { name: '7 days' })).toHaveAttribute('aria-pressed', 'true');
    expect(window.location.search).toBe('?tab=costs&range=7d');

    await sync();
    await flush();
    expect(callsTo(fetchMock, REPORT_PATH)).toHaveLength(1);
    expect(callsTo(fetchMock, LIST_PATH)).toHaveLength(1);
    expect(writes).toHaveBeenCalledTimes(1);
  });

  it('X-8b: a Costs change in the lag window is kept: activation writes it once and does not re-read the stale URL', async () => {
    const fetchMock = stub();
    openAt('?tab=costs&range=7d');
    await within(panel('costs')).findByTestId('costs-periods');
    fireEvent.click(screen.getByTestId('tab-activity'));
    await within(panel('activity')).findByTestId('activity-empty');
    await sync();
    fireEvent.click(screen.getByTestId('tab-costs'));
    await flush();
    const writes = watchWrites();

    // Before Next delivers the page's tab write, the admin picks 90 days.
    fireEvent.click(within(panel('costs')).getByRole('button', { name: '90 days' }));
    await waitFor(() => expect(callsTo(fetchMock, REPORT_PATH)).toHaveLength(2));
    await flush();
    expect(spanOf(callsTo(fetchMock, REPORT_PATH)[1])).toBe(89);
    // Inactive: the hook wrote nothing yet.
    expect(writes).not.toHaveBeenCalled();
    expect(window.location.search).toBe('?tab=costs&range=7d');

    await sync();
    await flush();
    expect(writes).toHaveBeenCalledTimes(1);
    expect(window.location.search).toBe('?tab=costs&range=90d');
    expect(within(panel('costs')).getByRole('button', { name: '90 days' })).toHaveAttribute('aria-pressed', 'true');

    // Next's echo of that write.
    await sync();
    await flush();
    expect(callsTo(fetchMock, REPORT_PATH)).toHaveLength(2);
    expect(writes).toHaveBeenCalledTimes(1);
  });

  it('X-9: Clear on Costs after a switch keeps tab=costs and unrelated keys, removes only Costs keys; one read', async () => {
    const fetchMock = stub();
    openAt(`?tab=costs&keep=1&range=7d&account=${A}`);
    await within(panel('costs')).findByTestId('costs-periods');
    fireEvent.click(screen.getByTestId('tab-activity'));
    await within(panel('activity')).findByTestId('activity-empty');
    await sync();
    fireEvent.click(screen.getByTestId('tab-costs'));
    await sync();
    await flush();
    const before = callsTo(fetchMock, REPORT_PATH).length;

    fireEvent.click(within(panel('costs')).getByRole('button', { name: 'Clear' }));
    await waitFor(() => expect(callsTo(fetchMock, REPORT_PATH)).toHaveLength(before + 1));
    await sync();
    await flush();
    expect(window.location.search).toBe('?tab=costs&keep=1');
    expect(callsTo(fetchMock, REPORT_PATH)).toHaveLength(before + 1);
    expect(spanOf(callsTo(fetchMock, REPORT_PATH)[before])).toBe(29);
  });

  it('X-10: Costs, Activity, Costs with no sync between: one write per click, no extra read; sync adds nothing', async () => {
    const fetchMock = stub();
    openAt(`?tab=costs&range=7d&account=${A}`);
    await within(panel('costs')).findByTestId('costs-periods');
    const writes = watchWrites();

    fireEvent.click(screen.getByTestId('tab-activity'));
    await within(panel('activity')).findByTestId('activity-empty');
    fireEvent.click(screen.getByTestId('tab-costs'));
    await flush();
    expect(writes).toHaveBeenCalledTimes(2);
    expect(window.location.search).toBe(`?tab=costs&range=7d&account=${A}`);
    expect(callsTo(fetchMock, REPORT_PATH)).toHaveLength(1);
    expect(callsTo(fetchMock, LIST_PATH)).toHaveLength(1);

    await sync();
    await flush();
    expect(writes).toHaveBeenCalledTimes(2);
    expect(callsTo(fetchMock, REPORT_PATH)).toHaveLength(1);
    expect(callsTo(fetchMock, LIST_PATH)).toHaveLength(1);
  });

  it('X-11: an outside change re-parses on the visible tab, and reads nothing while that tab is hidden', async () => {
    const fetchMock = stub();
    openAt('?tab=costs&range=7d');
    await within(panel('costs')).findByTestId('costs-periods');

    // An outside change that leaves the window as it is (an unrelated key):
    // re-parsed, and only the shared window equality keeps the filters' identity,
    // so nothing is read (the wrapper's SA M-1 rule, mutation V-6 (h)).
    window.history.replaceState(null, '', `${PAGE}?tab=costs&range=7d&keep=1`);
    await sync();
    await flush();
    expect(callsTo(fetchMock, REPORT_PATH)).toHaveLength(1);

    // An outside navigation (a link, Back) to Costs at 90 days.
    window.history.replaceState(null, '', `${PAGE}?tab=costs&range=90d`);
    await sync();
    await waitFor(() => expect(callsTo(fetchMock, REPORT_PATH)).toHaveLength(2));
    await flush();
    expect(spanOf(callsTo(fetchMock, REPORT_PATH)[1])).toBe(89);
    expect(within(panel('costs')).getByRole('button', { name: '90 days' })).toHaveAttribute('aria-pressed', 'true');

    fireEvent.click(screen.getByTestId('tab-activity'));
    await within(panel('activity')).findByTestId('activity-empty');
    await sync();
    await flush();
    const writes = watchWrites();

    // The same kind of change while Costs is hidden: neither tab reads or writes.
    window.history.replaceState(null, '', `${PAGE}?tab=costs&range=7d`);
    writes.mockClear();
    await sync();
    await flush();
    expect(callsTo(fetchMock, REPORT_PATH)).toHaveLength(2);
    expect(callsTo(fetchMock, LIST_PATH)).toHaveLength(1);
    expect(writes).not.toHaveBeenCalled();
  });
});
