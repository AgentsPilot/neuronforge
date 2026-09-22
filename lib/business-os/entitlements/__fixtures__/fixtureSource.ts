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

/**
 * A source that serves the fixture, validating it like any other config.
 *
 * Memoised per instance, exactly like `CodeTierMatrixSource` — and for a reason
 * worth recording: the service calls `load()` on EVERY `check()`, and a source
 * that re-validated each time would make one call ~5 ms of Zod instead of ~0.06
 * ms of resolution. The shipped source memoises, so a fixture that did not would
 * have made every service test measure the wrong thing (and the cache-eviction
 * test take half a minute).
 */
export class FixtureTierMatrixSource implements TierMatrixSource {
  private cached: EntitlementConfig | null = null;

  constructor(private readonly overrides: Partial<EntitlementConfig> = {}) {}

  load(): EntitlementConfig {
    if (this.cached) return this.cached;

    const config = fixtureConfig(this.overrides);
    validateEntitlementConfig(config);
    this.cached = config;
    return config;
  }

  /** Forget it, for a test that wants validation to run again. */
  reset(): void {
    this.cached = null;
  }
}
