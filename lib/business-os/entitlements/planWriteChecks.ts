// lib/business-os/entitlements/planWriteChecks.ts
//
// The pre-write checks a plan-row write shares, whoever writes it (plan
// payments P-3b, SA-P3 a; workplan BUSINESS_OS_PLAN_PAYMENTS_P3B_WORKPLAN.md
// §3.1).
//
// Two writers change a plan row: an admin op (`adminOps.ts`) and, from P-3b.2,
// a paid Stripe invoice (through `business_os_apply_plan_payment`). SA ruled
// that the webhook must NOT call `executeAdminOp`: its Zod union is the admin
// HTTP contract, and a system write must not be reachable through it. What the
// two paths share is therefore these pure checks, extracted here so neither
// re-implements them.
//
// `tierInForce` and `wouldLeaveNoBasis` moved here from `adminOps.ts`
// UNCHANGED (T6): the admin op tests run against them unedited, and are the
// proof. `tierIsConfigured` is the tiers-configured rule (RC-1) as a function,
// for the webhook, which has no Zod enum to lean on.
//
// Pure: no I/O, no logging, deterministic.

import type { BusinessOsAccountPlan, BusinessOsAccountPlanPatch } from '@/lib/repositories/BusinessOsAccountPlanRepository';
import type { EntitlementConfig } from './source';

/** Is a tier assignment in force at `now`? (A-1) */
export function tierInForce(plan: BusinessOsAccountPlan | null, now: Date): boolean {
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
export function wouldLeaveNoBasis(plan: BusinessOsAccountPlan, patch: BusinessOsAccountPlanPatch, now: Date): boolean {
  const next: BusinessOsAccountPlan = { ...plan, ...(patch as Partial<BusinessOsAccountPlan>) };
  // `updatePlan` clears a paired expiry when its assignment is cleared (Q-6),
  // so the projection has to do the same or it would disagree with reality.
  if (patch.tier === null && patch.tier_expires_at === undefined) next.tier_expires_at = null;
  if (patch.cohort === null && patch.cohort_expires_at === undefined) next.cohort_expires_at = null;

  return !tierInForce(next, now) && !next.cohort;
}

/**
 * RC-1: is `tier` one of the tiers the running config defines?
 *
 * A paid Stripe line names a tier through its price's lookup key. If the
 * config no longer defines it (a tier removed, a misconfigured price), writing
 * it would give the account a tier the resolver calls unknown, so the webhook
 * refuses it (`tier_not_configured`, workplan §3.2) instead.
 */
export function tierIsConfigured(config: Pick<EntitlementConfig, 'tierOrder'>, tier: string): boolean {
  return (config.tierOrder as readonly string[]).includes(tier);
}
