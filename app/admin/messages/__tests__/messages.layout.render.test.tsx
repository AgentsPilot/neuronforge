/**
 * @jest-environment jsdom
 */

/**
 * Messages on the Admin Layout Standard (slice L-7, workplan §6.3): T-1 to
 * T-18 and the D-19 action-failure cases T-21 to T-24 (SA M-1), with the D-17
 * row-click rules (SA M-3) and facts-only logging (SA M-4).
 *
 * jsdom like the sibling suites (Playwright is not installed: CLAUDE.md
 * § Testing). `next/navigation` is mocked with a settable search string, and
 * the real jsdom `history.replaceState` is spied on (the Businesses way).
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

import { clientLogger } from '@/lib/logger/client';
import { ADMIN_FIELD_CONTROL } from '@/app/admin/components/layout/AdminFilterBar';
import { ADMIN_NETWORK_ERROR } from '@/app/admin/components/layout/readAdminResponse';
import AdminMessages from '../page';

const PATH = '/admin/messages';

const DANA = {
  id: 'msg-1',
  name: 'Dana Example',
  email: 'dana@example.test',
  phone: '+1 555 0100',
  company: 'Example Dental',
  message: 'Hello, I would like to know the price.',
  subject: 'Pricing question',
  status: 'unread',
  email_sent: false,
  created_at: '2026-10-11T09:00:00Z',
  priority: 'high',
  source: 'contact_form',
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
  priority: 'urgent',
  replies: [
    { id: 'r-1', message_id: 'msg-3', sender: 'admin', content: 'We will call you.', created_at: '2026-10-09T08:00:00Z' },
  ],
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

let listAnswer: (query: URLSearchParams) => Promise<ResponseLike>;
let patchAnswer: (id: string, body: Record<string, unknown>) => Promise<ResponseLike>;
let deleteAnswer: (id: string) => Promise<ResponseLike>;

function mockFetch(): jest.Mock {
  const fetchMock = jest.fn((url: string, init?: RequestInit) => {
    const text = String(url);
    const method = init?.method ?? 'GET';
    const id = text.replace('/api/admin/messages/', '');
    if (method === 'GET' && text.startsWith('/api/admin/messages?')) {
      return listAnswer(new URLSearchParams(text.split('?')[1]));
    }
    if (method === 'PATCH') return patchAnswer(id, JSON.parse(String(init?.body)) as Record<string, unknown>);
    if (method === 'DELETE') return deleteAnswer(id);
    return Promise.resolve(answer(404, { error: 'not mocked' }));
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

async function flush() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
}

async function pastTheDebounce() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 450));
  });
}

function arrive(search: string) {
  window.history.replaceState(null, '', `${PATH}${search ? `?${search}` : ''}`);
  mockSearch = search;
}

async function renderPage() {
  const view = render(<AdminMessages />);
  await flush();
  await screen.findByRole('table', { name: 'Messages' });
  return view;
}

const table = () => screen.getByRole('table', { name: 'Messages', hidden: true });
const rowOf = (name: string) => within(table()).getByText(name).closest('tr') as HTMLTableRowElement;
const openButtonFor = (name: string) =>
  screen.getByRole('button', { name: `Open message from ${name}`, hidden: true }) as HTMLButtonElement;
const deleteButtonFor = (name: string) =>
  within(rowOf(name)).getByRole('button', { name: `Delete message from ${name}`, hidden: true });
const refresh = () => screen.getByRole('button', { name: 'Refresh messages', hidden: true }) as HTMLButtonElement;
const clearButton = () => screen.getByRole('button', { name: 'Clear', hidden: true }) as HTMLButtonElement;
const searchBox = () => screen.getByLabelText('Search') as HTMLInputElement;
const statusSelect = () => screen.getByLabelText('Status') as HTMLSelectElement;
const content = () => screen.getByTestId('messages-content');

async function openWithButton(name: string) {
  fireEvent.click(openButtonFor(name));
  return screen.findByRole('dialog', { name: new RegExp(`^Message from ${name}`) });
}

async function closeWithEscape() {
  fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
}

let replaceSpy: jest.SpyInstance;
let confirmSpy: jest.SpyInstance;

beforeEach(() => {
  jest.clearAllMocks();
  arrive('');
  listAnswer = async () => answer(200, { messages: [LIOR, OREN, DANA] });
  patchAnswer = async () => answer(200, { message: {} });
  deleteAnswer = async () => answer(200, { success: true });
  replaceSpy = jest.spyOn(window.history, 'replaceState');
  confirmSpy = jest.spyOn(window, 'confirm').mockReturnValue(true);
});

afterEach(() => {
  replaceSpy.mockRestore();
  confirmSpy.mockRestore();
});

const replacedUrls = (): string[] => replaceSpy.mock.calls.map((call) => String(call[2]));

describe('T-1 the header', () => {
  it('one h1 "Messages", the purpose line, Mark All Read in the header, no Refresh there, no "Contact Messages"', async () => {
    mockFetch();
    await renderPage();
    const headings = screen.getAllByRole('heading', { level: 1 });
    expect(headings).toHaveLength(1);
    expect(headings[0].textContent).toBe('Messages');
    const header = screen.getByRole('banner');
    expect(within(header).getByText(/Messages sent through the contact form/).textContent).toBe(
      'Messages sent through the contact form: read them, keep internal notes, and mark them read or unread.',
    );
    expect(within(header).getByRole('button', { name: 'Mark All Read' })).toBeTruthy();
    expect(within(header).queryByRole('button', { name: /Refresh/ })).toBeNull();
    expect(document.body.textContent).not.toContain('Contact Messages');
  });

  it('no Mark All Read while no loaded message is unread', async () => {
    mockFetch();
    listAnswer = async () => answer(200, { messages: [OREN, LIOR] });
    await renderPage();
    expect(screen.queryByRole('button', { name: 'Mark All Read' })).toBeNull();
  });
});

describe('T-2 the filter bar', () => {
  it('a search landmark named Filters with labelled controls in order Search, Status, Clear, Refresh', async () => {
    mockFetch();
    await renderPage();
    const bar = screen.getByRole('search', { name: 'Filters' });
    const order = [searchBox(), statusSelect(), clearButton(), refresh()];
    for (const el of order) expect(bar.contains(el)).toBe(true);
    for (let i = 0; i < order.length - 1; i += 1) {
      expect(order[i].compareDocumentPosition(order[i + 1]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
    expect(within(bar).getByText(/^Read at \d{2}:\d{2} UTC$/)).toBeTruthy();
    for (const token of ADMIN_FIELD_CONTROL.split(/\s+/).filter(Boolean)) {
      expect(statusSelect().classList.contains(token)).toBe(true);
    }
  });

  it('Clear is disabled at the defaults and enabled after either change', async () => {
    mockFetch();
    await renderPage();
    expect(clearButton().disabled).toBe(true);
    fireEvent.change(statusSelect(), { target: { value: 'read' } });
    await flush();
    expect(clearButton().disabled).toBe(false);
    fireEvent.change(statusSelect(), { target: { value: 'all' } });
    await flush();
    expect(clearButton().disabled).toBe(true);
    fireEvent.change(searchBox(), { target: { value: 'x' } });
    expect(clearButton().disabled).toBe(false);
  });

  it('Refresh is busy while a read is in flight', async () => {
    mockFetch();
    await renderPage();
    const pending = deferred<ResponseLike>();
    listAnswer = () => pending.promise;
    fireEvent.click(refresh());
    await waitFor(() => expect(refresh().getAttribute('aria-busy')).toBe('true'));
    await act(async () => pending.resolve(answer(200, { messages: [OREN] })));
    await waitFor(() => expect(refresh().getAttribute('aria-busy')).toBe('false'));
  });
});

describe('T-3 the URL', () => {
  it('Status is written with replaceState; All removes it; the search never reaches the URL', async () => {
    mockFetch();
    await renderPage();
    fireEvent.change(statusSelect(), { target: { value: 'unread' } });
    await flush();
    expect(replacedUrls()).toContain(`${PATH}?status=unread`);
    fireEvent.change(statusSelect(), { target: { value: 'all' } });
    await flush();
    expect(replacedUrls().at(-1)).toBe(PATH);
    fireEvent.change(searchBox(), { target: { value: 'secretterm' } });
    await pastTheDebounce();
    await flush();
    for (const url of replacedUrls()) expect(url).not.toMatch(/search|secretterm/);
    expect(window.location.search).not.toContain('secretterm');
  });

  it('an inbound ?status=replied sends filter=replied on the first and only GET', async () => {
    const fetchMock = mockFetch();
    arrive('status=replied');
    await renderPage();
    expect(reads(fetchMock).map((c) => c.url)).toEqual(['/api/admin/messages?filter=replied&search=']);
    expect(statusSelect().value).toBe('replied');
  });

  it('an inbound ?status=junk falls back to all (one GET) and the URL is cleaned', async () => {
    const fetchMock = mockFetch();
    arrive('status=junk');
    await renderPage();
    expect(reads(fetchMock).map((c) => c.url)).toEqual(['/api/admin/messages?filter=all&search=']);
    expect(replacedUrls().at(-1)).toBe(PATH);
  });
});

describe('T-4 Clear', () => {
  it('the mount sends one GET, also after the search pause has passed (lastSearched skips it)', async () => {
    const fetchMock = mockFetch();
    await renderPage();
    await pastTheDebounce();
    await flush();
    expect(reads(fetchMock)).toHaveLength(1);
  });

  it('a status change inside the search pause sends one GET, not two', async () => {
    const fetchMock = mockFetch();
    await renderPage();
    fireEvent.change(searchBox(), { target: { value: 'dana' } });
    fireEvent.change(statusSelect(), { target: { value: 'unread' } });
    await pastTheDebounce();
    await flush();
    expect(reads(fetchMock).slice(1).map((c) => c.url)).toEqual(['/api/admin/messages?filter=unread&search=dana']);
  });

  it('with both set, exactly one GET with the defaults; the box empties and the select shows All', async () => {
    const fetchMock = mockFetch();
    await renderPage();
    fireEvent.change(statusSelect(), { target: { value: 'unread' } });
    fireEvent.change(searchBox(), { target: { value: 'dana' } });
    await pastTheDebounce();
    await flush();
    const before = reads(fetchMock).length;
    fireEvent.click(clearButton());
    await pastTheDebounce();
    await flush();
    expect(reads(fetchMock).slice(before).map((c) => c.url)).toEqual(['/api/admin/messages?filter=all&search=']);
    expect(searchBox().value).toBe('');
    expect(statusSelect().value).toBe('all');
  });
});

describe('T-5 states', () => {
  it('while the first GET is pending: "Reading messages…" with the header and the bar mounted', async () => {
    mockFetch();
    const pending = deferred<ResponseLike>();
    listAnswer = () => pending.promise;
    render(<AdminMessages />);
    expect(screen.getByText('Reading messages…')).toBeTruthy();
    expect(screen.getByRole('heading', { level: 1 })).toBeTruthy();
    expect(searchBox()).toBeTruthy();
    await act(async () => pending.resolve(answer(200, { messages: [OREN] })));
  });

  it.each([
    ['a rejected fetch', () => Promise.reject(new TypeError('Failed to fetch')), ADMIN_NETWORK_ERROR],
    ['a 401', async () => answer(401, { success: false, error: 'Unauthorized' }), 'Your admin session has ended. Sign in again.'],
    ['a 403', async () => answer(403, { success: false, error: 'Forbidden' }), 'Your admin session has ended. Sign in again.'],
    ['a 500 with the route error', async () => answer(500, { error: 'Failed to fetch messages' }), 'Failed to fetch messages'],
    [
      'a 200 whose json() throws',
      async () => ({ ok: true, status: 200, json: async () => { throw new SyntaxError('Unexpected token < in JSON'); } }),
      'Could not read messages. Try again in a moment.',
    ],
    ['a 200 without a messages array', async () => answer(200, { messages: 'nope' }), 'Could not read messages. Try again in a moment.'],
    ['a 200 with no messages key', async () => answer(200, { data: [] }), 'Could not read messages. Try again in a moment.'],
  ])('%s shows exactly its words; never a parser message or "No messages found"; Try again reads again', async (_case, first, words) => {
    const fetchMock = mockFetch();
    listAnswer = first as () => Promise<ResponseLike>;
    render(<AdminMessages />);
    await flush();
    expect((await screen.findByTestId('messages-error')).textContent).toBe(words);
    expect(document.body.textContent).not.toContain('Unexpected token');
    expect(document.body.textContent).not.toContain('No messages found');
    listAnswer = async () => answer(200, { messages: [OREN] });
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await flush();
    expect(await screen.findByText('Oren Sample')).toBeTruthy();
    expect(reads(fetchMock)).toHaveLength(2);
  });
});

describe('T-6 nothing unmounts during a read', () => {
  it('the table and the search box stay, the content is aria-busy, and typing keeps focus in the box', async () => {
    mockFetch();
    await renderPage();
    const tableBefore = table();
    const boxBefore = searchBox();
    const pending = deferred<ResponseLike>();
    listAnswer = () => pending.promise;
    boxBefore.focus();
    fireEvent.change(boxBefore, { target: { value: 'dana' } });
    await pastTheDebounce();
    expect(content().getAttribute('aria-busy')).toBe('true');
    expect(tableBefore.isConnected).toBe(true);
    expect(searchBox()).toBe(boxBefore);
    await act(async () => pending.resolve(answer(200, { messages: [DANA] })));
    await flush();
    expect(document.activeElement).toBe(boxBefore);
    expect(content().getAttribute('aria-busy')).toBe('false');
  });
});

describe('T-7 no Reply anywhere (D-14 (b), R-15)', () => {
  it('no button or link named reply, in the page or the open drawer; no request to a reply path', async () => {
    const fetchMock = mockFetch();
    await renderPage();
    expect(screen.queryAllByRole('button', { name: /reply/i })).toHaveLength(0);
    expect(screen.queryAllByRole('link', { name: /reply/i })).toHaveLength(0);
    const dialog = await openWithButton('Lior Test');
    expect(within(dialog).getByText('Admin Reply')).toBeTruthy();
    expect(within(dialog).queryAllByRole('button', { name: /reply/i })).toHaveLength(0);
    expect(within(dialog).queryAllByRole('link', { name: /reply/i })).toHaveLength(0);
    expect(calls(fetchMock).some((c) => /\/repl(y|ay)/.test(c.url))).toBe(false);
  });
});

describe('T-8 newest read wins', () => {
  it('a slow first read landing after a fast second one does not replace its rows', async () => {
    mockFetch();
    const slow = deferred<ResponseLike>();
    listAnswer = () => slow.promise;
    render(<AdminMessages />);
    await flush();
    listAnswer = async () => answer(200, { messages: [OREN] });
    fireEvent.change(statusSelect(), { target: { value: 'read' } });
    await flush();
    expect(await screen.findByText('Oren Sample')).toBeTruthy();
    await act(async () => slow.resolve(answer(200, { messages: [LIOR] })));
    await flush();
    expect(within(table()).getByText('Oren Sample')).toBeTruthy();
    expect(screen.queryByTestId('messages-empty')).toBeNull();
  });
});

describe('T-9 the table', () => {
  it('named Messages, unique scoped headers, UTC time with an age line, and the count line', async () => {
    mockFetch();
    await renderPage();
    const headers = within(table()).getAllByRole('columnheader');
    expect(headers.map((h) => h.textContent)).toEqual(['Details', 'Contact', 'Message', 'Status', 'Received (UTC)', 'Actions']);
    for (const h of headers) expect(h.getAttribute('scope')).toBe('col');
    const received = within(rowOf('Dana Example')).getByTestId('row-received');
    const [time, age] = Array.from(received.querySelectorAll('span'));
    expect(time.textContent).toBe('2026-10-11 09:00 UTC');
    expect(age.textContent).toMatch(/ago$|^Just now$/);
    expect(screen.getByTestId('messages-count').textContent).toBe('3 messages, 1 unread, newest first');
  });
});

describe('T-10 chips', () => {
  it('status and priority tones and words; the replied extras carry their words', async () => {
    mockFetch();
    await renderPage();
    const chip = (name: string, id: string) => within(rowOf(name)).getByTestId(id);
    expect([chip('Dana Example', 'message-status').dataset.tone, chip('Dana Example', 'message-status').textContent]).toEqual(['info', 'Unread']);
    expect([chip('Oren Sample', 'message-status').dataset.tone, chip('Oren Sample', 'message-status').textContent]).toEqual(['neutral', 'Read']);
    expect([chip('Lior Test', 'message-status').dataset.tone, chip('Lior Test', 'message-status').textContent]).toEqual(['neutral', 'Replied']);
    expect([chip('Dana Example', 'message-priority').dataset.tone, chip('Dana Example', 'message-priority').textContent]).toEqual(['warn', 'High']);
    expect([chip('Oren Sample', 'message-priority').dataset.tone, chip('Oren Sample', 'message-priority').textContent]).toEqual(['neutral', 'Normal']);
    expect([chip('Lior Test', 'message-priority').dataset.tone, chip('Lior Test', 'message-priority').textContent]).toEqual(['danger', 'Urgent']);
    expect(within(rowOf('Lior Test')).getByText('Email sent').className).toContain('sr-only');
    expect(within(rowOf('Lior Test')).getByText('1 reply in the thread').className).toContain('sr-only');
  });
});

describe('T-11 opening the drawer', () => {
  it('an unread row: the dialog opens at once, exactly one PATCH {status, updated_at}, Mark as Unread only after it succeeds, then "Read"', async () => {
    const fetchMock = mockFetch();
    await renderPage();
    const pending = deferred<ResponseLike>();
    patchAnswer = () => pending.promise;
    const dialog = await openWithButton('Dana Example');
    expect(within(dialog).getByTestId('message-status').textContent).toBe('Unread');
    expect(within(dialog).queryByRole('button', { name: 'Mark as Unread' })).toBeNull();
    const sent = writes(fetchMock);
    expect(sent).toHaveLength(1);
    expect(sent[0].url).toBe('/api/admin/messages/msg-1');
    expect(Object.keys(sent[0].body ?? {}).sort()).toEqual(['status', 'updated_at']);
    expect(calls(fetchMock)).toHaveLength(2);
    await act(async () => pending.resolve(answer(200, { message: {} })));
    await waitFor(() => expect(within(dialog).getByTestId('message-status').textContent).toBe('Read'));
    expect(within(dialog).getByRole('button', { name: 'Mark as Unread' })).toBeTruthy();
  });

  it('a read row sends nothing', async () => {
    const fetchMock = mockFetch();
    await renderPage();
    await openWithButton('Oren Sample');
    await flush();
    expect(writes(fetchMock)).toHaveLength(0);
  });
});

describe('T-12 the whole-row click (D-17, SA M-3)', () => {
  it('a click on row text opens it; Escape returns focus to that row\'s Open button', async () => {
    mockFetch();
    await renderPage();
    fireEvent.click(within(rowOf('Oren Sample')).getByText('Thanks for the demo.'));
    expect(await screen.findByRole('dialog', { name: /^Message from Oren Sample/ })).toBeTruthy();
    await closeWithEscape();
    expect(document.activeElement).toBe(openButtonFor('Oren Sample'));
  });

  it('a click on an unread row\'s Open button sends exactly one PATCH (the row handler ignores it)', async () => {
    const fetchMock = mockFetch();
    await renderPage();
    await openWithButton('Dana Example');
    await flush();
    expect(writes(fetchMock)).toHaveLength(1);
  });

  it('a click on Delete with confirm false opens nothing and sends nothing', async () => {
    const fetchMock = mockFetch();
    await renderPage();
    confirmSpy.mockReturnValue(false);
    fireEvent.click(deleteButtonFor('Dana Example'));
    await flush();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(writes(fetchMock)).toHaveLength(0);
  });

  it('a text selection inside the row blocks the click; one elsewhere does not', async () => {
    mockFetch();
    await renderPage();
    const text = within(rowOf('Oren Sample')).getByText('Thanks for the demo.');
    const spy = jest.spyOn(window, 'getSelection');
    spy.mockReturnValue({ isCollapsed: false, anchorNode: text.firstChild, focusNode: text.firstChild } as unknown as Selection);
    fireEvent.click(text);
    await flush();
    expect(screen.queryByRole('dialog')).toBeNull();
    const elsewhere = screen.getByTestId('messages-count');
    spy.mockReturnValue({ isCollapsed: false, anchorNode: elsewhere.firstChild, focusNode: elsewhere.firstChild } as unknown as Selection);
    fireEvent.click(text);
    expect(await screen.findByRole('dialog')).toBeTruthy();
    spy.mockRestore();
  });

  it('the tr has no tabindex and no role; Enter on the focused Open button opens', async () => {
    mockFetch();
    const user = userEvent.setup();
    await renderPage();
    const row = rowOf('Oren Sample');
    expect(row.hasAttribute('tabindex')).toBe(false);
    expect(row.hasAttribute('role')).toBe(false);
    openButtonFor('Oren Sample').focus();
    await user.keyboard('{Enter}');
    expect(await screen.findByRole('dialog', { name: /^Message from Oren Sample/ })).toBeTruthy();
  });
});

describe('T-13 closing the drawer', () => {
  it('Escape closes it and focus returns to the Open button', async () => {
    mockFetch();
    await renderPage();
    await openWithButton('Oren Sample');
    await closeWithEscape();
    expect(document.activeElement).toBe(openButtonFor('Oren Sample'));
  });

  it('under Unread, opening an unread row keeps the drawer open although the row leaves; Escape focuses the content area', async () => {
    mockFetch();
    arrive('status=unread');
    await renderPage();
    const dialog = await openWithButton('Dana Example');
    await flush();
    await waitFor(() => expect(within(dialog).getByTestId('message-status').textContent).toBe('Read'));
    expect(screen.queryByRole('table', { name: 'Messages', hidden: true })).toBeNull();
    expect(screen.getByRole('dialog')).toBe(dialog);
    await closeWithEscape();
    await waitFor(() => expect(document.activeElement).toBe(content()));
  });
});

describe('T-14 close when gone', () => {
  it('deleting the open message closes the drawer', async () => {
    mockFetch();
    await renderPage();
    await openWithButton('Oren Sample');
    fireEvent.click(deleteButtonFor('Oren Sample'));
    await flush();
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('a Refresh without the open id closes it, and a later Refresh that brings it back does not reopen it', async () => {
    mockFetch();
    await renderPage();
    await openWithButton('Oren Sample');
    listAnswer = async () => answer(200, { messages: [DANA] });
    fireEvent.click(refresh());
    await flush();
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    listAnswer = async () => answer(200, { messages: [OREN, DANA] });
    fireEvent.click(refresh());
    await flush();
    expect(within(table()).getByText('Oren Sample')).toBeTruthy();
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

describe('T-15 admin notes', () => {
  it('edit mode does not carry over to another message', async () => {
    mockFetch();
    await renderPage();
    const first = await openWithButton('Oren Sample');
    fireEvent.click(within(first).getByRole('button', { name: 'Edit' }));
    expect(within(first).getByRole('textbox', { name: 'Admin notes' })).toBeTruthy();
    await closeWithEscape();
    const second = await openWithButton('Lior Test');
    expect(within(second).queryByRole('textbox', { name: 'Admin notes' })).toBeNull();
    expect(within(second).getByRole('button', { name: 'Edit' })).toBeTruthy();
  });

  it('a failed Save keeps edit mode and the draft, sends one PATCH, shows the line; a second Save clears it first', async () => {
    const fetchMock = mockFetch();
    await renderPage();
    patchAnswer = async () => answer(500, { error: 'route_error_probe' });
    const dialog = await openWithButton('Oren Sample');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Edit' }));
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Admin notes' }), { target: { value: 'Call back Monday' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await flush();
    expect(writes(fetchMock)).toHaveLength(1);
    expect(within(dialog).getByTestId('notes-failed').textContent).toBe('Could not save the notes. Try again.');
    expect((within(dialog).getByRole('textbox', { name: 'Admin notes' }) as HTMLTextAreaElement).value).toBe('Call back Monday');
    expect(document.body.textContent).not.toContain('route_error_probe');

    const pending = deferred<ResponseLike>();
    patchAnswer = () => pending.promise;
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(within(dialog).queryByTestId('notes-failed')).toBeNull());
    await act(async () => pending.resolve(answer(200, { message: {} })));
    await waitFor(() => expect(within(dialog).queryByRole('textbox', { name: 'Admin notes' })).toBeNull());
    expect(within(dialog).getByText('Call back Monday')).toBeTruthy();
  });

  it('a rejected Save fetch shows the same line', async () => {
    mockFetch();
    await renderPage();
    patchAnswer = () => Promise.reject(new TypeError('Failed to fetch'));
    const dialog = await openWithButton('Oren Sample');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Edit' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await flush();
    expect(within(dialog).getByTestId('notes-failed').textContent).toBe('Could not save the notes. Try again.');
  });
});

describe('T-16 Mark as Unread failure', () => {
  it('the drawer keeps "Read" and shows the unread line in the Status section', async () => {
    mockFetch();
    await renderPage();
    patchAnswer = async () => answer(500, { error: 'route_error_probe' });
    const dialog = await openWithButton('Oren Sample');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Mark as Unread' }));
    await flush();
    expect(within(dialog).getByTestId('message-status').textContent).toBe('Read');
    const status = within(dialog).getByTestId('drawer-status');
    expect(within(status).getByTestId('status-failed').textContent).toBe('Could not mark the message as unread. Try again.');
    expect(document.body.textContent).not.toContain('route_error_probe');
  });
});

describe('T-17 logging is facts only (SA M-4)', () => {
  it('no logger call carries a name, email, phone, company, subject, message text, notes, draft or search text', async () => {
    const DRAFT = 'Private draft about the caller';
    const NOTES = 'Existing private notes';
    mockFetch();
    listAnswer = async () => answer(200, { messages: [LIOR, { ...OREN, admin_notes: NOTES }, DANA] });
    await renderPage();

    // A failed PATCH (warn) and a rejected one (error).
    patchAnswer = async () => answer(500, { error: 'x' });
    const dialog = await openWithButton('Oren Sample');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Edit' }));
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Admin notes' }), { target: { value: DRAFT } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await flush();
    patchAnswer = () => Promise.reject(new TypeError('Failed to fetch'));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await flush();
    await closeWithEscape();

    // A failed DELETE, a rejected one, a failed open, and Mark All Read failing.
    deleteAnswer = async () => answer(500, { error: 'x' });
    fireEvent.click(deleteButtonFor('Dana Example'));
    await flush();
    deleteAnswer = () => Promise.reject(new TypeError('Failed to fetch'));
    fireEvent.click(deleteButtonFor('Dana Example'));
    await flush();
    fireEvent.click(screen.getByRole('button', { name: 'Mark All Read' }));
    await flush();

    // A search, then failing reads.
    listAnswer = async () => answer(500, { error: 'Failed to fetch messages' });
    fireEvent.change(searchBox(), { target: { value: 'secretsearchterm' } });
    await pastTheDebounce();
    await flush();
    listAnswer = () => Promise.reject(new TypeError('Failed to fetch'));
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await flush();

    const logger = clientLogger as unknown as Record<'info' | 'warn' | 'error' | 'debug', jest.Mock>;
    const allCalls = [...logger.info.mock.calls, ...logger.warn.mock.calls, ...logger.error.mock.calls, ...logger.debug.mock.calls];
    expect(logger.warn.mock.calls.length).toBeGreaterThanOrEqual(4);
    expect(logger.error.mock.calls.length).toBeGreaterThanOrEqual(3);
    const serialised = JSON.stringify(allCalls, (_key, value: unknown) =>
      value instanceof Error ? { name: value.name, message: value.message } : value,
    );
    for (const secret of [
      'Dana Example', 'dana@example.test', '+1 555 0100', 'Example Dental', 'Pricing question',
      'Hello, I would like to know the price.', 'Oren Sample', 'oren@example.test', 'Thanks for the demo.',
      NOTES, DRAFT, 'secretsearchterm',
    ]) {
      expect({ secret, found: serialised.includes(secret) }).toEqual({ secret, found: false });
    }
  });
});

describe('T-18 empty', () => {
  it('no rows and no filter: "No messages yet." with no Clear filters', async () => {
    mockFetch();
    listAnswer = async () => answer(200, { messages: [] });
    render(<AdminMessages />);
    await flush();
    expect((await screen.findByTestId('messages-empty')).textContent).toContain('No messages yet.');
    expect(screen.queryByRole('button', { name: 'Clear filters' })).toBeNull();
  });

  it('a search with no rows offers Clear filters, which reads again with the defaults', async () => {
    const fetchMock = mockFetch();
    await renderPage();
    listAnswer = async (q) => answer(200, { messages: q.get('search') ? [] : [OREN] });
    fireEvent.change(searchBox(), { target: { value: 'zzz' } });
    await pastTheDebounce();
    await flush();
    expect(screen.getByTestId('messages-empty').textContent).toContain('No messages match this search or status.');
    const before = reads(fetchMock).length;
    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    await pastTheDebounce();
    await flush();
    expect(reads(fetchMock).slice(before).map((c) => c.url)).toEqual(['/api/admin/messages?filter=all&search=']);
    expect(await screen.findByText('Oren Sample')).toBeTruthy();
  });
});

describe('T-21 D-19 Delete failure', () => {
  it('a failed DELETE keeps the row and shows the line in that row only, never the route words', async () => {
    mockFetch();
    await renderPage();
    deleteAnswer = async () => answer(500, { error: 'route_error_probe' });
    fireEvent.click(deleteButtonFor('Dana Example'));
    await flush();
    expect(within(table()).getByText('Dana Example')).toBeTruthy();
    expect(screen.getAllByTestId('delete-failed')).toHaveLength(1);
    expect(within(rowOf('Dana Example')).getByTestId('delete-failed').textContent).toBe('Could not delete the message. Try again.');
    expect(document.body.textContent).not.toContain('route_error_probe');
  });

  it('a rejected DELETE fetch shows the same line; accepting a new attempt clears it', async () => {
    mockFetch();
    await renderPage();
    deleteAnswer = () => Promise.reject(new TypeError('Failed to fetch'));
    fireEvent.click(deleteButtonFor('Dana Example'));
    await flush();
    expect(within(rowOf('Dana Example')).getByTestId('delete-failed').textContent).toBe('Could not delete the message. Try again.');
    const pending = deferred<ResponseLike>();
    deleteAnswer = () => pending.promise;
    fireEvent.click(deleteButtonFor('Dana Example'));
    await waitFor(() => expect(screen.queryByTestId('delete-failed')).toBeNull());
    await act(async () => pending.resolve(answer(200, { success: true })));
  });
});

describe('T-22 D-19 Mark All Read failure', () => {
  it('one of two PATCHes failing shows the header line and still sends exactly one re-read', async () => {
    const fetchMock = mockFetch();
    const NOA = { ...DANA, id: 'msg-4', name: 'Noa Unread', created_at: '2026-10-08T07:00:00Z' };
    listAnswer = async () => answer(200, { messages: [LIOR, OREN, DANA, NOA] });
    await renderPage();
    patchAnswer = async (id) => (id === 'msg-4' ? answer(500, { error: 'x' }) : answer(200, { message: {} }));
    const before = reads(fetchMock).length;
    fireEvent.click(screen.getByRole('button', { name: 'Mark All Read' }));
    await flush();
    await flush();
    expect(writes(fetchMock)).toHaveLength(2);
    expect(reads(fetchMock).length).toBe(before + 1);
    expect(within(screen.getByRole('banner')).getByTestId('mark-all-failed').textContent).toBe(
      'Could not mark every message as read. Try again.',
    );
  });
});

describe('T-23 D-19 the mark-read on open failing', () => {
  it('leaves the drawer open with the Unread chip and the read line', async () => {
    mockFetch();
    await renderPage();
    patchAnswer = async () => answer(500, { error: 'route_error_probe' });
    const dialog = await openWithButton('Dana Example');
    await flush();
    expect(screen.getByRole('dialog')).toBe(dialog);
    expect(within(dialog).getByTestId('message-status').textContent).toBe('Unread');
    expect(within(dialog).getByTestId('status-failed').textContent).toBe('Could not mark the message as read.');
  });
});

describe('T-24 D-19 success shows nothing new', () => {
  const noAlerts = () => expect(screen.queryAllByRole('alert', { hidden: true })).toHaveLength(0);

  it('open (mark read), Mark as Unread, Save notes, Delete and Mark All Read each succeed with no failure line', async () => {
    mockFetch();
    await renderPage();
    const dialog = await openWithButton('Dana Example');
    await flush();
    noAlerts();
    fireEvent.click(await within(dialog).findByRole('button', { name: 'Mark as Unread' }));
    await flush();
    noAlerts();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Edit' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await flush();
    noAlerts();
    await closeWithEscape();
    fireEvent.click(deleteButtonFor('Oren Sample'));
    await flush();
    noAlerts();
    fireEvent.click(screen.getByRole('button', { name: 'Mark All Read' }));
    await flush();
    await flush();
    noAlerts();
  });
});
