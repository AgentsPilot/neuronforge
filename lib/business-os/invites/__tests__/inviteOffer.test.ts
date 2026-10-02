/**
 * FR-9 / GR-1 — the offered plan is described from the entitlements config
 * through the existing presentation helpers, and a grant that has left the
 * config is not described at all.
 *
 * Plan ids are read from config (`INVITE_TYPES`, `TIER_ORDER`), never written.
 */

import { readFileSync } from 'fs';
import { join } from 'path';

import { CHAMPION_INVITE_TYPE, INVITE_TYPES } from '@/lib/business-os/entitlements/config/invites';
import { TIER_ORDER } from '@/lib/business-os/entitlements/config/tierMatrix';
import { getEntitlementConfig, type EntitlementConfig } from '@/lib/business-os/entitlements/source';
import { isHiddenFromCustomer } from '@/lib/business-os/entitlements/customerPlanView';
import type { CapabilityDef } from '@/lib/business-os/entitlements/types';

import {
  describeInviteAccess,
  describeInviteOffer,
  inviteAccessOf,
  isInviteGrantAvailable,
  type InviteGrantFacts,
} from '../inviteOffer';

const NOW = new Date('2026-10-01T00:00:00.000Z');
const config = getEntitlementConfig();
const championGrant = INVITE_TYPES[CHAMPION_INVITE_TYPE].defaultGrantId;
const firstTier = TIER_ORDER[0] as string;

function champion(overrides: Partial<InviteGrantFacts> = {}): InviteGrantFacts {
  return { grant_kind: 'cohort', grant_id: championGrant, access_open_ended: true, access_months: null, ...overrides };
}

function tier(id: string = firstTier): InviteGrantFacts {
  return { grant_kind: 'tier', grant_id: id, access_open_ended: null, access_months: null };
}

describe('describeInviteOffer', () => {
  it('a champion offer is free, named by the cohort\'s own label', () => {
    const offer = describeInviteOffer(champion(), config, NOW);
    const cohortLabel = (config.cohorts as Record<string, { labels: { en: string } }>)[championGrant].labels.en;
    expect(offer.planName).toBe(cohortLabel);
    expect(offer.free).toBe(true);
    expect(offer.monthlyPriceUsd).toBe(0);
    expect(offer.access).toEqual({ kind: 'open_ended', months: null });
  });

  it('a tier offer carries its price from the presentation block, and is not free', () => {
    const offer = describeInviteOffer(tier(), config, NOW);
    const presentation = (config.matrix.presentation as Record<string, { monthlyPriceUsd: number; labels: { en: string } }>)[firstTier];
    expect(offer.free).toBe(false);
    expect(offer.monthlyPriceUsd).toBe(presentation.monthlyPriceUsd);
    expect(offer.planName).toBe(presentation.labels.en);
    expect(offer.access).toEqual({ kind: 'while_paid', months: null });
  });

  it('what is included is non-empty, grouped, and excludes capabilities hidden from customers', () => {
    const offer = describeInviteOffer(champion(), config, NOW);
    expect(offer.included.length).toBeGreaterThan(0);
    const catalog = config.catalog as Record<string, CapabilityDef>;
    const hiddenLabels = Object.entries(catalog)
      .filter(([capability, definition]) => isHiddenFromCustomer(capability, definition))
      .map(([, definition]) => definition.labels.en);
    const joined = offer.included.map((row) => row.summary).join(' | ');
    for (const label of hiddenLabels) expect(joined).not.toContain(label);
    for (const row of offer.included) {
      expect(Object.keys(row).sort()).toEqual(['category', 'features', 'labelKey', 'noteKey', 'summary']);
    }
  });

  it('names the credits first, with the allowance from config and the sentence key (slice 6, D-g / D-h)', () => {
    // The public invite page is the first place a prospect sees a credit figure.
    // The number is read from the tier matrix here, not written: the test fails
    // if the offer stops reading config, and does not need editing when a
    // figure is re-priced.
    const allowance = (config.matrix.tiers as Record<string, Record<string, unknown>>)[firstTier][
      'credits.allowance'
    ] as { perMonth: number };
    const offer = describeInviteOffer(tier(), config, NOW);
    const first = offer.included[0];

    expect(first.category).toBe('credits');
    expect(first.labelKey).toBe('plan.category.credits');
    expect(first.noteKey).toBe('usage.explain.monthly');
    expect(first.summary).toBe(`Credits (${allowance.perMonth.toLocaleString('en-US')} per month)`);
    // Only the credits row carries a sentence.
    expect(offer.included.filter((row) => row.noteKey !== null)).toHaveLength(1);
  });

  it.each([
    ['he', 'קרדיטים', 'לחודש'],
    ['es', 'Créditos', 'al mes'],
  ] as const)("in the invite's language (%s): names, per month and grouping are localised (OI-10)", (locale, label, perMonth) => {
    const allowance = (config.matrix.tiers as Record<string, Record<string, unknown>>)[firstTier][
      'credits.allowance'
    ] as { perMonth: number };
    const offer = describeInviteOffer(tier(), config, NOW, locale);
    const presentation = (config.matrix.presentation as Record<string, { labels: Record<string, string> }>)[firstTier];

    expect(offer.planName).toBe(presentation.labels[locale]);
    // Grouping by the same `Intl` call the module makes — never a hand-typed separator (SA Q-10).
    const number = new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(allowance.perMonth);
    expect(offer.included[0].summary).toBe(`${label} (${number} ${perMonth})`);
    // No English value phrase left anywhere in the offer.
    const joined = offer.included.map((row) => row.summary).join(' | ');
    expect(joined).not.toMatch(/per month|in total/);
    // Ids are not translated: the keys stay the same in every language.
    expect(offer.included.map((row) => row.labelKey)).toEqual(
      describeInviteOffer(tier(), config, NOW).included.map((row) => row.labelKey)
    );
  });

  it('a months grant is described as data', () => {
    expect(describeInviteOffer(champion({ access_open_ended: false, access_months: 12 }), config, NOW).access).toEqual({
      kind: 'months',
      months: 12,
    });
  });
});

describe('describeInviteAccess (the admin list sentence)', () => {
  it('open-ended, months, and paid', () => {
    expect(describeInviteAccess(champion())).toBe('No end date');
    expect(describeInviteAccess(champion({ access_open_ended: false, access_months: 1 }))).toBe('1 month from signup');
    expect(describeInviteAccess(champion({ access_open_ended: false, access_months: 12 }))).toBe('12 months from signup');
    expect(describeInviteAccess(tier())).toBe('While the plan is paid for');
    expect(inviteAccessOf(tier())).toEqual({ kind: 'while_paid', months: null });
  });
});

describe('isInviteGrantAvailable (GR-1)', () => {
  it('today\'s grants are available', () => {
    expect(isInviteGrantAvailable(config, champion())).toBe(true);
    for (const id of TIER_ORDER) expect(isInviteGrantAvailable(config, tier(id))).toBe(true);
  });

  it('a plan that has left the config is not', () => {
    expect(isInviteGrantAvailable(config, tier('retired-tier'))).toBe(false);
    expect(isInviteGrantAvailable(config, champion({ grant_id: 'retired-cohort' }))).toBe(false);
    const withoutFirstTier: EntitlementConfig = { ...config, tierOrder: config.tierOrder.filter((id) => id !== firstTier) };
    expect(isInviteGrantAvailable(withoutFirstTier, tier())).toBe(false);
  });

  it('a real cohort no invite type grants (the trial) is not', () => {
    const otherCohorts = Object.keys(config.cohorts).filter((id) => id !== championGrant);
    expect(otherCohorts.length).toBeGreaterThan(0);
    for (const id of otherCohorts) expect(isInviteGrantAvailable(config, champion({ grant_id: id }))).toBe(false);
  });

  it('a grant kind that does not match the plan is not', () => {
    expect(isInviteGrantAvailable(config, { grant_kind: 'tier', grant_id: championGrant })).toBe(false);
    expect(isInviteGrantAvailable(config, { grant_kind: 'cohort', grant_id: firstTier })).toBe(false);
  });
});

describe('no plan contents written into the invite modules (FR-9)', () => {
  it.each(['inviteOffer.ts', 'publicInviteView.ts', 'adminInviteOps.ts'])('%s names no plan and no price', (file) => {
    const source = readFileSync(join(process.cwd(), 'lib', 'business-os', 'invites', file), 'utf8');
    expect(source).not.toMatch(/Essentials|Autopilot|Test Flight|Founding Partner/);
    expect(source).not.toMatch(/['"`](basic|pro|trial|champion)['"`]/);
    expect(source).not.toMatch(/\$\s?\d/);
  });
});
