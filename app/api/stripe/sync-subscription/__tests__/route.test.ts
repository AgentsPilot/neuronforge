/**
 * sync-subscription after plan payments P-10 (CF-3): refused with 410, auth
 * first, no Stripe client, no service-role client, no database call, no audit.
 */

const USER = { id: '2f734ed5-3681-4049-880d-3de7b096bea3', email: 'owner@example.com' };

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
  createServerClient: () => ({ auth: { getUser: () => mockGetUser() }, from: mockFrom }),
}));

// The old body built both of these at module load; the stub must build neither.
const mockCreateAdminClient = jest.fn();
jest.mock('@supabase/supabase-js', () => ({ createClient: (...a: unknown[]) => mockCreateAdminClient(...a) }));
const mockStripeConstructor = jest.fn();
jest.mock('stripe', () => jest.fn().mockImplementation((...a: unknown[]) => mockStripeConstructor(...a)));
const mockGetStripeService = jest.fn();
jest.mock('@/lib/stripe/StripeService', () => ({ getStripeService: () => mockGetStripeService() }));
const mockAudit = jest.fn();
jest.mock('@/lib/services/AuditTrailService', () => ({ AuditTrail: { log: mockAudit }, auditLog: mockAudit }));

import { POST } from '../route';

beforeEach(() => {
  mockWarn.mockClear();
  mockFrom.mockClear();
  mockGetUser.mockReset();
  mockGetStripeService.mockClear();
  mockAudit.mockClear();
});

describe('POST /api/stripe/sync-subscription', () => {
  it('builds no Stripe client and no service-role client at module load', () => {
    expect(mockStripeConstructor).not.toHaveBeenCalled();
    expect(mockCreateAdminClient).not.toHaveBeenCalled();
  });

  it('unauthenticated → 401', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error: null });
    const res = await POST();
    expect(res.status).toBe(401);
    expect(mockWarn).not.toHaveBeenCalled();
  });

  it('signed in → 410, logged, and nothing is read or changed anywhere', async () => {
    mockGetUser.mockResolvedValue({ data: { user: USER }, error: null });
    const res = await POST();
    expect(res.status).toBe(410);
    expect(await res.json()).toEqual({ success: false, error: 'Credit subscriptions are no longer sold' });
    expect(mockStripeConstructor).not.toHaveBeenCalled();
    expect(mockCreateAdminClient).not.toHaveBeenCalled();
    expect(mockGetStripeService).not.toHaveBeenCalled();
    expect(mockFrom).not.toHaveBeenCalled();
    expect(mockAudit).not.toHaveBeenCalled();
    expect(mockWarn).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'stripe_sync_subscription_refused', userId: USER.id }),
      expect.any(String)
    );
  });

  it('an auth failure that throws → 500 without the internal message', async () => {
    mockGetUser.mockRejectedValue(new Error('internal auth detail'));
    const res = await POST();
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.details).toBeUndefined();
    expect(JSON.stringify(body)).not.toContain('internal auth detail');
  });
});
