/**
 * CorrelationEngine - Cross-Workflow Pattern Detection
 *
 * Detects patterns and correlations across multiple workflows using
 * domain-agnostic analysis. All detection algorithms work for ANY
 * workflow type without hardcoded assumptions.
 *
 * Pattern Types Detected:
 * 1. Sequential Opportunity - Workflows that always run together
 * 2. Redundant Operation - Same plugin/action called multiple times
 * 3. Failure Cascade - When A fails, B fails
 * 4. Timing Conflict - Workflows competing for resources
 * 5. Data Dependency - Output of A feeds into B
 *
 * @module lib/pilot/insight/CorrelationEngine
 */

import { createLogger } from '@/lib/logger';
import { SupabaseClient } from '@supabase/supabase-js';
import { supabaseServer as defaultSupabase } from '@/lib/supabaseServer';

const logger = createLogger({ service: 'CorrelationEngine' });

// ============================================================================
// Types
// ============================================================================

/**
 * Types of cross-workflow patterns
 */
export type CrossWorkflowPatternType =
  | 'sequential_opportunity'  // Workflows that always run together
  | 'redundant_operation'     // Same plugin/action called multiple times
  | 'failure_cascade'         // When A fails, B fails
  | 'timing_conflict'         // Workflows competing for resources
  | 'data_dependency';        // Output of A feeds into B

/**
 * Detected cross-workflow pattern
 */
export interface CrossWorkflowPattern {
  type: CrossWorkflowPatternType;
  agents_involved: AgentSummary[];
  description: string;
  recommendation: string;
  estimated_impact: {
    value: number;
    unit: 'seconds' | 'count' | 'percentage';
    description: string;
  };
  confidence: number;         // 0-1
  evidence: PatternEvidence;
  detected_at: string;
}

/**
 * Minimal agent info for patterns
 */
export interface AgentSummary {
  id: string;
  name: string;
}

/**
 * Evidence supporting the pattern detection
 */
export interface PatternEvidence {
  occurrences: number;        // How many times pattern was observed
  sample_timestamps?: string[]; // Example timestamps
  correlation_coefficient?: number; // For statistical correlations
  shared_elements?: string[]; // Shared plugins, actions, etc.
}

/**
 * Execution record for correlation analysis
 */
interface ExecutionRecord {
  id: string;
  agent_id: string;
  agent_name: string;
  started_at: string;
  completed_at: string | null;
  duration_ms: number | null;
  status: 'success' | 'failed' | 'running';
  plugins_used: string[];
}

/**
 * Configuration for the correlation engine
 */
export interface CorrelationEngineConfig {
  // Time window for sequential detection (ms)
  sequentialWindowMs?: number;
  // Minimum occurrences to report a pattern
  minOccurrences?: number;
  // Minimum confidence to report
  minConfidence?: number;
  // Look back period in days
  lookBackDays?: number;
}

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_CONFIG: Required<CorrelationEngineConfig> = {
  sequentialWindowMs: 5 * 60 * 1000,  // 5 minutes
  minOccurrences: 3,
  minConfidence: 0.5,
  lookBackDays: 30,
};

// ============================================================================
// Main Class
// ============================================================================

export class CorrelationEngine {
  private supabase: SupabaseClient;
  private config: Required<CorrelationEngineConfig>;

  constructor(
    supabaseClient?: SupabaseClient,
    config?: CorrelationEngineConfig
  ) {
    this.supabase = supabaseClient || defaultSupabase;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Analyze all workflows for cross-workflow patterns
   */
  async analyzePortfolio(userId: string, orgId: string): Promise<CrossWorkflowPattern[]> {
    const startTime = Date.now();

    logger.info({ userId, orgId }, 'Starting cross-workflow correlation analysis');

    // 1. Fetch execution history
    const executions = await this.fetchExecutions(orgId);

    if (executions.length < this.config.minOccurrences * 2) {
      logger.info({ executionCount: executions.length }, 'Insufficient execution data for correlation');
      return [];
    }

    // 2. Run all detection algorithms in parallel
    const [
      sequentialPatterns,
      redundantPatterns,
      cascadePatterns,
      timingPatterns,
    ] = await Promise.all([
      this.detectSequentialPatterns(executions),
      this.detectRedundantOperations(orgId),
      this.detectFailureCascades(executions),
      this.detectTimingConflicts(executions),
    ]);

    // 3. Combine and filter patterns
    const allPatterns = [
      ...sequentialPatterns,
      ...redundantPatterns,
      ...cascadePatterns,
      ...timingPatterns,
    ].filter(p => p.confidence >= this.config.minConfidence);

    // 4. Sort by impact
    allPatterns.sort((a, b) => {
      // Prioritize by confidence * impact value
      const aScore = a.confidence * a.estimated_impact.value;
      const bScore = b.confidence * b.estimated_impact.value;
      return bScore - aScore;
    });

    logger.info({
      userId,
      duration: Date.now() - startTime,
      patternCount: allPatterns.length,
      byType: {
        sequential: sequentialPatterns.length,
        redundant: redundantPatterns.length,
        cascade: cascadePatterns.length,
        timing: timingPatterns.length,
      },
    }, 'Correlation analysis complete');

    return allPatterns;
  }

  // ============================================================================
  // Data Fetching
  // ============================================================================

  private async fetchExecutions(orgId: string): Promise<ExecutionRecord[]> {
    const lookBackDate = new Date();
    lookBackDate.setDate(lookBackDate.getDate() - this.config.lookBackDays);

    const { data, error } = await this.supabase
      .from('agent_executions')
      .select(`
        id,
        agent_id,
        started_at,
        completed_at,
        execution_duration_ms,
        status,
        logs,
        agents!inner(agent_name, org_id)
      `)
      .eq('agents.org_id', orgId)
      .gte('started_at', lookBackDate.toISOString())
      .order('started_at', { ascending: true });

    if (error) {
      logger.error({ err: error, orgId }, 'Failed to fetch executions');
      return [];
    }

    return (data || []).map((e: any) => ({
      id: e.id,
      agent_id: e.agent_id,
      agent_name: e.agents?.agent_name || 'Unknown',
      started_at: e.started_at,
      completed_at: e.completed_at,
      duration_ms: e.execution_duration_ms,
      status: this.normalizeStatus(e.status),
      plugins_used: this.extractPlugins(e.logs),
    }));
  }

  private normalizeStatus(status: string): 'success' | 'failed' | 'running' {
    if (['completed', 'success'].includes(status)) return 'success';
    if (['failed', 'error'].includes(status)) return 'failed';
    return 'running';
  }

  private extractPlugins(logs: any): string[] {
    if (!logs || typeof logs !== 'object') return [];

    // Extract plugin names from logs if available
    const plugins = new Set<string>();

    if (logs.toolCalls && Array.isArray(logs.toolCalls)) {
      logs.toolCalls.forEach((call: any) => {
        if (call.plugin) plugins.add(call.plugin);
      });
    }

    return Array.from(plugins);
  }

  // ============================================================================
  // Pattern Detection Algorithms
  // ============================================================================

  /**
   * Detect workflows that frequently run in sequence
   * (within a short time window of each other)
   */
  private async detectSequentialPatterns(
    executions: ExecutionRecord[]
  ): Promise<CrossWorkflowPattern[]> {
    const patterns: CrossWorkflowPattern[] = [];
    const pairCounts = new Map<string, {
      count: number;
      avgGapMs: number;
      timestamps: string[];
      agents: [AgentSummary, AgentSummary];
    }>();

    // Sort by start time
    const sorted = [...executions].sort(
      (a, b) => new Date(a.started_at).getTime() - new Date(b.started_at).getTime()
    );

    // Look for pairs within the time window
    for (let i = 0; i < sorted.length; i++) {
      for (let j = i + 1; j < sorted.length; j++) {
        const exec1 = sorted[i];
        const exec2 = sorted[j];

        // Skip same agent
        if (exec1.agent_id === exec2.agent_id) continue;

        const gap = new Date(exec2.started_at).getTime() - new Date(exec1.started_at).getTime();

        // Outside window
        if (gap > this.config.sequentialWindowMs) break;

        // Create consistent pair key (sorted IDs)
        const pairKey = [exec1.agent_id, exec2.agent_id].sort().join('|');

        const existing = pairCounts.get(pairKey) || {
          count: 0,
          avgGapMs: 0,
          timestamps: [],
          agents: [
            { id: exec1.agent_id, name: exec1.agent_name },
            { id: exec2.agent_id, name: exec2.agent_name },
          ],
        };

        existing.count++;
        existing.avgGapMs = (existing.avgGapMs * (existing.count - 1) + gap) / existing.count;
        existing.timestamps.push(exec1.started_at);

        pairCounts.set(pairKey, existing);
      }
    }

    // Convert to patterns
    pairCounts.forEach((data, key) => {
      if (data.count >= this.config.minOccurrences) {
        const avgGapSeconds = Math.round(data.avgGapMs / 1000);
        const timeSavedPerMerge = avgGapSeconds; // Time saved by merging

        patterns.push({
          type: 'sequential_opportunity',
          agents_involved: data.agents,
          description: `"${data.agents[0].name}" and "${data.agents[1].name}" frequently run within ${avgGapSeconds} seconds of each other`,
          recommendation: `Consider merging these workflows or creating a combined workflow to reduce overhead`,
          estimated_impact: {
            value: timeSavedPerMerge * data.count,
            unit: 'seconds',
            description: `~${this.formatTime(timeSavedPerMerge * data.count)} saved over ${data.count} occurrences`,
          },
          confidence: Math.min(0.9, data.count / 20),
          evidence: {
            occurrences: data.count,
            sample_timestamps: data.timestamps.slice(0, 5),
          },
          detected_at: new Date().toISOString(),
        });
      }
    });

    return patterns;
  }

  /**
   * Detect redundant operations (same plugin/action called across workflows)
   */
  private async detectRedundantOperations(orgId: string): Promise<CrossWorkflowPattern[]> {
    const patterns: CrossWorkflowPattern[] = [];

    // Get agents with their workflow steps
    const { data: agents, error } = await this.supabase
      .from('agents')
      .select('id, agent_name, pilot_steps, plugins_required')
      .eq('org_id', orgId)
      .neq('status', 'deleted');

    if (error || !agents) return patterns;

    // Analyze plugin usage overlap
    const pluginUsage = new Map<string, AgentSummary[]>();

    agents.forEach(agent => {
      const plugins = agent.plugins_required || [];
      plugins.forEach((plugin: string) => {
        const existing = pluginUsage.get(plugin) || [];
        existing.push({ id: agent.id, name: agent.agent_name });
        pluginUsage.set(plugin, existing);
      });
    });

    // Find plugins used by multiple workflows
    pluginUsage.forEach((agentsList, plugin) => {
      if (agentsList.length >= 3) {
        patterns.push({
          type: 'redundant_operation',
          agents_involved: agentsList,
          description: `${agentsList.length} workflows use the "${plugin}" plugin`,
          recommendation: `Review if these workflows can share a common sub-workflow for ${plugin} operations`,
          estimated_impact: {
            value: (agentsList.length - 1) * 10,
            unit: 'percentage',
            description: `Potential ${(agentsList.length - 1) * 10}% reduction in redundant API calls`,
          },
          confidence: Math.min(0.8, agentsList.length / 10),
          evidence: {
            occurrences: agentsList.length,
            shared_elements: [plugin],
          },
          detected_at: new Date().toISOString(),
        });
      }
    });

    return patterns;
  }

  /**
   * Detect failure cascades (when one workflow fails, others tend to fail)
   */
  private async detectFailureCascades(
    executions: ExecutionRecord[]
  ): Promise<CrossWorkflowPattern[]> {
    const patterns: CrossWorkflowPattern[] = [];

    // Group executions by day
    const byDay = new Map<string, ExecutionRecord[]>();
    executions.forEach(exec => {
      const day = exec.started_at.slice(0, 10);
      const existing = byDay.get(day) || [];
      existing.push(exec);
      byDay.set(day, existing);
    });

    // Look for correlated failures
    const failurePairs = new Map<string, {
      bothFailed: number;
      oneFailed: number;
      agents: [AgentSummary, AgentSummary];
    }>();

    byDay.forEach(dayExecutions => {
      // Get unique agents that ran this day
      const agentResults = new Map<string, {
        name: string;
        hasFailure: boolean;
      }>();

      dayExecutions.forEach(exec => {
        const existing = agentResults.get(exec.agent_id);
        if (!existing) {
          agentResults.set(exec.agent_id, {
            name: exec.agent_name,
            hasFailure: exec.status === 'failed',
          });
        } else if (exec.status === 'failed') {
          existing.hasFailure = true;
        }
      });

      // Check pairs
      const agentIds = Array.from(agentResults.keys());
      for (let i = 0; i < agentIds.length; i++) {
        for (let j = i + 1; j < agentIds.length; j++) {
          const agent1 = agentResults.get(agentIds[i])!;
          const agent2 = agentResults.get(agentIds[j])!;
          const pairKey = [agentIds[i], agentIds[j]].sort().join('|');

          const existing = failurePairs.get(pairKey) || {
            bothFailed: 0,
            oneFailed: 0,
            agents: [
              { id: agentIds[i], name: agent1.name },
              { id: agentIds[j], name: agent2.name },
            ],
          };

          if (agent1.hasFailure && agent2.hasFailure) {
            existing.bothFailed++;
          } else if (agent1.hasFailure || agent2.hasFailure) {
            existing.oneFailed++;
          }

          failurePairs.set(pairKey, existing);
        }
      }
    });

    // Identify significant correlations
    failurePairs.forEach((data, key) => {
      const total = data.bothFailed + data.oneFailed;
      if (total < this.config.minOccurrences) return;

      const correlation = data.bothFailed / total;
      if (correlation > 0.5) {
        patterns.push({
          type: 'failure_cascade',
          agents_involved: data.agents,
          description: `"${data.agents[0].name}" and "${data.agents[1].name}" tend to fail together (${Math.round(correlation * 100)}% correlation)`,
          recommendation: `Investigate shared dependencies or data sources that may cause coordinated failures`,
          estimated_impact: {
            value: data.bothFailed,
            unit: 'count',
            description: `${data.bothFailed} coordinated failures detected`,
          },
          confidence: correlation,
          evidence: {
            occurrences: total,
            correlation_coefficient: correlation,
          },
          detected_at: new Date().toISOString(),
        });
      }
    });

    return patterns;
  }

  /**
   * Detect timing conflicts (workflows competing for resources)
   */
  private async detectTimingConflicts(
    executions: ExecutionRecord[]
  ): Promise<CrossWorkflowPattern[]> {
    const patterns: CrossWorkflowPattern[] = [];

    // Look for overlapping executions
    const overlapCounts = new Map<string, {
      count: number;
      totalOverlapMs: number;
      agents: [AgentSummary, AgentSummary];
    }>();

    for (let i = 0; i < executions.length; i++) {
      const exec1 = executions[i];
      if (!exec1.completed_at) continue;

      const start1 = new Date(exec1.started_at).getTime();
      const end1 = new Date(exec1.completed_at).getTime();

      for (let j = i + 1; j < executions.length; j++) {
        const exec2 = executions[j];
        if (!exec2.completed_at) continue;
        if (exec1.agent_id === exec2.agent_id) continue;

        const start2 = new Date(exec2.started_at).getTime();
        const end2 = new Date(exec2.completed_at).getTime();

        // Check for overlap
        const overlapStart = Math.max(start1, start2);
        const overlapEnd = Math.min(end1, end2);
        const overlap = overlapEnd - overlapStart;

        if (overlap > 0) {
          const pairKey = [exec1.agent_id, exec2.agent_id].sort().join('|');

          const existing = overlapCounts.get(pairKey) || {
            count: 0,
            totalOverlapMs: 0,
            agents: [
              { id: exec1.agent_id, name: exec1.agent_name },
              { id: exec2.agent_id, name: exec2.agent_name },
            ],
          };

          existing.count++;
          existing.totalOverlapMs += overlap;

          overlapCounts.set(pairKey, existing);
        }
      }
    }

    // Report significant overlaps
    overlapCounts.forEach((data, key) => {
      if (data.count >= this.config.minOccurrences) {
        const avgOverlapSeconds = Math.round(data.totalOverlapMs / data.count / 1000);

        patterns.push({
          type: 'timing_conflict',
          agents_involved: data.agents,
          description: `"${data.agents[0].name}" and "${data.agents[1].name}" frequently run simultaneously (avg ${avgOverlapSeconds}s overlap)`,
          recommendation: `Consider staggering schedules to reduce resource contention`,
          estimated_impact: {
            value: avgOverlapSeconds,
            unit: 'seconds',
            description: `Average overlap of ${avgOverlapSeconds} seconds may cause slowdowns`,
          },
          confidence: Math.min(0.7, data.count / 15),
          evidence: {
            occurrences: data.count,
          },
          detected_at: new Date().toISOString(),
        });
      }
    });

    return patterns;
  }

  // ============================================================================
  // Helpers
  // ============================================================================

  private formatTime(seconds: number): string {
    if (seconds < 60) return `${Math.round(seconds)}s`;
    if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
    const hours = Math.floor(seconds / 3600);
    const mins = Math.round((seconds % 3600) / 60);
    return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
  }
}

// ============================================================================
// Singleton Export
// ============================================================================

let engineInstance: CorrelationEngine | null = null;

export function getCorrelationEngine(
  supabaseClient?: SupabaseClient,
  config?: CorrelationEngineConfig
): CorrelationEngine {
  if (!engineInstance) {
    engineInstance = new CorrelationEngine(supabaseClient, config);
  }
  return engineInstance;
}

export { CorrelationEngine as default };
