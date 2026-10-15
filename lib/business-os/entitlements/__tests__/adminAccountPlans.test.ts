/**
 * `describeAccountPlans`: the names and the two lifecycle answers the admin
 * plan card words (admin plan card plain labels, 2026-10-15).
 *
 * Run against the REAL config, and the expectations are read off it
 * (`planLabel`, `planInheritsFrom`, `tierOrder`) rather than written down, so
 * renaming a plan or moving the champion base is not a broken test.
 */

import { describeAccountPlans } from '../adminAccountPlans';
import { planInheritsFrom, planLabel } from '../planPresentation';
import { getEntitlementConfig } from '../source';

// The plan row type, taken from the function rather than named: only the
// repository layer may name the repository (RC-15).
type PlanRow = NonNullable<Parameters<typeof describeAccountPlans>[1]>;

const config = getEntitlementConfig();
const LOWEST_TIER = config.tierOrder[0];
const NOW = new Date('2026-10-15T12:00:00.000Z');

function row(patch: Partial<PlanRow>): PlanRow {
  return {
    user_id: '11111111-1111-4111-8111-111111111111',
    tier: null,
    plan_version: 1,
    tier_expires_at: null,
    cohort: null,
    cohort_expires_at: null,
    onboarding_started_at: '2026-01-01T00:00:00.000Z',
    profile_created_at: '2026-01-02T00:00:00.000Z',
    trial_started_at: null,
    trial_ends_at: null,
    grace_ends_at: null,
    period_anchor: '2026-01-01T00:00:00.000Z',
    origin: 'admin',
    updated_by_admin_id: null,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    ...patch,
  };
}

describe('describeAccountPlans', () => {
  it('no plan row: nothing named, nothing compared', () => {
    expect(describeAccountPlans(config, null, NOW)).toEqual({ tier: null, cohort: null, tierBelowCohortBase: false });
  });

  it('a dated paid plan over open-ended Founding Partner: named, live, takes over, and the comparison follows the tier order', () => {
    const result = describeAccountPlans(
      config,
      row({ tier: LOWEST_TIER, tier_expires_at: '2026-11-12T00:00:00.000Z', cohort: 'champion' }),
      NOW
    );
    const baseId = planInheritsFrom(config, 'champion');

    expect(result.tier).toEqual({ id: LOWEST_TIER, name: planLabel(config, LOWEST_TIER) });
    expect(result.cohort).toEqual({
      id: 'champion',
      name: planLabel(config, 'champion'),
      endsAt: null,
      liveNow: true,
      outlivesTier: true,
      base: baseId ? { id: baseId, name: planLabel(config, baseId) } : null,
    });
    expect(result.tierBelowCohortBase).toBe(
      baseId !== null && config.tierOrder.indexOf(LOWEST_TIER) < config.tierOrder.indexOf(baseId)
    );
  });

  it('a paid plan at the cohort base itself is not "lower"', () => {
    const baseId = planInheritsFrom(config, 'champion') as string;
    const result = describeAccountPlans(config, row({ tier: baseId, cohort: 'champion' }), NOW);
    expect(result.tierBelowCohortBase).toBe(false);
    // No dated paid plan: nothing to outlive.
    expect(result.cohort?.outlivesTier).toBeNull();
  });

  it('free access that ends before the paid plan does not take over', () => {
    const result = describeAccountPlans(
      config,
      row({
        tier: LOWEST_TIER,
        tier_expires_at: '2026-11-12T00:00:00.000Z',
        cohort: 'champion',
        cohort_expires_at: '2026-11-01T00:00:00.000Z',
      }),
      NOW
    );
    expect(result.cohort).toMatchObject({ endsAt: '2026-11-01T00:00:00.000Z', liveNow: true, outlivesTier: false });
  });

  it('free access that ends inside the renewal settlement margin does not take over', () => {
    // The paid plan is in force until its date plus the margin, so a cohort
    // ending in between has gone by the time the account would fall back.
    const result = describeAccountPlans(
      config,
      row({
        tier: LOWEST_TIER,
        tier_expires_at: '2026-11-12T00:00:00.000Z',
        cohort: 'champion',
        cohort_expires_at: '2026-11-12T06:00:00.000Z',
      }),
      NOW
    );
    expect(result.cohort?.outlivesTier).toBe(false);
  });

  it('a trial under a paid plan: its end is DERIVED from the start and duration, and an old trial is not live', () => {
    const result = describeAccountPlans(
      config,
      row({ tier: LOWEST_TIER, tier_expires_at: '2026-11-12T00:00:00.000Z', cohort: 'trial' }),
      NOW
    );
    expect(result.cohort?.name).toBe(planLabel(config, 'trial'));
    expect(result.cohort?.liveNow).toBe(false);
    expect(result.cohort?.outlivesTier).toBe(false);
    // Not the row's (null) cohort_expires_at: the trial's own end.
    expect(result.cohort?.endsAt).not.toBeNull();
    expect(new Date(result.cohort?.endsAt as string).getTime()).toBeLessThan(NOW.getTime());
  });

  it('an unknown cohort is named by its id and is not live', () => {
    const result = describeAccountPlans(config, row({ cohort: 'not_a_cohort' }), NOW);
    expect(result.cohort).toMatchObject({ id: 'not_a_cohort', name: 'not_a_cohort', liveNow: false, base: null });
  });
});
