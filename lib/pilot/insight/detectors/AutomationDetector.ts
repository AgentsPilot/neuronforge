/**
 * Automation Detector
 *
 * Detects automation improvement opportunities:
 * - High manual approval rates
 * - Patterns that could be auto-approved
 * - Repetitive human interventions
 *
 * Category: growth
 * Insight Type: automation_opportunity
 */

import {
  DetectedPattern,
  ExecutionSummary,
  InsightSeverity,
  PatternData,
  InsightMetrics,
} from '../types';

export class AutomationDetector {
  /**
   * Detect automation opportunities across execution summaries
   */
  detect(executions: ExecutionSummary[]): DetectedPattern[] {
    const patterns: DetectedPattern[] = [];

    // Pattern 1: High Manual Approval Rate
    const manualApprovalPattern = this.detectManualApprovals(executions);
    if (manualApprovalPattern) {
      patterns.push(manualApprovalPattern);
    }

    return patterns;
  }

  /**
   * Detect high manual approval rates that could be automated
   * Example: User manually approves 80% of similar operations
   */
  private detectManualApprovals(executions: ExecutionSummary[]): DetectedPattern | null {
    // This detector needs manual approval tracking in ExecutionContext
    // For now, we'll analyze execution patterns that might indicate manual work

    // Look for executions with pauses (indicating manual review)
    // This would be tracked via a "paused_for_approval" flag in ExecutionContext
    const executionsWithManualWork: ExecutionSummary[] = [];
    const manualSteps = new Set<string>();

    for (const exec of executions) {
      // Check for steps that might indicate manual work
      // In real implementation, this would check for approval steps or pauses
      const hasManualWork = exec.steps.some(
        (step) =>
          step.step_type.includes('approval') ||
          step.step_type.includes('review') ||
          step.step_type.includes('manual')
      );

      if (hasManualWork) {
        executionsWithManualWork.push(exec);
        exec.steps
          .filter(
            (s) =>
              s.step_type.includes('approval') ||
              s.step_type.includes('review') ||
              s.step_type.includes('manual')
          )
          .forEach((s) => manualSteps.add(s.step_id));
      }
    }

    // Need at least 5 executions to detect pattern
    if (executionsWithManualWork.length < 5) {
      return null;
    }

    const frequency = executionsWithManualWork.length / executions.length;

    // Threshold: If 50%+ executions require manual work, suggest automation
    if (frequency < 0.5) {
      return null;
    }

    // Determine severity based on frequency
    let severity: InsightSeverity;
    if (frequency >= 0.8) {
      severity = 'high'; // 80%+ require manual work
    } else if (frequency >= 0.6) {
      severity = 'medium'; // 60-80%
    } else {
      severity = 'low'; // 50-60%
    }

    const patternData: PatternData = {
      occurrences: executionsWithManualWork.length,
      affected_steps: Array.from(manualSteps),
      sample_data: {
        manual_approval_rate: Math.round(frequency * 100),
        automation_potential_percent: 70, // Estimate
        recommendation: 'Consider adding auto-approval rules for common patterns',
      },
    };

    const metrics: InsightMetrics = {
      total_executions: executions.length,
      affected_executions: executionsWithManualWork.length,
      pattern_frequency: frequency,
      first_occurrence: executionsWithManualWork[0]?.started_at,
      last_occurrence:
        executionsWithManualWork[executionsWithManualWork.length - 1]?.started_at,
    };

    return {
      insight_type: 'automation_opportunity',
      category: 'growth',
      severity,
      confidence_score: frequency,
      execution_ids: executionsWithManualWork.map(e => e.execution_id),
      pattern_data: patternData,
      metrics,
    };
  }
}
