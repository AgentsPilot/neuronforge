/**
 * @jest-environment jsdom
 *
 * The read-only Admin users page (ADMIN_BOS_CLEANUP slice 1; conditions C-3,
 * C-4, C-8; SA W-2, W-3, W-5). Workplan cases P-1 to P-10 plus a source check.
 *
 * W-2: guard rule R4 scans test files too, so absence of role UI is asserted
 * through text and accessible-name queries only, never by writing a role
 * comparison into this file.
 */

import '@testing-library/jest-dom';
import * as fs from 'fs';
import * as path from 'path';
import { StrictMode } from 'react';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const mockWarn = jest.fn();
jest.mock('@/lib/logger/client', () => {
  const logger: Record<string, unknown> = {
    info: jest.fn(),
    warn: (...a: unknown[]) => mockWarn(...a),
    error: jest.fn(),
    debug: jest.fn(),
  };
  logger.child = () => logger;
  return { clientLogger: logger };
});

import AdminUsersPage from '../page';
import type { AdminListData } from '@/lib/admin/adminList-types';

const OVERLAP_MARKER = 'Also in the environment setting: removing the row alone does not revoke access';
const TABLE_HEADING = 'From the admin_users table';
const ENV_HEADING = 'Granted by the ADMIN_EMAILS environment setting';
const ERROR_TEXT = /Could not load the admin list/;
const EMPTY_TABLE_TEXT = 'No active rows in the admin_users table.';

const LIST: AdminListData = {
  tableAdmins: [
    { email: 'ops@example.com', linkedToLogin: true, addedAt: '2026-07-01T10:00:00.000Z', notes: 'Founder', alsoInEnv: true },
    { email: 'new.admin@example.com', linkedToLogin: false, addedAt: '2026-08-15T09:30:00.000Z', notes: null, alsoInEnv: false },
  ],
  envOnlyAdmins: [{ email: 'extra@x.io' }],
};

type Reply = { status: number; body: unknown } | 'reject';

/** A fetch stub that answers from a queue (last reply repeats) and records every call. */
function stubFetch(...replies: Reply[]) {
  const queue = [...replies];
  type FakeResponse = { ok: boolean; status: number; json: () => Promise<unknown> };
  // Typed with the fetch call shape so `mock.calls` carries (url, init).
  const fetchMock = jest.fn<Promise<FakeResponse>, [string, RequestInit?]>(async () => {
    const reply = queue.length > 1 ? queue.shift()! : queue[0];
    if (reply === 'reject') throw new TypeError('Failed to fetch');
    return { ok: reply.status >= 200 && reply.status < 300, status: reply.status, json: async () => reply.body };
  });
  global.fetch = fetchMock as unknown as typeof fetch;
  return fetchMock;
}

const ok = (data: unknown = LIST): Reply => ({ status: 200, body: { success: true, data } });

async function renderLoaded(data: AdminListData = LIST) {
  const fetchMock = stubFetch(ok(data));
  render(<AdminUsersPage />);
  await waitFor(() => expect(screen.getByText(TABLE_HEADING)).toBeInTheDocument());
  return fetchMock;
}

function expectNoList() {
  expect(screen.queryByText(TABLE_HEADING)).not.toBeInTheDocument();
  expect(screen.queryByText(ENV_HEADING)).not.toBeInTheDocument();
  expect(screen.queryByText(EMPTY_TABLE_TEXT)).not.toBeInTheDocument();
  expect(screen.queryAllByTestId('table-admin')).toHaveLength(0);
  expect(screen.queryAllByTestId('env-admin')).toHaveLength(0);
}

beforeEach(() => {
  mockWarn.mockClear();
});

describe('what the page shows', () => {
  it('P-1: table emails, linked-to-a-login, added date and notes', async () => {
    await renderLoaded();
    const rows = screen.getAllByTestId('table-admin');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent('ops@example.com');
    expect(rows[0]).toHaveTextContent('Linked to a login: yes');
    expect(rows[0]).toHaveTextContent('Added Jul 1, 2026');
    expect(rows[0]).toHaveTextContent('Founder');
    expect(rows[1]).toHaveTextContent('new.admin@example.com');
    expect(rows[1]).toHaveTextContent('Linked to a login: not yet');
    expect(rows[1]).toHaveTextContent('Added Aug 15, 2026');
  });

  it('P-2: the overlap marker is on exactly the overlapping row', async () => {
    await renderLoaded();
    expect(screen.getAllByText(OVERLAP_MARKER)).toHaveLength(1);
    const [overlapping, other] = screen.getAllByTestId('table-admin');
    expect(within(overlapping).getByText(OVERLAP_MARKER)).toBeInTheDocument();
    expect(within(other).queryByText(OVERLAP_MARKER)).not.toBeInTheDocument();
  });

  it('P-3: the environment section heading and its address', async () => {
    await renderLoaded();
    expect(screen.getByText(ENV_HEADING)).toBeInTheDocument();
    const envRows = screen.getAllByTestId('env-admin');
    expect(envRows).toHaveLength(1);
    expect(envRows[0]).toHaveTextContent('extra@x.io');
  });

  it('P-3b: no env-only addresses says so', async () => {
    await renderLoaded({ ...LIST, envOnlyAdmins: [] });
    expect(screen.getByText('No addresses beyond the table.')).toBeInTheDocument();
  });

  it('P-8: an empty table, with no error, says so truthfully', async () => {
    await renderLoaded({ tableAdmins: [], envOnlyAdmins: [] });
    expect(screen.getByText(EMPTY_TABLE_TEXT)).toBeInTheDocument();
    expect(screen.queryByText(ERROR_TEXT)).not.toBeInTheDocument();
  });

  it('P-9: the info box names both sources and the doc path as text, with no /docs link', async () => {
    await renderLoaded();
    const info = screen.getByTestId('access-info');
    expect(info).toHaveTextContent('admin_users');
    expect(info).toHaveTextContent('ADMIN_EMAILS');
    expect(info).toHaveTextContent('docs/admin/ADMIN_IDENTIFICATION_AND_ACCESS.md § Bootstrapping Admins');
    expect(info).toHaveTextContent('within about a minute');
    expect(info).toHaveTextContent('needs a redeploy');
    const docLinks = Array.from(document.querySelectorAll('a')).filter((a) => (a.getAttribute('href') ?? '').includes('docs'));
    expect(docLinks).toHaveLength(0);
  });
});

describe('read-only', () => {
  it('P-4: no write control, no role text, no input; the only button is Refresh', async () => {
    await renderLoaded();
    const buttons = screen.getAllByRole('button');
    expect(buttons).toHaveLength(1);
    expect(buttons[0]).toHaveAccessibleName('Refresh');
    expect(screen.queryByRole('button', { name: /add|remove|delete|grant|revoke/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    expect(document.querySelectorAll('input, select, textarea, form')).toHaveLength(0);
    expect(screen.queryByText(/super admin/i)).not.toBeInTheDocument();
    expect(document.body.textContent ?? '').not.toMatch(/\brole\b/i);
  });

  it('P-5: every request, across mount and a Refresh click, is GET /api/admin/admins', async () => {
    const fetchMock = await renderLoaded();
    await userEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getByText(TABLE_HEADING)).toBeInTheDocument());
    for (const [url, init] of fetchMock.mock.calls) {
      expect(url).toBe('/api/admin/admins');
      expect((init?.method ?? 'GET').toUpperCase()).toBe('GET');
      expect(url).not.toMatch(/settings\/(admin|platform)-users/);
    }
  });
});

describe('never a list it cannot vouch for (SA W-3)', () => {
  it('P-6: a 500 shows the error state and no list', async () => {
    stubFetch({ status: 500, body: { success: false, error: 'Failed to load admin list' } });
    render(<AdminUsersPage />);
    await waitFor(() => expect(screen.getByText(ERROR_TEXT)).toBeInTheDocument());
    expectNoList();
  });

  it('P-6: a 200 with success: false is an error', async () => {
    stubFetch({ status: 200, body: { success: false, error: 'nope' } });
    render(<AdminUsersPage />);
    await waitFor(() => expect(screen.getByText(ERROR_TEXT)).toBeInTheDocument());
    expectNoList();
  });

  it.each([
    ['no data', { success: true }],
    ['tableAdmins missing', { success: true, data: { envOnlyAdmins: [] } }],
    ['envOnlyAdmins not an array', { success: true, data: { tableAdmins: [], envOnlyAdmins: null } }],
    ['tableAdmins an object', { success: true, data: { tableAdmins: {}, envOnlyAdmins: [] } }],
    ['not an object', 'ok'],
  ])('P-6 (W-3a): a malformed 200 (%s) is an error, not "No active rows"', async (_label, body) => {
    stubFetch({ status: 200, body });
    render(<AdminUsersPage />);
    await waitFor(() => expect(screen.getByText(ERROR_TEXT)).toBeInTheDocument());
    expectNoList();
  });

  it('P-7: a network rejection shows the error state and logs a warning with no address', async () => {
    stubFetch('reject');
    render(<AdminUsersPage />);
    await waitFor(() => expect(screen.getByText(ERROR_TEXT)).toBeInTheDocument());
    expectNoList();
    expect(mockWarn).toHaveBeenCalledWith(expect.objectContaining({ err: expect.any(Error) }), 'Admin list request failed');
    for (const args of mockWarn.mock.calls) expect(JSON.stringify(args)).not.toContain('@');
  });

  it('P-10 (W-3b): a failed refresh after a good load clears the list', async () => {
    stubFetch(ok(), { status: 500, body: { success: false, error: 'Failed to load admin list' } });
    render(<AdminUsersPage />);
    await waitFor(() => expect(screen.getByText(TABLE_HEADING)).toBeInTheDocument());
    expect(screen.getAllByTestId('table-admin')).toHaveLength(2);

    await userEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    await waitFor(() => expect(screen.getByText(ERROR_TEXT)).toBeInTheDocument());
    expectNoList();
    expect(screen.queryByText('ops@example.com')).not.toBeInTheDocument();
  });

  it('P-11 (QA): a slow, failing earlier response cannot overwrite a newer good one', async () => {
    // StrictMode mounts effects twice, so two loads race. The first is held and
    // then fails AFTER the second has rendered the list; the page must ignore it.
    let releaseFirst!: () => void;
    const firstHeld = new Promise<void>((resolve) => { releaseFirst = resolve; });
    let calls = 0;
    const fetchMock = jest.fn(async () => {
      calls += 1;
      if (calls === 1) {
        await firstHeld;
        return { ok: false, status: 500, json: async () => ({ success: false, error: 'Failed to load admin list' }) };
      }
      return { ok: true, status: 200, json: async () => ({ success: true, data: LIST }) };
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    render(<StrictMode><AdminUsersPage /></StrictMode>);
    await waitFor(() => expect(screen.getByText(TABLE_HEADING)).toBeInTheDocument());
    expect(fetchMock).toHaveBeenCalledTimes(2);

    await act(async () => {
      releaseFirst();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(screen.queryByText(ERROR_TEXT)).not.toBeInTheDocument();
    expect(screen.getAllByTestId('table-admin')).toHaveLength(2);
    expect(mockWarn).not.toHaveBeenCalled();
  });
});

describe('source: properties no render can reach', () => {
  const source = fs.readFileSync(path.join(process.cwd(), 'app/admin/settings/page.tsx'), 'utf8');
  // Line comments first, so a `//` line cannot open a fake block comment.
  const code = source.replace(/(^|[^:])\/\/.*$/gm, '$1').replace(/\/\*[\s\S]*?\*\//g, '');

  it('stays a client component and logs through the client Pino logger, never console', () => {
    expect(source.startsWith("'use client';")).toBe(true);
    expect(code).toMatch(/from '@\/lib\/logger\/client'/);
    expect(code).not.toMatch(/\bconsole\./);
  });

  it('names neither old management route anywhere in the file', () => {
    expect(source).not.toMatch(/settings\/admin-users|settings\/platform-users/);
    expect(code).toContain("'/api/admin/admins'");
  });

  it('W-5: imports the shared list types type-only', () => {
    const imports = code.split('\n').filter((line) => line.includes("'@/lib/admin/adminList-types'"));
    expect(imports).toHaveLength(1);
    expect(imports[0]).toMatch(/^import type \{/);
  });

  it('W-5: the types module has no runtime code and imports nothing', () => {
    const types = fs
      .readFileSync(path.join(process.cwd(), 'lib/admin/adminList-types.ts'), 'utf8')
      .replace(/(^|[^:])\/\/.*$/gm, '$1')
      .replace(/\/\*[\s\S]*?\*\//g, '');
    expect(types).not.toMatch(/^\s*import\b/m);
    expect(types).not.toMatch(/export\s+(const|let|var|function|class|enum|default)\b/);
  });
});
