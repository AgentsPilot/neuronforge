/**
 * `describePlanOffer` — the read-only plan preview that lets code outside the
 * entitlements module describe a plan without importing the resolver (SA M-3).
 */

import { readFileSync } from 'fs';
import { join } from 'path';

import { COHORT_IDS } from '@/lib/business-os/entitlements/config/cohorts';
import { TIER_ORDER } from '@/lib/business-os/entitlements/config/tierMatrix';
import { buildCustomerPlanView, isHiddenFromCustomer } from '@/lib/business-os/entitlements/customerPlanView';
import { planLabel, planMonthlyPriceUsd, previewAccountFor } from '@/lib/business-os/entitlements/planPresentation';
import { describePlanOffer } from '@/lib/business-os/entitlements/planOfferView';
import { resolveEntitlements } from '@/lib/business-os/entitlements/resolver';
import { getEntitlementConfig } from '@/lib/business-os/entitlements/source';
import type { CapabilityDef } from '@/lib/business-os/entitlements/types';

const NOW = new Date('2026-10-01T00:00:00.000Z');
const config = getEntitlementConfig();
const catalog = config.catalog as Record<string, CapabilityDef>;

describe('describePlanOffer', () => {
  it.each([...TIER_ORDER])('tier %s: named and priced from presentation, not free', (tier) => {
    const offer = describePlanOffer(config, tier, NOW);
    expect(offer.planName).toBe(planLabel(config, tier));
    expect(offer.monthlyPriceUsd).toBe(planMonthlyPriceUsd(config, tier));
    expect(offer.monthlyPriceUsd).toBeGreaterThan(0);
    expect(offer.free).toBe(false);
  });

  it.each([...COHORT_IDS])('cohort %s: named by its label, free, price 0', (cohort) => {
    const offer = describePlanOffer(config, cohort, NOW);
    expect(offer.planName).toBe(planLabel(config, cohort));
    expect(offer.free).toBe(true);
    expect(offer.monthlyPriceUsd).toBe(0);
  });

  it('includes exactly what the customer section would list for an account on that plan', () => {
    for (const planId of [...TIER_ORDER, ...COHORT_IDS]) {
      const resolution = resolveEntitlements({
        config,
        account: previewAccountFor(config, planId, NOW),
        overrides: [],
        addons: [],
        now: NOW,
      });
      const customer = buildCustomerPlanView({ resolution, unavailable: false, now: NOW, config });
      const offer = describePlanOffer(config, planId, NOW);
      expect(offer.included).toEqual(
        customer.included.map((row) => ({ category: row.category, label: row.label, summary: row.summary }))
      );
      expect(offer.included.length).toBeGreaterThan(0);
    }
  });

  it('never names a capability hidden from customers', () => {
    const hidden = Object.entries(catalog)
      .filter(([capability, definition]) => isHiddenFromCustomer(capability, definition))
      .map(([, definition]) => definition.labels.en);
    for (const planId of [...TIER_ORDER, ...COHORT_IDS]) {
      const text = describePlanOffer(config, planId, NOW).included.map((row) => row.summary).join(' | ');
      for (const label of hidden) expect(text).not.toContain(label);
    }
  });

  it('returns exactly the four offer keys, and each row three', () => {
    const offer = describePlanOffer(config, TIER_ORDER[0], NOW);
    expect(Object.keys(offer).sort()).toEqual(['free', 'included', 'monthlyPriceUsd', 'planName']);
    for (const row of offer.included) expect(Object.keys(row).sort()).toEqual(['category', 'label', 'summary']);
  });

  it('is server-only and reads nothing but config (no repository, no account id)', () => {
    const source = readFileSync(join(process.cwd(), 'lib', 'business-os', 'entitlements', 'planOfferView.ts'), 'utf8');
    expect(source.startsWith("import 'server-only';")).toBe(true);
    expect(source).not.toMatch(/repositories|supabase|getSnapshot|userId/);
  });
});
