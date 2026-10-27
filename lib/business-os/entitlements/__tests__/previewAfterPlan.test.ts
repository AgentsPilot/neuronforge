/**
 * `EntitlementService.previewAfterPlan` (account-deletion lifecycle SX-2 / D3;
 * SA Q-4, R-5): same inputs and cache as `getSnapshot`, never mutates the
 * cached object, and resolves PAST the renewal settlement margin.
 */

import { EntitlementService, CACHE_TTL_SECONDS } from '@/lib/business-os/entitlements/EntitlementService';
import { AFTER_PLAN } from '@/lib/business-os/entitlements/config/afterPlan';
import { COHORTS, type CohortConfig } from '@/lib/business-os/entitlements/config/cohorts';
import { TIER_ORDER } from '@/lib/business-os/entitlements/config/tierMatrix';
import { afterPlanAccount } from '@/lib/business-os/entitlements/afterPlan';
import { resolveEntitlements } from '@/lib/business-os/entitlements/resolver';
import { getEntitlementConfig } from '@/lib/business-os/entitlements/source';
import { fromPlanRow, type EntitlementAccount } from '@/lib/business-os/entitlements/account';
// The row types through the account seam, so this suite does not name the repository (RC-15 guard).
type BusinessOsAccountPlan = Parameters<typeof fromPlanRow>[0];
type BusinessOsEntitlementInputs = { plan: BusinessOsAccountPlan | null; overrides: [] };

const NOW = '2026-10-27T12:00:00.000Z';
const ENDS = '2026-11-26T10:00:00.000Z';
const TOP = TIER_ORDER[TIER_ORDER.length - 1];
const ADMIN_DATED = (Object.entries(COHORTS) as Array<[string, CohortConfig]>).find(([, c]) => !c.durationHistory)![0];

function planRow(overrides: Partial<BusinessOsAccountPlan> = {}): BusinessOsAccountPlan {
  return {
    user_id: 'acct-1', tier: TOP, plan_version: 0, tier_expires_at: ENDS, cohort: AFTER_PLAN.cohort, cohort_expires_at: null,
    onboarding_started_at: '2026-01-01T00:00:00.000Z', profile_created_at: null, trial_started_at: null, trial_ends_at: null,
    grace_ends_at: null, period_anchor: '2026-01-01T00:00:00.000Z', origin: 'admin', updated_by_admin_id: null,
    created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z', ...overrides,
  };
}

function fakeRepository(inputs: BusinessOsEntitlementInputs | null) {
  const state = { calls: 0, error: null as Error | null };
  return {
    state,
    async findEntitlementInputs() {
      state.calls += 1;
      if (state.error || !inputs) return { data: null, error: state.error ?? new Error('none') };
      return { data: inputs, error: null };
    },
    async findEntitlementInputsBatch() {
      return { data: {}, error: null };
    },
  };
}

function service(inputs: BusinessOsEntitlementInputs | null, nowIso = NOW) {
  let ms = Date.parse(nowIso);
  const repo = fakeRepository(inputs);
  const svc = new EntitlementService({ repository: repo, now: () => new Date(ms) });
  return { svc, repo, advance: (seconds: number) => (ms += seconds * 1000) };
}

describe('previewAfterPlan', () => {
  it('reads through the cache getSnapshot filled: one repository read for both', async () => {
    const { svc, repo } = service({ plan: planRow(), overrides: [] });
    await svc.getSnapshot('acct-1');
    const preview = await svc.previewAfterPlan('acct-1', ENDS);
    expect(preview).not.toBeNull();
    expect(repo.state.calls).toBe(1);
  });

  it('reads (and caches) when nothing fresh is cached', async () => {
    const { svc, repo, advance } = service({ plan: planRow(), overrides: [] });
    await svc.getSnapshot('acct-1');
    advance(CACHE_TTL_SECONDS + 1);
    await svc.previewAfterPlan('acct-1', ENDS);
    await svc.getFreeAccessAfterPaidTier('acct-1');
    expect(repo.state.calls).toBe(2);
  });

  it('never mutates the cached account', async () => {
    const { svc } = service({ plan: planRow(), overrides: [] });
    await svc.getSnapshot('acct-1');
    // Reaching into the private cache on purpose: this is the object the rule must not touch.
    const cache = (svc as unknown as { cache: Map<string, { inputs: { account: EntitlementAccount } }> }).cache;
    const cached = cache.get('acct-1')!.inputs.account;
    const before = JSON.stringify(cached);
    Object.freeze(cached);
    const preview = await svc.previewAfterPlan('acct-1', ENDS);
    expect(JSON.stringify(cached)).toBe(before);
    expect(preview!.moved).toBe(true);
    const again = await svc.getSnapshot('acct-1');
    expect(again.resolution!.basis).toEqual({ kind: 'tier', tier: TOP });
  });

  it('resolves past the settlement margin: inside it the tier would still be in force', async () => {
    const { svc } = service({ plan: planRow(), overrides: [] });
    const preview = await svc.previewAfterPlan('acct-1', ENDS);
    expect(preview!.current.basis).toEqual({ kind: 'tier', tier: TOP });
    expect(preview!.after.basis).toEqual({ kind: 'cohort', cohort: AFTER_PLAN.cohort });

    // The same after-plan row, read one millisecond after the period end (inside the margin): still the tier.
    const config = getEntitlementConfig();
    const lifecycle = { cohorts: config.cohorts, tierOrder: config.tierOrder, subscriptionGraceHistory: config.lifecycle.subscriptionGraceHistory, renewalSettlementMarginHistory: config.lifecycle.renewalSettlementMarginHistory };
    const row = afterPlanAccount(fromPlanRow(planRow()), ENDS, lifecycle).account;
    const inside = resolveEntitlements({ config, account: row, overrides: [], addons: [], now: new Date(Date.parse(ENDS) + 1) });
    expect(inside.basis).toEqual({ kind: 'tier', tier: TOP });
  });

  it('afterTrialEnd: the free period\'s own grace (read-only), then paused', async () => {
    const { svc } = service({ plan: planRow(), overrides: [] });
    const preview = await svc.previewAfterPlan('acct-1', ENDS);
    expect(preview!.afterTrialEnd!.state).toBe('grace');
    expect(preview!.freeAccessAfter).toBeNull();
  });

  it('a Founding Partner whose free access outlives the plan: not moved, and P-7a.3\'s date travels with it', async () => {
    const { svc } = service({ plan: planRow({ cohort: ADMIN_DATED, cohort_expires_at: '2027-03-01T00:00:00.000Z' }), overrides: [] });
    const preview = await svc.previewAfterPlan('acct-1', ENDS);
    expect(preview!.moved).toBe(false);
    expect(preview!.after.basis).toEqual({ kind: 'cohort', cohort: ADMIN_DATED });
    expect(preview!.freeAccessAfter).toEqual(await svc.getFreeAccessAfterPaidTier('acct-1'));
  });

  it('null on unreadable inputs, on no plan row, and on an unreadable date', async () => {
    const failing = service(null);
    await expect(failing.svc.previewAfterPlan('acct-1', ENDS)).resolves.toBeNull();
    const noRow = service({ plan: null, overrides: [] });
    await expect(noRow.svc.previewAfterPlan('acct-1', ENDS)).resolves.toBeNull();
    const ok = service({ plan: planRow(), overrides: [] });
    await expect(ok.svc.previewAfterPlan('acct-1', 'not a date')).resolves.toBeNull();
  });
});
