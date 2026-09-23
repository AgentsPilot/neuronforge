// lib/business-os/entitlements/config/launch.ts
//
// Launch preconditions — the handful of values that decide when enforcement may
// be switched on at all.

import type { LaunchConfigShape } from '../types';

export const LAUNCH = {
  /**
   * Refuse `BOS_ENTITLEMENTS_MODE=enforce` while no tier is configured (UD-2).
   *
   * Without this, switching enforcement on before a plan exists would take every
   * trial that has run out into grace and then pause — with nothing for the
   * customer to buy, because there is no plan to buy. The mode reader (component
   * 3) reads this, logs an error and falls back to shadow rather than enforcing.
   *
   * Setting it to `false` is a deliberate act: it says "I know there are no
   * tiers and I want enforcement anyway".
   */
  enforceRequiresConfiguredTier: true,
} as const satisfies LaunchConfigShape;
