/**
 * `afterPlanAccount`: the single after-plan rule (account-deletion lifecycle
 * SX-2 / D3 and SX-2b / D3.1; user decision BQ-20 and the repeat-cancel
 * halving, 2026-10-27; SA R-4a, R-7, Q-10, DR-4, S-2, S-3, S-4, S-11).
 *
 * The D3 view describes it and the D3.1 writer writes it, so it is pinned here
 * once: the length is read from the config at `endsAt` (never a literal 14) and
 * halved per earlier move, the free period starts when paid access really ends,
 * the paid tier is never written, the input is never mutated, and a Founding
 * Partner whose own free access outlives the paid plan is never moved down.
 * Cohorts are found by STRUCTURE (with / without a duration), never by name.
 */

import { readFileSync } from 'fs';
import { join } from 'path';

import { afterPlanAccount, afterPlanDays } from '@/lib/business-os/entitlements/afterPlan';
import { AFTER_PLAN, type AfterPlanConfig } from '@/lib/business-os/entitlements/config/afterPlan';
import { COHORTS, COHORT_IDS, type CohortConfig, type CohortId } from '@/lib/business-os/entitlements/config/cohorts';
import { LIFECYCLE_CONFIG } from '@/lib/business-os/entitlements/config/lifecycle';
import { TIER_ORDER } from '@/lib/business-os/entitlements/config/tierMatrix';
import { freeAccessAfterPaidTier } from '@/lib/business-os/entitlements/freeAccess';
import { isGrantableCohort } from '@/lib/business-os/entitlements/grantRules';
import { historyAt, tierSettlementEndsAt, type LifecycleInputs } from '@/lib/business-os/entitlements/lifecycle';
import { getEntitlementConfig } from '@/lib/business-os/entitlements/source';
import { account } from '@/lib/business-os/entitlements/__fixtures__/accounts';

const DAY = 24 * 60 * 60 * 1000;
const ENDS = '2026-11-26T10:00:00.000Z';
const TOP = TIER_ORDER[TIER_ORDER.length - 1];
const FIRST = { priorMoves: 0 };

const INPUTS: LifecycleInputs = {
  cohorts: COHORTS,
  tierOrder: TIER_ORDER,
  subscriptionGraceHistory: LIFECYCLE_CONFIG.subscriptionGraceHistory,
  renewalSettlementMarginHistory: LIFECYCLE_CONFIG.renewalSettlementMarginHistory,
};

const entries = Object.entries(COHORTS) as Array<[string, CohortConfig]>;
const ADMIN_DATED = entries.find(([, c]) => !c.durationHistory)![0];
const AFTER_DAYS = historyAt((COHORTS[AFTER_PLAN.cohort] as CohortConfig).durationHistory ?? [], new Date(ENDS))!.days;
/** When a tier paid through ENDS really ends: ENDS plus the settlement margin, from config. */
const SETTLED = tierSettlementEndsAt(ENDS, LIFECYCLE_CONFIG.renewalSettlementMarginHistory);
const plus = (iso: string, days: number) => new Date(Date.parse(iso) + days * DAY).toISOString();

/** A paying account whose trial was used long ago and whose paid tier lapsed BEFORE `ENDS` (a past_due end). */
const lapsed = (extra: Parameters<typeof account>[0] = {}) =>
  account({ tier: TOP, planVersion: 0, tierExpiresAt: '2026-10-26T10:00:00.000Z', ...extra });
/** A paying account paid through exactly `ENDS` (a period-end cancel), trial used long ago. */
const periodEnd = (extra: Parameters<typeof account>[0] = {}) =>
  account({ tier: TOP, planVersion: 0, tierExpiresAt: ENDS, cohort: AFTER_PLAN.cohort, onboardingStartedAt: '2026-01-01T00:00:00.000Z', ...extra });

describe('the config entry (SA Q-10)', () => {
  it('names a grantable cohort WITH a duration (an end date), so the move is always dated', () => {
    expect(isGrantableCohort(getEntitlementConfig(), AFTER_PLAN.cohort)).toBe(true);
    expect((COHORTS[AFTER_PLAN.cohort] as CohortConfig).durationHistory?.length).toBeGreaterThan(0);
  });

  it('BQ-20 (user, 2026-10-27): the first free period is 14 days, read from the config', () => {
    expect(AFTER_DAYS).toBe(14);
  });

  it('the repeat halving (user, 2026-10-27): divisor 2, minimum 1 day', () => {
    expect(AFTER_PLAN.repeat).toEqual({ divisor: 2, minimumDays: 1 });
  });
});

describe('the repeat-cancel halving (user decision 2026-10-27, SA S-3: ceil)', () => {
  it('real config: priorMoves 0..6 → 14, 7, 4, 2, 1, 1, 1 days', () => {
    const days = [0, 1, 2, 3, 4, 5, 6].map((priorMoves) => afterPlanAccount(periodEnd(), ENDS, INPUTS, { priorMoves }).days);
    expect(days).toEqual([14, 7, 4, 2, 1, 1, 1]);
  });

  it('the stored end is the start plus the halved length, for every count', () => {
    for (const [priorMoves, expected] of [[0, 14], [1, 7], [4, 1]] as const) {
      const result = afterPlanAccount(periodEnd(), ENDS, INPUTS, { priorMoves });
      expect(result.account.trialEndsAt).toBe(plus(SETTLED, expected));
    }
  });

  it('no literal in the rule: a fixture base of 10 with divisor 2 and minimum 2 → 10, 5, 3, 2, 2', () => {
    const fixture = { ...COHORTS[AFTER_PLAN.cohort], durationHistory: [{ effectiveFrom: '2026-01-01T00:00:00.000Z', days: 10 }] } as CohortConfig;
    const inputs: LifecycleInputs = { ...INPUTS, cohorts: { ...COHORTS, fixture_free: fixture } };
    const config: AfterPlanConfig = { cohort: 'fixture_free' as CohortId, repeat: { divisor: 2, minimumDays: 2 } };
    const days = [0, 1, 2, 3, 4].map((priorMoves) => afterPlanAccount(periodEnd({ cohort: null }), ENDS, inputs, { priorMoves }, config).days);
    expect(days).toEqual([10, 5, 3, 2, 2]);
  });

  it('a count that is not a non-negative integer counts as 0 (the caller logs it)', () => {
    expect(afterPlanDays(14, -1, AFTER_PLAN.repeat)).toBe(14);
    expect(afterPlanDays(14, 1.5, AFTER_PLAN.repeat)).toBe(14);
    expect(afterPlanDays(14, Number.NaN, AFTER_PLAN.repeat)).toBe(14);
    expect(afterPlanDays(14, 10_000, AFTER_PLAN.repeat)).toBe(1);
  });

  it('a bad divisor or minimum cannot give a length', () => {
    expect(afterPlanDays(14, 1, { divisor: 1, minimumDays: 1 })).toBeNull();
    expect(afterPlanDays(14, 1, { divisor: 2, minimumDays: 0 })).toBeNull();
    const result = afterPlanAccount(periodEnd(), ENDS, INPUTS, FIRST, { cohort: AFTER_PLAN.cohort, repeat: { divisor: 0, minimumDays: 1 } });
    expect(result).toMatchObject({ moved: false, days: null, skip: 'after_plan_misconfigured' });
  });
});

describe('moves to the after-plan cohort', () => {
  it('S-2: a period-end cancel starts the free period when paid access really ends (endsAt + the margin)', () => {
    const result = afterPlanAccount(periodEnd(), ENDS, INPUTS, FIRST);
    expect(result.moved).toBe(true);
    expect(result.skip).toBeUndefined();
    expect(result.days).toBe(AFTER_DAYS);
    expect(result.account).toMatchObject({
      tier: TOP,
      tierExpiresAt: ENDS,
      cohort: AFTER_PLAN.cohort,
      trialStartedAt: SETTLED,
      trialEndsAt: plus(SETTLED, AFTER_DAYS),
    });
    // U-3: the first cancel reads period end + 15 days with today's 1-day margin.
    expect(result.account.trialEndsAt).toBe(plus(ENDS, 15));
  });

  it('S-2: an immediate cancel of an already lapsed tier (past_due) starts at endsAt', () => {
    const result = afterPlanAccount(lapsed({ cohort: AFTER_PLAN.cohort, onboardingStartedAt: '2026-01-01T00:00:00.000Z' }), ENDS, INPUTS, FIRST);
    expect(result.moved).toBe(true);
    expect(result.account.trialStartedAt).toBe(ENDS);
    expect(result.account.trialEndsAt).toBe(plus(ENDS, AFTER_DAYS));
  });

  it('S-2: a row paid through INSIDE the margin after endsAt starts at its own settlement end', () => {
    const paidThrough = new Date(Date.parse(ENDS) + 12 * 60 * 60 * 1000).toISOString();
    const result = afterPlanAccount(periodEnd({ tierExpiresAt: paidThrough }), ENDS, INPUTS, FIRST);
    expect(result.moved).toBe(true);
    expect(result.account.trialStartedAt).toBe(tierSettlementEndsAt(paidThrough, LIFECYCLE_CONFIG.renewalSettlementMarginHistory));
    expect(result.account.tierExpiresAt).toBe(paidThrough);
  });

  it('a paying account with no cohort at all', () => {
    const result = afterPlanAccount(lapsed(), ENDS, INPUTS, FIRST);
    expect(result.moved).toBe(true);
    expect(result.account.cohort).toBe(AFTER_PLAN.cohort);
  });

  it('a Founding Partner whose free access ends BEFORE the paid plan does', () => {
    const result = afterPlanAccount(lapsed({ cohort: ADMIN_DATED, cohortExpiresAt: '2026-11-01T00:00:00.000Z' }), ENDS, INPUTS, FIRST);
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
    const result = afterPlanAccount(lapsed(), ENDS, inputs, FIRST, { cohort: 'renamed_free' as CohortId, repeat: AFTER_PLAN.repeat });
    expect(result.account.cohort).toBe('renamed_free');
    expect(result.account.trialEndsAt).toBe(plus(ENDS, 3));
  });

  it('a config entry naming a cohort with no duration cannot move anyone (no endless free plan)', () => {
    const result = afterPlanAccount(lapsed(), ENDS, INPUTS, FIRST, { cohort: ADMIN_DATED as CohortId, repeat: AFTER_PLAN.repeat });
    expect(result).toMatchObject({ moved: false, days: null, skip: 'after_plan_misconfigured' });
    expect(result.account.cohort).toBeNull();
  });

  it('an unreadable endsAt moves nothing', () => {
    expect(afterPlanAccount(periodEnd(), 'not a date', INPUTS, FIRST)).toMatchObject({ moved: false, skip: 'no_end_date' });
  });
});

describe('S-11 replacement (PLAN PAYMENTS condition 3): the rule never writes the paid tier', () => {
  it('a row paid through LATER than endsAt + the margin: nothing moves, paid_through_after_end', () => {
    const before = periodEnd({ tierExpiresAt: plus(ENDS, 30) });
    const result = afterPlanAccount(before, ENDS, INPUTS, FIRST);
    expect(result).toMatchObject({ moved: false, days: null, skip: 'paid_through_after_end' });
    expect(result.account).toEqual(before);
  });

  it('a tier with no end date: nothing moves, paid_through_after_end', () => {
    expect(afterPlanAccount(periodEnd({ tierExpiresAt: null }), ENDS, INPUTS, FIRST).skip).toBe('paid_through_after_end');
  });

  it('a moved row keeps tierExpiresAt exactly as it was, in both directions', () => {
    for (const before of [periodEnd(), lapsed()]) {
      expect(afterPlanAccount(before, ENDS, INPUTS, FIRST).account.tierExpiresAt).toBe(before.tierExpiresAt);
    }
  });
});

describe('S-4: a stale grace pin', () => {
  it('earlier than the new trial end: cleared', () => {
    const result = afterPlanAccount(periodEnd({ graceEndsAt: '2026-06-01T00:00:00.000Z' }), ENDS, INPUTS, FIRST);
    expect(result.moved).toBe(true);
    expect(result.account.graceEndsAt).toBeNull();
  });

  it('later than the new trial end: kept', () => {
    const later = plus(ENDS, 60);
    expect(afterPlanAccount(periodEnd({ graceEndsAt: later }), ENDS, INPUTS, FIRST).account.graceEndsAt).toBe(later);
  });

  it('none: stays none', () => {
    expect(afterPlanAccount(periodEnd(), ENDS, INPUTS, FIRST).account.graceEndsAt).toBeNull();
  });
});

describe('a surviving own cohort is left alone (SA R-4a: never downgrade a champion)', () => {
  it('a dated Founding Partner live past the period end: unchanged, for every priorMoves', () => {
    const before = periodEnd({ cohort: ADMIN_DATED, cohortExpiresAt: '2027-03-01T00:00:00.000Z' });
    for (const priorMoves of [0, 1, 5]) {
      const result = afterPlanAccount(before, ENDS, INPUTS, { priorMoves });
      expect(result).toMatchObject({ moved: false, days: null, skip: 'own_cohort_survives' });
      expect(result.account).toEqual(before);
    }
  });

  it('an open-ended Founding Partner: unchanged', () => {
    const before = periodEnd({ cohort: ADMIN_DATED, cohortExpiresAt: null });
    const result = afterPlanAccount(before, ENDS, INPUTS, { priorMoves: 3 });
    expect(result.moved).toBe(false);
    expect(result.account.cohort).toBe(ADMIN_DATED);
  });

  it('agrees with P-7a.3: wherever freeAccessAfterPaidTier answers, nothing moves', () => {
    const before = periodEnd({ cohort: ADMIN_DATED, cohortExpiresAt: '2027-03-01T00:00:00.000Z' });
    expect(freeAccessAfterPaidTier({ ...before, tierExpiresAt: ENDS }, INPUTS)).not.toBeNull();
    expect(afterPlanAccount(before, ENDS, INPUTS, FIRST).moved).toBe(false);
  });

  it('an unexpired trial resumes as it is', () => {
    const before = periodEnd({ trialStartedAt: '2026-11-20T00:00:00.000Z' });
    const result = afterPlanAccount(before, ENDS, INPUTS, FIRST);
    expect(result.moved).toBe(false);
    expect(result.account.trialStartedAt).toBe('2026-11-20T00:00:00.000Z');
  });
});

describe('DR-4: the resolution order is paid-through, survival, halving, start, pin', () => {
  it('paid-through is decided before survival: a live Founding Partner paid through after the end reads paid_through_after_end', () => {
    const before = periodEnd({ cohort: ADMIN_DATED, cohortExpiresAt: null, tierExpiresAt: plus(ENDS, 30) });
    expect(afterPlanAccount(before, ENDS, INPUTS, FIRST).skip).toBe('paid_through_after_end');
  });

  it('survival is decided before the halving config: a Founding Partner with a broken after-plan entry reads own_cohort_survives', () => {
    const before = periodEnd({ cohort: ADMIN_DATED, cohortExpiresAt: null });
    const broken: AfterPlanConfig = { cohort: AFTER_PLAN.cohort, repeat: { divisor: 0, minimumDays: 0 } };
    expect(afterPlanAccount(before, ENDS, INPUTS, FIRST, broken).skip).toBe('own_cohort_survives');
  });

  it('the pin is judged against the HALVED end: a pin between the halved and the first-time end', () => {
    const pin = plus(SETTLED, 10); // after a 4-day end, before a 14-day end
    expect(afterPlanAccount(periodEnd({ graceEndsAt: pin }), ENDS, INPUTS, { priorMoves: 2 }).account.graceEndsAt).toBe(pin);
    expect(afterPlanAccount(periodEnd({ graceEndsAt: pin }), ENDS, INPUTS, { priorMoves: 0 }).account.graceEndsAt).toBeNull();
  });
});

describe('purity', () => {
  it('never mutates its input (it may be the service cache\'s own object)', () => {
    const before = Object.freeze(periodEnd({ graceEndsAt: '2026-06-01T00:00:00.000Z' }));
    const copy = JSON.stringify(before);
    const result = afterPlanAccount(before, ENDS, INPUTS, { priorMoves: 2 });
    expect(JSON.stringify(before)).toBe(copy);
    expect(result.account).not.toBe(before);
    const skipped = afterPlanAccount(before, ENDS, INPUTS, FIRST, { cohort: ADMIN_DATED as CohortId, repeat: AFTER_PLAN.repeat });
    expect(skipped.account).not.toBe(before);
  });

  it.each(['afterPlan.ts', 'planEndingView.ts', 'freeAccess.ts'])('%s names no cohort id', (file) => {
    const source = readFileSync(join(process.cwd(), 'lib', 'business-os', 'entitlements', file), 'utf8');
    for (const id of COHORT_IDS) {
      expect(source).not.toMatch(new RegExp(`['"\`]${id}['"\`]`));
    }
  });
});
