/**
 * @jest-environment jsdom
 *
 * Business OS AI on the admin layout standard, slice L-8a (workplan §6.3):
 * the shared page header with a per-tab purpose line (T-1), the tablist's keys
 * (T-2), the Activity tab's URL contract (T-3 to T-6, T-15), its KPI strip
 * (T-7 to T-9), its shared states (T-10 to T-12), its table (T-13), and that a
 * tab switch starts no read (T-16, SA M-1).
 *
 * `useSearchParams` follows `window.location` here (not a fixed string), as
 * Next does once `replaceState(null, …)` is used: that is what makes a tab
 * click an outside change for the Activity filter hook (T-16).
 */

import '@testing-library/jest-dom';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

jest.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(window.location.search),
}));

import BusinessOsLlmSettingsPage from '../page';
import { ADMIN_NETWORK_ERROR } from '@/app/admin/components/layout/readAdminResponse';
import { StatusChip } from '@/app/admin/components/layout/StatusChip';
import { resolvePreset } from '../activityPresets';
import { ACTIVITY_INTRO, MIN_COST_FORMAT_PROBLEM, PLATFORM_ACCOUNT_ERROR, TIMES_ARE_UTC } from '../activityCopy';
import { PAGE_SUBTITLE } from '../copy';
import { COSTS_INTRO } from '../costCopy';
import { formatUsd } from '../costFormat';
import type { ActivityPayload, ActivityRow } from '../activityTypes';

const A = '11111111-1111-4111-8111-111111111111';
const ACTION = 'aaaaaaaa-aaaa-4aaa-8aaa-000000000009';
const PAGE = '/admin/business-os-llm';
const LIST_PATH = '/api/admin/business-os/ai-activity';
const REPORT_PATH = '/api/admin/business-os/credits/report';

function row(over: Partial<ActivityRow> = {}): ActivityRow {
  return {
    actionId: 'aaaaaaaa-aaaa-4aaa-8aaa-000000000001',
    createdAt: '2026-10-01T10:15:00+00:00',
    accountId: A,
    companyName: 'Alpha Studio',
    area: 'chat',
    actionType: 'chat_turn',
    trigger: 'owner',
    outcome: 'succeeded',
    groupId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    costUsd: { gross: 0.004, net: 0.004 },
    credits: { gross: 4, net: 4 },
    isFallbackPriced: false,
    corrected: false,
    adjustmentCount: 0,
    reasonCodes: [],
    entry: {
      state: 'found',
      callCount: 3,
      failedCallCount: 1,
      inputTokens: 1200,
      outputTokens: 300,
      totalTokens: 1500,
      models: ['model-alpha'],
      errorCode: null,
    },
    ...over,
  };
}

function payload(over: Partial<ActivityPayload> = {}): ActivityPayload {
  return {
    generatedAt: '2026-10-02T12:00:00.000Z',
    window: { from: '2026-10-01', to: '2026-10-02', start: '2026-10-01T00:00:00.000Z', end: '2026-10-03T00:00:00.000Z' },
    cutover: { at: '2026-09-29T16:50:53.914167Z', coverage: 'after_cutover' },
    filters: { accountId: null, area: null, outcome: null, trigger: null, minCostUsd: null },
    sort: 'time',
    limit: 100,
    areas: [
      { area: 'chat', actionTypes: ['chat_turn'] },
      { area: 'website', actionTypes: ['website_full_site'] },
    ],
    rows: [
      row(),
      row({
        actionId: 'aaaaaaaa-aaaa-4aaa-8aaa-000000000002',
        outcome: 'failed',
        costUsd: { gross: 0.001, net: 0.0006 },
        credits: { gross: 1, net: 0.6 },
      }),
    ],
    total: 2,
    capped: false,
    names: 'ok',
    adjustments: 'ok',
    unresolvedAdjustments: 0,
    unreadableAmounts: 0,
    deletedAccounts: null,
    audit: null,
    ...over,
  };
}

type Answer = { status: number; body: unknown };
const ok = (data: ActivityPayload): Answer => ({ status: 200, body: { success: true, data } });

/** Routes by exact path; the list answer comes from `list` (a payload or a full answer). */
function stub(list: (url: string) => Answer | Promise<Answer>) {
  const fetchMock = jest.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    const path = url.split('?')[0];
    const { status, body } =
      path === LIST_PATH
        ? await list(url)
        : path === REPORT_PATH
          ? { status: 500, body: { success: false, error: 'not under test' } }
          : { status: 200, body: { success: true, data: { areas: [], generatedAt: '2026-10-02T09:00:00.000Z' } } };
    return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
  });
  global.fetch = fetchMock as unknown as typeof fetch;
  return fetchMock;
}

const listCalls = (fetchMock: jest.Mock) =>
  fetchMock.mock.calls.map((c) => String(c[0])).filter((url) => url.split('?')[0] === LIST_PATH);
const reportCalls = (fetchMock: jest.Mock) =>
  fetchMock.mock.calls.map((c) => String(c[0])).filter((url) => url.split('?')[0] === REPORT_PATH);
const paramsOf = (url: string) => new URLSearchParams(url.split('?')[1]);
const lastListParams = (fetchMock: jest.Mock) => {
  const calls = listCalls(fetchMock);
  return paramsOf(calls[calls.length - 1]);
};

function openAt(search: string) {
  window.history.replaceState(null, '', `${PAGE}${search}`);
  return render(<BusinessOsLlmSettingsPage />);
}

const purposeLine = () => screen.getByRole('heading', { level: 1 }).closest('header')?.querySelector('p') ?? null;

beforeEach(() => {
  jest.restoreAllMocks();
  window.history.replaceState(null, '', PAGE);
});

describe('T-1: the page header and the per-tab purpose line (F-68)', () => {
  it('one h1, the Read-only neutral chip, and the purpose of the tab shown, once', async () => {
    stub(() => ok(payload()));
    const user = userEvent.setup();
    openAt('');
    const headings = screen.getAllByRole('heading', { level: 1 });
    expect(headings).toHaveLength(1);
    expect(headings[0]).toHaveTextContent('Business OS AI');
    const badge = within(headings[0].closest('header') as HTMLElement).getByText('Read-only');
    expect(badge).toHaveAttribute('data-tone', 'neutral');
    expect(screen.queryByTestId('page-subtitle')).toBeNull();
    expect(purposeLine()).toHaveTextContent(PAGE_SUBTITLE);

    await user.click(screen.getByTestId('tab-costs'));
    expect(purposeLine()?.textContent).toBe(COSTS_INTRO);
    expect(await screen.findByTestId('costs-tab')).not.toHaveTextContent(COSTS_INTRO);

    await user.click(screen.getByTestId('tab-activity'));
    expect(purposeLine()?.textContent).toBe(`${ACTIVITY_INTRO} ${TIMES_ARE_UTC}`);
    await screen.findByTestId('activity-table');
    expect(screen.getByTestId('activity-tab')).not.toHaveTextContent(ACTIVITY_INTRO);
  });
});

describe('T-2: the tabs (A-4, SA Q-5: manual activation, roving tabIndex)', () => {
  it('arrows and Home / End move focus without selecting; Enter selects', async () => {
    const fetchMock = stub(() => ok(payload()));
    const user = userEvent.setup();
    openAt('');
    const settings = screen.getByTestId('tab-settings');
    const costs = screen.getByTestId('tab-costs');
    const activity = screen.getByTestId('tab-activity');
    expect([settings.tabIndex, costs.tabIndex, activity.tabIndex]).toEqual([0, -1, -1]);

    act(() => settings.focus());
    await user.keyboard('{ArrowLeft}');
    expect(activity).toHaveFocus();
    expect(activity).toHaveAttribute('aria-selected', 'false');
    await user.keyboard('{ArrowRight}');
    expect(settings).toHaveFocus();
    await user.keyboard('{ArrowRight}');
    expect(costs).toHaveFocus();
    expect(costs).toHaveAttribute('aria-selected', 'false');
    await user.keyboard('{End}');
    expect(activity).toHaveFocus();
    await user.keyboard('{Home}');
    expect(settings).toHaveFocus();
    // Focus alone read nothing.
    expect(reportCalls(fetchMock)).toHaveLength(0);
    expect(listCalls(fetchMock)).toHaveLength(0);

    await user.keyboard('{ArrowRight}');
    await user.keyboard('{Enter}');
    expect(costs).toHaveAttribute('aria-selected', 'true');
    await waitFor(() => expect(reportCalls(fetchMock).length).toBeGreaterThan(0));
    expect([settings.tabIndex, costs.tabIndex, activity.tabIndex]).toEqual([-1, 0, -1]);
  });
});

describe('the URL contract (§5.6)', () => {
  it('T-3: an inbound link reads its own view once, and the controls show it', async () => {
    const fetchMock = stub(() => ok(payload()));
    const search = `?tab=activity&range=yesterday&account=${A}&area=website&outcome=failed&trigger=owner&min_cost=0.01&sort=cost`;
    openAt(search);
    await screen.findByTestId('activity-table');
    expect(listCalls(fetchMock)).toHaveLength(1);
    const params = lastListParams(fetchMock);
    const yesterday = resolvePreset('yesterday', new Date());
    expect(Object.fromEntries(params)).toEqual({
      from: yesterday.from,
      to: yesterday.to,
      sort: 'cost',
      accountId: A,
      area: 'website',
      outcome: 'failed',
      trigger: 'owner',
      minCostUsd: '0.01',
    });
    expect(screen.getByRole('button', { name: 'Yesterday' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByLabelText('Area')).toHaveValue('website');
    expect(screen.getByLabelText('Outcome')).toHaveValue('failed');
    expect(screen.getByLabelText('Trigger')).toHaveValue('owner');
    expect(screen.getByLabelText('Minimum cost (USD)')).toHaveValue('0.01');
    expect(screen.getByRole('button', { name: 'Most expensive first' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('business-filter-chip')).toHaveTextContent('Business: 11111111…');
    // Nothing to rewrite: the link was already the projection.
    expect(window.location.search).toBe(search);
  });

  it.each([
    ['an unknown range', 'range=48h'],
    ['an account that is not a UUID', 'account=not-a-uuid'],
    ['an unknown outcome', 'outcome=maybe'],
    ['a minimum cost that is not digits', 'min_cost=abc'],
    ['a minute bound (linked window)', 'range=custom&from=2026-10-01T10:00&to=2026-10-02'],
    ['a one-sided window', 'to=2026-10-01'],
  ])('T-4: %s is ignored (U-4): the default read, at the defaults', async (_name, query) => {
    const fetchMock = stub(() => ok(payload()));
    openAt(`?tab=activity&${query}`);
    await screen.findByTestId('activity-table');
    expect(listCalls(fetchMock)).toHaveLength(1);
    const params = lastListParams(fetchMock);
    const thisMonth = resolvePreset('this_month', new Date());
    expect(Object.fromEntries(params)).toEqual({ from: thisMonth.from, to: thisMonth.to, sort: 'time' });
    expect(screen.getByRole('button', { name: 'This month' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByTestId('linked-window-chip')).toBeNull();
    expect(screen.getByRole('button', { name: 'Clear' })).toBeDisabled();
    // The address bar is cleaned to the projection.
    await waitFor(() => expect(window.location.search).toBe('?tab=activity'));
  });

  it('T-5: a change writes the URL by replaceState(null, …), keeps tab and actionId, omits defaults; Clear resets everything with one read', async () => {
    const fetchMock = stub(() => ok(payload()));
    openAt(`?tab=activity&actionId=${ACTION}`);
    await screen.findByTestId('activity-table');
    const spy = jest.spyOn(window.history, 'replaceState');

    fireEvent.change(screen.getByLabelText('Outcome'), { target: { value: 'failed' } });
    await waitFor(() => expect(lastListParams(fetchMock).get('outcome')).toBe('failed'));
    expect(spy).toHaveBeenLastCalledWith(null, '', `${PAGE}?tab=activity&actionId=${ACTION}&outcome=failed`);

    fireEvent.change(screen.getByLabelText('Minimum cost (USD)'), { target: { value: '0.5' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply minimum cost' }));
    await waitFor(() => expect(lastListParams(fetchMock).get('minCostUsd')).toBe('0.5'));
    expect(window.location.search).toBe(`?tab=activity&actionId=${ACTION}&outcome=failed&min_cost=0.5`);

    // An unapplied draft is reset by Clear too.
    fireEvent.change(screen.getByLabelText('Minimum cost (USD)'), { target: { value: '0.7' } });
    const before = listCalls(fetchMock).length;
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
    await waitFor(() => expect(listCalls(fetchMock)).toHaveLength(before + 1));
    expect(window.location.search).toBe(`?tab=activity&actionId=${ACTION}`);
    expect(screen.getByLabelText('Minimum cost (USD)')).toHaveValue('');
    expect([...lastListParams(fetchMock).keys()]).toEqual(['from', 'to', 'sort']);
    await act(async () => {});
    expect(listCalls(fetchMock)).toHaveLength(before + 1);
  });

  it('T-6 (F-73): a preset discards an unapplied minimum cost', async () => {
    const fetchMock = stub(() => ok(payload()));
    openAt('?tab=activity');
    await screen.findByTestId('activity-table');
    fireEvent.change(screen.getByLabelText('Minimum cost (USD)'), { target: { value: '0.3' } });
    fireEvent.click(screen.getByRole('button', { name: 'Last month' }));
    const lastMonth = resolvePreset('last_month', new Date());
    await waitFor(() => expect(lastListParams(fetchMock).get('from')).toBe(lastMonth.from));
    expect(lastListParams(fetchMock).get('minCostUsd')).toBeNull();
    expect(screen.getByLabelText('Minimum cost (USD)')).toHaveValue('');
  });

  it('T-15: a URL area not in the payload list shows as its own selected option, never "All areas"', async () => {
    stub(() => ok(payload()));
    openAt('?tab=activity&area=leads');
    await screen.findByTestId('activity-table');
    const select = screen.getByLabelText('Area') as HTMLSelectElement;
    expect(select.value).toBe('leads');
    expect(select.selectedOptions[0].textContent).toBe('leads');
  });
});

describe('T-7: the KPI values (§7.11, K-8, K-9)', () => {
  const tile = (testId: string) => screen.getByTestId(testId);

  it('the count, the failed rows, the net cost, and Unresolved neutral at zero', async () => {
    stub(() => ok(payload()));
    openAt('?tab=activity');
    await screen.findByTestId('activity-table');
    expect(tile('activity-kpi-actions')).toHaveAttribute('aria-label', 'AI actions, 2');
    expect(tile('activity-kpi-failed')).toHaveAttribute('aria-label', 'Failed, 1');
    expect(tile('activity-kpi-cost')).toHaveAttribute('aria-label', `Cost (USD, net), ${formatUsd(0.0046)}`);
    expect(tile('activity-kpi-failed')).not.toHaveTextContent('shown');
    const unresolved = tile('activity-kpi-unresolved');
    expect(unresolved).toHaveAttribute('aria-label', 'Unresolved corrections, 0');
    expect(unresolved).toHaveAttribute('data-status', 'neutral');
    expect(unresolved).not.toHaveTextContent('Needs a look');
  });

  it('capped with no count: "at least", and "of the N shown" on the shown-row figures', async () => {
    stub(() => ok(payload({ total: null, capped: true })));
    openAt('?tab=activity');
    await screen.findByTestId('activity-table');
    expect(tile('activity-kpi-actions')).toHaveAttribute('aria-label', 'AI actions, at least 2');
    expect(tile('activity-kpi-failed')).toHaveTextContent('of the 2 shown');
    expect(tile('activity-kpi-cost')).toHaveTextContent('of the 2 shown');
  });

  it('an unread count that is not capped is Unknown', async () => {
    stub(() => ok(payload({ total: null, capped: false })));
    openAt('?tab=activity');
    await screen.findByTestId('activity-table');
    expect(tile('activity-kpi-actions')).toHaveAttribute('aria-label', 'AI actions, Unknown');
  });

  it('a null net is left out and said so; capped as well gives ONE sub-line (S-5); all null is Unknown', async () => {
    const rows = [row(), row({ actionId: 'aaaaaaaa-aaaa-4aaa-8aaa-000000000003', costUsd: { gross: 0.002, net: null } })];
    stub(() => ok(payload({ rows, total: 2 })));
    const { unmount } = openAt('?tab=activity');
    await screen.findByTestId('activity-table');
    expect(tile('activity-kpi-cost')).toHaveAttribute('aria-label', `Cost (USD, net), ${formatUsd(0.004)}`);
    expect(tile('activity-kpi-cost')).toHaveTextContent('1 without a net figure left out');
    unmount();

    stub(() => ok(payload({ rows, total: 50, capped: true })));
    const second = openAt('?tab=activity');
    await screen.findByTestId('activity-table');
    const cost = tile('activity-kpi-cost');
    const subId = cost.getAttribute('aria-describedby') as string;
    expect(document.getElementById(subId)?.textContent).toBe('of the 2 shown; 1 without a net figure left out');
    second.unmount();

    const allNull = rows.map((r) => ({ ...r, costUsd: { gross: 0.001, net: null } }));
    stub(() => ok(payload({ rows: allNull, total: 2 })));
    openAt('?tab=activity');
    await screen.findByTestId('activity-table');
    expect(tile('activity-kpi-cost')).toHaveAttribute('aria-label', 'Cost (USD, net), Unknown');
  });

  it('Unresolved is amber with "Needs a look" only when there is one (K-5 (ii))', async () => {
    stub(() => ok(payload({ unresolvedAdjustments: 3 })));
    openAt('?tab=activity');
    await screen.findByTestId('activity-table');
    const unresolved = tile('activity-kpi-unresolved');
    expect(unresolved).toHaveAttribute('data-status', 'amber');
    expect(unresolved).toHaveTextContent('Needs a look');
  });
});

describe('T-8: the KPI links (K-6, SA Q-10)', () => {
  it('Failed is a real link with the tab; a plain click applies, a second click removes; a ctrl-click does not apply', async () => {
    const fetchMock = stub(() => ok(payload()));
    openAt('?tab=activity');
    await screen.findByTestId('activity-table');
    const failed = screen.getByTestId('activity-kpi-failed');
    expect(failed.tagName).toBe('A');
    expect(failed).toHaveAttribute('href', `${PAGE}?tab=activity&outcome=failed`);

    // jsdom cannot navigate: keep the browser's own handling from running for the modified click.
    const stopNavigation = (event: Event) => event.preventDefault();
    window.addEventListener('click', stopNavigation);
    const before = listCalls(fetchMock).length;
    fireEvent.click(failed, { ctrlKey: true });
    await act(async () => {});
    expect(listCalls(fetchMock)).toHaveLength(before);
    window.removeEventListener('click', stopNavigation);

    fireEvent.click(failed);
    await waitFor(() => expect(lastListParams(fetchMock).get('outcome')).toBe('failed'));
    expect(listCalls(fetchMock)).toHaveLength(before + 1);
    expect(screen.getByTestId('activity-kpi-failed')).toHaveAttribute('aria-current', 'true');
    // When applied, the link is the toggled-off view, never a dead link.
    expect(screen.getByTestId('activity-kpi-failed')).toHaveAttribute('href', `${PAGE}?tab=activity`);

    fireEvent.click(screen.getByTestId('activity-kpi-failed'));
    await waitFor(() => expect(lastListParams(fetchMock).get('outcome')).toBeNull());
    expect(screen.getByTestId('activity-kpi-failed')).not.toHaveAttribute('aria-current');
  });

  it('Cost toggles the cost sort; AI actions resets Outcome and Area; Unresolved is a group, not a link', async () => {
    const fetchMock = stub(() => ok(payload()));
    openAt('?tab=activity&area=chat&outcome=failed');
    await screen.findByTestId('activity-table');
    expect(screen.getByTestId('activity-kpi-cost')).toHaveAttribute('href', `${PAGE}?tab=activity&area=chat&outcome=failed&sort=cost`);
    fireEvent.click(screen.getByTestId('activity-kpi-cost'));
    await waitFor(() => expect(lastListParams(fetchMock).get('sort')).toBe('cost'));
    expect(screen.getByTestId('activity-kpi-cost')).toHaveAttribute('aria-current', 'true');

    const actions = screen.getByTestId('activity-kpi-actions');
    expect(actions).toHaveAttribute('href', `${PAGE}?tab=activity&sort=cost`);
    expect(actions).not.toHaveAttribute('aria-current');
    fireEvent.click(actions);
    await waitFor(() => expect(lastListParams(fetchMock).get('outcome')).toBeNull());
    expect(lastListParams(fetchMock).get('area')).toBeNull();
    expect(lastListParams(fetchMock).get('sort')).toBe('cost');

    const unresolved = screen.getByTestId('activity-kpi-unresolved');
    expect(unresolved.tagName).toBe('DIV');
    expect(unresolved).toHaveAttribute('role', 'group');
    expect(unresolved).not.toHaveAttribute('href');
  });
});

describe('T-9: the strip follows the read (K-10)', () => {
  it('placeholders on the first read, then tiles', async () => {
    let answer: (value: Answer) => void = () => undefined;
    stub(() => new Promise<Answer>((resolve) => (answer = resolve)));
    openAt('?tab=activity');
    expect(await screen.findAllByTestId('kpi-placeholder')).toHaveLength(4);
    await act(async () => answer(ok(payload())));
    await screen.findByTestId('activity-table');
    expect(screen.queryByTestId('kpi-placeholder')).toBeNull();
    expect(screen.getByTestId('activity-kpi-actions')).toBeInTheDocument();
  });

  it('hidden on an error', async () => {
    stub(() => ({ status: 500, body: { success: false, error: 'boom' } }));
    openAt('?tab=activity');
    await screen.findByTestId('activity-error');
    expect(screen.queryByTestId('kpi-placeholder')).toBeNull();
    expect(screen.queryByTestId('activity-kpi-actions')).toBeNull();
  });

  it('hidden when the window is entirely before the cut-over', async () => {
    stub(() =>
      ok(payload({ cutover: { at: '2026-09-29T16:50:53.914167Z', coverage: 'entirely_before_cutover' }, rows: [], total: 0 })),
    );
    openAt('?tab=activity');
    await screen.findByTestId('activity-cutover-entirely');
    expect(screen.queryByTestId('activity-kpi-actions')).toBeNull();
    expect(screen.queryByTestId('kpi-placeholder')).toBeNull();
  });
});

describe('the shared states (§5.10)', () => {
  it('T-10: an error offers Try again, which re-reads the same parameters', async () => {
    let fail = true;
    const fetchMock = stub(() => (fail ? { status: 500, body: { success: false, error: 'boom' } } : ok(payload())));
    openAt('?tab=activity&outcome=failed');
    expect(await screen.findByTestId('activity-error')).toHaveTextContent('boom');
    fail = false;
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await screen.findByTestId('activity-table');
    const calls = listCalls(fetchMock);
    expect(calls).toHaveLength(2);
    expect(calls[1]).toBe(calls[0]);
  });

  it('T-10: a network failure says the shared words', async () => {
    global.fetch = jest.fn(async (input: RequestInfo | URL) => {
      if (String(input).split('?')[0] === LIST_PATH) throw new Error('offline');
      return { ok: true, status: 200, json: async () => ({ success: true, data: { areas: [], generatedAt: null } }) } as Response;
    }) as unknown as typeof fetch;
    openAt('?tab=activity');
    expect(await screen.findByTestId('activity-error')).toHaveTextContent(ADMIN_NETWORK_ERROR);
  });

  it('T-10: the platform-account notice keeps its words and has no Try again', async () => {
    stub(() => ({ status: 409, body: { success: false, error: 'platform_account' } }));
    openAt('?tab=activity');
    expect(await screen.findByTestId('activity-platform-account')).toHaveTextContent(PLATFORM_ACCOUNT_ERROR);
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
  });

  it('T-12: an empty list offers Clear filters only while a filter is on', async () => {
    const fetchMock = stub(() => ok(payload({ rows: [], total: 0 })));
    const { unmount } = openAt('?tab=activity');
    await screen.findByTestId('activity-empty');
    expect(screen.queryByRole('button', { name: 'Clear filters' })).toBeNull();
    unmount();

    openAt('?tab=activity&trigger=scheduled');
    await screen.findByTestId('activity-empty');
    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    await waitFor(() => expect(lastListParams(fetchMock).get('trigger')).toBeNull());
    expect(window.location.search).toBe('?tab=activity');
  });
});

describe('T-11: Refresh (D-15)', () => {
  afterEach(() => jest.useRealTimers());

  it('is named, re-sends the same dates across midnight, keeps the table and marks the content busy', async () => {
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
    const fetchMock = stub(() => (hold === null ? ok(payload()) : new Promise<Answer>((resolve) => (hold = resolve))));
    openAt('?tab=activity');
    await screen.findByTestId('activity-table');
    expect(screen.getByText('Read at 12:00 UTC')).toBeInTheDocument();
    const first = listCalls(fetchMock)[0];
    expect(paramsOf(first).get('from')).toBe('2026-10-01');
    expect(paramsOf(first).get('to')).toBe('2026-10-31');

    jest.setSystemTime(new Date('2026-11-01T00:00:30.000Z'));
    hold = () => undefined;
    fireEvent.click(screen.getByRole('button', { name: 'Refresh the AI activity' }));
    await waitFor(() => expect(listCalls(fetchMock)).toHaveLength(2));
    expect(listCalls(fetchMock)[1]).toBe(first);
    expect(screen.getByTestId('activity-content')).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByTestId('activity-table')).toBeInTheDocument();
    const release = hold as unknown as (value: Answer) => void;
    await act(async () => release(ok(payload({ generatedAt: '2026-11-01T00:00:31.000Z' }))));
    await waitFor(() => expect(screen.getByTestId('activity-content')).toHaveAttribute('aria-busy', 'false'));
    expect(screen.getByText('Read at 00:00 UTC')).toBeInTheDocument();
  });
});

describe('T-13: the table (§5.7, F-71, F-72, T-5, T-6)', () => {
  it('tabular figures on the four number columns, Outcome as a chip with words and icon, no page green or slate-500', async () => {
    stub(() => ok(payload()));
    openAt('?tab=activity');
    const table = await screen.findByTestId('activity-table');
    expect(table).toHaveAttribute('aria-label', 'AI actions');
    const [first, second] = within(table).getAllByTestId('activity-row');
    for (const testId of ['activity-cost', 'activity-credits']) {
      expect(within(first).getByTestId(testId).closest('td')?.className).toContain('tabular-nums');
    }
    for (const testId of ['activity-calls', 'activity-tokens']) {
      expect(within(first).getByTestId(testId).className).toContain('tabular-nums');
    }

    const succeeded = within(first).getByTestId('activity-outcome').querySelector('[data-tone]') as HTMLElement;
    expect(succeeded).toHaveAttribute('data-tone', 'ok');
    expect(succeeded.textContent).toBe('Succeeded');
    expect(succeeded.querySelector('svg')).not.toBeNull();
    const failed = within(second).getByTestId('activity-outcome').querySelector('[data-tone]') as HTMLElement;
    expect(failed).toHaveAttribute('data-tone', 'danger');
    expect(failed.textContent).toBe('Failed');
    // S-2: the chip's own danger icon (AlertOctagon), no icon of the page's.
    const reference = render(<StatusChip tone="danger">x</StatusChip>);
    expect(failed.querySelector('svg')?.getAttribute('class')).toBe(
      reference.container.querySelector('svg')?.getAttribute('class'),
    );
    reference.unmount();

    // The only green is the shared chip's (T-6); slate-500 survives only in the
    // record-state marker, recorded for a later tidy-up (§9 finding).
    const greens = [...table.querySelectorAll('[class*="text-emerald-"]')];
    expect(greens.every((el) => el.closest('[data-tone="ok"]') !== null)).toBe(true);
    const dim = [...table.querySelectorAll('[class*="text-slate-500"]')];
    expect(dim.every((el) => (el.getAttribute('data-testid') ?? '').startsWith('marker-'))).toBe(true);
  });
});

describe('T-16 (SA M-1): a tab switch is an outside change that starts no read', () => {
  it('with filters applied, Settings and back: no further list read, filters and table intact, only the two tab writes', async () => {
    const fetchMock = stub(() => ok(payload()));
    const user = userEvent.setup();
    // A window value in the URL is what makes the window field's `equals` matter:
    // without it the re-parse would return the default object itself.
    openAt('?tab=activity&range=last_week&outcome=failed');
    await screen.findByTestId('activity-table');
    expect(listCalls(fetchMock)).toHaveLength(1);
    const spy = jest.spyOn(window.history, 'replaceState');

    await user.click(screen.getByTestId('tab-settings'));
    await user.click(screen.getByTestId('tab-activity'));
    await act(async () => {});

    expect(listCalls(fetchMock)).toHaveLength(1);
    expect(screen.getByLabelText('Outcome')).toHaveValue('failed');
    expect(screen.getByRole('button', { name: 'Last week' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('activity-table')).toBeVisible();
    expect(spy).toHaveBeenCalledTimes(2);
    expect(spy.mock.calls.map((call) => [call[0], new URL(String(call[2]), 'http://localhost').searchParams.get('tab')])).toEqual([
      [null, 'settings'],
      [null, 'activity'],
    ]);
  });
});

describe('QA-L8a-1: a malformed minimum cost is refused in the bar', () => {
  it.each(['abc', '5.', '.5', '-1', '1,000'])(
    '"%s": an inline message, no request, URL unchanged; a tab switch then reads nothing',
    async (typed) => {
      const fetchMock = stub(() => ok(payload()));
      const user = userEvent.setup();
      openAt('?tab=activity');
      await screen.findByTestId('activity-table');
      const before = listCalls(fetchMock).length;
      const spy = jest.spyOn(window.history, 'replaceState');

      fireEvent.change(screen.getByLabelText('Minimum cost (USD)'), { target: { value: typed } });
      fireEvent.click(screen.getByRole('button', { name: 'Apply minimum cost' }));
      const problem = await screen.findByRole('alert');
      expect(problem).toHaveTextContent(MIN_COST_FORMAT_PROBLEM);
      expect(screen.getByLabelText('Minimum cost (USD)')).toHaveAttribute('aria-invalid', 'true');
      await act(async () => {});
      expect(listCalls(fetchMock)).toHaveLength(before);
      expect(spy).not.toHaveBeenCalled();
      expect(window.location.search).toBe('?tab=activity');

      await user.click(screen.getByTestId('tab-settings'));
      await user.click(screen.getByTestId('tab-activity'));
      await act(async () => {});
      expect(listCalls(fetchMock)).toHaveLength(before);
    },
  );

  it('Enter refuses the same way; typing clears the message; a valid amount applies with one request', async () => {
    const fetchMock = stub(() => ok(payload()));
    openAt('?tab=activity');
    await screen.findByTestId('activity-table');
    const before = listCalls(fetchMock).length;
    const input = screen.getByLabelText('Minimum cost (USD)');

    fireEvent.change(input, { target: { value: '1,000' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(await screen.findByTestId('activity-min-cost-problem')).toHaveTextContent(MIN_COST_FORMAT_PROBLEM);
    fireEvent.change(input, { target: { value: '0.25' } });
    expect(screen.queryByTestId('activity-min-cost-problem')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Apply minimum cost' }));
    await waitFor(() => expect(lastListParams(fetchMock).get('minCostUsd')).toBe('0.25'));
    await act(async () => {});
    expect(listCalls(fetchMock)).toHaveLength(before + 1);
    expect(window.location.search).toBe('?tab=activity&min_cost=0.25');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('a well-formed amount the route refuses (too large) still reaches the route and shows its words', async () => {
    const message = 'Minimum cost must be less than $1,000,000';
    const fetchMock = stub((url) =>
      paramsOf(url).get('minCostUsd') ? { status: 400, body: { success: false, error: message } } : ok(payload()),
    );
    openAt('?tab=activity');
    await screen.findByTestId('activity-table');
    fireEvent.change(screen.getByLabelText('Minimum cost (USD)'), { target: { value: '1000000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply minimum cost' }));
    expect(await screen.findByTestId('activity-error')).toHaveTextContent(message);
    expect(lastListParams(fetchMock).get('minCostUsd')).toBe('1000000');
    expect(screen.queryByTestId('activity-min-cost-problem')).toBeNull();
  });
});
