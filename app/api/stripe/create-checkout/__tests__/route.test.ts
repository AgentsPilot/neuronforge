/**
 * create-checkout after plan payments P-10: every purchase type is refused with
 * 410 after auth and validation. `custom_credits` since P-1 (PF-12);
 * `boost_pack` since P-10, which owns Credits Boost FR-40 (TK-5, R-7). No
 * Stripe call, no database call, no audit entry.
 */

import { NextRequest } from 'next/server';

const USER = { id: '2f734ed5-3681-4049-880d-3de7b096bea3', email: 'owner@example.com' };

const mockLog = jest.fn();
jest.mock('@/lib/services/AuditTrailService', () => ({
  AuditTrail: { log: (...args: unknown[]) => mockLog(...args) },
  auditLog: (...args: unknown[]) => mockLog(...args),
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
const mockGetUser = jest.fn();
jest.mock('@supabase/ssr', () => ({
  createServerClient: () => ({
    auth: { getUser: () => mockGetUser() },
    from: (table: string) => mockFrom(table),
  }),
}));

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

function expectNothingHappened(): void {
  expect(mockGetStripeService).not.toHaveBeenCalled();
  expect(mockStripeService.createBoostPackCheckout).not.toHaveBeenCalled();
  expect(mockStripeService.createCustomCreditSubscription).not.toHaveBeenCalled();
  expect(mockFrom).not.toHaveBeenCalled();
  expect(mockLog).not.toHaveBeenCalled();
}

beforeEach(() => {
  jest.clearAllMocks();
  mockGetUser.mockResolvedValue({ data: { user: USER }, error: null });
});

describe('POST /api/stripe/create-checkout', () => {
  it.each([
    ['boost_pack', { purchaseType: 'boost_pack', boostPackId: 'bp_1' }, 'Boost packs are no longer sold'],
    ['boost_pack without an id', { purchaseType: 'boost_pack' }, 'Boost packs are no longer sold'],
    ['custom_credits', { purchaseType: 'custom_credits', pilotCredits: 5000 }, 'Credit subscriptions are no longer sold'],
  ])('%s → 410, logged, no Stripe call, no database call, no audit entry', async (_label, body, message) => {
    const res = await POST(req(body));
    expect(res.status).toBe(410);
    expect(await res.json()).toEqual({ success: false, error: message });
    expectNothingHappened();
    expect(mockWarn).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'stripe_checkout_refused',
        userId: USER.id,
        purchaseType: (body as { purchaseType: string }).purchaseType,
      }),
      expect.any(String)
    );
  });

  it('unauthenticated → 401, nothing else happens', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error: null });
    const res = await POST(req({ purchaseType: 'boost_pack', boostPackId: 'bp_1' }));
    expect(res.status).toBe(401);
    expectNothingHappened();
    expect(mockWarn).not.toHaveBeenCalled();
  });

  it.each([
    ['an unknown purchase type', { purchaseType: 'x' }],
    ['no purchase type', {}],
    ['a body that is not JSON', 'not json'],
  ])('%s → 400 (Zod still runs, CLAUDE.md rule 2)', async (_label, body) => {
    const res = await POST(req(body));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ success: false, error: 'Invalid purchase type' });
    expectNothingHappened();
  });

  it('an auth failure that throws → 500 with no internal message outside development', async () => {
    mockGetUser.mockRejectedValue(new Error('secret internal detail'));
    const res = await POST(req({ purchaseType: 'boost_pack', boostPackId: 'bp_1' }));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body).toEqual({ success: false, error: 'Failed to create checkout session' });
    expect(JSON.stringify(body)).not.toContain('secret internal detail');
  });

  it('source guard: the route reaches no Stripe service, table, service-role client or audit', () => {
    const source = readFileSync(join(__dirname, '..', 'route.ts'), 'utf8');
    expect(source).not.toMatch(/\.from\(/);
    expect(source).not.toMatch(/getStripeService|supabaseServer|AuditTrail|auditLog/);
  });
});
