require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

(async () => {
  // Get latest execution
  const { data: executions } = await supabase
    .from('workflow_executions')
    .select('id, created_at, logs')
    .eq('agent_id', '08eb9918-e60f-4179-a5f4-bc83b95fc15c')
    .order('created_at', { ascending: false })
    .limit(1)
    .single();

  if (!executions) {
    console.log('No execution found');
    return;
  }

  const logs = executions.logs?.pilot || [];
  
  console.log('🔍 SEARCHING FOR LLM CALL LOGS:\n');
  
  const llmLogs = logs.filter(log => 
    log.toLowerCase().includes('llm') ||
    log.toLowerCase().includes('claude') ||
    log.toLowerCase().includes('business insight') ||
    log.toLowerCase().includes('situation analysis')
  );

  if (llmLogs.length === 0) {
    console.log('❌ NO LLM CALL LOGS FOUND');
    console.log('\nLast 10 log entries:');
    logs.slice(-10).forEach(log => console.log(log));
  } else {
    console.log('✅ LLM CALL LOGS:');
    llmLogs.forEach(log => console.log(log));
  }
})();
