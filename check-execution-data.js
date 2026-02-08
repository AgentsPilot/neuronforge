require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

(async () => {
  const { data } = await supabase
    .from('workflow_executions')
    .select('execution_results, execution_trace')
    .eq('id', '85e7e3ec-ae7e-4764-bd30-fbe18bfef292')
    .single();

  console.log('execution_results type:', typeof data?.execution_results);
  console.log('execution_results keys:', Object.keys(data?.execution_results || {}));
  console.log('execution_results sample:', JSON.stringify(data?.execution_results, null, 2).substring(0, 500));

  console.log('\nexecution_trace type:', typeof data?.execution_trace);
  console.log('execution_trace length:', Array.isArray(data?.execution_trace) ? data?.execution_trace.length : 'N/A');
  if (Array.isArray(data?.execution_trace) && data.execution_trace.length > 0) {
    console.log('First trace entry:', JSON.stringify(data.execution_trace[0], null, 2));
  }
})();
