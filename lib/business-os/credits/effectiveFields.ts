/**
 * The EFFECTIVE fields of a credit ledger row (requirement N-10, SA Q-5).
 *
 * An adjustment row stores `service`, `action_type` and `triggered_by` as NULL:
 * it corrects a charge, and it belongs wherever that charge belongs. So every
 * reader that groups ledger rows must resolve the fields through the charge
 * the adjustment points at (`adjusts_action_id` → the charge's `action_id`,
 * which is UNIQUE, so the answer is deterministic). Reading the raw column
 * instead silently drops every correction from its service (KI-14).
 *
 * This module is the ONE place that resolves them. It is pure: the caller
 * supplies the originals it has read. Slice 7's owner diary is meant to reuse
 * it.
 *
 * The area is looked up by (effective service, action type) (N-11): for the AI
 * service, from the slice 1 declarations; for any other service it is "not
 * declared" and the row is still counted.
 *
 * @module lib/business-os/credits/effectiveFields
 */

import { AI_ACTION_DECLARATIONS } from '@/lib/business-os/llm/aiActionAudit';
import { AI_CHARGE_SERVICE } from '@/lib/business-os/llm/aiChargeRecorder';

/** The fields of a ledger row this module reads. Structural, so tests need no full row. */
export interface EffectiveFieldsInput {
  kind: 'charge' | 'adjustment';
  user_id: string | null;
  action_id: string | null;
  adjusts_action_id: string | null;
  service: string | null;
  action_type: string | null;
  triggered_by: string | null;
}

export interface EffectiveFields {
  /** False for an adjustment whose charge could not be found (or belongs to another account). */
  resolved: boolean;
  effectiveService: string | null;
  effectiveActionType: string | null;
  /** NULL when the (service, action type) pair declares no area. */
  effectiveArea: string | null;
  effectiveTrigger: string | null;
}

const UNRESOLVED: EffectiveFields = {
  resolved: false,
  effectiveService: null,
  effectiveActionType: null,
  effectiveArea: null,
  effectiveTrigger: null,
};

/**
 * The area of an action type, or NULL when it is not declared (N-11). Keyed on
 * the effective service AND the action type: an action type name means nothing
 * without the service that defined it.
 */
export function areaFor(effectiveService: string | null, actionType: string | null): string | null {
  if (effectiveService !== AI_CHARGE_SERVICE || actionType === null) return null;
  if (!Object.prototype.hasOwnProperty.call(AI_ACTION_DECLARATIONS, actionType)) return null;
  return AI_ACTION_DECLARATIONS[actionType as keyof typeof AI_ACTION_DECLARATIONS].area;
}

function own(row: EffectiveFieldsInput): EffectiveFields {
  return {
    resolved: true,
    effectiveService: row.service,
    effectiveActionType: row.action_type,
    effectiveArea: areaFor(row.service, row.action_type),
    effectiveTrigger: row.triggered_by,
  };
}

/**
 * Resolve one row. A charge answers for itself. An adjustment takes its
 * charge's fields, found in `chargesByActionId`; when the charge is missing,
 * is not a charge, or sits on another account, the adjustment is UNRESOLVED:
 * counted in its own bucket by the caller, never dropped and never guessed.
 */
export function resolveEffectiveFields(
  row: EffectiveFieldsInput,
  chargesByActionId: ReadonlyMap<string, EffectiveFieldsInput>
): EffectiveFields {
  if (row.kind === 'charge') return own(row);
  if (row.adjusts_action_id === null) return UNRESOLVED;
  const original = chargesByActionId.get(row.adjusts_action_id);
  if (!original || original.kind !== 'charge') return UNRESOLVED;
  // The adjustment function (4c) takes the account from the original, so they
  // always agree. If they ever do not, attributing the correction would move
  // money between accounts' figures: refuse to resolve instead.
  if (original.user_id !== row.user_id) return UNRESOLVED;
  return own(original);
}
