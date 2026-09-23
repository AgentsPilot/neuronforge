/**
 * The five layers, on the fixture matrix (production ships none — U-1).
 *
 * Each test names the layer it is about, because the layers are only meaningful
 * in order: a test that asserted a final value without saying which layer put it
 * there would still pass if two layers swapped.
 */

import { fixtureConfig } from '@/lib/business-os/entitlements/__fixtures__/fixtureSource';
import { account, championAccount, override, tierAccount, trialAccount } from '@/lib/business-os/entitlements/__fixtures__/accounts';
import { lowestTierFor, resolveEntitlements, satisfies, withheldValue } from '@/lib/business-os/entitlements/resolver';
import { readCodeConfig } from '@/lib/business-os/entitlements/source';
import type { EntitlementConfig } from '@/lib/business-os/entitlements/source';
import { CAPABILITIES } from '@/lib/business-os/entitlements/config/catalog';
import type { CapabilityDef } from '@/lib/business-os/entitlements/types';

const NOW = new Date('2026-09-22T00:00:00.000Z');
const config = fixtureConfig();

function resolve(acct: Parameters<typeof resolveEntitlements>[0]['account'], overrides: Parameters<typeof resolveEntitlements>[0]['overrides'] = [], cfg: EntitlementConfig = config) {
  return resolveEntitlements({ config: cfg, account: acct, overrides, addons: [], now: NOW });
}

describe('layer 1 — the basis', () => {
  it('a tier account resolves from its own row', () => {
    const result = resolve(tierAccount('growth'));

    expect(result.basis).toEqual({ kind: 'tier', tier: 'growth' });
    expect(result.values['chat.marketing'].value).toBe(true); // growth has it
    expect(result.values['chat.search'].value).toBe(false); // pro only
    expect(result.values['ai.actions'].value).toEqual({ perMonth: 500 });
    expect(result.values['chat.search'].trace[0].note).toContain('tier growth');
  });

  it('a champion gets the catalog-derived maximum (RC-2, B-14)', () => {
    const result = resolve(championAccount());

    expect(result.basis).toEqual({ kind: 'cohort', cohort: 'champion' });
    expect(result.values['chat.search'].value).toBe(true);
    // Variant: the TOP of the list, which is what makes the order load-bearing.
    expect(result.values['website.branding'].value).toBe('unbranded');
    expect(result.values['intake.forms'].value).toBe('ai');
    // Quantities cannot be derived, so they come from the cohort's own numbers.
    expect(result.values['ai.actions'].value).toEqual(readCodeConfig().cohorts.champion.values['ai.actions']);
  });

  it('a trial gets the same everything, with the trial numbers', () => {
    const result = resolve(trialAccount('2026-09-20T00:00:00.000Z'));

    expect(result.state).toBe('trial');
    expect(result.values['chat.search'].value).toBe(true);
    expect(result.values['ai.actions'].value).toEqual(readCodeConfig().cohorts.trial.values['ai.actions']);
  });

  it('an anomaly grants nothing at all', () => {
    const result = resolve(account());

    expect(result.anomaly).toBe('no_assignment');
    for (const [capability, definition] of Object.entries(CAPABILITIES)) {
      expect(result.values[capability].value).toEqual(withheldValue(definition as CapabilityDef));
    }
  });

  it('returns a value for EVERY capability, always', () => {
    // "Absent" must never have two meanings. A caller can ask about anything.
    for (const acct of [tierAccount('basic'), championAccount(), account()]) {
      expect(Object.keys(resolve(acct).values).sort()).toEqual(Object.keys(CAPABILITIES).sort());
    }
  });
});

describe('the lifecycle gate (FR-13)', () => {
  it('not_built is off for a champion who gets "everything"', () => {
    const result = resolve(championAccount());

    expect(result.values['marketing.mass_email'].value).toBe(false);
    expect(result.values['payments.reminders'].value).toBe(false);
    expect(result.values['website.custom_domain'].value).toBe('unavailable');
    expect(result.values['sms.messages'].value).toEqual({ perMonth: 0 });
    expect(result.values['marketing.mass_email'].decidedBy).toBe('lifecycle_gate');
  });

  it('not_built cannot be turned on by an override either', () => {
    const result = resolve(championAccount(), [override({ capability: 'marketing.posts', op: 'set', value: true })]);

    expect(result.values['marketing.posts'].value).toBe(false);
    expect(result.ignoredOverrides).toContainEqual({ id: 'ovr-1', capability: 'marketing.posts', reason: 'not_built' });
  });

  it('beta is reachable through a cohort that opts in, and not through a tier', () => {
    // No capability is `beta` today, so the rule is exercised against a catalog
    // with one — otherwise this test would pass by having nothing to check.
    const beta = { ...config.catalog, 'chat.quotes': { ...CAPABILITIES['chat.quotes'], lifecycle: 'beta' } } as unknown as typeof config.catalog;

    const optedIn = resolve(championAccount(), [], { ...config, catalog: beta });
    expect(optedIn.values['chat.quotes'].value).toBe(true);

    const cohorts = { ...config.cohorts, champion: { ...config.cohorts.champion, includeLifecycle: [] } };
    const optedOut = resolve(championAccount(), [], { ...config, catalog: beta, cohorts });
    expect(optedOut.values['chat.quotes'].value).toBe(false);

    // A tier sells `available` features. Growth's row says true; the gate says
    // beta is not something a plan includes.
    const onATier = resolve(tierAccount('growth'), [], { ...config, catalog: beta });
    expect(onATier.values['chat.quotes'].value).toBe(false);
    expect(onATier.values['chat.quotes'].trace[0].note).toContain('beta');
  });
});

describe('layer 1a — grandfathering (B-10, T-11)', () => {
  const removed: EntitlementConfig = {
    ...config,
    matrix: {
      ...config.matrix,
      version: 2,
      tiers: {
        ...(config.matrix.tiers as Record<string, Record<string, unknown>>),
        growth: { ...(config.matrix.tiers as Record<string, Record<string, unknown>>).growth, 'chat.reporting': false },
      },
      removals: [
        { version: 2, tier: 'growth', capability: 'chat.reporting', previousValue: true, grandfatherUntil: '2027-01-01T00:00:00.000Z' },
      ],
    } as unknown as EntitlementConfig['matrix'],
  };

  it('a subscriber sold at v1 keeps what v2 took away', () => {
    const result = resolve(tierAccount('growth', { planVersion: 1 }), [], removed);

    expect(result.values['chat.reporting'].value).toBe(true);
    expect(result.values['chat.reporting'].decidedBy).toBe('grandfather');
  });

  it('a subscriber sold at v2 never had it', () => {
    expect(resolve(tierAccount('growth', { planVersion: 2 }), [], removed).values['chat.reporting'].value).toBe(false);
  });

  it('it stops at the sunset date', () => {
    const later = resolveEntitlements({ config: removed, account: tierAccount('growth', { planVersion: 1 }), overrides: [], now: new Date('2027-06-01T00:00:00.000Z') });
    expect(later.values['chat.reporting'].value).toBe(false);
  });

  it('it does not follow an account to another tier', () => {
    expect(resolve(tierAccount('pro', { planVersion: 1 }), [], removed).values['chat.reporting'].decidedBy).not.toBe('grandfather');
  });

  it('it does not apply to a cohort account', () => {
    // Layer 1a is a tier rule. A champion already has everything, so the only
    // way to see the difference is the trace.
    const result = resolve(championAccount(), [], removed);
    expect(result.values['chat.reporting'].decidedBy).toBe('basis');
  });
});

describe('layer 2 — add-ons (Slice 4 data, merged now — S-3)', () => {
  it('an add-on switches on an add-on-shaped capability', () => {
    const result = resolveEntitlements({
      config,
      account: tierAccount('basic'),
      overrides: [],
      addons: [{ capability: 'addon.marketing_analytics' }],
      now: NOW,
    });

    // …except that this one is not_built, so the gate refuses it first. That IS
    // the expected answer, and it is worth pinning: buying an add-on must not be
    // a way round "the feature does not exist".
    expect(result.values['addon.marketing_analytics'].value).toBe('unavailable');
  });

  it('a quantity add-on adds to the tier value', () => {
    const result = resolveEntitlements({
      config,
      account: tierAccount('pro'),
      overrides: [],
      addons: [{ capability: 'team.seats', amount: 3 }],
      now: NOW,
    });

    expect(result.values['team.seats'].value).toMatchObject({ included: 8 }); // pro has 5
    expect(result.values['team.seats'].decidedBy).toBe('addon');
  });
});

describe('layer 4 — overrides (FR-11)', () => {
  it('set replaces the value', () => {
    const result = resolve(tierAccount('basic'), [override({ capability: 'chat.search', op: 'set', value: true })]);
    expect(result.values['chat.search']).toMatchObject({ value: true, decidedBy: 'override' });
  });

  it('add increases a quantity', () => {
    const result = resolve(tierAccount('basic'), [override({ capability: 'ai.actions', op: 'add', value: 250 })]);
    expect(result.values['ai.actions'].value).toEqual({ perMonth: 350 }); // basic has 100
  });

  it('revoke drops to the floor', () => {
    const result = resolve(tierAccount('pro'), [override({ capability: 'chat.search', op: 'revoke', value: null })]);
    expect(result.values['chat.search'].value).toBe(false);
  });

  it('several on one capability apply in created_at order', () => {
    const result = resolve(tierAccount('basic'), [
      override({ id: 'b', capability: 'ai.actions', op: 'set', value: { perMonth: 1000 }, createdAt: '2026-02-01T00:00:00.000Z' }),
      override({ id: 'a', capability: 'ai.actions', op: 'add', value: 50, createdAt: '2026-01-01T00:00:00.000Z' }),
    ]);

    // add(50) over basic's 100, then set(1000) — the later one wins.
    expect(result.values['ai.actions'].value).toEqual({ perMonth: 1000 });
    expect(result.values['ai.actions'].trace.map((t) => t.note)).toEqual([
      'tier basic',
      'override a (add)',
      'override b (set)',
    ]);
  });

  it('ended and expired ones are ignored, and SAID to be ignored', () => {
    const result = resolve(tierAccount('basic'), [
      override({ id: 'ended', capability: 'chat.search', endedAt: '2026-05-01T00:00:00.000Z' }),
      override({ id: 'expired', capability: 'chat.bulk', expiresAt: '2026-05-01T00:00:00.000Z' }),
      override({ id: 'unknown', capability: 'chat.telepathy' }),
    ]);

    expect(result.values['chat.search'].value).toBe(false);
    expect(result.values['chat.bulk'].value).toBe(false);
    expect(result.ignoredOverrides).toEqual(
      expect.arrayContaining([
        { id: 'ended', capability: 'chat.search', reason: 'ended' },
        { id: 'expired', capability: 'chat.bulk', reason: 'expired' },
        { id: 'unknown', capability: 'chat.telepathy', reason: 'unknown_capability' },
      ])
    );
  });

  it('an override that has not expired still applies', () => {
    // The negative control for the case above: without it, a bug that ignored
    // every override would pass every assertion in this block.
    const result = resolve(tierAccount('basic'), [override({ capability: 'chat.bulk', expiresAt: '2027-01-01T00:00:00.000Z' })]);
    expect(result.values['chat.bulk'].value).toBe(true);
  });
});

describe('lowestTierFor (RC-1)', () => {
  it('names the cheapest tier that satisfies the ask', () => {
    expect(lowestTierFor(config, 'chat.search')).toBe('pro');
    expect(lowestTierFor(config, 'chat.marketing')).toBe('growth');
    expect(lowestTierFor(config, 'crm.core')).toBe('basic');
  });

  it('compares quantities, not just presence', () => {
    expect(lowestTierFor(config, 'ai.actions', { perMonth: 100 })).toBe('basic');
    expect(lowestTierFor(config, 'ai.actions', { perMonth: 750 })).toBe('pro');
    expect(lowestTierFor(config, 'ai.actions', { perMonth: 99999 })).toBeNull();
  });

  it('is null for a not_built capability, whatever a tier says', () => {
    expect(lowestTierFor(config, 'marketing.posts')).toBeNull();
  });

  it('is null for EVERY capability on the production config (U-1)', () => {
    // The whole point of shipping with no tiers: nothing can offer an upgrade,
    // because there is nothing to upgrade to.
    const production = readCodeConfig();
    for (const capability of Object.keys(production.catalog)) {
      expect(lowestTierFor(production, capability)).toBeNull();
    }
  });
});

describe('satisfies', () => {
  const def = CAPABILITIES['ai.actions'] as CapabilityDef;

  it('covers an equal or larger ask', () => {
    expect(satisfies(def, { perMonth: 500 }, { perMonth: 100 })).toBe(true);
    expect(satisfies(def, { perMonth: 500 }, { perMonth: 500 })).toBe(true);
    expect(satisfies(def, { perMonth: 100 }, { perMonth: 500 })).toBe(false);
  });

  it('without an ask, means "granted at all"', () => {
    expect(satisfies(def, { perMonth: 1 })).toBe(true);
    expect(satisfies(def, { perMonth: 0 })).toBe(false);
    expect(satisfies(CAPABILITIES['crm.core'] as CapabilityDef, true)).toBe(true);
    expect(satisfies(CAPABILITIES['crm.core'] as CapabilityDef, false)).toBe(false);
  });

  it('compares variants by the catalog order', () => {
    const branding = CAPABILITIES['website.branding'] as CapabilityDef;
    expect(satisfies(branding, 'unbranded', 'branded')).toBe(true);
    expect(satisfies(branding, 'branded', 'unbranded')).toBe(false);
  });
});
