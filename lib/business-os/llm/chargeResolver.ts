// lib/business-os/llm/chargeResolver.ts
//
// Business OS credit deduction, slice 3a: THE one cost → credits conversion
// (requirement FR-2, FR-6, SQ-8), and the pure builder of the exact charge
// record slice 3b-ii will write (FR-13).
//
// UNWIRED in 3a: nothing outside tests imports this module. Slice 3b-ii calls
// `buildAiChargeRecord` from `runAiAction`, after the audit entry is queued, as
// slice 2 shipped `chargePricing.ts` ahead of this file.
//
// Built only from the action's in-memory call list (FR-11, AC-30): never from
// the usage ledger, never from the audit entry's rounded cost. Pricing is slice
// 2's `priceActionForCharge`, so a call without a usable price is charged the
// conservative rate and flagged (FR-12b). This module adds no log for an
// unpriced call: `bos_llm_call_unpriced` stays the one loud event (S2 N-4).
//
// Pure apart from one `info` per process, on first use, naming the active
// credit value version (SA-S6: serverless has no start-up hook). Checking the
// identities reuses `validateIdentities`, which may emit its own once-per-
// process warning about a misconfigured platform id.
//
// Server-only: `chargePricing.ts` reaches `SystemConfigRepository`, which loads
// `supabaseServer` at import.

import type { UsageCallRecord } from '@/lib/ai/usageScope';
import { createLogger } from '@/lib/logger';
import { currentCreditValue, type CreditValueVersion } from '@/lib/business-os/entitlements/config/creditValue';
import {
  AI_ACTION_DECLARATIONS,
  validateIdentities,
  type AiActionSpec,
  type AiActionType,
  type AiTrigger,
} from './aiActionAudit';
import { priceActionForCharge } from './chargePricing';

const logger = createLogger({ module: 'BosChargeResolver' });

/** One action's charge, before it is written. */
export interface ActionCharge {
  /** USD, the unrounded priced sum rounded to 10 dp for storage (SQ-8). */
  costUsd: number;
  /** The UNROUNDED cost ÷ `usdPerCredit`, rounded to 6 dp (SQ-8). Never rounded further here. */
  credits: number;
  /** The credit value version the credits were computed at (FR-3). */
  creditValueVersion: number;
  isFallbackPriced: boolean;
  fallbackCallCount: number;
}

/** Who caused the charge, in the charge row's words (FR-10, SQ-15 (3)). */
export type ChargeTrigger = 'owner' | 'scheduled' | 'external';

/** Exactly the thin row slice 3b writes (FR-13). No tokens, models, call names, areas or error codes. */
export interface AiChargeRecord {
  actionId: string;
  accountId: string;
  groupId: string;
  actionType: AiActionType;
  trigger: ChargeTrigger;
  outcome: 'succeeded' | 'failed';
  credits: number;
  costUsd: number;
  creditValueVersion: number;
  isFallbackPriced: boolean;
}

/** Why no record was built. */
export type ChargeSkipReason = 'no_calls' | 'not_charged' | 'invalid_identity' | 'unpriceable';

export type AiChargeRecordResult =
  /** `fallbackCallCount` is for the recorder's one `info` per fallback-priced charge; it is not on the row. */
  | { record: AiChargeRecord; fallbackCallCount: number }
  | { skipped: ChargeSkipReason };

export interface AiChargeRecordInput {
  spec: AiActionSpec;
  /** The invocation's id, minted by `runAiAction` (SA-B1). */
  actionId: string;
  /** The server-side account, as `runAiAction` holds it at the end of the action. */
  accountId: string | undefined;
  calls: readonly UsageCallRecord[];
  /** The action's failure, from `resolveActionFailure`: the same result the audit entry takes. */
  failure: { code: string } | undefined;
}

/**
 * Round half away from zero at `dp` places. Exact while value × 10^dp is a
 * safe integer (for 10 dp, below ~$900,000 per action, as the audit entry).
 */
function roundTo(value: number, factor: number): number {
  return Math.round(value * factor) / factor;
}

let activeValueLogged = false;

/** One `info` per process naming the credit value in use (SA-S6). */
function logActiveValueOnce(value: CreditValueVersion): void {
  if (activeValueLogged) return;
  activeValueLogged = true;
  logger.info(
    { event: 'bos_credit_value_active', version: value.version, usdPerCredit: value.usdPerCredit, status: value.status },
    'Business OS credit value in use'
  );
}

/** For tests: forget that the active credit value was logged. */
export function resetCreditValueLogForTests(): void {
  activeValueLogged = false;
}

/** The charge plus the unrounded cost, so the builder can refuse a defect before rounding hides it. */
function price(calls: readonly UsageCallRecord[]): { charge: ActionCharge; rawCostUsd: number } {
  const value = currentCreditValue();
  logActiveValueOnce(value);
  const priced = priceActionForCharge(calls);
  return {
    rawCostUsd: priced.costUsd,
    charge: {
      costUsd: roundTo(priced.costUsd, 1e10),
      // From the UNROUNDED cost: a ~2e-7 USD embedding is 0.0002 credits, not 0 (AC-5).
      credits: roundTo(priced.costUsd / value.usdPerCredit, 1e6),
      creditValueVersion: value.version,
      isFallbackPriced: priced.isFallbackPriced,
      fallbackCallCount: priced.fallbackCallCount,
    },
  };
}

/** The ONLY cost → credits conversion (FR-2). Pure apart from the once-per-process `info`. */
export function resolveActionCharge(calls: readonly UsageCallRecord[]): ActionCharge {
  return price(calls).charge;
}

/** `user` → `owner`; `scheduled` and `external` unchanged (FR-10, SQ-15 (3)). */
export function toChargeTrigger(trigger: AiTrigger): ChargeTrigger {
  switch (trigger) {
    case 'user':
      return 'owner';
    case 'scheduled':
      return 'scheduled';
    case 'external':
      return 'external';
    default: {
      // A new AiTrigger fails to compile here until it is mapped.
      const unmapped: never = trigger;
      return unmapped;
    }
  }
}

/**
 * Build the one charge record for one action, or say why there is none
 * (workplan §2.3, rules 1-5 in order):
 *   1. no calls                            → `no_calls` (FR-7: nothing to charge)
 *   2. the action type is not charged      → `not_charged` (FR-4)
 *   3. invalid group or account, or the platform account → `invalid_identity` (RC-3)
 *   4. a cost that is not finite or < 0    → `unpriceable` (a defect; slice 2 guarantees finite ≥ 0)
 *   5. otherwise                           → the record
 *
 * A failed action is charged the calls it made (FR-8); several calls are one
 * record (FR-5). Never throws on a record; a defect in the pricing tables
 * themselves can throw, and the 3b-ii caller catches it (SA N-4).
 */
export function buildAiChargeRecord(input: AiChargeRecordInput): AiChargeRecordResult {
  const { spec, actionId, accountId, calls, failure } = input;

  if (calls.length === 0) return { skipped: 'no_calls' };
  if (!AI_ACTION_DECLARATIONS[spec.actionType].isCharged) return { skipped: 'not_charged' };

  const identities = validateIdentities(spec, accountId);
  if (!identities) return { skipped: 'invalid_identity' };

  const { charge, rawCostUsd } = price(calls);
  if (!Number.isFinite(rawCostUsd) || rawCostUsd < 0 || !Number.isFinite(charge.credits)) {
    return { skipped: 'unpriceable' };
  }

  return {
    record: {
      actionId,
      accountId: identities.accountId,
      groupId: spec.groupId,
      actionType: spec.actionType,
      trigger: toChargeTrigger(spec.trigger),
      outcome: failure ? 'failed' : 'succeeded',
      credits: charge.credits,
      costUsd: charge.costUsd,
      creditValueVersion: charge.creditValueVersion,
      isFallbackPriced: charge.isFallbackPriced,
    },
    fallbackCallCount: charge.fallbackCallCount,
  };
}
