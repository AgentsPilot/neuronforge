/**
 * Plan prices in Stripe: the lookup-key config (plan payments P-2b, workplan
 * §3.1, §3.2, §7; CF-1).
 */

import {
  PLAN_STRIPE_PRICES,
  allPlanLookupKeys,
  tierForPlanLookupKey,
  type PlanStripePrices,
} from '@/lib/business-os/entitlements/config/planPrices';
import { TIER_ORDER } from '@/lib/business-os/entitlements/config/tierMatrix';

/** The catalog reads every key in one Stripe call, which accepts at most ten. */
const STRIPE_MAX_LOOKUP_KEYS = 10;

const withRetired: PlanStripePrices = {
  basic: { lookupKey: 'bos_plan_basic_monthly_usd', retiredLookupKeys: ['bos_plan_basic_monthly_usd_retired_20270101'] },
  pro: { lookupKey: 'bos_plan_pro_monthly_usd', retiredLookupKeys: [] },
};

describe('PLAN_STRIPE_PRICES', () => {
  it('has an entry for every configured tier, and nothing else', () => {
    expect(Object.keys(PLAN_STRIPE_PRICES).sort()).toEqual([...TIER_ORDER].sort());
  });

  it('names the keys SA approved (Q-10); they are permanent in live mode', () => {
    expect(PLAN_STRIPE_PRICES.basic.lookupKey).toBe('bos_plan_basic_monthly_usd');
    expect(PLAN_STRIPE_PRICES.pro.lookupKey).toBe('bos_plan_pro_monthly_usd');
  });

  it('no key repeats, across tiers or between current and retired lists', () => {
    const every = Object.values(PLAN_STRIPE_PRICES).flatMap((p) => [p.lookupKey, ...p.retiredLookupKeys]);
    expect(new Set(every).size).toBe(every.length);
  });

  it('every retired key has the <key>_retired_<yyyymmdd> form of its own tier', () => {
    for (const p of Object.values(PLAN_STRIPE_PRICES) as PlanStripePrices[keyof PlanStripePrices][]) {
      for (const retired of p.retiredLookupKeys) {
        expect(retired).toMatch(new RegExp(`^${p.lookupKey}_retired_\\d{8}$`));
      }
    }
  });

  it('stays within the catalog limit of one Stripe call (10 keys), so no webhook throws on it', () => {
    expect(allPlanLookupKeys().length).toBeLessThanOrEqual(STRIPE_MAX_LOOKUP_KEYS);
  });

  it('holds no Stripe object id: keys only (account-agnostic)', () => {
    const text = JSON.stringify(PLAN_STRIPE_PRICES);
    expect(text).not.toMatch(/\b(price|prod|acct)_[A-Za-z0-9]{8,}/);
  });
});

describe('allPlanLookupKeys', () => {
  it('lists current keys in tier order when nothing is retired', () => {
    expect(allPlanLookupKeys()).toEqual(['bos_plan_basic_monthly_usd', 'bos_plan_pro_monthly_usd']);
  });

  it('includes retired keys, deduplicated', () => {
    expect(allPlanLookupKeys(withRetired)).toEqual([
      'bos_plan_basic_monthly_usd',
      'bos_plan_basic_monthly_usd_retired_20270101',
      'bos_plan_pro_monthly_usd',
    ]);
    const duplicated: PlanStripePrices = {
      basic: { lookupKey: 'k1', retiredLookupKeys: ['k1'] },
      pro: { lookupKey: 'k2', retiredLookupKeys: [] },
    };
    expect(allPlanLookupKeys(duplicated)).toEqual(['k1', 'k2']);
  });
});

describe('tierForPlanLookupKey', () => {
  it('names the tier of a current key', () => {
    expect(tierForPlanLookupKey('bos_plan_basic_monthly_usd')).toBe('basic');
    expect(tierForPlanLookupKey('bos_plan_pro_monthly_usd')).toBe('pro');
  });

  it('names the tier of a retired key (CF-1: a renewal on an old price keeps its tier)', () => {
    expect(tierForPlanLookupKey('bos_plan_basic_monthly_usd_retired_20270101', withRetired)).toBe('basic');
  });

  it('is null for an unknown key, a probe key, a prefix and an empty string', () => {
    for (const key of ['bos_plan_enterprise_monthly_usd', 'bos_router_fixture_probe_a', 'bos_plan_basic', '']) {
      expect(tierForPlanLookupKey(key)).toBeNull();
    }
  });
});
