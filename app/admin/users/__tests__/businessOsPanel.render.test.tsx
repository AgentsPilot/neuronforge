/**
 * @jest-environment jsdom
 */

/**
 * The Businesses screen (admin reorganisation slice 2b): each row shows the
 * business name AND the user name, and the Business OS panel shows the plan
 * exactly as the entitlements API returns it, USD AI spend, and recent AI
 * failures linked to the audit trail.
 */

import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';

jest.mock('@/lib/logger', () => ({
  createLogger: () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    child: jest.fn().mockReturnThis(),
  }),
}));

import UsersPage from '../page';
import { BusinessOsPanel } from '../components/BusinessOsPanel';
import recordedAccountBody from '@/app/admin/business-os-tiers/__tests__/__fixtures__/recordedAccountBody.json';

const ACCOUNT = '99999999-9999-4999-8999-999999999999';
const NO_BUSINESS = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

const SUMMARY = {
  success: true,
  data: {
    accountId: ACCOUNT,
    business: { status: 'ok', companyName: 'Acme Therapy', vertical: 'therapist', subVertical: 'family_therapist' },
    aiSpend30d: {
      status: 'complete',
      currency: 'USD',
      window: { start: '2026-08-26T00:00:00.000Z', end: '2026-09-25T00:00:00.000Z' },
      total: { calls: 12, tokens: 3400, estimatedCostUsd: 0.1234 },
      lines: [{ key: 'insights', kind: 'area', calls: 12, tokens: 3400, estimatedCostUsd: 0.1234 }],
    },
    recentAiFailures: {
      status: 'ok',
      window: { start: '2026-08-26T00:00:00.000Z', end: '2026-09-25T00:00:00.000Z' },
      limit: 10,
      items: [
        {
          id: 'f1',
          createdAt: '2026-09-22T10:00:00.000Z',
          groupId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
          area: 'insights',
          actionType: 'insight_detection',
          trigger: 'cron',
          errorCode: 'provider_timeout',
          callCount: 3,
          failedCallCount: 1,
        },
      ],
    },
  },
};

type Routes = Record<string, { status: number; body: unknown }>;

function mockFetch(routes: Routes): jest.Mock {
  const fetchMock = jest.fn(async (url: string) => {
    const key = Object.keys(routes).find((k) => String(url).includes(k));
    const hit = key ? routes[key] : { status: 404, body: { success: false, error: 'not mocked' } };
    return { ok: hit.status < 400, status: hit.status, json: async () => hit.body };
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- jsdom has no fetch; standard test stub
  (global as any).fetch = fetchMock;
  return fetchMock;
}

beforeEach(() => jest.clearAllMocks());

describe('BusinessOsPanel', () => {
  it('shows business and user name, the plan with its deciding layer, USD spend and linked failures', async () => {
    mockFetch({
      [`/entitlements/accounts/${ACCOUNT}`]: { status: 200, body: recordedAccountBody },
      [`/accounts/${ACCOUNT}/summary`]: { status: 200, body: SUMMARY },
    });
    render(<BusinessOsPanel accountId={ACCOUNT} userName="Dana Cohen" />);

    await waitFor(() => expect(screen.getByTestId('bos-panel-business').textContent).toBe('Acme Therapy'));
    expect(screen.getByTestId('bos-panel-user').textContent).toBe('Dana Cohen');
    expect(screen.getByTestId('bos-panel-vertical').textContent).toContain('therapist');

    // The plan: the Plans & entitlements rendering, including "Decided by".
    const plan = screen.getByTestId('account-result');
    expect(within(plan).getByText('Decided by')).toBeTruthy();

    const spend = screen.getByTestId('bos-panel-spend');
    expect(spend.textContent).toContain('USD');
    expect(spend.textContent).toContain('$0.1234');

    const failures = screen.getByTestId('bos-panel-failures');
    expect(failures.textContent).toContain('provider_timeout');
    const links = within(failures).getAllByRole('link').map((a) => a.getAttribute('href'));
    expect(links).toContain(
      `/admin/audit-trail?action=BUSINESS_AI_ACTION_FAILED&user_id=${ACCOUNT}&search=cccccccc-cccc-4ccc-8ccc-cccccccccccc`
    );
    expect(screen.getByTestId('bos-panel-failures-link').getAttribute('href')).toBe(
      `/admin/audit-trail?action=BUSINESS_AI_ACTION_FAILED&user_id=${ACCOUNT}`
    );
  });

  it('says "Not a Business OS account" for an AgentsPilot-only login, and shows no spend', async () => {
    mockFetch({
      [`/entitlements/accounts/${NO_BUSINESS}`]: { status: 404, body: { success: false, error: 'not_a_business_os_account' } },
      [`/accounts/${NO_BUSINESS}/summary`]: { status: 404, body: { success: false, error: 'not_a_business_os_account' } },
    });
    render(<BusinessOsPanel accountId={NO_BUSINESS} userName="Agent Only" />);

    expect((await screen.findByTestId('bos-panel-not-bos')).textContent).toContain('Not a Business OS account');
    expect(screen.getByTestId('bos-panel-user').textContent).toBe('Agent Only');
    expect(screen.queryByTestId('bos-panel-spend')).toBeNull();
  });

  it('still shows the plan when the summary fails', async () => {
    mockFetch({
      [`/entitlements/accounts/${ACCOUNT}`]: { status: 200, body: recordedAccountBody },
      [`/accounts/${ACCOUNT}/summary`]: { status: 500, body: { success: false, error: 'Internal server error' } },
    });
    render(<BusinessOsPanel accountId={ACCOUNT} userName="Dana Cohen" />);

    expect((await screen.findByTestId('bos-panel-summary-error')).textContent).toContain('failed on the server');
    expect(screen.getByTestId('account-result')).toBeTruthy();
  });

  it('marks an incomplete 30-day total as a lower bound', async () => {
    const incomplete = { ...SUMMARY, data: { ...SUMMARY.data, aiSpend30d: { ...SUMMARY.data.aiSpend30d, status: 'incomplete' } } };
    mockFetch({
      [`/entitlements/accounts/${ACCOUNT}`]: { status: 200, body: recordedAccountBody },
      [`/accounts/${ACCOUNT}/summary`]: { status: 200, body: incomplete },
    });
    render(<BusinessOsPanel accountId={ACCOUNT} userName="Dana Cohen" />);
    expect((await screen.findByTestId('bos-panel-spend-incomplete')).textContent).toContain('lower bound');
  });
});

describe('the Businesses list', () => {
  function listBody() {
    return {
      success: true,
      data: [
        {
          id: ACCOUNT, full_name: 'Dana Cohen', company: null, email: 'dana@example.com', email_confirmed: true,
          last_sign_in_at: null, created_at: '2026-09-01T00:00:00Z', providers: [], role: 'authenticated',
          business: { companyName: 'Acme Therapy', vertical: 'therapist' },
        },
        {
          id: NO_BUSINESS, full_name: 'Agent Only', company: null, email: 'agent@example.com', email_confirmed: true,
          last_sign_in_at: null, created_at: '2026-08-01T00:00:00Z', providers: [], role: 'authenticated',
          business: null,
        },
      ],
      stats: { totalUsers: 2, activeUsers: 0, newUsersToday: 0 },
    };
  }

  it('shows the business name and the user name on each row, and "No Business OS business" where there is none', async () => {
    mockFetch({ '/api/admin/users?': { status: 200, body: listBody() } });
    render(<UsersPage />);

    await waitFor(() => expect(screen.getAllByTestId('row-business')).toHaveLength(2));
    const businesses = screen.getAllByTestId('row-business').map((e) => e.textContent);
    const users = screen.getAllByTestId('row-user').map((e) => e.textContent);
    expect(businesses).toEqual(['Acme Therapy', 'No Business OS business']);
    expect(users).toEqual(['Dana Cohen', 'Agent Only']);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Businesses');
  });

  it('opens a row on the Business OS panel, with agent facts folded away', async () => {
    mockFetch({
      '/api/admin/users?': { status: 200, body: listBody() },
      [`/entitlements/accounts/${ACCOUNT}`]: { status: 200, body: recordedAccountBody },
      [`/accounts/${ACCOUNT}/summary`]: { status: 200, body: SUMMARY },
      [`/api/admin/users/${ACCOUNT}/stats`]: {
        status: 200,
        body: {
          success: true,
          data: {
            agents: { total: 1, active: 1, inactive: 0, draft: 0, scheduled: 0, list: [] },
            executions: { total_30d: 4, successful: 4, failed: 0, total_duration_ms: 0, total_tokens: 0, total_cost_usd: 0, success_rate: 100 },
            tokens: { total_input_tokens: 0, total_output_tokens: 0, total_cost_usd: 0, total_calls: 0, by_model: [] },
            subscription: null,
            plugins: { total: 0, active: 0, list: [] },
          },
        },
      },
    });
    render(<UsersPage />);

    fireEvent.click((await screen.findAllByTestId('row-business'))[0]);

    expect(await screen.findByTestId('bos-panel')).toBeTruthy();
    const folded = await screen.findByTestId('agentspilot-details');
    expect(folded.tagName).toBe('DETAILS');
    expect(folded.hasAttribute('open')).toBe(false);
    expect(document.body.textContent).toContain('may be incomplete above 1,000 calls');
  });

  it('shows the error state when the list fails', async () => {
    mockFetch({ '/api/admin/users?': { status: 500, body: { success: false, error: 'Failed to fetch users' } } });
    render(<UsersPage />);
    await waitFor(() => expect(document.body.textContent).toContain('Failed to fetch users'));
  });
});
