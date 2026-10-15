/**
 * @jest-environment jsdom
 */

/**
 * AI cost & usage on the Admin Layout Standard, part b (L-2b): the table on
 * the shared classes, drill links, call status chips, the call drawer opened
 * from an Open button, the static run card, the summary cards below the table,
 * the empty state and the footer word (workplan §6.1 T-1 to T-13).
 *
 * The real page, with the L-2a harness: `next/navigation` and both loggers
 * mocked, the address bar read through `window.location.search`, requests
 * through the fetch mock. A `deferred` answer holds a read until the test
 * lands it, which is how the QA B-1 sequences (the open call leaves the data)
 * are driven.
 */

import React from 'react';
import { act, createEvent, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

jest.mock('@/lib/logger/client', () => {
  const noop = () => undefined;
  return { clientLogger: { child: () => ({ error: noop, warn: noop, info: noop, debug: noop }) } };
});

let mockSearch = '';
jest.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(mockSearch),
}));

/**
 * SA M-4: the page renders its one drawer unconditionally, outside every state
 * branch. A closed sheet puts nothing in the DOM, so the real drawer is wrapped
 * with a hidden marker that shows whether the page has it mounted (T-8). The
 * drawer itself is the real one.
 */
jest.mock('@/app/admin/components/layout/AdminDrawer', () => {
  const actual = jest.requireActual('@/app/admin/components/layout/AdminDrawer');
  const react = jest.requireActual('react');
  return {
    ...actual,
    AdminDrawer: (props: Record<string, unknown>) =>
      react.createElement(
        react.Fragment,
        null,
        react.createElement('span', { hidden: true, 'data-testid': 'drawer-mounted' }),
        react.createElement(actual.AdminDrawer, props),
      ),
  };
});

import { BUSINESS_SEARCH_PATH } from '@/app/admin/components/layout/AdminBusinessPicker';

import AdminCostAnalytics from '../page';

const PATH = '/admin/analytics';
const DRILL = '/api/admin/token-usage/drill-down?';
const ACCOUNT = '99999999-9999-4999-8999-999999999999';
const EXEC = '33333333-3333-4333-8333-333333333333';
const AGENT = '44444444-4444-4444-8444-444444444444';

/** Call 1: every key, the most expensive call. Call 2: failed, no activity or system keys. Call 3: no stored outcome. */
const CALLS = [
  {
    id: 'call-1',
    label: 'Step 1',
    cost: 0.75,
    tokens: 1500,
    inputTokens: 1000,
    outputTokens: 500,
    calls: 1,
    percentage: 75,
    type: 'call',
    isHighCost: true,
    metadata: {
      model: 'gpt-4o',
      provider: 'openai',
      latencyMs: 1234,
      success: true,
      timestamp: '2026-09-03T10:00:00.000Z',
      requestType: 'chat',
      dbCategory: 'agent_execution',
      category: 'execution',
      activityType: 'agent_run',
      activityName: 'Run agent',
      activityStep: 'plan',
      workflowStep: 'step-1',
      feature: 'agent-runner',
      component: 'planner',
      endpoint: '/api/run-agent',
      callId: 'call-id-0001',
    },
  },
  {
    id: 'call-2',
    label: 'Step 2',
    cost: 0.2,
    tokens: 300,
    inputTokens: 200,
    outputTokens: 100,
    calls: 1,
    percentage: 20,
    type: 'call',
    isHighCost: false,
    metadata: { model: 'gpt-4o-mini', provider: 'openai', latencyMs: 0, success: false, timestamp: '2026-09-03T10:00:30.000Z' },
  },
  {
    id: 'call-3',
    label: 'Step 3',
    cost: 0.05,
    tokens: 50,
    inputTokens: 30,
    outputTokens: 20,
    calls: 1,
    percentage: 5,
    type: 'call',
    isHighCost: false,
    metadata: { model: 'gpt-4o-mini', timestamp: '2026-09-03T10:00:45.000Z' },
  },
];

type Body = { calls?: string[]; empty?: boolean };
type Answer =
  | ({ kind: 'ok' } & Body)
  | { kind: 'json'; status: number; body: unknown }
  | { kind: 'pending' }
  | { kind: 'deferred' };

let answer: Answer = { kind: 'ok' };
/** Lands the read held by a `deferred` answer (QA B-1). */
let land: ((next: Exclude<Answer, { kind: 'deferred' } | { kind: 'pending' }>) => void) | null = null;

function okBody(query: URLSearchParams, options: Body) {
  const breakdownBy = query.get('breakdownBy') ?? 'provider';
  const base = {
    success: true,
    totals: { cost: 1.5, tokens: 100, inputTokens: 60, outputTokens: 40, calls: 3 },
    filters: {},
    availableFilters: { providers: [], models: [], activities: [], users: [], agents: [] },
    categoryTotals: {
      creation: { cost: 0.25, tokens: 10, calls: 1 },
      execution: { cost: 0.75, tokens: 50, calls: 1 },
      memory: { cost: 0.5, tokens: 40, calls: 1 },
      system: { cost: 0, tokens: 0, calls: 0 },
    },
    scope: query.get('scope'),
    possiblyIncomplete: false,
  };
  if (options.empty) return { ...base, items: [] };
  if (query.get('execution')) {
    const ids = options.calls ?? CALLS.map((c) => c.id);
    return {
      ...base,
      items: CALLS.filter((c) => ids.includes(c.id)),
      executionDetails: {
        executionId: EXEC,
        startedAt: '2026-09-03T10:00:00.000Z',
        completedAt: '2026-09-03T10:01:00.000Z',
        status: 'completed',
        inputData: { note: 'SECRET-input' },
        agent: {
          id: AGENT,
          name: 'Agent One',
          connectedPlugins: ['google-mail'],
          mode: 'on_demand',
          status: 'active',
          userPrompt: 'SECRET-user-prompt',
        },
      },
    };
  }
  return {
    ...base,
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
        category_breakdown: {
          creation: { cost: 0.25, tokens: 10, calls: 1 },
          execution: { cost: 0.75, tokens: 50, calls: 1 },
          memory: { cost: 0, tokens: 0, calls: 0 },
          system: { cost: 0.5, tokens: 40, calls: 1 },
        },
      },
    ],
  };
}

function respond(current: Answer, url: string): Promise<unknown> {
  const query = new URLSearchParams(url.split('?')[1]);
  switch (current.kind) {
    case 'ok':
      return Promise.resolve({ ok: true, status: 200, json: async () => okBody(query, current) });
    case 'json':
      return Promise.resolve({
        ok: current.status >= 200 && current.status < 300,
        status: current.status,
        json: async () => current.body,
      });
    case 'pending':
      return new Promise(() => undefined);
    case 'deferred':
      return new Promise((resolve) => {
        land = (next) => resolve(respond(next, url));
      });
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

function arrive(search: string) {
  window.history.replaceState(null, '', `${PATH}${search ? `?${search}` : ''}`);
  mockSearch = search;
}

const refreshButton = () => screen.getByRole('button', { name: 'Refresh AI cost and usage' }) as HTMLButtonElement;

async function settled() {
  await waitFor(() => expect(fetchMock).toHaveBeenCalled());
  await waitFor(() => expect(refreshButton().disabled).toBe(false));
}

async function renderAt(search: string) {
  arrive(search);
  render(<AdminCostAnalytics />);
  await settled();
}

const headerTexts = () => screen.getAllByRole('columnheader').map((th) => th.textContent);
const openButton = (n: number) => screen.getByRole('button', { name: new RegExp(`^Open details for call ${n},`) });

/** Escape on the open dialog, then wait for it to go. */
async function escape() {
  fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
}

/** Every element with a green class that is not inside a `data-tone="ok"` chip. */
function decorativeGreen(): string[] {
  const found: string[] = [];
  for (const el of Array.from(document.body.querySelectorAll('[class]'))) {
    const cls = el.getAttribute('class') ?? '';
    if (/emerald|green/.test(cls) && !el.closest('[data-tone="ok"]')) found.push(`${el.tagName}: ${cls}`);
  }
  return found;
}

let replaceSpy: jest.SpyInstance;
let pushSpy: jest.SpyInstance;

beforeEach(() => {
  jest.clearAllMocks();
  answer = { kind: 'ok' };
  land = null;
  arrive('');
  replaceSpy = jest.spyOn(window.history, 'replaceState');
  pushSpy = jest.spyOn(window.history, 'pushState');
  mockFetch();
});

afterEach(() => {
  // U-2: never pushState, and every write is replaceState(null, …).
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

describe('the table on the shared classes (§5.7)', () => {
  it('T-1: Business OS: named, four unique headers with scope=col, numbers right-aligned and tabular, no Trend', async () => {
    await renderAt('');
    const table = screen.getByRole('table', { name: 'AI cost by Provider' });
    const headers = screen.getAllByRole('columnheader');
    expect(headerTexts()).toEqual(['Provider', 'Cost (USD)', 'Tokens', 'Calls']);
    for (const th of headers) expect(th.getAttribute('scope')).toBe('col');
    expect(new Set(headerTexts()).size).toBe(headers.length);
    for (const th of headers.slice(1)) {
      expect(th.className).toContain('text-right');
      expect(th.className).not.toContain('font-mono');
    }
    const cells = within(within(table).getAllByRole('row')[1]).getAllByRole('cell');
    expect(cells).toHaveLength(4);
    for (const td of cells.slice(1)) {
      expect(td.className).toContain('text-right');
      expect(td.className).toContain('tabular-nums');
      expect(td.className).not.toContain('font-mono');
    }
    expect(document.body.textContent).not.toContain('Trend');
  });

  it('T-2: All: seven headers; grouped by Execution they stay unique', async () => {
    await renderAt('scope=all');
    expect(headerTexts()).toEqual([
      'Provider',
      'Cost (USD)',
      'Tokens',
      'Calls',
      'Creation (USD)',
      'Execution (USD)',
      'Memory (USD)',
    ]);
    fireEvent.change(screen.getByTestId('group-by-select'), { target: { value: 'execution' } });
    await waitFor(() => expect(lastQuery().get('breakdownBy')).toBe('execution'));
    await screen.findByRole('table', { name: 'AI cost by Execution' });
    const texts = headerTexts();
    expect(texts).toHaveLength(7);
    expect(texts).toContain('Execution');
    expect(texts).toContain('Execution (USD)');
    expect(new Set(texts).size).toBe(7);
  });
});

describe('aggregate rows drill through a real link (§5.8 D-3)', () => {
  it('T-3: a plain click is prevented and drills in place: one request, no reload', async () => {
    await renderAt('');
    const link = screen.getByRole('link', { name: 'Row provider' });
    expect(link.getAttribute('href')).toBe(`${PATH}?group_by=model&provider=provider-1`);

    const event = createEvent.click(link, { button: 0 });
    fireEvent(link, event);
    expect(event.defaultPrevented).toBe(true);
    await waitFor(() => expect(lastQuery().get('breakdownBy')).toBe('model'));
    expect(lastQuery().get('provider')).toBe('provider-1');
    expect(drillQueries()).toHaveLength(2);
    expect(window.location.search).toBe('?group_by=model&provider=provider-1');
  });

  it.each<[string, MouseEventInit]>([
    ['ctrl', { button: 0, ctrlKey: true }],
    ['meta', { button: 0, metaKey: true }],
    ['shift', { button: 0, shiftKey: true }],
    ['middle', { button: 1 }],
  ])('T-3: a %s click is left to the browser: not prevented, no request', async (_name, init) => {
    await renderAt('');
    const link = screen.getByRole('link', { name: 'Row provider' });
    // Record whether the page prevented the default, then stop jsdom's own
    // navigation from a listener that runs after the page's.
    let preventedByPage: boolean | null = null;
    const record = (clicked: Event) => {
      preventedByPage = clicked.defaultPrevented;
      clicked.preventDefault();
    };
    document.addEventListener('click', record);
    fireEvent(link, createEvent.click(link, init));
    document.removeEventListener('click', record);
    expect(preventedByPage).toBe(false);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(drillQueries()).toHaveLength(1);
    expect(window.location.search).toBe('');
  });

  it('QA-B1: Enter on a focused row name drills once, and focus lands on the content area, never <body>', async () => {
    await renderAt('');
    const link = screen.getByRole('link', { name: 'Row provider' });
    link.focus();
    expect(document.activeElement).toBe(link);
    // A browser turns Enter on a link into a click (button 0, no modifier); jsdom does not.
    fireEvent.keyDown(link, { key: 'Enter' });
    fireEvent.click(link, { button: 0 });
    await waitFor(() => expect(lastQuery().get('breakdownBy')).toBe('model'));
    await screen.findByRole('link', { name: 'Row model' });
    await settled();
    expect(drillQueries()).toHaveLength(2);
    expect(link.isConnected).toBe(false);
    expect(document.activeElement).not.toBe(document.body);
    expect(document.activeElement).toBe(screen.getByTestId('analytics-content'));
  });

  it('T-3: the row itself has no click handler: a click on the cost cell sends nothing', async () => {
    await renderAt('');
    const row = screen.getByRole('link', { name: 'Row provider' }).closest('tr')!;
    fireEvent.click(within(row).getAllByRole('cell')[1]);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(drillQueries()).toHaveLength(1);
  });
});

describe('call rows, status chips and the call drawer (§5.8 D-1 to D-6, §5.9)', () => {
  const RUN = `scope=all&execution=${EXEC}`;

  // LF-8 (user request 2026-10-15): the Open button moved from the first cell
  // to a narrow last column whose "Details" header is screen-reader-only.
  it('T-4: eight headers, an Open button last in each row, status in words', async () => {
    await renderAt(RUN);
    expect(screen.getByRole('table', { name: 'AI calls in this run' })).toBeTruthy();
    expect(headerTexts()).toEqual([
      'Call',
      'Cost (USD)',
      'Input tokens',
      'Output tokens',
      'Total tokens',
      'Latency',
      'Status',
      'Details',
    ]);
    const rows = within(screen.getByRole('table')).getAllByRole('row').slice(1, 4);
    rows.forEach((row, index) => {
      const cells = within(row).getAllByRole('cell');
      const last = cells[cells.length - 1];
      expect(within(last).getByRole('button').getAttribute('aria-label')).toBe(
        `Open details for call ${index + 1}, Step ${index + 1}`,
      );
    });
    const chips = screen.getAllByTestId('call-status');
    expect(chips.map((chip) => [chip.textContent, chip.getAttribute('data-tone')])).toEqual([
      ['Succeeded', 'ok'],
      ['Failed', 'danger'],
      ['Unknown', 'unknown'],
    ]);
    expect(document.body.textContent).not.toMatch(/[✓✗]/);
    // Latency 0 is a dash in the cell, as before (SA S-3).
    expect(within(rows[1]).getAllByRole('cell')[5].textContent).toBe('—');
    expect(within(rows[0]).getAllByRole('cell')[5].textContent).toBe('1234ms');
  });

  // LF-8 SA F-2: the footer spans exactly the eight headers, so every total sits
  // under its own column, and its last cell is the narrow Open column.
  it('T-4b: the call footer spans the eight headers and ends on the narrow Open cell', async () => {
    await renderAt(RUN);
    const footerCells = Array.from(
      screen.getByTestId('analytics-footer').querySelectorAll('td'),
    ) as HTMLTableCellElement[];
    const width = footerCells.reduce((sum, cell) => sum + cell.colSpan, 0);
    expect(headerTexts()).toHaveLength(8);
    expect(width).toBe(8);
    expect(footerCells[footerCells.length - 1].classList.contains('w-10')).toBe(true);
  });

  it('T-5: Open shows the call from the loaded row, in UTC, without colour, and sends no request', async () => {
    await renderAt(RUN);
    const before = fetchMock.mock.calls.length;

    fireEvent.click(openButton(1));
    const dialog = await screen.findByRole('dialog', { name: 'Call details 2026-09-03 10:00 UTC' });
    const fieldValue = (label: string) => within(dialog).getByText(label, { selector: 'dt' }).nextElementSibling!;
    expect(fieldValue('Model').textContent).toBe('gpt-4o');
    expect(fieldValue('Provider').textContent).toBe('openai');
    expect(fieldValue('Status').textContent).toBe('Succeeded');
    expect(fieldValue('Time').textContent).toBe('2026-09-03 10:00 UTC');
    expect(fieldValue('Latency').textContent).toBe('1.23s');
    const cost = within(dialog).getByTestId('call-detail-cost');
    expect(cost.textContent).toBe('$0.75most expensive call in this run');
    for (const el of [cost, ...Array.from(cost.querySelectorAll('*'))]) {
      expect(el.getAttribute('class') ?? '').not.toMatch(/green|emerald|red/);
    }
    expect(within(dialog).getByRole('group', { name: 'Activity' })).toBeTruthy();
    expect(within(dialog).getByRole('group', { name: 'System context' })).toBeTruthy();
    await escape();

    fireEvent.click(openButton(2));
    const second = await screen.findByRole('dialog', { name: 'Call details 2026-09-03 10:00 UTC' });
    expect(within(second).getByText('Step 2', { selector: 'dd' })).toBeTruthy();
    expect(second.textContent).not.toContain('most expensive call in this run');
    expect(within(second).queryByRole('group', { name: 'Activity' })).toBeNull();
    expect(within(second).queryByRole('group', { name: 'System context' })).toBeNull();
    // Latency 0 has no field in the drawer (SA S-3).
    expect(within(second).queryByText('Latency', { selector: 'dt' })).toBeNull();
    await escape();

    // A call with no stored outcome reads Unknown (SA S-6, Q-6).
    fireEvent.click(openButton(3));
    const third = await screen.findByRole('dialog');
    expect(within(third).getByTestId('call-detail-status').textContent).toBe('Unknown');
    await escape();

    expect(fetchMock.mock.calls.length).toBe(before);
  });

  it('T-6: Escape returns focus to that row\'s Open button; the X, named "Close", does the same', async () => {
    await renderAt(RUN);
    const second = openButton(2);
    second.focus();
    fireEvent.click(second);
    await screen.findByRole('dialog');
    await escape();
    expect(document.activeElement).toBe(second);

    const first = openButton(1);
    first.focus();
    fireEvent.click(first);
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(document.activeElement).toBe(first);
  });
});

describe('QA B-1: the open call leaves the data', () => {
  const RUN = `scope=all&execution=${EXEC}`;

  it('T-7: a read that lands without the open call closes the drawer, keeps focus off <body>, and a later read does not reopen it', async () => {
    await renderAt(RUN);
    answer = { kind: 'deferred' };
    fireEvent.click(refreshButton());
    await waitFor(() => expect(land).not.toBeNull());

    const second = openButton(2);
    second.focus();
    fireEvent.click(second);
    await screen.findByRole('dialog');

    await act(async () => {
      land?.({ kind: 'ok', calls: ['call-1', 'call-3'] });
    });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(screen.getAllByTestId('call-status')).toHaveLength(2));
    await waitFor(() => expect(document.activeElement).not.toBe(document.body));
    expect(document.activeElement?.isConnected).toBe(true);

    // A later read brings the call back: the drawer stays closed.
    land = null;
    answer = { kind: 'ok' };
    fireEvent.click(refreshButton());
    await waitFor(() => expect(screen.getAllByTestId('call-status')).toHaveLength(3));
    await settled();
    expect(screen.queryByRole('dialog')).toBeNull();

    // Open still works.
    fireEvent.click(openButton(2));
    expect(await screen.findByRole('dialog')).toBeTruthy();
  });

  it('T-8: success, then a failed read with the drawer open, then Try again: no dialog, focus kept, first-read state, then the table', async () => {
    await renderAt(RUN);
    answer = { kind: 'deferred' };
    fireEvent.click(refreshButton());
    await waitFor(() => expect(land).not.toBeNull());

    const first = openButton(1);
    first.focus();
    fireEvent.click(first);
    await screen.findByRole('dialog');

    await act(async () => {
      land?.({ kind: 'json', status: 500, body: { success: false, error: 'Internal server error' } });
    });
    expect((await screen.findByTestId('analytics-error')).textContent).toBe('Internal server error');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(document.activeElement).not.toBe(document.body));
    expect(document.activeElement?.isConnected).toBe(true);
    expect(screen.queryByTestId('category-card-total')).toBeNull();
    // SA M-4: the drawer closed through its `open` prop; it was never unmounted with the content.
    expect(screen.getByTestId('drawer-mounted')).toBeTruthy();

    land = null;
    answer = { kind: 'deferred' };
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(screen.queryByTestId('analytics-error')).toBeNull());
    expect(screen.getAllByTestId('kpi-placeholder')).toHaveLength(5);
    expect(screen.getByRole('status').textContent).toBe('Reading AI cost and usage…');
    expect(document.body.textContent).not.toContain('$0.00');
    expect(screen.queryByTestId('analytics-empty')).toBeNull();
    expect(screen.getByTestId('drawer-mounted')).toBeTruthy();

    await act(async () => {
      land?.({ kind: 'ok' });
    });
    await waitFor(() => expect(screen.getAllByTestId('call-status')).toHaveLength(3));
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

describe('colour, the run card, the empty state, the footer and the cards', () => {
  it('T-9: no decorative green anywhere outside an ok chip: Business OS and All aggregate tables', async () => {
    await renderAt('');
    expect(decorativeGreen()).toEqual([]);

    fireEvent.click(screen.getByTestId('scope-toggle'));
    await waitFor(() => expect(lastQuery().get('scope')).toBe('all'));
    await screen.findByTestId('table-col-execution');
    await settled();
    // The Execution (USD) cell holds a cost here, so a coloured cell would show.
    expect(within(screen.getByRole('link', { name: 'Row provider' }).closest('tr')!).getAllByRole('cell')[5].textContent).toBe(
      '$0.75',
    );
    expect(decorativeGreen()).toEqual([]);
  });

  it('T-9: a run (call table, run card and summary cards) has no decorative green either', async () => {
    await renderAt(`scope=all&execution=${EXEC}`);
    expect(screen.getByTestId('execution-card')).toBeTruthy();
    expect(screen.getByTestId('analytics-summary')).toBeTruthy();
    expect(decorativeGreen()).toEqual([]);
    // The one green on the page is the ok chip.
    expect(document.body.querySelector('[data-tone="ok"]')).not.toBeNull();
  });

  it('T-10: the run card shows the run, both statuses, the short agent id and the plugins, with no button and no owner text', async () => {
    await renderAt(`scope=all&execution=${EXEC}`);
    const card = screen.getByTestId('execution-card');
    expect(within(card).getByRole('heading', { level: 2 }).textContent).toBe('Agent One');
    expect(card.textContent).toContain('Agent run · on_demand · 1 plugin(s)');
    const value = (label: string) => within(card).getByText(label, { selector: 'dt' }).nextElementSibling!;
    expect(value('Started').textContent).toBe('2026-09-03 10:00 UTC');
    expect(value('Completed').textContent).toBe('2026-09-03 10:01 UTC');
    const runStatus = within(card).getByTestId('run-status');
    expect(runStatus.textContent).toBe('completed');
    expect(runStatus.getAttribute('data-tone')).toBe('ok');
    // SA M-2: the agent's own status stays, labelled apart, as plain text.
    expect(value('Agent status').textContent).toBe('active');
    expect(value('Agent status').querySelector('[data-tone]')).toBeNull();
    const agentId = within(value('Agent ID') as HTMLElement).getByText('44444444…');
    expect(agentId.getAttribute('title')).toBe(AGENT);
    expect(value('Connected plugins').textContent).toBe('google-mail');
    expect(within(card).queryByRole('button')).toBeNull();
    expect(document.body.textContent).not.toContain('SECRET-');
    // The card comes before the count line, which sits directly above the table (SA S-2).
    const count = screen.getByTestId('analytics-count');
    const table = screen.getByRole('table');
    expect(card.compareDocumentPosition(count) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(count.nextElementSibling).toBe(table.parentElement);
  });

  it('T-11: empty: the sentence, no table; "Clear filters" only while a filter is on, and it cleans the URL', async () => {
    answer = { kind: 'ok', empty: true };
    const { unmount } = render(<AdminCostAnalytics />);
    await settled();
    const empty = screen.getByTestId('analytics-empty');
    expect(empty.textContent).toContain('No AI usage matches this window and these filters.');
    expect(screen.queryByRole('table')).toBeNull();
    expect(within(empty).queryByRole('button', { name: 'Clear filters' })).toBeNull();
    unmount();

    await renderAt('provider=openai');
    const filtered = screen.getByTestId('analytics-empty');
    fireEvent.click(within(filtered).getByRole('button', { name: 'Clear filters' }));
    await waitFor(() => expect(window.location.search).toBe(''));
    await waitFor(() => expect(lastQuery().has('provider')).toBe(false));
  });

  it('T-12: the footer says Total at defaults, Subtotal after a feature drill and with an account (F-49)', async () => {
    await renderAt('');
    expect(within(screen.getByTestId('analytics-footer')).getAllByRole('cell')[0].textContent).toBe('Total');

    fireEvent.change(screen.getByTestId('group-by-select'), { target: { value: 'feature' } });
    await waitFor(() => expect(lastQuery().get('breakdownBy')).toBe('feature'));
    fireEvent.click(await screen.findByRole('link', { name: 'Row feature' }));
    await waitFor(() => expect(lastQuery().get('feature')).toBe('feature-1'));
    await settled();
    expect(within(screen.getByTestId('analytics-footer')).getAllByRole('cell')[0].textContent).toBe('Subtotal');
  });

  it('T-12: with ?account= the footer says Subtotal', async () => {
    await renderAt(`account=${ACCOUNT}`);
    expect(within(screen.getByTestId('analytics-footer')).getAllByRole('cell')[0].textContent).toBe('Subtotal');
    // Call counts are exact in the footer (SA S-1).
    expect(within(screen.getByTestId('analytics-footer')).getAllByRole('cell')[3].textContent).toBe('3');
  });

  it('T-13: the summary cards follow the table, with h2 titles and the same values', async () => {
    await renderAt('');
    const table = screen.getByRole('table');
    const summary = screen.getByTestId('analytics-summary');
    expect(table.compareDocumentPosition(summary) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByRole('heading', { level: 2, name: 'Quick stats' })).toBeTruthy();
    expect(screen.getByRole('heading', { level: 2, name: 'Top 3 by cost' })).toBeTruthy();
    const stats = screen.getByTestId('quick-stats');
    const stat = (label: string) => within(stats).getByText(label, { selector: 'dt' }).nextElementSibling!;
    expect(stat('Calls').textContent).toBe('3');
    expect(stat('Avg cost per call').textContent).toBe('$0.50');
    expect(screen.getByTestId('top-by-cost').textContent).toContain('100% of cost');
    expect(document.body.textContent).not.toContain('Top Token Consumers');
  });
});
