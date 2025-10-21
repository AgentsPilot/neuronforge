import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function scheduleFor2Minutes() {
  const agentId = '832a8039-d864-4d25-bdbb-23c02db5b810';

  // Set to 2 minutes from now
  const nextRun = new Date(Date.now() + 2 * 60 * 1000);

  const { data, error } = await supabase
    .from('agents')
    .update({
      next_run: nextRun.toISOString(),
      status: 'active',
      schedule_enabled: true
    })
    .eq('id', agentId)
    .select()
    .single();

  if (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }

  console.log('\n✅ Agent scheduled for 2 minutes from now!');
  console.log('='.repeat(60));
  console.log('Agent Name:', data.agent_name);
  console.log('Agent ID:', data.id);
  console.log('Current Time:', new Date().toLocaleString());
  console.log('Next Run:', new Date(data.next_run).toLocaleString());
  console.log('Seconds Until Run:', Math.round((new Date(data.next_run).getTime() - Date.now()) / 1000));
  console.log('='.repeat(60));
  console.log('\n📋 Testing Instructions:');
  console.log('1. Make sure local dev server is running (npm run dev)');
  console.log('2. Start the worker: npm run worker');
  console.log('3. Wait 2 minutes');
  console.log('4. Call scheduler manually: curl -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/run-scheduled-agents');
  console.log('5. Check execution in Supabase or worker logs\n');
}

scheduleFor2Minutes();
