/**
 * ⚠️ TEMPORARY — DELETE THIS FILE IN CREDIT DEDUCTION SLICE 6.
 *
 * User decision R-7, option C (2026-09-30): until slice 6 explains what a credit
 * is, owners (`/business-os/settings` → Plan, built by `buildCustomerPlanView`)
 * and invitees (the public `/invite` page, built by `describePlanOffer`) see the
 * credit allowance as "Credits (included)" with no number. Admin screens still
 * show the figures.
 *
 * Slice 6 removes `withCustomerDisplay` and its call sites, deletes this file,
 * and restores the three assertions in `customerPlanView.test.ts` marked
 * "TEMPORARY (R-7 option C)".
 */

import { COHORT_IDS } from '@/lib/business-os/entitlements/config/cohorts';
import { TIER_ORDER } from '@/lib/business-os/entitlements/config/tierMatrix';
import { buildAdminPlansView } from '@/lib/business-os/entitlements/adminPlansView';
import { buildCustomerPlanView, withCustomerDisplay } from '@/lib/business-os/entitlements/customerPlanView';
import { describePlanCapabilities, previewAccountFor } from '@/lib/business-os/entitlements/planPresentation';
import { describePlanOffer } from '@/lib/business-os/entitlements/planOfferView';
import { resolveEntitlements } from '@/lib/business-os/entitlements/resolver';
import { readCodeConfig } from '@/lib/business-os/entitlements/source';
import type { CapabilityDef } from '@/lib/business-os/entitlements/types';
import type { Locale } from '@/lib/i18n/config';

const NOW = new Date('2026-10-01T00:00:00.000Z');
const config = readCodeConfig();
const catalog = config.catalog as Record<string, CapabilityDef>;
const ALL_PLANS = [...TIER_ORDER, ...COHORT_IDS];

/** Every way the allowance's amount could be written today. */
const AMOUNTS = /19,750|32,250|2,000 in total|19750|32250/;

function resolutionFor(planId: string) {
  return resolveEntitlements({
    config,
    account: previewAccountFor(config, planId, NOW),
    overrides: [],
    addons: [],
    now: NOW,
  });
}

function ownerView(planId: string, locale?: Locale) {
  return buildCustomerPlanView({ resolution: resolutionFor(planId), unavailable: false, now: NOW, config, locale });
}

describe('owners (Settings → Plan) see "Credits (included)" without the number', () => {
  it.each(ALL_PLANS)('%s: the included list names the credits and no amount', (planId) => {
    const view = ownerView(planId);
    const feature = view.included.flatMap((row) => row.features).find((f) => f.capability === 'credits.allowance');

    expect(feature).toEqual({ capability: 'credits.allowance', label: 'Credits', value: 'included' });
    const text = view.included.map((row) => row.summary).join(' | ');
    expect(text).toContain('Credits (included)');
    expect(text).not.toMatch(AMOUNTS);
  });

  it.each([
    ['en', 'Credits (included)'],
    ['he', 'קרדיטים (כלול)'],
    ['es', 'Créditos (incluido)'],
  ] as const)('reads in the owner\'s language (%s)', (locale, expected) => {
    const text = ownerView('champion', locale).included.map((row) => row.summary).join(' | ');
    expect(text).toContain(expected);
    expect(text).not.toMatch(AMOUNTS);
  });

  it('no "next plan up" line carries the number back in', () => {
    for (const planId of ALL_PLANS) {
      const upgrade = ownerView(planId).nextPlanUp;
      if (!upgrade) continue;
      expect(JSON.stringify(upgrade)).not.toMatch(AMOUNTS);
      expect(upgrade.improves.map((entry) => entry.capability)).not.toContain('credits.allowance');
      expect(upgrade.changes.map((entry) => entry.capability)).not.toContain('credits.allowance');
    }
  });

  it('the trial still says it ends when the credits run out (no number in that sentence)', () => {
    expect(ownerView('trial').endsWhen?.key).toBe('plan.ends_on_or_credits');
  });
});

describe('invitees (the public /invite page) see "Credits (included)" without the number', () => {
  it.each(ALL_PLANS)('%s offer', (planId) => {
    const text = describePlanOffer(config, planId, NOW).included.map((row) => row.summary).join(' | ');
    expect(text).toContain('Credits (included)');
    expect(text).not.toMatch(AMOUNTS);
  });
});

describe('admins still see the figures', () => {
  const byId = Object.fromEntries(buildAdminPlansView(NOW).plans.map((plan) => [plan.id, plan]));

  it('the Tiers cards show every plan\'s allowance', () => {
    expect(byId.basic.credits).toBe('19,750 per month');
    expect(byId.pro.credits).toBe('32,250 per month');
    expect(byId.champion.credits).toBe('32,250 per month');
    expect(byId.trial.credits).toBe('2,000 in total');
  });

  it('the included list on each card carries the number too', () => {
    const row = byId.pro.includes.find((entry) => entry.capability === 'credits.allowance');
    expect(row?.display).toBe('32,250 per month');
  });
});

describe('the rule is narrow', () => {
  it('changes the credit allowance and no other row', () => {
    const rows = describePlanCapabilities(resolutionFor('pro'), catalog);
    const shown = withCustomerDisplay(rows);

    rows.forEach((row, i) => {
      if (row.capability === 'credits.allowance') expect(shown[i].display).toBe('included');
      else expect(shown[i]).toBe(row);
    });
  });
});
