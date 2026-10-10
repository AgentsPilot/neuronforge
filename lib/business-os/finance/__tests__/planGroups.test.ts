/**
 * Section 1's classifier (finance & business health slice 1a, §8.1, AC-6,
 * AC-12, SA-Q3, SA-W3, SA-WR-4).
 *
 * The real entitlement config is passed in (SA-WR-4). Tier and cohort ids are
 * taken FROM that config, never written as literals: the tier literal guard
 * scans tests too.
 */

jest.mock('@/lib/supabaseServer', () => ({ supabaseServer: {} }));
jest.mock('@/lib/logger', () => {
  const logger: Record<string, unknown> = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
  logger.child = () => logger;
  return { createLogger: () => logger };
});

import type { BusinessOsAccountPlan } from '@/lib/repositories/BusinessOsAccountPlanRepository';
import { getEntitlementConfig } from '@/lib/business-os/entitlements/source';
import { stateForCohort, type EntitlementBasis, type LifecycleResult } from '@/lib/business-os/entitlements/lifecycle';
import { buildShadowReport } from '@/lib/business-os/entitlements/report';
import type { LifecycleState } from '@/lib/business-os/entitlements/types';
import { classifyAccounts, groupFor } from '../planGroups';
import type { FinanceGroupKey } from '../financeTypes';

const config = getEntitlementConfig();
const TIER = config.tierOrder[0];
const cohortIds = Object.keys(config.cohorts);
const CHAMPION = cohortIds.find((id) => stateForCohort(id) === 'champion') as string;
const TRIAL = cohortIds.find((id) => stateForCohort(id) === 'trial') as string;

const NOW = new Date('2026-10-09T12:00:00.000Z');
const WINDOW = { start: new Date('2026-10-01T00:00:00.000Z'), end: new Date('2026-10-10T00:00:00.000Z') };
const daysFromNow = (d: number) => new Date(NOW.getTime() + d * 86_400_000).toISOString();

let seq = 0;
function planRow(extra: Partial<BusinessOsAccountPlan> = {}): BusinessOsAccountPlan {
  seq += 1;
  return {
    user_id: `00000000-0000-4000-8000-${String(seq).padStart(12, '0')}`,
    tier: null,
    plan_version: 1,
    tier_expires_at: null,
    cohort: null,
    cohort_expires_at: null,
    onboarding_started_at: '2026-09-01T00:00:00.000Z',
    profile_created_at: '2026-09-01T00:00:00.000Z',
    trial_started_at: null,
    trial_ends_at: null,
    grace_ends_at: null,
    period_anchor: '2026-09-01T00:00:00.000Z',
    origin: 'trigger',
    updated_by_admin_id: null,
    created_at: '2026-09-01T00:00:00.000Z',
    updated_at: '2026-09-01T00:00:00.000Z',
    ...extra,
  };
}

const SEEDED: FinanceGroupKey[] = [
  'trial',
  'founding_partner',
  'comped',
  ...config.tierOrder.map((t) => `tier:${t}` as FinanceGroupKey),
  'unknown_held',
];

describe('groupFor: every LifecycleState × every basis kind (AC-12)', () => {
  const STATES: LifecycleState[] = ['trial', 'champion', 'active', 'past_due', 'grace', 'paused', 'unknown'];
  const BASES: EntitlementBasis[] = [
    { kind: 'tier', tier: TIER },
    { kind: 'cohort', cohort: CHAMPION },
    { kind: 'cohort', cohort: TRIAL },
    { kind: 'cohort', cohort: 'not-a-cohort' },
    { kind: 'none' },
  ];
  const result = (state: LifecycleState, basis: EntitlementBasis): LifecycleResult => ({
    state,
    basis,
    accessEndsAt: null,
    graceEndsAt: null,
    reason: 'test',
  });

  for (const state of STATES) {
    for (const basis of BASES) {
      for (const paying of [true, false, null] as const) {
        it(`${state} / ${JSON.stringify(basis)} / paying ${paying} → exactly one known group`, () => {
          const group = groupFor(result(state, basis), paying);
          const allowed = paying === null ? [...SEEDED, 'tier_set'] : SEEDED;
          expect(allowed).toContain(group);
        });
      }
    }
  }

  it('applies the §8.1 table', () => {
    expect(groupFor(result('trial', { kind: 'none' }), true)).toBe('trial');
    expect(groupFor(result('champion', { kind: 'tier', tier: TIER }), false)).toBe('founding_partner');
    expect(groupFor(result('active', { kind: 'tier', tier: TIER }), true)).toBe(`tier:${TIER}`);
    expect(groupFor(result('active', { kind: 'tier', tier: TIER }), false)).toBe('comped');
    expect(groupFor(result('past_due', { kind: 'tier', tier: TIER }), true)).toBe(`tier:${TIER}`);
    expect(groupFor(result('grace', { kind: 'tier', tier: TIER }), false)).toBe('comped');
    expect(groupFor(result('active', { kind: 'tier', tier: TIER }), null)).toBe('tier_set');
    expect(groupFor(result('grace', { kind: 'cohort', cohort: CHAMPION }), null)).toBe('founding_partner');
    expect(groupFor(result('grace', { kind: 'cohort', cohort: TRIAL }), null)).toBe('trial');
    expect(groupFor(result('grace', { kind: 'cohort', cohort: 'not-a-cohort' }), true)).toBe('unknown_held');
    expect(groupFor(result('active', { kind: 'cohort', cohort: 'not-a-cohort' }), true)).toBe('unknown_held');
    expect(groupFor(result('paused', { kind: 'tier', tier: TIER }), true)).toBe('unknown_held');
    expect(groupFor(result('unknown', { kind: 'none' }), true)).toBe('unknown_held');
  });
});

describe('classifyAccounts', () => {
  // The 12-row fixture of the workplan (§ planGroups tests).
  const payingTier = planRow({ tier: TIER });
  const comped = planRow({ tier: TIER });
  const tierAndCohort = planRow({ tier: TIER, cohort: CHAMPION });
  const expiredTierInGrace = planRow({ tier: TIER, tier_expires_at: daysFromNow(-2) });
  const fixture = [
    planRow({ cohort: TRIAL, onboarding_started_at: daysFromNow(-3) }), // trial
    planRow({ cohort: CHAMPION, profile_created_at: null, created_at: '2026-10-02T00:00:00.000Z', origin: 'backfill' }), // open-ended, dormant, new
    planRow({ cohort: CHAMPION }), // open-ended, has a profile
    planRow({ cohort: CHAMPION, cohort_expires_at: daysFromNow(20) }), // dated, ending soon
    planRow({ cohort: CHAMPION, cohort_expires_at: daysFromNow(-10) }), // lapsed into grace (cohort basis)
    payingTier,
    comped,
    tierAndCohort, // tier wins
    expiredTierInGrace,
    planRow({ tier: TIER, tier_expires_at: daysFromNow(5), created_at: '2026-10-05T00:00:00.000Z' }), // ending soon, new
    planRow({ cohort: 'not-a-cohort' }), // unknown cohort
    planRow({ tier: 'not-a-tier' }), // unknown tier
  ];
  const paying = new Set([payingTier.user_id, tierAndCohort.user_id]);

  const count = (groups: Array<{ key: string; count: number }>, key: string) =>
    groups.find((g) => g.key === key)?.count;

  it('classifies the 12 rows; the groups sum to Total', () => {
    const { figures, groupByAccount } = classifyAccounts({ rows: fixture, payingIds: paying, window: WINDOW, now: NOW, config });
    expect(figures.total).toBe(12);
    expect(figures.groups.reduce((sum, g) => sum + g.count, 0)).toBe(12);
    expect(figures.groups.map((g) => g.key)).toEqual(SEEDED);
    expect(count(figures.groups, 'trial')).toBe(1);
    expect(count(figures.groups, 'founding_partner')).toBe(4);
    // payingTier + tierAndCohort paying; the active tier ending soon is not.
    expect(count(figures.groups, `tier:${TIER}`)).toBe(2);
    expect(count(figures.groups, 'comped')).toBe(3);
    expect(count(figures.groups, 'unknown_held')).toBe(2);
    expect(figures.payingKnown).toBe(true);
    expect(groupByAccount.get(tierAndCohort.user_id)).toBe(`tier:${TIER}`);
    expect(groupByAccount.get(comped.user_id)).toBe('comped');

    // Grace counted beside its group.
    expect(figures.groups.find((g) => g.key === 'founding_partner')?.grace).toBe(1);
    expect(figures.groups.find((g) => g.key === 'comped')?.grace).toBe(1);
    expect(figures.byState.grace).toBe(2);

    expect(figures.foundingNoEndDate).toBe(2);
    expect(figures.dormantFounding).toBe(1);
    expect(figures.newInWindow).toEqual({
      total: 2,
      byOrigin: [
        { origin: 'backfill', count: 1 },
        { origin: 'trigger', count: 1 },
      ],
    });
    expect(figures.endingIn30Days).toBeGreaterThanOrEqual(2);
  });

  it('labels tier groups from config, never a literal', () => {
    const { figures } = classifyAccounts({ rows: [], payingIds: new Set(), window: WINDOW, now: NOW, config });
    const presentation = config.matrix.presentation as Record<string, { labels: { en: string } }>;
    for (const tier of config.tierOrder) {
      expect(figures.groups.find((g) => g.key === `tier:${tier}`)?.tierLabel).toBe(presentation[tier].labels.en);
    }
    expect(figures.groups.find((g) => g.key === 'trial')?.tierLabel).toBeNull();
  });

  it('paying read failed → one "Tier set" group, no Comped and no tier groups', () => {
    const { figures } = classifyAccounts({ rows: fixture, payingIds: null, window: WINDOW, now: NOW, config });
    expect(figures.payingKnown).toBe(false);
    expect(figures.groups.map((g) => g.key)).toEqual(['trial', 'founding_partner', 'tier_set', 'unknown_held']);
    expect(count(figures.groups, 'tier_set')).toBe(5);
    expect(figures.groups.reduce((sum, g) => sum + g.count, 0)).toBe(12);
  });

  it('AC-6: no plan rows → every group 0, Total 0', () => {
    const { figures } = classifyAccounts({ rows: [], payingIds: new Set(), window: WINDOW, now: NOW, config });
    expect(figures.total).toBe(0);
    expect(figures.groups.every((g) => g.count === 0)).toBe(true);
    expect(figures.foundingNoEndDate).toBe(0);
  });
});

describe('one definition, two callers (SA-Q3): no end date and dormant agree with the shadow report', () => {
  it('counts the same Founding Partners with no end date and the same dormant ones as buildShadowReport', async () => {
    const rows = [
      planRow({ cohort: CHAMPION, profile_created_at: null }),
      planRow({ cohort: CHAMPION, profile_created_at: null }),
      planRow({ cohort: CHAMPION }),
      planRow({ cohort: CHAMPION, cohort_expires_at: daysFromNow(40) }),
      planRow({ cohort: CHAMPION, cohort_expires_at: daysFromNow(-5) }),
      planRow({ cohort: TRIAL, onboarding_started_at: daysFromNow(-1) }),
    ].sort((a, b) => a.user_id.localeCompare(b.user_id));

    const report = await buildShadowReport({
      config,
      now: () => NOW,
      planRepository: {
        pagePlans: async ({ afterUserId }: { afterUserId?: string | null } = {}) => ({
          data: afterUserId ? [] : rows,
          error: null,
        }),
        findTenantsMissingPlanRow: async () => ({ data: null, error: new Error('not used') }),
        findRecentOnboardedPlans: async () => ({ data: [], error: null }),
      } as unknown as NonNullable<Parameters<typeof buildShadowReport>[0]>['planRepository'],
    });

    const { figures } = classifyAccounts({ rows, payingIds: new Set(), window: WINDOW, now: NOW, config });
    const reportNoEnd = report.static.noEndDate.filter((r) => r.kind === 'cohort' && r.name === CHAMPION).length;
    expect(figures.foundingNoEndDate).toBe(reportNoEnd);
    expect(figures.foundingNoEndDate).toBe(3);
    expect(figures.dormantFounding).toBe(report.static.dormantChampions.accounts);
    expect(figures.dormantFounding).toBe(2);
  });
});
