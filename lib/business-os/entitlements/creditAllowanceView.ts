// lib/business-os/entitlements/creditAllowanceView.ts
//
// THE CREDIT ALLOWANCE, FOR DISPLAY — what the owner's dashboard card counts
// down from (credit deduction slice 6a, workplan §4.4, SA W6-9).
//
// ── WHY IT LIVES INSIDE THE MODULE ──────────────────────────────────────────
// It names the capability id, and the id literal stays inside the module (the
// entitlements guards). The two callers outside are registered as non-gate
// importers: `lib/business-os/credits/ownerCreditUsage.ts` (the owner card and
// history, `creditAllowanceForDisplay`) and, from credit deduction slice 11c,
// the admin per-account credit view `app/api/admin/business-os/credits/
// accounts/[accountId]/route.ts` (`creditAllowanceDecision`: the same figure
// plus the resolver layer that decided it, for an admin's eyes only).
//
// ── DISPLAY ONLY — NEVER A GATE ─────────────────────────────────────────────
// It answers "what figure does the card show?", never "may this call go
// ahead?". It must never be imported by a gate: refusing by allowance is
// slices 8 and 10, through `check()` / `decide()`.
//
// That is also why a STALE snapshot is used: T-3 bars stale inputs from
// owner-paid ANSWERS, and a read-out is not one. The staleness is bounded by
// `STALE_TOLERANCE_SECONDS` in the service.
//
// ── "NO ALLOWANCE" IS DECIDED HERE, AND IS NEVER "0 OF 0" (FR-29, D-e) ──────
// `null` when the snapshot is unavailable, the resolution is an anomaly (no
// plan row, no assignment…), nothing was granted (`basis.kind === 'none'`), the
// value is the withheld floor, the value is not a positive finite amount, or
// the lifecycle state has no allowance to show. The card then shows usage with
// no gauge. A trial is recognised by the value's SHAPE (`{ total }`), never by
// a cohort or tier name.

import type { SnapshotResult } from './EntitlementService';
import { withheldValue, type TraceEntry } from './resolver';
import { CAPABILITIES } from './config/catalog';
import type { CapabilityDef, CapabilityValue, LifecycleState } from './types';

const CREDIT_ALLOWANCE = 'credits.allowance';

/** What the card counts down from. `per: 'total'` is a one-off (trial) allowance. */
export interface CreditAllowanceForDisplay {
  amount: number;
  per: 'month' | 'total';
}

/**
 * Whether a lifecycle state shows its allowance.
 *
 * Exhaustive on purpose (SA W6-9): the resolver does not apply the lifecycle
 * overlay to values (layer 5 lives in `decide.ts`), so this is the one place
 * the card decides it. A new state fails to compile here until someone decides
 * whether it shows an allowance.
 */
function showsAllowance(state: LifecycleState): boolean {
  switch (state) {
    case 'trial':
    case 'champion':
    case 'active':
    case 'past_due':
    case 'grace':
      // In grace the allowance still applies; once lapsed, usage with no gauge.
      return true;
    case 'paused':
    case 'unknown':
      return false;
    default: {
      const unhandled: never = state;
      throw new Error(`Unhandled lifecycle state: ${String(unhandled)}`);
    }
  }
}

function sameValue(a: CapabilityValue, b: CapabilityValue): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function toAllowance(value: CapabilityValue): CreditAllowanceForDisplay | null {
  if (!value || typeof value !== 'object') return null;
  if ('perMonth' in value && typeof value.perMonth === 'number') {
    return Number.isFinite(value.perMonth) && value.perMonth > 0 ? { amount: value.perMonth, per: 'month' } : null;
  }
  if ('total' in value && typeof value.total === 'number') {
    return Number.isFinite(value.total) && value.total > 0 ? { amount: value.total, per: 'total' } : null;
  }
  return null;
}

/** The credit allowance the card shows, or `null` for "no allowance" (usage only). */
export function creditAllowanceForDisplay(snapshot: SnapshotResult): CreditAllowanceForDisplay | null {
  if (snapshot.unavailable || !snapshot.resolution) return null;

  const resolution = snapshot.resolution;
  if (resolution.anomaly || resolution.basis.kind === 'none') return null;
  if (!showsAllowance(resolution.state)) return null;

  const resolved = resolution.values[CREDIT_ALLOWANCE];
  if (!resolved) return null;

  const definition = (CAPABILITIES as Record<string, CapabilityDef>)[CREDIT_ALLOWANCE];
  if (definition && sameValue(resolved.value, withheldValue(definition))) return null;

  return toAllowance(resolved.value);
}

/** The allowance and the layer that decided it (credit deduction slice 11c, SA OP-24). */
export interface CreditAllowanceDecision {
  /** Exactly `creditAllowanceForDisplay(snapshot)`: one rule, not two. */
  allowance: CreditAllowanceForDisplay | null;
  /** The resolver's layer for the credit allowance; null whenever `allowance` is null. */
  layer: TraceEntry['layer'] | null;
}

/**
 * The allowance the owner's card shows, with the layer that decided it, for
 * the admin credit view. The figure is `creditAllowanceForDisplay` itself, so
 * the admin and the owner can never read two different allowances.
 */
export function creditAllowanceDecision(snapshot: SnapshotResult): CreditAllowanceDecision {
  const allowance = creditAllowanceForDisplay(snapshot);
  if (allowance === null) return { allowance: null, layer: null };
  const resolved = snapshot.resolution?.values[CREDIT_ALLOWANCE];
  return { allowance, layer: resolved ? resolved.decidedBy : null };
}
