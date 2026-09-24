// lib/business-os/entitlements/account.ts
//
// The account seam, and the shape the resolver reasons about.
//
// Workplan §4.9 (T-2). Requirement FR-9.
//
// ── WHY A SEAM FOR SOMETHING THIS SMALL ─────────────────────────────────────
// An "account" in Business OS is a user id, today. Every table is keyed to
// `auth.users`, there are no teams, and `team.seats` is `{ included: 1 }` for
// everyone because invites do not exist (§18).
//
// That will change. When it does, ONE function changes rather than every call
// site: the alternative is `userId` threaded through the resolver, the cache
// key, the shadow events and the admin routes, and then a migration that has to
// find all of them. `resolveAccountId` exists so that migration is a diff of one
// file, not an audit of the module.
//
// ── WHY THE RESOLVER DOES NOT TAKE THE DATABASE ROW ─────────────────────────
// `BusinessOsAccountPlan` is a row: snake_case, nullable everywhere, and shaped
// by PostgREST. `EntitlementAccount` is the same facts in the vocabulary the
// rules are written in. `fromPlanRow` is the one place they meet, so a column
// rename cannot reach the resolver, and a test can build an account in four
// lines without inventing `period_anchor` or `updated_by_admin_id`.

import type { BusinessOsAccountPlan, BusinessOsEntitlementOverride } from '@/lib/repositories/BusinessOsAccountPlanRepository';

/** The id everything in this module is keyed by. */
export type AccountId = string;

/**
 * The account, as the rules see it.
 *
 * Every field is exactly what the plan row holds, renamed. Nothing is defaulted
 * here: a missing cohort stays missing, so the resolver can call it an anomaly
 * rather than guess.
 */
export interface EntitlementAccount {
  accountId: AccountId;
  tier: string | null;
  /** The matrix version the tier was sold at. 0 means "whatever is current" (S-4). */
  planVersion: number;
  /** NULL = no end date. A-1: that is a decision, and the report lists every one. */
  tierExpiresAt: string | null;
  cohort: string | null;
  /** NULL = open-ended. For a champion that is normal (UD-4), not an anomaly (RC-4). */
  cohortExpiresAt: string | null;
  /** Facts, written once by the provisioning triggers. */
  onboardingStartedAt: string | null;
  profileCreatedAt: string | null;
  /** Pins: an admin's explicit override of a derived date. */
  trialStartedAt: string | null;
  trialEndsAt: string | null;
  graceEndsAt: string | null;
}

/** An override, in the same vocabulary. */
export interface EntitlementOverride {
  id: string;
  capability: string;
  op: 'set' | 'add' | 'revoke';
  value: unknown;
  /** NULL = no expiry. */
  expiresAt: string | null;
  /** Set when an admin ended it. Ended overrides are never deleted (M-2). */
  endedAt: string | null;
  createdAt: string;
}

/**
 * The only mapping from a user to an account.
 *
 * Returns the id unchanged. It is a function rather than an identity constant so
 * that the day an account stops being a user, the compiler shows every caller.
 */
export function resolveAccountId(userId: string): AccountId {
  return userId;
}

/** A plan row as the resolver wants it. */
export function fromPlanRow(row: BusinessOsAccountPlan): EntitlementAccount {
  return {
    accountId: row.user_id,
    tier: row.tier,
    planVersion: row.plan_version,
    tierExpiresAt: row.tier_expires_at,
    cohort: row.cohort,
    cohortExpiresAt: row.cohort_expires_at,
    onboardingStartedAt: row.onboarding_started_at,
    profileCreatedAt: row.profile_created_at,
    trialStartedAt: row.trial_started_at,
    trialEndsAt: row.trial_ends_at,
    graceEndsAt: row.grace_ends_at,
  };
}

/** An override row as the resolver wants it. */
export function fromOverrideRow(row: BusinessOsEntitlementOverride): EntitlementOverride {
  return {
    id: row.id,
    capability: row.capability,
    op: row.op,
    value: row.value,
    expiresAt: row.expires_at,
    endedAt: row.ended_at,
    createdAt: row.created_at,
  };
}
