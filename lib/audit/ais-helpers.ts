// lib/audit/ais-helpers.ts
// Helper functions for AIS (Agent Intensity System) audit logging

import { auditLog } from '../services/AuditTrailService';
import { AUDIT_EVENTS } from './events';
import type { AgentIntensityMetrics } from '../types/intensity';
import {
  calculateCreationMultiplier,
  calculateExecutionMultiplier,
  calculateCombinedMultiplier
} from '../types/intensity';
import type { AISRanges } from '../services/AISConfigService';
import type { SupabaseClient } from '@supabase/supabase-js';

interface AISScoreSnapshot {
  agent_id: string;
  agent_name: string;
  creation_score: number;
  execution_score: number;
  combined_score: number;
  creation_multiplier: number;
  execution_multiplier: number;
  combined_multiplier: number;
  last_calculated_at: string;
}

interface AISRangeSnapshot {
  range_key: string;
  best_practice_min: number;
  best_practice_max: number;
  active_mode: number; // 0 = best_practice, 1 = dynamic
  category: string;
}

/**
 * Log when an agent's intensity score is initially calculated
 */
export async function logAISScoreCalculated(
  agentId: string,
  agentName: string,
  userId: string,
  metrics: AgentIntensityMetrics,
  normalizationRanges?: AISRanges
): Promise<void> {
  await auditLog({
    userId,
    action: AUDIT_EVENTS.AIS_SCORE_CALCULATED,
    entityType: 'agent',
    entityId: agentId,
    resourceName: agentName,
    details: {
      creation_score: metrics.creation_score,
      execution_score: metrics.execution_score,
      combined_score: metrics.combined_score,
      creation_multiplier: calculateCreationMultiplier(metrics.creation_score),
      execution_multiplier: calculateExecutionMultiplier(metrics.execution_score),
      combined_multiplier: calculateCombinedMultiplier(metrics.combined_score),
      reason: 'Initial calculation',
      normalization_ranges: normalizationRanges ? {
        // Creation ranges
        creation_workflow_steps: normalizationRanges.creation_workflow_steps,
        creation_plugins: normalizationRanges.creation_plugins,
        creation_io_fields: normalizationRanges.creation_io_fields,
        // Execution ranges (most critical)
        token_volume: normalizationRanges.token_volume,
        token_peak: normalizationRanges.token_peak,
        iterations: normalizationRanges.iterations,
        duration_ms: normalizationRanges.duration_ms,
        plugin_count: normalizationRanges.plugin_count,
        plugins_per_run: normalizationRanges.plugins_per_run,
        workflow_steps: normalizationRanges.workflow_steps,
        branches: normalizationRanges.branches,
      } : undefined,
    },
    severity: 'info',
  });
}

/**
 * Log when an agent's intensity score is updated
 */
export async function logAISScoreUpdated(
  agentId: string,
  agentName: string,
  userId: string,
  oldMetrics: AgentIntensityMetrics,
  newMetrics: AgentIntensityMetrics,
  reason: string,
  normalizationRanges?: AISRanges
): Promise<void> {
  const oldCombinedMultiplier = calculateCombinedMultiplier(oldMetrics.combined_score);
  const newCombinedMultiplier = calculateCombinedMultiplier(newMetrics.combined_score);

  await auditLog({
    userId,
    action: AUDIT_EVENTS.AIS_SCORE_UPDATED,
    entityType: 'agent',
    entityId: agentId,
    resourceName: agentName,
    changes: {
      before: {
        creation_score: oldMetrics.creation_score,
        execution_score: oldMetrics.execution_score,
        combined_score: oldMetrics.combined_score,
        combined_multiplier: oldCombinedMultiplier,
      },
      after: {
        creation_score: newMetrics.creation_score,
        execution_score: newMetrics.execution_score,
        combined_score: newMetrics.combined_score,
        combined_multiplier: newCombinedMultiplier,
      },
      delta: {
        creation_score: newMetrics.creation_score - oldMetrics.creation_score,
        execution_score: newMetrics.execution_score - oldMetrics.execution_score,
        combined_score: newMetrics.combined_score - oldMetrics.combined_score,
        combined_multiplier: newCombinedMultiplier - oldCombinedMultiplier,
      },
    },
    details: {
      reason,
      total_executions: newMetrics.total_executions,
      total_tokens_used: newMetrics.total_tokens_used,
      normalization_ranges: normalizationRanges ? {
        creation_workflow_steps: normalizationRanges.creation_workflow_steps,
        creation_plugins: normalizationRanges.creation_plugins,
        creation_io_fields: normalizationRanges.creation_io_fields,
        token_volume: normalizationRanges.token_volume,
        token_peak: normalizationRanges.token_peak,
        iterations: normalizationRanges.iterations,
        duration_ms: normalizationRanges.duration_ms,
        plugin_count: normalizationRanges.plugin_count,
        plugins_per_run: normalizationRanges.plugins_per_run,
        workflow_steps: normalizationRanges.workflow_steps,
        branches: normalizationRanges.branches,
      } : undefined,
    },
    severity: 'info',
  });
}

/**
 * Log manual score recalculation
 */
export async function logAISManualRefresh(
  agentId: string,
  agentName: string,
  userId: string,
  oldMetrics: AgentIntensityMetrics,
  newMetrics: AgentIntensityMetrics,
  normalizationRanges?: AISRanges
): Promise<void> {
  const oldCombinedMultiplier = calculateCombinedMultiplier(oldMetrics.combined_score);
  const newCombinedMultiplier = calculateCombinedMultiplier(newMetrics.combined_score);

  await auditLog({
    userId,
    action: AUDIT_EVENTS.AIS_SCORE_RECALCULATED,
    entityType: 'agent',
    entityId: agentId,
    resourceName: agentName,
    changes: {
      before: {
        creation_score: oldMetrics.creation_score,
        execution_score: oldMetrics.execution_score,
        combined_score: oldMetrics.combined_score,
        combined_multiplier: oldCombinedMultiplier,
      },
      after: {
        creation_score: newMetrics.creation_score,
        execution_score: newMetrics.execution_score,
        combined_score: newMetrics.combined_score,
        combined_multiplier: newCombinedMultiplier,
      },
    },
    details: {
      reason: 'Manual refresh requested by user',
      normalization_ranges: normalizationRanges ? {
        creation_workflow_steps: normalizationRanges.creation_workflow_steps,
        creation_plugins: normalizationRanges.creation_plugins,
        creation_io_fields: normalizationRanges.creation_io_fields,
        token_volume: normalizationRanges.token_volume,
        token_peak: normalizationRanges.token_peak,
        iterations: normalizationRanges.iterations,
        duration_ms: normalizationRanges.duration_ms,
        plugin_count: normalizationRanges.plugin_count,
        plugins_per_run: normalizationRanges.plugins_per_run,
        workflow_steps: normalizationRanges.workflow_steps,
        branches: normalizationRanges.branches,
      } : undefined,
    },
    severity: 'info',
  });
}

/**
 * Snapshot all agent intensity scores
 */
export async function snapshotAllAgentScores(
  supabase: SupabaseClient
): Promise<AISScoreSnapshot[]> {
  try {
    const { data: metrics, error } = await supabase
      .from('agent_intensity_metrics')
      .select(`
        agent_id,
        creation_score,
        execution_score,
        combined_score,
        last_calculated_at,
        agents!inner (
          agent_name
        )
      `);

    if (error) {
      console.error('Failed to snapshot agent scores:', error);
      console.error('Error details:', error);
      return [];
    }

    if (!metrics || metrics.length === 0) {
      console.warn('No agent intensity metrics found for snapshot');
      return [];
    }

    return (metrics || []).map((m: any) => ({
      agent_id: m.agent_id,
      agent_name: m.agents?.agent_name || 'Unknown',
      creation_score: m.creation_score,
      execution_score: m.execution_score,
      combined_score: m.combined_score,
      creation_multiplier: calculateCreationMultiplier(m.creation_score),
      execution_multiplier: calculateExecutionMultiplier(m.execution_score),
      combined_multiplier: calculateCombinedMultiplier(m.combined_score),
      last_calculated_at: m.last_calculated_at,
    }));
  } catch (error) {
    console.error('Exception in snapshotAllAgentScores:', error);
    return [];
  }
}

/**
 * Snapshot current normalization ranges
 */
export async function snapshotNormalizationRanges(
  supabase: SupabaseClient
): Promise<AISRangeSnapshot[]> {
  try {
    const { data: ranges, error } = await supabase
      .from('ais_normalization_ranges')
      .select('range_key, best_practice_min, best_practice_max, dynamic_min, dynamic_max, active_mode, category');

    if (error) {
      console.error('Failed to snapshot ranges:', error);
      console.error('Error details:', error);
      return [];
    }

    if (!ranges || ranges.length === 0) {
      console.warn('No normalization ranges found for snapshot');
      return [];
    }

    // Map to snapshot format, using the active range based on active_mode
    return ranges.map((r: any) => {
      const usesDynamic = r.active_mode === 1;
      return {
        range_key: r.range_key,
        best_practice_min: usesDynamic ? (r.dynamic_min ?? r.best_practice_min) : r.best_practice_min,
        best_practice_max: usesDynamic ? (r.dynamic_max ?? r.best_practice_max) : r.best_practice_max,
        active_mode: r.active_mode,
        category: r.category,
      };
    });
  } catch (error) {
    console.error('Exception in snapshotNormalizationRanges:', error);
    return [];
  }
}

/**
 * Log normalization refresh started with snapshot
 */
export async function logAISNormalizationRefreshStarted(
  userId: string | null,
  oldRanges: AISRangeSnapshot[],
  agentScoresSnapshot: AISScoreSnapshot[],
  reason: string
): Promise<void> {
  await auditLog({
    userId,
    actorId: userId,
    action: AUDIT_EVENTS.AIS_NORMALIZATION_REFRESH_STARTED,
    entityType: 'system',
    entityId: 'ais_normalization_ranges',
    resourceName: 'AIS Normalization Ranges',
    details: {
      reason,
      affected_agents_count: agentScoresSnapshot.length,
      agent_scores_snapshot: agentScoresSnapshot,
      old_ranges: oldRanges,
      timestamp: new Date().toISOString(),
    },
    severity: 'warning',
  });
}

/**
 * Log normalization refresh completed
 */
export async function logAISNormalizationRefreshCompleted(
  userId: string | null,
  oldRanges: AISRangeSnapshot[],
  newRanges: AISRangeSnapshot[]
): Promise<void> {
  await auditLog({
    userId,
    actorId: userId,
    action: AUDIT_EVENTS.AIS_NORMALIZATION_REFRESH_COMPLETED,
    entityType: 'system',
    entityId: 'ais_normalization_ranges',
    resourceName: 'AIS Normalization Ranges',
    changes: {
      before: oldRanges,
      after: newRanges,
    },
    details: {
      ranges_updated: newRanges.length,
      timestamp: new Date().toISOString(),
    },
    severity: 'warning',
  });
}

/**
 * Log bulk score recalculation after normalization refresh
 */
export async function logAISScoresBulkRecalculated(
  userId: string | null,
  beforeSnapshot: AISScoreSnapshot[],
  afterSnapshot: AISScoreSnapshot[]
): Promise<void> {
  // Calculate summary statistics
  const changes = afterSnapshot.map((after) => {
    const before = beforeSnapshot.find(b => b.agent_id === after.agent_id);
    if (!before) return null;

    return {
      agent_id: after.agent_id,
      agent_name: after.agent_name,
      delta: {
        creation_score: after.creation_score - before.creation_score,
        execution_score: after.execution_score - before.execution_score,
        combined_score: after.combined_score - before.combined_score,
        combined_multiplier: after.combined_multiplier - before.combined_multiplier,
      },
    };
  }).filter(Boolean);

  await auditLog({
    userId,
    action: AUDIT_EVENTS.AIS_SCORES_BULK_RECALCULATED,
    entityType: 'system',
    entityId: 'agent_intensity_metrics',
    resourceName: 'All Agent Intensity Scores',
    changes: {
      before: beforeSnapshot,
      after: afterSnapshot,
      summary: changes,
    },
    details: {
      reason: 'Post-normalization refresh recalculation',
      agents_affected: changes.length,
      timestamp: new Date().toISOString(),
    },
    severity: 'warning',
  });
}

/**
 * Log per-step routing decision (Per-Step AIS Enhancement)
 */
export async function logStepRoutingDecision(
  agentId: string,
  agentName: string,
  userId: string,
  executionId: string,
  stepId: string,
  stepName: string,
  stepType: string,
  complexity: number,
  agentAIS: number,
  effectiveComplexity: number,
  tier: string,
  model: string,
  provider: string,
  reason: string
): Promise<void> {
  await auditLog({
    userId,
    action: 'STEP_ROUTING_DECISION',
    entityType: 'workflow_step',
    entityId: stepId,
    resourceName: stepName,
    details: {
      agent: {
        id: agentId,
        name: agentName,
        ais_score: agentAIS,
      },
      execution: {
        id: executionId,
        step_id: stepId,
        step_name: stepName,
        step_type: stepType,
      },
      complexity: {
        step_score: complexity,
        agent_score: agentAIS,
        effective_score: effectiveComplexity,
        weighting: '60% agent + 40% step',
      },
      routing: {
        tier,
        model,
        provider,
        reason,
      },
      timestamp: new Date().toISOString(),
    },
    severity: 'info',
  });
}
