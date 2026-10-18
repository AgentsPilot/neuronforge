/**
 * GET /api/admin/business-os/billing/accounts/[accountId] (plan payments
 * P-8a.2; workplan §5.3; AC-AM.1, AC-F4.1, AC-SR.5).
 *
 * The admin gate is real (with `getUser` and the access service mocked); the
 * tenant check and the two reads are mocked; the builder is REAL, so the
 * payload is exactly what the route sends.
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

const mockIsTenant = jest.fn();
jest.mock('@/lib/business-os/entitlements/adminOps', () => ({
  isBusinessOsTenant: (...args: unknown[]) => mockIsTenant(...args),
}));
jest.mock('@/lib/repositories/BusinessProfileRepository', () => ({ businessProfileRepository: {} }));
jest.mock('@/lib/repositories/OnboardingConversationRepository', () => ({ onboardingConversationRepository: {} }));

const mockFindPlan = jest.fn();
jest.mock('@/lib/repositories/BusinessOsAccountPlanRepository', () => ({
  businessOsAccountPlanRepository: { findEntitlementInputs: (...a: unknown[]) => mockFindPlan(...a) },
}));

const mockFindBilling = jest.fn();
jest.mock('@/lib/repositories/BusinessOsBillingAdminReadRepository', () => ({
  businessOsBillingAdminReadRepository: { findBillingRowForAccount: (...a: unknown[]) => mockFindBilling(...a) },
}));

import { GET } from '../route';
import { getEntitlementConfig } from '@/lib/business-os/entitlements/source';
import { STRIPE_MODE_UNKNOWN } from '@/lib/admin/billing/subscriptionsTypes';
import type { BillingPanelPayload } from '@/lib/admin/billing/billingPanelTypes';

const config = getEntitlementConfig();
const TIER = config.tierOrder[0];
const ADMIN = { id: '11111111-1111-4111-8111-11111111111a', email: 'ops@example.com' };
const CUSTOMER = { id: '22222222-2222-4222-8222-22222222222b', email: 'customer@example.com' };
const ACCOUNT = 'abcdef99-9999-4999-8999-99999999999f';
const PLATFORM = '00000000-0000-0000-0000-000000000000';
const PERIOD_END = '2099-11-01T00:00:00.000Z';
const env = process.env as Record<string, string | undefined>;
const savedKey = env.STRIPE_SECRET_KEY;

const call = (accountId: string) =>
  GET(new NextRequest(`http://localhost/api/admin/business-os/billing/accounts/${accountId}`), { params: { accountId } });

const asAdmin = () => {
  mockGetUser.mockResolvedValue(ADMIN);
  mockIsAdmin.mockResolvedValue(true);
};

const billingRow = (patch: Record<string, unknown> = {}) => ({
  id: '00000000-0000-4000-8000-000000000001',
  user_id: ACCOUNT,
  livemode: false,
  subscription_status: 'active',
  bought_tier: TIER,
  current_period_end: PERIOD_END,
  cancel_at_period_end: false,
  pending_tier: null,
  last_paid_at: '2026-10-01T00:00:00.000Z',
  last_payment_failed_at: null,
  failed_attempts: 0,
  founder_discount_applied_at: null,
  ended_at: null,
  stripe_customer_id: 'cus_RouteTest1',
  ...patch,
});

const planRow = {
  user_id: ACCOUNT,
  tier: TIER,
  plan_version: 1,
  tier_expires_at: PERIOD_END,
  cohort: null,
  cohort_expires_at: null,
  onboarding_started_at: null,
  profile_created_at: null,
  trial_started_at: null,
  trial_ends_at: null,
  grace_ends_at: null,
  period_anchor: '2026-10-01T00:00:00.000Z',
  origin: 'admin',
  updated_by_admin_id: null,
  created_at: '2026-10-01T00:00:00.000Z',
  updated_at: '2026-10-01T00:00:00.000Z',
};

beforeEach(() => {
  jest.clearAllMocks();
  logged.length = 0;
  env.STRIPE_SECRET_KEY = 'sk_test_only_value';
  mockIsTenant.mockResolvedValue(true);
  mockFindBilling.mockResolvedValue({ data: billingRow(), error: null });
  mockFindPlan.mockResolvedValue({
    data: { plan: planRow, overrides: [{ id: 'x', reason: 'secret admin reason' }] },
    error: null,
  });
});

afterAll(() => {
  env.STRIPE_SECRET_KEY = savedKey;
});

describe('auth', () => {
  it('401 without a session, before the tenant check', async () => {
    mockGetUser.mockResolvedValue(null);
    expect((await call(ACCOUNT)).status).toBe(401);
    expect(mockIsTenant).not.toHaveBeenCalled();
    expect(mockFindBilling).not.toHaveBeenCalled();
  });

  it('403 for a non-admin', async () => {
    mockGetUser.mockResolvedValue(CUSTOMER);
    mockIsAdmin.mockResolvedValue(false);
    expect((await call(ACCOUNT)).status).toBe(403);
    expect(mockFindBilling).not.toHaveBeenCalled();
  });
});

describe('the caller-supplied id (tenant-isolation-guard order)', () => {
  beforeEach(asAdmin);

  it.each(['not-a-uuid', "x' or 1=1", '%20'])('400 invalid_account_id for %p, before any read', async (id) => {
    const res = await call(id);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('invalid_account_id');
    expect(mockIsTenant).not.toHaveBeenCalled();
  });

  it('409 platform_account, before the tenant check', async () => {
    const res = await call(PLATFORM);
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe('platform_account');
    expect(mockIsTenant).not.toHaveBeenCalled();
  });

  it('404 not_a_business_os_account, no billing read', async () => {
    mockIsTenant.mockResolvedValue(false);
    const res = await call(ACCOUNT);
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe('not_a_business_os_account');
    expect(mockFindBilling).not.toHaveBeenCalled();
  });

  it('500 tenant_check_failed, no billing read', async () => {
    mockIsTenant.mockResolvedValue(null);
    const res = await call(ACCOUNT);
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe('tenant_check_failed');
    expect(mockFindBilling).not.toHaveBeenCalled();
  });

  it('every read receives exactly the checked id', async () => {
    await call(ACCOUNT.toUpperCase());
    expect(mockIsTenant.mock.calls[0][0].accountId).toBe(ACCOUNT);
    expect(mockFindBilling).toHaveBeenCalledWith(ACCOUNT, false);
    expect(mockFindPlan).toHaveBeenCalledWith(ACCOUNT);
  });
});

describe('the current Stripe mode (PF-15)', () => {
  beforeEach(asAdmin);

  it('a live key reads the live billing row', async () => {
    env.STRIPE_SECRET_KEY = 'sk_live_only_value';
    mockFindBilling.mockResolvedValue({ data: billingRow({ livemode: true }), error: null });
    const data = (await (await call(ACCOUNT)).json()).data as BillingPanelPayload;
    expect(mockFindBilling).toHaveBeenCalledWith(ACCOUNT, true);
    expect(data.mode).toBe('live');
    expect(data.customerDashboardUrl).toBe('https://dashboard.stripe.com/customers/cus_RouteTest1');
  });

  it.each([undefined, 'garbage'])('key %p: 409, no read, the key never echoed', async (key) => {
    env.STRIPE_SECRET_KEY = key;
    const res = await call(ACCOUNT);
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ success: false, error: STRIPE_MODE_UNKNOWN, details: undefined });
    expect(mockFindBilling).not.toHaveBeenCalled();
    if (key) expect(JSON.stringify(logged)).not.toContain(key);
  });
});

describe('200', () => {
  beforeEach(asAdmin);

  it('both sides, side by side, with the test dashboard link, no-store', async () => {
    const res = await call(ACCOUNT);
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    const data = (await res.json()).data as BillingPanelPayload;
    expect(data.stripe).toMatchObject({ stripeStatus: 'active', status: 'active', mrrKind: 'counted' });
    expect(data.plan).toMatchObject({ tier: { id: TIER }, paidThrough: PERIOD_END, origin: 'admin' });
    expect(data.disagreements).toEqual([]);
    expect(data.customerDashboardUrl).toBe('https://dashboard.stripe.com/test/customers/cus_RouteTest1');
  });

  it('no billing row: "No Stripe subscription" (AC-F4.1)', async () => {
    mockFindBilling.mockResolvedValue({ data: null, error: null });
    const data = (await (await call(ACCOUNT)).json()).data as BillingPanelPayload;
    expect(data.stripe).toBeNull();
    expect(data.customerDashboardUrl).toBeNull();
  });

  it('never sends an override reason, and logs no Stripe id', async () => {
    const text = JSON.stringify((await (await call(ACCOUNT)).json()).data);
    expect(text).not.toContain('secret admin reason');
    expect(JSON.stringify(logged)).not.toContain('cus_RouteTest1');
  });
});

describe('500', () => {
  beforeEach(asAdmin);

  it('a failed billing read', async () => {
    mockFindBilling.mockResolvedValue({ data: null, error: new Error('db down') });
    const res = await call(ACCOUNT);
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.details).toBeUndefined();
    expect(JSON.stringify(body)).not.toContain('db down');
  });

  it('a failed plan read', async () => {
    mockFindPlan.mockResolvedValue({ data: null, error: new Error('db down') });
    expect((await call(ACCOUNT)).status).toBe(500);
  });

  it('an unexpected throw is the standard 500', async () => {
    mockFindPlan.mockRejectedValue(new Error('exploded'));
    const res = await call(ACCOUNT);
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ success: false, error: 'Internal server error' });
  });
});

describe('source', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'route.ts'), 'utf8');

  it('requireAdmin is the first statement of the handler', () => {
    const body = source.slice(source.indexOf('export async function GET'));
    const firstStatement = body.slice(body.indexOf('{', body.indexOf(')')) + 1).trim().split('\n')[0];
    expect(firstStatement).toMatch(/^const gate = await requireAdmin\(/);
  });

  it('makes no Stripe call and writes nothing', () => {
    expect(source).not.toMatch(/stripeClient|new Stripe|from 'stripe'/);
    expect(source).not.toMatch(/\.(insert|update|upsert|delete|rpc)\s*\(/);
  });
});
