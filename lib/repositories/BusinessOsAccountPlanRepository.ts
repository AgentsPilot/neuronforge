// lib/repositories/BusinessOsAccountPlanRepository.ts
//
// Data access for the Business OS entitlement tables:
//   business_os_account_plans          — one row per account (owner user_id)
//   business_os_entitlement_overrides  — admin grants/revocations, ended not deleted
//
// Schema: supabase/migrations/20261005_business_os_entitlements.sql
// Workplan: docs/workplans/business-os-subscription-entitlements.md §4.3, §4.9
//
// ── WHY THE SERVICE ROLE (intentional RLS bypass, documented per CLAUDE.md) ──
// These tables have RLS on and NO policies, and SELECT/INSERT/UPDATE/DELETE are
// revoked from `anon` and `authenticated`. That is deliberate: an account's own
// session must not be able to read the admin `reason` text or the actor ids, and
// must never be able to write its own entitlements. Every caller of this
// repository is a server-side admin route, cron or report that already knows
// which account it is acting on, so the account id ALWAYS comes from server
// context — a session, a claimed row or an admin route's validated path
// parameter — and never from a request body.
//
// Every **per-account** read and write is scoped with `.eq('user_id', accountId)`,
// per CLAUDE.md rule 4 — the PK is `user_id`, so that filter is also the row key.
// The two exceptions are deliberate and are account-wide by definition:
// `findEntitlementInputsBatch` (a cron's claimed batch, scoped by an explicit
// `IN` list built server-side) and `pagePlans` (the admin report walking every
// account). Neither takes an id from request input.
//
// ── WHAT THIS REPOSITORY DOES NOT DO ────────────────────────────────────────
// It contains no entitlement logic. Resolution is a pure function over the rows
// returned here (component 3), which is what makes it cacheable and testable
// with an injected clock. Nothing here reads config or decides anything.

import { SupabaseClient } from '@supabase/supabase-js';
import { supabaseServer as defaultSupabase } from '@/lib/supabaseServer';
import { createLogger, Logger } from '@/lib/logger';
import type { AgentRepositoryResult as RepositoryResult } from './types';

/** A row of `business_os_account_plans`. */
export interface BusinessOsAccountPlan {
  user_id: string;
  tier: string | null;
  plan_version: number;
  /** NULL = no end date (forever). */
  tier_expires_at: string | null;
  cohort: string | null;
  /** NULL = open-ended (a champion with no end date). */
  cohort_expires_at: string | null;
  /** Facts: written once by the provisioning triggers, never overwritten. */
  onboarding_started_at: string | null;
  profile_created_at: string | null;
  /** Pins: admin overrides of the derived dates. */
  trial_started_at: string | null;
  trial_ends_at: string | null;
  grace_ends_at: string | null;
  period_anchor: string;
  origin: string;
  updated_by_admin_id: string | null;
  created_at: string;
  updated_at: string;
}

/** A row of `business_os_entitlement_overrides`. */
export interface BusinessOsEntitlementOverride {
  id: string;
  user_id: string;
  capability: string;
  op: 'set' | 'add' | 'revoke';
  value: unknown;
  reason: string;
  expires_at: string | null;
  actor_admin_id: string;
  created_at: string;
  ended_at: string | null;
  ended_by_admin_id: string | null;
  ended_reason: string | null;
}

/**
 * Everything the resolver needs for one account, in one round trip.
 *
 * `plan` is null when the account has no row at all — an anomaly the caller
 * reports rather than papers over, because "no row" must never be read as
 * "full access".
 */
export interface BusinessOsEntitlementInputs {
  plan: BusinessOsAccountPlan | null;
  /** Every override, including expired and ended ones: the resolver explains why each was ignored. */
  overrides: BusinessOsEntitlementOverride[];
}

/**
 * The fields an admin operation may change on a plan row.
 *
 * An explicit allow-list, not a partial of the row type, because that is what
 * stops a caller-supplied object from reaching the table (tenant-isolation-guard
 * §3). `user_id`, `created_at` and the recorded facts are absent on purpose:
 * tenancy and history are not editable.
 */
export interface BusinessOsAccountPlanPatch {
  tier?: string | null;
  plan_version?: number;
  tier_expires_at?: string | null;
  cohort?: string | null;
  cohort_expires_at?: string | null;
  trial_started_at?: string | null;
  trial_ends_at?: string | null;
  grace_ends_at?: string | null;
  period_anchor?: string;
  origin?: string;
}

/** Input for creating an account's plan row when a provisioning trigger did not. */
export interface EnsureBusinessOsAccountPlanInput {
  userId: string;
  /** Required: an admin says what the account starts as. There is no default. */
  cohort: string;
  /** Champion only. `null` means open-ended, and the caller must have said so. */
  cohortExpiresAt?: string | null;
  /** Facts recovered from the tenant's own history, when they are known. */
  onboardingStartedAt?: string | null;
  profileCreatedAt?: string | null;
  adminId: string;
}

export interface CreateBusinessOsOverrideInput {
  userId: string;
  capability: string;
  op: 'set' | 'add' | 'revoke';
  value?: unknown;
  reason: string;
  expiresAt?: string | null;
  adminId: string;
}

export interface ResetBusinessOsPlanStateInput {
  userId: string;
  /** Required. The RPC refuses NULL and blank. */
  cohort: string;
  cohortExpiresAt?: string | null;
  trialStartedAt?: string | null;
  adminId: string;
  reason: string;
}

const PLAN_COLUMNS =
  'user_id, tier, plan_version, tier_expires_at, cohort, cohort_expires_at, ' +
  'onboarding_started_at, profile_created_at, trial_started_at, trial_ends_at, grace_ends_at, ' +
  'period_anchor, origin, updated_by_admin_id, created_at, updated_at';

const OVERRIDE_COLUMNS =
  'id, user_id, capability, op, value, reason, expires_at, actor_admin_id, created_at, ' +
  'ended_at, ended_by_admin_id, ended_reason';

/**
 * PostgREST puts the filter in the URL, so a batch is bounded by URL length
 * rather than by the database. 100 ids is well inside every proxy's limit and
 * is the chunk size the service uses (workplan RC-12).
 */
export const BOS_ENTITLEMENT_BATCH_LIMIT = 100;

/** Rows a plan-row write may never set from a caller-supplied object. */
const PATCH_FIELDS: ReadonlyArray<keyof BusinessOsAccountPlanPatch> = [
  'tier',
  'plan_version',
  'tier_expires_at',
  'cohort',
  'cohort_expires_at',
  'trial_started_at',
  'trial_ends_at',
  'grace_ends_at',
  'period_anchor',
  'origin',
];

export class BusinessOsAccountPlanRepository {
  private supabase: SupabaseClient;
  private logger: Logger;

  constructor(supabaseClient?: SupabaseClient) {
    // Service role by design — see the header. Injectable so tests can assert
    // the query shape without a database.
    this.supabase = supabaseClient || defaultSupabase;
    this.logger = createLogger({ service: 'BusinessOsAccountPlanRepository' });
  }

  // ── Reads ─────────────────────────────────────────────────────────────────

  /**
   * The plan row and its overrides for one account, in ONE round trip.
   *
   * The embed is why `business_os_entitlement_overrides.user_id` has a foreign
   * key to the plan row rather than straight to `auth.users`: PostgREST can only
   * embed across a relationship it can see.
   */
  async findEntitlementInputs(accountId: string): Promise<RepositoryResult<BusinessOsEntitlementInputs>> {
    try {
      const { data, error } = await this.supabase
        .from('business_os_account_plans')
        .select(`${PLAN_COLUMNS}, business_os_entitlement_overrides(${OVERRIDE_COLUMNS})`)
        .eq('user_id', accountId)
        .maybeSingle();

      if (error) throw error;
      return { data: toInputs(data), error: null };
    } catch (error) {
      this.logger.error({ err: error, accountId }, 'Failed to read entitlement inputs');
      return { data: null, error: error as Error };
    }
  }

  /**
   * The same, for a batch of accounts — one query for a cron's claimed batch or
   * a page of the report.
   *
   * An oversized batch is REFUSED — returned as an error, and no query is sent
   * — rather than truncated: a silently short result would read as "these
   * accounts have no plan row", which is the one answer that must never be
   * wrong. (Like every method here, it returns `{ data, error }` and never
   * throws at the caller.)
   */
  async findEntitlementInputsBatch(
    accountIds: string[]
  ): Promise<RepositoryResult<Record<string, BusinessOsEntitlementInputs>>> {
    if (accountIds.length > BOS_ENTITLEMENT_BATCH_LIMIT) {
      const error = new Error(
        `findEntitlementInputsBatch accepts at most ${BOS_ENTITLEMENT_BATCH_LIMIT} ids, received ${accountIds.length}`
      );
      this.logger.error({ err: error, count: accountIds.length }, 'Batch too large');
      return { data: null, error };
    }

    if (accountIds.length === 0) return { data: {}, error: null };

    try {
      const { data, error } = await this.supabase
        .from('business_os_account_plans')
        .select(`${PLAN_COLUMNS}, business_os_entitlement_overrides(${OVERRIDE_COLUMNS})`)
        .in('user_id', accountIds);

      if (error) throw error;

      const byAccount: Record<string, BusinessOsEntitlementInputs> = {};
      for (const row of (data ?? []) as Array<Record<string, unknown>>) {
        const inputs = toInputs(row);
        if (inputs.plan) byAccount[inputs.plan.user_id] = inputs;
      }
      return { data: byAccount, error: null };
    } catch (error) {
      this.logger.error({ err: error, count: accountIds.length }, 'Failed to read entitlement inputs batch');
      return { data: null, error: error as Error };
    }
  }

  /**
   * One page of plan rows, ordered by `user_id` and seeked by the last id.
   *
   * Keyset rather than offset: the report walks every account, and an offset
   * walk silently skips or repeats rows when a row is inserted mid-walk.
   */
  async pagePlans(options: {
    afterUserId?: string | null;
    limit?: number;
  } = {}): Promise<RepositoryResult<BusinessOsAccountPlan[]>> {
    const limit = Math.min(Math.max(options.limit ?? 500, 1), 1000);

    try {
      let query = this.supabase
        .from('business_os_account_plans')
        .select(PLAN_COLUMNS)
        .order('user_id', { ascending: true })
        .limit(limit);

      if (options.afterUserId) query = query.gt('user_id', options.afterUserId);

      const { data, error } = await query;
      if (error) throw error;
      return { data: (data ?? []) as unknown as BusinessOsAccountPlan[], error: null };
    } catch (error) {
      this.logger.error({ err: error }, 'Failed to page plan rows');
      return { data: null, error: error as Error };
    }
  }

  /**
   * The most recently onboarded accounts, newest first (QA B-1).
   *
   * For the report's setup-AI sample, which needs **recent** accounts because
   * they used the current product — an account that set up a year ago says
   * nothing about what setting up costs today.
   *
   * Ordered by `onboarding_started_at`, not by `created_at`: for every account
   * the backfill touched, `created_at` is the moment the backfill ran, so
   * ordering by it would sort tens of thousands of accounts by an identical
   * timestamp. `onboarding_started_at` is the account's own start.
   *
   * Rows without that fact are excluded rather than sorted last: a sample of
   * accounts that never started onboarding would measure nothing.
   */
  async findRecentOnboardedPlans(
    options: { limit?: number } = {}
  ): Promise<RepositoryResult<BusinessOsAccountPlan[]>> {
    const limit = Math.min(Math.max(options.limit ?? 200, 1), 1000);

    try {
      const { data, error } = await this.supabase
        .from('business_os_account_plans')
        .select(PLAN_COLUMNS)
        .not('onboarding_started_at', 'is', null)
        .order('onboarding_started_at', { ascending: false })
        .limit(limit);

      if (error) throw error;
      return { data: (data ?? []) as unknown as BusinessOsAccountPlan[], error: null };
    } catch (error) {
      this.logger.error({ err: error }, 'Failed to read recently onboarded plan rows');
      return { data: null, error: error as Error };
    }
  }

  /**
   * Business OS tenants that have **no** plan row (workplan §4.10, report §1).
   *
   * Every tenant should have one: two triggers create it on the first
   * onboarding message or the first business profile, and the backfill covered
   * everyone who existed at rollout. A non-empty answer here therefore means a
   * trigger failed — which the fact triggers do SILENTLY by design (S-8(i): they
   * swallow their own error so a customer's write is never lost), so this read
   * is one of the two places that failure becomes visible at all.
   *
   * ── WHAT IT SCANS, AND WHAT IT DOES NOT ───────────────────────────────────
   * Tenants that have a **business profile**. It does not scan
   * `onboarding_conversations`, which holds one row per message and has no
   * DISTINCT through PostgREST — an anti-join across both tables needs SQL, and
   * SQL here would mean an RPC this slice does not otherwise need. The gap is
   * covered from two directions instead: `scripts/check-…` row B1 does the full
   * anti-join at apply time, and the report's own "no end date" list shows
   * onboarding-only accounts from the other side (S1-T11a).
   *
   * Bounded twice: `maxAccounts` rows of profiles, checked 100 ids at a time
   * (RC-12), so a report on a large database is a predictable number of small
   * queries rather than one enormous one.
   *
   * ⚠️ **This must become exhaustive before enforcement is switched on** (SA,
   * component 4 review — recorded as a blocking item in workplan §5). The gap is
   * harmless while nothing is enforced: a missing plan row costs nobody
   * anything. Under enforcement it resolves to the `no_plan_row` anomaly, which
   * DENIES owner-paid capabilities — so a bookkeeping failure we could not see
   * becomes a real customer refused something they are entitled to. The fix is
   * an RPC doing the anti-join in SQL, the same one `scripts/check-…` row B1
   * already performs at apply time.
   */
  async findTenantsMissingPlanRow(
    options: { maxAccounts?: number } = {}
  ): Promise<RepositoryResult<{ checked: number; missing: string[]; truncated: boolean }>> {
    const maxAccounts = Math.min(Math.max(options.maxAccounts ?? 2000, 1), 20000);

    try {
      const { data, error } = await this.supabase
        .from('business_profiles')
        .select('user_id')
        .order('user_id', { ascending: true })
        .limit(maxAccounts + 1);

      if (error) throw error;

      const ids = [...new Set(((data ?? []) as Array<{ user_id: string }>).map((row) => row.user_id))];
      const truncated = ids.length > maxAccounts;
      const scanned = truncated ? ids.slice(0, maxAccounts) : ids;

      const missing: string[] = [];

      for (let i = 0; i < scanned.length; i += BOS_ENTITLEMENT_BATCH_LIMIT) {
        const chunk = scanned.slice(i, i + BOS_ENTITLEMENT_BATCH_LIMIT);
        const { data: plans, error: planError } = await this.supabase
          .from('business_os_account_plans')
          .select('user_id')
          .in('user_id', chunk);

        if (planError) throw planError;

        const present = new Set(((plans ?? []) as Array<{ user_id: string }>).map((row) => row.user_id));
        for (const id of chunk) if (!present.has(id)) missing.push(id);
      }

      return { data: { checked: scanned.length, missing, truncated }, error: null };
    } catch (error) {
      this.logger.error({ err: error }, 'Failed to look for tenants without a plan row');
      return { data: null, error: error as Error };
    }
  }

  /** One override by id, scoped to its account so a foreign id cannot be ended. */
  async findOverrideById(
    overrideId: string,
    accountId: string
  ): Promise<RepositoryResult<BusinessOsEntitlementOverride>> {
    try {
      const { data, error } = await this.supabase
        .from('business_os_entitlement_overrides')
        .select(OVERRIDE_COLUMNS)
        .eq('id', overrideId)
        .eq('user_id', accountId)
        .maybeSingle();

      if (error) throw error;
      return { data: (data as unknown as BusinessOsEntitlementOverride) ?? null, error: null };
    } catch (error) {
      this.logger.error({ err: error, overrideId, accountId }, 'Failed to read override');
      return { data: null, error: error as Error };
    }
  }

  // ── Writes (admin paths only; see the import guard in the workplan §3) ─────

  /**
   * Create the plan row for an account that has none.
   *
   * `cohort` is required by the input type because a tenant with no row after
   * the backfill is a trigger failure, and under the rollout decision an
   * existing tenant should usually be a champion — so this must never guess.
   *
   * Idempotent, and safe against a race (SA F-4). The pre-read is only a fast
   * path; the write itself is an upsert that IGNORES a duplicate, so a
   * provisioning trigger — or a second admin — firing between the read and the
   * write cannot turn into a unique-violation 500. When the insert is skipped
   * because the row appeared in between, the existing row is read back and
   * reported as `created: false`, which is the truth: this call did not create
   * it.
   */
  async ensurePlanRow(
    input: EnsureBusinessOsAccountPlanInput
  ): Promise<RepositoryResult<{ created: boolean; plan: BusinessOsAccountPlan | null }>> {
    const methodLogger = this.logger.child({ method: 'ensurePlanRow', accountId: input.userId });

    // QA Q-13: the table deliberately has no value CHECK on `cohort` (FR-12 keeps
    // tier and cohort names in config), so `''` would satisfy `cohort IS NOT NULL`
    // and produce a row the resolver cannot interpret. The reset RPC refuses a
    // blank cohort in SQL; this is the same refusal on the other write path, so
    // the invariant does not depend on one caller remembering. Component 5's Zod
    // enum is still the primary validation.
    const cohort = input.cohort?.trim() ?? '';
    if (!cohort) {
      const error = new Error('ensurePlanRow requires an explicit, non-blank cohort');
      methodLogger.error({ err: error }, 'Refused a blank cohort');
      return { data: null, error };
    }

    try {
      const existing = await this.supabase
        .from('business_os_account_plans')
        .select(PLAN_COLUMNS)
        .eq('user_id', input.userId)
        .maybeSingle();

      if (existing.error) throw existing.error;
      if (existing.data) {
        return {
          data: { created: false, plan: existing.data as unknown as BusinessOsAccountPlan },
          error: null,
        };
      }

      const now = new Date().toISOString();
      const { data, error } = await this.supabase
        .from('business_os_account_plans')
        // `ignoreDuplicates` makes this an ON CONFLICT DO NOTHING, so a row that
        // appeared since the read above is left exactly as it is — this must
        // never overwrite a cohort someone else just set.
        .upsert(
          {
            user_id: input.userId,
            cohort,
            cohort_expires_at: input.cohortExpiresAt ?? null,
            onboarding_started_at: input.onboardingStartedAt ?? null,
            profile_created_at: input.profileCreatedAt ?? null,
            origin: 'admin',
            period_anchor: now,
            updated_by_admin_id: input.adminId,
            updated_at: now,
          },
          { onConflict: 'user_id', ignoreDuplicates: true }
        )
        .select(PLAN_COLUMNS)
        .maybeSingle();

      if (error) throw error;

      if (!data) {
        // The insert was skipped: someone created the row in between. Report
        // the row that exists, not the one this call would have written.
        const raced = await this.supabase
          .from('business_os_account_plans')
          .select(PLAN_COLUMNS)
          .eq('user_id', input.userId)
          .maybeSingle();

        if (raced.error) throw raced.error;

        methodLogger.info({ adminId: input.adminId }, 'Plan row already existed by the time the insert ran');
        return {
          data: { created: false, plan: (raced.data as unknown as BusinessOsAccountPlan) ?? null },
          error: null,
        };
      }

      methodLogger.info({ cohort, adminId: input.adminId }, 'Plan row created for an account that had none');
      return { data: { created: true, plan: data as unknown as BusinessOsAccountPlan }, error: null };
    } catch (error) {
      methodLogger.error({ err: error }, 'Failed to ensure a plan row');
      return { data: null, error: error as Error };
    }
  }

  /**
   * Apply an admin patch to a plan row.
   *
   * The payload is built field by field from the allow-list — never spread from
   * a request body — and `updated_at`/`updated_by_admin_id` are always written,
   * because nothing in the database maintains them (there is deliberately no
   * BEFORE UPDATE trigger: one more trigger on this table is one more thing
   * that can fail inside someone else's transaction).
   *
   * **Clearing an assignment also clears its end date (QA Q-6).** The table
   * pairs them (`tier IS NOT NULL OR tier_expires_at IS NULL`), so clearing one
   * half alone would violate the constraint and surface to an admin as an opaque
   * 500. Normalising here means the route cannot get the pairing wrong, and the
   * constraint stays as the backstop it was meant to be.
   *
   * **Returns `{ data: null, error: null }` when no row matched (QA Q-15).** The
   * caller cannot tell that from a successful update of nothing, so it is logged
   * at `warn` here, and the admin route pre-checks the row's existence and
   * answers 409 `plan_row_missing` before ever calling this (workplan §4.12).
   */
  async updatePlan(
    accountId: string,
    patch: BusinessOsAccountPlanPatch,
    adminId: string
  ): Promise<RepositoryResult<BusinessOsAccountPlan>> {
    const methodLogger = this.logger.child({ method: 'updatePlan', accountId });

    try {
      const payload: Record<string, unknown> = {
        updated_at: new Date().toISOString(),
        updated_by_admin_id: adminId,
      };
      for (const field of PATCH_FIELDS) {
        if (Object.prototype.hasOwnProperty.call(patch, field)) payload[field] = patch[field];
      }

      // Q-6: clearing an assignment clears its end date with it, unless the
      // caller already said so explicitly.
      if (payload.tier === null && !Object.prototype.hasOwnProperty.call(patch, 'tier_expires_at')) {
        payload.tier_expires_at = null;
      }
      if (payload.cohort === null && !Object.prototype.hasOwnProperty.call(patch, 'cohort_expires_at')) {
        payload.cohort_expires_at = null;
      }

      const { data, error } = await this.supabase
        .from('business_os_account_plans')
        .update(payload)
        .eq('user_id', accountId)
        .select(PLAN_COLUMNS)
        .maybeSingle();

      if (error) throw error;

      if (!data) {
        // Not an error — but "nothing to update" and "updated" are the same
        // shape to the caller, so say it here (Q-15).
        methodLogger.warn({ adminId }, 'Plan update matched no row; the account has no plan row');
        return { data: null, error: null };
      }

      methodLogger.info({ fields: Object.keys(payload), adminId }, 'Plan row updated');
      return { data: data as unknown as BusinessOsAccountPlan, error: null };
    } catch (error) {
      methodLogger.error({ err: error }, 'Failed to update the plan row');
      return { data: null, error: error as Error };
    }
  }

  /** Record an admin grant/revocation. Overrides are append-only. */
  async createOverride(
    input: CreateBusinessOsOverrideInput
  ): Promise<RepositoryResult<BusinessOsEntitlementOverride>> {
    const methodLogger = this.logger.child({ method: 'createOverride', accountId: input.userId });

    try {
      const { data, error } = await this.supabase
        .from('business_os_entitlement_overrides')
        .insert({
          user_id: input.userId,
          capability: input.capability,
          op: input.op,
          value: input.op === 'revoke' ? null : (input.value ?? null),
          reason: input.reason,
          expires_at: input.expiresAt ?? null,
          actor_admin_id: input.adminId,
        })
        .select(OVERRIDE_COLUMNS)
        .single();

      if (error) throw error;

      methodLogger.info({ capability: input.capability, op: input.op, adminId: input.adminId }, 'Override created');
      return { data: data as unknown as BusinessOsEntitlementOverride, error: null };
    } catch (error) {
      methodLogger.error({ err: error }, 'Failed to create an override');
      return { data: null, error: error as Error };
    }
  }

  /**
   * End an override. It is never deleted: the row is the durable record of what
   * an admin granted and why, kept outside the audit queue on purpose.
   *
   * Scoped by both id and account, and by `ended_at IS NULL` so ending twice
   * cannot overwrite who ended it first.
   */
  async endOverride(
    overrideId: string,
    accountId: string,
    adminId: string,
    reason: string
  ): Promise<RepositoryResult<BusinessOsEntitlementOverride>> {
    const methodLogger = this.logger.child({ method: 'endOverride', accountId, overrideId });

    try {
      const { data, error } = await this.supabase
        .from('business_os_entitlement_overrides')
        .update({
          ended_at: new Date().toISOString(),
          ended_by_admin_id: adminId,
          ended_reason: reason,
        })
        .eq('id', overrideId)
        .eq('user_id', accountId)
        .is('ended_at', null)
        .select(OVERRIDE_COLUMNS)
        .maybeSingle();

      if (error) throw error;

      methodLogger.info({ adminId }, 'Override ended');
      return { data: (data as unknown as BusinessOsEntitlementOverride) ?? null, error: null };
    } catch (error) {
      methodLogger.error({ err: error }, 'Failed to end an override');
      return { data: null, error: error as Error };
    }
  }

  /**
   * Start an account's plan state over, atomically, through the RPC.
   *
   * The work is in one database function on purpose (see the migration): it
   * ends the active overrides and rewrites the plan row IN PLACE, so the
   * account never passes through a state with no plan row and the record of
   * what an admin had granted survives as ended rows.
   *
   * This is an admin-only operation. The customer-facing Reset and Purge never
   * touch these tables — that is what stops a customer resetting into a fresh
   * trial — so this is the only sanctioned way to genuinely start over.
   */
  async resetPlanState(
    input: ResetBusinessOsPlanStateInput
  ): Promise<RepositoryResult<BusinessOsAccountPlan>> {
    const methodLogger = this.logger.child({ method: 'resetPlanState', accountId: input.userId });

    try {
      const { data, error } = await this.supabase.rpc('business_os_reset_plan_state', {
        p_user_id: input.userId,
        p_cohort: input.cohort,
        p_cohort_expires_at: input.cohortExpiresAt ?? null,
        p_trial_started_at: input.trialStartedAt ?? null,
        p_admin_id: input.adminId,
        p_reason: input.reason,
      });

      if (error) throw error;

      // A composite-returning function comes back as the row itself; some
      // PostgREST versions wrap it in a single-element array.
      const row = (Array.isArray(data) ? data[0] : data) as unknown as BusinessOsAccountPlan | null;

      methodLogger.info({ cohort: input.cohort, adminId: input.adminId }, 'Plan state reset');
      return { data: row ?? null, error: null };
    } catch (error) {
      methodLogger.error({ err: error }, 'Failed to reset the plan state');
      return { data: null, error: error as Error };
    }
  }
}

/** Split an embedded PostgREST row into the plan and its overrides. */
function toInputs(row: unknown): BusinessOsEntitlementInputs {
  if (!row || typeof row !== 'object') return { plan: null, overrides: [] };

  const { business_os_entitlement_overrides: embedded, ...plan } = row as Record<string, unknown>;
  return {
    plan: plan as unknown as BusinessOsAccountPlan,
    overrides: Array.isArray(embedded) ? (embedded as BusinessOsEntitlementOverride[]) : [],
  };
}

/** Singleton for convenience, matching the rest of the repository layer. */
export const businessOsAccountPlanRepository = new BusinessOsAccountPlanRepository();
