/**
 * @jest-environment jsdom
 */

/**
 * Businesses on the Admin Layout Standard (slice L-4a, the list): header, KPI
 * tiles, the filter bar (Search page-only, Status in the URL), the shared
 * loading / error / empty states with no full-page spinner, newest read wins,
 * the standard table, and the row toggle's name. U-1 to U-13 of the L-4a
 * workplan (with SA M-1 and M-5).
 *
 * jsdom like the sibling suites (Playwright is not installed: CLAUDE.md
 * § Testing). `next/navigation` is mocked with a settable search string, and
 * the real jsdom `history.replaceState` is spied on, as the Audit trail suites do.
 */

import React from 'react';
import { act, configure, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

jest.mock('@/lib/logger', () => ({
  createLogger: () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    child: jest.fn().mockReturnThis(),
  }),
  // LF-F3: the page logs through `clientLogger.child`; `@/lib/logger/client` re-exports it from this module.
  clientLogger: { child: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }) },
}));

let mockSearch = '';
jest.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(mockSearch),
}));

import UsersPage from '../page';
import { rowToggleName } from '../userName';

// As the pin files (SA F2 on LF-4a.2; SA ruling on LF-4c, check 8): the whole
// page under a parallel Jest run can take more than RTL's 1 s default to
// settle. Both limits are raised, so the longer wait does not just hit Jest's
// 5 s test timeout. A longer wait cannot make a wrong result pass; it only stops a slow machine failing a correct one.
jest.setTimeout(30_000);
configure({ asyncUtilTimeout: 5000 });

const PATH = '/admin/users';
const DANA_ID = '99999999-9999-4999-8999-999999999999';
const OREN_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

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
  statusText?: string;
  json: () => Promise<unknown>;
}

function ok(rows: unknown[], extra: Record<string, unknown> = {}): ResponseLike {
  const body = {
    success: true,
    data: rows,
    stats: { totalUsers: rows.length, activeUsers: 0, newUsersToday: 0 },
    ...extra,
  };
  return { ok: true, status: 200, json: async () => body };
}

function failing(status: number, body: unknown, statusText = ''): ResponseLike {
  return { ok: false, status, statusText, json: async () => body };
}

/** A 502 from a proxy: an HTML page, so `json()` throws a parser error. */
function htmlPage(status: number): ResponseLike {
  return {
    ok: false,
    status,
    statusText: 'Bad Gateway',
    json: async () => {
      throw new SyntaxError('Unexpected token < in JSON at position 0');
    },
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

/** The list route's answer for one request. Set per test; the default answers Dana and Oren. */
let listAnswer: (query: URLSearchParams) => Promise<ResponseLike>;

function mockFetch(): jest.Mock {
  const fetchMock = jest.fn((url: string) => {
    const text = String(url);
    if (text.startsWith('/api/admin/users?')) return listAnswer(new URLSearchParams(text.split('?')[1]));
    return Promise.resolve(failing(404, { success: false, error: 'not mocked' }));
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- jsdom has no fetch; standard test stub
  (global as any).fetch = fetchMock;
  return fetchMock;
}

const listQueries = (mock: jest.Mock): URLSearchParams[] =>
  mock.mock.calls
    .map(([u]) => String(u))
    .filter((u) => u.startsWith('/api/admin/users?'))
    .map((u) => new URLSearchParams(u.split('?')[1]));

/** Arrive at the page with this query, as a link would open it. */
function arrive(search: string) {
  window.history.replaceState(null, '', `${PATH}${search ? `?${search}` : ''}`);
  mockSearch = search;
}

const refresh = () => screen.getByRole('button', { name: 'Refresh the business list' }) as HTMLButtonElement;
const clearButton = () => screen.getByRole('button', { name: 'Clear' }) as HTMLButtonElement;
const searchBox = () => screen.getByLabelText('Search') as HTMLInputElement;
const statusSelect = () => screen.getByLabelText('Status') as HTMLSelectElement;
const content = () => screen.getByTestId('users-content');

/** Wait until the read in flight has settled (Refresh is enabled again). */
async function settled() {
  await waitFor(() => expect(refresh().disabled).toBe(false));
}

/** Let the 300 ms search pause pass, and then some. */
async function pastTheDebounce() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 450));
  });
}

let replaceSpy: jest.SpyInstance;

beforeEach(() => {
  jest.clearAllMocks();
  arrive('');
  listAnswer = async () => ok([DANA, OREN]);
  replaceSpy = jest.spyOn(window.history, 'replaceState');
});

afterEach(() => {
  replaceSpy.mockRestore();
});

const replacedUrls = (): string[] => replaceSpy.mock.calls.map((call) => String(call[2]));

describe('U-1 the standard header, and no dead Advanced Filters panel (D-11 (a))', () => {
  it('has one h1 "Businesses", the purpose sentence, and no Filters button or panel words', async () => {
    mockFetch();
    render(<UsersPage />);
    await screen.findAllByTestId('row-business');
    const headings = screen.getAllByRole('heading', { level: 1 });
    expect(headings).toHaveLength(1);
    expect(headings[0].textContent).toBe('Businesses');
    expect(within(screen.getByRole('banner')).getByText(/Every login on the platform/).textContent).toBe(
      'Every login on the platform. Logins with no business show "No Business OS business".',
    );
    expect(screen.queryByRole('button', { name: /Filters/ })).toBeNull();
    for (const word of ['Apply Filters', 'Email Verified', 'Auth Provider', 'Joined Date', 'Has Agents']) {
      expect(document.body.textContent).not.toContain(word);
    }
    expect(screen.queryByTestId('count-pill')).toBeNull();
  });
});

describe('U-2 the KPI tiles', () => {
  it('three tiles in order, named label then value; the first two are status links, the third is a group', async () => {
    const fetchMock = mockFetch();
    const { container } = render(<UsersPage />);
    await screen.findByTestId('kpi-shown');
    const tiles = Array.from(container.querySelectorAll('[data-testid^="kpi-"]'));
    expect(tiles.map((t) => t.getAttribute('aria-label'))).toEqual(['Users shown (active), 2', 'Active users, 0', 'New today, 0']);

    const [shown, activeTile, newToday] = tiles;
    expect(shown.tagName).toBe('A');
    expect(shown.getAttribute('href')).toBe('/admin/users?status=all');
    expect(shown.getAttribute('aria-current')).toBeNull();
    expect(activeTile.tagName).toBe('A');
    expect(activeTile.getAttribute('href')).toBe('/admin/users');
    expect(activeTile.getAttribute('aria-current')).toBe('true');
    expect(newToday.tagName).toBe('DIV');
    expect(newToday.getAttribute('role')).toBe('group');

    const before = listQueries(fetchMock).length;
    const notPrevented = fireEvent.click(shown);
    expect(notPrevented).toBe(false);
    await waitFor(() => expect(listQueries(fetchMock)).toHaveLength(before + 1));
    expect(listQueries(fetchMock)[before].get('status')).toBe('all');
    await waitFor(() => expect(screen.getByTestId('kpi-shown').getAttribute('aria-current')).toBe('true'));
  });

  it('shows three placeholders while the first read is in flight, and no tiles after a failed read', async () => {
    const first = deferred<ResponseLike>();
    listAnswer = () => first.promise;
    mockFetch();
    render(<UsersPage />);
    expect(screen.getAllByTestId('kpi-placeholder')).toHaveLength(3);
    expect(screen.queryByTestId('kpi-shown')).toBeNull();
    await act(async () => first.resolve(failing(500, { success: false, error: 'Failed to fetch users' })));
    await screen.findByTestId('users-error');
    expect(screen.queryByTestId('kpi-placeholder')).toBeNull();
    expect(screen.queryByTestId('kpi-shown')).toBeNull();
  });
});

describe('U-3 the URL holds the status only', () => {
  it('an inbound ?status=inactive makes the FIRST request inactive, and the select shows it', async () => {
    arrive('status=inactive');
    const fetchMock = mockFetch();
    render(<UsersPage />);
    await settled();
    expect(listQueries(fetchMock)[0].get('status')).toBe('inactive');
    expect(statusSelect().value).toBe('inactive');
  });

  it('choosing All Users writes ?status=all by replace; choosing Active writes no status', async () => {
    mockFetch();
    render(<UsersPage />);
    await settled();
    fireEvent.change(statusSelect(), { target: { value: 'all' } });
    await waitFor(() => expect(replacedUrls()).toContain('/admin/users?status=all'));
    fireEvent.change(statusSelect(), { target: { value: 'active' } });
    await waitFor(() => expect(window.location.search).toBe(''));
    expect(replacedUrls()[replacedUrls().length - 1]).toBe('/admin/users');
  });

  it('?status=bogus falls back to Active and is cleaned from the address bar (U-4)', async () => {
    arrive('status=bogus');
    const fetchMock = mockFetch();
    render(<UsersPage />);
    await settled();
    expect(listQueries(fetchMock)[0].get('status')).toBe('active');
    expect(window.location.search).toBe('');
  });

  it('typing a search never writes it to the URL (D-6 (a))', async () => {
    const fetchMock = mockFetch();
    render(<UsersPage />);
    await settled();
    fireEvent.change(searchBox(), { target: { value: 'dana' } });
    await waitFor(() => expect(listQueries(fetchMock).some((q) => q.get('search') === 'dana')).toBe(true));
    expect(replacedUrls().some((url) => url.includes('dana') || url.includes('search'))).toBe(false);
    expect(window.location.search).not.toContain('dana');
  });
});

describe('U-4 no full-page spinner (F-19)', () => {
  it('a slow later read keeps the search box (same node, value, focus) and the table; the area is busy', async () => {
    const fetchMock = mockFetch();
    render(<UsersPage />);
    await screen.findAllByTestId('row-business');
    expect(screen.getByText(/^Read at \d\d:\d\d UTC$/)).toBeTruthy();

    const slow = deferred<ResponseLike>();
    listAnswer = (q) => (q.get('search') === 'dana' ? slow.promise : Promise.resolve(ok([DANA, OREN])));
    const box = searchBox();
    box.focus();
    fireEvent.change(box, { target: { value: 'dana' } });
    await waitFor(() => expect(content().getAttribute('aria-busy')).toBe('true'));

    expect(searchBox()).toBe(box);
    expect(box.value).toBe('dana');
    expect(document.activeElement).toBe(box);
    expect(screen.getAllByTestId('row-business').length).toBeGreaterThan(0);
    expect(refresh().getAttribute('aria-busy')).toBe('true');
    expect(refresh().disabled).toBe(true);
    expect(screen.queryByRole('status')).toBeNull();

    await act(async () => slow.resolve(ok([DANA])));
    await settled();
    expect(content().getAttribute('aria-busy')).toBe('false');

    listAnswer = async () => ok([DANA]);
    const before = listQueries(fetchMock).length;
    fireEvent.click(refresh());
    await waitFor(() => expect(listQueries(fetchMock)).toHaveLength(before + 1));
    const last = listQueries(fetchMock)[before];
    expect(last.get('status')).toBe('active');
    expect(last.get('search')).toBe('dana');
  });
});

describe('U-5 error copy (F-20, §5.10)', () => {
  async function errorFor(answer: () => Promise<ResponseLike>): Promise<HTMLElement> {
    listAnswer = answer;
    mockFetch();
    render(<UsersPage />);
    return screen.findByTestId('users-error');
  }

  it('an HTML 502 shows the fixed copy, never a parser message', async () => {
    const error = await errorFor(async () => htmlPage(502));
    expect(error.textContent).toBe('Could not read the business list. Try again in a moment.');
    expect(document.body.textContent).not.toMatch(/Unexpected token|SyntaxError/);
  });

  it('a 500 with no JSON and a statusText shows the fixed copy, not the status text', async () => {
    const error = await errorFor(async () => ({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
      json: async () => {
        throw new SyntaxError('Unexpected end of JSON input');
      },
    }));
    expect(error.textContent).toBe('Could not read the business list. Try again in a moment.');
    expect(document.body.textContent).not.toContain('Internal Server Error');
  });

  it('a rejected fetch shows the network copy', async () => {
    const error = await errorFor(() => Promise.reject(new TypeError('Failed to fetch')));
    expect(error.textContent).toBe('Could not reach the server. Check your connection and try again.');
  });

  it('a 401 shows the session-ended sentence (SA Q-13)', async () => {
    const error = await errorFor(async () => failing(401, { success: false, error: 'Unauthorized' }));
    expect(error.textContent).toBe('Your admin session has ended. Sign in again.');
  });

  it("a 500 with the route's own error shows that text, in a dark alert", async () => {
    const error = await errorFor(async () => failing(500, { success: false, error: 'Failed to fetch users' }));
    expect(error.textContent).toBe('Failed to fetch users');
    const alert = error.closest('[role="alert"]') as HTMLElement;
    expect(alert).toBeTruthy();
    // Token match: the dark alert's `bg-red-500/10` contains the text "bg-red-50".
    expect(alert.className.split(/\s+/)).not.toContain('bg-red-50');
  });
});

describe('U-6 success, failure, retry', () => {
  it('Refresh fails (rows and tiles go); Try again succeeds; focus lands on the list area, not <body>', async () => {
    mockFetch();
    render(<UsersPage />);
    await screen.findAllByTestId('row-business');

    listAnswer = async () => failing(500, { success: false, error: 'Failed to fetch users' });
    fireEvent.click(refresh());
    await screen.findByTestId('users-error');
    expect(screen.queryAllByTestId('row-business')).toHaveLength(0);
    expect(screen.queryByTestId('kpi-shown')).toBeNull();

    listAnswer = async () => ok([DANA, OREN]);
    const tryAgain = screen.getByRole('button', { name: 'Try again' });
    tryAgain.focus();
    expect(document.activeElement).toBe(tryAgain);
    fireEvent.click(tryAgain);
    await waitFor(() => expect(screen.getAllByTestId('row-business')).toHaveLength(2));
    expect(screen.queryByTestId('users-error')).toBeNull();
    expect(screen.getByTestId('kpi-shown')).toBeTruthy();
    await waitFor(() => expect(document.activeElement).toBe(content()));
  });

  it('a read started from the bar never moves focus', async () => {
    mockFetch();
    render(<UsersPage />);
    await settled();
    const button = refresh();
    button.focus();
    fireEvent.click(button);
    await settled();
    expect(document.activeElement).toBe(refresh());
  });
});

describe('U-7 / U-7b Clear and the mount (SA M-1)', () => {
  it('the mount sends exactly one list request, and still one after the search pause', async () => {
    const fetchMock = mockFetch();
    render(<UsersPage />);
    await settled();
    expect(listQueries(fetchMock)).toHaveLength(1);
    expect(listQueries(fetchMock)[0].toString()).toBe('status=active&search=');
    await pastTheDebounce();
    expect(listQueries(fetchMock)).toHaveLength(1);
  });

  it('Clear is disabled at the defaults; after "All Users" one click sends exactly one request back to the defaults', async () => {
    const fetchMock = mockFetch();
    render(<UsersPage />);
    await settled();
    expect(clearButton().disabled).toBe(true);

    fireEvent.change(statusSelect(), { target: { value: 'all' } });
    await waitFor(() => expect(clearButton().disabled).toBe(false));
    await settled();

    const before = listQueries(fetchMock).length;
    fireEvent.click(clearButton());
    await pastTheDebounce();
    await settled();
    const after = listQueries(fetchMock).slice(before);
    expect(after.map((q) => q.toString())).toEqual(['status=active&search=']);
    expect(searchBox().value).toBe('');
    expect(window.location.search).toBe('');
    expect(clearButton().disabled).toBe(true);
  });

  it('after a search, Clear empties the box and sends exactly one request with an empty search', async () => {
    const fetchMock = mockFetch();
    render(<UsersPage />);
    await settled();
    fireEvent.change(searchBox(), { target: { value: 'acme' } });
    expect(clearButton().disabled).toBe(false);
    await waitFor(() => expect(listQueries(fetchMock).some((q) => q.get('search') === 'acme')).toBe(true));
    await settled();

    const before = listQueries(fetchMock).length;
    fireEvent.click(clearButton());
    await pastTheDebounce();
    await settled();
    expect(listQueries(fetchMock).slice(before).map((q) => q.toString())).toEqual(['status=active&search=']);
    expect(searchBox().value).toBe('');
    expect(clearButton().disabled).toBe(true);
  });
});

describe('U-8 emptying the search box reloads the list (F-18, D-16)', () => {
  it('typing then emptying the box sends a request with an empty search after the pause', async () => {
    const fetchMock = mockFetch();
    render(<UsersPage />);
    await settled();
    fireEvent.change(searchBox(), { target: { value: 'acme' } });
    await waitFor(() => expect(listQueries(fetchMock).some((q) => q.get('search') === 'acme')).toBe(true));
    await settled();
    const before = listQueries(fetchMock).length;
    fireEvent.change(searchBox(), { target: { value: '' } });
    await waitFor(() => expect(listQueries(fetchMock)).toHaveLength(before + 1));
    expect(listQueries(fetchMock)[before].toString()).toBe('status=active&search=');
  });

  it('typing then changing the status inside the pause sends no second request for the same text', async () => {
    const fetchMock = mockFetch();
    render(<UsersPage />);
    await settled();
    const before = listQueries(fetchMock).length;
    fireEvent.change(searchBox(), { target: { value: 'acme' } });
    fireEvent.change(statusSelect(), { target: { value: 'all' } });
    await pastTheDebounce();
    await settled();
    expect(listQueries(fetchMock).slice(before).map((q) => q.toString())).toEqual(['status=all&search=acme']);
  });
});

describe('U-9 newest read wins (SA M-5)', () => {
  it('two reads resolving in reverse order: the newer rows stay, and Refresh is not busy after both', async () => {
    mockFetch();
    render(<UsersPage />);
    await settled();

    const older = deferred<ResponseLike>();
    const newer = deferred<ResponseLike>();
    listAnswer = (q) => (q.get('status') === 'all' ? older.promise : newer.promise);
    fireEvent.change(statusSelect(), { target: { value: 'all' } });
    fireEvent.change(statusSelect(), { target: { value: 'inactive' } });

    await act(async () => newer.resolve(ok([DANA])));
    await act(async () => older.resolve(ok([OREN])));
    await settled();
    expect(screen.getAllByTestId('row-user').map((e) => e.textContent)).toEqual(['Dana Cohen']);
    expect(refresh().getAttribute('aria-busy')).toBe('false');
  });

  it('an older read that FAILS and resolves last shows no error and keeps the newer rows, tiles and Read at', async () => {
    mockFetch();
    render(<UsersPage />);
    await settled();

    const older = deferred<ResponseLike>();
    const newer = deferred<ResponseLike>();
    listAnswer = (q) => (q.get('status') === 'all' ? older.promise : newer.promise);
    fireEvent.change(statusSelect(), { target: { value: 'all' } });
    fireEvent.change(statusSelect(), { target: { value: 'inactive' } });

    await act(async () => newer.resolve(ok([DANA])));
    await act(async () => older.resolve(failing(500, { success: false, error: 'Failed to fetch users' })));
    await settled();
    expect(screen.queryByTestId('users-error')).toBeNull();
    expect(screen.getAllByTestId('row-user').map((e) => e.textContent)).toEqual(['Dana Cohen']);
    expect(screen.getByTestId('kpi-shown').getAttribute('aria-label')).toBe('Users shown (inactive), 1');
    expect(screen.getByText(/^Read at \d\d:\d\d UTC$/)).toBeTruthy();
  });
});

describe('U-10 the table', () => {
  // L-4b (SA Q-2 (b)): the Actions column went with the row toggle. LF-8 (user
  // request 2026-10-15): the Open button's own narrow last column, "Details"
  // for screen readers only, makes seven.
  it('keeps the seven headers, each scope="col"', async () => {
    mockFetch();
    render(<UsersPage />);
    await screen.findAllByTestId('row-business');
    const headers = screen.getAllByRole('columnheader');
    expect(headers.map((th) => th.textContent)).toEqual([
      'Business / user',
      'Credits left',
      'Contact',
      'Login Activity',
      'Last Sign In',
      'Joined',
      'Details',
    ]);
    for (const th of headers) expect(th.getAttribute('scope')).toBe('col');
  });

  // L-4b: the row toggle became the drawer's Open button (Q-16, R-8). LF-8: an
  // icon, so its name is also its tooltip (the old toggle's no-title pin is
  // superseded); still not a toggle.
  it('the Open button is named for the person, is an icon with that name as its tooltip, and is not a toggle', async () => {
    mockFetch();
    render(<UsersPage />);
    const open = await screen.findByRole('button', { name: 'Open details for Dana Cohen' });
    expect(open.textContent).toBe('');
    expect(open.hasAttribute('aria-expanded')).toBe(false);
    expect(open.getAttribute('title')).toBe('Open details for Dana Cohen');
  });

  it('the toggle name falls back to the email, then "this login", never "null" (SA S-4)', () => {
    expect(rowToggleName('  Dana Cohen ', 'dana@example.com')).toBe('Dana Cohen');
    expect(rowToggleName(null, 'dana@example.com')).toBe('dana@example.com');
    expect(rowToggleName('   ', ' ')).toBe('this login');
    expect(rowToggleName(undefined, undefined)).toBe('this login');
  });

  it('the short id shows formatShortId with the full id in title', async () => {
    mockFetch();
    render(<UsersPage />);
    const ids = await screen.findAllByTestId('row-short-id');
    expect(ids[0].textContent).toBe('99999999…');
    expect(ids[0].getAttribute('title')).toBe(DANA_ID);
  });

  it('Last Sign In and Joined show the UTC time with an age line; a null sign-in shows "Never"', async () => {
    mockFetch();
    render(<UsersPage />);
    const signIns = await screen.findAllByTestId('row-last-sign-in');
    const [first, second] = signIns;
    const lines = Array.from(first.querySelectorAll('span')).map((s) => s.textContent);
    expect(lines[0]).toBe('2026-10-10 08:05 UTC');
    expect(lines[1]).toMatch(/^(Just now|\d+h ago|\d+d ago)$/);
    expect(second.textContent).toBe('Never');
    const joined = screen.getAllByTestId('row-joined')[0];
    expect(joined.querySelector('span')?.textContent).toBe('2026-09-01 00:00 UTC');
    expect(joined.textContent).toMatch(/\d+d ago$/);
  });
});

describe('U-11 the count line (§5.7)', () => {
  it('"1 user" and "2 users"', async () => {
    listAnswer = async () => ok([DANA]);
    const fetchMock = mockFetch();
    render(<UsersPage />);
    expect((await screen.findByTestId('users-count-line')).textContent).toBe('1 user');
    listAnswer = async () => ok([DANA, OREN]);
    fireEvent.click(refresh());
    await waitFor(() => expect(screen.getByTestId('users-count-line').textContent).toBe('2 users'));
    expect(listQueries(fetchMock)).toHaveLength(2);
  });

  it('with 101 rows: the capped sentence and exactly 100 rows', async () => {
    const rows = Array.from({ length: 101 }, (_, i) => ({
      ...DANA,
      id: `${String(i).padStart(8, '0')}-0000-4000-8000-000000000000`,
      created_at: new Date(Date.UTC(2026, 0, 1) + i * 60_000).toISOString(),
    }));
    listAnswer = async () => ok(rows);
    mockFetch();
    render(<UsersPage />);
    const line = await screen.findByTestId('users-count-line');
    expect(line.textContent).toBe(
      'Showing the first 100 of 101 users, newest first. Narrow the list with the search or the status.',
    );
    expect(screen.getAllByTestId('row-business')).toHaveLength(100);
  });
});

describe('U-12 an open row across list reads (L-4a §2.5, SA Q-2)', () => {
  const panelReads = (mock: jest.Mock) =>
    mock.mock.calls
      .map(([u]) => String(u))
      .filter((u) => u.includes(`/entitlements/accounts/${DANA_ID}`) || u.includes(`/accounts/${DANA_ID}/summary`)).length;

  // L-4b: the open row is a modal drawer now. Radix hides the page from role
  // queries while it is open, so Refresh is found with `hidden: true`; the
  // request counts are unchanged (SA M-4). The status change is the close.
  const refreshBehindDrawer = () =>
    screen.getByRole('button', { name: 'Refresh the business list', hidden: true }) as HTMLButtonElement;

  it('stays open across Refresh with no new panel reads; a status change that drops the row closes it', async () => {
    const fetchMock = mockFetch();
    render(<UsersPage />);
    fireEvent.click((await screen.findAllByTestId('row-business'))[0]);
    await screen.findByTestId('bos-panel');
    await waitFor(() => expect(panelReads(fetchMock)).toBeGreaterThan(0));
    const panel = screen.getByTestId('bos-panel');
    const readsBefore = panelReads(fetchMock);

    fireEvent.click(refreshBehindDrawer());
    await waitFor(() => expect(refreshBehindDrawer().disabled).toBe(false));
    expect(screen.getByTestId('bos-panel')).toBe(panel);
    expect(panelReads(fetchMock)).toBe(readsBefore);
    expect(screen.getByRole('dialog')).toBeTruthy();

    listAnswer = async (q) => (q.get('status') === 'inactive' ? ok([OREN]) : ok([DANA, OREN]));
    fireEvent.change(statusSelect(), { target: { value: 'inactive' } });
    await settled();
    expect(screen.queryByTestId('bos-panel')).toBeNull();
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

describe('U-13 search notices (§5.10 Partial)', () => {
  it('the capped and failed notices render through AdminNotice with their test ids and words', async () => {
    listAnswer = async () =>
      ok([DANA], { search: { businessSearch: 'failed', businessMatchesCapped: true, businessMatchLimit: 50 } });
    mockFetch();
    render(<UsersPage />);
    const capped = await screen.findByTestId('business-search-capped');
    expect(capped.textContent).toBe(
      'More than 50 businesses match this search; only the first 50 by name are included. Refine the search to see the rest.',
    );
    const failed = screen.getByTestId('business-search-failed');
    expect(failed.textContent).toBe('Business names could not be searched just now; these results match people only.');
    for (const notice of [capped, failed]) {
      expect((notice.parentElement as HTMLElement).className).toContain('border-amber-500/40');
      expect(notice.closest('[role="alert"]')).toBeNull();
    }
  });
});
