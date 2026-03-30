import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';

config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function main() {
  // Get most recent agent
  const { data: agent, error: agentError } = await supabase
    .from('agents')
    .select('id, agent_name, updated_at')
    .order('updated_at', { ascending: false })
    .limit(1)
    .single();

  if (agentError || !agent) {
    console.error('Error fetching agent:', agentError);
    return;
  }

  console.log('=== CALIBRATION URL ===\n');
  console.log('Agent ID:', agent.id);
  console.log('Agent Name:', agent.agent_name);
  console.log('Last Updated:', agent.updated_at);
  console.log('\n📍 Open this URL in your browser:\n');
  console.log(`http://localhost:3000/v2/sandbox/${agent.id}`);
  console.log('\nThen click "Start Calibration" or "Run Calibration" button');
  console.log('\nThis will trigger the batch calibration API which includes:');
  console.log('  ✅ Scatter-gather error detection');
  console.log('  ✅ Parameter mismatch auto-fix');
  console.log('  ✅ Iterative loop until workflow succeeds\n');
}

main().catch(console.error);
