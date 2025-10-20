import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function scheduleFor645PM() {
  const agentId = '832a8039-d864-4d25-bdbb-23c02db5b810';

  // Set to 6:45 PM today
  const nextRun = new Date();
  nextRun.setHours(18, 45, 0, 0); // 6:45:00 PM

  // If 6:45 PM has already passed today, set it for tomorrow
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

  console.log('\n✅ Agent scheduled for 6:45 PM!');
  console.log('='.repeat(60));
  console.log('Agent Name:', data.agent_name);
  console.log('Agent Status:', data.status);
  console.log('Schedule Enabled:', data.schedule_enabled);
  console.log('Current Time:', new Date().toLocaleString());
  console.log('Next Run:', new Date(data.next_run).toLocaleString());
  console.log('Time Until Run:', Math.round((new Date(data.next_run).getTime() - Date.now()) / 1000 / 60), 'minutes');
  console.log('='.repeat(60));
  console.log('\n⏰ Vercel Cron will check every 5 minutes!');
  console.log('   Next cron runs: :40, :45, :50, :55, :00');
  console.log('   Your agent will be picked up at :45 or :50\n');
}

scheduleFor645PM();
