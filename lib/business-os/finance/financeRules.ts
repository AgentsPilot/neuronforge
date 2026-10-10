/**
 * The finance page's KPI rules and colouring (finance & business health slice
 * 1a, §7.1, SA-Q1, SA-Q12, BD-11, SA-W5, SA-W7).
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

export type FinanceMetric = 'aiCostMonth' | 'aiCostPrevSpan' | 'foundingNoEndDate';

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
  k3_founding_no_end_date: { metrics: ['foundingNoEndDate'], flags: [] },
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
  k3_founding_no_end_date: [
    {
      id: 'founding.noEndDate',
      priority: 1,
      colour: 'amber',
      description: 'Founding Partners with no end date',
      condition: { kind: 'atLeast', metric: 'foundingNoEndDate', value: 1 },
    },
  ],
  k5_our_revenue: [],
};

/**
 * The ONLY finance tiles that may be green. Code, not data. K-5 is absent: in
 * slice 1 it is information only (none yet / recorded / could not check).
 */
export const FINANCE_GREEN_ELIGIBLE: ReadonlySet<FinanceTileId> = new Set<FinanceTileId>([
  'k1_ai_cost',
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
  options: { unavailableHeadline?: string; onRuleError?: (problem: FinanceRuleProblem) => void } = {}
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
    return { status: 'amber', headline: FINANCE_LOWER_BOUND_HEADLINE, ruleId: null };
  }
  if (FINANCE_GREEN_ELIGIBLE.has(id)) return { status: 'green', headline: GREEN_HEADLINE, ruleId: null };
  return { status: 'neutral', headline: measurement.information ?? FINANCE_UNKNOWN_HEADLINE, ruleId: null };
}
