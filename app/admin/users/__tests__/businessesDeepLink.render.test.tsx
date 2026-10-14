/**
 * @jest-environment jsdom
 */

/**
 * Money M-1 (T13, AC-115, SA-Q33, SA-W57, SA-WR-36): the one-shot `account`
 * key on Businesses. Finance's account summary links here with
 * `?status=all&account=<id>`.
 *
 *   - The key is page-only: the hook's mount write removes it from the address
 *     bar at once, and it is never written back.
 *   - It is consumed ONCE, after the first list read that SUCCEEDED: the row on
 *     screen opens in the drawer (focus returns to its Open button on close),
 *     or the notice "This business is not in the current list" shows.
 *   - SA-WR-36: a delayed first read still opens the drawer after the key left
 *     the URL; a failed first read consumes nothing and the next good read
 *     opens it; Clear and Refresh never bring the key back.
 *   - A malformed value is ignored and removed. One list request on mount;
 *     status and search behave as before.
 *
 * jsdom, with `next/navigation` mocked and the real `history.replaceState`
 * spied on, as the U-3 suite does.
 */

import React from 'react';
import { act, configure, fireEvent, render, screen, waitFor } from '@testing-library/react';

jest.mock('@/lib/logger', () => ({
  createLogger: () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    child: jest.fn().mockReturnThis(),
  }),
  clientLogger: { child: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }) },
}));

let mockSearch = '';
jest.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(mockSearch),
}));

import UsersPage from '../page';

// As the sibling page suites: the whole page under a parallel run can be slow to settle.
jest.setTimeout(30_000);
configure({ asyncUtilTimeout: 5000 });

const PATH = '/admin/users';
const DANA_ID = '99999999-9999-4999-8999-999999999999';
const OREN_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ABSENT_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

const DANA = {
  id: DANA_ID, full_name: 'Dana Cohen', company: null, email: 'dana@example.com', email_confirmed: true,
  last_sign_in_at: '2026-10-10T08:05:00Z', created_at: '2026-09-01T00:00:00Z', providers: [], role: 'authenticated',
  business: { companyName: 'Acme Therapy', vertical: 'therapist' },
};
const OREN = {
  id: OREN_ID, full_name: 'Oren Levi', company: null, email: 'oren@example.com', email_confirmed: true,
  last_sign_in_at: null, created_at: '2026-08-01T00:00:00Z', providers: [], role: 'authenticated',
  business: null,
};

interface ResponseLike {
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
}

const ok = (rows: unknown[]): ResponseLike => ({
  ok: true,
  status: 200,
  json: async () => ({ success: true, data: rows, stats: { totalUsers: rows.length, activeUsers: 0, newUsersToday: 0 } }),
});
const failing = (status: number, body: unknown): ResponseLike => ({ ok: false, status, json: async () => body });

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

let listAnswer: () => Promise<ResponseLike>;

function mockFetch(): jest.Mock {
  const fetchMock = jest.fn((url: string) => {
    const text = String(url);
    if (text.startsWith('/api/admin/users?')) return listAnswer();
    // The drawer's own reads: not under test here.
    return Promise.resolve(failing(404, { success: false, error: 'not mocked' }));
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- jsdom has no fetch; standard test stub
  (global as any).fetch = fetchMock;
  return fetchMock;
}

const listCalls = (mock: jest.Mock) => mock.mock.calls.map(([u]) => String(u)).filter((u) => u.startsWith('/api/admin/users?'));

/** Arrive at the page with this query, as a link would open it. */
function arrive(search: string) {
  window.history.replaceState(null, '', `${PATH}${search ? `?${search}` : ''}`);
  mockSearch = search;
  // Only the page's own writes are asserted on, never the arrival itself.
  replaceSpy?.mockClear();
}

let replaceSpy: jest.SpyInstance;
const replacedUrls = (): string[] => replaceSpy.mock.calls.map((call) => String(call[2]));

const refresh = () => screen.getByRole('button', { name: 'Refresh the business list' }) as HTMLButtonElement;
const openButtonOf = (id: string) =>
  document.querySelector<HTMLButtonElement>(`tr[data-account-id="${id}"] [data-testid="row-open"]`);

async function settled() {
  await waitFor(() => expect(refresh().disabled).toBe(false));
}

beforeAll(() => {
  const proto = Element.prototype as unknown as Record<string, unknown>;
  proto.hasPointerCapture ??= () => false;
  proto.releasePointerCapture ??= () => undefined;
  proto.scrollIntoView ??= () => undefined;
});

beforeEach(() => {
  jest.clearAllMocks();
  arrive('');
  listAnswer = async () => ok([DANA, OREN]);
  replaceSpy = jest.spyOn(window.history, 'replaceState');
});

afterEach(() => {
  replaceSpy.mockRestore();
});

describe('AC-115: the one-shot account key', () => {
  it('a row on screen opens in the drawer; the key leaves the URL; one list request; focus returns to its Open button', async () => {
    arrive(`status=all&account=${DANA_ID}`);
    const fetchMock = mockFetch();
    render(<UsersPage />);
    const dialog = await screen.findByRole('dialog', { name: 'Acme Therapy 99999999…' });
    expect(dialog).toBeTruthy();
    // Removed by the hook's mount write; status kept.
    expect(window.location.search).toBe('?status=all');
    expect(replacedUrls()).toContain('/admin/users?status=all');
    expect(replacedUrls().some((u) => u.includes('account='))).toBe(false);
    expect(listCalls(fetchMock)).toHaveLength(1);
    expect(new URLSearchParams(listCalls(fetchMock)[0].split('?')[1]).get('status')).toBe('all');
    expect(screen.queryByTestId('users-deeplink-missing')).toBeNull();

    fireEvent.keyDown(dialog, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(openButtonOf(DANA_ID)));
  });

  it('a business not on screen → the notice, and nothing opens; the key is removed', async () => {
    arrive(`status=all&account=${ABSENT_ID}`);
    mockFetch();
    render(<UsersPage />);
    expect((await screen.findByTestId('users-deeplink-missing')).textContent).toContain('This business is not in the current list');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(window.location.search).toBe('?status=all');
  });

  it('a malformed value is ignored and removed: no notice, no drawer', async () => {
    arrive('status=all&account=nonsense');
    const fetchMock = mockFetch();
    render(<UsersPage />);
    await settled();
    await screen.findAllByTestId('row-business');
    expect(screen.queryByTestId('users-deeplink-missing')).toBeNull();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(window.location.search).toBe('?status=all');
    expect(listCalls(fetchMock)).toHaveLength(1);
  });

  it('the notice clears on the next status change; status and search behave as before', async () => {
    arrive(`status=all&account=${ABSENT_ID}`);
    const fetchMock = mockFetch();
    render(<UsersPage />);
    await screen.findByTestId('users-deeplink-missing');
    expect((screen.getByLabelText('Status') as HTMLSelectElement).value).toBe('all');
    expect((screen.getByLabelText('Search') as HTMLInputElement).value).toBe('');
    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'inactive' } });
    await waitFor(() => expect(screen.queryByTestId('users-deeplink-missing')).toBeNull());
    await waitFor(() => expect(window.location.search).toBe('?status=inactive'));
    await settled();
    expect(listCalls(fetchMock)).toHaveLength(2);
    expect(replacedUrls().some((u) => u.includes('account='))).toBe(false);
  });
});

describe('SA-WR-36: the key survives a delayed or failed first read', () => {
  it('a delayed first read: the URL has lost the key at once, and the drawer still opens when the list arrives', async () => {
    const first = deferred<ResponseLike>();
    listAnswer = () => first.promise;
    arrive(`status=all&account=${DANA_ID}`);
    mockFetch();
    render(<UsersPage />);
    // The mount write ran before any list arrived.
    await waitFor(() => expect(window.location.search).toBe('?status=all'));
    expect(screen.queryByRole('dialog')).toBeNull();
    await act(async () => first.resolve(ok([DANA, OREN])));
    expect(await screen.findByRole('dialog', { name: 'Acme Therapy 99999999…' })).toBeTruthy();
  });

  it('a failed first read consumes nothing; the next good read (Try again) opens the drawer', async () => {
    let calls = 0;
    listAnswer = async () => {
      calls += 1;
      return calls === 1 ? failing(500, { success: false, error: 'Failed to fetch users' }) : ok([DANA, OREN]);
    };
    arrive(`status=all&account=${DANA_ID}`);
    mockFetch();
    render(<UsersPage />);
    await screen.findByTestId('users-error');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByTestId('users-deeplink-missing')).toBeNull();
    expect(window.location.search).toBe('?status=all');
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('dialog', { name: 'Acme Therapy 99999999…' })).toBeTruthy();
  });

  it('after it is consumed, Refresh and Clear never bring the key back or reopen the drawer', async () => {
    arrive(`status=all&account=${DANA_ID}`);
    const fetchMock = mockFetch();
    render(<UsersPage />);
    const dialog = await screen.findByRole('dialog');
    fireEvent.keyDown(dialog, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    fireEvent.click(refresh());
    await settled();
    expect(listCalls(fetchMock)).toHaveLength(2);
    expect(screen.queryByRole('dialog')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
    await settled();
    await waitFor(() => expect(window.location.search).toBe(''));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByTestId('users-deeplink-missing')).toBeNull();
    expect(replacedUrls().some((u) => u.includes('account='))).toBe(false);
  });
});
