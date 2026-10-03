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
// account). Neither takes an id from request input. `findPeriodAnchorsBatch`
// (credit deduction slice 8a) is a third of the first kind: an explicit `IN`
// list the admin Businesses list builds from its own rows.
//
// ── WHAT THIS REPOSITORY DOES NOT DO ────────────────────────────────────────
// It contains no entitlement logic. Resolution is a pure function over the rows
// returned here (component 3), which is what makes it cacheable and testable
// with an injected clock. Nothing here reads config or decides anything.

import { SupabaseClient } from '@supabase/supabase-js';
import { supabaseServer as defaultSupabase } from '@/lib/supabaseServer';
import { createLogger, Logger } from '@/lib/logger';
import { safeDbError } from './BusinessOsInviteRepository';
import type { AgentRepositoryResult as RepositoryResult, FriendFinaliseOutcome } from './types';

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

/** An account id is an auth user id (a UUID). */
const ACCOUNT_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The answer from `business_os_tenants_missing_plan_row`.
 *
 * `withProfile` and `onboardingOnly` split the same total: `onboardingOnly` is
 * the population the pre-S-0 scan could not see at all, reported on its own so
 * the difference between two reports is readable rather than inferred.
 *
 * `truncated` refers to the **sample**. `count` is exact either way.
 */
export interface BusinessOsMissingPlanRowScan {
  checked: number;
  count: number;
  missing: string[];
  withProfile: number;
  onboardingOnly: number;
  truncated: boolean;
  scope: string;
}

/**
 * The row as PostgREST delivers it.
 *
 * Counts are typed as `number | string` because a `bigint` arrives as a string;
 * that is the reason the coercion above exists rather than an accident.
 */
interface MissingPlanRowScanRow {
  tenants_checked: number | string | null;
  missing_count: number | string | null;
  missing_with_profile: number | string | null;
  missing_onboarding_only: number | string | null;
  missing_sample: string[] | null;
  truncated: boolean | null;
}

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
   * The account's `period_anchor` ONLY — for the owner credit card's billing
   * period (credit deduction slice 6a, SQ-20).
   *
   * Returns the string PostgREST returned, UNTOUCHED: `period_anchor` is a
   * microsecond `timestamptz`, and the period key the charge recorder writes is
   * derived from it, so a value re-serialised through a `Date` would name a
   * period no charge sits in. `null` means the account has no plan row; a read
   * error is returned as an error, never as "no row". Uncached, like the
   * recorder's own read.
   */
  async findPeriodAnchor(accountId: string): Promise<RepositoryResult<string | null>> {
    try {
      const { data, error } = await this.supabase
        .from('business_os_account_plans')
        .select('period_anchor')
        .eq('user_id', accountId)
        .maybeSingle();

      if (error) throw error;
      const anchor = (data as { period_anchor?: unknown } | null)?.period_anchor;
      if (data !== null && typeof anchor !== 'string') {
        throw new Error('The plan row has no readable period anchor');
      }
      return { data: data === null ? null : (anchor as string), error: null };
    } catch (error) {
      this.logger.error({ err: error, accountId }, 'Failed to read the plan period anchor');
      return { data: null, error: error as Error };
    }
  }

  /**
   * `period_anchor` for a batch of accounts — the admin Businesses list's
   * "Credits left" column (credit deduction slice 8a, SA SQ-42): one query per
   * 100 accounts instead of one per row.
   *
   * Scoped by an explicit `IN` list of account ids (the multi-account form of
   * CLAUDE.md rule 4); the caller builds it server-side from the admin list's
   * own profile rows, behind `requireAdmin` — never from request input.
   *
   * Anchors come back VERBATIM (microsecond strings, never through a `Date`,
   * as `findPeriodAnchor`). An account missing from the result has no plan
   * row. An empty, oversized (> 100) or malformed id list is REFUSED with no
   * query; a row with no readable anchor is an error. Never throws.
   */
  async findPeriodAnchorsBatch(accountIds: readonly string[]): Promise<RepositoryResult<Record<string, string>>> {
    try {
      if (!Array.isArray(accountIds) || accountIds.length === 0) {
        throw new Error('findPeriodAnchorsBatch needs at least one account id');
      }
      if (accountIds.length > BOS_ENTITLEMENT_BATCH_LIMIT) {
        throw new Error(
          `findPeriodAnchorsBatch accepts at most ${BOS_ENTITLEMENT_BATCH_LIMIT} ids, received ${accountIds.length}`
        );
      }
      if (!accountIds.every((id) => typeof id === 'string' && ACCOUNT_ID_PATTERN.test(id))) {
        throw new Error('findPeriodAnchorsBatch accepts account ids (UUIDs) only');
      }

      const { data, error } = await this.supabase
        .from('business_os_account_plans')
        .select('user_id, period_anchor')
        .in('user_id', [...accountIds]);

      if (error) throw error;

      const anchors: Record<string, string> = {};
      for (const row of (data ?? []) as Array<{ user_id?: unknown; period_anchor?: unknown }>) {
        if (typeof row.user_id !== 'string' || typeof row.period_anchor !== 'string') {
          throw new Error('A plan row has no readable period anchor');
        }
        anchors[row.user_id] = row.period_anchor;
      }
      return { data: anchors, error: null };
    } catch (error) {
      this.logger.error(
        { err: error, count: Array.isArray(accountIds) ? accountIds.length : 0 },
        'Failed to read plan period anchors'
      );
      return { data: null, error: error as Error };
    }
  }

  /**
   * `findEntitlementInputs`, for a batch of accounts — one query for a cron's claimed batch or
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
   * Every tenant with no plan record — **exhaustive since S-0**.
   *
   * ── Why this is one RPC and not a PostgREST walk ───────────────────────
   * The question is `tenants (business_profiles UNION onboarding_conversations)
   * ANTI JOIN business_os_account_plans`. PostgREST cannot express a union of
   * two tables, let alone an anti-join across it, so this used to read
   * `business_profiles` and then ask about plan rows 100 ids at a time — which
   * made a tenant who started onboarding and never created a business profile
   * **invisible**, and capped the answer at the fetch limit besides.
   *
   * Harmless while nothing is enforced. Under `enforce` an account with no plan
   * record resolves to no entitlements, so an uncounted tenant is **a real
   * customer refused something they are entitled to**. That is why it had to be
   * exhaustive before switch-on rather than after.
   *
   * The counting now happens in SQL, which is also what
   * `scripts/check-bos-entitlements-migration.sql` row B1 does — so the report
   * and the checker can no longer disagree about a number that gates a launch.
   *
   * ── The one guarantee to preserve ──────────────────────────────────
   * **A failure must never look like "nothing is missing".** The operator
   * applies migrations by hand, so a missing function is a live possibility, and
   * "nothing is missing" is the green light for switching enforcement on. Both
   * failure shapes — an error, and a result set with no row — return an error
   * here. Callers must not paper over that: see the `scanFailed` flag on the
   * report section.
   *
   * @param options.maxAccounts Bounds the returned **sample**, not the count.
   *   Clamped to 1..20000. Clamped here as well as in the function because the
   *   function is callable from the SQL editor by somebody who never read this.
   */
  async findTenantsMissingPlanRow(
    options: { maxAccounts?: number } = {}
  ): Promise<RepositoryResult<BusinessOsMissingPlanRowScan>> {
    const maxAccounts = Math.min(Math.max(options.maxAccounts ?? 2000, 1), 20000);

    try {
      const { data, error } = await this.supabase.rpc('business_os_tenants_missing_plan_row', {
        p_limit: maxAccounts,
      });

      if (error) throw error;

      // A table-returning function comes back as an array of rows; some
      // PostgREST versions hand back the single row itself. Both mean the same.
      const row = (Array.isArray(data) ? data[0] : data) as MissingPlanRowScanRow | undefined | null;

      if (!row) {
        // NOT an empty list. The function returns exactly one row, so no row
        // means it did not answer — the same trap as a missing function,
        // arriving by a different route.
        throw new Error('business_os_tenants_missing_plan_row returned no row');
      }

      // PostgREST sends `bigint` as a string. Counting is the entire purpose of
      // this method, so a string here makes `"37" + 1` into `"371"`.
      const scan: BusinessOsMissingPlanRowScan = {
        checked: Number(row.tenants_checked ?? 0),
        count: Number(row.missing_count ?? 0),
        missing: row.missing_sample ?? [],
        withProfile: Number(row.missing_with_profile ?? 0),
        onboardingOnly: Number(row.missing_onboarding_only ?? 0),
        truncated: Boolean(row.truncated),
        // The scope travels with the answer rather than being written at the
        // reader. The old value of this field said "accounts with a business
        // profile", which was accurate and was the defect.
        scope: 'every tenant: a business profile OR any onboarding message (exhaustive anti-join)',
      };

      if (scan.count > 0) {
        this.logger.warn(
          { missing: scan.count, withProfile: scan.withProfile, onboardingOnly: scan.onboardingOnly },
          'Tenants without a Business OS plan record'
        );
      }

      return { data: scan, error: null };
    } catch (error) {
      this.logger.error({ err: error }, 'Failed to look for tenants without a plan record');
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

  /**
   * Finish an invite redemption: the plan row, the lineage row and the
   * invite's redeemed stamp, in ONE transaction (invite-only signup Slice 1b;
   * T-4 as replaced by R-1, L-5, I-5, F-8).
   *
   * This is a plan-state WRITE, which is why it lives here and is listed in the
   * entitlements imports guard's `WRITE_METHODS`: every writer of plan state is
   * visible to that guard. It is reached only by the public complete-signup
   * route, after mailbox proof, the invite claim and the account creation.
   *
   * The SQL function `business_os_finalise_invite_redemption` (SECURITY
   * INVOKER, empty search_path, service_role EXECUTE only) reads the grant and
   * the access length FROM THE INVITE ROW and computes the champion end date in
   * SQL (F-5). `cohort` is an EXPECTED value (already validated with
   * `grantRules`), compared with the row. `accountId` is the server-generated
   * id the invite was claimed for (I-3); `email` is the row's own email.
   *
   * `data` is the invite id on success (also when this account had ALREADY
   * finished it: the function is re-run safe), `null` when the row no longer
   * matches. A database error is scrubbed to `{ code, message }` (M-1), and
   * nothing here logs the email.
   */
  async provisionFromInvite(input: {
    inviteId: string;
    accountId: string;
    email: string;
    cohort: string;
  }): Promise<RepositoryResult<string>> {
    const methodLogger = this.logger.child({ method: 'provisionFromInvite', inviteId: input.inviteId, accountId: input.accountId });
    try {
      const { data, error } = await this.supabase.rpc('business_os_finalise_invite_redemption', {
        p_invite_id: input.inviteId,
        p_account_id: input.accountId,
        p_email: input.email,
        p_cohort: input.cohort,
      });

      if (error) throw error;
      const inviteId = Array.isArray(data) ? data[0] : data;
      if (typeof inviteId === 'string') {
        methodLogger.info('Invite redemption finalised (plan row and lineage written)');
        return { data: inviteId, error: null };
      }
      return { data: null, error: null };
    } catch (error) {
      const safe = safeDbError(error);
      methodLogger.error({ dbError: safe }, 'Failed to finalise an invite redemption');
      const out = new Error(safe.message) as Error & { code?: string };
      if (safe.code) out.code = safe.code;
      return { data: null, error: out };
    }
  }

  /**
   * Finish a FRIEND's redemption (invite-only signup Slice 5b; T-19, T-13).
   * The invite's redeemed stamp, the friend's plan row and the lineage row, in
   * ONE transaction, through `business_os_finalise_friend_invite_redemption`.
   *
   * A plan-state WRITE, so it lives here and is listed in the entitlements
   * imports guard's `WRITE_METHODS`, beside `provisionFromInvite`. Reached only
   * by the public signup routes (code and Google), after mailbox proof, the
   * claim and the account creation.
   *
   * ── The documented exception to R2-3 (T-13 layer 1) ────────────────────────
   * The plan row is written with NO basis: `cohort` and `tier` NULL,
   * `origin = 'invite'`. R2-3 ("every row has a basis") governs admin
   * operations; this row is deliberately basis-less so the onboarding and
   * profile triggers, whose `ON CONFLICT` can then only fill a fact, can never
   * mint a trial for a friend who has not paid (BQ-13). Under enforcement it
   * resolves to `no_assignment` and fails closed, which is correct.
   *
   * `tierId` and `issuerCohort` come from config (`INVITE_ISSUANCE_POLICY.account`),
   * so the SQL holds no plan name (L-5). `accountId` is the server-generated id
   * the invite was claimed for (I-3); `email` is the row's own email. Outcomes:
   * `finalised` / `already_finalised` (re-run safe) with the invite id and the
   * level written; `issuer_not_eligible` (the champion lost the cohort mid-request);
   * `not_matched`. A database error is scrubbed to `{ code, message }` (M-1).
   */
  async provisionFromFriendInvite(input: {
    inviteId: string;
    accountId: string;
    email: string;
    tierId: string;
    issuerCohort: string;
  }): Promise<RepositoryResult<FriendFinaliseOutcome>> {
    const methodLogger = this.logger.child({ method: 'provisionFromFriendInvite', inviteId: input.inviteId, accountId: input.accountId });
    try {
      const { data, error } = await this.supabase.rpc('business_os_finalise_friend_invite_redemption', {
        p_invite_id: input.inviteId,
        p_account_id: input.accountId,
        p_email: input.email,
        p_tier: input.tierId,
        p_issuer_cohort: input.issuerCohort,
      });

      if (error) throw error;
      const row = (Array.isArray(data) ? data[0] : data) as
        | { result_outcome?: unknown; result_invite_id?: unknown; result_level?: unknown }
        | null
        | undefined;
      const outcome = row?.result_outcome;
      if (
        (outcome === 'finalised' || outcome === 'already_finalised') &&
        typeof row?.result_invite_id === 'string' &&
        typeof row?.result_level === 'number'
      ) {
        methodLogger.info({ outcome, level: row.result_level }, 'Friend invite redemption finalised (plan row and lineage written)');
        return { data: { outcome, inviteId: row.result_invite_id, level: row.result_level }, error: null };
      }
      if (outcome === 'issuer_not_eligible' || outcome === 'not_matched') {
        methodLogger.warn({ outcome }, 'Friend invite redemption not finalised');
        return { data: { outcome }, error: null };
      }
      methodLogger.error({ outcome: typeof outcome === 'string' ? outcome : null }, 'Friend finalise returned an unknown answer');
      return { data: null, error: new Error('friend finalise returned an unknown answer') };
    } catch (error) {
      const safe = safeDbError(error);
      methodLogger.error({ dbError: safe }, 'Failed to finalise a friend invite redemption');
      const out = new Error(safe.message) as Error & { code?: string };
      if (safe.code) out.code = safe.code;
      return { data: null, error: out };
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
