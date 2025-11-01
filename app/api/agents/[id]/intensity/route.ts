// app/api/agents/[id]/intensity/route.ts
// API endpoint to get agent intensity breakdown

import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';
import {
  EXECUTION_WEIGHTS,
  calculateCreationMultiplier,
  calculateExecutionMultiplier,
  calculateCombinedMultiplier,
  DEFAULT_INTENSITY_METRICS,
} from '@/lib/types/intensity';
import type {
  IntensityBreakdown,
  IntensityComponentScores,
  CreationComponentScores,
  AgentIntensityMetrics,
} from '@/lib/types/intensity';
import { AISConfigService } from '@/lib/services/AISConfigService';
import type { SupabaseClient } from '@supabase/supabase-js';

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const cookieStore = await cookies();
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          get: (name) => cookieStore.get(name)?.value,
          set: async () => {},
          remove: async () => {},
        },
      }
    );

    // Get authenticated user
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
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

    if (agent.user_id !== user.id) {
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
          user_id: user.id,
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
      return NextResponse.json(breakdown);
    }

    // Build and return breakdown
    const breakdown = await buildIntensityBreakdown(supabase, metrics as AgentIntensityMetrics, agent);
    return NextResponse.json(breakdown);

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

  // Creation component scores (4 dimensions)
  const creationComponents: CreationComponentScores = {
    workflow_structure: {
      score: workflowScore,
      weight: 0.5,
      weighted_score: workflowScore * 0.5,
    },
    plugin_diversity: {
      score: pluginScore,
      weight: 0.3,
      weighted_score: pluginScore * 0.3,
    },
    io_schema: {
      score: ioScore,
      weight: 0.2,
      weighted_score: ioScore * 0.2,
    },
    trigger_type: {
      score: triggerBonus,
      weight: 0.0, // Bonus, not weighted
      weighted_score: 0,
    },
  };

  // Execution component scores (4 components)
  const executionComponents: IntensityComponentScores = {
    token_complexity: {
      score: metrics.token_complexity_score,
      weight: EXECUTION_WEIGHTS.TOKEN_COMPLEXITY,
      weighted_score: metrics.token_complexity_score * EXECUTION_WEIGHTS.TOKEN_COMPLEXITY,
    },
    execution_complexity: {
      score: metrics.execution_complexity_score,
      weight: EXECUTION_WEIGHTS.EXECUTION_COMPLEXITY,
      weighted_score: metrics.execution_complexity_score * EXECUTION_WEIGHTS.EXECUTION_COMPLEXITY,
    },
    plugin_complexity: {
      score: metrics.plugin_complexity_score,
      weight: EXECUTION_WEIGHTS.PLUGIN_COMPLEXITY,
      weighted_score: metrics.plugin_complexity_score * EXECUTION_WEIGHTS.PLUGIN_COMPLEXITY,
    },
    workflow_complexity: {
      score: metrics.workflow_complexity_score,
      weight: EXECUTION_WEIGHTS.WORKFLOW_COMPLEXITY,
      weighted_score: metrics.workflow_complexity_score * EXECUTION_WEIGHTS.WORKFLOW_COMPLEXITY,
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
}
