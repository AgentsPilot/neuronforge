// lib/business-os/entitlements/balance.ts
//
// The AI-action balance seam (workplan §4.8, step c of the A-2 contract).
//
// ── WHY A SEAM WITH NOTHING BEHIND IT SHIPS NOW ─────────────────────────────
// Metering is Slice 3: there is no usage ledger, no boost grant and nothing that
// counts an AI action. So this always answers "yes, there is enough".
//
// It exists anyway because of where the answer has to be ASKED. "Have you got
// any allowance left?" is the third of three questions every call site asks, and
// if it is not in the contract from the start then Slice 3 has to find every
// call site and add it — which is the migration this module exists to avoid. One
// implementation swap, no call-site changes: that is the whole point.
//
// ── WHY IT IS ASYNC WHEN THE STUB IS NOT ────────────────────────────────────
// The real one will query a ledger. An interface that was synchronous today
// would have to change shape tomorrow, and every caller with it.

/** The question a call site is really asking before it spends an AI action. */
export interface AiActionBalanceQuery {
  accountId: string;
  capability: string;
  /** How many actions this call would consume. Usually 1; a fan-out is n. */
  cost: number;
}

export interface AiActionBalanceResult {
  sufficient: boolean;
  /** What is left after this call, when the source can say. */
  remaining?: number;
}

export interface AiActionBalanceSource {
  check(input: AiActionBalanceQuery): Promise<AiActionBalanceResult>;
}

/**
 * The Slice 1 default: nothing is ever short.
 *
 * Not a lie — it is precisely true. Nothing meters anything yet, so no account
 * can be out of an allowance that nothing counts. When Slice 3 lands, the
 * numbers in `cohorts.ts` (all marked PLACEHOLDER) get decided from shadow data
 * and this object gets replaced.
 */
export const ALWAYS_SUFFICIENT: AiActionBalanceSource = {
  async check(): Promise<AiActionBalanceResult> {
    return { sufficient: true };
  },
};
