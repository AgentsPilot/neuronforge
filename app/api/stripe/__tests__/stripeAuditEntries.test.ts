/**
 * The Stripe routes still write their audit entries after Layer 3 step 0 (Q-1).
 *
 * They used to POST to /api/audit/log over HTTP with an `x-user-id` header. That
 * route now needs a session, which a server-to-server fetch does not carry, so
 * the entries would silently have stopped. They are now written in-process,
 * under the session user, with the same action, entity, details and (through
 * EVENT_METADATA) the same severity and flags.
 */

import { NextRequest } from 'next/server';

const USER = { id: '2f734ed5-3681-4049-880d-3de7b096bea3', email: 'owner@example.com' };

const mockLog = jest.fn();
jest.mock('@/lib/services/AuditTrailService', () => ({
  AuditTrail: { log: (...args: unknown[]) => mockLog(...args) },
}));

jest.mock('@/lib/logger', () => {
  const make = (): Record<string, unknown> => {
    const logger: Record<string, unknown> = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
    logger.child = () => logger;
    return logger;
  };
  return { createLogger: () => make() };
});

jest.mock('next/headers', () => ({ cookies: () => ({ get: () => undefined }) }));

// A PostgREST builder: any chain, resolving to the row configured for its table.
const mockRows: Record<string, unknown> = {};
function mockBuilder(table: string): unknown {
  const result = { data: mockRows[table] ?? null, error: null };
  return new Proxy(
    {},
    {
      get(_t, prop) {
        if (prop === 'then') return (resolve: (v: unknown) => void) => resolve(result);
        if (prop === 'single') return () => Promise.resolve(result);
        return () => mockBuilder(table);
      },
    }
  );
}

const mockGetUser = jest.fn();
jest.mock('@supabase/ssr', () => ({
  createServerClient: () => ({
    auth: { getUser: () => mockGetUser() },
    from: (table: string) => mockBuilder(table),
  }),
}));
jest.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ from: (table: string) => mockBuilder(table) }),
}));

const mockSubscriptionUpdate = jest.fn();
jest.mock('stripe', () =>
  jest.fn().mockImplementation(() => ({ subscriptions: { update: (...a: unknown[]) => mockSubscriptionUpdate(...a) } }))
);

const mockStripeService = {
  createPortalSession: jest.fn(),
  createCustomCreditSubscription: jest.fn(),
  createBoostPackCheckout: jest.fn(),
};
jest.mock('@/lib/stripe/StripeService', () => ({ getStripeService: () => mockStripeService }));

import { getEventMetadata } from '@/lib/audit/events';
import { POST as cancelPOST } from '../cancel-subscription/route';
import { POST as reactivatePOST } from '../reactivate-subscription/route';
import { POST as portalPOST } from '../create-portal/route';
import { POST as checkoutPOST } from '../create-checkout/route';

function req(url: string, body?: unknown): NextRequest {
  return new NextRequest(url, {
    method: 'POST',
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  });
}

const fetchSpy = jest.spyOn(global, 'fetch');

beforeEach(() => {
  mockLog.mockReset();
  mockLog.mockResolvedValue(undefined);
  mockGetUser.mockReset();
  mockGetUser.mockResolvedValue({ data: { user: USER }, error: null });
  fetchSpy.mockReset();
  mockSubscriptionUpdate.mockReset();
  mockSubscriptionUpdate.mockResolvedValue({ id: 'sub_123', current_period_end: 1790000000 });
  mockStripeService.createPortalSession.mockResolvedValue({ id: 'bps_1', url: 'https://billing.stripe.test/x' });
  mockStripeService.createCustomCreditSubscription.mockResolvedValue({ id: 'cs_1', client_secret: 'secret_1' });
  mockStripeService.createBoostPackCheckout.mockResolvedValue({ id: 'cs_2', client_secret: 'secret_2' });
  for (const key of Object.keys(mockRows)) delete mockRows[key];
});

afterAll(() => fetchSpy.mockRestore());

/** The one audit entry the route wrote, and proof it went in-process. */
function onlyEntry() {
  expect(mockLog).toHaveBeenCalledTimes(1);
  const calledAuditRoute = fetchSpy.mock.calls.some(([url]) => String(url).includes('/api/audit/log'));
  expect(calledAuditRoute).toBe(false);
  return mockLog.mock.calls[0][0] as Record<string, unknown>;
}

/** Severity and flags stored come from metadata: assert they are what the route sent before. */
function expectStored(action: string, severity: string, flags: string[]) {
  expect(getEventMetadata(action).severity).toBe(severity);
  expect(getEventMetadata(action).complianceFlags).toEqual(flags);
}

describe('Stripe routes keep writing their audit entries (Q-1)', () => {
  it('cancel-subscription → SUBSCRIPTION_CANCELED under the session user', async () => {
    mockRows.user_subscriptions = { stripe_subscription_id: 'sub_123', stripe_customer_id: 'cus_1' };
    const res = await cancelPOST(req('http://localhost/api/stripe/cancel-subscription'));
    expect(res.status).toBe(200);
    const entry = onlyEntry();
    expect(entry).toMatchObject({
      action: 'SUBSCRIPTION_CANCELED',
      entityType: 'subscription',
      entityId: 'sub_123',
      userId: USER.id,
      resourceName: 'Subscription Cancellation',
      details: expect.objectContaining({ subscription_id: 'sub_123', cancel_at_period_end: true }),
    });
    expect(entry).not.toHaveProperty('request');
    expectStored('SUBSCRIPTION_CANCELED', 'info', ['SOC2', 'FINANCIAL']);
  });

  it('reactivate-subscription → SUBSCRIPTION_REACTIVATED under the session user', async () => {
    mockRows.user_subscriptions = { stripe_subscription_id: 'sub_123', stripe_customer_id: 'cus_1', cancel_at_period_end: true };
    const res = await reactivatePOST(req('http://localhost/api/stripe/reactivate-subscription'));
    expect(res.status).toBe(200);
    expect(onlyEntry()).toMatchObject({ action: 'SUBSCRIPTION_REACTIVATED', entityType: 'subscription', entityId: 'sub_123', userId: USER.id });
    expectStored('SUBSCRIPTION_REACTIVATED', 'info', ['SOC2', 'FINANCIAL']);
  });

  it('create-portal → CUSTOMER_PORTAL_ACCESSED under the session user', async () => {
    mockRows.user_subscriptions = { stripe_customer_id: 'cus_1' };
    const res = await portalPOST(req('http://localhost/api/stripe/create-portal'));
    expect(res.status).toBe(200);
    expect(onlyEntry()).toMatchObject({ action: 'CUSTOMER_PORTAL_ACCESSED', entityType: 'subscription', entityId: 'cus_1', userId: USER.id });
    expectStored('CUSTOMER_PORTAL_ACCESSED', 'info', ['SOC2']);
  });

  it('create-checkout (custom credits) → SUBSCRIPTION_CHECKOUT_INITIATED', async () => {
    const res = await checkoutPOST(req('http://localhost/api/stripe/create-checkout', { purchaseType: 'custom_credits', pilotCredits: 5000 }));
    expect(res.status).toBe(200);
    expect(onlyEntry()).toMatchObject({ action: 'SUBSCRIPTION_CHECKOUT_INITIATED', entityType: 'subscription', entityId: 'cs_1', userId: USER.id });
    expectStored('SUBSCRIPTION_CHECKOUT_INITIATED', 'info', ['SOC2', 'FINANCIAL']);
  });

  it('create-checkout (boost pack) → BOOST_PACK_CHECKOUT_INITIATED', async () => {
    const res = await checkoutPOST(req('http://localhost/api/stripe/create-checkout', { purchaseType: 'boost_pack', boostPackId: 'bp_1' }));
    expect(res.status).toBe(200);
    expect(onlyEntry()).toMatchObject({ action: 'BOOST_PACK_CHECKOUT_INITIATED', entityType: 'boost_pack', entityId: 'bp_1', userId: USER.id });
    expectStored('BOOST_PACK_CHECKOUT_INITIATED', 'info', ['SOC2', 'FINANCIAL']);
  });

  it('a failing audit write does not fail the payment action', async () => {
    mockLog.mockRejectedValue(new Error('queue broken'));
    mockRows.user_subscriptions = { stripe_customer_id: 'cus_1' };
    const res = await portalPOST(req('http://localhost/api/stripe/create-portal'));
    expect(res.status).toBe(200);
  });

  it('writes no entry when the caller is not signed in', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error: null });
    const res = await portalPOST(req('http://localhost/api/stripe/create-portal'));
    expect(res.status).toBe(401);
    expect(mockLog).not.toHaveBeenCalled();
  });
});
