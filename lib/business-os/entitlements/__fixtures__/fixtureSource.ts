// lib/business-os/entitlements/__fixtures__/fixtureSource.ts
//
// A `TierMatrixSource` over the draft matrix, so the tier semantics can be
// tested against a config that HAS tiers while production ships none.
//
// It goes through the same `validateEntitlementConfig` as the shipped source —
// otherwise the fixture would prove the tests pass, not that the rules hold.

import { readCodeConfig, validateEntitlementConfig } from '../source';
import type { EntitlementConfig, TierMatrixSource } from '../source';
import { FIXTURE_TIER_MATRIX, FIXTURE_TIER_ORDER } from './exampleTierMatrix';

/**
 * The production config with the fixture matrix swapped in.
 *
 * Everything else — catalog, cohorts, lifecycle, chat map — is the real thing:
 * a fixture that replaced all of it would be testing itself.
 */
export function fixtureConfig(overrides: Partial<EntitlementConfig> = {}): EntitlementConfig {
  const base = readCodeConfig();
  return {
    ...base,
    tierOrder: FIXTURE_TIER_ORDER,
    // The cast is the seam's price: `EntitlementConfig.matrix` is typed to the
    // production (empty) tier set, and the fixture has three. The shapes are
    // identical; only the tier names differ, which is exactly what the fixture
    // exists to vary.
    matrix: FIXTURE_TIER_MATRIX as unknown as EntitlementConfig['matrix'],
    ...overrides,
  };
}

/** A source that serves the fixture, validating it like any other config. */
export class FixtureTierMatrixSource implements TierMatrixSource {
  constructor(private readonly overrides: Partial<EntitlementConfig> = {}) {}

  load(): EntitlementConfig {
    const config = fixtureConfig(this.overrides);
    validateEntitlementConfig(config);
    return config;
  }
}
