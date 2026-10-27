/**
 * `planEndingView` (account-deletion lifecycle SX-2 / D3; SA Q-3, Q-7, R-4b,
 * R-6): what the Cancel drawer's "What changes" step says, read through the
 * REAL service (fake repository, fixed clock) and the production config.
 */

import { readFileSync } from 'fs';
import { join } from 'path';

import { EntitlementService } from '@/lib/business-os/entitlements/EntitlementService';
import { AFTER_PLAN } from '@/lib/business-os/entitlements/config/afterPlan';
import { COHORTS, type CohortConfig } from '@/lib/business-os/entitlements/config/cohorts';
import { PLAN_COMPARISON_ROWS } from '@/lib/business-os/entitlements/config/planComparison';
import { TIER_ORDER } from '@/lib/business-os/entitlements/config/tierMatrix';
import { historyAt } from '@/lib/business-os/entitlements/lifecycle';
import { planLabel } from '@/lib/business-os/entitlements/planPresentation';
import { buildPlanEndingView, readPlanEndingView } from '@/lib/business-os/entitlements/planEndingView';
import { getEntitlementConfig } from '@/lib/business-os/entitlements/source';
import type { fromPlanRow } from '@/lib/business-os/entitlements/account';

// The row type through the account seam, so this suite does not name the repository (RC-15 guard).
type BusinessOsAccountPlan = Parameters<typeof fromPlanRow>[0];

const DAY = 24 * 60 * 60 * 1000;
const NOW = '2026-10-27T12:00:00.000Z';
const ENDS = '2026-11-26T10:00:00.000Z';
const FREE_UNTIL = '2027-03-01T00:00:00.000Z';
const TOP = TIER_ORDER[TIER_ORDER.length - 1];
const ADMIN_DATED = (Object.entries(COHORTS) as Array<[string, CohortConfig]>).find(([, c]) => !c.durationHistory)![0];
const AFTER_COHORT = COHORTS[AFTER_PLAN.cohort] as CohortConfig;
const AFTER_BASE_TIER = (AFTER_COHORT.base as { tier: string }).tier;
const config = getEntitlementConfig();

function planRow(overrides: Partial<BusinessOsAccountPlan> = {}): BusinessOsAccountPlan {
  return {
    user_id: 'acct-1', tier: TOP, plan_version: 0, tier_expires_at: ENDS, cohort: AFTER_PLAN.cohort, cohort_expires_at: null,
    onboarding_started_at: '2026-01-01T00:00:00.000Z', profile_created_at: null, trial_started_at: null, trial_ends_at: null,
    grace_ends_at: null, period_anchor: '2026-01-01T00:00:00.000Z', origin: 'admin', updated_by_admin_id: null,
    created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z', ...overrides,
  };
}

function serviceFor(plan: BusinessOsAccountPlan | null) {
  return new EntitlementService({
    repository: {
      async findEntitlementInputs() {
        return { data: { plan, overrides: [] }, error: null };
      },
      async findEntitlementInputsBatch() {
        return { data: {}, error: null };
      },
    },
    now: () => new Date(NOW),
  });
}

const read = (plan: BusinessOsAccountPlan | null, locale: 'en' | 'he' | 'es' = 'en') =>
  readPlanEndingView({ accountId: 'acct-1', endsAt: ENDS, locale }, { service: serviceFor(plan) });

describe('free_plan (user BQ-20)', () => {
  it('the top paid tier, trial used long ago: the free cohort until endsAt + its duration, what is lost, then its grace', async () => {
    const view = await read(planRow());
    const days = historyAt(AFTER_COHORT.durationHistory ?? [], new Date(ENDS))!.days;
    const grace = historyAt(AFTER_COHORT.graceHistory, new Date(ENDS))!.days;
    expect(view).toEqual({
      kind: 'free_plan',
      endsAt: ENDS,
      planName: planLabel(config, AFTER_PLAN.cohort, 'en'),
      until: new Date(Date.parse(ENDS) + days * DAY).toISOString(),
      credits: (AFTER_COHORT.values['credits.allowance'] as { total: number }).total,
      loses: expect.any(Array),
      thenReadOnlyDays: grace,
      thenPausedFrom: new Date(Date.parse(ENDS) + (days + grace) * DAY).toISOString(),
    });
    expect(days).toBe(14);
    expect(grace).toBe(7);
    if (view?.kind !== 'free_plan') throw new Error('kind');
    expect(view.loses.length).toBeGreaterThan(0);
    const enLabels = PLAN_COMPARISON_ROWS.map((row) => row.labels.en);
    for (const label of view.loses) expect(enLabels).toContain(label);
  });

  it('paying for the tier the free cohort previews: nothing in the comparison is lost', async () => {
    const view = await read(planRow({ tier: AFTER_BASE_TIER }));
    expect(view?.kind).toBe('free_plan');
    expect(view && view.kind !== 'unknown' ? view.loses : null).toEqual([]);
  });

  it('labels in he and es come from the config', async () => {
    for (const locale of ['he', 'es'] as const) {
      const view = await read(planRow(), locale);
      if (view?.kind !== 'free_plan') throw new Error('kind');
      expect(view.planName).toBe(planLabel(config, AFTER_PLAN.cohort, locale));
      const labels = PLAN_COMPARISON_ROWS.map((row) => row.labels[locale]);
      for (const label of view.loses) expect(labels).toContain(label);
    }
  });

  it('fixture rows: an injected row list is what `loses` is read from', async () => {
    const service = serviceFor(planRow());
    const preview = (await service.previewAfterPlan('acct-1', ENDS))!;
    const view = buildPlanEndingView({ config, preview, endsAt: ENDS, locale: 'en', rows: [] });
    expect(view.kind === 'free_plan' ? view.loses : null).toEqual([]);
  });
});

describe('credits (user G-5 approval, 2026-10-27)', () => {
  it('is the configured one-off total of the free cohort, a positive number', async () => {
    const view = await read(planRow());
    if (view?.kind !== 'free_plan') throw new Error('kind');
    const configured = (AFTER_COHORT.values['credits.allowance'] as { total?: number }).total;
    expect(typeof configured).toBe('number');
    expect(view.credits).toBe(configured);
    expect(view.credits).toBeGreaterThan(0);
  });

  it('follows the config: a fixture total is what is sent, and a non-total allowance is null', async () => {
    const preview = (await serviceFor(planRow()).previewAfterPlan('acct-1', ENDS))!;
    const withValue = (value: unknown) => ({
      ...config,
      cohorts: { ...config.cohorts, [AFTER_PLAN.cohort]: { ...AFTER_COHORT, values: { ...AFTER_COHORT.values, 'credits.allowance': value } } },
    }) as typeof config;
    const total = buildPlanEndingView({ config: withValue({ total: 321 }), preview, endsAt: ENDS, locale: 'en' });
    expect(total.kind === 'free_plan' ? total.credits : undefined).toBe(321);
    const monthly = buildPlanEndingView({ config: withValue({ perMonth: 50 }), preview, endsAt: ENDS, locale: 'en' });
    expect(monthly.kind === 'free_plan' ? monthly.credits : undefined).toBeNull();
  });

  it('the source holds no credit figure', () => {
    const source = readFileSync(join(process.cwd(), 'lib', 'business-os', 'entitlements', 'planEndingView.ts'), 'utf8');
    expect(source).not.toMatch(/1[,_]?000/);
  });
});

describe('back_to_plan (SA R-4)', () => {
  it('a dated Founding Partner: until IS getFreeAccessAfterPaidTier\'s date, nothing lost', async () => {
    const plan = planRow({ cohort: ADMIN_DATED, cohort_expires_at: FREE_UNTIL });
    const view = await read(plan);
    const p7a3 = await serviceFor(plan).getFreeAccessAfterPaidTier('acct-1');
    expect(p7a3).toEqual({ endsAt: FREE_UNTIL });
    expect(view).toEqual({ kind: 'back_to_plan', endsAt: ENDS, planName: planLabel(config, ADMIN_DATED, 'en'), until: p7a3!.endsAt, loses: [] });
  });

  it('an open-ended Founding Partner: back to it, no end date', async () => {
    const view = await read(planRow({ cohort: ADMIN_DATED, cohort_expires_at: null }));
    expect(view).toMatchObject({ kind: 'back_to_plan', until: null });
  });
});

describe('unknown', () => {
  it('a current basis that is not a tier (a tierless trial)', async () => {
    const view = await read(planRow({ tier: null, tier_expires_at: null }));
    expect(view).toEqual({ kind: 'unknown', endsAt: ENDS });
  });

  it('a resolver anomaly (a tier the config does not know)', async () => {
    const view = await read(planRow({ tier: 'no_such_tier' }));
    expect(view).toEqual({ kind: 'unknown', endsAt: ENDS });
  });

  it('no plan row: null (nothing to describe)', async () => {
    await expect(read(null)).resolves.toBeNull();
  });
});

describe('source', () => {
  it('display only: no check() / decide(), no repository, no write', () => {
    const source = readFileSync(join(process.cwd(), 'lib', 'business-os', 'entitlements', 'planEndingView.ts'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    expect(source).not.toMatch(/\.check\(|\bdecide\(|Repository|recordPlanChange/);
  });
});
