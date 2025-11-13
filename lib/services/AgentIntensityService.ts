// lib/services/AgentIntensityService.ts
// Service for calculating and managing agent intensity scores

import { supabase as defaultSupabase } from '@/lib/supabaseClient';
import type { SupabaseClient } from '@supabase/supabase-js';
import { tokensToPilotCredits } from '@/lib/utils/pricingConfig';
import type {
  AgentIntensityMetrics,
  AgentExecutionData,
  AgentCreationData,
  IntensityBreakdown,
  IntensityComponentScores,
  CreationComponentScores,
} from '@/lib/types/intensity';
import {
  DEFAULT_INTENSITY_METRICS,
  calculateCreationMultiplier,
  calculateExecutionMultiplier,
  calculateCombinedMultiplier,
} from '@/lib/types/intensity';
// Phase 6: Removed EXECUTION_WEIGHTS and COMBINED_WEIGHTS imports - now using database-driven weights!
import { AISConfigService } from './AISConfigService';
import { logAISScoreCalculated, logAISScoreUpdated } from '@/lib/audit/ais-helpers';

/**
 * AgentIntensityService
 *
 * Handles calculation and persistence of agent complexity scores for dynamic pricing.
 * Uses a weighted formula across 4 dimensions:
 * - Token Complexity (35%)
 * - Execution Complexity (25%)
 * - Plugin Complexity (25%)
 * - Workflow Complexity (15%)
 */
export class AgentIntensityService {
  /**
   * Initialize intensity metrics for a new agent
   */
  static async initializeMetrics(
    supabaseClient: SupabaseClient,
    agent_id: string,
    user_id: string
  ): Promise<AgentIntensityMetrics | null> {
    try {
      const { data, error } = await supabaseClient
        .from('agent_intensity_metrics')
        .insert({
          agent_id,
          user_id,
          ...DEFAULT_INTENSITY_METRICS,
        })
        .select()
        .single();

      if (error) {
        console.error('Error initializing intensity metrics:', error);
        return null;
      }

      return data as AgentIntensityMetrics;
    } catch (error) {
      console.error('Exception in initializeMetrics:', error);
      return null;
    }
  }

  /**
   * Track agent creation costs (one-time)
   */
  static async trackCreationCosts(
    supabaseClient: SupabaseClient,
    creationData: AgentCreationData
  ): Promise<AgentIntensityMetrics | null> {
    try {
      // Get existing metrics or create if not exists
      let existing = await this.getMetrics(supabaseClient, creationData.agent_id);

      if (!existing) {
        // Initialize if doesn't exist
        existing = await this.initializeMetrics(
          supabaseClient,
          creationData.agent_id,
          creationData.user_id
        );
        if (!existing) return null;
      }

      // Fetch pilot credit cost from database (no more hardcoding!)
      const PILOT_CREDIT_COST = await AISConfigService.getSystemConfig(
        supabaseClient,
        'pilot_credit_cost_usd',
        0.00048 // Fallback only if database unavailable
      );

      // Use database-driven token-to-credit conversion
      const pilotCredits = await tokensToPilotCredits(creationData.tokens_used, supabaseClient);
      const creation_cost_usd = pilotCredits * PILOT_CREDIT_COST;

      // Fetch AIS ranges for audit trail
      const ranges = await AISConfigService.getRanges(supabaseClient);

      // NEW: Calculate creation score components based on agent DESIGN complexity (4 dimensions)
      const creationComponents = await this.calculateCreationScores(supabaseClient, creationData.agent_id);
      const creation_score = this.calculateCreationOverallScore(creationComponents);

      // Phase 6: Fetch combined weights from database (no more COMBINED_WEIGHTS constant!)
      const combinedWeights = await AISConfigService.getCombinedWeights(supabaseClient);

      // Calculate combined score with predicted execution complexity
      // Use 5.0 as reasonable middle-ground estimate until first execution
      const execution_score_default = 5.0; // Default until first execution
      let combined_score = (creation_score * combinedWeights.creation) +
                            (execution_score_default * combinedWeights.execution);

      // ✅ Validate combined_score is not NaN before database insert
      if (isNaN(combined_score)) {
        console.error('[AIS] ⚠️ Combined score is NaN, using default 5.0:', {
          creation_score,
          execution_score_default,
          weights: combinedWeights
        });
        combined_score = 5.0;
      }

      console.log(`✅ [AIS] Creation score calculated:`, {
        tokens: creationData.tokens_used,
        workflow: creationComponents.workflow_structure.score.toFixed(2),
        plugins: creationComponents.plugin_diversity.score.toFixed(2),
        io: creationComponents.io_schema.score.toFixed(2),
        trigger: creationComponents.trigger_type.score.toFixed(2),
        creation_score: creation_score.toFixed(2),
        combined_score: combined_score.toFixed(2)
      });

      // Update database with creation costs AND scores (4 dimensions + combined)
      const { data, error } = await supabaseClient
        .from('agent_intensity_metrics')
        .update({
          creation_tokens_used: creationData.tokens_used,
          total_creation_cost_usd: creation_cost_usd,

          // Three scores
          creation_score,
          execution_score: execution_score_default,
          combined_score, // ✅ CALCULATED IMMEDIATELY

          // Four creation dimensions
          creation_workflow_score: creationComponents.workflow_structure.score,
          creation_plugin_score: creationComponents.plugin_diversity.score,
          creation_io_score: creationComponents.io_schema.score,
          creation_trigger_score: creationComponents.trigger_type.score,

          // OLD (keep for backward compatibility during migration)
          creation_complexity_score: creation_score,
          creation_token_efficiency_score: creation_score,

          updated_at: new Date().toISOString(),
        })
        .eq('agent_id', creationData.agent_id)
        .select()
        .single();

      if (error) {
        console.error('❌ [AIS] Error tracking creation costs:', error);
        return null;
      }

      // Verify the update was successful
      if (!data) {
        console.error('❌ [AIS] Update returned no data');
        return null;
      }

      console.log(`✅ [AIS] Creation costs tracked for agent ${creationData.agent_id}: ${pilotCredits} credits ($${creation_cost_usd.toFixed(4)}), creation_score: ${creation_score.toFixed(1)}, combined_score: ${combined_score.toFixed(1)}`);

      // Verify stored values match what we calculated
      const storedData = data as AgentIntensityMetrics;

      // Audit log the score calculation
      const { data: agentData } = await supabaseClient
        .from('agents')
        .select('agent_name')
        .eq('id', creationData.agent_id)
        .single();

      const agentName = agentData?.agent_name || 'Unknown Agent';
      await logAISScoreCalculated(
        creationData.agent_id,
        agentName,
        creationData.user_id,
        storedData,
        ranges // Include normalization ranges in audit log
      );
      if (Math.abs(storedData.creation_score - creation_score) > 0.01) {
        console.error(`⚠️ [AIS] Creation score mismatch! Calculated: ${creation_score.toFixed(2)}, Stored: ${storedData.creation_score}`);
      }
      if (Math.abs((storedData.combined_score ?? 0) - combined_score) > 0.01) {
        console.error(`⚠️ [AIS] Combined score mismatch! Calculated: ${combined_score.toFixed(2)}, Stored: ${storedData.combined_score}`);
      }
      if (Math.abs((storedData.creation_workflow_score ?? 0) - creationComponents.workflow_structure.score) > 0.01) {
        console.error(`⚠️ [AIS] Workflow score mismatch! Calculated: ${creationComponents.workflow_structure.score.toFixed(2)}, Stored: ${storedData.creation_workflow_score}`);
      }

      return storedData;
    } catch (error) {
      console.error('Exception in trackCreationCosts:', error);
      return null;
    }
  }

  /**
   * Update intensity metrics after agent execution
   */
  static async updateMetricsFromExecution(
    supabaseClient: SupabaseClient,
    executionData: AgentExecutionData
  ): Promise<AgentIntensityMetrics | null> {
    try {
      // 1. Get existing metrics or create if not exists
      const existing = await this.getMetrics(supabaseClient, executionData.agent_id);

      // Store old metrics for audit trail
      const oldMetrics = existing ? { ...existing } : null;

      if (!existing) {
        // Initialize if doesn't exist
        await this.initializeMetrics(
          supabaseClient,
          executionData.agent_id,
          executionData.user_id
        );
      }

      // 2. Calculate updated statistics
      const updated = this.calculateUpdatedMetrics(existing, executionData);

      // 3. Fetch AIS ranges from database
      const ranges = await AISConfigService.getRanges(supabaseClient);

      // 4. Calculate new component scores using database ranges AND weights
      const componentScores = await this.calculateComponentScores(updated, ranges, supabaseClient);

      // 5. Calculate overall intensity score (old 4-component system)
      const intensity_score = this.calculateOverallScore(componentScores);

      // NEW: Use intensity_score as execution_score (they represent the same thing: execution complexity)
      // intensity_score is calculated from 4 execution dimensions: tokens, execution, plugins, workflow
      const execution_score = intensity_score;

      // Get creation_score from database (should already exist from trackCreationCosts)
      const creation_score = existing?.creation_score || 5.0;

      // Calculate combined score using database weights
      const combinedWeights = await AISConfigService.getCombinedWeights(supabaseClient);
      let combined_score = (creation_score * combinedWeights.creation) + (execution_score * combinedWeights.execution);

      // ✅ Validate combined_score before database insert
      if (isNaN(combined_score)) {
        console.error('[AIS] ⚠️ Combined score is NaN during execution update:', {
          creation_score,
          execution_score,
          weights: combinedWeights
        });
        combined_score = 5.0;
      }

      console.log(`✅ [AIS] Three-score system updated:`, {
        creation: creation_score.toFixed(2),
        execution: execution_score.toFixed(2),
        combined: combined_score.toFixed(2)
      });

      // 5. Update database with ALL THREE SCORES
      const { data, error } = await supabaseClient
        .from('agent_intensity_metrics')
        .update({
          ...updated,
          intensity_score,  // Old 4-component score (for backward compatibility)

          // NEW: Three-score system
          execution_score,  // ✅ Now calculated on every execution
          combined_score,   // ✅ Recalculated with latest execution_score

          // Four component scores
          token_complexity_score: componentScores.token_complexity.score,
          execution_complexity_score: componentScores.execution_complexity.score,
          plugin_complexity_score: componentScores.plugin_complexity.score,
          workflow_complexity_score: componentScores.workflow_complexity.score,

          last_calculated_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('agent_id', executionData.agent_id)
        .select()
        .single();

      if (error) {
        console.error('Error updating intensity metrics:', error);
        return null;
      }

      console.log(`✅ Intensity updated for agent ${executionData.agent_id}: ${intensity_score.toFixed(1)}`);

      const newMetrics = data as AgentIntensityMetrics;

      // Audit log the score update (only if scores actually changed)
      if (oldMetrics &&
          (Math.abs(oldMetrics.combined_score - newMetrics.combined_score) > 0.01 ||
           Math.abs(oldMetrics.execution_score - newMetrics.execution_score) > 0.01)) {

        const { data: agentData } = await supabaseClient
          .from('agents')
          .select('agent_name')
          .eq('id', executionData.agent_id)
          .single();

        const agentName = agentData?.agent_name || 'Unknown Agent';
        await logAISScoreUpdated(
          executionData.agent_id,
          agentName,
          executionData.user_id,
          oldMetrics,
          newMetrics,
          'Post-execution recalculation',
          ranges // Include normalization ranges in audit log
        );
      }

      return newMetrics;
    } catch (error) {
      console.error('Exception in updateMetricsFromExecution:', error);
      return null;
    }
  }

  /**
   * Get existing metrics for an agent
   */
  static async getMetrics(
    supabaseClient: SupabaseClient,
    agent_id: string
  ): Promise<AgentIntensityMetrics | null> {
    try {
      const { data, error } = await supabaseClient
        .from('agent_intensity_metrics')
        .select('*')
        .eq('agent_id', agent_id)
        .single();

      if (error || !data) {
        return null;
      }

      return data as AgentIntensityMetrics;
    } catch (error) {
      return null;
    }
  }

  /**
   * Get intensity breakdown with detailed components
   */
  static async getIntensityBreakdown(
    agent_id: string,
    supabaseClient: SupabaseClient = defaultSupabase
  ): Promise<IntensityBreakdown | null> {
    try {
      const metrics = await this.getMetrics(supabaseClient, agent_id);
      if (!metrics) return null;

      // Fetch agent design data for design_stats
      const { data: agent } = await supabaseClient
        .from('agents')
        .select('workflow_steps, input_schema, output_schema, connected_plugins, trigger_conditions')
        .eq('id', agent_id)
        .single();

      // Parse agent configuration to extract design stats
      let workflowStepsCount = 0;
      let connectedPluginsCount = 0;
      let inputFieldsCount = 0;
      let outputFieldsCount = 0;
      let triggerType = 'on_demand';

      if (agent) {
        const workflowSteps = typeof agent.workflow_steps === 'string'
          ? JSON.parse(agent.workflow_steps)
          : (agent.workflow_steps || []);
        const inputSchema = typeof agent.input_schema === 'string'
          ? JSON.parse(agent.input_schema)
          : (agent.input_schema || []);
        const outputSchema = typeof agent.output_schema === 'string'
          ? JSON.parse(agent.output_schema)
          : (agent.output_schema || []);
        const connectedPlugins = typeof agent.connected_plugins === 'string'
          ? JSON.parse(agent.connected_plugins)
          : (agent.connected_plugins || []);
        const triggerConditions = typeof agent.trigger_conditions === 'string'
          ? JSON.parse(agent.trigger_conditions)
          : (agent.trigger_conditions || {});

        workflowStepsCount = workflowSteps.length;
        connectedPluginsCount = connectedPlugins.length;
        inputFieldsCount = inputSchema.length;
        outputFieldsCount = outputSchema.length;

        // Determine trigger type
        if (triggerConditions.event_triggers && triggerConditions.event_triggers.length > 0) {
          triggerType = 'event-based';
        } else if (triggerConditions.schedule_cron) {
          triggerType = 'scheduled';
        }
      }

      // Phase 6: Fetch weights from database (no more hardcoded constants!)
      const creationWeights = await AISConfigService.getCreationWeights(supabaseClient);
      const executionWeights = await AISConfigService.getExecutionWeights(supabaseClient);

      // Creation component scores (4 dimensions) - database-driven weights
      const creationComponents: CreationComponentScores = {
        workflow_structure: {
          score: metrics.creation_workflow_score ?? 5.0,
          weight: creationWeights.workflow,
          weighted_score: (metrics.creation_workflow_score ?? 5.0) * creationWeights.workflow,
        },
        plugin_diversity: {
          score: metrics.creation_plugin_score ?? 5.0,
          weight: creationWeights.plugins,
          weighted_score: (metrics.creation_plugin_score ?? 5.0) * creationWeights.plugins,
        },
        io_schema: {
          score: metrics.creation_io_score ?? 5.0,
          weight: creationWeights.io_schema,
          weighted_score: (metrics.creation_io_score ?? 5.0) * creationWeights.io_schema,
        },
        trigger_type: {
          score: metrics.creation_trigger_score ?? 0.0,
          weight: 0.0,
          weighted_score: 0,
        },
      };

      // Execution component scores - database-driven weights
      const executionComponents: IntensityComponentScores = {
        token_complexity: {
          score: metrics.token_complexity_score,
          weight: executionWeights.tokens,
          weighted_score: metrics.token_complexity_score * executionWeights.tokens,
        },
        execution_complexity: {
          score: metrics.execution_complexity_score,
          weight: executionWeights.execution,
          weighted_score: metrics.execution_complexity_score * executionWeights.execution,
        },
        plugin_complexity: {
          score: metrics.plugin_complexity_score,
          weight: executionWeights.plugins,
          weighted_score: metrics.plugin_complexity_score * executionWeights.plugins,
        },
        workflow_complexity: {
          score: metrics.workflow_complexity_score,
          weight: executionWeights.workflow,
          weighted_score: metrics.workflow_complexity_score * executionWeights.workflow,
        },
        memory_complexity: {
          score: metrics.memory_complexity_score ?? 0,
          weight: executionWeights.memory,
          weighted_score: (metrics.memory_complexity_score ?? 0) * executionWeights.memory,
        },
      };

      return {
        // NEW: Three scores
        creation_score: metrics.creation_score,
        execution_score: metrics.execution_score,
        combined_score: metrics.combined_score,

        creation_multiplier: calculateCreationMultiplier(metrics.creation_score),
        execution_multiplier: calculateExecutionMultiplier(metrics.execution_score),
        combined_multiplier: calculateCombinedMultiplier(metrics.combined_score),

        // DEPRECATED but keep for backward compatibility
        overall_score: metrics.combined_score,
        pricing_multiplier: calculateCombinedMultiplier(metrics.combined_score),

        // NEW: Separate component breakdowns
        creation_components: creationComponents,
        execution_components: executionComponents,

        details: {
          creation_stats: {
            creation_tokens_used: metrics.creation_tokens_used,
            total_creation_cost_usd: metrics.total_creation_cost_usd,
            creation_complexity_score: metrics.creation_complexity_score,
            creation_efficiency_score: metrics.creation_token_efficiency_score,
          },
          design_stats: {
            workflow_steps: workflowStepsCount,
            connected_plugins: connectedPluginsCount,
            input_fields: inputFieldsCount,
            output_fields: outputFieldsCount,
            trigger_type: triggerType,
          },
          token_stats: {
            avg_tokens_per_run: metrics.avg_tokens_per_run,
            peak_tokens: metrics.peak_tokens_single_run,
            total_tokens: metrics.total_tokens_used,
            input_output_ratio: metrics.input_output_ratio,
          },
          execution_stats: {
            total_executions: metrics.total_executions,
            success_rate: metrics.success_rate,
            avg_duration_ms: metrics.avg_execution_duration_ms,
            avg_iterations: metrics.avg_iterations_per_run,
          },
          plugin_stats: {
            unique_plugins: metrics.unique_plugins_used,
            avg_plugins_per_run: metrics.avg_plugins_per_run,
            total_calls: metrics.total_plugin_calls,
            orchestration_overhead_ms: metrics.tool_orchestration_overhead_ms,
          },
          workflow_stats: {
            workflow_steps: metrics.workflow_steps_count,
            branches: metrics.conditional_branches_count,
            loops: metrics.loop_iterations_count,
            parallel_executions: metrics.parallel_execution_count,
          },
        },
      };
    } catch (error) {
      console.error('Exception in getIntensityBreakdown:', error);
      return null;
    }
  }

  /**
   * Calculate updated metrics by incorporating new execution data
   */
  private static calculateUpdatedMetrics(
    existing: AgentIntensityMetrics | null,
    execution: AgentExecutionData
  ): Partial<AgentIntensityMetrics> {
    const current = existing || { ...DEFAULT_INTENSITY_METRICS } as AgentIntensityMetrics;

    // Update execution counts
    const total_executions = current.total_executions + 1;
    const successful_executions = current.successful_executions + (execution.was_successful ? 1 : 0);
    const failed_executions = current.failed_executions + (execution.was_successful ? 0 : 1);

    // Update token statistics
    const total_tokens_used = current.total_tokens_used + execution.tokens_used;
    const avg_tokens_per_run = total_tokens_used / total_executions;
    const peak_tokens_single_run = Math.max(current.peak_tokens_single_run, execution.tokens_used);

    const input_output_ratio = execution.input_tokens && execution.output_tokens
      ? execution.output_tokens / execution.input_tokens
      : current.input_output_ratio;

    // Update execution statistics
    const total_iterations = current.total_iterations + execution.iterations_count;
    const avg_iterations_per_run = total_iterations / total_executions;

    const avg_execution_duration_ms = Math.round(
      (current.avg_execution_duration_ms * current.total_executions + execution.execution_duration_ms) / total_executions
    );
    const peak_execution_duration_ms = Math.max(current.peak_execution_duration_ms, execution.execution_duration_ms);

    // Update plugin statistics
    const total_plugin_calls = current.total_plugin_calls + execution.tool_calls_count;
    const unique_plugins_used = Math.max(current.unique_plugins_used, execution.plugins_used.length);
    const avg_plugins_per_run = execution.plugins_used.length > 0
      ? ((current.avg_plugins_per_run * current.total_executions) + execution.plugins_used.length) / total_executions
      : current.avg_plugins_per_run;

    const tool_orchestration_overhead_ms = execution.tool_orchestration_time_ms
      ? Math.round(((current.tool_orchestration_overhead_ms * current.total_executions) + execution.tool_orchestration_time_ms) / total_executions)
      : current.tool_orchestration_overhead_ms;

    // Update workflow statistics
    const workflow_steps_count = execution.workflow_steps
      ? Math.max(current.workflow_steps_count, execution.workflow_steps)
      : current.workflow_steps_count;
    const conditional_branches_count = execution.conditional_branches
      ? Math.max(current.conditional_branches_count, execution.conditional_branches)
      : current.conditional_branches_count;
    const loop_iterations_count = execution.loop_iterations
      ? current.loop_iterations_count + execution.loop_iterations
      : current.loop_iterations_count;
    const parallel_execution_count = execution.parallel_executions
      ? Math.max(current.parallel_execution_count, execution.parallel_executions)
      : current.parallel_execution_count;

    // Calculate reliability metrics
    const success_rate = (successful_executions / total_executions) * 100;
    const retry_rate = execution.retry_count
      ? ((current.retry_rate * current.total_executions) + execution.retry_count) / total_executions
      : current.retry_rate;
    const error_recovery_count = execution.retry_count && execution.was_successful
      ? current.error_recovery_count + 1
      : current.error_recovery_count;

    // Update resource usage
    const memory_footprint_mb = execution.memory_usage_mb
      ? Math.round(((current.memory_footprint_mb * current.total_executions) + execution.memory_usage_mb) / total_executions)
      : current.memory_footprint_mb;
    const api_calls_per_run = execution.api_calls
      ? ((current.api_calls_per_run * current.total_executions) + execution.api_calls) / total_executions
      : current.api_calls_per_run;

    return {
      total_executions,
      successful_executions,
      failed_executions,
      total_tokens_used,
      avg_tokens_per_run,
      peak_tokens_single_run,
      input_output_ratio,
      total_iterations,
      avg_iterations_per_run,
      avg_execution_duration_ms,
      peak_execution_duration_ms,
      total_plugin_calls,
      unique_plugins_used,
      avg_plugins_per_run,
      tool_orchestration_overhead_ms,
      workflow_steps_count,
      conditional_branches_count,
      loop_iterations_count,
      parallel_execution_count,
      success_rate,
      retry_rate,
      error_recovery_count,
      memory_footprint_mb,
      api_calls_per_run,
    };
  }

  /**
   * Calculate creation score components (4 dimensions)
   * Based on agent DESIGN complexity, not creation tokens
   * Now uses database-driven weights - NO MORE HARDCODING!
   */
  private static async calculateCreationScores(
    supabaseClient: SupabaseClient,
    agent_id: string
  ): Promise<CreationComponentScores> {
    // Fetch AIS ranges and creation weights from database (Phase 5: database-driven)
    const ranges = await AISConfigService.getRanges(supabaseClient);
    const creationWeights = await AISConfigService.getCreationWeights(supabaseClient);

    // Fetch agent configuration to analyze design complexity
    const { data: agent, error } = await supabaseClient
      .from('agents')
      .select('workflow_steps, input_schema, output_schema, connected_plugins, trigger_conditions, system_prompt')
      .eq('id', agent_id)
      .single();

    if (error || !agent) {
      console.warn('⚠️ [AIS] Could not fetch agent data for creation score, using defaults');
      // Return default medium complexity (4 dimensions)
      return {
        workflow_structure: { score: 5.0, weight: 0.5, weighted_score: 2.5 },
        plugin_diversity: { score: 5.0, weight: 0.3, weighted_score: 1.5 },
        io_schema: { score: 5.0, weight: 0.2, weighted_score: 1.0 },
        trigger_type: { score: 0.0, weight: 0.0, weighted_score: 0.0 },
      };
    }

    // Parse agent configuration (handle both string and object types from Supabase)
    const workflowSteps = typeof agent.workflow_steps === 'string'
      ? JSON.parse(agent.workflow_steps)
      : (agent.workflow_steps || []);
    const inputSchema = typeof agent.input_schema === 'string'
      ? JSON.parse(agent.input_schema)
      : (agent.input_schema || []);
    const outputSchema = typeof agent.output_schema === 'string'
      ? JSON.parse(agent.output_schema)
      : (agent.output_schema || []);
    const connectedPlugins = typeof agent.connected_plugins === 'string'
      ? JSON.parse(agent.connected_plugins)
      : (agent.connected_plugins || []);
    const triggerConditions = typeof agent.trigger_conditions === 'string'
      ? JSON.parse(agent.trigger_conditions)
      : (agent.trigger_conditions || {});

    // === CREATION SCORE (4 DIMENSIONS) ===
    // Based ONLY on agent design complexity (what model needs to handle)
    // Range: Simple agents (1-3) → Medium (4-6) → Complex (7-10)

    // 1. Workflow complexity (0-10) - 50% weight
    // Simple sequential (1-3 steps) = 1-2
    // Medium workflows (4-6 steps) = 3-5
    // Complex workflows (7+ steps with branching/loops) = 6-10
    const workflowScore = AISConfigService.normalize(
      workflowSteps.length,
      ranges.creation_workflow_steps
    );

    // 2. Plugin diversity (0-10) - 30% weight
    // Single plugin = 1-2
    // Multiple plugins (2-3) = 3-5
    // Many plugins (4+) = 6-10
    const pluginScore = AISConfigService.normalize(
      connectedPlugins.length,
      ranges.creation_plugins
    );

    // 3. I/O Schema complexity (0-10) - 20% weight
    // Simple I/O (1-2 fields) = 1-2
    // Medium I/O (3-5 fields) = 3-5
    // Complex I/O (6+ fields) = 6-10
    const ioFieldCount = inputSchema.length + outputSchema.length;
    const ioScore = AISConfigService.normalize(
      ioFieldCount,
      ranges.creation_io_fields
    );

    // 4. Trigger complexity (bonus, not weighted)
    // on_demand = +0, scheduled = +1, event-based = +2
    let triggerBonus = 0;
    if (triggerConditions.schedule_cron) triggerBonus = 1;
    if (triggerConditions.event_triggers && triggerConditions.event_triggers.length > 0) triggerBonus = 2;

    // Use database-driven weights (Phase 5: no more fallbacks!)
    const workflowWeight = creationWeights.workflow;
    const pluginWeight = creationWeights.plugins;
    const ioWeight = creationWeights.io_schema;

    return {
      workflow_structure: {
        score: this.clamp(workflowScore, 0, 10),
        weight: workflowWeight,
        weighted_score: this.clamp(workflowScore, 0, 10) * workflowWeight,
      },
      plugin_diversity: {
        score: this.clamp(pluginScore, 0, 10),
        weight: pluginWeight,
        weighted_score: this.clamp(pluginScore, 0, 10) * pluginWeight,
      },
      io_schema: {
        score: this.clamp(ioScore, 0, 10),
        weight: ioWeight,
        weighted_score: this.clamp(ioScore, 0, 10) * ioWeight,
      },
      trigger_type: {
        score: triggerBonus,
        weight: 0.0, // Bonus only, not weighted
        weighted_score: 0,
      },
    };
  }

  /**
   * Calculate overall creation score from creation components (4 dimensions)
   */
  private static calculateCreationOverallScore(components: CreationComponentScores): number {
    const baseScore =
      components.workflow_structure.weighted_score +
      components.plugin_diversity.weighted_score +
      components.io_schema.weighted_score;

    // Add trigger bonus (not weighted)
    const overall = Math.min(10, baseScore + components.trigger_type.score);

    return this.clamp(overall, 0, 10);
  }

  /**
   * Calculate component scores (0-10) based on metrics
   * Now uses database-driven ranges AND weights - NO MORE HARDCODING!
   */
  private static async calculateComponentScores(
    metrics: Partial<AgentIntensityMetrics>,
    ranges: import('./AISConfigService').AISRanges,
    supabase: import('@supabase/supabase-js').SupabaseClient
  ): Promise<IntensityComponentScores> {
    // Fetch scoring weights from database
    const tokenWeights = await AISConfigService.getScoringWeights(supabase, 'token_complexity');
    const execWeights = await AISConfigService.getScoringWeights(supabase, 'execution_complexity');
    const pluginWeights = await AISConfigService.getScoringWeights(supabase, 'plugin_complexity');
    const workflowWeights = await AISConfigService.getScoringWeights(supabase, 'workflow_complexity');

    // Phase 6: Fetch main dimension weights from database (no more EXECUTION_WEIGHTS constant!)
    const executionWeights = await AISConfigService.getExecutionWeights(supabase);

    // TOKEN COMPLEXITY (35% weight)
    // Based on: volume, efficiency, peak usage, input/output ratio
    const tokenVolumeScore = AISConfigService.normalize(metrics.avg_tokens_per_run || 0, ranges.token_volume);
    const tokenPeakScore = AISConfigService.normalize(metrics.peak_tokens_single_run || 0, ranges.token_peak);
    const tokenEfficiencyScore = metrics.input_output_ratio
      ? this.normalizeToScale(metrics.input_output_ratio, ranges.token_io_ratio_min, ranges.token_io_ratio_max, 10, 0) // Lower ratio = more efficient
      : 5.0;
    const token_complexity_score = (
      tokenVolumeScore * (tokenWeights.volume || 0.5) +
      tokenPeakScore * (tokenWeights.peak || 0.3) +
      tokenEfficiencyScore * (tokenWeights.efficiency || 0.2)
    );

    // EXECUTION COMPLEXITY (25% weight)
    // Based on: iterations, duration, failure rate, retry rate
    const iterationScore = AISConfigService.normalize(metrics.avg_iterations_per_run || 1, ranges.iterations);
    const durationScore = AISConfigService.normalize(metrics.avg_execution_duration_ms || 0, ranges.duration_ms);
    const failureRateScore = metrics.success_rate
      ? AISConfigService.normalize(100 - metrics.success_rate, ranges.failure_rate) // More failures = higher complexity
      : 0;
    const retryScore = AISConfigService.normalize(metrics.retry_rate || 0, ranges.retry_rate);
    const execution_complexity_score = (
      iterationScore * (execWeights.iterations || 0.35) +
      durationScore * (execWeights.duration || 0.30) +
      failureRateScore * (execWeights.failures || 0.20) +
      retryScore * (execWeights.retries || 0.15)
    );

    // PLUGIN COMPLEXITY (25% weight)
    // Based on: number of plugins, orchestration overhead, call frequency
    const pluginCountScore = AISConfigService.normalize(metrics.unique_plugins_used || 0, ranges.plugin_count);
    const pluginFrequencyScore = AISConfigService.normalize(metrics.avg_plugins_per_run || 0, ranges.plugins_per_run);
    const orchestrationScore = AISConfigService.normalize(metrics.tool_orchestration_overhead_ms || 0, ranges.orchestration_overhead_ms);
    const plugin_complexity_score = (
      pluginCountScore * (pluginWeights.count || 0.4) +
      pluginFrequencyScore * (pluginWeights.frequency || 0.35) +
      orchestrationScore * (pluginWeights.orchestration || 0.25)
    );

    // WORKFLOW COMPLEXITY (15% weight)
    // Based on: steps, branches, loops, parallel executions
    const stepsScore = AISConfigService.normalize(metrics.workflow_steps_count || 0, ranges.workflow_steps);
    const branchScore = AISConfigService.normalize(metrics.conditional_branches_count || 0, ranges.branches);
    const loopScore = AISConfigService.normalize(metrics.loop_iterations_count || 0, ranges.loops);
    const parallelScore = AISConfigService.normalize(metrics.parallel_execution_count || 0, ranges.parallel);
    const workflow_complexity_score = (
      stepsScore * (workflowWeights.steps || 0.4) +
      branchScore * (workflowWeights.branches || 0.25) +
      loopScore * (workflowWeights.loops || 0.20) +
      parallelScore * (workflowWeights.parallel || 0.15)
    );

    // Phase 6: Use database-driven weights instead of EXECUTION_WEIGHTS constant
    return {
      token_complexity: {
        score: this.clamp(token_complexity_score, 0, 10),
        weight: executionWeights.tokens,
        weighted_score: this.clamp(token_complexity_score, 0, 10) * executionWeights.tokens,
      },
      execution_complexity: {
        score: this.clamp(execution_complexity_score, 0, 10),
        weight: executionWeights.execution,
        weighted_score: this.clamp(execution_complexity_score, 0, 10) * executionWeights.execution,
      },
      plugin_complexity: {
        score: this.clamp(plugin_complexity_score, 0, 10),
        weight: executionWeights.plugins,
        weighted_score: this.clamp(plugin_complexity_score, 0, 10) * executionWeights.plugins,
      },
      workflow_complexity: {
        score: this.clamp(workflow_complexity_score, 0, 10),
        weight: executionWeights.workflow,
        weighted_score: this.clamp(workflow_complexity_score, 0, 10) * executionWeights.workflow,
      },
      memory_complexity: {
        score: this.clamp(metrics.memory_complexity_score || 0, 0, 10),
        weight: executionWeights.memory,
        weighted_score: this.clamp(metrics.memory_complexity_score || 0, 0, 10) * executionWeights.memory,
      },
    };
  }

  /**
   * Calculate overall intensity score from component scores
   */
  private static calculateOverallScore(components: IntensityComponentScores): number {
    // ✅ Add NaN validation to prevent NULL constraint violations
    const tokenScore = components.token_complexity.weighted_score;
    const execScore = components.execution_complexity.weighted_score;
    const pluginScore = components.plugin_complexity.weighted_score;
    const workflowScore = components.workflow_complexity.weighted_score;

    // Check for NaN values and provide fallback
    if (isNaN(tokenScore) || isNaN(execScore) || isNaN(pluginScore) || isNaN(workflowScore)) {
      console.error('[AIS] ⚠️ NaN detected in component scores:', {
        token: tokenScore,
        execution: execScore,
        plugin: pluginScore,
        workflow: workflowScore
      });
      // Return middle-ground default if any component is NaN
      return 5.0;
    }

    const overall = tokenScore + execScore + pluginScore + workflowScore;

    // ✅ Final NaN check before returning
    if (isNaN(overall)) {
      console.error('[AIS] ⚠️ Overall score is NaN, using default 5.0');
      return 5.0;
    }

    return this.clamp(overall, 0, 10);
  }

  /**
   * Normalize a value from input range to output range
   */
  private static normalizeToScale(
    value: number,
    inMin: number,
    inMax: number,
    outMin: number,
    outMax: number
  ): number {
    // ✅ Handle edge cases that could cause NaN
    if (isNaN(value)) {
      console.warn('[AIS] normalizeToScale received NaN value, using outMin');
      return outMin;
    }

    if (inMax === inMin) {
      console.warn('[AIS] normalizeToScale: inMax === inMin, returning middle value');
      return (outMin + outMax) / 2;
    }

    const clamped = Math.max(inMin, Math.min(inMax, value));
    const normalized = outMin + ((clamped - inMin) * (outMax - outMin)) / (inMax - inMin);

    // ✅ Check result for NaN
    if (isNaN(normalized)) {
      console.error('[AIS] normalizeToScale produced NaN:', { value, inMin, inMax, outMin, outMax });
      return outMin;
    }

    return normalized;
  }

  /**
   * Clamp value between min and max
   */
  private static clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
  }
}
