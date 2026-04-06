require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function checkLogs() {
  const { data: execution } = await supabase
    .from('workflow_executions')
    .select('logs')
    .eq('agent_id', '08eb9918-e60f-4179-a5f4-bc83b95fc15c')
    .order('created_at', { ascending: false })
    .limit(1)
    .single();

  if (!execution || !execution.logs) {
    console.log('No logs found');
    return;
  }

  const logs = execution.logs.pilot || [];
  
  console.log('SEARCHING FOR INSIGHT-RELATED LOGS:\n');
  
  const insightLogs = logs.filter(log => {
    const logStr = typeof log === 'string' ? log : JSON.stringify(log);
    return logStr.toLowerCase().includes('insight') ||
           logStr.toLowerCase().includes('llm') ||
           logStr.toLowerCase().includes('business') ||
           logStr.toLowerCase().includes('claude');
  });

  if (insightLogs.length === 0) {
    console.log('No insight-related logs found');
    console.log('\nShowing last 20 logs:');
    logs.slice(-20).forEach(log => {
      console.log(typeof log === 'string' ? log : JSON.stringify(log));
    });
  } else {
    console.log('Found ' + insightLogs.length + ' insight-related logs:\n');
    insightLogs.forEach(log => {
      console.log(typeof log === 'string' ? log : JSON.stringify(log));
    });
  }
}

checkLogs();
