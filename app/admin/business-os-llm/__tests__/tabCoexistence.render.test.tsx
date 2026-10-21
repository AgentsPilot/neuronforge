/**
 * @jest-environment jsdom
 *
 * Filter tabs, one address bar (Admin Layout Standard L-9a, workplan §2.2,
 * §6.3 X-1 to X-12, F-113): the address bar describes the visible tab only.
 *
 * Money M-5 (finance health §11H.4 CC-5, SA-WP-M5 M5-R1): the Costs & credits
 * tab moved to its own page, Charge checks, so Activity is the only filter tab
 * left and the coordination now runs between Activity and Settings. Kept and
 * re-scoped to that pair: X-4 to X-11 (X-8, X-8b and X-10 test the lag-window
 * timing, which still exists). Deleted, because they need two filter tabs:
 *   X-1  Costs at 7 days for one business, then Activity reads its own default;
 *   X-2  back to Costs puts its keys back in one write;
 *   X-3  a Costs change while Activity is hidden starts no Activity read;
 *   X-12 a deep link to Costs at 90 days, then Activity's first visit.
 * No case may read the cost report here any more.
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

const PAGE = '/admin/business-os-llm';
const REPORT_PATH = '/api/admin/business-os/credits/report';
const LIST_PATH = '/api/admin/business-os/ai-activity';
const BUSINESSES_PATH = '/api/admin/business-os/llm-usage/businesses';

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
      path === LIST_PATH
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
const panel = (id: 'settings' | 'activity') => document.getElementById(`bos-llm-panel-${id}`) as HTMLElement;
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
    expect(callsTo(fetchMock, REPORT_PATH)).toHaveLength(0);
  });

  it.each([
    // Money M-5: `costs` is no longer a tab; an old link that bypassed the redirect opens Settings.
    ['an old Costs URL', '?tab=costs&outcome=failed'],
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
    const fetchMock = stub();
    openAt('?tab=activity&keep=1&range=last_week', '#activity-table');
    await within(panel('activity')).findByTestId('activity-empty');
    await flush();

    fireEvent.click(screen.getByTestId('tab-settings'));
    await flush();
    expect(window.location.search).toBe('?tab=settings&keep=1');
    expect(window.location.hash).toBe('');

    fireEvent.click(screen.getByTestId('tab-activity'));
    await flush();
    expect(window.location.search).toBe('?tab=activity&keep=1&range=last_week');
    expect(window.location.hash).toBe('');
    expect(callsTo(fetchMock, LIST_PATH)).toHaveLength(1);
    expect(callsTo(fetchMock, REPORT_PATH)).toHaveLength(0);
  });
});

describe('lagging: useSearchParams catches up only on sync() (Next 14.2 transition delivery)', () => {
  beforeEach(() => {
    mode = 'lagging';
  });

  it('X-7: Activity\'s first visit in the click render reads This month, never a stray range on the Settings URL; sync adds nothing', async () => {
    const fetchMock = stub();
    openAt('?tab=settings&range=last_week');
    await flush();
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
    expect(writes).toHaveBeenCalledTimes(1);
    expect(window.location.search).toBe('?tab=activity');
    expect(callsTo(fetchMock, REPORT_PATH)).toHaveLength(0);
  });

  it('X-8: revisiting Activity before sync reads nothing and keeps its state; sync adds nothing; one write', async () => {
    const fetchMock = stub();
    openAt('?tab=activity&range=last_week');
    await within(panel('activity')).findByTestId('activity-empty');
    fireEvent.click(screen.getByTestId('tab-settings'));
    await sync();
    await flush();
    const writes = watchWrites();

    fireEvent.click(screen.getByTestId('tab-activity'));
    await flush();
    expect(callsTo(fetchMock, LIST_PATH)).toHaveLength(1);
    expect(within(panel('activity')).getByRole('button', { name: 'Last week' })).toHaveAttribute('aria-pressed', 'true');
    expect(window.location.search).toBe('?tab=activity&range=last_week');

    await sync();
    await flush();
    expect(callsTo(fetchMock, LIST_PATH)).toHaveLength(1);
    expect(writes).toHaveBeenCalledTimes(1);
  });

  it('X-8b: an Activity change in the lag window is kept: activation writes it once and does not re-read the stale URL', async () => {
    const fetchMock = stub();
    openAt('?tab=activity&range=last_week');
    await within(panel('activity')).findByTestId('activity-empty');
    fireEvent.click(screen.getByTestId('tab-settings'));
    await sync();
    fireEvent.click(screen.getByTestId('tab-activity'));
    await flush();
    const writes = watchWrites();

    // Before Next delivers the page's tab write, the admin picks Last month.
    fireEvent.click(within(panel('activity')).getByRole('button', { name: 'Last month' }));
    await waitFor(() => expect(callsTo(fetchMock, LIST_PATH)).toHaveLength(2));
    await flush();
    const lastMonth = resolvePreset('last_month', new Date());
    expect(paramsOf(callsTo(fetchMock, LIST_PATH)[1]).get('from')).toBe(lastMonth.from);
    // Inactive: the hook wrote nothing yet.
    expect(writes).not.toHaveBeenCalled();
    expect(window.location.search).toBe('?tab=activity&range=last_week');

    await sync();
    await flush();
    expect(writes).toHaveBeenCalledTimes(1);
    expect(window.location.search).toBe('?tab=activity&range=last_month');
    expect(within(panel('activity')).getByRole('button', { name: 'Last month' })).toHaveAttribute('aria-pressed', 'true');

    // Next's echo of that write.
    await sync();
    await flush();
    expect(callsTo(fetchMock, LIST_PATH)).toHaveLength(2);
    expect(writes).toHaveBeenCalledTimes(1);
  });

  it('X-9: Clear on Activity after a switch keeps tab=activity and unrelated keys, removes only Activity keys; one read', async () => {
    const fetchMock = stub();
    openAt('?tab=activity&keep=1&range=last_week&outcome=failed');
    await within(panel('activity')).findByTestId('activity-empty');
    fireEvent.click(screen.getByTestId('tab-settings'));
    await sync();
    fireEvent.click(screen.getByTestId('tab-activity'));
    await sync();
    await flush();
    const before = callsTo(fetchMock, LIST_PATH).length;

    fireEvent.click(within(panel('activity')).getByRole('button', { name: 'Clear' }));
    await waitFor(() => expect(callsTo(fetchMock, LIST_PATH)).toHaveLength(before + 1));
    await sync();
    await flush();
    expect(window.location.search).toBe('?tab=activity&keep=1');
    expect(callsTo(fetchMock, LIST_PATH)).toHaveLength(before + 1);
    const thisMonth = resolvePreset('this_month', new Date());
    expect(paramsOf(callsTo(fetchMock, LIST_PATH)[before]).get('from')).toBe(thisMonth.from);
    expect(paramsOf(callsTo(fetchMock, LIST_PATH)[before]).has('outcome')).toBe(false);
  });

  it('X-10: Activity, Settings, Activity with no sync between: one write per click, no extra read; sync adds nothing', async () => {
    const fetchMock = stub();
    openAt('?tab=activity&range=last_week&outcome=failed');
    await within(panel('activity')).findByTestId('activity-empty');
    const writes = watchWrites();

    fireEvent.click(screen.getByTestId('tab-settings'));
    fireEvent.click(screen.getByTestId('tab-activity'));
    await flush();
    expect(writes).toHaveBeenCalledTimes(2);
    expect(window.location.search).toBe('?tab=activity&range=last_week&outcome=failed');
    expect(callsTo(fetchMock, LIST_PATH)).toHaveLength(1);

    await sync();
    await flush();
    expect(writes).toHaveBeenCalledTimes(2);
    expect(callsTo(fetchMock, LIST_PATH)).toHaveLength(1);
  });

  it('X-11: an outside change re-parses on the visible tab, and reads nothing while that tab is hidden', async () => {
    const fetchMock = stub();
    openAt('?tab=activity&range=last_week');
    await within(panel('activity')).findByTestId('activity-empty');

    // An outside change that leaves the window as it is (an unrelated key):
    // re-parsed, and only the shared window equality keeps the filters' identity,
    // so nothing is read (the wrapper's SA M-1 rule, mutation V-6 (h)).
    window.history.replaceState(null, '', `${PAGE}?tab=activity&range=last_week&keep=1`);
    await sync();
    await flush();
    expect(callsTo(fetchMock, LIST_PATH)).toHaveLength(1);

    // An outside navigation (a link, Back) to Activity at Last month.
    window.history.replaceState(null, '', `${PAGE}?tab=activity&range=last_month`);
    await sync();
    await waitFor(() => expect(callsTo(fetchMock, LIST_PATH)).toHaveLength(2));
    await flush();
    const lastMonth = resolvePreset('last_month', new Date());
    expect(paramsOf(callsTo(fetchMock, LIST_PATH)[1]).get('from')).toBe(lastMonth.from);
    expect(within(panel('activity')).getByRole('button', { name: 'Last month' })).toHaveAttribute('aria-pressed', 'true');

    fireEvent.click(screen.getByTestId('tab-settings'));
    await sync();
    await flush();
    const writes = watchWrites();

    // The same kind of change while Activity is hidden: it neither reads nor writes.
    window.history.replaceState(null, '', `${PAGE}?tab=settings&range=last_week`);
    writes.mockClear();
    await sync();
    await flush();
    expect(callsTo(fetchMock, LIST_PATH)).toHaveLength(2);
    expect(writes).not.toHaveBeenCalled();
    expect(callsTo(fetchMock, REPORT_PATH)).toHaveLength(0);
  });
});
