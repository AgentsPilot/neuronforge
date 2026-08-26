/**
 * Correlation Types
 *
 * Types for the cross-detector correlation engine that connects
 * individual detector signals into unified, story-driven insights.
 */

import type { DetectionResult, InsightSeverity } from '../detectors/types';

/**
 * A pattern that connects multiple detector signals
 */
export interface CorrelationPattern {
  /** Unique pattern identifier */
  id: string;

  /** Human-readable pattern name */
  name: string;

  /** Pattern category */
  category: 'funnel' | 'revenue' | 'retention' | 'pipeline' | 'capacity' | 'service';

  /** Detector IDs that must ALL fire for pattern to match */
  requiredDetectors: string[];

  /** Detector IDs that strengthen the pattern if present */
  optionalDetectors?: string[];

  /** Minimum number of required detectors that must fire */
  minMatches: number;

  /** Template for the insight story (with {placeholders}) */
  storyTemplate: string;

  /** Template for the recommended action */
  actionTemplate: string;

  /** How much to boost severity when this pattern matches */
  severityBoost: number;

  /** Priority for this pattern (higher = more important) */
  priority: number;
}

/**
 * Result of finding a matching correlation pattern
 */
export interface PatternMatch {
  /** The matched pattern */
  pattern: CorrelationPattern;

  /** Detection results that matched the pattern */
  matchedResults: DetectionResult[];

  /** Detector IDs from required list that matched */
  matchedRequired: string[];

  /** Detector IDs from optional list that matched */
  matchedOptional: string[];

  /** Calculated combined severity */
  combinedSeverity: InsightSeverity;

  /** Total estimated impact across all matched detectors */
  totalImpactUsd: number;

  /** Generated story based on template and data */
  story: string;

  /** Generated action based on template */
  action: string;
}

/**
 * A correlated insight that combines multiple detector signals
 */
export interface CorrelatedInsight {
  /** Unique correlation ID */
  id: string;

  /** Pattern that matched */
  patternId: string;

  /** Pattern name for display */
  patternName: string;

  /** Category for grouping */
  category: CorrelationPattern['category'];

  /** Combined severity (may be boosted) */
  severity: InsightSeverity;

  /** The story that explains the connected signals */
  story: string;

  /** Recommended action */
  action: string;

  /** Total impact across all signals */
  totalImpactUsd: number;

  /** Impact direction (loss or gain) */
  impactDirection: 'loss' | 'gain';

  /** Individual detection results that form this insight */
  contributingInsights: Array<{
    detectorId: string;
    detectorName: string;
    severity: InsightSeverity;
    summary: string;
    impactUsd: number;
  }>;

  /** When this correlation was detected */
  detectedAt: Date;

  /** Priority score for sorting */
  priority: number;
}

/**
 * Summary of all correlated and standalone insights
 */
export interface CorrelationSummary {
  /** Correlated insights (highest priority) */
  correlatedInsights: CorrelatedInsight[];

  /** Individual insights NOT part of any correlation */
  standaloneInsights: DetectionResult[];

  /** Total patterns checked */
  patternsChecked: number;

  /** Total patterns matched */
  patternsMatched: number;

  /** Total combined impact */
  totalImpactUsd: number;
}
