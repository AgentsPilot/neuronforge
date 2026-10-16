/**
 * @jest-environment jsdom
 *
 * Finance F-5, Pin B (AC-181, SA F5-R4): every KPI tile's value and status
 * on /admin/finance equal the values before F-5, for the same payload.
 *
 * Written FIRST and run green on the unchanged tree (447d17a2, where the page
 * still drew its own tiles through Health's status styles), then never edited
 * again. Its SHA-256 is recorded in the F-5 workplan's Implementation Notes at
 * Step 0 and at handover; the two must be equal.
 *
 * It renders the real FinanceView with fixed payloads and reads each tile only
 * through what both trees share: `data-testid="tile-<id>"`, `data-status`, and
 * the tile's text containing a literal. So the same file runs on either side.
 * Every wait has an explicit timeout (the F-4 amendment lesson).
 *
 * Not pinned, by design (workplan SA-W1, SA-W4): the "For information" word on
 * a neutral tile (K-4 removes it), the line order and the type sizes.
 */

import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/react';

import type { FinanceCreditRow, FinancePayload, FinanceTakingsSection } from '@/lib/business-os/finance/financeTypes';
import type { FinancePaymentProblemsSection, FinancePlanRevenue, FinanceRevenueSection } from '@/lib/business-os/finance/financeTypes';

let mockSearch = '';
jest.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(mockSearch),
  useRouter: () => ({ replace: jest.fn(), push: jest.fn() }),
  usePathname: () => '/admin/finance',
}));
// The real picker searches as the admin types; a stand-in keeps the page's own fetch count.
jest.mock('@/app/admin/components/layout/AdminBusinessPicker', () => ({
  ...jest.requireActual('@/app/admin/components/layout/AdminBusinessPicker'),
  AdminBusinessPicker: () => <div data-testid="picker-stand-in" />,
}));

import { FinanceView } from '../components/FinanceView';

const WAIT = { timeout: 10_000 };
const CASE_TIMEOUT_MS = 30_000;

// ── The payload, as the page render test builds it (copied, so this file never changes) ──
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


function serve(body: unknown): void {
  const fetchMock = jest.fn(async () => ({ ok: true, status: 200, json: async () => body }));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- jsdom has no fetch; standard test stub
  (global as any).fetch = fetchMock;
}

beforeEach(() => {
  mockSearch = '';
  window.history.replaceState(null, '', '/admin/finance');
});

type Tiles = FinancePayload['tiles'];
type TileId = Tiles[keyof Tiles]['id'];

interface TileExpectation {
  id: TileId;
  status: string;
  /** Literal fragments the tile's text contains, before and after F-5. */
  has: string[];
  /** Literal fragments it must not contain. */
  hasNot?: string[];
}

interface Fixture {
  name: string;
  search: string;
  build: () => FinancePayload;
  tiles: TileExpectation[];
}

const LABEL_K1 = 'Charged AI cost this month';
const SUB_K1 = 'This month vs last month, UTC';
const LABEL_K2 = 'Accounts far over allowance';
const LABEL_K3 = 'Founding Partners with no end date';
const LABEL_K4 = 'Gifted credits outstanding';
const SUB_K4 = 'Credits, now';
const LABEL_K5 = 'Our revenue';

const FIXTURES: Fixture[] = [
  {
    name: 'F1 base: every tile has a value',
    search: '',
    build: () => {
      const p = payload();
      p.tiles.k1 = { id: 'k1_ai_cost', status: 'green', headline: 'All clear', value: { value: 12.5, exact: true }, previous: { value: 10, exact: true } };
      p.tiles.k2 = { id: 'k2_far_over_allowance', status: 'amber', headline: 'Some accounts could not be read', value: { value: 1, exact: false }, previous: null };
      p.tiles.k3 = { id: 'k3_founding_no_end_date', status: 'red', headline: 'Founding Partners with no end date', value: { value: 8, exact: true }, previous: null };
      p.tiles.k4 = { id: 'k4_gifted_outstanding', status: 'neutral', headline: 'Admin-granted, not taken back, not expired', value: { value: 12.5, exact: true }, previous: null };
      p.tiles.k5 = { id: 'k5_our_revenue', status: 'neutral', headline: 'Net of refunds and disputes', value: null, previous: null, money: { kind: 'one', currency: 'USD', net: 10 } };
      return p;
    },
    tiles: [
      { id: 'k1_ai_cost', status: 'green', has: [LABEL_K1, SUB_K1, 'USD 12.50', 'Same days last month: USD 10.00', 'Healthy', 'All clear'], hasNot: ['At least'] },
      { id: 'k2_far_over_allowance', status: 'amber', has: [LABEL_K2, "At or over 150% of this period's allowance", 'At least 1', 'Needs a look', 'Some accounts could not be read'] },
      { id: 'k3_founding_no_end_date', status: 'red', has: [LABEL_K3, '8', 'Needs action'] },
      { id: 'k4_gifted_outstanding', status: 'neutral', has: [LABEL_K4, SUB_K4, '12.5', 'Admin-granted, not taken back, not expired'], hasNot: ['$', 'USD'] },
      { id: 'k5_our_revenue', status: 'neutral', has: [LABEL_K5, 'Credit boosts and plans · This month, 2026-10-01 to 2026-10-09 UTC', 'USD 10.00', 'Net of refunds and disputes'] },
    ],
  },
  {
    name: 'F2 grey: not measured, could not check, no value',
    search: '',
    build: () => {
      const p = payload();
      p.tiles.k1 = { id: 'k1_ai_cost', status: 'not_measured', headline: 'Not enough history', value: null, previous: null };
      p.tiles.k2 = { id: 'k2_far_over_allowance', status: 'unavailable', headline: 'Could not read the credits', value: null, previous: null };
      p.tiles.k3 = { id: 'k3_founding_no_end_date', status: 'green', headline: 'All clear', value: { value: 0, exact: true }, previous: null };
      p.tiles.k4 = { id: 'k4_gifted_outstanding', status: 'neutral', headline: 'Admin-granted, not taken back, not expired', value: { value: 0, exact: true }, previous: null };
      p.tiles.k5 = { id: 'k5_our_revenue', status: 'neutral', headline: 'No data yet', value: null, previous: null, money: { kind: 'none' } };
      return p;
    },
    tiles: [
      { id: 'k1_ai_cost', status: 'not_measured', has: [LABEL_K1, SUB_K1, 'Not measured yet', 'Not enough history'], hasNot: ['USD', 'Same days last month'] },
      { id: 'k2_far_over_allowance', status: 'unavailable', has: [LABEL_K2, 'Could not check', 'Could not read the credits'], hasNot: ['At least'] },
      { id: 'k3_founding_no_end_date', status: 'green', has: [LABEL_K3, '0', 'Healthy', 'All clear'] },
      { id: 'k4_gifted_outstanding', status: 'neutral', has: [LABEL_K4, SUB_K4, '0'], hasNot: ['$', 'USD'] },
      { id: 'k5_our_revenue', status: 'neutral', has: [LABEL_K5, 'No data yet'], hasNot: ['USD', '0.00', 'Unknown'] },
    ],
  },
  {
    name: 'F3 money: lower bounds and several currencies',
    search: '',
    build: () => {
      const p = payload();
      p.tiles.k1 = { id: 'k1_ai_cost', status: 'amber', headline: 'A lower bound', value: { value: 12.5, exact: false }, previous: { value: 3.25, exact: false } };
      p.tiles.k2 = { id: 'k2_far_over_allowance', status: 'red', headline: 'Accounts far over allowance', value: { value: 3, exact: true }, previous: null };
      p.tiles.k5 = { id: 'k5_our_revenue', status: 'neutral', headline: 'Net of refunds and disputes', value: null, previous: null, money: { kind: 'several', currencies: 2 } };
      return p;
    },
    tiles: [
      { id: 'k1_ai_cost', status: 'amber', has: [LABEL_K1, 'At least USD 12.50', 'Same days last month: At least USD 3.25', 'Needs a look', 'A lower bound'] },
      { id: 'k2_far_over_allowance', status: 'red', has: [LABEL_K2, '3', 'Needs action', 'Accounts far over allowance'], hasNot: ['At least'] },
      { id: 'k3_founding_no_end_date', status: 'amber', has: [LABEL_K3, '8', 'Needs a look', 'Founding Partners with no end date'] },
      { id: 'k4_gifted_outstanding', status: 'neutral', has: [LABEL_K4, '12.5'] },
      { id: 'k5_our_revenue', status: 'neutral', has: [LABEL_K5, '2 currencies, see Our revenue'], hasNot: ['USD'] },
    ],
  },
  {
    name: 'F3b money unknown: the read failed',
    search: '',
    build: () => {
      const p = payload();
      p.tiles.k5 = { id: 'k5_our_revenue', status: 'unavailable', headline: 'Could not read our revenue', value: null, previous: null, money: { kind: 'unknown', reason: 'failed' } };
      return p;
    },
    tiles: [
      { id: 'k1_ai_cost', status: 'not_measured', has: [LABEL_K1, 'USD 12.50', 'Not measured yet', 'Not enough history'] },
      { id: 'k5_our_revenue', status: 'unavailable', has: [LABEL_K5, 'Unknown', 'Could not check', 'Could not read our revenue'], hasNot: ['USD'] },
    ],
  },
  {
    name: 'F4 picked business',
    search: `account=${A}`,
    build: () => {
      const p = payload({ accountId: A });
      p.tiles.k4 = { id: 'k4_gifted_outstanding', status: 'neutral', headline: 'Admin-granted, not taken back, not expired', value: { value: 0, exact: true }, previous: null };
      p.tiles.k5 = { id: 'k5_our_revenue', status: 'neutral', headline: 'Net of refunds and disputes', value: null, previous: null, money: { kind: 'one', currency: 'USD', net: 89 } };
      return p;
    },
    tiles: [
      { id: 'k1_ai_cost', status: 'not_measured', has: [LABEL_K1, 'USD 12.50'] },
      { id: 'k2_far_over_allowance', status: 'amber', has: [LABEL_K2, 'At least 1', 'Needs a look'] },
      { id: 'k3_founding_no_end_date', status: 'amber', has: [LABEL_K3, '8', 'Needs a look'] },
      { id: 'k4_gifted_outstanding', status: 'neutral', has: [LABEL_K4, '0'], hasNot: ['$', 'USD'] },
      { id: 'k5_our_revenue', status: 'neutral', has: [LABEL_K5, 'USD 89.00'] },
    ],
  },
];

describe('Finance F-5 Pin B: every tile value and status equal the values before F-5', () => {
  it('pins five fixtures and every tile at least once', () => {
    expect(FIXTURES).toHaveLength(5);
    const ids = new Set(FIXTURES.flatMap((f) => f.tiles.map((t) => t.id)));
    expect([...ids].sort()).toEqual(['k1_ai_cost', 'k2_far_over_allowance', 'k3_founding_no_end_date', 'k4_gifted_outstanding', 'k5_our_revenue']);
  });

  it.each(FIXTURES.map((f) => [f.name, f] as const))('%s', async (_name, fixture) => {
    mockSearch = fixture.search;
    serve({ success: true, data: fixture.build() });
    render(<FinanceView />);
    await screen.findByTestId(`tile-${fixture.tiles[0].id}`, {}, WAIT);
    for (const expected of fixture.tiles) {
      const tile = screen.getByTestId(`tile-${expected.id}`);
      expect({ id: expected.id, status: tile.getAttribute('data-status') }).toEqual({ id: expected.id, status: expected.status });
      const text = tile.textContent ?? '';
      for (const fragment of expected.has) expect({ id: expected.id, fragment, found: text.includes(fragment) }).toEqual({ id: expected.id, fragment, found: true });
      for (const fragment of expected.hasNot ?? []) expect({ id: expected.id, fragment, found: text.includes(fragment) }).toEqual({ id: expected.id, fragment, found: false });
    }
    // Exactly five tiles, each once.
    expect(document.querySelectorAll('[data-testid^="tile-k"][data-status]')).toHaveLength(5);
  }, CASE_TIMEOUT_MS);
});
