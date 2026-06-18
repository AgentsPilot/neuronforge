/**
 * InsightPrioritizer - Domain-Agnostic Priority Scoring for Insights
 *
 * Calculates priority scores for insights using universal metrics that work
 * for ANY workflow type, business, or industry. No hardcoded categories,
 * departments, or domain-specific logic.
 *
 * Priority Formula (all inputs normalized 0-1):
 * score = (severity_weight × 30) + (confidence × 25) + (value_impact × 25) + (frequency × 20)
 *
 * @module lib/pilot/insight/InsightPrioritizer
 */

import {
  ExecutionInsight,
  InsightSeverity,
  InsightCategory,
  InsightType,
} from './types';
import { createLogger } from '@/lib/logger';

const logger = createLogger({ service: 'InsightPrioritizer' });

// ============================================================================
// Types
// ============================================================================

/**
 * Urgency levels for insights
 * - immediate: Requires action within hours (critical issues)
 * - this_week: Should be addressed this week
 * - this_month: Can be scheduled for this month
 * - when_possible: Nice to have, no urgency
 */
export type InsightUrgency = 'immediate' | 'this_week' | 'this_month' | 'when_possible';

/**
 * Effort required to implement the fix
 */
export type EffortLevel = 'low' | 'medium' | 'high';

/**
 * Value unit types (universal, domain-agnostic)
 */
export type ValueUnit = 'seconds' | 'count' | 'percentage';

/**
 * Extended insight with priority scoring
 */
export interface PrioritizedInsight extends ExecutionInsight {
  /** Priority score from 0-100 */
  priority_score: number;

  /** Urgency classification */
  urgency: InsightUrgency;

  /** Estimated value if addressed */
  estimated_value: number;

  /** Unit for estimated_value (always universal) */
  value_unit: ValueUnit;

  /** Effort to implement the fix */
  effort_to_fix: EffortLevel;

  /** Return on investment score (value / effort) */
  roi_score: number;

  /** Whether this insight should be highlighted in UI */
  requires_attention: boolean;
}

/**
 * Priority calculation weights
 */
export interface PriorityWeights {
  severity: number;    // Default: 30
  confidence: number;  // Default: 25
  value: number;       // Default: 25
  frequency: number;   // Default: 20
}

/**
 * Configuration for the prioritizer
 */
export interface PrioritizerConfig {
  weights?: Partial<PriorityWeights>;
  attentionThreshold?: number;  // Score above which requires_attention = true
  /** User's primary business goal - used to boost relevant insight types */
  primaryGoal?: string;
}

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_WEIGHTS: PriorityWeights = {
  severity: 30,
  confidence: 25,
  value: 25,
  frequency: 20,
};

const SEVERITY_SCORES: Record<InsightSeverity, number> = {
  critical: 1.0,
  high: 0.75,
  medium: 0.5,
  low: 0.25,
};

// Effort estimation by insight type (domain-agnostic)
const EFFORT_BY_TYPE: Record<InsightType, EffortLevel> = {
  // Data insights - usually low effort (add validation)
  data_unavailable: 'low',
  data_malformed: 'medium',
  data_missing_fields: 'low',
  data_type_mismatch: 'low',
  data_validation_failed: 'medium',
  // Technical insights - varies
  reliability_risk: 'medium',
  performance_degradation: 'high',
  cost_optimization: 'medium',
  schedule_optimization: 'low',
  // Business insights - usually requires analysis
  automation_opportunity: 'high',
  volume_trend: 'low',
  category_shift: 'medium',
  operational_anomaly: 'medium',
  scale_opportunity: 'high',
};

// Urgency mapping by severity and category
const URGENCY_MATRIX: Record<InsightSeverity, Record<InsightCategory, InsightUrgency>> = {
  critical: {
    data_insight: 'immediate',
    technical_insight: 'immediate',
    business_insight: 'this_week',
  },
  high: {
    data_insight: 'this_week',
    technical_insight: 'this_week',
    business_insight: 'this_week',
  },
  medium: {
    data_insight: 'this_month',
    technical_insight: 'this_month',
    business_insight: 'this_month',
  },
  low: {
    data_insight: 'when_possible',
    technical_insight: 'when_possible',
    business_insight: 'when_possible',
  },
};

// ============================================================================
// Main Class
// ============================================================================

/**
 * Goal-based boost mapping
 * Maps user's primary_goal to insight types that should be prioritized higher
 */
const GOAL_BOOST_MAP: Record<string, InsightType[]> = {
  reduce_costs: ['cost_optimization', 'schedule_optimization', 'performance_degradation'],
  grow_revenue: ['volume_trend', 'scale_opportunity', 'automation_opportunity'],
  improve_efficiency: ['performance_degradation', 'automation_opportunity', 'schedule_optimization'],
  scale_operations: ['reliability_risk', 'scale_opportunity', 'performance_degradation'],
  better_cx: ['data_validation_failed', 'operational_anomaly', 'reliability_risk'],
};

/** Boost multiplier for goal-aligned insights (25% boost) */
const GOAL_BOOST_MULTIPLIER = 1.25;

export class InsightPrioritizer {
  private weights: PriorityWeights;
  private attentionThreshold: number;
  private primaryGoal?: string;

  constructor(config: PrioritizerConfig = {}) {
    this.weights = { ...DEFAULT_WEIGHTS, ...config.weights };
    this.attentionThreshold = config.attentionThreshold ?? 70;
    this.primaryGoal = config.primaryGoal;

    // Validate weights sum to 100
    const totalWeight = Object.values(this.weights).reduce((a, b) => a + b, 0);
    if (totalWeight !== 100) {
      logger.warn({ totalWeight, weights: this.weights }, 'Priority weights do not sum to 100');
    }

    if (this.primaryGoal) {
      logger.debug({ primaryGoal: this.primaryGoal }, 'Goal-based priority boost enabled');
    }
  }

  /**
   * Prioritize a single insight
   */
  prioritize(insight: ExecutionInsight): PrioritizedInsight {
    // Calculate component scores (all 0-1)
    const severityScore = this.calculateSeverityScore(insight.severity);
    const confidenceScore = this.calculateConfidenceScore(insight.confidence);
    const valueScore = this.calculateValueScore(insight);
    const frequencyScore = this.calculateFrequencyScore(insight);

    // Apply weights and sum
    let priorityScore = Math.round(
      severityScore * this.weights.severity +
      confidenceScore * this.weights.confidence +
      valueScore * this.weights.value +
      frequencyScore * this.weights.frequency
    );

    // Apply goal-based boost if insight type aligns with user's primary goal
    priorityScore = this.applyGoalBoost(priorityScore, insight.insight_type);

    // Derive additional properties
    const urgency = this.determineUrgency(insight);
    const effortToFix = this.estimateEffort(insight);
    const { estimatedValue, valueUnit } = this.estimateValue(insight);
    const roiScore = this.calculateROI(priorityScore, effortToFix);

    return {
      ...insight,
      priority_score: Math.min(100, Math.max(0, priorityScore)),
      urgency,
      estimated_value: estimatedValue,
      value_unit: valueUnit,
      effort_to_fix: effortToFix,
      roi_score: roiScore,
      requires_attention: priorityScore >= this.attentionThreshold,
    };
  }

  /**
   * Prioritize multiple insights and sort by priority
   */
  prioritizeAll(insights: ExecutionInsight[]): PrioritizedInsight[] {
    const prioritized = insights.map(i => this.prioritize(i));

    // Sort by priority score descending, then by urgency
    return prioritized.sort((a, b) => {
      if (b.priority_score !== a.priority_score) {
        return b.priority_score - a.priority_score;
      }
      // Secondary sort by urgency
      const urgencyOrder: Record<InsightUrgency, number> = {
        immediate: 0,
        this_week: 1,
        this_month: 2,
        when_possible: 3,
      };
      return urgencyOrder[a.urgency] - urgencyOrder[b.urgency];
    });
  }

  /**
   * Get top N insights that require attention
   */
  getTopPriorities(insights: ExecutionInsight[], limit = 5): PrioritizedInsight[] {
    const prioritized = this.prioritizeAll(insights);
    return prioritized
      .filter(i => i.requires_attention)
      .slice(0, limit);
  }

  /**
   * Group insights by urgency
   */
  groupByUrgency(insights: ExecutionInsight[]): Record<InsightUrgency, PrioritizedInsight[]> {
    const prioritized = this.prioritizeAll(insights);
    return {
      immediate: prioritized.filter(i => i.urgency === 'immediate'),
      this_week: prioritized.filter(i => i.urgency === 'this_week'),
      this_month: prioritized.filter(i => i.urgency === 'this_month'),
      when_possible: prioritized.filter(i => i.urgency === 'when_possible'),
    };
  }

  // ============================================================================
  // Score Calculation Methods
  // ============================================================================

  /**
   * Apply goal-based boost if insight type aligns with user's primary business goal
   * Returns boosted score (capped at 100)
   */
  private applyGoalBoost(score: number, insightType: InsightType): number {
    if (!this.primaryGoal) {
      return score;
    }

    const boostedTypes = GOAL_BOOST_MAP[this.primaryGoal];
    if (!boostedTypes || !boostedTypes.includes(insightType)) {
      return score;
    }

    // Apply boost and cap at 100
    const boostedScore = Math.round(score * GOAL_BOOST_MULTIPLIER);
    return Math.min(100, boostedScore);
  }

  private calculateSeverityScore(severity: InsightSeverity): number {
    return SEVERITY_SCORES[severity] ?? 0.5;
  }

  private calculateConfidenceScore(confidence: number): number {
    // Confidence is already 0-1
    return Math.min(1, Math.max(0, confidence));
  }

  private calculateValueScore(insight: ExecutionInsight): number {
    // Value is derived from business impact metrics (all domain-agnostic)
    const metrics = insight.metrics;

    // Calculate based on affected executions percentage
    const affectedPercentage = metrics.total_executions > 0
      ? metrics.affected_executions / metrics.total_executions
      : 0;

    // Also consider pattern frequency
    const frequencyFactor = metrics.pattern_frequency ?? 0;

    // Time savings if available
    let timeSavingsFactor = 0;
    if (insight.time_saved_hours_per_week) {
      // Normalize: 10+ hours/week = 1.0
      timeSavingsFactor = Math.min(1, insight.time_saved_hours_per_week / 10);
    }

    // Combine factors (weighted average)
    return (affectedPercentage * 0.4) + (frequencyFactor * 0.3) + (timeSavingsFactor * 0.3);
  }

  private calculateFrequencyScore(insight: ExecutionInsight): number {
    const metrics = insight.metrics;

    // How often does this pattern occur?
    // More frequent = higher priority
    const frequency = metrics.pattern_frequency ?? 0;

    // Also consider recency
    let recencyFactor = 0.5; // Default neutral
    if (metrics.last_occurrence) {
      const daysSinceLastOccurrence = this.daysSince(metrics.last_occurrence);
      // Recent occurrences (within 7 days) get higher score
      recencyFactor = Math.max(0, 1 - (daysSinceLastOccurrence / 30));
    }

    return (frequency * 0.6) + (recencyFactor * 0.4);
  }

  // ============================================================================
  // Helper Methods
  // ============================================================================

  private determineUrgency(insight: ExecutionInsight): InsightUrgency {
    return URGENCY_MATRIX[insight.severity]?.[insight.category] ?? 'when_possible';
  }

  private estimateEffort(insight: ExecutionInsight): EffortLevel {
    return EFFORT_BY_TYPE[insight.insight_type] ?? 'medium';
  }

  private estimateValue(insight: ExecutionInsight): { estimatedValue: number; valueUnit: ValueUnit } {
    // Prioritize time-based value (universal metric)
    if (insight.time_saved_hours_per_week && insight.time_saved_hours_per_week > 0) {
      return {
        estimatedValue: Math.round(insight.time_saved_hours_per_week * 3600), // Convert to seconds
        valueUnit: 'seconds',
      };
    }

    // Fall back to affected executions
    if (insight.metrics.affected_executions > 0) {
      return {
        estimatedValue: insight.metrics.affected_executions,
        valueUnit: 'count',
      };
    }

    // Use pattern frequency as percentage
    return {
      estimatedValue: Math.round(insight.metrics.pattern_frequency * 100),
      valueUnit: 'percentage',
    };
  }

  private calculateROI(priorityScore: number, effort: EffortLevel): number {
    // ROI = priority / effort
    const effortMultiplier: Record<EffortLevel, number> = {
      low: 1,
      medium: 2,
      high: 3,
    };
    return Math.round(priorityScore / effortMultiplier[effort]);
  }

  private daysSince(isoDateString: string): number {
    const date = new Date(isoDateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    return diffMs / (1000 * 60 * 60 * 24);
  }
}

// ============================================================================
// Singleton Export
// ============================================================================

let prioritizerInstance: InsightPrioritizer | null = null;

export function getInsightPrioritizer(config?: PrioritizerConfig): InsightPrioritizer {
  if (!prioritizerInstance) {
    prioritizerInstance = new InsightPrioritizer(config);
  }
  return prioritizerInstance;
}

// Named export for direct instantiation
export { InsightPrioritizer as default };
