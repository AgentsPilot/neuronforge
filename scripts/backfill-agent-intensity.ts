// scripts/backfill-agent-intensity.ts
// Backfill script to initialize intensity metrics for all existing agents

import { config } from 'dotenv';
import { resolve } from 'path';
import { createClient } from '@supabase/supabase-js';
import { DEFAULT_INTENSITY_METRICS } from '../lib/types/intensity';

// Load environment variables from .env.local
config({ path: resolve(__dirname, '../.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('❌ Missing required environment variables:');
  console.error('   - NEXT_PUBLIC_SUPABASE_URL');
  console.error('   - SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

// Create admin client with service role key
const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function backfillAgentIntensity() {
  console.log('🚀 Starting Agent Intensity backfill...\n');

  try {
    // 1. Get all agents that don't have intensity metrics yet
    console.log('📊 Fetching agents without intensity metrics...');
    const { data: agents, error: agentsError } = await supabase
      .from('agents')
      .select('id, user_id, agent_name, created_at')
      .order('created_at', { ascending: true });

    if (agentsError) {
      throw new Error(`Failed to fetch agents: ${agentsError.message}`);
    }

    if (!agents || agents.length === 0) {
      console.log('✅ No agents found. Nothing to backfill.');
      return;
    }

    console.log(`✅ Found ${agents.length} agents\n`);

    // 2. Check which agents already have metrics
    const { data: existingMetrics, error: metricsError } = await supabase
      .from('agent_intensity_metrics')
      .select('agent_id');

    if (metricsError) {
      throw new Error(`Failed to fetch existing metrics: ${metricsError.message}`);
    }

    const existingAgentIds = new Set(existingMetrics?.map(m => m.agent_id) || []);
    const agentsToBackfill = agents.filter(a => !existingAgentIds.has(a.id));

    console.log(`📝 Agents with existing metrics: ${existingAgentIds.size}`);
    console.log(`🔄 Agents to backfill: ${agentsToBackfill.length}\n`);

    if (agentsToBackfill.length === 0) {
      console.log('✅ All agents already have intensity metrics!');
      return;
    }

    // 3. Initialize metrics for agents without them
    let successCount = 0;
    let errorCount = 0;

    for (let i = 0; i < agentsToBackfill.length; i++) {
      const agent = agentsToBackfill[i];
      const progress = `[${i + 1}/${agentsToBackfill.length}]`;

      try {
        console.log(`${progress} Initializing metrics for: ${agent.agent_name} (${agent.id})`);

        // Initialize with default values using direct database insert
        const { data: result, error: insertError } = await supabase
          .from('agent_intensity_metrics')
          .insert({
            agent_id: agent.id,
            user_id: agent.user_id,
            ...DEFAULT_INTENSITY_METRICS,
          })
          .select()
          .single();

        if (insertError) {
          errorCount++;
          console.log(`   ❌ Failed: ${insertError.message}`);
        } else if (result) {
          successCount++;
          console.log(`   ✅ Success (score: ${result.intensity_score})`);
        } else {
          errorCount++;
          console.log(`   ❌ Failed to initialize`);
        }
      } catch (error) {
        errorCount++;
        console.error(`   ❌ Error:`, error instanceof Error ? error.message : error);
      }

      // Add a small delay to avoid overwhelming the database
      if (i < agentsToBackfill.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }

    // 4. Summary
    console.log('\n' + '='.repeat(60));
    console.log('📊 Backfill Summary');
    console.log('='.repeat(60));
    console.log(`Total agents processed: ${agentsToBackfill.length}`);
    console.log(`✅ Successfully initialized: ${successCount}`);
    console.log(`❌ Failed: ${errorCount}`);
    console.log('='.repeat(60));

    if (errorCount > 0) {
      console.log('\n⚠️  Some agents failed to initialize. Please check the logs above.');
      process.exit(1);
    } else {
      console.log('\n✅ Backfill completed successfully!');
    }

  } catch (error) {
    console.error('\n❌ Fatal error during backfill:', error);
    process.exit(1);
  }
}

// Run the backfill
backfillAgentIntensity()
  .then(() => {
    console.log('\n✨ Script finished');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n💥 Unhandled error:', error);
    process.exit(1);
  });
