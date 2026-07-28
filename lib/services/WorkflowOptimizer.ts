/**
 * WorkflowOptimizer
 *
 * Analyzes execution patterns and generates optimization suggestions.
 * Uses baselines, anomalies, and historical patterns to recommend improvements.
 *
 * Part of Phase 6: Execution Optimization (Memory System Enhancement)
 *
 * @module lib/services/WorkflowOptimizer
 */

import { SupabaseClient } from '@supabase/supabase-js';
import { createLogger } from '@/lib/logger';
import { getBaselineService, ExecutionBaseline } from './BaselineService';
import { getAnomalyDetector, ExecutionAnomaly } from './AnomalyDetector';
import { getPluginPerformanceService, PluginMetrics } from './PluginPerformanceService';

const logger = createLogger({ service: 'WorkflowOptimizer' });

// ============ Types ============

export interface OptimizationSuggestion {
  type: OptimizationType;
  priority: 'low' | 'medium' | 'high';
  title: string;
  description: string;
  impact: string;
  actionable: boolean;
  metadata?: Record<string, unknown>;
}

export type OptimizationType =
  | 'reduce_token_usage'
  | 'improve_reliability'
  | 'speed_optimization'
  | 'error_prevention'
  | 'step_consolidation'
  | 'plugin_replacement'
  | 'caching_opportunity'
  | 'parallel_execution';

export interface OptimizationAnalysis {
  agentId: string;
  agentName?: string;
  analysisDate: string;
  overallScore: number; // 0-100
  suggestions: OptimizationSuggestion[];
  metrics: {
    avgDuration: number;
    avgTokens: number;
    successRate: number;
    anomalyCount: number;
  };
}

export interface WorkflowHealthScore {
  overall: number;
  reliability: number;
  efficiency: number;
  cost: number;
  breakdown: {
    factor: string;
    score: number;
    weight: number;
    notes: string;
  }[];
}

// ============ Service ============

export class WorkflowOptimizer {
  constructor(private supabase: SupabaseClient) {}

  /**
   * Analyze an agent's workflow and generate optimization suggestions
   *
   * @param agentId - Agent to analyze
   * @param userId - User ID for security
   */
  async analyzeWorkflow(agentId: string, userId: string): Promise<OptimizationAnalysis | null> {
    try {
      // Gather data
      const [baseline, anomalies, pluginMetrics] = await Promise.all([
        getBaselineService(this.supabase).getBaseline(agentId, userId),
        getAnomalyDetector(this.supabase).getUnresolvedAnomalies(agentId, userId),
        this.getAgentPluginMetrics(agentId, userId),
      ]);

      if (!baseline || baseline.sample_count < 5) {
        logger.debug({ agentId }, 'Insufficient data for optimization analysis');
        return null;
      }

      const suggestions = this.generateSuggestions(baseline, anomalies, pluginMetrics);
      const overallScore = this.calculateOverallScore(baseline, anomalies);

      return {
        agentId,
        analysisDate: new Date().toISOString(),
        overallScore,
        suggestions,
        metrics: {
          avgDuration: baseline.avg_duration_ms,
          avgTokens: baseline.avg_token_usage,
          successRate: baseline.success_rate,
          anomalyCount: anomalies.length,
        },
      };
    } catch (err) {
      logger.error({ err, agentId }, 'Failed to analyze workflow');
      return null;
    }
  }

  /**
   * Calculate workflow health score
   */
  async calculateHealthScore(agentId: string, userId: string): Promise<WorkflowHealthScore | null> {
    try {
      const baseline = await getBaselineService(this.supabase).getBaseline(agentId, userId);

      if (!baseline || baseline.sample_count < 5) {
        return null;
      }

      const breakdown: WorkflowHealthScore['breakdown'] = [];

      // Reliability (40% weight)
      const reliabilityScore = baseline.success_rate * 100;
      breakdown.push({
        factor: 'Success Rate',
        score: reliabilityScore,
        weight: 0.4,
        notes: `${(baseline.success_rate * 100).toFixed(1)}% success rate`,
      });

      // Efficiency - Duration (25% weight)
      // Score based on consistency (low stddev = good)
      const durationConsistency =
        baseline.stddev_duration_ms > 0
          ? Math.max(0, 100 - (baseline.stddev_duration_ms / baseline.avg_duration_ms) * 100)
          : 100;
      breakdown.push({
        factor: 'Duration Consistency',
        score: durationConsistency,
        weight: 0.25,
        notes: `${baseline.avg_duration_ms.toFixed(0)}ms ± ${baseline.stddev_duration_ms.toFixed(0)}ms`,
      });

      // Cost - Token Usage (25% weight)
      const tokenConsistency =
        baseline.stddev_token_usage > 0
          ? Math.max(0, 100 - (baseline.stddev_token_usage / baseline.avg_token_usage) * 100)
          : 100;
      breakdown.push({
        factor: 'Token Consistency',
        score: tokenConsistency,
        weight: 0.25,
        notes: `${baseline.avg_token_usage.toFixed(0)} ± ${baseline.stddev_token_usage.toFixed(0)} tokens`,
      });

      // Retry Rate (10% weight)
      const retryScore = Math.max(0, 100 - baseline.avg_retry_count * 20);
      breakdown.push({
        factor: 'Retry Rate',
        score: retryScore,
        weight: 0.1,
        notes: `${baseline.avg_retry_count.toFixed(1)} retries avg`,
      });

      // Calculate weighted scores
      const overall = breakdown.reduce((sum, b) => sum + b.score * b.weight, 0);

      return {
        overall: Math.round(overall),
        reliability: Math.round(reliabilityScore),
        efficiency: Math.round((durationConsistency + retryScore) / 2),
        cost: Math.round(tokenConsistency),
        breakdown,
      };
    } catch (err) {
      logger.error({ err, agentId }, 'Failed to calculate health score');
      return null;
    }
  }

  /**
   * Get optimization summary for all user agents
   */
  async getUserOptimizationSummary(userId: string): Promise<{
    totalAgents: number;
    needsAttention: number;
    topSuggestions: OptimizationSuggestion[];
    avgHealthScore: number;
  }> {
    try {
      const baselines = await getBaselineService(this.supabase).getUserBaselines(userId);

      if (baselines.length === 0) {
        return {
          totalAgents: 0,
          needsAttention: 0,
          topSuggestions: [],
          avgHealthScore: 0,
        };
      }

      const allSuggestions: OptimizationSuggestion[] = [];
      let totalScore = 0;
      let needsAttention = 0;

      for (const baseline of baselines) {
        const score = this.calculateOverallScore(baseline, []);
        totalScore += score;

        if (score < 70) {
          needsAttention++;
        }

        // Generate suggestions for each agent
        const suggestions = this.generateSuggestions(baseline, [], []);
        allSuggestions.push(...suggestions);
      }

      // Get top 5 most impactful suggestions
      const topSuggestions = allSuggestions
        .sort((a, b) => {
          const priorityOrder = { high: 3, medium: 2, low: 1 };
          return priorityOrder[b.priority] - priorityOrder[a.priority];
        })
        .slice(0, 5);

      return {
        totalAgents: baselines.length,
        needsAttention,
        topSuggestions,
        avgHealthScore: Math.round(totalScore / baselines.length),
      };
    } catch (err) {
      logger.error({ err }, 'Failed to get user optimization summary');
      return {
        totalAgents: 0,
        needsAttention: 0,
        topSuggestions: [],
        avgHealthScore: 0,
      };
    }
  }

  /**
   * Format suggestions for user display
   */
  formatSuggestionsForUser(suggestions: OptimizationSuggestion[]): string {
    if (suggestions.length === 0) {
      return '✅ No optimization suggestions at this time.';
    }

    const lines: string[] = ['💡 Optimization Suggestions:'];

    for (const suggestion of suggestions.slice(0, 5)) {
      const priorityIcon =
        suggestion.priority === 'high' ? '🔴' : suggestion.priority === 'medium' ? '🟡' : '🟢';

      lines.push(`${priorityIcon} ${suggestion.title}`);
      lines.push(`   ${suggestion.description}`);
      lines.push(`   Impact: ${suggestion.impact}`);
      lines.push('');
    }

    return lines.join('\n');
  }

  // ============ Private Methods ============

  /**
   * Get plugin metrics for an agent
   */
  private async getAgentPluginMetrics(
    agentId: string,
    userId: string
  ): Promise<PluginMetrics[]> {
    try {
      const service = getPluginPerformanceService(this.supabase);
      const { data } = await this.supabase
        .from('plugin_performance')
        .select('plugin, action')
        .eq('agent_id', agentId)
        .eq('user_id', userId);

      if (!data) return [];

      const metrics: PluginMetrics[] = [];
      for (const row of data) {
        const m = await service.getMetrics(agentId, userId, row.plugin, row.action);
        if (m) metrics.push(m);
      }

      return metrics;
    } catch {
      return [];
    }
  }

  /**
   * Generate optimization suggestions based on data
   */
  private generateSuggestions(
    baseline: ExecutionBaseline,
    anomalies: ExecutionAnomaly[],
    pluginMetrics: PluginMetrics[]
  ): OptimizationSuggestion[] {
    const suggestions: OptimizationSuggestion[] = [];

    // High retry rate
    if (baseline.avg_retry_count > 1.5) {
      suggestions.push({
        type: 'improve_reliability',
        priority: 'high',
        title: 'High Retry Rate',
        description: `This workflow averages ${baseline.avg_retry_count.toFixed(1)} retries per execution.`,
        impact: 'Reducing retries could cut execution time by 30-50%.',
        actionable: true,
        metadata: { avgRetries: baseline.avg_retry_count },
      });
    }

    // Low success rate
    if (baseline.success_rate < 0.9) {
      suggestions.push({
        type: 'improve_reliability',
        priority: baseline.success_rate < 0.7 ? 'high' : 'medium',
        title: 'Low Success Rate',
        description: `Success rate is ${(baseline.success_rate * 100).toFixed(1)}%.`,
        impact: 'Improving reliability will reduce manual intervention needs.',
        actionable: true,
        metadata: { successRate: baseline.success_rate },
      });
    }

    // High token usage variance
    if (baseline.stddev_token_usage > baseline.avg_token_usage * 0.5) {
      suggestions.push({
        type: 'reduce_token_usage',
        priority: 'medium',
        title: 'Inconsistent Token Usage',
        description: 'Token usage varies significantly between executions.',
        impact: 'Stabilizing prompts could reduce costs by 20-40%.',
        actionable: true,
        metadata: {
          avgTokens: baseline.avg_token_usage,
          stddev: baseline.stddev_token_usage,
        },
      });
    }

    // High duration variance
    if (baseline.stddev_duration_ms > baseline.avg_duration_ms * 0.5) {
      suggestions.push({
        type: 'speed_optimization',
        priority: 'low',
        title: 'Inconsistent Execution Time',
        description: 'Execution time varies significantly.',
        impact: 'Identifying slow steps could improve predictability.',
        actionable: true,
        metadata: {
          avgDuration: baseline.avg_duration_ms,
          stddev: baseline.stddev_duration_ms,
        },
      });
    }

    // Unresolved anomalies
    const criticalAnomalies = anomalies.filter((a) => a.severity === 'critical' || a.severity === 'high');
    if (criticalAnomalies.length > 0) {
      suggestions.push({
        type: 'error_prevention',
        priority: 'high',
        title: 'Unresolved Critical Anomalies',
        description: `${criticalAnomalies.length} critical/high severity anomalies detected.`,
        impact: 'Resolving these could prevent future execution failures.',
        actionable: true,
        metadata: { anomalyCount: criticalAnomalies.length },
      });
    }

    // Plugin-specific issues
    for (const metric of pluginMetrics) {
      const successRate = metric.execution_count > 0
        ? metric.success_count / metric.execution_count
        : 1;

      if (successRate < 0.8 && metric.execution_count >= 5) {
        suggestions.push({
          type: 'plugin_replacement',
          priority: 'medium',
          title: `${metric.plugin}/${metric.action} Reliability Issue`,
          description: `This plugin action has ${(successRate * 100).toFixed(0)}% success rate.`,
          impact: 'Consider error handling or alternative approaches.',
          actionable: true,
          metadata: {
            plugin: metric.plugin,
            action: metric.action,
            successRate,
          },
        });
      }
    }

    // High step count (potential for consolidation)
    if (baseline.avg_step_count > 8) {
      suggestions.push({
        type: 'step_consolidation',
        priority: 'low',
        title: 'Complex Workflow',
        description: `Workflow averages ${baseline.avg_step_count.toFixed(1)} steps.`,
        impact: 'Consolidating steps could simplify maintenance.',
        actionable: false,
        metadata: { avgSteps: baseline.avg_step_count },
      });
    }

    return suggestions;
  }

  /**
   * Calculate overall optimization score
   */
  private calculateOverallScore(
    baseline: ExecutionBaseline,
    anomalies: ExecutionAnomaly[]
  ): number {
    let score = 100;

    // Deduct for low success rate
    if (baseline.success_rate < 1.0) {
      score -= (1 - baseline.success_rate) * 40;
    }

    // Deduct for high retries
    if (baseline.avg_retry_count > 0) {
      score -= Math.min(20, baseline.avg_retry_count * 5);
    }

    // Deduct for high variance
    if (baseline.stddev_duration_ms > baseline.avg_duration_ms * 0.5) {
      score -= 10;
    }
    if (baseline.stddev_token_usage > baseline.avg_token_usage * 0.5) {
      score -= 10;
    }

    // Deduct for unresolved anomalies
    const criticalCount = anomalies.filter(
      (a) => a.severity === 'critical' || a.severity === 'high'
    ).length;
    score -= Math.min(20, criticalCount * 5);

    return Math.max(0, Math.round(score));
  }
}

// Singleton factory
let _instance: WorkflowOptimizer | null = null;
let _lastSupabase: SupabaseClient | null = null;

export function getWorkflowOptimizer(supabase: SupabaseClient): WorkflowOptimizer {
  if (!_instance || _lastSupabase !== supabase) {
    _instance = new WorkflowOptimizer(supabase);
    _lastSupabase = supabase;
  }
  return _instance;
}
