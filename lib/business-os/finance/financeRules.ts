/**
 * The finance page's KPI rules and colouring (finance & business health slices
 * 1a and 1b, §7.1, SA-Q1, SA-Q12, BD-11, SA-W5, SA-W7, SA-W10, SA-WR-8).
 *
 * Health's model, reused, not copied: rules are DATA, the first match wins,
 * a rule's colour is only red or amber, and green is decided by CODE
 * (`FINANCE_GREEN_ELIGIBLE`) for a tile whose figures are exact and complete.
 * Matching goes through Health's own `firstMatchingRule` / `matchCondition`
 * (widened to any id, SA-Q1), so the micro-unit rounding and SA C-2 (a ratio
 * never fires on an inexact figure) are never copied. Validation goes through
 * Health's `validateRuleListAgainst` with this file's own vocabulary (SA-W4).
 *
 * Health's own rule set, vocabulary and green set stay closed: this file has
 * its own of each.
 *
 * @module lib/business-os/finance/financeRules
 */

import type { HealthCondition } from '@/lib/admin/health/rules';
import type { TileStatus } from '@/lib/admin/health/healthTypes';
import type { Measured } from '@/lib/admin/health/windows';
import { firstMatchingRule, GREEN_HEADLINE, validateRuleListAgainst } from '@/lib/admin/health/evaluateHealth';
import type { FinanceTileId } from './financeTypes';

export type FinanceMetric = 'aiCostMonth' | 'aiCostPrevSpan' | 'foundingNoEndDate' | 'accountsFarOverAllowance';

export interface FinanceRule {
  /** Stable id, e.g. 'aiCost.doubled'. */
  id: string;
  /** Unique within the tile; ascending in list order. */
  priority: number;
  colour: 'red' | 'amber';
  /** Shown on the tile when this rule is the first to match. Never "OK". */
  description: string;
  condition: HealthCondition<FinanceMetric, never>;
}

export type FinanceRuleSet = Readonly<Record<FinanceTileId, readonly FinanceRule[]>>;

/** Which metrics each tile's conditions may name (checked by the validator). */
export const FINANCE_TILE_VOCABULARY: Readonly<
  Record<FinanceTileId, { metrics: readonly FinanceMetric[]; flags: readonly never[] }>
> = {
  k1_ai_cost: { metrics: ['aiCostMonth', 'aiCostPrevSpan'], flags: [] },
  k2_far_over_allowance: { metrics: ['accountsFarOverAllowance'], flags: [] },
  k3_founding_no_end_date: { metrics: ['foundingNoEndDate'], flags: [] },
  k4_gifted_outstanding: { metrics: [], flags: [] },
  k5_our_revenue: { metrics: [], flags: [] },
};

/**
 * The thresholds (BD-11). Data: changing a factor or the floor changes the
 * colour with no code change (AC-20). K-1's `floor` (USD 1.00) applies to the
 * CURRENT figure, so a tiny month never fires. A $0 previous span with a
 * current figure at or above the floor is red: Health's "new spend" semantics,
 * kept on purpose (SA-W5).
 */
export const FINANCE_RULES: FinanceRuleSet = {
  k1_ai_cost: [
    {
      id: 'aiCost.doubled',
      priority: 1,
      colour: 'red',
      description: 'AI cost at least doubled vs the same days last month',
      condition: { kind: 'ratioAtLeast', metric: 'aiCostMonth', baseline: 'aiCostPrevSpan', factor: 2, floor: 1 },
    },
    {
      id: 'aiCost.up50',
      priority: 2,
      colour: 'amber',
      description: 'AI cost up 50% or more vs the same days last month',
      condition: { kind: 'ratioAtLeast', metric: 'aiCostMonth', baseline: 'aiCostPrevSpan', factor: 1.5, floor: 1 },
    },
  ],
  // BD-11: any account at or over the far-over-allowance line is amber.
  k2_far_over_allowance: [
    {
      id: 'credits.farOver',
      priority: 1,
      colour: 'amber',
      description: 'Accounts at or over the far-over-allowance line',
      condition: { kind: 'atLeast', metric: 'accountsFarOverAllowance', value: 1 },
    },
  ],
  k3_founding_no_end_date: [
    {
      id: 'founding.noEndDate',
      priority: 1,
      colour: 'amber',
      description: 'Founding Partners with no end date',
      condition: { kind: 'atLeast', metric: 'foundingNoEndDate', value: 1 },
    },
  ],
  // Information only (§7.1): never coloured by a rule.
  k4_gifted_outstanding: [],
  k5_our_revenue: [],
};

/**
 * Per-metric parameters (SA-W10, BD-11): data, like the rules. The far-over-
 * allowance line is a parameter of the K-2 METRIC (which accounts count), not
 * of a rule: Health's condition kinds have no per-account threshold. It must
 * be an integer from 100 to 1000 (percent of the period's allowance), checked
 * where it is used; an invalid value makes K-2 unavailable, never a guess.
 */
export const FINANCE_METRIC_PARAMS = { farOverAllowancePercent: 150 } as const;

export const FAR_OVER_ALLOWANCE_PERCENT_RANGE = { min: 100, max: 1000 } as const;

/** The valid far-over-allowance line from a params object, or null when it is invalid. */
export function farOverAllowancePercentOf(params: unknown): number | null {
  const value = (params as { farOverAllowancePercent?: unknown } | null | undefined)?.farOverAllowancePercent;
  if (typeof value !== 'number' || !Number.isInteger(value)) return null;
  return value >= FAR_OVER_ALLOWANCE_PERCENT_RANGE.min && value <= FAR_OVER_ALLOWANCE_PERCENT_RANGE.max ? value : null;
}

/**
 * The ONLY finance tiles that may be green. Code, not data. K-4 and K-5 are
 * absent: in slice 1 they are information only. K-2 is green only when its
 * count is exact (no listed account unknown, SA-WR-8).
 */
export const FINANCE_GREEN_ELIGIBLE: ReadonlySet<FinanceTileId> = new Set<FinanceTileId>([
  'k1_ai_cost',
  'k2_far_over_allowance',
  'k3_founding_no_end_date',
]);

/** SA C-18 for finance: an inexact figure with no rule matched is amber, never green. */
export const FINANCE_LOWER_BOUND_HEADLINE = 'Total is a minimum; not all charges counted';
/** K-1 when the previous span starts before charging went live (code, not data). */
export const NOT_ENOUGH_HISTORY_HEADLINE = 'Not enough history';
/** A figure that could not be read. */
export const FINANCE_UNKNOWN_HEADLINE = 'Unknown';
/** The revenue check failed. */
export const FINANCE_COULD_NOT_CHECK_HEADLINE = 'Could not check';
/** A rule list that failed validation. */
export const FINANCE_RULES_INVALID_HEADLINE = 'Could not check: the rules for this tile are invalid';
/** K-4's information line (§7.1, §8.4): what "outstanding" means. */
export const K4_INFORMATION_HEADLINE = 'Admin-granted, not taken back, not expired';

/** K-2 when some listed account could not be read and none is far over (SA-WR-8): never green. */
export function accountsNotReadHeadline(count: number): string {
  return count === 1 ? '1 account could not be read' : `${count} accounts could not be read`;
}

export interface FinanceMeasurement {
  metrics: Partial<Record<FinanceMetric, Measured>>;
  /** K-1 only: the previous span starts before the cut-over. */
  notEnoughHistory?: boolean;
  /** The headline of a tile that may never be green and matched no rule (K-5). */
  information?: string;
}

export interface FinanceTileColour {
  status: TileStatus;
  headline: string;
  /** The matching rule's id, when one matched. Logged, never shown. */
  ruleId: string | null;
}

export interface FinanceRuleProblem {
  tile: FinanceTileId;
  ruleId: string | null;
  reason: string;
}

/**
 * The tile's state. `measurement` null = the read failed. Never throws.
 * `onRuleError` is called when the rule list is invalid (the builder logs it at
 * `error`).
 */
export function colourFinanceTile(
  id: FinanceTileId,
  rules: unknown,
  measurement: FinanceMeasurement | null,
  options: {
    unavailableHeadline?: string;
    /** The tile's own headline for an inexact figure that matched no rule (K-2, SA-WR-8). */
    lowerBoundHeadline?: string;
    onRuleError?: (problem: FinanceRuleProblem) => void;
  } = {}
): FinanceTileColour {
  const problem = validateRuleListAgainst(id, rules, FINANCE_TILE_VOCABULARY[id]);
  if (problem) {
    options.onRuleError?.(problem);
    return { status: 'unavailable', headline: FINANCE_RULES_INVALID_HEADLINE, ruleId: null };
  }
  if (measurement === null) {
    return { status: 'unavailable', headline: options.unavailableHeadline ?? FINANCE_UNKNOWN_HEADLINE, ruleId: null };
  }
  if (measurement.notEnoughHistory) {
    return { status: 'not_measured', headline: NOT_ENOUGH_HISTORY_HEADLINE, ruleId: null };
  }

  const match = firstMatchingRule<FinanceRule, FinanceMetric, never>(rules as readonly FinanceRule[], measurement.metrics, {});
  if (match) return { status: match.colour, headline: match.description, ruleId: match.id };

  const values = Object.values(measurement.metrics) as Measured[];
  if (values.some((m) => !m.exact)) {
    return { status: 'amber', headline: options.lowerBoundHeadline ?? FINANCE_LOWER_BOUND_HEADLINE, ruleId: null };
  }
  if (FINANCE_GREEN_ELIGIBLE.has(id)) return { status: 'green', headline: GREEN_HEADLINE, ruleId: null };
  return { status: 'neutral', headline: measurement.information ?? FINANCE_UNKNOWN_HEADLINE, ruleId: null };
}

/**
 * K-2, accounts far over their allowance (BD-11, SA-W10, SA-WR-8). The line is
 * validated first: an invalid one is a rule error (unavailable, reported).
 * `unknownAccounts` > 0 makes the count a lower bound: the `atLeast` rule still
 * fires on a count of 1 or more, and with no match the tile is amber with its
 * own headline, never green and never the ledger's "minimum" line.
 */
export function colourFarOverAllowanceTile(
  rules: unknown,
  measured: { farOverAllowance: number; unknownAccounts: number } | null,
  params: unknown,
  options: { onRuleError?: (problem: FinanceRuleProblem) => void } = {}
): FinanceTileColour {
  if (farOverAllowancePercentOf(params) === null) {
    options.onRuleError?.({
      tile: 'k2_far_over_allowance',
      ruleId: null,
      reason: `farOverAllowancePercent must be an integer from ${FAR_OVER_ALLOWANCE_PERCENT_RANGE.min} to ${FAR_OVER_ALLOWANCE_PERCENT_RANGE.max}`,
    });
    return { status: 'unavailable', headline: FINANCE_RULES_INVALID_HEADLINE, ruleId: null };
  }
  return colourFinanceTile(
    'k2_far_over_allowance',
    rules,
    measured === null
      ? null
      : { metrics: { accountsFarOverAllowance: { value: measured.farOverAllowance, exact: measured.unknownAccounts === 0 } } },
    { onRuleError: options.onRuleError, lowerBoundHeadline: accountsNotReadHeadline(measured?.unknownAccounts ?? 0) }
  );
}
