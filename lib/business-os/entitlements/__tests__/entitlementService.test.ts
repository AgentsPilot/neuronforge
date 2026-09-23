/**
 * The service: the cache policy, the failure policy, and the order the balance
 * source is consulted in.
 *
 * Everything here injects a fake repository and a fake clock. A test that hit
 * Supabase would be testing Supabase; a test that used the wall clock could not
 * assert a 30-second TTL without sleeping for 30 seconds.
 */

import { EntitlementService, CACHE_MAX_ENTRIES, CACHE_TTL_SECONDS } from '@/lib/business-os/entitlements/EntitlementService';
import { FixtureTierMatrixSource } from '@/lib/business-os/entitlements/__fixtures__/fixtureSource';
import type { AiActionBalanceSource } from '@/lib/business-os/entitlements/balance';
import type { BusinessOsAccountPlan, BusinessOsEntitlementInputs } from '@/lib/repositories/BusinessOsAccountPlanRepository';

const configSource = new FixtureTierMatrixSource();

function planRow(overrides: Partial<BusinessOsAccountPlan> = {}): BusinessOsAccountPlan {
  return {
    user_id: 'acct-1',
    tier: 'growth',
    plan_version: 1,
    tier_expires_at: null,
    cohort: null,
    cohort_expires_at: null,
    onboarding_started_at: null,
    profile_created_at: null,
    trial_started_at: null,
    trial_ends_at: null,
    grace_ends_at: null,
    period_anchor: '2026-01-01T00:00:00.000Z',
    origin: 'admin',
    updated_by_admin_id: null,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

/** A repository that counts its calls and can be told to fail. */
function fakeRepository(initial: BusinessOsEntitlementInputs = { plan: planRow(), overrides: [] }) {
  const state = {
    inputs: initial,
    calls: 0,
    batchCalls: 0,
    batchSizes: [] as number[],
    error: null as Error | null,
  };

  return {
    state,
    async findEntitlementInputs() {
      state.calls += 1;
      if (state.error) return { data: null, error: state.error };
      return { data: state.inputs, error: null };
    },
    async findEntitlementInputsBatch(ids: string[]) {
      state.batchCalls += 1;
      state.batchSizes.push(ids.length);
      if (state.error) return { data: null, error: state.error };
      const byAccount: Record<string, BusinessOsEntitlementInputs> = {};
      for (const id of ids) byAccount[id] = { plan: planRow({ user_id: id }), overrides: [] };
      return { data: byAccount, error: null };
    },
  };
}

/** A clock the test moves by hand. */
function fakeClock(startIso = '2026-09-22T00:00:00.000Z') {
  let ms = Date.parse(startIso);
  return {
    now: () => new Date(ms),
    advanceSeconds: (seconds: number) => {
      ms += seconds * 1000;
    },
  };
}

describe('the cache holds INPUTS, not answers (S-6)', () => {
  it('serves a second call without a second read', async () => {
    const repo = fakeRepository();
    const service = new EntitlementService({ repository: repo, configSource, now: fakeClock().now });

    await service.check('acct-1', 'crm.core', { surfaceKind: 'owner_read' });
    await service.check('acct-1', 'chat.marketing', { surfaceKind: 'owner_write' });

    expect(repo.state.calls).toBe(1);
  });

  it('re-reads once the TTL passes', async () => {
    const repo = fakeRepository();
    const clock = fakeClock();
    const service = new EntitlementService({ repository: repo, configSource, now: clock.now });

    await service.check('acct-1', 'crm.core', { surfaceKind: 'owner_read' });
    clock.advanceSeconds(CACHE_TTL_SECONDS + 1);
    await service.check('acct-1', 'crm.core', { surfaceKind: 'owner_read' });

    expect(repo.state.calls).toBe(2);
  });

  it('re-resolves against the CURRENT clock, so a trial can expire inside the TTL', async () => {
    // The reason the cache holds inputs: a cached SNAPSHOT would still say
    // `trial` after the trial ended, for up to thirty seconds.
    const repo = fakeRepository({
      plan: planRow({ tier: null, cohort: 'trial', onboarding_started_at: '2026-09-08T00:00:00.000Z' }),
      overrides: [],
    });
    const clock = fakeClock('2026-09-21T23:59:50.000Z'); // the trial ends at 2026-09-22T00:00:00Z
    const service = new EntitlementService({ repository: repo, configSource, now: clock.now });

    expect((await service.check('acct-1', 'crm.core', { surfaceKind: 'owner_write' })).state).toBe('trial');

    clock.advanceSeconds(20); // still inside the 30 s TTL — no second read
    const after = await service.check('acct-1', 'crm.core', { surfaceKind: 'owner_write' });

    expect(repo.state.calls).toBe(1);
    expect(after.state).toBe('grace');
    expect(after.outcome).toBe('read_only');
  });

  it('every decision says how stale it may be (T-5)', async () => {
    const service = new EntitlementService({ repository: fakeRepository(), configSource, now: fakeClock().now });
    const decision = await service.check('acct-1', 'crm.core', { surfaceKind: 'owner_read' });
    expect(decision.effectiveWithinSeconds).toBe(30);
  });

  it('invalidate forces the next call to read', async () => {
    const repo = fakeRepository();
    const service = new EntitlementService({ repository: repo, configSource, now: fakeClock().now });

    await service.check('acct-1', 'crm.core', { surfaceKind: 'owner_read' });
    service.invalidate('acct-1');
    await service.check('acct-1', 'crm.core', { surfaceKind: 'owner_read' });

    expect(repo.state.calls).toBe(2);
  });

  it('is bounded, and evicts the least recently used', async () => {
    const repo = fakeRepository();
    const service = new EntitlementService({ repository: repo, configSource, now: fakeClock().now });

    for (let i = 0; i < CACHE_MAX_ENTRIES + 10; i += 1) {
      await service.check(`acct-${i}`, 'crm.core', { surfaceKind: 'owner_read' });
    }

    expect(service.cacheSize).toBe(CACHE_MAX_ENTRIES);
  });
});

describe('batch and report paths read through (RC-12/RC-13)', () => {
  it('chunks at 100 and does not touch the cache', async () => {
    const repo = fakeRepository();
    const service = new EntitlementService({ repository: repo, configSource, now: fakeClock().now });

    const ids = Array.from({ length: 250 }, (_, i) => `acct-${i}`);
    const snapshots = await service.getSnapshots(ids);

    expect(snapshots.size).toBe(250);
    expect(repo.state.batchSizes).toEqual([100, 100, 50]);
    // A report must not evict the working set of live requests.
    expect(service.cacheSize).toBe(0);
  });

  it('an account with no row comes back as an anomaly, not as unavailable', async () => {
    const repo = fakeRepository();
    repo.findEntitlementInputsBatch = async () => ({ data: {}, error: null });
    const service = new EntitlementService({ repository: repo, configSource, now: fakeClock().now });

    const snapshots = await service.getSnapshots(['acct-1']);
    expect(snapshots.get('acct-1')).toMatchObject({ unavailable: false });
    expect(snapshots.get('acct-1')?.resolution?.anomaly).toBe('no_plan_row');
  });
});

describe('failure policy (T-3)', () => {
  it('an unreadable account never produces not_entitled', async () => {
    const repo = fakeRepository();
    repo.state.error = new Error('connection reset');
    const service = new EntitlementService({ repository: repo, configSource, now: fakeClock().now });

    const owner = await service.check('acct-1', 'chat.search', { surfaceKind: 'owner_write' });
    expect(owner.outcome).toBe('entitlement_unavailable');

    const client = await service.check('acct-1', 'website.ai_site', { surfaceKind: 'public_business' });
    expect(client.outcome).toBe('allowed');
  });

  it('serves stale inputs to a client surface, and refuses them to an owner-paid one', async () => {
    const repo = fakeRepository();
    const clock = fakeClock();
    const service = new EntitlementService({ repository: repo, configSource, now: clock.now });

    await service.check('acct-1', 'crm.core', { surfaceKind: 'owner_read' }); // populate
    repo.state.error = new Error('database down');
    clock.advanceSeconds(120); // past the TTL, inside the stale tolerance

    const publicSurface = await service.check('acct-1', 'website.ai_site', { surfaceKind: 'public_business' });
    expect(publicSurface.outcome).toBe('allowed');

    const ownerPaid = await service.check('acct-1', 'chat.marketing', { surfaceKind: 'owner_write' });
    expect(ownerPaid).toMatchObject({ outcome: 'entitlement_unavailable' });
    expect(ownerPaid.reason).toContain('stale_inputs');
  });

  it('stops serving stale inputs once they are older than the tolerance', async () => {
    const repo = fakeRepository();
    const clock = fakeClock();
    const service = new EntitlementService({ repository: repo, configSource, now: clock.now });

    await service.check('acct-1', 'crm.core', { surfaceKind: 'owner_read' });
    repo.state.error = new Error('database down');
    clock.advanceSeconds(3600);

    // Still not a refusal for a client surface — it fails open on the policy
    // rather than on the cached row.
    expect((await service.check('acct-1', 'website.ai_site', { surfaceKind: 'public_business' })).outcome).toBe('allowed');
    expect((await service.check('acct-1', 'crm.core', { surfaceKind: 'owner_write' })).outcome).toBe('entitlement_unavailable');
  });

  it('a config that will not load behaves like an outage, not like a refusal', async () => {
    const broken = {
      load() {
        throw new Error('config is invalid');
      },
    };
    const service = new EntitlementService({ repository: fakeRepository(), configSource: broken, now: fakeClock().now });

    const decision = await service.check('acct-1', 'chat.search', { surfaceKind: 'owner_write' });
    expect(decision.outcome).toBe('entitlement_unavailable');
    expect(decision.reason).toContain('config_unavailable');
  });
});

describe('the balance seam (A-2 step c)', () => {
  const short: AiActionBalanceSource = { async check() { return { sufficient: false, remaining: 0 }; } };

  it('is consulted for a metered capability', async () => {
    const service = new EntitlementService({ repository: fakeRepository(), configSource, now: fakeClock().now, balanceSource: short });
    const decision = await service.check('acct-1', 'ai.actions', { surfaceKind: 'owner_ai' });

    expect(decision).toMatchObject({ outcome: 'limit_reached', remaining: 0 });
  });

  it('is NOT consulted when the call was going to be refused anyway', async () => {
    // Slice 3's ledger query must not run for a request that fails step (a).
    let calls = 0;
    const counting: AiActionBalanceSource = {
      async check() {
        calls += 1;
        return { sufficient: false };
      },
    };
    const repo = fakeRepository({ plan: planRow({ tier: 'basic' }), overrides: [] });
    const service = new EntitlementService({ repository: repo, configSource, now: fakeClock().now, balanceSource: counting });

    const decision = await service.check('acct-1', 'ai.actions', { surfaceKind: 'owner_ai', requested: { perMonth: 5000 } });

    expect(decision.outcome).toBe('not_entitled');
    expect(calls).toBe(0);
  });

  it('is not consulted at all for a non-metered capability', async () => {
    let calls = 0;
    const counting: AiActionBalanceSource = {
      async check() {
        calls += 1;
        return { sufficient: true };
      },
    };
    const service = new EntitlementService({ repository: fakeRepository(), configSource, now: fakeClock().now, balanceSource: counting });

    await service.check('acct-1', 'crm.core', { surfaceKind: 'owner_write' });
    expect(calls).toBe(0);
  });

  it('a balance source that throws allows the call rather than refusing it', async () => {
    const broken: AiActionBalanceSource = {
      async check() {
        throw new Error('ledger unavailable');
      },
    };
    const service = new EntitlementService({ repository: fakeRepository(), configSource, now: fakeClock().now, balanceSource: broken });

    expect((await service.check('acct-1', 'ai.actions', { surfaceKind: 'owner_ai' })).outcome).toBe('allowed');
  });

  it('the shipped default never refuses', async () => {
    const service = new EntitlementService({ repository: fakeRepository(), configSource, now: fakeClock().now });
    expect((await service.check('acct-1', 'ai.actions', { surfaceKind: 'owner_ai' })).outcome).toBe('allowed');
  });
});
