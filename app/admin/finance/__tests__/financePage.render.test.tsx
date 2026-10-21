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
 * and K-5's "$89.00" with its new caption (AC-120 to AC-126, AC-129).
 */

import '@testing-library/jest-dom';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

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
// Money MK-5: a separate import.
import { FINANCE_KPIS as FINANCE_KPIS_MK5 } from '../financeCopy';
// Money MK-4: a separate import.
import { REVENUE_RECURRING_HEADING, REVENUE_RECURRING_NONE, REVENUE_RECURRING_TEST_KEY_LABEL, REVENUE_RECURRING_UNKNOWN } from '../financeCopy';
import type { FinanceMrrSection } from '@/lib/business-os/finance/financeTypes';
import type { SubscriptionsPayload } from '@/lib/admin/billing/subscriptionsTypes';
// Money MK-5b: a separate import, so the lists above stay unedited.
import type { FinanceConverted, FinanceConvertedRow } from '@/lib/business-os/finance/financeTypes';
import {
  CONVERTED_EMPTY,
  CONVERTED_PARTIAL,
  CONVERTED_SOURCE_MISSING,
  CONVERTED_SOURCE_UNKNOWN,
  CONVERTED_STATUS,
  KPI_CONVERTED_ONE,
  KPI_CONVERTED_UNKNOWN,
} from '../financeCopy';
import { MODE_BADGE, TEST_KEY_NOTE } from '../plansCopy';
// Money MK-1: a separate import, so the lists above stay unedited.
import {
  BLOCK_KPI_CLIENT_PAYMENTS_DEFINITION,
  BLOCK_KPI_CLIENT_PAYMENTS_LABEL,
  BLOCK_KPI_FAR_OVER_CHIP,
  BLOCK_KPI_OVER_ALLOWANCE_DEFINITION,
  BLOCK_KPI_OVER_ALLOWANCE_LABEL,
} from '../financeCopy';
import { KPI_INDICATOR_WORDS } from '@/app/admin/components/layout/KpiStrip';
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
// Finance F-2: a separate import, so the lists above stay unedited.
import { PAGE_PURPOSE, PAGE_TITLE, RETRY } from '../financeCopy';
// Finance F-4: the URL notice is gone (BD-30, SA-W1); the request literals are AC-173's.
import { pinnedRequest } from './financeRequestPins';
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
  PAYMENT_PROBLEMS_TITLE,
  REMINDERS_FAILED,
  REMINDERS_NOT_NARROWED,
} from '../financeCopy';

/**
 * Finance F-5 (AC-179, SA-W1): the shared tile's status words (standard K-4).
 * A neutral tile has no status row, so no word and no icon.
 */
const STATE_WORD: Record<string, string | null> = {
  red: 'Needs action',
  amber: 'Needs a look',
  green: 'Healthy',
  not_measured: 'Not measured yet',
  unavailable: 'Could not check',
  neutral: null,
};
function expectTileState(id: string): void {
  const tile = screen.getByTestId(`tile-${id}`);
  const word = STATE_WORD[tile.getAttribute('data-status') ?? ''];
  expect(word).not.toBeUndefined();
  if (word) {
    expect(tile).toHaveTextContent(word);
    expect(tile.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
  } else {
    expect(tile.querySelector('svg')).toBeNull();
    expect(tile.textContent).not.toContain('For information');
  }
}

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

/** Slice 5a: the owner's October plan payment, all businesses ($79.00, one business, by business). */
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

/** One currency line, the owner's test purchase by default ($10.00, 5,000 credits). */
function boostLine(extra: Partial<FinanceBoostLine> = {}): FinanceBoostLine {
  return {
    currency: 'USD', purchases: 1, gross: 10, tax: 0, refunded: 0, lost: 0, net: 10, creditsSold: 5000,
    unreadable: 0, unreadableEvents: 0, unreadableCredits: 0, ...extra,
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
  // Finance F-4: the shared hook writes the address bar with history.replaceState.
  window.history.replaceState(null, '', '/admin/finance');
});

/**
 * F-1: every section's own status is now the shared StatusChip (so it carries
 * data-tone). "No chip in this section" means no chip OTHER than that one.
 */
// Money MK-5 (ruled): K-3's chip on Plan mix is its rule (not a frame chip), so it is left out like the status.
const NO_CHIP_BUT_STATUS = (id: string) => `[data-tone]:not([data-testid="section-${id}-status"]):not([data-testid="accounts-k3-chip"])`;

describe('the finance page', () => {
  it('shows the title, the three tiles with their text state, and the sections in order', async () => {
    serve({ success: true, data: payload() });
    render(<FinanceView />);
    await screen.findByTestId('kpi-strip');
    // Finance F-2: the h1 equals the sidebar label.
    expect(screen.getByRole('heading', { level: 1, name: 'Finance' })).toBeInTheDocument();
    // Money MK-5 (ruled): the five F-K tiles; K-3's headline is on Plan mix now, beside its chip.
    for (const id of ['fk1_revenue', 'fk2_mrr', 'fk3_ai_cost', 'fk4_ai_margin', 'fk5_paying']) expectTileState(id);
    expect(screen.getByText(TILE_LABELS.k1Sub)).toBeInTheDocument();
    expect(screen.getByTestId('accounts-k3')).toHaveTextContent('Founding Partners with no end date');
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
    expect(await screen.findByTestId('ai-total')).toHaveTextContent('$3.50');
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
    const k5 = screen.getByTestId('tile-fk1_revenue');
    expect(k5.textContent).not.toMatch(/\$|USD|0\.00/);
    expect(k5.lastElementChild).toHaveTextContent('No data yet');
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
    expect(section.querySelector(NO_CHIP_BUT_STATUS('accounts'))).toBeNull();
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
    expect(section.querySelector(NO_CHIP_BUT_STATUS('accounts'))).toBeNull();
    expect(section.textContent).not.toMatch(/including \d+ Founding Partner/);
  });

  it('AC-27: a failed section says so with a Try again; the others still render; Try again refetches', async () => {
    const fetchMock = serve({
      success: true,
      data: payload({ accounts: { status: 'unknown', scope: 'all', figures: null } }),
    });
    render(<FinanceView />);
    const section = await screen.findByTestId('section-accounts');
    expect(within(section).getAllByText(SECTION_COULD_NOT_LOAD).length).toBeGreaterThan(0);
    expect(screen.getByTestId('ai-total')).toBeInTheDocument();
    fireEvent.click(within(section).getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  });

  it('F-1: the section status is the shared chip: OK neutral, partial warn with an icon, could-not-load unknown with an icon', async () => {
    const p = payload({ accounts: { status: 'unknown', scope: 'all', figures: null } });
    p.aiCost = { ...p.aiCost, status: 'partial', figures: { ...p.aiCost.figures!, exact: false } };
    serve({ success: true, data: p });
    render(<FinanceView />);
    await screen.findByTestId('ai-total');
    const ok = screen.getByTestId('section-credits-status');
    expect(ok).toHaveAttribute('data-tone', 'neutral');
    expect(ok.querySelector('svg')).toBeNull();
    const partial = screen.getByTestId('section-ai-cost-status');
    expect(partial).toHaveAttribute('data-tone', 'warn');
    expect(partial.querySelector('svg[aria-hidden="true"]')).not.toBeNull();
    const unknown = screen.getByTestId('section-accounts-status');
    expect(unknown).toHaveAttribute('data-tone', 'unknown');
    expect(unknown).toHaveTextContent(SECTION_COULD_NOT_LOAD);
    expect(unknown.querySelector('svg[aria-hidden="true"]')).not.toBeNull();
  });

  it('F-1: the slice-1a tables use the shared admin table: number columns right-aligned and tabular, every other column not', async () => {
    serve({ success: true, data: payload() });
    render(<FinanceView />);
    await screen.findByTestId('ai-total');
    // Literals, not the copy constants, so a renamed header cannot silently shrink the pin.
    const NUMBER_COLUMNS: Record<string, string[]> = {
      'accounts-groups': ['Accounts', 'In grace', 'Past due'],
      'ai-top': ['Cost (USD)', 'Credits charged'],
      'credits-table': ['Allowance', 'Used', '% used', 'Gifted outstanding'],
    };
    for (const [id, expected] of Object.entries(NUMBER_COLUMNS)) {
      const table = screen.getByTestId(id);
      expect(table.parentElement).toHaveClass('overflow-x-auto', 'rounded-xl');
      const headers = Array.from(table.querySelectorAll('thead th'));
      const numeric = headers.map((th) => th.classList.contains('text-right'));
      expect(headers.filter((_, i) => numeric[i]).map((th) => th.textContent)).toEqual(expected);
      const rows = Array.from(table.querySelectorAll('tbody tr'));
      expect(rows.length).toBeGreaterThan(0);
      for (const row of rows) {
        let column = 0;
        for (const cell of Array.from(row.children) as HTMLTableCellElement[]) {
          // A spanning cell holds words ("No allowance"), so it is left-aligned whatever it spans.
          if (cell.colSpan === 1) expect([id, column, cell.classList.contains('tabular-nums')]).toEqual([id, column, numeric[column]]);
          else expect(cell.classList.contains('tabular-nums')).toBe(false);
          column += cell.colSpan;
        }
      }
    }
  });

  it('AC-15: a partial read says "At least USD"', async () => {
    const p = payload();
    p.aiCost = { ...p.aiCost, status: 'partial', figures: { ...p.aiCost.figures!, exact: false } };
    serve({ success: true, data: p });
    render(<FinanceView />);
    expect(await screen.findByTestId('ai-total')).toHaveTextContent('At least $3.50');
  });

  it('AC-7: an empty window says "No AI actions charged in this window" and $0.00', async () => {
    const p = payload();
    p.aiCost = {
      ...p.aiCost,
      figures: { ...p.aiCost.figures!, costUsd: 0, credits: 0, chargedActions: 0, rows: 0, topAccounts: [] },
    };
    serve({ success: true, data: p });
    render(<FinanceView />);
    expect(await screen.findByTestId('ai-no-rows')).toHaveTextContent(AI_NO_ROWS);
    expect(screen.getByTestId('ai-total')).toHaveTextContent('$0.00');
  });

  it('AC-40: a window entirely before the cut-over shows the notice instead of a $0', async () => {
    const p = payload();
    p.aiCost = { ...p.aiCost, coverage: 'entirely_before_cutover' };
    serve({ success: true, data: p });
    render(<FinanceView />);
    expect(await screen.findByTestId('activity-cutover-entirely')).toBeInTheDocument();
    expect(screen.queryByTestId('ai-total')).not.toBeInTheDocument();
  });

  it('a route error (e.g. 404) shows the server message with a Try again', async () => {
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
    // Money MK-5 (ruled): the five F-K tiles; K-2 and K-4 live in Credits now.
    for (const id of ['fk1_revenue', 'fk2_mrr', 'fk3_ai_cost', 'fk4_ai_margin', 'fk5_paying']) expectTileState(id);
    // K-2: the line still comes from the payload (120 here), on the Credits chip (MK-1).
    expect(screen.getByTestId('credits-over-chip')).toHaveTextContent('at or over 120% of allowance');
    expect(k2Subtitle(120)).toContain('120%');
    // K-4: the gifted figure on Credits.
    expect(screen.getByTestId('credits-gifted')).toHaveTextContent('12.5');
    for (const gone of ['k2_far_over_allowance', 'k3_founding_no_end_date', 'k4_gifted_outstanding']) {
      expect(screen.queryByTestId(`tile-${gone}`)).toBeNull();
    }
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
    // MK-5: K-4 is the Credits gifted figure now.
    expect(screen.getByTestId('credits-gifted').textContent).not.toMatch(/\$|USD/);
  });

  it('AC-8 (MK-5: K-4 is the Credits gifted figure): no gifted credits → 0, never money', async () => {
    const base = creditsSection();
    serve({ success: true, data: payload({ credits: { ...base, gifted: { ...base.gifted!, outstanding: 0 } } }) });
    render(<FinanceView />);
    const gifted = await screen.findByTestId('credits-gifted');
    expect(gifted).toHaveTextContent('0');
    expect(gifted.textContent).not.toMatch(/\$|USD/);
    expect(screen.queryByTestId('tile-k4_gifted_outstanding')).toBeNull();
  });

  it('AC-16: Section 4 could not load → its own Try again, the other sections and the strip render (MK-5: K-2 and K-4 left the strip)', async () => {
    const p = payload({ credits: creditsSection({ status: 'unknown', figures: null }) });
    p.tiles.k2 = { ...p.tiles.k2, status: 'unavailable', headline: 'Unknown', value: null };
    serve({ success: true, data: p });
    render(<FinanceView />);
    const section = await screen.findByTestId('section-credits');
    expect(within(section).getAllByText(SECTION_COULD_NOT_LOAD).length).toBeGreaterThan(0);
    expect(within(section).getByRole('button', { name: 'Try again' })).toBeInTheDocument();
    expect(screen.getByTestId('ai-total')).toBeInTheDocument();
    expect(screen.getByTestId('kpi-strip')).toBeInTheDocument();
    expect(screen.queryByTestId('tile-k2_far_over_allowance')).toBeNull();
    expect(screen.queryByTestId('tile-k4_gifted_outstanding')).toBeNull();
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

describe('the URL is the state (AC-24; Finance F-4: the shared hook, AC-175)', () => {
  it('fetches with the parsed query; an invalid window falls back to This month silently (no notice)', async () => {
    mockSearch = 'preset=year';
    const fetchMock = serve({ success: true, data: payload() });
    render(<FinanceView />);
    await screen.findByTestId('kpi-strip');
    expect(screen.queryByTestId('finance-url-notice')).toBeNull();
    expect(fetchMock).toHaveBeenCalledWith('/api/admin/business-os/finance?preset=this_month', expect.objectContaining({ cache: 'no-store' }));
  });

  it('a preset click sends the 7 days request and writes range with history.replaceState(null), never the router', async () => {
    mockSearch = `preset=this_month&accountId=${A}`;
    window.history.replaceState(null, '', `/admin/finance?${mockSearch}`);
    const fetchMock = serve({ success: true, data: payload({ accountId: A }) });
    render(<FinanceView />);
    await screen.findByTestId('kpi-strip');
    const replaceSpy = jest.spyOn(window.history, 'replaceState');
    fireEvent.click(screen.getByRole('button', { name: '7 days' }));
    expect(fetchMock).toHaveBeenLastCalledWith(`/api/admin/business-os/finance?preset=7d&accountId=${A}`, expect.objectContaining({ cache: 'no-store' }));
    expect(replaceSpy).toHaveBeenCalledWith(null, '', `/admin/finance?range=7d&account=${A}`);
    expect(mockReplace).not.toHaveBeenCalled();
    replaceSpy.mockRestore();
    await screen.findByTestId('kpi-strip');
  });
});

describe('Section 2 block B, takings (slice 2a)', () => {
  const renderWith = async (takings: FinanceTakingsSection) => {
    serve({ success: true, data: payload({ takings }) });
    render(<FinanceView />);
    return screen.findByTestId('section-takings');
  };
  const figures = () => takingsSection().figures!;

  // Money MK-1 (ruled edit): renamed "Client payments (the businesses' money, not ours)" and moved from under
  // "Our revenue" to the very bottom of the Overview, after the payment problems; the chip stays.
  // Money MK-6 (UI short path): the Payment problems section is gone; the client problems are inside this block.
  it('sits last on the Overview, after Credits, with its title, subtitle and the "Not our revenue" chip', async () => {
    const section = await renderWith(takingsSection());
    expect(within(section).getByRole('heading', { name: TAKINGS_TITLE })).toBeInTheDocument();
    expect(TAKINGS_TITLE).toBe("Client payments (the businesses' money, not ours)");
    expect(section).toHaveTextContent('Covers businesses that still exist');
    expect(section).toHaveTextContent('UTC');
    const order = ['section-revenue', 'section-accounts', 'section-credits', 'section-takings'].map((id) =>
      screen.getByTestId(id)
    );
    for (let i = 1; i < order.length; i += 1) {
      expect(order[i - 1].compareDocumentPosition(order[i]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
    expect(section.parentElement?.lastElementChild).toBe(section);
    expect(screen.getByTestId('section-takings-badge')).toHaveTextContent(TAKINGS_CHIP);
  });

  it.each([['ok'], ['partial'], ['unknown']] as const)('SA-WR-17: the chip shows in the %s state', async (status) => {
    const base = takingsSection();
    await renderWith({ ...base, status, figures: status === 'unknown' ? null : base.figures });
    const chip = screen.getByTestId('section-takings-badge');
    expect(chip).toHaveTextContent(TAKINGS_CHIP);
    expect(chip).toHaveAttribute('data-tone', 'neutral');
  });

  // Money MK-1 (ruled edit): Credits now carries ONE chip, K-2's far-over count on its block KPI (§3.2), amber;
  // still no "not ours" frame badge on Accounts, AI cost or Credits.
  it('SA-WR-17: the Accounts, AI cost and Credits sections render no frame chip; Credits only its far-over chip', async () => {
    await renderWith(takingsSection());
    for (const id of ['accounts', 'ai-cost', 'credits']) {
      expect(screen.queryByTestId(`section-${id}-badge`)).not.toBeInTheDocument();
      const chips = Array.from(screen.getByTestId(`section-${id}`).querySelectorAll(NO_CHIP_BUT_STATUS(id)));
      if (id === 'credits') {
        expect(chips.map((chip) => [chip.getAttribute('data-testid'), chip.getAttribute('data-tone')])).toEqual([['credits-over-chip', 'warn']]);
      } else {
        expect(chips).toEqual([]);
      }
    }
  });

  it('AC-48: every money cell names its currency; nothing adds two currencies', async () => {
    const section = await renderWith(takingsSection());
    const cells = section.querySelectorAll('[data-money]');
    expect(cells.length).toBeGreaterThanOrEqual(12);
    for (const cell of Array.from(cells)) expect(cell.textContent).toMatch(/^(At least )?(-?\$[\d,]+\.\d\d|(ILS|EUR|Unknown currency) -?[\d,]+\.\d\d)$/);
    expect(within(screen.getByTestId('takings-line-ILS')).getByText('ILS 230.30')).toBeInTheDocument();
    expect(within(screen.getByTestId('takings-line-USD')).getByText('$150.50')).toBeInTheDocument();
    // No cross-currency total anywhere in the block (gross 380.80, net 345.80, refunded 35.00).
    expect(section.textContent).not.toMatch(/380\.80|345\.80|35\.00/);
  });

  it('AC-49: fees on their FEE currency line, with "recorded on N of M" and the never-deducted note', async () => {
    const section = await renderWith(takingsSection());
    expect(within(screen.getByTestId('takings-fee-USD')).getByText('$5.85')).toBeInTheDocument();
    expect(screen.getByTestId('takings-fees-recorded')).toHaveTextContent('Fees recorded on 3 of 6 payments in this window');
    expect(section).toHaveTextContent(TAKINGS_FEE_NOTE);
    // Net is the server's gross minus refunded, untouched by any fee.
    expect(within(screen.getByTestId('takings-line-USD')).getByText('$130.50')).toBeInTheDocument();
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
    expect(usd).toHaveTextContent('At least $150.50');
    expect(usd).toHaveTextContent('At least 2');
    expect(within(usd).getByText(TAKINGS_NET_CUT_OFF)).toBeInTheDocument();
    expect(screen.getByTestId('takings-notice-payments-cut')).toBeInTheDocument();
    expect(screen.getByTestId('section-takings')).toHaveAttribute('data-status', 'partial');
  });

  it('AC-51: refunds cut off → refunded "At least", net cut off, its own notice', async () => {
    const f = figures();
    await renderWith({ ...takingsSection(), status: 'partial', figures: { ...f, refundsState: 'partial', lines: f.lines.map((l) => ({ ...l, net: null })) } });
    const usd = screen.getByTestId('takings-line-USD');
    expect(usd).toHaveTextContent('At least $20.00');
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
    // Money MK-6: the client problems block (its own figures, in their currencies) now sits in this section; leave it out.
    const takingsOnly = section.cloneNode(true) as HTMLElement;
    takingsOnly.querySelector('[data-testid="problems-clients"]')?.remove();
    expect(takingsOnly.textContent).not.toMatch(/0\.00|USD|ILS/);
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

  it('AC-66: the block could not load → its own Try again; every other section and tile renders', async () => {
    const section = await renderWith({ status: 'unknown', scope: 'all', figures: null });
    expect(within(section).getAllByText(SECTION_COULD_NOT_LOAD).length).toBeGreaterThan(0);
    expect(within(section).getByRole('button', { name: 'Try again' })).toBeInTheDocument();
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
    expect(usd).toHaveTextContent('$150.50');
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
    expect(within(usd).getByText('At least $150.50')).toBeInTheDocument();
    expect(within(usd).getByText('Unknown')).toBeInTheDocument();
    expect(within(usd).queryByText(TAKINGS_NET_CUT_OFF)).not.toBeInTheDocument();
    expect(within(screen.getByTestId('takings-line-ILS')).getByText('ILS 230.30')).toBeInTheDocument();
    const row = screen.getByTestId(`takings-row-${A}-USD`);
    expect(within(row).getByText('At least $150.00')).toBeInTheDocument();
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
    expect(within(usd).getByText('$150.50')).toBeInTheDocument();
    expect(usd).not.toHaveTextContent('At least $150.50');
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
    // Money MK-6: the client problems block, now inside Client payments (no section of its own).
    return screen.findByTestId('problems-clients');
  };
  const base = () => paymentProblemsSection();

  // Money MK-6 (§6 item 15, BD-38; UI short path): the block moved into Client payments, its last part.
  it('L-32 / MK-6: inside Client payments, after its takings; its title, chip, "As of now, UTC" subtitle and five parts, four with a status in words', async () => {
    const section = await renderWith(base());
    // MK-6: no "Payment problems" frame any more; block B keeps its own heading and neutral chip (SA-CR-4b2 CR-1).
    expect(screen.queryByTestId('section-payment-problems')).toBeNull();
    expect(screen.queryByRole('heading', { name: PAYMENT_PROBLEMS_TITLE })).toBeNull();
    const clients = section;
    expect(within(clients).getByRole('heading', { name: PROBLEMS_TITLE })).toBeInTheDocument();
    expect(within(clients).getByTestId('problems-clients-chip')).toHaveTextContent(PROBLEMS_CHIP);
    expect(within(clients).getByTestId('problems-clients-chip')).toHaveAttribute('data-tone', 'neutral');
    expect(section).toHaveTextContent('As of now, UTC (2026-10-09)');
    expect(section).toHaveTextContent('Covers businesses that still exist');
    const takings = screen.getByTestId('section-takings');
    expect(takings.contains(section)).toBe(true);
    expect(screen.getByTestId('takings-body').compareDocumentPosition(section) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // The "Not our revenue" badge (BD-1) stays on the block that hosts it.
    expect(screen.getByTestId('section-takings-badge')).toHaveTextContent(TAKINGS_CHIP);
    expect(takings.parentElement?.lastElementChild).toBe(takings);
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
    for (const cell of Array.from(cells)) expect(cell.textContent).toMatch(/^(At least )?(-?\$[\d,]+\.\d\d|(ILS|EUR|Unknown currency) -?[\d,]+\.\d\d)$/);
    expect(within(screen.getByTestId('problems-invoices-line-USD')).getByText('$1,234.50')).toBeInTheDocument();
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
    // MK-6: no frame to carry "partial"; each part keeps its own chip, and the block still renders.
    expect(screen.queryByTestId('section-payment-problems')).toBeNull();
    expect(screen.getByTestId('problems-clients')).toBeInTheDocument();
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
    expect(screen.getByTestId('problems-invoices-line-USD')).toHaveTextContent('At least $1,234.50');
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
    expect(screen.getByTestId('problems-invoices-line-USD')).toHaveTextContent('At least $1,234.50');
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
    expect(first.querySelector('[data-money="received"]')).toHaveTextContent('$79.00');
    expect(first.querySelector('[data-money="tax"]')).toHaveTextContent('$0.00');
    const second = within(panel).getByTestId('revenue-plans-payment-e0');
    expect(second).toHaveTextContent(REVENUE_PLANS_UNKNOWN_PLAN);
    expect(second).toHaveTextContent(`${REVENUE_PLANS_PERIOD_NOT_RECORDED} to ${REVENUE_PLANS_PERIOD_NOT_RECORDED}`);
    expect(second.textContent).not.toContain('—');
    // Newest first, as sent.
    expect(first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // K-5 and the summary read the same total (SA-Q40).
    expect(screen.getByTestId('tile-fk1_revenue')).toHaveTextContent('$89.00');
    expect(screen.getByTestId('account-summary-total-USD')).toHaveTextContent('$89.00');
    expect(screen.getByTestId('account-summary-plan-USD')).toHaveTextContent('$79.00');
  });

  it('AC-120 / AC-124: all businesses → the per-currency line (Received header, "$79.00"), the by-business table, the deleted line in words', async () => {
    const plans = paidPlans({ deletedAccounts: [{ currency: 'USD', payments: 1, received: 49, exact: true }] });
    serve({ success: true, data: payload({ revenue: revenueSection({ state: 'recorded', plans }) }) });
    render(<FinanceView />);
    const panel = await screen.findByTestId('section-revenue');
    const line = within(panel).getByTestId('revenue-plans-line-USD');
    expect(line.querySelector('[data-money="received"]')).toHaveTextContent('$79.00');
    expect(line.querySelector('[data-money="tax"]')).toHaveTextContent('$0.00');
    expect(within(panel).getByRole('columnheader', { name: REVENUE_PLANS_RECEIVED })).toBeInTheDocument();
    expect(within(panel).getByTestId(`revenue-plans-account-${A}`)).toHaveTextContent('Acme Dental');
    expect(within(panel).getByTestId(`revenue-plans-account-${A}`)).toHaveTextContent('$79.00');
    expect(within(panel).getByTestId('revenue-plans-deleted-USD')).toHaveTextContent(revenuePlansDeletedLine(1, '$49.00'));
    expect(within(panel).getByTestId('revenue-plans-refunds-note')).toHaveTextContent(REVENUE_PLANS_REFUNDS_NOTE);
    for (const cell of within(panel).getByTestId('revenue-plans').querySelectorAll('[data-money]')) expect(cell.textContent).toMatch(/^(At least )?\$/);
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
    expect(line.querySelector('[data-money="received"]')).toHaveTextContent('At least $79.00');
    expect(line).toHaveTextContent('excludes 1 unreadable');
    expect(screen.getByTestId('revenue-plans-notice-cut')).toHaveTextContent(REVENUE_PLANS_NOTICE_CUT);
    expect(screen.getByTestId('revenue-plans-notice-unreadable')).toHaveTextContent(REVENUE_PLANS_NOTICE_UNREADABLE(1));
    expect(screen.getByTestId('tile-fk1_revenue')).toHaveTextContent('Unknown');
  });

  it('AC-90 / AC-95: the owner purchase → "$10.00" in the line and on K-5, with the caption; K-5 grey, never green', async () => {
    serve({ success: true, data: k5With(payload({ revenue: { ...paidRevenue([boostLine()]), totals: [{ currency: 'USD', boostsNet: 10, plansReceived: 0, total: 10 }] } }), { kind: 'one', currency: 'USD', net: 10 }) });
    render(<FinanceView />);
    const panel = await screen.findByTestId('section-revenue');
    const line = within(panel).getByTestId('revenue-line-USD');
    for (const cell of ['gross', 'net']) expect(line.querySelector(`[data-money="${cell}"]`)).toHaveTextContent('$10.00');
    expect(line.querySelector('[data-money="tax"]')).toHaveTextContent('$0.00');
    expect(line).toHaveTextContent('5,000');
    expect(within(panel).getByRole('columnheader', { name: REVENUE_NET })).toBeInTheDocument();
    expect(within(panel).getByTestId('revenue-package-pkg-small v1')).toHaveTextContent('$10.00');
    const k5 = screen.getByTestId('tile-fk1_revenue');
    expect(k5).toHaveTextContent('$10.00');
    // MK-5 (ruled): F-K1's caption.
    expect(k5).toHaveTextContent(FINANCE_KPIS_MK5.revenue.sub(WINDOW_LABEL));
    expect(FINANCE_KPIS_MK5.revenue.sub(WINDOW_LABEL)).toContain('Plans and credit boosts');
    expect(k5.getAttribute('data-status')).toBe('neutral');
    expect(k5.className).not.toContain('emerald');
    // Every money cell names its currency.
    // MK-5a: a US-dollar cell is "$…"; any other names its code.
    for (const cell of panel.querySelectorAll('[data-money]')) expect(cell.textContent).toMatch(/\$|USD|Unknown/);
  });

  it('AC-90: 1999 minor units arrive as 19.99 and print "$19.99"', async () => {
    serve({ success: true, data: payload({ revenue: paidRevenue([boostLine({ gross: 19.99, net: 19.99 })]) }) });
    render(<FinanceView />);
    expect(within(await screen.findByTestId('revenue-line-USD')).getAllByText('$19.99').length).toBeGreaterThan(0);
  });

  it('AC-90: an unreadable purchase → "excludes 1 unreadable", gross "At least", net "Unknown", a notice', async () => {
    const revenue = paidRevenue([boostLine({ purchases: 2, unreadable: 1, net: null })], { unreadablePurchases: 1 }, { status: 'partial' });
    revenue.boosts.status = 'partial';
    serve({ success: true, data: k5With(payload({ revenue }), { kind: 'unknown', reason: 'unreadable' }) });
    render(<FinanceView />);
    const line = await screen.findByTestId('revenue-line-USD');
    expect(line).toHaveTextContent('excludes 1 unreadable');
    expect(line.querySelector('[data-money="gross"]')).toHaveTextContent('At least $10.00');
    expect(line.querySelector('[data-money="net"]')).toHaveTextContent(/^Unknown$/);
    expect(screen.getByTestId('revenue-notice-unreadable')).toHaveTextContent(REVENUE_NOTICE_UNREADABLE(1));
    expect(screen.getByTestId('tile-fk1_revenue')).toHaveTextContent('Unknown');
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
    serve({
      success: true,
      data: k5With(
        payload({ revenue: { ...paidRevenue(lines), totals: [{ currency: 'EUR', boostsNet: 7, plansReceived: 0, total: 7 }, { currency: 'USD', boostsNet: 10, plansReceived: 0, total: 10 }] } }),
        { kind: 'several', currencies: 2 }
      ),
    });
    render(<FinanceView />);
    const panel = await screen.findByTestId('section-revenue');
    expect(within(panel).getByTestId('revenue-line-EUR')).toHaveTextContent('EUR 7.00');
    expect(within(panel).getByTestId('revenue-line-USD')).toHaveTextContent('$10.00');
    // MK-5 (ruled, USD-3 / USD-5): F-K1 shows the US-dollar line only, and the other currency as a count.
    expect(screen.getByTestId('tile-fk1_revenue')).toHaveTextContent('$10.00');
    expect(screen.getByTestId('tile-fk1_revenue')).toHaveTextContent('plus 1 payment in other currencies, not converted');
    expect(screen.getByTestId('tile-fk1_revenue').textContent).not.toMatch(/EUR|7\.00/);
    expect(k5SeveralCurrencies(2)).toBe('2 currencies, see Our revenue');
    // 7 + 10 printed anywhere would be a cross-currency total.
    expect(document.body.textContent).not.toMatch(/17\.00/);
  });

  it('AC-93: the ceiling → "At least" on counts and amounts (refunded and lost included, 4b.2), "Unknown (a read was cut off)" on net, the notice; K-5 "Unknown"', async () => {
    const revenue = paidRevenue([boostLine({ net: null })], { exact: false }, { status: 'partial' });
    revenue.boosts.status = 'partial';
    revenue.boosts.packages = revenue.boosts.packages!.map((p) => ({ ...p, net: null }));
    serve({ success: true, data: k5With(payload({ revenue }), { kind: 'unknown', reason: 'cut_off' }) });
    render(<FinanceView />);
    const line = await screen.findByTestId('revenue-line-USD');
    for (const cell of ['gross', 'tax', 'refunded', 'lost']) expect(line.querySelector(`[data-money="${cell}"]`)).toHaveTextContent(/^At least \$/);
    expect(line.querySelector('[data-money="held"]')).toBeNull();
    expect(line.querySelector('[data-money="net"]')).toHaveTextContent(REVENUE_CUT_OFF);
    expect(line).toHaveTextContent('At least 1');
    expect(line).toHaveTextContent('At least 5,000');
    expect(screen.getByTestId('revenue-notice-cut')).toHaveTextContent(REVENUE_NOTICE_CUT);
    expect(screen.getByTestId('section-revenue').getAttribute('data-status')).toBe('partial');
    const k5 = screen.getByTestId('tile-fk1_revenue');
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
    expect(await screen.findByTestId('revenue-deleted-USD')).toHaveTextContent(revenueDeletedLine(1, '$25.00'));
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
    expect(within(panel).getByTestId('revenue-plans-line-USD')).toHaveTextContent('$79.00');
    expect(screen.getByTestId('tile-fk1_revenue').getAttribute('data-status')).toBe('unavailable');
    expect(screen.getByTestId('tile-fk1_revenue')).toHaveTextContent('Unknown');
    expect(screen.getByTestId('section-takings')).toBeInTheDocument();
  });

  it('both reads failed → the section says it could not load, with Try again', async () => {
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
    ['cut off', paidRevenue([boostLine({ net: null })], { exact: false })],
    ['boosts failed', revenueSection({ status: 'partial', plans: paidPlans(), totals: null }, { status: 'unknown', lines: null, packages: null, deletedAccounts: null, notes: null })],
    ['plans failed', revenueSection({ status: 'partial', plans: PLANS_FAILED, totals: null })],
    ['both failed', revenueSection({ status: 'unknown', state: 'unknown', plans: PLANS_FAILED, totals: null }, { status: 'unknown', lines: null, packages: null, deletedAccounts: null, notes: null })],
  ] as const)('AC-81 (unchanged rule): in the %s state the section and K-5 name no mode and no webhook', async (_name, revenue) => {
    serve({ success: true, data: payload({ revenue }) });
    render(<FinanceView />);
    const panel = await screen.findByTestId('section-revenue');
    const text = `${panel.textContent} ${screen.getByTestId('tile-fk1_revenue').textContent}`;
    expect(text).not.toMatch(/webhook|not in place|test accounts only|live mode|test mode|livemode/i);
  });
});

describe('formatMoney (SA-WR-18): fixed two decimals, the code always shown', () => {
  it('0.10 + 0.20 summed in hundredths and divided once renders "$0.30"', () => {
    expect(formatMoney((10 + 20) / 100, 'USD')).toBe('$0.30');
  });

  it('12,345,678,901.23 renders exactly', () => {
    expect(formatMoney(1_234_567_890_123 / 100, 'USD')).toBe('$12,345,678,901.23');
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
    for (const id of ['section-revenue', 'section-takings', 'section-accounts', 'section-ai-cost', 'section-credits']) {
      expect(screen.getByTestId(id)).toBeInTheDocument();
    }
  });

  it('AC-109: after a pick the chip reads "Business: {picked name}", and the name never reaches the URL', async () => {
    serve({ success: true, data: payload() });
    render(<FinanceView />);
    await screen.findByTestId('kpi-strip');
    const replaceSpy = jest.spyOn(window.history, 'replaceState');
    const fetchMock = serve({ success: true, data: payload({ accountId: A }) });
    fireEvent.click(screen.getByTestId('picker-pick'));
    expect(replaceSpy).toHaveBeenCalledWith(null, '', `/admin/finance?account=${A}`);
    expect(fetchMock).toHaveBeenLastCalledWith(`/api/admin/business-os/finance?preset=this_month&accountId=${A}`, expect.objectContaining({ cache: 'no-store' }));
    for (const call of replaceSpy.mock.calls) expect(String(call[2])).not.toContain('Acme');
    for (const call of fetchMock.mock.calls) expect(String((call as unknown[])[0])).not.toContain('Acme');
    replaceSpy.mockRestore();
    await screen.findByTestId('account-header');
  });

  it('AC-109: the picked name shows in the chip and the header once the URL carries the account', async () => {
    serve({ success: true, data: payload() });
    const { rerender } = render(<FinanceView />);
    await screen.findByTestId('kpi-strip');
    // Finance F-4: the hook's state changes at once, so no new URL needs to reach the mock.
    const fetchMock = serve({ success: true, data: payload({ accountId: A }) });
    fireEvent.click(screen.getByTestId('picker-pick'));
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
    // Finance F-5 (BD-29): the KPI strip now sits above the filter bar, so above the account header.
    expect(header.compareDocumentPosition(screen.getByTestId('kpi-strip')) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy();
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
    const fetchMock = serve({ success: true, data: payload() });
    fireEvent.click(screen.getByRole('button', { name: 'Remove business' }));
    expect(window.location.pathname + window.location.search).toBe('/admin/finance');
    expect(fetchMock).toHaveBeenLastCalledWith('/api/admin/business-os/finance?preset=this_month', expect.objectContaining({ cache: 'no-store' }));
    await screen.findByTestId('kpi-strip');
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

// ── Slice 6a (Money M-3, AC-130, AC-145): the tabs around today's page ──────
// A separate import, so the lists above stay unedited.
import { TAB_ACCOUNTS, TAB_OVERVIEW } from '../financeCopy';

describe('slice 6a: the Overview and Accounts tabs (AC-130)', () => {
  it('no business picked → a tablist, Overview selected, today’s sections in its panel, no tab key in the request', async () => {
    const fetchMock = serve({ success: true, data: payload() });
    render(<FinanceView />);
    await screen.findByTestId('kpi-strip');
    const tablist = screen.getByRole('tablist');
    // Money MK-4 (ruled): the third tab, Plans & subscriptions; slice 2a: the fourth, Exchange rates.
    expect(within(tablist).getAllByRole('tab').map((t) => t.textContent)).toEqual([TAB_OVERVIEW, TAB_ACCOUNTS, 'Plans & subscriptions', 'Exchange rates']);
    expect(screen.getByRole('tab', { name: TAB_OVERVIEW })).toHaveAttribute('aria-selected', 'true');
    const panel = screen.getByRole('tabpanel');
    expect(panel).toHaveAttribute('id', 'finance-panel-overview');
    for (const id of ['section-revenue', 'section-takings', 'section-accounts', 'section-ai-cost', 'section-credits']) {
      expect(within(panel).getByTestId(id)).toBeInTheDocument();
    }
    // Finance F-5 (BD-29): the strip sits above the bar, outside the tab panel.
    expect(within(panel).queryByTestId('kpi-strip')).toBeNull();
    expect(screen.getByTestId('kpi-strip')).toBeInTheDocument();
    expect(String(fetchMock.mock.calls[0][0])).not.toMatch(/tab=|sort=|group=|show=/);
  });

  it('a business picked → no tablist and no tab panel; the one-account view as before', async () => {
    mockSearch = `accountId=${A}`;
    const p = payload({ accountId: A });
    serve({ success: true, data: p });
    render(<FinanceView />);
    await screen.findByTestId('account-summary');
    expect(screen.queryByRole('tablist')).toBeNull();
    expect(screen.queryByRole('tabpanel')).toBeNull();
    expect(screen.getByTestId('kpi-strip')).toBeInTheDocument();
  });

  it('clicking Accounts writes tab=accounts (history.replaceState) and sends the tab request', async () => {
    serve({ success: true, data: payload() });
    render(<FinanceView />);
    await screen.findByTestId('kpi-strip');
    const fetchMock = serve({ success: true, data: payload() });
    fireEvent.click(screen.getByRole('tab', { name: TAB_ACCOUNTS }));
    expect(window.location.pathname + window.location.search).toBe('/admin/finance?tab=accounts');
    expect(fetchMock).toHaveBeenLastCalledWith(pinnedRequest(11), expect.objectContaining({ cache: 'no-store' }));
    expect(mockReplace).not.toHaveBeenCalled();
    await screen.findByRole('tabpanel');
  });
});

// ── Money M-4 Part A (SA-W90 / E-59, SA-WR-46): Section 3's subtitle ─────────
// A separate import, so the lists above stay unedited.
import { AI_SOURCE, AI_TITLE } from '../financeCopy';

describe('Money M-4 Part A: Section 3 names its measure and puts the window first', () => {
  const WINDOW_LABEL = 'This month, 2026-10-01 to 2026-10-09 UTC';

  it('SA-WR-46: the subtitle is "<window label>. Credit ledger: …", with no ", <window label>" tail', async () => {
    serve({ success: true, data: payload() });
    render(<FinanceView />);
    const section = await screen.findByTestId('section-ai-cost');
    expect(within(section).getByRole('heading', { name: AI_TITLE })).toBeInTheDocument();
    expect(AI_TITLE).toBe('Charged AI cost in the window');
    const subtitle = within(section).getByText(
      (_, el) => el?.tagName === 'P' && (el.textContent ?? '').startsWith(`${WINDOW_LABEL}.`)
    );
    expect(subtitle.textContent).toBe(`${WINDOW_LABEL}. ${AI_SOURCE}`);
    expect(subtitle.textContent).toBe(
      `${WINDOW_LABEL}. Credit ledger: what Business OS actions were charged for, with corrections, from 29 Sep 2026. AI calls that were never charged are not in it.`
    );
    expect(subtitle.textContent).not.toContain(`, ${WINDOW_LABEL}`);
    expect(subtitle.textContent).not.toContain('., ');
  });
});

// ── Money M-4 Part B (OV-5, T9-B / T11-B on one render): the recorded block ──
// A separate import, so the lists above stay unedited.
import type { FinanceRecordedAiCost } from '@/lib/business-os/finance/financeTypes';
import { ACCOUNT_RECORDED_ABOVE, RECORDED_LABEL } from '../financeCopy';
import { cleanup } from '@testing-library/react';

describe('Money M-4 Part B: the recorded AI cost on the page', () => {
  const RECORDED: FinanceRecordedAiCost = {
    status: 'ok', recordedUsd: 4.25, recordedExact: true, aboveCharged: { state: 'figure', usd: 0.75 }, chargedAboveUsd: null,
  };
  const withRecorded = (recorded: FinanceRecordedAiCost | undefined, extra: Partial<FinancePayload> = {}) => {
    const p = payload(extra);
    p.aiCost = { ...p.aiCost, recorded };
    return p;
  };

  it('the Overview: the block inside Section 3, beside the unchanged charged total; no element shows their sum', async () => {
    serve({ success: true, data: withRecorded(RECORDED) });
    render(<FinanceView />);
    const section = await screen.findByTestId('section-ai-cost');
    const block = within(section).getByTestId('ai-recorded');
    expect(within(block).getByText(RECORDED_LABEL)).toBeInTheDocument();
    expect(within(block).getByTestId('ai-recorded-total')).toHaveTextContent('$4.25');
    expect(within(block).getByTestId('ai-recorded-above')).toHaveTextContent('$0.75');
    expect(within(section).getByTestId('ai-total')).toHaveTextContent('$3.50');
    expect(document.body.textContent).not.toContain('7.75');
  });

  it('AC-158: with a business picked, the summary line and Section 3 show the same text from the one field; the recorded figure is not repeated', async () => {
    for (const recorded of [
      RECORDED,
      { ...RECORDED, aboveCharged: { state: 'none' as const, usd: null }, chargedAboveUsd: 0.4 },
      { ...RECORDED, status: 'unknown' as const, recordedUsd: null, recordedExact: false, aboveCharged: { state: 'unknown' as const, usd: null } },
    ]) {
      cleanup();
      mockSearch = `preset=this_month&accountId=${A}`;
      serve({ success: true, data: withRecorded(recorded, { accountId: A }) });
      render(<FinanceView />);
      const summary = await screen.findByTestId('account-summary');
      const line = within(summary).getByTestId('account-summary-recorded-above');
      // The label sits in the line's <dt>, beside the value's <dd>.
      expect(line.parentElement?.querySelector('dt')).toHaveTextContent(ACCOUNT_RECORDED_ABOVE);
      expect(within(summary).getByTestId('account-summary-recorded-above-value').textContent).toBe(screen.getByTestId('ai-recorded-above').textContent);
      expect(within(summary).queryByText(RECORDED_LABEL)).toBeNull();
      expect(within(summary).queryByTestId('ai-recorded-total')).toBeNull();
    }
  });

  it('AC-167 (render half): a payload with no recorded key → no block and no summary line', async () => {
    mockSearch = `preset=this_month&accountId=${A}`;
    serve({ success: true, data: withRecorded(undefined, { accountId: A }) });
    render(<FinanceView />);
    await screen.findByTestId('account-summary');
    expect(screen.queryByTestId('ai-recorded')).toBeNull();
    expect(screen.queryByTestId('account-summary-recorded-above')).toBeNull();
  });
});

/**
 * Finance F-2 (Admin Layout Standard §5.3, §5.10): the shared header and the
 * shared states. Finance F-4 inverted the DV-1 pin on purpose: Refresh is now in
 * the shared filter bar ("Refresh the finance page"), not in the header.
 */
describe('Finance F-2: header and states', () => {
  /** A fetch that never answers until `release` is called with a body. */
  function pending(): { fetchMock: jest.Mock; release: (body: unknown, status?: number) => void } {
    let resolve: (value: unknown) => void = () => undefined;
    const fetchMock = jest.fn(
      () =>
        new Promise((res) => {
          resolve = res;
        })
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- jsdom has no fetch; standard test stub
    (global as any).fetch = fetchMock;
    return {
      fetchMock,
      release: (body, status = 200) => resolve({ ok: status < 400, status, json: async () => body }),
    };
  }

  it('the page has exactly one h1, "Finance" (the sidebar label), the purpose line, and the as-of line only once data is in', async () => {
    const { release } = pending();
    render(<FinanceView />);
    const h1s = screen.getAllByRole('heading', { level: 1 });
    expect(h1s).toHaveLength(1);
    expect(h1s[0].textContent).toBe('Finance');
    expect(PAGE_TITLE).toBe('Finance');
    expect(screen.getByText(PAGE_PURPOSE)).toBeInTheDocument();
    expect(screen.queryByTestId('as-of')).toBeNull();
    await act(async () => release({ success: true, data: payload() }));
    expect(await screen.findByTestId('as-of')).toHaveTextContent('This month, 2026-10-01 to 2026-10-09 UTC');
    expect(screen.getByTestId('as-of').className).toContain('text-slate-400');
  });

  it('F-4 (DV-1 ended, inverted on purpose): Refresh is in the filter bar, not the header; aria-busy while the first read runs', () => {
    pending();
    render(<FinanceView />);
    const refresh = screen.getByRole('button', { name: 'Refresh the finance page' });
    expect(refresh.closest('header')).toBeNull();
    expect(screen.getByRole('search', { name: 'Filters' })).toContainElement(refresh);
    expect(refresh).toHaveTextContent('Refresh');
    expect(refresh).toHaveAttribute('aria-busy', 'true');
    expect(refresh).toBeDisabled();
  });

  it('first load: "Reading the finance page…" in the content area, while the header and the filter bar stay mounted', () => {
    pending();
    render(<FinanceView />);
    const content = screen.getByTestId('finance-content');
    expect(within(content).getByRole('status')).toHaveTextContent('Reading the finance page…');
    expect(screen.getAllByRole('status')).toHaveLength(1);
    expect(content).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument();
    expect(screen.getByTestId('picker-pick')).toBeInTheDocument();
    expect(screen.queryByText('Loading…')).toBeNull();
  });

  it('error: the shared red alert, the message exactly, and "Try again" sends the same request again', async () => {
    const fetchMock = serve({ success: false, error: 'Business not found' }, 404);
    render(<FinanceView />);
    const message = await screen.findByTestId('finance-error');
    expect(message.textContent).toBe('Business not found');
    const alert = screen.getByRole('alert');
    expect(alert).toContainElement(message);
    expect(alert.className).toContain('border-red-500/40');
    expect(within(screen.getByTestId('finance-content')).getByRole('alert')).toBe(alert);
    expect(screen.queryByRole('status')).toBeNull();
    expect(within(alert).queryByRole('button', { name: 'Retry' })).toBeNull();
    fireEvent.click(within(alert).getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(fetchMock.mock.calls[1]).toEqual(fetchMock.mock.calls[0]);
  });

  it('a failure after a success clears the figures (today’s behaviour): no sections under the error', async () => {
    let call = 0;
    const fetchMock = jest.fn(async () => {
      call += 1;
      return call === 1
        ? { ok: true, status: 200, json: async () => ({ success: true, data: payload() }) }
        : { ok: false, status: 500, json: async () => ({ success: false, error: 'Boom' }) };
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- jsdom has no fetch; standard test stub
    (global as any).fetch = fetchMock;
    render(<FinanceView />);
    await screen.findByTestId('kpi-strip');
    fireEvent.click(screen.getByRole('button', { name: 'Refresh the finance page' }));
    expect(await screen.findByTestId('finance-error')).toHaveTextContent('Boom');
    expect(screen.queryByTestId('kpi-strip')).toBeNull();
    expect(screen.queryByTestId('section-revenue')).toBeNull();
    expect(screen.queryByTestId('as-of')).toBeNull();
  });

  it('a Refresh keeps the current figures and marks the content area aria-busy until the read settles', async () => {
    serve({ success: true, data: payload() });
    render(<FinanceView />);
    await screen.findByTestId('kpi-strip');
    const content = screen.getByTestId('finance-content');
    expect(content).toHaveAttribute('aria-busy', 'false');
    const { release } = pending();
    fireEvent.click(screen.getByRole('button', { name: 'Refresh the finance page' }));
    expect(content).toHaveAttribute('aria-busy', 'true');
    // Finance F-5 (BD-29): the strip is above the bar now; it and the sections stay during the refresh.
    expect(screen.getByTestId('kpi-strip')).toBeInTheDocument();
    expect(within(content).getByTestId('section-revenue')).toBeInTheDocument();
    expect(within(content).queryByText('Reading the finance page…')).toBeNull();
    await act(async () => release({ success: true, data: payload() }));
    await waitFor(() => expect(content).toHaveAttribute('aria-busy', 'false'));
    expect(screen.getByTestId('finance-content')).toBe(content);
  });

  it('Finance F-4 (AC-175, BD-30): a bad link shows no URL notice and no amber notice at all', async () => {
    mockSearch = `preset=year&accountId=acme`;
    serve({ success: true, data: payload() });
    render(<FinanceView />);
    await screen.findByTestId('kpi-strip');
    expect(screen.queryByTestId('finance-url-notice')).toBeNull();
    expect(screen.queryByText(/could not use/)).toBeNull();
    expect(screen.queryByText(/default view is shown/)).toBeNull();
    // A tile may be amber; nothing amber sits outside the content area (where the notice was) and the KPI strip (F-5, above the bar).
    const content = screen.getByTestId('finance-content');
    const strip = screen.getByTestId('kpi-strip');
    const amberOutside = Array.from(document.querySelectorAll('.border-amber-500\\/40')).filter((el) => !content.contains(el) && !strip.contains(el));
    expect(amberOutside).toEqual([]);
  });

  it('Finance F-4: "Read at HH:mm UTC" sits in the bar once the first read is in', async () => {
    const { release } = pending();
    render(<FinanceView />);
    expect(screen.queryByText(/Read at/)).toBeNull();
    await act(async () => release({ success: true, data: payload() }));
    const bar = await screen.findByRole('search', { name: 'Filters' });
    await waitFor(() => expect(within(bar).getByText(/^Read at /)).toHaveTextContent('Read at 10:00 UTC'));
  });

  it('Finance F-4 (SA-W8): the as-of line reads "7 days" for range=7d', async () => {
    mockSearch = 'range=7d';
    const p = payload();
    p.window = { ...p.window, preset: '7d', from: '2026-10-03', to: '2026-10-09' };
    serve({ success: true, data: p });
    render(<FinanceView />);
    expect(await screen.findByTestId('as-of')).toHaveTextContent('7 days, 2026-10-03 to 2026-10-09 UTC');
  });

  it('the Accounts tab waiting for its section says "Reading the accounts…"', async () => {
    mockSearch = 'tab=accounts';
    serve({ success: true, data: payload() });
    render(<FinanceView />);
    const panel = await screen.findByRole('tabpanel');
    expect(within(panel).getByRole('status')).toHaveTextContent('Reading the accounts…');
  });

  it('F2-R2: every retry button on the page reads "Try again" (page error and sections alike); none reads "Retry"', async () => {
    expect(RETRY).toBe('Try again');
    serve({
      success: true,
      data: payload({ accounts: { status: 'unknown', scope: 'all', figures: null }, credits: creditsSection({ status: 'unknown', figures: null }) }),
    });
    render(<FinanceView />);
    await screen.findByTestId('kpi-strip');
    const retries = screen.getAllByRole('button', { name: /try again|retry/i });
    expect(retries.length).toBeGreaterThanOrEqual(2);
    for (const button of retries) expect(button.textContent).toBe('Try again');
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
  });
});

// ── Finance F-5: the KPI tiles on the shared strip (AC-179, AC-180; BD-29, BD-31) ──
// A separate import, so the lists above stay unedited.
import { k1AnalyticsHref } from '../financeLinks';

describe('Finance F-5: KPI tiles above the filter bar, clickable to their sections', () => {
  const follows = (a: Element, b: Element) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
  const bar = () => screen.getByRole('button', { name: 'Refresh the finance page' });

  it.each([
    ['Overview', ''],
    ['the Accounts tab', 'tab=accounts'],
    ['a business picked', `account=${A}`],
  ])('AC-179 on %s: the h1, then the KPI strip, then the filter bar, then the content', async (_view, search) => {
    mockSearch = search;
    serve({ success: true, data: payload(search.startsWith('account=') ? { accountId: A } : {}) });
    render(<FinanceView />);
    const strip = await screen.findByTestId('kpi-strip', {}, { timeout: 10_000 });
    const h1 = screen.getByRole('heading', { level: 1, name: 'Finance' });
    expect(follows(h1, strip)).toBe(true);
    expect(follows(strip, bar())).toBe(true);
    expect(follows(bar(), screen.getByTestId('finance-content'))).toBe(true);
    expect(screen.getByTestId('finance-content').contains(strip)).toBe(false);
    expect(strip.querySelectorAll('[data-testid^="tile-fk"][data-status]')).toHaveLength(5);
  });

  it('K-10: five placeholders above the bar while the first read runs, and no kpi-strip until figures arrive', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- jsdom has no fetch; standard test stub
    (global as any).fetch = jest.fn(() => new Promise(() => undefined));
    render(<FinanceView />);
    const placeholders = screen.getAllByTestId('kpi-placeholder');
    expect(placeholders).toHaveLength(5);
    expect(follows(placeholders[0], bar())).toBe(true);
    expect(screen.queryByTestId('kpi-strip')).toBeNull();
  });

  it('K-10: a failed read shows the page error and no strip, and no placeholders', async () => {
    serve({ success: false, error: 'Boom' }, 500);
    render(<FinanceView />);
    await screen.findByTestId('finance-error', {}, { timeout: 10_000 });
    expect(screen.queryByTestId('kpi-strip')).toBeNull();
    expect(screen.queryAllByTestId('kpi-placeholder')).toHaveLength(0);
  });

  it('AC-180 / MK-5 (ruled): F-K1 → Our revenue, F-K2 → Recurring now, F-K3 → the AI cost summary, F-K4 → Accounts, F-K5 → Plans & subscriptions; each target exists', async () => {
    serve({ success: true, data: payload({ mrr: { status: 'ok', lines: [], unpriced: 0, discountUnknown: 0, pastDueCounted: true }, stripeMode: 'live' }) });
    render(<FinanceView />);
    await screen.findByTestId('kpi-strip', {}, { timeout: 10_000 });
    const anchors = { fk1_revenue: '#revenue', fk2_mrr: '#revenue-mrr', fk3_ai_cost: '#ai-cost' };
    for (const [id, href] of Object.entries(anchors)) {
      const tile = screen.getByTestId(`tile-${id}`);
      expect({ id, tag: tile.tagName, href: tile.getAttribute('href') }).toEqual({ id, tag: 'A', href });
      expect(document.getElementById(href.slice(1))).not.toBeNull();
    }
    expect(screen.getByTestId('tile-fk4_ai_margin').getAttribute('href')).toBe('/admin/finance?tab=accounts');
    expect(screen.getByTestId('tile-fk5_paying').getAttribute('href')).toBe('/admin/finance?tab=plans');
    // Links, never buttons: the page's button count grows only by the five icons (MK-0), never a tile (K-6).
    for (const button of screen.getAllByRole('button')) expect(button.getAttribute('data-testid') ?? '').not.toMatch(/^tile-fk\d_[a-z_]+$/);
  });

  it('MK-5: a plain click on F-K4 or F-K5 opens its tab in one write; a business picked has no tab target', async () => {
    window.history.replaceState(null, '', '/admin/finance');
    serve({ success: true, data: payload() });
    const first = render(<FinanceView />);
    await screen.findByTestId('kpi-strip', {}, { timeout: 10_000 });
    fireEvent.click(screen.getByTestId('tile-fk5_paying'));
    expect(window.location.search).toBe('?tab=plans');
    first.unmount();
    mockSearch = `account=${A}`;
    serve({ success: true, data: payload({ accountId: A }) });
    render(<FinanceView />);
    await screen.findByTestId('kpi-strip', {}, { timeout: 10_000 });
    expect(screen.getByTestId('tile-fk4_ai_margin').tagName).toBe('DIV');
    expect(screen.getByTestId('tile-fk5_paying').tagName).toBe('DIV');
  });

  it('F5-R3: every section anchor id occurs exactly once, on Overview and in the picked view', async () => {
    for (const search of ['', `account=${A}`]) {
      mockSearch = search;
      serve({ success: true, data: payload(search ? { accountId: A } : {}) });
      const { unmount } = render(<FinanceView />);
      await screen.findByTestId('kpi-strip', {}, { timeout: 10_000 });
      for (const id of ['revenue', 'takings', 'accounts', 'ai-cost', 'credits']) {
        expect({ search, id, count: document.querySelectorAll(`[id="${id}"]`).length }).toEqual({ search, id, count: 1 });
      }
      const ids = Array.from(document.querySelectorAll('[id]')).map((el) => el.id);
      expect(new Set(ids).size).toBe(ids.length);
      unmount();
    }
  });

  it('MK-5 (ruled; replaces K-1\u2019s cross-page link): F-K3 jumps to the AI cost summary; Section 3 keeps its own link to AI calls & usage', async () => {
    serve({ success: true, data: payload() });
    render(<FinanceView />);
    await screen.findByTestId('kpi-strip', {}, { timeout: 10_000 });
    expect(screen.getByTestId('tile-fk3_ai_cost').getAttribute('href')).toBe('#ai-cost');
    expect(screen.getByTestId('ai-analytics-link').getAttribute('href')).toBe(k1AnalyticsHref(null));
  });

  describe('on the Accounts tab (SA-W3 (a), F5-R2)', () => {
    let scrolled: string[] = [];
    const original = Element.prototype.scrollIntoView;
    beforeEach(() => {
      scrolled = [];
      Element.prototype.scrollIntoView = function scrollIntoView(this: Element) {
        scrolled.push(this.id);
      };
    });
    afterEach(() => {
      Element.prototype.scrollIntoView = original;
    });

    it('a section tile is a real link to Overview at its section, with no tab key', async () => {
      mockSearch = 'range=7d&tab=accounts&sort=credits';
      serve({ success: true, data: payload() });
      render(<FinanceView />);
      await screen.findByTestId('kpi-strip', {}, { timeout: 10_000 });
      expect(screen.getByTestId('tile-fk1_revenue').getAttribute('href')).toBe('/admin/finance?range=7d#revenue');
      expect(screen.getByTestId('tile-fk3_ai_cost').getAttribute('href')).toBe('/admin/finance?range=7d#ai-cost');
      // F-K4 is on its own tab here: its link is the tab it is on.
      expect(screen.getByTestId('tile-fk4_ai_margin').getAttribute('href')).toBe('/admin/finance?range=7d&tab=accounts&sort=credits');
    });

    it('a plain click selects Overview in one write and scrolls to the section once; no hash is written', async () => {
      mockSearch = 'tab=accounts';
      window.history.replaceState(null, '', '/admin/finance?tab=accounts');
      serve({ success: true, data: payload() });
      render(<FinanceView />);
      await screen.findByTestId('kpi-strip', {}, { timeout: 10_000 });
      const replace = jest.spyOn(window.history, 'replaceState');
      serve({ success: true, data: payload() });
      fireEvent.click(screen.getByTestId('tile-fk3_ai_cost'));
      await waitFor(() => expect(scrolled).toEqual(['ai-cost']), { timeout: 10_000 });
      expect(screen.getByRole('tab', { name: TAB_OVERVIEW })).toHaveAttribute('aria-selected', 'true');
      expect(replace).toHaveBeenCalledTimes(1);
      expect(window.location.search).toBe('');
      expect(window.location.hash).toBe('');
      // The next read answers and re-renders: no second scroll (jumpTo was cleared).
      await waitFor(() => expect(screen.getByTestId('finance-content')).toHaveAttribute('aria-busy', 'false'), { timeout: 10_000 });
      expect(scrolled).toEqual(['ai-cost']);
      replace.mockRestore();
    });

    it('a modified click is left to the browser: no tab change and no scroll', async () => {
      mockSearch = 'tab=accounts';
      serve({ success: true, data: payload() });
      render(<FinanceView />);
      await screen.findByTestId('kpi-strip', {}, { timeout: 10_000 });
      fireEvent.click(screen.getByTestId('tile-fk1_revenue'), { ctrlKey: true });
      expect(screen.getByRole('tab', { name: TAB_ACCOUNTS })).toHaveAttribute('aria-selected', 'true');
      expect(scrolled).toEqual([]);
    });
  });

  it('on Overview a section tile is a plain anchor: a click scrolls nothing itself (the browser follows the anchor)', async () => {
    const original = Element.prototype.scrollIntoView;
    const spy = jest.fn();
    Element.prototype.scrollIntoView = spy;
    serve({ success: true, data: payload() });
    render(<FinanceView />);
    await screen.findByTestId('kpi-strip', {}, { timeout: 10_000 });
    fireEvent.click(screen.getByTestId('tile-fk1_revenue'));
    expect(spy).not.toHaveBeenCalled();
    Element.prototype.scrollIntoView = original;
  });
});

// ── Slice 6b (BD-35, §11K.6, AC-253, SA-Q89): the tile ORDER ─────────────────
// Order only: Pin B owns every value and status and is not edited. (A tab with a
// business picked is refused by the route, SA-W84, so it is not a view.)
import { REVENUE_NET as REVENUE_NET_6B, REVENUE_PLANS_RECEIVED as REVENUE_PLANS_RECEIVED_6B } from '../financeCopy';
describe('slice 6b: the KPI tiles read K-5, K-1, K-3, K-2, K-4 (BD-35)', () => {
  // Money MK-5 (ruled, §3.1, BD-35): revenue, cost, then users.
  const ORDER = ['tile-fk1_revenue', 'tile-fk2_mrr', 'tile-fk3_ai_cost', 'tile-fk4_ai_margin', 'tile-fk5_paying'];
  const follows = (a: Element, b: Element) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;

  it.each([
    ['Overview, all businesses', ''],
    ['Overview, a business picked', `account=${A}`],
    ['the Accounts tab', 'tab=accounts'],
  ])('AC-253 on %s: revenue, then cost, then the accounts, in DOM order, above the filter bar', async (_view, search) => {
    mockSearch = search;
    serve({ success: true, data: payload(search.startsWith('account=') ? { accountId: A } : {}) });
    render(<FinanceView />);
    const strip = await screen.findByTestId('kpi-strip', {}, { timeout: 10_000 });
    const ids = [...strip.querySelectorAll('[data-testid^="tile-fk"][data-status]')].map((tile) => tile.getAttribute('data-testid'));
    expect(ids).toEqual(ORDER);
    expect(follows(strip, screen.getByRole('button', { name: 'Refresh the finance page' }))).toBe(true);
  });

  it('AC-253: five placeholders while the first read runs (unchanged by the order)', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- jsdom has no fetch; standard test stub
    (global as any).fetch = jest.fn(() => new Promise(() => undefined));
    render(<FinanceView />);
    expect(screen.getAllByTestId('kpi-placeholder')).toHaveLength(5);
  });

  it('AC-251: Our revenue still says "Stripe fees not deducted"; no fee estimate on Overview', async () => {
    serve({ success: true, data: payload() });
    render(<FinanceView />);
    await screen.findByTestId('kpi-strip', {}, { timeout: 10_000 });
    // The Our revenue strings that carry it are unchanged; the cannot-show item stays true.
    expect(REVENUE_PLANS_RECEIVED_6B).toMatch(/Stripe fees not deducted/);
    expect(REVENUE_NET_6B).toMatch(/Stripe fees not deducted/);
    expect(screen.getByTestId('section-revenue').textContent).toContain('Real Stripe fees (none are recorded for our payments yet)');
    expect(document.body.textContent).not.toMatch(/Stripe fees, estimate/);
  });
});

// ── DF-6 (DF6-FR-9, E-81, E-82, DF6-R2): the since-start window line on the page ──
describe('DF-6: "Since it started" on the page', () => {
  const LINE = 'Since it started: 2026-09-29 16:50 to now (UTC)';
  const SINCE_WINDOW = { preset: 'since_start', from: '2026-09-29', to: '2026-10-09', start: '2026-09-29T16:50:53.914Z', end: '2026-10-09T10:00:00.000Z' } as const;

  it('AC-266: the header, a section subtitle and the account summary read the one line built from the payload', async () => {
    mockSearch = `range=since_start&account=${A}`;
    window.history.replaceState(null, '', `/admin/finance?${mockSearch}`);
    const fetchMock = serve({ success: true, data: payload({ accountId: A, window: SINCE_WINDOW }) });
    render(<FinanceView />);
    await screen.findByTestId('account-summary');
    expect(fetchMock).toHaveBeenCalledWith(`/api/admin/business-os/finance?preset=since_start&accountId=${A}`, expect.objectContaining({ cache: 'no-store' }));
    expect(screen.getByTestId('account-summary-window')).toHaveTextContent(LINE);
    expect(screen.getByTestId('section-ai-cost').textContent).toContain(LINE);
    expect(screen.getAllByText(LINE).length).toBeGreaterThanOrEqual(2);
    expect(document.body.textContent).not.toContain('UTC to now');
    // AC-269 on the page: a short span goes out as custom dates, never range=since_start.
    for (const link of within(screen.getByTestId('account-summary-links')).getAllByRole('link')) {
      expect(link.getAttribute('href')).not.toContain('since_start');
    }
  });

  it('E-82: with any other window the summary has no window line', async () => {
    mockSearch = `account=${A}`;
    window.history.replaceState(null, '', `/admin/finance?${mockSearch}`);
    serve({ success: true, data: payload({ accountId: A }) });
    render(<FinanceView />);
    await screen.findByTestId('account-summary');
    expect(screen.queryByTestId('account-summary-window')).toBeNull();
    expect(document.body.textContent).not.toContain('Since it started:');
  });
});

// ── Slice 8.3 (E-85 / S8-F1, 8.3-R3, AC-290): the History block sends nothing on load ──
// The history request literal is pinned HERE, never in the AC-173 table.
describe('slice 8.3: one request on load; the History request only on "Show history"', () => {
  const FINANCE_REQ = '/api/admin/business-os/finance?preset=this_month';
  const HISTORY_REQ = '/api/admin/business-os/finance/history?preset=this_month';
  const urls = (mock: jest.Mock) => mock.mock.calls.map((c) => String((c as unknown[])[0]));
  /** Answers each URL with its own body: the finance payload, or a ready history view. */
  function serveBoth(): jest.Mock {
    const history = {
      window: { from: '2026-10-01', to: '2026-10-09' },
      firstSnapshotDate: '2026-10-05',
      state: 'ready',
      weekly: false,
      planMix: { columns: [{ id: 'accounts_total', unit: 'accounts' }], points: [{ date: '2026-10-08', kind: 'snapshot', cells: [{ kind: 'value', value: 8 }] }], change: [{ kind: 'not_available' }] },
      credits: { columns: [{ id: 'credit_used', unit: 'credits' }], points: [{ date: '2026-10-08', kind: 'no_snapshot' }], change: [{ kind: 'not_available' }] },
    };
    const fetchMock = jest.fn(async (url: string) => ({
      ok: true,
      status: 200,
      json: async () => ({ success: true, data: String(url).includes('/history') ? history : payload() }),
    }));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- jsdom has no fetch; standard test stub
    (global as any).fetch = fetchMock;
    return fetchMock;
  }

  it('8.3-R3 (AC-173’s path): a failed finance read mounts no Overview and no History block, so exactly 1 fetch', async () => {
    const fetchMock = serve({ success: false, error: 'Business not found' }, 404);
    render(<FinanceView />);
    await screen.findByTestId('finance-error');
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(screen.queryByTestId('history-plan-mix-trend')).toBeNull();
    expect(screen.queryByTestId('history-credits-trend')).toBeNull();
    expect(urls(fetchMock)).toEqual([FINANCE_REQ]);
  });

  // Money MK-7 (§6 item 13): the block is split; each trend sits under its KPI, both closed on load.
  it('8.3-R3 (Pin B’s path) / MK-7: a loaded page shows both trends CLOSED, under Plan mix and Credits, and still sends exactly 1 fetch', async () => {
    const fetchMock = serveBoth();
    render(<FinanceView />);
    const planTrend = await screen.findByTestId('history-plan-mix-trend');
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(urls(fetchMock)).toEqual([FINANCE_REQ]);
    expect(screen.queryByTestId('section-history')).toBeNull();
    expect(screen.getByTestId('section-accounts').contains(planTrend)).toBe(true);
    const creditsTrend = screen.getByTestId('history-credits-trend');
    expect(screen.getByTestId('section-credits').contains(creditsTrend)).toBe(true);
    for (const id of ['history-plan-mix-toggle', 'history-credits-toggle']) {
      expect(screen.getByTestId(id)).toHaveAttribute('aria-expanded', 'false');
    }
  });

  it('AC-290 / MK-7: "Show history" sends exactly one more request, the pinned literal, never with a business; the second trend shares it', async () => {
    const fetchMock = serveBoth();
    render(<FinanceView />);
    fireEvent.click(await screen.findByTestId('history-plan-mix-toggle'));
    await screen.findByTestId('history-plan-mix-start-line');
    expect(urls(fetchMock)).toEqual([FINANCE_REQ, HISTORY_REQ]);
    expect(fetchMock.mock.calls[1]).toEqual([HISTORY_REQ, expect.objectContaining({ cache: 'no-store' })]);
    for (const url of urls(fetchMock)) expect(url).not.toContain('accountId');
    expect(screen.getByTestId('history-plan-mix-start-line')).toHaveTextContent('History starts on 2026-10-05 (UTC).');
    // MK-7: one shared lazy read, so opening the credits trend sends nothing more.
    fireEvent.click(screen.getByTestId('history-credits-toggle'));
    await screen.findByTestId('history-credits-start-line');
    expect(urls(fetchMock)).toEqual([FINANCE_REQ, HISTORY_REQ]);
  });

  it('a window change while closed sends no history request; while open, one more', async () => {
    const fetchMock = serveBoth();
    render(<FinanceView />);
    await screen.findByTestId('history-credits-trend');
    fireEvent.click(screen.getByRole('button', { name: '7 days' }));
    await waitFor(() => expect(urls(fetchMock)).toHaveLength(2));
    expect(urls(fetchMock).filter((u) => u.includes('/history'))).toEqual([]);
    fireEvent.click(await screen.findByTestId('history-credits-toggle'));
    await screen.findByTestId('history-credits-start-line');
    expect(urls(fetchMock).filter((u) => u.includes('/history'))).toEqual(['/api/admin/business-os/finance/history?preset=7d']);
  });

  it('HS-FR-11 / L-161: with a business picked, the one line, no button and no history request', async () => {
    mockSearch = `account=${A}`;
    window.history.replaceState(null, '', `/admin/finance?${mockSearch}`);
    const fetchMock = serveBoth();
    render(<FinanceView />);
    // MK-7: the one line under each KPI block (Plan mix and Credits), no toggle anywhere.
    await screen.findAllByTestId('history-all-businesses-only');
    expect(screen.getAllByTestId('history-all-businesses-only')).toHaveLength(2);
    expect(screen.queryByTestId('history-plan-mix-toggle')).toBeNull();
    expect(screen.queryByTestId('history-credits-toggle')).toBeNull();
    expect(urls(fetchMock).filter((u) => u.includes('/history'))).toEqual([]);
  });
});

// ── Slice 4b.2 (BD-17): refunds by event date, held now, block A, bought credits, on the page ──
import {
  BOOST_PROBLEMS_NONE,
  BOOST_PROBLEMS_TITLE,
  CREDITS_BOUGHT,
  CREDITS_BOUGHT_COLUMN,
  CREDITS_NOT_TAKEN_BACK,
  REVENUE_EVENTS_NOT_AVAILABLE,
  REVENUE_HELD,
  REVENUE_HELD_NONE,
  REVENUE_UNKNOWN as REVENUE_UNKNOWN_4B2,
} from '../financeCopy';

describe('slice 4b.2 on the page', () => {
  const events = { state: 'read' as const, exact: true, unreadable: 0, onUnpaidPurchases: 0, overTotal: 0, refundEvents: 1 };

  it('AC-217: a refund-only window → a line with a negative net and its minus sign; the BD-17 sentence (AC-225)', async () => {
    const revenue = paidRevenue([boostLine({ purchases: 0, gross: 0, refunded: 10, net: -10 })], { refundOrDispute: true });
    revenue.boosts.events = events;
    revenue.boosts.heldNow = [];
    serve({ success: true, data: payload({ revenue }) });
    render(<FinanceView />);
    const line = await screen.findByTestId('revenue-line-USD');
    expect(line.querySelector('[data-money="net"]')).toHaveTextContent('-$10.00');
    expect(screen.getByTestId('revenue-refund-note')).toHaveTextContent(REVENUE_REFUND_TIMING_NOTE);
    expect(document.body.textContent).not.toMatch(/counted in the month of the purchase/);
    expect(screen.getByTestId('revenue-held-now-none')).toHaveTextContent(REVENUE_HELD_NONE);
  });

  it('AC-219: held in open disputes now is its own table, per currency, beside the lines', async () => {
    const revenue = paidRevenue([boostLine()], { refundOrDispute: true });
    revenue.boosts.events = { ...events, refundEvents: 0 };
    revenue.boosts.heldNow = [{ currency: 'USD', disputes: 1, amount: 8 }];
    serve({ success: true, data: payload({ revenue }) });
    render(<FinanceView />);
    const held = await screen.findByTestId('revenue-held-now');
    expect(held).toHaveTextContent(REVENUE_HELD);
    expect(screen.getByTestId('revenue-held-now-USD').querySelector('[data-money="held"]')).toHaveTextContent('$8.00');
    expect(screen.getByTestId('revenue-line-USD').querySelector('[data-money="net"]')).toHaveTextContent('$10.00');
  });

  it('AC-224 / §7: the events table not there yet → refunded, lost and net "Unknown" with one calm notice; the page renders', async () => {
    const revenue = paidRevenue([boostLine({ refunded: null, lost: null, net: null })], {}, { status: 'partial' });
    revenue.boosts.status = 'partial';
    revenue.boosts.events = { state: 'not_available', exact: false, unreadable: 0, onUnpaidPurchases: 0, overTotal: 0, refundEvents: 0 };
    revenue.boosts.heldNow = [];
    serve({ success: true, data: payload({ revenue }) });
    render(<FinanceView />);
    const line = await screen.findByTestId('revenue-line-USD');
    for (const cell of ['refunded', 'lost']) expect(line.querySelector(`[data-money="${cell}"]`)).toHaveTextContent(REVENUE_UNKNOWN_4B2);
    expect(screen.getByTestId('revenue-notice-events-not-available')).toHaveTextContent(REVENUE_EVENTS_NOT_AVAILABLE);
    expect(screen.getByTestId('section-credits')).toBeInTheDocument();
  });

  it('AC-227: block A comes first in Section 6: an open dispute with its held amount and opened date', async () => {
    const problems = paymentProblemsSection({
      boosts: {
        status: 'ok',
        figures: {
          empty: false, exact: true, openDisputes: 1, notCredited: 0, openedDates: 'read', eventsOnUnpaidPurchases: 0, overTotal: 0,
          lines: [{ currency: 'USD', openDisputes: 1, held: 8, oldestDisputeOpenedAt: '2026-10-04T09:00:00.000Z', notCredited: 0, notCreditedAmount: null, oldestNotCreditedAt: null }],
        },
      },
    });
    serve({ success: true, data: payload({ paymentProblems: problems }) });
    render(<FinanceView />);
    const block = await screen.findByTestId('problems-boosts');
    expect(block).toHaveTextContent(BOOST_PROBLEMS_TITLE);
    // Money MK-6 (§6 item 14): our boost problems sit in Revenue, after its boosts part.
    const revenue = screen.getByTestId('section-revenue');
    expect(revenue.contains(block)).toBe(true);
    expect(screen.getByTestId('revenue-boosts-part').compareDocumentPosition(block) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByTestId('problems-clients').contains(block)).toBe(false);
    const row = screen.getByTestId('problems-boosts-line-USD');
    expect(row.querySelector('[data-money="held"]')).toHaveTextContent('$8.00');
    expect(row).toHaveTextContent('2026-10-04');
  });

  it('AC-227: nothing to show → the calm empty line; no block at all when the payload has none (E-103)', async () => {
    serve({
      success: true,
      data: payload({
        paymentProblems: paymentProblemsSection({
          boosts: { status: 'ok', figures: { empty: true, exact: true, openDisputes: 0, notCredited: 0, openedDates: 'read', eventsOnUnpaidPurchases: 0, overTotal: 0, lines: [] } },
        }),
      }),
    });
    const { unmount } = render(<FinanceView />);
    expect(await screen.findByTestId('problems-boosts-none')).toHaveTextContent(BOOST_PROBLEMS_NONE);
    unmount();
    serve({ success: true, data: payload() });
    render(<FinanceView />);
    await screen.findByTestId('revenue-body');
    expect(screen.queryByTestId('problems-boosts')).toBeNull();
  });

  it('AC-228: bought credits beside gifted, never one figure; the column; the not-taken-back sentence', async () => {
    const base = creditsSection();
    const credits = {
      ...base,
      figures: base.figures ? { ...base.figures, rows: base.figures.rows.map((r) => ({ ...r, boughtOutstanding: 5000 })) } : null,
      bought: { outstanding: 5000, deletedAccountsOutstanding: 0, window: { credits: 5000, lots: 1 }, refundNotTakenBack: true },
    };
    serve({ success: true, data: payload({ credits }) });
    render(<FinanceView />);
    expect(await screen.findByTestId('credits-bought')).toHaveTextContent('5,000');
    expect(screen.getByTestId('credits-summary')).toHaveTextContent(CREDITS_BOUGHT);
    expect(screen.getByTestId('credits-gifted')).not.toHaveTextContent('5,0');
    expect(screen.getByTestId('credits-table')).toHaveTextContent(CREDITS_BOUGHT_COLUMN);
    expect(screen.getByTestId('credits-not-taken-back')).toHaveTextContent(CREDITS_NOT_TAKEN_BACK);
  });

  it('E-103: a payload without the 4b.2 fields renders exactly as before (no bought column, no held table)', async () => {
    serve({ success: true, data: payload() });
    render(<FinanceView />);
    await screen.findByTestId('credits-summary');
    expect(screen.queryByTestId('credits-bought')).toBeNull();
    expect(screen.getByTestId('credits-table')).not.toHaveTextContent(CREDITS_BOUGHT_COLUMN);
    expect(screen.queryByTestId('revenue-held-now')).toBeNull();
  });
});

// ── Money MK-1 (KPI restructure review §3.2, §3.3, §5; FC-1): the block KPI headlines ──
describe('Money MK-1: block KPIs as headlines, with their leading icon', () => {
  it('Client payments: "Businesses taking client payments" is the headline, leading, from its one definition constant', async () => {
    serve({ success: true, data: payload() });
    render(<FinanceView />);
    const section = await screen.findByTestId('section-takings');
    const kpi = within(section).getByRole('group', { name: `${BLOCK_KPI_CLIENT_PAYMENTS_LABEL}, 3` });
    expect(within(section).getByTestId('takings-body').firstElementChild).toBe(kpi);
    expect(within(kpi).getByTestId('takings-businesses')).toHaveTextContent('3');
    const icon = within(kpi).getByRole('button', { name: `${KPI_INDICATOR_WORDS.leading.name}. ${BLOCK_KPI_CLIENT_PAYMENTS_DEFINITION}` });
    expect(screen.getByTestId('takings-businesses-indicator')).toHaveAttribute('data-indicator', 'leading');
    act(() => icon.focus());
    expect(within(kpi).getByRole('tooltip')).toHaveTextContent(KPI_INDICATOR_WORDS.leading.line);
    // The old plain line is gone: one figure, one place.
    expect(section).not.toHaveTextContent('Businesses with takings:');
  });

  it('Client payments: the headline says "at least" when the payments read was cut off', async () => {
    const base = takingsSection();
    serve({ success: true, data: payload({ takings: { ...base, status: 'partial', figures: { ...base.figures!, paymentsExact: false } } }) });
    render(<FinanceView />);
    const section = await screen.findByTestId('section-takings');
    expect(within(section).getByTestId('takings-businesses').textContent).toMatch(/at least/i);
  });

  it('Credits: "Accounts over allowance" is the headline, leading, with K-2 far-over as its amber chip', async () => {
    serve({ success: true, data: payload() });
    render(<FinanceView />);
    const section = await screen.findByTestId('section-credits');
    const kpi = within(section).getByRole('group', { name: `${BLOCK_KPI_OVER_ALLOWANCE_LABEL}, 1` });
    expect(within(kpi).getByTestId('credits-over')).toHaveTextContent('1');
    within(kpi).getByRole('button', { name: `${KPI_INDICATOR_WORDS.leading.name}. ${BLOCK_KPI_OVER_ALLOWANCE_DEFINITION}` });
    const chip = within(kpi).getByTestId('credits-over-chip');
    expect(chip).toHaveTextContent(BLOCK_KPI_FAR_OVER_CHIP('1', 150));
    expect(chip).toHaveAttribute('data-tone', 'warn');
    // The headline is not repeated in the summary list.
    expect(within(screen.getByTestId('credits-summary')).queryByTestId('credits-over')).toBeNull();
  });

  it.each([[0], [null]] as const)('Credits: no far-over chip when the count is %s', async (farOver) => {
    const base = creditsSection();
    serve({ success: true, data: payload({ credits: { ...base, figures: { ...base.figures!, farOverAllowance: farOver } } }) });
    render(<FinanceView />);
    await screen.findByTestId('section-credits');
    expect(screen.queryByTestId('credits-over-chip')).toBeNull();
  });

  it('BD-1: the title and the "Not our revenue" chip say it together; the block is never inside the revenue panel', async () => {
    serve({ success: true, data: payload() });
    render(<FinanceView />);
    const section = await screen.findByTestId('section-takings');
    expect(within(section).getByRole('heading', { name: TAKINGS_TITLE })).toHaveTextContent('not ours');
    expect(screen.getByTestId('section-takings-badge')).toHaveTextContent(TAKINGS_CHIP);
    expect(screen.getByTestId('section-revenue').contains(section)).toBe(false);
  });

  it('FC-1: none of the new strings says just Cost, Expenses, OPEX or Profit', () => {
    const texts = [
      TAKINGS_TITLE,
      BLOCK_KPI_CLIENT_PAYMENTS_LABEL,
      BLOCK_KPI_CLIENT_PAYMENTS_DEFINITION,
      BLOCK_KPI_OVER_ALLOWANCE_LABEL,
      BLOCK_KPI_OVER_ALLOWANCE_DEFINITION,
      BLOCK_KPI_FAR_OVER_CHIP('2', 150),
      BLOCK_KPI_FAR_OVER_CHIP('2', null),
    ];
    for (const text of texts) expect(text).not.toMatch(/\b(cost|costs|expenses?|opex|profit)\b/i);
  });
});

// ── Money MK-4 (KPI restructure review §3.2, SA-2, C-4): MRR and the Plans & subscriptions tab ──
describe('Money MK-4: Recurring now and the Plans & subscriptions tab', () => {
  const SUBS_ROUTE = '/api/admin/business-os/billing/subscriptions';
  const MRR: FinanceMrrSection = {
    status: 'ok',
    lines: [{ currency: 'USD', totalHundredths: 14700, cancellingHundredths: 4900, pastDueHundredths: 4900, subscriptions: 3, overflow: false }],
    unpriced: 0,
    discountUnknown: 1,
    pastDueCounted: true,
  };
  const SUBS: SubscriptionsPayload = {
    generatedAt: '2026-10-19T09:00:00.000Z',
    mode: 'test',
    status: null,
    totals: {
      mrr: MRR.lines,
      mrrUnpriced: 0,
      mrrDiscountUnknown: 1,
      mrrPastDueCounted: true,
      paidByPlan: [{ id: 'tier_a', name: 'Plan A', accounts: 3 }],
      byStatus: { ended: 0, paused: 0, grace: 0, failed: 1, cancelling: 1, active: 1, other: 0, no_stripe: 0 },
      accounts: 3,
    },
    rows: [
      {
        accountId: A,
        businessName: 'Acme',
        status: 'active',
        statuses: ['active'],
        stripeStatus: 'active',
        planBought: { id: 'tier_a', name: 'Plan A' },
        planOnRecord: { id: 'tier_a', name: 'Plan A' },
        paidThrough: '2026-11-01T00:00:00.000Z',
        currentPeriodEnd: '2026-11-01T00:00:00.000Z',
        cancelAtPeriodEnd: false,
        endedAt: null,
        lastPaidAt: '2026-10-01T00:00:00.000Z',
        lastPaymentFailedAt: null,
        failedAttempts: 0,
        pendingPlan: null,
        discounted: false,
      },
    ],
    matching: 1,
  };

  /** The finance route for every finance URL, the subscriptions route for its own. */
  function serveBoth(finance: unknown, subs: unknown = { success: true, data: SUBS }): jest.Mock {
    const fetchMock = jest.fn(async (url: string) => {
      const body = String(url).startsWith(SUBS_ROUTE) ? subs : finance;
      return { ok: true, status: 200, json: async () => body };
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- jsdom has no fetch; standard test stub
    (global as any).fetch = fetchMock;
    return fetchMock;
  }
  const urls = (fetchMock: jest.Mock) => fetchMock.mock.calls.map((call) => String(call[0]));
  /** The address bar the shared filter hook writes (history.replaceState). */
  const address = () => `${window.location.pathname}${window.location.search}`;

  it('T-3: the Overview makes ONE request on load, to the finance route only', async () => {
    const fetchMock = serveBoth({ success: true, data: payload({ mrr: MRR, stripeMode: 'test' }) });
    render(<FinanceView />);
    await screen.findByTestId('section-revenue');
    expect(urls(fetchMock)).toHaveLength(1);
    expect(urls(fetchMock)[0]).toMatch(/^\/api\/admin\/business-os\/finance\?/);
    expect(urls(fetchMock).some((u) => u.startsWith(SUBS_ROUTE))).toBe(false);
  });

  it('T-3 / T-4: opening Plans & subscriptions sends exactly one more request, to the subscriptions route; the finance request is the Overview literal', async () => {
    const fetchMock = serveBoth({ success: true, data: payload({ mrr: MRR, stripeMode: 'test' }) });
    render(<FinanceView />);
    await screen.findByTestId('section-revenue');
    const financeRequest = urls(fetchMock)[0];
    expect(financeRequest).toBe('/api/admin/business-os/finance?preset=this_month');
    fireEvent.click(screen.getByTestId('finance-tab-plans'));
    await screen.findByTestId('plans-subscriptions-count');
    const after = urls(fetchMock);
    expect(after.filter((u) => u.startsWith(SUBS_ROUTE))).toEqual([SUBS_ROUTE]);
    // The finance request is never sent with tab=plans (AC-173 Part C unchanged).
    expect(after.filter((u) => !u.startsWith(SUBS_ROUTE)).every((u) => u === financeRequest)).toBe(true);
    expect(address()).toBe('/admin/finance?tab=plans');
  });

  it('a deep link to tab=plans: Plan mix on top, then the subscriptions; the status filter is sent on the first read', async () => {
    mockSearch = 'tab=plans&status=failed';
    window.history.replaceState(null, '', '/admin/finance?tab=plans&status=failed');
    const fetchMock = serveBoth({ success: true, data: payload({ mrr: MRR, stripeMode: 'test' }) });
    render(<FinanceView />);
    const panel = await screen.findByTestId('finance-panel-plans');
    await within(panel).findByTestId('plans-subscriptions-count');
    const accounts = within(panel).getByTestId('section-accounts');
    const subs = within(panel).getByTestId('plans-subscriptions');
    expect(accounts.compareDocumentPosition(subs) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(urls(fetchMock)).toContain(`${SUBS_ROUTE}?status=failed`);
    expect(screen.getByRole('tab', { name: 'Plans & subscriptions' })).toHaveAttribute('aria-selected', 'true');
  });

  /** The page's text with the two allowed places (C-4) removed: the MRR line's chip and the subscriptions block. */
  const textOutsideAllowed = (container: HTMLElement) => {
    const copy = container.cloneNode(true) as HTMLElement;
    copy.querySelector('[data-testid="revenue-recurring-key"]')?.remove();
    // MK-5 (C-4): the MRR tile is the other allowed place.
    copy.querySelector('[data-testid="tile-fk2_mrr"]')?.remove();
    copy.querySelector('[data-testid="plans-subscriptions"]')?.remove();
    return copy.textContent ?? '';
  };

  it('T-5 (C-4, SA-CR-MK4): "Stripe test mode" is shown on the MRR line and the Plans & subscriptions block only', async () => {
    serveBoth({ success: true, data: payload({ mrr: MRR, stripeMode: 'test' }) });
    const view = render(<FinanceView />);
    await screen.findByTestId('section-revenue');
    expect(screen.getByTestId('revenue-recurring-key')).toHaveTextContent(REVENUE_RECURRING_TEST_KEY_LABEL);
    expect(textOutsideAllowed(view.container)).not.toMatch(/test.?mode|live.?mode/i);
    fireEvent.click(screen.getByTestId('finance-tab-plans'));
    const subs = await screen.findByTestId('plans-subscriptions');
    await within(subs).findByTestId('plans-subscriptions-mode');
    expect(within(subs).getByTestId('plans-subscriptions-mode')).toHaveTextContent(MODE_BADGE.test);
    expect(within(subs).getByTestId('plans-subscriptions-test-key-note')).toHaveTextContent(TEST_KEY_NOTE);
    // Outside the two allowed places, still no mode words anywhere (strip, Plan mix, header).
    expect(textOutsideAllowed(view.container)).not.toMatch(/test.?mode|live.?mode/i);
  });

  it('CR-2: the MRR line is labelled in test only; a live key or an unknown MRR has no label; revenue received never (BD-20)', async () => {
    serveBoth({ success: true, data: payload({ mrr: MRR, stripeMode: 'test' }) });
    const first = render(<FinanceView />);
    const revenue = await screen.findByTestId('section-revenue');
    const chip = within(within(revenue).getByTestId('revenue-recurring')).getByTestId('revenue-recurring-key');
    expect(chip).toHaveTextContent('Stripe test mode');
    expect(chip).toHaveAttribute('data-tone', 'neutral');
    for (const part of ['revenue-plans-part', 'revenue-boosts-part']) {
      expect(within(revenue).getByTestId(part)).not.toHaveTextContent(/test.?mode|live.?mode/i);
    }
    first.unmount();
    serveBoth({ success: true, data: payload({ mrr: MRR, stripeMode: 'live' }) });
    const second = render(<FinanceView />);
    await screen.findByTestId('revenue-recurring');
    expect(screen.queryByTestId('revenue-recurring-key')).toBeNull();
    expect(second.container).not.toHaveTextContent(/test.?mode|live.?mode/i);
    second.unmount();
    serveBoth({ success: true, data: payload({ mrr: { ...MRR, status: 'unknown', lines: [] }, stripeMode: 'test' }) });
    render(<FinanceView />);
    await screen.findByTestId('revenue-recurring-unknown');
    expect(screen.queryByTestId('revenue-recurring-key')).toBeNull();
  });

  it('T-6: Revenue shows "Recurring now (MRR)" per currency, past due and cancelling apart; mode words only on the MRR chip', async () => {
    serveBoth({ success: true, data: payload({ mrr: MRR, stripeMode: 'test' }) });
    render(<FinanceView />);
    const revenue = await screen.findByTestId('section-revenue');
    const part = within(revenue).getByTestId('revenue-recurring');
    expect(within(part).getByRole('heading', { name: REVENUE_RECURRING_HEADING })).toBeInTheDocument();
    const line = within(part).getByTestId('revenue-recurring-USD');
    expect(line).toHaveTextContent('$147.00');
    expect(line).toHaveTextContent('3 subscriptions');
    expect(line).toHaveTextContent('of which past due (still counted) $49.00');
    expect(line).toHaveTextContent('of which cancelling $49.00');
    expect(part).toHaveTextContent('1 paying with a founder discount');
    expect(textOutsideAllowed(revenue)).not.toMatch(/test.?mode|live.?mode/i);
  });

  it('T-6: an unknown MRR says Unknown, never 0; no paying subscription says None; no mrr key renders the panel as before', async () => {
    serveBoth({ success: true, data: payload({ mrr: { ...MRR, status: 'unknown', lines: [] }, stripeMode: null }) });
    const first = render(<FinanceView />);
    expect(await screen.findByTestId('revenue-recurring-unknown')).toHaveTextContent(REVENUE_RECURRING_UNKNOWN);
    first.unmount();
    serveBoth({ success: true, data: payload({ mrr: { ...MRR, lines: [], discountUnknown: 0 }, stripeMode: 'test' }) });
    const second = render(<FinanceView />);
    expect(await screen.findByTestId('revenue-recurring-none')).toHaveTextContent(REVENUE_RECURRING_NONE);
    second.unmount();
    serveBoth({ success: true, data: payload() });
    render(<FinanceView />);
    await screen.findByTestId('section-revenue');
    expect(screen.queryByTestId('revenue-recurring')).toBeNull();
  });

  it('a 409 from the subscriptions route shows its sentence in the block; the rest of the page stays', async () => {
    serveBoth({ success: true, data: payload({ mrr: MRR, stripeMode: null }) }, { success: false, error: 'The Stripe key could not be read.' });
    render(<FinanceView />);
    await screen.findByTestId('section-revenue');
    fireEvent.click(screen.getByTestId('finance-tab-plans'));
    expect(await screen.findByTestId('plans-subscriptions-error')).toBeInTheDocument();
    expect(screen.getByTestId('kpi-strip')).toBeInTheDocument();
  });

  it('leaving the tab drops the status filter from the address (it belongs to the tab)', async () => {
    mockSearch = 'tab=plans&status=failed';
    window.history.replaceState(null, '', '/admin/finance?tab=plans&status=failed');
    serveBoth({ success: true, data: payload({ mrr: MRR, stripeMode: 'test' }) });
    render(<FinanceView />);
    await screen.findByTestId('finance-panel-plans');
    fireEvent.click(screen.getByTestId('finance-tab-overview'));
    expect(address()).toBe('/admin/finance');
  });
});

// ── Money MK-5 (KPI restructure review §3.1, §3.3, §3.4, §5, §14 FC-2): the strip's icons, K-3 in its block, USD-6 ──
describe('Money MK-5: the F-K strip, K-3 on Plan mix, and no "USD " money on the page', () => {
  const KPIS: Array<[string, keyof typeof FINANCE_KPIS_MK5, 'leading' | 'lagging']> = [
    ['fk1_revenue', 'revenue', 'lagging'],
    ['fk2_mrr', 'mrr', 'leading'],
    ['fk3_ai_cost', 'aiCost', 'lagging'],
    ['fk4_ai_margin', 'aiMargin', 'lagging'],
    ['fk5_paying', 'paying', 'lagging'],
  ];
  const WORDS = { leading: 'Leading indicator', lagging: 'Lagging indicator' } as const;

  it.each(KPIS)('T-2: %s carries its %s icon (LL-1 to LL-4), named from its one definition constant', async (id, key, kind) => {
    serve({ success: true, data: payload() });
    render(<FinanceView />);
    await screen.findByTestId('kpi-strip');
    const icon = screen.getByTestId(`tile-${id}-indicator`);
    expect(icon).toHaveAttribute('data-indicator', key === 'mrr' ? 'leading' : kind);
    expect(within(icon).getByRole('button', { name: `${WORDS[kind]}. ${FINANCE_KPIS_MK5[key].definition}` })).toBeInTheDocument();
    // The tile stays the link; the icon is beside it, never inside (LL-3).
    expect(screen.getByTestId(`tile-${id}`).contains(icon)).toBe(false);
  });

  it('T-2 / FC-2: the AI margin tooltip says what it deducts, word for word (§14)', () => {
    expect(FINANCE_KPIS_MK5.aiMargin.definition).toContain(
      'A partial gross margin: only AI cost is deducted so far. Stripe fees are an estimate beside it.'
    );
    for (const kpi of Object.values(FINANCE_KPIS_MK5)) {
      // FC-1: every label names AI where it means AI; none says just Cost, Expenses, OPEX or Profit.
      expect(kpi.label).not.toMatch(/^(cost|costs|expenses|opex|profit)$/i);
      expect(kpi.label).not.toMatch(/\b(expenses|opex|profit|gross margin|operating margin)\b/i);
    }
  });

  it('T-8: K-3 is a chip on Plan mix with its rule (amber → warn, red → danger), and none when the rule is quiet', async () => {
    const amber = payload();
    serve({ success: true, data: amber });
    const first = render(<FinanceView />);
    const chip = await screen.findByTestId('accounts-k3-chip');
    expect(chip).toHaveTextContent('8 Founding Partners with no end date');
    expect(chip).toHaveAttribute('data-tone', 'warn');
    expect(screen.getByTestId('accounts-k3')).toHaveTextContent(amber.tiles.k3.headline);
    first.unmount();

    const red = payload();
    red.tiles.k3 = { ...red.tiles.k3, status: 'red' };
    serve({ success: true, data: red });
    const second = render(<FinanceView />);
    expect(await screen.findByTestId('accounts-k3-chip')).toHaveAttribute('data-tone', 'danger');
    second.unmount();

    const quiet = payload();
    quiet.tiles.k3 = { ...quiet.tiles.k3, status: 'green', headline: 'All clear' };
    serve({ success: true, data: quiet });
    render(<FinanceView />);
    await screen.findByTestId('section-accounts');
    expect(screen.queryByTestId('accounts-k3-chip')).toBeNull();
  });

  it('T-8: K-2 (the Credits chip, MK-1) and K-4 (the gifted figure) stay in Credits; neither is a tile', async () => {
    serve({ success: true, data: payload() });
    render(<FinanceView />);
    const credits = await screen.findByTestId('section-credits');
    expect(within(credits).getByTestId('credits-over-chip')).toHaveTextContent('1 at or over 150% of allowance');
    expect(within(credits).getByTestId('credits-gifted')).toHaveTextContent('12.5');
    expect(screen.getByTestId('kpi-strip').querySelectorAll('[data-testid^="tile-k"]')).toHaveLength(0);
  });

  it('T-7: Paying accounts reads the % with its count, the denominator being every plan row (Q-11)', async () => {
    serve({ success: true, data: payload({ paying: { scope: 'all', status: 'ok', paying: 9, accounts: 50 } }) });
    render(<FinanceView />);
    const tile = await screen.findByTestId('tile-fk5_paying');
    expect(tile).toHaveTextContent('18%');
    expect(tile).toHaveTextContent('9 of 50 accounts');
    expect(FINANCE_KPIS_MK5.paying.definition).toMatch(/trials, Founding Partners and comped accounts included/);
  });

  it.each([
    ['Overview', ''],
    ['the Accounts tab', 'tab=accounts'],
    ['a business picked', `account=${A}`],
  ])('USD-6 (render): on %s, no money is shown as "USD <amount>"; US dollars carry "$"', async (_view, search) => {
    mockSearch = search;
    serve({
      success: true,
      data: payload({
        ...(search.startsWith('account=') ? { accountId: A } : {}),
        mrr: { status: 'ok', lines: [{ currency: 'USD', totalHundredths: 4900, cancellingHundredths: 0, pastDueHundredths: 0, subscriptions: 1, overflow: false }], unpriced: 0, discountUnknown: 0, pastDueCounted: true },
        stripeMode: 'live',
      }),
    });
    const view = render(<FinanceView />);
    await screen.findByTestId('kpi-strip');
    expect(view.container.textContent).not.toMatch(/USD -?\d/);
    expect(view.container.textContent).toMatch(/\$\d/);
  });
});

// ── SA-CR-MK5 C-2 (BD-11): the K-2 chip takes K-2's own status ──
describe('Money MK-5 C-2: the far-over chip on Credits follows the K-2 rule', () => {
  it.each([
    ['red', 'danger'],
    ['amber', 'warn'],
    ['green', 'neutral'],
    ['neutral', 'neutral'],
    ['unavailable', 'neutral'],
  ] as const)('K-2 %s → a %s chip', async (status, tone) => {
    const p = payload();
    p.tiles.k2 = { ...p.tiles.k2, status };
    serve({ success: true, data: p });
    render(<FinanceView />);
    const chip = await screen.findByTestId('credits-over-chip');
    expect(chip).toHaveAttribute('data-tone', tone);
    expect(chip).toHaveTextContent('1 at or over 150% of allowance');
  });
});

// ── Money MK-5b (§5.1 F-K5b): Converted this month, the F-K5 figure and the list ──
describe('Money MK-5b: Converted this month', () => {
  const OCT = { from: '2026-10-01T00:00:00.000Z', to: '2026-11-01T00:00:00.000Z' };
  const SUBS_ROUTE_5B = '/api/admin/business-os/billing/subscriptions';
  const row = (accountId: string, extra: Partial<FinanceConvertedRow> = {}): FinanceConvertedRow => ({
    accountId,
    name: 'Acme Dental',
    nameStatus: 'found',
    group: 'tier:x',
    tierLabel: 'Essentials-ish',
    firstPaymentAt: '2026-10-05T10:00:00.000Z',
    source: 'account_invite',
    sourceStatus: 'found',
    payingNow: true,
    ...extra,
  });
  const all = (extra: Partial<Extract<FinanceConverted, { scope: 'all' }>> = {}): FinanceConverted => ({
    scope: 'all', status: 'ok', month: OCT, converted: 2, paying: 9, stopped: 1, shownLimit: 100,
    rows: [row(A), row(B, { name: null, nameStatus: 'missing', source: null, sourceStatus: 'missing', payingNow: false }), row(C, { sourceStatus: 'unavailable', source: null })],
    ...extra,
  });
  const PAYING = { scope: 'all' as const, status: 'ok' as const, paying: 9, accounts: 50 };

  function serveFinanceAndSubs(finance: unknown): jest.Mock {
    const subs = { success: true, data: { generatedAt: '2026-10-19T09:00:00.000Z', mode: 'test', status: null, totals: null, rows: [], matching: 0 } };
    const fetchMock = jest.fn(async (url: string) => ({
      ok: true,
      status: 200,
      json: async () => (String(url).startsWith(SUBS_ROUTE_5B) ? subs : finance),
    }));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- jsdom has no fetch; standard test stub
    (global as any).fetch = fetchMock;
    return fetchMock;
  }

  it('F-K5: "Converted this month: 2 of 9 paying" with its own Leading pill and the §5 definition', async () => {
    serve({ success: true, data: payload({ paying: PAYING, converted: all() }) });
    render(<FinanceView />);
    const tile = await screen.findByTestId('tile-fk5_paying');
    expect(tile).toHaveTextContent('18%');
    expect(tile).toHaveTextContent('Converted this month: 2 of 9 paying');
    const pill = screen.getByTestId('tile-fk5_converted-indicator');
    expect(pill).toHaveAttribute('data-indicator', 'leading');
    expect(within(pill).getByRole('button')).toHaveTextContent('Leading');
    expect(screen.getByTestId('tile-fk5_converted-indicator-tooltip')).toHaveTextContent(FINANCE_KPIS_MK5.converted.definition);
    // The paying figure keeps its own Lagging pill; the converted pill is outside the tile's link.
    expect(screen.getByTestId('tile-fk5_paying-indicator')).toHaveAttribute('data-indicator', 'lagging');
    expect(tile.contains(pill)).toBe(false);
    expect(screen.getByTestId('tile-fk5_converted-box').contains(tile)).toBe(true);
  });

  it('F-K5: "at least" when cut off; Unknown on a failed read, never 0', async () => {
    serve({ success: true, data: payload({ paying: PAYING, converted: all({ status: 'partial' }) }) });
    const { unmount } = render(<FinanceView />);
    expect(await screen.findByTestId('tile-fk5_paying')).toHaveTextContent('Converted this month: at least 2, of at least 9 paying');
    unmount();
    serve({ success: true, data: payload({ paying: PAYING, converted: all({ status: 'unknown', converted: null, paying: null, stopped: null, rows: null }) }) });
    render(<FinanceView />);
    const tile = await screen.findByTestId('tile-fk5_paying');
    expect(tile).toHaveTextContent(KPI_CONVERTED_UNKNOWN);
    expect(tile).not.toHaveTextContent('Converted this month: 0');
  });

  it('F-K5 with a business picked: that business, yes or no (the recorded decision)', async () => {
    mockSearch = `accountId=${A}`;
    window.history.replaceState(null, '', `/admin/finance?accountId=${A}`);
    serve({
      success: true,
      data: payload({
        accountId: A,
        paying: { scope: 'one', status: 'ok', paying: false },
        converted: { scope: 'one', status: 'ok', month: OCT, state: 'stopped', firstPaymentAt: '2026-10-05T10:00:00.000Z' },
      }),
    });
    render(<FinanceView />);
    expect(await screen.findByTestId('tile-fk5_paying')).toHaveTextContent(KPI_CONVERTED_ONE.stopped);
  });

  it('no converted key: F-K5 has no converted line and no second pill (as before MK-5b)', async () => {
    serve({ success: true, data: payload({ paying: PAYING }) });
    render(<FinanceView />);
    const tile = await screen.findByTestId('tile-fk5_paying');
    expect(tile).not.toHaveTextContent('Converted this month');
    expect(screen.queryByTestId('tile-fk5_converted-indicator')).toBeNull();
    expect(screen.queryByTestId('tile-fk5_converted-box')).toBeNull();
  });

  it('the list on Plans & subscriptions: business, plan, first payment, came from, status; no new request (AC-173)', async () => {
    mockSearch = 'tab=plans';
    window.history.replaceState(null, '', '/admin/finance?tab=plans');
    const fetchMock = serveFinanceAndSubs({ success: true, data: payload({ paying: PAYING, converted: all() }) });
    render(<FinanceView />);
    const section = await screen.findByTestId('section-converted-this-month');
    const panel = screen.getByTestId('finance-panel-plans');
    expect(panel.contains(section)).toBe(true);
    // Between Plan mix and the subscriptions.
    const planMix = within(panel).getByTestId('section-accounts');
    const subs = within(panel).getByTestId('plans-subscriptions');
    expect(planMix.compareDocumentPosition(section) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(section.compareDocumentPosition(subs) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(section).toHaveTextContent('October 2026');

    const first = within(section).getByTestId(`converted-row-${A}`);
    expect(first).toHaveTextContent('Acme Dental');
    expect(first).toHaveTextContent('Essentials-ish');
    expect(first).toHaveTextContent('2026-10-05');
    expect(first).toHaveTextContent('Friend invite');
    expect(first).toHaveTextContent(CONVERTED_STATUS.paying);
    const stopped = within(section).getByTestId(`converted-row-${B}`);
    expect(stopped).toHaveTextContent(CONVERTED_SOURCE_MISSING);
    expect(stopped).toHaveTextContent(CONVERTED_STATUS.stopped);
    expect(within(section).getByTestId(`converted-row-${C}`)).toHaveTextContent(CONVERTED_SOURCE_UNKNOWN);
    expect(within(section).getByTestId('converted-count')).toHaveTextContent('2 converted and paying · 1 converted, no longer paying');

    // AC-173: the finance request once, the subscriptions request once, and nothing for the list.
    await within(panel).findByTestId('plans-subscriptions-empty');
    const urls = fetchMock.mock.calls.map((call) => String(call[0]));
    expect(urls.filter((u) => u.startsWith('/api/admin/business-os/finance'))).toHaveLength(1);
    expect(urls.filter((u) => u.startsWith(SUBS_ROUTE_5B))).toEqual([SUBS_ROUTE_5B]);
    expect(urls).toHaveLength(2);
  });

  it('the list: empty, partial and could-not-load states (never an empty list for a failed read)', async () => {
    mockSearch = 'tab=plans';
    window.history.replaceState(null, '', '/admin/finance?tab=plans');
    serveFinanceAndSubs({ success: true, data: payload({ paying: PAYING, converted: all({ converted: 0, stopped: 0, rows: [] }) }) });
    const first = render(<FinanceView />);
    expect(await screen.findByTestId('converted-empty')).toHaveTextContent(CONVERTED_EMPTY);
    first.unmount();

    serveFinanceAndSubs({ success: true, data: payload({ paying: PAYING, converted: all({ status: 'partial' }) }) });
    const second = render(<FinanceView />);
    expect(await screen.findByTestId('converted-notice-partial')).toHaveTextContent(CONVERTED_PARTIAL);
    expect(screen.getByTestId('converted-count')).toHaveTextContent('At least 2');
    second.unmount();

    serveFinanceAndSubs({ success: true, data: payload({ paying: PAYING, converted: all({ status: 'unknown', converted: null, paying: null, stopped: null, rows: null }) }) });
    render(<FinanceView />);
    const section = await screen.findByTestId('section-converted-this-month');
    expect(section).toHaveAttribute('data-status', 'unknown');
    expect(within(section).queryByTestId('converted-empty')).toBeNull();
  });
});

// ── Money MK-6 (§6 items 14 and 15, BD-38; UI short path): payment problems where they belong ──
describe('Money MK-6: payment problems in Revenue and Client payments', () => {
  const boosts = (): NonNullable<FinancePaymentProblemsSection['boosts']> => ({
    status: 'ok',
    figures: {
      empty: false, exact: true, openDisputes: 1, notCredited: 0, openedDates: 'read', eventsOnUnpaidPurchases: 0, overTotal: 0,
      lines: [{ currency: 'USD', openDisputes: 1, held: 8, oldestDisputeOpenedAt: '2026-10-04T09:00:00.000Z', notCredited: 0, notCreditedAmount: null, oldestNotCreditedAt: null }],
    },
  });

  it('no Payment problems section; our boosts in Revenue, the clients\u2019 problems in Client payments; one request', async () => {
    const fetchMock = serve({ success: true, data: payload({ paymentProblems: paymentProblemsSection({ boosts: boosts() }) }) });
    render(<FinanceView />);
    const revenue = await screen.findByTestId('section-revenue');
    expect(screen.queryByTestId('section-payment-problems')).toBeNull();
    expect(document.getElementById('payment-problems')).toBeNull();
    expect(within(revenue).getByTestId('problems-boosts')).toHaveTextContent(BOOST_PROBLEMS_TITLE);
    expect(within(revenue).queryByTestId('problems-clients')).toBeNull();
    const takings = screen.getByTestId('section-takings');
    expect(within(takings).getByTestId('problems-clients')).toBeInTheDocument();
    expect(within(takings).queryByTestId('problems-boosts')).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('each block still shows when its host section could not load (its own reads)', async () => {
    serve({
      success: true,
      data: payload({
        revenue: { ...revenueSection(), status: 'unknown' },
        takings: { ...takingsSection(), status: 'unknown', figures: null },
        paymentProblems: paymentProblemsSection({ boosts: boosts() }),
      }),
    });
    render(<FinanceView />);
    const revenue = await screen.findByTestId('section-revenue');
    expect(revenue).toHaveAttribute('data-status', 'unknown');
    expect(within(revenue).getByTestId('problems-boosts')).toBeInTheDocument();
    const takings = screen.getByTestId('section-takings');
    expect(takings).toHaveAttribute('data-status', 'unknown');
    expect(within(takings).getByTestId('problems-clients')).toBeInTheDocument();
    expect(screen.getByTestId('section-takings-badge')).toHaveTextContent(TAKINGS_CHIP);
  });

  it('a business picked: the boost problems keep their Businesses link, inside Revenue', async () => {
    mockSearch = `accountId=${A}`;
    window.history.replaceState(null, '', `/admin/finance?accountId=${A}`);
    serve({ success: true, data: payload({ accountId: A, paymentProblems: paymentProblemsSection({ boosts: boosts() }) }) });
    render(<FinanceView />);
    const revenue = await screen.findByTestId('section-revenue');
    expect(within(revenue).getByTestId('problems-boosts-link')).toBeInTheDocument();
  });
});

// ── Money MK-8 (§3 drawer column, Q-7): the read-only Finance drawers on the page ──
describe('Money MK-8: the business drawer and the plan drawer on the page', () => {
  const SUBS_ROUTE_8 = '/api/admin/business-os/billing/subscriptions';
  const PLAN_ROUTE_8 = '/api/admin/business-os/billing/plans/tier_a';
  const SUBS_8 = {
    generatedAt: '2026-10-21T09:00:00.000Z',
    mode: 'test',
    status: null,
    totals: {
      mrr: [{ currency: 'USD', totalHundredths: 4900, cancellingHundredths: 0, pastDueHundredths: 0, subscriptions: 1, overflow: false }],
      mrrUnpriced: 0,
      mrrDiscountUnknown: 0,
      mrrPastDueCounted: true,
      paidByPlan: [{ id: 'tier_a', name: 'Plan A', accounts: 1 }],
      byStatus: { ended: 0, paused: 0, grace: 0, failed: 0, cancelling: 0, active: 1, other: 0, no_stripe: 0 },
      accounts: 1,
    },
    rows: [
      {
        accountId: A, businessName: 'Acme Dental', status: 'active', statuses: ['active'], stripeStatus: 'active',
        planBought: { id: 'tier_a', name: 'Plan A' }, planOnRecord: { id: 'tier_a', name: 'Plan A' },
        paidThrough: '2026-11-01T00:00:00.000Z', currentPeriodEnd: '2026-11-01T00:00:00.000Z', cancelAtPeriodEnd: false,
        endedAt: null, lastPaidAt: '2026-10-01T00:00:00.000Z', lastPaymentFailedAt: null, failedAttempts: 0, pendingPlan: null, discounted: false,
      },
    ],
    matching: 1,
  };
  /** The finance route (the page and the business drawer), the subscriptions list, and the plan route. */
  function serveAll(): jest.Mock {
    const fetchMock = jest.fn(async (url: string) => {
      const u = String(url);
      const body = u.startsWith(SUBS_ROUTE_8)
        ? { success: true, data: SUBS_8 }
        : u.startsWith(PLAN_ROUTE_8)
          ? { success: true, data: SUBS_8 }
          : { success: true, data: u.includes('accountId=') ? payload({ accountId: A }) : payload() };
      return { ok: true, status: 200, json: async () => body };
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- jsdom has no fetch; standard test stub
    (global as any).fetch = fetchMock;
    return fetchMock;
  }
  const urlsOf = (fetchMock: jest.Mock) => fetchMock.mock.calls.map((call) => String(call[0]));
  const openPlansTab = () => {
    mockSearch = 'tab=plans';
    window.history.replaceState(null, '', '/admin/finance?tab=plans');
  };

  it('AC-173 kept: the Overview loads with exactly one request; no drawer is open', async () => {
    const fetchMock = serveAll();
    render(<FinanceView />);
    await screen.findByTestId('section-revenue');
    expect(urlsOf(fetchMock)).toEqual(['/api/admin/business-os/finance?preset=this_month']);
    expect(screen.queryByTestId('business-drawer')).toBeNull();
    expect(screen.queryByTestId('plan-drawer')).toBeNull();
  });

  it('a subscription row opens the business drawer: one more request (this business, the page window); header, summary, own-currency client payments, Plan billing closed, Open full view', async () => {
    openPlansTab();
    const fetchMock = serveAll();
    render(<FinanceView />);
    fireEvent.click(await screen.findByTestId('subscription-quick-look'));
    const drawer = await screen.findByTestId('business-drawer');
    const body = await within(drawer).findByTestId('business-drawer-body');
    expect(urlsOf(fetchMock)).toEqual([
      '/api/admin/business-os/finance?preset=this_month',
      SUBS_ROUTE_8,
      `/api/admin/business-os/finance?preset=this_month&accountId=${A}`,
    ]);
    expect(within(body).getByTestId('account-header')).toHaveTextContent('Acme Dental');
    expect(within(body).getByTestId('account-summary')).toBeInTheDocument();
    // USD-4 (Q-10): the business's own currency sign, one line per currency, never one total.
    expect(within(body).getByTestId('business-drawer-client-line-ILS')).toHaveTextContent('gross ₪230.30 · net ₪215.30');
    expect(within(body).getByTestId('business-drawer-client-line-USD')).toHaveTextContent('gross $150.50 · net $130.50');
    expect(within(body).getByTestId('business-drawer-overdue-invoices')).toBeInTheDocument();
    // The read-only Plan billing panel (P-8a.2): shown closed, and it reads nothing until opened.
    expect(within(body).getByRole('button', { name: 'Show plan billing' })).toBeInTheDocument();
    expect(within(body).getByTestId('business-drawer-open-full')).toHaveAttribute('href', `/admin/finance?preset=this_month&accountId=${A}`);
    expect(urlsOf(fetchMock)).toHaveLength(3);
    // Read-only (§8, NG-1): the only buttons are the panel's own read toggle and the drawer's close.
    const buttons = within(drawer).getAllByRole('button').map((b) => b.textContent?.trim() || b.getAttribute('aria-label') || '');
    expect(buttons.filter((name) => name !== 'Show plan billing' && !/close/i.test(name))).toEqual([]);
  });

  it('a plan in "Paid accounts" opens the plan drawer: one more request, to the plan route; its MRR in $', async () => {
    openPlansTab();
    const fetchMock = serveAll();
    render(<FinanceView />);
    fireEvent.click(await screen.findByTestId('plans-subscriptions-plan-tier_a'));
    const drawer = await screen.findByTestId('plan-drawer');
    const body = await within(drawer).findByTestId('plan-drawer-body');
    expect(urlsOf(fetchMock)).toEqual(['/api/admin/business-os/finance?preset=this_month', SUBS_ROUTE_8, PLAN_ROUTE_8]);
    expect(within(body).getByTestId('plan-drawer-mrr-line')).toHaveTextContent(/^\$49 /);
    // The "Paid accounts" words are unchanged by the opener.
    expect(screen.getByTestId('plans-subscriptions-paid')).toHaveTextContent('1 Plan A 1');
  });
});

// ── SA-CR-MK8 CR-2: the business drawer from the AI cost top accounts, Credits and Client payments rows ──
describe('Money MK-8 CR-2: more rows open the business drawer', () => {
  function serveFinance(): jest.Mock {
    const fetchMock = jest.fn(async (url: string) => ({
      ok: true,
      status: 200,
      json: async () => ({ success: true, data: String(url).includes('accountId=') ? payload({ accountId: A }) : payload() }),
    }));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- jsdom has no fetch; standard test stub
    (global as any).fetch = fetchMock;
    return fetchMock;
  }
  const urlsOf = (fetchMock: jest.Mock) => fetchMock.mock.calls.map((call) => String(call[0]));
  const DRAWER_URL = `/api/admin/business-os/finance?preset=this_month&accountId=${A}`;

  it('openers sit inside the business cells (columns unchanged); never on the platform row; one fetch on load', async () => {
    const fetchMock = serveFinance();
    render(<FinanceView />);
    await screen.findByTestId('section-revenue');
    expect(urlsOf(fetchMock)).toEqual(['/api/admin/business-os/finance?preset=this_month']);
    // AI cost top accounts: Acme has one, the platform row none.
    const top = screen.getByTestId('ai-top');
    expect(within(top).getByTestId(`ai-top-quick-look-${A}`)).toHaveAttribute('aria-label', 'Quick look at Acme Dental');
    expect(within(top).queryByTestId('ai-top-quick-look-00000000-0000-0000-0000-000000000000')).toBeNull();
    expect(within(top).getAllByRole('columnheader')).toHaveLength(3);
    // Credits rows and Client payments rows.
    expect(screen.getByTestId(`credits-quick-look-${A}`)).toBeInTheDocument();
    expect(screen.getByTestId(`takings-quick-look-${A}-USD`)).toBeInTheDocument();
    expect(screen.queryByTestId('takings-quick-look-00000000-0000-0000-0000-000000000000-USD')).toBeNull();
  });

  it.each([
    ['the AI cost top accounts', `ai-top-quick-look-${A}`],
    ['the Credits rows', `credits-quick-look-${A}`],
    ['the Client payments rows', `takings-quick-look-${A}-USD`],
  ])('%s: the opener opens the same business drawer with exactly one more request', async (_where, testId) => {
    const fetchMock = serveFinance();
    render(<FinanceView />);
    fireEvent.click(await screen.findByTestId(testId));
    const drawer = await screen.findByTestId('business-drawer');
    await within(drawer).findByTestId('business-drawer-body');
    expect(urlsOf(fetchMock)).toEqual(['/api/admin/business-os/finance?preset=this_month', DRAWER_URL]);
    // Opened from a non-subscription row: no Plan billing panel.
    expect(within(drawer).queryByRole('button', { name: 'Show plan billing' })).toBeNull();
  });

  it('with a business picked there are no openers (the page already is that business)', async () => {
    mockSearch = `accountId=${A}`;
    window.history.replaceState(null, '', `/admin/finance?accountId=${A}`);
    serveFinance();
    render(<FinanceView />);
    await screen.findByTestId('account-header');
    expect(screen.queryAllByTestId(/quick-look/)).toHaveLength(0);
  });
});
