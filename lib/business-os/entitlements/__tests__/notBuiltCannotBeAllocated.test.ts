/**
 * "If a feature does not exist it cannot be allocated." (user, 2026-09-22)
 *
 * `lifecycle: 'not_built'` already meant "never entitled" at resolution time
 * (FR-13). The gap it left was commercial rather than technical: a tier could
 * still LIST the capability, so a plan's feature list and what the customer
 * actually gets could disagree — and the customer would be the one to find out.
 *
 * The loader now rejects that config. These tests prove the rejection fires for
 * every shape a grant can take, and — just as important — that withholding the
 * same capability is accepted, so the rule cannot be satisfied by refusing
 * everything.
 */

import { CAPABILITIES } from '@/lib/business-os/entitlements/config/catalog';
import { fixtureConfig } from '@/lib/business-os/entitlements/__fixtures__/fixtureSource';
import { FIXTURE_TIER_MATRIX } from '@/lib/business-os/entitlements/__fixtures__/exampleTierMatrix';
import { isGrantingValue } from '@/lib/business-os/entitlements/schema';
import { readCodeConfig, validateEntitlementConfig } from '@/lib/business-os/entitlements/source';
import type { EntitlementConfig } from '@/lib/business-os/entitlements/source';
import type { CapabilityValue } from '@/lib/business-os/entitlements/types';

/** The fixture matrix with one tier value replaced. */
function withTierValue(tier: string, capability: string, value: unknown): EntitlementConfig {
  const matrix = JSON.parse(JSON.stringify(FIXTURE_TIER_MATRIX)) as Record<string, unknown>;
  (matrix.tiers as Record<string, Record<string, unknown>>)[tier][capability] = value;
  return fixtureConfig({ matrix: matrix as EntitlementConfig['matrix'] });
}

describe('a tier may not grant a capability that does not exist', () => {
  // One case per SHAPE, because "granting" means something different in each.
  const grants: Array<[string, string, unknown]> = [
    ['boolean', 'marketing.posts', true],
    ['boolean (a stubbed sender)', 'payments.reminders', true],
    ['boolean (a builder with no dispatcher)', 'marketing.mass_email', true],
    ['add-on, included', 'website.custom_domain', 'included'],
    // `purchasable` is the one worth spelling out: it is an OFFER TO SELL
    // something that does not exist, which is the failure the rule is about.
    ['add-on, merely purchasable', 'addon.mobile', 'purchasable'],
    ['metered allowance', 'sms.messages', { perMonth: 250 }],
  ];

  it.each(grants)('rejects granting a not_built capability by %s', (_shape, capability, value) => {
    expect(() => validateEntitlementConfig(withTierValue('pro', capability, value))).toThrow(
      /not_built|cannot be allocated/
    );
  });

  it('names the capability and the tier in the error', () => {
    // An operator adding a tier needs to know WHICH line to fix, not that
    // "the tier matrix is invalid".
    expect(() => validateEntitlementConfig(withTierValue('growth', 'marketing.posts', true))).toThrow(
      /marketing\.posts/
    );
    expect(() => validateEntitlementConfig(withTierValue('growth', 'marketing.posts', true))).toThrow(/growth/);
  });

  it('suggests the value that withholds it', () => {
    expect(() => validateEntitlementConfig(withTierValue('pro', 'addon.mobile', 'included'))).toThrow(
      /unavailable/
    );
  });

  const withheld: Array<[string, string, unknown]> = [
    ['boolean false', 'marketing.posts', false],
    ['add-on unavailable', 'website.custom_domain', 'unavailable'],
    ['zero allowance', 'sms.messages', { perMonth: 0 }],
  ];

  it.each(withheld)('accepts withholding it by %s', (_shape, capability, value) => {
    expect(() => validateEntitlementConfig(withTierValue('pro', capability, value))).not.toThrow();
  });

  it('leaves capabilities that DO exist alone', () => {
    // The negative control on the rule itself: if it rejected everything, every
    // test above would pass for the wrong reason.
    expect(() => validateEntitlementConfig(withTierValue('basic', 'chat.search', true))).not.toThrow();
    expect(() => validateEntitlementConfig(withTierValue('basic', 'ai.actions', { perMonth: 999 }))).not.toThrow();
    expect(() => validateEntitlementConfig(withTierValue('basic', 'website.branding', 'unbranded'))).not.toThrow();
  });
});

describe('a cohort may not allocate one either', () => {
  it('rejects a non-zero allowance for a not_built capability', () => {
    // `{ all: true }` derives booleans and variants and skips not_built by
    // construction — but quantities and allowances are written by hand, so a
    // champion could be handed SMS messages that nothing can send.
    const base = readCodeConfig();
    const config: EntitlementConfig = {
      ...base,
      cohorts: {
        ...base.cohorts,
        champion: {
          ...base.cohorts.champion,
          values: { ...base.cohorts.champion.values, 'sms.messages': { perMonth: 500 } },
        },
      },
    };

    expect(() => validateEntitlementConfig(config)).toThrow(/cohorts/);
    expect(() => validateEntitlementConfig(config)).toThrow(/sms\.messages/);
  });

  it('accepts the zero the shipped config uses', () => {
    expect(() => validateEntitlementConfig(readCodeConfig())).not.toThrow();
    expect(readCodeConfig().cohorts.champion.values['sms.messages']).toEqual({ perMonth: 0 });
    expect(readCodeConfig().cohorts.trial.values['sms.messages']).toEqual({ perMonth: 0 });
  });

  it('still refuses `not_built` in includeLifecycle', () => {
    const base = readCodeConfig();
    const config: EntitlementConfig = {
      ...base,
      cohorts: {
        ...base.cohorts,
        trial: { ...base.cohorts.trial, includeLifecycle: ['beta', 'not_built'] },
      },
    };

    expect(() => validateEntitlementConfig(config)).toThrow(/not_built/);
  });
});

describe('Eyal\'s draft matrix obeys the rule', () => {
  it('validates as shipped', () => {
    // It did NOT when the rule landed: the sheet sold posts, campaigns,
    // reminders, a custom domain and four add-ons that do not exist. That was a
    // fixture bug, and the same one the real matrix will make first time.
    expect(() => validateEntitlementConfig(fixtureConfig())).not.toThrow();
  });

  it('withholds every not_built capability in every tier', () => {
    const offenders: string[] = [];

    for (const [tier, row] of Object.entries(FIXTURE_TIER_MATRIX.tiers as Record<string, Record<string, unknown>>)) {
      for (const [capability, value] of Object.entries(row)) {
        const definition = CAPABILITIES[capability as keyof typeof CAPABILITIES];
        if (definition.lifecycle !== 'not_built') continue;
        if (isGrantingValue(value as CapabilityValue, definition)) offenders.push(`${tier}.${capability}`);
      }
    }

    expect(offenders).toEqual([]);
  });
});

describe('an OFFER to sell counts, on every shape that has one (QA B-1)', () => {
  /**
   * The same config with `team.seats` made `not_built`, every tier withholding
   * it, and one tier's value replaced.
   *
   * A synthetic catalog entry because no `not_built` capability has the quantity
   * shape today (QA B-2) — which is exactly why the gap was latent, and why
   * testing it against the real catalog would prove nothing.
   */
  function withSeats(value: unknown): EntitlementConfig {
    const base = fixtureConfig();

    const catalog = {
      ...base.catalog,
      'team.seats': { ...CAPABILITIES['team.seats'], lifecycle: 'not_built' },
    } as unknown as EntitlementConfig['catalog'];

    const matrix = JSON.parse(JSON.stringify(FIXTURE_TIER_MATRIX)) as {
      tiers: Record<string, Record<string, unknown>>;
    };
    for (const tier of Object.keys(matrix.tiers)) matrix.tiers[tier]['team.seats'] = { included: 0, purchasable: false };
    matrix.tiers.pro['team.seats'] = value;

    const withheldSeats = { included: 0, purchasable: false };
    const cohorts = {
      trial: { ...base.cohorts.trial, values: { ...base.cohorts.trial.values, 'team.seats': withheldSeats } },
      champion: { ...base.cohorts.champion, values: { ...base.cohorts.champion.values, 'team.seats': withheldSeats } },
    } as unknown as EntitlementConfig['cohorts'];

    return fixtureConfig({ catalog, cohorts, matrix: matrix as unknown as EntitlementConfig['matrix'] });
  }

  it('rejects `purchasable: true` even when nothing is included', () => {
    // `{ included: 0, purchasable: true }` ranks 0 — the customer is given no
    // seats — but the plan still offers to SELL them seats that do not exist.
    expect(() => validateEntitlementConfig(withSeats({ included: 0, purchasable: true }))).toThrow(/team\.seats/);
    expect(() => validateEntitlementConfig(withSeats({ included: 0, purchasable: true }))).toThrow(/not_built|cannot be allocated/);
  });

  it('rejects a non-zero included count, purchasable or not', () => {
    expect(() => validateEntitlementConfig(withSeats({ included: 2, purchasable: false }))).toThrow(/team\.seats/);
  });

  it('accepts the withheld value — so the rule is not simply refusing everything', () => {
    expect(() => validateEntitlementConfig(withSeats({ included: 0, purchasable: false }))).not.toThrow();
    expect(() => validateEntitlementConfig(withSeats({ included: 0 }))).not.toThrow();
  });

  it('leaves a quantity capability that DOES exist alone', () => {
    // The control on the synthetic catalog itself: with the real lifecycle,
    // every one of those values is fine.
    expect(() => validateEntitlementConfig(withTierValue('pro', 'team.seats', { included: 0, purchasable: true }))).not.toThrow();
  });
});

describe('isGrantingValue — what counts as handing something out', () => {
  it('treats the bottom of each scale as withheld', () => {
    expect(isGrantingValue(false, CAPABILITIES['marketing.posts'])).toBe(false);
    expect(isGrantingValue('unavailable', CAPABILITIES['addon.mobile'])).toBe(false);
    expect(isGrantingValue({ perMonth: 0 }, CAPABILITIES['sms.messages'])).toBe(false);
    expect(isGrantingValue({ included: 0 }, CAPABILITIES['team.seats'])).toBe(false);
    expect(isGrantingValue({ included: 0, purchasable: false }, CAPABILITIES['team.seats'])).toBe(false);
    expect(isGrantingValue('branded', CAPABILITIES['website.branding'])).toBe(false);
  });

  it('treats anything above it as granted, including an offer to sell', () => {
    expect(isGrantingValue(true, CAPABILITIES['marketing.posts'])).toBe(true);
    expect(isGrantingValue('purchasable', CAPABILITIES['addon.mobile'])).toBe(true);
    expect(isGrantingValue('included', CAPABILITIES['addon.mobile'])).toBe(true);
    expect(isGrantingValue({ perMonth: 1 }, CAPABILITIES['sms.messages'])).toBe(true);
    expect(isGrantingValue({ included: 2 }, CAPABILITIES['team.seats'])).toBe(true);
    // QA B-1: nothing included, but seats are on sale. Same failure as the
    // add-on shape's `purchasable`, on the only other shape that has one.
    expect(isGrantingValue({ included: 0, purchasable: true }, CAPABILITIES['team.seats'])).toBe(true);
    expect(isGrantingValue('unbranded', CAPABILITIES['website.branding'])).toBe(true);
  });

  it('treats an unrankable value as granted, not as withheld', () => {
    // If we cannot tell what a value means, we do not hand it out. A variant
    // that is not in the list ranks `null`.
    expect(isGrantingValue('telepathic' as CapabilityValue, CAPABILITIES['intake.forms'])).toBe(true);
  });
});
