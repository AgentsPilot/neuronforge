/**
 * @jest-environment jsdom
 *
 * The Activity tab (admin AI Activity view, Gap B slice B1a): its states, the
 * table's columns and record-state text (AC-B1, AC-B17), the count line
 * (AC-B11), the cut-over line (AC-B20), the deleted-account bucket (AC-B9),
 * the platform-account refusal (SA-B1-5), the controls reaching the route
 * (AC-B3), and the page's URL-addressable tab (SA-RC-13, SA-B1-8).
 */

import '@testing-library/jest-dom';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

let mockSearch = '';
jest.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(mockSearch),
}));

import BusinessOsLlmSettingsPage from '../page';
import { ActivityTab } from '../components/activity/ActivityTab';
import { resolvePreset } from '../activityPresets';
import {
  ACTIVITY_EMPTY,
  ACTIVITY_TAB_LABEL,
  ADJUSTMENTS_FAILED,
  COLUMNS,
  CUTOVER_ENTIRELY_BEFORE,
  CUTOVER_LINE,
  DELETED_BUCKET_NOTE,
  MARKER_CORRECTED,
  MARKER_FALLBACK,
  NAMES_FAILED,
  PLATFORM_ACCOUNT_ERROR,
} from '../activityCopy';
import type { ActivityPayload, ActivityRow } from '../activityTypes';

const A = '11111111-1111-4111-8111-111111111111';

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
        isFallbackPriced: true,
        corrected: true,
        adjustmentCount: 1,
        reasonCodes: ['fallback_price_reconciled'],
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
    deletedAccounts: { status: 'ok', count: 3, costUsd: 0.003, credits: 3, atLeast: false },
    ...over,
  };
}

type Responder = (url: string) => { status: number; body: unknown };

function stub(respond: Responder) {
  const fetchMock = jest.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    const { status, body } = respond(url);
    return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
  });
  global.fetch = fetchMock as unknown as typeof fetch;
  return fetchMock;
}

const ok = (data: ActivityPayload) => ({ status: 200, body: { success: true, data } });
const activityCalls = (fetchMock: jest.Mock) =>
  fetchMock.mock.calls.map((c) => String(c[0])).filter((u) => u.startsWith('/api/admin/business-os/ai-activity'));
const lastActivityParams = (fetchMock: jest.Mock) => {
  const calls = activityCalls(fetchMock);
  return new URLSearchParams(calls[calls.length - 1].split('?')[1]);
};

beforeEach(() => {
  jest.clearAllMocks();
  mockSearch = '';
  window.history.replaceState(null, '', '/admin/business-os-llm');
});

describe('states', () => {
  it('reads the default window (this month, newest first) and renders the table', async () => {
    const fetchMock = stub(() => ok(payload()));
    render(<ActivityTab />);
    expect(await screen.findByTestId('activity-table')).toBeInTheDocument();
    const params = lastActivityParams(fetchMock);
    const thisMonth = resolvePreset('this_month', new Date());
    expect(params.get('from')).toBe(thisMonth.from);
    expect(params.get('to')).toBe(thisMonth.to);
    expect(params.get('sort')).toBe('time');
    // Only set filters are sent: the route is strict.
    expect([...params.keys()].sort()).toEqual(['from', 'sort', 'to']);
    expect(screen.getByRole('button', { name: 'This month' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('an error from the route is shown, and no stale rows stay under it', async () => {
    let fail = false;
    stub(() => (fail ? { status: 400, body: { success: false, error: 'The window may be at most 92 days' } } : ok(payload())));
    render(<ActivityTab />);
    await screen.findByTestId('activity-table');
    fail = true;
    fireEvent.click(screen.getByRole('button', { name: 'Yesterday' }));
    expect(await screen.findByTestId('activity-error')).toHaveTextContent('The window may be at most 92 days');
    expect(screen.queryByTestId('activity-table')).not.toBeInTheDocument();
  });

  it('a network failure is shown as an error', async () => {
    global.fetch = jest.fn(async () => {
      throw new Error('offline');
    }) as unknown as typeof fetch;
    render(<ActivityTab />);
    expect(await screen.findByTestId('activity-error')).toHaveTextContent('offline');
  });

  it('SA-B1-5: a platform account gets its own explanation, not the generic error', async () => {
    stub(() => ({ status: 409, body: { success: false, error: 'platform_account' } }));
    render(<ActivityTab />);
    const notice = await screen.findByTestId('activity-platform-account');
    expect(notice).toHaveTextContent(PLATFORM_ACCOUNT_ERROR);
    expect(notice).not.toHaveTextContent('platform_account');
    expect(screen.queryByTestId('activity-error')).not.toBeInTheDocument();
  });

  it('an empty window says so', async () => {
    stub(() => ok(payload({ rows: [], total: 0 })));
    render(<ActivityTab />);
    expect(await screen.findByTestId('activity-empty')).toHaveTextContent(ACTIVITY_EMPTY);
  });
});

describe('the table (AC-B1, AC-B17)', () => {
  it('labels the cost column "Cost (USD)" and has no audit-entry columns yet (B1b)', async () => {
    stub(() => ok(payload()));
    render(<ActivityTab />);
    const table = await screen.findByTestId('activity-table');
    const headers = within(table).getAllByRole('columnheader').map((h) => h.textContent);
    expect(headers).toEqual(Object.values(COLUMNS));
    expect(headers).toContain('Cost (USD)');
    for (const absent of ['Calls', 'Tokens', 'Models', 'Error code']) expect(headers).not.toContain(absent);
  });

  it('every state renders as TEXT, never colour alone', async () => {
    stub(() => ok(payload()));
    render(<ActivityTab />);
    const rows = await screen.findAllByTestId('activity-row');
    expect(within(rows[0]).getByTestId('activity-outcome')).toHaveTextContent('Succeeded');
    expect(within(rows[1]).getByTestId('activity-outcome')).toHaveTextContent('Failed');
    expect(within(rows[1]).getByTestId('marker-fallback')).toHaveTextContent(MARKER_FALLBACK);
    expect(within(rows[1]).getByTestId('marker-corrected')).toHaveTextContent(`${MARKER_CORRECTED}(fallback_price_reconciled)`);
    expect(within(rows[0]).getByTestId('marker-none')).toBeInTheDocument();
    // No direction is claimed for a fallback price until B2/B3 (OQ-13).
    expect(rows[1]).not.toHaveTextContent(/over-estimate|under-estimate|overcharged|undercharged/i);
  });

  it('a corrected row shows the net figure with the charged figure struck beside it', async () => {
    stub(() => ok(payload()));
    render(<ActivityTab />);
    const rows = await screen.findAllByTestId('activity-row');
    const cost = within(rows[1]).getByTestId('activity-cost');
    expect(cost).toHaveTextContent('$0.0006');
    expect(cost.querySelector('s')).toHaveTextContent('$0.001');
    expect(within(rows[0]).getByTestId('activity-cost').querySelector('s')).toBeNull();
  });

  it('names the business with its short id, and says when names could not be read', async () => {
    stub(() => ok(payload({ names: 'failed', rows: [row({ companyName: null })], total: 1 })));
    render(<ActivityTab />);
    const [first] = await screen.findAllByTestId('activity-row');
    expect(first).toHaveTextContent('Name unavailable');
    expect(first).toHaveTextContent('11111111…');
    expect(screen.getByTestId('activity-names-failed')).toHaveTextContent(NAMES_FAILED);
  });

  it('when corrections could not be read, says the figures are as charged', async () => {
    stub(() =>
      ok(payload({ adjustments: 'failed', rows: [row({ costUsd: { gross: 0.004, net: null }, credits: { gross: 4, net: null } })], total: 1 }))
    );
    render(<ActivityTab />);
    expect(await screen.findByTestId('activity-adjustments-failed')).toHaveTextContent(ADJUSTMENTS_FAILED);
  });
});

describe('the count line (AC-B11)', () => {
  it('"N actions" when everything is shown', async () => {
    stub(() => ok(payload()));
    render(<ActivityTab />);
    expect(await screen.findByTestId('activity-count')).toHaveTextContent('2 actions');
  });

  it('names the cap and the order when capped', async () => {
    stub(() => ok(payload({ total: 1234, capped: true })));
    render(<ActivityTab />);
    expect(await screen.findByTestId('activity-count')).toHaveTextContent(
      'Showing the top 2 of 1,234 for the current filter, newest first'
    );
  });

  it('says "most expensive first" for the cost sort', async () => {
    stub(() => ok(payload({ total: 500, capped: true, sort: 'cost' })));
    render(<ActivityTab />);
    expect(await screen.findByTestId('activity-count')).toHaveTextContent('most expensive first');
  });

  it('shows no number at all when the count could not be read', async () => {
    stub(() => ok(payload({ total: null, capped: false })));
    render(<ActivityTab />);
    await screen.findByTestId('activity-table');
    expect(screen.queryByTestId('activity-count')).not.toBeInTheDocument();
  });
});

describe('the cut-over (AC-B20)', () => {
  it('a window that starts before it shows the line and both links', async () => {
    stub(() => ok(payload({ cutover: { at: '2026-09-29T16:50:53.914167Z', coverage: 'starts_before_cutover' } })));
    render(<ActivityTab />);
    const notice = await screen.findByTestId('activity-cutover');
    expect(notice).toHaveTextContent(CUTOVER_LINE);
    expect(screen.getByTestId('activity-cutover-audit')).toHaveAttribute(
      'href',
      '/admin/audit-trail?entity_type=ai_action&date_to=2026-09-29T16%3A51'
    );
    expect(screen.getByTestId('activity-cutover-analytics')).toHaveAttribute('href', '/admin/analytics?scope=bos');
    expect(screen.getByTestId('activity-table')).toBeInTheDocument();
  });

  it('the links follow the chosen business', async () => {
    stub(() =>
      ok(
        payload({
          cutover: { at: '2026-09-29T16:50:53.914167Z', coverage: 'starts_before_cutover' },
          filters: { accountId: A, area: null, outcome: null, trigger: null, minCostUsd: null },
          deletedAccounts: null,
        })
      )
    );
    render(<ActivityTab />);
    await screen.findByTestId('activity-cutover');
    expect(screen.getByTestId('activity-cutover-audit').getAttribute('href')).toContain(`user_id=${A}`);
    expect(screen.getByTestId('activity-cutover-analytics').getAttribute('href')).toContain(`user=${A}`);
  });

  it('a window entirely before it shows the line INSTEAD of a table or an empty result', async () => {
    stub(() =>
      ok(
        payload({
          cutover: { at: '2026-09-29T16:50:53.914167Z', coverage: 'entirely_before_cutover' },
          rows: [],
          total: 0,
          deletedAccounts: null,
        })
      )
    );
    render(<ActivityTab />);
    expect(await screen.findByTestId('activity-cutover-entirely')).toHaveTextContent(CUTOVER_ENTIRELY_BEFORE);
    expect(screen.queryByTestId('activity-table')).not.toBeInTheDocument();
    expect(screen.queryByTestId('activity-empty')).not.toBeInTheDocument();
    expect(screen.queryByTestId('activity-count')).not.toBeInTheDocument();
  });

  it('a window after it shows no cut-over line', async () => {
    stub(() => ok(payload()));
    render(<ActivityTab />);
    await screen.findByTestId('activity-table');
    expect(screen.queryByTestId('activity-cutover')).not.toBeInTheDocument();
  });
});

describe('the deleted-account bucket (AC-B9)', () => {
  it('is its own line, labelled not audit loss', async () => {
    stub(() => ok(payload()));
    render(<ActivityTab />);
    const bucket = await screen.findByTestId('activity-deleted-bucket');
    expect(bucket).toHaveTextContent('Account deleted — 3 actions, $0.003, 3 credits');
    expect(bucket).toHaveTextContent(DELETED_BUCKET_NOTE);
    expect(bucket).not.toHaveTextContent('at least');
  });

  it('says "at least" on the sums only when the read stopped at its ceiling; the count stays exact (SA-CR-2)', async () => {
    stub(() => ok(payload({ deletedAccounts: { status: 'ok', count: 5000, costUsd: 5, credits: 5000, atLeast: true } })));
    render(<ActivityTab />);
    const bucket = await screen.findByTestId('activity-deleted-bucket');
    expect(bucket).toHaveTextContent('Account deleted — 5,000 actions, at least $5.00, at least 5,000 credits');
    expect(bucket).not.toHaveTextContent('at least 5,000 actions');
  });

  it('is absent when one business is chosen', async () => {
    stub(() => ok(payload({ deletedAccounts: null })));
    render(<ActivityTab />);
    await screen.findByTestId('activity-table');
    expect(screen.queryByTestId('activity-deleted-bucket')).not.toBeInTheDocument();
  });
});

describe('controls (AC-B3, AC-B17)', () => {
  it('every control has an accessible name, and the presets say which is pressed', async () => {
    stub(() => ok(payload()));
    render(<ActivityTab />);
    await screen.findByTestId('activity-table');
    for (const label of ['From (UTC)', 'To (UTC)', 'Minimum cost (USD)', 'Area', 'Outcome', 'Trigger', 'Account']) {
      expect(screen.getByLabelText(label)).toBeInTheDocument();
    }
    for (const name of ['Today', 'Yesterday', 'This week', 'Last week', 'This month', 'Last month']) {
      expect(screen.getByRole('button', { name })).toHaveAttribute('aria-pressed');
    }
    expect(screen.getByRole('button', { name: 'Newest first' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('a preset reads its own window', async () => {
    const fetchMock = stub(() => ok(payload()));
    render(<ActivityTab />);
    await screen.findByTestId('activity-table');
    fireEvent.click(screen.getByRole('button', { name: 'Last month' }));
    const lastMonth = resolvePreset('last_month', new Date());
    await waitFor(() => expect(lastActivityParams(fetchMock).get('from')).toBe(lastMonth.from));
    expect(lastActivityParams(fetchMock).get('to')).toBe(lastMonth.to);
    expect(screen.getByRole('button', { name: 'Last month' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('the filters and the sort reach the route', async () => {
    const fetchMock = stub(() => ok(payload()));
    render(<ActivityTab />);
    await screen.findByTestId('activity-table');
    fireEvent.change(screen.getByLabelText('Area'), { target: { value: 'website' } });
    fireEvent.change(screen.getByLabelText('Outcome'), { target: { value: 'failed' } });
    fireEvent.change(screen.getByLabelText('Trigger'), { target: { value: 'scheduled' } });
    fireEvent.click(screen.getByRole('button', { name: 'Most expensive first' }));
    await waitFor(() => expect(lastActivityParams(fetchMock).get('sort')).toBe('cost'));
    const params = lastActivityParams(fetchMock);
    expect(params.get('area')).toBe('website');
    expect(params.get('outcome')).toBe('failed');
    expect(params.get('trigger')).toBe('scheduled');
  });

  it('typed dates and the minimum cost apply with Apply, and mark the window custom', async () => {
    const fetchMock = stub(() => ok(payload()));
    render(<ActivityTab />);
    await screen.findByTestId('activity-table');
    const before = activityCalls(fetchMock).length;
    fireEvent.change(screen.getByLabelText('From (UTC)'), { target: { value: '2026-09-20' } });
    fireEvent.change(screen.getByLabelText('To (UTC)'), { target: { value: '2026-09-30' } });
    fireEvent.change(screen.getByLabelText('Minimum cost (USD)'), { target: { value: '0.01' } });
    // Nothing is read while typing.
    expect(activityCalls(fetchMock)).toHaveLength(before);
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    await waitFor(() => expect(lastActivityParams(fetchMock).get('from')).toBe('2026-09-20'));
    expect(lastActivityParams(fetchMock).get('to')).toBe('2026-09-30');
    expect(lastActivityParams(fetchMock).get('minCostUsd')).toBe('0.01');
    expect(screen.getByRole('button', { name: 'This month' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('only the newest response may set the screen', async () => {
    const resolvers: ((v: Response) => void)[] = [];
    global.fetch = jest.fn(
      (input: RequestInfo | URL) =>
        new Promise<Response>((resolve) => {
          if (String(input).startsWith('/api/admin/business-os/ai-activity')) resolvers.push(resolve);
        })
    ) as unknown as typeof fetch;
    render(<ActivityTab />);
    fireEvent.click(screen.getByRole('button', { name: 'Yesterday' }));
    await waitFor(() => expect(resolvers).toHaveLength(2));
    const respond = (data: ActivityPayload) =>
      ({ ok: true, status: 200, json: async () => ({ success: true, data }) }) as Response;
    await act(async () => resolvers[1](respond(payload({ rows: [row({ companyName: 'Newest Co' })], total: 1 }))));
    await act(async () => resolvers[0](respond(payload({ rows: [row({ companyName: 'Stale Co' })], total: 1 }))));
    expect(await screen.findByText('Newest Co')).toBeInTheDocument();
    expect(screen.queryByText('Stale Co')).not.toBeInTheDocument();
  });
});

describe('the page: the Activity tab and the URL (SA-RC-13, SA-B1-8)', () => {
  function stubPage() {
    return stub((url) => {
      if (url.startsWith('/api/admin/business-os/ai-activity')) return ok(payload());
      if (url.startsWith('/api/admin/business-os/credits/report')) return { status: 500, body: { success: false, error: 'not under test' } };
      return { status: 200, body: { success: true, data: { areas: [], generatedAt: '2026-10-02T09:00:00.000Z' } } };
    });
  }

  it('has an Activity tab that controls its own panel and is not read until opened', async () => {
    const fetchMock = stubPage();
    render(<BusinessOsLlmSettingsPage />);
    const tab = screen.getByTestId('tab-activity');
    expect(tab).toHaveTextContent(ACTIVITY_TAB_LABEL);
    const panel = document.getElementById(tab.getAttribute('aria-controls') as string)!;
    expect(panel).toHaveAttribute('role', 'tabpanel');
    expect(panel).toHaveAttribute('aria-labelledby', tab.id);
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(activityCalls(fetchMock)).toHaveLength(0);
    expect(screen.queryByTestId('activity-tab')).not.toBeInTheDocument();
  });

  it('?tab=activity opens the Activity tab AND mounts its panel on first render', async () => {
    mockSearch = 'tab=activity';
    const fetchMock = stubPage();
    render(<BusinessOsLlmSettingsPage />);
    expect(screen.getByTestId('tab-activity')).toHaveAttribute('aria-selected', 'true');
    expect(await screen.findByTestId('activity-table')).toBeVisible();
    expect(activityCalls(fetchMock).length).toBeGreaterThan(0);
  });

  it('?tab=costs opens the Costs tab AND mounts its panel on first render', async () => {
    mockSearch = 'tab=costs';
    const fetchMock = stubPage();
    render(<BusinessOsLlmSettingsPage />);
    expect(screen.getByTestId('tab-costs')).toHaveAttribute('aria-selected', 'true');
    expect(await screen.findByTestId('costs-tab')).toBeVisible();
    await waitFor(() =>
      expect(fetchMock.mock.calls.some((c) => String(c[0]).startsWith('/api/admin/business-os/credits/report'))).toBe(true)
    );
    expect(screen.queryByTestId('activity-tab')).not.toBeInTheDocument();
  });

  it('an unknown tab means Settings, and an actionId (B3) is ignored by the page', async () => {
    mockSearch = 'tab=nonsense&actionId=aaaaaaaa-aaaa-4aaa-8aaa-000000000001';
    const fetchMock = stubPage();
    render(<BusinessOsLlmSettingsPage />);
    expect(screen.getByTestId('tab-settings')).toHaveAttribute('aria-selected', 'true');
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(activityCalls(fetchMock)).toHaveLength(0);
  });

  it('choosing a tab writes ?tab= with replaceState, keeping history.state and the other parameters', async () => {
    stubPage();
    window.history.replaceState({ marker: 'kept' }, '', '/admin/business-os-llm?keep=1');
    const spy = jest.spyOn(window.history, 'replaceState');
    render(<BusinessOsLlmSettingsPage />);
    fireEvent.click(screen.getByTestId('tab-activity'));
    expect(spy).toHaveBeenLastCalledWith({ marker: 'kept' }, '', expect.stringContaining('tab=activity'));
    const url = new URL(window.location.href);
    expect(url.searchParams.get('tab')).toBe('activity');
    expect(url.searchParams.get('keep')).toBe('1');
    expect(window.history.state).toEqual({ marker: 'kept' });
    await screen.findByTestId('activity-table');

    fireEvent.click(screen.getByTestId('tab-settings'));
    expect(new URL(window.location.href).searchParams.get('tab')).toBe('settings');
    // Kept mounted but hidden, like Costs.
    expect(screen.getByTestId('activity-tab')).not.toBeVisible();
    spy.mockRestore();
  });
});
