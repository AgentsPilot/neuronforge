/**
 * @jest-environment jsdom
 */

/**
 * AI cost & usage — the Business OS lens (ADMIN_BOS_CLEANUP slice 3).
 *
 * Business OS scope shows only the Total card, no AgentsPilot table columns, no
 * Agent or Execution group-by, and its drill path never reaches agents
 * (C3-1, C3-2, W3-7). Switching to Business OS clears every hidden selection in
 * the same event (C3-4). "All" scope is unchanged, and its execution detail is
 * metadata only (C3-5, FYI-1).
 *
 * Every test in this file is also checked by the shared afterEach: no request
 * ever pairs scope=bos with a hidden view (W3-5).
 */

import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

jest.mock('@/lib/logger', () => ({
  createLogger: () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    child: jest.fn().mockReturnThis(),
  }),
}));

let mockSearch = '';
jest.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(mockSearch),
  useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
}));

import AdminCostAnalytics from '../page';

const ACCOUNT = '99999999-9999-4999-8999-999999999999';
const EXEC = '33333333-3333-4333-8333-333333333333';
const AGENT = '44444444-4444-4444-8444-444444444444';

const CATEGORIES = ['creation', 'execution', 'memory', 'system'] as const;
const ALL_DIMS = ['provider', 'model', 'activity', 'request_type', 'feature', 'component', 'endpoint', 'user', 'agent', 'execution'];
const BOS_DIMS = ALL_DIMS.filter((d) => d !== 'agent' && d !== 'execution');

type StubOptions = { emptyItems?: boolean; withChips?: boolean };

/**
 * One generic route stub. Each response has one row labelled after the
 * requested breakdown ("Row feature"), so a test can click its way down. The
 * execution detail is returned ONLY for a request that names an execution
 * (W3-5), and it carries owner text the page must never render.
 */
function stubRoute(options: StubOptions = {}): jest.Mock {
  const fetchMock = jest.fn(async (input: unknown) => {
    const q = new URL(String(input), 'http://x').searchParams;
    const breakdownBy = q.get('breakdownBy') ?? 'provider';
    const base = {
      success: true,
      totals: { cost: 1.5, tokens: 100, inputTokens: 60, outputTokens: 40, calls: 3 },
      filters: {},
      availableFilters: { providers: [], models: [], activities: [], users: [], agents: [] },
      categoryTotals: {
        creation: { cost: 0, tokens: 0, calls: 0 },
        execution: { cost: 0, tokens: 0, calls: 0 },
        memory: { cost: 0, tokens: 0, calls: 0 },
        system: { cost: 1.5, tokens: 100, calls: 3 },
      },
      period: { from: '2026-09-01T00:00:00.000Z', to: '2026-09-08T00:00:00.000Z' },
      scope: q.get('scope'),
      possiblyIncomplete: false,
    };
    let body: Record<string, unknown>;
    if (q.get('execution')) {
      body = {
        ...base,
        items: [
          {
            id: 'call-1',
            label: 'Step 1',
            cost: 0.5,
            tokens: 10,
            inputTokens: 6,
            outputTokens: 4,
            calls: 1,
            percentage: 100,
            type: 'call',
            metadata: { success: true },
          },
        ],
        // Extra keys on purpose: the page must not render them even if a
        // future route sent them (P-9).
        executionDetails: {
          executionId: EXEC,
          startedAt: '2026-09-03T10:00:00.000Z',
          completedAt: '2026-09-03T10:01:00.000Z',
          status: 'completed',
          inputData: { note: 'SECRET-input' },
          outputData: { note: 'SECRET-output' },
          agent: {
            id: AGENT,
            name: 'Agent One',
            connectedPlugins: ['google-mail'],
            mode: 'on_demand',
            status: 'active',
            userPrompt: 'SECRET-user-prompt',
            systemPrompt: 'SECRET-system-prompt',
            pilotSteps: [{ id: 'step1', name: 'SECRET-pilot-step' }],
            inputSchema: { field: 'SECRET-input-schema' },
            outputSchema: { field: 'SECRET-output-schema' },
          },
        },
      };
    } else {
      body = {
        ...base,
        items: options.emptyItems
          ? []
          : [
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
                metadata: options.withChips ? { agentCount: 2, executionCount: 3 } : {},
              },
            ],
      };
    }
    return { ok: true, status: 200, json: async () => body };
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- jsdom has no fetch; standard test stub
  (global as any).fetch = fetchMock;
  return fetchMock;
}

let fetchMock: jest.Mock;
const queries = (): URLSearchParams[] =>
  fetchMock.mock.calls.map(([u]) => new URL(String(u), 'http://x').searchParams);
const lastQuery = () => queries()[queries().length - 1];

/** The row in the table (the label also appears under Top Token Consumers). */
async function rowFor(label: string): Promise<HTMLElement> {
  await waitFor(() => expect(screen.getAllByText(label).some((el) => el.closest('tbody'))).toBe(true));
  return screen.getAllByText(label).find((el) => el.closest('tbody'))!.closest('tr')!;
}

async function groupBy(dim: string) {
  fireEvent.click(await screen.findByTestId(`group-by-${dim}`));
  await waitFor(() => expect(lastQuery().get('breakdownBy')).toBe(dim));
}

async function clickRowAndExpectNext(label: string, nextBreakdown: string) {
  fireEvent.click(await rowFor(label));
  await waitFor(() => expect(lastQuery().get('breakdownBy')).toBe(nextBreakdown));
}

beforeAll(() => {
  // framer-motion measures the detail panel's height animation; jsdom has no scrollTo.
  window.scrollTo = jest.fn() as unknown as typeof window.scrollTo;
});

beforeEach(() => {
  jest.clearAllMocks();
  mockSearch = '';
  fetchMock = stubRoute();
});

// P-13 / W3-5: across the whole run, no request pairs scope=bos with a view the
// route refuses there.
afterEach(() => {
  for (const q of queries()) {
    if (q.get('scope') !== 'bos') continue;
    expect(['agent', 'execution']).not.toContain(q.get('breakdownBy'));
    expect(q.has('agent')).toBe(false);
    expect(q.has('execution')).toBe(false);
    expect(q.has('category')).toBe(false);
  }
});

describe('what Business OS scope shows (C3-1, C3-2, W3-7)', () => {
  it('P-1: only the Total card, eight group-bys, no AgentsPilot table columns', async () => {
    render(<AdminCostAnalytics />);
    await rowFor('Row provider');

    expect(screen.getByTestId('category-card-total')).toBeTruthy();
    for (const c of CATEGORIES) expect(screen.queryByTestId(`category-card-${c}`)).toBeNull();
    for (const d of BOS_DIMS) expect(screen.getByTestId(`group-by-${d}`)).toBeTruthy();
    expect(screen.queryByTestId('group-by-agent')).toBeNull();
    expect(screen.queryByTestId('group-by-execution')).toBeNull();
    for (const c of ['creation', 'execution', 'memory']) expect(screen.queryByTestId(`table-col-${c}`)).toBeNull();
  });

  it('P-1: the empty state spans the Business OS column count', async () => {
    fetchMock = stubRoute({ emptyItems: true });
    render(<AdminCostAnalytics />);
    const empty = (await screen.findByText('No data found')).closest('td')!;
    expect(empty.getAttribute('colspan')).toBe('6');
  });

  it('P-2: "All" scope keeps all five cards, ten group-bys and the three columns', async () => {
    mockSearch = 'scope=all';
    render(<AdminCostAnalytics />);
    await rowFor('Row provider');

    expect(screen.getByTestId('category-card-total')).toBeTruthy();
    for (const c of CATEGORIES) expect(screen.getByTestId(`category-card-${c}`)).toBeTruthy();
    for (const d of ALL_DIMS) expect(screen.getByTestId(`group-by-${d}`)).toBeTruthy();
    for (const c of ['creation', 'execution', 'memory']) expect(screen.getByTestId(`table-col-${c}`)).toBeTruthy();
  });

  it('P-2: the "All" empty state still spans nine columns', async () => {
    mockSearch = 'scope=all';
    fetchMock = stubRoute({ emptyItems: true });
    render(<AdminCostAnalytics />);
    const empty = (await screen.findByText('No data found')).closest('td')!;
    expect(empty.getAttribute('colspan')).toBe('9');
  });

  it('P-7: no agent or execution context chips in Business OS; both in "All"', async () => {
    fetchMock = stubRoute({ withChips: true });
    const { unmount } = render(<AdminCostAnalytics />);
    await rowFor('Row provider');
    expect(screen.queryByText('2 agents')).toBeNull();
    expect(screen.queryByText('3 executions')).toBeNull();
    unmount();

    mockSearch = 'scope=all';
    render(<AdminCostAnalytics />);
    await rowFor('Row provider');
    expect(screen.getByText('2 agents')).toBeTruthy();
    expect(screen.getByText('3 executions')).toBeTruthy();
  });
});

describe('switching to Business OS (C3-4)', () => {
  it('P-3: a hidden group-by resets to Provider in the same event', async () => {
    mockSearch = 'scope=all';
    render(<AdminCostAnalytics />);
    await rowFor('Row provider');
    await groupBy('agent');

    fireEvent.click(screen.getByTestId('scope-toggle'));

    await waitFor(() => {
      expect(lastQuery().get('scope')).toBe('bos');
      expect(lastQuery().get('breakdownBy')).toBe('provider');
    });
    await rowFor('Row provider');
    expect(document.body.textContent).not.toContain('not valid');
  });

  it('P-8: an open execution detail is cleared, and no execution is sent', async () => {
    mockSearch = 'scope=all';
    render(<AdminCostAnalytics />);
    await rowFor('Row provider');
    await groupBy('agent');
    await clickRowAndExpectNext('Row agent', 'execution');
    fireEvent.click(await rowFor('Row execution'));
    expect(await screen.findByText('Agent One')).toBeTruthy();
    expect(lastQuery().get('execution')).toBe('execution-1');

    fireEvent.click(screen.getByTestId('scope-toggle'));

    await waitFor(() => expect(lastQuery().get('scope')).toBe('bos'));
    await rowFor('Row provider');
    expect(screen.queryByText('Agent One')).toBeNull();
    expect(lastQuery().has('execution')).toBe(false);
    expect(lastQuery().has('agent')).toBe(false);
  });
});

describe('the Business OS drill path never reaches agents (C3-2, FYI-2, W3-5)', () => {
  it.each(['activity', 'request_type', 'endpoint'])('P-10: a %s row goes to Feature', async (dim) => {
    render(<AdminCostAnalytics />);
    await rowFor('Row provider');
    await groupBy(dim);
    await clickRowAndExpectNext(`Row ${dim}`, 'feature');
  });

  it('P-4: a Feature row goes to Component', async () => {
    render(<AdminCostAnalytics />);
    await rowFor('Row provider');
    await groupBy('feature');
    await clickRowAndExpectNext('Row feature', 'component');
    expect(lastQuery().get('feature')).toBe('feature-1');
  });

  it('P-5: a User row with feature and component filtered goes to Model', async () => {
    render(<AdminCostAnalytics />);
    await rowFor('Row provider');
    await groupBy('feature');
    await clickRowAndExpectNext('Row feature', 'component');
    await clickRowAndExpectNext('Row component', 'user');
    await clickRowAndExpectNext('Row user', 'model');
  });

  it('P-11: with every Business OS dimension filtered, a row click stays put', async () => {
    mockSearch = `user=${ACCOUNT}`;
    render(<AdminCostAnalytics />);
    await clickRowAndExpectNext('Row provider', 'model');
    await clickRowAndExpectNext('Row model', 'activity');
    await clickRowAndExpectNext('Row activity', 'feature');
    await clickRowAndExpectNext('Row feature', 'component');
    // provider, model, user, feature and component are now all filtered.
    const before = fetchMock.mock.calls.length;
    fireEvent.click(await rowFor('Row component'));
    await waitFor(() => expect(fetchMock.mock.calls.length).toBeGreaterThan(before));
    const q = lastQuery();
    expect(q.get('breakdownBy')).toBe('component');
    for (const dim of ['provider', 'model', 'user', 'feature', 'component']) expect(q.has(dim)).toBe(true);
    expect(queries().some((x) => x.get('breakdownBy') === 'agent')).toBe(false);
  });
});

describe('"All" scope is unchanged (W3-5)', () => {
  it('P-6: a Feature row goes to Agent', async () => {
    mockSearch = 'scope=all';
    render(<AdminCostAnalytics />);
    await rowFor('Row provider');
    await groupBy('feature');
    await clickRowAndExpectNext('Row feature', 'agent');
  });

  it('P-12: an Activity row goes to Agent, and an Agent row to Execution', async () => {
    mockSearch = 'scope=all';
    render(<AdminCostAnalytics />);
    await rowFor('Row provider');
    await groupBy('activity');
    await clickRowAndExpectNext('Row activity', 'agent');
    await clickRowAndExpectNext('Row agent', 'execution');
  });
});

describe('the "All" execution detail is metadata only (C3-5, FYI-1)', () => {
  it('P-9: timing, status and plugins render; no owner-text section or marker does', async () => {
    mockSearch = 'scope=all';
    render(<AdminCostAnalytics />);
    await rowFor('Row provider');
    await groupBy('execution');
    fireEvent.click(await rowFor('Row execution'));
    expect(await screen.findByText('Agent One')).toBeTruthy();

    fireEvent.click(screen.getByText(/Show details/));

    expect(await screen.findByText('Started')).toBeTruthy();
    expect(screen.getByText('completed')).toBeTruthy();
    expect(screen.getByText('Connected Plugins')).toBeTruthy();
    expect(screen.getAllByText('google-mail').length).toBeGreaterThan(0);
    const text = document.body.textContent ?? '';
    for (const heading of [
      'Pilot Steps',
      'Input Schema',
      'Output Schema',
      'Execution Input',
      'Execution Output',
      'User Prompt',
    ]) {
      expect(text).not.toContain(heading);
    }
    expect(text).not.toContain('SECRET-');
  });
});
