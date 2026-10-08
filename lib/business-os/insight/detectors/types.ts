/**
 * Detector Types and Interfaces
 *
 * Defines the structure for business insight detectors.
 * Each detector watches specific metrics/events and fires when thresholds are breached.
 *
 * @see docs/INSIGHT_SYSTEM_PLAN.md Section 3
 */

import type { BusinessEventCategory } from '../events/types';
import type { MetricKey } from '../metrics/types';
import type { SegmentRate } from '../patterns/segmentRate';

// ===========================
// Consent & Automation Tiers
// ===========================

/**
 * Consent tiers for actions
 * - observe: Just notify, no action
 * - suggest: Show recommendation, user must approve
 * - automate: Can run automatically once enabled
 */

// ===========================
// Severity Levels
// ===========================

export type InsightSeverity = 'low' | 'medium' | 'high' | 'critical';

export const SEVERITY_WEIGHTS: Record<InsightSeverity, number> = {
  low: 0.25,
  medium: 0.5,
  high: 0.75,
  critical: 1.0,
};

// ===========================
// Guardrails
// ===========================

/**
 * Guardrails prevent runaway automation
 */
export interface Guardrail {
  type: 'rate_limit' | 'max_per_run' | 'quiet_hours' | 'sanity_check';
  config: Record<string, unknown>;
}

export const COMMON_GUARDRAILS: Record<string, Guardrail> = {
  max_1_per_invoice_per_7d: {
    type: 'rate_limit',
    config: { entity: 'invoice', max: 1, period_days: 7 },
  },
  max_20_per_run: {
    type: 'max_per_run',
    config: { max: 20 },
  },
  quiet_hours: {
    type: 'quiet_hours',
    config: { start_hour: 22, end_hour: 8 },
  },
  max_2_per_booking: {
    type: 'rate_limit',
    config: { entity: 'booking', max: 2, period_days: 7 },
  },
  max_1_per_contact_per_48h: {
    type: 'rate_limit',
    config: { entity: 'contact', max: 1, period_hours: 48 },
  },
  max_1_per_contact_per_7d: {
    type: 'rate_limit',
    config: { entity: 'contact', max: 1, period_days: 7 },
  },
};

// ===========================
// Parameter Definitions
// ===========================

/**
 * Parameters the owner can customize for a detector's paired process
 */
export interface ParameterDefinition {
  id: string;
  label: string;
  type: 'number' | 'string' | 'select' | 'boolean';
  default: unknown;
  options?: Array<{ value: string; label: string }>;
  min?: number;
  max?: number;
}

// ===========================
// Detector Definition
// ===========================

/**
 * Threshold types for detection
 * - absolute: Fire when value crosses a fixed number
 * - percent_change: Fire when value changes by X% from baseline
 * - std_deviation: Fire when value is X standard deviations from baseline
 */
export type ThresholdType = 'absolute' | 'percent_change' | 'std_deviation';

/**
 * Direction for threshold comparison
 */
export type ThresholdDirection = 'above' | 'below' | 'either';

/**
 * Baseline window for computing reference values
 */
export type BaselineWindow = 'week' | 'month' | '90days';

/**
 * Full detector definition
 */
/**
 * The kind of assertion a detector makes about the business.
 *
 * `instance` names specific things and is true however little history exists.
 * The other three are inferences over a population and are only as good as the
 * population behind them.
 */
export type ClaimType = 'instance' | 'rate' | 'trend' | 'pattern';

export interface DetectorDefinition {
  /** Unique detector ID (e.g., 'cash_ar_overdue') */
  id: string;

  /** Human-readable name */
  name: string;

  /** Business category this detector watches */
  category: BusinessEventCategory;

  /** Brief description of what this detector finds */
  description: string;

  // === Signal ===

  /** Metrics this detector evaluates */
  watchedMetrics: MetricKey[];

  /**
   * Event types this detector is ABOUT. Documentation, not wiring.
   *
   * Nothing reads this. It looks like a subscription and is not one: a detector
   * is evaluated on every run regardless, and reads whatever tables its
   * `evaluate` names. An audit on 2026-10-06 found five detectors apparently
   * "waiting on" events that can never exist -- `client.at_risk`,
   * `service.booked`, `intro_offer.used`, `enquiry.stalled`,
   * `calendar.utilization_low` -- and two of them work fine, because they were
   * quietly rewritten to read module tables and this field was left behind.
   *
   * Renamed so the next reader cannot mistake it for a trigger. The field that
   * IS consumed is `eventTypes` on a METRIC definition
   * (`insight/metrics/types.ts`), which `MetricsComputeService` counts.
   */
  documentsEventTypes?: string[];

  // === Threshold ===

  /** How far back to look for baseline */
  baselineWindow: BaselineWindow;

  /** Type of threshold comparison */
  thresholdType: ThresholdType;

  /** Threshold value (interpretation depends on thresholdType) */
  threshold: number;

  /** Direction of breach */
  direction: ThresholdDirection;

  /** Minimum samples required before detector can fire */
  minSamples: number;

  // === Severity calculation ===

  /** Function to compute severity based on delta and baseline */
  severityFn: (delta: number, baseline: number) => InsightSeverity;

  // === Paired action ===

  /** Kernel process that can fix this issue (optional) */
  pairedProcessId?: string;


  /** Can this become a standing automation? */
  eligibleForAutomation: boolean;



  // === Cooldown ===

  /** Hours before re-surfacing same insight */
  /**
   * Run even when this detector's vector is still dark.
   *
   * The maturity gate exists so a COMPARATIVE detector is not asked to reason
   * from a baseline it does not have — "conversion is down 30%" is meaningless
   * on eleven contacts. An ABSOLUTE detector has no such problem: "three people
   * wrote to you and got no reply" is true on day one, and the businesses the
   * gate silences are exactly the small ones that can least afford to lose an
   * enquiry.
   *
   * Set it only where the count stands on its own. Default is to respect the
   * gate, which is right for almost everything.
   */
  ignoresVectorMaturity?: boolean;

  /**
   * What KIND of claim this detector makes, which decides how much evidence it
   * needs before it may speak.
   *
   * The maturity gate used to read one boolean, and the boolean was set by hand
   * until 22 of 44 detectors claimed the exemption. The kind of claim is the
   * thing that was actually being decided each time, so it is declared directly
   * now and the exemption is derived from it.
   *
   *   instance  "these 2 bookings hold ₪150"          true at n=1
   *   rate      "18.8% of payments were refunded"     needs a denominator
   *   trend     "traffic is down 40% on last week"    needs two full periods
   *   pattern   "price is the top objection"          needs a share of a sample
   *
   * Only `instance` may run on a vector that is still `learn`. See
   * `effectiveClaimType` below for what an undeclared detector gets, and why
   * the default is the strict one.
   */
  claimType?: ClaimType;

  cooldownHours: number;
}

/**
 * The claim type to gate on, for a detector that may not declare one yet.
 *
 * Derived rather than required so this change does not have to edit 44 files at
 * once, and defaulted to `rate` -- the STRICT side -- on purpose. A field that
 * looks like a guard and is not is the mistake this module has already made
 * twice: `minSamples` was declared by all 44 detectors and read by none, and
 * `ignoresVectorMaturity` was read but hand-set. Defaulting to strict means a
 * new detector that forgets to declare gets quieter, never louder, so the
 * failure mode of forgetting is a card that waits rather than a card that lies.
 */
export function effectiveClaimType(definition: {
  claimType?: ClaimType;
  ignoresVectorMaturity?: boolean;
}): ClaimType {
  if (definition.claimType) return definition.claimType;
  return definition.ignoresVectorMaturity ? 'instance' : 'rate';
}

// ===========================
// Detection Result
// ===========================

/**
 * Result from running a detector
 */
export interface DetectionResult {
  /** Detector that fired */
  detectorId: string;

  /** When detection occurred */
  detectedAt: Date;

  /** Business category */
  category: BusinessEventCategory;

  /** Computed severity */
  severity: InsightSeverity;

  // === Metrics ===

  /** Which metric triggered */
  metricKey: MetricKey;

  /**
   * The detector's own re-surfacing interval, carried onto the result.
   *
   * `InsightPrioritizer` applied `CATEGORY_COOLDOWNS[category]` and never read
   * the detector's `cooldownHours`, so every carefully chosen value was
   * silently replaced by its category's. `toil_manual_booking_entry` asks for
   * 336 hours on purpose -- changing how you take bookings is not a weekly nag
   * -- and was re-surfaced every 168. Two sources of truth, the visible one
   * losing.
   *
   * Stamped by `createDetectionResult` from the definition, like `category`
   * and `pairedProcessId`, because the prioritizer sees results and not
   * definitions.
   */
  cooldownHours?: number;

  /** Current value of the metric */
  currentValue: number;

  /**
   * What `currentValue` is a quantity OF.
   *
   * ───────────────────────────────────────────────────────────────────────────
   * The narration prompt used to print it as `Amount involved: ₪X` for every
   * detector, whatever the number measured. On one live account that produced,
   * in the owner's own language:
   *
   *   ops_service_performance     currentValue 2  (services)   → "₪2 עלולים להפסיד ₪340"
   *   cash_refund_pattern         currentValue 25 (per cent)   → "שיעור החזרות של 25 ₪"
   *   cash_cancelled_unrefunded   currentValue 2  (bookings)   → "₪2 לא הוחזרו"
   *
   * The model was not hallucinating. It was told the number was money and
   * wrote it as money.
   *
   * OMITTED means the figure is NOT sent to the narrator at all. That is the
   * safe default and the reason this is optional: an unlabelled number the
   * model has to guess the unit of is worse than a number it never saw, and
   * `affectedCount` plus `estimatedImpactUsd` already carry the two quantities
   * whose units are never in doubt.
   * ───────────────────────────────────────────────────────────────────────────
   */
  currentValueUnit?: 'money' | 'percent' | 'count' | 'days';

  /**
   * One short phrase naming WHAT this insight is about, built by the detector.
   *
   * The prompt carries counts and money and nothing else, so a card could say
   * "one link you share does not open" and be unable to say WHICH — while the
   * detector's own `processParameters` held the code, the name and the click
   * count all along. The owner's reply to that card was "which link?".
   *
   * Written by the detector because only it knows which of its parameters are
   * worth a sentence, and already in the reader's terms: "the booking link
   * '5 שירותים', 25 clicks" rather than a parameter dump. Never include
   * anything a client typed — this is handed to a model.
   */
  narrationSubject?: string;

  /** Baseline value for comparison */
  baselineValue: number;

  /** Threshold that was breached */
  thresholdValue: number;

  /** Percent change from baseline */
  percentChange: number;

  /** Direction of breach */
  direction: 'above' | 'below';

  /**
   * One part of this business measured against the rest of it.
   *
   * The difference between "30% of your bookings are cancelled", which the
   * owner can read off her own calendar, and "Thursday 43%, everything else
   * 8%", which she cannot see and which names the thing to change.
   *
   * Optional, and absent far more often than present: `outlierSegment` refuses
   * rather than guesses whenever a sample is too thin or the segments are
   * level, and on a small account that is the usual outcome. A card with no
   * comparison renders exactly as it does today — see `describeImpact` in
   * `InsightRepository` for the precedent, and never emit a dangling
   * "compared to".
   *
   * Always a RATE against a pooled remainder, never a volume. See
   * `patterns/segmentRate.ts` for why that is the whole point.
   */
  comparison?: SegmentRate;

  // === Affected entities ===

  /** Type of affected entities */
  affectedEntityType?: string;

  /** IDs of affected entities */
  affectedEntityIds?: string[];

  /** Count of affected entities */
  affectedCount: number;

  // === Money impact ===

  /** Estimated USD impact */
  estimatedImpactUsd?: number;

  /** Direction of impact */
  impactDirection?: 'loss' | 'opportunity' | 'savings';

  /** Period for impact */
  impactPeriod?: 'daily' | 'weekly' | 'monthly';

  // === Action ===

  /** Paired kernel process */
  pairedProcessId?: string;

  /** Default parameters for process */
  processParameters?: Record<string, unknown>;

  /** Can be automated */
  eligibleForAutomation: boolean;
}

// ===========================
// Detector Interface
// ===========================

/**
 * Interface that all detectors must implement
 */
export interface Detector {
  /** Detector definition */
  definition: DetectorDefinition;

  /**
   * Evaluate the detector for a user
   * Returns detection results if thresholds are breached
   */
  evaluate(userId: string): Promise<DetectionResult | null>;
}

// ===========================
// Detection Run
// ===========================

/**
 * Tracks a complete detection run
 */
export interface DetectionRun {
  id: string;
  startedAt: Date;
  completedAt?: Date;
  usersProcessed: number;
  detectorsRun: number;
  insightsGenerated: number;
  errors: number;
}
