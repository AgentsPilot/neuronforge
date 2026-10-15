/**
 * POST /api/admin/business-os/test/plan-test-clock (TEST MODE ONLY; plan
 * payments P-6a.1, workplan §5.8, SA C-5, C-6, C-7).
 *
 * The admin gate's dependencies, the tenant check, the two repositories, the
 * Stripe service and the audit flush are mocked. The Zod schema, the account
 * seam, the switches, the key-mode check, the use cases in `planTestClock.ts`
 * and the lifecycle derivation are real.
 */

import { NextRequest } from 'next/server';

const mockGetUser = jest.fn();
jest.mock('@/lib/auth', () => ({ getUser: () => mockGetUser() }));

const mockIsAdmin = jest.fn();
jest.mock('@/lib/services/AdminAccessService', () => ({
  AdminAccessService: { getInstance: () => ({ isAdmin: (...args: unknown[]) => mockIsAdmin(...args) }) },
}));

jest.mock('@/lib/audit/recordRefusedAccess', () => ({ recordRefusedAccess: jest.fn().mockResolvedValue(undefined) }));

const mockLogLines: unknown[][] = [];
jest.mock('@/lib/logger', () => {
  const make = (): Record<string, unknown> => {
    const record = (...args: unknown[]) => mockLogLines.push(args);
    const logger: Record<string, unknown> = { info: record, warn: record, error: record, debug: record };
    logger.child = () => logger;
    return logger;
  };
  return { createLogger: () => make() };
});

const mockLogAndFlush = jest.fn();
jest.mock('@/lib/audit/boundedAuditFlush', () => ({
  logAndFlush: (...args: unknown[]) => mockLogAndFlush(...args),
}));

const mockIsTenant = jest.fn();
jest.mock('@/lib/business-os/entitlements/adminOps', () => ({
  isBusinessOsTenant: (...args: unknown[]) => mockIsTenant(...args),
}));

const mockFindByUser = jest.fn();
const mockRecordCustomer = jest.fn();
const mockAttachCustomer = jest.fn();
jest.mock('@/lib/repositories/BusinessOsBillingAccountRepository', () => ({
  businessOsBillingAccountRepository: {
    findByUser: (...args: unknown[]) => mockFindByUser(...args),
    recordCustomer: (...args: unknown[]) => mockRecordCustomer(...args),
    attachTestClockCustomer: (...args: unknown[]) => mockAttachCustomer(...args),
  },
}));

const mockFindEntitlementInputs = jest.fn();
jest.mock('@/lib/repositories/BusinessOsAccountPlanRepository', () => ({
  businessOsAccountPlanRepository: { findEntitlementInputs: (...args: unknown[]) => mockFindEntitlementInputs(...args) },
}));
jest.mock('@/lib/repositories/BusinessProfileRepository', () => ({ businessProfileRepository: {} }));
jest.mock('@/lib/repositories/OnboardingConversationRepository', () => ({ onboardingConversationRepository: {} }));

const mockCreateClockCustomer = jest.fn();
const mockRetrieveCustomerClock = jest.fn();
const mockRetrieveClock = jest.fn();
const mockAdvanceClock = jest.fn();
jest.mock('@/lib/stripe/StripeService', () => ({
  getStripeService: () => ({
    createBusinessOsTestClockCustomer: (...args: unknown[]) => mockCreateClockCustomer(...args),
    retrieveBusinessOsCustomerClock: (...args: unknown[]) => mockRetrieveCustomerClock(...args),
    retrieveBusinessOsTestClock: (...args: unknown[]) => mockRetrieveClock(...args),
    advanceBusinessOsTestClock: (...args: unknown[]) => mockAdvanceClock(...args),
  }),
}));

import { POST } from '../route';
import { AUDIT_EVENTS } from '@/lib/audit/events';
import { TIER_ORDER } from '@/lib/business-os/entitlements/config/tierMatrix';
import { LIFECYCLE_CONFIG } from '@/lib/business-os/entitlements/config/lifecycle';

const ADMIN = { id: '11111111-1111-4111-8111-11111111111a', email: 'ops@example.invalid' };
// Hex letters on purpose, so an upper-cased id really differs.
const ACCOUNT = 'abcdef99-9999-4999-8999-99999999999f';
const OTHER = 'abcdef88-8888-4888-8888-88888888888e';
const OLD_CUSTOMER = 'cus_old1';
const NEW_CUSTOMER = 'cus_clock1';
const CLOCK = 'clock_1';
const FROZEN = '2026-11-01T00:00:00.000Z';
const ENV = ['BUSINESS_OS_PLAN_CHECKOUT_ENABLED', 'BUSINESS_OS_PLAN_PRICES_ENABLED', 'STRIPE_SECRET_KEY'] as const;
const original = Object.fromEntries(ENV.map((name) => [name, process.env[name]]));

function billingRow(overrides: Record<string, unknown> = {}) {
  return {
    id: '22222222-2222-4222-8222-222222222222',
    accountId: ACCOUNT,
    livemode: false,
    stripeCustomerId: OLD_CUSTOMER,
    stripeSubscriptionId: null,
    subscriptionStatus: null,
    boughtTier: null,
    currentPeriodEnd: null,
    cancelAtPeriodEnd: false,
    pendingTier: null,
    openCheckoutSessionId: null,
    openCheckoutExpiresAt: null,
    lastInvoiceId: null,
    lastPaidAt: null,
    lastPaymentFailedAt: null,
    failedAttempts: 0,
    actionRequiredInvoiceUrl: null,
    founderDiscountAppliedAt: null,
    endedAt: null,
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
    ...overrides,
  };
}

function planRow(overrides: Record<string, unknown> = {}) {
  return {
    user_id: ACCOUNT,
    tier: TIER_ORDER[0],
    plan_version: 2,
    tier_expires_at: '2026-10-30T00:00:00.000Z',
    cohort: null,
    cohort_expires_at: null,
    onboarding_started_at: null,
    profile_created_at: null,
    trial_started_at: null,
    trial_ends_at: null,
    grace_ends_at: null,
    period_anchor: '2026-09-30T00:00:00.000Z',
    origin: 'admin',
    updated_by_admin_id: null,
    created_at: '2026-09-01T00:00:00.000Z',
    updated_at: '2026-09-01T00:00:00.000Z',
    ...overrides,
  };
}

const call = (body: unknown) =>
  POST(
    new NextRequest('http://localhost/api/admin/business-os/test/plan-test-clock', {
      method: 'POST',
      body: typeof body === 'string' ? body : JSON.stringify(body),
      headers: { 'content-type': 'application/json', 'x-correlation-id': 'corr-1' },
    })
  );

const noStripeCall = () => {
  expect(mockCreateClockCustomer).not.toHaveBeenCalled();
  expect(mockRetrieveCustomerClock).not.toHaveBeenCalled();
  expect(mockRetrieveClock).not.toHaveBeenCalled();
  expect(mockAdvanceClock).not.toHaveBeenCalled();
};
const noWrite = () => {
  expect(mockRecordCustomer).not.toHaveBeenCalled();
  expect(mockAttachCustomer).not.toHaveBeenCalled();
  expect(mockLogAndFlush).not.toHaveBeenCalled();
};

beforeEach(() => {
  jest.clearAllMocks();
  mockLogLines.length = 0;
  process.env.BUSINESS_OS_PLAN_CHECKOUT_ENABLED = 'true';
  process.env.BUSINESS_OS_PLAN_PRICES_ENABLED = 'true';
  process.env.STRIPE_SECRET_KEY = 'sk_test_unit';
  mockGetUser.mockResolvedValue(ADMIN);
  mockIsAdmin.mockResolvedValue(true);
  mockIsTenant.mockResolvedValue(true);
  mockLogAndFlush.mockResolvedValue(undefined);
  mockFindByUser.mockResolvedValue({ data: billingRow(), error: null });
  mockRecordCustomer.mockResolvedValue({ data: { account: billingRow({ stripeCustomerId: NEW_CUSTOMER }), created: true }, error: null });
  mockAttachCustomer.mockResolvedValue({ data: { replaced: true }, error: null });
  mockCreateClockCustomer.mockResolvedValue({ testClockId: CLOCK, frozenTime: FROZEN, customerId: NEW_CUSTOMER, livemode: false });
  mockRetrieveCustomerClock.mockResolvedValue({ deleted: false, testClockId: CLOCK, bosUserId: ACCOUNT });
  mockRetrieveClock.mockResolvedValue({ testClockId: CLOCK, frozenTime: FROZEN, status: 'ready' });
  mockAdvanceClock.mockResolvedValue({ testClockId: CLOCK, frozenTime: '2026-11-03T00:00:00.000Z', status: 'advancing' });
  mockFindEntitlementInputs.mockResolvedValue({ data: { plan: planRow(), overrides: [] }, error: null });
});

afterAll(() => {
  for (const name of ENV) {
    if (original[name] === undefined) delete process.env[name];
    else process.env[name] = original[name];
  }
});

describe('the gate and the order (SA C-5)', () => {
  it('401 when signed out, before anything is read', async () => {
    mockGetUser.mockResolvedValue(null);
    const res = await call({ action: 'status', accountId: ACCOUNT });
    expect(res.status).toBe(401);
    expect(mockIsTenant).not.toHaveBeenCalled();
    noStripeCall();
  });

  it('403 for a signed-in non-admin', async () => {
    mockIsAdmin.mockResolvedValue(false);
    const res = await call({ action: 'attach', accountId: ACCOUNT });
    expect(res.status).toBe(403);
    expect(mockFindByUser).not.toHaveBeenCalled();
    noStripeCall();
    noWrite();
  });

  it.each([
    ['checkout switch off', 'BUSINESS_OS_PLAN_CHECKOUT_ENABLED'],
    ['price switch off', 'BUSINESS_OS_PLAN_PRICES_ENABLED'],
  ])('%s: 404 not_enabled, with no repository or Stripe call', async (_label, flag) => {
    process.env[flag] = 'false';
    const res = await call({ action: 'attach', accountId: ACCOUNT });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ success: false, error: 'not_enabled' });
    expect(mockIsTenant).not.toHaveBeenCalled();
    expect(mockFindByUser).not.toHaveBeenCalled();
    noStripeCall();
    noWrite();
  });

  it.each([
    ['no body', undefined],
    ['unknown action', { action: 'rewind', accountId: ACCOUNT }],
    ['missing accountId', { action: 'status' }],
    ['not a uuid', { action: 'status', accountId: 'acct-1' }],
    ['extra field (strict)', { action: 'attach', accountId: ACCOUNT, customerId: 'cus_x' }],
    ['advance without a target', { action: 'advance', accountId: ACCOUNT }],
    ['advance with a date-only target', { action: 'advance', accountId: ACCOUNT, to: '2026-11-03' }],
  ])('400 invalid_input: %s', async (_label, body) => {
    const res = await call(body === undefined ? '' : body);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('invalid_input');
    noStripeCall();
    noWrite();
  });

  it('404 not_a_tenant, and 500 when the tenant check cannot tell', async () => {
    mockIsTenant.mockResolvedValue(false);
    const notTenant = await call({ action: 'attach', accountId: ACCOUNT });
    expect(notTenant.status).toBe(404);
    expect((await notTenant.json()).error).toBe('not_a_tenant');

    mockIsTenant.mockResolvedValue(null);
    const unknown = await call({ action: 'attach', accountId: ACCOUNT });
    expect(unknown.status).toBe(500);
    noStripeCall();
    noWrite();
  });

  it('409 live_mode_refused with a live key, for every action, with no Stripe call', async () => {
    process.env.STRIPE_SECRET_KEY = 'sk_live_unit';
    for (const body of [
      { action: 'attach', accountId: ACCOUNT },
      { action: 'status', accountId: ACCOUNT },
      { action: 'advance', accountId: ACCOUNT, to: '2026-11-03T00:00:00.000Z' },
    ]) {
      const res = await call(body);
      expect(res.status).toBe(409);
      expect((await res.json()).error).toBe('live_mode_refused');
    }
    expect(mockFindByUser).not.toHaveBeenCalled();
    noStripeCall();
    noWrite();
  });

  it('the account is tenant-checked in canonical lower case', async () => {
    await call({ action: 'status', accountId: ACCOUNT.toUpperCase() });
    expect(mockIsTenant).toHaveBeenCalledWith(expect.objectContaining({ accountId: ACCOUNT }));
    expect(mockFindByUser).toHaveBeenCalledWith(ACCOUNT, false);
  });
});

describe('attach (C-6)', () => {
  it('replaces the test-mode customer with a fresh test-clock customer, clearing the mirror, and audits once', async () => {
    const res = await call({ action: 'attach', accountId: ACCOUNT });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      success: true,
      data: {
        testClockId: CLOCK,
        frozenTime: FROZEN,
        status: 'ready',
        customerId: NEW_CUSTOMER,
        recordPath: 'replaced',
        previousCustomerId: OLD_CUSTOMER,
      },
    });

    expect(mockFindByUser).toHaveBeenCalledWith(ACCOUNT, false);
    expect(mockCreateClockCustomer).toHaveBeenCalledWith({ bosUserId: ACCOUNT, frozenTimeUnix: expect.any(Number) });
    expect(mockAttachCustomer).toHaveBeenCalledWith({
      userId: ACCOUNT,
      oldCustomerId: OLD_CUSTOMER,
      newCustomerId: NEW_CUSTOMER,
      nowIso: expect.any(String),
    });
    expect(mockRecordCustomer).not.toHaveBeenCalled();

    expect(mockLogAndFlush).toHaveBeenCalledTimes(1);
    const [entry] = mockLogAndFlush.mock.calls[0];
    expect(entry).toMatchObject({
      action: AUDIT_EVENTS.BOS_BILLING_TEST_CLOCK_ATTACHED,
      entityType: 'business_os_account_plan',
      entityId: ACCOUNT,
      userId: ACCOUNT,
      actorId: ADMIN.id,
      details: { testClockId: CLOCK, customerId: NEW_CUSTOMER, previousCustomerId: OLD_CUSTOMER, recordPath: 'replaced', livemode: false },
    });
  });

  it('an ended previous subscription does not block a new clock (the rows C-6 is about)', async () => {
    mockFindByUser.mockResolvedValue({
      data: billingRow({
        stripeSubscriptionId: 'sub_old',
        subscriptionStatus: 'canceled',
        endedAt: '2026-12-15T00:00:00.000Z',
        currentPeriodEnd: '2027-01-01T00:00:00.000Z',
      }),
      error: null,
    });
    const res = await call({ action: 'attach', accountId: ACCOUNT });
    expect(res.status).toBe(200);
    expect(mockAttachCustomer).toHaveBeenCalledTimes(1);
  });

  it('records a new test-mode row when the account has none', async () => {
    mockFindByUser.mockResolvedValue({ data: null, error: null });
    const res = await call({ action: 'attach', accountId: ACCOUNT });
    expect(res.status).toBe(200);
    expect((await res.json()).data).toMatchObject({ recordPath: 'recorded', previousCustomerId: null });
    expect(mockRecordCustomer).toHaveBeenCalledWith({ userId: ACCOUNT, livemode: false, stripeCustomerId: NEW_CUSTOMER });
    expect(mockAttachCustomer).not.toHaveBeenCalled();
    expect(mockLogAndFlush).toHaveBeenCalledTimes(1);
  });

  it('the admin may target their own account (test mode only)', async () => {
    mockFindByUser.mockResolvedValue({ data: null, error: null });
    const res = await call({ action: 'attach', accountId: ADMIN.id });
    expect(res.status).toBe(200);
  });

  it.each([
    ['active', { stripeSubscriptionId: 'sub_1', subscriptionStatus: 'active' }],
    ['past_due', { stripeSubscriptionId: 'sub_1', subscriptionStatus: 'past_due' }],
    ['not ended yet, whatever the status', { stripeSubscriptionId: 'sub_1', subscriptionStatus: null }],
  ])('409 subscription_live (%s), with no Stripe call and no write', async (_label, overrides) => {
    mockFindByUser.mockResolvedValue({ data: billingRow(overrides), error: null });
    const res = await call({ action: 'attach', accountId: ACCOUNT });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe('subscription_live');
    noStripeCall();
    noWrite();
  });

  it('409 checkout_open while an unexpired checkout lock is held; an expired one does not block', async () => {
    mockFindByUser.mockResolvedValue({
      data: billingRow({ openCheckoutSessionId: 'cs_1', openCheckoutExpiresAt: new Date(Date.now() + 3600_000).toISOString() }),
      error: null,
    });
    const open = await call({ action: 'attach', accountId: ACCOUNT });
    expect(open.status).toBe(409);
    expect((await open.json()).error).toBe('checkout_open');
    noStripeCall();

    mockFindByUser.mockResolvedValue({
      data: billingRow({ openCheckoutSessionId: 'cs_1', openCheckoutExpiresAt: new Date(Date.now() - 3600_000).toISOString() }),
      error: null,
    });
    expect((await call({ action: 'attach', accountId: ACCOUNT })).status).toBe(200);
  });

  it('409 concurrent_change when the compare-and-set finds the customer already changed; no audit', async () => {
    mockAttachCustomer.mockResolvedValue({ data: { replaced: false }, error: null });
    const res = await call({ action: 'attach', accountId: ACCOUNT });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe('concurrent_change');
    expect(mockLogAndFlush).not.toHaveBeenCalled();
  });

  it('409 concurrent_change when another request recorded the new row first (created: false); no audit (QA E-1)', async () => {
    mockFindByUser.mockResolvedValue({ data: null, error: null });
    // The repository found a row already there: another request won the race.
    mockRecordCustomer.mockResolvedValue({ data: { account: billingRow({ stripeCustomerId: 'cus_winner' }), created: false }, error: null });
    const res = await call({ action: 'attach', accountId: ACCOUNT });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ success: false, error: 'concurrent_change' });
    expect(mockRecordCustomer).toHaveBeenCalledWith({ userId: ACCOUNT, livemode: false, stripeCustomerId: NEW_CUSTOMER });
    expect(mockAttachCustomer).not.toHaveBeenCalled();
    expect(mockLogAndFlush).not.toHaveBeenCalled();
  });

  it('500 when the billing row cannot be read, before any Stripe call', async () => {
    mockFindByUser.mockResolvedValue({ data: null, error: new Error('db down') });
    const res = await call({ action: 'attach', accountId: ACCOUNT });
    expect(res.status).toBe(500);
    noStripeCall();
    noWrite();
  });

  it('500 and nothing recorded when Stripe returns a live customer (PF-15)', async () => {
    mockCreateClockCustomer.mockResolvedValue({ testClockId: CLOCK, frozenTime: FROZEN, customerId: NEW_CUSTOMER, livemode: true });
    const res = await call({ action: 'attach', accountId: ACCOUNT });
    expect(res.status).toBe(500);
    noWrite();
  });
});

describe('advance', () => {
  const advance = (to: string, accountId = ACCOUNT) => call({ action: 'advance', accountId, to });

  it('advances the account\'s own clock', async () => {
    const res = await advance('2026-11-03T00:00:00.000Z');
    expect(res.status).toBe(200);
    expect(mockAdvanceClock).toHaveBeenCalledWith(CLOCK, Date.parse('2026-11-03T00:00:00.000Z') / 1000);
    expect((await res.json()).data).toEqual({ testClockId: CLOCK, frozenTime: '2026-11-03T00:00:00.000Z', status: 'advancing' });
    expect(mockLogAndFlush).not.toHaveBeenCalled();
  });

  it.each([
    ['a target at the frozen time', FROZEN, 'target_in_past'],
    ['a target in the past', '2026-10-01T00:00:00.000Z', 'target_in_past'],
    ['more than 60 days ahead', '2027-01-01T00:00:01.000Z', 'target_too_far'],
  ])('409 for %s, with no advance', async (_label, to, code) => {
    const res = await advance(to);
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe(code);
    expect(mockAdvanceClock).not.toHaveBeenCalled();
  });

  it('exactly 60 days ahead is allowed', async () => {
    const res = await advance('2026-12-31T00:00:00.000Z');
    expect(res.status).toBe(200);
  });

  it('409 foreign_clock when the stored customer belongs to another account', async () => {
    mockRetrieveCustomerClock.mockResolvedValue({ deleted: false, testClockId: CLOCK, bosUserId: OTHER });
    const res = await advance('2026-11-03T00:00:00.000Z');
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe('foreign_clock');
    expect(mockAdvanceClock).not.toHaveBeenCalled();
  });

  it.each([
    ['no billing row', () => mockFindByUser.mockResolvedValue({ data: null, error: null })],
    ['a customer with no clock', () => mockRetrieveCustomerClock.mockResolvedValue({ deleted: false, testClockId: null, bosUserId: ACCOUNT })],
    ['a deleted customer', () => mockRetrieveCustomerClock.mockResolvedValue({ deleted: true, testClockId: null, bosUserId: null })],
  ])('409 no_test_clock: %s', async (_label, arrange) => {
    arrange();
    const res = await advance('2026-11-03T00:00:00.000Z');
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe('no_test_clock');
    expect(mockAdvanceClock).not.toHaveBeenCalled();
  });

  it('409 clock_not_ready while the clock is still advancing', async () => {
    mockRetrieveClock.mockResolvedValue({ testClockId: CLOCK, frozenTime: FROZEN, status: 'advancing' });
    const res = await advance('2026-11-03T00:00:00.000Z');
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe('clock_not_ready');
  });

  it('a Stripe refusal of the advance is a coded 409, never a 500', async () => {
    mockAdvanceClock.mockRejectedValue(
      Object.assign(new Error('Cannot advance more than two intervals'), { type: 'StripeInvalidRequestError', code: 'test_clock_advance_too_far' })
    );
    const res = await advance('2026-11-03T00:00:00.000Z');
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe('advance_refused');
  });

  it('any other Stripe failure is a 500 with no details in production', async () => {
    mockAdvanceClock.mockRejectedValue(Object.assign(new Error('socket hang up'), { type: 'StripeConnectionError' }));
    const res = await advance('2026-11-03T00:00:00.000Z');
    expect(res.status).toBe(500);
  });
});

describe('status (C-7): the lifecycle at the CLOCK\'s time', () => {
  it('reads grace once the clock is past the paid-through date plus the 24-hour margin', async () => {
    // Paid through 30 October; the clock reads 1 November: T + 2 days.
    mockFindByUser.mockResolvedValue({
      data: billingRow({
        stripeCustomerId: NEW_CUSTOMER,
        stripeSubscriptionId: 'sub_1',
        subscriptionStatus: 'past_due',
        currentPeriodEnd: '2026-10-30T00:00:00.000Z',
        lastPaymentFailedAt: '2026-10-30T01:00:00.000Z',
        failedAttempts: 2,
        actionRequiredInvoiceUrl: 'https://invoice.stripe.com/i/secret',
      }),
      error: null,
    });
    const res = await call({ action: 'status', accountId: ACCOUNT });
    expect(res.status).toBe(200);
    const { data } = await res.json();
    const graceDays = LIFECYCLE_CONFIG.subscriptionGraceHistory[1].days;

    expect(data.clock).toEqual({ testClockId: CLOCK, frozenTime: FROZEN, status: 'ready' });
    expect(data.lifecycle).toMatchObject({
      state: 'grace',
      reason: 'tier_expired_no_cohort',
      accessEndsAt: '2026-10-30T00:00:00.000Z',
      graceEndsAt: new Date(Date.parse('2026-10-31T00:00:00.000Z') + graceDays * 86400000).toISOString(),
    });
    expect(data.billing).toMatchObject({ subscriptionStatus: 'past_due', failedAttempts: 2, hasActionRequiredUrl: true });
    expect(data.plan).toMatchObject({ tierExpiresAt: '2026-10-30T00:00:00.000Z', periodAnchor: '2026-09-30T00:00:00.000Z' });
    // The hosted invoice URL is a bearer link: never in the response or a log line.
    expect(JSON.stringify(data)).not.toContain('invoice.stripe.com');
    expect(JSON.stringify(mockLogLines)).not.toContain('invoice.stripe.com');
    noWrite();
  });

  it('reads active, reason tier_in_settlement_margin, inside the margin', async () => {
    mockRetrieveClock.mockResolvedValue({ testClockId: CLOCK, frozenTime: '2026-10-30T01:00:00.000Z', status: 'ready' });
    const { data } = await (await call({ action: 'status', accountId: ACCOUNT })).json();
    expect(data.lifecycle).toMatchObject({ state: 'active', reason: 'tier_in_settlement_margin' });
  });

  it('AC-F6.5: a Founding Partner whose free access is live reads champion after the margin', async () => {
    mockFindEntitlementInputs.mockResolvedValue({
      data: { plan: planRow({ cohort: 'champion', cohort_expires_at: '2027-06-01T00:00:00.000Z' }), overrides: [] },
      error: null,
    });
    const { data } = await (await call({ action: 'status', accountId: ACCOUNT })).json();
    expect(data.lifecycle).toMatchObject({ state: 'champion', basis: { kind: 'cohort', cohort: 'champion' }, graceEndsAt: null });
  });

  it('409 no_test_clock when the account is not on a clock; 409 foreign_clock for another account\'s customer', async () => {
    mockRetrieveCustomerClock.mockResolvedValue({ deleted: false, testClockId: null, bosUserId: ACCOUNT });
    expect((await (await call({ action: 'status', accountId: ACCOUNT })).json()).error).toBe('no_test_clock');

    mockRetrieveCustomerClock.mockResolvedValue({ deleted: false, testClockId: CLOCK, bosUserId: OTHER });
    expect((await (await call({ action: 'status', accountId: ACCOUNT })).json()).error).toBe('foreign_clock');
    expect(mockRetrieveClock).not.toHaveBeenCalled();
  });
});
