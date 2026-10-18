/**
 * GET /api/admin/business-os/billing/subscriptions (plan payments P-8a.1;
 * workplan §5.3; AC-AM.2, AC-P8a.5, AC-SR.5).
 *
 * The admin gate is real (with `getUser` and the access service mocked); the
 * wiring and the name read are mocked; the builder and the MRR rule are REAL,
 * so the payload is exactly what the route sends.
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
jest.mock('@/lib/audit/recordRefusedAccess', () => ({ recordRefusedAccess: jest.fn(async () => undefined) }));

const logged: unknown[][] = [];
jest.mock('@/lib/logger', () => {
  const make = (): Record<string, unknown> => {
    const rec = (...a: unknown[]) => void logged.push(a);
    const logger: Record<string, unknown> = { info: rec, warn: rec, error: rec, debug: rec };
    logger.child = () => logger;
    return logger;
  };
  return { createLogger: () => make() };
});

const mockDeps = {
  readBillingRows: jest.fn(),
  readPlanRows: jest.fn(),
  readConfig: jest.fn(),
};
jest.mock('@/lib/admin/billing/subscriptionsDeps', () => ({ subscriptionsDeps: () => mockDeps }));

const mockFindNames = jest.fn();
jest.mock('@/lib/repositories/BusinessProfileRepository', () => ({
  businessProfileRepository: { findAdminIdentitiesByUserIds: (...a: unknown[]) => mockFindNames(...a) },
}));

import { GET } from '../route';
import { getEntitlementConfig } from '@/lib/business-os/entitlements/source';
import { planMonthlyPriceUsd } from '@/lib/business-os/entitlements/planPresentation';
import { STRIPE_MODE_UNKNOWN, type SubscriptionsPayload } from '@/lib/admin/billing/subscriptionsTypes';
import type { AdminBillingRow } from '@/lib/repositories/BusinessOsBillingAdminReadRepository';

const config = getEntitlementConfig();
const TIER = config.tierOrder[0];
const ADMIN = { id: '11111111-1111-4111-8111-11111111111a', email: 'ops@example.com' };
const CUSTOMER = { id: '22222222-2222-4222-8222-22222222222b', email: 'customer@example.com' };
const ACCOUNT = 'abcdef99-9999-4999-8999-99999999999f';
const env = process.env as Record<string, string | undefined>;
const savedKey = env.STRIPE_SECRET_KEY;

const call = (query = '') => GET(new NextRequest(`http://localhost/api/admin/business-os/billing/subscriptions${query}`));

const asAdmin = () => {
  mockGetUser.mockResolvedValue(ADMIN);
  mockIsAdmin.mockResolvedValue(true);
};

function billing(patch: Partial<AdminBillingRow> = {}): AdminBillingRow {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    user_id: ACCOUNT,
    livemode: false,
    subscription_status: 'active',
    bought_tier: TIER,
    current_period_end: '2099-11-01T00:00:00.000Z',
    cancel_at_period_end: false,
    pending_tier: null,
    last_paid_at: '2026-10-01T00:00:00.000Z',
    last_payment_failed_at: null,
    failed_attempts: 0,
    founder_discount_applied_at: null,
    ended_at: null,
    ...patch,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  logged.length = 0;
  env.STRIPE_SECRET_KEY = 'sk_test_only_value';
  mockDeps.readBillingRows.mockResolvedValue({ data: [billing()], error: null });
  mockDeps.readPlanRows.mockResolvedValue({ data: [], error: null });
  mockDeps.readConfig.mockReturnValue(config);
  mockFindNames.mockResolvedValue({ data: [{ user_id: ACCOUNT, company_name: 'Acme Studio' }], error: null });
});

afterAll(() => {
  env.STRIPE_SECRET_KEY = savedKey;
});

describe('auth', () => {
  it('401 without a session, before any read', async () => {
    mockGetUser.mockResolvedValue(null);
    const res = await call();
    expect(res.status).toBe(401);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(mockDeps.readBillingRows).not.toHaveBeenCalled();
  });

  it('403 for a signed-in non-admin, before any read', async () => {
    mockGetUser.mockResolvedValue(CUSTOMER);
    mockIsAdmin.mockResolvedValue(false);
    const res = await call();
    expect(res.status).toBe(403);
    expect(mockDeps.readBillingRows).not.toHaveBeenCalled();
  });
});

describe('input', () => {
  beforeEach(asAdmin);

  it.each(['?status=bogus', '?status=active&extra=1', '?other=1'])('400 for %s, before any read', async (query) => {
    const res = await call(query);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(mockDeps.readBillingRows).not.toHaveBeenCalled();
  });

  it('400 for a repeated key', async () => {
    const res = await call('?status=active&status=failed');
    expect(res.status).toBe(400);
    expect(mockDeps.readBillingRows).not.toHaveBeenCalled();
  });
});

describe('the current Stripe mode (PF-15, AC-P8a.5)', () => {
  beforeEach(asAdmin);

  it('a test key reads the test-mode rows only', async () => {
    const res = await call();
    expect(res.status).toBe(200);
    expect(mockDeps.readBillingRows).toHaveBeenCalledWith(false);
    expect(((await res.json()).data as SubscriptionsPayload).mode).toBe('test');
  });

  it('a live key reads the live-mode rows only', async () => {
    env.STRIPE_SECRET_KEY = 'sk_live_only_value';
    mockDeps.readBillingRows.mockResolvedValue({ data: [billing({ livemode: true })], error: null });
    const res = await call();
    expect(mockDeps.readBillingRows).toHaveBeenCalledWith(true);
    const data = (await res.json()).data as SubscriptionsPayload;
    expect(data.mode).toBe('live');
    expect(data.rows).toHaveLength(1);
  });

  it.each([undefined, 'pk_test_wrong_kind', 'garbage'])('key %p: 409, no figure, no read, and the key never echoed', async (key) => {
    env.STRIPE_SECRET_KEY = key;
    const res = await call();
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body).toEqual({ success: false, error: STRIPE_MODE_UNKNOWN, details: undefined });
    expect(mockDeps.readBillingRows).not.toHaveBeenCalled();
    if (key) expect(JSON.stringify(logged)).not.toContain(key);
  });
});

describe('200', () => {
  beforeEach(asAdmin);

  it('the list, the totals with MRR per currency, and the business name of each row shown', async () => {
    const res = await call();
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    const body = await res.json();
    expect(body.success).toBe(true);
    const data = body.data as SubscriptionsPayload;
    expect(data.rows).toHaveLength(1);
    expect(data.rows[0]).toMatchObject({ accountId: ACCOUNT, businessName: 'Acme Studio', status: 'active' });
    expect(data.totals.mrr).toEqual([
      {
        currency: 'USD',
        totalHundredths: Math.round(planMonthlyPriceUsd(config, TIER) * 100),
        cancellingHundredths: 0,
        pastDueHundredths: 0,
        subscriptions: 1,
        overflow: false,
      },
    ]);
    expect(mockFindNames).toHaveBeenCalledWith([ACCOUNT]);
  });

  it('the status filter narrows the rows only', async () => {
    const res = await call('?status=failed');
    const data = (await res.json()).data as SubscriptionsPayload;
    expect(data.status).toBe('failed');
    expect(data.rows).toEqual([]);
    expect(data.totals.accounts).toBe(1);
    expect(mockFindNames).not.toHaveBeenCalled();
  });

  it('a failed name read leaves names empty and keeps the figures', async () => {
    mockFindNames.mockResolvedValue({ data: null, error: new Error('names down') });
    const res = await call();
    expect(res.status).toBe(200);
    const data = (await res.json()).data as SubscriptionsPayload;
    expect(data.rows[0].businessName).toBeNull();
    expect(data.totals.mrr).toHaveLength(1);
  });

  it('logs counts only, never a business name or an account id', async () => {
    await call();
    const text = JSON.stringify(logged);
    expect(text).not.toContain('Acme Studio');
    expect(text).not.toContain(ACCOUNT);
  });

  it('the payload carries no Stripe id (P8A-R3)', async () => {
    const text = JSON.stringify((await (await call()).json()).data);
    expect(text).not.toMatch(/\b(cus|sub|in|cs|pi)_[A-Za-z0-9]/);
  });
});

describe('500', () => {
  beforeEach(asAdmin);

  it.each(['readBillingRows', 'readPlanRows'] as const)('a failed %s is 500, never a partial list', async (read) => {
    mockDeps[read].mockResolvedValue({ data: null, error: new Error('db down') });
    const res = await call();
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.details).toBeUndefined();
    expect(JSON.stringify(body)).not.toContain('db down');
  });

  it('an unexpected throw is the standard 500, details only in development', async () => {
    mockDeps.readConfig.mockImplementation(() => {
      throw new Error('config exploded');
    });
    const res = await call();
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ success: false, error: 'Internal server error' });
  });
});

describe('source', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'route.ts'), 'utf8');

  it('requireAdmin is the first statement of the handler', () => {
    const body = source.slice(source.indexOf('export async function GET'));
    const firstStatement = body.slice(body.indexOf('{') + 1).trim().split('\n')[0];
    expect(firstStatement).toMatch(/^const gate = await requireAdmin\(/);
  });

  it('makes no Stripe call and writes nothing', () => {
    expect(source).not.toMatch(/stripeClient|new Stripe|from 'stripe'/);
    expect(source).not.toMatch(/\.(insert|update|upsert|delete|rpc)\s*\(/);
  });

  it('names no repository of the plan or billing tables (it goes through the wiring)', () => {
    // Built from parts: the RC-15 and billing caller-list guards match these
    // names as text, so writing them whole here would list this test as a caller.
    const names = ['AccountPlan', 'BillingAccount', 'BillingAdminRead'].map((part) => `BusinessOs${part}Repository`);
    for (const name of names) expect(source).not.toContain(name);
  });
});
