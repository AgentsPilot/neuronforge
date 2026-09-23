// lib/business-os/entitlements/decide.ts
//
// MAY THIS CALL GO AHEAD? — the A-2 three-step contract.
//
// Workplan §4.8. Pure: the snapshot, the request and the balance answer in, one
// decision out.
//
// ── WHY THE ORDER IS FIXED, AND WHY IT IS ONE FUNCTION ──────────────────────
// There are three different reasons to say no, and they are not interchangeable:
//
//   a. you do not have this capability          → sell them something
//   b. your account is not active               → tell them to pay, not to buy
//   c. you have it, but you are out of allowance → top up, or degrade quietly
//
// Left to call sites, some would check one, some two, and the order would differ
// — so a Basic account in grace would be told "upgrade to Pro" by one surface
// and "your account is paused" by another, for the same click. The order here is
// the most actionable first: a customer who does not have the feature at all is
// not helped by being told their account is read-only.
//
// ── STEP 0 IS THE ONE THAT MATTERS MOST ─────────────────────────────────────
// When we cannot resolve the account — the database is down, the config failed
// to load — the answer is NEVER `not_entitled`. An outage must not show a
// customer an upgrade prompt for something they already pay for. Owner-paid
// surfaces get `entitlement_unavailable` (a 503-shaped answer, "try again"), and
// everything the business's own clients touch keeps working (T-3).

import type { CapabilityDef, LifecycleState, OverlayOutcome, SurfaceKind } from './types';
import type { AtLimitBehaviour, CapabilityValue } from './types';
import type { EntitlementConfig } from './source';
import type { CatalogLike } from './schema';
import type { EntitlementResolution } from './resolver';
import { lowestTierFor, satisfies } from './resolver';
import type { AiActionBalanceResult } from './balance';

export type EntitlementOutcome =
  /** Go ahead. */
  | 'allowed'
  /** Go ahead, and say the account needs attention (grace, on a public page). */
  | 'allowed_with_warning'
  /** The plan does not include it. The only outcome that should ever offer an upgrade. */
  | 'not_entitled'
  /** The account is in grace or paused: look, do not touch. */
  | 'read_only'
  /** Public booking/website surfaces while paused. */
  | 'paused_public'
  /** An automated send that must not go out in this state. */
  | 'suppressed'
  /** Entitled and active, but the allowance is spent. */
  | 'limit_reached'
  /** We could not tell. Never means "no" — see the header. */
  | 'entitlement_unavailable';

export interface EntitlementRequest {
  surfaceKind: SurfaceKind;
  /** The level or amount being asked for. Omit for "is it on at all?". */
  requested?: CapabilityValue;
  /** How many AI actions this call would spend. Default 1. */
  cost?: number;
  /** When the surface is an automated send, its registry id (S-1). */
  sendId?: string;
}

export interface EntitlementDecision {
  outcome: EntitlementOutcome;
  capability: string;
  /** The cheapest tier that would satisfy the request. `null` while no tiers exist (RC-1). */
  lowestTier: string | null;
  /** A short machine-readable token: the rule that decided it. */
  reason: string;
  surfaceKind: SurfaceKind;
  state: LifecycleState;
  /** Set on `limit_reached`: what the call site should do instead (D-12). */
  atLimit?: AtLimitBehaviour;
  /** Set on `limit_reached`, when the balance source can say. */
  remaining?: number;
  /** How long this answer may be stale (T-5). */
  effectiveWithinSeconds?: number;
}

/**
 * Why step 0 answers differently for different surfaces (T-3).
 *
 * The question is not "how important is this call" but "who is harmed by the
 * wrong answer". If we cannot resolve an account and we refuse:
 *   - the OWNER sees a feature they pay for disappear, and may buy it twice;
 *   - the owner's CLIENT sees a booking page that is down, having done nothing.
 *
 * So client-facing surfaces fail open, owner-paid surfaces fail closed-but-
 * honest, and marketing sends — the only ones with no one waiting — defer.
 */
export function failurePolicyFor(
  definition: CapabilityDef | undefined,
  surfaceKind: SurfaceKind
): { outcome: EntitlementOutcome; reason: string } {
  if (surfaceKind === 'send:marketing') {
    return { outcome: 'entitlement_unavailable', reason: 'unavailable_defer_marketing' };
  }

  if (surfaceKind === 'public_business' || surfaceKind === 'public_self_service') {
    return { outcome: 'allowed', reason: 'unavailable_fail_open_public' };
  }

  if (surfaceKind === 'send:transactional:client' || surfaceKind === 'send:transactional:system') {
    return { outcome: 'allowed', reason: 'unavailable_fail_open_transactional' };
  }

  if (definition && (definition.audience === 'client' || definition.audience === 'client_render')) {
    return { outcome: 'allowed', reason: 'unavailable_fail_open_client_facing' };
  }

  // Owner and mixed audiences on owner surfaces: never `not_entitled`.
  return { outcome: 'entitlement_unavailable', reason: 'unavailable_owner_surface' };
}

/** The overlay outcome for a state and surface, honouring per-send exceptions (Q-B4). */
export function overlayFor(
  config: EntitlementConfig,
  state: LifecycleState,
  surfaceKind: SurfaceKind,
  sendId?: string
): OverlayOutcome {
  if (sendId) {
    const perSend = config.lifecycle.sendPolicyOverrides as Record<
      string,
      Partial<Record<LifecycleState, OverlayOutcome>> | undefined
    >;
    const exception = perSend[sendId]?.[state];
    if (exception) return exception;
  }

  const table = config.lifecycle.overlay as Record<LifecycleState, Record<SurfaceKind, OverlayOutcome>>;
  return table[state]?.[surfaceKind] ?? 'allow';
}

/**
 * The single decision.
 *
 * `resolution` is `null` when the account could not be resolved at all — that is
 * step 0, and it is why this takes a nullable snapshot rather than making every
 * caller handle the failure itself.
 *
 * `balance` is the balance source's answer, already awaited. It is passed in
 * rather than fetched so this function stays pure and so the service can skip
 * the query entirely when steps (a) or (b) have already failed.
 */
export function decide(args: {
  config: EntitlementConfig;
  resolution: EntitlementResolution | null;
  capability: string;
  request: EntitlementRequest;
  balance?: AiActionBalanceResult;
  /** T-5: how long the underlying inputs may be stale. */
  effectiveWithinSeconds?: number;
}): EntitlementDecision {
  const { config, resolution, capability, request, balance, effectiveWithinSeconds } = args;
  const definition = (config.catalog as CatalogLike)[capability];
  const surfaceKind = request.surfaceKind;

  const base = {
    capability,
    surfaceKind,
    lowestTier: null as string | null,
    effectiveWithinSeconds,
  };

  // ── Step 0: is there an answer at all? ────────────────────────────────────
  if (!resolution || resolution.anomaly) {
    const policy = failurePolicyFor(definition, surfaceKind);
    return {
      ...base,
      outcome: policy.outcome,
      reason: resolution?.anomaly ? `${policy.reason}:${resolution.anomaly}` : policy.reason,
      state: resolution?.state ?? 'unknown',
    };
  }

  const state = resolution.state;

  if (!definition) {
    // A capability nobody declared. Treating it as entitled would make the
    // catalog optional; treating it as unavailable keeps the failure visible
    // without showing a customer an upgrade prompt for a typo.
    return { ...base, outcome: 'entitlement_unavailable', reason: 'unknown_capability', state };
  }

  // ── Step a: does the entitlement cover it? ────────────────────────────────
  const held = resolution.values[capability]?.value;
  if (held === undefined || !satisfies(definition, held, request.requested)) {
    return {
      ...base,
      outcome: 'not_entitled',
      lowestTier: lowestTierFor(config, capability, request.requested),
      reason: definition.lifecycle === 'not_built' ? 'not_built' : 'not_in_plan',
      state,
    };
  }

  // ── Step b: is the account's state active on this surface? ────────────────
  const overlay = overlayFor(config, state, surfaceKind, request.sendId);
  if (overlay === 'read_only') {
    return { ...base, outcome: 'read_only', reason: `state_${state}`, state };
  }
  if (overlay === 'paused_public') {
    return { ...base, outcome: 'paused_public', reason: `state_${state}`, state };
  }
  if (overlay === 'suppress') {
    return { ...base, outcome: 'suppressed', reason: `state_${state}`, state };
  }

  // ── Step c: is there allowance left? ──────────────────────────────────────
  // Only metered capabilities have a balance to be short of. Asking about a
  // boolean would be asking a question with no answer.
  if (definition.shape.kind === 'metered' && balance && !balance.sufficient) {
    return {
      ...base,
      outcome: 'limit_reached',
      reason: 'allowance_exhausted',
      // D-12/B-9: a client-facing send degrades to template text rather than
      // failing; owner-facing AI pauses and chat explains why.
      atLimit: definition.atLimit,
      remaining: balance.remaining,
      state,
    };
  }

  return {
    ...base,
    outcome: overlay === 'allow_with_warning' ? 'allowed_with_warning' : 'allowed',
    reason: overlay === 'allow_with_warning' ? `state_${state}` : 'entitled',
    state,
  };
}

/** True when the decision means the call must not proceed as asked. */
export function isRefusal(decision: EntitlementDecision): boolean {
  return decision.outcome !== 'allowed' && decision.outcome !== 'allowed_with_warning';
}
