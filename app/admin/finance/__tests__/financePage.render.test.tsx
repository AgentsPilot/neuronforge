/**
 * @jest-environment jsdom
 *
 * The finance page renders what the route sent, honestly (slice 1a): every
 * tile's state in text (AC-21), a failed section on its own with a Retry
 * (AC-27), the revenue panel in words and never a $0 (AC-22), AI cost
 * labelled USD (AC-14), "At least" on a partial read (AC-15), "No AI actions
 * charged" on an empty window (AC-7), the cut-over notice instead of a $0
 * (AC-40), a platform account labelled (SA-WR-5), and the URL as the state
 * (AC-24: invalid → notice, a filter change → router.replace with scroll false).
 */

import '@testing-library/jest-dom';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';

import type { FinancePayload } from '@/lib/business-os/finance/financeTypes';

const mockReplace = jest.fn();
let mockSearch = '';
jest.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(mockSearch),
  useRouter: () => ({ replace: mockReplace, push: jest.fn() }),
  usePathname: () => '/admin/finance',
}));
jest.mock('@/app/admin/audit-trail/BusinessAccountPicker', () => ({
  BusinessAccountPicker: () => null,
}));

import { FinanceView } from '../components/FinanceView';
import { STATUS_STYLES } from '@/app/admin/components/health/HealthTile';
import {
  AI_NO_ROWS,
  NAME_PLATFORM,
  REVENUE_COULD_NOT_CHECK,
  REVENUE_NONE_YET,
  SECTION_COULD_NOT_LOAD,
  TILE_LABELS,
} from '../financeCopy';

const A = '11111111-1111-4111-8111-111111111111';

function payload(extra: Partial<FinancePayload> = {}): FinancePayload {
  return {
    generatedAt: '2026-10-09T10:00:00.000Z',
    window: { preset: 'this_month', from: '2026-10-01', to: '2026-10-09', start: '2026-10-01T00:00:00.000Z', end: '2026-10-10T00:00:00.000Z' },
    accountId: null,
    tiles: {
      k1: { id: 'k1_ai_cost', status: 'not_measured', headline: 'Not enough history', value: { value: 12.5, exact: true }, previous: null },
      k3: { id: 'k3_founding_no_end_date', status: 'amber', headline: 'Founding Partners with no end date', value: { value: 8, exact: true }, previous: null },
      k5: { id: 'k5_our_revenue', status: 'neutral', headline: 'None yet', value: null, previous: null },
    },
    revenue: { status: 'ok', state: 'none_yet' },
    accounts: {
      status: 'ok',
      scope: 'all',
      figures: {
        total: 8,
        groups: [
          { key: 'trial', tierLabel: null, count: 0, grace: 0, pastDue: 0 },
          { key: 'founding_partner', tierLabel: null, count: 8, grace: 0, pastDue: 0 },
          { key: 'comped', tierLabel: null, count: 0, grace: 0, pastDue: 0 },
          { key: 'tier:x', tierLabel: 'Essentials-ish', count: 0, grace: 0, pastDue: 0 },
          { key: 'unknown_held', tierLabel: null, count: 0, grace: 0, pastDue: 0 },
        ],
        payingKnown: true,
        byState: { champion: 8 },
        foundingNoEndDate: 8,
        dormantFounding: 2,
        newInWindow: { total: 1, byOrigin: [{ origin: 'backfill', count: 1 }] },
        endingIn30Days: 0,
      },
    },
    aiCost: {
      status: 'ok',
      coverage: 'after_cutover',
      figures: {
        exact: true,
        costUsd: 3.5,
        credits: 120,
        chargedActions: 10,
        rows: 11,
        byTrigger: [
          { trigger: 'owner', costUsd: 3.5, credits: 120, rows: 11 },
          { trigger: 'scheduled', costUsd: 0, credits: 0, rows: 0 },
          { trigger: 'external', costUsd: 0, credits: 0, rows: 0 },
          { trigger: 'unattributed', costUsd: 0, credits: 0, rows: 0 },
        ],
        byGroup: { status: 'ok', lines: [{ key: 'founding_partner', tierLabel: null, costUsd: 3.5, credits: 120, rows: 11 }] },
        topAccounts: [
          { accountId: A, name: 'Acme Dental', nameStatus: 'found', costUsd: 3, credits: 100 },
          { accountId: '00000000-0000-0000-0000-000000000000', name: null, nameStatus: 'platform', costUsd: 0.5, credits: 20 },
        ],
        deleted: { costUsd: 0, credits: 0, rows: 0 },
        unreadableAmounts: 0,
        unresolvedAdjustments: 0,
      },
    },
    ...extra,
  };
}

function serve(body: unknown, status = 200): jest.Mock {
  const fetchMock = jest.fn(async () => ({ ok: status < 400, status, json: async () => body }));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- jsdom has no fetch; standard test stub
  (global as any).fetch = fetchMock;
  return fetchMock;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockSearch = '';
});

describe('the finance page', () => {
  it('shows the title, the three tiles with their text state, and the sections in order', async () => {
    serve({ success: true, data: payload() });
    render(<FinanceView />);
    await screen.findByTestId('kpi-strip');
    expect(screen.getByRole('heading', { name: 'Finance & business health' })).toBeInTheDocument();
    for (const id of ['k1_ai_cost', 'k3_founding_no_end_date', 'k5_our_revenue']) {
      const status = screen.getByTestId(`tile-${id}`).getAttribute('data-status') as keyof typeof STATUS_STYLES;
      expect(screen.getByTestId(`tile-${id}-state`)).toHaveTextContent(STATUS_STYLES[status].label);
    }
    expect(screen.getByText(TILE_LABELS.k1Sub)).toBeInTheDocument();
    expect(screen.getByTestId('tile-k3_founding_no_end_date-headline')).toHaveTextContent('Founding Partners with no end date');
    const order = ['kpi-strip', 'section-revenue', 'section-accounts', 'section-ai-cost'].map((id) => screen.getByTestId(id));
    for (let i = 1; i < order.length; i += 1) {
      expect(order[i - 1].compareDocumentPosition(order[i]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
    expect(screen.getByTestId('accounts-total')).toHaveTextContent('8');
    expect(screen.getByText('Essentials-ish')).toBeInTheDocument();
    expect(screen.getByText(/backfill \(backfilled\)/)).toBeInTheDocument();
  });

  it('AC-14: the AI cost is labelled USD; SA-WR-5: a platform account is labelled', async () => {
    serve({ success: true, data: payload() });
    render(<FinanceView />);
    expect(await screen.findByTestId('ai-total')).toHaveTextContent('USD 3.50');
    expect(within(screen.getByTestId('ai-top')).getByText(NAME_PLATFORM)).toBeInTheDocument();
    expect(within(screen.getByTestId('ai-top')).getByText('Acme Dental')).toBeInTheDocument();
  });

  it('AC-22: the revenue panel says none yet, and shows no $0 anywhere in it or on K-5', async () => {
    serve({ success: true, data: payload() });
    render(<FinanceView />);
    const panel = await screen.findByTestId('section-revenue');
    expect(panel).toHaveTextContent(REVENUE_NONE_YET);
    expect(panel.textContent).not.toMatch(/\$|USD|0\.00/);
    expect(screen.getByTestId('tile-k5_our_revenue').textContent).not.toMatch(/\$|USD|0\.00/);
  });

  it('AC-39: the revenue check failed → "Could not check"', async () => {
    serve({ success: true, data: payload({ revenue: { status: 'unknown', state: 'unknown' } }) });
    render(<FinanceView />);
    expect(await screen.findByTestId('revenue-text')).toHaveTextContent(REVENUE_COULD_NOT_CHECK);
  });

  it('AC-27: a failed section says so with a Retry; the others still render; Retry refetches', async () => {
    const fetchMock = serve({
      success: true,
      data: payload({ accounts: { status: 'unknown', scope: 'all', figures: null } }),
    });
    render(<FinanceView />);
    const section = await screen.findByTestId('section-accounts');
    expect(within(section).getAllByText(SECTION_COULD_NOT_LOAD).length).toBeGreaterThan(0);
    expect(screen.getByTestId('ai-total')).toBeInTheDocument();
    fireEvent.click(within(section).getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  });

  it('AC-15: a partial read says "At least USD"', async () => {
    const p = payload();
    p.aiCost = { ...p.aiCost, status: 'partial', figures: { ...p.aiCost.figures!, exact: false } };
    serve({ success: true, data: p });
    render(<FinanceView />);
    expect(await screen.findByTestId('ai-total')).toHaveTextContent('At least USD 3.50');
  });

  it('AC-7: an empty window says "No AI actions charged in this window" and USD 0.00', async () => {
    const p = payload();
    p.aiCost = {
      ...p.aiCost,
      figures: { ...p.aiCost.figures!, costUsd: 0, credits: 0, chargedActions: 0, rows: 0, topAccounts: [] },
    };
    serve({ success: true, data: p });
    render(<FinanceView />);
    expect(await screen.findByTestId('ai-no-rows')).toHaveTextContent(AI_NO_ROWS);
    expect(screen.getByTestId('ai-total')).toHaveTextContent('USD 0.00');
  });

  it('AC-40: a window entirely before the cut-over shows the notice instead of a $0', async () => {
    const p = payload();
    p.aiCost = { ...p.aiCost, coverage: 'entirely_before_cutover' };
    serve({ success: true, data: p });
    render(<FinanceView />);
    expect(await screen.findByTestId('activity-cutover-entirely')).toBeInTheDocument();
    expect(screen.queryByTestId('ai-total')).not.toBeInTheDocument();
  });

  it('a route error (e.g. 404) shows the server message with a Retry', async () => {
    serve({ success: false, error: 'Business not found' }, 404);
    render(<FinanceView />);
    expect(await screen.findByTestId('finance-error')).toHaveTextContent('Business not found');
  });
});

describe('the URL is the state (AC-24)', () => {
  it('fetches with the parsed query; an invalid value falls back to the default with a notice', async () => {
    mockSearch = 'preset=year';
    const fetchMock = serve({ success: true, data: payload() });
    render(<FinanceView />);
    expect(await screen.findByTestId('finance-url-notice')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith('/api/admin/business-os/finance?preset=this_month', expect.objectContaining({ cache: 'no-store' }));
  });

  it('a preset click writes the URL with router.replace and scroll false', async () => {
    mockSearch = `preset=this_month&accountId=${A}`;
    serve({ success: true, data: payload({ accountId: A }) });
    render(<FinanceView />);
    await screen.findByTestId('kpi-strip');
    fireEvent.click(screen.getByRole('button', { name: '7d' }));
    expect(mockReplace).toHaveBeenCalledWith(`/admin/finance?preset=7d&accountId=${A}`, { scroll: false });
  });
});
