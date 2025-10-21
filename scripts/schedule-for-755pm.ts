import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function scheduleFor755PM() {
  const agentId = '832a8039-d864-4d25-bdbb-23c02db5b810';

  // Set to 7:55 PM today
  const nextRun = new Date();
  nextRun.setHours(19, 55, 0, 0); // 7:55:00 PM

  // If 7:55 PM has already passed today, set it for tomorrow
  if (nextRun < new Date()) {
    nextRun.setDate(nextRun.getDate() + 1);
  }

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

  console.log('\n✅ Agent scheduled for 7:55 PM!');
  console.log('='.repeat(60));
  console.log('Agent Name:', data.agent_name);
  console.log('Agent ID:', data.id);
  console.log('Current Time:', new Date().toLocaleString());
  console.log('Next Run:', new Date(data.next_run).toLocaleString());
  console.log('Minutes Until Run:', Math.round((new Date(data.next_run).getTime() - Date.now()) / 1000 / 60));
  console.log('='.repeat(60));
  console.log('\n📋 Testing Instructions:');
  console.log('1. Dev server should be running on http://localhost:3000');
  console.log('2. Worker should be running (npm run worker)');
  console.log('3. At 7:55 PM, manually trigger scheduler:');
  console.log('   curl -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/run-scheduled-agents');
  console.log('4. Watch worker terminal for job processing');
  console.log('5. Check Supabase agent_executions table for results\n');
}

scheduleFor755PM();
