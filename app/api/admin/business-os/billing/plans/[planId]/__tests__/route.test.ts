/**
 * GET /api/admin/business-os/billing/plans/[planId] (Money MK-8, the Finance
 * plan drawer). The admin gate is real (with `getUser` and the access service
 * mocked); the wiring and the name read are mocked; the builder and the MRR
 * rule are REAL, so the payload is exactly what the route sends.
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

import { GET, PLAN_NOT_FOUND } from '../route';
import { getEntitlementConfig } from '@/lib/business-os/entitlements/source';
import { STRIPE_MODE_UNKNOWN, type SubscriptionsPayload } from '@/lib/admin/billing/subscriptionsTypes';
import { subscriptionsMrr } from '@/lib/admin/billing/subscriptionsView';
import type { AdminBillingRow } from '@/lib/repositories/BusinessOsBillingAdminReadRepository';

const config = getEntitlementConfig();
const TIER = config.tierOrder[0];
const OTHER = config.tierOrder.find((tier) => tier !== TIER) ?? null;
const ADMIN = { id: '11111111-1111-4111-8111-11111111111a', email: 'ops@example.com' };
const CUSTOMER = { id: '22222222-2222-4222-8222-22222222222b', email: 'customer@example.com' };
const ACCOUNT = 'abcdef99-9999-4999-8999-99999999999f';
const OTHER_ACCOUNT = 'abcdef99-9999-4999-8999-999999999990';
const env = process.env as Record<string, string | undefined>;
const savedKey = env.STRIPE_SECRET_KEY;

const call = (planId: string, query = '') =>
  GET(new NextRequest(`http://localhost/api/admin/business-os/billing/plans/${encodeURIComponent(planId)}${query}`), { params: { planId } });

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

const ROWS = (): AdminBillingRow[] =>
  OTHER === null
    ? [billing()]
    : [billing(), billing({ id: '00000000-0000-4000-8000-000000000002', user_id: OTHER_ACCOUNT, bought_tier: OTHER })];

beforeEach(() => {
  jest.clearAllMocks();
  logged.length = 0;
  env.STRIPE_SECRET_KEY = 'sk_test_only_value';
  mockDeps.readBillingRows.mockResolvedValue({ data: ROWS(), error: null });
  mockDeps.readPlanRows.mockResolvedValue({ data: [], error: null });
  mockDeps.readConfig.mockReturnValue(config);
  mockFindNames.mockResolvedValue({ data: [{ user_id: ACCOUNT, company_name: 'Acme Studio' }], error: null });
});

afterAll(() => {
  env.STRIPE_SECRET_KEY = savedKey;
});

const noRead = () => {
  expect(mockDeps.readBillingRows).not.toHaveBeenCalled();
  expect(mockDeps.readPlanRows).not.toHaveBeenCalled();
  expect(mockFindNames).not.toHaveBeenCalled();
};

describe('auth', () => {
  it('401 without a session, before any read', async () => {
    mockGetUser.mockResolvedValue(null);
    const res = await call(TIER);
    expect(res.status).toBe(401);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    noRead();
  });

  it('403 for a signed-in non-admin, before any read', async () => {
    mockGetUser.mockResolvedValue(CUSTOMER);
    mockIsAdmin.mockResolvedValue(false);
    const res = await call(TIER);
    expect(res.status).toBe(403);
    noRead();
  });
});

describe('input', () => {
  beforeEach(asAdmin);

  it.each(['Not A Plan', 'x'.repeat(65), "a' or 1=1", '../etc'])('400 for the plan id %p, before any read', async (planId) => {
    const res = await call(planId);
    expect(res.status).toBe(400);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    noRead();
  });

  it('400 for any query key (nothing else selects rows)', async () => {
    const res = await call(TIER, `?accountId=${ACCOUNT}`);
    expect(res.status).toBe(400);
    noRead();
  });

  it('404 for a well-formed id that is not a configured plan, before any read', async () => {
    const res = await call('no-such-plan');
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe(PLAN_NOT_FOUND);
    noRead();
  });
});

describe('mode and reads', () => {
  beforeEach(asAdmin);

  it('409 when the Stripe key mode cannot be read; no read', async () => {
    env.STRIPE_SECRET_KEY = '';
    const res = await call(TIER);
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe(STRIPE_MODE_UNKNOWN);
    noRead();
  });

  it('500 when a read fails, never a partial plan', async () => {
    mockDeps.readBillingRows.mockResolvedValue({ data: null, error: new Error('boom') });
    expect((await call(TIER)).status).toBe(500);
    mockDeps.readBillingRows.mockResolvedValue({ data: ROWS(), error: null });
    mockDeps.readPlanRows.mockResolvedValue({ data: null, error: new Error('boom') });
    expect((await call(TIER)).status).toBe(500);
  });

  it('reads the current mode only (test key → livemode false)', async () => {
    await call(TIER);
    expect(mockDeps.readBillingRows).toHaveBeenCalledWith(false);
  });
});

describe('200', () => {
  beforeEach(asAdmin);

  it('one plan’s accounts and MRR only, names for the rows shown, no-store', async () => {
    const res = await call(TIER);
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    const data = (await res.json()).data as SubscriptionsPayload;
    expect(data.rows.map((r) => r.accountId)).toEqual([ACCOUNT]);
    expect(data.rows[0].businessName).toBe('Acme Studio');
    expect(data.totals.mrr).toEqual(subscriptionsMrr([billing()], config, 'test').lines);
    expect(data.totals.paidByPlan.map((p) => p.id)).toEqual([TIER]);
    expect(mockFindNames).toHaveBeenCalledWith([ACCOUNT]);
  });

  it('the log line has counts and the plan id only: never an account id or a business name', async () => {
    await call(TIER);
    const text = JSON.stringify(logged);
    expect(text).not.toContain(ACCOUNT);
    expect(text).not.toContain('Acme Studio');
    expect(logged.find((entry) => entry[1] === 'Plan drawer read')?.[0]).toEqual(
      expect.objectContaining({ planId: TIER, accounts: 1, shown: 1 })
    );
  });

  it('no secret field travels: no Stripe id, checkout lock or invoice link in the body', async () => {
    const res = await call(TIER);
    expect(await res.text()).not.toMatch(/stripe_customer_id|stripe_subscription_id|open_checkout|action_required_invoice_url|cus_|sub_/);
  });
});

describe('source', () => {
  const code = fs.readFileSync(path.join(__dirname, '..', 'route.ts'), 'utf8');

  it('requireAdmin is the first statement of the handler; no write verb, no audit, no Stripe call', () => {
    const handler = code.slice(code.search(/export async function GET\(/));
    // The body starts after the signature's closing ') {' (the context type has its own braces).
    const body = handler.slice(handler.indexOf(') {') + 3).trimStart();
    expect(body.startsWith('const gate = await requireAdmin(')).toBe(true);
    expect(code).not.toMatch(/\.(insert|update|upsert|delete|rpc)\s*\(/);
    expect(code).not.toMatch(/AuditTrailService|getStripe|stripe\.(customers|subscriptions)/);
  });

  it('names no tier literal: the plan id is compared with config.tierOrder', () => {
    expect(code).toMatch(/config\.tierOrder\.includes\(planId\)/);
    for (const tier of config.tierOrder) expect(code).not.toContain(`'${tier}'`);
  });
});
