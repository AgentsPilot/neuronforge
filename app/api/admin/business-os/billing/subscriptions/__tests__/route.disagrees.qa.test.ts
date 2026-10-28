/**
 * QA P-8b.3a: GET /api/admin/business-os/billing/subscriptions with the
 * `disagrees` value at the gate (401 / 403 win over a 400), and no PII added
 * to the response by the new fields. The admin gate is real, the wiring and
 * the name read are mocked, and the builder is REAL.
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

const EMAIL = 'owner-secret@example.com';

describe('QA P-8b.3a: the gate comes before the filter', () => {
  it.each(['?status=disagrees', '?status=disagree', '?status=disagrees&status=active'])('403 for a signed-in non-admin with %s, before any read', async (query) => {
    mockIsAdmin.mockResolvedValue(false);
    const res = await call(query);
    expect(res.status).toBe(403);
    expect(mockDeps.readBillingRows).not.toHaveBeenCalled();
  });

  it.each(['?status=disagree', '?status='])('401 (not 400) without a session for the invalid %s', async (query) => {
    mockGetUser.mockResolvedValue(null);
    const res = await call(query);
    expect(res.status).toBe(401);
    expect(mockDeps.readBillingRows).not.toHaveBeenCalled();
  });

  it.each(['?status=', '?status=disagrees&status=disagrees', '?status=DISAGREES'])('an admin gets 400 for %s, before any read', async (query) => {
    const res = await call(query);
    expect(res.status).toBe(400);
    expect(mockDeps.readBillingRows).not.toHaveBeenCalled();
  });
});

describe('QA P-8b.3a: no PII added by the new fields', () => {
  it('the response carries kinds and a count only: no email, no admin id, no customer id', async () => {
    mockFindNames.mockResolvedValue({ data: [{ user_id: DIFFERS, company_name: 'Differs Co', email: EMAIL }], error: null });
    const res = await call('?status=disagrees');
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).not.toContain(EMAIL);
    expect(text).not.toContain(ADMIN.email);
    expect(text).not.toContain(ADMIN.id);
    expect(text).not.toContain('cus_');
    const data = (JSON.parse(text) as { data: SubscriptionsPayload }).data;
    expect(Object.keys(data.totals)).toContain('disagreeing');
    for (const row of data.rows) {
      for (const kind of row.disagreements) expect(['tier_differs', 'paid_through_differs', 'no_tier_on_plan']).toContain(kind);
    }
  });

  it('no log line carries the email or a business name', async () => {
    mockFindNames.mockResolvedValue({ data: [{ user_id: DIFFERS, company_name: 'Differs Co', email: EMAIL }], error: null });
    await call('?status=disagrees');
    const text = JSON.stringify(logged);
    expect(text).not.toContain(EMAIL);
    expect(text).not.toContain('Differs Co');
  });
});
