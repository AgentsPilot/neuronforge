/**
 * hasOpenEndedFreeAccess (plan payments P-4.1, BQ-P10; SA Q-1, Q-7).
 *
 * Driven through the REAL lifecycle derivation, so the rule is tested on the
 * resolutions production produces, not on hand-made shapes. The cohort with no
 * duration and the cohort with one are found by STRUCTURE in the production
 * config, and a fixture config with renamed cohorts proves no name is read.
 */

import { readFileSync } from 'fs';
import { join } from 'path';

import { COHORTS } from '@/lib/business-os/entitlements/config/cohorts';
import { LIFECYCLE_CONFIG } from '@/lib/business-os/entitlements/config/lifecycle';
import { TIER_ORDER } from '@/lib/business-os/entitlements/config/tierMatrix';
import { freeAccessEndedByPurchase, hasOpenEndedFreeAccess } from '@/lib/business-os/entitlements/freeAccess';
import { deriveLifecycle, type LifecycleInputs } from '@/lib/business-os/entitlements/lifecycle';
import { account } from '@/lib/business-os/entitlements/__fixtures__/accounts';
import type { CohortConfig } from '@/lib/business-os/entitlements/config/cohorts';

const NOW = new Date('2026-10-13T12:00:00.000Z');
const PAST = '2026-10-01T00:00:00.000Z';
const FUTURE = '2026-12-01T00:00:00.000Z';
const TIER = TIER_ORDER[0];

const cohortEntries = Object.entries(COHORTS) as Array<[string, CohortConfig]>;
/** The admin-dated cohort (no duration), found by structure, never by name. */
const ADMIN_DATED = cohortEntries.find(([, config]) => !config.durationHistory)![0];
/** The timed cohort (a trial), found by structure. */
const TIMED = cohortEntries.find(([, config]) => !!config.durationHistory)![0];

const INPUTS: LifecycleInputs = {
  cohorts: COHORTS,
  tierOrder: TIER_ORDER,
  subscriptionGraceHistory: LIFECYCLE_CONFIG.subscriptionGraceHistory,
  renewalSettlementMarginHistory: LIFECYCLE_CONFIG.renewalSettlementMarginHistory,
};

const resolve = (overrides: Parameters<typeof account>[0], inputs: LifecycleInputs = INPUTS) =>
  deriveLifecycle(account(overrides), inputs, NOW);
const caught = (overrides: Parameters<typeof account>[0]) => {
  const lifecycle = resolve(overrides);
  return hasOpenEndedFreeAccess({ basis: lifecycle.basis, lifecycle });
};

describe('hasOpenEndedFreeAccess — BQ-P10 "Refuse until end date set"', () => {
  it('the production config has one cohort of each kind (non-vacuity)', () => {
    expect(ADMIN_DATED).toBeDefined();
    expect(TIMED).toBeDefined();
    expect(ADMIN_DATED).not.toBe(TIMED);
  });

  it('CAUGHT: a tierless admin-dated cohort with no end date', () => {
    expect(caught({ cohort: ADMIN_DATED, cohortExpiresAt: null })).toBe(true);
  });

  it('not caught: the same cohort with a future end date (F10: they may buy)', () => {
    expect(caught({ cohort: ADMIN_DATED, cohortExpiresAt: FUTURE })).toBe(false);
  });

  it('not caught: the same cohort whose end date passed (in grace)', () => {
    const lifecycle = resolve({ cohort: ADMIN_DATED, cohortExpiresAt: PAST });
    expect(lifecycle.basis).toEqual({ kind: 'cohort', cohort: ADMIN_DATED });
    expect(hasOpenEndedFreeAccess({ basis: lifecycle.basis, lifecycle })).toBe(false);
  });

  it('not caught: a timed cohort (a trial), live, ended, or with its clock not started', () => {
    expect(caught({ cohort: TIMED, onboardingStartedAt: '2026-10-10T00:00:00.000Z' })).toBe(false);
    expect(caught({ cohort: TIMED, onboardingStartedAt: '2026-01-01T00:00:00.000Z' })).toBe(false);
    expect(caught({ cohort: TIMED })).toBe(false);
  });

  it('not caught: a tier account, live or lapsed (paused / expired)', () => {
    expect(caught({ tier: TIER, planVersion: 1, tierExpiresAt: null })).toBe(false);
    expect(caught({ tier: TIER, planVersion: 1, tierExpiresAt: FUTURE })).toBe(false);
    expect(caught({ tier: TIER, planVersion: 1, tierExpiresAt: PAST })).toBe(false);
  });

  // SA Q-1: a live admin-assigned tier suspends the open-ended cohort, so
  // buying ends no free access; once that tier lapses the cohort resumes with
  // no end date and IS caught.
  it('Q-1: an open-ended cohort with a LIVE tier is not caught; once the tier lapses it is', () => {
    const liveTier = resolve({ cohort: ADMIN_DATED, cohortExpiresAt: null, tier: TIER, planVersion: 1, tierExpiresAt: FUTURE });
    expect(liveTier.basis.kind).toBe('tier');
    expect(hasOpenEndedFreeAccess({ basis: liveTier.basis, lifecycle: liveTier })).toBe(false);

    const lapsedTier = resolve({ cohort: ADMIN_DATED, cohortExpiresAt: null, tier: TIER, planVersion: 1, tierExpiresAt: PAST });
    expect(lapsedTier.basis).toEqual({ kind: 'cohort', cohort: ADMIN_DATED });
    expect(hasOpenEndedFreeAccess({ basis: lapsedTier.basis, lifecycle: lapsedTier })).toBe(true);
  });

  it('not caught: no plan row (basis none)', () => {
    const lifecycle = deriveLifecycle(null, INPUTS, NOW);
    expect(hasOpenEndedFreeAccess({ basis: lifecycle.basis, lifecycle })).toBe(false);
  });

  it('a cohort the config does not know is caught when it has no end (fail closed)', () => {
    expect(hasOpenEndedFreeAccess({ basis: { kind: 'cohort', cohort: 'not_configured' }, lifecycle: { accessEndsAt: null } })).toBe(true);
    expect(hasOpenEndedFreeAccess({ basis: { kind: 'cohort', cohort: 'not_configured' }, lifecycle: { accessEndsAt: FUTURE } })).toBe(false);
  });

  it('reads structure, not names: renamed cohorts give the same answers', () => {
    const renamed: Record<string, CohortConfig> = {
      alpha_partner: COHORTS[ADMIN_DATED as keyof typeof COHORTS],
      beta_preview: COHORTS[TIMED as keyof typeof COHORTS],
    };
    const inputs: LifecycleInputs = { ...INPUTS, cohorts: renamed };

    const open = deriveLifecycle(account({ cohort: 'alpha_partner', cohortExpiresAt: null }), inputs, NOW);
    expect(hasOpenEndedFreeAccess({ basis: open.basis, lifecycle: open }, renamed)).toBe(true);

    const dated = deriveLifecycle(account({ cohort: 'alpha_partner', cohortExpiresAt: FUTURE }), inputs, NOW);
    expect(hasOpenEndedFreeAccess({ basis: dated.basis, lifecycle: dated }, renamed)).toBe(false);

    const trial = deriveLifecycle(account({ cohort: 'beta_preview', onboardingStartedAt: '2026-10-10T00:00:00.000Z' }), inputs, NOW);
    expect(hasOpenEndedFreeAccess({ basis: trial.basis, lifecycle: trial }, renamed)).toBe(false);
  });

  it('writes no cohort id in its source', () => {
    const source = readFileSync(join(process.cwd(), 'lib', 'business-os', 'entitlements', 'freeAccess.ts'), 'utf8');
    for (const id of Object.keys(COHORTS)) expect(source).not.toMatch(new RegExp(`['"\`]${id}['"\`]`));
  });
});

describe('freeAccessEndedByPurchase — the sentence beside the Choose list (P-4.2, SA Q-3 / W-7)', () => {
  const ended = (overrides: Parameters<typeof account>[0]) => {
    const lifecycle = resolve(overrides);
    return freeAccessEndedByPurchase({ basis: lifecycle.basis, lifecycle }, NOW);
  };

  it("'timed': a live timed cohort, including one whose clock has not started", () => {
    expect(ended({ cohort: TIMED, onboardingStartedAt: '2026-10-10T00:00:00.000Z' })).toBe('timed');
    expect(ended({ cohort: TIMED })).toBe('timed');
  });

  it('null: a timed cohort that has ended (in grace or after)', () => {
    expect(ended({ cohort: TIMED, onboardingStartedAt: '2026-01-01T00:00:00.000Z' })).toBeNull();
  });

  it("'admin_dated': a live admin-dated cohort with a future end date", () => {
    expect(ended({ cohort: ADMIN_DATED, cohortExpiresAt: FUTURE })).toBe('admin_dated');
  });

  it('null: an admin-dated cohort past its end date (grace), or with no end date (BQ-P10 refuses that sale)', () => {
    expect(ended({ cohort: ADMIN_DATED, cohortExpiresAt: PAST })).toBeNull();
    expect(ended({ cohort: ADMIN_DATED, cohortExpiresAt: null })).toBeNull();
  });

  it('null: a tier basis, live or lapsed, and an admin tier over a cohort (nothing free is ended)', () => {
    expect(ended({ tier: TIER, planVersion: 1, tierExpiresAt: null })).toBeNull();
    expect(ended({ tier: TIER, planVersion: 1, tierExpiresAt: PAST })).toBeNull();
    expect(ended({ cohort: ADMIN_DATED, cohortExpiresAt: FUTURE, tier: TIER, planVersion: 1, tierExpiresAt: FUTURE })).toBeNull();
  });

  it('null: no plan row, and an unreadable end date', () => {
    const lifecycle = deriveLifecycle(null, INPUTS, NOW);
    expect(freeAccessEndedByPurchase({ basis: lifecycle.basis, lifecycle }, NOW)).toBeNull();
    expect(freeAccessEndedByPurchase({ basis: { kind: 'cohort', cohort: ADMIN_DATED }, lifecycle: { accessEndsAt: 'not a date' } }, NOW)).toBeNull();
  });

  it('reads structure, not names: renamed cohorts give the same answers', () => {
    const renamed: Record<string, CohortConfig> = {
      alpha_partner: COHORTS[ADMIN_DATED as keyof typeof COHORTS],
      beta_preview: COHORTS[TIMED as keyof typeof COHORTS],
    };
    const inputs: LifecycleInputs = { ...INPUTS, cohorts: renamed };
    const dated = deriveLifecycle(account({ cohort: 'alpha_partner', cohortExpiresAt: FUTURE }), inputs, NOW);
    expect(freeAccessEndedByPurchase({ basis: dated.basis, lifecycle: dated }, NOW, renamed)).toBe('admin_dated');
    const trial = deriveLifecycle(account({ cohort: 'beta_preview', onboardingStartedAt: '2026-10-10T00:00:00.000Z' }), inputs, NOW);
    expect(freeAccessEndedByPurchase({ basis: trial.basis, lifecycle: trial }, NOW, renamed)).toBe('timed');
  });
});
