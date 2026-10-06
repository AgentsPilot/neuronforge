/**
 * create-checkout after plan payments P-1: boost packs only; credit
 * subscriptions refused with 410 before any Stripe or database call (PF-12).
 */

import { NextRequest } from 'next/server';

const USER = { id: '2f734ed5-3681-4049-880d-3de7b096bea3', email: 'owner@example.com' };

const mockLog = jest.fn();
jest.mock('@/lib/services/AuditTrailService', () => ({
  AuditTrail: { log: (...args: unknown[]) => mockLog(...args) },
}));

const mockWarn = jest.fn();
jest.mock('@/lib/logger', () => {
  const make = (): Record<string, unknown> => {
    const logger: Record<string, unknown> = {
      info: jest.fn(),
      warn: (...a: unknown[]) => mockWarn(...a),
      error: jest.fn(),
      debug: jest.fn(),
    };
    logger.child = () => logger;
    return logger;
  };
  return { createLogger: () => make() };
});

jest.mock('next/headers', () => ({ cookies: () => ({ get: () => undefined }) }));

const mockFrom = jest.fn();
function mockBuilder(): unknown {
  const result = { data: { full_name: 'Owner' }, error: null };
  return new Proxy(
    {},
    {
      get(_t, prop) {
        if (prop === 'then') return (resolve: (v: unknown) => void) => resolve(result);
        if (prop === 'single') return () => Promise.resolve(result);
        return () => mockBuilder();
      },
    }
  );
}

const mockGetUser = jest.fn();
jest.mock('@supabase/ssr', () => ({
  createServerClient: () => ({
    auth: { getUser: () => mockGetUser() },
    from: (table: string) => {
      mockFrom(table);
      return mockBuilder();
    },
  }),
}));
jest.mock('@/lib/supabaseServer', () => ({ supabaseServer: { __kind: 'service-role' } }));

const mockStripeService = {
  createCustomCreditSubscription: jest.fn(),
  createBoostPackCheckout: jest.fn(),
};
const mockGetStripeService = jest.fn(() => mockStripeService);
jest.mock('@/lib/stripe/StripeService', () => ({ getStripeService: () => mockGetStripeService() }));

import { readFileSync } from 'fs';
import { join } from 'path';
import { POST } from '../route';

function req(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/stripe/create-checkout', {
    method: 'POST',
    body: typeof body === 'string' ? body : JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockLog.mockResolvedValue(undefined);
  mockGetUser.mockResolvedValue({ data: { user: USER }, error: null });
  mockStripeService.createBoostPackCheckout.mockResolvedValue({ id: 'cs_boost', client_secret: 'secret_boost' });
});

describe('POST /api/stripe/create-checkout', () => {
  it('boost_pack: creates the session under the session user and queues BOOST_PACK_CHECKOUT_INITIATED', async () => {
    const res = await POST(req({ purchaseType: 'boost_pack', boostPackId: 'bp_1' }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ sessionId: 'cs_boost', clientSecret: 'secret_boost' });
    expect(mockStripeService.createBoostPackCheckout).toHaveBeenCalledWith(
      expect.objectContaining({ userId: USER.id, boostPackId: 'bp_1', supabase: { __kind: 'service-role' } })
    );
    expect(mockLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'BOOST_PACK_CHECKOUT_INITIATED', entityId: 'bp_1', userId: USER.id })
    );
  });

  // CLAUDE.md rule 1: the profile read goes through UserProfileRepository, on the
  // caller's cookie client (RLS applies), and only full_name is used.
  it('boost_pack: reads the customer name through UserProfileRepository', async () => {
    const res = await POST(req({ purchaseType: 'boost_pack', boostPackId: 'bp_1' }));
    expect(res.status).toBe(200);
    expect(mockFrom).toHaveBeenCalledWith('profiles');
    expect(mockStripeService.createBoostPackCheckout).toHaveBeenCalledWith(expect.objectContaining({ name: 'Owner' }));
  });

  it('the route makes no direct Supabase table call (source guard)', () => {
    const source = readFileSync(join(__dirname, '..', 'route.ts'), 'utf8');
    expect(source).not.toMatch(/\.from\(/);
    expect(source).toContain('new UserProfileRepository(supabase).findById(user.id)');
  });

  it('unauthenticated → 401, nothing else happens', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error: null });
    const res = await POST(req({ purchaseType: 'boost_pack', boostPackId: 'bp_1' }));
    expect(res.status).toBe(401);
    expect(mockGetStripeService).not.toHaveBeenCalled();
    expect(mockLog).not.toHaveBeenCalled();
  });

  it.each([
    ['an unknown purchase type', { purchaseType: 'x' }],
    ['no purchase type', {}],
    ['a body that is not JSON', 'not json'],
  ])('%s → 400', async (_label, body) => {
    const res = await POST(req(body));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ success: false, error: 'Invalid purchase type' });
    expect(mockGetStripeService).not.toHaveBeenCalled();
  });

  it('boost_pack without an id → 400', async () => {
    const res = await POST(req({ purchaseType: 'boost_pack' }));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: 'Boost pack ID is required' });
    expect(mockStripeService.createBoostPackCheckout).not.toHaveBeenCalled();
  });

  it('custom_credits → 410, logged, no Stripe call, no database call, no audit entry (PF-12)', async () => {
    const res = await POST(req({ purchaseType: 'custom_credits', pilotCredits: 5000 }));
    expect(res.status).toBe(410);
    expect(await res.json()).toEqual({ success: false, error: 'Credit subscriptions are no longer sold' });
    expect(mockGetStripeService).not.toHaveBeenCalled();
    expect(mockStripeService.createCustomCreditSubscription).not.toHaveBeenCalled();
    expect(mockFrom).not.toHaveBeenCalled();
    expect(mockLog).not.toHaveBeenCalled();
    expect(mockWarn).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'stripe_checkout_subscription_refused', userId: USER.id }),
      expect.any(String)
    );
  });

  it('a Stripe failure → 500 with no internal message outside development', async () => {
    mockStripeService.createBoostPackCheckout.mockRejectedValue(new Error('secret internal detail'));
    const res = await POST(req({ purchaseType: 'boost_pack', boostPackId: 'bp_1' }));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body).toEqual({ success: false, error: 'Failed to create checkout session' });
    expect(JSON.stringify(body)).not.toContain('secret internal detail');
  });
});
