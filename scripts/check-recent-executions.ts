import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function checkExecutions() {
  const { data } = await supabase
    .from('agent_executions')
    .select('id, status, execution_type, created_at')
    .gte('created_at', '2025-10-20T19:10:00')
    .order('created_at', { ascending: false });

  console.log('\n📊 Executions since 7:10 PM:');
  if (!data || data.length === 0) {
    console.log('❌ No executions found - 7:15 PM test did NOT run');
  } else {
    console.log(`✅ Found ${data.length} execution(s):`);
    data.forEach(ex => {
      console.log(`  - ${ex.id} | ${ex.status} | ${ex.execution_type} | ${new Date(ex.created_at).toLocaleTimeString()}`);
    });
  }
}

checkExecutions();
