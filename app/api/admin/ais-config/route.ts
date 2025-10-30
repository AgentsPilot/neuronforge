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

    console.log('✅ [AIS Config] Active mode:', currentMode, '(', firstRange?.active_mode, ')');

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

    // Group ranges by category
    const rangesByCategory: Record<string, any[]> = {};
    ranges?.forEach(range => {
      if (!rangesByCategory[range.category]) {
        rangesByCategory[range.category] = [];
      }
      rangesByCategory[range.category].push(range);
    });

    console.log('✅ [AIS Config] Categories:', Object.keys(rangesByCategory));

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
        ranges: rangesByCategory
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

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 });

  } catch (error) {
    console.error('Error updating AIS config:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
