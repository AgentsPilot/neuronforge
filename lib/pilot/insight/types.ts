/**
 * Business Insight System - Type Definitions
 *
 * Defines data structures for the production insight collection system.
 * Based on architecture document: docs/shadow-critic-architecture.md (lines 1056-1114)
 *
 * Key principles:
 * - Metadata only (no client data)
 * - Confidence-based insights
 * - Business language
 */

// ===========================
// Confidence Mode System
// ===========================

/**
 * Confidence modes based on execution count
 * - observation: 1 run (describe only, no trends)
 * - early_signals: 2-3 runs ("possible", "may" language)
 * - emerging_patterns: 4-10 runs ("appears", "likely" language)
 * - confirmed: 10+ runs (full recommendations, trends)
 */
export type ConfidenceMode = 'observation' | 'early_signals' | 'emerging_patterns' | 'confirmed';

/**
 * Confidence thresholds configuration
 */
export interface ConfidenceThresholds {
  early_signals_threshold: number;      // Default: 2
  emerging_patterns_threshold: number;  // Default: 4
  confirmed_threshold: number;          // Default: 10
}

// ===========================
// Insight Types
// ===========================

/**
 * Three categories of insights:
 * 1. Data Quality - Fix problems (empty results, malformed data, missing fields)
 * 2. Growth - Improve business (automation, cost, performance, reliability)
 * 3. Business Intelligence - Understand business trends (volume, patterns, operational health)
 */
export type InsightCategory = 'data_quality' | 'growth' | 'business_intelligence';

/**
 * Specific insight types
 */
export type InsightType =
  // Data Quality Insights
  | 'data_unavailable'       // Empty results, missing data
  | 'data_malformed'         // Unexpected structure
  | 'data_missing_fields'    // Required fields not present
  | 'data_type_mismatch'     // Wrong data type
  | 'data_validation_failed' // Schema validation errors
  // Growth Insights
  | 'automation_opportunity' // High manual approval rate
  | 'cost_optimization'      // High token usage, caching opportunities
  | 'performance_degradation'// Slower than historical average
  | 'reliability_risk'       // No fallback, single point of failure
  | 'schedule_optimization'  // Better timing for execution
  | 'scale_opportunity'      // Could process more items
  // Business Intelligence Insights
  | 'volume_trend'           // Volume changes (increases/decreases)
  | 'category_shift'         // Distribution changes (field presence)
  | 'performance_issue'      // Duration degradation
  | 'operational_anomaly';   // Spikes, drops, unusual patterns

/**
 * Insight severity levels
 */
export type InsightSeverity = 'low' | 'medium' | 'high' | 'critical';

/**
 * Insight lifecycle status
 */
export type InsightStatus = 'new' | 'viewed' | 'applied' | 'dismissed' | 'snoozed';

// ===========================
// Core Data Structures
// ===========================

/**
 * Main insight record stored in database
 */
export interface ExecutionInsight {
  // Basic identification
  id: string;
  user_id: string;
  agent_id: string;
  execution_ids: string[];  // Multiple executions may contribute to one insight

  // Classification
  insight_type: InsightType;
  category: InsightCategory;
  severity: InsightSeverity;
  confidence: ConfidenceMode | number;  // ConfidenceMode for technical, 0.0-1.0 for business

  // Content (business language)
  title: string;
  description: string;
  business_impact: string;
  recommendation: string;

  // Supporting data (metadata only - NO client data)
  pattern_data: PatternData;
  metrics: InsightMetrics;

  // Lifecycle
  status: InsightStatus;
  snoozed_until?: string;  // ISO timestamp
  created_at: string;
  updated_at: string;
  viewed_at?: string;
  applied_at?: string;
}

/**
 * Pattern-specific metadata (varies by insight type)
 * NEVER contains client data - only structural information
 */
export interface PatternData {
  occurrences: number;              // How many times pattern occurred
  affected_steps: string[];         // Step IDs where pattern appears
  sample_data?: {
    // Structural info only
    result_count?: number;
    expected_field?: string;
    field_type?: string;
    actual_type?: string;
    step_name?: string;
    [key: string]: any;
  };
}

/**
 * Aggregate metrics for insight
 */
export interface InsightMetrics {
  total_executions: number;
  affected_executions: number;
  pattern_frequency: number;         // 0-1 (percentage)
  avg_duration_ms?: number;
  avg_token_usage?: number;
  avg_cost?: number;
  first_occurrence?: string;         // ISO timestamp
  last_occurrence?: string;          // ISO timestamp
}

/**
 * Execution summary for pattern detection
 * This is the input to insight generation - contains ONLY metadata
 */
export interface ExecutionSummary {
  execution_id: string;
  agent_id: string;
  status: 'success' | 'failed' | 'timeout';
  started_at: string;
  completed_at?: string;
  duration_ms?: number;

  // Step-level metadata
  steps: StepSummary[];

  // Aggregate metrics
  total_steps: number;
  steps_completed: number;
  steps_failed: number;
  steps_skipped: number;
  total_token_usage?: number;
  total_cost?: number;

  // Pattern indicators (NO client data)
  empty_result_steps: string[];      // Steps that returned 0 results
  slow_steps: string[];              // Steps slower than average
  high_token_steps: string[];        // Steps with high token usage
  failed_without_fallback: string[]; // Failed steps with no fallback
}

/**
 * Individual step metadata
 */
export interface StepSummary {
  step_id: string;
  step_name: string;
  step_type: string;
  status: 'success' | 'failed' | 'skipped';
  duration_ms?: number;
  token_usage?: number;
  error_type?: string;               // Error category (NOT error message)

  // Structural indicators
  result_count?: number;             // How many items returned (NOT the items)
  field_names?: string[];            // Field names present (NOT values)
  has_fallback: boolean;
  fallback_used: boolean;
}

/**
 * Pattern detector result
 */
export interface DetectedPattern {
  insight_type: InsightType;
  category: InsightCategory;         // Data quality or growth
  severity: InsightSeverity;
  confidence_score: number;          // 0-1
  execution_ids: string[];           // Executions where pattern was detected
  pattern_data: PatternData;
  metrics: InsightMetrics;
  trend?: 'increasing' | 'stable' | 'decreasing'; // Pattern trend over time
}

/**
 * Input to insight generator (AI)
 */
// Removed InsightGenerationInput and GeneratedInsight - no longer needed
// InsightGenerator.ts deleted - using only BusinessInsightGenerator now
