/**
 * Credit deduction slice 6, part 6b — the credit allowance on the plan screen
 * and the invite page.
 *
 *   D-g  a `credits` category, FIRST, with its own heading;
 *   D-h  the sentence saying what a credit is, under that row only, monthly or
 *        one-off by the allowance's SHAPE (SA Q-9) — never by a plan name;
 *   OI-10 the value phrases ("per month", "in total") and the number grouping
 *        in the reader's language; ids unchanged; admin stays English (SA Q-10).
 *
 * Every figure here is READ from config, never written: the user's rule
 * (2026-10-01) is that credit numbers come only from configuration, and a test
 * that hard-codes them would have to be edited on every re-price. Grouping is
 * produced by the same `Intl` call the module makes, never a hand-typed
 * separator (SA Q-10).
 */

import { readFileSync } from 'fs';
import { join } from 'path';

import { buildAdminPlansView } from '@/lib/business-os/entitlements/adminPlansView';
import { describeCapabilityValue } from '@/lib/business-os/entitlements/capabilityDisplay';
import { buildCustomerPlanView } from '@/lib/business-os/entitlements/customerPlanView';
import { previewAccountFor } from '@/lib/business-os/entitlements/planPresentation';
import { describePlanOffer } from '@/lib/business-os/entitlements/planOfferView';
import { resolveEntitlements } from '@/lib/business-os/entitlements/resolver';
import { readCodeConfig, type EntitlementConfig } from '@/lib/business-os/entitlements/source';
import type { CapabilityDef, CapabilityValue } from '@/lib/business-os/entitlements/types';
import { INVITE_LOCALES, INVITE_PAGE_COPY } from '@/app/invite/invitePageCopy';
import type { Locale } from '@/lib/i18n/config';

const NOW = new Date('2026-10-01T00:00:00.000Z');
const config = readCodeConfig();
const catalog = config.catalog as Record<string, CapabilityDef>;

/** Every plan a customer can be on: the tiers and the cohorts, read off config. */
const PLANS = [...config.tierOrder, ...Object.keys(config.cohorts)];

function resolutionFor(planId: string, cfg: EntitlementConfig = config) {
  return resolveEntitlements({ config: cfg, account: previewAccountFor(cfg, planId, NOW), overrides: [], addons: [], now: NOW });
}

function viewFor(planId: string, locale?: Locale, cfg: EntitlementConfig = config) {
  return buildCustomerPlanView({ resolution: resolutionFor(planId, cfg), unavailable: false, now: NOW, config: cfg, locale });
}

/** The allowance the resolver gives this plan — the one number source. */
function allowanceOf(planId: string): { perMonth?: number; total?: number } {
  return resolutionFor(planId).values['credits.allowance'].value as { perMonth?: number; total?: number };
}

const group = (locale: Locale, n: number) => new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(n);

const PHRASE: Record<Locale, { perMonth: string; total: string; label: string }> = {
  en: { perMonth: 'per month', total: 'in total', label: 'Credits' },
  he: { perMonth: 'לחודש', total: 'בסך הכול', label: 'קרדיטים' },
  es: { perMonth: 'al mes', total: 'en total', label: 'Créditos' },
};

function expectedLine(planId: string, locale: Locale): string {
  const allowance = allowanceOf(planId);
  const words = PHRASE[locale];
  return typeof allowance.total === 'number'
    ? `${words.label} (${group(locale, allowance.total)} ${words.total})`
    : `${words.label} (${group(locale, allowance.perMonth!)} ${words.perMonth})`;
}

describe('D-g: the credit allowance has its own row, first', () => {
  it('the catalog files it under `credits`', () => {
    expect(catalog['credits.allowance'].category).toBe('credits');
  });

  it.each(PLANS)('%s: the first included row is credits, with its own heading key', (planId) => {
    const first = viewFor(planId).included[0];

    expect(first.category).toBe('credits');
    expect(first.labelKey).toBe('plan.category.credits');
    expect(first.features.map((feature) => feature.capability)).toEqual(['credits.allowance']);
  });

  it.each(PLANS)('%s: the line carries the number the resolver gives the plan', (planId) => {
    expect(viewFor(planId).included[0].summary).toBe(expectedLine(planId, 'en'));
  });
});

describe('D-h: the sentence under the credits row (SA Q-9)', () => {
  it.each(PLANS)('%s: the variant follows the allowance shape', (planId) => {
    const expected = typeof allowanceOf(planId).total === 'number' ? 'usage.explain.trial' : 'usage.explain.monthly';

    expect(viewFor(planId).included[0].noteKey).toBe(expected);
    expect(describePlanOffer(config, planId, NOW).included[0].noteKey).toBe(expected);
  });

  it('both variants are reachable from the shipped config (non-vacuity)', () => {
    const keys = new Set(PLANS.map((planId) => viewFor(planId).included[0].noteKey));
    expect([...keys].sort()).toEqual(['usage.explain.monthly', 'usage.explain.trial']);
  });

  it.each(PLANS)('%s: no other row carries a sentence, in the list or in the next plan up', (planId) => {
    const view = viewFor(planId);
    expect(view.included.slice(1).every((row) => row.noteKey === null)).toBe(true);
    expect((view.nextPlanUp?.adds ?? []).every((row) => row.noteKey === null)).toBe(true);
  });

  it('is chosen by SHAPE, not by plan: a paid tier given a one-off total reads the one-off sentence', () => {
    // A fixture, not a product decision: proves no plan name is consulted.
    const firstTier = config.tierOrder[0];
    const oneOff = {
      ...config,
      matrix: {
        ...config.matrix,
        tiers: {
          ...config.matrix.tiers,
          [firstTier]: { ...config.matrix.tiers[firstTier as keyof typeof config.matrix.tiers], 'credits.allowance': { total: 7 } },
        },
      },
    } as EntitlementConfig;

    expect(resolutionFor(firstTier, oneOff).values['credits.allowance'].value).toEqual({ total: 7 });
    expect(viewFor(firstTier, 'en', oneOff).included[0].noteKey).toBe('usage.explain.trial');
  });

  it('every note key the module can name is worded on BOTH surfaces, in all three languages', () => {
    const noteKeys = new Set(PLANS.map((planId) => viewFor(planId).included[0].noteKey!));

    // The plan screen: the dictionary (read as text — it is a client module).
    const dictionary = readFileSync(join(process.cwd(), 'lib/business-os/LanguageContext.tsx'), 'utf8');
    for (const key of noteKeys) {
      expect(dictionary.split(`'${key}':`).length - 1).toBe(3);
    }

    // The invite page: its own copy, in the invite's language.
    for (const locale of INVITE_LOCALES) {
      for (const key of noteKeys) expect(INVITE_PAGE_COPY[locale].planCategoryNote[key]).toBeTruthy();
      expect(INVITE_PAGE_COPY[locale].planCategory['plan.category.credits']).toBe(PHRASE[locale].label);
    }
  });
});

describe('OI-10: values in the reader\'s language (SA Q-10)', () => {
  it.each(['he', 'es'] as const)('%s: the credits line of every plan is localised, number grouped by the language', (locale) => {
    for (const planId of PLANS) {
      expect(viewFor(planId, locale).included[0].summary).toBe(expectedLine(planId, locale));
      expect(describePlanOffer(config, planId, NOW, locale).included[0].summary).toBe(expectedLine(planId, locale));
    }
  });

  it.each(['he', 'es'] as const)('%s: no English value phrase is left in the customer view', (locale) => {
    for (const planId of PLANS) {
      const view = viewFor(planId, locale);
      const text = [
        ...view.included.map((row) => row.summary),
        ...(view.nextPlanUp?.improves ?? []).flatMap((entry) => [entry.from, entry.to]),
        ...(view.nextPlanUp?.changes ?? []).flatMap((entry) => [entry.from, entry.to]),
      ].join(' | ');
      expect(text).not.toMatch(/per month|in total|alerts, never blocks|more purchasable/);
    }
  });

  it.each(['en', 'he', 'es'] as const)('%s: the next plan up and the trial change read in the same language', (locale) => {
    const firstTier = config.tierOrder[0];
    const secondTier = config.tierOrder[1];
    const fromTier = allowanceOf(firstTier).perMonth!;
    const toTier = allowanceOf(secondTier).perMonth!;

    const improves = viewFor(firstTier, locale).nextPlanUp!.improves.find((entry) => entry.capability === 'credits.allowance')!;
    expect(improves.from).toBe(`${group(locale, fromTier)} ${PHRASE[locale].perMonth}`);
    expect(improves.to).toBe(`${group(locale, toTier)} ${PHRASE[locale].perMonth}`);

    // The trial: a one-off total becomes a monthly rate — a CHANGE, never a gain.
    const trialId = PLANS.find((planId) => typeof allowanceOf(planId).total === 'number')!;
    const change = viewFor(trialId, locale).nextPlanUp!.changes.find((entry) => entry.capability === 'credits.allowance')!;
    expect(change.from).toBe(`${group(locale, allowanceOf(trialId).total!)} ${PHRASE[locale].total}`);
    expect(change.to).toBe(`${group(locale, allowanceOf(firstTier).perMonth!)} ${PHRASE[locale].perMonth}`);
  });

  it('ids are not translated: categories, heading keys and capability ids are the same in every language', () => {
    for (const planId of PLANS) {
      const shape = (locale: Locale) =>
        viewFor(planId, locale).included.map((row) => [row.category, row.labelKey, row.noteKey, row.features.map((f) => f.capability)]);
      expect(shape('he')).toEqual(shape('en'));
      expect(shape('es')).toEqual(shape('en'));
    }
  });

  it('a variant id passes through unchanged in every language', () => {
    const variant = Object.entries(catalog).find(([, definition]) => definition.shape.kind === 'variant')!;
    const value = (variant[1].shape as { variants: readonly string[] }).variants[0] as CapabilityValue;

    expect(describeCapabilityValue(value, variant[1], 'he')).toBe(value);
    expect(describeCapabilityValue(value, variant[1], 'es')).toBe(value);
  });

  it('with no locale it is English — which is what every admin caller gets', () => {
    const definition = catalog['credits.allowance'];
    expect(describeCapabilityValue({ perMonth: 1234 }, definition)).toBe(`${group('en', 1234)} per month`);
    expect(describeCapabilityValue({ total: 1234 }, definition)).toBe(`${group('en', 1234)} in total`);
  });

  it('the admin Tiers view stays English', () => {
    const view = buildAdminPlansView(NOW);
    for (const plan of view.plans) {
      expect(plan.credits).toMatch(/ (per month|in total)$/);
    }
  });
});
