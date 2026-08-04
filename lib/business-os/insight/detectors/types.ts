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

// ===========================
// Consent & Automation Tiers
// ===========================

/**
 * Consent tiers for actions
 * - observe: Just notify, no action
 * - suggest: Show recommendation, user must approve
 * - automate: Can run automatically once enabled
 */
export type ConsentTier = 'observe' | 'suggest' | 'automate';

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

  /** Event types that can trigger evaluation (optional) */
  eventTypes?: string[];

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

  /** Consent tier required */
  consentTier: ConsentTier;

  /** Can this become a standing automation? */
  eligibleForAutomation: boolean;

  /** Parameters owner can customize */
  ownerParameters?: ParameterDefinition[];

  /** Guardrails to apply */
  guardrails?: Guardrail[];

  // === Cooldown ===

  /** Hours before re-surfacing same insight */
  cooldownHours: number;
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

  /** Current value of the metric */
  currentValue: number;

  /** Baseline value for comparison */
  baselineValue: number;

  /** Threshold that was breached */
  thresholdValue: number;

  /** Percent change from baseline */
  percentChange: number;

  /** Direction of breach */
  direction: 'above' | 'below';

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
