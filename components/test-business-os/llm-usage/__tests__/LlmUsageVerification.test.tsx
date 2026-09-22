/**
 * @jest-environment jsdom
 *
 * LLM Usage tab — Layer 1.1 AC-17 (access, business selection, exception note),
 * AC-18 (Start now), AC-19 (statuses with text, platform ids, WC-9 warning),
 * AC-20 (truncation and incomplete warnings).
 */

import '@testing-library/jest-dom';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import type { BusinessListResponse, LlmUsageReport } from '@/lib/business-os/usage/llmUsageReportTypes';
import { LlmUsageVerification } from '../LlmUsageVerification';

const SESSION = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ACCOUNT = '2f734ed5-3681-4049-880d-3de7b096bea3';
const ZERO = '00000000-0000-0000-0000-000000000000';
const NOW = new Date('2026-09-17T12:00:00.000Z');

function listResponse(overrides: Partial<BusinessListResponse> = {}): BusinessListResponse {
  return {
    businesses: [
      { userId: ACCOUNT, companyName: 'Acme Coaching' },
      { userId: '99999999-9999-4999-8999-999999999999', companyName: null },
    ],
    limit: 50,
    platformAccountIds: [ZERO],
    platformAccountEnvIgnored: false,
    ...overrides,
  };
}

function makeReport(overrides: (r: LlmUsageReport) => void = () => undefined): LlmUsageReport {
  const row = {
    createdAt: '2026-09-17T11:59:00.000Z',
    feature: 'business-os-chat',
    areaKind: 'current' as const,
    area: 'chat',
    areaLabel: 'chat',
    component: 'planner',
    sessionId: '33333333-3333-4333-8333-333333333333',
    inputTokens: 10,
    outputTokens: 5,
    tokens: 15,
    estimatedCostUsd: 0.001,
    success: true,
    errorCode: null,
    flags: [],
    knownComponent: null,
  };
  const report: LlmUsageReport = {
    account: { userId: ACCOUNT, companyName: 'Acme Coaching', profileLookup: 'found' },
    window: { start: '2026-09-17T11:00:00.000Z', end: NOW.toISOString(), startClamped: false },
    platformAccountIdsChecked: [ZERO, '22222222-2222-4222-8222-222222222222'],
    platformAccountEnvIgnored: false,
    incomplete: false,
    trigger: 'manual',
    limits: { pageSize: 1000, readCeiling: 5000, displayRows: 500, displayGroups: 500, platformBreakdownRows: 500, helperTimestamps: 50 },
    checks: {
      calls: {
        status: 'pass',
        error: null,
        rowsRead: 1,
        incomplete: false,
        flaggedRows: 0,
        flagCounts: { legacy_feature: 0, unknown_area: 0, unknown_call_name: 0, missing_group_id: 0 },
        rows: [row],
        rowsTruncated: false,
        displayCap: 500,
      },
      platformAccount: { status: 'fail', error: null, count: 2, breakdown: [{ feature: 'business-os-website', component: 'full_site', calls: 2 }], breakdownRowsRead: 2, breakdownTruncated: false, breakdownCap: 500 },
      legacyLabels: {
        status: 'incomplete',
        error: null,
        legacyOnSelected: { count: 0, byFeature: [], incomplete: true },
        legacyOnPlatform: { count: 0 },
        helperLabelOnSelected: { count: 0 },
        helperLabelOnPlatform: { count: 3, timestamps: ['2026-09-17T11:10:00.000Z'], timestampsTruncated: false, timestampCap: 50 },
        helperLabel: { feature: 'onboarding', component: 'simple-complete' },
      },
      groups: {
        status: 'info',
        error: null,
        incomplete: false,
        groups: [],
        groupsTotal: 0,
        groupsTruncated: false,
        displayCap: 500,
        ungrouped: [],
        ungroupedTotal: 0,
        ungroupedFlagged: 0,
        ungroupedTruncated: false,
      },
      usageCard: { status: 'pass', error: null, summedBy: 'database', tokensPerCredit: 10, windowEnd: 'open', totals: { tokens: 15, calls: 1, credits: 2 }, categories: [{ key: 'chat', tokens: 15, calls: 1, credits: 2, shownOnCard: true }], otherFeatures: [] },
    },
    areaTotals: { status: 'complete', error: null, lines: [{ key: 'chat', kind: 'area', calls: 1, tokens: 15, estimatedCostUsd: 0.001 }], total: { calls: 1, tokens: 15, estimatedCostUsd: 0.001 } },
  };
  overrides(report);
  return report;
}

function json(status: number, body: unknown) {
  return Promise.resolve({ status, ok: status >= 200 && status < 300, json: () => Promise.resolve(body) });
}

const fetchMock = jest.fn();

beforeAll(() => {
  (globalThis as { fetch: unknown }).fetch = fetchMock;
  if (!globalThis.crypto?.randomUUID) {
    Object.defineProperty(globalThis, 'crypto', {
      configurable: true,
      value: { ...(globalThis.crypto ?? {}), randomUUID: () => '11111111-1111-4111-8111-111111111111' },
    });
  }
});

beforeEach(() => {
  jest.useFakeTimers({ now: NOW });
  fetchMock.mockReset();
});

afterEach(() => {
  jest.useRealTimers();
});

function routeFetch(handlers: { list?: () => Promise<unknown>; report?: (url: string) => Promise<unknown> }) {
  fetchMock.mockImplementation((url: string) => {
    if (url.startsWith('/api/admin/business-os/llm-usage/businesses')) {
      return handlers.list ? handlers.list() : json(200, { success: true, data: listResponse() });
    }
    if (url.startsWith('/api/admin/business-os/llm-usage?')) {
      return handlers.report ? handlers.report(url) : json(200, { success: true, data: makeReport() });
    }
    throw new Error(`unexpected fetch ${url}`);
  });
}

async function settle() {
  await act(async () => {
    jest.advanceTimersByTime(0);
  });
  for (let i = 0; i < 5; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

async function renderTab(props: Partial<React.ComponentProps<typeof LlmUsageVerification>> = {}) {
  const onLog = jest.fn();
  const onResponse = jest.fn();
  const utils = render(
    <LlmUsageVerification sessionUserId={SESSION} authLoading={false} onLog={onLog} onResponse={onResponse} {...props} />
  );
  await settle();
  return { ...utils, onLog, onResponse };
}

describe('LlmUsageVerification — access (AC-17)', () => {
  it('shows the sign-in message and makes no request when signed out', async () => {
    routeFetch({});
    await renderTab({ sessionUserId: null });
    expect(screen.getByText(/Not signed in/)).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('shows "Admins only" and no data for a non-admin', async () => {
    routeFetch({ list: () => json(403, { success: false, error: 'Forbidden' }) });
    await renderTab();
    expect(screen.getByTestId('llm-usage-admins-only')).toHaveTextContent('Admins only');
    expect(screen.queryByTestId('llm-usage-business-list')).not.toBeInTheDocument();
    expect(screen.queryByTestId('llm-usage-summary')).not.toBeInTheDocument();
  });
});

describe('LlmUsageVerification — admin', () => {
  it('states the read-other-business exception and starts with every check Not checked', async () => {
    routeFetch({});
    await renderTab();
    expect(screen.getByTestId('llm-usage-exception-note')).toHaveTextContent(/reads the usage ledger of the business you select/);
    for (const key of ['calls', 'platformAccount', 'legacyLabels', 'groups', 'usageCard', 'areaTotals']) {
      expect(screen.getByTestId(`llm-usage-status-${key}`)).toHaveTextContent('Not checked');
    }
  });

  it('lists businesses with a name or "(no name)" and a short id; search is debounced', async () => {
    routeFetch({});
    await renderTab();
    const list = screen.getByTestId('llm-usage-business-list');
    expect(within(list).getByText(/Acme Coaching/)).toBeInTheDocument();
    expect(within(list).getByText(/\(no name\)/)).toBeInTheDocument();
    expect(within(list).getByText('2f734ed5…')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Search businesses:'), { target: { value: 'acme' } });
    await act(async () => {
      jest.advanceTimersByTime(299);
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await settle();
    await act(async () => {
      jest.advanceTimersByTime(1);
    });
    expect(fetchMock).toHaveBeenLastCalledWith('/api/admin/business-os/llm-usage/businesses?search=acme', expect.any(Object));
  });

  it('selects by list, "My account" and a pasted id, and rejects a malformed paste', async () => {
    routeFetch({});
    await renderTab();

    fireEvent.click(within(screen.getByTestId('llm-usage-business-list')).getByText(/Acme Coaching/));
    expect(screen.getByTestId('llm-usage-summary')).toHaveTextContent(ACCOUNT);

    fireEvent.click(screen.getByText('My account'));
    expect(screen.getByTestId('llm-usage-summary')).toHaveTextContent(SESSION);

    fireEvent.change(screen.getByLabelText('Or paste an account id:'), { target: { value: 'not-an-id' } });
    fireEvent.click(screen.getByText('Use this id'));
    expect(screen.getByText('Paste a full account id (UUID).')).toBeInTheDocument();

    const pasted = '77777777-7777-4777-8777-777777777777';
    fireEvent.change(screen.getByLabelText('Or paste an account id:'), { target: { value: pasted.toUpperCase() } });
    fireEvent.click(screen.getByText('Use this id'));
    expect(screen.getByTestId('llm-usage-summary')).toHaveTextContent(pasted);
  });

  it('warns when "My account" is a platform account and does not allow a refresh', async () => {
    routeFetch({ list: () => json(200, { success: true, data: listResponse({ platformAccountIds: [ZERO, SESSION] }) }) });
    await renderTab();
    expect(screen.getAllByText(/Your account is a platform account/)[0]).toBeInTheDocument();
    fireEvent.click(screen.getByText('My account'));
    expect(screen.getByText(/This is the platform account; its Business OS rows are shown in Check 2/)).toBeInTheDocument();
    expect(screen.getByText('Refresh')).toBeDisabled();
  });

  it('"Start now" sets the start time to the current moment', async () => {
    routeFetch({});
    await renderTab();
    fireEvent.click(within(screen.getByTestId('llm-usage-business-list')).getByText(/Acme Coaching/));
    fireEvent.click(screen.getByText('Start now'));
    fireEvent.click(screen.getByText('Refresh'));
    await settle();
    const reportCall = fetchMock.mock.calls.find(([url]) => String(url).startsWith('/api/admin/business-os/llm-usage?'));
    const params = new URL(`http://x${reportCall?.[0]}`).searchParams;
    expect(params.get('since')).toBe(NOW.toISOString());
    expect(params.get('trigger')).toBe('manual');
    expect(params.get('accountId')).toBe(ACCOUNT);
  });

  it('shows every status as text, the platform ids checked, and logs the manual refresh (AC-19)', async () => {
    routeFetch({});
    const { onLog, onResponse } = await renderTab();
    fireEvent.click(within(screen.getByTestId('llm-usage-business-list')).getByText(/Acme Coaching/));
    fireEvent.click(screen.getByText('Refresh'));
    await settle();

    expect(screen.getByTestId('llm-usage-status-calls')).toHaveTextContent('Pass');
    expect(screen.getByTestId('llm-usage-status-platformAccount')).toHaveTextContent('Fail');
    expect(screen.getByTestId('llm-usage-status-legacyLabels')).toHaveTextContent('Incomplete');
    expect(screen.getByTestId('llm-usage-status-groups')).toHaveTextContent('Info');
    expect(screen.getByTestId('llm-usage-summary')).toHaveTextContent('22222222-2222-4222-8222-222222222222');
    expect(screen.getByTestId('llm-usage-summary')).toHaveTextContent('Acme Coaching');
    expect(screen.getByTestId('llm-usage-card-caveat')).toHaveTextContent(/open end/);
    expect(screen.getByTestId('llm-usage-card-caveat')).toHaveTextContent(/match it only when the windows match/);
    expect(onLog.mock.calls.map((c) => c[0])).toEqual(['info', 'success']);
    expect(onResponse).toHaveBeenCalledTimes(1);
  });

  it('shows a truncation warning on each capped list and the incomplete message (AC-20)', async () => {
    const report = makeReport((r) => {
      r.incomplete = true;
      r.checks.calls.rowsTruncated = true;
      r.checks.calls.rowsRead = 5000;
      r.checks.calls.incomplete = true;
      r.checks.calls.status = 'incomplete';
      r.checks.groups.groupsTruncated = true;
      r.checks.groups.groupsTotal = 900;
      r.checks.groups.groups = [
        { sessionId: '33333333-3333-4333-8333-333333333333', areaLabel: 'chat', callCount: 2, calls: [{ component: 'planner', count: 2 }], callSummary: 'planner ×2', tokens: 30, estimatedCostUsd: 0.002, firstAt: '2026-09-17T11:00:00.000Z', lastAt: '2026-09-17T11:01:00.000Z' },
      ];
      r.checks.platformAccount.breakdownTruncated = true;
      r.checks.legacyLabels.helperLabelOnPlatform = { count: 80, timestamps: ['2026-09-17T11:10:00.000Z'], timestampsTruncated: true, timestampCap: 50 };
      r.areaTotals.status = 'incomplete';
    });
    routeFetch({ report: () => json(200, { success: true, data: report }) });
    await renderTab();
    fireEvent.click(within(screen.getByTestId('llm-usage-business-list')).getByText(/Acme Coaching/));
    fireEvent.click(screen.getByText('Refresh'));
    await settle();

    expect(screen.getByTestId('llm-usage-truncated-calls')).toHaveTextContent('Showing the newest 500 of 5,000 calls.');
    expect(screen.getByTestId('llm-usage-truncated-groups')).toBeInTheDocument();
    expect(screen.getByTestId('llm-usage-truncated-platform')).toBeInTheDocument();
    expect(screen.getByTestId('llm-usage-truncated-timestamps')).toBeInTheDocument();
    expect(screen.getAllByText(/more than 5,000 Business OS calls in this window; narrow the start time/).length).toBeGreaterThanOrEqual(4);
    expect(screen.getByTestId('llm-usage-status-calls')).toHaveTextContent('Incomplete');
    expect(screen.getByTestId('llm-usage-status-areaTotals')).toHaveTextContent('Incomplete');
  });

  it('warns when SYSTEM_ADMIN_USER_ID was ignored (WC-9)', async () => {
    const report = makeReport((r) => {
      r.platformAccountEnvIgnored = true;
    });
    routeFetch({ report: () => json(200, { success: true, data: report }) });
    await renderTab();
    fireEvent.click(within(screen.getByTestId('llm-usage-business-list')).getByText(/Acme Coaching/));
    fireEvent.click(screen.getByText('Refresh'));
    await settle();
    expect(screen.getByText('SYSTEM_ADMIN_USER_ID is set but is not a UUID; only the all-zero id was checked')).toBeInTheDocument();
  });

  it('shows the server message for a failed refresh and logs it', async () => {
    routeFetch({ report: () => json(400, { success: false, error: 'Start time is in the future' }) });
    const { onLog } = await renderTab();
    fireEvent.click(within(screen.getByTestId('llm-usage-business-list')).getByText(/Acme Coaching/));
    fireEvent.click(screen.getByText('Refresh'));
    await settle();
    expect(screen.getByTestId('llm-usage-error')).toHaveTextContent('Start time is in the future');
    expect(onLog).toHaveBeenCalledWith('error', expect.stringContaining('Start time is in the future'));
  });
});
