// lib/business-os/entitlements/config/creditRetail.ts
//
// THE RETAIL MARKUP — how much more than our measured AI cost an owner pays for
// a credit they buy.
//
// Business OS credits boost, slice 1 (requirement §8.1, FR-42, SA T-3a / F-3).
// Before this file the markup (decision D1, 100%) lived only in the pricing doc,
// so the boost base rate could not be derived from config. The base rate is
// COMPUTED from this file and `creditValue.ts` (`retailRate.ts`), never typed.
//
// ── WHY ITS OWN FILE, NOT A FIELD ON creditValue.ts ─────────────────────────
// The credit itself carries no markup (pricing doc §1): a charge is always
// measured cost ÷ the credit value. A markup change must therefore not mint a
// new credit value version, which would imply something changed about recorded
// charges. The two histories are separate, and each retail entry names the
// credit value version it was decided against.
//
// ── APPEND-ONLY ─────────────────────────────────────────────────────────────
// Never edit an entry that has shipped. To change the markup, APPEND an entry
// with the next version, extend `creditRetail.history.json` in the same PR, and
// re-version every boost package (`boostPackages.ts`), whose `retailVersion`
// must name the current entry or the catalogue is invalid (fails closed).
// The snapshot test (`__tests__/creditRetail.test.ts`) catches an ACCIDENTAL
// edit only; the PR and its SA review are the audit record.
//
// Data only: no logic beyond the last-entry accessor, no run-time imports (RC-7).
// Procedure: docs/architecture/BUSINESS_OS_CREDIT_PRICING.md §6.3.

export interface CreditRetailVersion {
  /** 1, 2, 3 … with no gaps (there was never a provisional markup). */
  version: number;
  /** Markup over measured AI cost: 1 = 100%, the owner pays 2× cost. Finite, >= 0. */
  markup: number;
  /** The `CREDIT_VALUE_HISTORY` version this markup was decided against. */
  creditValueVersion: number;
  /** ISO date (YYYY-MM-DD) the markup was decided. */
  decidedOn: string;
  /** Why, in words; points at the pricing doc rather than restating it. */
  derivation: string;
}

/**
 * Freezes every nested object, so no caller can shift the rate at run time
 * (`as const` is compile-time only). Local: this file has no run-time imports.
 */
function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const key of Object.keys(value)) deepFreeze((value as Record<string, unknown>)[key]);
    Object.freeze(value);
  }
  return value;
}

/** Append-only. Changing an existing entry rewrites history; a test refuses it. */
export const CREDIT_RETAIL_HISTORY = deepFreeze([
  {
    version: 1,
    markup: 1,
    creditValueVersion: 1,
    decidedOn: '2026-09-30',
    derivation:
      'Decision D1 (user, 2026-09-30): 100% markup, the owner pays twice our measured AI cost. Recorded in code by credits boost slice 1 (SA F-3). Numbers and revision log: docs/architecture/BUSINESS_OS_CREDIT_PRICING.md.',
  },
] as const satisfies readonly CreditRetailVersion[]);

/** The markup new sales are priced at: the last entry. */
export function currentCreditRetail(): CreditRetailVersion {
  return CREDIT_RETAIL_HISTORY[CREDIT_RETAIL_HISTORY.length - 1];
}
