/**
 * @jest-environment jsdom
 *
 * Money M-5: the Charge checks page (finance health §11H.4 CC-1 to CC-4;
 * AC-187, AC-189, AC-191). Today's cost report and its Leak check, mounted at
 * `/admin/finance/charges` under the standard header, with the report's own
 * URL state and no tab coordination (CR SA-Q-4).
 *
 * The request itself is pinned across the move by Pin C
 * (`chargeChecksRequest.pin.render.test.tsx`); the report's controls, states
 * and sections by `business-os-llm/__tests__/costsLayout.render.test.tsx`,
 * which mounts this page.
 *
 * `useSearchParams` follows `window.location` here, as Next does once a
 * `replaceState(null, …)` has been delivered (the `costsLayout.render` harness).
 */

import '@testing-library/jest-dom';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import * as fs from 'fs';
import * as path from 'path';

jest.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(window.location.search),
}));

import ChargeChecksPage from '../charges/page';
import { CHARGE_CHECKS_TITLE, COSTS_INTRO } from '@/app/admin/business-os-llm/costCopy';
import type { CostPeriodFigures, CostReportPayload } from '@/app/admin/business-os-llm/costTypes';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const PAGE = '/admin/finance/charges';
const REPORT_PATH = '/api/admin/business-os/credits/report';
const BUSINESSES_PATH = '/api/admin/business-os/llm-usage/businesses';
const WAIT = { timeout: 10_000 };

const figures = (over: Partial<CostPeriodFigures> = {}): CostPeriodFigures => ({
  creditsTotal: 4,
  creditsOwner: 4,
  creditsScheduled: 0,
  creditsExternal: 0,
  creditsAdjustment: 0,
  costUsd: 0.004,
  charges: 4,
  fallbackPriced: 0,
  ...over,
});

function report(): CostReportPayload {
  return {
    generatedAt: '2026-10-02T12:00:00.000Z',
    window: { from: '2026-09-03', to: '2026-10-02', start: '2026-09-03T00:00:00.000Z', end: '2026-10-03T00:00:00.000Z' },
    accountFilter: null,
    periodLookbackDays: 31,
    incomplete: false,
    incompleteReasons: [],
    limits: { totalsCeiling: 2000, rowsCeiling: 20000, originalsMax: 1000, fallbackListMax: 50, fewExamplesBelow: 10 },
    sections: { totals: 'ok', rows: 'ok', names: 'ok', originals: 'ok' },
    rowsRead: 4,
    accounts: [
      { accountId: A, companyName: 'Alpha Studio' },
      { accountId: B, companyName: 'Beta Bakery' },
    ],
    periods: [
      { accountId: A, companyName: 'Alpha Studio', periodStart: '2026-09-05T00:00:00+00:00', stored: figures(), fromRows: figures(), matches: true },
    ],
    grandTotal: { stored: figures(), fromRows: figures() },
    mismatchedPeriods: 0,
    breakdowns: { byActionType: [], byArea: [], byService: [], byTrigger: [] },
    unresolvedCorrections: { count: 0, credits: 0, costUsd: 0 },
    fallback: { count: 0, reconciled: 0, items: [] },
    spreads: [],
    unreadableAmounts: 0,
  };
}

function stub() {
  const fetchMock = jest.fn(async (input: RequestInfo | URL) => {
    const base = String(input).split('?')[0];
    const body =
      base === REPORT_PATH
        ? { success: true, data: report() }
        : base === BUSINESSES_PATH
          ? {
              success: true,
              data: {
                businesses: [
                  { userId: A, companyName: 'Alpha Studio' },
                  { userId: B, companyName: 'Beta Bakery' },
                ],
                limit: 50,
              },
            }
          : { success: false, error: 'not stubbed' };
    const status = base === REPORT_PATH || base === BUSINESSES_PATH ? 200 : 400;
    return { ok: status === 200, status, json: async () => body } as Response;
  });
  global.fetch = fetchMock as unknown as typeof fetch;
  return fetchMock;
}

const reportCalls = (fetchMock: jest.Mock) =>
  fetchMock.mock.calls.map((c) => String(c[0])).filter((url) => url.split('?')[0] === REPORT_PATH);

function openAt(search: string) {
  window.history.replaceState(null, '', `${PAGE}${search}`);
  return render(<ChargeChecksPage />);
}

beforeEach(() => {
  jest.restoreAllMocks();
  window.history.replaceState(null, '', PAGE);
});

describe('Charge checks: the page (CC-1 to CC-3, AC-187)', () => {
  it('one h1 "Charge checks", the neutral Read-only chip, and the report purpose line', async () => {
    stub();
    openAt('');
    const headings = screen.getAllByRole('heading', { level: 1 });
    expect(headings).toHaveLength(1);
    expect(headings[0]).toHaveTextContent(CHARGE_CHECKS_TITLE);
    expect(CHARGE_CHECKS_TITLE).toBe('Charge checks');
    const header = headings[0].closest('header') as HTMLElement;
    expect(within(header).getByText('Read-only')).toHaveAttribute('data-tone', 'neutral');
    expect(within(header).getByText(COSTS_INTRO)).toBeInTheDocument();
    await screen.findByTestId('costs-periods', {}, WAIT);
  });

  it('shows the cost report and the Leak check, with no tabs', async () => {
    stub();
    openAt('');
    expect(await screen.findByTestId('costs-periods', {}, WAIT)).toBeVisible();
    expect(screen.getByRole('button', { name: 'Run leak check' })).toBeVisible();
    expect(screen.queryAllByRole('tab')).toHaveLength(0);
  });
});

describe('Charge checks: its own URL state (AC-189, AC-191)', () => {
  it('reads once on first load, with no click (CostsTab active by default)', async () => {
    const fetchMock = stub();
    openAt('');
    await screen.findByTestId('costs-periods', {}, WAIT);
    expect(reportCalls(fetchMock)).toHaveLength(1);
  });

  it('a window change writes range by replaceState(null, …) with no tab', async () => {
    const fetchMock = stub();
    openAt('');
    await screen.findByTestId('costs-periods', {}, WAIT);
    const spy = jest.spyOn(window.history, 'replaceState');
    fireEvent.click(screen.getByRole('button', { name: '7 days' }));
    await waitFor(() => expect(reportCalls(fetchMock)).toHaveLength(2), WAIT);
    expect(spy).toHaveBeenLastCalledWith(null, '', `${PAGE}?range=7d`);
    expect(window.location.search).toBe('?range=7d');
  });

  it('picking a business writes account and reads that business', async () => {
    const fetchMock = stub();
    openAt('?range=7d');
    await screen.findByTestId('costs-periods', {}, WAIT);
    fireEvent.focus(screen.getByTestId('business-picker-input'));
    const list = await screen.findByTestId('business-picker-options', {}, WAIT);
    fireEvent.click(await within(list).findByText('Beta Bakery', {}, WAIT));
    await waitFor(() => expect(reportCalls(fetchMock)).toHaveLength(2), WAIT);
    expect(new URLSearchParams(reportCalls(fetchMock)[1].split('?')[1]).get('accountId')).toBe(B);
    await waitFor(() => expect(window.location.search).toBe(`?range=7d&account=${B}`), WAIT);
  });

  it('the redirect’s output (?tab=costs&range=7d&account=A) reads 7 days for that business once (AC-191)', async () => {
    const fetchMock = stub();
    openAt(`?tab=costs&range=7d&account=${A}`);
    await screen.findByTestId('costs-periods', {}, WAIT);
    const calls = reportCalls(fetchMock);
    expect(calls).toHaveLength(1);
    const params = new URLSearchParams(calls[0].split('?')[1]);
    expect(params.get('accountId')).toBe(A);
    const days = (Date.parse(`${params.get('to')}T00:00:00Z`) - Date.parse(`${params.get('from')}T00:00:00Z`)) / 86_400_000;
    expect(days).toBe(6);
  });
});

describe('Charge checks: source (CC-1, CC-3)', () => {
  const source = fs.readFileSync(path.join(process.cwd(), 'app/admin/finance/charges/page.tsx'), 'utf8');
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

  it("is a client page wrapped in Suspense, rendering CostsTab with no `active` prop", () => {
    expect(source).toMatch(/^['"]use client['"];/);
    expect(code).toMatch(/<Suspense[\s\S]*<CostsTab \/>[\s\S]*<\/Suspense>/);
    expect(code).not.toMatch(/\bactive=/);
  });

  it('reads and writes no URL itself, and imports no server module', () => {
    expect(code).not.toMatch(/useSearchParams|history\.|useRouter|router\./);
    expect(code).not.toMatch(/@\/lib\//);
  });
});
