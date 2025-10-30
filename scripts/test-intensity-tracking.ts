// scripts/test-intensity-tracking.ts
// Test script to verify intensity tracking is working

import { config } from 'dotenv';
import { resolve } from 'path';
import { createClient } from '@supabase/supabase-js';

// Load environment variables
config({ path: resolve(__dirname, '../.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function testIntensityTracking() {
  console.log('🧪 Testing Agent Intensity Tracking\n');

  // Get all agents
  const { data: agents, error: agentsError } = await supabase
    .from('agents')
    .select('id, agent_name')
    .limit(3);

  if (agentsError) {
    console.error('❌ Error fetching agents:', agentsError);
    return;
  }

  console.log(`Found ${agents?.length || 0} agents\n`);

  // Check intensity metrics for each agent
  for (const agent of agents || []) {
    console.log(`📊 Agent: ${agent.agent_name} (${agent.id})`);

    const { data: metrics, error: metricsError } = await supabase
      .from('agent_intensity_metrics')
      .select('*')
      .eq('agent_id', agent.id)
      .single();

    if (metricsError) {
      console.log(`   ❌ No metrics found: ${metricsError.message}`);
    } else if (metrics) {
      console.log(`   ✅ Metrics found:`);
      console.log(`      - Intensity Score: ${metrics.intensity_score}`);
      console.log(`      - Total Executions: ${metrics.total_executions}`);
      console.log(`      - Total Tokens: ${metrics.total_tokens_used}`);
      console.log(`      - Avg Tokens/Run: ${metrics.avg_tokens_per_run?.toFixed(0)}`);
      console.log(`      - Success Rate: ${metrics.success_rate?.toFixed(1)}%`);
      console.log(`      - Last Updated: ${metrics.last_calculated_at || 'Never'}`);
    }
    console.log('');
  }

  // Check total metrics count
  const { count } = await supabase
    .from('agent_intensity_metrics')
    .select('*', { count: 'exact', head: true });

  console.log(`\n📈 Total agents with intensity metrics: ${count}`);
}

testIntensityTracking()
  .then(() => console.log('\n✅ Test complete'))
  .catch((error) => console.error('\n❌ Test failed:', error))
  .finally(() => process.exit(0));
