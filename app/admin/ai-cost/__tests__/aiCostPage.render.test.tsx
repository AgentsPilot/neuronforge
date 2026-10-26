/**
 * @jest-environment jsdom
 *
 * Money MK-3a (T-1): the AI cost page, Summary & checks content. The header
 * (h1 "AI cost", the §14 purpose line, the Read-only badge), the fixed
 * two-line legend, the strip A-K1 to A-K5, the recorded block (C-7) and the
 * Leak check with its block KPI under `#costs-leak`. One report request on
 * load, nothing else (the Leak check runs only on its button; the Calls tab
 * and its drill-down read arrive in MK-3b). A failed report keeps the header,
 * the legend and the Leak check.
 */

import '@testing-library/jest-dom';
import { render, screen, waitFor, within } from '@testing-library/react';

jest.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(window.location.search),
}));

import AiCostPage from '../page';
import { AI_COST_LEGEND, AI_COST_PURPOSE, AI_COST_TITLE } from '../aiCostCopy';
import { LEAK_KPI_LABEL, LEAK_KPI_NOT_RUN } from '@/app/admin/business-os-llm/leakCopy';
import type { CostReportPayload } from '@/app/admin/business-os-llm/costTypes';

const REPORT_PATH = '/api/admin/business-os/credits/report';
const WAIT = { timeout: 10_000 };

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

function stub(answer: () => { status: number; body: unknown }) {
  const fetchMock = jest.fn(async () => {
    const { status, body } = answer();
    return { ok: status === 200, status, json: async () => body } as Response;
  });
  global.fetch = fetchMock as unknown as typeof fetch;
  return fetchMock;
}

const urls = (fetchMock: jest.Mock) => fetchMock.mock.calls.map((c) => String(c[0]));

beforeEach(() => {
  window.history.replaceState(null, '', '/admin/ai-cost?tab=checks');
});

describe('MK-3a: the AI cost page (Summary & checks)', () => {
  it('header, legend, strip, recorded block and Leak check; one report request and nothing else', async () => {
    const fetchMock = stub(() => ({ status: 200, body: { success: true, data: report() } }));
    render(<AiCostPage />);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(AI_COST_TITLE);
    expect(screen.getByText(AI_COST_PURPOSE)).toBeInTheDocument();
    expect(screen.getByText('Read-only')).toBeInTheDocument();
    const legend = screen.getByTestId('ai-cost-legend');
    expect(legend).toHaveTextContent(AI_COST_LEGEND.charged.term);
    expect(legend).toHaveTextContent(AI_COST_LEGEND.recorded.term);

    expect(await screen.findByTestId('costs-kpi-cost', {}, WAIT)).toHaveAttribute('aria-label', 'Charged AI cost, $12.50');
    expect(screen.getByTestId('costs-kpi-recorded')).toHaveAttribute('aria-label', 'Recorded AI cost, $14.00');
    expect(screen.getByTestId('costs-kpi-above')).toHaveAttribute('aria-label', 'Recorded above charged, $1.50');

    // The recorded block, then the Leak check with its block KPI, under one anchor.
    const leak = screen.getByTestId('costs-leak');
    expect(leak).toHaveAttribute('id', 'costs-leak');
    const recordedBlock = within(leak).getByTestId('costs-recorded');
    const panel = within(leak).getByTestId('leak-panel');
    expect(recordedBlock.compareDocumentPosition(panel) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(panel).getByTestId('leak-kpi-uncharged-kpi')).toHaveAttribute('aria-label', `${LEAK_KPI_LABEL}, ${LEAK_KPI_NOT_RUN}`);

    // The legend sits above the strip (the order of §4).
    expect(legend.compareDocumentPosition(screen.getByTestId('costs-kpi-cost')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    await waitFor(() => expect(urls(fetchMock).filter((u) => u.split('?')[0] === REPORT_PATH)).toHaveLength(1), WAIT);
    expect(urls(fetchMock).every((u) => u.split('?')[0] === REPORT_PATH)).toBe(true);
    expect(urls(fetchMock).some((u) => u.includes('/token-usage/drill-down'))).toBe(false);
    // The redirect's tab=checks is kept, untouched.
    expect(window.location.search).toContain('tab=checks');
  });

  it('a failed report: the header, the legend and the Leak check stay; no strip, no recorded block', async () => {
    stub(() => ({ status: 500, body: { success: false, error: 'boom' } }));
    render(<AiCostPage />);
    expect(await screen.findByTestId('costs-error', {}, WAIT)).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(AI_COST_TITLE);
    expect(screen.getByTestId('ai-cost-legend')).toBeInTheDocument();
    expect(screen.queryByTestId('costs-kpi-cost')).toBeNull();
    expect(screen.queryByTestId('costs-recorded')).toBeNull();
    expect(screen.getByTestId('leak-panel')).toBeInTheDocument();
  });
});
