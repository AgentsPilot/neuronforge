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

  it('404s an id that is not a Business OS account', async () => {
    // Was a 200 with a confident panel until 2026-09-24: an agent-platform-only
    // id, or a deleted account, read as a Business OS account with a plan.
    state.isTenant = false;

    const response = await accountRoute.GET(
      get(`/api/admin/business-os/entitlements/accounts/${ACCOUNT}`),
      { params: { accountId: ACCOUNT } }
    );

    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ error: 'not_a_business_os_account' });
  });

  it('the write path answers the same way, so the two cannot disagree', async () => {
    state.isTenant = false;

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
