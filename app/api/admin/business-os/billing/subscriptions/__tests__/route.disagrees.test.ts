/**
 * GET /api/admin/business-os/billing/subscriptions: the `disagrees` filter value
 * (plan payments P-8b.3a, AM-2; SA P3-SA-2 item 5). The admin gate is real,
 * the wiring and the name read are mocked, and the builder is REAL.
 */

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

const mockDeps = { readBillingRows: jest.fn(), readPlanRows: jest.fn(), readConfig: jest.fn() };
jest.mock('@/lib/admin/billing/subscriptionsDeps', () => ({ subscriptionsDeps: () => mockDeps }));

const mockFindNames = jest.fn();
jest.mock('@/lib/repositories/BusinessProfileRepository', () => ({
  businessProfileRepository: { findAdminIdentitiesByUserIds: (...a: unknown[]) => mockFindNames(...a) },
}));

import { GET } from '../route';
import { getEntitlementConfig } from '@/lib/business-os/entitlements/source';
import type { SubscriptionsPayload } from '@/lib/admin/billing/subscriptionsTypes';
import type { AdminBillingRow } from '@/lib/repositories/BusinessOsBillingAdminReadRepository';
import type { SubscriptionsInput } from '@/lib/admin/billing/subscriptionsView';

// The plan-row type through the builder's own input, so this test names no plan repository (RC-15).
type BusinessOsAccountPlan = SubscriptionsInput['planRows'][number];

const config = getEntitlementConfig();
const TIER = config.tierOrder[0];
const ADMIN = { id: '11111111-1111-4111-8111-11111111111a', email: 'ops@example.com' };
const AGREES = 'abcdef99-9999-4999-8999-999999999991';
const DIFFERS = 'abcdef99-9999-4999-8999-999999999992';
const END = '2099-11-01T00:00:00.000Z';
const env = process.env as Record<string, string | undefined>;
const savedKey = env.STRIPE_SECRET_KEY;

const call = (query = '') => GET(new NextRequest(`http://localhost/api/admin/business-os/billing/subscriptions${query}`));

function billing(n: number, userId: string): AdminBillingRow {
  return {
    id: `00000000-0000-4000-8000-00000000000${n}`,
    user_id: userId,
    livemode: false,
    subscription_status: 'active',
    bought_tier: TIER,
    current_period_end: END,
    cancel_at_period_end: false,
    pending_tier: null,
    last_paid_at: '2026-10-01T00:00:00.000Z',
    last_payment_failed_at: null,
    failed_attempts: 0,
    founder_discount_applied_at: null,
    ended_at: null,
  };
}

function plan(userId: string, tierExpiresAt: string): BusinessOsAccountPlan {
  return {
    user_id: userId,
    tier: TIER,
    plan_version: 1,
    tier_expires_at: tierExpiresAt,
    cohort: null,
    cohort_expires_at: null,
    onboarding_started_at: '2026-09-01T00:00:00.000Z',
    profile_created_at: '2026-09-01T00:00:00.000Z',
    trial_started_at: null,
    trial_ends_at: null,
    grace_ends_at: null,
    period_anchor: '2026-09-01T00:00:00.000Z',
    origin: 'admin',
    updated_by_admin_id: null,
    created_at: '2026-09-01T00:00:00.000Z',
    updated_at: '2026-09-01T00:00:00.000Z',
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  logged.length = 0;
  env.STRIPE_SECRET_KEY = 'sk_test_only_value';
  mockGetUser.mockResolvedValue(ADMIN);
  mockIsAdmin.mockResolvedValue(true);
  mockDeps.readBillingRows.mockResolvedValue({ data: [billing(1, AGREES), billing(2, DIFFERS)], error: null });
  mockDeps.readPlanRows.mockResolvedValue({ data: [plan(AGREES, END), plan(DIFFERS, '2026-10-01T00:00:00.000Z')], error: null });
  mockDeps.readConfig.mockReturnValue(config);
  mockFindNames.mockResolvedValue({ data: [], error: null });
});

afterAll(() => {
  env.STRIPE_SECRET_KEY = savedKey;
});

describe('P-8b.3a: status=disagrees', () => {
  it('is accepted, and narrows the rows to those whose stored records disagree', async () => {
    const res = await call('?status=disagrees');
    expect(res.status).toBe(200);
    const data = (await res.json()).data as SubscriptionsPayload;
    expect(data.status).toBe('disagrees');
    expect(data.rows.map((row) => row.accountId)).toEqual([DIFFERS]);
    expect(data.rows[0].disagreements).toEqual(['paid_through_differs']);
    expect(data.matching).toBe(1);
    // Totals ignore the filter.
    expect(data.totals.accounts).toBe(2);
    expect(data.totals.disagreeing).toBe(1);
  });

  it('with no filter, every row carries its own list and the count is the same', async () => {
    const data = (await (await call()).json()).data as SubscriptionsPayload;
    expect(data.totals.disagreeing).toBe(1);
    expect(Object.fromEntries(data.rows.map((row) => [row.accountId, row.disagreements]))).toEqual({
      [AGREES]: [],
      [DIFFERS]: ['paid_through_differs'],
    });
  });

  it.each(['?status=disagree', '?status=Disagrees', '?status=disagrees&extra=1'])('400 for %s, before any read', async (query) => {
    const res = await call(query);
    expect(res.status).toBe(400);
    expect(mockDeps.readBillingRows).not.toHaveBeenCalled();
  });

  it('401 without a session, before any read (the gate wins over the filter)', async () => {
    mockGetUser.mockResolvedValue(null);
    const res = await call('?status=disagrees');
    expect(res.status).toBe(401);
    expect(mockDeps.readBillingRows).not.toHaveBeenCalled();
  });

  it('the log line carries the count and the filter, never an account id', async () => {
    await call('?status=disagrees');
    const text = JSON.stringify(logged);
    expect(text).toContain('"disagreeing":1');
    expect(text).not.toContain(DIFFERS);
    expect(text).not.toContain(AGREES);
  });
});
