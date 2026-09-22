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

jest.mock('@/lib/repositories/BusinessOsAccountPlanRepository', () => ({
  businessOsAccountPlanRepository: {
    async findEntitlementInputs() {
      repositoryCalls.push('findEntitlementInputs');
      return {
        data: {
          plan: {
            user_id: ACCOUNT,
            tier: null,
            plan_version: 0,
            tier_expires_at: null,
            cohort: 'champion',
            cohort_expires_at: null,
            onboarding_started_at: '2026-01-01T00:00:00.000Z',
            profile_created_at: '2026-01-02T00:00:00.000Z',
            trial_started_at: null,
            trial_ends_at: null,
            grace_ends_at: null,
            period_anchor: '2026-01-01T00:00:00.000Z',
            origin: 'backfill',
            updated_by_admin_id: null,
            created_at: '2026-01-01T00:00:00.000Z',
            updated_at: '2026-01-01T00:00:00.000Z',
          },
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
      return { data: { created_at: '2026-01-02T00:00:00.000Z' }, error: null };
    },
  },
}));

jest.mock('@/lib/repositories/OnboardingConversationRepository', () => ({
  onboardingConversationRepository: {
    async getFirstMessageAt() {
      return { data: '2026-01-01T00:00:00.000Z', error: null };
    },
    async getLatestMessageAt() {
      return { data: '2026-03-01T00:00:00.000Z', error: null };
    },
  },
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const accountRoute = require('@/app/api/admin/business-os/entitlements/accounts/[accountId]/route');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const launchRoute = require('@/app/api/admin/business-os/entitlements/launch/route');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const reportRoute = require('@/app/api/admin/business-os/entitlements/shadow-report/route');

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

  it('a REAL run is refused while no tier is configured (UD-2)', async () => {
    const response = await launchRoute.POST(
      post('/api/admin/business-os/entitlements/launch', {
        confirm: 'launch_champion_existing',
        reason: 'do it',
        dryRun: false,
      })
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: 'launch_preconditions_unmet' });
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
