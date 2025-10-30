// Quick script to fix the 3 agents with missing/duplicate metrics
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(supabaseUrl, supabaseServiceKey);

const problemAgents = [
  '417c92c3-4902-43ac-9e38-01bd3d0d9c9a',
  'f55d2ce2-eafa-4a1d-8470-f7f5c66f2cd2',
  '02b58571-347a-4a3e-9926-4aa278f4f730'
];

async function fixAgent(agentId: string) {
  console.log(`\nChecking agent ${agentId}...`);

  // Check how many metrics records exist
  const { data: metrics, error } = await supabase
    .from('agent_intensity_metrics')
    .select('*')
    .eq('agent_id', agentId);

  if (error) {
    console.error(`  Error: ${error.message}`);
    return;
  }

  console.log(`  Found ${metrics?.length || 0} metrics records`);

  if (!metrics || metrics.length === 0) {
    console.log(`  Creating initial metrics record...`);
    // Get user_id from agent
    const { data: agent } = await supabase
      .from('agents')
      .select('user_id')
      .eq('id', agentId)
      .single();

    if (agent) {
      await supabase.from('agent_intensity_metrics').insert({
        agent_id: agentId,
        user_id: agent.user_id,
        creation_score: 5.0,
        execution_score: 5.0,
        combined_score: 5.0,
        intensity_score: 5.0,
      });
      console.log(`  ✅ Created initial metrics`);
    }
  } else if (metrics.length > 1) {
    console.log(`  ⚠️  Multiple records found - keeping newest, deleting others`);
    // Sort by created_at, keep newest
    metrics.sort((a: any, b: any) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    const toKeep = metrics[0];
    const toDelete = metrics.slice(1);

    for (const record of toDelete) {
      await supabase
        .from('agent_intensity_metrics')
        .delete()
        .eq('id', (record as any).id);
      console.log(`  Deleted duplicate record ${(record as any).id}`);
    }
    console.log(`  ✅ Kept record ${(toKeep as any).id}`);
  }
}

async function main() {
  for (const agentId of problemAgents) {
    await fixAgent(agentId);
  }
  console.log('\n✅ Done fixing problem agents\n');
}

main();
