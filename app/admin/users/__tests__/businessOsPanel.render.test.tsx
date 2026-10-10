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
      readCeiling: 5000,
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

/** `GET /api/admin/business-os/credits/accounts/[accountId]` (credit deduction slice 11c). */
const CREDITS = {
  success: true,
  data: {
    accountId: ACCOUNT,
    isOwnAccount: false,
    limits: { grantCeiling: 100000, reasonMin: 3, reasonMax: 500 },
    usage: {
      status: 'ok',
      period: { kind: 'monthly', key: '2026-09-14T09:31:07.123456+00:00', resetsOn: '2026-10-14T09:31:07.123Z' },
      allowanceStatus: 'ok',
      allowance: { amount: 5000, per: 'month' },
      allowanceLayer: 'basis',
      used: 12,
      usedByOwner: 10,
      usedAutomatic: 2,
      planLeft: 4988,
      overPlan: 0,
    },
    extra: { status: 'ok', extraCredits: 0, hasInconsistentLot: false, lots: [] },
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
      [`/credits/accounts/${ACCOUNT}`]: { status: 200, body: CREDITS },
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

  it('still shows the plan when the summary fails, under a neutral header (N-4)', async () => {
    mockFetch({
      [`/entitlements/accounts/${ACCOUNT}`]: { status: 200, body: recordedAccountBody },
      [`/accounts/${ACCOUNT}/summary`]: { status: 500, body: { success: false, error: 'Internal server error' } },
    });
    render(<BusinessOsPanel accountId={ACCOUNT} userName="Dana Cohen" />);

    expect((await screen.findByTestId('bos-panel-summary-error')).textContent).toContain('failed on the server');
    expect(screen.getByTestId('account-result')).toBeTruthy();
    expect(screen.getByTestId('bos-panel-business').textContent).toBe('Business OS');
    expect(screen.getByTestId('bos-panel-user').textContent).toBe('Dana Cohen');
  });

  it('orders the panel header, Credits, Plan & entitlements (collapsed), AI spend, AI failures (user UI fixes, 2026-10-04)', async () => {
    mockFetch({
      [`/entitlements/accounts/${ACCOUNT}`]: { status: 200, body: recordedAccountBody },
      [`/accounts/${ACCOUNT}/summary`]: { status: 200, body: SUMMARY },
      [`/credits/accounts/${ACCOUNT}`]: { status: 200, body: CREDITS },
    });
    render(<BusinessOsPanel accountId={ACCOUNT} userName="Dana Cohen" />);

    const credits = await screen.findByTestId('credits-block');
    const fold = screen.getByTestId('bos-panel-plan') as HTMLDetailsElement;
    const order = [
      screen.getByTestId('bos-panel-business'),
      credits,
      fold,
      screen.getByTestId('bos-panel-spend'),
      screen.getByTestId('bos-panel-failures'),
    ];
    for (let i = 1; i < order.length; i++) {
      expect(order[i - 1].compareDocumentPosition(order[i]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }

    // Collapsed by default; the snapshot (with its 30-second note) lives inside the fold.
    expect(fold.tagName).toBe('DETAILS');
    expect(fold.open).toBe(false);
    const plan = within(fold).getByTestId('account-result');
    expect(plan.textContent).toContain('This answer is good for');
    // The one-line summary names the tier the entitlements read already returned.
    const summary = screen.getByTestId('bos-panel-plan-summary');
    expect(summary.textContent).toContain('Plan & entitlements · basic');
    expect(summary.textContent).toContain('Show all capabilities');
  });

  it('a plan read failure is shown openly, never folded away', async () => {
    mockFetch({
      [`/entitlements/accounts/${ACCOUNT}`]: { status: 500, body: { success: false, error: 'Internal server error' } },
      [`/accounts/${ACCOUNT}/summary`]: { status: 200, body: SUMMARY },
      [`/credits/accounts/${ACCOUNT}`]: { status: 200, body: CREDITS },
    });
    render(<BusinessOsPanel accountId={ACCOUNT} userName="Dana Cohen" />);
    expect((await screen.findByTestId('bos-panel-plan-error')).textContent).toContain('failed on the server');
    expect(screen.queryByTestId('bos-panel-plan')).toBeNull();
  });

  it('renders the Credits block above Plan & entitlements, and passes it the business name (credit deduction slice 11c)', async () => {
    const fetchMock = mockFetch({
      [`/entitlements/accounts/${ACCOUNT}`]: { status: 200, body: recordedAccountBody },
      [`/accounts/${ACCOUNT}/summary`]: { status: 200, body: SUMMARY },
      [`/credits/accounts/${ACCOUNT}`]: { status: 200, body: CREDITS },
    });
    render(<BusinessOsPanel accountId={ACCOUNT} userName="Dana Cohen" />);

    const credits = await screen.findByTestId('credits-block');
    await waitFor(() => expect(within(credits).getByTestId('credits-extra-figure').textContent).toBe('0'));
    expect(within(credits).getByTestId('credits-no-lots')).toBeTruthy();
    // Above the plan: the Credits block comes first in the document.
    const plan = screen.getByTestId('account-result');
    expect(credits.compareDocumentPosition(plan) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith(`/api/admin/business-os/credits/accounts/${ACCOUNT}`))).toBe(true);

    // The Give form's confirm step names the business, not "Business OS".
    // jsdom has no crypto.randomUUID: stubbed, as W11c-8 asks.
    Object.defineProperty(globalThis, 'crypto', {
      configurable: true,
      value: { randomUUID: () => '00000000-0000-4000-8000-000000000001' },
    });
    fireEvent.click(within(credits).getByTestId('credits-give'));
    expect((await screen.findByTestId('credit-form-dialog')).textContent).toContain('Give credits to Acme Therapy');
  });

  it('renders the Credit top-ups block right after Credits, from its own route (credits boost slice 6a)', async () => {
    const BOOST = {
      success: true,
      data: {
        accountId: ACCOUNT,
        isOwnAccount: false,
        serverMode: 'test',
        purchases: { status: 'ok', rows: [], truncated: { test: false, live: false } },
        cap: { status: 'ok', default: { amountMinor: 15000, currency: 'USD', windowDays: 30 }, active: null, history: [] },
      },
    };
    const fetchMock = mockFetch({
      // The longer key first: the stub takes the first key the URL contains.
      [`/credits/accounts/${ACCOUNT}/boost`]: { status: 200, body: BOOST },
      [`/entitlements/accounts/${ACCOUNT}`]: { status: 200, body: recordedAccountBody },
      [`/accounts/${ACCOUNT}/summary`]: { status: 200, body: SUMMARY },
      [`/credits/accounts/${ACCOUNT}`]: { status: 200, body: CREDITS },
    });
    render(<BusinessOsPanel accountId={ACCOUNT} userName="Dana Cohen" />);

    const boost = await screen.findByTestId('boost-block');
    await within(boost).findByTestId('boost-no-purchases');
    const credits = screen.getByTestId('credits-block');
    expect(credits.compareDocumentPosition(boost) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith(`/api/admin/business-os/credits/accounts/${ACCOUNT}/boost`))).toBe(true);
  });

  it('shows no Credits block for a login with no business', async () => {
    mockFetch({
      [`/entitlements/accounts/${NO_BUSINESS}`]: { status: 404, body: { success: false, error: 'not_a_business_os_account' } },
      [`/accounts/${NO_BUSINESS}/summary`]: { status: 404, body: { success: false, error: 'not_a_business_os_account' } },
    });
    render(<BusinessOsPanel accountId={NO_BUSINESS} userName="Agent Only" />);
    await screen.findByTestId('bos-panel-not-bos');
    expect(screen.queryByTestId('credits-block')).toBeNull();
  });

  it('marks an incomplete 30-day total as a lower bound, quoting the ceiling from the payload (N-6)', async () => {
    const incomplete = {
      ...SUMMARY,
      data: { ...SUMMARY.data, aiSpend30d: { ...SUMMARY.data.aiSpend30d, status: 'incomplete', readCeiling: 1234 } },
    };
    mockFetch({
      [`/entitlements/accounts/${ACCOUNT}`]: { status: 200, body: recordedAccountBody },
      [`/accounts/${ACCOUNT}/summary`]: { status: 200, body: incomplete },
    });
    render(<BusinessOsPanel accountId={ACCOUNT} userName="Dana Cohen" />);
    const note = (await screen.findByTestId('bos-panel-spend-incomplete')).textContent;
    expect(note).toContain('lower bound');
    expect(note).toContain('1,234');
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

  // `GET /api/admin/users/[id]/stats` after ADMIN_BOS_CLEANUP slice 5a: only
  // `tokens` and `plugins`, each `null` when its read failed.
  const TOKENS = {
    total_input_tokens: 1200,
    total_output_tokens: 300,
    total_cost_usd: 0.4321,
    total_calls: 7,
    by_model: [{ model: 'openai/gpt-x', input: 1200, output: 300, cost: 0.4321, calls: 7 }],
  };
  const PLUGINS = {
    total: 2,
    active: 1,
    list: [
      { plugin: 'google-mail', connected_at: '2026-09-01T00:00:00Z', is_active: true },
      { plugin: 'slack', connected_at: '2026-09-02T00:00:00Z', is_active: false },
    ],
  };

  /** Open the first row with the stats route answering `stats`. */
  async function openRowWithStats(stats: { status: number; body: unknown }) {
    mockFetch({
      '/api/admin/users?': { status: 200, body: listBody() },
      [`/entitlements/accounts/${ACCOUNT}`]: { status: 200, body: recordedAccountBody },
      [`/accounts/${ACCOUNT}/summary`]: { status: 200, body: SUMMARY },
      [`/api/admin/users/${ACCOUNT}/stats`]: stats,
    });
    render(<UsersPage />);
    fireEvent.click((await screen.findAllByTestId('row-business'))[0]);
    expect(await screen.findByTestId('bos-panel')).toBeTruthy();
  }

  it('P-1: opens a row on the Business OS panel, with no AgentsPilot fold and no Subscription card', async () => {
    await openRowWithStats({ status: 200, body: { success: true, data: { tokens: TOKENS, plugins: PLUGINS } } });

    const spend = await screen.findByTestId('ai-spend-card');
    expect(spend.textContent).toContain('may be incomplete above 1,000 calls');
    expect(spend.textContent).toContain('$0.4321');
    const plugins = screen.getByTestId('plugins-card');
    expect(plugins.textContent).toContain('1/2 active');
    expect(plugins.textContent).toContain('Google Mail');

    expect(screen.queryByTestId('agentspilot-details')).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Subscription' })).toBeNull();
    expect(document.body.textContent).not.toContain('AgentsPilot details');
  });

  it('P-2: a tokens section that could not be read says so, and shows no zero spend', async () => {
    await openRowWithStats({ status: 200, body: { success: true, data: { tokens: null, plugins: PLUGINS } } });

    const spend = await screen.findByTestId('ai-spend-card');
    expect(spend.textContent).toContain('could not be read');
    expect(spend.textContent).not.toContain('$0.0000');
    expect(spend.textContent).not.toContain('LLM Calls');
    expect(screen.getByTestId('plugins-card').textContent).toContain('Google Mail');
  });

  it('P-3: a plugins section that could not be read says so, and shows no 0/0 active', async () => {
    await openRowWithStats({ status: 200, body: { success: true, data: { tokens: TOKENS, plugins: null } } });

    const plugins = await screen.findByTestId('plugins-card');
    expect(plugins.textContent).toContain('could not be read');
    expect(plugins.textContent).not.toContain('active');
    expect(plugins.textContent).not.toContain('No plugins connected');
    expect(screen.getByTestId('ai-spend-card').textContent).toContain('$0.4321');
  });

  it('P-4: says under the heading that the list is every login; heading and count pill unchanged', async () => {
    mockFetch({ '/api/admin/users?': { status: 200, body: listBody() } });
    render(<UsersPage />);

    expect((await screen.findByTestId('list-scope-note')).textContent).toContain('Every login on the platform');
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Businesses');
    expect(screen.getByTestId('count-pill').textContent).toContain('2');
  });

  it('P-5: the row detail shows no Role field (SA-5a-1)', async () => {
    await openRowWithStats({ status: 200, body: { success: true, data: { tokens: TOKENS, plugins: PLUGINS } } });

    await screen.findByTestId('ai-spend-card');
    expect(screen.getByText('User ID:')).toBeTruthy();
    expect(screen.queryByText('Role:')).toBeNull();
    expect(document.body.textContent).not.toContain('authenticated');
  });

  it('P-6: a failed stats request shows "could not be read" on both cards, never zeros (SA-5a-2)', async () => {
    await openRowWithStats({ status: 500, body: { success: false, error: 'Failed to fetch user statistics' } });

    const spend = await screen.findByTestId('ai-spend-card');
    const plugins = screen.getByTestId('plugins-card');
    expect(spend.textContent).toContain('could not be read');
    expect(plugins.textContent).toContain('could not be read');
    for (const card of [spend, plugins]) {
      expect(card.textContent).not.toContain('$0.0000');
      expect(card.textContent).not.toContain('0/0');
    }
  });

  it('P-6b: a 200 with success false is treated as a failed request (SA-5a-2)', async () => {
    await openRowWithStats({ status: 200, body: { success: false, error: 'nope' } });

    expect((await screen.findByTestId('ai-spend-card')).textContent).toContain('could not be read');
    expect(screen.getByTestId('plugins-card').textContent).toContain('could not be read');
  });

  it('P-6c: a rejected stats fetch (network error) shows "could not be read", never vanishing cards (QA E-1)', async () => {
    const routed = mockFetch({
      '/api/admin/users?': { status: 200, body: listBody() },
      [`/entitlements/accounts/${ACCOUNT}`]: { status: 200, body: recordedAccountBody },
      [`/accounts/${ACCOUNT}/summary`]: { status: 200, body: SUMMARY },
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- jsdom has no fetch; standard test stub
    (global as any).fetch = jest.fn(async (url: string) => {
      if (String(url).includes(`/api/admin/users/${ACCOUNT}/stats`)) throw new TypeError('Failed to fetch');
      return routed(url);
    });
    render(<UsersPage />);
    fireEvent.click((await screen.findAllByTestId('row-business'))[0]);

    const spend = await screen.findByTestId('ai-spend-card');
    const plugins = screen.getByTestId('plugins-card');
    expect(spend.textContent).toContain('could not be read');
    expect(plugins.textContent).toContain('could not be read');
    for (const card of [spend, plugins]) {
      expect(card.textContent).not.toContain('$0.0000');
      expect(card.textContent).not.toContain('0/0');
    }
  });

  it('QA-P7: a login with no business, no usage and no plugins shows genuine zeros, not "could not be read"', async () => {
    mockFetch({
      '/api/admin/users?': { status: 200, body: listBody() },
      [`/entitlements/accounts/${NO_BUSINESS}`]: { status: 404, body: { success: false, error: 'not_a_business_os_account' } },
      [`/accounts/${NO_BUSINESS}/summary`]: { status: 404, body: { success: false, error: 'not_a_business_os_account' } },
      [`/api/admin/users/${NO_BUSINESS}/stats`]: {
        status: 200,
        body: {
          success: true,
          data: {
            tokens: { total_input_tokens: 0, total_output_tokens: 0, total_cost_usd: 0, total_calls: 0, by_model: [] },
            plugins: { total: 0, active: 0, list: [] },
          },
        },
      },
    });
    render(<UsersPage />);
    fireEvent.click((await screen.findAllByTestId('row-business'))[1]);

    expect((await screen.findByTestId('bos-panel-not-bos')).textContent).toContain('Not a Business OS account');
    const spend = await screen.findByTestId('ai-spend-card');
    const plugins = screen.getByTestId('plugins-card');
    expect(spend.textContent).toContain('$0.0000');
    expect(plugins.textContent).toContain('0/0 active');
    expect(plugins.textContent).toContain('No plugins connected');
    expect(spend.textContent).not.toContain('could not be read');
    expect(plugins.textContent).not.toContain('could not be read');
  });

  it('QA-P8: reopening a row after a failed stats read fetches it again (O-3); after success it does not', async () => {
    const okDetails = {
      [`/users/${ACCOUNT}/login-stats`]: { status: 200, body: { success: true, data: { total_logins: 1, failed_logins: 0, unique_ips: 1 } } },
      [`/users/${ACCOUNT}/audit-logs`]: { status: 200, body: { success: true, data: [] } },
      [`/entitlements/accounts/${ACCOUNT}`]: { status: 200, body: recordedAccountBody },
      [`/accounts/${ACCOUNT}/summary`]: { status: 200, body: SUMMARY },
      '/api/admin/users?': { status: 200, body: listBody() },
    };
    const statsCalls = (m: jest.Mock) =>
      m.mock.calls.filter(([u]) => String(u).endsWith(`/api/admin/users/${ACCOUNT}/stats`)).length;

    const failing = mockFetch({ ...okDetails, [`/api/admin/users/${ACCOUNT}/stats`]: { status: 500, body: { success: false } } });
    render(<UsersPage />);
    const row = (await screen.findAllByTestId('row-business'))[0];
    fireEvent.click(row);
    expect((await screen.findByTestId('ai-spend-card')).textContent).toContain('could not be read');
    expect(statsCalls(failing)).toBe(1);

    fireEvent.click(row); // close
    const healthy = mockFetch({
      ...okDetails,
      [`/api/admin/users/${ACCOUNT}/stats`]: { status: 200, body: { success: true, data: { tokens: TOKENS, plugins: PLUGINS } } },
    });
    fireEvent.click(row); // reopen: the failed section is not cached
    await waitFor(() => expect(screen.getByTestId('ai-spend-card').textContent).toContain('$0.4321'));
    expect(screen.getByTestId('plugins-card').textContent).toContain('1/2 active');
    expect(statsCalls(healthy)).toBe(1);

    fireEvent.click(row); // close
    fireEvent.click(row); // reopen: now loaded, served from state
    expect((await screen.findByTestId('ai-spend-card')).textContent).toContain('$0.4321');
    expect(statsCalls(healthy)).toBe(1);
  });

  it('says when the business-name search was capped (E-4)', async () => {
    const body = { ...listBody(), search: { businessSearch: 'ok', businessMatchesCapped: true, businessMatchLimit: 50 } };
    mockFetch({ '/api/admin/users?': { status: 200, body } });
    render(<UsersPage />);
    expect((await screen.findByTestId('business-search-capped')).textContent).toContain('Refine the search');
  });

  it('shows the error state when the list fails', async () => {
    mockFetch({ '/api/admin/users?': { status: 500, body: { success: false, error: 'Failed to fetch users' } } });
    render(<UsersPage />);
    await waitFor(() => expect(document.body.textContent).toContain('Failed to fetch users'));
  });
});
