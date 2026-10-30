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
// Slice 1c: a separate import, so the lines above stay unedited.
import { paidTierOf } from '../planGroups';
// MK5BFU-FU-2: a separate import too.
import { isAfterPlanRow, isTrialRow, trialEndOf, trialsForTrialToPaid } from '../planGroups';

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

// ── Slice 1c (BD-15, SA-Q20, SA-Q23, SA-Q24, SA-W42, SA-W44, SA-WR-29) ───────
// Appended: everything above runs unedited. Tiers come from config only.

describe('slice 1c: paidTierOf (SA-Q20, SA-WR-29, AC-86)', () => {
  const TIER_2 = config.tierOrder[1];

  it('has two distinct config tiers to work with (non-vacuity)', () => {
    expect(TIER_2).toBeDefined();
    expect(TIER_2).not.toBe(TIER);
  });

  it.each([
    ['plan tier valid → the plan tier', () => paidTierOf(TIER, null, config.tierOrder), () => TIER],
    ['plan tier valid and the bought tier differs → the plan tier wins', () => paidTierOf(TIER, TIER_2, config.tierOrder), () => TIER],
    ['no plan tier, valid bought tier → the bought tier', () => paidTierOf(null, TIER_2, config.tierOrder), () => TIER_2],
    ['invalid plan tier, valid bought tier → the bought tier', () => paidTierOf('not-a-tier', TIER_2, config.tierOrder), () => TIER_2],
    ['no plan tier, invalid bought tier → null (Unknown/held)', () => paidTierOf(null, 'not-a-tier', config.tierOrder), () => null],
    ['both absent → null', () => paidTierOf(null, undefined, config.tierOrder), () => null],
    ['blank bought tier → null', () => paidTierOf(null, '', config.tierOrder), () => null],
  ])('%s', (_name, actual, expected) => {
    expect(actual()).toBe(expected());
  });
});

describe('slice 1c: a paying Founding Partner is grouped by its paid tier (BD-15, S1C-FR-3)', () => {
  const TIER_2 = config.tierOrder[1];
  const group = (groups: Array<{ key: string; count: number; foundingPartners: number }>, key: string) =>
    groups.find((g) => g.key === key);
  const run = (
    rows: BusinessOsAccountPlan[],
    payingIds: ReadonlySet<string> | null,
    paidTierHints?: ReadonlyMap<string, string>
  ) => classifyAccounts({ rows, payingIds, paidTierHints, window: WINDOW, now: NOW, config }).figures;

  it('(a) AC-78: champion with its tier in force and paying → its tier group with the note; Comped 0', () => {
    const owner = planRow({ tier: TIER, cohort: CHAMPION });
    const figures = run([owner], new Set([owner.user_id]));
    expect(group(figures.groups, `tier:${TIER}`)).toMatchObject({ count: 1, foundingPartners: 1 });
    expect(group(figures.groups, 'comped')).toMatchObject({ count: 0, foundingPartners: 0 });
    expect(group(figures.groups, 'founding_partner')?.count).toBe(0);
  });

  it('(a2) the same account not paying → Comped, no note anywhere (BD-4 unchanged)', () => {
    const owner = planRow({ tier: TIER, cohort: CHAMPION });
    const figures = run([owner], new Set());
    expect(group(figures.groups, 'comped')?.count).toBe(1);
    expect(figures.groups.every((g) => g.foundingPartners === 0)).toBe(true);
  });

  it('(b) AC-78: champion with no tier, paying, bought tier from its billing row → that tier group with the note', () => {
    const champ = planRow({ cohort: CHAMPION });
    const figures = run([champ], new Set([champ.user_id]), new Map([[champ.user_id, TIER_2]]));
    expect(group(figures.groups, `tier:${TIER_2}`)).toMatchObject({ count: 1, foundingPartners: 1 });
    expect(group(figures.groups, 'founding_partner')?.count).toBe(0);
  });

  it('(b2) AC-86: champion with an EXPIRED plan tier and a live cohort, paying, bought tier differs → the plan tier wins', () => {
    const champ = planRow({ tier: TIER, tier_expires_at: daysFromNow(-30), cohort: CHAMPION });
    const figures = run([champ], new Set([champ.user_id]), new Map([[champ.user_id, TIER_2]]));
    expect(group(figures.groups, `tier:${TIER}`)).toMatchObject({ count: 1, foundingPartners: 1 });
    expect(group(figures.groups, `tier:${TIER_2}`)?.count).toBe(0);
  });

  it('(b3) AC-86: champion with no tier, paying, no valid bought tier → Unknown/held, never dropped, no note', () => {
    const none = planRow({ cohort: CHAMPION });
    const invalid = planRow({ cohort: CHAMPION });
    const figures = run([none, invalid], new Set([none.user_id, invalid.user_id]), new Map([[invalid.user_id, 'not-a-tier']]));
    expect(group(figures.groups, 'unknown_held')?.count).toBe(2);
    expect(figures.groups.every((g) => g.foundingPartners === 0)).toBe(true);
    expect(figures.total).toBe(2);
  });

  it('grace on the champion cohort, paying → its paid tier (S1C-FR-3); its FP period has ended, so no note (QA-1)', () => {
    const lapsed = planRow({ cohort: CHAMPION, cohort_expires_at: daysFromNow(-10) });
    const figures = run([lapsed], new Set([lapsed.user_id]), new Map([[lapsed.user_id, TIER]]));
    expect(group(figures.groups, `tier:${TIER}`)).toMatchObject({ count: 1, foundingPartners: 0 });
    expect(group(figures.groups, 'founding_partner')?.count).toBe(0);
  });

  it('QA-1: a paying champion with a tier in force and a FUTURE Founding Partner end date → the note', () => {
    const current = planRow({ tier: TIER, cohort: CHAMPION, cohort_expires_at: daysFromNow(30) });
    const figures = run([current], new Set([current.user_id]));
    expect(group(figures.groups, `tier:${TIER}`)).toMatchObject({ count: 1, foundingPartners: 1 });
  });

  it('QA-1: a paying champion with a tier in force whose Founding Partner period has ENDED → its tier group, no note', () => {
    const ended = planRow({ tier: TIER, cohort: CHAMPION, cohort_expires_at: daysFromNow(-1) });
    const figures = run([ended], new Set([ended.user_id]));
    expect(group(figures.groups, `tier:${TIER}`)).toMatchObject({ count: 1, foundingPartners: 0 });
    expect(figures.groups.every((g) => g.foundingPartners === 0)).toBe(true);
  });

  it('QA-1: the end is compared with the same now as the rest of the classifier (an end exactly at now has ended)', () => {
    const atNow = planRow({ tier: TIER, cohort: CHAMPION, cohort_expires_at: NOW.toISOString() });
    const figures = run([atNow], new Set([atNow.user_id]));
    expect(group(figures.groups, `tier:${TIER}`)?.foundingPartners).toBe(0);
  });

  it('AC-79: a champion that is not paying stays in Founding Partner, even with a bought tier, and no note', () => {
    const champ = planRow({ cohort: CHAMPION });
    const figures = run([champ], new Set(), new Map([[champ.user_id, TIER]]));
    expect(group(figures.groups, 'founding_partner')?.count).toBe(1);
    expect(figures.groups.every((g) => g.foundingPartners === 0)).toBe(true);
  });

  it('S1C-FR-6: the paying read failed → champions stay in Founding Partner, tiers fold into "Tier set"', () => {
    const champ = planRow({ cohort: CHAMPION });
    const owner = planRow({ tier: TIER, cohort: CHAMPION });
    const figures = run([champ, owner], null, new Map([[champ.user_id, TIER]]));
    expect(figures.payingKnown).toBe(false);
    expect(group(figures.groups, 'founding_partner')?.count).toBe(1);
    expect(group(figures.groups, 'tier_set')?.count).toBe(1);
    expect(figures.groups.every((g) => g.foundingPartners === 0)).toBe(true);
  });

  it('AC-80: K-3 ("no end date") counts only the champions left in Founding Partner', () => {
    const open1 = planRow({ cohort: CHAMPION });
    const open2 = planRow({ cohort: CHAMPION });
    const openPaying = planRow({ cohort: CHAMPION });
    const figures = run([open1, open2, openPaying], new Set([openPaying.user_id]), new Map([[openPaying.user_id, TIER]]));
    expect(figures.foundingNoEndDate).toBe(2);
  });

  it('AC-12 / AC-84: a mixed fixture with every new case still sums to Total', () => {
    const rows = [
      planRow({ tier: TIER, cohort: CHAMPION }),
      planRow({ tier: TIER, cohort: CHAMPION }),
      planRow({ cohort: CHAMPION }),
      planRow({ cohort: CHAMPION }),
      planRow({ cohort: CHAMPION, cohort_expires_at: daysFromNow(-10) }),
      planRow({ tier: TIER }),
      planRow({ cohort: TRIAL, onboarding_started_at: daysFromNow(-1) }),
    ];
    const payingIds = new Set([rows[0].user_id, rows[2].user_id, rows[4].user_id]);
    const hints = new Map([
      [rows[2].user_id, TIER_2],
      [rows[4].user_id, 'not-a-tier'],
    ]);
    const figures = run(rows, payingIds, hints);
    expect(figures.groups.reduce((sum, g) => sum + g.count, 0)).toBe(rows.length);
    expect(group(figures.groups, `tier:${TIER}`)).toMatchObject({ count: 1, foundingPartners: 1 });
    expect(group(figures.groups, `tier:${TIER_2}`)).toMatchObject({ count: 1, foundingPartners: 1 });
    expect(group(figures.groups, 'comped')?.count).toBe(2);
    expect(group(figures.groups, 'unknown_held')?.count).toBe(1);
    expect(group(figures.groups, 'founding_partner')?.count).toBe(1);
    expect(group(figures.groups, 'trial')?.count).toBe(1);
  });
});

describe('slice 1c: dormant Founding Partners counts the Founding Partner group only (SA-Q23, SA-W42, S1C-F3)', () => {
  // A separate fixture with paying champions: the parity test above keeps its
  // own, which has no paying champion and no tier, and is not edited.
  it('a paying dormant champion and a Comped dormant champion are not counted; a plain dormant one is', () => {
    const payingDormant = planRow({ cohort: CHAMPION, profile_created_at: null });
    const compedDormant = planRow({ tier: TIER, cohort: CHAMPION, profile_created_at: null });
    const plainDormant = planRow({ cohort: CHAMPION, profile_created_at: null });
    const { figures, groupByAccount } = classifyAccounts({
      rows: [payingDormant, compedDormant, plainDormant],
      payingIds: new Set([payingDormant.user_id]),
      paidTierHints: new Map([[payingDormant.user_id, TIER]]),
      window: WINDOW,
      now: NOW,
      config,
    });
    expect(groupByAccount.get(payingDormant.user_id)).toBe(`tier:${TIER}`);
    expect(groupByAccount.get(compedDormant.user_id)).toBe('comped');
    expect(groupByAccount.get(plainDormant.user_id)).toBe('founding_partner');
    expect(figures.dormantFounding).toBe(1);
  });
});

describe('slice 6a: the non-wire foundingPartnerNote set (SA-W77)', () => {
  it('holds exactly the accounts counted in a tier group’s foundingPartners; its size equals their sum', () => {
    const TIER_2 = config.tierOrder[1];
    const noted = planRow({ tier: TIER, cohort: CHAMPION });
    const notedViaHint = planRow({ cohort: CHAMPION });
    const ended = planRow({ tier: TIER, cohort: CHAMPION, cohort_expires_at: daysFromNow(-1) });
    const comped = planRow({ tier: TIER, cohort: CHAMPION });
    const plainChampion = planRow({ cohort: CHAMPION });
    const paying = new Set([noted.user_id, notedViaHint.user_id, ended.user_id]);
    const result = classifyAccounts({
      rows: [noted, notedViaHint, ended, comped, plainChampion],
      payingIds: paying,
      paidTierHints: new Map([[notedViaHint.user_id, TIER_2]]),
      window: WINDOW,
      now: NOW,
      config,
    });
    expect([...result.foundingPartnerNote].sort()).toEqual([noted.user_id, notedViaHint.user_id].sort());
    const sum = result.figures.groups.reduce((n, g) => n + g.foundingPartners, 0);
    expect(result.foundingPartnerNote.size).toBe(sum);
  });

  it('is empty when the paying read failed (no tier group, so no note)', () => {
    const owner = planRow({ tier: TIER, cohort: CHAMPION });
    const result = classifyAccounts({ rows: [owner], payingIds: null, window: WINDOW, now: NOW, config });
    expect(result.foundingPartnerNote.size).toBe(0);
  });
});

// MK5BFU-FU-2 (user decision 2026-10-30): an after-plan free period is not a trial for MK-9.
describe('MK5BFU-FU-2: isAfterPlanRow and trialsForTrialToPaid', () => {
  const trial = (extra: Partial<BusinessOsAccountPlan> = {}) =>
    planRow({ cohort: TRIAL, trial_started_at: '2026-09-20T00:00:00.000Z', trial_ends_at: '2026-10-04T00:00:00.000Z', ...extra });

  it('isAfterPlanRow: true only for a count above 0; a row read without the column counts as 0', () => {
    expect(isAfterPlanRow({ after_plan_moves: 1 })).toBe(true);
    expect(isAfterPlanRow({ after_plan_moves: 3 })).toBe(true);
    expect(isAfterPlanRow({ after_plan_moves: 0 })).toBe(false);
    expect(isAfterPlanRow({})).toBe(false);
  });

  it('an after-plan trial row is left out', () => {
    const back = trial({ after_plan_moves: 1 });
    expect(isTrialRow(back)).toBe(true); // still a trial by cohort: the plan mix is unchanged
    expect(trialsForTrialToPaid([back], config, NOW)).toEqual([]);
  });

  it('a real trial is kept, with the same end trialEndOf gives (moves 0, or no column)', () => {
    const fresh = trial({ after_plan_moves: 0 });
    const old = trial();
    expect(trialsForTrialToPaid([fresh, old], config, NOW)).toEqual([
      { accountId: fresh.user_id, endsAt: trialEndOf(fresh, config, NOW) },
      { accountId: old.user_id, endsAt: trialEndOf(old, config, NOW) },
    ]);
    expect(trialEndOf(fresh, config, NOW)).toBe('2026-10-04T00:00:00.000Z');
  });

  it('a mixed set: only the real trials, in input order; non-trial rows stay out whatever their count', () => {
    const a = trial({ after_plan_moves: 0 });
    const b = trial({ after_plan_moves: 2 });
    const c = planRow({ tier: TIER, cohort: null, after_plan_moves: 0 });
    const d = planRow({ cohort: CHAMPION, after_plan_moves: 1 });
    const e = trial();
    expect(trialsForTrialToPaid([a, b, c, d, e], config, NOW).map((t) => t.accountId)).toEqual([a.user_id, e.user_id]);
  });
});
