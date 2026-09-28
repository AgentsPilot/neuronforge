// lib/business-os/llm/chargeClassification.ts
//
// Business OS credit deduction, slice 2 ("No $0 cost"): how one LLM call is
// priced FOR A CHARGE, and the one live hook that makes an unpriced call fail
// loudly (requirement FR-12a, AC-3; SA Q-1).
//
// Under option B the measured cost IS the charge, so a silent $0 would give an
// action away. The provider layer now says, per OpenAI call, whether the cost
// came from a usable price (`UsageCallRecord.pricing`). This module reads that
// signal, re-checks the price table when it is absent, and decides one of:
//   - measured               charge the recorded cost
//   - failed_call            the provider reported no usage (KI-8, SQ-16)
//   - conservative_fallback  charge the highest in-code rate, flagged (SQ-9)
//
// Deliberately small (SA Q-1 (b)): it imports only the shared pricing reader,
// the logger and types, so `aiActionAudit.ts` can call the hook without
// pulling the rate derivation (and `SystemConfigRepository`) into the graph of
// all 16 AI actions. The rates live in `chargePricing.ts`.
//
// Server-side only by use (it is reached from `aiActionAudit.ts`), though it
// has no server-only import of its own.

import { getPriceStatusSync, isInputOnlyPricedModel } from '@/lib/ai/pricing';
import type { UsageCallRecord } from '@/lib/ai/usageScope';
import { createLogger } from '@/lib/logger';
// Type-only, erased at compile time. Importing the catalog also puts this
// module in `check:bos-llm-literals`' scope, which is where charge policy must
// be: a model or price literal here has to fail CI.
import type { BosLlmArea } from './callCatalog';
import type { AiActionType } from './aiActionAudit';

const logger = createLogger({ module: 'BosChargeClassification' });

/** How a call's charge is decided. */
export type CallChargeBasis = 'measured' | 'failed_call' | 'conservative_fallback';

/** Why a call was priced conservatively. */
export type FallbackReason =
  /** The provider said the model had no usable price. */
  | 'unpriced'
  /** No signal and cost 0; the table has no usable price for the model now either. */
  | 'unpriced_on_recheck'
  /** The provider said "priced" yet the cost is 0 for work done. A backstop: it cannot happen today. */
  | 'priced_but_zero'
  /**
   * No signal, cost 0 for non-zero tokens, and the table says priced NOW (SA C-1).
   * A priced model cannot cost 0 for real tokens, so it was unpriced at call
   * time: for example a cold instance whose price load had not landed, warmed
   * before the action ended (SA-S2's residual hole).
   */
  | 'zero_cost_with_tokens'
  /** A non-finite or negative cost or token count, or an unreadable signal. */
  | 'malformed';

/** One vocabulary on the charge side (SA S-4). The provider side says 'token' | 'image'. */
export type ChargeKind = 'text' | 'embedding' | 'image';

export interface ClassifiedCall {
  basis: CallChargeBasis;
  /** Present exactly when `basis` is `conservative_fallback`. */
  reason?: FallbackReason;
  kind: ChargeKind;
}

/** What the loud log names, beside the call itself. Ids only, never owner text (Standard 5). */
export interface UnpricedLogContext {
  area: BosLlmArea;
  actionType: AiActionType;
  groupId: string;
  accountId: string | null | undefined;
}

/** A finite, non-negative number. */
function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

/**
 * The call's kind. An image says so through its signal. Anything else is a
 * token call, and an input-only model (an embedding) is its own kind, because
 * its conservative rate is the embedding maximum, not the chat maximum (SQ-9).
 * A zero-token record with no signal is a token call, never an image: only
 * OpenAI generates images and it always sets the signal (SA Q-7).
 */
function kindOf(call: UsageCallRecord): ChargeKind {
  if (call.pricing?.unit === 'image') return 'image';
  const { provider, model } = call;
  if (typeof provider === 'string' && typeof model === 'string' && isInputOnlyPricedModel(provider, model)) {
    return 'embedding';
  }
  return 'text';
}

function hasReadableSignal(pricing: UsageCallRecord['pricing']): boolean {
  if (pricing === undefined) return true;
  return (
    typeof pricing === 'object' &&
    pricing !== null &&
    (pricing.status === 'priced' || pricing.status === 'unpriced') &&
    (pricing.unit === 'token' || pricing.unit === 'image')
  );
}

const fallback = (reason: FallbackReason, kind: ChargeKind): ClassifiedCall => ({
  basis: 'conservative_fallback',
  reason,
  kind,
});

/**
 * How one call is charged. Pure and silent; never throws. The rules, in order
 * (workplan §2.3; SA N-6 accepted the order, C-1 amended rule 7):
 *
 *   1. malformed numbers or signal        → conservative, `malformed`
 *   2. a failed call                      → failed_call (its recorded 0, not flagged)
 *   3. signal `unpriced`                  → conservative, `unpriced`
 *   4. signal `priced`, cost 0, work done → conservative, `priced_but_zero` (backstop)
 *   5. signal `priced` otherwise          → measured
 *   6. no signal, cost > 0                → measured (a positive cost proves a price; SA Q-4)
 *   7. no signal, cost 0                  → re-check the table:
 *        priced,   no tokens  → measured (0)
 *        priced,   tokens > 0 → conservative, `zero_cost_with_tokens` (SA C-1)
 *        unpriced             → conservative, `unpriced_on_recheck`
 */
export function classifyCallForCharge(call: UsageCallRecord): ClassifiedCall {
  if (typeof call !== 'object' || call === null) return fallback('malformed', 'text');

  const kind = kindOf(call);
  const { costUsd, inputTokens, outputTokens, pricing } = call;

  // Rule 1.
  if (!isCount(costUsd) || !isCount(inputTokens) || !isCount(outputTokens) || !hasReadableSignal(pricing)) {
    return fallback('malformed', kind);
  }

  // Rule 2.
  if (call.success === false) return { basis: 'failed_call', kind };

  const tokens = inputTokens + outputTokens;

  if (pricing) {
    // Rule 3.
    if (pricing.status === 'unpriced') return fallback('unpriced', kind);
    // Rule 4. An image has no tokens, so a priced image at 0 is the same contradiction.
    if (costUsd === 0 && (tokens > 0 || kind === 'image')) return fallback('priced_but_zero', kind);
    // Rule 5.
    return { basis: 'measured', kind };
  }

  // Rule 6.
  if (costUsd > 0) return { basis: 'measured', kind };

  // Rule 7: an absent signal is re-checked, never assumed unpriced (SQ-13 (2)).
  if (getPriceStatusSync(call.provider, call.model) === 'priced') {
    return tokens === 0 ? { basis: 'measured', kind } : fallback('zero_cost_with_tokens', kind);
  }
  return fallback('unpriced_on_recheck', kind);
}

/**
 * Make every call this action will be charged conservatively for fail loudly,
 * NOW (AC-3), naming what an operator needs to fix it: provider, model, area,
 * action, group, account, call name, kind and reason. One `error` per such
 * call, under the stable event `bos_llm_call_unpriced`, so "how many calls were
 * unpriced?" is countable from logs (FR-12c). This is the ONE error event per
 * unpriced call; slice 3 must not add a second (SA N-4).
 *
 * Log-only: no return value, no audit field, no charge. `runAiAction` calls it
 * in its own try/catch after the audit entry is queued (SA S-1), so nothing
 * here can change the action or skip its entry.
 */
export function reportUnpricedCalls(calls: readonly UsageCallRecord[], ctx: UnpricedLogContext): void {
  for (const call of calls) {
    const classified = classifyCallForCharge(call);
    if (classified.basis !== 'conservative_fallback') continue;
    logger.error(
      {
        event: 'bos_llm_call_unpriced',
        provider: call?.provider,
        model: call?.model,
        area: ctx.area,
        actionType: ctx.actionType,
        groupId: ctx.groupId,
        accountId: ctx.accountId ?? null,
        callName: call?.component,
        kind: classified.kind,
        reason: classified.reason,
      },
      'LLM call has no usable price; its charge is the conservative fallback rate'
    );
  }
}
