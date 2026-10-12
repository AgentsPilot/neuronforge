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
 *
 * Slice 1b: five tiles with their text state (AC-21), Section 4 after Section
 * 3, K-4 at 0 grey (AC-8), Section 4 failing alone with K-4 still shown
 * (AC-16, SA-W12), the gifted figures Unknown on a failed lots read (AC-38),
 * one Unknown row (AC-17), the display cap, "<0.1%" (SA-W17), K-2's line from
 * the payload (SA-W10), and no currency anywhere in Section 4 or on K-4.
 *
 * Slice 2a: the takings block directly under "Our revenue" with its "Not our
 * revenue" chip in every state (SA-WR-17), a currency on every money cell and
 * no total across currencies (AC-48), the fee line and note (AC-49), "At
 * least" and a cut-off net (AC-51), the empty states (AC-52), unreadable and
 * other-status counts in words (AC-53), the table's cap and labels (AC-54), no
 * test-mode wording (AC-55), a failed block alone (AC-66), the layout parts
 * (AC-68), and formatMoney's fixed two decimals (SA-WR-18).
 */

import '@testing-library/jest-dom';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';

import type { FinanceCreditRow, FinancePayload, FinanceTakingsSection } from '@/lib/business-os/finance/financeTypes';

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
  CREDITS_GIFTED_UNKNOWN,
  CREDITS_LESS_THAN_TENTH,
  CREDITS_NO_ALLOWANCE,
  CREDITS_UNKNOWN,
  k2Subtitle,
  NAME_PLATFORM,
  REVENUE_COULD_NOT_CHECK,
  REVENUE_NONE_YET,
  SECTION_COULD_NOT_LOAD,
  TAKINGS_CHIP,
  TAKINGS_FEE_NOTE,
  TAKINGS_NET_CUT_OFF,
  TAKINGS_NO_PAYMENTS,
  TAKINGS_NO_REFUNDS,
  TAKINGS_REFUNDS_FAILED,
  TAKINGS_TITLE,
  TILE_LABELS,
} from '../financeCopy';
import { formatMoney } from '../financeFormat';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const C = '33333333-3333-4333-8333-333333333333';
const D = '44444444-4444-4444-8444-444444444444';

const creditRow = (accountId: string, extra: Partial<FinanceCreditRow> = {}): FinanceCreditRow => ({
  accountId,
  name: 'Acme Dental',
  nameStatus: 'found',
  group: 'founding_partner',
  tierLabel: null,
  kind: 'position',
  allowance: 100,
  used: 160,
  usedTenths: 1600,
  trial: false,
  overAllowance: true,
  farOverAllowance: true,
  giftedOutstanding: 12.5,
  ...extra,
});

function creditsSection(extra: Partial<FinancePayload['credits']> = {}): FinancePayload['credits'] {
  return {
    status: 'ok',
    scope: 'all',
    farOverAllowancePercent: 150,
    figures: {
      accounts: 4,
      overAllowance: 1,
      farOverAllowance: 1,
      unknownAccounts: 1,
      noAllowanceAccounts: 1,
      rows: [
        creditRow(A),
        creditRow(B, { name: null, nameStatus: 'missing', used: 0.00001, usedTenths: 0, overAllowance: false, farOverAllowance: false, trial: true, giftedOutstanding: 0 }),
        creditRow(C, { kind: 'no_allowance', allowance: null, used: null, usedTenths: null, overAllowance: null, farOverAllowance: null }),
        creditRow(D, { kind: 'unknown', allowance: null, used: null, usedTenths: null, overAllowance: null, farOverAllowance: null }),
      ],
    },
    gifted: {
      outstanding: 12.5,
      accountsNotListed: 0,
      deletedAccountsOutstanding: 30,
      inconsistentAccounts: 0,
      window: { granted: 50, takenBack: 40, grants: 2, grantingAdmins: 2 },
    },
    ...extra,
  };
}

const PLATFORM_ID = '00000000-0000-0000-0000-000000000000';

/** Two currencies; a fee in USD on an ILS payment; one platform row. Totals across currencies would be 380.80 / 345.80. */
function takingsSection(extra: Partial<FinanceTakingsSection> = {}): FinanceTakingsSection {
  return {
    status: 'ok',
    scope: 'all',
    figures: {
      empty: false,
      paymentsExact: true,
      refundsState: 'ok',
      lines: [
        { currency: 'ILS', payments: 4, gross: 230.3, refunded: 15, net: 215.3, businesses: 2, unreadable: 0, unreadablePayments: 0 },
        { currency: 'USD', payments: 2, gross: 150.5, refunded: 20, net: 130.5, businesses: 1, unreadable: 0, unreadablePayments: 0 },
      ],
      refundLines: [
        { currency: 'ILS', refunds: 1, refunded: 15 },
        { currency: 'USD', refunds: 1, refunded: 20 },
      ],
      refundsNotCompleted: 0,
      feeLines: [{ currency: 'USD', fees: 5.85, payments: 3 }],
      feesRecordedOn: 3,
      countedPayments: 6,
      unreadableFees: 0,
      processors: [
        { processorType: 'manual', payments: 1 },
        { processorType: 'stripe', payments: 4 },
        { processorType: null, payments: 1 },
      ],
      businesses: 3,
      otherStatusPayments: 0,
      unreadableAmounts: 0,
      rows: [
        { accountId: B, name: 'Beta Clinic', nameStatus: 'found', currency: 'ILS', payments: 2, gross: 230, refunded: 15, net: 215, unreadablePayments: 0 },
        { accountId: A, name: 'Acme Dental', nameStatus: 'found', currency: 'USD', payments: 1, gross: 150, refunded: 20, net: 130, unreadablePayments: 0 },
        { accountId: PLATFORM_ID, name: null, nameStatus: 'platform', currency: 'USD', payments: 1, gross: 0.5, refunded: 0, net: 0.5, unreadablePayments: 0 },
      ],
      rowsTotal: 3,
    },
    ...extra,
  };
}

function payload(extra: Partial<FinancePayload> = {}): FinancePayload {
  return {
    generatedAt: '2026-10-09T10:00:00.000Z',
    window: { preset: 'this_month', from: '2026-10-01', to: '2026-10-09', start: '2026-10-01T00:00:00.000Z', end: '2026-10-10T00:00:00.000Z' },
    accountId: null,
    tiles: {
      k1: { id: 'k1_ai_cost', status: 'not_measured', headline: 'Not enough history', value: { value: 12.5, exact: true }, previous: null },
      k2: { id: 'k2_far_over_allowance', status: 'amber', headline: 'Accounts at or over the far-over-allowance line', value: { value: 1, exact: false }, previous: null },
      k3: { id: 'k3_founding_no_end_date', status: 'amber', headline: 'Founding Partners with no end date', value: { value: 8, exact: true }, previous: null },
      k4: { id: 'k4_gifted_outstanding', status: 'neutral', headline: 'Admin-granted, not taken back, not expired', value: { value: 12.5, exact: true }, previous: null },
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
    credits: creditsSection(),
    takings: takingsSection(),
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

describe('Section 4 and the credit tiles (slice 1b)', () => {
  it('AC-21: all five tiles show a text state; Section 4 follows Section 3; K-2 says its line from the payload', async () => {
    serve({ success: true, data: payload({ credits: creditsSection({ farOverAllowancePercent: 120 }) }) });
    render(<FinanceView />);
    await screen.findByTestId('kpi-strip');
    for (const id of ['k1_ai_cost', 'k2_far_over_allowance', 'k3_founding_no_end_date', 'k4_gifted_outstanding', 'k5_our_revenue']) {
      const status = screen.getByTestId(`tile-${id}`).getAttribute('data-status') as keyof typeof STATUS_STYLES;
      expect(screen.getByTestId(`tile-${id}-state`)).toHaveTextContent(STATUS_STYLES[status].label);
    }
    // The line comes from the payload (120 here), never a literal in the page.
    expect(screen.getByTestId('tile-k2_far_over_allowance')).toHaveTextContent(k2Subtitle(120));
    expect(k2Subtitle(120)).toContain('120%');
    expect(screen.getByTestId('tile-k2_far_over_allowance')).toHaveTextContent('At least 1');
    expect(within(screen.getByTestId('tile-k4_gifted_outstanding')).getByText(TILE_LABELS.k4)).toBeInTheDocument();
    const aiCost = screen.getByTestId('section-ai-cost');
    const credits = screen.getByTestId('section-credits');
    expect(aiCost.compareDocumentPosition(credits) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('the summary, the table (Unknown and No allowance in words, trial, <0.1%), the window line and the notes', async () => {
    serve({ success: true, data: payload() });
    render(<FinanceView />);
    const section = await screen.findByTestId('section-credits');
    expect(within(section).getByTestId('credits-over')).toHaveTextContent('1');
    expect(within(section).getByTestId('credits-far-over')).toHaveTextContent('1');
    expect(within(section).getByTestId('credits-gifted')).toHaveTextContent('12.5');
    expect(within(section).getByTestId('credits-window')).toHaveTextContent('50');
    expect(within(screen.getByTestId(`credits-row-${A}`)).getByText('160.0%')).toBeInTheDocument();
    expect(within(screen.getByTestId(`credits-row-${A}`)).getByText('Yes')).toBeInTheDocument();
    expect(within(screen.getByTestId(`credits-row-${B}`)).getByText(CREDITS_LESS_THAN_TENTH)).toBeInTheDocument();
    expect(screen.getByTestId(`credits-row-${B}`)).toHaveTextContent('trial');
    expect(within(screen.getByTestId(`credits-row-${C}`)).getByText(CREDITS_NO_ALLOWANCE)).toBeInTheDocument();
    // AC-17: the one unknown account says so, in words; the others still show.
    expect(within(screen.getByTestId(`credits-row-${D}`)).getByText(CREDITS_UNKNOWN)).toBeInTheDocument();
    expect(within(section).getByTestId('credits-notes')).toHaveTextContent('1 account could not be read');
    // SA-W9: deleted accounts' credits are their own note.
    expect(within(section).getByTestId('credits-notes')).toHaveTextContent('30 credits on deleted accounts, not counted.');
  });

  it('credits are never money: no currency in Section 4 or on K-4', async () => {
    serve({ success: true, data: payload() });
    render(<FinanceView />);
    const section = await screen.findByTestId('section-credits');
    expect(section.textContent).not.toMatch(/\$|USD/);
    expect(screen.getByTestId('tile-k4_gifted_outstanding').textContent).not.toMatch(/\$|USD/);
  });

  it('AC-8: no gifted credits → K-4 shows 0, grey, with its text state', async () => {
    const p = payload();
    p.tiles.k4 = { ...p.tiles.k4, value: { value: 0, exact: true } };
    serve({ success: true, data: p });
    render(<FinanceView />);
    const tile = await screen.findByTestId('tile-k4_gifted_outstanding');
    expect(tile).toHaveAttribute('data-status', 'neutral');
    expect(tile).toHaveTextContent('0');
    expect(screen.getByTestId('tile-k4_gifted_outstanding-state')).toHaveTextContent(STATUS_STYLES.neutral.label);
  });

  it('AC-16: Section 4 could not load → its own Retry, the other sections render, and K-4 still shows its value (SA-W12)', async () => {
    const p = payload({ credits: creditsSection({ status: 'unknown', figures: null }) });
    p.tiles.k2 = { ...p.tiles.k2, status: 'unavailable', headline: 'Unknown', value: null };
    serve({ success: true, data: p });
    render(<FinanceView />);
    const section = await screen.findByTestId('section-credits');
    expect(within(section).getAllByText(SECTION_COULD_NOT_LOAD).length).toBeGreaterThan(0);
    expect(within(section).getByRole('button', { name: 'Retry' })).toBeInTheDocument();
    expect(screen.getByTestId('ai-total')).toBeInTheDocument();
    expect(screen.getByTestId('tile-k4_gifted_outstanding')).toHaveTextContent('12.5');
    expect(screen.getByTestId('tile-k2_far_over_allowance')).toHaveAttribute('data-status', 'unavailable');
  });

  it('AC-38: the lots read failed → the gifted figures say Unknown; the table and the over-allowance counts render', async () => {
    const base = creditsSection();
    const p = payload({
      credits: {
        ...base,
        gifted: null,
        figures: base.figures && { ...base.figures, rows: base.figures.rows.map((r) => ({ ...r, giftedOutstanding: null })) },
      },
    });
    p.tiles.k4 = { ...p.tiles.k4, status: 'unavailable', headline: 'Unknown', value: null };
    serve({ success: true, data: p });
    render(<FinanceView />);
    const section = await screen.findByTestId('section-credits');
    expect(within(section).getByTestId('credits-gifted')).toHaveTextContent(CREDITS_UNKNOWN);
    expect(within(section).getByTestId('credits-window')).toHaveTextContent(CREDITS_GIFTED_UNKNOWN);
    expect(within(section).getByTestId('credits-over')).toHaveTextContent('1');
    expect(screen.getByTestId('credits-table')).toBeInTheDocument();
  });

  it('SA-W15: the table says "Showing N of M" when the server capped it', async () => {
    serve({ success: true, data: payload({ credits: creditsSection() }) });
    render(<FinanceView />);
    // The fixture has 4 accounts and 4 rows: no notice.
    await screen.findByTestId('section-credits');
    expect(screen.queryByTestId('credits-showing')).not.toBeInTheDocument();
  });

  it('SA-W15: with more accounts than rows the notice shows', async () => {
    const base = creditsSection();
    serve({ success: true, data: payload({ credits: { ...base, figures: base.figures && { ...base.figures, accounts: 250 } } }) });
    render(<FinanceView />);
    expect(await screen.findByTestId('credits-showing')).toHaveTextContent('Showing 4 of 250');
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

describe('Section 2 block B, takings (slice 2a)', () => {
  const renderWith = async (takings: FinanceTakingsSection) => {
    serve({ success: true, data: payload({ takings }) });
    render(<FinanceView />);
    return screen.findByTestId('section-takings');
  };
  const figures = () => takingsSection().figures!;

  it('sits directly under "Our revenue", before Section 1, with its title, subtitle and the "Not our revenue" chip', async () => {
    const section = await renderWith(takingsSection());
    expect(within(section).getByRole('heading', { name: TAKINGS_TITLE })).toBeInTheDocument();
    expect(section).toHaveTextContent('Covers businesses that still exist');
    expect(section).toHaveTextContent('UTC');
    const order = ['section-revenue', 'section-takings', 'section-accounts'].map((id) => screen.getByTestId(id));
    for (let i = 1; i < order.length; i += 1) {
      expect(order[i - 1].compareDocumentPosition(order[i]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
    expect(screen.getByTestId('section-takings-badge')).toHaveTextContent(TAKINGS_CHIP);
  });

  it.each([['ok'], ['partial'], ['unknown']] as const)('SA-WR-17: the chip shows in the %s state', async (status) => {
    const base = takingsSection();
    await renderWith({ ...base, status, figures: status === 'unknown' ? null : base.figures });
    const chip = screen.getByTestId('section-takings-badge');
    expect(chip).toHaveTextContent(TAKINGS_CHIP);
    expect(chip).toHaveAttribute('data-tone', 'neutral');
  });

  it('SA-WR-17: the Accounts, AI cost and Credits sections render no chip', async () => {
    await renderWith(takingsSection());
    for (const id of ['accounts', 'ai-cost', 'credits']) {
      expect(screen.queryByTestId(`section-${id}-badge`)).not.toBeInTheDocument();
      expect(screen.getByTestId(`section-${id}`).querySelector('[data-tone]')).toBeNull();
    }
  });

  it('AC-48: every money cell names its currency; nothing adds two currencies', async () => {
    const section = await renderWith(takingsSection());
    const cells = section.querySelectorAll('[data-money]');
    expect(cells.length).toBeGreaterThanOrEqual(12);
    for (const cell of Array.from(cells)) expect(cell.textContent).toMatch(/^(At least )?(USD|ILS|EUR|Unknown currency) -?[\d,]+\.\d\d$/);
    expect(within(screen.getByTestId('takings-line-ILS')).getByText('ILS 230.30')).toBeInTheDocument();
    expect(within(screen.getByTestId('takings-line-USD')).getByText('USD 150.50')).toBeInTheDocument();
    // No cross-currency total anywhere in the block (gross 380.80, net 345.80, refunded 35.00).
    expect(section.textContent).not.toMatch(/380\.80|345\.80|35\.00/);
  });

  it('AC-49: fees on their FEE currency line, with "recorded on N of M" and the never-deducted note', async () => {
    const section = await renderWith(takingsSection());
    expect(within(screen.getByTestId('takings-fee-USD')).getByText('USD 5.85')).toBeInTheDocument();
    expect(screen.getByTestId('takings-fees-recorded')).toHaveTextContent('Fees recorded on 3 of 6 payments in this window');
    expect(section).toHaveTextContent(TAKINGS_FEE_NOTE);
    // Net is the server's gross minus refunded, untouched by any fee.
    expect(within(screen.getByTestId('takings-line-USD')).getByText('USD 130.50')).toBeInTheDocument();
  });

  it('SA-W21: processor labels from the copy; NULL reads "Not recorded"', async () => {
    const section = await renderWith(takingsSection());
    const processors = within(section).getByTestId('takings-processors');
    expect(processors).toHaveTextContent('Stripe');
    expect(processors).toHaveTextContent('Manual: recorded by the business; no processor fee');
    expect(processors).toHaveTextContent('Not recorded');
  });

  it('AC-51: payments cut off → "At least" on gross and counts, net "Unknown (a read was cut off)", a notice; status partial', async () => {
    const f = figures();
    await renderWith({
      ...takingsSection(),
      status: 'partial',
      figures: { ...f, paymentsExact: false, lines: f.lines.map((l) => ({ ...l, net: null })), rows: f.rows.map((r) => ({ ...r, net: null })) },
    });
    const usd = screen.getByTestId('takings-line-USD');
    expect(usd).toHaveTextContent('At least USD 150.50');
    expect(usd).toHaveTextContent('At least 2');
    expect(within(usd).getByText(TAKINGS_NET_CUT_OFF)).toBeInTheDocument();
    expect(screen.getByTestId('takings-notice-payments-cut')).toBeInTheDocument();
    expect(screen.getByTestId('section-takings')).toHaveAttribute('data-status', 'partial');
  });

  it('AC-51: refunds cut off → refunded "At least", net cut off, its own notice', async () => {
    const f = figures();
    await renderWith({ ...takingsSection(), status: 'partial', figures: { ...f, refundsState: 'partial', lines: f.lines.map((l) => ({ ...l, net: null })) } });
    const usd = screen.getByTestId('takings-line-USD');
    expect(usd).toHaveTextContent('At least USD 20.00');
    expect(within(usd).getByText(TAKINGS_NET_CUT_OFF)).toBeInTheDocument();
    expect(screen.getByTestId('takings-notice-refunds-cut')).toBeInTheDocument();
  });

  it('AC-52: an empty window → both sentences; no currency line and no 0.00', async () => {
    const section = await renderWith({
      status: 'ok',
      scope: 'all',
      figures: {
        ...figures(),
        empty: true,
        lines: [],
        refundLines: [],
        feeLines: [],
        feesRecordedOn: 0,
        countedPayments: 0,
        processors: [],
        businesses: 0,
        rows: [],
        rowsTotal: 0,
      },
    });
    expect(screen.getByTestId('takings-no-payments')).toHaveTextContent(TAKINGS_NO_PAYMENTS);
    expect(screen.getByTestId('takings-no-refunds')).toHaveTextContent(TAKINGS_NO_REFUNDS);
    expect(screen.queryByTestId('takings-lines')).not.toBeInTheDocument();
    expect(section.textContent).not.toMatch(/0\.00|USD|ILS/);
  });

  it('AC-53: unreadable amounts, unreadable fees and other statuses are counted in words; net Unknown on that line', async () => {
    const f = figures();
    await renderWith({
      ...takingsSection(),
      status: 'partial',
      figures: {
        ...f,
        unreadableAmounts: 2,
        unreadableFees: 1,
        otherStatusPayments: 3,
        lines: f.lines.map((l) => (l.currency === 'USD' ? { ...l, net: null, unreadable: 2, unreadablePayments: 2 } : l)),
      },
    });
    expect(screen.getByTestId('takings-notice-unreadable')).toHaveTextContent('2 amounts could not be read and are not counted');
    expect(screen.getByTestId('takings-notice-unreadable-fees')).toHaveTextContent('1 recorded fee could not be read');
    expect(screen.getByTestId('takings-other-status')).toHaveTextContent('3 payments with another status not counted');
    const usd = screen.getByTestId('takings-line-USD');
    expect(usd).toHaveTextContent('excludes 2 unreadable');
    expect(within(usd).getByText('Unknown')).toBeInTheDocument();
    // The other currency's net is untouched.
    expect(within(screen.getByTestId('takings-line-ILS')).getByText('ILS 215.30')).toBeInTheDocument();
  });

  it('AC-54: "Showing N of M", Platform account and Unknown business in words; never "Deleted business"', async () => {
    const f = figures();
    const section = await renderWith({
      ...takingsSection(),
      figures: {
        ...f,
        rows: [...f.rows, { accountId: null, name: null, nameStatus: 'unknown_business', currency: null, payments: 1, gross: 3, refunded: 0, net: 3, unreadablePayments: 0 }],
        rowsTotal: 201,
      },
    });
    expect(screen.getByTestId('takings-showing')).toHaveTextContent('Showing 4 of 201');
    const table = screen.getByTestId('takings-table');
    expect(within(table).getByText(NAME_PLATFORM)).toBeInTheDocument();
    expect(within(table).getByText('Unknown business')).toBeInTheDocument();
    expect(within(table).getAllByText('Unknown currency 3.00')).toHaveLength(2);
    expect(section.textContent).not.toMatch(/Deleted business/);
  });

  it('AC-55: no test-mode label, note or switch anywhere in the block', async () => {
    const section = await renderWith(takingsSection());
    expect(section.textContent).not.toMatch(/test.?mode|livemode|live mode/i);
    expect(within(section).queryByRole('switch')).not.toBeInTheDocument();
    expect(within(section).queryByRole('checkbox')).not.toBeInTheDocument();
  });

  it('AC-66: the block could not load → its own Retry; every other section and tile renders', async () => {
    const section = await renderWith({ status: 'unknown', scope: 'all', figures: null });
    expect(within(section).getAllByText(SECTION_COULD_NOT_LOAD).length).toBeGreaterThan(0);
    expect(within(section).getByRole('button', { name: 'Retry' })).toBeInTheDocument();
    expect(screen.getByTestId('ai-total')).toBeInTheDocument();
    expect(screen.getByTestId('section-credits')).toBeInTheDocument();
  });

  it('AC-66: refunds failed → "Refunds could not be read", refunded and net Unknown, gross shown', async () => {
    const f = figures();
    await renderWith({
      ...takingsSection(),
      status: 'partial',
      figures: {
        ...f,
        refundsState: 'unknown',
        refundLines: null,
        refundsNotCompleted: null,
        lines: f.lines.map((l) => ({ ...l, refunded: null, net: null })),
        rows: f.rows.map((r) => ({ ...r, refunded: null, net: null })),
      },
    });
    expect(screen.getByTestId('takings-notice-refunds-failed')).toHaveTextContent(TAKINGS_REFUNDS_FAILED);
    const usd = screen.getByTestId('takings-line-USD');
    expect(usd).toHaveTextContent('USD 150.50');
    expect(usd).not.toHaveTextContent('At least');
    // SA-1: a FAILED refunds read is not a cut-off read: refunded AND net say plain "Unknown".
    expect(within(usd).getAllByText('Unknown')).toHaveLength(2);
    expect(within(usd).queryByText(TAKINGS_NET_CUT_OFF)).not.toBeInTheDocument();
    expect(within(screen.getByTestId('section-takings')).queryByText(TAKINGS_NET_CUT_OFF)).not.toBeInTheDocument();
  });

  it('QA-2: an unreadable PAYMENT amount on a line or row → gross "At least", net plain "Unknown"; the other line stays plain', async () => {
    const f = figures();
    await renderWith({
      ...takingsSection(),
      status: 'partial',
      figures: {
        ...f,
        unreadableAmounts: 1,
        lines: f.lines.map((l) => (l.currency === 'USD' ? { ...l, net: null, unreadable: 1, unreadablePayments: 1 } : l)),
        rows: f.rows.map((r) => (r.accountId === A ? { ...r, net: null, unreadablePayments: 1 } : r)),
      },
    });
    const usd = screen.getByTestId('takings-line-USD');
    expect(within(usd).getByText('At least USD 150.50')).toBeInTheDocument();
    expect(within(usd).getByText('Unknown')).toBeInTheDocument();
    expect(within(usd).queryByText(TAKINGS_NET_CUT_OFF)).not.toBeInTheDocument();
    expect(within(screen.getByTestId('takings-line-ILS')).getByText('ILS 230.30')).toBeInTheDocument();
    const row = screen.getByTestId(`takings-row-${A}-USD`);
    expect(within(row).getByText('At least USD 150.00')).toBeInTheDocument();
    expect(within(row).getByText('Unknown')).toBeInTheDocument();
    expect(within(screen.getByTestId(`takings-row-${B}-ILS`)).getByText('ILS 230.00')).toBeInTheDocument();
  });

  it('QA-2: an unreadable REFUND amount only → gross stays a plain figure (it left nothing out); net Unknown', async () => {
    const f = figures();
    await renderWith({
      ...takingsSection(),
      status: 'partial',
      figures: {
        ...f,
        unreadableAmounts: 1,
        lines: f.lines.map((l) => (l.currency === 'USD' ? { ...l, net: null, unreadable: 1, unreadablePayments: 0 } : l)),
      },
    });
    const usd = screen.getByTestId('takings-line-USD');
    expect(within(usd).getByText('USD 150.50')).toBeInTheDocument();
    expect(usd).not.toHaveTextContent('At least USD 150.50');
    expect(within(usd).getByText('Unknown')).toBeInTheDocument();
  });

  it('AC-68: labelled tables with column headers, number cells right-aligned and tabular; the KPI strip still has exactly five tiles', async () => {
    const section = await renderWith(takingsSection());
    for (const name of ['Takings per currency', 'Refunds', 'Recorded processor fees', 'Payments by processor', 'Takings by business']) {
      const table = within(section).getByRole('table', { name });
      const headers = table.querySelectorAll('thead th');
      expect(headers.length).toBeGreaterThan(1);
      for (const th of Array.from(headers)) expect(th).toHaveAttribute('scope', 'col');
    }
    for (const cell of Array.from(section.querySelectorAll('[data-money]'))) expect(cell.className).toMatch(/tabular-nums/);
    const tiles = screen.getByTestId('kpi-strip').querySelectorAll('[data-testid^="tile-"][data-status]');
    expect(tiles).toHaveLength(5);
  });
});

describe('formatMoney (SA-WR-18): fixed two decimals, the code always shown', () => {
  it('0.10 + 0.20 summed in hundredths and divided once renders "USD 0.30"', () => {
    expect(formatMoney((10 + 20) / 100, 'USD')).toBe('USD 0.30');
  });

  it('12,345,678,901.23 renders exactly', () => {
    expect(formatMoney(1_234_567_890_123 / 100, 'USD')).toBe('USD 12,345,678,901.23');
  });

  it('a negative net keeps its minus sign and its code; a whole amount keeps two decimals; Unknown currency named', () => {
    expect(formatMoney(-5, 'EUR')).toBe('EUR -5.00');
    expect(formatMoney(-1234.5, 'ILS')).toBe('ILS -1,234.50');
    expect(formatMoney(200, 'ILS')).toBe('ILS 200.00');
    expect(formatMoney(12, null)).toBe('Unknown currency 12.00');
  });
});
