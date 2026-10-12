/**
 * @jest-environment jsdom
 */

/**
 * Characterisation of `/admin/messages` (Admin Layout Standard L-7, workplan
 * §6.1, B-1 to B-15). Written against the page as it was at `46a69ad3`, before
 * any source edit, and run green there (V-0). The migration may change this
 * file only where the workplan names a deliberate flip (§6.2: B-5, B-12, B-13,
 * B-14) or one of the two query helpers (`statusSelect`, `deleteButtonFor`);
 * any other edit is a review finding (SA S-7).
 *
 * The queries are chosen to survive the migration where the behaviour does:
 * requests are asserted on the fetch mock, the detail is found by text that
 * the old modal and the new drawer both show ("No admin notes yet.").
 */

import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

jest.mock('@/lib/logger/client', () => {
  const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(), child: jest.fn() };
  logger.child.mockReturnValue(logger);
  return { clientLogger: logger };
});

let mockSearch = '';
jest.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(mockSearch),
}));

import AdminMessages from '../page';

const DANA = {
  id: 'msg-1',
  name: 'Dana Example',
  email: 'dana@example.test',
  message: 'Hello, I would like to know the price.',
  subject: 'Pricing question',
  status: 'unread',
  email_sent: false,
  created_at: '2026-10-11T09:00:00Z',
  priority: 'high',
  replies: [],
};

const OREN = {
  id: 'msg-2',
  name: 'Oren Sample',
  email: 'oren@example.test',
  message: 'Thanks for the demo.',
  status: 'read',
  email_sent: false,
  created_at: '2026-10-10T08:00:00Z',
  priority: 'normal',
  replies: [],
};

const LIOR = {
  id: 'msg-3',
  name: 'Lior Test',
  email: 'lior@example.test',
  message: 'Following up on my earlier note.',
  status: 'replied',
  email_sent: true,
  created_at: '2026-10-09T07:00:00Z',
  replies: [],
};

interface ResponseLike {
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
}

const answer = (status: number, body: unknown): ResponseLike => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
});

/** The route answers oldest first here, so the page's own newest-first sort is what B-2 sees. */
let listAnswer: () => Promise<ResponseLike>;

function mockFetch(): jest.Mock {
  const fetchMock = jest.fn((url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    if (method === 'GET' && String(url).startsWith('/api/admin/messages?')) return listAnswer();
    if (method === 'POST') return Promise.resolve(answer(200, { reply_id: 'reply-1' }));
    return Promise.resolve(answer(200, { success: true }));
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- jsdom has no fetch; standard test stub
  (global as any).fetch = fetchMock;
  return fetchMock;
}

type Call = { url: string; method: string; body: Record<string, unknown> | null };

const calls = (mock: jest.Mock): Call[] =>
  mock.mock.calls.map(([url, init]: [string, RequestInit | undefined]) => ({
    url: String(url),
    method: init?.method ?? 'GET',
    body: typeof init?.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : null,
  }));

const reads = (mock: jest.Mock) => calls(mock).filter((c) => c.method === 'GET');
const writes = (mock: jest.Mock) => calls(mock).filter((c) => c.method !== 'GET');
const readQuery = (call: Call) => new URLSearchParams(call.url.split('?')[1]);

/** Let the mocked reads and their state updates land. */
async function flush() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
}

/** Let the 300 ms search pause pass, and then some. */
async function pastTheDebounce() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 450));
  });
}

async function renderPage() {
  render(<AdminMessages />);
  await flush();
  await screen.findByText('Dana Example');
}

const table = () => screen.getByRole('table');
const rowOf = (name: string) => within(table()).getByText(name).closest('tr') as HTMLTableRowElement;
const searchBox = () => screen.getByPlaceholderText('Search messages...') as HTMLInputElement;
/** §6.2 helper 1 (L-7 edit): by its visible label (by role before the migration, when it had none). */
const statusSelect = () => screen.getByLabelText('Status') as HTMLSelectElement;
/** §6.2 helper 2 (L-7 edit): by its accessible name (by `title` before the migration, when it had none). */
const deleteButtonFor = (name: string) => within(rowOf(name)).getByRole('button', { name: `Delete message from ${name}` });

let confirmSpy: jest.SpyInstance;

beforeEach(() => {
  jest.clearAllMocks();
  mockSearch = '';
  window.history.replaceState(null, '', '/admin/messages');
  listAnswer = async () => answer(200, { messages: [LIOR, OREN, DANA] });
  confirmSpy = jest.spyOn(window, 'confirm').mockReturnValue(true);
});

afterEach(() => {
  confirmSpy.mockRestore();
});

describe('L-7 characterisation (B-1 to B-15)', () => {
  it('B-1: the first read is exactly one GET with filter=all and an empty search', async () => {
    const fetchMock = mockFetch();
    await renderPage();
    expect(calls(fetchMock).map((c) => c.url)).toEqual(['/api/admin/messages?filter=all&search=']);
  });

  it('B-2: rows show name, email, subject and message, newest first', async () => {
    mockFetch();
    await renderPage();
    const row = rowOf('Dana Example');
    expect(row.textContent).toContain('dana@example.test');
    expect(row.textContent).toContain('Pricing question');
    expect(row.textContent).toContain('Hello, I would like to know the price.');
    const order = ['Dana Example', 'Oren Sample', 'Lior Test'].map((name) => rowOf(name));
    expect(order[0].compareDocumentPosition(order[1]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(order[1].compareDocumentPosition(order[2]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('B-3: choosing Unread reads with filter=unread', async () => {
    const fetchMock = mockFetch();
    await renderPage();
    fireEvent.change(statusSelect(), { target: { value: 'unread' } });
    await flush();
    const last = reads(fetchMock).at(-1) as Call;
    expect(last.url).toBe('/api/admin/messages?filter=unread&search=');
    expect(reads(fetchMock)).toHaveLength(2);
  });

  it('B-4: typing a search sends one GET after the 300 ms pause, none before', async () => {
    const fetchMock = mockFetch();
    await renderPage();
    fireEvent.change(searchBox(), { target: { value: 'dana' } });
    expect(reads(fetchMock)).toHaveLength(1);
    await pastTheDebounce();
    await flush();
    expect(reads(fetchMock)).toHaveLength(2);
    expect(readQuery(reads(fetchMock)[1]).get('search')).toBe('dana');
  });

  // FLIPPED by L-7 (D-16, SA Q-2): emptying the box now reloads (was: no new GET).
  it('B-5: emptying the search sends one GET with an empty search', async () => {
    const fetchMock = mockFetch();
    await renderPage();
    fireEvent.change(searchBox(), { target: { value: 'dana' } });
    await pastTheDebounce();
    await flush();
    await screen.findByText('Dana Example');
    expect(reads(fetchMock)).toHaveLength(2);
    fireEvent.change(searchBox(), { target: { value: '' } });
    await pastTheDebounce();
    await flush();
    expect(reads(fetchMock)).toHaveLength(3);
    expect(reads(fetchMock)[2].url).toBe('/api/admin/messages?filter=all&search=');
  });

  it('B-6: a click on an unread row sends one PATCH {status: read, updated_at}, then the detail shows the message', async () => {
    const fetchMock = mockFetch();
    await renderPage();
    fireEvent.click(within(rowOf('Dana Example')).getByText('Dana Example'));
    await flush();
    const sent = writes(fetchMock);
    expect(sent).toHaveLength(1);
    expect(sent[0].url).toBe('/api/admin/messages/msg-1');
    expect(sent[0].method).toBe('PATCH');
    expect(Object.keys(sent[0].body ?? {}).sort()).toEqual(['status', 'updated_at']);
    expect(sent[0].body?.status).toBe('read');
    expect(new Date(String(sent[0].body?.updated_at)).toISOString()).toBe(sent[0].body?.updated_at);
    expect(await screen.findByText('No admin notes yet.')).toBeTruthy();
    expect(screen.getAllByText('Hello, I would like to know the price.')).toHaveLength(2);
  });

  it('B-7: a click on a read row sends nothing and shows the detail', async () => {
    const fetchMock = mockFetch();
    await renderPage();
    fireEvent.click(within(rowOf('Oren Sample')).getByText('Oren Sample'));
    await flush();
    expect(writes(fetchMock)).toHaveLength(0);
    expect(await screen.findByText('No admin notes yet.')).toBeTruthy();
    expect(screen.getAllByText('Thanks for the demo.')).toHaveLength(2);
  });

  it('B-8: Mark as Unread sends PATCH {status: unread, updated_at}', async () => {
    const fetchMock = mockFetch();
    await renderPage();
    fireEvent.click(within(rowOf('Oren Sample')).getByText('Oren Sample'));
    await flush();
    fireEvent.click(await screen.findByRole('button', { name: 'Mark as Unread' }));
    await flush();
    const sent = writes(fetchMock);
    expect(sent).toHaveLength(1);
    expect(sent[0].url).toBe('/api/admin/messages/msg-2');
    expect(sent[0].method).toBe('PATCH');
    expect(Object.keys(sent[0].body ?? {}).sort()).toEqual(['status', 'updated_at']);
    expect(sent[0].body?.status).toBe('unread');
  });

  it('B-9: Edit, type, Save sends PATCH {admin_notes, updated_at}; the note shows after', async () => {
    const fetchMock = mockFetch();
    await renderPage();
    fireEvent.click(within(rowOf('Oren Sample')).getByText('Oren Sample'));
    await flush();
    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }));
    fireEvent.change(screen.getByPlaceholderText('Add internal notes about this message...'), {
      target: { value: 'Called back on Monday' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await flush();
    const sent = writes(fetchMock);
    expect(sent).toHaveLength(1);
    expect(sent[0].url).toBe('/api/admin/messages/msg-2');
    expect(sent[0].method).toBe('PATCH');
    expect(sent[0].body).toEqual({ admin_notes: 'Called back on Monday', updated_at: expect.any(String) });
    expect(await screen.findByText('Called back on Monday')).toBeTruthy();
  });

  it('B-10: Delete with confirm true sends DELETE and drops the row; with confirm false nothing is sent', async () => {
    const fetchMock = mockFetch();
    await renderPage();
    confirmSpy.mockReturnValue(false);
    fireEvent.click(deleteButtonFor('Dana Example'));
    await flush();
    expect(confirmSpy).toHaveBeenCalledWith('Are you sure you want to delete this message?');
    expect(writes(fetchMock)).toHaveLength(0);

    confirmSpy.mockReturnValue(true);
    fireEvent.click(deleteButtonFor('Dana Example'));
    await flush();
    const sent = writes(fetchMock);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toEqual({ url: '/api/admin/messages/msg-1', method: 'DELETE', body: null });
    await waitFor(() => expect(within(table()).queryByText('Dana Example')).toBeNull());
  });

  it('B-11: Mark All Read with confirm true sends one PATCH per unread row then one GET; confirm false sends nothing', async () => {
    const fetchMock = mockFetch();
    const second = { ...DANA, id: 'msg-4', name: 'Noa Unread', created_at: '2026-10-08T07:00:00Z' };
    listAnswer = async () => answer(200, { messages: [LIOR, OREN, DANA, second] });
    await renderPage();

    confirmSpy.mockReturnValue(false);
    fireEvent.click(screen.getByRole('button', { name: 'Mark All Read' }));
    await flush();
    expect(confirmSpy).toHaveBeenCalledWith('Mark all messages as read?');
    expect(writes(fetchMock)).toHaveLength(0);
    expect(reads(fetchMock)).toHaveLength(1);

    confirmSpy.mockReturnValue(true);
    fireEvent.click(screen.getByRole('button', { name: 'Mark All Read' }));
    await flush();
    await flush();
    const sent = writes(fetchMock);
    expect(sent.map((c) => `${c.method} ${c.url}`).sort()).toEqual([
      'PATCH /api/admin/messages/msg-1',
      'PATCH /api/admin/messages/msg-4',
    ]);
    for (const call of sent) expect(call.body).toEqual({ status: 'read', updated_at: expect.any(String) });
    expect(reads(fetchMock)).toHaveLength(2);
  });

  // FLIPPED by L-7 (F-9): a failed read says so (was: "No messages found").
  it('B-12: a failed GET (500) shows the route\'s words in messages-error, never "No messages found"', async () => {
    mockFetch();
    listAnswer = async () => answer(500, { error: 'Failed to fetch messages' });
    render(<AdminMessages />);
    await flush();
    expect((await screen.findByTestId('messages-error')).textContent).toBe('Failed to fetch messages');
    expect(screen.queryByText('No messages found')).toBeNull();
  });

  // FLIPPED by L-7 (D-14 (b), R-15): no Reply control anywhere (was: a Reply that posted to …/reply).
  it('B-13: there is no Reply control, in the table or the detail', async () => {
    const fetchMock = mockFetch();
    await renderPage();
    expect(screen.queryAllByRole('button', { name: /reply/i })).toHaveLength(0);
    fireEvent.click(within(rowOf('Oren Sample')).getByText('Oren Sample'));
    await screen.findByText('No admin notes yet.');
    expect(screen.queryAllByRole('button', { name: /reply/i })).toHaveLength(0);
    expect(calls(fetchMock).some((c) => /\/repl(y|ay)/.test(c.url))).toBe(false);
  });

  // FLIPPED by L-7 (D-3 (a)): the h1 equals the sidebar label (was: "Contact Messages").
  it('B-14: the h1 is "Messages"', async () => {
    mockFetch();
    await renderPage();
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Messages');
  });

  it('B-15: no PATCH, DELETE or POST on load, on a status change, or on a search', async () => {
    const fetchMock = mockFetch();
    await renderPage();
    fireEvent.change(statusSelect(), { target: { value: 'read' } });
    await flush();
    fireEvent.change(searchBox(), { target: { value: 'oren' } });
    await pastTheDebounce();
    await flush();
    expect(writes(fetchMock)).toHaveLength(0);
    expect(reads(fetchMock).length).toBeGreaterThanOrEqual(3);
  });
});
