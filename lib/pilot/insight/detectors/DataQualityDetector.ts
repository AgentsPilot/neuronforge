/**
 * Data Quality Detector
 *
 * Detects data quality issues in production executions:
 * - Empty results (e.g., Gmail search returns 0 emails)
 * - Missing fields
 * - Data shape mismatches
 * - High empty result rate
 *
 * Category: data_quality
 * Insight Types: data_unavailable, data_malformed, data_missing_fields, data_type_mismatch
 */

import {
  DetectedPattern,
  ExecutionSummary,
  InsightType,
  InsightSeverity,
  PatternData,
  InsightMetrics,
} from '../types';

export class DataQualityDetector {
  /**
   * Detect data quality patterns across execution summaries
   */
  detect(executions: ExecutionSummary[]): DetectedPattern[] {
    const patterns: DetectedPattern[] = [];

    // Pattern 1: Empty Results (data_unavailable)
    const emptyResultPattern = this.detectEmptyResults(executions);
    if (emptyResultPattern) {
      patterns.push(emptyResultPattern);
    }

    // Pattern 2: Missing Fields (data_missing_fields)
    const missingFieldsPattern = this.detectMissingFields(executions);
    if (missingFieldsPattern) {
      patterns.push(missingFieldsPattern);
    }

    // Pattern 3: Type Mismatches (data_type_mismatch)
    const typeMismatchPattern = this.detectTypeMismatches(executions);
    if (typeMismatchPattern) {
      patterns.push(typeMismatchPattern);
    }

    return patterns;
  }

  /**
   * Detect workflows returning empty results
   * Example: Gmail search consistently returns 0 emails
   */
  private detectEmptyResults(executions: ExecutionSummary[]): DetectedPattern | null {
    const emptyResultExecutions: ExecutionSummary[] = [];
    const affectedSteps = new Set<string>();

    for (const exec of executions) {
      if (exec.empty_result_steps.length > 0) {
        emptyResultExecutions.push(exec);
        exec.empty_result_steps.forEach((step) => affectedSteps.add(step));
      }
    }

    // Threshold: At least 2 executions with empty results
    if (emptyResultExecutions.length < 2) {
      return null;
    }

    const frequency = emptyResultExecutions.length / executions.length;

    // Calculate severity based on frequency
    let severity: InsightSeverity;
    if (frequency >= 0.8) {
      severity = 'critical'; // 80%+ empty results
    } else if (frequency >= 0.5) {
      severity = 'high'; // 50-80% empty results
    } else if (frequency >= 0.3) {
      severity = 'medium'; // 30-50% empty results
    } else {
      severity = 'low'; // < 30% empty results
    }

    // Build pattern data (metadata only - NO client data)
    const patternData: PatternData = {
      occurrences: emptyResultExecutions.length,
      affected_steps: Array.from(affectedSteps),
      sample_data: {
        result_count: 0,
        expected_field: 'results',
        field_type: 'array',
        // Include step name from first affected execution for context
        step_name: emptyResultExecutions[0]?.empty_result_steps[0] || 'unknown',
      },
    };

    const metrics: InsightMetrics = {
      total_executions: executions.length,
      affected_executions: emptyResultExecutions.length,
      pattern_frequency: frequency,
      first_occurrence: emptyResultExecutions[0]?.started_at,
      last_occurrence:
        emptyResultExecutions[emptyResultExecutions.length - 1]?.started_at,
    };

    return {
      insight_type: 'data_unavailable',
      category: 'data_quality',
      severity,
      confidence_score: frequency, // Higher frequency = higher confidence
      execution_ids: emptyResultExecutions.map(e => e.execution_id),
      pattern_data: patternData,
      metrics,
    };
  }

  /**
   * Detect missing expected fields
   * Example: step1.data.contacts doesn't exist, but step1.data.records does
   */
  private detectMissingFields(executions: ExecutionSummary[]): DetectedPattern | null {
    const fieldMissingExecutions: ExecutionSummary[] = [];
    const affectedSteps = new Set<string>();
    const missingFields: Record<string, number> = {};

    for (const exec of executions) {
      for (const step of exec.steps) {
        // Look for steps with field_names metadata
        if (step.field_names && step.field_names.length === 0 && step.status === 'success') {
          fieldMissingExecutions.push(exec);
          affectedSteps.add(step.step_id);

          // Track which fields are missing (this would come from error metadata in real implementation)
          const fieldKey = `${step.step_id}:expected_field`;
          missingFields[fieldKey] = (missingFields[fieldKey] || 0) + 1;
        }
      }
    }

    // Threshold: At least 2 executions
    if (fieldMissingExecutions.length < 2) {
      return null;
    }

    const frequency = fieldMissingExecutions.length / executions.length;

    let severity: InsightSeverity;
    if (frequency >= 0.7) {
      severity = 'high';
    } else if (frequency >= 0.4) {
      severity = 'medium';
    } else {
      severity = 'low';
    }

    const patternData: PatternData = {
      occurrences: fieldMissingExecutions.length,
      affected_steps: Array.from(affectedSteps),
      sample_data: {
        missing_fields: Object.keys(missingFields),
      },
    };

    const metrics: InsightMetrics = {
      total_executions: executions.length,
      affected_executions: fieldMissingExecutions.length,
      pattern_frequency: frequency,
      first_occurrence: fieldMissingExecutions[0]?.started_at,
      last_occurrence:
        fieldMissingExecutions[fieldMissingExecutions.length - 1]?.started_at,
    };

    return {
      insight_type: 'data_missing_fields',
      category: 'data_quality',
      severity,
      confidence_score: frequency,
      execution_ids: fieldMissingExecutions.map(e => e.execution_id),
      pattern_data: patternData,
      metrics,
    };
  }

  /**
   * Detect data type mismatches
   * Example: Expected object but got array
   */
  private detectTypeMismatches(executions: ExecutionSummary[]): DetectedPattern | null {
    // This would be implemented based on actual execution metadata
    // For now, we'll return null as we need specific type tracking in ExecutionContext
    // TODO: Implement when ExecutionContext tracks type information

    return null;
  }
}
