/**
 * @jest-environment jsdom
 */

/**
 * Slice 2c on the rendered page: the one-click "BOS AI failures" view, the
 * deep link from Businesses (`?action=…&user_id=…`), and the Business OS-only
 * Action Type list.
 */

import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

jest.mock('@/components/UserProvider', () => ({
  useAuth: () => ({ user: { id: 'admin-user', email: 'admin@example.com' } }),
}));

jest.mock('@/lib/logger', () => ({
  createLogger: () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    child: jest.fn().mockReturnThis(),
  }),
}));

let mockSearch = '';
jest.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(mockSearch),
}));

import AuditTrailPage from '../page';

const ACCOUNT = '99999999-9999-4999-8999-999999999999';

function mockRoute(response: { ok: boolean; body: unknown }): jest.Mock {
  const fetchMock = jest.fn(async () => ({ ok: response.ok, json: async () => response.body }));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- jsdom has no fetch; standard test stub
  (global as any).fetch = fetchMock;
  return fetchMock;
}

const EMPTY_PAGE = {
  ok: true,
  body: { success: true, logs: [], pagination: { page: 1, pageSize: 20, total: 0, totalPages: 0, showing: 0, hasMore: false } },
};

const fetchedUrls = (mock: jest.Mock): string[] => mock.mock.calls.map(([u]) => String(u));

function actionSelect(): HTMLSelectElement {
  return screen.getByText('All Actions').closest('select') as HTMLSelectElement;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockSearch = '';
});

describe('the BOS AI failures preset', () => {
  it('filters to BUSINESS_AI_ACTION_FAILED in one click', async () => {
    const fetchMock = mockRoute(EMPTY_PAGE);
    render(<AuditTrailPage />);
    fireEvent.click(await screen.findByTestId('preset-bos-ai-failures'));

    await waitFor(() =>
      expect(fetchedUrls(fetchMock).some((u) => u.includes('action=BUSINESS_AI_ACTION_FAILED'))).toBe(true)
    );
  });

  it('shows the error state when the route fails', async () => {
    mockRoute({ ok: false, body: { success: false, error: 'Failed to fetch audit logs' } });
    render(<AuditTrailPage />);
    await waitFor(() => expect(document.body.textContent).toContain('Failed to fetch audit logs'));
  });
});

describe('the deep link from Businesses', () => {
  it('asks for one account’s failures and shows the account chip', async () => {
    mockSearch = `action=BUSINESS_AI_ACTION_FAILED&user_id=${ACCOUNT}`;
    const fetchMock = mockRoute(EMPTY_PAGE);
    render(<AuditTrailPage />);

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const first = fetchedUrls(fetchMock)[0];
    expect(first).toContain('action=BUSINESS_AI_ACTION_FAILED');
    expect(first).toContain(`user_id=${ACCOUNT}`);
    expect((await screen.findByTestId('account-filter-chip')).textContent).toContain(ACCOUNT.slice(0, 8));
  });

  it('clearing the chip drops the account filter', async () => {
    mockSearch = `user_id=${ACCOUNT}`;
    const fetchMock = mockRoute(EMPTY_PAGE);
    render(<AuditTrailPage />);
    fireEvent.click(await screen.findByLabelText('Show every account'));

    await waitFor(() => {
      const last = fetchedUrls(fetchMock).at(-1) as string;
      expect(last).not.toContain('user_id=');
    });
  });

  it('renders a hidden AgentsPilot event named by the URL instead of a blank select', async () => {
    mockSearch = 'action=AGENT_CREATED';
    mockRoute(EMPTY_PAGE);
    render(<AuditTrailPage />);

    await waitFor(() => expect(actionSelect().value).toBe('AGENT_CREATED'));
    expect(actionSelect().textContent).toContain('(hidden from this list)');
  });
});

describe('the Action Type list', () => {
  it('offers Business OS and shared events, and no AgentsPilot-only event', async () => {
    mockRoute(EMPTY_PAGE);
    render(<AuditTrailPage />);
    await waitFor(() => expect(actionSelect()).toBeTruthy());

    const values = Array.from(actionSelect().querySelectorAll('option')).map((o) => o.value);
    expect(values).toContain('all');
    expect(values).toContain('BUSINESS_AI_ACTION_FAILED');
    expect(values).toContain('USER_LOGIN');
    expect(values).not.toContain('AGENT_CREATED');
    expect(values).not.toContain('PILOT_EXECUTION_FAILED');
  });
});
