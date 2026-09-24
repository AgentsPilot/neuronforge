/**
 * The state machine: RC-11 precedence, A-1's expired-tier fallback, and S-7's
 * histories.
 *
 * Every case injects `now`, because a test that used the wall clock would pass
 * today and fail on the day a trial length changes.
 */

import { COHORTS } from '@/lib/business-os/entitlements/config/cohorts';
import { LIFECYCLE_CONFIG } from '@/lib/business-os/entitlements/config/lifecycle';
import { deriveLifecycle, historyAt } from '@/lib/business-os/entitlements/lifecycle';
import type { LifecycleInputs } from '@/lib/business-os/entitlements/lifecycle';
import type { HistoryEntry } from '@/lib/business-os/entitlements/types';
import { account, championAccount, tierAccount, trialAccount } from '@/lib/business-os/entitlements/__fixtures__/accounts';

const INPUTS: LifecycleInputs = {
  cohorts: COHORTS,
  tierOrder: ['basic', 'growth', 'pro'],
  subscriptionGraceHistory: LIFECYCLE_CONFIG.subscriptionGraceHistory,
};

const at = (iso: string) => new Date(iso);

describe('historyAt — S-7', () => {
  const history: HistoryEntry[] = [
    { effectiveFrom: '2026-01-01T00:00:00.000Z', days: 14 },
    { effectiveFrom: '2026-06-01T00:00:00.000Z', days: 7 },
  ];

  it('picks the entry in force at that moment', () => {
    expect(historyAt(history, at('2026-03-01T00:00:00.000Z'))?.days).toBe(14);
    expect(historyAt(history, at('2026-07-01T00:00:00.000Z'))?.days).toBe(7);
  });

  it('uses the earliest entry for a moment before any of them', () => {
    // A trial that started before this module shipped still needs an answer, and
    // the earliest entry is the closest thing to what was promised.
    expect(historyAt(history, at('2025-01-01T00:00:00.000Z'))?.days).toBe(14);
  });

  it('has no answer for an empty history', () => {
    expect(historyAt([], at('2026-01-01T00:00:00.000Z'))).toBeNull();
  });

  it('does not shorten a trial that is already running', () => {
    // The point of the whole mechanism: shortening the trial on 1 June must not
    // end a trial that started in March.
    const started = '2026-03-01T00:00:00.000Z';
    const result = deriveLifecycle(trialAccount(started), { ...INPUTS, cohorts: { ...COHORTS, trial: { ...COHORTS.trial, durationHistory: history } } }, at('2026-03-10T00:00:00.000Z'));
    expect(result.trial?.endsAt).toBe('2026-03-15T00:00:00.000Z');
    expect(result.state).toBe('trial');
  });
});

describe('anomalies', () => {
  it('has no plan row', () => {
    const result = deriveLifecycle(null, INPUTS, at('2026-09-22T00:00:00.000Z'));
    expect(result).toMatchObject({ state: 'unknown', anomaly: 'no_plan_row', basis: { kind: 'none' } });
  });

  it('has neither a tier nor a cohort', () => {
    expect(deriveLifecycle(account(), INPUTS, at('2026-09-22T00:00:00.000Z')).anomaly).toBe('no_assignment');
  });

  it('names a tier the config does not have', () => {
    expect(deriveLifecycle(tierAccount('platinum'), INPUTS, at('2026-09-22T00:00:00.000Z')).anomaly).toBe('unknown_tier');
  });

  it('names a cohort the config does not have', () => {
    expect(deriveLifecycle(account({ cohort: 'founder' }), INPUTS, at('2026-09-22T00:00:00.000Z')).anomaly).toBe('unknown_cohort');
  });

  it('does NOT call an open-ended champion an anomaly (RC-4)', () => {
    const result = deriveLifecycle(championAccount(), INPUTS, at('2030-01-01T00:00:00.000Z'));
    expect(result.anomaly).toBeUndefined();
    expect(result.state).toBe('champion');
  });
});

describe('the cohort branches', () => {
  it('a champion with no end date never ends', () => {
    const result = deriveLifecycle(championAccount(), INPUTS, at('2099-01-01T00:00:00.000Z'));
    expect(result).toMatchObject({ state: 'champion', reason: 'champion_open_ended', accessEndsAt: null });
  });

  it('a champion with a date runs out, then has 30 days of grace (D-4)', () => {
    const acct = championAccount({ cohortExpiresAt: '2026-09-01T00:00:00.000Z' });

    expect(deriveLifecycle(acct, INPUTS, at('2026-08-31T00:00:00.000Z')).state).toBe('champion');
    expect(deriveLifecycle(acct, INPUTS, at('2026-09-15T00:00:00.000Z'))).toMatchObject({
      state: 'grace',
      graceEndsAt: '2026-10-01T00:00:00.000Z',
    });
    expect(deriveLifecycle(acct, INPUTS, at('2026-10-02T00:00:00.000Z')).state).toBe('paused');
  });

  it('a trial runs 14 days from the first onboarding message, then 7 days of grace', () => {
    const acct = trialAccount('2026-09-01T00:00:00.000Z');

    expect(deriveLifecycle(acct, INPUTS, at('2026-09-10T00:00:00.000Z'))).toMatchObject({
      state: 'trial',
      trial: { startedAt: '2026-09-01T00:00:00.000Z', endsAt: '2026-09-15T00:00:00.000Z' },
    });
    expect(deriveLifecycle(acct, INPUTS, at('2026-09-16T00:00:00.000Z'))).toMatchObject({
      state: 'grace',
      graceEndsAt: '2026-09-22T00:00:00.000Z',
    });
    expect(deriveLifecycle(acct, INPUTS, at('2026-09-23T00:00:00.000Z')).state).toBe('paused');
  });

  it("a trial whose clock fact hasn't happened yet is still setting up", () => {
    // Q-B3: with `clockStartsAt: 'profile_created'`, an account that has only
    // sent onboarding messages has not started its trial. It is not expired and
    // it is not an anomaly — setup is in progress.
    const cohorts = { ...COHORTS, trial: { ...COHORTS.trial, clockStartsAt: 'profile_created' as const } };
    const result = deriveLifecycle(trialAccount('2026-01-01T00:00:00.000Z'), { ...INPUTS, cohorts }, at('2026-09-22T00:00:00.000Z'));

    expect(result).toMatchObject({ state: 'trial', reason: 'trial_not_started', accessEndsAt: null });
    expect(result.anomaly).toBeUndefined();
  });

  it('an admin pin beats the derived dates', () => {
    const acct = trialAccount('2026-09-01T00:00:00.000Z', {
      trialStartedAt: '2026-09-10T00:00:00.000Z',
      trialEndsAt: '2026-12-01T00:00:00.000Z',
      graceEndsAt: '2026-12-31T00:00:00.000Z',
    });

    expect(deriveLifecycle(acct, INPUTS, at('2026-11-01T00:00:00.000Z'))).toMatchObject({
      state: 'trial',
      trial: { startedAt: '2026-09-10T00:00:00.000Z', endsAt: '2026-12-01T00:00:00.000Z' },
    });
    expect(deriveLifecycle(acct, INPUTS, at('2026-12-15T00:00:00.000Z'))).toMatchObject({
      state: 'grace',
      graceEndsAt: '2026-12-31T00:00:00.000Z',
    });
  });
});

describe('RC-11 + A-1 — the tier/cohort matrix', () => {
  const NOW = at('2026-09-22T00:00:00.000Z');

  it('a tier in force beats a live cohort, and the cohort is ignored', () => {
    const acct = tierAccount('growth', { cohort: 'champion', cohortExpiresAt: null });
    const result = deriveLifecycle(acct, INPUTS, NOW);

    expect(result).toMatchObject({ state: 'active', basis: { kind: 'tier', tier: 'growth' }, reason: 'tier_in_force_no_end_date' });
  });

  it('a tier with a future end date is still in force', () => {
    const acct = tierAccount('pro', { tierExpiresAt: '2027-01-01T00:00:00.000Z' });
    expect(deriveLifecycle(acct, INPUTS, NOW)).toMatchObject({ state: 'active', reason: 'tier_in_force' });
  });

  it('A-1: an expired tier falls back to a LIVE champion, who is a champion again', () => {
    const acct = tierAccount('pro', { tierExpiresAt: '2026-09-01T00:00:00.000Z', cohort: 'champion', cohortExpiresAt: null });
    const result = deriveLifecycle(acct, INPUTS, NOW);

    expect(result).toMatchObject({ state: 'champion', basis: { kind: 'cohort', cohort: 'champion' } });
    expect(result.reason).toMatch(/^tier_expired_/);
  });

  it('A-1: an expired tier falls back to a trial that is still running', () => {
    const acct = tierAccount('pro', {
      tierExpiresAt: '2026-09-20T00:00:00.000Z',
      cohort: 'trial',
      onboardingStartedAt: '2026-09-15T00:00:00.000Z',
    });

    expect(deriveLifecycle(acct, INPUTS, NOW)).toMatchObject({ state: 'trial', basis: { kind: 'cohort', cohort: 'trial' } });
  });

  it('A-1: when both have ended, grace runs from the LATER of the two dates', () => {
    // The case the rule exists for: an account upgraded mid-trial must not be
    // pushed into grace by a trial end date that passed while it was paying.
    const acct = tierAccount('pro', {
      tierExpiresAt: '2026-09-20T00:00:00.000Z',
      cohort: 'trial',
      // A trial that ended in March, long before the tier did.
      onboardingStartedAt: '2026-03-01T00:00:00.000Z',
    });

    const result = deriveLifecycle(acct, INPUTS, NOW);
    expect(result.accessEndsAt).toBe('2026-09-20T00:00:00.000Z');
    // 7 days of trial grace from the tier's end, not from March.
    expect(result).toMatchObject({ state: 'grace', graceEndsAt: '2026-09-27T00:00:00.000Z' });
    expect(deriveLifecycle(acct, INPUTS, at('2026-10-01T00:00:00.000Z')).state).toBe('paused');
  });

  it('A-1: when both have ended, the COHORT sets the grace length (QA C-2)', () => {
    // The third decision in that branch, and the one §4.8 did not state until
    // QA asked. A lapsed subscriber who was also a lapsed champion keeps the
    // champion's 30 days rather than dropping to the subscription grace — the
    // alternative would mean having been a champion made their lapse worse.
    const acct = tierAccount('growth', {
      tierExpiresAt: '2026-09-20T00:00:00.000Z',
      cohort: 'champion',
      cohortExpiresAt: '2026-05-01T00:00:00.000Z',
    });

    const result = deriveLifecycle(acct, INPUTS, NOW);

    expect(result.basis).toEqual({ kind: 'tier', tier: 'growth' }); // basis: the tier
    expect(result.accessEndsAt).toBe('2026-09-20T00:00:00.000Z'); // end: the later date
    expect(result.graceEndsAt).toBe('2026-10-20T00:00:00.000Z'); // length: champion's 30 days
    expect(result.state).toBe('grace');

    // The contrast that makes the assertion mean something: the same account
    // with no cohort at all gets the SHORTER subscription grace.
    const noCohort = deriveLifecycle(tierAccount('growth', { tierExpiresAt: '2026-09-20T00:00:00.000Z' }), INPUTS, NOW);
    expect(new Date(noCohort.graceEndsAt as string).getTime()).toBeLessThan(
      new Date(result.graceEndsAt as string).getTime()
    );
  });

  it('A-1: an expired tier with NO cohort uses the subscription grace history', () => {
    const acct = tierAccount('pro', { tierExpiresAt: '2026-09-20T00:00:00.000Z' });
    const result = deriveLifecycle(acct, INPUTS, NOW);

    const days = LIFECYCLE_CONFIG.subscriptionGraceHistory[0].days;
    expect(result).toMatchObject({ state: 'grace', reason: 'tier_expired_no_cohort', basis: { kind: 'tier', tier: 'pro' } });
    expect(result.graceEndsAt).toBe(new Date(Date.parse('2026-09-20T00:00:00.000Z') + days * 86400000).toISOString());
  });

  it('covers the full matrix without an unknown state', () => {
    // A cheap sweep: every combination the requirement lists must produce a
    // state the overlay table has a row for. A gap here would surface later as
    // "cannot read property of undefined" inside decide().
    const tiers = [null, { tier: 'growth', tierExpiresAt: null }, { tier: 'growth', tierExpiresAt: '2027-01-01T00:00:00.000Z' }, { tier: 'growth', tierExpiresAt: '2026-01-01T00:00:00.000Z' }];
    const cohorts = [
      null,
      { cohort: 'trial', onboardingStartedAt: '2026-09-20T00:00:00.000Z' },
      { cohort: 'trial', onboardingStartedAt: '2026-01-01T00:00:00.000Z' },
      { cohort: 'champion', cohortExpiresAt: null },
      { cohort: 'champion', cohortExpiresAt: '2026-01-01T00:00:00.000Z' },
    ];
    const clocks = [
      '2026-09-22T00:00:00.000Z',
      '2026-09-25T00:00:00.000Z',
      // Inside the grace window of the trial that started on 20 September:
      // without a clock here the sweep never produces `grace`, and the
      // non-vacuity assertion below is what catches that.
      '2026-10-06T00:00:00.000Z',
      '2027-06-01T00:00:00.000Z',
    ];

    const states = new Set<string>();
    for (const t of tiers) {
      for (const c of cohorts) {
        for (const clock of clocks) {
          if (!t && !c) continue; // the anomaly case, covered above
          const result = deriveLifecycle(account({ ...(t ?? {}), ...(c ?? {}), planVersion: t ? 1 : 0 }), INPUTS, at(clock));
          expect(LIFECYCLE_CONFIG.overlay[result.state]).toBeDefined();
          states.add(result.state);
        }
      }
    }

    // Non-vacuity: if the sweep only ever produced `active`, the assertion above
    // would pass while proving nothing.
    expect([...states].sort()).toEqual(['active', 'champion', 'grace', 'paused', 'trial']);
  });
});
