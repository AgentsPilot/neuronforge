/**
 * @jest-environment jsdom
 */

/**
 * Audit trail as the Admin Layout Standard L-1c pilot (part 1): the shared
 * header, the full filter bar, the URL filter state (C-7) with every inbound
 * link of the L-1c workplan §4.2, and the shared loading / empty / error
 * states. A new file, so the existing Audit trail pins stay exactly as they
 * were (the `health.layout` / `jobsQueues.layout` precedent).
 *
 * The address bar is read through `window.location.search` (the hook writes
 * with the real jsdom `history.replaceState`); requests through the fetch
 * mock. `useSearchParams` is mocked over the arrival string and, like jsdom,
 * never echoes a write.
 */

import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';

jest.mock('@/components/UserProvider', () => ({
  useAuth: () => ({ user: { id: 'admin-user', email: 'admin@example.com' } }),
}));

// The original account picker still logs through `createLogger` (until L-1d).
jest.mock('@/lib/logger', () => ({
  createLogger: () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    child: jest.fn().mockReturnThis(),
  }),
}));

const mockLogError = jest.fn();
// RC-1: the page logs through `clientLogger.child`.
jest.mock('@/lib/logger/client', () => {
  const noop = () => undefined;
  return {
    clientLogger: {
      child: () => ({ error: (...args: unknown[]) => mockLogError(...args), warn: noop, info: noop, debug: noop }),
    },
  };
});

let mockSearch = '';
jest.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(mockSearch),
}));

import { ARCHIVING_OVERVIEW_URL } from '@/hooks/useLatestArchiveCutoff';
import { ADMIN_NETWORK_ERROR } from '@/app/admin/components/layout/readAdminResponse';
import { resolveAdminWindow } from '@/app/admin/components/adminWindowPresets';

import AuditTrailPage from '../page';

const ACCOUNT = '99999999-9999-4999-8999-999999999999';
const PATH = '/admin/audit-trail';

const ROW = {
  id: 'log-1',
  user_id: null,
  action: 'USER_LOGIN',
  entity_type: 'user',
  entity_id: 'entity-1',
  resource_name: 'Front desk',
  details: null,
  changes: null,
  severity: 'info',
  created_at: '2026-10-10T09:00:00.000Z',
  compliance_flags: [],
};

type Answer =
  | { kind: 'rows'; logs: unknown[] }
  | { kind: 'json'; status: number; body: unknown }
  | { kind: 'html'; status: number }
  | { kind: 'network' }
  | { kind: 'pending' };

let answer: Answer = { kind: 'rows', logs: [] };

function respond(current: Answer): Promise<unknown> {
  switch (current.kind) {
    case 'rows':
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          logs: current.logs,
          pagination: { page: 1, pageSize: 20, total: current.logs.length, totalPages: 1, hasMore: false, showing: current.logs.length },
        }),
      });
    case 'json':
      return Promise.resolve({
        ok: current.status >= 200 && current.status < 300,
        status: current.status,
        json: async () => current.body,
      });
    case 'html':
      return Promise.resolve({
        ok: false,
        status: current.status,
        json: async () => {
          throw new SyntaxError("Unexpected token '<'");
        },
      });
    case 'network':
      return Promise.reject(new TypeError('Failed to fetch'));
    case 'pending':
      return new Promise(() => undefined);
  }
}

function mockFetch(): jest.Mock {
  const fetchMock = jest.fn((url: string) => {
    if (String(url) === ARCHIVING_OVERVIEW_URL) {
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ success: true, data: { runs: [] } }) });
    }
    return respond(answer);
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- jsdom has no fetch; standard test stub
  (global as any).fetch = fetchMock;
  return fetchMock;
}

const urls = (mock: jest.Mock): string[] => mock.mock.calls.map(([u]) => String(u));
const auditUrls = (mock: jest.Mock): string[] => urls(mock).filter((u) => u.startsWith('/api/admin/audit-trail?'));
const archiveCalls = (mock: jest.Mock): number => urls(mock).filter((u) => u === ARCHIVING_OVERVIEW_URL).length;
const query = (url: string) => new URLSearchParams(url.split('?')[1]);

/** Arrive at the page with this query, as a link would open it. */
function arrive(search: string) {
  window.history.replaceState(null, '', `${PATH}${search ? `?${search}` : ''}`);
  mockSearch = search;
}

/** Wait until the read in flight has settled (Refresh is enabled again). */
async function settled() {
  await waitFor(() =>
    expect((screen.getByRole('button', { name: 'Refresh the audit trail' }) as HTMLButtonElement).disabled).toBe(false),
  );
}

let pushSpy: jest.SpyInstance;

beforeEach(() => {
  jest.clearAllMocks();
  answer = { kind: 'rows', logs: [] };
  arrive('');
  pushSpy = jest.spyOn(window.history, 'pushState');
});

afterEach(() => {
  expect(pushSpy).not.toHaveBeenCalled();
  pushSpy.mockRestore();
});

describe('the standard header and bar', () => {
  it('keeps the header and bar while the first read is pending, with "Reading the audit trail…"', async () => {
    answer = { kind: 'pending' };
    mockFetch();
    render(<AuditTrailPage />);
    const headings = screen.getAllByRole('heading', { level: 1 });
    expect(headings).toHaveLength(1);
    expect(headings[0].textContent).toBe('Audit trail');
    expect(screen.getByRole('search', { name: 'Filters' })).toBeTruthy();
    expect(screen.getByRole('status').textContent).toBe('Reading the audit trail…');
  });

  it('once loaded: one h1 "Audit trail", no System Config pill, Export CSV, exactly one Refresh, and "Read at"', async () => {
    answer = { kind: 'rows', logs: [ROW] };
    mockFetch();
    render(<AuditTrailPage />);
    await settled();

    const headings = screen.getAllByRole('heading', { level: 1 });
    expect(headings).toHaveLength(1);
    expect(headings[0].textContent).toBe('Audit trail');
    // The pill is gone (F-30); "System Config Changed" is still an Action Type option.
    expect(screen.queryByText('System Config')).toBeNull();
    expect(screen.getByRole('button', { name: 'Export CSV' })).toBeTruthy();
    const refreshes = screen.getAllByRole('button', { name: /^Refresh/ });
    expect(refreshes).toHaveLength(1);
    expect(refreshes[0].getAttribute('aria-label')).toBe('Refresh the audit trail');
    expect(document.body.textContent).toMatch(/Read at \d{2}:\d{2} UTC/);
  });

  it('BOS AI failures shows its pressed state', async () => {
    mockFetch();
    render(<AuditTrailPage />);
    const toggle = await screen.findByTestId('preset-bos-ai-failures');
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(toggle);
    await waitFor(() => expect(screen.getByTestId('preset-bos-ai-failures').getAttribute('aria-pressed')).toBe('true'));
  });
});

describe('inbound links (workplan §4.2): the address bar after mount and the first request', () => {
  const today = new Date();
  const sevenDays = resolveAdminWindow('7d', today);

  it.each([
    {
      name: 'no query',
      arriving: '',
      bar: '',
      request: {},
    },
    {
      name: 'a Health figure link (minute bounds)',
      arriving: 'action=BUSINESS_AI_ACTION_FAILED&date_from=2026-09-25T10:30&date_to=2026-09-26T10:30',
      bar: '?range=custom&from=2026-09-25T10%3A30&to=2026-09-26T10%3A30&action=BUSINESS_AI_ACTION_FAILED',
      request: { date_from: '2026-09-25T10:30', date_to: '2026-09-26T10:30', action: 'BUSINESS_AI_ACTION_FAILED' },
    },
    {
      name: 'the cutover notice (one-sided to, user_id)',
      arriving: `entity_type=ai_action&date_to=2026-09-29T16:51&user_id=${ACCOUNT}`,
      bar: `?range=custom&to=2026-09-29T16%3A51&account=${ACCOUNT}&entity_type=ai_action`,
      request: { date_to: '2026-09-29T16:51', user_id: ACCOUNT, entity_type: 'ai_action' },
    },
    {
      name: 'the Businesses panel (user_id and search)',
      arriving: `action=BUSINESS_AI_ACTION_FAILED&user_id=${ACCOUNT}&search=grp-1`,
      bar: `?account=${ACCOUNT}&action=BUSINESS_AI_ACTION_FAILED`,
      request: { search: 'grp-1', user_id: ACCOUNT },
    },
    {
      name: 'a one-sided minute from (only date_from, SA M-4)',
      arriving: 'date_from=2026-09-25T10:30',
      bar: '?range=custom&from=2026-09-25T10%3A30',
      request: { date_from: '2026-09-25T10:30', date_to: null },
    },
    {
      name: 'range=7d',
      arriving: 'range=7d',
      bar: '?range=7d',
      request: { date_from: `${sevenDays.from}T00:00:00.000Z`, date_to: `${sevenDays.to}T23:59:59.999999Z` },
    },
    {
      name: 'a custom range',
      arriving: 'range=custom&from=2026-10-01&to=2026-10-05',
      bar: '?range=custom&from=2026-10-01&to=2026-10-05',
      request: { date_from: '2026-10-01T00:00:00.000Z', date_to: '2026-10-05T23:59:59.999999Z' },
    },
    {
      name: 'reversed dates',
      arriving: 'from=2026-10-05&to=2026-10-01',
      bar: '',
      request: { date_from: null, date_to: null },
    },
    {
      name: 'values the route would refuse',
      arriving: "range=bogus&severity=catastrophic&account=nope&action=a'b",
      bar: '',
      request: { severity: null, user_id: null, action: null, date_from: null },
    },
    {
      name: 'the canonical key beside its alias',
      arriving: 'date_from=2026-09-01&from=2026-09-10',
      bar: '?range=custom&from=2026-09-10',
      request: { date_from: '2026-09-10T00:00:00.000Z' },
    },
    {
      name: 'an unrelated key',
      arriving: 'tab=x&severity=info',
      bar: '?tab=x&severity=info',
      request: { severity: 'info' },
    },
  ])('$name', async ({ arriving, bar, request }) => {
    arrive(arriving);
    const fetchMock = mockFetch();
    render(<AuditTrailPage />);
    await waitFor(() => expect(auditUrls(fetchMock).length).toBe(1));
    await settled();

    expect(window.location.search).toBe(bar);
    const first = query(auditUrls(fetchMock)[0]);
    for (const [key, value] of Object.entries(request)) expect({ key, value: first.get(key) }).toEqual({ key, value });
    expect(auditUrls(fetchMock)).toHaveLength(1);
  });

  it('a Health link reaches the route byte for byte, as before', async () => {
    arrive('action=BUSINESS_AI_ACTION_FAILED&date_from=2026-09-25T10%3A30&date_to=2026-09-26T10%3A30');
    const fetchMock = mockFetch();
    render(<AuditTrailPage />);
    await waitFor(() => expect(auditUrls(fetchMock).length).toBe(1));
    expect(auditUrls(fetchMock)[0]).toBe(
      '/api/admin/audit-trail?action=BUSINESS_AI_ACTION_FAILED&date_from=2026-09-25T10%3A30&date_to=2026-09-26T10%3A30&page=1&page_size=20',
    );
  });

  it('shows the linked-window chip for a Health link, and its X goes back to every date', async () => {
    arrive('date_from=2026-09-25T10:30&date_to=2026-09-26T10:30');
    const fetchMock = mockFetch();
    render(<AuditTrailPage />);
    expect((await screen.findByTestId('linked-window-chip')).textContent).toBe(
      'Linked window 2026-09-25 10:30 to 2026-09-26 10:30 UTC',
    );
    await settled();

    fireEvent.click(screen.getByRole('button', { name: 'Remove linked window' }));
    await waitFor(() => expect(auditUrls(fetchMock).length).toBe(2));
    expect(query(auditUrls(fetchMock)[1]).get('date_from')).toBeNull();
    expect(query(auditUrls(fetchMock)[1]).get('date_to')).toBeNull();
    expect(window.location.search).toBe('');
    expect(screen.queryByTestId('linked-window-chip')).toBeNull();
  });

  it('shows "Linked window up to … UTC" for the cutover link', async () => {
    arrive(`entity_type=ai_action&date_to=2026-09-29T16:51&user_id=${ACCOUNT}`);
    mockFetch();
    render(<AuditTrailPage />);
    expect((await screen.findByTestId('linked-window-chip')).textContent).toBe('Linked window up to 2026-09-29 16:51 UTC');
    expect(await screen.findByTestId('business-filter-chip')).toBeTruthy();
  });

  it('the search from a link fills the Search box and never reaches the address bar', async () => {
    arrive(`user_id=${ACCOUNT}&search=grp-1`);
    mockFetch();
    render(<AuditTrailPage />);
    expect(((await screen.findByLabelText('Search')) as HTMLInputElement).value).toBe('grp-1');
    expect(window.location.search).toBe(`?account=${ACCOUNT}`);
  });
});

describe('changing filters', () => {
  it('a preset click asks once more with UTC instants and writes range=7d', async () => {
    const fetchMock = mockFetch();
    render(<AuditTrailPage />);
    await settled();

    fireEvent.click(screen.getByRole('button', { name: '7 days' }));
    await waitFor(() => expect(auditUrls(fetchMock).length).toBe(2));
    const expected = resolveAdminWindow('7d', new Date());
    const second = query(auditUrls(fetchMock)[1]);
    expect(second.get('date_from')).toBe(`${expected.from}T00:00:00.000Z`);
    expect(second.get('date_to')).toBe(`${expected.to}T23:59:59.999999Z`);
    expect(window.location.search).toBe('?range=7d');
    await settled();
    expect(auditUrls(fetchMock)).toHaveLength(2);
  });

  it('clicking the pressed preset again goes back to every date (SA M-2)', async () => {
    const fetchMock = mockFetch();
    render(<AuditTrailPage />);
    await settled();

    fireEvent.click(screen.getByRole('button', { name: '7 days' }));
    await waitFor(() => expect(auditUrls(fetchMock).length).toBe(2));
    await settled();
    fireEvent.click(screen.getByRole('button', { name: '7 days' }));
    await waitFor(() => expect(auditUrls(fetchMock).length).toBe(3));
    const third = query(auditUrls(fetchMock)[2]);
    expect(third.get('date_from')).toBeNull();
    expect(third.get('date_to')).toBeNull();
    expect(window.location.search).toBe('');
  });

  it('Custom + Apply asks with the whole UTC days and writes the range', async () => {
    const fetchMock = mockFetch();
    render(<AuditTrailPage />);
    await settled();

    fireEvent.click(screen.getByRole('button', { name: 'Custom' }));
    fireEvent.change(screen.getByLabelText('From (UTC)'), { target: { value: '2026-10-01' } });
    fireEvent.change(screen.getByLabelText('To (UTC)'), { target: { value: '2026-10-05' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));

    await waitFor(() => expect(auditUrls(fetchMock).length).toBe(2));
    const second = query(auditUrls(fetchMock)[1]);
    expect(second.get('date_from')).toBe('2026-10-01T00:00:00.000Z');
    expect(second.get('date_to')).toBe('2026-10-05T23:59:59.999999Z');
    expect(window.location.search).toBe('?range=custom&from=2026-10-01&to=2026-10-05');
  });

  it('From after To shows the alert and asks nothing more', async () => {
    const fetchMock = mockFetch();
    render(<AuditTrailPage />);
    await settled();

    fireEvent.click(screen.getByRole('button', { name: 'Custom' }));
    fireEvent.change(screen.getByLabelText('From (UTC)'), { target: { value: '2026-10-05' } });
    fireEvent.change(screen.getByLabelText('To (UTC)'), { target: { value: '2026-10-01' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));

    expect(screen.getByRole('alert').textContent).toBe('The start date must not be after the end date');
    await act(async () => {
      await Promise.resolve();
    });
    expect(auditUrls(fetchMock)).toHaveLength(1);
    expect(window.location.search).toBe('');
  });

  it('typing a search sends it, and the address bar never shows it', async () => {
    const fetchMock = mockFetch();
    render(<AuditTrailPage />);
    await settled();

    fireEvent.change(screen.getByLabelText('Search'), { target: { value: 'acme' } });
    await waitFor(() => expect(auditUrls(fetchMock).some((u) => query(u).get('search') === 'acme')).toBe(true));
    expect(window.location.search).toBe('');
  });

  it('Clear keeps only the unrelated key, and is then disabled', async () => {
    arrive('tab=x&severity=info&range=30d');
    const fetchMock = mockFetch();
    render(<AuditTrailPage />);
    await settled();

    const clear = screen.getByRole('button', { name: 'Clear' }) as HTMLButtonElement;
    expect(clear.disabled).toBe(false);
    fireEvent.click(clear);
    await waitFor(() => expect(auditUrls(fetchMock).length).toBe(2));
    expect(window.location.search).toBe('?tab=x');
    expect((screen.getByRole('button', { name: 'Clear' }) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('the F-28 mount pin', () => {
  it('a Health alias link costs exactly one list request plus the archive notice', async () => {
    arrive('action=BUSINESS_AI_ACTION_FAILED&date_from=2026-09-25T10:30&date_to=2026-09-26T10:30');
    const fetchMock = mockFetch();
    render(<AuditTrailPage />);
    await waitFor(() => expect(auditUrls(fetchMock).length).toBe(1));
    await settled();
    expect(urls(fetchMock).filter((u) => u !== ARCHIVING_OVERVIEW_URL)).toEqual(auditUrls(fetchMock));
    expect(auditUrls(fetchMock)).toHaveLength(1);
    expect(archiveCalls(fetchMock)).toBe(1);
  });

  it('the archive notice is read once, and still once after a filter change (SA M-3)', async () => {
    const fetchMock = mockFetch();
    render(<AuditTrailPage />);
    await settled();
    expect(archiveCalls(fetchMock)).toBe(1);

    fireEvent.change(screen.getByLabelText('Severity'), { target: { value: 'critical' } });
    await waitFor(() => expect(auditUrls(fetchMock).length).toBe(2));
    await settled();
    expect(archiveCalls(fetchMock)).toBe(1);
  });
});

describe('the shared states', () => {
  it('a 500 with a non-JSON body shows the fallback sentence', async () => {
    answer = { kind: 'html', status: 500 };
    mockFetch();
    render(<AuditTrailPage />);
    expect((await screen.findByTestId('audit-error')).textContent).toBe('Could not read the audit trail. Try again in a moment.');
  });

  it('a rejected fetch shows the network sentence and is logged', async () => {
    answer = { kind: 'network' };
    mockFetch();
    render(<AuditTrailPage />);
    expect((await screen.findByTestId('audit-error')).textContent).toBe(ADMIN_NETWORK_ERROR);
    expect(mockLogError).toHaveBeenCalled();
  });

  it('a 403 shows the session sentence (Q-9)', async () => {
    answer = { kind: 'json', status: 403, body: { success: false, error: 'Forbidden' } };
    mockFetch();
    render(<AuditTrailPage />);
    expect((await screen.findByTestId('audit-error')).textContent).toBe('Your admin session has ended. Sign in again.');
  });

  it('a failed Refresh keeps the rows on screen, and Try again reads again', async () => {
    answer = { kind: 'rows', logs: [ROW] };
    const fetchMock = mockFetch();
    render(<AuditTrailPage />);
    // L-1d: the card's h3 became the row's Event cell.
    expect(await screen.findByRole('cell', { name: 'User Login' })).toBeTruthy();
    await settled();

    answer = { kind: 'html', status: 502 };
    fireEvent.click(screen.getByRole('button', { name: 'Refresh the audit trail' }));
    expect(await screen.findByTestId('audit-error')).toBeTruthy();
    expect(screen.getByRole('cell', { name: 'User Login' })).toBeTruthy();

    answer = { kind: 'rows', logs: [ROW] };
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(screen.queryByTestId('audit-error')).toBeNull());
    expect(auditUrls(fetchMock)).toHaveLength(3);
  });

  it('an empty list shows the empty sentence, with "Clear filters" only when filtered', async () => {
    mockFetch();
    const { unmount } = render(<AuditTrailPage />);
    expect((await screen.findByTestId('audit-empty')).textContent).toContain('No audit events match these filters.');
    expect(screen.queryByRole('button', { name: 'Clear filters' })).toBeNull();
    unmount();

    arrive('severity=critical');
    const fetchMock = mockFetch();
    render(<AuditTrailPage />);
    await screen.findByTestId('audit-empty');
    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    await waitFor(() => expect(auditUrls(fetchMock).length).toBe(2));
    expect(query(auditUrls(fetchMock)[1]).get('severity')).toBeNull();
    expect(window.location.search).toBe('');
  });
});
