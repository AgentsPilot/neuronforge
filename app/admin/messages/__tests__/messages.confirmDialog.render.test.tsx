/**
 * @jest-environment jsdom
 */

/**
 * LF-3b (Admin Layout Follow-ups §3.3, AC-3.3, SA-C11): Delete and Mark All
 * Read ask in an admin dialog instead of the browser's native box.
 *
 * C-1 focus on open, C-2 Enter on open sends nothing, C-3 Cancel and Escape
 * send nothing, C-4 the action sends exactly today's requests, C-5 a double
 * click sends once, C-6 no close while in flight, C-7 focus return, C-8 the
 * D-19 failure lines. Requests are asserted on the fetch mock.
 */

import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

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
  status: 'unread',
  email_sent: false,
  created_at: '2026-10-11T09:00:00Z',
  priority: 'high',
  replies: [],
};

const NOA = { ...DANA, id: 'msg-4', name: 'Noa Unread', created_at: '2026-10-08T07:00:00Z' };

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

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

let listAnswer: () => Promise<ResponseLike>;
let patchAnswer: (id: string) => Promise<ResponseLike>;
let deleteAnswer: (id: string) => Promise<ResponseLike>;

function mockFetch(): jest.Mock {
  const fetchMock = jest.fn((url: string, init?: RequestInit) => {
    const text = String(url);
    const method = init?.method ?? 'GET';
    const id = text.replace('/api/admin/messages/', '');
    if (method === 'GET' && text.startsWith('/api/admin/messages?')) return listAnswer();
    if (method === 'PATCH') return patchAnswer(id);
    if (method === 'DELETE') return deleteAnswer(id);
    return Promise.resolve(answer(404, { error: 'not mocked' }));
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- jsdom has no fetch; standard test stub
  (global as any).fetch = fetchMock;
  return fetchMock;
}

const methodOf = (call: unknown[]) => (call[1] as RequestInit | undefined)?.method ?? 'GET';
const writes = (mock: jest.Mock) => mock.mock.calls.filter((call) => methodOf(call) !== 'GET');
const reads = (mock: jest.Mock) => mock.mock.calls.filter((call) => methodOf(call) === 'GET');

async function flush() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
}

async function renderPage() {
  render(<AdminMessages />);
  await flush();
  await screen.findByRole('table', { name: 'Messages' });
}

const DELETE_QUESTION = 'Are you sure you want to delete this message?';
const MARK_ALL_QUESTION = 'Mark all messages as read?';

const table = () => screen.getByRole('table', { name: 'Messages', hidden: true });
const rowOf = (name: string) => within(table()).queryByText(name)?.closest('tr') ?? null;
const deleteButtonFor = (name: string) =>
  screen.getByRole('button', { name: `Delete message from ${name}`, hidden: true }) as HTMLButtonElement;
const markAllButton = () => screen.getByRole('button', { name: 'Mark All Read', hidden: true }) as HTMLButtonElement;
const content = () => screen.getByTestId('messages-content');
const asked = (question: string) => screen.findByRole('dialog', { name: question });
const buttonIn = (dialog: HTMLElement, name: string) => within(dialog).getByRole('button', { name }) as HTMLButtonElement;

async function askDelete(name: string) {
  fireEvent.click(deleteButtonFor(name));
  return asked(DELETE_QUESTION);
}

async function askMarkAll() {
  fireEvent.click(markAllButton());
  return asked(MARK_ALL_QUESTION);
}

beforeEach(() => {
  jest.clearAllMocks();
  mockSearch = '';
  window.history.replaceState(null, '', '/admin/messages');
  listAnswer = async () => answer(200, { messages: [OREN, DANA, NOA] });
  patchAnswer = async () => answer(200, { message: {} });
  deleteAnswer = async () => answer(200, { success: true });
});

describe('C-0 the words', () => {
  it('Delete asks the native box question word for word, with Cancel and Delete', async () => {
    mockFetch();
    await renderPage();
    const dialog = await askDelete('Dana Example');
    expect(within(dialog).getByRole('heading').textContent).toBe(DELETE_QUESTION);
    expect(within(dialog).getAllByRole('button').map((b) => b.textContent)).toEqual(['Cancel', 'Delete', 'Close']);
  });

  it('Mark All Read asks the native box question word for word, with Cancel and Mark All Read', async () => {
    mockFetch();
    await renderPage();
    const dialog = await askMarkAll();
    expect(within(dialog).getByRole('heading').textContent).toBe(MARK_ALL_QUESTION);
    expect(within(dialog).getAllByRole('button').map((b) => b.textContent)).toEqual(['Cancel', 'Mark All Read', 'Close']);
  });
});

describe('C-1 initial focus is the non-destructive button', () => {
  it('Delete opens with focus on Cancel', async () => {
    mockFetch();
    await renderPage();
    const dialog = await askDelete('Dana Example');
    await waitFor(() => expect(document.activeElement).toBe(buttonIn(dialog, 'Cancel')));
  });

  it('Mark All Read opens with focus on Cancel', async () => {
    mockFetch();
    await renderPage();
    const dialog = await askMarkAll();
    await waitFor(() => expect(document.activeElement).toBe(buttonIn(dialog, 'Cancel')));
  });
});

describe('C-2 Enter on open sends nothing', () => {
  it('Delete: Enter closes the dialog and no DELETE is sent', async () => {
    const fetchMock = mockFetch();
    const user = userEvent.setup();
    await renderPage();
    const dialog = await askDelete('Dana Example');
    await waitFor(() => expect(document.activeElement).toBe(buttonIn(dialog, 'Cancel')));
    await user.keyboard('{Enter}');
    await flush();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(writes(fetchMock)).toHaveLength(0);
    expect(rowOf('Dana Example')).not.toBeNull();
  });

  it('Mark All Read: Enter closes the dialog, no PATCH and no re-read', async () => {
    const fetchMock = mockFetch();
    const user = userEvent.setup();
    await renderPage();
    const dialog = await askMarkAll();
    await waitFor(() => expect(document.activeElement).toBe(buttonIn(dialog, 'Cancel')));
    await user.keyboard('{Enter}');
    await flush();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(writes(fetchMock)).toHaveLength(0);
    expect(reads(fetchMock)).toHaveLength(1);
  });
});

describe('C-3 Cancel and Escape send nothing', () => {
  it('Delete: Cancel, then Escape, each close with no request', async () => {
    const fetchMock = mockFetch();
    await renderPage();
    fireEvent.click(buttonIn(await askDelete('Dana Example'), 'Cancel'));
    await flush();
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.keyDown(await askDelete('Dana Example'), { key: 'Escape' });
    await flush();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(fetchMock.mock.calls).toHaveLength(1);
  });

  it('Mark All Read: Cancel, then Escape, each close with no request', async () => {
    const fetchMock = mockFetch();
    await renderPage();
    fireEvent.click(buttonIn(await askMarkAll(), 'Cancel'));
    await flush();
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.keyDown(await askMarkAll(), { key: 'Escape' });
    await flush();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(fetchMock.mock.calls).toHaveLength(1);
  });
});

describe('C-4 the action sends exactly the requests of before', () => {
  it('Delete: one fetch, the same URL and init { method: DELETE }, and the row leaves', async () => {
    const fetchMock = mockFetch();
    await renderPage();
    const dialog = await askDelete('Dana Example');
    await act(async () => {
      fireEvent.click(buttonIn(dialog, 'Delete'));
    });
    await flush();
    expect(writes(fetchMock)).toEqual([['/api/admin/messages/msg-1', { method: 'DELETE' }]]);
    expect(reads(fetchMock)).toHaveLength(1);
    expect(rowOf('Dana Example')).toBeNull();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('Mark All Read: one status PATCH per unread row, the same init, then exactly one re-read', async () => {
    const fetchMock = mockFetch();
    await renderPage();
    const dialog = await askMarkAll();
    await act(async () => {
      fireEvent.click(buttonIn(dialog, 'Mark All Read'));
    });
    await flush();
    await flush();
    const sent = writes(fetchMock);
    expect(sent.map((call) => call[0]).sort()).toEqual(['/api/admin/messages/msg-1', '/api/admin/messages/msg-4']);
    for (const [, init] of sent as Array<[string, RequestInit]>) {
      expect(init.method).toBe('PATCH');
      expect(init.headers).toEqual({ 'Content-Type': 'application/json' });
      expect(JSON.parse(String(init.body))).toEqual({ status: 'read', updated_at: expect.any(String) });
      expect(Object.keys(init).sort()).toEqual(['body', 'headers', 'method']);
    }
    expect(reads(fetchMock).map((call) => call[0])).toEqual([
      '/api/admin/messages?filter=all&search=',
      '/api/admin/messages?filter=all&search=',
    ]);
  });
});

describe('C-5 one send per confirmation', () => {
  it('Delete: two clicks before a re-render send one DELETE', async () => {
    const fetchMock = mockFetch();
    const pending = deferred<ResponseLike>();
    deleteAnswer = () => pending.promise;
    await renderPage();
    const action = buttonIn(await askDelete('Dana Example'), 'Delete');
    act(() => {
      action.click();
      action.click();
    });
    fireEvent.click(action);
    await act(async () => pending.resolve(answer(200, { success: true })));
    await flush();
    expect(writes(fetchMock)).toHaveLength(1);
  });

  it('Delete: a double click sends one DELETE', async () => {
    const fetchMock = mockFetch();
    const user = userEvent.setup();
    await renderPage();
    const action = buttonIn(await askDelete('Dana Example'), 'Delete');
    await user.dblClick(action);
    await flush();
    expect(writes(fetchMock)).toHaveLength(1);
  });

  it('Mark All Read: two clicks before a re-render send one fan-out and one re-read', async () => {
    const fetchMock = mockFetch();
    await renderPage();
    const action = buttonIn(await askMarkAll(), 'Mark All Read');
    await act(async () => {
      action.click();
      action.click();
    });
    await flush();
    await flush();
    expect(writes(fetchMock)).toHaveLength(2);
    expect(reads(fetchMock)).toHaveLength(2);
  });
});

describe('C-6 no close while the request is in flight', () => {
  it('Delete: Escape, Cancel and the corner close do nothing until the DELETE settles; then it closes', async () => {
    mockFetch();
    const pending = deferred<ResponseLike>();
    deleteAnswer = () => pending.promise;
    await renderPage();
    const dialog = await askDelete('Dana Example');
    await act(async () => {
      fireEvent.click(buttonIn(dialog, 'Delete'));
    });
    expect(buttonIn(dialog, 'Cancel').disabled).toBe(true);
    expect(buttonIn(dialog, 'Delete').disabled).toBe(true);
    fireEvent.keyDown(dialog, { key: 'Escape' });
    fireEvent.click(buttonIn(dialog, 'Cancel'));
    fireEvent.click(buttonIn(dialog, 'Close'));
    await flush();
    expect(screen.getByRole('dialog', { name: DELETE_QUESTION })).toBe(dialog);
    await act(async () => pending.resolve(answer(200, { success: true })));
    await flush();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('Mark All Read: Escape and the corner close do nothing until the fan-out settles', async () => {
    mockFetch();
    const pending = deferred<ResponseLike>();
    patchAnswer = () => pending.promise;
    await renderPage();
    const dialog = await askMarkAll();
    await act(async () => {
      fireEvent.click(buttonIn(dialog, 'Mark All Read'));
    });
    fireEvent.keyDown(dialog, { key: 'Escape' });
    fireEvent.click(buttonIn(dialog, 'Close'));
    await flush();
    expect(screen.getByRole('dialog', { name: MARK_ALL_QUESTION })).toBe(dialog);
    await act(async () => pending.resolve(answer(200, { message: {} })));
    await flush();
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

describe('C-7 focus returns to the opener, or to the content area, never body', () => {
  it("Delete cancelled: back to that row's Delete button", async () => {
    mockFetch();
    await renderPage();
    fireEvent.click(buttonIn(await askDelete('Dana Example'), 'Cancel'));
    await waitFor(() => expect(document.activeElement).toBe(deleteButtonFor('Dana Example')));
  });

  it('Delete done: the row is gone, so the content area', async () => {
    mockFetch();
    await renderPage();
    const dialog = await askDelete('Dana Example');
    await act(async () => {
      fireEvent.click(buttonIn(dialog, 'Delete'));
    });
    await flush();
    expect(rowOf('Dana Example')).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(content()));
  });

  it('Mark All Read cancelled: back to the header button', async () => {
    mockFetch();
    await renderPage();
    fireEvent.click(buttonIn(await askMarkAll(), 'Cancel'));
    await waitFor(() => expect(document.activeElement).toBe(markAllButton()));
  });

  it('Mark All Read done: nothing is unread, the button is gone, so the content area', async () => {
    mockFetch();
    await renderPage();
    listAnswer = async () => answer(200, { messages: [OREN, { ...DANA, status: 'read' }, { ...NOA, status: 'read' }] });
    const dialog = await askMarkAll();
    await act(async () => {
      fireEvent.click(buttonIn(dialog, 'Mark All Read'));
    });
    await flush();
    await flush();
    expect(screen.queryByRole('button', { name: 'Mark All Read', hidden: true })).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(content()));
    expect(document.activeElement).not.toBe(document.body);
  });
});

describe('C-8 failures keep the D-19 short lines', () => {
  it('a failed DELETE closes the dialog, keeps the row with its line, and focus is back on its Delete', async () => {
    mockFetch();
    deleteAnswer = async () => answer(500, { error: 'route_error_probe' });
    await renderPage();
    const dialog = await askDelete('Dana Example');
    await act(async () => {
      fireEvent.click(buttonIn(dialog, 'Delete'));
    });
    await flush();
    expect(screen.queryByRole('dialog')).toBeNull();
    const row = rowOf('Dana Example');
    expect(row).not.toBeNull();
    expect(within(row as HTMLElement).getByTestId('delete-failed').textContent).toBe('Could not delete the message. Try again.');
    expect(document.body.textContent).not.toContain('route_error_probe');
    await waitFor(() => expect(document.activeElement).toBe(deleteButtonFor('Dana Example')));
  });

  it('a rejected DELETE shows the same line', async () => {
    mockFetch();
    deleteAnswer = () => Promise.reject(new TypeError('Failed to fetch'));
    await renderPage();
    const dialog = await askDelete('Dana Example');
    await act(async () => {
      fireEvent.click(buttonIn(dialog, 'Delete'));
    });
    await flush();
    expect(screen.getByTestId('delete-failed').textContent).toBe('Could not delete the message. Try again.');
  });

  it('a failed PATCH in the fan-out closes the dialog, shows the header line, and still reads once', async () => {
    const fetchMock = mockFetch();
    patchAnswer = async (id) => (id === 'msg-4' ? answer(500, { error: 'route_error_probe' }) : answer(200, { message: {} }));
    await renderPage();
    const dialog = await askMarkAll();
    await act(async () => {
      fireEvent.click(buttonIn(dialog, 'Mark All Read'));
    });
    await flush();
    await flush();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByTestId('mark-all-failed').textContent).toBe('Could not mark every message as read. Try again.');
    expect(reads(fetchMock)).toHaveLength(2);
    expect(document.body.textContent).not.toContain('route_error_probe');
  });
});
