/**
 * @jest-environment jsdom
 */

/**
 * AI cost & usage on the Admin Layout Standard, part a (L-2a): the shared
 * header, the KPI strip with the same-page filter tiles, the filter bar with
 * every filter in the URL, and the shared states. A new file, so the existing
 * analytics pins stay as they were apart from the edits listed in workplan §6.2.
 *
 * The address bar is read through `window.location.search` (the hook writes
 * with the real jsdom `history.replaceState`, spied); requests through the
 * fetch mock. `useSearchParams` is mocked over the arrival string and, like
 * jsdom, never echoes a write.
 */

import React from 'react';
import { createEvent, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

const mockLogError = jest.fn();
// RC-1: the page and the shared business picker log through `clientLogger.child`.
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

import { ADMIN_NETWORK_ERROR } from '@/app/admin/components/layout/readAdminResponse';
import { BUSINESS_SEARCH_PATH } from '@/app/admin/components/layout/AdminBusinessPicker';
import { resolveAdminWindow } from '@/app/admin/components/adminWindowPresets';

import AdminCostAnalytics from '../page';

const PATH = '/admin/analytics';
const ACCOUNT = '99999999-9999-4999-8999-999999999999';
const OTHER = '88888888-8888-4888-8888-888888888888';
const FROM = '2026-09-25T08:14:00.000Z';
const TO = '2026-09-26T08:14:00.000Z';
const DRILL = '/api/admin/token-usage/drill-down?';

type Answer =
  | { kind: 'ok'; extra?: Record<string, unknown> }
  | { kind: 'json'; status: number; body: unknown }
  | { kind: 'html'; status: number }
  | { kind: 'network' }
  | { kind: 'pending' };

let answer: Answer = { kind: 'ok' };

function okBody(query: URLSearchParams, extra: Record<string, unknown> = {}) {
  const breakdownBy = query.get('breakdownBy') ?? 'provider';
  return {
    success: true,
    totals: { cost: 1.5, tokens: 100, inputTokens: 60, outputTokens: 40, calls: 3 },
    filters: {},
    availableFilters: { providers: [], models: [], activities: [], users: [], agents: [] },
    categoryTotals: {
      creation: { cost: 0, tokens: 0, calls: 0 },
      execution: { cost: 0, tokens: 0, calls: 0 },
      memory: { cost: 0.5, tokens: 10, calls: 1 },
      system: { cost: 1, tokens: 90, calls: 2 },
    },
    scope: query.get('scope'),
    possiblyIncomplete: false,
    items: [
      {
        id: `${breakdownBy}-1`,
        label: `Row ${breakdownBy}`,
        cost: 1.5,
        tokens: 100,
        inputTokens: 60,
        outputTokens: 40,
        calls: 3,
        percentage: 100,
        type: breakdownBy,
        metadata: {},
      },
    ],
    ...extra,
  };
}

function respond(current: Answer, url: string): Promise<unknown> {
  const query = new URLSearchParams(url.split('?')[1]);
  switch (current.kind) {
    case 'ok':
      return Promise.resolve({ ok: true, status: 200, json: async () => okBody(query, current.extra) });
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

let fetchMock: jest.Mock;
function mockFetch(): jest.Mock {
  fetchMock = jest.fn((url: string) => respond(answer, String(url)));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- jsdom has no fetch; standard test stub
  (global as any).fetch = fetchMock;
  return fetchMock;
}

const urls = (): string[] => fetchMock.mock.calls.map(([u]) => String(u));
const drillQueries = (): URLSearchParams[] =>
  urls()
    .filter((u) => u.startsWith(DRILL))
    .map((u) => new URLSearchParams(u.slice(DRILL.length)));
const lastQuery = () => drillQueries()[drillQueries().length - 1];

/** Arrive at the page with this query, as a link would open it. */
function arrive(search: string) {
  window.history.replaceState(null, '', `${PATH}${search ? `?${search}` : ''}`);
  mockSearch = search;
}

const refreshButton = () => screen.getByRole('button', { name: 'Refresh AI cost and usage' }) as HTMLButtonElement;

/** Wait until the read in flight has settled (Refresh is enabled again). */
async function settled() {
  await waitFor(() => expect(fetchMock).toHaveBeenCalled());
  await waitFor(() => expect(refreshButton().disabled).toBe(false));
}

let replaceSpy: jest.SpyInstance;
let pushSpy: jest.SpyInstance;

beforeAll(() => {
  // framer-motion measures panels; jsdom has no scrollTo.
  window.scrollTo = jest.fn() as unknown as typeof window.scrollTo;
});

beforeEach(() => {
  jest.clearAllMocks();
  answer = { kind: 'ok' };
  arrive('');
  replaceSpy = jest.spyOn(window.history, 'replaceState');
  pushSpy = jest.spyOn(window.history, 'pushState');
  mockFetch();
});

afterEach(() => {
  // U-2: never pushState, and every write is replaceState(null, …) (SA M-1 of L-1c).
  expect(pushSpy).not.toHaveBeenCalled();
  for (const call of replaceSpy.mock.calls) expect(call[0]).toBeNull();
  // RC-6: the business picker never reads on mount.
  expect(urls().some((u) => u.startsWith(BUSINESS_SEARCH_PATH))).toBe(false);
  // W3-5: no request pairs scope=bos with a view the route refuses there.
  for (const q of drillQueries()) {
    if (q.get('scope') !== 'bos') continue;
    expect(['agent', 'execution']).not.toContain(q.get('breakdownBy'));
    expect(q.has('agent') || q.has('execution') || q.has('category')).toBe(false);
  }
  replaceSpy.mockRestore();
  pushSpy.mockRestore();
});

describe('the standard header, strip, bar and states', () => {
  it('first read: header and bar mounted, KPI placeholders, and "Reading AI cost and usage…"', () => {
    answer = { kind: 'pending' };
    render(<AdminCostAnalytics />);
    const headings = screen.getAllByRole('heading', { level: 1 });
    expect(headings).toHaveLength(1);
    expect(headings[0].textContent).toBe('AI cost & usage');
    expect(screen.getByRole('search', { name: 'Filters' })).toBeTruthy();
    expect(screen.getAllByTestId('kpi-placeholder')).toHaveLength(4);
    expect(screen.getByRole('status').textContent).toBe('Reading AI cost and usage…');
    expect(refreshButton().disabled).toBe(true);
  });

  it('All scope shows five placeholders while the first read is pending', () => {
    answer = { kind: 'pending' };
    arrive('scope=all');
    render(<AdminCostAnalytics />);
    expect(screen.getAllByTestId('kpi-placeholder')).toHaveLength(5);
  });

  it('once loaded: one h1 with the purpose line, no "BI System", one Refresh, "Read at", in the order header, strip, bar, content', async () => {
    render(<AdminCostAnalytics />);
    await settled();
    const headings = screen.getAllByRole('heading', { level: 1 });
    expect(headings).toHaveLength(1);
    expect(headings[0].textContent).toBe('AI cost & usage');
    expect(document.body.textContent).toContain(
      'What Business OS and agent-platform AI calls cost, by provider, model and feature.',
    );
    expect(document.body.textContent).not.toContain('BI System');
    expect(document.body.textContent).not.toContain('Token Usage Analytics');
    expect(screen.getAllByRole('button', { name: /^Refresh/ })).toHaveLength(1);
    expect(document.body.textContent).toMatch(/Read at \d{2}:\d{2} UTC/);

    const header = headings[0].closest('header')!;
    const strip = screen.getByTestId('category-card-total').parentElement!;
    const bar = screen.getByRole('search', { name: 'Filters' });
    const notes = screen.getByTestId('scope-notes');
    const follows = (a: Element, b: Element) => Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
    expect(follows(header, strip)).toBe(true);
    expect(follows(strip, bar)).toBe(true);
    expect(follows(bar, notes)).toBe(true);
  });

  it('the scope switch is named "Scope Business OS only" and is purple, never green (SA M-3, T-6)', async () => {
    render(<AdminCostAnalytics />);
    await settled();
    const toggle = screen.getByRole('switch', { name: 'Scope Business OS only' });
    expect(toggle).toBe(screen.getByTestId('scope-toggle'));
    expect(toggle.getAttribute('aria-checked')).toBe('true');
    expect(toggle.className).toContain('bg-purple-500/20');
    expect(toggle.className).not.toMatch(/emerald|green/);
    expect(screen.getByText('Scope').tagName).toBe('SPAN');
  });

  it('Group by is a labelled native select with the Business OS options', async () => {
    render(<AdminCostAnalytics />);
    await settled();
    const select = screen.getByRole('combobox', { name: 'Group by' }) as HTMLSelectElement;
    expect(select).toBe(screen.getByTestId('group-by-select'));
    expect(select.value).toBe('provider');
    expect(within(select).getAllByRole('option')).toHaveLength(8);
  });

  it('Refresh re-reads the same query and updates "Read at"', async () => {
    render(<AdminCostAnalytics />);
    await settled();
    const before = urls().filter((u) => u.startsWith(DRILL));
    expect(before).toHaveLength(1);
    fireEvent.click(refreshButton());
    await settled();
    const after = urls().filter((u) => u.startsWith(DRILL));
    expect(after).toHaveLength(2);
    expect(after[1]).toBe(after[0]);
    expect(document.body.textContent).toMatch(/Read at \d{2}:\d{2} UTC/);
  });
});

describe('errors (§5.10, F-43, F-55; SA Q-10)', () => {
  it('a route failure keeps the header and bar, hides the strip, shows the route words, and Try again re-reads', async () => {
    answer = { kind: 'json', status: 500, body: { success: false, error: 'Internal server error' } };
    render(<AdminCostAnalytics />);
    expect((await screen.findByTestId('analytics-error')).textContent).toBe('Internal server error');
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByRole('search', { name: 'Filters' })).toBeTruthy();
    expect(screen.queryByTestId('category-card-total')).toBeNull();
    expect(screen.queryAllByTestId('kpi-placeholder')).toHaveLength(0);
    expect(screen.queryByTestId('scope-notes')).toBeNull();

    answer = { kind: 'ok' };
    const count = drillQueries().length;
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(screen.queryByTestId('analytics-error')).toBeNull());
    expect(drillQueries()).toHaveLength(count + 1);
    expect(drillQueries()[count].toString()).toBe(drillQueries()[0].toString());
    expect(await screen.findByTestId('category-card-total')).toBeTruthy();
  });

  it('QA B-1: after success, a failure, then Try again with a pending read, shows placeholders and "Reading…", never zeros', async () => {
    render(<AdminCostAnalytics />);
    await settled();
    expect(screen.getByRole('link', { name: 'Recorded AI cost, $1.50' })).toBeTruthy();

    answer = { kind: 'json', status: 500, body: { success: false, error: 'Internal server error' } };
    fireEvent.click(refreshButton());
    expect((await screen.findByTestId('analytics-error')).textContent).toBe('Internal server error');

    answer = { kind: 'pending' };
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(screen.queryByTestId('analytics-error')).toBeNull());
    expect(screen.getAllByTestId('kpi-placeholder')).toHaveLength(4);
    expect(screen.getByRole('status').textContent).toBe('Reading AI cost and usage…');
    expect(screen.queryByTestId('category-card-total')).toBeNull();
    expect(document.body.textContent).not.toContain('$0.00');
    expect(document.body.textContent).not.toContain('No data found');
    // L-2b: the empty state is `AdminEmpty` now; it must not show either.
    expect(screen.queryByTestId('analytics-empty')).toBeNull();
    // The header and the bar stay.
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByRole('search', { name: 'Filters' })).toBeTruthy();
  });

  it('a non-JSON body shows the fixed sentence, never a parser message (F-43)', async () => {
    answer = { kind: 'html', status: 502 };
    render(<AdminCostAnalytics />);
    expect((await screen.findByTestId('analytics-error')).textContent).toBe(
      'Could not read AI cost and usage. Try again in a moment.',
    );
    expect(document.body.textContent).not.toContain('Unexpected token');
  });

  it('an OK status with a non-JSON body is the same fixed sentence', async () => {
    answer = { kind: 'html', status: 200 };
    render(<AdminCostAnalytics />);
    expect((await screen.findByTestId('analytics-error')).textContent).toBe(
      'Could not read AI cost and usage. Try again in a moment.',
    );
  });

  it('a rejected fetch shows the network sentence and logs { err } once', async () => {
    answer = { kind: 'network' };
    render(<AdminCostAnalytics />);
    expect((await screen.findByTestId('analytics-error')).textContent).toBe(ADMIN_NETWORK_ERROR);
    expect(mockLogError).toHaveBeenCalledTimes(1);
    const [context] = mockLogError.mock.calls[0];
    expect(Object.keys(context as object)).toEqual(['err']);
  });

  it('403 shows the session-ended sentence', async () => {
    answer = { kind: 'json', status: 403, body: { success: false, error: 'Forbidden' } };
    render(<AdminCostAnalytics />);
    expect((await screen.findByTestId('analytics-error')).textContent).toBe('Your admin session has ended. Sign in again.');
  });

  it('400 keeps the page sentence, not the route words (SA Q-10)', async () => {
    answer = { kind: 'json', status: 400, body: { success: false, error: 'Invalid query parameters' } };
    render(<AdminCostAnalytics />);
    expect((await screen.findByTestId('analytics-error')).textContent).toBe(
      'The selected filters or dates are not valid. Check the date range and try again.',
    );
  });
});

describe('the KPI strip (§7.5, R-13, K-5)', () => {
  it('Business OS: Recorded AI cost, Calls, Tokens, Avg cost per call, with their names and targets', async () => {
    render(<AdminCostAnalytics />);
    await settled();
    const spend = screen.getByRole('link', { name: 'Recorded AI cost, $1.50' });
    expect(spend.getAttribute('href')).toBe(PATH);
    const calls = screen.getByRole('link', { name: 'Calls, 3' });
    expect(calls.getAttribute('href')).toBe(`${PATH}?group_by=activity`);
    const tokens = screen.getByRole('link', { name: 'Tokens, 100' });
    expect(tokens.getAttribute('href')).toBe(`${PATH}?group_by=model`);
    expect(document.getElementById(tokens.getAttribute('aria-describedby')!)?.textContent).toBe('60 in · 40 out');
    const avg = screen.getByRole('group', { name: 'Avg cost per call, $0.50' });
    expect(avg.getAttribute('data-testid')).toBe('kpi-avg-cost');
    for (const c of ['creation', 'execution', 'memory', 'system']) expect(screen.queryByTestId(`category-card-${c}`)).toBeNull();
  });

  it('All: Recorded AI cost keeps the total tokens first in its sub-line (SA M-2), and four neutral category tiles', async () => {
    arrive('scope=all');
    render(<AdminCostAnalytics />);
    await settled();
    const spend = screen.getByRole('link', { name: 'Recorded AI cost, $1.50' });
    expect(spend.getAttribute('href')).toBe(`${PATH}?scope=all`);
    expect(document.getElementById(spend.getAttribute('aria-describedby')!)?.textContent).toBe('100 tokens');
    const memory = screen.getByRole('link', { name: 'Memory, $0.50' });
    expect(memory.getAttribute('href')).toBe(`${PATH}?scope=all&category=memory`);
    expect(document.getElementById(memory.getAttribute('aria-describedby')!)?.textContent).toBe(
      '33% of recorded cost · 10 tokens · Embeddings, summarization',
    );
    for (const c of ['creation', 'execution', 'memory', 'system']) {
      const tile = screen.getByTestId(`category-card-${c}`);
      expect(tile.className).toContain('border-slate-700');
      expect(tile.className).not.toMatch(/emerald|green|blue|orange/);
    }
    expect(screen.queryByTestId('kpi-calls')).toBeNull();
  });

  it('the change vs the previous period is plain text, and incomplete totals turn Recorded AI cost amber', async () => {
    answer = {
      kind: 'ok',
      extra: {
        possiblyIncomplete: true,
        comparison: {
          previousPeriod: { cost: 1, tokens: 1, calls: 1, from: FROM, to: TO },
          changes: { costPct: 4.2, tokensPct: 0, callsPct: 0 },
        },
      },
    };
    render(<AdminCostAnalytics />);
    await settled();
    const spend = screen.getByRole('link', { name: 'Recorded AI cost, $1.50, needs a look' });
    expect(spend.getAttribute('data-status')).toBe('amber');
    const sub = document.getElementById(spend.getAttribute('aria-describedby')!)!;
    expect(sub.textContent).toBe('+4.2% vs previous period · may be incomplete');
    expect(sub.className).not.toMatch(/red|green/);
    expect(screen.getByTestId('incomplete-banner').textContent).toContain('lower bound');
  });

  it('the Calls tile applies its group by in place: one request, the URL, no reload', async () => {
    render(<AdminCostAnalytics />);
    await settled();
    fireEvent.click(screen.getByRole('link', { name: 'Calls, 3' }));
    await waitFor(() => expect(lastQuery().get('breakdownBy')).toBe('activity'));
    expect(drillQueries()).toHaveLength(2);
    expect(window.location.search).toBe('?group_by=activity');
    expect((screen.getByTestId('group-by-select') as HTMLSelectElement).value).toBe('activity');
  });
});

describe('inbound links and round trips (workplan §4.2)', () => {
  const today = resolveAdminWindow('today', new Date());

  it.each([
    {
      name: 'R-1 the Health spend tile (two instants)',
      arriving: `scope=bos&dateFrom=${FROM}&dateTo=${TO}`,
      bar: '?range=custom&from=2026-09-25T08%3A14%3A00.000Z&to=2026-09-26T08%3A14%3A00.000Z',
      request: { scope: 'bos', dateFrom: FROM, dateTo: TO, period: null },
    },
    {
      name: 'R-2 the Businesses panel / Activity (scope=bos, user)',
      arriving: `scope=bos&user=${ACCOUNT}`,
      bar: `?account=${ACCOUNT}`,
      request: { scope: 'bos', user: ACCOUNT, period: '30' },
    },
    {
      name: 'R-3 All scope with a user',
      arriving: `scope=all&user=${ACCOUNT}`,
      bar: `?scope=all&account=${ACCOUNT}`,
      request: { scope: 'all', user: ACCOUNT, period: '30' },
    },
    {
      name: 'R-4 the cutover notice with no account',
      arriving: 'scope=bos',
      bar: '',
      request: { scope: 'bos', period: '30', user: null },
    },
    {
      name: 'R-5 minute-form bounds (ignored: the route refuses them)',
      arriving: 'dateFrom=2026-09-25T08:14&dateTo=2026-09-26T08:14',
      bar: '',
      request: { period: '30', dateFrom: null, dateTo: null },
    },
    {
      name: 'R-6 a legacy whole-date pair (now a custom range)',
      arriving: 'dateFrom=2026-09-25&dateTo=2026-09-26',
      bar: '?range=custom&from=2026-09-25&to=2026-09-26',
      request: { dateFrom: '2026-09-25T00:00:00.000Z', dateTo: '2026-09-26T23:59:59.999999Z', period: null },
    },
    {
      name: 'R-7 the canonical account wins over the alias',
      arriving: `account=${ACCOUNT}&user=${OTHER}`,
      bar: `?account=${ACCOUNT}`,
      request: { user: ACCOUNT },
    },
    {
      name: 'R-8 range=24h',
      arriving: 'range=24h',
      bar: '?range=24h',
      request: { period: '1', dateFrom: null },
    },
    {
      name: 'R-8 range=90d',
      arriving: 'range=90d',
      bar: '?range=90d',
      request: { period: '90', dateFrom: null },
    },
    {
      name: 'R-8 range=today',
      arriving: 'range=today',
      bar: '?range=today',
      request: { period: null, dateFrom: `${today.from}T00:00:00.000Z`, dateTo: `${today.to}T23:59:59.999999Z` },
    },
    {
      name: 'R-9 a Business OS link naming what that scope cannot hold',
      arriving: 'scope=bos&category=memory&group_by=agent',
      bar: '',
      request: { scope: 'bos', category: null, breakdownBy: 'provider', period: '30' },
    },
    {
      name: 'R-10 junk',
      arriving: 'range=week&group_by=nope&account=xyz&scope=maybe',
      bar: '',
      request: { scope: 'bos', breakdownBy: 'provider', period: '30', user: null },
    },
  ])('$name', async ({ arriving, bar, request }) => {
    arrive(arriving);
    replaceSpy.mockClear();
    render(<AdminCostAnalytics />);
    await settled();
    // The mount pin: exactly one request, however many URL writes the mount made.
    expect(drillQueries()).toHaveLength(1);
    const q = drillQueries()[0];
    for (const [key, value] of Object.entries(request)) expect({ key, value: q.get(key) }).toEqual({ key, value });
    expect(window.location.pathname).toBe(PATH);
    expect(window.location.search).toBe(bar);
    if (arriving === bar.slice(1)) expect(replaceSpy).not.toHaveBeenCalled();
  });

  it('R-1: the linked chip names the window, and no window button is pressed', async () => {
    arrive(`scope=bos&dateFrom=${FROM}&dateTo=${TO}`);
    render(<AdminCostAnalytics />);
    await settled();
    expect(screen.getByTestId('linked-window-chip').textContent).toBe('Linked window 2026-09-25 08:14 to 2026-09-26 08:14 UTC');
    const pressed = within(screen.getByRole('group', { name: 'Window' }))
      .getAllByRole('button')
      .filter((b) => b.getAttribute('aria-pressed') === 'true');
    expect(pressed).toHaveLength(0);
  });

  it('R-2: the business chip shows the short id, X "Remove business" clears it', async () => {
    arrive(`scope=bos&user=${ACCOUNT}`);
    render(<AdminCostAnalytics />);
    await settled();
    const chip = screen.getByTestId('business-filter-chip');
    expect(chip.textContent).toContain('Business: 99999999…');
    fireEvent.click(within(chip).getByRole('button', { name: 'Remove business' }));
    await waitFor(() => expect(lastQuery().has('user')).toBe(false));
    expect(window.location.search).toBe('');
  });

  it('R-6: Custom is pressed and its inputs hold the dates', async () => {
    arrive('dateFrom=2026-09-25&dateTo=2026-09-26');
    render(<AdminCostAnalytics />);
    await settled();
    expect(screen.getByRole('button', { name: 'Custom' }).getAttribute('aria-pressed')).toBe('true');
    expect((screen.getByLabelText('From (UTC)') as HTMLInputElement).value).toBe('2026-09-25');
    expect((screen.getByLabelText('To (UTC)') as HTMLInputElement).value).toBe('2026-09-26');
  });

  it('R-8: the extra and the preset are pressed', async () => {
    arrive('range=90d');
    const { unmount } = render(<AdminCostAnalytics />);
    await settled();
    expect(screen.getByRole('button', { name: '90 days' }).getAttribute('aria-pressed')).toBe('true');
    unmount();

    arrive('range=today');
    render(<AdminCostAnalytics />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Today' }).getAttribute('aria-pressed')).toBe('true'));
  });

  it('R-11: All scope, a click on the Memory tile filters in place; a second click goes back to all', async () => {
    arrive('scope=all');
    render(<AdminCostAnalytics />);
    await settled();
    const memory = screen.getByTestId('category-card-memory');
    expect(memory.getAttribute('href')).toBe(`${PATH}?scope=all&category=memory`);

    const event = createEvent.click(memory, { button: 0 });
    fireEvent(memory, event);
    expect(event.defaultPrevented).toBe(true);
    await waitFor(() => expect(lastQuery().get('category')).toBe('memory'));
    expect(drillQueries()).toHaveLength(2);
    expect(window.location.search).toBe('?scope=all&category=memory');
    expect(screen.getByTestId('category-card-memory').getAttribute('aria-current')).toBe('true');
    expect(screen.getByTestId('filter-chip-category').textContent).toContain('Category: Memory');
    // The applied tile's link goes back to every category.
    expect(screen.getByTestId('category-card-memory').getAttribute('href')).toBe(`${PATH}?scope=all`);

    fireEvent.click(screen.getByTestId('category-card-memory'));
    await waitFor(() => expect(lastQuery().has('category')).toBe(false));
    expect(window.location.search).toBe('?scope=all');
    expect(screen.queryByTestId('filter-chip-category')).toBeNull();
  });

  it.each<[string, MouseEventInit]>([
    ['ctrl', { ctrlKey: true }],
    ['meta', { metaKey: true }],
    ['shift', { shiftKey: true }],
  ])('R-12: a %s click on a tile is left to the browser: no request, URL unchanged', async (_name, init) => {
    arrive('scope=all');
    render(<AdminCostAnalytics />);
    await settled();
    const memory = screen.getByTestId('category-card-memory');
    // Record whether the page prevented the default, then stop jsdom's own
    // navigation (which it does not implement) from a listener that runs after
    // the page's, at the document.
    let preventedByPage: boolean | null = null;
    const record = (clicked: Event) => {
      preventedByPage = clicked.defaultPrevented;
      clicked.preventDefault();
    };
    document.addEventListener('click', record);
    fireEvent(memory, createEvent.click(memory, { button: 0, ...init }));
    document.removeEventListener('click', record);
    expect(preventedByPage).toBe(false);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(drillQueries()).toHaveLength(1);
    expect(window.location.search).toBe('?scope=all');
    expect(memory.hasAttribute('aria-current')).toBe(false);
  });

  it('R-13: a drill click writes the filter and the next group by, and shows a chip with the row label', async () => {
    render(<AdminCostAnalytics />);
    await settled();
    fireEvent.change(screen.getByTestId('group-by-select'), { target: { value: 'feature' } });
    await waitFor(() => expect(lastQuery().get('breakdownBy')).toBe('feature'));
    // L-2b: the row drills through the link on its name (§5.8 D-3); the `tr` has no handler.
    const link = (await screen.findAllByRole('link', { name: 'Row feature' })).find((el) => el.closest('tbody'))!;
    fireEvent.click(link);
    await waitFor(() => expect(lastQuery().get('breakdownBy')).toBe('component'));
    expect(lastQuery().get('feature')).toBe('feature-1');
    expect(window.location.search).toBe('?group_by=component&feature=feature-1');
    const chip = screen.getByTestId('filter-chip-feature');
    expect(chip.textContent).toContain('Feature: Row feature');
    expect(within(chip).getByRole('button', { name: 'Remove feature' })).toBeTruthy();

    // The breadcrumb "All Data" clears the drill but keeps scope, window and group by.
    fireEvent.click(screen.getByRole('button', { name: 'All Data' }));
    await waitFor(() => expect(lastQuery().has('feature')).toBe(false));
    expect(window.location.search).toBe('?group_by=component');
  });

  it('R-14: Clear resets every filter, scope, window and group by included', async () => {
    arrive(`scope=all&range=7d&group_by=model&provider=openai&account=${ACCOUNT}`);
    render(<AdminCostAnalytics />);
    await settled();
    const clear = screen.getByRole('button', { name: 'Clear' }) as HTMLButtonElement;
    expect(clear.disabled).toBe(false);
    fireEvent.click(clear);
    await waitFor(() => expect(lastQuery().toString()).toBe('breakdownBy=provider&scope=bos&period=30'));
    expect(window.location.search).toBe('');
    expect((screen.getByRole('button', { name: 'Clear' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole('button', { name: '30 days' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByTestId('scope-toggle').getAttribute('aria-checked')).toBe('true');
  });

  it('a window button writes range and sends the period; 24 hours is period=1', async () => {
    render(<AdminCostAnalytics />);
    await settled();
    fireEvent.click(screen.getByRole('button', { name: '24 hours' }));
    await waitFor(() => expect(lastQuery().get('period')).toBe('1'));
    expect(window.location.search).toBe('?range=24h');
  });

  it('Custom applies only on Apply, with whole UTC days (F-54)', async () => {
    render(<AdminCostAnalytics />);
    await settled();
    fireEvent.click(screen.getByRole('button', { name: 'Custom' }));
    expect(drillQueries()).toHaveLength(1);
    fireEvent.change(screen.getByLabelText('From (UTC)'), { target: { value: '2026-09-01' } });
    fireEvent.change(screen.getByLabelText('To (UTC)'), { target: { value: '2026-09-05' } });
    expect(drillQueries()).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    await waitFor(() => expect(lastQuery().get('dateFrom')).toBe('2026-09-01T00:00:00.000Z'));
    expect(lastQuery().get('dateTo')).toBe('2026-09-05T23:59:59.999999Z');
    expect(window.location.search).toBe('?range=custom&from=2026-09-01&to=2026-09-05');
  });

  it('the scope switch writes scope=all and back, one request each', async () => {
    render(<AdminCostAnalytics />);
    await settled();
    fireEvent.click(screen.getByTestId('scope-toggle'));
    await waitFor(() => expect(lastQuery().get('scope')).toBe('all'));
    expect(window.location.search).toBe('?scope=all');
    await waitFor(() => expect(screen.getAllByRole('link', { name: /^Memory/ })).toHaveLength(1));
    fireEvent.click(screen.getByTestId('scope-toggle'));
    await waitFor(() => expect(lastQuery().get('scope')).toBe('bos'));
    expect(window.location.search).toBe('');
    expect(drillQueries()).toHaveLength(3);
  });
});
