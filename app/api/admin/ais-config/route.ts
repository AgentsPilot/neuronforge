// app/api/admin/ais-config/route.ts
// Admin API for managing AIS configuration

import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import {
  snapshotNormalizationRanges,
  snapshotAllAgentScores,
  logAISNormalizationRefreshStarted,
  logAISNormalizationRefreshCompleted,
  logAISScoresBulkRecalculated
} from '@/lib/audit/ais-helpers';
import {
  logAISModeSwitch,
  logAISThresholdUpdate
} from '@/lib/audit/admin-helpers';

// Initialize service role client for admin operations
const supabaseServiceRole = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET - Fetch current AIS configuration
export async function GET() {
  try {
    // TODO: Add admin role check here
    // For now, using service role to fetch data (same as reward-config)

    // Get all ranges (active_mode is stored in each row of ais_normalization_ranges)
    console.log('🔍 [AIS Config] Fetching normalization ranges...');
    const { data: ranges, error: rangesError } = await supabaseServiceRole
      .from('ais_normalization_ranges')
      .select('*')
      .order('category', { ascending: true })
      .order('range_key', { ascending: true });

    if (rangesError) {
      console.error('❌ [AIS Config] Error fetching AIS ranges:', rangesError);
      return NextResponse.json({ success: false, error: 'Failed to fetch ranges: ' + rangesError.message }, { status: 500 });
    }

    console.log('✅ [AIS Config] Found', ranges?.length || 0, 'ranges');

    // Get mode and threshold from first range (all rows have the same values)
    const firstRange = ranges?.[0];
    const currentMode = firstRange?.active_mode === 1 ? 'dynamic' : 'best_practice';
    const minExecutionsRequired = firstRange?.min_executions_threshold || 10;

    // Extract growth thresholds (all rows have same values, use first)
    const growthThresholds = {
      monitorThreshold: firstRange?.output_token_growth_monitor_threshold || 25,
      rescoreThreshold: firstRange?.output_token_growth_rescore_threshold || 50,
      upgradeThreshold: firstRange?.output_token_growth_upgrade_threshold || 100,
      monitorAdjustment: firstRange?.output_token_growth_monitor_adjustment || 0.2,
      rescoreAdjustment: firstRange?.output_token_growth_rescore_adjustment || 0.75,
      upgradeAdjustment: firstRange?.output_token_growth_upgrade_adjustment || 1.25,
      qualitySuccessThreshold: firstRange?.quality_success_threshold || 80,
      qualityRetryThreshold: firstRange?.quality_retry_threshold || 30,
      qualitySuccessMultiplier: firstRange?.quality_success_multiplier || 0.3,
      qualityRetryMultiplier: firstRange?.quality_retry_multiplier || 0.2
    };

    console.log('✅ [AIS Config] Active mode:', currentMode, '(', firstRange?.active_mode, ')');
    console.log('✅ [AIS Config] Growth thresholds loaded:', growthThresholds);

    // Get statistics about data points from production data
    console.log('🔍 [AIS Config] Fetching production stats from agents table and token_usage...');

    // First, get all current agent IDs from agents table
    const { data: currentAgents, error: agentsFetchError } = await supabaseServiceRole
      .from('agents')
      .select('id');

    if (agentsFetchError) {
      console.error('❌ [AIS Config] Error fetching agents:', agentsFetchError);
    }

    const currentAgentIds = new Set(currentAgents?.map(a => a.id) || []);
    console.log(`📊 [AIS Config] Current agents in database: ${currentAgentIds.size}`);

    // Get agent-related usage from token_usage table
    const { data: usageStats, error: usageError } = await supabaseServiceRole
      .from('token_usage')
      .select('input_tokens, output_tokens, activity_type, agent_id')
      .in('activity_type', ['agent_creation', 'agent_generation', 'agent_execution']);

    if (usageError) {
      console.error('❌ [AIS Config] Error fetching usage stats:', usageError);
    }

    // Filter to only include records for agents that currently exist
    const currentAgentUsage = usageStats?.filter(u =>
      u.agent_id && currentAgentIds.has(u.agent_id)
    ) || [];

    // Also check for records without agent_id
    const recordsWithoutAgentId = usageStats?.filter(u => !u.agent_id) || [];
    const recordsWithDeletedAgents = usageStats?.filter(u =>
      u.agent_id && !currentAgentIds.has(u.agent_id)
    ) || [];

    // Separate creation and execution records (for current agents only)
    const creationRecords = currentAgentUsage.filter(u =>
      u.activity_type === 'agent_creation' || u.activity_type === 'agent_generation'
    );

    const executionRecords = currentAgentUsage.filter(u =>
      u.activity_type === 'agent_execution'
    );

    console.log(`\n📊 ========== AIS CONFIG STATISTICS BREAKDOWN ==========`);
    console.log(`\n1️⃣ AGENTS:`);
    console.log(`   Current agents in database: ${currentAgentIds.size}`);
    console.log(`   Agent IDs: [${Array.from(currentAgentIds).slice(0, 3).join(', ')}${currentAgentIds.size > 3 ? '...' : ''}]`);

    console.log(`\n2️⃣ TOKEN USAGE RECORDS:`);
    console.log(`   Total records in token_usage: ${usageStats?.length || 0}`);
    console.log(`   - For current agents: ${currentAgentUsage.length}`);
    console.log(`   - Without agent_id (orphaned): ${recordsWithoutAgentId.length}`);
    console.log(`   - For deleted agents: ${recordsWithDeletedAgents.length}`);

    console.log(`\n3️⃣ ACTIVITY BREAKDOWN (Current Agents Only):`);
    console.log(`   Creation activities (agent_creation + agent_generation): ${creationRecords.length}`);
    console.log(`   Execution activities (agent_execution): ${executionRecords.length}`);

    // Count by activity type
    const creationByType = creationRecords.reduce((acc, r) => {
      acc[r.activity_type] = (acc[r.activity_type] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);
    console.log(`   - By type:`, creationByType);

    // Use count from agents table (always accurate)
    const totalAgents = currentAgentIds.size;
    const totalCreations = creationRecords.length;
    const totalExecutions = executionRecords.length;

    // Total tokens from current agents' activities only
    const creationTokens = creationRecords.reduce((sum, u) => sum + (u.input_tokens || 0) + (u.output_tokens || 0), 0);
    const executionTokens = executionRecords.reduce((sum, u) => sum + (u.input_tokens || 0) + (u.output_tokens || 0), 0);
    const totalTokens = creationTokens + executionTokens;

    // Sample data for debugging
    const sampleCreation = creationRecords[0];
    const sampleExecution = executionRecords[0];

    console.log(`\n4️⃣ TOKEN USAGE (Current Agents Only):`);
    console.log(`   Creation tokens: ${creationTokens.toLocaleString()}`);
    console.log(`   Execution tokens: ${executionTokens.toLocaleString()}`);
    console.log(`   TOTAL: ${totalTokens.toLocaleString()}`);

    if (sampleCreation) {
      console.log(`\n   Sample creation record:`);
      console.log(`   - Agent: ${sampleCreation.agent_id?.slice(0, 8)}...`);
      console.log(`   - Input tokens: ${sampleCreation.input_tokens}`);
      console.log(`   - Output tokens: ${sampleCreation.output_tokens}`);
      console.log(`   - Total: ${(sampleCreation.input_tokens || 0) + (sampleCreation.output_tokens || 0)}`);
    }

    if (sampleExecution) {
      console.log(`\n   Sample execution record:`);
      console.log(`   - Agent: ${sampleExecution.agent_id?.slice(0, 8)}...`);
      console.log(`   - Input tokens: ${sampleExecution.input_tokens}`);
      console.log(`   - Output tokens: ${sampleExecution.output_tokens}`);
      console.log(`   - Total: ${(sampleExecution.input_tokens || 0) + (sampleExecution.output_tokens || 0)}`);
    }

    console.log(`\n5️⃣ FINAL STATISTICS RETURNED TO UI:`);
    console.log(`   Total Agents: ${totalAgents} (unique agents in database)`);
    console.log(`   Total Creations: ${totalCreations} (LLM calls during agent creation)`);
    console.log(`   Total Executions: ${totalExecutions} (LLM calls during agent execution)`);
    console.log(`   Total Tokens: ${totalTokens.toLocaleString()} (${(totalTokens / 1000000).toFixed(2)}M)`);
    console.log(`     - Creation avg: ${creationRecords.length > 0 ? Math.round(creationTokens / creationRecords.length).toLocaleString() : 0} tokens/call`);
    console.log(`     - Execution avg: ${executionRecords.length > 0 ? Math.round(executionTokens / executionRecords.length).toLocaleString() : 0} tokens/call`);

    console.log(`\n⚠️  IMPORTANT NOTES:`);
    console.log(`   - "Total Creations" = number of LLM API calls made DURING agent creation`);
    console.log(`   - Each agent creation may involve multiple LLM calls (analysis, generation, validation)`);
    console.log(`   - "Total Executions" = number of LLM API calls made DURING agent runs`);
    console.log(`   - Each agent execution may involve multiple LLM calls (iterations, retries)`);
    console.log(`   - These are NOT counts of "how many agents created" or "how many times agents ran"`);
    console.log(`\n========================================================\n`);

    // Group ranges by category with special handling for memory complexity
    const rangesByCategory: Record<string, any[]> = {};
    ranges?.forEach(range => {
      // Special handling: memory ranges get their own category
      let category = range.category;
      if (range.range_key?.includes('memory_')) {
        category = 'memory_complexity';
      }

      if (!rangesByCategory[category]) {
        rangesByCategory[category] = [];
      }
      rangesByCategory[category].push(range);
    });

    console.log('✅ [AIS Config] Categories:', Object.keys(rangesByCategory));

    // Fetch system limits, AIS weights, and per-step routing config
    console.log('🔍 [AIS Config] Fetching system limits, AIS weights, and per-step routing config...');
    const { data: configData, error: configError} = await supabaseServiceRole
      .from('ais_system_config')
      .select('config_key, config_value')
      .in('config_key', [
        'min_agent_intensity', 'max_agent_intensity', 'min_executions_for_score',
        // Main dimension weights
        'ais_weight_tokens', 'ais_weight_execution', 'ais_weight_plugins', 'ais_weight_workflow', 'ais_weight_memory',
        // Token subdimension weights
        'ais_token_volume_weight', 'ais_token_peak_weight', 'ais_token_io_weight',
        // Execution subdimension weights
        'ais_execution_iterations_weight', 'ais_execution_duration_weight', 'ais_execution_failure_weight', 'ais_execution_retry_weight',
        // Plugin subdimension weights
        'ais_plugin_count_weight', 'ais_plugin_usage_weight', 'ais_plugin_overhead_weight',
        // Workflow subdimension weights
        'ais_workflow_steps_weight', 'ais_workflow_branches_weight', 'ais_workflow_loops_weight', 'ais_workflow_parallel_weight',
        // Memory subdimension weights (Phase 4)
        'ais_memory_ratio_weight', 'ais_memory_diversity_weight', 'ais_memory_volume_weight',
        // Creation component weights (Phase 5)
        'ais_creation_workflow_weight', 'ais_creation_plugin_weight', 'ais_creation_io_weight',
        // Combined blend weights (Phase 6)
        'ais_weight_creation', 'ais_weight_execution_blend',
        // Per-step routing configuration
        'pilot_routing_complexity_thresholds', 'pilot_routing_tier1_model', 'pilot_routing_tier2_model', 'pilot_routing_tier3_model',
        'pilot_complexity_weights_llm_decision', 'pilot_complexity_weights_transform', 'pilot_complexity_weights_conditional',
        'pilot_complexity_weights_action', 'pilot_complexity_weights_api_call', 'pilot_complexity_weights_default',
        'pilot_complexity_thresholds_prompt_length', 'pilot_complexity_thresholds_data_size',
        'pilot_complexity_thresholds_condition_count', 'pilot_complexity_thresholds_context_depth'
      ]);

    if (configError) {
      console.error('❌ [AIS Config] Error fetching config:', configError);
    }

    // Parse limits and weights from config data
    const systemLimits = {
      minAgentIntensity: 0.0,
      maxAgentIntensity: 10.0,
      minExecutionsForScore: 5
    };

    const aisWeights = {
      tokens: 0.30,       // Updated default (reduced from 0.35)
      execution: 0.25,
      plugins: 0.20,      // Updated default (reduced from 0.25)
      workflow: 0.15,
      memory: 0.10,       // NEW: Memory complexity weight
      token_volume: 0.5,
      token_peak: 0.3,
      token_io: 0.2,
      execution_iterations: 0.35,
      execution_duration: 0.30,
      execution_failure: 0.20,
      execution_retry: 0.15,
      plugin_count: 0.4,
      plugin_usage: 0.35,
      plugin_overhead: 0.25,
      workflow_steps: 0.4,
      workflow_branches: 0.25,
      workflow_loops: 0.20,
      workflow_parallel: 0.15,
      memory_ratio: 0.5,
      memory_diversity: 0.3,
      memory_volume: 0.2
    };

    // Phase 5: Creation component weights
    const creationWeights = {
      workflow: 0.5,
      plugins: 0.3,
      io_schema: 0.2
    };

    configData?.forEach(item => {
      const value = parseFloat(item.config_value);
      switch (item.config_key) {
        // System limits
        case 'min_agent_intensity':
          systemLimits.minAgentIntensity = value;
          break;
        case 'max_agent_intensity':
          systemLimits.maxAgentIntensity = value;
          break;
        case 'min_executions_for_score':
          systemLimits.minExecutionsForScore = parseInt(item.config_value);
          break;
        // Main dimension weights
        case 'ais_weight_tokens':
          aisWeights.tokens = value;
          break;
        case 'ais_weight_execution':
          aisWeights.execution = value;
          break;
        case 'ais_weight_plugins':
          aisWeights.plugins = value;
          break;
        case 'ais_weight_workflow':
          aisWeights.workflow = value;
          break;
        case 'ais_weight_memory':
          aisWeights.memory = value;
          break;
        // Token subdimensions
        case 'ais_token_volume_weight':
          aisWeights.token_volume = value;
          break;
        case 'ais_token_peak_weight':
          aisWeights.token_peak = value;
          break;
        case 'ais_token_io_weight':
          aisWeights.token_io = value;
          break;
        // Execution subdimensions
        case 'ais_execution_iterations_weight':
          aisWeights.execution_iterations = value;
          break;
        case 'ais_execution_duration_weight':
          aisWeights.execution_duration = value;
          break;
        case 'ais_execution_failure_weight':
          aisWeights.execution_failure = value;
          break;
        case 'ais_execution_retry_weight':
          aisWeights.execution_retry = value;
          break;
        // Plugin subdimensions
        case 'ais_plugin_count_weight':
          aisWeights.plugin_count = value;
          break;
        case 'ais_plugin_usage_weight':
          aisWeights.plugin_usage = value;
          break;
        case 'ais_plugin_overhead_weight':
          aisWeights.plugin_overhead = value;
          break;
        // Workflow subdimensions
        case 'ais_workflow_steps_weight':
          aisWeights.workflow_steps = value;
          break;
        case 'ais_workflow_branches_weight':
          aisWeights.workflow_branches = value;
          break;
        case 'ais_workflow_loops_weight':
          aisWeights.workflow_loops = value;
          break;
        case 'ais_workflow_parallel_weight':
          aisWeights.workflow_parallel = value;
          break;
        // Memory subdimensions
        case 'ais_memory_ratio_weight':
          aisWeights.memory_ratio = value;
          break;
        case 'ais_memory_diversity_weight':
          aisWeights.memory_diversity = value;
          break;
        case 'ais_memory_volume_weight':
          aisWeights.memory_volume = value;
          break;
        // Phase 5: Creation component weights
        case 'ais_creation_workflow_weight':
          creationWeights.workflow = value;
          break;
        case 'ais_creation_plugin_weight':
          creationWeights.plugins = value;
          break;
        case 'ais_creation_io_weight':
          creationWeights.io_schema = value;
          break;
      }
    });

    console.log('✅ [AIS Config] System limits:', systemLimits);
    console.log('✅ [AIS Config] AIS weights loaded');

    // Parse per-step routing configuration
    const perStepRouting: any = {
      tier1Max: 3.9,
      tier2Max: 6.9,
      tier1Model: 'gpt-4o-mini',
      tier1Provider: 'openai',
      tier2Model: 'claude-3-5-haiku-20241022',
      tier2Provider: 'anthropic',
      tier3Model: 'gpt-4o',
      tier3Provider: 'openai',
      llmDecision: { promptLength: 0.15, dataSize: 0.10, conditionCount: 0.15, contextDepth: 0.15, reasoningDepth: 0.30, outputComplexity: 0.15 },
      transform: { promptLength: 0.15, dataSize: 0.30, conditionCount: 0.10, contextDepth: 0.15, reasoningDepth: 0.15, outputComplexity: 0.15 },
      conditional: { promptLength: 0.15, dataSize: 0.10, conditionCount: 0.30, contextDepth: 0.15, reasoningDepth: 0.20, outputComplexity: 0.10 },
      action: { promptLength: 0.20, dataSize: 0.15, conditionCount: 0.15, contextDepth: 0.15, reasoningDepth: 0.20, outputComplexity: 0.15 },
      apiCall: { promptLength: 0.20, dataSize: 0.20, conditionCount: 0.15, contextDepth: 0.15, reasoningDepth: 0.15, outputComplexity: 0.15 },
      default: { promptLength: 0.20, dataSize: 0.15, conditionCount: 0.15, contextDepth: 0.15, reasoningDepth: 0.20, outputComplexity: 0.15 },
      promptLengthThresholds: { low: 200, medium: 500, high: 1000 },
      dataSizeThresholds: { low: 1024, medium: 10240, high: 51200 },
      conditionCountThresholds: { low: 2, medium: 5, high: 10 },
      contextDepthThresholds: { low: 2, medium: 5, high: 10 }
    };

    configData?.forEach(item => {
      if (item.config_key === 'pilot_routing_complexity_thresholds') {
        const thresholds = JSON.parse(item.config_value);
        perStepRouting.tier1Max = thresholds.tier1_max || 3.9;
        perStepRouting.tier2Max = thresholds.tier2_max || 6.9;
      } else if (item.config_key === 'pilot_routing_tier1_model') {
        const tier1 = JSON.parse(item.config_value);
        perStepRouting.tier1Model = tier1.model || 'gpt-4o-mini';
        perStepRouting.tier1Provider = tier1.provider || 'openai';
      } else if (item.config_key === 'pilot_routing_tier2_model') {
        const tier2 = JSON.parse(item.config_value);
        perStepRouting.tier2Model = tier2.model || 'claude-3-5-haiku-20241022';
        perStepRouting.tier2Provider = tier2.provider || 'anthropic';
      } else if (item.config_key === 'pilot_routing_tier3_model') {
        const tier3 = JSON.parse(item.config_value);
        perStepRouting.tier3Model = tier3.model || 'gpt-4o';
        perStepRouting.tier3Provider = tier3.provider || 'openai';
      } else if (item.config_key === 'pilot_complexity_weights_llm_decision') {
        perStepRouting.llmDecision = JSON.parse(item.config_value);
      } else if (item.config_key === 'pilot_complexity_weights_transform') {
        perStepRouting.transform = JSON.parse(item.config_value);
      } else if (item.config_key === 'pilot_complexity_weights_conditional') {
        perStepRouting.conditional = JSON.parse(item.config_value);
      } else if (item.config_key === 'pilot_complexity_weights_action') {
        perStepRouting.action = JSON.parse(item.config_value);
      } else if (item.config_key === 'pilot_complexity_weights_api_call') {
        perStepRouting.apiCall = JSON.parse(item.config_value);
      } else if (item.config_key === 'pilot_complexity_weights_default') {
        perStepRouting.default = JSON.parse(item.config_value);
      } else if (item.config_key === 'pilot_complexity_thresholds_prompt_length') {
        perStepRouting.promptLengthThresholds = JSON.parse(item.config_value);
      } else if (item.config_key === 'pilot_complexity_thresholds_data_size') {
        perStepRouting.dataSizeThresholds = JSON.parse(item.config_value);
      } else if (item.config_key === 'pilot_complexity_thresholds_condition_count') {
        perStepRouting.conditionCountThresholds = JSON.parse(item.config_value);
      } else if (item.config_key === 'pilot_complexity_thresholds_context_depth') {
        perStepRouting.contextDepthThresholds = JSON.parse(item.config_value);
      }
    });

    console.log('✅ [AIS Config] Per-step routing config loaded');

    const response = {
      success: true,
      config: {
        mode: currentMode,
        minExecutionsRequired,
        canSwitchToDynamic: totalExecutions >= minExecutionsRequired,
        statistics: {
          totalAgents,
          totalCreations,
          totalExecutions,
          totalTokens,
          creationTokens,
          executionTokens,
          dataPointsAvailable: totalExecutions >= minExecutionsRequired
        },
        ranges: rangesByCategory,
        systemLimits,
        aisWeights,
        creationWeights, // Phase 5
        growthThresholds,
        perStepRouting
      }
    };

    console.log('✅ [AIS Config] Sending response with', Object.keys(rangesByCategory).length, 'categories');
    return NextResponse.json(response);

  } catch (error) {
    console.error('Error fetching AIS config:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// POST - Update AIS configuration
export async function POST(req: Request) {
  try {
    // TODO: Add admin role check here
    // For now, using service role to update data (same as reward-config)

    const body = await req.json();
    const { action, mode, threshold } = body;

    if (action === 'switch_mode') {
      // Validate mode
      if (mode !== 'best_practice' && mode !== 'dynamic') {
        return NextResponse.json({ error: 'Invalid mode' }, { status: 400 });
      }

      // Get current mode before switching
      const { data: currentRanges } = await supabaseServiceRole
        .from('ais_normalization_ranges')
        .select('active_mode')
        .limit(1)
        .single();

      const oldMode = currentRanges?.active_mode === 1 ? 'dynamic' : 'best_practice';
      const modeValue = mode === 'dynamic' ? 1 : 0;

      // Update mode in ALL rows of ais_normalization_ranges table
      const { error: updateError } = await supabaseServiceRole
        .from('ais_normalization_ranges')
        .update({ active_mode: modeValue })
        .neq('id', '00000000-0000-0000-0000-000000000000'); // Update all rows

      if (updateError) {
        console.error('Error updating mode:', updateError);
        return NextResponse.json({ error: 'Failed to update mode' }, { status: 500 });
      }

      // Log the mode switch (TODO: Get real user ID from session)
      await logAISModeSwitch(null, oldMode, mode, 'Admin mode switch via dashboard');

      // If switching to dynamic mode, update ranges from data
      if (mode === 'dynamic') {
        try {
          const { data: updateResult } = await supabaseServiceRole
            .rpc('update_dynamic_ais_ranges');

          console.log('✅ Dynamic ranges updated:', updateResult);
        } catch (rangeError) {
          console.error('Error updating dynamic ranges:', rangeError);
          return NextResponse.json({
            error: 'Mode switched but failed to update ranges. Not enough data?',
            partialSuccess: true
          }, { status: 500 });
        }
      }

      return NextResponse.json({
        success: true,
        message: `Switched to ${mode} mode`,
        mode
      });
    }

    if (action === 'refresh_ranges') {
      // Manually refresh dynamic ranges from production data
      try {
        // STEP 1: Capture BEFORE state (all agent scores + current ranges)
        console.log('📸 [AIS Audit] Capturing BEFORE state...');
        const beforeScores = await snapshotAllAgentScores(supabaseServiceRole);
        const oldRanges = await snapshotNormalizationRanges(supabaseServiceRole);
        console.log(`📸 [AIS Audit] Captured ${beforeScores.length} agent scores and ${oldRanges.length} ranges`);

        // STEP 2: Log refresh started with full snapshot
        await logAISNormalizationRefreshStarted(
          null, // userId - TODO: Get from auth session
          oldRanges,
          beforeScores,
          'Admin manual refresh via AIS Config dashboard'
        );

        // STEP 3: Update ranges using stored procedure
        const { data: updateResult, error: rangeError } = await supabaseServiceRole
          .rpc('update_dynamic_ais_ranges');

        if (rangeError) {
          console.error('Error refreshing dynamic ranges:', rangeError);
          return NextResponse.json({
            success: false,
            error: rangeError.message || 'Failed to refresh ranges. Not enough data?'
          }, { status: 500 });
        }

        console.log('✅ Dynamic ranges refreshed:', updateResult);

        // STEP 4: Get new ranges
        const newRanges = await snapshotNormalizationRanges(supabaseServiceRole);

        // STEP 5: Log ranges updated
        await logAISNormalizationRefreshCompleted(
          null, // userId - TODO: Get from auth session
          oldRanges,
          newRanges
        );

        // STEP 6: Recalculate all agent scores with new ranges
        // Note: This happens automatically on next execution via AgentIntensityService
        // For immediate recalculation, you could trigger it here, but it's expensive
        console.log('ℹ️ [AIS] Agent scores will be recalculated on next execution with new ranges');

        // STEP 7: Capture AFTER state (for now, same as before since recalc happens on next run)
        // If you want immediate recalculation, uncomment below and add the logic
        // const afterScores = await snapshotAllAgentScores(supabaseServiceRole);
        // await logAISScoresBulkRecalculated(null, beforeScores, afterScores);

        return NextResponse.json({
          success: true,
          message: 'Dynamic ranges refreshed successfully',
          updates: updateResult,
          audit: {
            before_snapshot: beforeScores.length,
            old_ranges: oldRanges.length,
            new_ranges: newRanges.length
          }
        });
      } catch (rangeError: any) {
        console.error('Error refreshing dynamic ranges:', rangeError);
        return NextResponse.json({
          success: false,
          error: rangeError.message || 'Failed to refresh ranges'
        }, { status: 500 });
      }
    }

    if (action === 'update_threshold') {
      if (!threshold || threshold < 1) {
        return NextResponse.json({ error: 'Invalid threshold value' }, { status: 400 });
      }

      // Get current threshold before updating
      const { data: currentRanges } = await supabaseServiceRole
        .from('ais_normalization_ranges')
        .select('min_executions_threshold')
        .limit(1)
        .single();

      const oldThreshold = currentRanges?.min_executions_threshold || 10;

      // Update the minimum executions threshold in ALL rows of ais_normalization_ranges table
      const { error: updateError } = await supabaseServiceRole
        .from('ais_normalization_ranges')
        .update({ min_executions_threshold: threshold })
        .neq('id', '00000000-0000-0000-0000-000000000000'); // Update all rows

      if (updateError) {
        console.error('Error updating threshold:', updateError);
        return NextResponse.json({ error: 'Failed to update threshold' }, { status: 500 });
      }

      // Log the threshold update (TODO: Get real user ID from session)
      await logAISThresholdUpdate(null, oldThreshold, threshold);

      return NextResponse.json({
        success: true,
        message: `Minimum executions threshold updated to ${threshold}`,
        threshold
      });
    }

    if (action === 'update_growth_thresholds') {
      const { growthThresholds } = body;

      if (!growthThresholds) {
        return NextResponse.json({ error: 'Missing growth thresholds data' }, { status: 400 });
      }

      console.log('🔄 [AIS Config] Updating growth thresholds:', growthThresholds);

      // Update growth thresholds in ALL rows of ais_normalization_ranges table
      const { error: updateError } = await supabaseServiceRole
        .from('ais_normalization_ranges')
        .update({
          output_token_growth_monitor_threshold: growthThresholds.monitorThreshold,
          output_token_growth_rescore_threshold: growthThresholds.rescoreThreshold,
          output_token_growth_upgrade_threshold: growthThresholds.upgradeThreshold,
          output_token_growth_monitor_adjustment: growthThresholds.monitorAdjustment,
          output_token_growth_rescore_adjustment: growthThresholds.rescoreAdjustment,
          output_token_growth_upgrade_adjustment: growthThresholds.upgradeAdjustment,
          quality_success_threshold: growthThresholds.qualitySuccessThreshold,
          quality_retry_threshold: growthThresholds.qualityRetryThreshold,
          quality_success_multiplier: growthThresholds.qualitySuccessMultiplier,
          quality_retry_multiplier: growthThresholds.qualityRetryMultiplier
        })
        .neq('id', '00000000-0000-0000-0000-000000000000'); // Update all rows

      if (updateError) {
        console.error('❌ [AIS Config] Error updating growth thresholds:', updateError);
        return NextResponse.json({
          success: false,
          error: 'Failed to update growth thresholds: ' + updateError.message
        }, { status: 500 });
      }

      console.log('✅ [AIS Config] Growth thresholds updated successfully');

      return NextResponse.json({
        success: true,
        message: 'Growth thresholds updated successfully'
      });
    }

    if (action === 'update_per_step_routing') {
      const { perStepRouting } = body;

      if (!perStepRouting) {
        return NextResponse.json({ error: 'Missing per-step routing data' }, { status: 400 });
      }

      console.log('🔄 [AIS Config] Updating per-step routing configuration:', perStepRouting);

      try {
        // Update complexity thresholds
        await supabaseServiceRole
          .from('ais_system_config')
          .upsert({
            config_key: 'pilot_routing_complexity_thresholds',
            config_value: JSON.stringify({
              tier1_max: perStepRouting.tier1Max,
              tier2_max: perStepRouting.tier2Max
            }),
            description: 'Complexity score thresholds for model tier assignment in per-step routing'
          }, { onConflict: 'config_key' });

        // Update tier models
        await supabaseServiceRole
          .from('ais_system_config')
          .upsert({
            config_key: 'pilot_routing_tier1_model',
            config_value: JSON.stringify({
              model: perStepRouting.tier1Model,
              provider: perStepRouting.tier1Provider
            }),
            description: 'Tier 1 model configuration: Low complexity tasks (0-3.9)'
          }, { onConflict: 'config_key' });

        await supabaseServiceRole
          .from('ais_system_config')
          .upsert({
            config_key: 'pilot_routing_tier2_model',
            config_value: JSON.stringify({
              model: perStepRouting.tier2Model,
              provider: perStepRouting.tier2Provider
            }),
            description: 'Tier 2 model configuration: Medium complexity tasks (4.0-6.9)'
          }, { onConflict: 'config_key' });

        await supabaseServiceRole
          .from('ais_system_config')
          .upsert({
            config_key: 'pilot_routing_tier3_model',
            config_value: JSON.stringify({
              model: perStepRouting.tier3Model,
              provider: perStepRouting.tier3Provider
            }),
            description: 'Tier 3 model configuration: High complexity tasks (7.0-10.0)'
          }, { onConflict: 'config_key' });

        // Update complexity factor weights for each step type
        await supabaseServiceRole
          .from('ais_system_config')
          .upsert({
            config_key: 'pilot_complexity_weights_llm_decision',
            config_value: JSON.stringify(perStepRouting.llmDecision),
            description: 'Complexity factor weights for LLM decision steps (highest reasoning weight)'
          }, { onConflict: 'config_key' });

        await supabaseServiceRole
          .from('ais_system_config')
          .upsert({
            config_key: 'pilot_complexity_weights_transform',
            config_value: JSON.stringify(perStepRouting.transform),
            description: 'Complexity factor weights for transform steps (highest data size weight)'
          }, { onConflict: 'config_key' });

        await supabaseServiceRole
          .from('ais_system_config')
          .upsert({
            config_key: 'pilot_complexity_weights_conditional',
            config_value: JSON.stringify(perStepRouting.conditional),
            description: 'Complexity factor weights for conditional steps (highest condition count weight)'
          }, { onConflict: 'config_key' });

        await supabaseServiceRole
          .from('ais_system_config')
          .upsert({
            config_key: 'pilot_complexity_weights_action',
            config_value: JSON.stringify(perStepRouting.action),
            description: 'Complexity factor weights for action steps (balanced weights)'
          }, { onConflict: 'config_key' });

        await supabaseServiceRole
          .from('ais_system_config')
          .upsert({
            config_key: 'pilot_complexity_weights_api_call',
            config_value: JSON.stringify(perStepRouting.apiCall),
            description: 'Complexity factor weights for API call steps (lower reasoning weight)'
          }, { onConflict: 'config_key' });

        await supabaseServiceRole
          .from('ais_system_config')
          .upsert({
            config_key: 'pilot_complexity_weights_default',
            config_value: JSON.stringify(perStepRouting.default),
            description: 'Complexity factor weights for default/unknown step types (balanced weights)'
          }, { onConflict: 'config_key' });

        // Update complexity scoring thresholds
        await supabaseServiceRole
          .from('ais_system_config')
          .upsert({
            config_key: 'pilot_complexity_thresholds_prompt_length',
            config_value: JSON.stringify(perStepRouting.promptLengthThresholds),
            description: 'Character count thresholds for prompt length complexity scoring'
          }, { onConflict: 'config_key' });

        await supabaseServiceRole
          .from('ais_system_config')
          .upsert({
            config_key: 'pilot_complexity_thresholds_data_size',
            config_value: JSON.stringify(perStepRouting.dataSizeThresholds),
            description: 'Byte count thresholds for data size complexity scoring'
          }, { onConflict: 'config_key' });

        await supabaseServiceRole
          .from('ais_system_config')
          .upsert({
            config_key: 'pilot_complexity_thresholds_condition_count',
            config_value: JSON.stringify(perStepRouting.conditionCountThresholds),
            description: 'Number of conditions thresholds for conditional complexity scoring'
          }, { onConflict: 'config_key' });

        await supabaseServiceRole
          .from('ais_system_config')
          .upsert({
            config_key: 'pilot_complexity_thresholds_context_depth',
            config_value: JSON.stringify(perStepRouting.contextDepthThresholds),
            description: 'Context reference count thresholds for context depth complexity scoring'
          }, { onConflict: 'config_key' });

        console.log('✅ [AIS Config] Per-step routing configuration updated successfully');

        return NextResponse.json({
          success: true,
          message: 'Per-step routing configuration updated successfully'
        });
      } catch (error: any) {
        console.error('❌ [AIS Config] Error updating per-step routing:', error);
        return NextResponse.json({
          success: false,
          error: 'Failed to update per-step routing configuration: ' + error.message
        }, { status: 500 });
      }
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 });

  } catch (error) {
    console.error('Error updating AIS config:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
