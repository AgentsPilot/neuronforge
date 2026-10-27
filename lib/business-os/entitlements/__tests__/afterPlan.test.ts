/**
 * `afterPlanAccount`: the single after-plan rule (account-deletion lifecycle
 * SX-2 / D3; user decision BQ-20, 2026-10-27; SA R-4a, R-7, Q-10).
 *
 * The D3 view describes it and SX-2b will write it, so it is pinned here once:
 * the duration is read from the config at `endsAt` (never a literal 14), the
 * input is never mutated, and a Founding Partner whose own free access outlives
 * the paid plan is never moved down to the free cohort. Cohorts are found by
 * STRUCTURE (with / without a duration), never by name.
 */

import { readFileSync } from 'fs';
import { join } from 'path';

import { afterPlanAccount } from '@/lib/business-os/entitlements/afterPlan';
import { AFTER_PLAN } from '@/lib/business-os/entitlements/config/afterPlan';
import { COHORTS, COHORT_IDS, type CohortConfig, type CohortId } from '@/lib/business-os/entitlements/config/cohorts';
import { LIFECYCLE_CONFIG } from '@/lib/business-os/entitlements/config/lifecycle';
import { TIER_ORDER } from '@/lib/business-os/entitlements/config/tierMatrix';
import { freeAccessAfterPaidTier } from '@/lib/business-os/entitlements/freeAccess';
import { isGrantableCohort } from '@/lib/business-os/entitlements/grantRules';
import { historyAt, type LifecycleInputs } from '@/lib/business-os/entitlements/lifecycle';
import { getEntitlementConfig } from '@/lib/business-os/entitlements/source';
import { account } from '@/lib/business-os/entitlements/__fixtures__/accounts';

const DAY = 24 * 60 * 60 * 1000;
const ENDS = '2026-11-26T10:00:00.000Z';
const TOP = TIER_ORDER[TIER_ORDER.length - 1];

const INPUTS: LifecycleInputs = {
  cohorts: COHORTS,
  tierOrder: TIER_ORDER,
  subscriptionGraceHistory: LIFECYCLE_CONFIG.subscriptionGraceHistory,
  renewalSettlementMarginHistory: LIFECYCLE_CONFIG.renewalSettlementMarginHistory,
};

const entries = Object.entries(COHORTS) as Array<[string, CohortConfig]>;
const ADMIN_DATED = entries.find(([, c]) => !c.durationHistory)![0];
const AFTER_DAYS = historyAt((COHORTS[AFTER_PLAN.cohort] as CohortConfig).durationHistory ?? [], new Date(ENDS))!.days;

const paying = (extra: Parameters<typeof account>[0] = {}) =>
  account({ tier: TOP, planVersion: 0, tierExpiresAt: '2026-10-26T10:00:00.000Z', ...extra });

describe('the config entry (SA Q-10)', () => {
  it('names a grantable cohort WITH a duration (an end date), so the move is always dated', () => {
    expect(isGrantableCohort(getEntitlementConfig(), AFTER_PLAN.cohort)).toBe(true);
    expect((COHORTS[AFTER_PLAN.cohort] as CohortConfig).durationHistory?.length).toBeGreaterThan(0);
  });

  it('BQ-20 (user, 2026-10-27): the first free period is 14 days, read from the config', () => {
    expect(AFTER_DAYS).toBe(14);
  });
});

describe('moves to the after-plan cohort', () => {
  it('a paying account whose trial was used long ago: cohort, start = endsAt, end = endsAt + duration', () => {
    const result = afterPlanAccount(paying({ cohort: AFTER_PLAN.cohort, onboardingStartedAt: '2026-01-01T00:00:00.000Z' }), ENDS, INPUTS);
    expect(result.moved).toBe(true);
    expect(result.account).toMatchObject({
      tier: TOP,
      tierExpiresAt: ENDS,
      cohort: AFTER_PLAN.cohort,
      trialStartedAt: ENDS,
      trialEndsAt: new Date(Date.parse(ENDS) + AFTER_DAYS * DAY).toISOString(),
    });
  });

  it('a paying account with no cohort at all', () => {
    const result = afterPlanAccount(paying(), ENDS, INPUTS);
    expect(result.moved).toBe(true);
    expect(result.account.cohort).toBe(AFTER_PLAN.cohort);
  });

  it('a Founding Partner whose free access ends BEFORE the paid plan does', () => {
    const result = afterPlanAccount(paying({ cohort: ADMIN_DATED, cohortExpiresAt: '2026-11-01T00:00:00.000Z' }), ENDS, INPUTS);
    expect(result.moved).toBe(true);
    expect(result.account.cohort).toBe(AFTER_PLAN.cohort);
    expect(result.account.cohortExpiresAt).toBe('2026-11-01T00:00:00.000Z');
  });

  it('the duration is the entry in force AT endsAt (S-7), never a literal', () => {
    const renamed = { ...COHORTS[AFTER_PLAN.cohort], durationHistory: [
      { effectiveFrom: '2026-01-01T00:00:00.000Z', days: 30 },
      { effectiveFrom: '2026-11-01T00:00:00.000Z', days: 3 },
      { effectiveFrom: '2027-01-01T00:00:00.000Z', days: 99 },
    ] } as CohortConfig;
    const inputs: LifecycleInputs = { ...INPUTS, cohorts: { ...COHORTS, renamed_free: renamed } };
    const result = afterPlanAccount(paying(), ENDS, inputs, { cohort: 'renamed_free' as CohortId });
    expect(result.account.cohort).toBe('renamed_free');
    expect(result.account.trialEndsAt).toBe(new Date(Date.parse(ENDS) + 3 * DAY).toISOString());
  });

  it('a config entry naming a cohort with no duration cannot move anyone (no endless free plan)', () => {
    const result = afterPlanAccount(paying(), ENDS, INPUTS, { cohort: ADMIN_DATED as CohortId });
    expect(result.moved).toBe(false);
    expect(result.account.cohort).toBeNull();
  });
});

describe('a surviving own cohort is left alone (SA R-4a: never downgrade a champion)', () => {
  it('a dated Founding Partner live past the period end: unchanged but the tier end', () => {
    const before = paying({ cohort: ADMIN_DATED, cohortExpiresAt: '2027-03-01T00:00:00.000Z' });
    const result = afterPlanAccount(before, ENDS, INPUTS);
    expect(result.moved).toBe(false);
    expect(result.account).toEqual({ ...before, tierExpiresAt: ENDS });
  });

  it('an open-ended Founding Partner: unchanged', () => {
    const before = paying({ cohort: ADMIN_DATED, cohortExpiresAt: null });
    const result = afterPlanAccount(before, ENDS, INPUTS);
    expect(result.moved).toBe(false);
    expect(result.account.cohort).toBe(ADMIN_DATED);
  });

  it('agrees with P-7a.3: wherever freeAccessAfterPaidTier answers, nothing moves', () => {
    const before = paying({ cohort: ADMIN_DATED, cohortExpiresAt: '2027-03-01T00:00:00.000Z' });
    expect(freeAccessAfterPaidTier({ ...before, tierExpiresAt: ENDS }, INPUTS)).not.toBeNull();
    expect(afterPlanAccount(before, ENDS, INPUTS).moved).toBe(false);
  });

  it('an unexpired trial resumes as it is', () => {
    const before = paying({ cohort: AFTER_PLAN.cohort, trialStartedAt: '2026-11-20T00:00:00.000Z' });
    const result = afterPlanAccount(before, ENDS, INPUTS);
    expect(result.moved).toBe(false);
    expect(result.account.trialStartedAt).toBe('2026-11-20T00:00:00.000Z');
  });
});

describe('purity', () => {
  it('never mutates its input (it may be the service cache\'s own object)', () => {
    const before = Object.freeze(paying({ cohort: AFTER_PLAN.cohort, onboardingStartedAt: '2026-01-01T00:00:00.000Z' }));
    const copy = JSON.stringify(before);
    const result = afterPlanAccount(before, ENDS, INPUTS);
    expect(JSON.stringify(before)).toBe(copy);
    expect(result.account).not.toBe(before);
  });

  it.each(['afterPlan.ts', 'planEndingView.ts', 'freeAccess.ts'])('%s names no cohort id', (file) => {
    const source = readFileSync(join(process.cwd(), 'lib', 'business-os', 'entitlements', file), 'utf8');
    for (const id of COHORT_IDS) {
      expect(source).not.toMatch(new RegExp(`['"\`]${id}['"\`]`));
    }
  });
});
