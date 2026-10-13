/**
 * @jest-environment jsdom
 *
 * Admin users on the Admin Layout Standard (L-12, workplan
 * ADMIN_LAYOUT_L12_WORKPLAN.md §6.3).
 *
 * A-11i and A-12i are the read-only and request INVARIANTS (SA M-1). They were
 * written before the page changed and ran green on the unchanged page; they are
 * not edited by the change. They hold only what is true before and after: no
 * write control in any state, and every request is the one GET.
 *
 * Guard rule R4 (admin-authz-surface) scans test files too, so absence of role
 * UI is asserted through text and accessible-name queries only.
 */

import '@testing-library/jest-dom';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

jest.mock('@/lib/logger/client', () => {
  const logger: Record<string, unknown> = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
  logger.child = () => logger;
  return { clientLogger: logger };
});

import AdminUsersPage from '../page';
import { ADMIN_NETWORK_ERROR } from '@/app/admin/components/layout/readAdminResponse';
import type { AdminListData } from '@/lib/admin/adminList-types';

const LIST: AdminListData = {
  tableAdmins: [
    { email: 'ops@example.com', linkedToLogin: true, addedAt: '2026-07-01T10:00:00.000Z', notes: 'Founder', alsoInEnv: true },
  ],
  envOnlyAdmins: [{ email: 'extra@x.io' }],
};

const REQUEST = ['/api/admin/admins', { method: 'GET' }];
const WRITE_VERBS = /add|remove|delete|grant|revoke|save|edit/i;

type FakeResponse = { ok: boolean; status: number; json: () => Promise<unknown> };

function answer(status: number, body: unknown): FakeResponse {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

const okAnswer = (data: AdminListData = LIST) => answer(200, { success: true, data });

/** A fetch stub whose replies the test releases one by one. */
function heldFetch() {
  const pending: Array<(value: FakeResponse) => void> = [];
  const fetchMock = jest.fn<Promise<FakeResponse>, [string, RequestInit?]>(
    () => new Promise<FakeResponse>((resolve) => pending.push(resolve)),
  );
  global.fetch = fetchMock as unknown as typeof fetch;
  return {
    fetchMock,
    release: (value: FakeResponse) => {
      const next = pending.shift();
      if (!next) throw new Error('no request is waiting');
      next(value);
    },
  };
}

/** The read-only invariant, true in every state before and after L-12. */
function expectReadOnly() {
  expect(document.querySelectorAll('input, select, textarea, form, [role="dialog"]')).toHaveLength(0);
  expect(screen.queryAllByRole('dialog')).toHaveLength(0);
  for (const button of screen.queryAllByRole('button')) {
    const name = button.getAttribute('aria-label') ?? button.textContent ?? '';
    expect(name).not.toMatch(WRITE_VERBS);
    expect(name.startsWith('Refresh') || name === 'Try again').toBe(true);
  }
}

function refreshButton() {
  return screen.getByRole('button', { name: /^Refresh/ });
}

function expectOnlyTheOneGet(fetchMock: jest.Mock) {
  expect(fetchMock.mock.calls.length).toBeGreaterThan(0);
  for (const call of fetchMock.mock.calls) expect(call).toEqual(REQUEST);
}

describe('A-11i: read-only in every state (invariant, M-1)', () => {
  it('loading, ready, refreshing and ready again', async () => {
    const { fetchMock, release } = heldFetch();
    render(<AdminUsersPage />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expectReadOnly(); // first load

    release(okAnswer());
    await waitFor(() => expect(screen.getAllByTestId('table-admin')).toHaveLength(1));
    expectReadOnly(); // ready

    await userEvent.click(refreshButton());
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expectReadOnly(); // refreshing

    release(okAnswer());
    await waitFor(() => expect(refreshButton()).not.toBeDisabled());
    expectReadOnly();
  });

  it('error', async () => {
    const { fetchMock, release } = heldFetch();
    render(<AdminUsersPage />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    release(answer(500, { success: false, error: 'Failed to load admin list' }));
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    expectReadOnly();
  });
});

describe('A-12i: every request is the one GET (invariant, M-1)', () => {
  it('across mount and Refresh', async () => {
    const { fetchMock, release } = heldFetch();
    render(<AdminUsersPage />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    release(okAnswer());
    await waitFor(() => expect(screen.getAllByTestId('table-admin')).toHaveLength(1));

    await userEvent.click(refreshButton());
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    release(okAnswer());
    await waitFor(() => expect(refreshButton()).not.toBeDisabled());

    expectOnlyTheOneGet(fetchMock);
  });
});

// ── After the change (task 5) ───────────────────────────────────────────────

const REFRESH = 'Refresh the admin list';
const UNUSABLE = 'Could not read the admin list. Try again in a moment.';
const SESSION_ENDED = 'Your admin session has ended. Sign in again.';
const READ_AT = /Read at [0-9]{2}:[0-9]{2} UTC/;

type Reply = FakeResponse | 'reject';

/** Answers from a queue (the last reply repeats) and records every call. */
function queueFetch(...replies: Reply[]) {
  const queue = [...replies];
  const fetchMock = jest.fn<Promise<FakeResponse>, [string, RequestInit?]>(async () => {
    const reply = queue.length > 1 ? queue.shift()! : queue[0];
    if (reply === 'reject') throw new TypeError('Failed to fetch');
    return reply;
  });
  global.fetch = fetchMock as unknown as typeof fetch;
  return fetchMock;
}

const notJson = (status: number): FakeResponse => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => {
    throw new SyntaxError(`Unexpected token '<', "<html>" is not valid JSON`);
  },
});

async function renderReady(data: AdminListData = LIST) {
  const fetchMock = queueFetch(okAnswer(data));
  render(<AdminUsersPage />);
  await waitFor(() => expect(screen.getAllByTestId('table-admin').length).toBeGreaterThan(0));
  return fetchMock;
}

function buttonNames(): string[] {
  return screen.queryAllByRole('button').map((b) => b.getAttribute('aria-label') ?? b.textContent ?? '');
}

function expectNoList() {
  expect(screen.queryAllByTestId('table-admin')).toHaveLength(0);
  expect(screen.queryAllByTestId('env-admin')).toHaveLength(0);
  expect(screen.queryByText('From the admin_users table')).not.toBeInTheDocument();
  expect(screen.queryByText('No active rows in the admin_users table.')).not.toBeInTheDocument();
}

let consoleError: jest.SpyInstance;
let consoleWarn: jest.SpyInstance;
beforeEach(() => {
  consoleError = jest.spyOn(console, 'error').mockImplementation(() => undefined);
  consoleWarn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
});
afterEach(() => {
  expect(consoleError).not.toHaveBeenCalled();
  expect(consoleWarn).not.toHaveBeenCalled();
  consoleError.mockRestore();
  consoleWarn.mockRestore();
});

describe('A-1: header', () => {
  it('one h1, the purpose, the neutral Read-only badge, no button in the header', async () => {
    await renderReady();
    const headings = screen.getAllByRole('heading', { level: 1 });
    expect(headings).toHaveLength(1);
    expect(headings[0]).toHaveTextContent('Admin users');
    // LF-5 (user-approved copy, 2026-10-13).
    expect(
      screen.getByText('People who can sign in to this admin area, and where their access comes from.'),
    ).toBeInTheDocument();
    const badge = screen.getByTestId('read-only-badge');
    expect(badge).toHaveTextContent('Read-only');
    expect(badge).toHaveAttribute('data-tone', 'neutral');
    const header = document.querySelector('header');
    expect(header).not.toBeNull();
    expect(header!.querySelectorAll('button')).toHaveLength(0);
  });
});

describe('A-2: the Refresh-only bar', () => {
  it('plain div, Read at in UTC, the named Refresh with visible text', async () => {
    await renderReady();
    expect(screen.queryByRole('search')).not.toBeInTheDocument();
    expect(screen.getByText(READ_AT)).toBeInTheDocument();
    const refresh = screen.getByRole('button', { name: REFRESH });
    expect(refresh).toHaveTextContent('Refresh');
  });
});

describe('A-3: refresh keeps the lists while it reads', () => {
  it('lists mounted, aria-busy and a disabled button while pending; idle after', async () => {
    const { fetchMock, release } = heldFetch();
    render(<AdminUsersPage />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    release(okAnswer());
    await waitFor(() => expect(screen.getAllByTestId('table-admin')).toHaveLength(1));
    const content = screen.getByTestId('admin-users-content');
    expect(content).toHaveAttribute('aria-busy', 'false');

    await userEvent.click(screen.getByRole('button', { name: REFRESH }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(screen.getAllByTestId('table-admin')).toHaveLength(1);
    expect(content).toHaveAttribute('aria-busy', 'true');
    const refresh = screen.getByRole('button', { name: REFRESH });
    expect(refresh).toBeDisabled();
    expect(refresh).toHaveAttribute('aria-busy', 'true');

    release(okAnswer());
    await waitFor(() => expect(content).toHaveAttribute('aria-busy', 'false'));
    expect(screen.getByRole('button', { name: REFRESH })).not.toBeDisabled();
  });
});

describe('A-4: first load', () => {
  it('the shared loading state, with the header, bar and info box already there', async () => {
    const { fetchMock } = heldFetch();
    render(<AdminUsersPage />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(screen.getByRole('status')).toHaveTextContent('Reading the admin list…');
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Admin users');
    expect(screen.getByRole('button', { name: REFRESH })).toBeDisabled();
    expect(screen.getByTestId('access-info')).toBeInTheDocument();
    expect(screen.queryByText(READ_AT)).not.toBeInTheDocument();
    expectNoList();
  });
});

describe('A-5: error words (§5.10)', () => {
  const cases: Array<[string, Reply, string]> = [
    ['500 with the route sentence', answer(500, { success: false, error: 'Failed to load admin list' }), 'Failed to load admin list'],
    ['200 success: false', answer(200, { success: false, error: 'nope' }), 'nope'],
    ['malformed 200', answer(200, { success: true, data: { tableAdmins: {}, envOnlyAdmins: [] } }), UNUSABLE],
    ['non-JSON 502', notJson(502), UNUSABLE],
    ['401', answer(401, { success: false, error: 'Unauthorized' }), SESSION_ENDED],
    ['403', answer(403, { success: false, error: 'Forbidden' }), SESSION_ENDED],
    ['network rejection', 'reject', ADMIN_NETWORK_ERROR],
  ];

  it.each(cases)('%s', async (_label, reply, expected) => {
    queueFetch(reply);
    render(<AdminUsersPage />);
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    expect(screen.getByTestId('admin-list-error').textContent).toBe(expected);
    expect(screen.getByRole('alert')).toContainElement(screen.getByTestId('admin-list-error'));
    expectNoList();
    expect(screen.queryByText(READ_AT)).not.toBeInTheDocument();
    expect(screen.getByTestId('access-info')).toBeInTheDocument();
    const text = document.body.textContent ?? '';
    expect(text).not.toMatch(/Failed to fetch|SyntaxError|Unexpected token/);
  });

  it('S-5: a malformed 200 and a non-JSON body show the same words (page literal = shared fallback)', async () => {
    queueFetch(answer(200, { success: true, data: { envOnlyAdmins: [] } }));
    const first = render(<AdminUsersPage />);
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    const malformed = screen.getByTestId('admin-list-error').textContent;
    first.unmount();

    queueFetch(notJson(502));
    render(<AdminUsersPage />);
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    expect(screen.getByTestId('admin-list-error').textContent).toBe(malformed);
  });
});

describe('A-6: Try again', () => {
  it('re-reads with the same request and recovers to the lists', async () => {
    const fetchMock = queueFetch('reject', okAnswer());
    render(<AdminUsersPage />);
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(screen.getAllByTestId('table-admin')).toHaveLength(1));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1]).toEqual(REQUEST);
  });
});

describe('A-7: a failed refresh clears the lists and Read at (W-3b, SA Q-3)', () => {
  it('nothing is left on screen that the failed read could not confirm', async () => {
    queueFetch(okAnswer(), answer(500, { success: false, error: 'Failed to load admin list' }));
    render(<AdminUsersPage />);
    await waitFor(() => expect(screen.getByText(READ_AT)).toBeInTheDocument());
    await userEvent.click(screen.getByRole('button', { name: REFRESH }));
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    expectNoList();
    expect(screen.queryByText('ops@example.com')).not.toBeInTheDocument();
    expect(screen.queryByText(READ_AT)).not.toBeInTheDocument();
  });
});

describe('A-7b: Try again after a failed refresh shows no stale list while it reads (SA L-12 F-1)', () => {
  it('good load, failed Refresh, held Try again: loading only; then the lists return', async () => {
    const { fetchMock, release } = heldFetch();
    render(<AdminUsersPage />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    release(okAnswer());
    await waitFor(() => expect(screen.getAllByTestId('table-admin')).toHaveLength(1));

    await userEvent.click(screen.getByRole('button', { name: REFRESH }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    release(answer(500, { success: false, error: 'Failed to load admin list' }));
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());

    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    // Held: the list the failed read could not confirm must not come back early.
    expectNoList();
    expect(screen.queryByText(READ_AT)).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Reading the admin list…');

    release(okAnswer());
    await waitFor(() => expect(screen.getAllByTestId('table-admin')).toHaveLength(1));
    expect(screen.getByText(READ_AT)).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});

describe('A-8: dates in UTC through formatUtc', () => {
  const row = (addedAt: string) => ({
    tableAdmins: [{ email: 'a@example.com', linkedToLogin: true, addedAt, notes: null, alsoInEnv: false }],
    envOnlyAdmins: [],
  });

  it.each([
    ['an offset instant', '2026-07-01T12:30:00+02:00', 'Added 2026-07-01 10:30 UTC'],
    ['just after midnight UTC', '2026-07-01T00:30:00.000Z', 'Added 2026-07-01 00:30 UTC'],
    ['an unreadable value', 'not a date', 'Added —'],
  ])('%s', async (_label, addedAt, expected) => {
    await renderReady(row(addedAt));
    const item = screen.getByTestId('table-admin');
    expect(item).toHaveTextContent(expected);
    expect(item).not.toHaveTextContent('1970');
  });
});

/** Every class token on the page, with the element it sits on. */
function classTokens(): Array<{ el: Element; token: string }> {
  const out: Array<{ el: Element; token: string }> = [];
  for (const el of Array.from(document.body.querySelectorAll('*'))) {
    for (const token of (el.getAttribute('class') ?? '').split(/[ ]+/).filter(Boolean)) out.push({ el, token });
  }
  return out;
}

/** The utility after any variant prefix ("hover:bg-x" gives "bg-x"). */
const utility = (token: string) => token.split(':').pop() ?? token;

function expectStandardColours() {
  const status = screen.queryByRole('status');
  const spinner = status ? status.querySelector('svg') : null;
  const purpleText: Element[] = [];
  for (const { el, token } of classTokens()) {
    const u = utility(token);
    expect({ token, ok: !/^text-slate-(500|600)$/.test(u) }).toEqual({ token, ok: true });
    expect({ token, ok: !/^(text|bg|border)-blue-/.test(u) }).toEqual({ token, ok: true });
    expect({ token, ok: !token.startsWith('dark:') && !token.includes('--v2-') }).toEqual({ token, ok: true });
    if (/^(bg|border)-purple-/.test(u)) throw new Error(`purple surface: ${token}`);
    if (/^text-purple-/.test(u)) purpleText.push(el);
  }
  // M-2: the shared AdminLoading spinner is the one purple text allowed (§5.10).
  expect(purpleText.filter((el) => el !== spinner)).toHaveLength(0);
}

describe('A-9: T-5 and T-7 colours', () => {
  it('ready', async () => {
    await renderReady();
    expectStandardColours();
  });

  it('loading (the spinner is the only purple text)', async () => {
    const { fetchMock } = heldFetch();
    render(<AdminUsersPage />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(screen.getByRole('status').querySelector('svg')).toHaveClass('text-purple-500');
    expectStandardColours();
  });

  it('error', async () => {
    queueFetch('reject');
    render(<AdminUsersPage />);
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    expectStandardColours();
  });
});

describe('A-10: decorative icons are hidden from assistive tech', () => {
  it('every svg in the header, the lists and the info box', async () => {
    await renderReady();
    const scopes = [document.querySelector('header'), screen.getByTestId('admin-users-content'), screen.getByTestId('access-info')];
    let seen = 0;
    for (const scope of scopes) {
      for (const svg of Array.from(scope!.querySelectorAll('svg'))) {
        seen += 1;
        expect(svg).toHaveAttribute('aria-hidden', 'true');
      }
    }
    expect(seen).toBeGreaterThan(0);
  });
});

describe('A-11x: the exact button sets, and read-only after Try again', () => {
  it('{Refresh} ready and loading; {Try again, Refresh} error; read-only after Try again', async () => {
    const { fetchMock, release } = heldFetch();
    render(<AdminUsersPage />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(buttonNames()).toEqual([REFRESH]);

    release(answer(500, { success: false, error: 'Failed to load admin list' }));
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    expect(buttonNames().sort()).toEqual([REFRESH, 'Try again'].sort());
    expectReadOnly();

    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(buttonNames()).toEqual([REFRESH]);
    expectReadOnly();

    release(okAnswer());
    await waitFor(() => expect(screen.getAllByTestId('table-admin')).toHaveLength(1));
    expect(buttonNames()).toEqual([REFRESH]);
    expectReadOnly();
  });
});

describe('A-12x: mount, Refresh and Try again each add exactly the one GET', () => {
  it('three calls, each deep-equal to the request', async () => {
    const fetchMock = queueFetch(okAnswer(), 'reject', okAnswer());
    render(<AdminUsersPage />);
    await waitFor(() => expect(screen.getAllByTestId('table-admin')).toHaveLength(1));
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await userEvent.click(screen.getByRole('button', { name: REFRESH }));
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    expect(fetchMock).toHaveBeenCalledTimes(2);

    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(screen.getAllByTestId('table-admin')).toHaveLength(1));
    expect(fetchMock).toHaveBeenCalledTimes(3);
    for (const call of fetchMock.mock.calls) expect(call).toEqual(REQUEST);
  });
});
