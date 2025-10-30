import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const agentId = 'c6e8a3d6-bece-4bbf-8ccb-483736f6f0bc';

async function fixAgent() {
  console.log(`\n🔧 Fixing agent ${agentId}...\n`);

  // Check if multiple metrics exist
  const { data: allMetrics, error: fetchError } = await supabase
    .from('agent_intensity_metrics')
    .select('*')
    .eq('agent_id', agentId);

  if (fetchError) {
    console.error('Error:', fetchError.message);
    return;
  }

  console.log(`Found ${allMetrics?.length || 0} metrics records`);

  if (!allMetrics || allMetrics.length === 0) {
    console.log('No metrics found - creating initial record');
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
      });
      console.log('✅ Created initial metrics');
    }
  } else if (allMetrics.length > 1) {
    console.log(`⚠️  Multiple records found - keeping newest, deleting ${allMetrics.length - 1} duplicates`);

    // Sort by created_at, keep newest
    allMetrics.sort((a: any, b: any) =>
      new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );

    const toKeep = allMetrics[0];
    const toDelete = allMetrics.slice(1);

    for (const record of toDelete) {
      await supabase
        .from('agent_intensity_metrics')
        .delete()
        .eq('id', (record as any).id);
      console.log(`  Deleted duplicate: ${(record as any).id}`);
    }

    console.log(`✅ Kept record: ${(toKeep as any).id}`);
  }

  console.log('\n✅ Agent fixed! Now run backfill again.\n');
}

fixAgent();
