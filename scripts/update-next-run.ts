import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function updateNextRun() {
  const agentId = '832a8039-d864-4d25-bdbb-23c02db5b810';
  const nextRun = new Date();
  nextRun.setMinutes(nextRun.getMinutes() + 5);

  const { data, error } = await supabase
    .from('agents')
    .update({
      next_run: nextRun.toISOString(),
      status: 'active'
    })
    .eq('id', agentId)
    .select()
    .single();

  if (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }

  console.log('\n✅ Agent scheduled successfully!');
  console.log('='.repeat(60));
  console.log('Agent Name:', data.agent_name);
  console.log('Agent Status:', data.status);
  console.log('Current Time:', new Date().toLocaleString());
  console.log('Next Run:', new Date(data.next_run).toLocaleString());
  console.log('Time Until Run:', Math.round((new Date(data.next_run).getTime() - Date.now()) / 1000 / 60), 'minutes');
  console.log('='.repeat(60));
  console.log('\n⏰ The scheduler will pick this up automatically!');
  console.log('   Watch your worker terminal for activity...\n');
}

updateNextRun();
