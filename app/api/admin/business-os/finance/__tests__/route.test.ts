/**
 * GET /api/admin/business-os/finance (finance & business health slice 1a):
 * the REAL `requireAdmin` (401 / 403 before any read, including a user whose
 * `profiles.role` says admin, SA-WR-6), 400 on every invalid query (AC-4,
 * AC-33, AC-34), 404 for a platform account or a business with no plan row
 * (AC-5), 200 with the window from the server clock (AC-25), the account
 * scope through the route (AC-42), one accountability log line with no name
 * (AC-30), 500 without internals (AC-36) and `no-store` on every status
 * (AC-35).
 *
 * Slice 1b: the credits section in the payload, AC-42 for the credit and lot
 * reads through the route, and the info line's credit statuses and counts
 * with no credit figure (AC-30, SA-WR-13). The wiring is faked whole, and its
 * `credits.getSnapshots` is a fake (SA-WR-10): the real entitlement service is
 * never reached.
 *
 * Slice 1c: the renamed billing and revenue reads, and two billing rows for the
 * picked business giving 200 with the "Tier set" fallback (AC-82, SA-WR-28).
 *
 * Slice 2a: the takings block in the payload (every money key beside its
 * currency, AC-48), `?currency=` refused (AC-46), the picked business through
 * the route (AC-65), a failed takings read is 200 with that block alone
 * unknown (AC-66), and the info line's takings status and counts with no
 * amount, currency code or name (AC-69).
 *
 * Slice 2b: the client payment problems block in the payload; the reminder
 * read bound by the route to exactly `({ correlationId, adminId },
 * 'payment_reminders', <Date>, { signal })` and never called with a business
 * picked (SA-WR-24, AC-61, AC-65); every read failing alone (AC-66); no client
 * data key in the block (AC-64); the info line's block statuses and counts
 * with no amount, currency, due date or name (AC-69); and the six new reads
 * plus the reminder read in `allReads()`, so every 401 / 403 / 400 case proves
 * zero calls on them (AC-45, AC-46).
 *
 * Slice 4a: "Our revenue" with its boosts in the payload (every money key
 * beside its currency, `tiles.k5.money` included, AC-92 / SA-WR-34), no
 * Stripe or lot field (AC-98), the picked business through the route (AC-96),
 * a failed boost read is 200 with K-5 "Unknown" (AC-95), the two boost reads
 * in `allReads()` (AC-99), and the info line's `revenueBoosts` and
 * `counts.boosts` with no amount, currency or package (AC-98).
 *
 * Slice 5a (Money M-2): R-m and R-m′ are in `mockDeps.finance`, so
 * `allReads()` covers them in every 401 / 403 / 400 case (AC-128). With a
 * business picked, R-m′ gets exactly the id and R-m and R-d have ZERO calls
 * (AC-123, SA-Q35; the 4a "R-d with no argument" pins are rewritten). The
 * payload's plans, totals and K-5 money keep every money key beside its
 * currency, with no Stripe, refusal, plan_written or mode key (AC-127), and the
 * info line carries `sections.revenuePlans`, `counts.plans` and
 * `counts.revenueExistence` with no amount, currency or tier.
 *
 * Money M-4 (OV-5, T7-B): the two usage-log readers are faked at the
 * repository boundary (their limits stay real) and join `allReads()`, so every
 * 401 / 403 / 400 case proves zero calls on them (AC-157). The AC-145 baseline
 * is updated ONCE, by SA ruling E-55: one added read with its exact arguments,
 * one `recorded` assertion and a new hash; nothing else in it changes.
 */

import * as fs from 'fs';
import * as path from 'path';
import { NextRequest } from 'next/server';

const mockGetUser = jest.fn();
jest.mock('@/lib/auth', () => ({ getUser: () => mockGetUser() }));

const mockIsAdmin = jest.fn();
jest.mock('@/lib/services/AdminAccessService', () => ({
  AdminAccessService: { getInstance: () => ({ isAdmin: (...args: unknown[]) => mockIsAdmin(...args) }) },
}));

const mockRecordRefused = jest.fn(async () => undefined);
jest.mock('@/lib/audit/recordRefusedAccess', () => ({
  recordRefusedAccess: (...a: unknown[]) => (mockRecordRefused as (...b: unknown[]) => Promise<void>)(...a),
}));

// A user-writable profile that claims admin (SA-WR-6): the gate must not read it.
const mockProfileFind = jest.fn(async () => ({ data: { id: 'x', role: 'admin' }, error: null }));
jest.mock('@/lib/repositories/UserProfileRepository', () => ({
  UserProfileRepository: jest.fn().mockImplementation(() => ({ findById: mockProfileFind })),
  userProfileRepository: { findById: mockProfileFind },
}));

const mockLog = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
jest.mock('@/lib/logger', () => {
  const make = (): Record<string, unknown> => {
    const logger: Record<string, unknown> = {
      info: (...a: unknown[]) => mockLog.info(...a),
      warn: (...a: unknown[]) => mockLog.warn(...a),
      error: (...a: unknown[]) => mockLog.error(...a),
      debug: (...a: unknown[]) => mockLog.debug(...a),
    };
    logger.child = () => logger;
    return logger;
  };
  return { createLogger: () => make() };
});

const mockDeps = {
  plans: { pagePlans: jest.fn() },
  findPlanForAccount: jest.fn(),
  ledger: {
    listRowsOfAllAccountsCreatedInRange: jest.fn(),
    listRowsForAccountCreatedInRange: jest.fn(),
    findChargesByActionIds: jest.fn(),
  },
  finance: {
    listBillingStatusesAllAccounts: jest.fn(),
    findBillingStatusForAccount: jest.fn(),
    countRevenueRows: jest.fn(),
    listClientPaymentsAllAccountsPaidInRange: jest.fn(),
    listClientPaymentsForAccountPaidInRange: jest.fn(),
    listClientRefundsAllAccountsCreatedInRange: jest.fn(),
    listClientRefundsForAccountCreatedInRange: jest.fn(),
    listOverdueClientInvoicesAllAccounts: jest.fn(),
    listOverdueClientInvoicesForAccount: jest.fn(),
    listOverdueClientInstalmentsAllAccounts: jest.fn(),
    listOverdueClientInstalmentsForAccount: jest.fn(),
    listClientPlansAllAccounts: jest.fn(),
    listClientPlansForAccount: jest.fn(),
    // Slice 4a: R-k and R-k′.
    listBoostPurchasesAllAccountsPaidInRange: jest.fn(),
    listBoostPurchasesForAccountPaidInRange: jest.fn(),
    // Slice 5a: R-m and R-m′.
    listPlanPaymentsAllAccountsPaidInRange: jest.fn(),
    listPlanPaymentsForAccountPaidInRange: jest.fn(),
  },
  credits: {
    getSnapshots: jest.fn(),
    findPeriodAnchorsBatch: jest.fn(),
    listTotalsForAccountsInRange: jest.fn(),
  },
  lots: {
    allAccounts: jest.fn(),
    forAccount: jest.fn(),
  },
};
jest.mock('@/lib/business-os/finance/financeHealthDeps', () => {
  const { getEntitlementConfig } = jest.requireActual('@/lib/business-os/entitlements/source');
  return {
    financeHealthDeps: () => ({
      ...mockDeps,
      config: getEntitlementConfig(),
      isPlatformAccount: (id: string) => id === '00000000-0000-0000-0000-000000000000',
    }),
  };
});

const mockFindNames = jest.fn();
jest.mock('@/lib/repositories/BusinessProfileRepository', () => ({
  businessProfileRepository: { findAdminIdentitiesByUserIds: (...a: unknown[]) => mockFindNames(...a) },
}));

// Slice 2b: R-j, the jobs & queues admin read, faked at the repository boundary.
const mockReadQueueFigures = jest.fn();
jest.mock('@/lib/repositories/AdminJobsQueuesRepository', () => ({
  adminJobsQueuesRepository: { readQueueFiguresAllAccounts: (...a: unknown[]) => mockReadQueueFigures(...a) },
}));

// Money M-4: the two usage-log readers, faked at the repository boundary (SA-WR-3). Each fake holds
// ONLY the one method the route may call, and the modules' real limits are kept.
const mockRecordedAllAccounts = jest.fn();
jest.mock('@/lib/repositories/AdminTokenUsageAnalyticsRepository', () => ({
  ...jest.requireActual('@/lib/repositories/AdminTokenUsageAnalyticsRepository'),
  adminTokenUsageAnalyticsRepository: { listCostPointsAllAccountsInWindow: (...a: unknown[]) => mockRecordedAllAccounts(...a) },
}));
const mockRecordedForAccount = jest.fn();
jest.mock('@/lib/repositories/TokenUsageRepository', () => ({
  ...jest.requireActual('@/lib/repositories/TokenUsageRepository'),
  tokenUsageRepository: { listCallsInWindow: (...a: unknown[]) => mockRecordedForAccount(...a) },
}));

// Fix round 1: the real pass by default; one test makes it THROW (it is documented never to).
const mockThrowFromPositions = { on: false };
jest.mock('@/lib/business-os/credits/adminCreditPercent', () => {
  const actual = jest.requireActual('@/lib/business-os/credits/adminCreditPercent');
  return {
    ...actual,
    readAdminCreditPositions: (...a: unknown[]) => {
      if (mockThrowFromPositions.on) throw new Error('positions pass exploded');
      return actual.readAdminCreditPositions(...a);
    },
  };
});

import { GET } from '../route';
import { bosRowFilter } from '@/lib/business-os/llm/callCatalog';

const ADMIN = { id: '11111111-1111-4111-8111-111111111111', email: 'ops@example.com' };
const OWNER = {
  id: '2f734ed5-3681-4049-880d-3de7b096bea3',
  email: 'owner@example.com',
  // Self-promotion signals the platform must ignore.
  app_metadata: { role: 'admin' },
  user_metadata: { role: 'admin' },
  role: 'admin',
};
const ACCOUNT = '99999999-9999-4999-8999-999999999999';
const PLATFORM = '00000000-0000-0000-0000-000000000000';
const NAME = 'Alpha Studio Secret Name';
const INVALID_QUERY = 'The filters are not valid. Check the dates, the window and the business.';

const call = (query = '') => GET(new NextRequest(`http://localhost/api/admin/business-os/finance${query}`));
const asAdmin = () => {
  mockGetUser.mockResolvedValue(ADMIN);
  mockIsAdmin.mockResolvedValue(true);
};
const todayUtc = () => new Date().toISOString().slice(0, 10);
const daysFromToday = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

function plan(user_id: string) {
  return {
    user_id, tier: null, plan_version: 1, tier_expires_at: null, cohort: null, cohort_expires_at: null,
    onboarding_started_at: null, profile_created_at: null, trial_started_at: null, trial_ends_at: null,
    grace_ends_at: null, period_anchor: '2026-09-01T00:00:00Z', origin: 'trigger', updated_by_admin_id: null,
    created_at: '2026-09-01T00:00:00Z', updated_at: '2026-09-01T00:00:00Z',
  };
}

function chargeRow(user_id: string) {
  return {
    id: 'r1', kind: 'charge', action_id: 'aaaaaaaa-aaaa-4aaa-8aaa-000000000001', adjusts_action_id: null,
    reason_code: null, user_id, period_start: '2026-10-01T00:00:00+00:00', group_id: null,
    credits: '2.000000', cost_usd: '1.2345000000', credit_value_version: 0, is_fallback_priced: false,
    service: 'ai', action_type: 'chat_turn', triggered_by: 'owner', outcome: 'succeeded', created_at: '2026-10-01T10:00:00+00:00',
  };
}

/** A real snapshot of the config's first cohort plan: the credit pass reads a real allowance. */
function snapshot() {
  const { getEntitlementConfig } = jest.requireActual('@/lib/business-os/entitlements/source');
  const { resolveEntitlements } = jest.requireActual('@/lib/business-os/entitlements/resolver');
  const { previewAccountFor } = jest.requireActual('@/lib/business-os/entitlements/planPresentation');
  const config = getEntitlementConfig();
  const planId = Object.keys(config.cohorts)[0];
  const now = new Date();
  return { resolution: resolveEntitlements({ config, account: previewAccountFor(config, planId, now), overrides: [], addons: [], now }), unavailable: false, stale: false };
}

/** A client payment figure that must never reach a log line (AC-69). */
const TAKINGS_FIGURE = '9876.54';
function clientPayment(user_id: string, amount: string, currency: string) {
  return {
    id: 'cccccccc-0000-4000-8000-000000000001', user_id, amount, currency, status: 'succeeded',
    paid_at: '2026-10-02T10:00:00+00:00', processor_fee: '1.10', fee_currency: 'USD', processor_type: 'stripe',
  };
}
function clientRefund(user_id: string, amount: string, currency: string) {
  return { id: 'dddddddd-0000-4000-8000-000000000001', user_id, amount, currency, status: 'succeeded', created_at: '2026-10-03T10:00:00+00:00' };
}

/** Slice 2b: an overdue amount, a due date and a currency that must never reach a log line (AC-69). */
const OVERDUE_FIGURE = '4321.09';
const DUE_DATE = '2026-09-17';
function overdueInvoice(user_id: string) {
  return { id: 'ffffffff-0000-4000-8000-000000000001', user_id, amount: OVERDUE_FIGURE, currency: 'eur', status: 'overdue', due_date: DUE_DATE };
}
function pendingInstalment(user_id: string) {
  return { id: 'ffffffff-0000-4000-8000-000000000002', user_id, amount: '55.00', currency: 'EUR', status: 'pending', due_date: '2020-01-01' };
}
function clientPlan(user_id: string) {
  return {
    id: 'ffffffff-0000-4000-8000-000000000003', user_id, status: 'active', cancelled_at: null, completed_at: null,
    next_charge_at: '2099-01-01T00:00:00Z', last_failure_at: null,
  };
}
const REMINDER_FIGURES = {
  dueNow: 3, later: 1, noDueTime: null, inProgress: 0, stuck: 1, failed24h: 0, failed7d: 2, deadLettered24h: 0,
  deadLettered7d: 1, skipped7d: 0, guardrailSkips7d: null, unrecognisedStatus: 0, oldestDueAt: '2026-10-01T09:00:00.000Z',
};

/** Slice 4a: a boost amount (minor units) and a package id that must never reach a log line (AC-98). */
const BOOST_MINOR = 123457;
const BOOST_PACKAGE = 'pkg-secret-name';
function boostPurchase(user_id: string | null) {
  return {
    id: 'abababab-0000-4000-8000-000000000001', user_id, status: 'paid', package_id: BOOST_PACKAGE, package_version: 3,
    currency: 'USD', amount_total_minor: BOOST_MINOR, amount_tax_minor: 0, amount_refunded_minor: 0,
    credits_total: '5000.000000', paid_at: '2026-10-02T10:00:00+00:00',
  };
}

/** Credit figures that must never reach a log line (AC-30). */
const USED_FIGURE = '7.123456';
const GIFTED_FIGURE = 13.5;

function seed() {
  const ledger = { data: { rows: [chargeRow(ACCOUNT)], reachedCeiling: false }, error: null };
  mockDeps.credits.getSnapshots.mockImplementation(async (ids: string[]) => new Map(ids.map((id) => [id, snapshot()])));
  mockDeps.credits.findPeriodAnchorsBatch.mockImplementation(async (ids: string[]) => ({
    data: Object.fromEntries(ids.map((id) => [id, '2026-09-01T00:00:00Z'])),
    error: null,
  }));
  mockDeps.credits.listTotalsForAccountsInRange.mockImplementation(async (ids: string[]) => ({
    data: { rows: ids.map((id) => ({ user_id: id, period_start: `${todayUtc().slice(0, 8)}01T00:00:00+00:00`, credits_total: USED_FIGURE })), reachedCeiling: false },
    error: null,
  }));
  const gift = [{
    id: '44444444-4444-4444-8444-000000000001', accountId: ACCOUNT, source: 'admin_grant', creditsGranted: GIFTED_FIGURE,
    expiresAt: null, createdAt: '2026-09-02T00:00:00Z', actorAdminId: ADMIN.id, draws: [],
  }];
  mockDeps.lots.allAccounts.mockResolvedValue({ data: gift, error: null });
  mockDeps.lots.forAccount.mockResolvedValue({ data: gift, error: null });
  mockDeps.plans.pagePlans.mockResolvedValue({ data: [plan(ACCOUNT)], error: null });
  mockDeps.findPlanForAccount.mockResolvedValue({ data: { plan: plan(ACCOUNT) }, error: null });
  mockDeps.ledger.listRowsOfAllAccountsCreatedInRange.mockResolvedValue(ledger);
  mockDeps.ledger.listRowsForAccountCreatedInRange.mockResolvedValue(ledger);
  mockDeps.ledger.findChargesByActionIds.mockResolvedValue({ data: [], error: null });
  mockDeps.finance.listBillingStatusesAllAccounts.mockResolvedValue({ data: [], error: null });
  mockDeps.finance.findBillingStatusForAccount.mockResolvedValue({ data: null, error: null });
  mockDeps.finance.countRevenueRows.mockResolvedValue({ data: { planInvoicesPaid: 0, boostsPaid: 0 }, error: null });
  const payments = { data: { rows: [clientPayment(ACCOUNT, TAKINGS_FIGURE, 'ils')], reachedCeiling: false }, error: null };
  const refunds = { data: { rows: [clientRefund(ACCOUNT, '76.54', 'ILS')], reachedCeiling: false }, error: null };
  mockDeps.finance.listClientPaymentsAllAccountsPaidInRange.mockResolvedValue(payments);
  mockDeps.finance.listClientPaymentsForAccountPaidInRange.mockResolvedValue(payments);
  mockDeps.finance.listClientRefundsAllAccountsCreatedInRange.mockResolvedValue(refunds);
  mockDeps.finance.listClientRefundsForAccountCreatedInRange.mockResolvedValue(refunds);
  mockFindNames.mockResolvedValue({ data: [{ user_id: ACCOUNT, company_name: NAME }], error: null });
  const invoices = { data: { rows: [overdueInvoice(ACCOUNT)], reachedCeiling: false }, error: null };
  const instalments = { data: { rows: [pendingInstalment(ACCOUNT)], reachedCeiling: false }, error: null };
  const plans = { data: { rows: [clientPlan(ACCOUNT)], reachedCeiling: false }, error: null };
  mockDeps.finance.listOverdueClientInvoicesAllAccounts.mockResolvedValue(invoices);
  mockDeps.finance.listOverdueClientInvoicesForAccount.mockResolvedValue(invoices);
  mockDeps.finance.listOverdueClientInstalmentsAllAccounts.mockResolvedValue(instalments);
  mockDeps.finance.listOverdueClientInstalmentsForAccount.mockResolvedValue(instalments);
  mockDeps.finance.listClientPlansAllAccounts.mockResolvedValue(plans);
  mockDeps.finance.listClientPlansForAccount.mockResolvedValue(plans);
  mockReadQueueFigures.mockResolvedValue({ data: REMINDER_FIGURES, error: null });
  const boosts = { data: { rows: [boostPurchase(ACCOUNT)], reachedCeiling: false }, error: null };
  mockDeps.finance.listBoostPurchasesAllAccountsPaidInRange.mockResolvedValue(boosts);
  mockDeps.finance.listBoostPurchasesForAccountPaidInRange.mockResolvedValue(boosts);
  // Slice 5a: no plan payment by default (so the 4a K-5 figures stand); the 5a describe seeds its own.
  const noPlans = { data: { rows: [], reachedCeiling: false }, error: null };
  mockDeps.finance.listPlanPaymentsAllAccountsPaidInRange.mockResolvedValue(noPlans);
  mockDeps.finance.listPlanPaymentsForAccountPaidInRange.mockResolvedValue(noPlans);
  // Money M-4: one recorded row each, against the one 1.2345 charge.
  mockRecordedAllAccounts.mockResolvedValue({ data: { rows: [costPoint()], reachedCeiling: false, completed: true, pages: 1 }, error: null });
  mockRecordedForAccount.mockResolvedValue({ data: { rows: [ledgerCall()], reachedCeiling: false }, error: null });
}

/** Money M-4: a recorded cost, a feature value and a session id that must never reach a log line or the payload (AC-164). */
const RECORDED_COST = '1.9876543';
const RECORDED_FEATURE = 'business-os-secret-feature';
const RECORDED_SESSION = 'sess-secret-777';
function costPoint() {
  return { id: 'usage-row-1', created_at: '2026-10-02T10:00:00+00:00', cost_usd: RECORDED_COST };
}
function ledgerCall() {
  return {
    id: 'usage-row-2', created_at: '2026-10-02T10:00:00+00:00', feature: RECORDED_FEATURE, component: 'chat',
    session_id: RECORDED_SESSION, input_tokens: 10, output_tokens: 20, cost_usd: RECORDED_COST, success: true, error_code: null,
  };
}

const allReads = () => [
  mockDeps.plans.pagePlans,
  mockDeps.findPlanForAccount,
  ...Object.values(mockDeps.ledger),
  ...Object.values(mockDeps.finance),
  ...Object.values(mockDeps.credits),
  ...Object.values(mockDeps.lots),
  mockFindNames,
  // Slice 2b: R-j. Every 401 / 403 / 400 case proves zero calls on it too (AC-45, AC-46).
  mockReadQueueFigures,
  // Money M-4: both recorded reads (AC-157).
  mockRecordedAllAccounts,
  mockRecordedForAccount,
];
const noReadHappened = () => {
  for (const fn of allReads()) expect(fn).not.toHaveBeenCalled();
};
const expectNoStore = (res: Response) => expect(res.headers.get('cache-control')).toBe('no-store');

beforeEach(() => {
  jest.clearAllMocks();
  seed();
});

describe('authz: the real requireAdmin, before anything else', () => {
  it('AC-1: 401 when signed out, no data, no-store', async () => {
    mockGetUser.mockResolvedValue(null);
    const res = await call();
    expect(res.status).toBe(401);
    expectNoStore(res);
    expect((await res.json()).data).toBeUndefined();
    noReadHappened();
  });

  it('AC-2: 403 for a signed-in non-admin, no-store, no read', async () => {
    mockGetUser.mockResolvedValue(OWNER);
    mockIsAdmin.mockResolvedValue(false);
    const res = await call();
    expect(res.status).toBe(403);
    expectNoStore(res);
    noReadHappened();
  });

  it('SA-WR-6: 403 for a user whose profiles.role (and metadata) say admin, when admin_users says no', async () => {
    mockGetUser.mockResolvedValue(OWNER);
    mockIsAdmin.mockResolvedValue(false);
    const res = await call(`?accountId=${ACCOUNT}`);
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ success: false, error: 'Forbidden' });
    // The only admin signal asked is the admin_users check.
    expect(mockIsAdmin).toHaveBeenCalledWith({ id: OWNER.id, email: OWNER.email });
    expect(mockProfileFind).not.toHaveBeenCalled();
    noReadHappened();
  });

  it('403, not 400, for a non-admin with an invalid query: validation never runs first', async () => {
    mockGetUser.mockResolvedValue(OWNER);
    mockIsAdmin.mockResolvedValue(false);
    expect((await call('?preset=nope&preset=x')).status).toBe(403);
  });
});

describe('validation (AC-4, AC-33, AC-34)', () => {
  beforeEach(asAdmin);

  it.each([
    ['an unknown preset', '?preset=year'],
    ['custom without dates', '?preset=custom'],
    ['custom with to before from', '?preset=custom&from=2026-10-05&to=2026-10-01'],
    ['a malformed account id', '?accountId=acme'],
    ['an unknown key', '?preset=today&name=Acme'],
    ['a malformed from on a preset (format-checked even when ignored)', '?preset=7d&from=2026-1-1'],
  ])('%s → 400, standard body, no details outside development, no-store, no read', async (_name, query) => {
    const res = await call(query);
    expect(res.status).toBe(400);
    expectNoStore(res);
    const body = await res.json();
    // QA-3: a short message for the admin; Zod's detail never outside development.
    expect(body).toEqual({ success: false, error: INVALID_QUERY });
    noReadHappened();
  });

  it('QA-3: in development, the 400 carries Zod\u2019s detail under details', async () => {
    const env = process.env as Record<string, string | undefined>;
    const previous = env.NODE_ENV;
    env.NODE_ENV = 'development';
    try {
      const body = await (await call('?preset=custom&from=2026-10-05&to=2026-10-01')).json();
      expect(body.error).toBe(INVALID_QUERY);
      expect(body.details.issue).toBe('The start date must not be after the end date');
      expect(body.details.formErrors).toBeDefined();
    } finally {
      env.NODE_ENV = previous;
    }
  });

  it('AC-33: a repeated key → 400 before Zod', async () => {
    const res = await call('?preset=today&preset=today');
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('Each query parameter may appear once');
  });

  it('AC-34: to = tomorrow → 400 (no tolerance)', async () => {
    const res = await call(`?preset=custom&from=${todayUtc()}&to=${daysFromToday(1)}`);
    expect(res.status).toBe(400);
  });

  it('AC-34: 92 inclusive days → 200; 93 → 400', async () => {
    expect((await call(`?preset=custom&from=${daysFromToday(-91)}&to=${todayUtc()}`)).status).toBe(200);
    expect((await call(`?preset=custom&from=${daysFromToday(-92)}&to=${todayUtc()}`)).status).toBe(400);
  });
});

describe('not found (AC-5, SA-F14)', () => {
  beforeEach(asAdmin);

  it('404 "Business not found" for a platform account id, before any read', async () => {
    const res = await call(`?accountId=${PLATFORM}`);
    expect(res.status).toBe(404);
    expectNoStore(res);
    expect(await res.json()).toEqual({ success: false, error: 'Business not found' });
    noReadHappened();
  });

  it('404 for a well-formed id with no plan row, and no further read', async () => {
    mockDeps.findPlanForAccount.mockResolvedValue({ data: { plan: null }, error: null });
    const res = await call(`?accountId=${ACCOUNT}`);
    expect(res.status).toBe(404);
    expectNoStore(res);
    expect(await res.json()).toEqual({ success: false, error: 'Business not found' });
    expect(mockDeps.ledger.listRowsForAccountCreatedInRange).not.toHaveBeenCalled();
    // Money M-4 (tenant isolation): a foreign id never reaches either recorded read.
    expect(mockRecordedForAccount).not.toHaveBeenCalled();
    expect(mockRecordedAllAccounts).not.toHaveBeenCalled();
  });

  it('500 "Could not check this business" when the check fails', async () => {
    mockDeps.findPlanForAccount.mockResolvedValue({ data: null, error: new Error('down') });
    const res = await call(`?accountId=${ACCOUNT}`);
    expect(res.status).toBe(500);
    expectNoStore(res);
    expect((await res.json()).error).toBe('Could not check this business. Try again.');
  });
});

describe('200', () => {
  beforeEach(asAdmin);

  it('returns every section with no-store; the default preset is this month', async () => {
    const res = await call();
    expect(res.status).toBe(200);
    expectNoStore(res);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.window.preset).toBe('this_month');
    expect(body.data.window.to).toBe(todayUtc());
    expect(Object.keys(body.data).sort()).toEqual(['accountId', 'accounts', 'aiCost', 'credits', 'generatedAt', 'paymentProblems', 'revenue', 'takings', 'tiles', 'window']);
    expect(Object.keys(body.data.tiles).sort()).toEqual(['k1', 'k2', 'k3', 'k4', 'k5']);
    expect(body.data.credits.status).toBe('ok');
    expect(body.data.tiles.k4.value).toEqual({ value: GIFTED_FIGURE, exact: true });
  });

  it('AC-25: a preset with client from / to → the window comes from the server clock', async () => {
    const res = await call('?preset=7d&from=2020-01-01&to=2020-01-02');
    const body = await res.json();
    expect(body.data.window.from).toBe(daysFromToday(-6));
    expect(body.data.window.to).toBe(todayUtc());
  });

  it('AC-27: a failed section is 200 with that section unknown', async () => {
    mockDeps.ledger.listRowsOfAllAccountsCreatedInRange.mockResolvedValue({ data: null, error: new Error('x') });
    const res = await call();
    expect(res.status).toBe(200);
    expect((await res.json()).data.aiCost.status).toBe('unknown');
  });

  it('AC-42 through the route: with accountId, no all-accounts read, every scoped read gets exactly the id', async () => {
    const res = await call(`?accountId=${ACCOUNT}`);
    expect(res.status).toBe(200);
    expect(mockDeps.plans.pagePlans).not.toHaveBeenCalled();
    expect(mockDeps.ledger.listRowsOfAllAccountsCreatedInRange).not.toHaveBeenCalled();
    expect(mockDeps.finance.listBillingStatusesAllAccounts).not.toHaveBeenCalled();
    expect(mockDeps.findPlanForAccount).toHaveBeenCalledWith(ACCOUNT);
    expect(mockDeps.finance.findBillingStatusForAccount).toHaveBeenCalledWith(ACCOUNT);
    for (const [id] of mockDeps.ledger.listRowsForAccountCreatedInRange.mock.calls) expect(id).toBe(ACCOUNT);
    // SA-Q35 (slice 5a): no platform-wide read with a business picked; R-m′ gets exactly the id.
    expect(mockDeps.finance.countRevenueRows).not.toHaveBeenCalled();
    expect(mockDeps.finance.listPlanPaymentsAllAccountsPaidInRange).not.toHaveBeenCalled();
    for (const [id] of mockDeps.finance.listPlanPaymentsForAccountPaidInRange.mock.calls) expect(id).toBe(ACCOUNT);
    expect(mockFindNames).toHaveBeenCalledWith([ACCOUNT]);
  });

  it('AC-82 / AC-85 (slice 1c, SA-WR-28): two billing rows make the picked read fail → 200, Section 1 "Tier set", no Founding Partner note', async () => {
    mockDeps.finance.findBillingStatusForAccount.mockResolvedValue({
      data: null,
      error: new Error('JSON object requested, multiple (or no) rows returned'),
    });
    const res = await call(`?accountId=${ACCOUNT}`);
    expect(res.status).toBe(200);
    const accounts = (await res.json()).data.accounts;
    expect(accounts.status).toBe('ok');
    expect(accounts.figures.payingKnown).toBe(false);
    expect(accounts.figures.groups.map((g: { key: string }) => g.key)).toContain('tier_set');
    expect(accounts.figures.groups.every((g: { foundingPartners: number }) => g.foundingPartners === 0)).toBe(true);
  });

  it('AC-42 (slice 1b) through the route: every credit and lot read gets exactly the id; the all-accounts lot read is never called', async () => {
    const res = await call(`?accountId=${ACCOUNT}`);
    expect(res.status).toBe(200);
    expect(mockDeps.lots.allAccounts).not.toHaveBeenCalled();
    expect(mockDeps.lots.forAccount).toHaveBeenCalledTimes(1);
    expect(mockDeps.lots.forAccount).toHaveBeenCalledWith(ACCOUNT);
    expect(mockDeps.credits.getSnapshots.mock.calls).toEqual([[[ACCOUNT]]]);
    expect(mockDeps.credits.findPeriodAnchorsBatch.mock.calls).toEqual([[[ACCOUNT]]]);
    expect(mockDeps.credits.listTotalsForAccountsInRange.mock.calls.map((c) => c[0])).toEqual([[ACCOUNT]]);
    for (const [ids] of mockFindNames.mock.calls) expect(ids).toEqual([ACCOUNT]);
    expect((await res.json()).data.credits.scope).toBe('one');
  });

  it('all businesses: the named all-accounts lot read, never the one-account read', async () => {
    await call();
    expect(mockDeps.lots.allAccounts).toHaveBeenCalledTimes(1);
    expect(mockDeps.lots.allAccounts).toHaveBeenCalledWith();
    expect(mockDeps.lots.forAccount).not.toHaveBeenCalled();
  });

  it('AC-27 (slice 1b): a failed credit pass and a failed lot read → 200, credits unknown, K-4 unavailable, the rest renders', async () => {
    mockDeps.credits.listTotalsForAccountsInRange.mockResolvedValue({ data: null, error: new Error('x') });
    mockDeps.lots.allAccounts.mockResolvedValue({ data: null, error: new Error('y') });
    const res = await call();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.credits.status).toBe('unknown');
    expect(body.data.tiles.k4.status).toBe('unavailable');
    expect(body.data.aiCost.status).toBe('ok');
  });

  it('fix round 1: the positions pass THROWS → still 200; Section 4 unknown, K-2 unavailable, K-4 keeps its value; logged as a read failure', async () => {
    mockThrowFromPositions.on = true;
    try {
      const res = await call();
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data.credits).toMatchObject({ status: 'unknown', figures: null });
      expect(body.data.tiles.k2).toMatchObject({ status: 'unavailable', value: null });
      expect(body.data.tiles.k4).toMatchObject({ status: 'neutral', value: { value: GIFTED_FIGURE, exact: true } });
      expect(body.data.accounts.status).toBe('ok');
      expect(body.data.aiCost.status).toBe('ok');
      expect(mockLog.error).toHaveBeenCalledWith(expect.objectContaining({ read: 'credit_positions' }), 'Finance read failed');
      expect(mockLog.error).not.toHaveBeenCalledWith(expect.anything(), 'Business OS finance read failed');
      const line = mockLog.info.mock.calls.find((c) => c[1] === 'Admin read the Business OS finance page');
      expect(line?.[0]).toMatchObject({ sections: { credits: 'unknown' }, counts: { creditsPass: 'failed', creditAccounts: 1 } });
    } finally {
      mockThrowFromPositions.on = false;
    }
  });

  it('AC-30 / SA-WR-13 (slice 1b): the info line carries the credit statuses, the credit account count and the pass outcome; no credit figure', async () => {
    await call();
    const lines = mockLog.info.mock.calls.filter((c) => c[1] === 'Admin read the Business OS finance page');
    expect(lines).toHaveLength(1);
    const [ctx] = lines[0];
    expect(ctx).toMatchObject({
      sections: { credits: 'ok' },
      tiles: { k2: expect.any(String), k4: 'neutral' },
      counts: { creditAccounts: 1, creditsPass: 'ok', creditLots: 1, creditRowsShown: 1 },
    });
    const logged = JSON.stringify([mockLog.info.mock.calls, mockLog.warn.mock.calls, mockLog.error.mock.calls]);
    expect(logged).not.toContain(USED_FIGURE);
    expect(logged).not.toContain(String(GIFTED_FIGURE));
    expect(logged).not.toContain(NAME);
  });

  it('AC-30: one info line with the admin id, filters, statuses and counts; no name, email or figure', async () => {
    await call(`?accountId=${ACCOUNT}`);
    const lines = mockLog.info.mock.calls.filter((c) => c[1] === 'Admin read the Business OS finance page');
    expect(lines).toHaveLength(1);
    const [ctx] = lines[0];
    expect(ctx).toMatchObject({
      accountId: ACCOUNT,
      sections: { revenue: 'ok', accounts: 'ok', aiCost: 'ok' },
      counts: { ledgerRows: 1, topAccounts: 1, namesFound: 1 },
    });
    const logged = JSON.stringify([mockLog.info.mock.calls, mockLog.warn.mock.calls, mockLog.error.mock.calls]);
    expect(logged).not.toContain(NAME);
    expect(logged).not.toContain(ADMIN.email);
    expect(logged).not.toContain('1.2345');
  });
});

describe('slice 2a: takings through the route', () => {
  beforeEach(asAdmin);

  it('AC-46: ?currency=USD → 400, no read (no new query parameter)', async () => {
    const res = await call('?preset=this_month&currency=USD');
    expect(res.status).toBe(400);
    expectNoStore(res);
    expect(await res.json()).toEqual({ success: false, error: INVALID_QUERY });
    noReadHappened();
  });

  it('AC-45: the four takings reads are in allReads(), so every 401 / 403 / 400 case proves zero calls on them', () => {
    for (const fn of Object.values(mockDeps.finance)) expect(allReads()).toContain(fn);
    // Slice 2b: the six overdue and plan reads joined the seven (thirteen); slice 4a: R-k and R-k′ (fifteen); slice 5a: R-m and R-m′ (seventeen).
    expect(Object.keys(mockDeps.finance)).toHaveLength(17);
  });

  it('the payload carries takings; AC-48: every money key sits beside a currency, and no money key is top-level', async () => {
    const body = await (await call()).json();
    const takings = body.data.takings;
    expect(takings.status).toBe('ok');
    expect(takings.scope).toBe('all');
    expect(takings.figures.lines).toEqual([
      { currency: 'ILS', payments: 1, gross: 9876.54, refunded: 76.54, net: 9800, businesses: 1, unreadable: 0, unreadablePayments: 0 },
    ]);
    expect(takings.figures.feeLines).toEqual([{ currency: 'USD', fees: 1.1, payments: 1 }]);
    expect(takings.figures.rows[0]).toMatchObject({ accountId: ACCOUNT, name: NAME, nameStatus: 'found', currency: 'ILS' });

    const MONEY = new Set(['gross', 'refunded', 'net', 'fees']);
    let moneyKeys = 0;
    const walk = (node: unknown, depth: number) => {
      if (Array.isArray(node)) return node.forEach((child) => walk(child, depth + 1));
      if (node === null || typeof node !== 'object') return;
      for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
        if (MONEY.has(key)) {
          moneyKeys += 1;
          expect({ key, hasCurrency: 'currency' in (node as object) }).toEqual({ key, hasCurrency: true });
          expect(depth).toBeGreaterThan(1);
        }
        walk(value, depth + 1);
      }
    };
    walk(takings, 0);
    // lines (3) + refund line (1) + fee line (1) + row (3).
    expect(moneyKeys).toBe(8);
  });

  it('AC-65 through the route: R-e′ and R-f′ get exactly the id; R-e and R-f are never called; names only [id]', async () => {
    const res = await call(`?accountId=${ACCOUNT}`);
    expect(res.status).toBe(200);
    expect(mockDeps.finance.listClientPaymentsAllAccountsPaidInRange).not.toHaveBeenCalled();
    expect(mockDeps.finance.listClientRefundsAllAccountsCreatedInRange).not.toHaveBeenCalled();
    expect(mockDeps.finance.listClientPaymentsForAccountPaidInRange).toHaveBeenCalledTimes(1);
    expect(mockDeps.finance.listClientRefundsForAccountCreatedInRange).toHaveBeenCalledTimes(1);
    expect(mockDeps.finance.listClientPaymentsForAccountPaidInRange.mock.calls[0][0]).toBe(ACCOUNT);
    expect(mockDeps.finance.listClientRefundsForAccountCreatedInRange.mock.calls[0][0]).toBe(ACCOUNT);
    for (const [ids] of mockFindNames.mock.calls) expect(ids).toEqual([ACCOUNT]);
    const body = await res.json();
    expect(body.data.takings.scope).toBe('one');
    expect(body.data.takings.figures.businesses).toBe(1);
  });

  it('AC-66 through the route: R-e fails → 200, takings unknown, every other section renders', async () => {
    mockDeps.finance.listClientPaymentsAllAccountsPaidInRange.mockResolvedValue({ data: null, error: new Error('down') });
    const res = await call();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.takings).toEqual({ status: 'unknown', scope: 'all', figures: null });
    expect(body.data.accounts.status).toBe('ok');
    expect(body.data.aiCost.status).toBe('ok');
    expect(body.data.credits.status).toBe('ok');
  });

  it('AC-66 through the route: R-f fails → 200, takings partial, refunded and net null, gross shown', async () => {
    mockDeps.finance.listClientRefundsAllAccountsCreatedInRange.mockResolvedValue({ data: null, error: new Error('down') });
    const res = await call();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.takings.status).toBe('partial');
    expect(body.data.takings.figures.lines[0]).toMatchObject({ gross: 9876.54, refunded: null, net: null });
  });

  it('AC-69: the one info line carries sections.takings and counts.takings (counts and booleans only); no amount, currency code or name in any log call', async () => {
    await call();
    const lines = mockLog.info.mock.calls.filter((c) => c[1] === 'Admin read the Business OS finance page');
    expect(lines).toHaveLength(1);
    const [ctx] = lines[0];
    expect(ctx.sections.takings).toBe('ok');
    expect(ctx.counts.takings).toEqual({
      payments: 1, refunds: 1, paymentsCeiling: false, refundsCeiling: false, otherStatusPayments: 0, refundsNotCompleted: 0,
      unreadableAmounts: 0, unreadableFees: 0, currencies: 1, rowsShown: 1, rowsTotal: 1, namesFound: 1,
    });
    for (const value of Object.values(ctx.counts.takings)) expect(['number', 'boolean']).toContain(typeof value);
    const logged = JSON.stringify([mockLog.info.mock.calls, mockLog.warn.mock.calls, mockLog.error.mock.calls, mockLog.debug.mock.calls]);
    expect(logged).not.toContain(TAKINGS_FIGURE);
    expect(logged).not.toContain('9800');
    expect(logged).not.toMatch(/\bILS\b|\bils\b/);
    expect(logged).not.toContain(NAME);
  });
});

describe('slice 2b: client payment problems through the route', () => {
  beforeEach(asAdmin);

  it('AC-45: the six new reads and the reminder read are in allReads(), so every 401 / 403 / 400 case proves zero calls on them', () => {
    for (const name of [
      'listOverdueClientInvoicesAllAccounts',
      'listOverdueClientInvoicesForAccount',
      'listOverdueClientInstalmentsAllAccounts',
      'listOverdueClientInstalmentsForAccount',
      'listClientPlansAllAccounts',
      'listClientPlansForAccount',
    ] as const) {
      expect(allReads()).toContain(mockDeps.finance[name]);
    }
    expect(allReads()).toContain(mockReadQueueFigures);
  });

  it('AC-45 / AC-46 re-run: signed out, a non-admin and an invalid query each make zero 2b calls, R-j included', async () => {
    mockGetUser.mockResolvedValue(null);
    expect((await call()).status).toBe(401);
    asAdmin();
    expect((await call('?preset=this_month&currency=EUR')).status).toBe(400);
    mockGetUser.mockResolvedValue(OWNER);
    mockIsAdmin.mockResolvedValue(false);
    expect((await call()).status).toBe(403);
    expect(mockReadQueueFigures).not.toHaveBeenCalled();
    for (const fn of Object.values(mockDeps.finance)) expect(fn).not.toHaveBeenCalled();
  });

  it('SA-WR-24 / AC-61: R-j is called once with exactly ({ correlationId, adminId }, "payment_reminders", <Date>, { signal }); the payload figures equal its return', async () => {
    const res = await GET(
      new NextRequest('http://localhost/api/admin/business-os/finance', { headers: { 'x-correlation-id': 'corr-2b-test' } })
    );
    expect(res.status).toBe(200);
    expect(mockReadQueueFigures).toHaveBeenCalledTimes(1);
    const args = mockReadQueueFigures.mock.calls[0];
    expect(args).toHaveLength(4);
    expect(args[0]).toEqual({ correlationId: 'corr-2b-test', adminId: ADMIN.id });
    expect(args[1]).toBe('payment_reminders');
    expect(args[2]).toBeInstanceOf(Date);
    expect(Object.keys(args[3])).toEqual(['signal']);
    expect(args[3].signal).toBeInstanceOf(AbortSignal);
    const body = await res.json();
    expect(body.data.paymentProblems.reminders).toEqual({
      status: 'ok',
      state: 'read',
      figures: { dueNow: 3, inProgress: 0, stuck: 1, failed24h: 0, failed7d: 2, deadLettered24h: 0, deadLettered7d: 1, oldestDueAt: '2026-10-01T09:00:00.000Z' },
    });
  });

  it('the payload: the block with its five parts, the full amounts per currency, due dates as date-only text', async () => {
    const body = await (await call()).json();
    const p = body.data.paymentProblems;
    expect(p.status).toBe('ok');
    expect(p.scope).toBe('all');
    expect(p.today).toBe(todayUtc());
    expect(p.failedPayments).toEqual({ state: 'not_stored' });
    expect(p.overdueInvoices.figures.lines).toEqual([
      { currency: 'EUR', marked: 1, pastDue: 0, amount: 4321.09, amountExact: true, unreadable: 0, businesses: 1, oldestDueDate: DUE_DATE },
    ]);
    expect(p.overdueInvoices.figures.rows[0]).toMatchObject({ accountId: ACCOUNT, name: NAME, nameStatus: 'found', dueDate: DUE_DATE, kind: 'marked' });
    expect(p.overdueInstalments.figures.rows[0]).toMatchObject({ kind: 'past_due', dueDate: '2020-01-01' });
    expect(p.clientPlans.figures).toMatchObject({ activeNow: 1, total: 1, failedCharges: { everRecorded: false, inWindow: 0 } });
  });

  it('AC-64: no key under paymentProblems names client data; every amount sits beside its currency', async () => {
    const body = await (await call()).json();
    const BANNED = new Set(['contact_id', 'email', 'phone', 'notes', 'internal_notes', 'metadata', 'line_items', 'invoice_number', 'client_name']);
    let amounts = 0;
    const walk = (node: unknown, parentKey: string | null) => {
      if (Array.isArray(node)) return node.forEach((child) => walk(child, parentKey));
      if (node === null || typeof node !== 'object') return;
      for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
        expect({ key, banned: BANNED.has(key) }).toEqual({ key, banned: false });
        // The only `name` is a business name on a table row (beside its nameStatus).
        if (key === 'name') expect('nameStatus' in (node as object)).toBe(true);
        if (key === 'amount') {
          amounts += 1;
          expect('currency' in (node as object)).toBe(true);
        }
        walk(value, key);
      }
    };
    walk(body.data.paymentProblems, null);
    // Two lines and two rows.
    expect(amounts).toBe(4);
  });

  it('AC-65 / SA-WR-24 through the route: a business picked → R-g′, R-h′, R-i′ get exactly the id; the all-accounts reads and R-j have zero calls', async () => {
    const res = await call(`?accountId=${ACCOUNT}`);
    expect(res.status).toBe(200);
    expect(mockDeps.finance.listOverdueClientInvoicesForAccount.mock.calls).toEqual([[ACCOUNT, todayUtc()]]);
    expect(mockDeps.finance.listOverdueClientInstalmentsForAccount.mock.calls).toEqual([[ACCOUNT, todayUtc()]]);
    expect(mockDeps.finance.listClientPlansForAccount.mock.calls).toEqual([[ACCOUNT]]);
    expect(mockDeps.finance.listOverdueClientInvoicesAllAccounts).not.toHaveBeenCalled();
    expect(mockDeps.finance.listOverdueClientInstalmentsAllAccounts).not.toHaveBeenCalled();
    expect(mockDeps.finance.listClientPlansAllAccounts).not.toHaveBeenCalled();
    expect(mockReadQueueFigures).not.toHaveBeenCalled();
    for (const [ids] of mockFindNames.mock.calls) expect(ids).toEqual([ACCOUNT]);
    const body = await res.json();
    expect(body.data.paymentProblems.scope).toBe('one');
    expect(body.data.paymentProblems.reminders).toEqual({ status: 'ok', state: 'not_narrowed', figures: null });
  });

  it.each([
    ['R-g', 'listOverdueClientInvoicesAllAccounts', 'overdueInvoices'],
    ['R-h', 'listOverdueClientInstalmentsAllAccounts', 'overdueInstalments'],
    ['R-i', 'listClientPlansAllAccounts', 'clientPlans'],
  ] as const)('AC-66 through the route: %s fails → 200, that part unknown, the block partial, every other section renders', async (_n, method, part) => {
    mockDeps.finance[method].mockResolvedValue({ data: null, error: new Error('down') });
    const res = await call();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.paymentProblems[part]).toEqual({ status: 'unknown', figures: null });
    expect(body.data.paymentProblems.status).toBe('partial');
    for (const section of ['accounts', 'aiCost', 'credits', 'takings']) expect(body.data[section].status).toBe('ok');
  });

  it('AC-66 through the route: R-j fails → 200, reminders failed, the block partial, the other parts ok', async () => {
    mockReadQueueFigures.mockResolvedValue({ data: null, error: new Error('queue down') });
    const res = await call();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.paymentProblems.reminders).toEqual({ status: 'unknown', state: 'failed', figures: null });
    expect(body.data.paymentProblems.status).toBe('partial');
    expect(body.data.paymentProblems.overdueInvoices.status).toBe('ok');
  });

  it('AC-69: the info line carries sections.paymentProblems and counts.paymentProblems (counts, booleans, state words); no amount, currency, due date or name in any log call', async () => {
    await call();
    const lines = mockLog.info.mock.calls.filter((c) => c[1] === 'Admin read the Business OS finance page');
    expect(lines).toHaveLength(1);
    const [ctx] = lines[0];
    expect(ctx.sections.paymentProblems).toEqual({
      block: 'ok',
      overdueInvoices: 'ok',
      overdueInstalments: 'ok',
      clientPlans: 'ok',
      reminders: 'read',
      failedPayments: 'not_stored',
    });
    expect(ctx.counts.paymentProblems).toEqual({
      invoices: 1, instalments: 1, plans: 1, invoicesCeiling: false, instalmentsCeiling: false, plansCeiling: false,
      unreadableAmounts: 0, unexpectedRows: 0, overdueRowsShown: 2, reminders: 'read', reminderMs: expect.any(Number), namesFound: 1,
    });
    for (const value of Object.values(ctx.counts.paymentProblems)) expect(['number', 'boolean', 'string']).toContain(typeof value);
    const logged = JSON.stringify([mockLog.info.mock.calls, mockLog.warn.mock.calls, mockLog.error.mock.calls, mockLog.debug.mock.calls]);
    expect(logged).not.toContain(OVERDUE_FIGURE);
    expect(logged).not.toContain('4321');
    expect(logged).not.toContain(DUE_DATE);
    expect(logged).not.toMatch(/\bEUR\b|\beur\b/);
    expect(logged).not.toContain(NAME);
  });
});

describe('slice 4a: our revenue through the route', () => {
  beforeEach(asAdmin);

  it('AC-99: R-k and R-k′ are in allReads(); signed out, a non-admin and an invalid query each make zero boost reads', async () => {
    expect(allReads()).toContain(mockDeps.finance.listBoostPurchasesAllAccountsPaidInRange);
    expect(allReads()).toContain(mockDeps.finance.listBoostPurchasesForAccountPaidInRange);
    mockGetUser.mockResolvedValue(null);
    expect((await call()).status).toBe(401);
    mockGetUser.mockResolvedValue(OWNER);
    mockIsAdmin.mockResolvedValue(false);
    expect((await call()).status).toBe(403);
    asAdmin();
    expect((await call('?preset=this_month&unknownKey=1')).status).toBe(400);
    expect(mockDeps.finance.listBoostPurchasesAllAccountsPaidInRange).not.toHaveBeenCalled();
    expect(mockDeps.finance.listBoostPurchasesForAccountPaidInRange).not.toHaveBeenCalled();
  });

  it('the payload: revenue with plans and boosts; K-5 money; AC-92: every money key sits beside a currency; AC-98: no Stripe or lot field', async () => {
    const body = await (await call()).json();
    const revenue = body.data.revenue;
    expect(Object.keys(revenue).sort()).toEqual(['boosts', 'plans', 'state', 'status', 'totals']);
    expect(revenue).toMatchObject({ status: 'ok', plans: { status: 'ok', lines: [] }, boosts: { status: 'ok', scope: 'all', deletedAccounts: [] } });
    expect(revenue.boosts.lines).toEqual([
      { currency: 'USD', purchases: 1, gross: 1234.57, tax: 0, refunded: 0, held: 0, lost: 0, net: 1234.57, creditsSold: 5000, unreadable: 0, unreadableCredits: 0 },
    ]);
    expect(revenue.boosts.packages).toEqual([
      { currency: 'USD', packageId: BOOST_PACKAGE, packageVersion: 3, purchases: 1, gross: 1234.57, refunded: 0, net: 1234.57, unreadable: 0 },
    ]);
    expect(body.data.tiles.k5).toMatchObject({ status: 'neutral', value: null, money: { kind: 'one', currency: 'USD', net: 1234.57 } });
    for (const id of ['k1', 'k2', 'k3', 'k4']) expect(body.data.tiles[id]).not.toHaveProperty('money');

    const MONEY = new Set(['gross', 'tax', 'refunded', 'held', 'lost', 'net']);
    let moneyKeys = 0;
    const walk = (node: unknown, depth: number) => {
      if (Array.isArray(node)) return node.forEach((child) => walk(child, depth + 1));
      if (node === null || typeof node !== 'object') return;
      for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
        if (MONEY.has(key)) {
          moneyKeys += 1;
          expect({ key, hasCurrency: 'currency' in (node as object) }).toEqual({ key, hasCurrency: true });
          expect(depth).toBeGreaterThan(0);
        }
        walk(value, depth + 1);
      }
    };
    walk(revenue.boosts, 0);
    walk({ money: body.data.tiles.k5.money }, 0);
    // line (6) + package row (3) + K-5 money (1).
    expect(moneyKeys).toBe(10);
    expect(Object.keys(revenue.boosts).sort()).toEqual(['deletedAccounts', 'lines', 'notes', 'packages', 'scope', 'status']);

    const text = JSON.stringify(revenue);
    for (const banned of ['stripe_', 'receipt_url', 'flag_reason', 'lot_id', 'paid_at', 'user_id', ACCOUNT]) expect(text).not.toContain(banned);
  });

  it('AC-96 through the route: R-k′ gets exactly the id and the window; R-k has zero calls; R-d has zero calls (SA-Q35); no deleted line', async () => {
    const res = await call(`?accountId=${ACCOUNT}`);
    expect(res.status).toBe(200);
    expect(mockDeps.finance.listBoostPurchasesAllAccountsPaidInRange).not.toHaveBeenCalled();
    expect(mockDeps.finance.listBoostPurchasesForAccountPaidInRange).toHaveBeenCalledTimes(1);
    const [id, range] = mockDeps.finance.listBoostPurchasesForAccountPaidInRange.mock.calls[0];
    expect(id).toBe(ACCOUNT);
    const body = await res.json();
    expect(range).toEqual({ from: new Date(body.data.window.start), to: new Date(body.data.window.end) });
    expect(mockDeps.finance.countRevenueRows.mock.calls).toEqual([]);
    expect(body.data.revenue.boosts).toMatchObject({ scope: 'one', deletedAccounts: null });
    expect(body.data.tiles.k5.money).toEqual({ kind: 'one', currency: 'USD', net: 1234.57 });
  });

  it('AC-95 through the route: R-k fails → 200, K-5 unavailable "Unknown", the boost part unknown, every other section renders', async () => {
    mockDeps.finance.listBoostPurchasesAllAccountsPaidInRange.mockResolvedValue({ data: null, error: new Error('down') });
    const res = await call();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.tiles.k5).toMatchObject({ status: 'unavailable', headline: 'Unknown', money: { kind: 'unknown', reason: 'failed' } });
    expect(body.data.revenue).toMatchObject({ status: 'partial', boosts: { status: 'unknown', lines: null } });
    for (const section of ['accounts', 'aiCost', 'credits', 'takings']) expect(body.data[section].status).not.toBe('unknown');
  });

  it('AC-98: the info line carries sections.revenueBoosts and counts.boosts (counts and booleans only); no boost amount, package or currency in any log call', async () => {
    await call();
    const lines = mockLog.info.mock.calls.filter((c) => c[1] === 'Admin read the Business OS finance page');
    expect(lines).toHaveLength(1);
    const [ctx] = lines[0];
    expect(ctx.sections.revenueBoosts).toBe('ok');
    expect(ctx.counts.boosts).toEqual({
      rows: 1, ceiling: false, counted: 1, otherStatus: 0, unreadable: 0, unreadableCredits: 0, currencies: 1, packages: 1, deletedAccountPurchases: 0,
    });
    for (const value of Object.values(ctx.counts.boosts)) expect(['number', 'boolean']).toContain(typeof value);
    const logged = JSON.stringify([mockLog.info.mock.calls, mockLog.warn.mock.calls, mockLog.error.mock.calls, mockLog.debug.mock.calls]);
    for (const secret of [String(BOOST_MINOR), '1234.57', BOOST_PACKAGE]) expect(logged).not.toContain(secret);
    expect(logged).not.toMatch(/\bUSD\b/);
  });
});

describe('slice 5a: our plan revenue through the route', () => {
  beforeEach(asAdmin);

  const PLAN_MINOR = 98761;
  const PLAN_TIER = 'secret-tier-value';
  const planPayment = (user_id: string | null, extra: Record<string, unknown> = {}) => ({
    id: 'efefefef-0000-4000-8000-000000000001', user_id, kind: 'invoice_paid', tier: PLAN_TIER,
    amount_minor: PLAN_MINOR, amount_tax_minor: 0, currency: 'usd',
    period_start: '2026-10-02T10:00:00+00:00', period_end: '2026-11-02T10:00:00+00:00', paid_at: '2026-10-02T10:00:00+00:00',
    ...extra,
  });
  const seedPlans = (rows: unknown[], reachedCeiling = false) => {
    const read = { data: { rows, reachedCeiling }, error: null };
    mockDeps.finance.listPlanPaymentsAllAccountsPaidInRange.mockResolvedValue(read);
    mockDeps.finance.listPlanPaymentsForAccountPaidInRange.mockResolvedValue(read);
  };

  it('AC-128: R-m and R-m′ are in allReads(); signed out, a non-admin and an invalid query each make zero plan reads', async () => {
    expect(allReads()).toContain(mockDeps.finance.listPlanPaymentsAllAccountsPaidInRange);
    expect(allReads()).toContain(mockDeps.finance.listPlanPaymentsForAccountPaidInRange);
    mockGetUser.mockResolvedValue(null);
    expect((await call()).status).toBe(401);
    mockGetUser.mockResolvedValue(OWNER);
    mockIsAdmin.mockResolvedValue(false);
    expect((await call()).status).toBe(403);
    asAdmin();
    expect((await call('?preset=this_month&unknownKey=1')).status).toBe(400);
    expect((await call('?preset=this_month&currency=usd')).status).toBe(400);
    expect(mockDeps.finance.listPlanPaymentsAllAccountsPaidInRange).not.toHaveBeenCalled();
    expect(mockDeps.finance.listPlanPaymentsForAccountPaidInRange).not.toHaveBeenCalled();
  });

  it('AC-122 / AC-127: the payload — plans per currency, totals and K-5 within one currency; every money key beside a currency; no Stripe, refusal, plan_written or mode key', async () => {
    seedPlans([planPayment(ACCOUNT), planPayment(null, { id: 'efefefef-0000-4000-8000-000000000002', amount_minor: 100 })]);
    const body = await (await call()).json();
    const revenue = body.data.revenue;
    expect(revenue.plans.lines).toEqual([
      { currency: 'USD', payments: 2, received: 988.61, tax: 0, businesses: 1, zeroAmountInvoices: 0, unreadable: 0, exact: true },
    ]);
    expect(revenue.plans.deletedAccounts).toEqual([{ currency: 'USD', payments: 1, received: 1, exact: true }]);
    expect(revenue.plans.accounts).toEqual([
      { accountId: ACCOUNT, name: NAME, nameStatus: 'found', currency: 'USD', payments: 1, received: 987.61, exact: true },
    ]);
    expect(revenue.totals).toEqual([{ currency: 'USD', boostsNet: 1234.57, plansReceived: 988.61, total: 2223.18 }]);
    expect(body.data.tiles.k5.money).toEqual({ kind: 'one', currency: 'USD', net: 2223.18 });

    const MONEY = new Set(['received', 'tax', 'boostsNet', 'plansReceived', 'total', 'net']);
    let moneyKeys = 0;
    const walk = (node: unknown, depth: number) => {
      if (Array.isArray(node)) return node.forEach((child) => walk(child, depth + 1));
      if (node === null || typeof node !== 'object') return;
      for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
        if (MONEY.has(key)) {
          moneyKeys += 1;
          expect({ key, hasCurrency: 'currency' in (node as object) }).toEqual({ key, hasCurrency: true });
          expect(depth).toBeGreaterThan(0);
        }
        walk(value, depth + 1);
      }
    };
    walk(revenue.plans, 0);
    walk(revenue.totals, 0);
    walk({ money: body.data.tiles.k5.money }, 0);
    // plan line (2) + deleted line (1) + by-business row (1) + totals (3) + K-5 (1).
    expect(moneyKeys).toBe(8);

    const text = JSON.stringify(revenue.plans);
    for (const banned of ['stripe_', 'refusal_reason', 'plan_written', 'livemode', 'amount_minor', 'paid_at', PLAN_TIER]) {
      expect(text).not.toContain(banned);
    }
  });

  it('AC-123 through the route: with accountId, R-m′ gets exactly the id and the window; R-m and R-d have ZERO calls; the payment list, no table', async () => {
    seedPlans([planPayment(ACCOUNT)]);
    const res = await call(`?accountId=${ACCOUNT}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(mockDeps.finance.listPlanPaymentsAllAccountsPaidInRange).not.toHaveBeenCalled();
    expect(mockDeps.finance.countRevenueRows).not.toHaveBeenCalled();
    expect(mockDeps.finance.listPlanPaymentsForAccountPaidInRange).toHaveBeenCalledTimes(1);
    const [id, range] = mockDeps.finance.listPlanPaymentsForAccountPaidInRange.mock.calls[0];
    expect(id).toBe(ACCOUNT);
    expect(range).toEqual({ from: new Date(body.data.window.start), to: new Date(body.data.window.end) });
    expect(body.data.revenue.plans).toMatchObject({ scope: 'one', accounts: null, deletedAccounts: null, paymentsTotal: 1 });
    expect(body.data.revenue.plans.payments).toEqual([
      { id: 'efefefef-0000-4000-8000-000000000001', paidAt: '2026-10-02T10:00:00+00:00', planLabel: null, received: 987.61, tax: 0, currency: 'USD', periodStart: '2026-10-02T10:00:00+00:00', periodEnd: '2026-11-02T10:00:00+00:00' },
    ]);
    expect(body.data.revenue.state).toBe('recorded');
  });

  it('AC-126 through the route: R-m fails → 200, plans unknown, the section partial, K-5 Unknown, every other section renders', async () => {
    mockDeps.finance.listPlanPaymentsAllAccountsPaidInRange.mockResolvedValue({ data: null, error: new Error('down') });
    const res = await call();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.revenue).toMatchObject({ status: 'partial', plans: { status: 'unknown', lines: null }, boosts: { status: 'ok' }, totals: null });
    expect(body.data.tiles.k5).toMatchObject({ status: 'unavailable', money: { kind: 'unknown', reason: 'failed' } });
    for (const section of ['accounts', 'aiCost', 'credits', 'takings']) expect(body.data[section].status).not.toBe('unknown');
  });

  it('AC-127: the info line carries sections.revenuePlans, counts.plans and counts.revenueExistence; no plan amount, currency or tier in any log call', async () => {
    seedPlans([planPayment(ACCOUNT)]);
    await call();
    const lines = mockLog.info.mock.calls.filter((c) => c[1] === 'Admin read the Business OS finance page');
    expect(lines).toHaveLength(1);
    const [ctx] = lines[0];
    expect(ctx.sections.revenuePlans).toBe('ok');
    expect(ctx.counts.revenueExistence).toBe('read');
    expect(ctx.counts.plans).toEqual({
      rows: 1, ceiling: false, payments: 1, zeroAmount: 0, unreadable: 0, otherKind: 0, currencies: 1,
      accountsShown: 1, accountsTotal: 1, deletedAccountPayments: 0, paymentsTotal: 0, namesFound: 1,
    });
    for (const value of Object.values(ctx.counts.plans)) expect(['number', 'boolean']).toContain(typeof value);
    const logged = JSON.stringify([mockLog.info.mock.calls, mockLog.warn.mock.calls, mockLog.error.mock.calls, mockLog.debug.mock.calls]);
    for (const secret of [String(PLAN_MINOR), '987.61', PLAN_TIER, '2223.18']) expect(logged).not.toContain(secret);
    expect(logged).not.toMatch(/\bUSD\b|"usd"/);

    jest.clearAllMocks();
    seed();
    asAdmin();
    await call(`?accountId=${ACCOUNT}`);
    const picked = mockLog.info.mock.calls.filter((c) => c[1] === 'Admin read the Business OS finance page');
    expect(picked[0][0].counts.revenueExistence).toBe('not_called');
  });
});

/**
 * AC-145 / SA-WR-44 (slice 6a, Money M-3): the Overview baseline. Written FIRST,
 * green on unchanged `d05eb0a4` code, and NEVER EDITED afterwards. With no
 * `tab` key, an all-businesses request makes exactly these read calls with
 * exactly these arguments and exactly these `findNames` calls, and returns
 * exactly these top-level payload keys (no `accountEconomics`, no
 * `accountMargin`). On a frozen clock the whole payload is byte-identical: its
 * SHA-256 is pinned.
 *
 * E-55 (Money M-4, SA ruling, the ONE permitted update): the Overview gains one
 * read, the all-accounts recorded AI cost read with its exact arguments
 * (`recorded.allAccounts`; `recorded.forAccount` is never called), and
 * `aiCost.recorded`, so the hash is refreshed. Every other read call, the
 * `findNames` calls and the top-level keys are unchanged.
 */
describe('AC-145 baseline: the Overview request is unchanged by slice 6a', () => {
  const FROZEN_NOW = new Date('2026-10-14T12:00:00.000Z');
  beforeEach(() => {
    // Only the clock is frozen: timers stay real (R-j's deadline uses setTimeout).
    jest.useFakeTimers({
      now: FROZEN_NOW,
      doNotFake: [
        'nextTick', 'setImmediate', 'clearImmediate', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval',
        'queueMicrotask', 'hrtime', 'performance',
      ],
    });
    asAdmin();
  });
  afterEach(() => jest.useRealTimers());

  /** Dates as ISO text, the abort signal and the random correlation id as markers. */
  const serialise = (value: unknown) =>
    JSON.parse(
      JSON.stringify(value, (k, v) => (v instanceof AbortSignal ? '<signal>' : k === 'correlationId' ? '<correlationId>' : v))
    ) as unknown;

  const namedReads = (): Record<string, jest.Mock> => ({
    'plans.pagePlans': mockDeps.plans.pagePlans,
    findPlanForAccount: mockDeps.findPlanForAccount,
    ...Object.fromEntries(Object.entries(mockDeps.ledger).map(([k, v]) => [`ledger.${k}`, v])),
    ...Object.fromEntries(Object.entries(mockDeps.finance).map(([k, v]) => [`finance.${k}`, v])),
    ...Object.fromEntries(Object.entries(mockDeps.credits).map(([k, v]) => [`credits.${k}`, v])),
    ...Object.fromEntries(Object.entries(mockDeps.lots).map(([k, v]) => [`lots.${k}`, v])),
    readQueueFigures: mockReadQueueFigures,
    // E-55 (M-4).
    'recorded.allAccounts': mockRecordedAllAccounts,
    'recorded.forAccount': mockRecordedForAccount,
  });

  const RANGE = { from: '2026-10-01T00:00:00.000Z', to: '2026-10-15T00:00:00.000Z' };
  const LEDGER_OPTS = { pageSize: 1000, ceiling: 20000 };
  const EXPECTED_CALLS = {
    'plans.pagePlans': [[{ afterUserId: null, limit: 500 }]],
    findPlanForAccount: [],
    'ledger.listRowsOfAllAccountsCreatedInRange': [
      [RANGE, LEDGER_OPTS],
      [{ from: '2026-10-01T00:00:00.000Z', to: '2026-10-14T12:00:00.000Z' }, LEDGER_OPTS],
    ],
    'ledger.listRowsForAccountCreatedInRange': [],
    'ledger.findChargesByActionIds': [],
    'finance.listBillingStatusesAllAccounts': [[]],
    'finance.findBillingStatusForAccount': [],
    'finance.countRevenueRows': [[]],
    'finance.listClientPaymentsAllAccountsPaidInRange': [[RANGE]],
    'finance.listClientPaymentsForAccountPaidInRange': [],
    'finance.listClientRefundsAllAccountsCreatedInRange': [[RANGE]],
    'finance.listClientRefundsForAccountCreatedInRange': [],
    'finance.listOverdueClientInvoicesAllAccounts': [['2026-10-14']],
    'finance.listOverdueClientInvoicesForAccount': [],
    'finance.listOverdueClientInstalmentsAllAccounts': [['2026-10-14']],
    'finance.listOverdueClientInstalmentsForAccount': [],
    'finance.listClientPlansAllAccounts': [[]],
    'finance.listClientPlansForAccount': [],
    'finance.listBoostPurchasesAllAccountsPaidInRange': [[RANGE]],
    'finance.listBoostPurchasesForAccountPaidInRange': [],
    'finance.listPlanPaymentsAllAccountsPaidInRange': [[RANGE]],
    'finance.listPlanPaymentsForAccountPaidInRange': [],
    'credits.getSnapshots': [[[ACCOUNT]]],
    'credits.findPeriodAnchorsBatch': [[[ACCOUNT]]],
    'credits.listTotalsForAccountsInRange': [
      [[ACCOUNT], { from: '2026-09-01T00:00:00.000Z', to: '2026-10-15T00:00:00.000Z' }, { pageSize: 1000, ceiling: 5000 }],
    ],
    'lots.allAccounts': [[]],
    'lots.forAccount': [],
    readQueueFigures: [
      [{ correlationId: '<correlationId>', adminId: ADMIN.id }, 'payment_reminders', '2026-10-14T12:00:00.000Z', { signal: '<signal>' }],
    ],
    // E-55 (M-4): the end is the window's end less 1 ms (SA-Q52); Business OS rows only (SA-WR-48).
    'recorded.allAccounts': [
      [
        { correlationId: '<correlationId>', adminId: ADMIN.id },
        { start: '2026-10-01T00:00:00.000Z', end: '2026-10-14T23:59:59.999Z' },
        { featureFilter: serialise(bosRowFilter()) },
        { pageSize: 1000, ceiling: 10000, signal: '<signal>' },
      ],
    ],
    'recorded.forAccount': [],
  };
  // Section 3's top accounts, the plans by business (none here), Section 4's rows, takings and overdue rows.
  const EXPECTED_NAME_CALLS = [[[ACCOUNT]], [[ACCOUNT]], [[ACCOUNT]], [[ACCOUNT]]];
  const EXPECTED_KEYS = ['generatedAt', 'window', 'accountId', 'tiles', 'revenue', 'accounts', 'aiCost', 'credits', 'takings', 'paymentProblems'];
  // E-55 (M-4): the new hash, and the 6a hash, which the payload still gives with `aiCost.recorded` taken out.
  const EXPECTED_SHA256 = '6761620e6fb59c9df83ec19b6ba0b534929bca660e7b3dbd2e271356e11b5250';
  const SLICE_6A_SHA256 = 'b4d10bc1256d32de808c435917c0a53d44229e3df4e9ff879a035911ae13588c';

  it('the read calls, the findNames calls, the top-level keys and the payload bytes', async () => {
    const res = await call();
    expect(res.status).toBe(200);
    const body = JSON.parse(await res.text());
    const calls = Object.fromEntries(Object.entries(namedReads()).map(([k, fn]) => [k, serialise(fn.mock.calls)]));
    expect(calls).toEqual(EXPECTED_CALLS);
    expect(serialise(mockFindNames.mock.calls)).toEqual(EXPECTED_NAME_CALLS);
    expect(Object.keys(body.data)).toEqual(EXPECTED_KEYS);
    expect(body.data).not.toHaveProperty('accountEconomics');
    expect(body.data).not.toHaveProperty('accountMargin');
    // E-55 (M-4): the recorded AI cost is one more key inside Section 3, never a top-level key.
    expect(body.data.aiCost).toHaveProperty('recorded');
    const sha = (jest.requireActual('crypto') as typeof import('crypto')).createHash('sha256');
    expect(sha.update(JSON.stringify(body.data)).digest('hex')).toBe(EXPECTED_SHA256);
    // E-55: the only change to the bytes is that one key.
    const section3 = { ...body.data.aiCost };
    delete section3.recorded;
    const without = { ...body.data, aiCost: section3 };
    const sha6a = (jest.requireActual('crypto') as typeof import('crypto')).createHash('sha256');
    expect(sha6a.update(JSON.stringify(without)).digest('hex')).toBe(SLICE_6A_SHA256);
  });
});

describe('500 (AC-36)', () => {
  beforeEach(asAdmin);

  it('an unexpected throw → 500 standard body, details only in development, no-store', async () => {
    // settle() absorbs a throwing READ, so the throw is forced past it: a
    // malformed page makes the builder itself throw.
    mockDeps.ledger.listRowsOfAllAccountsCreatedInRange.mockResolvedValue({ data: { rows: null, reachedCeiling: false }, error: null });
    const res = await call();
    expect(res.status).toBe(500);
    expectNoStore(res);
    const body = await res.json();
    expect(body).toEqual({ success: false, error: 'Internal server error' });
    expect(mockLog.error).toHaveBeenCalledWith(expect.objectContaining({ err: expect.any(Error) }), 'Business OS finance read failed');
  });

  it('in development, details carry the message', async () => {
    const env = process.env as Record<string, string | undefined>;
    const previous = env.NODE_ENV;
    env.NODE_ENV = 'development';
    try {
      mockDeps.ledger.listRowsOfAllAccountsCreatedInRange.mockResolvedValue({ data: { rows: null, reachedCeiling: false }, error: null });
      const body = await (await call()).json();
      expect(typeof body.details).toBe('string');
    } finally {
      env.NODE_ENV = previous;
    }
  });
});

describe('source', () => {
  const code = fs.readFileSync(path.join(__dirname, '..', 'route.ts'), 'utf8');

  it('names no write verb and no audit call (AC-28, SEC-10)', () => {
    expect(code).not.toMatch(/\.(insert|update|upsert|delete|rpc)\s*\(/);
    expect(code).not.toMatch(/AuditTrailService|auditTrail/);
  });

  it('requireAdmin is the first statement after the logger set-up, and every response passes no-store', () => {
    const body = code.slice(code.indexOf('export async function GET'));
    expect(body.indexOf('requireAdmin(')).toBeLessThan(body.indexOf('searchParams'));
    expect(code).not.toMatch(/profiles\.role|app_metadata|AdminAccessService/);
    // Every NextResponse.json carries the header constant.
    const jsonCalls = code.match(/NextResponse\.json\(/g) ?? [];
    const withHeader = code.match(/headers: NO_STORE/g) ?? [];
    expect(jsonCalls.length).toBe(withHeader.length);
  });
});

// ── Slice 6a (Money M-3): the Accounts tab through the route (T7) ───────────
// The AC-145 baseline above is NOT edited (SA-WR-44); every 6a case lives here.
describe('slice 6a: the Accounts tab through the route', () => {
  beforeEach(asAdmin);

  const TIER_ID: string = jest.requireActual('@/lib/business-os/entitlements/source').getEntitlementConfig().tierOrder[0];

  it.each([
    ['tab=overview (only accounts is accepted)', '?tab=overview'],
    ['a malformed sort', '?tab=accounts&sort=name'],
    ['a malformed show', '?tab=accounts&show=everything'],
    ['a malformed group (SA-WR-42)', '?tab=accounts&group=tier:Bad!'],
    ['an unknown group word', '?tab=accounts&group=vip'],
    ['sort without tab (E-48)', '?sort=margin'],
    ['group without tab (E-48)', '?group=trial'],
    ['show without tab (E-48)', '?show=active'],
    ['tab with a business picked (SA-W84)', `?tab=accounts&accountId=${ACCOUNT}`],
    ['a repeated tab', '?tab=accounts&tab=accounts'],
  ])('AC-146: %s → 400, no read', async (_name, query) => {
    const res = await call(query);
    expect(res.status).toBe(400);
    expectNoStore(res);
    noReadHappened();
  });

  it('AC-146: 401 and 403 with the tab make zero calls on every read', async () => {
    mockGetUser.mockResolvedValue(null);
    expect((await call('?tab=accounts&sort=margin')).status).toBe(401);
    noReadHappened();
    mockGetUser.mockResolvedValue(OWNER);
    mockIsAdmin.mockResolvedValue(false);
    expect((await call('?tab=accounts')).status).toBe(403);
    noReadHappened();
  });

  it('SA-WR-42: a well-formed tier key that is not configured → 200 with no rows ("No accounts match this filter")', async () => {
    const res = await call('?tab=accounts&group=tier:no-such-tier');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.accountEconomics.rows).toEqual([]);
    expect(body.data.accountEconomics.counts.matching).toBe(0);
    expect(body.data.accountEconomics.platform.accountsCovered).toBeGreaterThan(0);
  });

  it('AC-141: the route passes the parsed filters to the builder; defaults applied when absent', async () => {
    const body = await (await call('?tab=accounts&sort=margin&show=negative')).json();
    expect(body.data.accountEconomics.query).toEqual({ sort: 'margin', group: null, show: 'negative' });
    const plain = await (await call('?tab=accounts')).json();
    expect(plain.data.accountEconomics.query).toEqual({ sort: 'ai_cost', group: null, show: 'all' });
    expect(plain.data).not.toHaveProperty('accountMargin');
  });

  it('the payload: the row, its name, the platform line; AC-136: every money key beside a currency (cost and margin are USD fields)', async () => {
    const body = await (await call('?tab=accounts')).json();
    const tab = body.data.accountEconomics;
    const row = tab.rows.find((r: { accountId: string }) => r.accountId === ACCOUNT);
    expect(row).toMatchObject({
      name: NAME,
      nameStatus: 'found',
      paid: { failed: false, lines: [{ currency: 'USD', afterTax: 1234.57, exact: true, planAfterTax: 0, boostsAfterTax: 1234.57 }] },
      aiCost: { kind: 'figure', costUsd: 1.2345, exact: true },
      margin: { kind: 'figure', marginUsd: 1233.3355, noRevenue: false },
      // Slice 6b: one 123457 boost, fee (123457 × 290 + 5000) div 10000 = 3580, + 30 = 3610 (USD 36.10).
      marginAfterFees: { kind: 'figure', afterFeesUsd: 1197.2355, feesUsd: 36.1, currency: 'USD', noRevenue: false },
    });
    // Slice 6b (FE-16): the note values, divided on the server.
    expect(tab.feeEstimate).toEqual({ currency: 'USD', percent: 2.9, fixed: 0.3 });
    expect(tab.platform.aiCost).toEqual({ kind: 'figure', costUsd: body.data.aiCost.figures.costUsd, exact: true });

    const MONEY = new Set(['afterTax', 'planAfterTax', 'boostsAfterTax']);
    let moneyKeys = 0;
    const walk = (node: unknown) => {
      if (Array.isArray(node)) return node.forEach(walk);
      if (node === null || typeof node !== 'object') return;
      for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
        if (MONEY.has(key)) {
          moneyKeys += 1;
          expect({ key, hasCurrency: 'currency' in (node as object) }).toEqual({ key, hasCurrency: true });
        }
        // Only the USD-by-construction fields may carry money without a currency.
        // Slice 6b: the margin after fees and the fees carry their currency beside them.
        if (typeof value === 'number' && /usd$/i.test(key)) {
          if (key === 'afterFeesUsd' || key === 'feesUsd') expect({ key, hasCurrency: 'currency' in (node as object) }).toEqual({ key, hasCurrency: true });
          else expect(['costUsd', 'marginUsd']).toContain(key);
        }
        walk(value);
      }
    };
    walk(tab);
    expect(moneyKeys).toBeGreaterThan(0);
    const text = JSON.stringify(tab);
    for (const banned of ['stripe_', 'livemode', 'paid_at', 'user_id', BOOST_PACKAGE]) expect(text).not.toContain(banned);
    expect(text).not.toMatch(new RegExp(`['"]${TIER_ID}['"]`));
  });

  it('AC-142 through the route: with a business picked, accountMargin from R-a′ / R-k′ / R-m′; no all-accounts read; no accountEconomics', async () => {
    const body = await (await call(`?accountId=${ACCOUNT}`)).json();
    expect(body.data.accountMargin).toEqual({
      paid: { failed: false, lines: [{ currency: 'USD', afterTax: 1234.57, exact: true, planAfterTax: 0, boostsAfterTax: 1234.57 }] },
      aiCost: { kind: 'figure', costUsd: 1.2345, exact: true },
      margin: { kind: 'figure', marginUsd: 1233.3355, noRevenue: false },
      // Slice 6b (AC-250): the same margin after fees as the tab row.
      marginAfterFees: { kind: 'figure', afterFeesUsd: 1197.2355, feesUsd: 36.1, currency: 'USD', noRevenue: false },
    });
    expect(body.data).not.toHaveProperty('accountEconomics');
    expect(mockDeps.ledger.listRowsOfAllAccountsCreatedInRange).not.toHaveBeenCalled();
    expect(mockDeps.finance.listBoostPurchasesAllAccountsPaidInRange).not.toHaveBeenCalled();
    expect(mockDeps.finance.listPlanPaymentsAllAccountsPaidInRange).not.toHaveBeenCalled();
  });

  it('AC-143: the tab adds exactly ONE names call, of at most 200 ids, none of them a platform id', async () => {
    await call();
    const overviewNameCalls = mockFindNames.mock.calls.length;
    jest.clearAllMocks();
    seed();
    asAdmin();
    const ledger = { data: { rows: [chargeRow(ACCOUNT), { ...chargeRow(PLATFORM), id: 'r2' }], reachedCeiling: false }, error: null };
    mockDeps.ledger.listRowsOfAllAccountsCreatedInRange.mockResolvedValue(ledger);
    await call('?tab=accounts');
    expect(mockFindNames.mock.calls.length).toBe(overviewNameCalls + 1);
    const ids = mockFindNames.mock.calls[mockFindNames.mock.calls.length - 1][0] as string[];
    expect(ids.length).toBeLessThanOrEqual(200);
    expect(ids).toEqual([ACCOUNT]);
  });

  it('AC-138 through the route: R-k fails → 200, the tab partial, every Overview section present', async () => {
    mockDeps.finance.listBoostPurchasesAllAccountsPaidInRange.mockResolvedValue({ data: null, error: new Error('down') });
    const res = await call('?tab=accounts');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.accountEconomics.status).toBe('partial');
    for (const key of ['revenue', 'accounts', 'aiCost', 'credits', 'takings', 'paymentProblems', 'tiles']) expect(body.data).toHaveProperty(key);
  });

  it('AC-147: the info line carries sections.accountEconomics and counts.accountEconomics (counts, booleans, enum words); a planted tier id, an amount, a name and a currency reach no log call', async () => {
    await call(`?tab=accounts&sort=paid&group=tier:${TIER_ID}&show=active`);
    const lines = mockLog.info.mock.calls.filter((c) => c[1] === 'Admin read the Business OS finance page');
    expect(lines).toHaveLength(1);
    const ctx = lines[0][0];
    expect(ctx.sections.accountEconomics).toMatch(/^(ok|partial|unknown)$/);
    expect(ctx.counts.accountEconomics).toMatchObject({ built: true, sort: 'paid', group: 'tier', show: 'active' });
    for (const value of Object.values(ctx.counts.accountEconomics)) expect(['number', 'boolean', 'string']).toContain(typeof value);
    const logged = JSON.stringify([mockLog.info.mock.calls, mockLog.warn.mock.calls, mockLog.error.mock.calls, mockLog.debug.mock.calls]);
    expect(logged).not.toContain(`tier:${TIER_ID}`);
    expect(logged).not.toMatch(new RegExp(`"${TIER_ID}"`));
    for (const secret of [NAME, '1234.57', '1233.3355', String(BOOST_MINOR)]) expect(logged).not.toContain(secret);
    expect(logged).not.toMatch(/\bUSD\b|"usd"/);
  });

  it('the Overview line says not_built and counts.accountEconomics { built: false }', async () => {
    await call();
    const ctx = mockLog.info.mock.calls.find((c) => c[1] === 'Admin read the Business OS finance page')?.[0];
    expect(ctx.sections.accountEconomics).toBe('not_built');
    expect(ctx.counts.accountEconomics).toEqual({ built: false });
  });

  // SA-W83 / SA-WR-42: one definition of the group shape, imported from the pure page URL module.
  it('the route imports FINANCE_GROUP_SHAPE from financeUrl.ts and writes no group regex of its own', () => {
    const code = fs.readFileSync(path.join(__dirname, '..', 'route.ts'), 'utf8');
    expect(code).toMatch(/import \{[^}]*\bFINANCE_GROUP_SHAPE\b[^}]*\} from '@\/app\/admin\/finance\/financeUrl';/);
    expect(code).not.toMatch(/founding_partner\|comped/);
    expect(code).not.toMatch(/tier:\[/);
  });
});

// ── Money M-4 (OV-5, T7-B): the recorded AI cost through the route ──────────
// The AC-145 baseline above holds the one permitted edit (E-55); every M-4 case lives here.
describe('Money M-4: the recorded AI cost through the route', () => {
  beforeEach(asAdmin);

  const infoLine = () => {
    const lines = mockLog.info.mock.calls.filter((c) => c[1] === 'Admin read the Business OS finance page');
    expect(lines).toHaveLength(1);
    return lines[0][0];
  };

  it('AC-157 / SA-WR-48: no business picked → the all-accounts read once, Business OS rows only; the account read never', async () => {
    const body = await (await call()).json();
    expect(mockRecordedAllAccounts).toHaveBeenCalledTimes(1);
    expect(mockRecordedForAccount).not.toHaveBeenCalled();
    const [context, window, filters, opts] = mockRecordedAllAccounts.mock.calls[0];
    expect(context).toEqual({ correlationId: expect.any(String), adminId: ADMIN.id });
    expect(filters).toEqual({ featureFilter: bosRowFilter() });
    expect(opts).toEqual({ pageSize: 1000, ceiling: 10000, signal: expect.any(AbortSignal) });
    expect(typeof window.start).toBe('string');
    expect(typeof window.end).toBe('string');
    // 1.9876543 recorded against the one 1.2345 charge.
    expect(body.data.aiCost.recorded).toEqual({
      status: 'ok',
      recordedUsd: 1.9876543,
      recordedExact: true,
      aboveCharged: { state: 'figure', usd: 0.7531543 },
      chargedAboveUsd: null,
    });
  });

  it('AC-157 / SA-WR-48 / tenant isolation: a business picked → the account read ONCE with exactly that id and Business OS rows; the all-accounts read never', async () => {
    const body = await (await call(`?accountId=${ACCOUNT.toUpperCase()}`)).json();
    expect(mockRecordedAllAccounts).not.toHaveBeenCalled();
    expect(mockRecordedForAccount).toHaveBeenCalledTimes(1);
    const args = mockRecordedForAccount.mock.calls[0];
    expect(args).toHaveLength(4);
    expect(args[0]).toBe(ACCOUNT);
    expect(args[1].start).toBeInstanceOf(Date);
    expect(args[1].end).toBeInstanceOf(Date);
    expect(args[2]).toEqual(bosRowFilter());
    // No signal reaches it (SA-Q53): the options are the page size and the ceiling only.
    expect(args[3]).toEqual({ pageSize: 1000, ceiling: 5000 });
    expect(body.data.aiCost.recorded.aboveCharged).toEqual({ state: 'figure', usd: 0.7531543 });
  });

  describe('AC-162 / SA-Q52: both reads get the window end less 1 ms (frozen clock)', () => {
    beforeEach(() => {
      jest.useFakeTimers({
        now: new Date('2026-10-14T12:00:00.000Z'),
        doNotFake: ['nextTick', 'setImmediate', 'clearImmediate', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'queueMicrotask', 'hrtime', 'performance'],
      });
    });
    afterEach(() => jest.useRealTimers());

    it('all accounts: the exact ISO strings', async () => {
      await call();
      expect(mockRecordedAllAccounts.mock.calls[0][1]).toEqual({ start: '2026-10-01T00:00:00.000Z', end: '2026-10-14T23:59:59.999Z' });
    });

    it('one account: the exact instants, as Dates', async () => {
      await call(`?accountId=${ACCOUNT}`);
      const window = mockRecordedForAccount.mock.calls[0][1] as { start: Date; end: Date };
      expect(window.start.toISOString()).toBe('2026-10-01T00:00:00.000Z');
      expect(window.end.toISOString()).toBe('2026-10-14T23:59:59.999Z');
    });

    it('a custom window: the last day’s last millisecond, never the next day', async () => {
      await call('?preset=custom&from=2026-09-20&to=2026-10-03');
      expect(mockRecordedAllAccounts.mock.calls[0][1]).toEqual({ start: '2026-09-20T00:00:00.000Z', end: '2026-10-03T23:59:59.999Z' });
    });
  });

  it('AC-167: tab=accounts → neither read is called; no aiCost.recorded; the line says not_built', async () => {
    const body = await (await call('?tab=accounts')).json();
    expect(mockRecordedAllAccounts).not.toHaveBeenCalled();
    expect(mockRecordedForAccount).not.toHaveBeenCalled();
    expect(body.data.aiCost).not.toHaveProperty('recorded');
    expect(body.data.accountEconomics).toBeDefined();
    const ctx = infoLine();
    expect(ctx.sections.aiRecorded).toBe('not_built');
    expect(ctx.counts.aiRecorded).toEqual({ built: false });
  });

  it('AC-161: the recorded read fails → 200; Section 3 and every other section unchanged; recorded Unknown', async () => {
    const plain = await (await call()).json();
    jest.clearAllMocks();
    seed();
    asAdmin();
    mockRecordedAllAccounts.mockResolvedValue({ data: null, error: new Error('down') });
    const res = await call();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.aiCost.recorded).toEqual({ status: 'unknown', recordedUsd: null, recordedExact: false, aboveCharged: { state: 'unknown', usd: null }, chargedAboveUsd: null });
    expect(body.data.aiCost.status).toBe(plain.data.aiCost.status);
    expect(body.data.aiCost.figures).toEqual(plain.data.aiCost.figures);
    for (const section of ['revenue', 'accounts', 'credits', 'takings', 'paymentProblems']) expect(body.data[section].status).toBe(plain.data[section].status);
    const ctx = infoLine();
    expect(ctx.sections.aiRecorded).toBe('unknown');
    expect(ctx.counts.aiRecorded).toMatchObject({ built: true, read: 'all_accounts', outcome: 'failed', rows: null });
  });

  it('AC-164: the info line carries the status and counts only; no cost, feature, session id or row id in any log call or in the payload', async () => {
    await call();
    let ctx = infoLine();
    expect(ctx.sections.aiRecorded).toBe('ok');
    expect(ctx.counts.aiRecorded).toMatchObject({ built: true, read: 'all_accounts', outcome: 'ok', rows: 1, completed: true, reachedCeiling: null, unreadable: 0 });
    for (const value of Object.values(ctx.counts.aiRecorded)) expect(['number', 'boolean', 'string', 'object']).toContain(typeof value);
    for (const value of Object.values(ctx.counts.aiRecorded)) if (typeof value === 'object') expect(value).toBeNull();

    jest.clearAllMocks();
    seed();
    asAdmin();
    const res = await call(`?accountId=${ACCOUNT}`);
    const text = JSON.stringify(await res.json());
    ctx = infoLine();
    expect(ctx.counts.aiRecorded).toMatchObject({ built: true, read: 'account', outcome: 'ok', rows: 1, completed: null, reachedCeiling: false });
    const logged = JSON.stringify([mockLog.info.mock.calls, mockLog.warn.mock.calls, mockLog.error.mock.calls, mockLog.debug.mock.calls]);
    for (const secret of [RECORDED_COST, '0.7531543', RECORDED_FEATURE, RECORDED_SESSION, 'usage-row-2']) expect(logged).not.toContain(secret);
    for (const secret of [RECORDED_FEATURE, RECORDED_SESSION, 'usage-row-2', 'session_id', 'cost_usd', '"feature"']) expect(text).not.toContain(secret);
  });

  it('SA-Q54 / R4-11: aiCost.recorded has exactly five keys and none is a sum of the two measures', async () => {
    const body = await (await call()).json();
    expect(Object.keys(body.data.aiCost.recorded).sort()).toEqual(['aboveCharged', 'chargedAboveUsd', 'recordedExact', 'recordedUsd', 'status']);
    const sum = Math.round((1.9876543 + 1.2345) * 1e7) / 1e7;
    expect(JSON.stringify(body.data)).not.toContain(String(sum));
  });
});

// ── DF-6 (§11L): since it started, one business (AC-259 to AC-262, AC-271) ───
// The AC-145 baseline above is NOT edited; every DF-6 case lives here.
describe('DF-6: since_start through the route', () => {
  beforeEach(asAdmin);
  const OTHER = '88888888-8888-4888-8888-888888888888';
  const CUTOVER_ISO = '2026-09-29T16:50:53.914Z';
  const infoLine = () => {
    const line = mockLog.info.mock.calls.find((c) => c[1] === 'Admin read the Business OS finance page');
    return line?.[0] as Record<string, unknown> | undefined;
  };

  it('AC-259: since_start with accountId → 200; the window runs from the cut-over to now', async () => {
    const before = Date.now();
    const res = await call(`?preset=since_start&accountId=${ACCOUNT}`);
    expect(res.status).toBe(200);
    expectNoStore(res);
    const { window } = (await res.json()).data;
    expect(window.preset).toBe('since_start');
    expect(window.start).toBe(CUTOVER_ISO);
    expect(window.from).toBe('2026-09-29');
    expect(window.to).toBe(todayUtc());
    expect(Date.parse(window.end)).toBeGreaterThanOrEqual(before);
    expect(Date.parse(window.end)).toBeLessThanOrEqual(Date.now());
  });

  it('AC-259: since_start with no business → 400 INVALID_QUERY, no read', async () => {
    const res = await call('?preset=since_start');
    expect(res.status).toBe(400);
    expectNoStore(res);
    expect(await res.json()).toEqual({ success: false, error: INVALID_QUERY });
    noReadHappened();
  });

  it('AC-259: in development the 400 says the business is needed', async () => {
    const env = process.env as Record<string, string | undefined>;
    const previous = env.NODE_ENV;
    env.NODE_ENV = 'development';
    try {
      const body = await (await call('?preset=since_start')).json();
      expect(body.error).toBe(INVALID_QUERY);
      expect(body.details.issue).toBe('since_start needs a business picked');
    } finally {
      env.NODE_ENV = previous;
    }
  });

  it.each([
    ['with tab and a business (SA-W84)', `?preset=since_start&tab=accounts&accountId=${ACCOUNT}`],
    ['with tab and no business', '?preset=since_start&tab=accounts'],
    ['a hyphenated value', `?preset=since-start&accountId=${ACCOUNT}`],
    ['a malformed from beside it (format-checked even when ignored)', `?preset=since_start&from=2026-1-1&accountId=${ACCOUNT}`],
    ['an unknown key beside it (still strict)', `?preset=since_start&accountId=${ACCOUNT}&name=Acme`],
    ['a repeated preset', `?preset=since_start&preset=since_start&accountId=${ACCOUNT}`],
  ])('AC-259: %s → 400, no read', async (_name, query) => {
    const res = await call(query);
    expect(res.status).toBe(400);
    expectNoStore(res);
    noReadHappened();
  });

  it('AC-259: from / to sent with it are ignored (the same window)', async () => {
    const plain = (await (await call(`?preset=since_start&accountId=${ACCOUNT}`)).json()).data.window;
    const dated = (await (await call(`?preset=since_start&from=2020-01-01&to=2020-01-02&accountId=${ACCOUNT}`)).json()).data.window;
    expect({ ...dated, end: null }).toEqual({ ...plain, end: null });
  });

  it('AC-260: the 92-day cap is unchanged with a business picked (92 → 200, 93 → 400)', async () => {
    expect((await call(`?preset=custom&from=${daysFromToday(-91)}&to=${todayUtc()}&accountId=${ACCOUNT}`)).status).toBe(200);
    expect((await call(`?preset=custom&from=${daysFromToday(-92)}&to=${todayUtc()}&accountId=${ACCOUNT}`)).status).toBe(400);
  });

  it('AC-261 / SA-Q97 (tenant isolation): account A picked → every scoped read gets exactly A, never B; no all-accounts read', async () => {
    mockDeps.plans.pagePlans.mockResolvedValue({ data: [plan(ACCOUNT), plan(OTHER)], error: null });
    const res = await call(`?preset=since_start&accountId=${ACCOUNT}`);
    expect(res.status).toBe(200);
    expect(mockDeps.findPlanForAccount).toHaveBeenCalledWith(ACCOUNT);
    expect(mockDeps.finance.findBillingStatusForAccount).toHaveBeenCalledWith(ACCOUNT);
    const scoped = [
      mockDeps.ledger.listRowsForAccountCreatedInRange,
      mockDeps.finance.listClientPaymentsForAccountPaidInRange,
      mockDeps.finance.listClientRefundsForAccountCreatedInRange,
      mockDeps.finance.listOverdueClientInvoicesForAccount,
      mockDeps.finance.listOverdueClientInstalmentsForAccount,
      mockDeps.finance.listClientPlansForAccount,
      mockDeps.finance.listBoostPurchasesForAccountPaidInRange,
      mockDeps.finance.listPlanPaymentsForAccountPaidInRange,
      mockRecordedForAccount,
    ];
    for (const dep of scoped) {
      expect(dep).toHaveBeenCalled();
      for (const [id] of dep.mock.calls) expect(id).toBe(ACCOUNT);
    }
    const allAccounts = [
      mockDeps.plans.pagePlans,
      mockDeps.ledger.listRowsOfAllAccountsCreatedInRange,
      mockDeps.finance.listBillingStatusesAllAccounts,
      mockDeps.finance.countRevenueRows,
      mockDeps.finance.listClientPaymentsAllAccountsPaidInRange,
      mockDeps.finance.listClientRefundsAllAccountsCreatedInRange,
      mockDeps.finance.listOverdueClientInvoicesAllAccounts,
      mockDeps.finance.listOverdueClientInstalmentsAllAccounts,
      mockDeps.finance.listClientPlansAllAccounts,
      mockDeps.finance.listBoostPurchasesAllAccountsPaidInRange,
      mockDeps.finance.listPlanPaymentsAllAccountsPaidInRange,
      mockDeps.lots.allAccounts,
      mockReadQueueFigures,
      mockRecordedAllAccounts,
    ];
    for (const dep of allAccounts) expect(dep).not.toHaveBeenCalled();
    expect(JSON.stringify(allReads().map((fn) => fn.mock.calls))).not.toContain(OTHER);
  });

  it('AC-261: with since_start, a missing plan row is a 404 and a failed check a 500; nothing else is read', async () => {
    mockDeps.findPlanForAccount.mockResolvedValue({ data: { plan: null }, error: null });
    expect((await call(`?preset=since_start&accountId=${ACCOUNT}`)).status).toBe(404);
    mockDeps.findPlanForAccount.mockResolvedValue({ data: null, error: new Error('down') });
    expect((await call(`?preset=since_start&accountId=${ACCOUNT}`)).status).toBe(500);
    for (const fn of allReads().filter((f) => f !== mockDeps.findPlanForAccount)) expect(fn).not.toHaveBeenCalled();
  });

  it('AC-261: a platform account id is still the pure 404 before any read', async () => {
    expect((await call(`?preset=since_start&accountId=${PLATFORM}`)).status).toBe(404);
    noReadHappened();
  });

  it('AC-262 / DF6-P-1: the same reads as a picked 92-day custom request; only the range instants differ', async () => {
    const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;
    const masked = (value: unknown): unknown => {
      if (value instanceof Date) return '<instant>';
      if (typeof value === 'string' && ISO.test(value)) return '<instant>';
      if (Array.isArray(value)) return value.map(masked);
      if (value && typeof value === 'object') {
        return Object.fromEntries(
          Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, typeof v === 'function' ? '<fn>' : masked(v)])
        );
      }
      return value;
    };
    const snapshotCalls = () => allReads().map((fn) => masked(fn.mock.calls));
    const ledgerRange = () => {
      const [, range] = mockDeps.ledger.listRowsForAccountCreatedInRange.mock.calls[0] as unknown as [string, { from: Date; to: Date }];
      return range;
    };

    const sinceRes = await call(`?preset=since_start&accountId=${ACCOUNT}`);
    expect(sinceRes.status).toBe(200);
    const sinceEnd = (await sinceRes.json()).data.window.end as string;
    const sinceStart = snapshotCalls();
    const sinceRange = ledgerRange();
    jest.clearAllMocks();
    seed();
    expect((await call(`?preset=custom&from=${daysFromToday(-91)}&to=${todayUtc()}&accountId=${ACCOUNT}`)).status).toBe(200);
    const custom = snapshotCalls();
    const customRange = ledgerRange();

    expect(sinceStart).toEqual(custom);
    // E-78: a custom window ends at the next UTC midnight; since_start ends at now.
    expect(customRange.to.toISOString()).toBe(`${daysFromToday(1)}T00:00:00.000Z`);
    expect(sinceRange.to.toISOString()).toBe(sinceEnd);
    expect(sinceRange.from.toISOString()).toBe(CUTOVER_ISO);
  });

  it('AC-271 / DF6-FR-6: the info line logs the choice and its dates; no plan fact, amount or name', async () => {
    await call(`?preset=since_start&accountId=${ACCOUNT}`);
    expect(infoLine()?.window).toEqual({ preset: 'since_start', from: '2026-09-29', to: todayUtc() });
    const logged = JSON.stringify([mockLog.info.mock.calls, mockLog.warn.mock.calls, mockLog.error.mock.calls]);
    for (const secret of [NAME, TAKINGS_FIGURE, String(BOOST_MINOR), 'onboarding_started_at', 'profile_created_at', '2026-09-01T00:00:00Z']) {
      expect(logged).not.toContain(secret);
    }
  });
});
