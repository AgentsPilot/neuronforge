/**
 * The credit window rule, pure (credit deduction slice 8a, SA SQ-41).
 *
 * Which window an account's credits are counted over, and how a ledger figure
 * is read. Extracted from the owner card's window (`ownerCreditUsage.ts`) so
 * the owner card, the admin Businesses column (`adminCreditPercent.ts`) and
 * slice 8b's low-line record all decide it the same way — never a copy.
 *
 * Pure: no reads, no logging, a type-only import.
 *
 * @module lib/business-os/credits/creditWindowRule
 */

import type { OwnerCreditAllowance } from './ownerCreditUsageTypes';

/** `trial_total`: summed over every period from the anchor. `period`: the one current period. */
export type CreditWindowMode = 'trial_total' | 'period';

export interface CreditWindowRuleInput {
  /** The plan anchor, or null when the account has no plan row. */
  anchor: string | null;
  /** The allowance the entitlements resolver gave, or null. */
  allowance: OwnerCreditAllowance | null;
}

export interface CreditWindowRuleResult {
  /** No plan row means no allowance, whatever a cached snapshot still says. */
  allowance: OwnerCreditAllowance | null;
  mode: CreditWindowMode;
}

export function creditWindowRule(input: CreditWindowRuleInput): CreditWindowRuleResult {
  const allowance = input.anchor === null ? null : input.allowance;
  const mode: CreditWindowMode = allowance?.per === 'total' && input.anchor !== null ? 'trial_total' : 'period';
  return { allowance, mode };
}

/**
 * A ledger figure as a number. PostgREST may deliver `numeric` as a string.
 * `null` when it does not parse to a finite number — the caller treats that as
 * unreadable, never as 0 (SA W6-4).
 */
export function parseLedgerFigure(value: number | string | null | undefined): number | null {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' && value.trim() !== '' ? Number(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : null;
}
