// lib/business-os/entitlements/__fixtures__/accounts.ts
//
// Account builders for the resolver tests.
//
// A plan row has sixteen columns and the rules care about six of them, so every
// test that built one by hand would bury its own point under `period_anchor` and
// `updated_by_admin_id`. These builders say only what the test is about.

import type { EntitlementAccount, EntitlementOverride } from '../account';

/** A blank account: no tier, no cohort. On its own that is an anomaly. */
export function account(overrides: Partial<EntitlementAccount> = {}): EntitlementAccount {
  return {
    accountId: 'acct-1',
    tier: null,
    planVersion: 0,
    tierExpiresAt: null,
    cohort: null,
    cohortExpiresAt: null,
    onboardingStartedAt: null,
    profileCreatedAt: null,
    trialStartedAt: null,
    trialEndsAt: null,
    graceEndsAt: null,
    ...overrides,
  };
}

/** A trial whose clock started when the account first opened onboarding. */
export function trialAccount(startedAt: string, overrides: Partial<EntitlementAccount> = {}): EntitlementAccount {
  return account({ cohort: 'trial', onboardingStartedAt: startedAt, ...overrides });
}

/** A champion with no end date — what the backfill produced for everyone (U-2). */
export function championAccount(overrides: Partial<EntitlementAccount> = {}): EntitlementAccount {
  return account({ cohort: 'champion', cohortExpiresAt: null, ...overrides });
}

/** An account on a paid tier. */
export function tierAccount(
  tier: string,
  overrides: Partial<EntitlementAccount> = {}
): EntitlementAccount {
  return account({ tier, planVersion: 1, tierExpiresAt: null, ...overrides });
}

export function override(overrides: Partial<EntitlementOverride> = {}): EntitlementOverride {
  return {
    id: 'ovr-1',
    capability: 'chat.search',
    op: 'set',
    value: true,
    expiresAt: null,
    endedAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}
