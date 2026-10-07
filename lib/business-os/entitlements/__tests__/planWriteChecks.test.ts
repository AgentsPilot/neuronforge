/**
 * The shared plan-write checks (plan payments P-3b.1, SA-P3 a, T6).
 *
 * `tierInForce` and `wouldLeaveNoBasis` moved out of `adminOps.ts` unchanged;
 * the `adminOps` suite runs against them unedited, and this suite pins the
 * functions directly so the next caller (the webhook, P-3b.2) gets the same
 * answers. `tierIsConfigured` is new: the tiers-configured rule (RC-1) for a
 * caller with no Zod enum.
 */

import type { BusinessOsAccountPlan } from '@/lib/repositories/BusinessOsAccountPlanRepository';
import { tierInForce, tierIsConfigured, wouldLeaveNoBasis } from '../planWriteChecks';

const NOW = new Date('2026-10-07T12:00:00.000Z');
const PAST = '2026-10-01T00:00:00.000Z';
const FUTURE = '2026-11-01T00:00:00.000Z';

function plan(overrides: Partial<BusinessOsAccountPlan> = {}): BusinessOsAccountPlan {
  return {
    user_id: '11111111-1111-4111-8111-111111111111',
    tier: null,
    plan_version: 0,
    tier_expires_at: null,
    cohort: 'trial',
    cohort_expires_at: null,
    onboarding_started_at: null,
    profile_created_at: null,
    trial_started_at: null,
    trial_ends_at: null,
    grace_ends_at: null,
    period_anchor: '2026-10-01T00:00:00.000Z',
    origin: 'backfill',
    updated_by_admin_id: null,
    created_at: '2026-10-01T00:00:00.000Z',
    updated_at: '2026-10-01T00:00:00.000Z',
    ...overrides,
  } as BusinessOsAccountPlan;
}

describe('tierInForce (A-1)', () => {
  it('no plan or no tier is not in force', () => {
    expect(tierInForce(null, NOW)).toBe(false);
    expect(tierInForce(plan(), NOW)).toBe(false);
  });

  it('a tier with no end date, or an end date still ahead, is in force', () => {
    expect(tierInForce(plan({ tier: 'tier_a', plan_version: 1 }), NOW)).toBe(true);
    expect(tierInForce(plan({ tier: 'tier_a', plan_version: 1, tier_expires_at: FUTURE }), NOW)).toBe(true);
  });

  it('a tier whose end date has passed, or is now, is not in force', () => {
    expect(tierInForce(plan({ tier: 'tier_a', plan_version: 1, tier_expires_at: PAST }), NOW)).toBe(false);
    expect(tierInForce(plan({ tier: 'tier_a', plan_version: 1, tier_expires_at: NOW.toISOString() }), NOW)).toBe(false);
  });
});

describe('wouldLeaveNoBasis (R2-3)', () => {
  it('clearing the cohort of an account with no tier leaves no basis', () => {
    expect(wouldLeaveNoBasis(plan(), { cohort: null }, NOW)).toBe(true);
  });

  it('clearing the cohort while a tier is in force leaves a basis', () => {
    expect(wouldLeaveNoBasis(plan({ tier: 'tier_a', plan_version: 1 }), { cohort: null }, NOW)).toBe(false);
  });

  it('clearing the tier projects its end date away too (Q-6), so a cohort-less account has no basis', () => {
    expect(wouldLeaveNoBasis(plan({ tier: 'tier_a', plan_version: 1, tier_expires_at: FUTURE, cohort: null }), { tier: null }, NOW)).toBe(true);
  });

  it('expiring the tier in the past with no cohort leaves no basis', () => {
    expect(wouldLeaveNoBasis(plan({ tier: 'tier_a', plan_version: 1, cohort: null }), { tier_expires_at: PAST }, NOW)).toBe(true);
  });
});

describe('tierIsConfigured (RC-1)', () => {
  it('is true only for a tier the config names', () => {
    const config = { tierOrder: ['tier_a', 'tier_b'] as readonly string[] };
    expect(tierIsConfigured(config, 'tier_a')).toBe(true);
    expect(tierIsConfigured(config, 'tier_b')).toBe(true);
    expect(tierIsConfigured(config, 'tier_c')).toBe(false);
    expect(tierIsConfigured(config, '')).toBe(false);
  });

  it('nothing is configured when the config has no tiers (production before go-live)', () => {
    expect(tierIsConfigured({ tierOrder: [] }, 'tier_a')).toBe(false);
  });
});
