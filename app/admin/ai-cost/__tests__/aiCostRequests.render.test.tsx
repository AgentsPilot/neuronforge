/**
 * @jest-environment jsdom
 *
 * Money MK-3b (T-12, SA-Q-MK3-2 ruling; T-2, T-8): every request each tab of
 * the AI cost page sends, for each window choice, pinned as exact strings; and
 * the tab behaviour around them.
 *
 *   Summary & checks: ONE request, the report (the strip and the tab).
 *   Calls: the same report request AND the drill-down request.
 *
 * The page's one URL spec: 7, 30 and 90 days are whole UTC days on both tabs;
 * "24 hours" is gone (a `range=24h` link falls back to This month, U-4); a
 * linked window (the Health tile's exact instants) is exact on Calls and read
 * as the whole UTC days that cover it for the report, with a line saying so
 * (SA-Q-MK3-3); `system` reads every business for the report, also said
 * (SA-Q-MK3-4). A tab switch never re-reads the report; leaving Calls resets
 * its own keys; Clear keeps the tab.
 *
 * Only `Date` is faked (no timer faking, the #399 lesson); every wait has an
 * explicit 10 s timeout. The Summary & checks report requests equal Pin C's
 * table for the same states (`app/admin/finance/__tests__/chargeChecksRequestPins.ts`).
 */

import '@testing-library/jest-dom';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';

jest.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(window.location.search),
}));

import AiCostPage from '../page';
import { AI_COST_SYSTEM_STRIP_NOTE, aiCostCoveringDaysLine } from '../aiCostCopy';
import type { CostReportPayload } from '@/app/admin/business-os-llm/costTypes';

const WAIT = { timeout: 10_000 };
const NOW = new Date('2026-10-16T10:00:00.000Z');
const A = '1a2b3c4d-1111-4111-8111-abcdefabcdef';
const REPORT = '/api/admin/business-os/credits/report';
const DRILL = '/api/admin/token-usage/drill-down';

const R = (query: string) => `${REPORT}?${query}`;
/** The drill-down request in its historical order; whole UTC days unless `linked` bounds are given. */
const D = (from: string, to: string, head = 'breakdownBy=provider&scope=bos') =>
  `${DRILL}?${head}&dateFrom=${encodeURIComponent(from)}&dateTo=${encodeURIComponent(to)}`;
/** MK-3b QA E-1: whole UTC days end at the day's last millisecond, A-K2's and Finance's inclusive end. */
const days = (from: string, to: string, head?: string) => D(`${from}T00:00:00.000Z`, `${to}T23:59:59.999Z`, head);

function report(): CostReportPayload {
  return {
    generatedAt: '2026-10-16T09:00:00.000Z',
    window: { from: '2026-10-01', to: '2026-10-16', start: '2026-10-01T00:00:00.000Z', end: '2026-10-17T00:00:00.000Z' },
    accountFilter: null,
    periodLookbackDays: 31,
    incomplete: false,
    incompleteReasons: [],
    limits: { totalsCeiling: 2000, rowsCeiling: 20000, originalsMax: 1000, fallbackListMax: 50, fewExamplesBelow: 10 },
    sections: { totals: 'ok', rows: 'ok', names: 'ok', originals: 'ok' },
    rowsRead: 1,
    accounts: [],
    periods: [],
    grandTotal: {
      stored: { creditsTotal: 0, creditsOwner: 0, creditsScheduled: 0, creditsExternal: 0, creditsAdjustment: 0, costUsd: 0, charges: 0, fallbackPriced: 0 },
      fromRows: null,
    },
    mismatchedPeriods: 0,
    breakdowns: null,
    unresolvedCorrections: { count: 0, credits: 0, costUsd: 0 },
    fallback: { count: 0, reconciled: 0, items: [] },
    spreads: [],
    unreadableAmounts: 0,
    chargedInWindow: { status: 'ok', coverage: 'after_cutover', costUsd: 12.5, credits: 1250, charges: 40, rows: 41, deleted: { costUsd: 0, credits: 0, rows: 0 }, unreadableAmounts: 0 },
    recorded: { status: 'ok', recordedUsd: 14, recordedExact: true, aboveCharged: { state: 'figure', usd: 1.5 }, chargedAboveUsd: null },
  };
}

const drillBody = {
  success: true,
  totals: { cost: 1.5, tokens: 100, inputTokens: 60, outputTokens: 40, calls: 3 },
  items: [],
  filters: {},
  availableFilters: { providers: [], models: [], activities: [], users: [], agents: [] },
  possiblyIncomplete: false,
};

let fetchMock: jest.Mock;
function stub() {
  fetchMock = jest.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    const body = url.startsWith(REPORT) ? { success: true, data: report() } : drillBody;
    return { ok: true, status: 200, json: async () => body } as Response;
  });
  global.fetch = fetchMock as unknown as typeof fetch;
}
const callsTo = (base: string) => fetchMock.mock.calls.map((c) => String(c[0])).filter((u) => u.split('?')[0] === base);

function open(search: string) {
  window.history.replaceState(null, '', `/admin/ai-cost${search ? `?${search}` : ''}`);
  return render(<AiCostPage />);
}

beforeEach(() => {
  jest.useFakeTimers({
    now: NOW,
    doNotFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'setImmediate', 'clearImmediate', 'queueMicrotask', 'nextTick', 'requestAnimationFrame', 'cancelAnimationFrame'],
  });
  stub();
});

afterEach(() => {
  jest.useRealTimers();
});

const LINK_FROM = '2026-10-14T08:14:00.000Z';
const LINK_TO = '2026-10-15T08:14:00.000Z';

/** [the window part of the state, the report request, the Calls drill-down request] */
const WINDOWS: ReadonlyArray<readonly [string, string, string]> = [
  ['', R('from=2026-10-01&to=2026-10-16'), days('2026-10-01', '2026-10-16')],
  ['range=today', R('from=2026-10-16&to=2026-10-16'), days('2026-10-16', '2026-10-16')],
  ['range=7d', R('from=2026-10-10&to=2026-10-16'), days('2026-10-10', '2026-10-16')],
  ['range=30d', R('from=2026-09-17&to=2026-10-16'), days('2026-09-17', '2026-10-16')],
  ['range=this_month', R('from=2026-10-01&to=2026-10-16'), days('2026-10-01', '2026-10-16')],
  ['range=90d', R('from=2026-07-19&to=2026-10-16'), days('2026-07-19', '2026-10-16')],
  ['range=custom&from=2026-09-01&to=2026-09-30', R('from=2026-09-01&to=2026-09-30'), days('2026-09-01', '2026-09-30')],
  // SA-Q-MK3-3: the Health tile's exact instants: exact on Calls, the covering whole UTC days for the report.
  [`dateFrom=${LINK_FROM}&dateTo=${LINK_TO}`, R('from=2026-10-14&to=2026-10-15'), D(LINK_FROM, LINK_TO)],
  // SA-Q-MK3-3 / U-4: "24 hours" is gone; such a link falls back to This month.
  ['range=24h', R('from=2026-10-01&to=2026-10-16'), days('2026-10-01', '2026-10-16')],
];

describe('T-12: every request of each tab, for each window choice (SA-Q-MK3-2)', () => {
  it.each(WINDOWS.map(([state, reportUrl]) => [state || '(default)', state, reportUrl] as const))(
    'Summary & checks, %s: the report request only',
    async (_label, state, reportUrl) => {
      const view = open(state);
      await waitFor(() => expect(callsTo(REPORT)).toHaveLength(1), WAIT);
      await act(async () => {});
      expect(callsTo(REPORT)).toEqual([reportUrl]);
      expect(callsTo(DRILL)).toEqual([]);
      view.unmount();
    }
  );

  it.each(WINDOWS.map(([state, reportUrl, drillUrl]) => [state || '(default)', state, reportUrl, drillUrl] as const))(
    'Calls, %s: the report request and the drill-down request',
    async (_label, state, reportUrl, drillUrl) => {
      const view = open(`tab=calls${state ? `&${state}` : ''}`);
      await waitFor(() => expect(callsTo(DRILL)).toHaveLength(1), WAIT);
      await waitFor(() => expect(callsTo(REPORT)).toHaveLength(1), WAIT);
      await act(async () => {});
      expect(callsTo(REPORT)).toEqual([reportUrl]);
      expect(callsTo(DRILL)).toEqual([drillUrl]);
      view.unmount();
    }
  );

  it.each([
    ['All products scope', 'tab=calls&scope=all', R('from=2026-10-01&to=2026-10-16'), days('2026-10-01', '2026-10-16', 'breakdownBy=provider&scope=all')],
    ['a drill', 'tab=calls&group_by=model&provider=openai', R('from=2026-10-01&to=2026-10-16'), days('2026-10-01', '2026-10-16', 'breakdownBy=model&scope=bos&provider=openai')],
    ['a business', `tab=calls&account=${A}`, R(`from=2026-10-01&to=2026-10-16&accountId=${A}`), days('2026-10-01', '2026-10-16', `breakdownBy=provider&scope=bos&user=${A}`)],
    // SA-Q-MK3-4: `system` is a Calls drill value; the report reads every business.
    ['system calls', 'tab=calls&account=system', R('from=2026-10-01&to=2026-10-16'), days('2026-10-01', '2026-10-16', 'breakdownBy=provider&scope=bos&user=system')],
  ] as const)('Calls, %s: the report keeps to window and business; the drill-down carries the Calls keys', async (_label, state, reportUrl, drillUrl) => {
    const view = open(state);
    await waitFor(() => expect(callsTo(DRILL)).toHaveLength(1), WAIT);
    await waitFor(() => expect(callsTo(REPORT)).toHaveLength(1), WAIT);
    await act(async () => {});
    expect(callsTo(REPORT)).toEqual([reportUrl]);
    expect(callsTo(DRILL)).toEqual([drillUrl]);
    view.unmount();
  });
});

describe('T-2 / T-8: the tabs, the strip and the window line', () => {
  it('exactly two tabs, "Summary & checks" then "Calls"; the strip is the same on both', async () => {
    open('');
    await screen.findByTestId('costs-kpi-cost', {}, WAIT);
    expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual(['Summary & checks', 'Calls']);
    fireEvent.click(screen.getByRole('tab', { name: 'Calls' }));
    await waitFor(() => expect(callsTo(DRILL)).toHaveLength(1), WAIT);
    expect(screen.getByRole('tab', { name: 'Calls' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByTestId('costs-kpi-cost')).toHaveAttribute('aria-label', 'Charged AI cost, $12.50');
    expect(window.location.search).toBe('?tab=calls');
  });

  it('a tab switch never re-reads the report; switching back reads nothing new for the report', async () => {
    open('range=7d');
    await waitFor(() => expect(callsTo(REPORT)).toHaveLength(1), WAIT);
    fireEvent.click(screen.getByRole('tab', { name: 'Calls' }));
    await waitFor(() => expect(callsTo(DRILL)).toHaveLength(1), WAIT);
    fireEvent.click(screen.getByRole('tab', { name: 'Summary & checks' }));
    await screen.findByTestId('costs-tab', {}, WAIT);
    await act(async () => {});
    expect(callsTo(REPORT)).toHaveLength(1);
    // The window is one value on both tabs.
    expect(window.location.search).toBe('?range=7d');
  });

  it('leaving Calls resets its own keys; the window and the business stay', async () => {
    open(`tab=calls&scope=all&group_by=model&provider=openai&range=7d&account=${A}`);
    await waitFor(() => expect(callsTo(DRILL)).toHaveLength(1), WAIT);
    fireEvent.click(screen.getByRole('tab', { name: 'Summary & checks' }));
    await screen.findByTestId('costs-tab', {}, WAIT);
    expect(window.location.search).toBe(`?range=7d&account=${A}`);
  });

  it('A-K2 opens the Calls tab in place; on Calls the check tiles open Summary & checks at their block', async () => {
    open('');
    const recorded = await screen.findByTestId('costs-kpi-recorded', {}, WAIT);
    expect(recorded).toHaveAttribute('href', '/admin/ai-cost?tab=calls');
    fireEvent.click(recorded);
    await waitFor(() => expect(screen.getByRole('tab', { name: 'Calls' })).toHaveAttribute('aria-selected', 'true'), WAIT);
    expect(screen.getByTestId('costs-kpi-recorded')).toHaveAttribute('aria-current', 'true');
    expect(screen.getByTestId('costs-kpi-cost')).toHaveAttribute('href', '/admin/ai-cost#costs-charged');
    expect(screen.getByTestId('costs-kpi-above')).toHaveAttribute('href', '/admin/ai-cost#costs-leak');
  });

  it('a linked window: exact on Calls, and the strip says it reads the covering whole UTC days', async () => {
    open(`tab=calls&scope=bos&dateFrom=${LINK_FROM}&dateTo=${LINK_TO}`);
    expect(await screen.findByTestId('ai-cost-covering-days', {}, WAIT)).toHaveTextContent(aiCostCoveringDaysLine('2026-10-14', '2026-10-15'));
    expect(await screen.findByTestId('linked-window-chip', {}, WAIT)).toBeInTheDocument();
  });

  it('system calls: the strip says it reads every business', async () => {
    open('tab=calls&account=system');
    expect(await screen.findByTestId('ai-cost-system-note', {}, WAIT)).toHaveTextContent(AI_COST_SYSTEM_STRIP_NOTE);
  });

  it('Clear on Calls resets every filter and keeps the tab', async () => {
    open(`tab=calls&scope=all&range=7d&account=${A}`);
    await waitFor(() => expect(callsTo(DRILL)).toHaveLength(1), WAIT);
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
    await waitFor(() => expect(window.location.search).toBe('?tab=calls'), WAIT);
  });
});

// ── SA-CR-MK3B F-1: a failed report is never silent; on Calls it takes the strip's place ──
import { COSTS_PLATFORM_ACCOUNT } from '@/app/admin/business-os-llm/costCopy';
import { ADMIN_NETWORK_ERROR } from '@/app/admin/components/layout/readAdminResponse';

describe('F-1: a failed report read on the Calls tab', () => {
  /** The report answers `report`; the drill-down always answers. */
  function stubReport(report: () => Promise<Response>) {
    fetchMock = jest.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith(REPORT)) return report();
      return { ok: true, status: 200, json: async () => drillBody } as Response;
    });
    global.fetch = fetchMock as unknown as typeof fetch;
  }
  const json = (status: number, body: unknown) => Promise.resolve({ ok: status === 200, status, json: async () => body } as Response);

  it('409 platform account: the platform notice in the strip’s place, no strip, the Calls content still shown', async () => {
    stubReport(() => json(409, { success: false, error: 'platform_account' }));
    open(`tab=calls&account=${A}`);
    expect(await screen.findByTestId('ai-cost-strip-platform-account', {}, WAIT)).toHaveTextContent(COSTS_PLATFORM_ACCOUNT);
    expect(screen.queryByTestId('costs-kpi-cost')).toBeNull();
    expect(screen.queryByTestId('ai-cost-strip-error')).toBeNull();
    await waitFor(() => expect(callsTo(DRILL)).toHaveLength(1), WAIT);
    expect(screen.getByTestId('calls-tab')).toBeInTheDocument();
  });

  it('a custom window over 92 days: the route’s own reason with Try again in the strip’s place; Try again re-reads', async () => {
    const reason = 'The window may be at most 92 days';
    stubReport(() => json(400, { success: false, error: reason }));
    open('tab=calls&range=custom&from=2026-01-01&to=2026-10-16');
    const error = await screen.findByTestId('ai-cost-strip-error', {}, WAIT);
    expect(error).toHaveTextContent(reason);
    expect(screen.queryByTestId('costs-kpi-cost')).toBeNull();
    // The Calls tab has no window cap of its own, so its read still runs.
    await waitFor(() => expect(callsTo(DRILL)).toHaveLength(1), WAIT);
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(callsTo(REPORT)).toHaveLength(2), WAIT);
  });

  it('a network failure: the shared sentence with Try again in the strip’s place', async () => {
    stubReport(() => Promise.reject(new TypeError('Failed to fetch')));
    open('tab=calls');
    expect(await screen.findByTestId('ai-cost-strip-error', {}, WAIT)).toHaveTextContent(ADMIN_NETWORK_ERROR);
    expect(screen.queryByTestId('costs-kpi-cost')).toBeNull();
  });

  it('on Summary & checks the failure is shown once, in the tab’s content, never also in the strip’s place', async () => {
    stubReport(() => Promise.reject(new TypeError('Failed to fetch')));
    open('');
    expect(await screen.findByTestId('costs-error', {}, WAIT)).toHaveTextContent(ADMIN_NETWORK_ERROR);
    expect(screen.queryByTestId('ai-cost-strip-error')).toBeNull();
    expect(screen.getAllByRole('alert')).toHaveLength(1);
  });
});

// ── MK-3b QA E-1: the Calls window ends where A-K2's does ─────────────────────
// A-K2 (and Finance) read the usage log over the report's half-open window less 1 ms (SA-Q52,
// `recordedReads.ts`): the last day ends at …23:59:59.999Z. The Calls request must end at the very
// same instant, so a call stamped in the day's last millisecond is counted on both or on neither.
// The report route's `windowInstants` rule, written out (importing the server module would load its
// Supabase client in jsdom): whole UTC dates, half-open, `[from 00:00, the day after to 00:00)`.
const windowInstants = ({ from, to }: { from: string; to: string }) => ({
  start: new Date(`${from}T00:00:00.000Z`),
  end: new Date(Date.parse(`${to}T00:00:00.000Z`) + 86_400_000),
});

describe('T-12 (E-1): the Calls drill-down ends at A-K2’s inclusive end', () => {
  it.each([
    ['the default (This month)', '', '2026-10-01', '2026-10-16'],
    ['7 days', 'range=7d', '2026-10-10', '2026-10-16'],
    ['a custom window', 'range=custom&from=2026-09-01&to=2026-09-30', '2026-09-01', '2026-09-30'],
  ] as const)('%s', async (_label, state, from, to) => {
    const view = open(`tab=calls${state ? `&${state}` : ''}`);
    await waitFor(() => expect(callsTo(DRILL)).toHaveLength(1), WAIT);
    await waitFor(() => expect(callsTo(REPORT)).toHaveLength(1), WAIT);
    const drill = new URL(callsTo(DRILL)[0], 'http://x').searchParams;
    const report = new URL(callsTo(REPORT)[0], 'http://x').searchParams;
    expect([report.get('from'), report.get('to')]).toEqual([from, to]);
    // A-K2's read: the report window's instants, the end less 1 ms (SA-Q52).
    const instants = windowInstants({ from, to });
    const aK2End = new Date(instants.end.getTime() - 1).toISOString();
    expect(aK2End).toBe(`${to}T23:59:59.999Z`);
    expect(drill.get('dateFrom')).toBe(instants.start.toISOString());
    expect(drill.get('dateTo')).toBe(aK2End);
    view.unmount();
  });
});
