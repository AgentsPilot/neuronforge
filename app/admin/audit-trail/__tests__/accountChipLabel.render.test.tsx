/**
 * @jest-environment jsdom
 */

/**
 * The active account chip must name the account, not print a truncated GUID.
 *
 * `Account {filters.userId.slice(0, 8)}…` was the same complaint that produced
 * the resource/business-name work one row below it on the same viewport: an id
 * fragment tells an operator nothing. The readable identity is already loaded —
 * the route filters on `user_id`, so every row in `logs` belongs to the filtered
 * account and carries `business.company_name` and `users` — so the fix is a read
 * of state with no extra request. `fetch` is asserted to be called exactly once
 * below to pin that: a regression that looked the account up would call it twice.
 *
 * Renders the real page in jsdom like the sibling suites (Playwright is not
 * installed — CLAUDE.md § Testing), and asserts with `toBeTruthy()` /
 * `toBeNull()` because jest-dom is not configured in this project.
 */

import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';

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

import { ARCHIVING_OVERVIEW_URL } from '@/hooks/useLatestArchiveCutoff';

import AuditTrailPage from '../page';

const ACCOUNT = '99999999-9999-4999-8999-999999999999';
const OTHER_ACCOUNT = '11111111-1111-4111-8111-111111111111';
const TRUNCATED = `${ACCOUNT.slice(0, 8)}…`;

const baseRow = {
  id: 'row-1',
  action: 'BUSINESS_AI_ACTION_COMPLETED',
  entity_type: 'ai_action',
  entity_id: 'cccccccc-3333-4333-8333-cccccccccccc',
  resource_name: null,
  details: null,
  changes: null,
  severity: 'info',
  created_at: '2026-09-28T10:00:00.000Z',
  compliance_flags: [],
};

const NAMED_ROW = {
  ...baseRow,
  user_id: ACCOUNT,
  users: { email: 'owner@acme.test' },
  business: { company_name: 'Acme Dental' },
};

function mockRoute(logs: unknown[]): jest.Mock {
  const fetchMock = jest.fn(async () => ({
    ok: true,
    json: async () => ({
      success: true,
      logs,
      pagination: {
        page: 1,
        pageSize: 20,
        total: logs.length,
        totalPages: logs.length ? 1 : 0,
        hasMore: false,
        showing: logs.length,
      },
    }),
  }));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- jsdom has no fetch; standard test stub
  (global as any).fetch = fetchMock;
  return fetchMock;
}

/** The chip, once the first page has arrived. */
async function chip(fetchMock: jest.Mock): Promise<HTMLElement> {
  const element = await screen.findByTestId('account-filter-chip');
  await waitFor(() => expect(fetchMock).toHaveBeenCalled());
  return element;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockSearch = `user_id=${ACCOUNT}`;
});

describe('the account chip when the loaded rows carry a business name', () => {
  it('labels the account with the business name and not the id fragment', async () => {
    const fetchMock = mockRoute([NAMED_ROW]);
    render(<AuditTrailPage />);

    const element = await chip(fetchMock);
    await waitFor(() => expect(element.textContent).toContain('Acme Dental'));
    // THE regression guard: the truncated GUID must be gone from the visible text.
    expect(element.textContent).not.toContain(TRUNCATED);
    expect(element.textContent).not.toContain(ACCOUNT);
  });

  it('prefers the business name over the email when both are loaded', async () => {
    const fetchMock = mockRoute([NAMED_ROW]);
    render(<AuditTrailPage />);

    const element = await chip(fetchMock);
    await waitFor(() => expect(element.textContent).toContain('Acme Dental'));
    expect(element.textContent).not.toContain('owner@acme.test');
  });

  it('keeps the full id readable on hover, so the operator can still recover it', async () => {
    const fetchMock = mockRoute([NAMED_ROW]);
    render(<AuditTrailPage />);

    const element = await chip(fetchMock);
    await waitFor(() => expect(element.textContent).toContain('Acme Dental'));
    expect(element.querySelector(`[title="${ACCOUNT}"]`)).toBeTruthy();
  });

  it('reads the name from state — no identity lookup of its own', async () => {
    const fetchMock = mockRoute([NAMED_ROW]);
    render(<AuditTrailPage />);

    const element = await chip(fetchMock);
    await waitFor(() => expect(element.textContent).toContain('Acme Dental'));

    // The page makes exactly two requests on mount and neither is about identity:
    // the log list, and the archived-before notice's unrelated overview read. A
    // chip that looked the account up would add a third URL, so the endpoints are
    // enumerated rather than counted.
    const urls = fetchMock.mock.calls.map(([url]) => String(url));
    const listCalls = urls.filter((url) => url.startsWith('/api/admin/audit-trail?'));
    expect(listCalls).toHaveLength(1);
    expect(urls.filter((url) => url !== ARCHIVING_OVERVIEW_URL)).toEqual(listCalls);
  });
});

describe('the account chip when there is no business name', () => {
  it('falls back to the email, the same chain the rows use', async () => {
    const fetchMock = mockRoute([
      { ...baseRow, user_id: ACCOUNT, users: { email: 'solo@example.test' }, business: null },
    ]);
    render(<AuditTrailPage />);

    const element = await chip(fetchMock);
    await waitFor(() => expect(element.textContent).toContain('solo@example.test'));
    expect(element.textContent).not.toContain(TRUNCATED);
  });

  it('falls back to the full name when there is no email either', async () => {
    const fetchMock = mockRoute([
      { ...baseRow, user_id: ACCOUNT, users: { full_name: 'Dana Operator' }, business: { company_name: null } },
    ]);
    render(<AuditTrailPage />);

    const element = await chip(fetchMock);
    await waitFor(() => expect(element.textContent).toContain('Dana Operator'));
  });

  it('takes the name from whichever loaded row has one', async () => {
    // Identity travels per row, and an AI-action row can be identity-thin.
    const fetchMock = mockRoute([
      { ...baseRow, id: 'row-thin', user_id: ACCOUNT, users: null, business: null },
      { ...NAMED_ROW, id: 'row-named' },
    ]);
    render(<AuditTrailPage />);

    const element = await chip(fetchMock);
    await waitFor(() => expect(element.textContent).toContain('Acme Dental'));
  });
});

describe('the account chip when no identity is available', () => {
  it('shows the truncated id when the filter matched no rows', async () => {
    const fetchMock = mockRoute([]);
    render(<AuditTrailPage />);

    const element = await chip(fetchMock);
    // Honest: there is nothing loaded to name the account with.
    expect(element.textContent).toContain(TRUNCATED);
    expect(element.querySelector(`[title="${ACCOUNT}"]`)).toBeTruthy();
  });

  it('shows the truncated id when every loaded row has no identity at all', async () => {
    const fetchMock = mockRoute([{ ...baseRow, user_id: ACCOUNT, users: null, business: null }]);
    render(<AuditTrailPage />);

    const element = await chip(fetchMock);
    expect(element.textContent).toContain(TRUNCATED);
  });

  it('never borrows a name from rows that are not this account’s', async () => {
    // This is the in-flight state: `logs` still holds the previous filter's rows
    // while the request for this account is outstanding. Labelling the chip from
    // them would name the WRONG business, so the guard falls back to the id.
    const fetchMock = mockRoute([
      {
        ...baseRow,
        user_id: OTHER_ACCOUNT,
        users: { email: 'someone@else.test' },
        business: { company_name: 'Other Business' },
      },
    ]);
    render(<AuditTrailPage />);

    const element = await chip(fetchMock);
    expect(element.textContent).toContain(TRUNCATED);
    expect(element.textContent).not.toContain('Other Business');
    expect(element.textContent).not.toContain('someone@else.test');
  });
});
