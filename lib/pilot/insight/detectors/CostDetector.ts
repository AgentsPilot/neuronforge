/**
 * Cost Detector
 *
 * Detects cost optimization opportunities:
 * - High token usage patterns
 * - Expensive steps that could be cached
 * - Redundant API calls
 * - Schedule optimization opportunities
 *
 * Category: growth
 * Insight Types: cost_optimization, schedule_optimization
 */

import {
  DetectedPattern,
  ExecutionSummary,
  InsightSeverity,
  PatternData,
  InsightMetrics,
} from '../types';

export class CostDetector {
  // Token usage thresholds (configurable)
  private readonly HIGH_TOKEN_THRESHOLD = 5000; // Per execution
  private readonly HIGH_TOKEN_STEP_THRESHOLD = 2000; // Per step

  /**
   * Detect cost-related patterns across execution summaries
   */
  detect(executions: ExecutionSummary[]): DetectedPattern[] {
    const patterns: DetectedPattern[] = [];

    // Pattern 1: High Token Usage
    const highTokenPattern = this.detectHighTokenUsage(executions);
    if (highTokenPattern) {
      patterns.push(highTokenPattern);
    }

    // Pattern 2: Schedule Optimization
    const schedulePattern = this.detectScheduleOptimization(executions);
    if (schedulePattern) {
      patterns.push(schedulePattern);
    }

    return patterns;
  }

  /**
   * Detect high token usage that could be optimized
   */
  private detectHighTokenUsage(executions: ExecutionSummary[]): DetectedPattern | null {
    const highTokenExecutions: ExecutionSummary[] = [];
    const expensiveSteps = new Map<string, { count: number; avgTokens: number }>();

    for (const exec of executions) {
      // Check overall execution token usage
      if (exec.total_token_usage && exec.total_token_usage > this.HIGH_TOKEN_THRESHOLD) {
        highTokenExecutions.push(exec);
      }

      // Track expensive steps
      for (const stepId of exec.high_token_steps) {
        const step = exec.steps.find((s) => s.step_id === stepId);
        if (step && step.token_usage) {
          const existing = expensiveSteps.get(stepId) || { count: 0, avgTokens: 0 };
          existing.count += 1;
          existing.avgTokens =
            (existing.avgTokens * (existing.count - 1) + step.token_usage) / existing.count;
          expensiveSteps.set(stepId, existing);
        }
      }
    }

    // Threshold: At least 3 executions with high token usage
    if (highTokenExecutions.length < 3) {
      return null;
    }

    const frequency = highTokenExecutions.length / executions.length;

    // Calculate average token usage
    const avgTokenUsage =
      highTokenExecutions.reduce((sum, exec) => sum + (exec.total_token_usage || 0), 0) /
      highTokenExecutions.length;

    // Determine severity based on token usage
    let severity: InsightSeverity;
    if (avgTokenUsage > 10000) {
      severity = 'high'; // Very expensive
    } else if (avgTokenUsage > 7500) {
      severity = 'medium';
    } else {
      severity = 'low';
    }

    // Identify top expensive steps
    const topExpensiveSteps = Array.from(expensiveSteps.entries())
      .filter(([_, data]) => data.count >= 2) // Step appeared in 2+ executions
      .sort((a, b) => b[1].avgTokens - a[1].avgTokens)
      .slice(0, 3)
      .map(([stepId, _]) => stepId);

    const patternData: PatternData = {
      occurrences: highTokenExecutions.length,
      affected_steps: topExpensiveSteps,
      sample_data: {
        avg_token_usage: Math.round(avgTokenUsage),
        high_token_threshold: this.HIGH_TOKEN_THRESHOLD,
        potential_savings_percent: 30, // Estimate (caching could save ~30%)
      },
    };

    const metrics: InsightMetrics = {
      total_executions: executions.length,
      affected_executions: highTokenExecutions.length,
      pattern_frequency: frequency,
      avg_token_usage: avgTokenUsage,
      first_occurrence: highTokenExecutions[0]?.started_at,
      last_occurrence: highTokenExecutions[highTokenExecutions.length - 1]?.started_at,
    };

    return {
      insight_type: 'cost_optimization',
      category: 'growth',
      severity,
      confidence_score: frequency,
      execution_ids: highTokenExecutions.map(e => e.execution_id),
      pattern_data: patternData,
      metrics,
    };
  }

  /**
   * Detect schedule optimization opportunities
   * Example: Agent runs every hour but only has work 3 times per day
   */
  private detectScheduleOptimization(executions: ExecutionSummary[]): DetectedPattern | null {
    // Need at least 10 executions to detect schedule patterns
    if (executions.length < 10) {
      return null;
    }

    // Analyze execution timestamps to find patterns
    const executionsByHour: Record<number, number> = {};
    const executionsByDayOfWeek: Record<number, number> = {};

    for (const exec of executions) {
      const date = new Date(exec.started_at);
      const hour = date.getHours();
      const dayOfWeek = date.getDay();

      executionsByHour[hour] = (executionsByHour[hour] || 0) + 1;
      executionsByDayOfWeek[dayOfWeek] = (executionsByDayOfWeek[dayOfWeek] || 0) + 1;
    }

    // Find peak hours (hours with most executions)
    const peakHours = Object.entries(executionsByHour)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([hour, _]) => parseInt(hour));

    // Check if executions are concentrated in specific hours
    const totalInPeakHours = peakHours.reduce((sum, hour) => sum + executionsByHour[hour], 0);
    const concentrationRatio = totalInPeakHours / executions.length;

    // If 60%+ of executions happen in 3 hours, suggest schedule optimization
    if (concentrationRatio >= 0.6) {
      const patternData: PatternData = {
        occurrences: executions.length,
        affected_steps: [], // Affects overall schedule, not specific steps
        sample_data: {
          peak_hours: peakHours,
          concentration_ratio: Math.round(concentrationRatio * 100),
          recommendation: 'Schedule during peak activity hours only',
        },
      };

      const metrics: InsightMetrics = {
        total_executions: executions.length,
        affected_executions: executions.length,
        pattern_frequency: concentrationRatio,
        first_occurrence: executions[0]?.started_at,
        last_occurrence: executions[executions.length - 1]?.started_at,
      };

      return {
        insight_type: 'schedule_optimization',
        category: 'growth',
        severity: 'low', // Optimization, not a problem
        confidence_score: concentrationRatio,
        execution_ids: executions.map(e => e.execution_id),
        pattern_data: patternData,
        metrics,
      };
    }

    return null;
  }
}
