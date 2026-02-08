/**
 * Reliability Detector
 *
 * Detects reliability risks:
 * - Missing fallback mechanisms
 * - Single points of failure
 * - Steps with high failure rates
 * - Performance degradation
 *
 * Category: growth
 * Insight Types: reliability_risk, performance_degradation
 */

import {
  DetectedPattern,
  ExecutionSummary,
  InsightSeverity,
  PatternData,
  InsightMetrics,
} from '../types';

export class ReliabilityDetector {
  // Performance thresholds (configurable)
  private readonly SLOW_DURATION_MS = 30000; // 30 seconds
  private readonly DEGRADATION_THRESHOLD = 1.5; // 50% slower than average

  /**
   * Detect reliability patterns across execution summaries
   */
  detect(executions: ExecutionSummary[]): DetectedPattern[] {
    const patterns: DetectedPattern[] = [];

    // Pattern 1: Generic Execution Failures (CRITICAL - captures ALL errors)
    const genericFailurePattern = this.detectGenericFailures(executions);
    if (genericFailurePattern) {
      patterns.push(genericFailurePattern);
    }

    // Pattern 2: Missing Fallbacks
    const missingFallbackPattern = this.detectMissingFallbacks(executions);
    if (missingFallbackPattern) {
      patterns.push(missingFallbackPattern);
    }

    // Pattern 3: Performance Degradation
    const degradationPattern = this.detectPerformanceDegradation(executions);
    if (degradationPattern) {
      patterns.push(degradationPattern);
    }

    return patterns;
  }

  /**
   * Detect generic execution failures
   * This captures ALL failed executions regardless of cause (e.g., spreadsheet name changes,
   * missing data sources, API errors, etc.)
   *
   * CRITICAL: This is the primary failure detector - alerts users to any execution failures
   */
  private detectGenericFailures(executions: ExecutionSummary[]): DetectedPattern | null {
    const failedExecutions = executions.filter((exec) => exec.status === 'failed' || exec.status === 'timeout');

    // Threshold: At least 1 failed execution warrants investigation
    if (failedExecutions.length === 0) {
      return null;
    }

    const frequency = failedExecutions.length / executions.length;

    // Determine severity based on failure rate
    let severity: InsightSeverity;
    if (frequency >= 0.5) {
      severity = 'critical'; // 50%+ failure rate
    } else if (frequency >= 0.3) {
      severity = 'high'; // 30-50% failure rate
    } else if (frequency >= 0.15) {
      severity = 'medium'; // 15-30% failure rate
    } else {
      severity = 'low'; // < 15% failure rate
    }

    // Collect affected steps across all failures
    const affectedSteps = new Set<string>();
    const errorTypes = new Set<string>();

    for (const exec of failedExecutions) {
      for (const step of exec.steps) {
        if (step.status === 'failed') {
          affectedSteps.add(step.step_id);
          if (step.error_type) {
            errorTypes.add(step.error_type);
          }
        }
      }
    }

    const patternData: PatternData = {
      occurrences: failedExecutions.length,
      affected_steps: Array.from(affectedSteps),
      sample_data: {
        failure_rate: Math.round(frequency * 100),
        total_failures: failedExecutions.length,
        total_executions: executions.length,
        error_types: Array.from(errorTypes),
        most_recent_failure: failedExecutions[0]?.started_at,
      },
    };

    const metrics: InsightMetrics = {
      total_executions: executions.length,
      affected_executions: failedExecutions.length,
      pattern_frequency: frequency,
      first_occurrence: failedExecutions[failedExecutions.length - 1]?.started_at,
      last_occurrence: failedExecutions[0]?.started_at,
    };

    return {
      insight_type: 'reliability_risk',
      category: 'growth',
      severity,
      confidence_score: frequency, // Higher failure rate = higher confidence
      execution_ids: failedExecutions.map((e) => e.execution_id),
      pattern_data: patternData,
      metrics,
    };
  }

  /**
   * Detect steps that fail without fallback mechanisms
   */
  private detectMissingFallbacks(executions: ExecutionSummary[]): DetectedPattern | null {
    const failuresWithoutFallback: ExecutionSummary[] = [];
    const riskySteps = new Set<string>();

    for (const exec of executions) {
      for (const stepId of exec.failed_without_fallback) {
        failuresWithoutFallback.push(exec);
        riskySteps.add(stepId);
      }
    }

    // Threshold: At least 2 failures without fallback
    if (failuresWithoutFallback.length < 2) {
      return null;
    }

    const frequency = failuresWithoutFallback.length / executions.length;

    // Determine severity - missing fallbacks are serious
    let severity: InsightSeverity;
    if (frequency >= 0.3) {
      severity = 'critical'; // 30%+ executions affected
    } else if (frequency >= 0.15) {
      severity = 'high'; // 15-30%
    } else if (frequency >= 0.05) {
      severity = 'medium'; // 5-15%
    } else {
      severity = 'low'; // < 5%
    }

    const patternData: PatternData = {
      occurrences: failuresWithoutFallback.length,
      affected_steps: Array.from(riskySteps),
      sample_data: {
        failure_rate: Math.round(frequency * 100),
        missing_fallback_steps: Array.from(riskySteps),
        recommendation: 'Add fallback mechanisms for critical steps',
      },
    };

    const metrics: InsightMetrics = {
      total_executions: executions.length,
      affected_executions: failuresWithoutFallback.length,
      pattern_frequency: frequency,
      first_occurrence: failuresWithoutFallback[0]?.started_at,
      last_occurrence:
        failuresWithoutFallback[failuresWithoutFallback.length - 1]?.started_at,
    };

    return {
      insight_type: 'reliability_risk',
      category: 'growth',
      severity,
      confidence_score: frequency,
      execution_ids: failuresWithoutFallback.map(e => e.execution_id),
      pattern_data: patternData,
      metrics,
    };
  }

  /**
   * Detect performance degradation over time
   * Example: Workflow getting slower than historical average
   */
  private detectPerformanceDegradation(executions: ExecutionSummary[]): DetectedPattern | null {
    // Need at least 10 executions to detect trends
    if (executions.length < 10) {
      return null;
    }

    // Split into early and recent executions
    const splitPoint = Math.floor(executions.length * 0.5);
    const earlyExecutions = executions.slice(0, splitPoint);
    const recentExecutions = executions.slice(splitPoint);

    // Calculate average durations
    const earlyAvgDuration =
      earlyExecutions.reduce((sum, exec) => sum + (exec.duration_ms || 0), 0) /
      earlyExecutions.length;
    const recentAvgDuration =
      recentExecutions.reduce((sum, exec) => sum + (exec.duration_ms || 0), 0) /
      recentExecutions.length;

    // Check for degradation (recent is significantly slower than early)
    const degradationRatio = recentAvgDuration / earlyAvgDuration;

    if (degradationRatio < this.DEGRADATION_THRESHOLD) {
      return null; // No significant degradation
    }

    // Find which steps are getting slower
    const slowSteps = new Set<string>();
    for (const exec of recentExecutions) {
      for (const stepId of exec.slow_steps) {
        slowSteps.add(stepId);
      }
    }

    // Determine severity based on degradation
    let severity: InsightSeverity;
    if (degradationRatio >= 2.0) {
      severity = 'high'; // 2x slower
    } else if (degradationRatio >= 1.75) {
      severity = 'medium'; // 75% slower
    } else {
      severity = 'low'; // 50% slower
    }

    const patternData: PatternData = {
      occurrences: recentExecutions.length,
      affected_steps: Array.from(slowSteps),
      sample_data: {
        early_avg_duration_ms: Math.round(earlyAvgDuration),
        recent_avg_duration_ms: Math.round(recentAvgDuration),
        degradation_percent: Math.round((degradationRatio - 1) * 100),
        slow_steps: Array.from(slowSteps),
      },
    };

    const metrics: InsightMetrics = {
      total_executions: executions.length,
      affected_executions: recentExecutions.length,
      pattern_frequency: recentExecutions.length / executions.length,
      avg_duration_ms: recentAvgDuration,
      first_occurrence: recentExecutions[0]?.started_at,
      last_occurrence: recentExecutions[recentExecutions.length - 1]?.started_at,
    };

    return {
      insight_type: 'performance_degradation',
      category: 'growth',
      severity,
      confidence_score: Math.min(degradationRatio - 1, 1.0), // Cap at 1.0
      execution_ids: recentExecutions.map(e => e.execution_id),
      pattern_data: patternData,
      metrics,
    };
  }
}
