/**
 * GET /api/admin/business-os/credits/accounts/[accountId]
 * (credit deduction slice 11c, workplan §11c.6.2; SA W11c-5, W11c-11, W11c-16).
 *
 * Every repository, the entitlement service and the admin gate are mocked; the
 * builder (`readCreditPosition`), `creditAllowanceDecision`, `extraCreditsAt`
 * and the resolver are REAL, so the figures here are the ones the route would
 * really compute.
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

const mockLog = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
jest.mock('@/lib/logger', () => {
  const make = (): Record<string, unknown> => {
    const logger: Record<string, unknown> = {
      info: (...a: unknown[]) => mockLog.info(...a),
      warn: (...a: unknown[]) => mockLog.warn(...a),
      error: (...a: unknown[]) => mockLog.error(...a),
      debug: (...a: unknown[]) => mockLog.debug(...a),
    };
    logger.child = () => logger;
    return logger;
  };
  return { createLogger: () => make() };
});

const mockIsTenant = jest.fn();
jest.mock('@/lib/business-os/entitlements/adminOps', () => ({
  isBusinessOsTenant: (...args: unknown[]) => mockIsTenant(...args),
}));

const mockGetSnapshot = jest.fn();
jest.mock('@/lib/business-os/entitlements/EntitlementService', () => ({
  getEntitlementService: () => ({ getSnapshot: (...a: unknown[]) => mockGetSnapshot(...a) }),
}));

jest.mock('@/lib/repositories/BusinessProfileRepository', () => ({ businessProfileRepository: {} }));
jest.mock('@/lib/repositories/OnboardingConversationRepository', () => ({ onboardingConversationRepository: {} }));

const mockPlan = { findPeriodAnchor: jest.fn(), updatePlan: jest.fn(), ensurePlanRow: jest.fn() };
jest.mock('@/lib/repositories/BusinessOsAccountPlanRepository', () => ({ businessOsAccountPlanRepository: mockPlan }));

const mockPeriod = { periodStartFor: jest.fn() };
jest.mock('@/lib/repositories/BusinessOsCreditPeriodRepository', () => ({ businessOsCreditPeriodRepository: mockPeriod }));

const mockServiceClient = { service: 'role' };
jest.mock('@/lib/supabaseServer', () => ({ supabaseServer: mockServiceClient }));

const mockOwner = {
  findTotalsForPeriod: jest.fn(),
  listTotalsFrom: jest.fn(),
  listAdjustmentsForPeriods: jest.fn(),
  findChargesByActionIds: jest.fn(),
};
const mockOwnerConstructed: unknown[] = [];
jest.mock('@/lib/repositories/BusinessOsCreditOwnerReadRepository', () => ({
  BusinessOsCreditOwnerReadRepository: jest.fn().mockImplementation((client: unknown) => {
    mockOwnerConstructed.push(client);
    return mockOwner;
  }),
}));

const mockLots = { listLotsWithDraws: jest.fn(), recordLot: jest.fn(), reverseLot: jest.fn(), findLotForAccount: jest.fn() };
jest.mock('@/lib/repositories/BusinessOsCreditLotRepository', () => ({ businessOsCreditLotRepository: mockLots }));

import { GET } from '../route';
import { ADMIN_CREDIT_GRANT_CEILING } from '@/lib/business-os/credits/creditAdminOps';
import { extraCreditsAt } from '@/lib/business-os/credits/creditLots';
import { creditAllowanceForDisplay } from '@/lib/business-os/entitlements/creditAllowanceView';
import { previewAccountFor } from '@/lib/business-os/entitlements/planPresentation';
import { resolveEntitlements } from '@/lib/business-os/entitlements/resolver';
import { readCodeConfig } from '@/lib/business-os/entitlements/source';
import type { SnapshotResult } from '@/lib/business-os/entitlements/EntitlementService';
import type { BusinessOsCreditLotRow } from '@/lib/repositories/BusinessOsCreditLotRepository';

const ADMIN = { id: '11111111-1111-4111-8111-11111111111a', email: 'ops@example.com' };
const OWNER = { id: '2f734ed5-3681-4049-880d-3de7b096bea3', email: 'owner@example.com' };
// Hex letters on purpose, so an upper-cased path really differs (W11b-1 precedent).
const ACCOUNT = 'abcdef99-9999-4999-8999-99999999999f';
const OTHER = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const PLATFORM = '00000000-0000-0000-0000-000000000000';
const ANCHOR = '2026-08-14T09:31:07.123456+00:00';
const PERIOD = '2026-09-14T09:31:07.123456+00:00';
const NOW = new Date('2026-10-03T12:00:00.000Z');
const LOT_A = 'aaaaaaaa-1111-4111-8111-11111111111a';
const LOT_B = 'bbbbbbbb-2222-4222-8222-22222222222b';
const LOT_C = 'cccccccc-3333-4333-8333-33333333333c';
const DRAW = 'dddddddd-4444-4444-8444-44444444444d';

const config = readCodeConfig();
const snapshotFor = (planId: string): SnapshotResult => ({
  resolution: resolveEntitlements({ config, account: previewAccountFor(config, planId, NOW), overrides: [], addons: [], now: NOW }),
  unavailable: false,
  stale: false,
});

const call = (accountId: string, query = '') =>
  GET(new NextRequest(`http://localhost/api/admin/business-os/credits/accounts/${accountId}${query}`), {
    params: { accountId },
  });

const asAdmin = (user = ADMIN) => {
  mockGetUser.mockResolvedValue(user);
  mockIsAdmin.mockResolvedValue(true);
};

function lot(overrides: Partial<BusinessOsCreditLotRow> = {}): BusinessOsCreditLotRow {
  return {
    id: LOT_A,
    accountId: ACCOUNT,
    source: 'admin_grant',
    creditsGranted: 100,
    creditsBase: 100,
    creditsBonus: 0,
    creditValueVersion: 3,
    expiresAt: null,
    idempotencyKey: 'admin_grant:00000000-0000-4000-8000-000000000001',
    sourceRef: null,
    actorKind: 'admin',
    actorAdminId: ADMIN.id,
    reason: 'goodwill after the outage',
    createdAt: '2026-09-01T00:00:00.000Z',
    draws: [],
    ...overrides,
  };
}

const LOTS: BusinessOsCreditLotRow[] = [
  lot({
    id: LOT_A,
    creditsGranted: 100,
    draws: [
      {
        id: DRAW,
        lotId: LOT_A,
        accountId: ACCOUNT,
        kind: 'reversal',
        credits: 40,
        reason: 'mistaken amount',
        actorAdminId: ADMIN.id,
        idempotencyKey: 'admin_reversal:00000000-0000-4000-8000-000000000002',
        createdAt: '2026-09-02T00:00:00.000Z',
      },
    ],
  }),
  lot({ id: LOT_B, creditsGranted: 25.5, expiresAt: '2026-09-30T00:00:00.000Z', createdAt: '2026-09-10T00:00:00.000Z' }),
  lot({
    id: LOT_C,
    source: 'boost_purchase',
    actorKind: 'stripe_webhook',
    actorAdminId: null,
    reason: null,
    sourceRef: 'cs_test_secret',
    creditsGranted: 13.75,
    creditsBase: 12.5,
    creditsBonus: 1.25,
    createdAt: '2026-09-20T00:00:00.000Z',
  }),
];

function totals(used: number) {
  return {
    period_start: PERIOD,
    credits_total: used.toFixed(6),
    credits_owner: (used * 0.75).toFixed(6),
    credits_scheduled: (used * 0.25).toFixed(6),
    credits_external: '0.000000',
    credits_adjustment: '0.000000',
  };
}

function allReadsOk(options: { used?: number; snapshot?: SnapshotResult | 'throws'; anchor?: string | null; lots?: BusinessOsCreditLotRow[] } = {}) {
  mockIsTenant.mockResolvedValue(true);
  const snapshot = options.snapshot ?? snapshotFor('champion');
  if (snapshot === 'throws') mockGetSnapshot.mockRejectedValue(new Error('snapshot exploded'));
  else mockGetSnapshot.mockResolvedValue(snapshot);
  mockPlan.findPeriodAnchor.mockResolvedValue({ data: options.anchor === undefined ? ANCHOR : options.anchor, error: null });
  mockPeriod.periodStartFor.mockResolvedValue({ data: PERIOD, error: null });
  mockOwner.findTotalsForPeriod.mockResolvedValue({ data: totals(options.used ?? 1000.25), error: null });
  mockOwner.listTotalsFrom.mockResolvedValue({ data: { rows: [totals(options.used ?? 1000.25)], reachedCeiling: false }, error: null });
  mockOwner.listAdjustmentsForPeriods.mockResolvedValue({ data: { rows: [], reachedCeiling: false }, error: null });
  mockOwner.findChargesByActionIds.mockResolvedValue({ data: [], error: null });
  mockLots.listLotsWithDraws.mockResolvedValue({ data: options.lots ?? LOTS, error: null });
}

const ownerReadCalls = () => [
  ...mockOwner.findTotalsForPeriod.mock.calls,
  ...mockOwner.listTotalsFrom.mock.calls,
  ...mockOwner.listAdjustmentsForPeriods.mock.calls,
  ...mockOwner.findChargesByActionIds.mock.calls,
];

const noReadAfterTenant = () => {
  expect(mockGetSnapshot).not.toHaveBeenCalled();
  expect(mockPlan.findPeriodAnchor).not.toHaveBeenCalled();
  expect(mockPeriod.periodStartFor).not.toHaveBeenCalled();
  expect(ownerReadCalls()).toEqual([]);
  expect(mockLots.listLotsWithDraws).not.toHaveBeenCalled();
};

const noWrite = () => {
  expect(mockLots.recordLot).not.toHaveBeenCalled();
  expect(mockLots.reverseLot).not.toHaveBeenCalled();
  expect(mockPlan.updatePlan).not.toHaveBeenCalled();
  expect(mockPlan.ensurePlanRow).not.toHaveBeenCalled();
};

const ORIGINAL_SYSTEM_ADMIN = process.env.SYSTEM_ADMIN_USER_ID;

beforeEach(() => {
  jest.clearAllMocks();
  mockGetUser.mockReset();
  mockIsAdmin.mockReset();
  mockGetSnapshot.mockReset();
  // Only the clock is faked: the promises and the gate's timers stay real.
  jest.useFakeTimers({
    now: NOW,
    doNotFake: ['nextTick', 'setImmediate', 'clearImmediate', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'queueMicrotask'],
  });
});

afterEach(() => {
  jest.useRealTimers();
  noWrite();
  if (ORIGINAL_SYSTEM_ADMIN === undefined) delete process.env.SYSTEM_ADMIN_USER_ID;
  else process.env.SYSTEM_ADMIN_USER_ID = ORIGINAL_SYSTEM_ADMIN;
});

describe('the gate runs first (G11c-3)', () => {
  it('401 signed out: no tenant, repository, snapshot or builder call', async () => {
    mockGetUser.mockResolvedValue(null);
    const res = await call(ACCOUNT);
    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe('Unauthorized');
    expect(mockIsTenant).not.toHaveBeenCalled();
    noReadAfterTenant();
  });

  it('403 for a non-admin: nothing read', async () => {
    mockGetUser.mockResolvedValue(OWNER);
    mockIsAdmin.mockResolvedValue(false);
    const res = await call(ACCOUNT);
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe('Forbidden');
    expect(mockIsTenant).not.toHaveBeenCalled();
    noReadAfterTenant();
  });

  it('requireAdmin is the first statement of GET', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'route.ts'), 'utf8');
    const signature = /export async function GET\([^)]*\{[^)]*\}[^)]*\)\s*\{/.exec(source);
    expect(signature).not.toBeNull();
    const body = source.slice(signature!.index + signature![0].length);
    const first = body.split('\n').map((line) => line.trim()).find((line) => line && !line.startsWith('//'));
    expect(first).toMatch(/^const gate = await requireAdmin\(/);
  });

  it('is force-dynamic on Node, and names no service-role client (that lives in the wiring)', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'route.ts'), 'utf8');
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
    expect(code).toContain("export const dynamic = 'force-dynamic';");
    expect(code).toContain("export const runtime = 'nodejs';");
    expect(code).not.toMatch(/supabaseServer/);
    expect(code).not.toMatch(/\.rpc\s*\(|\.recordLot\s*\(|\.reverseLot\s*\(|\.check\s*\(|(?<![A-Za-z0-9_$])decide\s*\(/);
  });
});

describe('400 / 409 / tenant', () => {
  beforeEach(() => asAdmin());

  it('400 invalid_account_id for a malformed id, nothing read', async () => {
    const res = await call('not-a-uuid');
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('invalid_account_id');
    expect(mockIsTenant).not.toHaveBeenCalled();
    noReadAfterTenant();
  });

  it('409 platform_account for the all-zero id, before the tenant read', async () => {
    const res = await call(PLATFORM);
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe('platform_account');
    expect(mockIsTenant).not.toHaveBeenCalled();
    noReadAfterTenant();
  });

  it('409 platform_account for the configured system account, also upper-cased', async () => {
    process.env.SYSTEM_ADMIN_USER_ID = OTHER;
    const res = await call(OTHER.toUpperCase());
    expect(res.status).toBe(409);
    expect(mockIsTenant).not.toHaveBeenCalled();
  });

  it('500 tenant_check_failed: no ledger, lot or snapshot read', async () => {
    mockIsTenant.mockResolvedValue(null);
    const res = await call(ACCOUNT);
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe('tenant_check_failed');
    noReadAfterTenant();
  });

  it('404 not_a_business_os_account: no ledger, lot or snapshot read', async () => {
    mockIsTenant.mockResolvedValue(false);
    const res = await call(ACCOUNT);
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe('not_a_business_os_account');
    noReadAfterTenant();
  });

  it('500 Internal server error on an unexpected throw', async () => {
    mockIsTenant.mockRejectedValue(new Error('kaboom'));
    const res = await call(ACCOUNT);
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe('Internal server error');
  });
});

describe('200: the payload', () => {
  beforeEach(() => asAdmin());

  it('has exactly these keys at every level (no combined figure, no secrets: G11c-1, G11c-4)', async () => {
    allReadsOk();
    const body = await (await call(ACCOUNT)).json();
    expect(body.success).toBe(true);
    const data = body.data;
    expect(Object.keys(data).sort()).toEqual(['accountId', 'extra', 'isOwnAccount', 'limits', 'usage']);
    expect(Object.keys(data.limits).sort()).toEqual(['grantCeiling', 'reasonMax', 'reasonMin']);
    expect(Object.keys(data.usage).sort()).toEqual(
      ['allowance', 'allowanceLayer', 'allowanceStatus', 'overPlan', 'period', 'planLeft', 'status', 'used', 'usedAutomatic', 'usedByOwner'].sort()
    );
    expect(Object.keys(data.usage.period).sort()).toEqual(['key', 'kind', 'resetsOn']);
    expect(Object.keys(data.extra).sort()).toEqual(['extraCredits', 'hasInconsistentLot', 'lots', 'status']);
    for (const item of data.extra.lots) {
      expect(Object.keys(item).sort()).toEqual(
        ['actorAdminId', 'actorKind', 'counted', 'createdAt', 'credits', 'expired', 'expiresAt', 'id', 'reason', 'remaining', 'source', 'takeBacks'].sort()
      );
      for (const takeBack of item.takeBacks) {
        expect(Object.keys(takeBack).sort()).toEqual(['actorAdminId', 'createdAt', 'credits', 'id', 'reason']);
      }
    }
  });

  it('no key anywhere names a money, token, model, idempotency or combined figure (forbidden-word walk)', async () => {
    allReadsOk();
    const data = (await (await call(ACCOUNT)).json()).data;
    const keys: string[] = [];
    const walk = (value: unknown) => {
      if (Array.isArray(value)) value.forEach(walk);
      else if (value && typeof value === 'object') {
        for (const [key, inner] of Object.entries(value)) {
          keys.push(key);
          walk(inner);
        }
      }
    };
    walk(data);
    expect(keys.length).toBeGreaterThan(30);
    const forbidden = /usd|cost|token|model|idempotency|fallback|remainingTotal|total|combined|balance|sourceRef|creditsBase|creditsBonus|creditValueVersion/i;
    expect(keys.filter((key) => forbidden.test(key))).toEqual([]);
    const text = JSON.stringify(data);
    expect(text).not.toContain('cs_test_secret');
    expect(text).not.toContain('admin_grant:');
    expect(text).not.toContain('admin_reversal:');
  });

  it('the figures: allowance and its layer, used and its split, plan left, over plan, extra credits', async () => {
    allReadsOk({ used: 1000.25 });
    const snapshot = snapshotFor('champion');
    const allowance = creditAllowanceForDisplay(snapshot)!;
    const data = (await (await call(ACCOUNT)).json()).data;

    expect(data.accountId).toBe(ACCOUNT);
    expect(data.isOwnAccount).toBe(false);
    expect(data.limits).toEqual({ grantCeiling: ADMIN_CREDIT_GRANT_CEILING, reasonMin: 3, reasonMax: 500 });
    expect(data.usage).toMatchObject({
      status: 'ok',
      period: { kind: 'monthly', key: PERIOD },
      allowanceStatus: 'ok',
      allowance: { amount: allowance.amount, per: 'month' },
      allowanceLayer: snapshot.resolution!.values[Object.keys(snapshot.resolution!.values).find((k) => k.endsWith('allowance') && k.startsWith('credits'))!].decidedBy,
      used: 1000.25,
      usedByOwner: 750.1875,
      usedAutomatic: 250.0625,
      planLeft: allowance.amount - 1000.25,
      overPlan: 0,
    });
    expect(typeof data.usage.period.resetsOn).toBe('string');
  });

  it('extraCredits equals extraCreditsAt on the same rows at the same now (QA11a-4, per account)', async () => {
    allReadsOk();
    const data = (await (await call(ACCOUNT)).json()).data;
    const expected = extraCreditsAt(LOTS, NOW)!;
    expect(data.extra.status).toBe('ok');
    expect(data.extra.extraCredits).toBe(expected.extraCredits);
    // 60 left on A, B expired, 13.75 on C.
    expect(data.extra.extraCredits).toBe(73.75);
    expect(data.extra.hasInconsistentLot).toBe(false);
  });

  it('lots are newest first, each with its position joined by id, reason and actor, and its take-backs', async () => {
    allReadsOk();
    const lots = (await (await call(ACCOUNT)).json()).data.extra.lots;
    expect(lots.map((l: { id: string }) => l.id)).toEqual([LOT_C, LOT_B, LOT_A]);
    const [c, b, a] = lots;
    expect(c).toMatchObject({ source: 'boost_purchase', credits: 13.75, remaining: 13.75, expired: false, counted: true, actorKind: 'stripe_webhook', actorAdminId: null, reason: null });
    expect(b).toMatchObject({ credits: 25.5, remaining: 25.5, expired: true, counted: true, expiresAt: '2026-09-30T00:00:00.000Z' });
    expect(a).toMatchObject({ credits: 100, remaining: 60, expired: false, counted: true, reason: 'goodwill after the outage', actorKind: 'admin', actorAdminId: ADMIN.id });
    expect(a.takeBacks).toEqual([{ id: DRAW, credits: 40, reason: 'mistaken amount', actorAdminId: ADMIN.id, createdAt: '2026-09-02T00:00:00.000Z' }]);
  });

  it('a lot created after now (clock skew) is listed, not counted, with its granted credits (W11c-11)', async () => {
    const future = lot({ id: 'eeeeeeee-5555-4555-8555-55555555555e', creditsGranted: 500, createdAt: '2026-10-03T12:00:05.000Z' });
    allReadsOk({ lots: [...LOTS, future] });
    const extra = (await (await call(ACCOUNT)).json()).data.extra;
    expect(extra.status).toBe('ok');
    expect(extra.extraCredits).toBe(73.75);
    expect(extra.lots[0]).toMatchObject({ id: future.id, remaining: 500, expired: false, counted: false });
    expect(extra.lots).toHaveLength(4);
  });

  it('an inconsistent lot is flagged, clamped by the one function', async () => {
    const bad = lot({
      id: LOT_A,
      creditsGranted: 10,
      draws: [{ ...LOTS[0].draws[0], credits: 15 }],
    });
    allReadsOk({ lots: [bad] });
    const extra = (await (await call(ACCOUNT)).json()).data.extra;
    expect(extra).toMatchObject({ status: 'ok', extraCredits: 0, hasInconsistentLot: true });
    expect(extra.lots[0].remaining).toBe(0);
  });

  it('an empty lot list is 0 extra credits, ok', async () => {
    allReadsOk({ lots: [] });
    const extra = (await (await call(ACCOUNT)).json()).data.extra;
    expect(extra).toEqual({ status: 'ok', extraCredits: 0, hasInconsistentLot: false, lots: [] });
  });
});

describe('allowance cases', () => {
  beforeEach(() => asAdmin());

  it('a trial: per total, the trial window from the anchor', async () => {
    allReadsOk({ snapshot: snapshotFor('trial'), used: 120 });
    const usage = (await (await call(ACCOUNT)).json()).data.usage;
    const allowance = creditAllowanceForDisplay(snapshotFor('trial'))!;
    expect(usage).toMatchObject({ allowance: { amount: allowance.amount, per: 'total' }, period: { kind: 'trial_total', key: ANCHOR, resetsOn: null } });
    expect(usage.planLeft).toBe(allowance.amount - 120);
  });

  it('no allowance (a no-basis plan): allowance, layer, planLeft and overPlan are null', async () => {
    const base = snapshotFor('champion');
    allReadsOk({ snapshot: { ...base, resolution: { ...base.resolution!, basis: { kind: 'none' } } } });
    const usage = (await (await call(ACCOUNT)).json()).data.usage;
    expect(usage).toMatchObject({ status: 'ok', allowanceStatus: 'ok', allowance: null, allowanceLayer: null, planLeft: null, overPlan: null });
  });

  it('an unavailable snapshot: allowanceStatus unavailable, usage still returned', async () => {
    allReadsOk({ snapshot: { resolution: null, unavailable: true, stale: false }, used: 12 });
    const usage = (await (await call(ACCOUNT)).json()).data.usage;
    expect(usage).toMatchObject({ status: 'ok', allowanceStatus: 'unavailable', allowance: null, allowanceLayer: null, used: 12, planLeft: null });
    // Without an allowance the builder cannot see a trial: the current period, never a trial total.
    expect(usage.period.kind).toBe('monthly');
  });

  it('a throwing snapshot: allowanceStatus unavailable, usage still returned, the error logged', async () => {
    allReadsOk({ snapshot: 'throws' });
    const usage = (await (await call(ACCOUNT)).json()).data.usage;
    expect(usage).toMatchObject({ status: 'ok', allowanceStatus: 'unavailable', allowance: null });
    expect(mockLog.error).toHaveBeenCalledWith(expect.objectContaining({ err: expect.any(Error) }), expect.any(String));
  });

  it('no plan row: allowance and layer null, even though the snapshot names one', async () => {
    allReadsOk({ anchor: null });
    const usage = (await (await call(ACCOUNT)).json()).data.usage;
    expect(usage).toMatchObject({ allowance: null, allowanceLayer: null, period: { kind: 'calendar_month' } });
  });

  it('reads the snapshot once, fresh', async () => {
    allReadsOk();
    await call(ACCOUNT);
    expect(mockGetSnapshot).toHaveBeenCalledTimes(1);
    expect(mockGetSnapshot).toHaveBeenCalledWith(ACCOUNT, { bypassCache: true });
  });
});

describe('overPlan and planLeft', () => {
  beforeEach(() => asAdmin());

  it('over the plan: the exact difference, and planLeft 0 (never negative)', async () => {
    const allowance = creditAllowanceForDisplay(snapshotFor('champion'))!;
    allReadsOk({ used: allowance.amount + 12.345678 });
    const usage = (await (await call(ACCOUNT)).json()).data.usage;
    expect(usage.overPlan).toBe(12.345678);
    expect(usage.planLeft).toBe(0);
  });

  it('exactly at the plan: both 0', async () => {
    const allowance = creditAllowanceForDisplay(snapshotFor('champion'))!;
    allReadsOk({ used: allowance.amount });
    const usage = (await (await call(ACCOUNT)).json()).data.usage;
    expect(usage.overPlan).toBe(0);
    expect(usage.planLeft).toBe(0);
  });
});

describe('partial failures (SA OP-26)', () => {
  beforeEach(() => asAdmin());

  it('a usage read error: usage { status: error }, extra still ok', async () => {
    allReadsOk();
    mockOwner.findTotalsForPeriod.mockResolvedValue({ data: null, error: new Error('ledger down') });
    const res = await call(ACCOUNT);
    expect(res.status).toBe(200);
    const data = (await res.json()).data;
    expect(data.usage).toEqual({ status: 'error' });
    expect(data.extra.status).toBe('ok');
  });

  it('a lot read error (or the ceiling, which the repository answers as an error): extra { status: error }, usage still ok', async () => {
    allReadsOk();
    mockLots.listLotsWithDraws.mockResolvedValue({ data: null, error: new Error('Too many credit lots to read at once') });
    const data = (await (await call(ACCOUNT)).json()).data;
    expect(data.extra).toEqual({ status: 'error' });
    expect(data.usage.status).toBe('ok');
  });

  it('an unreadable lot figure (extraCreditsAt null): extra { status: error }', async () => {
    allReadsOk({ lots: [lot({ createdAt: 'not a date' })] });
    const data = (await (await call(ACCOUNT)).json()).data;
    expect(data.extra).toEqual({ status: 'error' });
    expect(data.usage.status).toBe('ok');
  });
});

describe('the account comes only from the path (G11c-5, SA W11c-5)', () => {
  beforeEach(() => asAdmin());

  function everyAccountArgument(): unknown[] {
    return [
      ...mockIsTenant.mock.calls.map((c) => (c[0] as { accountId: string }).accountId),
      ...mockGetSnapshot.mock.calls.map((c) => c[0]),
      ...mockPlan.findPeriodAnchor.mock.calls.map((c) => c[0]),
      ...ownerReadCalls().map((c) => c[0]),
      ...mockLots.listLotsWithDraws.mock.calls.map((c) => c[0]),
    ];
  }

  it('every call to every read receives exactly the path account', async () => {
    allReadsOk();
    await call(ACCOUNT);
    const accounts = everyAccountArgument();
    // Non-vacuity: tenant, snapshot, anchor, totals, lots at least.
    expect(accounts.length).toBeGreaterThanOrEqual(5);
    expect(new Set(accounts)).toEqual(new Set([ACCOUNT]));
  });

  it('an upper-case path gives the lower-case id in every call and in the payload', async () => {
    allReadsOk();
    const data = (await (await call(ACCOUNT.toUpperCase())).json()).data;
    expect(data.accountId).toBe(ACCOUNT);
    expect(new Set(everyAccountArgument())).toEqual(new Set([ACCOUNT]));
  });

  it('query parameters are ignored', async () => {
    allReadsOk();
    const data = (await (await call(ACCOUNT, `?accountId=${OTHER}&userId=${OTHER}`)).json()).data;
    expect(data.accountId).toBe(ACCOUNT);
    expect(new Set(everyAccountArgument())).toEqual(new Set([ACCOUNT]));
  });

  it('the owner read repository is built on the service-role client, by the wiring', async () => {
    allReadsOk();
    await call(ACCOUNT);
    expect(mockOwnerConstructed[mockOwnerConstructed.length - 1]).toBe(mockServiceClient);
  });
});

describe('own account (OP-28)', () => {
  it('isOwnAccount is true for the admin\'s own id, in any case', async () => {
    asAdmin({ id: ACCOUNT.toUpperCase(), email: 'self@example.com' });
    allReadsOk();
    const data = (await (await call(ACCOUNT)).json()).data;
    expect(data.isOwnAccount).toBe(true);
  });
});

describe('logging (SA OP-36)', () => {
  beforeEach(() => asAdmin());

  it('one info line with ids, statuses and counts: never a reason and never a figure', async () => {
    allReadsOk();
    await call(ACCOUNT);
    const infos = mockLog.info.mock.calls.filter((c) => c[1] === 'Admin read a Business OS account credit position');
    expect(infos).toHaveLength(1);
    expect(infos[0][0]).toEqual({ accountId: ACCOUNT, usageStatus: 'ok', extraStatus: 'ok', lotCount: 3 });
    const logged = JSON.stringify(mockLog.info.mock.calls);
    expect(logged).not.toContain('goodwill');
    expect(logged).not.toContain('73.75');
  });
});
