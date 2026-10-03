/**
 * update-subscription after plan payments P-1 (SA Q-3): refused with 410,
 * auth first, no Stripe call, no database call, no audit entry.
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

const mockGetStripeService = jest.fn();
jest.mock('@/lib/stripe/StripeService', () => ({ getStripeService: () => mockGetStripeService() }));
const mockAudit = jest.fn();
jest.mock('@/lib/services/AuditTrailService', () => ({ AuditTrail: { log: mockAudit }, auditLog: mockAudit }));

import { POST } from '../route';

beforeEach(() => jest.clearAllMocks());

describe('POST /api/stripe/update-subscription', () => {
  it('unauthenticated → 401', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error: null });
    const res = await POST();
    expect(res.status).toBe(401);
    expect(mockWarn).not.toHaveBeenCalled();
  });

  it('signed in → 410, logged, and nothing is changed anywhere', async () => {
    mockGetUser.mockResolvedValue({ data: { user: USER }, error: null });
    const res = await POST();
    expect(res.status).toBe(410);
    expect(await res.json()).toEqual({ success: false, error: 'Credit subscriptions are no longer sold' });
    expect(mockGetStripeService).not.toHaveBeenCalled();
    expect(mockFrom).not.toHaveBeenCalled();
    expect(mockAudit).not.toHaveBeenCalled();
    expect(mockWarn).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'stripe_subscription_update_refused', userId: USER.id }),
      expect.any(String)
    );
  });

  it('an auth failure that throws → 500 without the internal message', async () => {
    mockGetUser.mockRejectedValue(new Error('internal auth detail'));
    const res = await POST();
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain('internal auth detail');
  });
});
