// app/api/agents/[id]/intensity/route.ts
// API endpoint to get agent intensity breakdown

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import {
  calculateCreationMultiplier,
  calculateExecutionMultiplier,
  calculateCombinedMultiplier,
  DEFAULT_INTENSITY_METRICS,
} from '@/lib/types/intensity';
// Phase 6: Removed EXECUTION_WEIGHTS import - now using database-driven weights
import type {
  IntensityBreakdown,
  IntensityComponentScores,
  CreationComponentScores,
  AgentIntensityMetrics,
} from '@/lib/types/intensity';
import { AISConfigService } from '@/lib/services/AISConfigService';
import { SystemConfigService } from '@/lib/services/SystemConfigService';
import type { SupabaseClient } from '@supabase/supabase-js';

// Initialize Supabase client with Service Role Key
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// Helper function to extract user ID from request
function getUserIdFromRequest(request: NextRequest): string | null {
  const userIdHeader = request.headers.get('x-user-id');
  const authHeader = request.headers.get('authorization');

  if (userIdHeader) {
    return userIdHeader;
  }

  if (authHeader && authHeader.startsWith('Bearer ')) {
    // JWT token handling would go here
  }

  return null;
}

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const userId = getUserIdFromRequest(request);

    if (!userId) {
      return NextResponse.json(
        {
          success: false,
          error: 'Unauthorized - Please provide user authentication',
          details: 'Missing x-user-id header or authorization token'
        },
        { status: 401 }
      );
    }

    const agentId = params.id;

    // Verify agent belongs to user and fetch design data
    const { data: agent, error: agentError } = await supabase
      .from('agents')
      .select('id, user_id, workflow_steps, connected_plugins, input_schema, output_schema, trigger_conditions')
      .eq('id', agentId)
      .single();

    if (agentError || !agent) {
      return NextResponse.json({ error: 'Agent not found' }, { status: 404 });
    }

    if (agent.user_id !== userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    // Get intensity metrics
    const { data: metrics, error: metricsError } = await supabase
      .from('agent_intensity_metrics')
      .select('*')
      .eq('agent_id', agentId)
      .single();

    if (metricsError || !metrics) {
      // Initialize metrics if they don't exist
      const { data: newMetrics, error: insertError } = await supabase
        .from('agent_intensity_metrics')
        .insert({
          agent_id: agentId,
          user_id: userId,
          ...DEFAULT_INTENSITY_METRICS,
        })
        .select()
        .single();

      if (insertError || !newMetrics) {
        return NextResponse.json(
          { error: 'Unable to initialize intensity metrics' },
          { status: 500 }
        );
      }

      // Use newly created metrics
      const breakdown = await buildIntensityBreakdown(supabase, newMetrics as AgentIntensityMetrics, agent);

      // Fetch routing configuration for UI to determine which model would be selected
      const routingConfig = await SystemConfigService.getRoutingConfig(supabase);

      return NextResponse.json({
        ...breakdown,
        routing_config: {
          lowThreshold: routingConfig.lowThreshold,
          mediumThreshold: routingConfig.mediumThreshold,
          anthropicEnabled: routingConfig.anthropicEnabled,
        }
      });
    }

    // Build and return breakdown with routing config
    const breakdown = await buildIntensityBreakdown(supabase, metrics as AgentIntensityMetrics, agent);

    // Fetch routing configuration for UI to determine which model would be selected
    const routingConfig = await SystemConfigService.getRoutingConfig(supabase);

    return NextResponse.json({
      ...breakdown,
      routing_config: {
        lowThreshold: routingConfig.lowThreshold,
        mediumThreshold: routingConfig.mediumThreshold,
        anthropicEnabled: routingConfig.anthropicEnabled,
      }
    });

  } catch (error) {
    console.error('Error fetching agent intensity:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * Build intensity breakdown from metrics
 */
async function buildIntensityBreakdown(
  supabase: SupabaseClient,
  metrics: AgentIntensityMetrics,
  agent: any
): Promise<IntensityBreakdown> {
  // CRITICAL FIX: Get creation tokens from token_usage table
  // agent_intensity_metrics.total_tokens_used only includes execution tokens
  // We need to add creation tokens for accurate total
  // ✅ FIX: Fetch ALL creation token records and sum them (not just one with .maybeSingle())
  const { data: creationTokenRecords, error: creationError } = await supabase
    .from('token_usage')
    .select('input_tokens, output_tokens')
    .eq('agent_id', agent.id)
    .eq('activity_type', 'agent_creation');

  console.log(`[Intensity API] Creation token records for agent ${agent.id}:`, {
    found: !!creationTokenRecords,
    count: creationTokenRecords?.length || 0,
    error: creationError,
    records: creationTokenRecords
  });

  // Sum ALL creation token records
  const creationTokens = creationTokenRecords
    ? creationTokenRecords.reduce((sum, record) => sum + (record.input_tokens || 0) + (record.output_tokens || 0), 0)
    : 0;

  if (creationError) {
    console.warn('[Intensity API] Could not fetch creation tokens:', creationError);
  } else {
    console.log(`[Intensity API] ✅ Total creation tokens for agent ${agent.id}: ${creationTokens} (from ${creationTokenRecords?.length || 0} records)`);
  }

  // Phase 6: Load weights from database (no more hardcoded constants!)
  const executionWeights = await AISConfigService.getExecutionWeights(supabase);
  const creationWeights = await AISConfigService.getCreationWeights(supabase);

  // Parse agent design data
  const workflowSteps = typeof agent.workflow_steps === 'string'
    ? JSON.parse(agent.workflow_steps)
    : (agent.workflow_steps || []);
  const connectedPlugins = typeof agent.connected_plugins === 'string'
    ? JSON.parse(agent.connected_plugins)
    : (agent.connected_plugins || []);
  const inputSchema = typeof agent.input_schema === 'string'
    ? JSON.parse(agent.input_schema)
    : (agent.input_schema || []);
  const outputSchema = typeof agent.output_schema === 'string'
    ? JSON.parse(agent.output_schema)
    : (agent.output_schema || []);
  const triggerConditions = typeof agent.trigger_conditions === 'string'
    ? JSON.parse(agent.trigger_conditions)
    : (agent.trigger_conditions || {});

  // Fetch AIS ranges from database (same logic as AgentIntensityService)
  const ranges = await AISConfigService.getRanges(supabase);

  // Calculate design dimension scores using database-driven ranges
  const workflowScore = AISConfigService.normalize(workflowSteps.length, ranges.creation_workflow_steps);
  const pluginScore = AISConfigService.normalize(connectedPlugins.length, ranges.creation_plugins);
  const ioFieldCount = inputSchema.length + outputSchema.length;
  const ioScore = AISConfigService.normalize(ioFieldCount, ranges.creation_io_fields);

  let triggerBonus = 0;
  let triggerType = 'on-demand';
  if (triggerConditions.schedule_cron) {
    triggerBonus = 1;
    triggerType = 'scheduled';
  }
  if (triggerConditions.event_triggers && triggerConditions.event_triggers.length > 0) {
    triggerBonus = 2;
    triggerType = 'event-based';
  }

  // Handle null values for agents created before three-score migration
  const creation_score = metrics.creation_score ?? 5.0;
  const creation_complexity_score = metrics.creation_complexity_score ?? 5.0;
  const creation_token_efficiency_score = metrics.creation_token_efficiency_score ?? 5.0;
  const execution_score = metrics.execution_score ?? metrics.intensity_score; // Fallback to old score
  const combined_score = metrics.combined_score ?? metrics.intensity_score; // Fallback to old score

  // Creation component scores (4 dimensions) - Phase 6: Database-driven weights
  const creationComponents: CreationComponentScores = {
    workflow_structure: {
      score: workflowScore,
      weight: creationWeights.workflow,
      weighted_score: workflowScore * creationWeights.workflow,
    },
    plugin_diversity: {
      score: pluginScore,
      weight: creationWeights.plugins,
      weighted_score: pluginScore * creationWeights.plugins,
    },
    io_schema: {
      score: ioScore,
      weight: creationWeights.io_schema,
      weighted_score: ioScore * creationWeights.io_schema,
    },
    trigger_type: {
      score: triggerBonus,
      weight: 0.0, // Bonus, not weighted
      weighted_score: 0,
    },
  };

  // Execution component scores (5 components - includes memory) - Phase 6: Database-driven weights
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
    // === THREE SCORES ===
    creation_score: creation_score,
    execution_score: execution_score,
    combined_score: combined_score,

    creation_multiplier: calculateCreationMultiplier(creation_score),
    execution_multiplier: calculateExecutionMultiplier(execution_score),
    combined_multiplier: calculateCombinedMultiplier(combined_score),

    // DEPRECATED: Keep for backward compatibility
    overall_score: combined_score,
    pricing_multiplier: calculateCombinedMultiplier(combined_score),

    // === COMPONENT BREAKDOWNS ===
    creation_components: creationComponents,
    execution_components: executionComponents,

    details: {
      creation_stats: {
        creation_tokens_used: metrics.creation_tokens_used || 0,
        total_creation_cost_usd: metrics.total_creation_cost_usd || 0,
        creation_complexity_score: creation_complexity_score,
        creation_efficiency_score: creation_token_efficiency_score,
      },
      design_stats: {
        workflow_steps: workflowSteps.length,
        connected_plugins: connectedPlugins.length,
        input_fields: inputSchema.length,
        output_fields: outputSchema.length,
        trigger_type: triggerType,
      },
      token_stats: {
        avg_tokens_per_run: metrics.avg_tokens_per_run,
        peak_tokens: metrics.peak_tokens_single_run,
        total_tokens_execution_only: metrics.total_tokens_used, // Execution tokens only (old field)
        total_tokens_creation: creationTokens, // Creation tokens from token_usage table
        total_tokens: metrics.total_tokens_used + creationTokens, // ACCURATE TOTAL (execution + creation)
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
      memory_stats: {
        avg_memory_tokens_per_run: metrics.avg_memory_tokens_per_run ?? 0,
        memory_token_ratio: metrics.memory_token_ratio ?? 0,
        memory_entry_count: metrics.memory_entry_count ?? 0,
        memory_type_diversity: metrics.memory_type_diversity ?? 0,
      },
    },
  };
}
