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
 *
 * Slice 2b: the client payment problems block last, after Credits, with its
 * chip and five parts each in words (L-32, SA-W31); the failed-payments panel
 * never a 0 (AC-60); the full-amount labels and note (AC-56, AC-58); date
 * order with unknown dates last (SA-W30, SA-W36); a due date that never moves
 * a day in two process time zones (AC-74); plans by status (AC-59, SA-W39);
 * plain reminder figures and the link (AC-61); the platform-wide note
 * (AC-65); a failed part alone (AC-66, AC-67); "At least" (AC-62); empty
 * parts (AC-63); the layout parts (AC-68); no test-mode wording (BD-13).
 *
 * Slice 1c: the new revenue panel copy in every state with no mode or webhook
 * wording (AC-75 to AC-77, AC-81), the Founding Partner note on a tier group
 * with all businesses (AC-78) and the neutral chip with words only for a
 * picked business (AC-82, SA-Q24, SA-W43; the SA-WR-17 test is unedited).
 *
 * Slice 4a: "Our revenue" as a section (S4-FR-1). The 1c panel-sentence and
 * K-5 headline cases (AC-75 to AC-77) are superseded by S4-FR-4 / S4-FR-7
 * (SA-W50, E-31) and rewritten; AC-81's wording rule runs unchanged over every
 * new state. Then the boost lines with a currency in every money cell (AC-90),
 * the refund-timing note (AC-91), two currencies and never a total (AC-92),
 * the ceiling (AC-93), the empty window (AC-94), K-5's value and caption
 * (AC-95, SA-WR-34), the picked business's plans line (SA-WR-33), deleted
 * accounts (AC-97) and the failed boost read.
 *
 * Money M-1 (slice 5a): the shared picker (mocked by path, the real chip),
 * the chip name (AC-109), the header and summary only with a business picked
 * (AC-110, AC-116), and the Section 3 link (AC-113).
 *
 * Money M-2 (slice 5a, SA-W61): `revenue.plans` is the plans object. The 4a
 * plans-line cases (S4-FR-4, SA-WR-33) are rewritten to the M-2 meaning: the
 * plans part per currency, the by-business table or the one business's list,
 * the deleted line, empty and failed states, `formatUtc` on every timestamp,
 * and K-5's "USD 89.00" with its new caption (AC-120 to AC-126, AC-129).
 */

import '@testing-library/jest-dom';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';

import type { FinanceCreditRow, FinancePayload, FinanceTakingsSection } from '@/lib/business-os/finance/financeTypes';
// Slice 4a: a separate import, so the line above stays unedited.
import type { FinanceBoostLine, FinanceRevenueSection } from '@/lib/business-os/finance/financeTypes';
// Slice 5a: a separate import.
import type { FinancePlanRevenue } from '@/lib/business-os/finance/financeTypes';
import type { FinancePaymentProblemsSection } from '@/lib/business-os/finance/financeTypes';

const mockReplace = jest.fn();
let mockSearch = '';
jest.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(mockSearch),
  useRouter: () => ({ replace: mockReplace, push: jest.fn() }),
  usePathname: () => '/admin/finance',
}));
// Money M-1: Finance uses the shared picker. The stand-in offers one pick, and
// the real `businessFilterChip` is kept, so the chip's wording is the real one.
const PICKED_NAME = 'Acme Dental (picked)';
jest.mock('@/app/admin/components/layout/AdminBusinessPicker', () => ({
  ...jest.requireActual('@/app/admin/components/layout/AdminBusinessPicker'),
  AdminBusinessPicker: ({ onSelect }: { onSelect: (id: string, name: string | null) => void }) => (
    <button type="button" data-testid="picker-pick" onClick={() => onSelect('11111111-1111-4111-8111-111111111111', 'Acme Dental (picked)')}>
      pick
    </button>
  ),
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
// Slice 1c: a separate import, so the lists above stay unedited.
import {
  ACCOUNTS_FOUNDING_CHIP,
  accountsFoundingNote,
} from '../financeCopy';
// Slice 4a.
import {
  k5Caption,
  k5SeveralCurrencies,
  REVENUE_BOOSTS_FAILED,
  REVENUE_CANNOT,
  REVENUE_CUT_OFF,
  REVENUE_DELETED_NONE,
  REVENUE_NET,
  REVENUE_NO_BOOSTS,
  REVENUE_NOTICE_CUT,
  REVENUE_NOTICE_UNREADABLE,
  REVENUE_OTHER_STATUS,
  REVENUE_REFUND_TIMING_NOTE,
  REVENUE_SUBTITLE_ALL,
  REVENUE_SUBTITLE_ONE,
  revenueDeletedLine,
} from '../financeCopy';
import { formatMoney } from '../financeFormat';
// Slice 5a (Money M-2).
import {
  REVENUE_PLANS_DELETED_NONE,
  REVENUE_PLANS_EMPTY,
  REVENUE_PLANS_FAILED,
  REVENUE_PLANS_NOTICE_CUT,
  REVENUE_PLANS_NOTICE_UNREADABLE,
  REVENUE_PLANS_PERIOD_NOT_RECORDED,
  REVENUE_PLANS_RECEIVED,
  REVENUE_PLANS_REFUNDS_NOTE,
  REVENUE_PLANS_UNKNOWN_PLAN,
  REVENUE_PLANS_ZERO_NOTE,
  revenuePlansDeletedLine,
} from '../financeCopy';
import { formatUtc } from '@/app/admin/components/layout/adminFormat';
import {
  PART_COULD_NOT_LOAD,
  PART_OK,
  PART_PARTIAL,
  PLANS_EMPTY,
  PROBLEMS_CHIP,
  PROBLEMS_FAILED_COULD_NOT_CHECK,
  PROBLEMS_FAILED_NONE_IN_READ,
  PROBLEMS_FAILED_NOT_RECORDED,
  PROBLEMS_FAILED_NOT_STORED,
  PROBLEMS_INSTALMENT_RETRIES,
  PROBLEMS_INSTALMENTS,
  PROBLEMS_INVOICES,
  PROBLEMS_TITLE,
  REMINDERS_FAILED,
  REMINDERS_NOT_NARROWED,
} from '../financeCopy';

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

/**
 * Slice 2b: two currencies of overdue invoices (a platform row and a row with
 * an unknown due date), one past-due instalment, plans, reminder figures.
 * Totals across currencies would be 1,234.50 + 99.00 = 1,333.50.
 */
function paymentProblemsSection(extra: Partial<FinancePaymentProblemsSection> = {}): FinancePaymentProblemsSection {
  return {
    status: 'ok',
    scope: 'all',
    today: '2026-10-09',
    failedPayments: { state: 'not_stored' },
    overdueInvoices: {
      status: 'ok',
      figures: {
        empty: false,
        exact: true,
        lines: [
          { currency: 'EUR', marked: 1, pastDue: 0, amount: 99, amountExact: true, unreadable: 0, businesses: 1, oldestDueDate: null },
          { currency: 'USD', marked: 1, pastDue: 1, amount: 1234.5, amountExact: true, unreadable: 0, businesses: 2, oldestDueDate: '2026-09-30' },
        ],
        businesses: 3,
        total: 3,
        unreadableAmounts: 0,
        rows: [
          { id: 'aaaaaaaa-1111-4000-8000-000000000001', accountId: A, name: 'Acme Dental', nameStatus: 'found', kind: 'marked', dueDate: '2026-09-30', daysPastDue: 9, amount: 1000, currency: 'USD' },
          { id: 'aaaaaaaa-1111-4000-8000-000000000002', accountId: PLATFORM_ID, name: null, nameStatus: 'platform', kind: 'past_due', dueDate: '2026-10-05', daysPastDue: 4, amount: 234.5, currency: 'USD' },
          { id: 'aaaaaaaa-1111-4000-8000-000000000003', accountId: B, name: null, nameStatus: 'missing', kind: 'marked', dueDate: null, daysPastDue: null, amount: 99, currency: 'EUR' },
        ],
        rowsTotal: 3,
      },
    },
    overdueInstalments: {
      status: 'ok',
      figures: {
        empty: false,
        exact: true,
        lines: [{ currency: 'ILS', marked: 0, pastDue: 1, amount: 25.5, amountExact: true, unreadable: 0, businesses: 1, oldestDueDate: '2026-10-05' }],
        businesses: 1,
        total: 1,
        unreadableAmounts: 0,
        rows: [
          { id: 'bbbbbbbb-1111-4000-8000-000000000001', accountId: C, name: 'Gamma Gym', nameStatus: 'found', kind: 'past_due', dueDate: '2026-10-05', daysPastDue: 4, amount: 25.5, currency: 'ILS' },
        ],
        rowsTotal: 1,
      },
    },
    clientPlans: {
      status: 'ok',
      figures: {
        exact: true,
        total: 6,
        byStatus: [
          { status: 'pending', plans: 0, recognised: true },
          { status: 'active', plans: 5, recognised: true },
          { status: 'past_due', plans: 0, recognised: true },
          { status: 'paused', plans: 0, recognised: true },
          { status: 'completed', plans: 0, recognised: true },
          { status: 'cancelled', plans: 1, recognised: true },
        ],
        unrecognised: 0,
        activeNow: 5,
        cancelledInWindow: 1,
        completedInWindow: 0,
        nextChargeOverdue: 0,
        unreadableTimes: 0,
        failedCharges: { everRecorded: false, inWindow: 0 },
      },
    },
    reminders: {
      status: 'ok',
      state: 'read',
      figures: { dueNow: 7, inProgress: 0, stuck: 3, failed24h: 2, failed7d: 11, deadLettered24h: 0, deadLettered7d: 4, oldestDueAt: '2026-10-09T08:15:00.000Z' },
    },
    ...extra,
  };
}

/** Slice 5a: the plans part with nothing received in the window (the default). */
function plansPart(extra: Partial<FinancePlanRevenue> = {}): FinancePlanRevenue {
  return {
    status: 'ok',
    scope: 'all',
    lines: [],
    accounts: [],
    accountsTotal: 0,
    payments: null,
    paymentsTotal: null,
    deletedAccounts: [],
    notes: { empty: true, exact: true, zeroAmountInvoices: 0, unreadable: 0, otherKind: 0 },
    ...extra,
  };
}

/** Slice 5a: the owner's October plan payment, all businesses (USD 79.00, one business, by business). */
function paidPlans(extra: Partial<FinancePlanRevenue> = {}): FinancePlanRevenue {
  return plansPart({
    lines: [{ currency: 'USD', payments: 1, received: 79, tax: 0, businesses: 1, zeroAmountInvoices: 0, unreadable: 0, exact: true }],
    accounts: [{ accountId: A, name: 'Acme Dental', nameStatus: 'found', currency: 'USD', payments: 1, received: 79, exact: true }],
    accountsTotal: 1,
    notes: { empty: false, exact: true, zeroAmountInvoices: 0, unreadable: 0, otherKind: 0 },
    ...extra,
  });
}

const PLANS_FAILED: FinancePlanRevenue = plansPart({ status: 'unknown', lines: null, accounts: null, accountsTotal: null, deletedAccounts: null, notes: null });

/** Slice 4a: "Our revenue" with nothing paid in the window (the default). */
function revenueSection(extra: Partial<FinanceRevenueSection> = {}, boosts: Partial<FinanceRevenueSection['boosts']> = {}): FinanceRevenueSection {
  return {
    status: 'ok',
    state: 'none_yet',
    plans: plansPart(),
    totals: [],
    ...extra,
    boosts: {
      status: 'ok',
      scope: 'all',
      lines: [],
      packages: [],
      deletedAccounts: [],
      notes: { empty: true, exact: true, otherStatusPurchases: 0, unreadablePurchases: 0, refundOrDispute: false },
      ...boosts,
    },
  };
}

/** One currency line, the owner's test purchase by default (USD 10.00, 5,000 credits). */
function boostLine(extra: Partial<FinanceBoostLine> = {}): FinanceBoostLine {
  return {
    currency: 'USD', purchases: 1, gross: 10, tax: 0, refunded: 0, held: 0, lost: 0, net: 10, creditsSold: 5000,
    unreadable: 0, unreadableCredits: 0, ...extra,
  };
}

/** "Our revenue" with the given lines (one package row per line), as the builder would send it. */
function paidRevenue(lines: FinanceBoostLine[], notes: Partial<NonNullable<FinanceRevenueSection['boosts']['notes']>> = {}, extra: Partial<FinanceRevenueSection> = {}): FinanceRevenueSection {
  return revenueSection(
    { state: 'recorded', ...extra },
    {
      lines,
      packages: lines.map((l) => ({
        currency: l.currency, packageId: 'pkg-small', packageVersion: 1, purchases: l.purchases, gross: l.gross, refunded: l.refunded, net: l.net, unreadable: l.unreadable,
      })),
      notes: { empty: false, exact: true, otherStatusPurchases: 0, unreadablePurchases: 0, refundOrDispute: false, ...notes },
    }
  );
}

const k5With = (p: FinancePayload, money: NonNullable<FinancePayload['tiles']['k5']['money']>, headline = 'Net of refunds and disputes') => {
  p.tiles.k5 = { ...p.tiles.k5, headline, money };
  return p;
};

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
      k5: { id: 'k5_our_revenue', status: 'neutral', headline: 'No data yet', value: null, previous: null, money: { kind: 'none' } },
    },
    revenue: revenueSection(),
    accounts: {
      status: 'ok',
      scope: 'all',
      figures: {
        total: 8,
        groups: [
          { key: 'trial', tierLabel: null, count: 0, grace: 0, pastDue: 0, foundingPartners: 0 },
          { key: 'founding_partner', tierLabel: null, count: 8, grace: 0, pastDue: 0, foundingPartners: 0 },
          { key: 'comped', tierLabel: null, count: 0, grace: 0, pastDue: 0, foundingPartners: 0 },
          { key: 'tier:x', tierLabel: 'Essentials-ish', count: 0, grace: 0, pastDue: 0, foundingPartners: 0 },
          { key: 'unknown_held', tierLabel: null, count: 0, grace: 0, pastDue: 0, foundingPartners: 0 },
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
    paymentProblems: paymentProblemsSection(),
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

  it('AC-22 / AC-94 (4a meaning of AC-77): nothing paid → "No credit boosts paid in this window", no currency line, no 0.00; K-5 "No data yet" with no value', async () => {
    serve({ success: true, data: payload() });
    render(<FinanceView />);
    const panel = await screen.findByTestId('section-revenue');
    expect(within(panel).getByTestId('revenue-plans-empty')).toHaveTextContent(REVENUE_PLANS_EMPTY);
    expect(within(panel).getByTestId('revenue-no-boosts')).toHaveTextContent(REVENUE_NO_BOOSTS);
    expect(within(panel).queryByTestId('revenue-lines')).toBeNull();
    expect(panel.textContent).not.toMatch(/\$|USD|0\.00/);
    const k5 = screen.getByTestId('tile-k5_our_revenue');
    expect(k5.textContent).not.toMatch(/\$|USD|0\.00/);
    expect(screen.getByTestId('tile-k5_our_revenue-headline')).toHaveTextContent('No data yet');
    expect(k5.getAttribute('data-status')).toBe('neutral');
  });

  it('AC-78: all businesses, a tier group with a paying Founding Partner shows the note as text, no chip in Section 1', async () => {
    const p = payload();
    p.accounts.figures!.groups = p.accounts.figures!.groups.map((g) =>
      g.key === 'tier:x' ? { ...g, count: 1, foundingPartners: 1 } : g
    );
    serve({ success: true, data: p });
    render(<FinanceView />);
    const section = await screen.findByTestId('section-accounts');
    expect(within(section).getByTestId('accounts-founding-note-tier:x')).toHaveTextContent(accountsFoundingNote(1));
    expect(accountsFoundingNote(1)).toBe('including 1 Founding Partner');
    expect(accountsFoundingNote(2)).toBe('including 2 Founding Partners');
    expect(within(section).queryByTestId('accounts-founding-chip-tier:x')).not.toBeInTheDocument();
    expect(section.querySelector('[data-tone]')).toBeNull();
  });

  it('AC-82 / SA-Q24: a picked business shows the neutral "Founding Partner" chip with words, and no note sentence', async () => {
    const p = payload();
    p.accounts = {
      ...p.accounts,
      scope: 'one',
      figures: {
        ...p.accounts.figures!,
        total: 1,
        groups: p.accounts.figures!.groups.map((g) =>
          g.key === 'tier:x' ? { ...g, count: 1, foundingPartners: 1 } : { ...g, count: 0 }
        ),
      },
    };
    serve({ success: true, data: p });
    render(<FinanceView />);
    const section = await screen.findByTestId('section-accounts');
    const chip = within(section).getByTestId('accounts-founding-chip-tier:x');
    expect(chip).toHaveTextContent(ACCOUNTS_FOUNDING_CHIP);
    expect(chip).toHaveAttribute('data-tone', 'neutral');
    expect(within(section).queryByTestId('accounts-founding-note-tier:x')).not.toBeInTheDocument();
    expect(section.textContent).not.toMatch(/including \d+ Founding Partner/);
  });

  it('SA-W43: no group with a Founding Partner → no note and no chip, in either view', async () => {
    const p = payload();
    p.accounts = { ...p.accounts, scope: 'one' };
    serve({ success: true, data: p });
    render(<FinanceView />);
    const section = await screen.findByTestId('section-accounts');
    expect(section.querySelector('[data-tone]')).toBeNull();
    expect(section.textContent).not.toMatch(/including \d+ Founding Partner/);
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

describe('Section 6 block B, client payment problems (slice 2b)', () => {
  const renderWith = async (problems: FinancePaymentProblemsSection, extra: Partial<FinancePayload> = {}) => {
    serve({ success: true, data: payload({ paymentProblems: problems, ...extra }) });
    render(<FinanceView />);
    return screen.findByTestId('section-payment-problems');
  };
  const base = () => paymentProblemsSection();

  it('L-32: the last block, after Credits; its title, chip, "As of now, UTC" subtitle and five parts, four with a status in words', async () => {
    const section = await renderWith(base());
    expect(within(section).getByRole('heading', { name: PROBLEMS_TITLE })).toBeInTheDocument();
    expect(screen.getByTestId('section-payment-problems-badge')).toHaveTextContent(PROBLEMS_CHIP);
    expect(screen.getByTestId('section-payment-problems-badge')).toHaveAttribute('data-tone', 'neutral');
    expect(section).toHaveTextContent('As of now, UTC (2026-10-09)');
    expect(section).toHaveTextContent('Covers businesses that still exist');
    const order = ['section-credits', 'section-payment-problems'].map((id) => screen.getByTestId(id));
    expect(order[0].compareDocumentPosition(order[1]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(section.parentElement?.lastElementChild).toBe(section);
    for (const id of ['failed', 'invoices', 'instalments', 'plans', 'reminders']) {
      expect(within(section).getByTestId(`problems-${id}`)).toBeInTheDocument();
    }
    for (const id of ['invoices', 'instalments', 'plans', 'reminders']) {
      expect(screen.getByTestId(`problems-${id}-status`)).toHaveTextContent(PART_OK);
    }
    expect(screen.queryByTestId('problems-failed-status')).not.toBeInTheDocument();
  });

  it('AC-60: failed client payments say "not available" with a reason, never a 0; plan charges "Not recorded"; retries "not recorded"', async () => {
    await renderWith(base());
    const part = screen.getByTestId('problems-failed');
    expect(part).toHaveTextContent(PROBLEMS_FAILED_NOT_STORED);
    expect(screen.getByTestId('problems-failed-plan-charges')).toHaveTextContent(PROBLEMS_FAILED_NOT_RECORDED);
    expect(part).toHaveTextContent(PROBLEMS_INSTALMENT_RETRIES);
    expect(part.textContent).not.toMatch(/\d/);
  });

  it('AC-60: once a failure is stored, the plan charges line counts those in the window; a failed plans read says "Could not check"', async () => {
    const withFailure = base();
    withFailure.clientPlans.figures!.failedCharges = { everRecorded: true, inWindow: 2 };
    await renderWith(withFailure);
    expect(screen.getByTestId('problems-failed-plan-charges')).toHaveTextContent('2 with a failure time in this window');
  });

  it.each([
    ['at its ceiling', { exact: false }, 'partial'],
    ['partial (an unreadable time)', { unreadableTimes: 1 }, 'partial'],
  ] as const)('QA-1: plans read %s with no failure → "No failure found in the rows read", never "never stored"', async (_n, change, status) => {
    const capped = base();
    capped.status = 'partial';
    capped.clientPlans = { status, figures: { ...capped.clientPlans.figures!, ...change } };
    await renderWith(capped);
    const line = screen.getByTestId('problems-failed-plan-charges');
    expect(line).toHaveTextContent(PROBLEMS_FAILED_NONE_IN_READ);
    expect(line).not.toHaveTextContent(PROBLEMS_FAILED_NOT_RECORDED);
  });

  it('QA-1: a complete plans read with no failure → "Not recorded: no failure has ever been stored"', async () => {
    await renderWith(base());
    expect(screen.getByTestId('problems-failed-plan-charges')).toHaveTextContent(PROBLEMS_FAILED_NOT_RECORDED);
    expect(screen.getByTestId('problems-failed-plan-charges')).not.toHaveTextContent(PROBLEMS_FAILED_NONE_IN_READ);
  });

  it('AC-60: a failed plans read → the plan charges line says "Could not check"', async () => {
    await renderWith({ ...base(), status: 'partial', clientPlans: { status: 'unknown', figures: null } });
    expect(screen.getByTestId('problems-failed-plan-charges')).toHaveTextContent(PROBLEMS_FAILED_COULD_NOT_CHECK);
  });

  it('AC-56 / AC-58: "Invoice amount" and "Instalment amount", the not-the-amount-owed note, the chips in words; every money cell names its currency; no total across currencies', async () => {
    const section = await renderWith(base());
    const invoices = screen.getByTestId('problems-invoices');
    const instalments = screen.getByTestId('problems-instalments');
    expect(within(invoices).getByRole('table', { name: PROBLEMS_INVOICES.perCurrency })).toHaveTextContent('Invoice amount');
    expect(within(instalments).getByRole('table', { name: PROBLEMS_INSTALMENTS.perCurrency })).toHaveTextContent('Instalment amount');
    expect(invoices).toHaveTextContent(PROBLEMS_INVOICES.amountNote);
    expect(instalments).toHaveTextContent(PROBLEMS_INSTALMENTS.amountNote);
    expect(within(invoices).getAllByText('Overdue').length).toBeGreaterThanOrEqual(2);
    expect(within(invoices).getByText('Past due, not marked')).toBeInTheDocument();
    expect(within(instalments).getByText('Past due, still pending')).toBeInTheDocument();
    const cells = section.querySelectorAll('[data-money]');
    expect(cells.length).toBe(7);
    for (const cell of Array.from(cells)) expect(cell.textContent).toMatch(/^(At least )?(USD|ILS|EUR|Unknown currency) -?[\d,]+\.\d\d$/);
    expect(within(screen.getByTestId('problems-invoices-line-USD')).getByText('USD 1,234.50')).toBeInTheDocument();
    expect(section.textContent).not.toMatch(/1,333\.50|1333\.5/);
  });

  it('SA-W30 / SA-W36: the rows keep date order, the unknown due date last and shown as "Unknown"; the platform row labelled; ids short with the full id in title', async () => {
    await renderWith(base());
    const rows = within(screen.getByTestId('problems-invoices-rows')).getAllByRole('row').slice(1);
    expect(rows.map((r) => r.querySelector('[data-due-date]')?.textContent)).toEqual(['2026-09-30', '2026-10-05', 'Unknown']);
    expect(rows[1]).toHaveTextContent(NAME_PLATFORM);
    expect(rows[2]).toHaveTextContent('No business name');
    expect(within(rows[0]).getByTitle('aaaaaaaa-1111-4000-8000-000000000001')).toHaveTextContent('aaaaaaaa…');
    expect(screen.getByTestId('problems-invoices-line-EUR').querySelector('[data-due-date]')).toHaveTextContent('Unknown');
    expect(screen.getByTestId('problems-invoices-showing')).toHaveTextContent('Showing 3 of 3');
  });

  it.each(['America/New_York', 'Pacific/Auckland'])('AC-74: with the process in %s, the due date 2026-09-30 renders as 2026-09-30', async (zone) => {
    const original = process.env.TZ;
    process.env.TZ = zone;
    try {
      await renderWith(base());
      const first = within(screen.getByTestId('problems-invoices-rows')).getAllByRole('row')[1];
      expect(first.querySelector('[data-due-date]')).toHaveTextContent(/^2026-09-30$/);
      expect(screen.getByTestId('problems-invoices-line-USD')).toHaveTextContent('2026-09-30');
    } finally {
      if (original === undefined) delete process.env.TZ;
      else process.env.TZ = original;
    }
  });

  it('AC-59: client plans by status (every status), active now, cancelled and completed in the window, next charge overdue', async () => {
    await renderWith(base());
    const table = within(screen.getByTestId('problems-plans')).getByRole('table', { name: 'Client plans by status' });
    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows.map((r) => r.textContent)).toEqual(['Pending0', 'Active5', 'Past due0', 'Paused0', 'Completed0', 'Cancelled1']);
    expect(screen.getByTestId('problems-plans-active-now')).toHaveTextContent('Active now5');
    expect(screen.getByTestId('problems-plans-cancelled')).toHaveTextContent('Cancelled in this window1');
    expect(screen.getByTestId('problems-plans-next-charge-overdue')).toHaveTextContent('Next charge overdue0');
  });

  it('SA-W39: an unrecognised or missing status is shown as stored and marked unrecognised', async () => {
    const odd = base();
    odd.clientPlans.figures!.byStatus.push({ status: 'weird', plans: 1, recognised: false }, { status: null, plans: 2, recognised: false });
    await renderWith(odd);
    expect(screen.getByTestId('problems-plans')).toHaveTextContent('weird (unrecognised)');
    expect(screen.getByTestId('problems-plans')).toHaveTextContent('(none) (unrecognised)');
  });

  it('AC-61: the reminder figures are plain (no tone, no colour) with the oldest due time in UTC, and the link opens the Queues section', async () => {
    await renderWith(base());
    const figures = screen.getByTestId('problems-reminders-figures');
    expect(screen.getByTestId('problems-reminders-stuck')).toHaveTextContent('Stuck3');
    expect(screen.getByTestId('problems-reminders-deadlettered-7d')).toHaveTextContent('Dead-lettered (7 d)4');
    expect(screen.getByTestId('problems-reminders-oldest')).toHaveTextContent('2026-10-09 08:15 UTC');
    expect(figures.querySelector('[data-tone]')).toBeNull();
    const classes = [figures, ...Array.from(figures.querySelectorAll('*'))].map((el) => el.getAttribute('class') ?? '').join(' ');
    expect(classes).not.toMatch(/(?:text|bg|border)-(?:red|amber|emerald|green|sky)-\d/);
    // Planted negative control: a coloured class would be seen.
    expect('text-red-300').toMatch(/(?:text|bg|border)-(?:red|amber|emerald|green|sky)-\d/);
    const link = screen.getByTestId('problems-reminders-link');
    expect(link).toHaveAttribute('href', '/admin/jobs-queues#queues');
    expect(link).toHaveAccessibleName(/Jobs & queues/);
  });

  it('AC-65: a business picked → the reminder part says it is platform-wide, with the link, and no figure', async () => {
    await renderWith({ ...base(), scope: 'one', reminders: { status: 'ok', state: 'not_narrowed', figures: null } });
    expect(screen.getByTestId('problems-reminders-not-narrowed')).toHaveTextContent(REMINDERS_NOT_NARROWED);
    expect(screen.getByTestId('problems-reminders-link')).toHaveAttribute('href', '/admin/jobs-queues#queues');
    expect(screen.queryByTestId('problems-reminders-figures')).not.toBeInTheDocument();
  });

  it('AC-66 / AC-67: reminders failed → "Could not check reminders" with the link; the part chip says so; the block is partial and every other part renders', async () => {
    await renderWith({ ...base(), status: 'partial', reminders: { status: 'unknown', state: 'failed', figures: null } });
    expect(screen.getByTestId('problems-reminders-failed')).toHaveTextContent(REMINDERS_FAILED);
    expect(screen.getByTestId('problems-reminders-link')).toHaveAttribute('href', '/admin/jobs-queues#queues');
    expect(screen.getByTestId('problems-reminders-status')).toHaveTextContent(PART_COULD_NOT_LOAD);
    expect(screen.getByTestId('section-payment-problems')).toHaveAttribute('data-status', 'partial');
    expect(screen.getByTestId('problems-invoices-rows')).toBeInTheDocument();
    expect(screen.getByTestId('problems-plans-body')).toBeInTheDocument();
  });

  it('AC-66 (SA-W31): overdue invoices failed → that part alone says "Could not load this part"; the frame never says "Could not load this section"', async () => {
    const section = await renderWith({ ...base(), status: 'partial', overdueInvoices: { status: 'unknown', figures: null } });
    expect(screen.getByTestId('problems-invoices-could-not-load')).toHaveTextContent(PART_COULD_NOT_LOAD);
    expect(screen.getByTestId('problems-invoices-status')).toHaveTextContent(PART_COULD_NOT_LOAD);
    expect(within(section).queryByText(SECTION_COULD_NOT_LOAD)).not.toBeInTheDocument();
    expect(screen.getByTestId('problems-instalments-rows')).toBeInTheDocument();
    expect(screen.getByTestId('problems-failed')).toHaveTextContent(PROBLEMS_FAILED_NOT_STORED);
    for (const id of ['section-takings', 'section-accounts', 'section-ai-cost', 'section-credits']) {
      expect(screen.getByTestId(id)).toBeInTheDocument();
    }
  });

  it('AC-62: a read at its ceiling → "At least" on counts and amounts, a notice, "among the rows read", and the part chip "Partial"', async () => {
    const capped = base();
    capped.status = 'partial';
    capped.overdueInvoices.status = 'partial';
    const f = capped.overdueInvoices.figures!;
    f.exact = false;
    f.lines = f.lines.map((line) => ({ ...line, amountExact: false }));
    await renderWith(capped);
    expect(screen.getByTestId('problems-invoices-notice-ceiling')).toHaveTextContent(PROBLEMS_INVOICES.ceilingNotice);
    expect(screen.getByTestId('problems-invoices-line-USD')).toHaveTextContent('At least USD 1,234.50');
    expect(screen.getByTestId('problems-invoices-total')).toHaveTextContent('At least 3');
    expect(screen.getByTestId('problems-invoices-showing')).toHaveTextContent('Lists the oldest among the rows read');
    expect(screen.getByTestId('problems-invoices-status')).toHaveTextContent(PART_PARTIAL);
  });

  it('an unreadable amount → its line "At least", a notice, the row amount "Unknown"', async () => {
    const odd = base();
    const f = odd.overdueInvoices.figures!;
    f.unreadableAmounts = 1;
    f.lines[1] = { ...f.lines[1], amountExact: false, unreadable: 1 };
    f.rows[1] = { ...f.rows[1], amount: null };
    await renderWith(odd);
    expect(screen.getByTestId('problems-invoices-notice-unreadable')).toBeInTheDocument();
    expect(screen.getByTestId('problems-invoices-line-USD')).toHaveTextContent('At least USD 1,234.50');
    const row = within(screen.getByTestId('problems-invoices-rows')).getAllByRole('row')[2];
    expect(row).toHaveTextContent('Unknown');
  });

  it('AC-63: empty parts say so in words, with no 0.00', async () => {
    const empty = (): FinancePaymentProblemsSection['overdueInvoices'] => ({
      status: 'ok',
      figures: { empty: true, exact: true, lines: [], businesses: 0, total: 0, unreadableAmounts: 0, rows: [], rowsTotal: 0 },
    });
    const plans = base().clientPlans;
    plans.figures = { ...plans.figures!, total: 0, byStatus: plans.figures!.byStatus.map((s) => ({ ...s, plans: 0 })), activeNow: 0, cancelledInWindow: 0 };
    const section = await renderWith({ ...base(), overdueInvoices: empty(), overdueInstalments: empty(), clientPlans: plans });
    expect(screen.getByTestId('problems-invoices-empty')).toHaveTextContent(PROBLEMS_INVOICES.empty);
    expect(screen.getByTestId('problems-instalments-empty')).toHaveTextContent(PROBLEMS_INSTALMENTS.empty);
    expect(screen.getByTestId('problems-plans-empty')).toHaveTextContent(PLANS_EMPTY);
    expect(section.textContent).not.toMatch(/0\.00/);
  });

  it('AC-68: labelled tables with column headers, number cells tabular; every part chip has words; the KPI strip still has exactly five tiles', async () => {
    const section = await renderWith(base());
    for (const name of [PROBLEMS_INVOICES.perCurrency, PROBLEMS_INVOICES.oldest, PROBLEMS_INSTALMENTS.perCurrency, PROBLEMS_INSTALMENTS.oldest, 'Client plans by status']) {
      const table = within(section).getByRole('table', { name });
      const headers = table.querySelectorAll('thead th');
      expect(headers.length).toBeGreaterThan(1);
      for (const th of Array.from(headers)) expect(th).toHaveAttribute('scope', 'col');
    }
    for (const cell of Array.from(section.querySelectorAll('[data-money]'))) expect(cell.className).toMatch(/tabular-nums/);
    for (const chip of Array.from(section.querySelectorAll('[data-tone]'))) expect(chip.textContent?.trim().length).toBeGreaterThan(0);
    const tiles = screen.getByTestId('kpi-strip').querySelectorAll('[data-testid^="tile-"][data-status]');
    expect(tiles).toHaveLength(5);
  });

  it('BD-13 / S2-F6: no test-mode wording and no "Deleted business" anywhere in the block', async () => {
    const section = await renderWith(base());
    expect(section.textContent).not.toMatch(/test.?mode|live.?mode|livemode/i);
    expect(section.textContent).not.toMatch(/Deleted business/);
  });
});

describe('Our revenue (slice 4a)', () => {
  const WINDOW_LABEL = 'This month, 2026-10-01 to 2026-10-09 UTC';

  it('S4-FR-1: a section with its status, the window in the subtitle, above takings; the "cannot produce" list', async () => {
    serve({ success: true, data: payload() });
    render(<FinanceView />);
    const panel = await screen.findByTestId('section-revenue');
    expect(panel.getAttribute('data-status')).toBe('ok');
    expect(panel).toHaveTextContent(REVENUE_SUBTITLE_ALL(WINDOW_LABEL));
    expect(panel.compareDocumentPosition(screen.getByTestId('section-takings')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    for (const item of REVENUE_CANNOT) expect(within(panel).getByTestId('revenue-cannot')).toHaveTextContent(item);
  });

  it('SA-W61 (M-2 meaning of S4-FR-4): plans received, then credit boosts, under their own headings; no "later update" wording', async () => {
    serve({ success: true, data: payload({ revenue: revenueSection({ state: 'recorded', plans: paidPlans() }) }) });
    render(<FinanceView />);
    const panel = await screen.findByTestId('section-revenue');
    const plans = within(panel).getByTestId('revenue-plans-part');
    const boosts = within(panel).getByTestId('revenue-boosts-part');
    expect(within(plans).getByRole('heading', { level: 3 })).toHaveTextContent('Plans');
    expect(within(boosts).getByRole('heading', { level: 3 })).toHaveTextContent('Credit boosts');
    expect(plans.compareDocumentPosition(boosts) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(plans.textContent).not.toMatch(/later update|all businesses:/);
  });

  it('AC-126: plans failed → "Could not load" on the plans part only; the boosts and every other section render', async () => {
    serve({ success: true, data: payload({ revenue: revenueSection({ status: 'partial', plans: PLANS_FAILED }) }) });
    render(<FinanceView />);
    const panel = await screen.findByTestId('section-revenue');
    expect(within(panel).getByTestId('revenue-plans-failed')).toHaveTextContent(REVENUE_PLANS_FAILED);
    expect(within(panel).getByTestId('revenue-no-boosts')).toBeInTheDocument();
    expect(panel.getAttribute('data-status')).toBe('partial');
    expect(screen.getByTestId('section-takings')).toBeInTheDocument();
  });

  it('AC-123 / AC-129: a business picked → its own payment list (formatUtc, the plan label, the period), no "all businesses" wording, no table, no deleted line', async () => {
    mockSearch = `accountId=${A}`;
    const plans = paidPlans({
      scope: 'one',
      accounts: null,
      accountsTotal: null,
      deletedAccounts: null,
      payments: [
        { id: 'e1', paidAt: '2026-10-12T18:21:09.000Z', planLabel: 'Essentials-ish', received: 79, tax: 0, currency: 'USD', periodStart: '2026-10-12T18:21:07.000Z', periodEnd: '2026-11-12T18:21:07.000Z' },
        { id: 'e0', paidAt: '2026-10-02T08:00:00.000Z', planLabel: null, received: 19.99, tax: 1.99, currency: 'USD', periodStart: null, periodEnd: null },
      ],
      paymentsTotal: 2,
    });
    const revenue = paidRevenue([boostLine()], {}, { plans, totals: [{ currency: 'USD', boostsNet: 10, plansReceived: 79, total: 89 }] });
    revenue.boosts = { ...revenue.boosts, scope: 'one', deletedAccounts: null };
    serve({ success: true, data: k5With(payload({ accountId: A, revenue }), { kind: 'one', currency: 'USD', net: 89 }, 'Boosts net of refunds and disputes, plus plans received') });
    render(<FinanceView />);
    const panel = await screen.findByTestId('section-revenue');
    expect(panel).toHaveTextContent(REVENUE_SUBTITLE_ONE(WINDOW_LABEL));
    expect(panel.textContent).not.toMatch(/all businesses/);
    expect(within(panel).queryByTestId('revenue-plans-accounts')).toBeNull();
    expect(within(panel).queryByTestId('revenue-plans-deleted')).toBeNull();
    expect(within(panel).queryByTestId('revenue-deleted')).toBeNull();
    const first = within(panel).getByTestId('revenue-plans-payment-e1');
    expect(first).toHaveTextContent(formatUtc('2026-10-12T18:21:09.000Z'));
    expect(first).toHaveTextContent('2026-10-12 18:21 UTC');
    expect(first).toHaveTextContent('Essentials-ish');
    expect(first).toHaveTextContent(`${formatUtc('2026-10-12T18:21:07.000Z')} to ${formatUtc('2026-11-12T18:21:07.000Z')}`);
    expect(first.querySelector('[data-money="received"]')).toHaveTextContent('USD 79.00');
    expect(first.querySelector('[data-money="tax"]')).toHaveTextContent('USD 0.00');
    const second = within(panel).getByTestId('revenue-plans-payment-e0');
    expect(second).toHaveTextContent(REVENUE_PLANS_UNKNOWN_PLAN);
    expect(second).toHaveTextContent(`${REVENUE_PLANS_PERIOD_NOT_RECORDED} to ${REVENUE_PLANS_PERIOD_NOT_RECORDED}`);
    expect(second.textContent).not.toContain('—');
    // Newest first, as sent.
    expect(first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // K-5 and the summary read the same total (SA-Q40).
    expect(screen.getByTestId('tile-k5_our_revenue')).toHaveTextContent('USD 89.00');
    expect(screen.getByTestId('account-summary-total-USD')).toHaveTextContent('USD 89.00');
    expect(screen.getByTestId('account-summary-plan-USD')).toHaveTextContent('USD 79.00');
  });

  it('AC-120 / AC-124: all businesses → the per-currency line (Received header, "USD 79.00"), the by-business table, the deleted line in words', async () => {
    const plans = paidPlans({ deletedAccounts: [{ currency: 'USD', payments: 1, received: 49, exact: true }] });
    serve({ success: true, data: payload({ revenue: revenueSection({ state: 'recorded', plans }) }) });
    render(<FinanceView />);
    const panel = await screen.findByTestId('section-revenue');
    const line = within(panel).getByTestId('revenue-plans-line-USD');
    expect(line.querySelector('[data-money="received"]')).toHaveTextContent('USD 79.00');
    expect(line.querySelector('[data-money="tax"]')).toHaveTextContent('USD 0.00');
    expect(within(panel).getByRole('columnheader', { name: REVENUE_PLANS_RECEIVED })).toBeInTheDocument();
    expect(within(panel).getByTestId(`revenue-plans-account-${A}`)).toHaveTextContent('Acme Dental');
    expect(within(panel).getByTestId(`revenue-plans-account-${A}`)).toHaveTextContent('USD 79.00');
    expect(within(panel).getByTestId('revenue-plans-deleted-USD')).toHaveTextContent(revenuePlansDeletedLine(1, 'USD 49.00'));
    expect(within(panel).getByTestId('revenue-plans-refunds-note')).toHaveTextContent(REVENUE_PLANS_REFUNDS_NOTE);
    for (const cell of within(panel).getByTestId('revenue-plans').querySelectorAll('[data-money]')) expect(cell.textContent).toMatch(/USD/);
  });

  it('AC-124: no deleted-account payment → "No plan payments from deleted accounts"', async () => {
    serve({ success: true, data: payload({ revenue: revenueSection({ state: 'recorded', plans: paidPlans() }) }) });
    render(<FinanceView />);
    expect(await screen.findByTestId('revenue-plans-deleted')).toHaveTextContent(REVENUE_PLANS_DELETED_NONE);
  });

  it('AC-121 / AC-126: zero-amount only → the empty sentence and the note, no "0.00"', async () => {
    const plans = plansPart({ notes: { empty: true, exact: true, zeroAmountInvoices: 2, unreadable: 0, otherKind: 0 } });
    serve({ success: true, data: payload({ revenue: revenueSection({ plans }) }) });
    render(<FinanceView />);
    const part = await screen.findByTestId('revenue-plans');
    expect(within(part).getByTestId('revenue-plans-empty')).toHaveTextContent(REVENUE_PLANS_EMPTY);
    expect(within(part).getByTestId('revenue-plans-zero-note')).toHaveTextContent(REVENUE_PLANS_ZERO_NOTE(2));
    expect(part.textContent).not.toMatch(/0\.00|USD/);
  });

  it('AC-125 / AC-120: the ceiling and an unreadable invoice → "At least", the notices, "excludes 1 unreadable"', async () => {
    const plans = paidPlans({
      status: 'partial',
      lines: [{ currency: 'USD', payments: 1, received: 79, tax: 0, businesses: 1, zeroAmountInvoices: 0, unreadable: 1, exact: false }],
      notes: { empty: false, exact: false, zeroAmountInvoices: 0, unreadable: 1, otherKind: 0 },
    });
    serve({ success: true, data: k5With(payload({ revenue: revenueSection({ status: 'partial', plans }) }), { kind: 'unknown', reason: 'cut_off' }) });
    render(<FinanceView />);
    const line = await screen.findByTestId('revenue-plans-line-USD');
    expect(line.querySelector('[data-money="received"]')).toHaveTextContent('At least USD 79.00');
    expect(line).toHaveTextContent('excludes 1 unreadable');
    expect(screen.getByTestId('revenue-plans-notice-cut')).toHaveTextContent(REVENUE_PLANS_NOTICE_CUT);
    expect(screen.getByTestId('revenue-plans-notice-unreadable')).toHaveTextContent(REVENUE_PLANS_NOTICE_UNREADABLE(1));
    expect(screen.getByTestId('tile-k5_our_revenue')).toHaveTextContent('Unknown');
  });

  it('AC-90 / AC-95: the owner purchase → "USD 10.00" in the line and on K-5, with the caption; K-5 grey, never green', async () => {
    serve({ success: true, data: k5With(payload({ revenue: paidRevenue([boostLine()]) }), { kind: 'one', currency: 'USD', net: 10 }) });
    render(<FinanceView />);
    const panel = await screen.findByTestId('section-revenue');
    const line = within(panel).getByTestId('revenue-line-USD');
    for (const cell of ['gross', 'net']) expect(line.querySelector(`[data-money="${cell}"]`)).toHaveTextContent('USD 10.00');
    expect(line.querySelector('[data-money="tax"]')).toHaveTextContent('USD 0.00');
    expect(line).toHaveTextContent('5,000');
    expect(within(panel).getByRole('columnheader', { name: REVENUE_NET })).toBeInTheDocument();
    expect(within(panel).getByTestId('revenue-package-pkg-small v1')).toHaveTextContent('USD 10.00');
    const k5 = screen.getByTestId('tile-k5_our_revenue');
    expect(k5).toHaveTextContent('USD 10.00');
    expect(k5).toHaveTextContent(k5Caption(WINDOW_LABEL));
    expect(k5Caption(WINDOW_LABEL)).toContain('Credit boosts and plans');
    expect(k5.getAttribute('data-status')).toBe('neutral');
    expect(k5.className).not.toContain(STATUS_STYLES.green.card);
    // Every money cell names its currency.
    for (const cell of panel.querySelectorAll('[data-money]')) expect(cell.textContent).toMatch(/USD|Unknown/);
  });

  it('AC-90: 1999 minor units arrive as 19.99 and print "USD 19.99"', async () => {
    serve({ success: true, data: payload({ revenue: paidRevenue([boostLine({ gross: 19.99, net: 19.99 })]) }) });
    render(<FinanceView />);
    expect(within(await screen.findByTestId('revenue-line-USD')).getAllByText('USD 19.99').length).toBeGreaterThan(0);
  });

  it('AC-90: an unreadable purchase → "excludes 1 unreadable", gross "At least", net "Unknown", a notice', async () => {
    const revenue = paidRevenue([boostLine({ purchases: 2, unreadable: 1, held: null, lost: null, net: null })], { unreadablePurchases: 1 }, { status: 'partial' });
    revenue.boosts.status = 'partial';
    serve({ success: true, data: k5With(payload({ revenue }), { kind: 'unknown', reason: 'unreadable' }) });
    render(<FinanceView />);
    const line = await screen.findByTestId('revenue-line-USD');
    expect(line).toHaveTextContent('excludes 1 unreadable');
    expect(line.querySelector('[data-money="gross"]')).toHaveTextContent('At least USD 10.00');
    expect(line.querySelector('[data-money="net"]')).toHaveTextContent(/^Unknown$/);
    expect(screen.getByTestId('revenue-notice-unreadable')).toHaveTextContent(REVENUE_NOTICE_UNREADABLE(1));
    expect(screen.getByTestId('tile-k5_our_revenue')).toHaveTextContent('Unknown');
  });

  it('AC-91: the refund-timing note shows when a refund or dispute amount is non-zero, and only then', async () => {
    serve({ success: true, data: payload({ revenue: paidRevenue([boostLine({ refunded: 3, net: 7 })], { refundOrDispute: true }) }) });
    const { unmount } = render(<FinanceView />);
    expect(await screen.findByTestId('revenue-refund-note')).toHaveTextContent(REVENUE_REFUND_TIMING_NOTE);
    unmount();
    serve({ success: true, data: payload({ revenue: paidRevenue([boostLine()]) }) });
    render(<FinanceView />);
    await screen.findByTestId('revenue-lines');
    expect(screen.queryByTestId('revenue-refund-note')).toBeNull();
  });

  it('AC-92: two currencies → two lines; K-5 "2 currencies, see Our revenue"; no total anywhere', async () => {
    const lines = [boostLine({ currency: 'EUR', gross: 7, net: 7 }), boostLine()];
    serve({ success: true, data: k5With(payload({ revenue: paidRevenue(lines) }), { kind: 'several', currencies: 2 }) });
    render(<FinanceView />);
    const panel = await screen.findByTestId('section-revenue');
    expect(within(panel).getByTestId('revenue-line-EUR')).toHaveTextContent('EUR 7.00');
    expect(within(panel).getByTestId('revenue-line-USD')).toHaveTextContent('USD 10.00');
    expect(screen.getByTestId('tile-k5_our_revenue')).toHaveTextContent(k5SeveralCurrencies(2));
    expect(k5SeveralCurrencies(2)).toBe('2 currencies, see Our revenue');
    // 7 + 10 printed anywhere would be a cross-currency total.
    expect(document.body.textContent).not.toMatch(/17\.00/);
  });

  it('AC-93: the ceiling → "At least" on counts and amounts, "Unknown (a read was cut off)" on held, lost and net, the notice; K-5 "Unknown"', async () => {
    const revenue = paidRevenue([boostLine({ held: null, lost: null, net: null })], { exact: false }, { status: 'partial' });
    revenue.boosts.status = 'partial';
    revenue.boosts.packages = revenue.boosts.packages!.map((p) => ({ ...p, net: null }));
    serve({ success: true, data: k5With(payload({ revenue }), { kind: 'unknown', reason: 'cut_off' }) });
    render(<FinanceView />);
    const line = await screen.findByTestId('revenue-line-USD');
    for (const cell of ['gross', 'tax', 'refunded']) expect(line.querySelector(`[data-money="${cell}"]`)).toHaveTextContent(/^At least USD/);
    for (const cell of ['held', 'lost', 'net']) expect(line.querySelector(`[data-money="${cell}"]`)).toHaveTextContent(REVENUE_CUT_OFF);
    expect(line).toHaveTextContent('At least 1');
    expect(line).toHaveTextContent('At least 5,000');
    expect(screen.getByTestId('revenue-notice-cut')).toHaveTextContent(REVENUE_NOTICE_CUT);
    expect(screen.getByTestId('section-revenue').getAttribute('data-status')).toBe('partial');
    const k5 = screen.getByTestId('tile-k5_our_revenue');
    expect(k5).toHaveTextContent('Unknown');
    expect(k5.textContent).not.toMatch(/At least/);
  });

  it('AC-89: other-status purchases are counted in words', async () => {
    serve({ success: true, data: payload({ revenue: paidRevenue([boostLine()], { otherStatusPurchases: 2 }) }) });
    render(<FinanceView />);
    expect(await screen.findByTestId('revenue-other-status')).toHaveTextContent(REVENUE_OTHER_STATUS(2));
  });

  it('AC-97: the deleted-accounts line in words, never a name; "No purchases from deleted accounts" when none', async () => {
    const revenue = paidRevenue([boostLine({ purchases: 2, gross: 35, net: 35 })]);
    revenue.boosts.deletedAccounts = [{ currency: 'USD', purchases: 1, net: 25, unreadable: 0 }];
    serve({ success: true, data: payload({ revenue }) });
    const { unmount } = render(<FinanceView />);
    expect(await screen.findByTestId('revenue-deleted-USD')).toHaveTextContent(revenueDeletedLine(1, 'USD 25.00'));
    unmount();
    serve({ success: true, data: payload({ revenue: paidRevenue([boostLine()]) }) });
    render(<FinanceView />);
    expect(await screen.findByTestId('revenue-deleted')).toHaveTextContent(REVENUE_DELETED_NONE);
  });

  it('AC-95: the boost read failed → "Could not load" in the section, the plans part still shown; K-5 unavailable "Unknown"', async () => {
    const revenue = revenueSection({ status: 'partial', plans: paidPlans(), totals: null }, { status: 'unknown', lines: null, packages: null, deletedAccounts: null, notes: null });
    const p = payload({ revenue });
    p.tiles.k5 = { ...p.tiles.k5, status: 'unavailable', headline: 'Unknown', money: { kind: 'unknown', reason: 'failed' } };
    serve({ success: true, data: p });
    render(<FinanceView />);
    const panel = await screen.findByTestId('section-revenue');
    expect(within(panel).getByTestId('revenue-boosts-failed')).toHaveTextContent(REVENUE_BOOSTS_FAILED);
    expect(within(panel).getByTestId('revenue-plans-line-USD')).toHaveTextContent('USD 79.00');
    expect(screen.getByTestId('tile-k5_our_revenue').getAttribute('data-status')).toBe('unavailable');
    expect(screen.getByTestId('tile-k5_our_revenue')).toHaveTextContent('Unknown');
    expect(screen.getByTestId('section-takings')).toBeInTheDocument();
  });

  it('both reads failed → the section says it could not load, with Retry', async () => {
    const revenue = revenueSection({ status: 'unknown', state: 'unknown', plans: PLANS_FAILED, totals: null }, { status: 'unknown', lines: null, packages: null, deletedAccounts: null, notes: null });
    serve({ success: true, data: payload({ revenue }) });
    render(<FinanceView />);
    const panel = await screen.findByTestId('section-revenue');
    expect(panel).toHaveTextContent(SECTION_COULD_NOT_LOAD);
    expect(within(panel).queryByTestId('revenue-plans')).toBeNull();
  });

  it.each([
    ['empty', revenueSection()],
    ['paid with a refund', paidRevenue([boostLine({ refunded: 3, net: 7 })], { refundOrDispute: true })],
    ['cut off', paidRevenue([boostLine({ net: null, held: null, lost: null })], { exact: false })],
    ['boosts failed', revenueSection({ status: 'partial', plans: paidPlans(), totals: null }, { status: 'unknown', lines: null, packages: null, deletedAccounts: null, notes: null })],
    ['plans failed', revenueSection({ status: 'partial', plans: PLANS_FAILED, totals: null })],
    ['both failed', revenueSection({ status: 'unknown', state: 'unknown', plans: PLANS_FAILED, totals: null }, { status: 'unknown', lines: null, packages: null, deletedAccounts: null, notes: null })],
  ] as const)('AC-81 (unchanged rule): in the %s state the section and K-5 name no mode and no webhook', async (_name, revenue) => {
    serve({ success: true, data: payload({ revenue }) });
    render(<FinanceView />);
    const panel = await screen.findByTestId('section-revenue');
    const text = `${panel.textContent} ${screen.getByTestId('tile-k5_our_revenue').textContent}`;
    expect(text).not.toMatch(/webhook|not in place|test accounts only|live mode|test mode|livemode/i);
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

// ── Money M-1: one account, one screen (AC-109, AC-113, AC-116) ─────────────
describe('Money M-1 on the page', () => {
  it('AC-116: with all businesses there is no account header and no summary; the sections render as before', async () => {
    serve({ success: true, data: payload() });
    render(<FinanceView />);
    await screen.findByTestId('kpi-strip');
    expect(screen.queryByTestId('account-header')).toBeNull();
    expect(screen.queryByTestId('account-summary')).toBeNull();
    expect(screen.queryByTestId('business-filter-chip')).toBeNull();
    for (const id of ['section-revenue', 'section-takings', 'section-accounts', 'section-ai-cost', 'section-credits', 'section-payment-problems']) {
      expect(screen.getByTestId(id)).toBeInTheDocument();
    }
  });

  it('AC-109: after a pick the chip reads "Business: {picked name}", and the name never reaches the URL', async () => {
    serve({ success: true, data: payload() });
    render(<FinanceView />);
    await screen.findByTestId('kpi-strip');
    fireEvent.click(screen.getByTestId('picker-pick'));
    expect(mockReplace).toHaveBeenCalledWith(`/admin/finance?preset=this_month&accountId=${A}`, { scroll: false });
    for (const call of mockReplace.mock.calls) expect(String(call[0])).not.toContain('Acme');
  });

  it('AC-109: the picked name shows in the chip and the header once the URL carries the account', async () => {
    serve({ success: true, data: payload() });
    const { rerender } = render(<FinanceView />);
    await screen.findByTestId('kpi-strip');
    fireEvent.click(screen.getByTestId('picker-pick'));
    // The router mock does not change the URL; the next render sees it, as Next would.
    mockSearch = `preset=this_month&accountId=${A}`;
    const fetchMock = serve({ success: true, data: payload({ accountId: A }) });
    rerender(<FinanceView />);
    expect(await screen.findByTestId('account-header')).toBeInTheDocument();
    expect(screen.getByTestId('business-filter-chip')).toHaveTextContent(`Business: ${PICKED_NAME}`);
    expect(screen.getByTestId('account-header-name')).toHaveTextContent(PICKED_NAME);
    for (const call of fetchMock.mock.calls) expect(String((call as unknown[])[0])).not.toContain('Acme');
  });

  it('AC-109: on a reload the chip takes the name from the payload (Section 4 row); with no row, the short id', async () => {
    mockSearch = `preset=this_month&accountId=${A}`;
    serve({ success: true, data: payload({ accountId: A }) });
    const first = render(<FinanceView />);
    await screen.findByTestId('account-header');
    expect(screen.getByTestId('business-filter-chip')).toHaveTextContent('Business: Acme Dental');
    first.unmount();

    const unnamed = '55555555-5555-4555-8555-555555555555';
    mockSearch = `preset=this_month&accountId=${unnamed}`;
    serve({ success: true, data: payload({ accountId: unnamed }) });
    render(<FinanceView />);
    await screen.findByTestId('account-header');
    expect(screen.getByTestId('business-filter-chip')).toHaveTextContent('Business: 55555555…');
    expect(screen.getByTestId('account-header-name')).toHaveTextContent('55555555…');
  });

  it('AC-110: with a business picked, the header and summary show, and each summary figure equals its section on the same render', async () => {
    const p = payload({ accountId: A, revenue: paidRevenue([boostLine()]) });
    p.accounts = {
      ...p.accounts,
      scope: 'one',
      figures: {
        ...p.accounts.figures!,
        total: 1,
        groups: p.accounts.figures!.groups.map((g) => (g.key === 'tier:x' ? { ...g, count: 1, foundingPartners: 1 } : { ...g, count: 0 })),
      },
    };
    mockSearch = `preset=this_month&accountId=${A}`;
    serve({ success: true, data: p });
    render(<FinanceView />);
    const header = await screen.findByTestId('account-header');
    const summary = screen.getByTestId('account-summary');
    // Above the KPI strip.
    expect(header.compareDocumentPosition(screen.getByTestId('kpi-strip')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(header.compareDocumentPosition(summary) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(header).getByTestId('account-header-paying')).toHaveTextContent('Paying');
    // The same text as the section's own node.
    expect(within(summary).getByTestId('account-summary-ai-cost-value').textContent).toBe(screen.getByTestId('ai-total').textContent);
    const netCell = within(screen.getByTestId('revenue-line-USD')).getByText((_, el) => el?.getAttribute('data-money') === 'net');
    expect(within(summary).getByTestId('account-summary-boost-USD').textContent).toBe(netCell.textContent);
    const creditsRow = screen.getByTestId(`credits-row-${A}`);
    expect(creditsRow.textContent).toContain('160.0%');
    expect(within(summary).getByTestId('account-summary-credits').textContent).toContain('160.0%');
    expect(within(summary).getByTestId('account-summary-group-value').textContent).toBe(within(header).getByTestId('account-header-group').textContent);
    expect(within(header).getByTestId('account-header-group')).toHaveTextContent('Essentials-ish');
  });

  it('the chip X "Remove business" goes back to all businesses', async () => {
    mockSearch = `preset=this_month&accountId=${A}`;
    serve({ success: true, data: payload({ accountId: A }) });
    render(<FinanceView />);
    await screen.findByTestId('account-header');
    fireEvent.click(screen.getByRole('button', { name: 'Remove business' }));
    expect(mockReplace).toHaveBeenLastCalledWith('/admin/finance?preset=this_month', { scroll: false });
  });

  it('AC-113 (CR G-8): the Section 3 AI cost & usage link carries the window, and the account when picked', async () => {
    serve({ success: true, data: payload() });
    const first = render(<FinanceView />);
    await screen.findByTestId('kpi-strip');
    expect(screen.getByTestId('ai-analytics-link').getAttribute('href')).toBe('/admin/analytics?range=this_month');
    first.unmount();

    mockSearch = `preset=this_month&accountId=${A}`;
    serve({ success: true, data: payload({ accountId: A }) });
    render(<FinanceView />);
    await screen.findByTestId('account-header');
    expect(screen.getByTestId('ai-analytics-link').getAttribute('href')).toBe(`/admin/analytics?range=this_month&account=${A}`);
  });
});
