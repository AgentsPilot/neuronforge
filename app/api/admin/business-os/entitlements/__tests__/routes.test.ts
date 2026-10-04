/**
 * The three admin entitlement routes: the gate, the shapes, and the audit.
 *
 * What matters here is what a REQUEST gets, which is not the same question the
 * `adminOps` suite answers. Three things in particular:
 *
 *   1. **401 → 403 → work**, in that order, on every handler. A route that let
 *      an anonymous request reach a repository would be the only way these
 *      tables could be written from outside the admin surface.
 *   2. **`profiles.role = 'admin'` is not admin** (AC-6). It is user-writable,
 *      so a self-promoted profile must still get 403.
 *   3. **The audit entry is flushed before the response** (WC-7): a serverless
 *      instance can be frozen the moment it responds.
 */

import { NextRequest } from 'next/server';

const ACCOUNT = '11111111-1111-4111-8111-111111111111';
const ADMIN = '22222222-2222-4222-8222-222222222222';

const state = {
  user: null as { id: string; email?: string } | null,
  isAdmin: false,
  adminThrows: false,
  /** Is the account a Business OS tenant at all? (QA, 2026-09-24) */
  isTenant: true,
  /** The plan row the GET reads. Set per test when the account matters. */
  plan: null as Record<string, unknown> | null,
  /** Both tenancy reads fail: the check cannot answer (QA NEW-2). */
  tenantCheckThrows: false,
  /** Only the onboarding read fails, with a profile present (QA NEW-2). */
  onboardingErrors: false,
  audit: [] as Array<Record<string, unknown>>,
  flushes: 0,
  /** Order matters: the flush must happen before the handler resolves. */
  events: [] as string[],
};

jest.mock('@/lib/auth', () => ({
  getUser: async () => state.user,
}));

jest.mock('@/lib/services/AdminAccessService', () => ({
  AdminAccessService: {
    getInstance: () => ({
      isAdmin: async () => {
        if (state.adminThrows) throw new Error('admin lookup exploded');
        return state.isAdmin;
      },
    }),
  },
}));

jest.mock('@/lib/services/AuditTrailService', () => ({
  AuditTrailService: {
    getInstance: () => ({
      log: async (entry: Record<string, unknown>) => {
        state.audit.push(entry);
        state.events.push('log');
      },
      flush: async () => {
        state.flushes += 1;
        state.events.push('flush');
      },
    }),
  },
}));

const repositoryCalls: string[] = [];

/** The plan row the GET returns. State-driven so one test can vary it. */
const CHAMPION_PLAN = {
  user_id: ACCOUNT,
  tier: null as string | null,
  plan_version: 0,
  tier_expires_at: null as string | null,
  cohort: 'champion' as string | null,
  cohort_expires_at: null as string | null,
  onboarding_started_at: '2026-01-01T00:00:00.000Z',
  profile_created_at: '2026-01-02T00:00:00.000Z',
  trial_started_at: null as string | null,
  trial_ends_at: null as string | null,
  grace_ends_at: null as string | null,
  period_anchor: '2026-01-01T00:00:00.000Z',
  origin: 'backfill',
  updated_by_admin_id: null as string | null,
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
};

jest.mock('@/lib/repositories/BusinessOsAccountPlanRepository', () => ({
  businessOsAccountPlanRepository: {
    async findEntitlementInputs() {
      repositoryCalls.push('findEntitlementInputs');
      return {
        data: {
          plan: state.plan,
          overrides: [],
        },
        error: null,
      };
    },
    async updatePlan(_accountId: string, patch: Record<string, unknown>) {
      repositoryCalls.push('updatePlan');
      return { data: { user_id: ACCOUNT, cohort: 'champion', ...patch }, error: null };
    },
    async pagePlans() {
      repositoryCalls.push('pagePlans');
      return { data: [], error: null };
    },
    async findTenantsMissingPlanRow() {
      repositoryCalls.push('findTenantsMissingPlanRow');
      return { data: { checked: 0, missing: [], truncated: false }, error: null };
    },
    async findRecentOnboardedPlans() {
      return { data: [], error: null };
    },
  },
}));

jest.mock('@/lib/repositories/BusinessOsEntitlementShadowRepository', () => ({
  businessOsEntitlementShadowRepository: {
    async findWindow() {
      repositoryCalls.push('findWindow');
      return { data: [], error: null };
    },
  },
}));

jest.mock('@/lib/repositories/BusinessProfileRepository', () => ({
  businessProfileRepository: {
    async findByUserId() {
      // `isTenant` drives BOTH repositories: the tenancy rule is "a business
      // profile OR an onboarding message", so a non-tenant needs neither.
      if (state.tenantCheckThrows) return { data: null, error: new Error('profile read failed') };
      return { data: state.isTenant ? { created_at: '2026-01-02T00:00:00.000Z' } : null, error: null };
    },
  },
}));

jest.mock('@/lib/repositories/OnboardingConversationRepository', () => ({
  onboardingConversationRepository: {
    async getFirstMessageAt() {
      return { data: state.isTenant ? '2026-01-01T00:00:00.000Z' : null, error: null };
    },
    async getLatestMessageAt() {
      if (state.tenantCheckThrows || state.onboardingErrors) {
        return { data: null, error: new Error('onboarding read failed') };
      }
      return { data: state.isTenant ? '2026-03-01T00:00:00.000Z' : null, error: null };
    },
  },
}));

// ── Slice 11b: the credit ops' repositories ─────────────────────────────────
// Hex letters on purpose: an all-digit uuid reads the same in upper case, so
// a case test written with one would prove nothing.
const LOT = 'aaaaaaaa-3333-4333-8333-33333333333a';
const BOOST_LOT = 'bbbbbbbb-4444-4444-8444-44444444444b';
const FOREIGN_LOT = 'ffffffff-5555-4555-8555-55555555555f';
const NEW_LOT = '66666666-6666-4666-8666-666666666666';
const DRAW = '77777777-7777-4777-8777-777777777777';
const REQUEST = '88888888-8888-4888-8888-888888888888';
const PLATFORM = 'eeeeeeee-9999-4999-8999-99999999999e';
/** An account and an admin whose ids have letters, for the case tests (W11b-1). */
const HEX_ACCOUNT = 'abcdef01-2345-4678-89ab-cdef01234567';
const HEX_ADMIN = 'fedcba98-7654-4321-8fed-cba987654321';
const FAR_FUTURE = '2099-12-31T00:00:00.000Z';

function creditLotRow(overrides: Record<string, unknown> = {}) {
  return {
    id: LOT,
    accountId: ACCOUNT,
    source: 'admin_grant',
    creditsGranted: 100,
    creditsBase: 100,
    creditsBonus: 0,
    creditValueVersion: 1,
    expiresAt: null as string | null,
    idempotencyKey: 'admin_grant:00000000-0000-4000-8000-000000000001',
    sourceRef: null,
    actorKind: 'admin',
    actorAdminId: ADMIN,
    reason: 'earlier grant',
    createdAt: '2026-09-01T00:00:00.000Z',
    draws: [] as unknown[],
    ...overrides,
  };
}

const credit = {
  lots: [] as Array<ReturnType<typeof creditLotRow>>,
  listError: false,
  hold: 'not_held' as 'not_held' | 'held' | 'error' | 'throws',
  record: { outcome: 'recorded', lotId: NEW_LOT } as Record<string, unknown> | 'error',
  stored: null as Record<string, unknown> | null,
  reverse: { status: 'recorded', drawId: DRAW, credits: 40, remainingBefore: 100, remainingAfter: 60 } as Record<string, unknown> | 'error',
};

function resetCredit() {
  credit.lots = [
    creditLotRow(),
    creditLotRow({ id: BOOST_LOT, source: 'boost_purchase', actorKind: 'stripe_webhook', actorAdminId: null, creditsGranted: 13.75 }),
  ];
  credit.listError = false;
  credit.hold = 'not_held';
  credit.record = { outcome: 'recorded', lotId: NEW_LOT };
  credit.stored = null;
  credit.reverse = { status: 'recorded', drawId: DRAW, credits: 40, remainingBefore: 100, remainingAfter: 60 };
}

jest.mock('@/lib/repositories/BusinessOsCreditLotRepository', () => ({
  businessOsCreditLotRepository: {
    async listLotsWithDraws() {
      repositoryCalls.push('listLotsWithDraws');
      return credit.listError ? { data: null, error: new Error('lots read failed') } : { data: credit.lots, error: null };
    },
    async recordLot() {
      repositoryCalls.push('recordLot');
      return credit.record === 'error' ? { data: null, error: new Error('write failed') } : { data: credit.record, error: null };
    },
    async findLotForAccount() {
      repositoryCalls.push('findLotForAccount');
      return { data: credit.stored, error: null };
    },
    async reverseLot() {
      repositoryCalls.push('reverseLot');
      return credit.reverse === 'error' ? { data: null, error: new Error('write failed') } : { data: credit.reverse, error: null };
    },
  },
}));

jest.mock('@/lib/repositories/BusinessOsAccountLineageRepository', () => ({
  businessOsAccountLineageRepository: {
    async findHoldFactsForAccount() {
      repositoryCalls.push('findHoldFactsForAccount');
      if (credit.hold === 'throws') throw new Error('lineage exploded');
      if (credit.hold === 'error') return { data: null, error: new Error('lineage read failed') };
      if (credit.hold === 'held') return { data: { source: 'account_invite', first_paid_at: null, invite_id: null }, error: null };
      return { data: null, error: null };
    },
  },
}));

jest.mock('@/lib/repositories/BusinessOsInviteRepository', () => ({
  businessOsInviteRepository: {
    async findHoldFactsById() {
      repositoryCalls.push('findHoldFactsById');
      return { data: null, error: null };
    },
  },
}));

/** Every write method of the plan and lot repositories, for the no-write-on-refusal checks (W11b-6). */
const WRITE_METHODS = ['updatePlan', 'ensurePlanRow', 'createOverride', 'endOverride', 'resetPlanState', 'recordLot', 'reverseLot'];

// eslint-disable-next-line @typescript-eslint/no-require-imports
const accountRoute = require('@/app/api/admin/business-os/entitlements/accounts/[accountId]/route');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const launchRoute = require('@/app/api/admin/business-os/entitlements/launch/route');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const reportRoute = require('@/app/api/admin/business-os/entitlements/shadow-report/route');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const plansRoute = require('@/app/api/admin/business-os/entitlements/plans/route');

function post(url: string, body: unknown): NextRequest {
  return new NextRequest(new URL(url, 'http://localhost'), {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  });
}

function get(url: string): NextRequest {
  return new NextRequest(new URL(url, 'http://localhost'));
}

beforeEach(() => {
  state.user = { id: ADMIN, email: 'admin@example.com' };
  state.isAdmin = true;
  state.adminThrows = false;
  state.isTenant = true;
  state.tenantCheckThrows = false;
  state.onboardingErrors = false;
  state.plan = { ...CHAMPION_PLAN };
  state.audit = [];
  state.flushes = 0;
  state.events = [];
  repositoryCalls.length = 0;
  resetCredit();
});

/** Every exported handler, so the gate cases cover all of them. */
const HANDLERS: Array<[string, () => Promise<Response>]> = [
  ['accounts GET', () => accountRoute.GET(get(`/api/admin/business-os/entitlements/accounts/${ACCOUNT}`), { params: { accountId: ACCOUNT } })],
  [
    'accounts POST',
    () =>
      accountRoute.POST(
        post(`/api/admin/business-os/entitlements/accounts/${ACCOUNT}`, {
          op: 'set_cohort',
          cohort: 'trial',
          reason: 'support case',
        }),
        { params: { accountId: ACCOUNT } }
      ),
  ],
  // Slice 11b: the credit ops sit behind the same gate.
  [
    'accounts POST grant_credits',
    () =>
      accountRoute.POST(
        post(`/api/admin/business-os/entitlements/accounts/${ACCOUNT}`, {
          op: 'grant_credits',
          amount: 50,
          expiresAt: null,
          requestId: REQUEST,
          reason: 'goodwill',
        }),
        { params: { accountId: ACCOUNT } }
      ),
  ],
  [
    'accounts POST reduce_credit_lot',
    () =>
      accountRoute.POST(
        post(`/api/admin/business-os/entitlements/accounts/${ACCOUNT}`, {
          op: 'reduce_credit_lot',
          lotId: LOT,
          amount: 40,
          requestId: REQUEST,
          reason: 'mistaken grant',
        }),
        { params: { accountId: ACCOUNT } }
      ),
  ],
  ['launch POST', () => launchRoute.POST(post('/api/admin/business-os/entitlements/launch', { confirm: 'launch_champion_existing', reason: 'dry run' }))],
  ['shadow-report GET', () => reportRoute.GET(get('/api/admin/business-os/entitlements/shadow-report'))],
  ['plans GET', () => plansRoute.GET(get('/api/admin/business-os/entitlements/plans'))],
];

describe('the gate, on every handler', () => {
  it.each(HANDLERS)('%s returns 401 when signed out', async (_name, call) => {
    state.user = null;

    const response = await call();

    expect(response.status).toBe(401);
    // Nothing was read or written before the refusal.
    expect(repositoryCalls).toEqual([]);
    expect(state.audit).toEqual([]);
  });

  it.each(HANDLERS)('%s returns 403 for a signed-in non-admin', async (_name, call) => {
    state.isAdmin = false;

    const response = await call();

    expect(response.status).toBe(403);
    expect(repositoryCalls).toEqual([]);
    // A refusal writes no audit row either: the gate precedes everything.
    expect(state.audit).toEqual([]);
  });

  it.each(HANDLERS)('%s fails CLOSED when the admin check throws', async (_name, call) => {
    // A check that cannot answer is a "no", not a 500 and not a pass.
    state.adminThrows = true;

    const response = await call();

    expect(response.status).toBe(403);
    expect(repositoryCalls).toEqual([]);
    expect(state.audit).toEqual([]);
  });

  it('AC-6: a user-writable profile role is NOT admin', async () => {
    // `profiles.role` is self-settable, which is exactly why the gate reads
    // `admin_users` instead. This asserts the route never consults the profile.
    state.isAdmin = false;
    state.user = { id: ADMIN, email: 'admin@example.com' };

    const response = await accountRoute.GET(get(`/api/admin/business-os/entitlements/accounts/${ACCOUNT}`), {
      params: { accountId: ACCOUNT },
    });

    expect(response.status).toBe(403);
  });
});

describe('T11b.1 characterisation pin: an existing op\'s audit call, byte for byte (slice 11b, S11-C-7, G11b-1)', () => {
  // Written FIRST, on the route as it was before slice 11b, and never edited
  // since: the credit ops add an audit override, a replay branch and a
  // conditional cache invalidation to this route, and none of that may change
  // what the seven existing ops record. Every key is pinned with `toEqual`.
  const FIXED_NOW = new Date('2026-10-02T09:30:00.000Z');
  const CORRELATION = 'corr-11b-pin';

  beforeEach(() => {
    // Only `Date` is faked: the request body is read through real streams.
    jest.useFakeTimers({
      now: FIXED_NOW,
      doNotFake: ['nextTick', 'setImmediate', 'clearImmediate', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'queueMicrotask'],
    });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('set_cohort: the full audit entry, the response and the cache invalidation', async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const entitlementService = require('@/lib/business-os/entitlements/EntitlementService');
    const service = entitlementService.getEntitlementService();
    const invalidate = jest.spyOn(service, 'invalidate');

    const request = new NextRequest(new URL(`/api/admin/business-os/entitlements/accounts/${ACCOUNT}`, 'http://localhost'), {
      method: 'POST',
      body: JSON.stringify({ op: 'set_cohort', cohort: 'trial', reason: 'support case' }),
      headers: { 'content-type': 'application/json', 'x-correlation-id': CORRELATION },
    });

    const response = await accountRoute.POST(request, { params: { accountId: ACCOUNT } });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true, data: { accountId: ACCOUNT, op: 'set_cohort' } });

    expect(state.audit).toHaveLength(1);
    expect(state.audit[0]).toEqual({
      action: 'BOS_ENTITLEMENT_COHORT_SET',
      entityType: 'business_os_account_plan',
      entityId: ACCOUNT,
      userId: ACCOUNT,
      actorId: ADMIN,
      changes: {
        before: { ...CHAMPION_PLAN },
        after: {
          user_id: ACCOUNT,
          cohort: 'trial',
          period_anchor: FIXED_NOW.toISOString(),
          cohort_expires_at: null,
          trial_started_at: FIXED_NOW.toISOString(),
        },
      },
      details: { reason: 'support case', op: 'set_cohort', correlationId: CORRELATION },
      severity: 'warning',
      request,
    });
    expect(state.events).toEqual(['log', 'flush']);
    expect(invalidate).toHaveBeenCalledTimes(1);
    expect(invalidate).toHaveBeenCalledWith(ACCOUNT);

    invalidate.mockRestore();
  });
});

describe('POST /accounts/[accountId]', () => {
  it('applies an op and returns what happened', async () => {
    const response = await accountRoute.POST(
      post(`/api/admin/business-os/entitlements/accounts/${ACCOUNT}`, {
        op: 'set_cohort',
        cohort: 'trial',
        reason: 'support case',
      }),
      { params: { accountId: ACCOUNT } }
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ success: true, data: { accountId: ACCOUNT, op: 'set_cohort' } });
    expect(repositoryCalls).toContain('updatePlan');
  });

  it('writes one audit entry with the actor, the reason and the before/after', async () => {
    await accountRoute.POST(
      post(`/api/admin/business-os/entitlements/accounts/${ACCOUNT}`, {
        op: 'set_cohort',
        cohort: 'trial',
        reason: 'support case',
      }),
      { params: { accountId: ACCOUNT } }
    );

    expect(state.audit).toHaveLength(1);
    expect(state.audit[0]).toMatchObject({
      action: 'BOS_ENTITLEMENT_COHORT_SET',
      entityType: 'business_os_account_plan',
      entityId: ACCOUNT,
      actorId: ADMIN,
      severity: 'warning',
    });
    expect((state.audit[0].details as { reason: string }).reason).toBe('support case');
    expect(state.audit[0].changes).toHaveProperty('before');
    expect(state.audit[0].changes).toHaveProperty('after');
  });

  it('WC-7: flushes the audit BEFORE responding', async () => {
    // A serverless instance can be frozen the instant it responds, and an
    // entitlement change with no audit row is the one kind this must not have.
    await accountRoute.POST(
      post(`/api/admin/business-os/entitlements/accounts/${ACCOUNT}`, {
        op: 'set_cohort',
        cohort: 'trial',
        reason: 'support case',
      }),
      { params: { accountId: ACCOUNT } }
    );

    expect(state.events).toEqual(['log', 'flush']);
    expect(state.flushes).toBe(1);
  });

  it('400s an invalid body without touching the repository', async () => {
    const response = await accountRoute.POST(
      post(`/api/admin/business-os/entitlements/accounts/${ACCOUNT}`, { op: 'set_cohort', cohort: 'emperor', reason: 'x' }),
      { params: { accountId: ACCOUNT } }
    );

    expect(response.status).toBe(400);
    expect(repositoryCalls).toEqual([]);
    expect(state.audit).toEqual([]);
  });

  it('400s a malformed account id', async () => {
    const response = await accountRoute.POST(post('/api/admin/business-os/entitlements/accounts/nope', { op: 'set_cohort', cohort: 'trial', reason: 'support case' }), {
      params: { accountId: 'nope' },
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: 'invalid_account_id' });
  });

  it('passes a refusal through with its status and code, and audits nothing', async () => {
    const response = await accountRoute.POST(
      post(`/api/admin/business-os/entitlements/accounts/${ACCOUNT}`, {
        op: 'add_override',
        capability: 'marketing.posts',
        overrideOp: 'set',
        value: true,
        reason: 'comp this',
      }),
      { params: { accountId: ACCOUNT } }
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ success: false, error: 'capability_not_built' });
    expect(state.audit).toEqual([]);
  });
});

describe('GET /accounts/[accountId]', () => {
  it('returns the state, the trace and the override reasons (the admin-only view)', async () => {
    const response = await accountRoute.GET(get(`/api/admin/business-os/entitlements/accounts/${ACCOUNT}`), {
      params: { accountId: ACCOUNT },
    });

    expect(response.status).toBe(200);
    const body = await response.json();

    expect(body.data).toMatchObject({ accountId: ACCOUNT, state: 'champion', effectiveWithinSeconds: 30 });
    // FR-10: every capability carries the layer that decided it.
    expect(body.data.capabilities['crm.core']).toHaveProperty('decidedBy');
    expect(body.data.capabilities['crm.core']).toHaveProperty('trace');
    expect(Array.isArray(body.data.overrides)).toBe(true);
  });
});

describe('POST /launch (R2-1)', () => {
  it('a dry run reports and writes nothing', async () => {
    const response = await launchRoute.POST(
      post('/api/admin/business-os/entitlements/launch', { confirm: 'launch_champion_existing', reason: 'planning' })
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ success: true, data: { dryRun: true, wroteNothing: true } });
    expect(repositoryCalls).toContain('pagePlans');
    expect(repositoryCalls).not.toContain('updatePlan');
  });

  it('a REAL run is still refused, and writes nothing (2026-09-23)', async () => {
    // It used to be refused at 409 `launch_preconditions_unmet`, because no tier
    // was configured. Two tiers ship from 2026-09-23, so that precondition is
    // met and the refusal moves one line down: Slice 2 owns the execution, and
    // half a launch is worse than none. What must NOT change either way is that
    // a real run touches nothing.
    const response = await launchRoute.POST(
      post('/api/admin/business-os/entitlements/launch', {
        confirm: 'launch_champion_existing',
        reason: 'do it',
        dryRun: false,
      })
    );

    expect(response.status).toBe(501);
    expect(await response.json()).toMatchObject({ error: 'not_implemented_until_slice_2' });
    expect(repositoryCalls).toEqual([]);
  });

  it('refuses a body without the confirm literal', async () => {
    const response = await launchRoute.POST(post('/api/admin/business-os/entitlements/launch', { reason: 'oops' }));
    expect(response.status).toBe(400);
  });
});

describe('GET /shadow-report (S1-T12b)', () => {
  it('builds the report for an admin', async () => {
    const response = await reportRoute.GET(get('/api/admin/business-os/entitlements/shadow-report'));

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data).toHaveProperty('static');
    // The qualifiers travel with the numbers (QA D-1).
    expect(body.data.limitations).toHaveProperty('hookedSurfaces');
  });

  it('refuses half a window rather than silently widening it', async () => {
    const response = await reportRoute.GET(get('/api/admin/business-os/entitlements/shadow-report?from=2026-09-01'));
    expect(response.status).toBe(400);
  });

  it('refuses asTier without a window to replay', async () => {
    const response = await reportRoute.GET(get('/api/admin/business-os/entitlements/shadow-report?asTier=growth'));
    expect(response.status).toBe(400);
  });
});

describe('GET /plans (the Tiers admin screen)', () => {
  it('returns every plan, the mode and the not-built list', async () => {
    const response = await plansRoute.GET(get('/api/admin/business-os/entitlements/plans'));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    // Four plans, two of them tiers. Asserted through the payload rather than
    // against a list written here: the config is the source of truth, and a
    // test that named the plans would have to be edited to add one.
    expect(body.data.plans.length).toBeGreaterThanOrEqual(2);
    expect(body.data.plans.filter((plan: { kind: string }) => plan.kind === 'tier').length).toBeGreaterThan(0);
    expect(body.data.notBuilt.length).toBeGreaterThan(0);
    expect(['off', 'shadow', 'enforce']).toContain(body.data.mode);
    // SA R-1: the page needs to know which withheld capabilities nothing
    // enforces, and the route is where that fact arrives.
    expect(Array.isArray(body.data.withheldWithoutGate)).toBe(true);
    expect(body.data.plans[0].includes[0]).toHaveProperty('gateBuilt');
    expect(body.data.plans[0]).toHaveProperty('basis');
  });

  it('reads nothing and writes nothing', async () => {
    // The screen behind it is read-only, and so is this: no repository call,
    // no audit row. If either ever appears, the route has grown a side effect.
    await plansRoute.GET(get('/api/admin/business-os/entitlements/plans'));

    expect(repositoryCalls).toEqual([]);
    expect(state.audit).toEqual([]);
  });

  it('has no POST: the write ops live on the accounts route', async () => {
    // v1 is read-only by decision (D-4), and the absence is asserted rather
    // than assumed — a POST added here would bypass the audited op path.
    expect(plansRoute.POST).toBeUndefined();
    expect(plansRoute.PUT).toBeUndefined();
    expect(plansRoute.PATCH).toBeUndefined();
    expect(plansRoute.DELETE).toBeUndefined();
  });
});

describe('GET /accounts/[accountId] — the contract the admin screen renders (QA-7)', () => {
  /**
   * The node half of a two-part check.
   *
   * `app/admin/business-os-tiers/__tests__/__fixtures__/recordedAccountBody.json`
   * is the verbatim body this route produced for a `basic` tier account, and
   * the screen's `accountLookup.contract.test.tsx` renders the component
   * against it. This test asserts the route still produces exactly that.
   *
   * Together they close the gap that let two High defects ship: a fixture the
   * component's author wrote, checked against nothing, while the server sent a
   * different shape.
   */
  /* eslint-disable @typescript-eslint/no-require-imports */
  const recordedOnATier = require('@/app/admin/business-os-tiers/__tests__/__fixtures__/recordedAccountBody.json');
  const recordedNoPlanRow = require('@/app/admin/business-os-tiers/__tests__/__fixtures__/recordedAccountBodyNoPlanRow.json');
  /* eslint-enable @typescript-eslint/no-require-imports */

  /** The plan row each recording was taken for. */
  const TIER_PLAN = { ...CHAMPION_PLAN, tier: 'basic', plan_version: 1, cohort: null, origin: 'admin' };

  it('still matches the body the admin screen is tested against — account on a tier', async () => {
    // The interesting case for the screen: `basis` carries a tier name and the
    // granted count is the plan's.
    state.plan = { ...TIER_PLAN };

    const response = await accountRoute.GET(
      get(`/api/admin/business-os/entitlements/accounts/${ACCOUNT}`),
      { params: { accountId: ACCOUNT } }
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(recordedOnATier);
  });

  it('still matches it for a tenant with NO plan row — the state the screen got most wrong', async () => {
    // 14 of 38 capabilities were reported as in force here, for an account with
    // none at all. The recording pins the corrected answer: zero.
    state.plan = null;

    const response = await accountRoute.GET(
      get(`/api/admin/business-os/entitlements/accounts/${ACCOUNT}`),
      { params: { accountId: ACCOUNT } }
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(recordedNoPlanRow);

    const granting = Object.values(
      recordedNoPlanRow.data.capabilities as Record<string, { granting: boolean }>
    ).filter((capability) => capability.granting);
    expect(granting).toHaveLength(0);
  });

  it('sends `basis` as an object, and `granting` + `display` on every capability', () => {
    // Named separately from the deep-equal, because these are the fields whose
    // shape broke the page — a failure should say which.
    expect(typeof recordedOnATier.data.basis).toBe('object');
    expect(recordedOnATier.data.basis.kind).toBeDefined();

    const capabilities = Object.values(recordedOnATier.data.capabilities) as Array<
      Record<string, unknown>
    >;
    expect(capabilities.length).toBeGreaterThan(30);
    for (const capability of capabilities) {
      expect(typeof capability.granting).toBe('boolean');
      expect(typeof capability.decidedBy).toBe('string');
      // QA-8: the human rendering, so the lookup never formats a value itself.
      expect(typeof capability.display).toBe('string');
      expect(capability.display).not.toMatch(/^\{/);
    }
  });

  it('answers a tenant check that CANNOT be answered with 500, not with a guess', async () => {
    // QA NEW-2: the read path now calls the write path's own function, so the
    // two cannot disagree about what a tenant is — including about failure.
    state.tenantCheckThrows = true;

    const response = await accountRoute.GET(
      get(`/api/admin/business-os/entitlements/accounts/${ACCOUNT}`),
      { params: { accountId: ACCOUNT } }
    );

    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({ error: 'tenant_check_failed' });
  });

  it('and a profile hit alone is enough for BOTH paths, even when onboarding errors', async () => {
    // The disagreement QA found: the private function short-circuits on a
    // profile hit, the re-implementation read both and 500'd. One function now,
    // so this account reads and writes.
    state.onboardingErrors = true;

    const read = await accountRoute.GET(
      get(`/api/admin/business-os/entitlements/accounts/${ACCOUNT}`),
      { params: { accountId: ACCOUNT } }
    );
    const write = await accountRoute.POST(
      post(`/api/admin/business-os/entitlements/accounts/${ACCOUNT}`, {
        op: 'set_cohort',
        cohort: 'trial',
        reason: 'support case',
      }),
      { params: { accountId: ACCOUNT } }
    );

    expect(read.status).toBe(200);
    expect(write.status).toBe(200);
  });

  it('L-4 (invite-only signup, Slice 1b): a plan row alone makes a tenant, on the read AND the write path', async () => {
    // An invited champion before onboarding: no profile, no onboarding message,
    // but a plan row written at redemption.
    state.isTenant = false;
    state.plan = { ...CHAMPION_PLAN };

    const read = await accountRoute.GET(
      get(`/api/admin/business-os/entitlements/accounts/${ACCOUNT}`),
      { params: { accountId: ACCOUNT } }
    );
    const write = await accountRoute.POST(
      post(`/api/admin/business-os/entitlements/accounts/${ACCOUNT}`, { op: 'set_cohort', cohort: 'trial', reason: 'support case' }),
      { params: { accountId: ACCOUNT } }
    );

    expect(read.status).toBe(200);
    expect(write.status).toBe(200);
  });

  it('404s an id that is not a Business OS account', async () => {
    // Was a 200 with a confident panel until 2026-09-24: an agent-platform-only
    // id, or a deleted account, read as a Business OS account with a plan.
    // Slice 1b (L-4): "not a tenant" now also means "no plan row".
    state.isTenant = false;
    state.plan = null;

    const response = await accountRoute.GET(
      get(`/api/admin/business-os/entitlements/accounts/${ACCOUNT}`),
      { params: { accountId: ACCOUNT } }
    );

    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ error: 'not_a_business_os_account' });
  });

  it('the write path answers the same way, so the two cannot disagree', async () => {
    state.isTenant = false;
    state.plan = null;

    const response = await accountRoute.POST(
      post(`/api/admin/business-os/entitlements/accounts/${ACCOUNT}`, {
        op: 'set_cohort',
        cohort: 'trial',
        reason: 'support case',
      }),
      { params: { accountId: ACCOUNT } }
    );

    expect(response.status).toBe(404);
  });
});

describe('slice 11b — give / take back credits through the accounts route', () => {
  const CORRELATION = 'corr-11b';
  const url = (accountId: string) => `/api/admin/business-os/entitlements/accounts/${accountId}`;
  const grantBody = { op: 'grant_credits', amount: 50, expiresAt: FAR_FUTURE, requestId: REQUEST, reason: 'goodwill' };
  const reduceBody = { op: 'reduce_credit_lot', lotId: LOT, amount: 40, requestId: REQUEST, reason: 'mistaken grant' };

  function request(accountId: string, body: unknown): NextRequest {
    return new NextRequest(new URL(url(accountId), 'http://localhost'), {
      method: 'POST',
      body: JSON.stringify(body),
      headers: { 'content-type': 'application/json', 'x-correlation-id': CORRELATION },
    });
  }

  async function call(body: unknown, accountId = ACCOUNT) {
    const req = request(accountId, body);
    const response = await accountRoute.POST(req, { params: { accountId } });
    return { response, req, json: await response.json() };
  }

  let invalidate: jest.SpyInstance;
  const originalSystemId = process.env.SYSTEM_ADMIN_USER_ID;

  beforeEach(() => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { getEntitlementService } = require('@/lib/business-os/entitlements/EntitlementService');
    invalidate = jest.spyOn(getEntitlementService(), 'invalidate');
  });

  afterEach(() => {
    invalidate.mockRestore();
    if (originalSystemId === undefined) delete process.env.SYSTEM_ADMIN_USER_ID;
    else process.env.SYSTEM_ADMIN_USER_ID = originalSystemId;
  });

  it('grant: 200, one audit entry naming the lot, flushed before the response, cache untouched (G11b-7)', async () => {
    const { response, req, json } = await call(grantBody);

    expect(response.status).toBe(200);
    expect(json).toEqual({
      success: true,
      data: { accountId: ACCOUNT, op: 'grant_credits', lotId: NEW_LOT, credits: 50, expiresAt: FAR_FUTURE, replayed: false },
    });
    expect(state.audit).toEqual([
      {
        action: 'BOS_CREDIT_LOT_GRANTED',
        entityType: 'business_os_credit_lot',
        entityId: NEW_LOT,
        userId: ACCOUNT,
        actorId: ADMIN,
        changes: { extraCreditsBefore: 113.75, extraCreditsAfter: 163.75 },
        details: {
          reason: 'goodwill',
          op: 'grant_credits',
          correlationId: CORRELATION,
          lotId: NEW_LOT,
          credits: 50,
          expiresAt: FAR_FUTURE,
          replayed: false,
          source: 'admin_grant',
          idempotencyKey: `admin_grant:${REQUEST}`,
          extraCreditsBasis: 'read_before_write',
        },
        severity: 'warning',
        request: req,
      },
    ]);
    expect(state.events).toEqual(['log', 'flush']);
    expect(invalidate).not.toHaveBeenCalled();
  });

  it('reduce: 200, one audit entry with the function\'s lot figures, cache untouched', async () => {
    const { response, req, json } = await call(reduceBody);

    expect(response.status).toBe(200);
    expect(json).toEqual({
      success: true,
      data: { accountId: ACCOUNT, op: 'reduce_credit_lot', lotId: LOT, drawId: DRAW, credits: 40, lotRemainingAfter: 60, replayed: false },
    });
    expect(state.audit).toEqual([
      {
        action: 'BOS_CREDIT_LOT_REDUCED',
        entityType: 'business_os_credit_lot',
        entityId: LOT,
        userId: ACCOUNT,
        actorId: ADMIN,
        changes: { extraCreditsBefore: 113.75, extraCreditsAfter: 73.75, lotRemainingBefore: 100, lotRemainingAfter: 60 },
        details: {
          reason: 'mistaken grant',
          op: 'reduce_credit_lot',
          correlationId: CORRELATION,
          lotId: LOT,
          drawId: DRAW,
          credits: 40,
          lotRemainingAfter: 60,
          replayed: false,
          source: 'admin_grant',
          idempotencyKey: `admin_reversal:${REQUEST}`,
          extraCreditsBasis: 'read_before_write',
        },
        severity: 'warning',
        request: req,
      },
    ]);
    expect(state.events).toEqual(['log', 'flush']);
    expect(invalidate).not.toHaveBeenCalled();
  });

  it('grant replay: 200, replayed true, the STORED figures, no audit entry and no flush (S11-CR-2, CR11a-4)', async () => {
    credit.record = { outcome: 'replayed', lotId: NEW_LOT };
    credit.stored = { ...creditLotRow({ id: NEW_LOT, creditsGranted: 25, expiresAt: '2098-01-01T00:00:00.000Z' }), draws: undefined };

    const { response, json } = await call({ ...grantBody, amount: 50 });

    expect(response.status).toBe(200);
    expect(json).toEqual({
      success: true,
      data: { accountId: ACCOUNT, op: 'grant_credits', lotId: NEW_LOT, credits: 25, expiresAt: '2098-01-01T00:00:00.000Z', replayed: true },
    });
    expect(state.audit).toEqual([]);
    expect(state.events).toEqual([]);
    expect(invalidate).not.toHaveBeenCalled();
  });

  it('reduce replay: 200, replayed true, the RETURNED credits, no audit entry and no flush (QA11a-2)', async () => {
    credit.reverse = { status: 'already_recorded', drawId: DRAW, credits: 30, remainingBefore: 70, remainingAfter: 70 };

    const { response, json } = await call({ ...reduceBody, amount: 40 });

    expect(response.status).toBe(200);
    expect(json).toEqual({
      success: true,
      data: { accountId: ACCOUNT, op: 'reduce_credit_lot', lotId: LOT, drawId: DRAW, credits: 30, lotRemainingAfter: 70, replayed: true },
    });
    expect(state.audit).toEqual([]);
    expect(state.events).toEqual([]);
    expect(invalidate).not.toHaveBeenCalled();
  });

  it('an existing op still invalidates the cache (G11b-7, the control)', async () => {
    await call({ op: 'set_cohort', cohort: 'trial', reason: 'support case' });
    expect(invalidate).toHaveBeenCalledWith(ACCOUNT);
  });

  it('W11b-1: an UPPER-case path id on an existing op is handled as its lower-case form (audit ids and the cache key)', async () => {
    expect(HEX_ACCOUNT.toUpperCase()).not.toBe(HEX_ACCOUNT);
    const { response } = await call({ op: 'set_cohort', cohort: 'trial', reason: 'support case' }, HEX_ACCOUNT.toUpperCase());

    expect(response.status).toBe(200);
    expect(state.audit).toHaveLength(1);
    expect(state.audit[0]).toMatchObject({ entityId: HEX_ACCOUNT, userId: HEX_ACCOUNT });
    expect(invalidate).toHaveBeenCalledWith(HEX_ACCOUNT);
    expect(invalidate).not.toHaveBeenCalledWith(HEX_ACCOUNT.toUpperCase());
  });

  it('W11b-1: the GET answers with the lower-case id too', async () => {
    const response = await accountRoute.GET(get(url(HEX_ACCOUNT.toUpperCase())), { params: { accountId: HEX_ACCOUNT.toUpperCase() } });
    expect(response.status).toBe(200);
    expect((await response.json()).data.accountId).toBe(HEX_ACCOUNT);
  });

  it.each([
    ['grant_credits', HEX_ADMIN],
    ['grant_credits', HEX_ADMIN.toUpperCase()],
    ['set_cohort', HEX_ADMIN],
    ['set_cohort', HEX_ADMIN.toUpperCase()],
  ])('own account (%s, path %s): 403 own_account, no repository call at all, no audit', async (op, path) => {
    state.user = { id: HEX_ADMIN, email: 'admin@example.com' };
    const body = op === 'grant_credits' ? grantBody : { op: 'set_cohort', cohort: 'trial', reason: 'support case' };
    const { response, json } = await call(body, path);

    expect(response.status).toBe(403);
    expect(json).toMatchObject({ success: false, error: 'own_account' });
    expect(repositoryCalls).toEqual([]);
    expect(state.audit).toEqual([]);
  });

  it.each([
    ['an invalid amount', { ...grantBody, amount: 0 }],
    ['an injected accountId', { ...grantBody, accountId: '12121212-1212-4212-8212-121212121212' }],
    ['an injected userId', { ...reduceBody, userId: '12121212-1212-4212-8212-121212121212' }],
    ['a missing expiresAt key', { op: 'grant_credits', amount: 50, requestId: REQUEST, reason: 'goodwill' }],
  ])('400 invalid_body for %s, nothing read', async (_name, body) => {
    const { response, json } = await call(body);
    expect(response.status).toBe(400);
    expect(json).toMatchObject({ success: false, error: 'invalid_body' });
    expect(repositoryCalls).toEqual([]);
  });

  it('400 invalid_account_id for a malformed path id on a credit op', async () => {
    const response = await accountRoute.POST(post(url('nope'), grantBody), { params: { accountId: 'nope' } });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: 'invalid_account_id' });
    expect(repositoryCalls).toEqual([]);
  });

  it('404 for a lot of another account, and reverseLot is never called (tenant-isolation-guard Step 7)', async () => {
    const { response, json } = await call({ ...reduceBody, lotId: FOREIGN_LOT });
    expect(response.status).toBe(404);
    expect(json).toMatchObject({ error: 'lot_not_found' });
    expect(repositoryCalls).not.toContain('reverseLot');
  });

  it('a real lot sent UPPER-cased proceeds (W11b-2)', async () => {
    expect(LOT.toUpperCase()).not.toBe(LOT);
    const { response } = await call({ ...reduceBody, lotId: LOT.toUpperCase() });
    expect(response.status).toBe(200);
    expect(repositoryCalls).toContain('reverseLot');
  });

  it('409 exceeds_remaining carries the remaining read before the attempt, with its basis (W11b-10)', async () => {
    credit.reverse = { status: 'exceeds_remaining', drawId: null, credits: null, remainingBefore: null, remainingAfter: null };
    const { response, json } = await call({ ...reduceBody, amount: 500 });
    expect(response.status).toBe(409);
    expect(json).toEqual({ success: false, error: 'exceeds_remaining', details: { remaining: 100, remainingBasis: 'read_before_write' } });
  });

  /**
   * W11b-6: every refusal code of §11b.3.2 and §11b.3.6 writes nothing that
   * the route controls (no audit, no flush, no invalidation) and no plan
   * write. A pre-write refusal calls no write method at all; a refusal mapped
   * from a lot function's own answer called exactly that one function once,
   * and the function's contract is that every status but `recorded` wrote
   * nothing.
   */
  type Case = [string, number, () => { body: unknown; path?: string }, 'recordLot' | 'reverseLot' | null];
  const REFUSALS: Case[] = [
    ['invalid_body', 400, () => ({ body: { ...grantBody, amount: -1 } }), null],
    ['own_account', 403, () => ({ body: grantBody, path: ADMIN }), null],
    [
      'platform_account',
      409,
      () => {
        process.env.SYSTEM_ADMIN_USER_ID = PLATFORM;
        return { body: grantBody, path: PLATFORM };
      },
      null,
    ],
    [
      'not_a_business_os_account',
      404,
      () => {
        state.isTenant = false;
        state.plan = null;
        return { body: grantBody };
      },
      null,
    ],
    [
      'tenant_check_failed',
      500,
      () => {
        state.tenantCheckThrows = true;
        return { body: reduceBody };
      },
      null,
    ],
    [
      'plan_row_missing',
      409,
      () => {
        state.plan = null;
        return { body: reduceBody };
      },
      null,
    ],
    [
      'awaiting_payment',
      409,
      () => {
        credit.hold = 'held';
        return { body: grantBody };
      },
      null,
    ],
    [
      'payment_hold_check_failed',
      500,
      () => {
        credit.hold = 'error';
        return { body: grantBody };
      },
      null,
    ],
    [
      'payment_hold_check_failed (reader throws)',
      500,
      () => {
        credit.hold = 'throws';
        return { body: grantBody };
      },
      null,
    ],
    ['expires_at_in_past', 400, () => ({ body: { ...grantBody, expiresAt: '2020-01-01T00:00:00.000Z' } }), null],
    [
      'credit_lots_unreadable',
      500,
      () => {
        credit.listError = true;
        return { body: grantBody };
      },
      null,
    ],
    ['lot_not_found', 404, () => ({ body: { ...reduceBody, lotId: FOREIGN_LOT } }), null],
    ['paid_credits_locked', 409, () => ({ body: { ...reduceBody, lotId: BOOST_LOT } }), null],
    [
      'idempotency_key_conflict (grant)',
      409,
      () => {
        credit.record = { outcome: 'idempotency_key_conflict' };
        return { body: grantBody };
      },
      'recordLot',
    ],
    [
      'lot_write_failed (grant)',
      500,
      () => {
        credit.record = 'error';
        return { body: grantBody };
      },
      'recordLot',
    ],
    [
      'lot_read_failed (grant replay read-back)',
      500,
      () => {
        credit.record = { outcome: 'replayed', lotId: NEW_LOT };
        credit.stored = null;
        return { body: grantBody };
      },
      'recordLot',
    ],
    ...(['lot_not_found', 'lot_expired', 'nothing_left', 'exceeds_remaining', 'idempotency_key_conflict'] as const).map(
      (status): Case => [
        `${status} (from the reversal function)`,
        status === 'lot_not_found' ? 404 : 409,
        () => {
          credit.reverse = { status, drawId: null, credits: null, remainingBefore: null, remainingAfter: null };
          return { body: reduceBody };
        },
        'reverseLot',
      ]
    ),
    [
      'lot_write_failed (reduce)',
      500,
      () => {
        credit.reverse = 'error';
        return { body: reduceBody };
      },
      'reverseLot',
    ],
  ];

  it.each(REFUSALS)('refusal %s (%d): no audit, no flush, no invalidation, no write it did not have to attempt', async (name, status, setup, attempted) => {
    const { body, path } = setup();
    const { response, json } = await call(body, path ?? ACCOUNT);

    expect(response.status).toBe(status);
    expect(json.success).toBe(false);
    expect(json.error).toBe(name.split(' ')[0]);
    expect(state.audit).toEqual([]);
    expect(state.flushes).toBe(0);
    expect(invalidate).not.toHaveBeenCalled();

    const writes = repositoryCalls.filter((method) => WRITE_METHODS.includes(method));
    expect(writes).toEqual(attempted ? [attempted] : []);
    if (name === 'own_account') expect(repositoryCalls).toEqual([]);
  });
});

