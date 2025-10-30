// scripts/backfill-creation-dimensions.ts
// Backfill script to recalculate creation scores using new 4-dimension system

import { createClient } from '@supabase/supabase-js';
import { AISConfigService } from '@/lib/services/AISConfigService';
import { COMBINED_WEIGHTS } from '@/lib/types/intensity';
import * as dotenv from 'dotenv';
import * as path from 'path';

// Load environment variables
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('❌ Missing required environment variables');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

interface BackfillStats {
  total_agents: number;
  processed: number;
  updated: number;
  skipped: number;
  errors: number;
  error_details: Array<{ agent_id: string; error: string }>;
}

const stats: BackfillStats = {
  total_agents: 0,
  processed: 0,
  updated: 0,
  skipped: 0,
  errors: 0,
  error_details: []
};

async function backfillAgent(agentId: string, agentData: any): Promise<boolean> {
  try {
    // Parse agent design data
    const workflowSteps = typeof agentData.workflow_steps === 'string'
      ? JSON.parse(agentData.workflow_steps)
      : (agentData.workflow_steps || []);

    const connectedPlugins = typeof agentData.connected_plugins === 'string'
      ? JSON.parse(agentData.connected_plugins)
      : (agentData.connected_plugins || []);

    const inputSchema = typeof agentData.input_schema === 'string'
      ? JSON.parse(agentData.input_schema)
      : (agentData.input_schema || []);

    const outputSchema = typeof agentData.output_schema === 'string'
      ? JSON.parse(agentData.output_schema)
      : (agentData.output_schema || []);

    const triggerConditions = typeof agentData.trigger_conditions === 'string'
      ? JSON.parse(agentData.trigger_conditions)
      : (agentData.trigger_conditions || {});

    // Fetch AIS ranges from database
    const ranges = await AISConfigService.getRanges(supabase);

    // Calculate 4 dimension scores (same logic as AgentIntensityService)
    const workflowScore = AISConfigService.normalize(workflowSteps.length, ranges.creation_workflow_steps);
    const pluginScore = AISConfigService.normalize(connectedPlugins.length, ranges.creation_plugins);
    const ioFieldCount = inputSchema.length + outputSchema.length;
    const ioScore = AISConfigService.normalize(ioFieldCount, ranges.creation_io_fields);

    // Calculate trigger bonus
    let triggerBonus = 0;
    if (triggerConditions.schedule_cron) {
      triggerBonus = 1;
    }
    if (triggerConditions.event_triggers && triggerConditions.event_triggers.length > 0) {
      triggerBonus = 2;
    }

    // Calculate weighted creation score
    const creation_score = (
      workflowScore * 0.5 +
      pluginScore * 0.3 +
      ioScore * 0.2 +
      triggerBonus
    );

    // Get existing metrics to preserve execution score
    const { data: existingMetrics, error: fetchError } = await supabase
      .from('agent_intensity_metrics')
      .select('execution_score, intensity_score')
      .eq('agent_id', agentId)
      .single();

    if (fetchError) {
      console.error(`  ⚠️  Agent ${agentId}: Failed to fetch existing metrics`);
      stats.errors++;
      stats.error_details.push({ agent_id: agentId, error: fetchError.message });
      return false;
    }

    // Use existing execution score or default to 5.0
    const execution_score = existingMetrics?.execution_score ?? existingMetrics?.intensity_score ?? 5.0;

    // Recalculate combined score
    const combined_score = (
      creation_score * COMBINED_WEIGHTS.CREATION +
      execution_score * COMBINED_WEIGHTS.EXECUTION
    );

    // Update metrics with new scores
    const { error: updateError } = await supabase
      .from('agent_intensity_metrics')
      .update({
        // Three scores
        creation_score,
        combined_score,
        intensity_score: combined_score, // Keep in sync for backward compatibility

        // Four creation dimensions
        creation_workflow_score: workflowScore,
        creation_plugin_score: pluginScore,
        creation_io_score: ioScore,
        creation_trigger_score: triggerBonus,

        // OLD (keep for backward compatibility)
        creation_complexity_score: creation_score,
        creation_token_efficiency_score: creation_score,

        // Metadata
        updated_at: new Date().toISOString(),
      })
      .eq('agent_id', agentId);

    if (updateError) {
      console.error(`  ❌ Agent ${agentId}: Update failed`);
      stats.errors++;
      stats.error_details.push({ agent_id: agentId, error: updateError.message });
      return false;
    }

    console.log(`  ✅ Agent ${agentId}: Creation ${creation_score.toFixed(2)} | Execution ${execution_score.toFixed(2)} | Combined ${combined_score.toFixed(2)}`);
    stats.updated++;
    return true;

  } catch (error) {
    console.error(`  ❌ Agent ${agentId}: Exception`);
    stats.errors++;
    stats.error_details.push({
      agent_id: agentId,
      error: error instanceof Error ? error.message : String(error)
    });
    return false;
  }
}

async function backfillAllAgents(dryRun: boolean = false) {
  console.log('\n🚀 Starting Creation Dimension Backfill...\n');

  if (dryRun) {
    console.log('🔍 DRY RUN MODE - No changes will be made\n');
  }

  // Fetch all agents with their design data
  const { data: agents, error: agentsError } = await supabase
    .from('agents')
    .select('id, user_id, workflow_steps, connected_plugins, input_schema, output_schema, trigger_conditions');

  if (agentsError || !agents) {
    console.error('❌ Failed to fetch agents:', agentsError);
    process.exit(1);
  }

  stats.total_agents = agents.length;

  console.log(`📊 Found ${agents.length} agents to process\n`);

  if (agents.length === 0) {
    console.log('✅ No agents to backfill\n');
    return;
  }

  // Process agents in batches of 10
  const BATCH_SIZE = 10;
  for (let i = 0; i < agents.length; i += BATCH_SIZE) {
    const batch = agents.slice(i, i + BATCH_SIZE);
    console.log(`\nProcessing batch ${Math.floor(i / BATCH_SIZE) + 1} (agents ${i + 1}-${Math.min(i + BATCH_SIZE, agents.length)}):`);

    for (const agent of batch) {
      stats.processed++;

      if (dryRun) {
        console.log(`  [DRY RUN] Would process agent ${agent.id}`);
        continue;
      }

      await backfillAgent(agent.id, agent);
    }

    // Small delay between batches to avoid rate limiting
    if (i + BATCH_SIZE < agents.length) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }
}

async function printResults() {
  console.log('\n' + '='.repeat(80));
  console.log('📊 BACKFILL RESULTS');
  console.log('='.repeat(80) + '\n');

  console.log(`Total Agents:    ${stats.total_agents}`);
  console.log(`Processed:       ${stats.processed}`);
  console.log(`Updated:         ${stats.updated} ✅`);
  console.log(`Skipped:         ${stats.skipped}`);
  console.log(`Errors:          ${stats.errors} ${stats.errors > 0 ? '❌' : ''}`);

  if (stats.errors > 0 && stats.error_details.length > 0) {
    console.log('\n❌ Error Details:');
    console.log('-'.repeat(80));
    for (const detail of stats.error_details.slice(0, 10)) {
      console.log(`  Agent ${detail.agent_id}: ${detail.error}`);
    }
    if (stats.error_details.length > 10) {
      console.log(`  ... and ${stats.error_details.length - 10} more errors`);
    }
  }

  console.log('\n' + '='.repeat(80));

  const successRate = stats.total_agents > 0
    ? ((stats.updated / stats.total_agents) * 100).toFixed(1)
    : '0';

  if (stats.errors > 0) {
    console.log(`⚠️  Backfill completed with errors (${successRate}% success rate)\n`);
    process.exit(1);
  } else if (stats.updated > 0) {
    console.log(`🎉 Backfill completed successfully (${stats.updated} agents updated)\n`);
    process.exit(0);
  } else {
    console.log(`✅ No agents needed updating\n`);
    process.exit(0);
  }
}

async function main() {
  // Check for dry run flag
  const dryRun = process.argv.includes('--dry-run');

  console.log('🔧 AIS Creation Dimension Backfill Script\n');
  console.log('This script will:');
  console.log('  1. Recalculate creation scores using new 4-dimension system');
  console.log('  2. Update all 4 creation dimension columns');
  console.log('  3. Recalculate combined scores (30% creation + 70% execution)');
  console.log('  4. Keep backward compatibility fields in sync\n');

  if (dryRun) {
    console.log('Running in DRY RUN mode (use without --dry-run to apply changes)\n');
  }

  await backfillAllAgents(dryRun);
  await printResults();
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
