/**
 * @jest-environment jsdom
 *
 * Money MK-8b (§8.2, §8.3): the AI cost drawers, through the real page.
 *
 *   Period check rows   → the billing-period drawer
 *   Leak check rows     → the business drawer (with its own Leak check)
 *
 * Every opening row opens the Businesses way (MK-10): a narrow "Details"
 * column with the row's `row-open` button ("Open details for …"), a mouse-only
 * row click through it, focus back on it on close, ONE request per open. The
 * page's load requests stay the T-12 / Pin C ones; a drawer's report request
 * and its Leak check request equal Pin C row 7 (the page with that business
 * picked). Read-only: the only drawer button besides Close is Run leak check.
 *
 * Only `Date` is faked (the #399 lesson); waits carry an explicit timeout.
 */

import '@testing-library/jest-dom';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

jest.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(window.location.search),
}));

import AiCostPage from '../page';
import { PeriodsSection } from '@/app/admin/business-os-llm/components/costs/CostsSections';
import { COSTS_PLATFORM_ACCOUNT } from '@/app/admin/business-os-llm/costCopy';
import type { CostPeriodFigures, CostPeriodLine, CostReportPayload } from '@/app/admin/business-os-llm/costTypes';
import type { LeakAccountFindingWire, LeakCheckPayload } from '@/app/admin/business-os-llm/leakTypes';
import { LEAK_PATH, PIN_ACCOUNT, PINNED_CHARGE_REQUESTS, REPORT_PATH } from '@/app/admin/finance/__tests__/chargeChecksRequestPins';

const WAIT = { timeout: 10_000 };
const NOW = new Date('2026-10-16T10:00:00.000Z');
const A = PIN_ACCOUNT;
const B = '2b3c4d5e-2222-4222-8222-bcdefabcdef0';
const ROW7 = PINNED_CHARGE_REQUESTS.find((pin) => pin.row === 7)!;

const figures = (credits: number, cost: number, charges: number): CostPeriodFigures => ({
  creditsTotal: credits,
  creditsOwner: credits,
  creditsScheduled: 0,
  creditsExternal: 0,
  creditsAdjustment: 0,
  costUsd: cost,
  charges,
  fallbackPriced: 0,
});

const PERIOD_A: CostPeriodLine = {
  accountId: A,
  companyName: 'Acme Dental',
  periodStart: '2026-09-20',
  stored: figures(100, 1.25, 10),
  fromRows: figures(120, 1.5, 10),
  matches: false,
};
const PERIOD_B: CostPeriodLine = {
  accountId: B,
  companyName: null,
  periodStart: '2026-10-02',
  stored: figures(50, 0.5, 4),
  fromRows: figures(50, 0.5, 4),
  matches: true,
};

function report(accountId: string | null): CostReportPayload {
  const periods = [PERIOD_A, PERIOD_B].filter((p) => accountId === null || p.accountId === accountId);
  return {
    generatedAt: '2026-10-16T09:00:00.000Z',
    window: { from: '2026-10-01', to: '2026-10-16', start: '2026-10-01T00:00:00.000Z', end: '2026-10-17T00:00:00.000Z' },
    accountFilter: accountId,
    periodLookbackDays: 31,
    incomplete: false,
    incompleteReasons: [],
    limits: { totalsCeiling: 2000, rowsCeiling: 20000, originalsMax: 1000, fallbackListMax: 50, fewExamplesBelow: 10 },
    sections: { totals: 'ok', rows: 'ok', names: 'ok', originals: 'ok' },
    rowsRead: 14,
    accounts: [
      { accountId: A, companyName: 'Acme Dental' },
      { accountId: B, companyName: null },
    ].filter((a) => accountId === null || a.accountId === accountId),
    periods,
    grandTotal: { stored: figures(150, 1.75, 14), fromRows: figures(170, 2, 14) },
    mismatchedPeriods: periods.filter((p) => p.matches === false).length,
    breakdowns: null,
    unresolvedCorrections: { count: 0, credits: 0, costUsd: 0 },
    fallback: {
      count: 1,
      reconciled: 0,
      items: [
        { accountId: A, companyName: 'Acme Dental', createdAt: '2026-10-03T10:00:00.000Z', actionType: 'x', groupId: 'g', actionId: 'a1', credits: 1, costUsd: 0.01, reconciled: false },
      ],
    },
    spreads: [],
    unreadableAmounts: 0,
    chargedInWindow:
      accountId === A
        ? { status: 'partial', coverage: 'after_cutover', costUsd: 1.5, credits: 120, charges: 10, rows: 10, deleted: null, unreadableAmounts: 1 }
        : { status: 'ok', coverage: 'after_cutover', costUsd: 2, credits: 170, charges: 14, rows: 14, deleted: { costUsd: 0, credits: 0, rows: 0 }, unreadableAmounts: 0 },
    recorded: { status: 'ok', recordedUsd: 2.5, recordedExact: true, aboveCharged: { state: 'figure', usd: 1 }, chargedAboveUsd: null },
  };
}

function finding(accountId: string, companyName: string | null, withExample: boolean): LeakAccountFindingWire {
  const example = { groupId: `grp-${accountId.slice(0, 4)}`, periodStart: null, calls: 2, usageUsd: 0.2, chargedUsd: 0, firstCallAt: null, lastCallAt: null, direction: null };
  return {
    accountId,
    companyName,
    status: 'leak',
    periodStart: null,
    periodStarts: [],
    counts: {
      groupsExamined: 3, matched: 2, uncharged: 1, undercharged: 0, ungroupedCalls: 0, noSpend: 0, pendingReconciliation: 0,
      pendingUndercharged: 0, chargedAboveUsage: 0, knownPathCalls: 0, unresolvedCorrections: 0, unreadableAmounts: 0,
    },
    usd: { uncharged: 0.2, undercharged: 0, ungrouped: 0, totalUncharged: 0.2, knownPath: 0 },
    examples: { uncharged: withExample ? [example] : [], undercharged: [], pendingReconciliation: [], chargedAboveUsage: [] },
    knownPaths: [],
    reasons: [],
  };
}

function leak(accountId: string | null): LeakCheckPayload {
  const accounts = [finding(A, 'Acme Dental', true), finding(B, 'Beta Clinic', false)].filter((f) => accountId === null || f.accountId === accountId);
  return {
    trigger: 'on_demand',
    window: { start: '2026-10-15T00:00:00.000Z', end: '2026-10-16T00:00:00.000Z' },
    endClamped: false,
    accountId,
    generatedAt: '2026-10-16T09:00:00.000Z',
    accountsChecked: accounts.length,
    accountsWithLeak: accounts.length,
    accountsIncomplete: 0,
    accountsNotChecked: 0,
    accountsRemaining: 0,
    deadlineReached: false,
    listingFailed: false,
    listing: { planAccounts: 2, chargedWithoutPlan: 0, plans: 'ok', totals: 'ok' },
    totals: { unchargedGroups: 2, ungroupedCalls: 0, underchargedGroups: 0, pendingReconciliation: 0, knownPathCalls: 0, matchedGroups: 4, noSpendGroups: 0, chargedAboveUsage: 0, unchargedUsd: 0.4 },
    platform: { businessOsCalls: 3, helperLabelCalls: 0, envIgnored: false },
    accounts,
    blindSpots: [],
  };
}

/** Override the drawer's report answer (accountId set) with a status and body. */
let drawerAnswer: { status: number; body: unknown } | null = null;
let fetchMock: jest.Mock;

function stub() {
  fetchMock = jest.fn(async (input: RequestInfo | URL) => {
    const url = new URL(String(input), 'http://localhost');
    const accountId = url.searchParams.get('accountId');
    if (url.pathname === REPORT_PATH) {
      if (accountId && drawerAnswer) {
        const { status, body } = drawerAnswer;
        return { ok: status < 300, status, json: async () => body } as Response;
      }
      return { ok: true, status: 200, json: async () => ({ success: true, data: report(accountId) }) } as Response;
    }
    if (url.pathname === LEAK_PATH) return { ok: true, status: 200, json: async () => ({ success: true, data: leak(accountId) }) } as Response;
    return { ok: true, status: 200, json: async () => ({ success: true, data: {} }) } as Response;
  });
  global.fetch = fetchMock as unknown as typeof fetch;
}
const urls = () => fetchMock.mock.calls.map((c) => String(c[0]));
const callsTo = (base: string) => urls().filter((u) => u.split('?')[0] === base);

function open(search = '') {
  window.history.replaceState(null, '', `/admin/ai-cost${search ? `?${search}` : ''}`);
  return render(<AiCostPage />);
}

async function loaded() {
  await screen.findAllByTestId('period-row', undefined, WAIT);
  await act(async () => {});
}

const periodRow = (accountId: string) =>
  screen.getAllByTestId('period-row').find((row) => row.querySelector(`td[title="${accountId}"]`))!;

const drawer = () => screen.getByTestId('ai-cost-drawer');

beforeEach(() => {
  jest.useFakeTimers({
    now: NOW,
    doNotFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'setImmediate', 'clearImmediate', 'queueMicrotask', 'nextTick', 'requestAnimationFrame', 'cancelAnimationFrame'],
  });
  drawerAnswer = null;
  stub();
});

afterEach(() => {
  jest.restoreAllMocks();
  jest.useRealTimers();
});

describe('MK-8b: the period check rows open the billing-period drawer', () => {
  it('load: the T-12 request only, a Details column, one opener per period row, none on the Total row', async () => {
    open();
    await loaded();
    expect(urls()).toEqual([PINNED_CHARGE_REQUESTS[0].report]);
    const table = screen.getByRole('table', { name: 'Per account and billing period' });
    const headers = within(table).getAllByRole('columnheader');
    expect(headers).toHaveLength(12);
    expect(headers[11]).toHaveTextContent('Details');
    expect(within(periodRow(A)).getByTestId('row-open')).toHaveAttribute('aria-label', 'Open details for Acme Dental, period from 2026-09-20');
    // A name the report could not read: the short id.
    expect(within(periodRow(B)).getByTestId('row-open')).toHaveAttribute('aria-label', 'Open details for Business 2b3c4d5e…, period from 2026-10-02');
    const total = screen.getByTestId('period-total-row');
    expect(within(total).queryByTestId('row-open')).toBeNull();
    // Total (colSpan 2), 8 figures, the Check cell and the empty Details cell: 11 cells over 12 columns.
    expect(total.querySelectorAll('td')).toHaveLength(11);
  });

  it('the button opens the right period with ONE request (Pin C row 7), the stored and rebuilt figures, and the full-view link', async () => {
    open();
    await loaded();
    fireEvent.click(within(periodRow(A)).getByTestId('row-open'));
    await screen.findByTestId('ai-cost-period-drawer-body', undefined, WAIT);
    expect(callsTo(REPORT_PATH)).toEqual([PINNED_CHARGE_REQUESTS[0].report, ROW7.report]);
    const body = screen.getByTestId('ai-cost-period-drawer-body');
    expect(within(drawer()).getByText('Acme Dental')).toBeInTheDocument();
    expect(within(body).getByTestId('period-check-mismatch')).toBeInTheDocument();
    const credits = within(body).getByTestId('ai-cost-drawer-figure-creditsTotal');
    expect(credits).toHaveTextContent('100');
    expect(credits).toHaveTextContent('120');
    // C-5: a word, not colour alone.
    expect(within(credits).getByTestId('ai-cost-drawer-differs')).toHaveTextContent('differs');
    expect(within(within(body).getByTestId('ai-cost-drawer-figure-charges')).queryByTestId('ai-cost-drawer-differs')).toBeNull();
    // The business in the window, printed like the strip: an unreadable amount is "at least".
    expect(within(body).getByTestId('ai-cost-drawer-charged')).toHaveTextContent(/at least \$1\.5/i);
    expect(within(body).getByTestId('ai-cost-drawer-credits')).toHaveTextContent('120 credits');
    expect(within(body).getByTestId('ai-cost-drawer-open-full')).toHaveAttribute('href', `/admin/ai-cost?account=${A}#costs-periods`);
    // Read-only: no Leak check in the period drawer, and Close is the only button.
    expect(within(drawer()).queryByRole('button', { name: 'Run leak check' })).toBeNull();
    expect(within(drawer()).getAllByRole('button').map((b) => b.getAttribute('aria-label') ?? b.textContent)).toEqual(['Close']);
  });

  it('a row click opens through the row button (one request); Escape returns focus to that button', async () => {
    open();
    await loaded();
    const row = periodRow(B);
    const button = within(row).getByTestId('row-open');
    fireEvent.click(row.querySelector('td:nth-child(3)') as Element);
    await screen.findByTestId('ai-cost-period-drawer-body', undefined, WAIT);
    expect(callsTo(REPORT_PATH)).toHaveLength(2);
    expect(callsTo(REPORT_PATH)[1]).toContain(`accountId=${B}`);
    expect(row.className).toContain('bg-slate-700/20');
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
    await waitFor(() => expect(document.activeElement).toBe(button), WAIT);
  });

  it('the button opens once, not twice through the row; a text selection does not open', async () => {
    open();
    await loaded();
    const row = periodRow(A);
    const cell = row.querySelector('td:nth-child(3)') as Element;
    const selection = jest
      .spyOn(window, 'getSelection')
      .mockReturnValue({ isCollapsed: false, anchorNode: cell.firstChild, focusNode: cell.firstChild } as unknown as Selection);
    fireEvent.click(cell);
    await act(async () => {});
    expect(callsTo(REPORT_PATH)).toHaveLength(1);
    selection.mockRestore();
    fireEvent.click(within(row).getByTestId('row-open'));
    await screen.findByTestId('ai-cost-period-drawer-body', undefined, WAIT);
    expect(callsTo(REPORT_PATH)).toHaveLength(2);
  });

  it('opening a second row switches the drawer with one more request', async () => {
    open();
    await loaded();
    fireEvent.click(within(periodRow(A)).getByTestId('row-open'));
    await screen.findByTestId('ai-cost-period-drawer-body', undefined, WAIT);
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
    await act(async () => {});
    fireEvent.click(within(periodRow(B)).getByTestId('row-open'));
    await waitFor(() => expect(callsTo(REPORT_PATH)).toHaveLength(3), WAIT);
    expect(callsTo(REPORT_PATH)[2]).toContain(`accountId=${B}`);
    await waitFor(() => expect(within(drawer()).getByText(/Business 2b3c4d5e…/)).toBeInTheDocument(), WAIT);
  });

  it('a period the new read does not hold says so', async () => {
    drawerAnswer = { status: 200, body: { success: true, data: { ...report(A), periods: [] } } };
    open();
    await loaded();
    fireEvent.click(within(periodRow(A)).getByTestId('row-open'));
    expect(await screen.findByTestId('ai-cost-drawer-period-gone', undefined, WAIT)).toBeInTheDocument();
  });

  it('with a business picked: no Details column and no opener (the page is the full view)', async () => {
    open(`account=${A}`);
    await loaded();
    expect(urls()).toEqual([ROW7.report]);
    expect(screen.queryAllByTestId('row-open')).toHaveLength(0);
    expect(within(screen.getByRole('table', { name: 'Per account and billing period' })).getAllByRole('columnheader')).toHaveLength(11);
  });

  it('the fallback list opens nothing', async () => {
    open();
    await loaded();
    for (const row of screen.getAllByTestId('fallback-row')) expect(within(row).queryByTestId('row-open')).toBeNull();
  });

  it('standalone (no provider): today\'s 11 columns and no opener (C-6)', () => {
    render(<PeriodsSection report={report(null)} />);
    expect(screen.getAllByRole('columnheader')).toHaveLength(11);
    expect(screen.queryAllByTestId('row-open')).toHaveLength(0);
    // Today's Total row: 10 cells over 11 columns (Total spans two).
    expect(screen.getByTestId('period-total-row').querySelectorAll('td')).toHaveLength(10);
  });
});

describe('MK-8b: the Leak check rows open the business drawer', () => {
  async function runPageLeak() {
    open();
    await loaded();
    fireEvent.click(screen.getByRole('button', { name: 'Run leak check' }));
    await screen.findByTestId('leak-accounts', undefined, WAIT);
  }

  it('the result rows have the opener; the examples row spans the new column; the platform line opens nothing', async () => {
    await runPageLeak();
    const table = screen.getByTestId('leak-accounts');
    expect(within(table).getAllByRole('columnheader')).toHaveLength(10);
    expect(within(screen.getByTestId(`leak-account-${A}`)).getByTestId('row-open')).toHaveAttribute('aria-label', 'Open details for Acme Dental');
    expect(within(screen.getByTestId(`leak-account-${B}`)).getByTestId('row-open')).toHaveAttribute('aria-label', 'Open details for Beta Clinic');
    const examples = screen.getByTestId(`leak-account-${A}`).nextElementSibling as HTMLElement;
    expect(examples.querySelector('td')).toHaveAttribute('colspan', '10');
    expect(within(examples).queryByTestId('row-open')).toBeNull();
    expect(within(screen.getByTestId('leak-platform')).queryByTestId('row-open')).toBeNull();
    // A click on the examples disclosure opens nothing.
    fireEvent.click(within(examples).getByText(/./, { selector: 'summary' }));
    await act(async () => {});
    expect(callsTo(REPORT_PATH)).toHaveLength(1);
  });

  it('opens the business drawer with one request; its Leak check sends nothing until pressed, then Pin C row 7; no KPI and no opener inside', async () => {
    await runPageLeak();
    fireEvent.click(screen.getByTestId(`leak-account-${A}`).querySelector('td:nth-child(3)') as Element);
    const body = await screen.findByTestId('ai-cost-business-drawer-body', undefined, WAIT);
    expect(callsTo(REPORT_PATH)).toEqual([PINNED_CHARGE_REQUESTS[0].report, ROW7.report]);
    expect(callsTo(LEAK_PATH)).toHaveLength(1);
    expect(within(body).getByTestId('ai-cost-drawer-recorded')).toHaveTextContent('$2.5');
    expect(within(body).getByTestId('ai-cost-drawer-above')).toHaveTextContent('$1');
    expect(within(body).getByTestId('ai-cost-drawer-periods-not-matching')).toHaveTextContent('1');
    expect(within(body).getAllByTestId('ai-cost-drawer-period')).toHaveLength(1);
    expect(within(body).queryByTestId('leak-kpi-uncharged')).toBeNull();
    expect(within(body).getByTestId('ai-cost-drawer-open-full')).toHaveAttribute('href', `/admin/ai-cost?account=${A}`);
    fireEvent.click(within(body).getByRole('button', { name: 'Run leak check' }));
    await within(body).findByTestId('leak-accounts', undefined, WAIT);
    expect(callsTo(LEAK_PATH)).toEqual([PINNED_CHARGE_REQUESTS[0].leak, ROW7.leak]);
    expect(within(body).queryAllByTestId('row-open')).toHaveLength(0);
    expect(callsTo(REPORT_PATH)).toHaveLength(2);
    // Read-only: Run leak check and Close are the only buttons.
    const names = within(drawer()).getAllByRole('button').map((b) => b.getAttribute('aria-label') ?? b.textContent?.trim());
    expect(names.sort()).toEqual(['Close', 'Run leak check']);
  });
});

describe('MK-8b: failure paths inside the drawer (C-4, never silent)', () => {
  async function openA() {
    open();
    await loaded();
    fireEvent.click(within(periodRow(A)).getByTestId('row-open'));
  }

  it('a 500: the shared error, the page behind it unchanged', async () => {
    drawerAnswer = { status: 500, body: { success: false, error: 'Could not build the report.' } };
    await openA();
    expect(await screen.findByTestId('ai-cost-drawer-error', undefined, WAIT)).toHaveTextContent('Could not build the report.');
    expect(screen.getAllByTestId('period-row')).toHaveLength(2);
  });

  it('a 409 platform account: the page\'s own platform sentence', async () => {
    drawerAnswer = { status: 409, body: { success: false, error: 'platform_account' } };
    await openA();
    expect(await screen.findByTestId('ai-cost-drawer-platform', undefined, WAIT)).toHaveTextContent(COSTS_PLATFORM_ACCOUNT);
  });

  it('a network failure: the shared network sentence', async () => {
    open();
    await loaded();
    const page = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      if (String(input).includes('accountId=')) throw new TypeError('offline');
      return page(input);
    });
    fireEvent.click(within(periodRow(A)).getByTestId('row-open'));
    expect(await screen.findByTestId('ai-cost-drawer-error', undefined, WAIT)).toHaveTextContent('Could not reach the server');
  });

  it('unknown figures say Unknown on those fields only', async () => {
    drawerAnswer = {
      status: 200,
      body: {
        success: true,
        data: {
          ...report(A),
          chargedInWindow: { status: 'unknown', coverage: 'after_cutover', costUsd: null, credits: null, charges: null, rows: null, deleted: null, unreadableAmounts: 0 },
          recorded: { status: 'unknown', recordedUsd: null, recordedExact: false, aboveCharged: { state: 'unknown', usd: null }, chargedAboveUsd: null },
        },
      },
    };
    await openA();
    const body = await screen.findByTestId('ai-cost-period-drawer-body', undefined, WAIT);
    for (const id of ['ai-cost-drawer-charged', 'ai-cost-drawer-credits', 'ai-cost-drawer-charges', 'ai-cost-drawer-recorded', 'ai-cost-drawer-above']) {
      expect(within(body).getByTestId(id)).toHaveTextContent(/^Unknown/);
    }
    expect(within(body).getByTestId('ai-cost-drawer-figure-costUsd')).toHaveTextContent('$1.25');
  });
});

describe('MK-8b QA B-1: "(differs)" follows the period check, never a partial rebuilt sum', () => {
  async function openPeriodWith(line: CostPeriodLine, extra: Partial<CostReportPayload> = {}) {
    drawerAnswer = { status: 200, body: { success: true, data: { ...report(A), periods: [line], ...extra } } };
    open();
    await loaded();
    fireEvent.click(within(periodRow(A)).getByTestId('row-open'));
    return screen.findByTestId('ai-cost-period-drawer-body', undefined, WAIT);
  }
  const rebuiltCell = (body: HTMLElement, key: string) => within(body).getByTestId(`ai-cost-drawer-figure-${key}`).querySelectorAll('td')[2];

  it('matches === false: each figure that differs is marked, the others are not', async () => {
    const body = await openPeriodWith(PERIOD_A);
    expect(within(body).getByTestId('period-check-mismatch')).toBeInTheDocument();
    expect(rebuiltCell(body, 'creditsTotal')).toHaveTextContent('120(differs)');
    expect(rebuiltCell(body, 'costUsd')).toHaveTextContent('(differs)');
    expect(within(rebuiltCell(body, 'charges')).queryByTestId('ai-cost-drawer-differs')).toBeNull();
  });

  it('matches === true: the rebuilt figures are shown and nothing is marked', async () => {
    const body = await openPeriodWith({ ...PERIOD_A, fromRows: PERIOD_A.stored, matches: true });
    expect(within(body).getByTestId('period-check-ok')).toBeInTheDocument();
    expect(rebuiltCell(body, 'creditsTotal')).toHaveTextContent('100');
    expect(within(body).queryAllByTestId('ai-cost-drawer-differs')).toHaveLength(0);
  });

  it('matches === null (QA probe: the rows read hit its ceiling, the rebuilt sum is partial): "not checked", the partial sum not shown, no "(differs)"', async () => {
    const body = await openPeriodWith(
      { ...PERIOD_A, fromRows: figures(60, 0.75, 6), matches: null },
      { incomplete: true, incompleteReasons: ['rows_ceiling'] }
    );
    expect(within(body).getByTestId('period-check-skipped')).toHaveTextContent('not checked');
    expect(within(body).queryAllByTestId('ai-cost-drawer-differs')).toHaveLength(0);
    // Stored is still shown; the partial rebuilt figures are not.
    expect(within(body).getByTestId('ai-cost-drawer-figure-creditsTotal').querySelectorAll('td')[1]).toHaveTextContent('100');
    for (const key of ['creditsTotal', 'costUsd', 'charges']) expect(rebuiltCell(body, key)).toHaveTextContent(/^—$/);
    expect(within(body).queryByText('60')).toBeNull();
  });
});
