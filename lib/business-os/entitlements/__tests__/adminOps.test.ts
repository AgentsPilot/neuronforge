/**
 * The admin operations: validation, pre-checks, and every refusal.
 *
 * These are the rules that stop an admin producing a state the resolver cannot
 * explain — an account with no basis, an override that grants something that
 * does not exist, a champion with no answer to "until when?". Each one is
 * tested at its refusal AND at the case just past it, so "refuses everything"
 * would not pass.
 */

import { AUDIT_EVENTS } from '@/lib/audit/events';
import {
  OWN_ACCOUNT_GUARDED_OPS,
  adminOpSchema,
  executeAdminOp,
  isBusinessOsTenant,
} from '@/lib/business-os/entitlements/adminOps';
import type { AdminOp, AdminOpContext } from '@/lib/business-os/entitlements/adminOps';
import { currentCreditValue } from '@/lib/business-os/entitlements/config/creditValue';
import { fixtureConfig } from '@/lib/business-os/entitlements/__fixtures__/fixtureSource';
import { readCodeConfig } from '@/lib/business-os/entitlements/source';
import type { EntitlementConfig } from '@/lib/business-os/entitlements/source';
import type {
  BusinessOsAccountPlan,
  BusinessOsEntitlementOverride,
} from '@/lib/repositories/BusinessOsAccountPlanRepository';

const ACCOUNT = '11111111-1111-4111-8111-111111111111';
const ADMIN = '22222222-2222-4222-8222-222222222222';
const NOW = new Date('2026-09-22T00:00:00.000Z');

function planRow(overrides: Partial<BusinessOsAccountPlan> = {}): BusinessOsAccountPlan {
  return {
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
    ...overrides,
  };
}

function override(o: Partial<BusinessOsEntitlementOverride> = {}): BusinessOsEntitlementOverride {
  return {
    id: '33333333-3333-4333-8333-333333333333',
    user_id: ACCOUNT,
    capability: 'chat.search',
    op: 'set',
    value: true,
    reason: 'design partner',
    expires_at: null,
    actor_admin_id: ADMIN,
    created_at: '2026-02-01T00:00:00.000Z',
    ended_at: null,
    ended_by_admin_id: null,
    ended_reason: null,
    ...o,
  };
}

interface Calls {
  updatePlan: Array<Record<string, unknown>>;
  ensurePlanRow: Array<Record<string, unknown>>;
  createOverride: Array<Record<string, unknown>>;
  endOverride: unknown[][];
  resetPlanState: Array<Record<string, unknown>>;
  /** Slice 11b: the credit ops' writes. */
  recordLot: Array<Record<string, unknown>>;
  reverseLot: Array<Record<string, unknown>>;
  /** Slice 11b: EVERY repository method called, read or write, in order. */
  all: string[];
}

/** Slice 11b: a lot of the test account, as the lot repository returns it. */
const LOT_ID = '77777777-7777-4777-8777-777777777777';
/** An admin id with hex letters, for the upper-case cases (OP-15). */
const HEX_ADMIN = 'fedcba98-7654-4321-8fed-cba987654321';
const REQUEST_ID = '88888888-8888-4888-8888-888888888888';
function creditLot() {
  return {
    id: LOT_ID,
    accountId: ACCOUNT,
    source: 'admin_grant' as const,
    creditsGranted: 100,
    creditsBase: 100,
    creditsBonus: 0,
    creditValueVersion: 1,
    expiresAt: null,
    idempotencyKey: `admin_grant:${REQUEST_ID}`,
    sourceRef: null,
    actorKind: 'admin' as const,
    actorAdminId: ADMIN,
    reason: 'earlier grant',
    createdAt: '2026-09-01T00:00:00.000Z',
    draws: [],
  };
}

function context(options: {
  plan?: BusinessOsAccountPlan | null;
  overrides?: BusinessOsEntitlementOverride[];
  isTenant?: boolean;
  config?: EntitlementConfig;
  /** P-3b.1 (PF-13): the billing reader's answer. `null` = could not tell. Default: no subscription. */
  subscribed?: boolean | null;
} = {}): { ctx: AdminOpContext; calls: Calls } {
  const plan = options.plan === undefined ? planRow() : options.plan;
  const calls: Calls = {
    updatePlan: [],
    ensurePlanRow: [],
    createOverride: [],
    endOverride: [],
    resetPlanState: [],
    recordLot: [],
    reverseLot: [],
    all: [],
  };
  const isTenant = options.isTenant !== false;

  const ctx: AdminOpContext = {
    accountId: ACCOUNT,
    adminId: ADMIN,
    config: options.config ?? fixtureConfig(),
    now: NOW,
    planRepository: {
      async findEntitlementInputs() {
        return { data: { plan, overrides: options.overrides ?? [] }, error: null };
      },
      async ensurePlanRow(input: Record<string, unknown>) {
        calls.ensurePlanRow.push(input);
        return { data: { created: true, plan: planRow({ cohort: input.cohort as string }) }, error: null };
      },
      async updatePlan(_accountId: string, patch: Record<string, unknown>) {
        calls.updatePlan.push(patch);
        return { data: { ...planRow(), ...patch } as BusinessOsAccountPlan, error: null };
      },
      async createOverride(input: Record<string, unknown>) {
        calls.createOverride.push(input);
        return { data: override({ capability: input.capability as string }), error: null };
      },
      async endOverride(...args: unknown[]) {
        calls.endOverride.push(args);
        return { data: override({ ended_at: NOW.toISOString() }), error: null };
      },
      async findOverrideById() {
        return { data: override(), error: null };
      },
      async resetPlanState(input: Record<string, unknown>) {
        calls.resetPlanState.push(input);
        return { data: planRow({ cohort: input.cohort as string, tier: null }), error: null };
      },
    } as unknown as AdminOpContext['planRepository'],
    profileRepository: {
      async findByUserId() {
        return { data: isTenant ? ({ created_at: '2026-01-02T00:00:00.000Z' } as never) : null, error: null };
      },
    } as unknown as AdminOpContext['profileRepository'],
    onboardingRepository: {
      async getFirstMessageAt() {
        return { data: '2026-01-01T00:00:00.000Z', error: null };
      },
      async getLatestMessageAt() {
        return { data: isTenant ? '2026-03-01T00:00:00.000Z' : null, error: null };
      },
    } as unknown as AdminOpContext['onboardingRepository'],
    // Slice 11b: the credit ops' dependencies.
    credit: {
      lotRepository: {
        async listLotsWithDraws() {
          return { data: [creditLot()], error: null };
        },
        async findLotForAccount() {
          const { draws: _draws, ...lot } = creditLot();
          void _draws;
          return { data: lot, error: null };
        },
        async recordLot(input: Record<string, unknown>) {
          calls.recordLot.push(input);
          return { data: { outcome: 'recorded', lotId: '99999999-9999-4999-8999-999999999999' }, error: null };
        },
        async reverseLot(input: Record<string, unknown>) {
          calls.reverseLot.push(input);
          return { data: { status: 'recorded', drawId: '12121212-1212-4212-8212-121212121212', credits: 40, remainingBefore: 100, remainingAfter: 60 }, error: null };
        },
      } as unknown as AdminOpContext['credit']['lotRepository'],
      holdReaders: {
        lineage: {
          async findHoldFactsForAccount() {
            return { data: null, error: null };
          },
        },
        invites: {
          async findHoldFactsById() {
            return { data: null, error: null };
          },
        },
      } as unknown as AdminOpContext['credit']['holdReaders'],
    },
    // P-3b.1 (PF-13): the plan subscription reader.
    billing: {
      async hasLivePlanSubscription() {
        return options.subscribed === undefined ? false : options.subscribed;
      },
    },
  };

  // Record every repository method called, read or write (slice 11b: the
  // own-account refusal must come before ANY of them).
  const record = (repository: object, prefix: string) => {
    const target = repository as Record<string, unknown>;
    for (const key of Object.keys(target)) {
      const original = target[key];
      if (typeof original !== 'function') continue;
      target[key] = (...args: unknown[]) => {
        calls.all.push(`${prefix}.${key}`);
        return (original as (...a: unknown[]) => unknown)(...args);
      };
    }
  };
  record(ctx.planRepository, 'plan');
  record(ctx.profileRepository, 'profile');
  record(ctx.onboardingRepository, 'onboarding');
  record(ctx.credit.lotRepository, 'lots');
  record(ctx.credit.holdReaders.lineage, 'lineage');
  record(ctx.credit.holdReaders.invites, 'invites');
  record(ctx.billing, 'billing');

  return { ctx, calls };
}

/** Slice 11b: one valid body per op of the union (nine), for the per-op cases. */
const ONE_OF_EACH: Array<[string, AdminOp, Parameters<typeof context>[0]]> = [
  ['ensure_plan_row', { op: 'ensure_plan_row', cohort: 'champion', expiresAt: null, reason: 'trigger failed' } as AdminOp, { plan: null }],
  ['set_cohort', { op: 'set_cohort', cohort: 'trial', reason: 'support case' } as AdminOp, {}],
  ['set_expiry', { op: 'set_expiry', field: 'grace_ends_at', value: null, reason: 'support case' } as AdminOp, {}],
  ['assign_tier', { op: 'assign_tier', tier: 'growth', expiresAt: null, reason: 'support case' } as AdminOp, {}],
  ['add_override', { op: 'add_override', capability: 'chat.search', overrideOp: 'set', value: true, reason: 'support case' } as AdminOp, {}],
  ['end_override', { op: 'end_override', overrideId: '33333333-3333-4333-8333-333333333333', reason: 'support case' } as AdminOp, { overrides: [] }],
  [
    'reset_plan_state',
    { op: 'reset_plan_state', confirm: 'reset_plan_state', accountId: ACCOUNT, cohort: 'champion', expiresAt: null, reason: 'support case' } as AdminOp,
    {},
  ],
  ['grant_credits', { op: 'grant_credits', amount: 50, expiresAt: null, requestId: REQUEST_ID, reason: 'goodwill' } as AdminOp, {}],
  ['reduce_credit_lot', { op: 'reduce_credit_lot', lotId: LOT_ID, amount: 40, requestId: REQUEST_ID, reason: 'mistaken grant' } as AdminOp, {}],
];

const parse = (body: unknown, config: EntitlementConfig = fixtureConfig()) => adminOpSchema(config).safeParse(body);

describe('every audit action the executor can emit is registered (SA C5-2 / QA-2)', () => {
  // The route writes `AUDIT_EVENTS[outcome.action] ?? outcome.action`. The
  // fallback exists so an unregistered action still produces an audit row
  // rather than `undefined` — but nothing asserted it could never fire, and an
  // action that only exists as a string literal is one rename away from
  // writing a row nobody can query by name.
  //
  // Two legs, because neither alone is enough: the SOURCE sweep covers branches
  // this suite does not execute, and the EXECUTED leg proves the sweep is
  // looking at the right thing.

  it('source sweep: every `action:` literal in adminOps.ts is an AUDIT_EVENTS key', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { readFileSync } = require('fs');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { join } = require('path');
    const source: string = readFileSync(
      join(process.cwd(), 'lib', 'business-os', 'entitlements', 'adminOps.ts'),
      'utf8'
    );

    // Every event-name literal, not just the ones spelled `action:` — three of
    // them reach `writePatch` as its last argument, and a sweep that missed
    // those would have been the vacuous version of this test.
    const actions = [...source.matchAll(/'(BOS_ENTITLEMENT_[A-Z0-9_]+)'/g)].map((match) => match[1]);

    // Non-vacuity: a regex that matched nothing would pass the assertion below.
    // Seven op outcomes; `ensure_plan_row` emits its name from two branches.
    expect(new Set(actions).size).toBe(7);
    expect(actions.filter((action) => !(action in AUDIT_EVENTS))).toEqual([]);
  });

  it('source sweep, slice 11b: every action literal in creditAdminOps.ts is an AUDIT_EVENTS key', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { readFileSync } = require('fs');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { join } = require('path');
    const source: string = readFileSync(
      join(process.cwd(), 'lib', 'business-os', 'credits', 'creditAdminOps.ts'),
      'utf8'
    );
    const actions = [...source.matchAll(/'(BOS_CREDIT_LOT_[A-Z0-9_]+)'/g)].map((match) => match[1]);

    // Non-vacuity: the two credit op outcomes.
    expect(new Set(actions).size).toBe(2);
    expect(actions.filter((action) => !(action in AUDIT_EVENTS))).toEqual([]);
  });

  it('executed: the action every successful op returns is registered', async () => {
    const cases: Array<[string, AdminOp, Parameters<typeof context>[0]]> = [
      ['ensure_plan_row', { op: 'ensure_plan_row', cohort: 'champion', expiresAt: null, reason: 'trigger failed' } as AdminOp, { plan: null }],
      ['set_cohort', { op: 'set_cohort', cohort: 'trial', reason: 'support case' } as AdminOp, {}],
      ['set_expiry', { op: 'set_expiry', field: 'grace_ends_at', value: null, reason: 'support case' } as AdminOp, {}],
      ['assign_tier', { op: 'assign_tier', tier: 'growth', expiresAt: null, reason: 'support case' } as AdminOp, {}],
      ['add_override', { op: 'add_override', capability: 'chat.search', overrideOp: 'set', value: true, reason: 'support case' } as AdminOp, {}],
      ['end_override', { op: 'end_override', overrideId: override().id, reason: 'support case' } as AdminOp, { overrides: [override()] }],
      [
        'reset_plan_state',
        { op: 'reset_plan_state', confirm: 'reset_plan_state', accountId: ACCOUNT, cohort: 'champion', expiresAt: null, reason: 'support case' } as AdminOp,
        {},
      ],
      // Slice 11b: the two credit ops.
      ['grant_credits', { op: 'grant_credits', amount: 50, expiresAt: null, requestId: REQUEST_ID, reason: 'goodwill' } as AdminOp, {}],
      ['reduce_credit_lot', { op: 'reduce_credit_lot', lotId: LOT_ID, amount: 40, requestId: REQUEST_ID, reason: 'mistaken grant' } as AdminOp, {}],
    ];

    // Every variant of the union is covered, so a new op cannot be added
    // without either appearing here or failing the count.
    expect(cases).toHaveLength(9);
    expect(cases).toHaveLength(adminOpSchema(fixtureConfig()).options.length);

    for (const [name, op, options] of cases) {
      const { ctx } = context(options);
      const result = await executeAdminOp(op, ctx);

      expect(result.ok).toBe(true);
      const action = (result as { action: string }).action;
      expect({ name, registered: action in AUDIT_EVENTS }).toEqual({ name, registered: true });
    }
  });
});

describe('the body schema', () => {
  it('refuses an unknown key rather than dropping it', () => {
    const result = parse({ op: 'set_cohort', cohort: 'trial', reason: 'because', sneaky: true });
    expect(result.success).toBe(false);
  });

  it('requires a reason of real length, on every op', () => {
    // Caught by this suite's own first draft: `reason: 'x'` is INVALID, and a
    // test that used it would have asserted "refuses an unknown tier" while
    // really only asserting "refuses a one-character reason".
    expect(parse({ op: 'set_cohort', cohort: 'trial', reason: 'x' }).success).toBe(false);
    expect(parse({ op: 'set_cohort', cohort: 'trial', reason: 'support case' }).success).toBe(true);

    for (const body of [
      { op: 'set_cohort', cohort: 'trial' },
      { op: 'assign_tier', tier: null, expiresAt: null },
      { op: 'end_override', overrideId: '33333333-3333-4333-8333-333333333333' },
    ]) {
      expect(parse(body).success).toBe(false);
    }
  });

  it('A-1: assign_tier needs the expiresAt KEY, even to say null', () => {
    expect(parse({ op: 'assign_tier', tier: 'growth', reason: 'upgrade' }).success).toBe(false);
    expect(parse({ op: 'assign_tier', tier: 'growth', expiresAt: null, reason: 'upgrade' }).success).toBe(true);
  });

  it('Q-13: refuses a tier the config does not have', () => {
    expect(parse({ op: 'assign_tier', tier: 'platinum', expiresAt: null, reason: 'support case' }).success).toBe(false);
    expect(parse({ op: 'assign_tier', tier: 'growth', expiresAt: null, reason: 'support case' }).success).toBe(true);
  });

  it('Q-13: refuses a capability the catalog does not have', () => {
    expect(parse({ op: 'add_override', capability: 'chat.telepathy', overrideOp: 'set', value: true, reason: 'support case' }).success).toBe(false);
  });

  it('R2-2: ensure_plan_row has no default cohort', () => {
    expect(parse({ op: 'ensure_plan_row', reason: 'trigger failed' }).success).toBe(false);
    expect(parse({ op: 'ensure_plan_row', cohort: 'champion', expiresAt: null, reason: 'trigger failed' }).success).toBe(true);
  });
});

describe('RC-10 / Q-15 — the pre-checks before any write', () => {
  it('404s for someone who is not a Business OS tenant', async () => {
    const { ctx, calls } = context({ isTenant: false, plan: null });
    const result = await executeAdminOp({ op: 'set_cohort', cohort: 'trial', reason: 'support case' } as AdminOp, ctx);

    expect(result).toMatchObject({ ok: false, status: 404, error: 'not_a_business_os_account' });
    expect(calls.updatePlan).toEqual([]);
  });

  it('L-4 (invite-only signup, Slice 1b): a plan row alone makes a tenant, so an invited champion can be managed before onboarding', async () => {
    const { ctx, calls } = context({ isTenant: false });
    const result = await executeAdminOp({ op: 'set_cohort', cohort: 'trial', reason: 'support case' } as AdminOp, ctx);

    expect(result).toMatchObject({ ok: true });
    expect(calls.updatePlan).toHaveLength(1);
  });

  it('L-4: the plan row is read only when neither a profile nor an onboarding message answers', async () => {
    const reads: string[] = [];
    const planRepository = {
      async findEntitlementInputs() {
        reads.push('plan');
        return { data: { plan: null, overrides: [] }, error: null };
      },
    };
    const profile = { async findByUserId() { return { data: { id: 'p' } as never, error: null }; } };
    const noProfile = { async findByUserId() { return { data: null, error: null }; } };
    const onboarding = (latest: string | null) => ({
      async getFirstMessageAt() { return { data: null, error: null }; },
      async getLatestMessageAt() { return { data: latest, error: null }; },
    });

    await expect(
      isBusinessOsTenant({ accountId: ACCOUNT, profileRepository: profile as never, onboardingRepository: onboarding(null) as never, planRepository: planRepository as never })
    ).resolves.toBe(true);
    await expect(
      isBusinessOsTenant({ accountId: ACCOUNT, profileRepository: noProfile as never, onboardingRepository: onboarding('2026-03-01T00:00:00.000Z') as never, planRepository: planRepository as never })
    ).resolves.toBe(true);
    expect(reads).toEqual([]);

    await expect(
      isBusinessOsTenant({ accountId: ACCOUNT, profileRepository: noProfile as never, onboardingRepository: onboarding(null) as never, planRepository: planRepository as never })
    ).resolves.toBe(false);
    expect(reads).toEqual(['plan']);
  });

  it('L-4: a failed plan read is "could not answer" (null), never "not a tenant"', async () => {
    const failing = { async findEntitlementInputs() { return { data: null, error: new Error('timeout') }; } };
    const noProfile = { async findByUserId() { return { data: null, error: null }; } };
    const noOnboarding = { async getLatestMessageAt() { return { data: null, error: null }; } };
    await expect(
      isBusinessOsTenant({ accountId: ACCOUNT, profileRepository: noProfile as never, onboardingRepository: noOnboarding as never, planRepository: failing as never })
    ).resolves.toBeNull();
  });

  it('409s when the account has no plan row, rather than reporting success', async () => {
    // `updatePlan` returns `{ data: null, error: null }` for "no row matched",
    // which is indistinguishable from success at the call site.
    const { ctx, calls } = context({ plan: null });
    const result = await executeAdminOp({ op: 'set_cohort', cohort: 'trial', reason: 'support case' } as AdminOp, ctx);

    expect(result).toMatchObject({ ok: false, status: 409, error: 'plan_row_missing' });
    expect(calls.updatePlan).toEqual([]);
  });
});

describe('ensure_plan_row (R2-2)', () => {
  it('creates the row with the explicit cohort and the tenant\'s own facts', async () => {
    const { ctx, calls } = context({ plan: null });
    const result = await executeAdminOp(
      { op: 'ensure_plan_row', cohort: 'champion', expiresAt: null, reason: 'trigger failed' } as AdminOp,
      ctx
    );

    expect(result).toMatchObject({ ok: true, data: { created: true } });
    expect(calls.ensurePlanRow[0]).toMatchObject({
      cohort: 'champion',
      cohortExpiresAt: null,
      onboardingStartedAt: '2026-01-01T00:00:00.000Z',
      profileCreatedAt: '2026-01-02T00:00:00.000Z',
    });
  });

  it('is idempotent: an existing row is a no-op, not an error', async () => {
    const { ctx, calls } = context();
    const result = await executeAdminOp(
      { op: 'ensure_plan_row', cohort: 'champion', expiresAt: null, reason: 'again' } as AdminOp,
      ctx
    );

    expect(result).toMatchObject({ ok: true, data: { created: false } });
    expect(calls.ensurePlanRow).toEqual([]);
  });

  it('RC-4: a champion must answer "until when?", even to say never', async () => {
    const { ctx } = context({ plan: null });
    const result = await executeAdminOp({ op: 'ensure_plan_row', cohort: 'champion', reason: 'support case' } as AdminOp, ctx);

    expect(result).toMatchObject({ ok: false, status: 400, error: 'expires_at_required_for_champion' });
  });
});

describe('set_cohort', () => {
  it('sets a champion with an explicit end date', async () => {
    const { ctx, calls } = context();
    const result = await executeAdminOp(
      { op: 'set_cohort', cohort: 'champion', expiresAt: '2027-01-01T00:00:00.000Z', reason: 'partner' } as AdminOp,
      ctx
    );

    expect(result).toMatchObject({ ok: true, action: 'BOS_ENTITLEMENT_COHORT_SET' });
    expect(calls.updatePlan[0]).toMatchObject({ cohort: 'champion', cohort_expires_at: '2027-01-01T00:00:00.000Z' });
  });

  it('starts the trial clock when the cohort becomes a trial', async () => {
    const { ctx, calls } = context();
    await executeAdminOp({ op: 'set_cohort', cohort: 'trial', reason: 'restart' } as AdminOp, ctx);

    expect(calls.updatePlan[0]).toMatchObject({ cohort: 'trial', trial_started_at: NOW.toISOString() });
  });

  it('R2-3: refuses to clear the cohort when there is no tier to fall back on', async () => {
    const { ctx, calls } = context({ plan: planRow({ tier: null, cohort: 'champion' }) });
    const result = await executeAdminOp({ op: 'set_cohort', cohort: null, reason: 'cleanup' } as AdminOp, ctx);

    expect(result).toMatchObject({ ok: false, status: 409, error: 'would_leave_no_basis' });
    expect(calls.updatePlan).toEqual([]);
  });

  it('…and allows it when an in-force tier remains', async () => {
    // The control: the rule is about the RESULTING state, not about the op.
    const { ctx, calls } = context({ plan: planRow({ tier: 'growth', plan_version: 1, tier_expires_at: null }) });
    const result = await executeAdminOp({ op: 'set_cohort', cohort: null, reason: 'cleanup' } as AdminOp, ctx);

    expect(result).toMatchObject({ ok: true });
    expect(calls.updatePlan[0]).toMatchObject({ cohort: null });
  });

  it('counts an EXPIRED tier as no tier (A-1)', async () => {
    const { ctx } = context({ plan: planRow({ tier: 'growth', tier_expires_at: '2026-01-01T00:00:00.000Z' }) });
    const result = await executeAdminOp({ op: 'set_cohort', cohort: null, reason: 'cleanup' } as AdminOp, ctx);

    expect(result).toMatchObject({ ok: false, error: 'would_leave_no_basis' });
  });
});

describe('set_expiry (M-3 — a CHECK constraint is never the message)', () => {
  it('refuses an end date for a cohort that does not exist', async () => {
    const { ctx, calls } = context({ plan: planRow({ cohort: null, tier: 'growth', plan_version: 1 }) });
    const result = await executeAdminOp(
      { op: 'set_expiry', field: 'cohort_expires_at', value: '2027-01-01T00:00:00.000Z', reason: 'support case' } as AdminOp,
      ctx
    );

    expect(result).toMatchObject({ ok: false, status: 409, error: 'no_cohort_to_expire' });
    expect(calls.updatePlan).toEqual([]);
  });

  it('refuses an end date for a tier that does not exist', async () => {
    const { ctx } = context();
    const result = await executeAdminOp(
      { op: 'set_expiry', field: 'tier_expires_at', value: '2027-01-01T00:00:00.000Z', reason: 'support case' } as AdminOp,
      ctx
    );

    expect(result).toMatchObject({ ok: false, status: 409, error: 'no_tier_to_expire' });
  });

  it('allows clearing an end date that exists', async () => {
    const { ctx, calls } = context({ plan: planRow({ cohort_expires_at: '2027-01-01T00:00:00.000Z' }) });
    const result = await executeAdminOp(
      { op: 'set_expiry', field: 'cohort_expires_at', value: null, reason: 'open-ended' } as AdminOp,
      ctx
    );

    expect(result).toMatchObject({ ok: true });
    expect(calls.updatePlan[0]).toEqual({ cohort_expires_at: null });
  });

  it('R2-3: refuses an expiry that would strand the account with nothing', async () => {
    // A tier-only account whose tier is made to expire in the past has no
    // cohort to fall back on.
    const { ctx } = context({ plan: planRow({ cohort: null, tier: 'growth', plan_version: 1 }) });
    const result = await executeAdminOp(
      { op: 'set_expiry', field: 'tier_expires_at', value: '2020-01-01T00:00:00.000Z', reason: 'support case' } as AdminOp,
      ctx
    );

    expect(result).toMatchObject({ ok: false, status: 409, error: 'would_leave_no_basis' });
  });
});

describe('assign_tier', () => {
  it('assigns a tier the SHIPPED config has, now that it has two (2026-09-23)', async () => {
    // RC-1 used to refuse this op outright, because production shipped an empty
    // matrix. It ships `basic` and `pro` from 2026-09-23, so the op works — and
    // the assertion is on the production config deliberately, because "an admin
    // can put an account on a real plan" is the thing that changed.
    const config = readCodeConfig();
    const { ctx, calls } = context({ config });
    const result = await executeAdminOp(
      { op: 'assign_tier', tier: 'pro', expiresAt: null, reason: 'design partner' } as AdminOp,
      ctx
    );

    expect(result).toMatchObject({ ok: true });
    expect(calls.updatePlan[0]).toMatchObject({ tier: 'pro', plan_version: config.matrix.version });
  });

  it('RC-1: still refuses if the matrix is ever emptied again', async () => {
    // The refusal itself, kept under test now that the shipped config no longer
    // triggers it. It is the thing that stops an admin writing a tier name the
    // resolver would then call unknown.
    const { ctx, calls } = context({ config: { ...readCodeConfig(), tierOrder: [] } });
    const result = await executeAdminOp(
      { op: 'assign_tier', tier: 'pro', expiresAt: null, reason: 'support case' } as AdminOp,
      ctx
    );

    expect(result).toMatchObject({ ok: false, status: 400, error: 'no_tiers_configured' });
    expect(calls.updatePlan).toEqual([]);
  });

  it('Q-13 is now load-bearing on production: the schema enumerates the real tiers', () => {
    // While the matrix was empty the tier field fell back to `z.string()` and
    // this boundary check could not be exercised against the shipped config.
    const production = adminOpSchema(readCodeConfig());
    const body = (tier: string) => ({ op: 'assign_tier', tier, expiresAt: null, reason: 'support case' });

    expect(production.safeParse(body('pro')).success).toBe(true);
    expect(production.safeParse(body('basic')).success).toBe(true);
    // A cohort is not a tier. This is the mistake the enum exists to catch.
    expect(production.safeParse(body('champion')).success).toBe(false);
    expect(production.safeParse(body('growth')).success).toBe(false);
  });

  it('stamps the matrix version the tier was sold at', async () => {
    const config = fixtureConfig();
    const { ctx, calls } = context({ config });
    await executeAdminOp({ op: 'assign_tier', tier: 'growth', expiresAt: null, reason: 'support case' } as AdminOp, ctx);

    expect(calls.updatePlan[0]).toMatchObject({ tier: 'growth', tier_expires_at: null, plan_version: config.matrix.version });
  });

  it('clearing the tier clears its end date with it', async () => {
    const { ctx, calls } = context({ plan: planRow({ tier: 'growth', tier_expires_at: '2027-01-01T00:00:00.000Z' }) });
    await executeAdminOp({ op: 'assign_tier', tier: null, expiresAt: null, reason: 'downgrade' } as AdminOp, ctx);

    expect(calls.updatePlan[0]).toMatchObject({ tier: null, tier_expires_at: null });
  });
});

describe('PF-13: the credit-period anchor on a subscribed account (plan payments P-3b.1, SA-P2, Q-6)', () => {
  const ASSIGN = { op: 'assign_tier', tier: 'growth', expiresAt: null, reason: 'support case' } as AdminOp;
  const COHORT = { op: 'set_cohort', cohort: 'trial', reason: 'support case' } as AdminOp;

  it.each([
    ['assign_tier', ASSIGN],
    ['set_cohort', COHORT],
  ])('%s on an account with no live plan subscription still resets the anchor (unchanged behaviour)', async (_name, op) => {
    const { ctx, calls } = context({ subscribed: false });
    const result = await executeAdminOp(op, ctx);

    expect(result).toMatchObject({ ok: true });
    expect(calls.updatePlan[0]).toMatchObject({ period_anchor: NOW.toISOString() });
  });

  it.each([
    ['assign_tier', ASSIGN],
    ['set_cohort', COHORT],
  ])('%s on a subscribed account keeps the anchor: the patch does not name it at all', async (_name, op) => {
    const { ctx, calls } = context({ subscribed: true });
    const result = await executeAdminOp(op, ctx);

    expect(result).toMatchObject({ ok: true });
    expect(calls.updatePlan).toHaveLength(1);
    expect(calls.updatePlan[0]).not.toHaveProperty('period_anchor');
  });

  it('assign_tier on a subscribed account still writes the tier, its end date and the version (SA-P16b: the next paid invoice re-asserts the bought tier)', async () => {
    const config = fixtureConfig();
    const { ctx, calls } = context({ subscribed: true, config });
    await executeAdminOp(ASSIGN, ctx);

    expect(calls.updatePlan[0]).toEqual({ tier: 'growth', tier_expires_at: null, plan_version: config.matrix.version });
  });

  it.each([
    ['assign_tier', ASSIGN],
    ['set_cohort', COHORT],
  ])('%s refuses 500 billing_read_failed when the subscription cannot be told, and writes nothing (fail closed)', async (_name, op) => {
    const { ctx, calls } = context({ subscribed: null });
    const result = await executeAdminOp(op, ctx);

    expect(result).toEqual({ ok: false, status: 500, error: 'billing_read_failed' });
    expect(calls.updatePlan).toEqual([]);
  });

  it('the billing read comes after every earlier refusal, so those keep their status', async () => {
    // RC-1 and R2-3 refuse before the billing record is consulted.
    const empty = context({ subscribed: null, config: { ...readCodeConfig(), tierOrder: [] } });
    expect(await executeAdminOp({ op: 'assign_tier', tier: 'pro', expiresAt: null, reason: 'support case' } as AdminOp, empty.ctx)).toMatchObject({
      status: 400,
      error: 'no_tiers_configured',
    });
    expect(empty.calls.all).not.toContain('billing.hasLivePlanSubscription');

    const stranded = context({ subscribed: null, plan: planRow({ cohort: 'trial', tier: null }) });
    expect(
      await executeAdminOp({ op: 'set_cohort', cohort: null, reason: 'support case' } as AdminOp, stranded.ctx)
    ).toMatchObject({ status: 409, error: 'would_leave_no_basis' });
    expect(stranded.calls.all).not.toContain('billing.hasLivePlanSubscription');
  });

  it('reads the billing record for the path account, once, just before the write', async () => {
    const { ctx, calls } = context();
    const seen: string[] = [];
    ctx.billing = {
      async hasLivePlanSubscription(accountId: string) {
        seen.push(accountId);
        calls.all.push('billing.hasLivePlanSubscription');
        return false;
      },
    };
    await executeAdminOp(ASSIGN, ctx);

    expect(seen).toEqual([ACCOUNT]);
    expect(calls.all.indexOf('billing.hasLivePlanSubscription')).toBe(calls.all.indexOf('plan.updatePlan') - 1);
  });

  it.each([
    ['set_expiry', { op: 'set_expiry', field: 'grace_ends_at', value: null, reason: 'support case' } as AdminOp, {}],
    ['add_override', { op: 'add_override', capability: 'chat.search', overrideOp: 'set', value: true, reason: 'support case' } as AdminOp, {}],
    ['ensure_plan_row', { op: 'ensure_plan_row', cohort: 'champion', expiresAt: null, reason: 'trigger failed' } as AdminOp, { plan: null }],
  ] as Array<[string, AdminOp, Parameters<typeof context>[0]]>)('%s never reads the billing record (it does not move the anchor)', async (_name, op, options) => {
    const { ctx, calls } = context({ ...options, subscribed: null });
    const result = await executeAdminOp(op, ctx);

    expect(result).toMatchObject({ ok: true });
    expect(calls.all).not.toContain('billing.hasLivePlanSubscription');
  });
});

describe('add_override (C3-2)', () => {
  it('refuses to grant a capability that does not exist', async () => {
    // The resolver clamps such an override, so without this the admin reads
    // "granted" while the customer still has nothing.
    const { ctx, calls } = context();
    const result = await executeAdminOp(
      { op: 'add_override', capability: 'marketing.posts', overrideOp: 'set', value: true, reason: 'comp' } as AdminOp,
      ctx
    );

    expect(result).toMatchObject({ ok: false, status: 409, error: 'capability_not_built' });
    expect(calls.createOverride).toEqual([]);
  });

  it('…but allows REVOKING one, which is not a grant', async () => {
    const { ctx, calls } = context();
    const result = await executeAdminOp(
      { op: 'add_override', capability: 'marketing.posts', overrideOp: 'revoke', reason: 'belt and braces' } as AdminOp,
      ctx
    );

    expect(result).toMatchObject({ ok: true });
    expect(calls.createOverride).toHaveLength(1);
  });

  it('allows granting a capability that DOES exist', async () => {
    const { ctx, calls } = context();
    const result = await executeAdminOp(
      { op: 'add_override', capability: 'chat.search', overrideOp: 'set', value: true, reason: 'comp' } as AdminOp,
      ctx
    );

    expect(result).toMatchObject({ ok: true, action: 'BOS_ENTITLEMENT_OVERRIDE_ADDED' });
    expect(calls.createOverride[0]).toMatchObject({ capability: 'chat.search', op: 'set', value: true });
  });

  it('validates the value against the capability\'s own shape', async () => {
    const { ctx } = context();
    const result = await executeAdminOp(
      { op: 'add_override', capability: 'credits.allowance', overrideOp: 'set', value: true, reason: 'support case' } as AdminOp,
      ctx
    );

    expect(result).toMatchObject({ ok: false, status: 400, error: 'value_shape_invalid' });
  });

  it('refuses an override on the retired id `ai.actions` at the boundary (slice 5, SQ-17)', () => {
    // Renamed to `credits.allowance`, with no alias: the old id is no longer a
    // catalog key, so the schema's capability enum refuses it before anything
    // is written — an action-count override cannot be set on the credit pool.
    const production = adminOpSchema(readCodeConfig());
    const body = (capability: string) => ({
      op: 'add_override',
      capability,
      overrideOp: 'set',
      value: { perMonth: 5000 },
      reason: 'support case',
    });

    expect(production.safeParse(body('ai.actions')).success).toBe(false);
    expect(production.safeParse(body('credits.allowance')).success).toBe(true);
  });

  it('accepts the right shape for the same capability', async () => {
    const { ctx } = context();
    const result = await executeAdminOp(
      { op: 'add_override', capability: 'credits.allowance', overrideOp: 'set', value: { perMonth: 5000 }, reason: 'support case' } as AdminOp,
      ctx
    );

    expect(result).toMatchObject({ ok: true });
  });
});

describe('end_override', () => {
  it('refuses an override that does not belong to this account', async () => {
    const { ctx, calls } = context({ overrides: [] });
    const result = await executeAdminOp(
      { op: 'end_override', overrideId: '44444444-4444-4444-8444-444444444444', reason: 'support case' } as AdminOp,
      ctx
    );

    expect(result).toMatchObject({ ok: false, status: 404, error: 'override_not_found' });
    expect(calls.endOverride).toEqual([]);
  });

  it('refuses one that is already ended', async () => {
    const { ctx } = context({ overrides: [override({ ended_at: '2026-05-01T00:00:00.000Z' })] });
    const result = await executeAdminOp(
      { op: 'end_override', overrideId: override().id, reason: 'support case' } as AdminOp,
      ctx
    );

    expect(result).toMatchObject({ ok: false, status: 409, error: 'override_already_ended' });
  });

  it('ends a live one, scoped to the account', async () => {
    const { ctx, calls } = context({ overrides: [override()] });
    const result = await executeAdminOp(
      { op: 'end_override', overrideId: override().id, reason: 'no longer needed' } as AdminOp,
      ctx
    );

    expect(result).toMatchObject({ ok: true, action: 'BOS_ENTITLEMENT_OVERRIDE_ENDED' });
    expect(calls.endOverride[0]).toEqual([override().id, ACCOUNT, ADMIN, 'no longer needed']);
  });
});

describe('reset_plan_state (A-3) — the destructive one', () => {
  const base = {
    op: 'reset_plan_state' as const,
    confirm: 'reset_plan_state' as const,
    accountId: ACCOUNT,
    cohort: 'champion' as const,
    expiresAt: null,
    reason: 'support case',
  };

  it('refuses when the echoed account id does not match the path', async () => {
    const { ctx, calls } = context();
    const result = await executeAdminOp(
      { ...base, accountId: '55555555-5555-4555-8555-555555555555' } as AdminOp,
      ctx
    );

    expect(result).toMatchObject({ ok: false, status: 409, error: 'account_id_mismatch' });
    expect(calls.resetPlanState).toEqual([]);
  });

  it('refuses when a tier is assigned, unless the loss is confirmed', async () => {
    const withTier = { plan: planRow({ tier: 'growth', plan_version: 1 }) };

    const refused = context(withTier);
    expect(await executeAdminOp(base as AdminOp, refused.ctx)).toMatchObject({
      ok: false,
      status: 409,
      error: 'tier_assigned',
    });
    expect(refused.calls.resetPlanState).toEqual([]);

    const confirmed = context(withTier);
    expect(await executeAdminOp({ ...base, confirmTierLoss: true } as AdminOp, confirmed.ctx)).toMatchObject({ ok: true });
  });

  it('needs a trial clock when the new cohort is a trial', async () => {
    const { ctx } = context();
    const result = await executeAdminOp({ ...base, cohort: 'trial', expiresAt: undefined } as AdminOp, ctx);

    expect(result).toMatchObject({ ok: false, status: 400, error: 'trial_clock_required' });
  });

  it('pins the trial clock to now when asked to restart it', async () => {
    const { ctx, calls } = context();
    await executeAdminOp({ ...base, cohort: 'trial', trialClock: 'restart_now' } as AdminOp, ctx);

    expect(calls.resetPlanState[0]).toMatchObject({ cohort: 'trial', trialStartedAt: NOW.toISOString() });
  });

  it('re-derives it from the facts when asked to', async () => {
    const { ctx, calls } = context();
    await executeAdminOp({ ...base, cohort: 'trial', trialClock: 'from_facts' } as AdminOp, ctx);

    expect(calls.resetPlanState[0]).toMatchObject({ trialStartedAt: null });
  });

  it('carries the overrides the reset ENDED into the outcome', async () => {
    // The rows survive — M-2 makes the RPC end them rather than delete any, and
    // the migration guard asserts the function contains no DELETE. This is the
    // before-state next to the actor and the reason, so reading the audit entry
    // during an incident does not start with a join.
    const { ctx } = context({ overrides: [override(), override({ id: '66666666-6666-4666-8666-666666666666', capability: 'chat.bulk' })] });
    const result = await executeAdminOp(base as AdminOp, ctx);

    expect(result).toMatchObject({ ok: true, action: 'BOS_ENTITLEMENT_PLAN_STATE_RESET' });
    const ended = (result as unknown as { data: { endedOverrides: Array<{ capability: string }> } }).data
      .endedOverrides;
    expect(ended.map((row) => row.capability).sort()).toEqual(['chat.bulk', 'chat.search']);
  });
});

describe('slice 11b — the own-account guard, all nine ops (S11-BQ-1, OP-15)', () => {
  it('OWN_ACCOUNT_GUARDED_OPS equals the union\'s op literals, so a tenth op cannot be added without deciding', () => {
    const literals = adminOpSchema(fixtureConfig()).options.map((variant) => variant.shape.op.value);
    expect(literals).toHaveLength(9);
    expect(new Set(literals)).toEqual(new Set(OWN_ACCOUNT_GUARDED_OPS));
    expect(ONE_OF_EACH.map(([name]) => name).sort()).toEqual([...literals].sort());
  });

  it.each(ONE_OF_EACH)('%s on the admin\'s own account: 403 own_account and NO repository method at all', async (_name, sharedOp, options) => {
    const { ctx, calls } = context(options);
    ctx.accountId = ADMIN;
    // A copy: the shared fixture must not change for the later cases.
    const op = (sharedOp.op === 'reset_plan_state' ? { ...sharedOp, accountId: ADMIN } : sharedOp) as AdminOp;

    expect(await executeAdminOp(op, ctx)).toEqual({ ok: false, status: 403, error: 'own_account' });
    expect(calls.all).toEqual([]);
  });

  it.each(ONE_OF_EACH)('%s with the admin\'s own id UPPER-cased in the path: still 403, nothing read', async (_name, op, options) => {
    const { ctx, calls } = context(options);
    // Hex letters on purpose: the all-digit ADMIN reads the same in upper case.
    ctx.adminId = HEX_ADMIN;
    ctx.accountId = HEX_ADMIN.toUpperCase();
    expect(ctx.accountId).not.toBe(ctx.adminId);

    expect(await executeAdminOp(op, ctx)).toEqual({ ok: false, status: 403, error: 'own_account' });
    expect(calls.all).toEqual([]);
  });

  it('…and the admin id upper-cased against a lower-case path is refused too', async () => {
    const { ctx, calls } = context();
    ctx.accountId = HEX_ADMIN;
    ctx.adminId = HEX_ADMIN.toUpperCase();
    expect(await executeAdminOp({ op: 'set_cohort', cohort: 'trial', reason: 'support case' } as AdminOp, ctx)).toMatchObject({ status: 403, error: 'own_account' });
    expect(calls.all).toEqual([]);
  });

  it('a different account is not refused (the control)', async () => {
    const { ctx } = context();
    expect(await executeAdminOp({ op: 'set_cohort', cohort: 'trial', reason: 'support case' } as AdminOp, ctx)).toMatchObject({ ok: true });
  });
});

describe('slice 11b — the credit ops inside executeAdminOp', () => {
  const grant = { op: 'grant_credits', amount: 50, expiresAt: null, requestId: REQUEST_ID, reason: 'goodwill' } as AdminOp;
  const reduce = { op: 'reduce_credit_lot', lotId: LOT_ID, amount: 40, requestId: REQUEST_ID, reason: 'mistaken grant' } as AdminOp;
  const originalSystemId = process.env.SYSTEM_ADMIN_USER_ID;

  afterEach(() => {
    if (originalSystemId === undefined) delete process.env.SYSTEM_ADMIN_USER_ID;
    else process.env.SYSTEM_ADMIN_USER_ID = originalSystemId;
  });

  it('OP-9: the credit value version passed to recordLot is currentCreditValue().version', async () => {
    const { ctx, calls } = context();
    await executeAdminOp(grant, ctx);
    expect(calls.recordLot[0].creditValueVersion).toBe(currentCreditValue().version);
  });

  it.each([
    ['grant_credits', grant],
    ['reduce_credit_lot', reduce],
  ])('%s: the platform account is 409 platform_account BEFORE the tenant check (S11-CR-1)', async (_name, op) => {
    process.env.SYSTEM_ADMIN_USER_ID = '10101010-1010-4010-8010-101010101010';
    const { ctx, calls } = context();
    ctx.accountId = '10101010-1010-4010-8010-101010101010';
    expect(await executeAdminOp(op, ctx)).toEqual({ ok: false, status: 409, error: 'platform_account' });
    expect(calls.all).toEqual([]);
  });

  it('OP-21: the seven plan ops keep today\'s behaviour on the platform account (no platform check)', async () => {
    process.env.SYSTEM_ADMIN_USER_ID = '10101010-1010-4010-8010-101010101010';
    const { ctx } = context();
    ctx.accountId = '10101010-1010-4010-8010-101010101010';
    expect(await executeAdminOp({ op: 'set_cohort', cohort: 'trial', reason: 'support case' } as AdminOp, ctx)).toMatchObject({ ok: true });
  });

  it.each([
    ['grant_credits', grant],
    ['reduce_credit_lot', reduce],
  ])('%s: a non-tenant is 404 and a missing plan row is 409, nothing written', async (_name, op) => {
    const notTenant = context({ isTenant: false, plan: null });
    expect(await executeAdminOp(op, notTenant.ctx)).toMatchObject({ status: 404, error: 'not_a_business_os_account' });
    expect(notTenant.calls.recordLot).toEqual([]);
    expect(notTenant.calls.reverseLot).toEqual([]);

    const noRow = context({ plan: null });
    expect(await executeAdminOp(op, noRow.ctx)).toMatchObject({ status: 409, error: 'plan_row_missing' });
    expect(noRow.calls.recordLot).toEqual([]);
    expect(noRow.calls.reverseLot).toEqual([]);
  });

  it.each([
    ['grant_credits', grant],
    ['reduce_credit_lot', reduce],
  ])('%s: G11b-2, no plan, override or reset write; the outcome carries the audit override and no cache invalidation', async (_name, op) => {
    const { ctx, calls } = context({ plan: planRow({ cohort: 'trial', trial_started_at: '2026-09-01T00:00:00.000Z' }) });
    const result = await executeAdminOp(op, ctx);

    expect(result).toMatchObject({ ok: true, invalidatesEntitlements: false, audit: { entityType: 'business_os_credit_lot' } });
    expect((result as { before: unknown }).before).toEqual((result as { after: unknown }).after);
    expect(calls.updatePlan).toEqual([]);
    expect(calls.ensurePlanRow).toEqual([]);
    expect(calls.createOverride).toEqual([]);
    expect(calls.endOverride).toEqual([]);
    expect(calls.resetPlanState).toEqual([]);
  });

  it('the seven plan ops set no audit override, no replayed flag and no invalidation opt-out (G11b-1)', async () => {
    for (const [name, op, options] of ONE_OF_EACH.slice(0, 7)) {
      const { ctx } = context(name === 'end_override' ? { overrides: [override()] } : options);
      const result = await executeAdminOp(name === 'end_override' ? ({ ...op, overrideId: override().id } as AdminOp) : op, ctx);
      expect({ name, ok: result.ok }).toEqual({ name, ok: true });
      expect(result).not.toHaveProperty('audit');
      expect(result).not.toHaveProperty('replayed');
      expect(result).not.toHaveProperty('invalidatesEntitlements');
    }
  });

  it('the union parses both credit bodies, and refuses an injected account or user id', () => {
    expect(parse({ op: 'grant_credits', amount: 50, expiresAt: null, requestId: REQUEST_ID, reason: 'goodwill' }).success).toBe(true);
    expect(parse({ op: 'reduce_credit_lot', lotId: LOT_ID, amount: 'rest', requestId: REQUEST_ID, reason: 'mistaken grant' }).success).toBe(true);
    expect(parse({ op: 'grant_credits', amount: 50, expiresAt: null, requestId: REQUEST_ID, reason: 'goodwill', accountId: ACCOUNT }).success).toBe(false);
    expect(parse({ op: 'reduce_credit_lot', lotId: LOT_ID, amount: 1, requestId: REQUEST_ID, reason: 'mistaken grant', userId: ACCOUNT }).success).toBe(false);
    // The expiresAt key is required for a grant (S11-D-2 C).
    expect(parse({ op: 'grant_credits', amount: 50, requestId: REQUEST_ID, reason: 'goodwill' }).success).toBe(false);
  });
});

