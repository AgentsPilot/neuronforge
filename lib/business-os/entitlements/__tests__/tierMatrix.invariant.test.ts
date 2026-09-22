/**
 * The tier-matrix invariants (requirement AC-2, FR-3, FR-7).
 *
 * Production ships no tiers, so these run against the draft matrix in
 * `__fixtures__` — the properties being tested are properties OF A MATRIX and
 * cannot be shown on an empty one.
 *
 * The important one is AC-2's negative: removing ANY single value must be
 * rejected. It is generated rather than sampled, so the guarantee is "no tier
 * can have a hole", not "the three holes we thought of are caught".
 */

import { FIXTURE_TIER_MATRIX, FIXTURE_TIER_ORDER } from '@/lib/business-os/entitlements/__fixtures__/exampleTierMatrix';
import { FixtureTierMatrixSource, fixtureConfig } from '@/lib/business-os/entitlements/__fixtures__/fixtureSource';
import { CAPABILITY_IDS } from '@/lib/business-os/entitlements/config/catalog';
import { validateEntitlementConfig } from '@/lib/business-os/entitlements/source';
import type { EntitlementConfig } from '@/lib/business-os/entitlements/source';

/** The fixture config with a mutated matrix. */
function withMatrix(mutate: (matrix: Record<string, unknown>) => void): EntitlementConfig {
  const matrix = JSON.parse(JSON.stringify(FIXTURE_TIER_MATRIX)) as Record<string, unknown>;
  mutate(matrix);
  return fixtureConfig({ matrix: matrix as EntitlementConfig['matrix'] });
}

describe('the fixture matrix is a valid matrix', () => {
  it('loads', () => {
    expect(() => new FixtureTierMatrixSource().load()).not.toThrow();
  });

  it('assigns every capability in every tier (AC-2)', () => {
    for (const tier of FIXTURE_TIER_ORDER) {
      const row = FIXTURE_TIER_MATRIX.tiers[tier] as Record<string, unknown>;
      const assigned = Object.keys(row).sort();
      expect(assigned).toEqual([...CAPABILITY_IDS].sort());
    }
  });
});

describe('AC-2 — a tier with a hole in it is unrepresentable', () => {
  // One case per (tier × capability): 3 × 37 = 111 generated checks. Sampling
  // would leave the guarantee to luck.
  const cases = FIXTURE_TIER_ORDER.flatMap((tier) => CAPABILITY_IDS.map((capability) => [tier, capability] as const));

  it.each(cases)('rejects %s missing %s', (tier, capability) => {
    const config = withMatrix((matrix) => {
      const tiers = matrix.tiers as Record<string, Record<string, unknown>>;
      delete tiers[tier][capability];
    });

    expect(() => validateEntitlementConfig(config)).toThrow(/tier matrix/);
  });
});

describe('FR-3 / FR-7 — the other ways a matrix can be wrong', () => {
  it('rejects a capability that is not in the catalog', () => {
    const config = withMatrix((matrix) => {
      (matrix.tiers as Record<string, Record<string, unknown>>).basic['chat.telepathy'] = true;
    });

    expect(() => validateEntitlementConfig(config)).toThrow(/tier matrix/);
  });

  it('rejects a value of the wrong shape', () => {
    // A number where a variant belongs is the shape of mistake a hand-edited
    // matrix actually makes.
    const config = withMatrix((matrix) => {
      (matrix.tiers as Record<string, Record<string, unknown>>).growth['intake.forms'] = 7;
    });

    expect(() => validateEntitlementConfig(config)).toThrow(/tier matrix/);
  });

  it('rejects a variant that is not one of the declared options', () => {
    const config = withMatrix((matrix) => {
      (matrix.tiers as Record<string, Record<string, unknown>>).growth['website.branding'] = 'whitelabelled';
    });

    expect(() => validateEntitlementConfig(config)).toThrow(/tier matrix/);
  });

  it('rejects a row for a tier that is not configured', () => {
    // Caught by the key enum before the cross-check gets a look in — either way
    // a matrix cannot price a tier that does not exist.
    const config = withMatrix((matrix) => {
      const tiers = matrix.tiers as Record<string, unknown>;
      tiers.enterprise = tiers.pro;
    });

    expect(() => validateEntitlementConfig(config)).toThrow(/tier matrix/);
    expect(() => validateEntitlementConfig(config)).toThrow(/enterprise/);
  });

  it('rejects a configured tier with no row', () => {
    const config = withMatrix((matrix) => {
      delete (matrix.tiers as Record<string, unknown>).pro;
    });

    expect(() => validateEntitlementConfig(config)).toThrow(/has no row/);
  });

  it('rejects a negative allowance', () => {
    const config = withMatrix((matrix) => {
      (matrix.tiers as Record<string, Record<string, unknown>>).basic['ai.actions'] = { perMonth: -5 };
    });

    expect(() => validateEntitlementConfig(config)).toThrow(/tier matrix/);
  });
});

describe('WC-19 — removals are validated as carefully as values', () => {
  it("rejects grandfatherUntil: 'renewal' before billing exists", () => {
    // Without a renewal event, 'renewal' silently means "forever" — which is the
    // opposite of what a sunset date is for.
    const config = withMatrix((matrix) => {
      matrix.version = 2;
      (matrix.removals as unknown[]).push({
        version: 2,
        tier: 'growth',
        capability: 'chat.reporting',
        previousValue: true,
        grandfatherUntil: 'renewal',
      });
    });

    expect(() => validateEntitlementConfig(config)).toThrow(/tier matrix/);
  });

  it("accepts 'renewal' once billing is live", () => {
    const config = withMatrix((matrix) => {
      matrix.version = 2;
      (matrix.removals as unknown[]).push({
        version: 2,
        tier: 'growth',
        capability: 'chat.reporting',
        previousValue: true,
        grandfatherUntil: 'renewal',
      });
    });

    // Slice 4 flips the flag; the same config then validates.
    expect(() => validateEntitlementConfig(config, true)).not.toThrow();
  });

  it('rejects a removal whose previousValue is not a legal value', () => {
    const config = withMatrix((matrix) => {
      matrix.version = 2;
      (matrix.removals as unknown[]).push({
        version: 2,
        tier: 'growth',
        capability: 'intake.forms',
        previousValue: 'telepathic',
        grandfatherUntil: '2027-03-01T00:00:00.000Z',
      });
    });

    expect(() => validateEntitlementConfig(config)).toThrow(/previousValue/);
  });

  it('rejects a removal from the future', () => {
    const config = withMatrix((matrix) => {
      (matrix.removals as unknown[]).push({
        version: 9,
        tier: 'growth',
        capability: 'chat.reporting',
        previousValue: true,
        grandfatherUntil: '2027-03-01T00:00:00.000Z',
      });
    });

    expect(() => validateEntitlementConfig(config)).toThrow(/ahead of the matrix version/);
  });
});
