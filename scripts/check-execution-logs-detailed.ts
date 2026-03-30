import { config } from 'dotenv';
config({ path: '.env.local' });

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function main() {
  const executionId = '229b66ee-29ca-4944-8492-e25f3a822302';

  const { data: execution } = await supabase
    .from('agent_executions')
    .select('*')
    .eq('id', executionId)
    .single();

  if (!execution) {
    console.log('Execution not found');
    return;
  }

  console.log('=== FULL EXECUTION RECORD ===');
  console.log('ID:', execution.id);
  console.log('Status:', execution.status);
  console.log('Error:', execution.error);
  console.log('Created:', execution.created_at);

  console.log('\n=== LOGS FIELD ===');
  if (execution.logs) {
    console.log(JSON.stringify(execution.logs, null, 2));
  } else {
    console.log('No logs field');
  }

  console.log('\n=== EXECUTION SUMMARY ===');
  if (execution.execution_summary) {
    console.log(JSON.stringify(execution.execution_summary, null, 2));
  } else {
    console.log('No execution_summary');
  }

  console.log('\n=== RESULT ===');
  if (execution.result) {
    console.log(JSON.stringify(execution.result, null, 2));
  } else {
    console.log('No result');
  }

  console.log('\n=== ALL KEYS ===');
  console.log(Object.keys(execution).join(', '));

  // Look for any field that might contain error details
  console.log('\n=== SEARCHING FOR ERROR DETAILS ===');
  for (const [key, value] of Object.entries(execution)) {
    if (value && typeof value === 'object') {
      const str = JSON.stringify(value);
      if (str.includes('Recipient') || str.includes('step16') || str.includes('send_email')) {
        console.log(`\nFound in ${key}:`);
        console.log(JSON.stringify(value, null, 2));
      }
    } else if (typeof value === 'string' && (value.includes('Recipient') || value.includes('step16'))) {
      console.log(`\nFound in ${key}:`, value);
    }
  }
}

main();
