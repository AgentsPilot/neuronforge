// lib/business-os/entitlements/adminOps.ts
//
// THE ADMIN OPERATIONS — validation, pre-checks and the write, in one place.
//
// Workplan §4.12 (T-7, FR-31/32, AC-6, RC-4, RC-10, R2-2, R2-3, C3-2, M-3/M-4,
// S1-T12a).
//
// ── WHY THIS IS NOT IN THE ROUTE ────────────────────────────────────────────
// The route owns exactly three things: the admin gate, the HTTP shape, and the
// audit entry. Everything else — what a valid body looks like, what must be
// true before a write, what the write is — is here, because all of it is
// testable without a request and none of it should be re-implemented by the
// second route that needs it.
//
// The route stays thin on purpose: `requireAdmin` must be the FIRST statement
// in every exported handler (the CI guard reads each handler's own body), and a
// handler with 200 lines of business logic under that line is a handler where
// the gate is easy to lose in a refactor.
//
// ── THE ORDER OF CHECKS IS THE DESIGN ───────────────────────────────────────
//   1. Is the body valid?                    400, from Zod
//   2. Is this even a Business OS tenant?    404 — RC-10
//   3. Does it have a plan row?              409 `plan_row_missing` — Q-15
//   4. Would this leave it with no basis?    409 `would_leave_no_basis` — R2-3
//   5. Write, then invalidate.
//
// Every refusal is an explicit status with a machine-readable code. **A database
// constraint must never be how an admin learns they made a mistake** (M-3): the
// CHECKs on the table are the backstop, not the message.

import { z } from 'zod';
import type {
  BusinessOsAccountPlan,
  BusinessOsAccountPlanPatch,
  BusinessOsAccountPlanRepository,
  BusinessOsEntitlementOverride,
} from '@/lib/repositories/BusinessOsAccountPlanRepository';
import type { BusinessProfileRepository } from '@/lib/repositories/BusinessProfileRepository';
import type { OnboardingConversationRepository } from '@/lib/repositories/OnboardingConversationRepository';
import { isGrantingValue, valueSchemaFor } from './schema';
import type { CatalogLike } from './schema';
import type { EntitlementConfig } from './source';
import type { CapabilityValue } from './types';

/** The cohorts an admin may choose. Kept as a literal union so Zod can enumerate it. */
const COHORT_VALUES = ['trial', 'champion'] as const;

const isoString = z
  .string()
  .refine((value) => !Number.isNaN(Date.parse(value)), { message: 'must be an ISO 8601 timestamp' });

const reason = z.string().trim().min(3, 'a reason of at least 3 characters is required');

/**
 * The body schemas.
 *
 * Built from config so `assign_tier` can enumerate the configured tiers (Q-13:
 * the route is where an UNKNOWN value must be refused — the repository's blank
 * check is only a backstop), and so `add_override` can validate a value against
 * its capability's own shape.
 *
 * Every variant is `.strict()`: an unknown key is a mistake worth a 400, not
 * something to drop silently.
 */
export function adminOpSchema(config: EntitlementConfig) {
  const catalog = config.catalog as CatalogLike;
  const capabilityIds = Object.keys(catalog) as [string, ...string[]];

  const tierEnum =
    config.tierOrder.length > 0
      ? z.enum(config.tierOrder as unknown as [string, ...string[]])
      : // No tiers configured: the op is refused with 400 `no_tiers_configured`
        // before the value matters (RC-1), but the schema must still parse.
        z.string();

  return z.discriminatedUnion('op', [
    z
      .object({
        op: z.literal('ensure_plan_row'),
        // R2-2: explicit and required. A tenant with no row after the backfill
        // is a trigger failure, and under U-2 an existing tenant is usually a
        // champion — so there is no default, and no silent trial.
        cohort: z.enum(COHORT_VALUES),
        expiresAt: isoString.nullable().optional(),
        reason,
      })
      .strict(),
    z
      .object({
        op: z.literal('set_cohort'),
        cohort: z.enum(COHORT_VALUES).nullable(),
        expiresAt: isoString.nullable().optional(),
        trialEndsAt: isoString.nullable().optional(),
        reason,
      })
      .strict(),
    z
      .object({
        op: z.literal('set_expiry'),
        field: z.enum(['trial_ends_at', 'cohort_expires_at', 'tier_expires_at', 'grace_ends_at']),
        value: isoString.nullable(),
        reason,
      })
      .strict(),
    z
      .object({
        op: z.literal('assign_tier'),
        tier: tierEnum.nullable(),
        // A-1: a REQUIRED key, not an optional one. An ISO date or an explicit
        // `null` meaning no end date — silence is never read as "forever".
        expiresAt: isoString.nullable(),
        reason,
      })
      .strict(),
    z
      .object({
        op: z.literal('add_override'),
        capability: z.enum(capabilityIds),
        overrideOp: z.enum(['set', 'add', 'revoke']),
        value: z.unknown().optional(),
        expiresAt: isoString.nullable().optional(),
        reason,
      })
      .strict(),
    z
      .object({
        op: z.literal('end_override'),
        overrideId: z.string().uuid(),
        reason,
      })
      .strict(),
    z
      .object({
        op: z.literal('reset_plan_state'),
        confirm: z.literal('reset_plan_state'),
        /** Echo of the path id, so a mistyped id cannot fire this. */
        accountId: z.string().uuid(),
        cohort: z.enum(COHORT_VALUES),
        expiresAt: isoString.nullable().optional(),
        trialClock: z.enum(['restart_now', 'from_facts']).optional(),
        confirmTierLoss: z.boolean().optional(),
        reason,
      })
      .strict(),
  ]);
}

export type AdminOp = z.infer<ReturnType<typeof adminOpSchema>>;

/** What the executor gives back to the route. */
export type AdminOpOutcome =
  | {
      ok: true;
      /** The audit action name. */
      action: string;
      before: BusinessOsAccountPlan | null;
      after: BusinessOsAccountPlan | null;
      /** Extra body fields for the response. */
      data: Record<string, unknown>;
    }
  | { ok: false; status: 400 | 404 | 409 | 500; error: string; details?: Record<string, unknown> };

export interface AdminOpContext {
  accountId: string;
  adminId: string;
  config: EntitlementConfig;
  now: Date;
  planRepository: Pick<
    BusinessOsAccountPlanRepository,
    | 'findEntitlementInputs'
    | 'ensurePlanRow'
    | 'updatePlan'
    | 'createOverride'
    | 'endOverride'
    | 'findOverrideById'
    | 'resetPlanState'
  >;
  profileRepository: Pick<BusinessProfileRepository, 'findByUserId'>;
  onboardingRepository: Pick<OnboardingConversationRepository, 'getFirstMessageAt' | 'getLatestMessageAt'>;
}

/** Is a tier assignment in force at `now`? (A-1) */
function tierInForce(plan: BusinessOsAccountPlan | null, now: Date): boolean {
  if (!plan?.tier) return false;
  return plan.tier_expires_at === null || now.getTime() < Date.parse(plan.tier_expires_at);
}

/**
 * R2-3: would the account be left with neither an in-force tier nor a cohort?
 *
 * Checked against the state the op WOULD produce, not the state it came from —
 * an account with no basis resolves to the `no_assignment` anomaly, and under
 * enforcement an anomaly denies owner-paid capabilities. No admin op may create
 * that state, so it is refused before the write rather than discovered after.
 */
function wouldLeaveNoBasis(plan: BusinessOsAccountPlan, patch: BusinessOsAccountPlanPatch, now: Date): boolean {
  const next: BusinessOsAccountPlan = { ...plan, ...(patch as Partial<BusinessOsAccountPlan>) };
  // `updatePlan` clears a paired expiry when its assignment is cleared (Q-6),
  // so the projection has to do the same or it would disagree with reality.
  if (patch.tier === null && patch.tier_expires_at === undefined) next.tier_expires_at = null;
  if (patch.cohort === null && patch.cohort_expires_at === undefined) next.cohort_expires_at = null;

  return !tierInForce(next, now) && !next.cohort;
}

/**
 * Execute one admin operation.
 *
 * Never throws for an expected refusal: every one is an `ok: false` with the
 * status and the machine-readable code the route returns verbatim.
 */
export async function executeAdminOp(op: AdminOp, ctx: AdminOpContext): Promise<AdminOpOutcome> {
  const { accountId, planRepository } = ctx;

  // ── 2. Is this a Business OS tenant at all? (RC-10) ───────────────────────
  const isTenant = await isBusinessOsTenant(ctx);
  if (isTenant === null) return { ok: false, status: 500, error: 'tenant_check_failed' };
  if (!isTenant) return { ok: false, status: 404, error: 'not_a_business_os_account' };

  const inputs = await planRepository.findEntitlementInputs(accountId);
  if (inputs.error || !inputs.data) return { ok: false, status: 500, error: 'plan_read_failed' };

  const plan = inputs.data.plan;

  // ── 3. Every op except ensure_plan_row needs a row to act on (Q-15) ───────
  if (!plan && op.op !== 'ensure_plan_row') {
    return { ok: false, status: 409, error: 'plan_row_missing' };
  }

  switch (op.op) {
    case 'ensure_plan_row':
      return ensureRow(op, ctx, plan);
    case 'set_cohort':
      return setCohort(op, ctx, plan as BusinessOsAccountPlan);
    case 'set_expiry':
      return setExpiry(op, ctx, plan as BusinessOsAccountPlan);
    case 'assign_tier':
      return assignTier(op, ctx, plan as BusinessOsAccountPlan);
    case 'add_override':
      return addOverride(op, ctx, plan as BusinessOsAccountPlan);
    case 'end_override':
      return endOverride(op, ctx, plan as BusinessOsAccountPlan, inputs.data.overrides);
    case 'reset_plan_state':
      return resetPlanState(op, ctx, plan as BusinessOsAccountPlan, inputs.data.overrides);
    default:
      // Unreachable through Zod; a `never` here means a variant was added
      // without a branch.
      return { ok: false, status: 400, error: 'unsupported_op' };
  }
}

/** RC-10: a profile OR any onboarding message makes someone a tenant. */
async function isBusinessOsTenant(ctx: AdminOpContext): Promise<boolean | null> {
  const profile = await ctx.profileRepository.findByUserId(ctx.accountId);
  if (profile.error) return null;
  if (profile.data) return true;

  const latest = await ctx.onboardingRepository.getLatestMessageAt(ctx.accountId);
  if (latest.error) return null;
  return latest.data !== null;
}

async function ensureRow(
  op: Extract<AdminOp, { op: 'ensure_plan_row' }>,
  ctx: AdminOpContext,
  plan: BusinessOsAccountPlan | null
): Promise<AdminOpOutcome> {
  if (plan) {
    // Idempotent: an existing row is a no-op, not an error. An admin who runs
    // this twice has done nothing wrong.
    return { ok: true, action: 'BOS_ENTITLEMENT_PLAN_ROW_ENSURED', before: plan, after: plan, data: { created: false } };
  }

  // RC-4: a champion must say whether the access ends. Silence is not "forever".
  if (op.cohort === 'champion' && op.expiresAt === undefined) {
    return { ok: false, status: 400, error: 'expires_at_required_for_champion' };
  }

  // The facts come from the tenant's own history, so a recreated row carries
  // the same trial clock it would have had.
  const [firstMessage, profile] = await Promise.all([
    ctx.onboardingRepository.getFirstMessageAt(ctx.accountId),
    ctx.profileRepository.findByUserId(ctx.accountId),
  ]);

  const created = await ctx.planRepository.ensurePlanRow({
    userId: ctx.accountId,
    cohort: op.cohort,
    cohortExpiresAt: op.expiresAt ?? null,
    onboardingStartedAt: firstMessage.data ?? null,
    profileCreatedAt: (profile.data as { created_at?: string } | null)?.created_at ?? null,
    adminId: ctx.adminId,
  });

  if (created.error || !created.data) return { ok: false, status: 500, error: 'plan_row_create_failed' };

  return {
    ok: true,
    action: 'BOS_ENTITLEMENT_PLAN_ROW_ENSURED',
    before: null,
    after: created.data.plan,
    data: { created: created.data.created },
  };
}

async function setCohort(
  op: Extract<AdminOp, { op: 'set_cohort' }>,
  ctx: AdminOpContext,
  plan: BusinessOsAccountPlan
): Promise<AdminOpOutcome> {
  if (op.cohort === 'champion' && op.expiresAt === undefined) {
    return { ok: false, status: 400, error: 'expires_at_required_for_champion' };
  }

  const patch: BusinessOsAccountPlanPatch = {
    cohort: op.cohort,
    period_anchor: ctx.now.toISOString(),
  };

  if (op.cohort === 'champion') patch.cohort_expires_at = op.expiresAt ?? null;
  if (op.cohort === 'trial') {
    patch.cohort_expires_at = null;
    patch.trial_started_at = ctx.now.toISOString();
    if (op.trialEndsAt !== undefined) patch.trial_ends_at = op.trialEndsAt;
  }

  if (wouldLeaveNoBasis(plan, patch, ctx.now)) {
    return { ok: false, status: 409, error: 'would_leave_no_basis' };
  }

  return writePatch(ctx, plan, patch, 'BOS_ENTITLEMENT_COHORT_SET');
}

async function setExpiry(
  op: Extract<AdminOp, { op: 'set_expiry' }>,
  ctx: AdminOpContext,
  plan: BusinessOsAccountPlan
): Promise<AdminOpOutcome> {
  // M-3 / Q-6: the database has CHECK constraints for these pairings. They are
  // the backstop; this is the message. An admin setting an end date on an
  // assignment that does not exist gets a 409 that says which, not a Postgres
  // constraint name.
  if (op.field === 'cohort_expires_at' && op.value !== null && !plan.cohort) {
    return { ok: false, status: 409, error: 'no_cohort_to_expire' };
  }
  if (op.field === 'tier_expires_at' && op.value !== null && !plan.tier) {
    return { ok: false, status: 409, error: 'no_tier_to_expire' };
  }

  const patch: BusinessOsAccountPlanPatch = { [op.field]: op.value } as BusinessOsAccountPlanPatch;

  if (wouldLeaveNoBasis(plan, patch, ctx.now)) {
    return { ok: false, status: 409, error: 'would_leave_no_basis' };
  }

  return writePatch(ctx, plan, patch, 'BOS_ENTITLEMENT_EXPIRY_SET');
}

async function assignTier(
  op: Extract<AdminOp, { op: 'assign_tier' }>,
  ctx: AdminOpContext,
  plan: BusinessOsAccountPlan
): Promise<AdminOpOutcome> {
  // RC-1: production ships no tiers, so this op cannot do anything yet — and
  // says so, rather than writing a tier name the resolver would call unknown.
  if (op.tier !== null && ctx.config.tierOrder.length === 0) {
    return { ok: false, status: 400, error: 'no_tiers_configured' };
  }

  const patch: BusinessOsAccountPlanPatch = {
    tier: op.tier,
    tier_expires_at: op.tier === null ? null : op.expiresAt,
    period_anchor: ctx.now.toISOString(),
  };

  if (op.tier !== null) patch.plan_version = ctx.config.matrix.version;

  if (wouldLeaveNoBasis(plan, patch, ctx.now)) {
    return { ok: false, status: 409, error: 'would_leave_no_basis' };
  }

  return writePatch(ctx, plan, patch, 'BOS_ENTITLEMENT_TIER_ASSIGNED');
}

async function addOverride(
  op: Extract<AdminOp, { op: 'add_override' }>,
  ctx: AdminOpContext,
  plan: BusinessOsAccountPlan
): Promise<AdminOpOutcome> {
  const definition = (ctx.config.catalog as CatalogLike)[op.capability];

  // ── C3-2 (SA, component 3 review) ────────────────────────────────────────
  // The config loader refuses a TIER that grants a `not_built` capability, and
  // the resolver clamps an override that tries. Without this check the admin
  // would read "granted" in the response while the customer still has nothing —
  // the worst of both, because nobody would look again.
  if (op.overrideOp !== 'revoke' && definition.lifecycle === 'not_built') {
    return {
      ok: false,
      status: 409,
      error: 'capability_not_built',
      details: { capability: op.capability },
    };
  }

  if (op.overrideOp === 'set') {
    if (op.value === undefined) return { ok: false, status: 400, error: 'value_required' };

    const parsed = valueSchemaFor(definition.shape).safeParse(op.value);
    if (!parsed.success) {
      return { ok: false, status: 400, error: 'value_shape_invalid', details: { capability: op.capability } };
    }

    // The same rule, applied to the VALUE rather than the capability: `set` with
    // a granting value on a not_built capability is caught above, but a `set`
    // that grants a beta capability is fine and must not be.
    if (definition.lifecycle === 'not_built' && isGrantingValue(parsed.data as CapabilityValue, definition)) {
      return { ok: false, status: 409, error: 'capability_not_built' };
    }
  }

  if (op.overrideOp === 'add' && typeof op.value !== 'number') {
    return { ok: false, status: 400, error: 'add_requires_a_number' };
  }

  const created = await ctx.planRepository.createOverride({
    userId: ctx.accountId,
    capability: op.capability,
    op: op.overrideOp,
    value: op.value,
    reason: op.reason,
    expiresAt: op.expiresAt ?? null,
    adminId: ctx.adminId,
  });

  if (created.error || !created.data) return { ok: false, status: 500, error: 'override_create_failed' };

  return {
    ok: true,
    action: 'BOS_ENTITLEMENT_OVERRIDE_ADDED',
    before: plan,
    after: plan,
    // The override id, so an admin can end exactly this one later.
    data: { overrideId: created.data.id, capability: op.capability },
  };
}

async function endOverride(
  op: Extract<AdminOp, { op: 'end_override' }>,
  ctx: AdminOpContext,
  plan: BusinessOsAccountPlan,
  overrides: BusinessOsEntitlementOverride[]
): Promise<AdminOpOutcome> {
  // Scoped to the account: an override id from another tenant must not be
  // endable from this path, whatever the caller sends.
  const existing = overrides.find((row) => row.id === op.overrideId);
  if (!existing) return { ok: false, status: 404, error: 'override_not_found' };
  if (existing.ended_at) return { ok: false, status: 409, error: 'override_already_ended' };

  const ended = await ctx.planRepository.endOverride(op.overrideId, ctx.accountId, ctx.adminId, op.reason);
  if (ended.error) return { ok: false, status: 500, error: 'override_end_failed' };

  return {
    ok: true,
    action: 'BOS_ENTITLEMENT_OVERRIDE_ENDED',
    before: plan,
    after: plan,
    data: { overrideId: op.overrideId, capability: existing.capability },
  };
}

async function resetPlanState(
  op: Extract<AdminOp, { op: 'reset_plan_state' }>,
  ctx: AdminOpContext,
  plan: BusinessOsAccountPlan,
  overrides: BusinessOsEntitlementOverride[]
): Promise<AdminOpOutcome> {
  // Guard 1: the echoed id must match the path. A confirm literal alone would
  // still fire on a mistyped account.
  if (op.accountId !== ctx.accountId) {
    return { ok: false, status: 409, error: 'account_id_mismatch' };
  }

  // Guard 2: wiping a paying account's plan state is not an accident anyone
  // should be able to have.
  if (plan.tier && !op.confirmTierLoss) {
    return { ok: false, status: 409, error: 'tier_assigned', details: { tier: plan.tier } };
  }

  if (op.cohort === 'champion' && op.expiresAt === undefined) {
    return { ok: false, status: 400, error: 'expires_at_required_for_champion' };
  }
  if (op.cohort === 'trial' && !op.trialClock) {
    return { ok: false, status: 400, error: 'trial_clock_required' };
  }

  const reset = await ctx.planRepository.resetPlanState({
    userId: ctx.accountId,
    cohort: op.cohort,
    cohortExpiresAt: op.expiresAt ?? null,
    trialStartedAt: op.cohort === 'trial' && op.trialClock === 'restart_now' ? ctx.now.toISOString() : null,
    adminId: ctx.adminId,
    reason: op.reason,
  });

  if (reset.error || !reset.data) return { ok: false, status: 500, error: 'reset_failed' };

  return {
    ok: true,
    action: 'BOS_ENTITLEMENT_PLAN_STATE_RESET',
    before: plan,
    after: reset.data,
    data: {
      // Guard 4: what the account HAD, recorded at the moment it stopped
      // having it.
      //
      // The rows themselves survive — M-2 made the reset RPC END every override
      // (`ended_at`, `ended_by_admin_id`, `ended_reason = 'plan_state_reset: …'`)
      // rather than delete one, and the Jest migration guard asserts the
      // function contains no `DELETE` at all. So this is not the last trace of
      // them; it is the before-state in one place, next to the actor and the
      // reason, so an incident does not begin with a join.
      endedOverrides: overrides.map((row) => ({
        id: row.id,
        capability: row.capability,
        op: row.op,
        value: row.value,
        expiresAt: row.expires_at,
        endedAt: row.ended_at,
      })),
    },
  };
}

/** The one place a patch reaches the repository. */
async function writePatch(
  ctx: AdminOpContext,
  before: BusinessOsAccountPlan,
  patch: BusinessOsAccountPlanPatch,
  action: string
): Promise<AdminOpOutcome> {
  const updated = await ctx.planRepository.updatePlan(ctx.accountId, patch, ctx.adminId);

  if (updated.error) return { ok: false, status: 500, error: 'plan_update_failed' };
  // Q-15: `{ data: null, error: null }` means "no row matched", which is
  // indistinguishable from success at the call site unless it is said here.
  if (!updated.data) return { ok: false, status: 409, error: 'plan_row_missing' };

  return { ok: true, action, before, after: updated.data, data: {} };
}
