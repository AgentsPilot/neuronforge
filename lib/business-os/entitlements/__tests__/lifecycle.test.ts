/**
 * The state machine: RC-11 precedence, A-1's expired-tier fallback, and S-7's
 * histories.
 *
 * Every case injects `now`, because a test that used the wall clock would pass
 * today and fail on the day a trial length changes.
 */

import { COHORTS } from '@/lib/business-os/entitlements/config/cohorts';
import { LIFECYCLE_CONFIG } from '@/lib/business-os/entitlements/config/lifecycle';
import { deriveLifecycle, historyAt, tierSettlementEndsAt } from '@/lib/business-os/entitlements/lifecycle';
import { lifecycleSchema } from '@/lib/business-os/entitlements/schema';
import { planBadgeFor } from '@/lib/business-os/entitlements/planBadge';
import { resolveEntitlements } from '@/lib/business-os/entitlements/resolver';
import { readCodeConfig } from '@/lib/business-os/entitlements/source';
import type { LifecycleInputs } from '@/lib/business-os/entitlements/lifecycle';
import type { HistoryEntry } from '@/lib/business-os/entitlements/types';
import { account, championAccount, tierAccount, trialAccount } from '@/lib/business-os/entitlements/__fixtures__/accounts';

const INPUTS: LifecycleInputs = {
  cohorts: COHORTS,
  tierOrder: ['basic', 'growth', 'pro'],
  subscriptionGraceHistory: LIFECYCLE_CONFIG.subscriptionGraceHistory,
  renewalSettlementMarginHistory: LIFECYCLE_CONFIG.renewalSettlementMarginHistory,
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
    // Grace from the tier's end, not from March: the tier ended last, so the
    // subscription grace in force on 20 September (7 days) applies (BQ-P12),
    // and it starts after the 24-hour renewal settlement margin (FC-1, P-6a.1).
    expect(result).toMatchObject({ state: 'grace', graceEndsAt: '2026-09-28T00:00:00.000Z' });
    expect(deriveLifecycle(acct, INPUTS, at('2026-10-01T00:00:00.000Z')).state).toBe('paused');
  });

  it('A-1 + BQ-P12: a former Founding Partner whose free access ended while paying gets the SUBSCRIPTION grace', () => {
    // The third decision in that branch (QA C-2). Until 2026-10-15 the cohort's
    // grace won here (the champion's 30 days). The user decided BQ-P12 on
    // 2026-10-15: "5 days, like every paying customer". The champion's free
    // access ended in May; the paid tier was the last thing in force, so this
    // account was a paying customer when it lapsed and gets the subscription
    // grace, exactly as an account with no cohort does.
    const acct = tierAccount('growth', {
      tierExpiresAt: '2026-09-20T00:00:00.000Z',
      cohort: 'champion',
      cohortExpiresAt: '2026-05-01T00:00:00.000Z',
    });

    const result = deriveLifecycle(acct, INPUTS, NOW);

    expect(result.basis).toEqual({ kind: 'tier', tier: 'growth' }); // basis: the tier
    expect(result.accessEndsAt).toBe('2026-09-20T00:00:00.000Z'); // end: the later date
    // length: the subscription grace in force on 20 September (7 days, before
    // the 5-day entry), started after the 24-hour margin. NOT the champion's 30.
    expect(result.graceEndsAt).toBe('2026-09-28T00:00:00.000Z');
    expect(result).toMatchObject({ state: 'grace', reason: 'tier_and_cohort_ended' });

    // The contrast that makes the assertion mean something: the same account
    // with no cohort at all gets the very same grace end.
    const noCohort = deriveLifecycle(tierAccount('growth', { tierExpiresAt: '2026-09-20T00:00:00.000Z' }), INPUTS, NOW);
    expect(noCohort.graceEndsAt).toBe(result.graceEndsAt);
  });

  it('A-1: an expired tier with NO cohort uses the subscription grace history, after the margin', () => {
    const acct = tierAccount('pro', { tierExpiresAt: '2026-09-20T00:00:00.000Z' });
    const result = deriveLifecycle(acct, INPUTS, NOW);

    const days = LIFECYCLE_CONFIG.subscriptionGraceHistory[0].days;
    const marginDays = LIFECYCLE_CONFIG.renewalSettlementMarginHistory[0].days;
    expect(result).toMatchObject({ state: 'grace', reason: 'tier_expired_no_cohort', basis: { kind: 'tier', tier: 'pro' } });
    expect(result.graceEndsAt).toBe(
      new Date(Date.parse('2026-09-20T00:00:00.000Z') + (marginDays + days) * 86400000).toISOString()
    );
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

// ── P-6a.1: the renewal settlement margin (PF-10, FC-1), the 5-day grace (PF-1)
// and BQ-P12. Dates sit after the 5-day entry's effective date unless a test is
// about that boundary, so each one names the grace it expects from config.
describe('P-6a.1 — renewal settlement margin, 5-day grace, BQ-P12', () => {
  const DAY = 86400000;
  const HOUR = 60 * 60 * 1000;
  const plus = (iso: string, ms: number) => new Date(Date.parse(iso) + ms).toISOString();
  const [, fiveDayEntry] = LIFECYCLE_CONFIG.subscriptionGraceHistory;
  const P6A_EFFECTIVE = fiveDayEntry.effectiveFrom;
  const MARGIN_DAYS = LIFECYCLE_CONFIG.renewalSettlementMarginHistory[0].days;
  const CHAMPION_GRACE_DAYS = COHORTS.champion.graceHistory[0].days;
  // A paid-through date well after the 5-day entry, as every new subscription has.
  const T = '2026-11-10T00:00:00.000Z';

  it('config: the 5-day entry is APPENDED after the shipped 7 days, and the margin is 24 hours', () => {
    expect(LIFECYCLE_CONFIG.subscriptionGraceHistory.map((entry) => entry.days)).toEqual([7, 5]);
    expect(LIFECYCLE_CONFIG.renewalSettlementMarginHistory).toEqual([{ effectiveFrom: P6A_EFFECTIVE, days: 1 }]);
    // C-8: a fixed literal, never earlier than the merge. It must at least not
    // predate the day this was written.
    expect(Date.parse(P6A_EFFECTIVE)).toBeGreaterThanOrEqual(Date.parse('2026-10-16T00:00:00.000Z'));
  });

  it('tierSettlementEndsAt: the paid-through date plus the margin; no margin history means no margin', () => {
    expect(tierSettlementEndsAt(T, LIFECYCLE_CONFIG.renewalSettlementMarginHistory)).toBe(plus(T, MARGIN_DAYS * DAY));
    expect(tierSettlementEndsAt(T, [])).toBe(T);
    // Q-2: the earliest-entry rule applies the margin to older access ends too
    // (it only ever lengthens access).
    expect(tierSettlementEndsAt('2026-09-20T00:00:00.000Z', LIFECYCLE_CONFIG.renewalSettlementMarginHistory)).toBe(
      '2026-09-21T00:00:00.000Z'
    );
  });

  it('PF-10: inside the margin the tier is still in force, and accessEndsAt stays the paid-through date', () => {
    const acct = tierAccount('basic', { tierExpiresAt: T });

    expect(deriveLifecycle(acct, INPUTS, at(plus(T, -1000)))).toMatchObject({ state: 'active', reason: 'tier_in_force' });
    for (const offset of [0, HOUR, DAY - 1]) {
      expect(deriveLifecycle(acct, INPUTS, at(plus(T, offset)))).toMatchObject({
        state: 'active',
        basis: { kind: 'tier', tier: 'basic' },
        reason: 'tier_in_settlement_margin',
        accessEndsAt: T,
        graceEndsAt: null,
      });
    }
  });

  it('PF-1: at T + 24 h grace starts and runs 5 days; then paused', () => {
    const acct = tierAccount('basic', { tierExpiresAt: T });
    const graceEnds = plus(T, (MARGIN_DAYS + 5) * DAY);

    expect(deriveLifecycle(acct, INPUTS, at(plus(T, MARGIN_DAYS * DAY)))).toMatchObject({
      state: 'grace',
      reason: 'tier_expired_no_cohort',
      accessEndsAt: T,
      graceEndsAt: graceEnds,
    });
    expect(deriveLifecycle(acct, INPUTS, at(plus(graceEnds, -1000))).state).toBe('grace');
    expect(deriveLifecycle(acct, INPUTS, at(graceEnds)).state).toBe('paused');
  });

  it('PF-1 boundary: the grace length is the one in force at the paid-through date (7 before the entry, 5 from it)', () => {
    const justBefore = plus(P6A_EFFECTIVE, -1000);
    const before = deriveLifecycle(tierAccount('basic', { tierExpiresAt: justBefore }), INPUTS, at(plus(P6A_EFFECTIVE, 2 * DAY)));
    expect(before.graceEndsAt).toBe(plus(justBefore, (MARGIN_DAYS + 7) * DAY));

    const onTheDay = deriveLifecycle(tierAccount('basic', { tierExpiresAt: P6A_EFFECTIVE }), INPUTS, at(plus(P6A_EFFECTIVE, 2 * DAY)));
    expect(onTheDay.graceEndsAt).toBe(plus(P6A_EFFECTIVE, (MARGIN_DAYS + 5) * DAY));
  });

  it("an admin's grace pin still wins over the derived date", () => {
    const pin = '2026-12-31T00:00:00.000Z';
    const acct = tierAccount('basic', { tierExpiresAt: T, graceEndsAt: pin });

    expect(deriveLifecycle(acct, INPUTS, at(plus(T, 10 * DAY)))).toMatchObject({ state: 'grace', graceEndsAt: pin });
    expect(deriveLifecycle(acct, INPUTS, at(pin)).state).toBe('paused');
  });

  it('FC-1: a dated tier over a LIVE Founding Partner cohort stays on the tier for the whole margin, never champion', () => {
    const acct = tierAccount('basic', { tierExpiresAt: T, cohort: 'champion', cohortExpiresAt: null });

    for (const offset of [0, HOUR, DAY - 1]) {
      const result = deriveLifecycle(acct, INPUTS, at(plus(T, offset)));
      expect(result).toMatchObject({ state: 'active', basis: { kind: 'tier', tier: 'basic' }, reason: 'tier_in_settlement_margin' });
    }
  });

  it('AC-F6.5: after the margin, a Founding Partner whose free access is still live is a Founding Partner again: no grace, no pause', () => {
    const acct = tierAccount('basic', { tierExpiresAt: T, cohort: 'champion', cohortExpiresAt: '2027-06-01T00:00:00.000Z' });

    for (const offset of [MARGIN_DAYS * DAY, 6 * DAY, 60 * DAY]) {
      const result = deriveLifecycle(acct, INPUTS, at(plus(T, offset)));
      expect(result).toMatchObject({ state: 'champion', basis: { kind: 'cohort', cohort: 'champion' }, graceEndsAt: null });
      expect(result.reason).toMatch(/^tier_expired_/);
    }
  });

  it('AC-F6.5: the Founding Partner pill comes back after the margin, not before', () => {
    const config = readCodeConfig();
    const [paidTier] = config.tierOrder;
    const cohorts = config.cohorts as Readonly<Record<string, { durationHistory?: unknown }>>;
    const champion = Object.keys(cohorts).find((id) => !cohorts[id].durationHistory) as string;
    const resolutionAt = (now: Date) =>
      resolveEntitlements({
        config,
        account: tierAccount(paidTier, { tierExpiresAt: T, cohort: champion, cohortExpiresAt: null }),
        overrides: [],
        addons: [],
        now,
      });

    expect(planBadgeFor(resolutionAt(at(plus(T, HOUR))), config)).toBeNull();
    expect(planBadgeFor(resolutionAt(at(plus(T, MARGIN_DAYS * DAY))), config)).not.toBeNull();
  });

  it('BQ-P12: a former Founding Partner whose free access ended while paying gets 5 days on a failed renewal, not 30', () => {
    const acct = tierAccount('basic', { tierExpiresAt: T, cohort: 'champion', cohortExpiresAt: '2026-11-01T00:00:00.000Z' });
    const graceEnds = plus(T, (MARGIN_DAYS + 5) * DAY);

    expect(deriveLifecycle(acct, INPUTS, at(plus(T, 2 * DAY)))).toMatchObject({
      state: 'grace',
      basis: { kind: 'tier', tier: 'basic' },
      reason: 'tier_and_cohort_ended',
      accessEndsAt: T,
      graceEndsAt: graceEnds,
    });
    expect(deriveLifecycle(acct, INPUTS, at(graceEnds)).state).toBe('paused');
    // The contrast: the champion's own grace is far longer, and is NOT used.
    expect(CHAMPION_GRACE_DAYS).toBeGreaterThan(5);
  });

  it('BQ-P12: free access that ends inside the margin is still "ended while paying": subscription grace from T + 24 h', () => {
    const cohortEnd = plus(T, 12 * HOUR);
    const acct = tierAccount('basic', { tierExpiresAt: T, cohort: 'champion', cohortExpiresAt: cohortEnd });

    const result = deriveLifecycle(acct, INPUTS, at(plus(T, 2 * DAY)));
    expect(result.accessEndsAt).toBe(cohortEnd);
    expect(result.graceEndsAt).toBe(plus(T, (MARGIN_DAYS + 5) * DAY));
  });

  it('BQ-P12 boundary: a Founding Partner whose free access OUTLIVED the paid tier keeps the champion grace when it ends', () => {
    // They went back to Founding Partner when the subscription ended (AC-F6.5),
    // and their free access ran out later. Having paid for a while must not
    // make that lapse worse than any other Founding Partner's.
    const cohortEnd = '2026-12-01T00:00:00.000Z';
    const acct = tierAccount('basic', { tierExpiresAt: T, cohort: 'champion', cohortExpiresAt: cohortEnd });

    expect(deriveLifecycle(acct, INPUTS, at('2026-11-20T00:00:00.000Z')).state).toBe('champion');
    expect(deriveLifecycle(acct, INPUTS, at(plus(cohortEnd, DAY)))).toMatchObject({
      state: 'grace',
      basis: { kind: 'tier', tier: 'basic' },
      accessEndsAt: cohortEnd,
      graceEndsAt: plus(cohortEnd, CHAMPION_GRACE_DAYS * DAY),
    });
  });

  it('cohort branches get NO margin: a dated champion and a trial end exactly on their own dates', () => {
    const championEnd = '2026-11-10T00:00:00.000Z';
    expect(deriveLifecycle(championAccount({ cohortExpiresAt: championEnd }), INPUTS, at(championEnd))).toMatchObject({
      state: 'grace',
      graceEndsAt: plus(championEnd, CHAMPION_GRACE_DAYS * DAY),
    });

    const trial = trialAccount('2026-11-01T00:00:00.000Z');
    const trialEnd = deriveLifecycle(trial, INPUTS, at('2026-11-02T00:00:00.000Z')).trial?.endsAt as string;
    expect(deriveLifecycle(trial, INPUTS, at(trialEnd)).state).toBe('grace');
  });

  it('an open-ended tier is unaffected by the margin', () => {
    expect(deriveLifecycle(tierAccount('basic'), INPUTS, at('2030-01-01T00:00:00.000Z'))).toMatchObject({
      state: 'active',
      reason: 'tier_in_force_no_end_date',
    });
  });

  it('schema: the margin history obeys the same rules as every lifecycle duration (refuses 0, unsorted, empty, missing)', () => {
    const schema = lifecycleSchema();
    expect(schema.safeParse(LIFECYCLE_CONFIG).success).toBe(true);

    const withMargin = (margin: unknown) => schema.safeParse({ ...LIFECYCLE_CONFIG, renewalSettlementMarginHistory: margin }).success;
    expect(withMargin([{ effectiveFrom: P6A_EFFECTIVE, days: 0 }])).toBe(false);
    expect(withMargin([])).toBe(false);
    expect(
      withMargin([
        { effectiveFrom: '2027-01-01T00:00:00.000Z', days: 1 },
        { effectiveFrom: '2026-12-01T00:00:00.000Z', days: 2 },
      ])
    ).toBe(false);

    const withoutMargin: Record<string, unknown> = { ...LIFECYCLE_CONFIG };
    delete withoutMargin.renewalSettlementMarginHistory;
    expect(schema.safeParse(withoutMargin).success).toBe(false);
  });
});
