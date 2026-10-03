/**
 * GET /api/admin/users — the "Credits left" column's data (credit deduction
 * slice 8a; FR-48, AC-43; SA SQ-42, C-W4).
 *
 * Two layers: the route with the credits pass MOCKED (what the route does with
 * the pass's answer), and the route over the REAL pass with its reads mocked
 * (budget, failure, call count per chunk).
 */

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

const mockListUsers = jest.fn();
jest.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ auth: { admin: { listUsers: () => mockListUsers() } } }),
}));

const mockListForAdmin = jest.fn();
jest.mock('@/lib/repositories/UserProfileRepository', () => ({
  userProfileRepository: { listForAdmin: (...a: unknown[]) => mockListForAdmin(...a) },
}));

const mockIdentities = jest.fn();
jest.mock('@/lib/repositories/BusinessProfileRepository', () => ({
  BUSINESS_SEARCH_MAX_LIMIT: 50,
  businessProfileRepository: {
    findAdminIdentitiesByUserIds: (...a: unknown[]) => mockIdentities(...a),
    searchForAdmin: async () => ({ data: [], error: null }),
  },
}));

// The REAL pass, with its reads mocked: the production wiring and the
// entitlements service are replaced; `creditAllowanceForDisplay` reads the
// allowance a test put on the snapshot.
const mockAnchors = jest.fn();
const mockTotals = jest.fn();
jest.mock('@/lib/business-os/credits/adminCreditPercentDeps', () => ({
  adminCreditPercentDeps: () => ({
    findPeriodAnchorsBatch: (ids: readonly string[]) => mockAnchors(ids),
    listTotalsForAccountsInRange: (ids: readonly string[], range: unknown, opts: unknown) => mockTotals(ids, range, opts),
  }),
}));
const mockGetSnapshots = jest.fn();
jest.mock('@/lib/business-os/entitlements/EntitlementService', () => ({
  getEntitlementService: () => ({ getSnapshots: (ids: string[]) => mockGetSnapshots(ids) }),
}));
jest.mock('@/lib/business-os/entitlements/creditAllowanceView', () => ({
  creditAllowanceForDisplay: (snapshot: { allowance?: unknown }) => snapshot.allowance ?? null,
}));

import { GET } from '../route';
import * as pass from '@/lib/business-os/credits/adminCreditPercent';

const ADMIN = { id: '11111111-1111-4111-8111-111111111111', email: 'ops@example.com' };
const OWNER = { id: '2f734ed5-3681-4049-880d-3de7b096bea3', email: 'owner@example.com' };
const uid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const MONTHLY_BOS = uid(1);
const TRIAL_BOS = uid(2);
const NO_ALLOWANCE_BOS = uid(3);
const NOT_BOS = uid(4);

const PERIOD = '2026-09-14T09:31:07.123456+00:00';
const ANCHOR = PERIOD;

const call = () => GET(new NextRequest('http://localhost/api/admin/users'));
const asAdmin = () => {
  mockGetUser.mockResolvedValue(ADMIN);
  mockIsAdmin.mockResolvedValue(true);
};

function profiles(ids: string[]) {
  return {
    data: ids.map((id) => ({ id, full_name: 'X', company: null, created_at: '2026-09-01T00:00:00Z', updated_at: null })),
    error: null,
  };
}
function identities(ids: string[]) {
  return { data: ids.map((user_id) => ({ user_id, company_name: 'Biz', vertical: 'therapist', sub_vertical: null })), error: null };
}

/** The served line's context (the route's own Pino line). */
const servedLine = () => mockLog.info.mock.calls.find(([, msg]) => msg === 'Admin user list served')?.[0];

/** Every key anywhere in a JSON value. */
function keysOf(value: unknown, into: string[] = []): string[] {
  if (Array.isArray(value)) value.forEach((v) => keysOf(v, into));
  else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      into.push(k);
      keysOf(v, into);
    }
  }
  return into;
}

beforeEach(() => {
  jest.restoreAllMocks();
  jest.clearAllMocks();
  mockGetUser.mockReset();
  mockIsAdmin.mockReset();
  mockListUsers.mockResolvedValue({ data: { users: [] }, error: null });
  mockListForAdmin.mockResolvedValue(profiles([MONTHLY_BOS, TRIAL_BOS, NO_ALLOWANCE_BOS, NOT_BOS]));
  mockIdentities.mockResolvedValue(identities([MONTHLY_BOS, TRIAL_BOS, NO_ALLOWANCE_BOS]));
});

describe('the route with the pass mocked', () => {
  it('happy path: BOS rows carry creditsLeft; a row with no business carries no key at all', async () => {
    asAdmin();
    const spy = jest.spyOn(pass, 'readAdminCreditsLeft').mockResolvedValue({
      outcome: 'ok',
      byUserId: new Map<string, pass.AdminCreditsLeft>([
        [MONTHLY_BOS, { kind: 'percent', value: 64, trial: false }],
        [TRIAL_BOS, { kind: 'less_than_one', trial: true }],
        [NO_ALLOWANCE_BOS, { kind: 'no_allowance' }],
      ]),
    });

    const res = await call();
    expect(res.status).toBe(200);
    const body = await res.json();
    const byId = Object.fromEntries(body.data.map((u: { id: string }) => [u.id, u]));

    expect(spy).toHaveBeenCalledTimes(1);
    // Only the rows that HAVE a business, from this list — never request input.
    expect([...spy.mock.calls[0][0]].sort()).toEqual([MONTHLY_BOS, NO_ALLOWANCE_BOS, TRIAL_BOS].sort());
    expect(byId[MONTHLY_BOS].creditsLeft).toEqual({ kind: 'percent', value: 64, trial: false });
    expect(byId[TRIAL_BOS].creditsLeft).toEqual({ kind: 'less_than_one', trial: true });
    expect(byId[NO_ALLOWANCE_BOS].creditsLeft).toEqual({ kind: 'no_allowance' });
    expect(byId[NOT_BOS]).not.toHaveProperty('creditsLeft');
    expect(servedLine()).toEqual(expect.objectContaining({ creditsPass: 'ok' }));
  });

  it('a BOS row the pass did not answer reads unknown', async () => {
    asAdmin();
    jest.spyOn(pass, 'readAdminCreditsLeft').mockResolvedValue({ outcome: 'ok', byUserId: new Map() });
    const body = await (await call()).json();
    const row = body.data.find((u: { id: string }) => u.id === MONTHLY_BOS);
    expect(row.creditsLeft).toEqual({ kind: 'unknown' });
  });

  it.each([
    ['401 signed out', null, false, 401],
    ['403 for a non-admin', OWNER, false, 403],
  ])('%s: unchanged, and the pass never runs', async (_name, user, admin, status) => {
    mockGetUser.mockResolvedValue(user);
    mockIsAdmin.mockResolvedValue(admin);
    const spy = jest.spyOn(pass, 'readAdminCreditsLeft');
    expect((await call()).status).toBe(status);
    expect(spy).not.toHaveBeenCalled();
  });

  it('a failed business lookup: no pass, no creditsLeft anywhere, creditsPass skipped', async () => {
    asAdmin();
    mockIdentities.mockResolvedValue({ data: null, error: new Error('boom') });
    const spy = jest.spyOn(pass, 'readAdminCreditsLeft');
    const res = await call();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(spy).not.toHaveBeenCalled();
    for (const u of body.data) expect(u).not.toHaveProperty('creditsLeft');
    expect(servedLine()).toEqual(expect.objectContaining({ creditsPass: 'skipped' }));
  });

  it('runs alongside the auth enrichment: listUsers is called before the pass answers', async () => {
    asAdmin();
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    jest.spyOn(pass, 'readAdminCreditsLeft').mockImplementation(async () => {
      await gate;
      return { outcome: 'ok', byUserId: new Map() };
    });

    const pending = call();
    await new Promise((resolve) => setImmediate(resolve));
    expect(mockListUsers).toHaveBeenCalledTimes(1);
    release();
    expect((await pending).status).toBe(200);
  });
});

describe('the route over the real pass (reads mocked)', () => {
  const snapshotsFor = (ids: string[], allowanceOf: (id: string) => unknown) =>
    new Map(ids.map((id) => [id, { unavailable: false, allowance: allowanceOf(id) }]));

  beforeEach(() => {
    mockGetSnapshots.mockImplementation(async (ids: string[]) =>
      snapshotsFor(ids, (id) =>
        id === NO_ALLOWANCE_BOS ? null : id === TRIAL_BOS ? { amount: 2000, per: 'total' } : { amount: 32250, per: 'month' }
      )
    );
    mockAnchors.mockImplementation(async (ids: readonly string[]) => ({
      data: Object.fromEntries(ids.map((id) => [id, id === TRIAL_BOS ? new Date(Date.now() - 86_400_000).toISOString() : ANCHOR])),
      error: null,
    }));
    mockTotals.mockImplementation(async () => ({ data: { rows: [], reachedCeiling: false }, error: null }));
  });

  it('a failed read: 200, every BOS row unknown, creditsPass failed', async () => {
    asAdmin();
    mockAnchors.mockResolvedValue({ data: null, error: new Error('anchors down') });
    const res = await call();
    expect(res.status).toBe(200);
    const body = await res.json();
    for (const u of body.data) {
      if (u.id === NOT_BOS) expect(u).not.toHaveProperty('creditsLeft');
      else expect(u.creditsLeft).toEqual({ kind: 'unknown' });
    }
    expect(servedLine()).toEqual(expect.objectContaining({ creditsPass: 'failed' }));
  });

  describe('the budget', () => {
    beforeEach(() => jest.useFakeTimers({ doNotFake: ['setImmediate', 'nextTick'] }));
    afterEach(() => jest.useRealTimers());

    it('a hung pass: 200 after the 2 s budget, every BOS row unknown, and the route logs creditsPass timeout (SA C-W4)', async () => {
      asAdmin();
      mockAnchors.mockImplementation(() => new Promise(() => {}));

      const pending = call();
      await jest.advanceTimersByTimeAsync(pass.ADMIN_CREDITS_BUDGET_MS);
      const res = await pending;

      expect(res.status).toBe(200);
      const body = await res.json();
      for (const u of body.data) {
        if (u.id === NOT_BOS) expect(u).not.toHaveProperty('creditsLeft');
        else expect(u.creditsLeft).toEqual({ kind: 'unknown' });
      }
      expect(servedLine()).toEqual(expect.objectContaining({ creditsPass: 'timeout' }));
      expect(jest.getTimerCount()).toBe(0);
    });
  });

  it.each([
    [1, 1, 1, 1],
    [100, 1, 1, 1],
    [101, 2, 2, 1],
  ])('%i Business OS accounts → %i snapshot read(s) · %i anchor read(s) · %i totals read(s)', async (n, snapshotReads, anchorReads, totalsReads) => {
    asAdmin();
    const ids = Array.from({ length: n }, (_, i) => uid(1000 + i));
    mockListForAdmin.mockResolvedValue(profiles(ids));
    mockIdentities.mockResolvedValue(identities(ids));
    // As the production service: one repository read per chunk of 100.
    let chunks = 0;
    mockGetSnapshots.mockImplementation(async (accountIds: string[]) => {
      chunks += Math.ceil(accountIds.length / 100);
      return snapshotsFor(accountIds, () => ({ amount: 32250, per: 'month' }));
    });

    const res = await call();
    expect(res.status).toBe(200);
    expect(chunks).toBe(snapshotReads);
    expect(mockAnchors).toHaveBeenCalledTimes(anchorReads);
    expect(mockTotals).toHaveBeenCalledTimes(totalsReads);
  });

  it('the payload carries no credit count, token, cost or dollar key', async () => {
    asAdmin();
    mockTotals.mockResolvedValue({
      data: { rows: [{ user_id: MONTHLY_BOS, period_start: PERIOD, credits_total: '11610' }], reachedCeiling: false },
      error: null,
    });
    const body = await (await call()).json();

    const values = body.data.filter((u: { creditsLeft?: unknown }) => u.creditsLeft).map((u: { creditsLeft: unknown }) => u.creditsLeft);
    expect(values.length).toBe(3);
    for (const value of values) {
      for (const key of Object.keys(value)) expect(['kind', 'value', 'trial']).toContain(key);
    }
    const keys = keysOf(body);
    for (const banned of [/^credits_total$/, /^used$/, /^allowance$/, /^amount$/, /cost/i, /token/i, /usd/i, /dollar/i]) {
      expect(keys.filter((k) => banned.test(k))).toEqual([]);
    }
    expect(JSON.stringify(body)).not.toContain('11610');
  });
});
