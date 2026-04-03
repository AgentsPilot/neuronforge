/**
 * Insight Analyzer
 *
 * Main orchestrator for insight generation:
 * 1. Fetches execution history for the agent
 * 2. Calculates confidence mode based on run count
 * 3. Runs pattern detectors on execution metadata
 * 4. Filters patterns by confidence threshold
 * 5. Returns detected patterns with confidence scores
 *
 * This is the entry point for insight generation from WorkflowPilot.
 */

import { SupabaseClient } from '@supabase/supabase-js';
import { DetectedPattern, ExecutionSummary, ConfidenceMode, StepSummary } from './types';
import { calculateConfidenceMode, getConfidenceScore } from './ConfidenceCalculator';
import { DataQualityDetector } from './detectors/DataQualityDetector';
import { CostDetector } from './detectors/CostDetector';
import { AutomationDetector } from './detectors/AutomationDetector';
import { ReliabilityDetector } from './detectors/ReliabilityDetector';
import { TrendAnalyzer } from './TrendAnalyzer';
import { BusinessInsightGenerator, type BusinessInsight } from './BusinessInsightGenerator';

export class InsightAnalyzer {
  private dataQualityDetector: DataQualityDetector;
  private costDetector: CostDetector;
  private automationDetector: AutomationDetector;
  private reliabilityDetector: ReliabilityDetector;

  constructor(private supabase: SupabaseClient) {
    this.dataQualityDetector = new DataQualityDetector();
    this.costDetector = new CostDetector();
    this.automationDetector = new AutomationDetector();
    this.reliabilityDetector = new ReliabilityDetector();
  }

  /**
   * Analyze executions and detect patterns
   *
   * @param agentId - Agent to analyze
   * @param limit - How many recent executions to analyze (default: 20)
   * @returns Detected patterns with confidence scores AND business insights
   */
  async analyze(agentId: string, limit: number = 20): Promise<{
    patterns: DetectedPattern[];
    businessInsights: BusinessInsight[];
    confidence_mode: ConfidenceMode;
    execution_count: number;
  }> {
    // 1. Fetch execution history
    const executionSummaries = await this.fetchExecutionSummaries(agentId, limit);

    if (executionSummaries.length === 0) {
      return {
        patterns: [],
        businessInsights: [],
        confidence_mode: 'observation',
        execution_count: 0,
      };
    }

    // 2. Calculate confidence mode based on run count
    const confidence_mode = calculateConfidenceMode(executionSummaries.length);

    // 3. Run all pattern detectors (technical insights)
    const allPatterns: DetectedPattern[] = [
      ...this.dataQualityDetector.detect(executionSummaries),
      ...this.costDetector.detect(executionSummaries),
      ...this.automationDetector.detect(executionSummaries),
      ...this.reliabilityDetector.detect(executionSummaries),
    ];

    // 4. Filter patterns by minimum confidence threshold
    const minConfidenceScore = this.getMinConfidenceThreshold(confidence_mode);
    const filteredPatterns = allPatterns.filter(
      (pattern) => pattern.confidence_score >= minConfidenceScore
    );

    // 5. Sort by severity and confidence
    const sortedPatterns = filteredPatterns.sort((a, b) => {
      // Sort by severity first (critical > high > medium > low)
      const severityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
      const severityDiff = severityOrder[a.severity] - severityOrder[b.severity];
      if (severityDiff !== 0) return severityDiff;

      // Then by confidence score
      return b.confidence_score - a.confidence_score;
    });

    // 6. Generate unified insights using BusinessInsightGenerator (from execution #1)
    let businessInsights: BusinessInsight[] = [];

    try {
      // Fetch agent details for workflow context
      const { data: agent } = await this.supabase
        .from('agents')
        .select('id, agent_name, description, workflow_purpose, created_from_prompt')
        .eq('id', agentId)
        .single();

      if (!agent) {
        console.error('[InsightAnalyzer] Failed to fetch agent details');
        return {
          patterns: sortedPatterns,
          businessInsights: [],
          confidence_mode,
          execution_count: executionSummaries.length,
        };
      }

      const businessGenerator = new BusinessInsightGenerator(this.supabase);

      // Generate insights based on data availability
      if (executionSummaries.length >= 7) {
        // 7+ executions: Use trend analysis + detected patterns
        const trendAnalyzer = new TrendAnalyzer(this.supabase);
        const trends = await trendAnalyzer.analyzeTrends(agentId);

        if (trends) {
          // Fetch recent metrics for LLM context
          const { data: recentMetrics } = await this.supabase
            .from('execution_metrics')
            .select('*')
            .eq('agent_id', agentId)
            .order('executed_at', { ascending: false })
            .limit(30);

          if (recentMetrics && recentMetrics.length > 0) {
            businessInsights = await businessGenerator.generate(
              agent,
              trends,
              recentMetrics as any,
              sortedPatterns  // Pass detected technical patterns
            );

            console.log(`[InsightAnalyzer] Generated ${businessInsights.length} insights (trends + patterns) for agent ${agentId}`);
          }
        }
      } else {
        // 1-6 executions: Use only detected patterns (no trends yet)
        businessInsights = await businessGenerator.generateFromPatterns(
          agent,
          sortedPatterns,
          confidence_mode,
          executionSummaries.length
        );

        console.log(`[InsightAnalyzer] Generated ${businessInsights.length} insights (patterns only) for agent ${agentId}`);
      }
    } catch (error) {
      // Non-fatal - insights are optional
      console.error('[InsightAnalyzer] Failed to generate insights (non-fatal):', error);
    }

    return {
      patterns: sortedPatterns,
      businessInsights,
      confidence_mode,
      execution_count: executionSummaries.length,
    };
  }

  /**
   * Fetch recent execution summaries for an agent
   * Converts execution records to ExecutionSummary format (metadata only)
   *
   * IMPORTANT: Fetches BOTH successful AND failed executions to capture all error patterns
   * (e.g., spreadsheet name changes, missing data sources, etc.)
   */
  private async fetchExecutionSummaries(
    agentId: string,
    limit: number
  ): Promise<ExecutionSummary[]> {
    // Fetch ALL recent executions (success, failed, timeout)
    // This allows us to detect all types of failures generically
    const { data: executions, error } = await this.supabase
      .from('workflow_executions')
      .select(
        `
        id,
        agent_id,
        status,
        started_at,
        completed_at,
        total_execution_time_ms,
        execution_trace
      `
      )
      .eq('agent_id', agentId)
      .in('status', ['success', 'completed', 'failed', 'timeout']) // Include all execution outcomes
      .order('started_at', { ascending: false })
      .limit(limit);

    if (error) {
      console.error('[InsightAnalyzer] Failed to fetch executions:', error);
      return [];
    }

    if (!executions || executions.length === 0) {
      return [];
    }

    // Convert to ExecutionSummary format
    const summaries: ExecutionSummary[] = executions.map((exec) =>
      this.convertToExecutionSummary(exec)
    );

    return summaries;
  }

  /**
   * Convert execution record to ExecutionSummary (metadata extraction)
   * CRITICAL: NEVER include client data, only structural metadata
   */
  private convertToExecutionSummary(execution: any): ExecutionSummary {
    // Use execution_trace instead of logs (column name mismatch)
    const trace = execution.execution_trace || execution.logs || {};
    const pilotLogs = trace.pilot || {};

    // Extract step summaries from pilot logs
    const steps: StepSummary[] = this.extractStepSummaries(pilotLogs);

    // Extract metadata indicators
    const emptyResultSteps: string[] = [];
    const slowSteps: string[] = [];
    const highTokenSteps: string[] = [];
    const failedWithoutFallback: string[] = [];

    // Analyze each step for patterns
    for (const step of steps) {
      // Empty results
      if (step.result_count === 0) {
        emptyResultSteps.push(step.step_id);
      }

      // Slow steps (>10s)
      if (step.duration_ms && step.duration_ms > 10000) {
        slowSteps.push(step.step_id);
      }

      // High token usage (>1000)
      if (step.token_usage && step.token_usage > 1000) {
        highTokenSteps.push(step.step_id);
      }

      // Failed without fallback
      if (step.status === 'failed' && !step.has_fallback) {
        failedWithoutFallback.push(step.step_id);
      }
    }

    const summary: ExecutionSummary = {
      execution_id: execution.id,
      agent_id: execution.agent_id || '',
      status: execution.status,
      started_at: execution.started_at,
      completed_at: execution.completed_at,
      duration_ms: execution.total_execution_time_ms,

      steps,

      total_steps: steps.length,
      steps_completed: steps.filter((s) => s.status === 'success').length,
      steps_failed: steps.filter((s) => s.status === 'failed').length,
      steps_skipped: steps.filter((s) => s.status === 'skipped').length,

      // Pattern indicators
      empty_result_steps: emptyResultSteps,
      slow_steps: slowSteps,
      high_token_steps: highTokenSteps,
      failed_without_fallback: failedWithoutFallback,
    };

    return summary;
  }

  /**
   * Extract step summaries from pilot logs
   */
  private extractStepSummaries(pilotLogs: any): StepSummary[] {
    const steps: StepSummary[] = [];

    // Pilot logs should have a steps array
    if (!pilotLogs.steps || !Array.isArray(pilotLogs.steps)) {
      return steps;
    }

    for (const stepLog of pilotLogs.steps) {
      const stepSummary: StepSummary = {
        step_id: stepLog.step_id || stepLog.id || 'unknown',
        step_name: stepLog.step_name || stepLog.name || 'unknown',
        step_type: stepLog.step_type || stepLog.type || 'unknown',
        status: stepLog.status || 'unknown',
        duration_ms: stepLog.duration_ms,
        token_usage: stepLog.token_usage,
        error_type: stepLog.error_type,

        // Structural indicators (NO client data)
        result_count: this.extractResultCount(stepLog),
        field_names: this.extractFieldNames(stepLog),
        has_fallback: stepLog.has_fallback || false,
        fallback_used: stepLog.fallback_used || false,
      };

      steps.push(stepSummary);
    }

    return steps;
  }

  /**
   * Extract result count from step log (metadata only)
   */
  private extractResultCount(stepLog: any): number | undefined {
    // Check if output is an array
    if (stepLog.output && Array.isArray(stepLog.output)) {
      return stepLog.output.length;
    }

    // Check metadata
    if (stepLog.metadata && typeof stepLog.metadata.result_count === 'number') {
      return stepLog.metadata.result_count;
    }

    return undefined;
  }

  /**
   * Extract field names from step output (structure only, NO values)
   */
  private extractFieldNames(stepLog: any): string[] | undefined {
    if (stepLog.output && typeof stepLog.output === 'object' && !Array.isArray(stepLog.output)) {
      return Object.keys(stepLog.output);
    }

    return undefined;
  }

  /**
   * Get minimum confidence threshold based on confidence mode
   * Higher modes require stronger patterns
   */
  private getMinConfidenceThreshold(mode: ConfidenceMode): number {
    const thresholds: Record<ConfidenceMode, number> = {
      observation: 0.0, // Show everything for first run
      early_signals: 0.2, // 20% frequency minimum
      emerging_patterns: 0.3, // 30% frequency minimum
      confirmed: 0.4, // 40% frequency minimum
    };

    return thresholds[mode];
  }
}
