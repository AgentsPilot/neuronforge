require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function traceLLMCalls() {
  const agentId = '08eb9918-e60f-4179-a5f4-bc83b95fc15c';
  
  // Get the latest execution
  const { data: executions } = await supabase
    .from('workflow_executions')
    .select('id, created_at, status')
    .eq('agent_id', agentId)
    .order('created_at', { ascending: false })
    .limit(1)
    .single();

  if (!executions) {
    console.log('No execution found');
    return;
  }

  console.log('Latest execution: ' + executions.id);
  console.log('Status: ' + executions.status);
  console.log('Time: ' + executions.created_at);
  console.log('\nChecking if BusinessInsightGenerator was called...\n');

  // Check if any insights were created during this execution
  const { data: insights } = await supabase
    .from('execution_insights')
    .select('*')
    .eq('agent_id', agentId)
    .gte('created_at', executions.created_at);

  if (insights && insights.length > 0) {
    console.log('Found ' + insights.length + ' insights created:');
    insights.forEach(i => {
      console.log('  - ' + i.title + ' (' + i.severity + ')');
    });
  } else {
    console.log('No insights created during this execution');
  }

  // The issue might be that the LLM is being called but returning empty array
  // Or the LLM is not being called at all due to caching
  console.log('\nPossible reasons for 0 insights:');
  console.log('1. LLM returned {"insights": []} - working as designed (healthy state)');
  console.log('2. LLM call failed silently - check logs for errors');
  console.log('3. Cached insight was reused - check for "Reusing cached" in logs');
  console.log('4. Exception in BusinessInsightGenerator - check error logs');
}

traceLLMCalls();
