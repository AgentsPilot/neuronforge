/**
 * @jest-environment jsdom
 */

/**
 * The Businesses list's filter (admin reorganisation slice 4): it opens on
 * Active users; "total" labels follow the filter; an empty search under Active
 * offers "Search all users" and never widens silently (U-4); the table has no
 * status or role column, so nothing on a row reads as an admin marker (U-9,
 * SA C-23).
 */

import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';

const mockDebug = jest.fn();
jest.mock('@/lib/logger', () => ({
  createLogger: () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: (...args: unknown[]) => mockDebug(...args),
    child: jest.fn().mockReturnThis(),
  }),
  // LF-F3: the page logs through `clientLogger.child`; `@/lib/logger/client` re-exports it from this module.
  // Its debug goes to `mockDebug` too, so the E-3 checks below still read the page's debug lines.
  clientLogger: {
    child: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: (...args: unknown[]) => mockDebug(...args) }),
  },
}));

import UsersPage from '../page';

const ACCOUNT = '99999999-9999-4999-8999-999999999999';

function listBody(rows: unknown[]) {
  return { success: true, data: rows, stats: { totalUsers: rows.length, activeUsers: rows.length, newUsersToday: 0 } };
}

const DANA = {
  id: ACCOUNT, full_name: 'Dana Cohen', company: null, email: 'dana@example.com', email_confirmed: true,
  last_sign_in_at: new Date().toISOString(), created_at: '2026-09-01T00:00:00Z', providers: [], role: 'authenticated',
  business: { companyName: 'Acme Therapy', vertical: 'therapist' },
};

function mockList(rowsFor: (status: string | null, search: string | null) => unknown[]): jest.Mock {
  const fetchMock = jest.fn(async (url: string) => {
    const q = new URL(url, 'http://x').searchParams;
    return { ok: true, status: 200, json: async () => listBody(rowsFor(q.get('status'), q.get('search'))) };
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- jsdom has no fetch; standard test stub
  (global as any).fetch = fetchMock;
  return fetchMock;
}

const statuses = (m: jest.Mock) => m.mock.calls.map(([u]) => new URL(String(u), 'http://x').searchParams.get('status'));

beforeEach(() => {
  jest.clearAllMocks();
});

describe('the default filter', () => {
  it('opens on Active users: the first request carries status=active', async () => {
    const fetchMock = mockList(() => [DANA]);
    render(<UsersPage />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(statuses(fetchMock)[0]).toBe('active');
    expect(((await screen.findAllByRole('combobox'))[0] as HTMLSelectElement).value).toBe('active');
  });

  // L-4a (§5.3, T-6): the header pills are gone; the first KPI tile keeps the same words.
  it('labels the filtered count "shown", not "total", in the card', async () => {
    mockList(() => [DANA]);
    render(<UsersPage />);
    expect((await screen.findByTestId('kpi-shown')).getAttribute('aria-label')).toBe('Users shown (active), 1');

    fireEvent.change(screen.getAllByRole('combobox')[0], { target: { value: 'all' } });
    await waitFor(() => expect(screen.getByTestId('kpi-shown').getAttribute('aria-label')).toBe('All users, 1'));
  });

  it('never logs the raw list body (names and emails), only counts', async () => {
    mockList(() => [DANA]);
    render(<UsersPage />);
    await screen.findByTestId('kpi-shown');
    const logged = JSON.stringify(mockDebug.mock.calls);
    expect(logged).not.toContain('dana@example.com');
    expect(logged).not.toContain('Dana Cohen');
  });

  it('never logs the search text, only whether there is one (QA E-3)', async () => {
    mockList(() => []);
    render(<UsersPage />);
    fireEvent.change(await screen.findByPlaceholderText(/Search users/), { target: { value: 'dana@example.com' } });
    await waitFor(() =>
      expect(mockDebug.mock.calls.some(([ctx]) => (ctx as { hasSearch?: boolean })?.hasSearch === true)).toBe(true)
    );
    expect(JSON.stringify(mockDebug.mock.calls)).not.toContain('dana@example.com');
  });
});

describe('an empty search under Active (U-4)', () => {
  it('offers "Search all users", and only the click widens the search', async () => {
    // Nobody active matches; the inactive business is found under "all".
    const fetchMock = mockList((status, search) => (status === 'all' && search === 'acme' ? [DANA] : []));
    render(<UsersPage />);
    fireEvent.change(await screen.findByPlaceholderText(/Search users/), { target: { value: 'acme' } });
    // The page debounces a search by 300 ms: wait for the search request itself.
    await waitFor(() =>
      expect(fetchMock.mock.calls.some(([u]) => new URL(String(u), 'http://x').searchParams.get('search') === 'acme')).toBe(true)
    );
    const button = await screen.findByTestId('search-all-users');
    expect(screen.getByTestId('no-match-filtered').textContent).toBe('No match among active users');
    // No request has widened on its own.
    expect(statuses(fetchMock).every((s) => s === 'active')).toBe(true);

    fireEvent.click(button);
    await waitFor(() => expect(screen.getAllByTestId('row-user').map((e) => e.textContent)).toEqual(['Dana Cohen']));
    const last = new URL(String(fetchMock.mock.calls[fetchMock.mock.calls.length - 1][0]), 'http://x').searchParams;
    expect(last.get('status')).toBe('all');
    expect(last.get('search')).toBe('acme');
  });

  it('with no search term, the empty state has no "Search all users" button', async () => {
    mockList(() => []);
    render(<UsersPage />);
    await screen.findByText('No users found');
    expect(screen.queryByTestId('search-all-users')).toBeNull();
  });
});

describe('no status or role column (U-9; C-23 satisfied by removal)', () => {
  // L-4b (SA Q-2 (b)): the Actions column went with the row toggle (the Open
  // button sits in the first cell), so six columns; the intent is unchanged.
  it('has no "Auth role" or "Status" header, six columns in all', async () => {
    mockList(() => [DANA]);
    render(<UsersPage />);
    await screen.findByTestId('row-activity');
    expect(screen.queryByRole('columnheader', { name: 'Auth role' })).toBeNull();
    expect(screen.queryByRole('columnheader', { name: 'Status' })).toBeNull();
    expect(screen.getAllByRole('columnheader').map((th) => th.textContent)).toEqual([
      'Business / user',
      // Credit deduction slice 8a (FR-48).
      'Credits left',
      'Contact',
      'Login Activity',
      'Last Sign In',
      'Joined',
    ]);
  });

  it('the Active badge is still beside the name', async () => {
    mockList(() => [DANA]);
    render(<UsersPage />);
    const nameLine = await screen.findByTestId('row-name-line');
    expect(within(nameLine).getByTestId('row-activity').textContent).toBe('Active');
  });

  it('nothing on the row reads as an admin indicator', async () => {
    mockList(() => [DANA]);
    render(<UsersPage />);
    await screen.findByTestId('row-activity');
    const row = screen.getByTestId('row-business').closest('tr') as HTMLTableRowElement;
    expect(within(row).queryByTestId('row-auth-role')).toBeNull();
    expect(row.textContent).not.toMatch(/\b(admin|authenticated|role)\b/i);
    // The shield icon the role pill used to carry is gone from the row.
    expect(row.querySelector('svg.lucide-shield')).toBeNull();
  });

  it('the empty state spans all six columns (slice 8a; six since L-4b, SA Q-2 (b))', async () => {
    mockList(() => []);
    render(<UsersPage />);
    const cell = (await screen.findByText('No users found')).closest('td') as HTMLTableCellElement;
    // Every column, whatever their number, and the literal six of today.
    expect(cell.getAttribute('colspan')).toBe(String(screen.getAllByRole('columnheader').length));
    expect(cell.getAttribute('colspan')).toBe('6');
  });
});
