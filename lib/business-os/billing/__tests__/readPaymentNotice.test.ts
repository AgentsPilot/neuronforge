/**
 * readPaymentNotice (plan payments P-6a.2; workplan §5.6; SA C-13): the owner
 * banner read for the Business OS layout, with `readPlanBadge`'s guarantees.
 */

const mockGetUser = jest.fn();
jest.mock('@/lib/auth', () => ({ getUser: () => mockGetUser() }));
const mockGetSnapshot = jest.fn();
jest.mock('@/lib/business-os/entitlements/EntitlementService', () => ({
  getEntitlementService: () => ({ getSnapshot: (id: string) => mockGetSnapshot(id) }),
}));
jest.mock('@/lib/repositories/BusinessOsBillingAccountRepository', () => {
  const actual = jest.requireActual('@/lib/repositories/BusinessOsBillingAccountRepository');
  return { ...actual, businessOsBillingAccountRepository: { findByUser: jest.fn(() => { throw new Error('the default repository must not be reached in this test'); }) } };
});
jest.mock('@/lib/logger', () => {
  const logger: Record<string, unknown> = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
  logger.child = () => logger;
  return { createLogger: () => logger };
});

import { readPaymentNotice, type ReadPaymentNoticeDeps } from '@/lib/business-os/billing/readPaymentNotice';
import type { BusinessOsBillingAccount } from '@/lib/repositories/BusinessOsBillingAccountRepository';

const USER = 'aaaaaaaa-1111-4111-8111-111111111111';
const URL = 'https://invoice.stripe.com/i/acct_probe/test_banner?s=ap';

function row(overrides: Partial<BusinessOsBillingAccount> = {}): BusinessOsBillingAccount {
  return {
    id: '33333333-3333-4333-8333-333333333333',
    accountId: USER,
    livemode: false,
    stripeCustomerId: 'cus_probe',
    stripeSubscriptionId: 'sub_probe',
    subscriptionStatus: 'past_due',
    boughtTier: 'tier_probe',
    currentPeriodEnd: '2027-01-15T07:05:22.000Z',
    cancelAtPeriodEnd: false,
    pendingTier: null,
    openCheckoutSessionId: null,
    openCheckoutExpiresAt: null,
    lastInvoiceId: 'in_probe',
    lastPaidAt: '2026-12-15T08:05:22.000Z',
    lastPaymentFailedAt: '2026-10-15T07:05:55.000Z',
    failedAttempts: 1,
    actionRequiredInvoiceUrl: null,
    founderDiscountAppliedAt: null,
    endedAt: null,
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
    ...overrides,
  };
}

function setup(overrides: Partial<ReadPaymentNoticeDeps> = {}, billingRow: BusinessOsBillingAccount | null = row()) {
  const findByUser = jest.fn(async () => ({ data: billingRow, error: null }));
  const warn = jest.fn();
  const getUser = jest.fn(async () => ({ id: USER }));
  const snapshot = jest.fn(async () => ({ resolution: { lifecycle: { state: 'grace', graceEndsAt: '2027-01-21T07:05:22.000Z' } } }));
  const deps: ReadPaymentNoticeDeps = {
    pricesEnabled: () => true,
    getUser,
    billing: { findByUser } as unknown as ReadPaymentNoticeDeps['billing'],
    entitlements: () => ({ getSnapshot: snapshot }),
    stripeMode: () => 'test',
    enforcing: () => false,
    label: (tier) => `Label of ${tier}`,
    logger: { warn },
    ...overrides,
  };
  return { deps, findByUser, warn, getUser, snapshot };
}

beforeEach(() => {
  mockGetUser.mockReset();
  mockGetSnapshot.mockReset();
});

describe('readPaymentNotice', () => {
  it('1. off with the price switch: nothing is read at all (no session, no billing row, no snapshot)', async () => {
    const h = setup({ pricesEnabled: () => false });
    await expect(readPaymentNotice(h.deps)).resolves.toBeNull();
    expect(h.getUser).not.toHaveBeenCalled();
    expect(h.findByUser).not.toHaveBeenCalled();
    expect(h.snapshot).not.toHaveBeenCalled();
  });

  it('1. the real switch: unset means off, and no default port is touched', async () => {
    const saved = process.env.BUSINESS_OS_PLAN_PRICES_ENABLED;
    delete process.env.BUSINESS_OS_PLAN_PRICES_ENABLED;
    try {
      await expect(readPaymentNotice({ logger: { warn: jest.fn() } })).resolves.toBeNull();
      expect(mockGetUser).not.toHaveBeenCalled();
      expect(mockGetSnapshot).not.toHaveBeenCalled();
    } finally {
      if (saved === undefined) delete process.env.BUSINESS_OS_PLAN_PRICES_ENABLED;
      else process.env.BUSINESS_OS_PLAN_PRICES_ENABLED = saved;
    }
  });

  it('2. no session → null; the account id is never invented', async () => {
    const h = setup({ getUser: async () => null });
    await expect(readPaymentNotice(h.deps)).resolves.toBeNull();
    expect(h.findByUser).not.toHaveBeenCalled();
  });

  it('3. reads OUR record by the seam-resolved account and the server key\'s mode, and the snapshot by the same id', async () => {
    const h = setup();
    await readPaymentNotice(h.deps);
    expect(h.findByUser).toHaveBeenCalledWith(USER, false);
    expect(h.snapshot).toHaveBeenCalledWith(USER);
  });

  it('live key → the live row is read', async () => {
    const h = setup({ stripeMode: () => 'live' }, row({ livemode: true }));
    await expect(readPaymentNotice(h.deps)).resolves.toMatchObject({ kind: 'payment_failed' });
    expect(h.findByUser).toHaveBeenCalledWith(USER, true);
  });

  it('payment_failed in grace: the label and the lifecycle\'s pause date, nothing else', async () => {
    const h = setup();
    await expect(readPaymentNotice(h.deps)).resolves.toEqual({ kind: 'payment_failed', planLabel: 'Label of tier_probe', pauseBy: '2027-01-21T07:05:22.000Z' });
  });

  it('action_required: the hosted URL travels to this owner only, and only for this kind', async () => {
    const h = setup({}, row({ actionRequiredInvoiceUrl: URL }));
    await expect(readPaymentNotice(h.deps)).resolves.toEqual({ kind: 'action_required', planLabel: 'Label of tier_probe', confirmUrl: URL });
  });

  it('paused only when enforcing (SA Q-5); ended while paused', async () => {
    const paused = setup({ enforcing: () => true, entitlements: () => ({ getSnapshot: async () => ({ resolution: { lifecycle: { state: 'paused', graceEndsAt: null } } }) }) });
    await expect(readPaymentNotice(paused.deps)).resolves.toEqual({ kind: 'paused', planLabel: 'Label of tier_probe' });
    const ended = setup(
      { entitlements: () => ({ getSnapshot: async () => ({ resolution: { lifecycle: { state: 'paused', graceEndsAt: null } } }) }) },
      row({ subscriptionStatus: 'canceled', endedAt: '2027-02-01T00:00:00.000Z' })
    );
    await expect(readPaymentNotice(ended.deps)).resolves.toEqual({ kind: 'ended', planLabel: 'Label of tier_probe' });
  });

  it('no row, a healthy row, or no bought tier', async () => {
    await expect(readPaymentNotice(setup({}, null).deps)).resolves.toBeNull();
    await expect(readPaymentNotice(setup({}, row({ subscriptionStatus: 'active', failedAttempts: 0 })).deps)).resolves.toBeNull();
    await expect(readPaymentNotice(setup({}, row({ boughtTier: null })).deps)).resolves.toMatchObject({ planLabel: null });
  });

  it('an unreadable snapshot still tells a failed payment, without a pause date', async () => {
    const h = setup({ entitlements: () => ({ getSnapshot: async () => ({ resolution: null }) }) });
    await expect(readPaymentNotice(h.deps)).resolves.toEqual({ kind: 'payment_failed', planLabel: 'Label of tier_probe', pauseBy: null });
  });

  it.each([
    ['the session read throws', { getUser: async () => { throw new Error('auth down'); } }],
    ['the billing read errors', { billing: { findByUser: async () => ({ data: null, error: new Error('db down') }) } as unknown as ReadPaymentNoticeDeps['billing'] }],
    ['the snapshot throws', { entitlements: () => ({ getSnapshot: async () => { throw new Error('cache down'); } }) }],
    ['the key mode is unknown', { stripeMode: () => { throw new Error('no key'); } }],
  ])('4. %s → null and a warn', async (_label, overrides) => {
    const h = setup(overrides as Partial<ReadPaymentNoticeDeps>);
    await expect(readPaymentNotice(h.deps)).resolves.toBeNull();
    expect(h.warn).toHaveBeenCalledWith(expect.objectContaining({ event: 'bos_billing_payment_notice_unavailable' }), expect.any(String));
  });

  it('the hosted URL is never logged', async () => {
    const h = setup({ label: () => { throw new Error('label down'); } }, row({ actionRequiredInvoiceUrl: URL }));
    await expect(readPaymentNotice(h.deps)).resolves.toBeNull();
    expect(JSON.stringify(h.warn.mock.calls)).not.toContain('invoice.stripe.com');
  });
});
