import { config } from 'dotenv';
config({ path: '.env.local' });

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function main() {
  // Get latest execution
  const { data: executions } = await supabase
    .from('workflow_executions')
    .select('id, execution_trace, created_at, status')
    .eq('agent_id', '43ffbc8a-406d-4a43-9f3f-4e7554160eda')
    .order('created_at', { ascending: false })
    .limit(5);

  if (!executions || executions.length === 0) {
    console.log('No executions found');
    return;
  }

  console.log(`Found ${executions.length} recent executions\n`);

  for (const execution of executions) {
    console.log(`\n=== Execution ${execution.id} ===`);
    console.log('Created:', execution.created_at);
    console.log('Status:', execution.status);

    const trace = execution.execution_trace;

    // Check for step6_sanitize output
    if (trace.step6_sanitize) {
      console.log('\n✅ step6_sanitize output found:');
      console.log(JSON.stringify(trace.step6_sanitize, null, 2));
    } else if (trace.extracted_fields_clean) {
      console.log('\n✅ extracted_fields_clean found:');
      console.log(JSON.stringify(trace.extracted_fields_clean, null, 2));
    } else {
      console.log('\n❌ No step6_sanitize or extracted_fields_clean in trace');
      console.log('Available keys:', Object.keys(trace).filter(k => k.includes('step') || k.includes('extract')));
    }

    // Check step6 output (original extraction)
    if (trace.extracted_fields) {
      console.log('\nstep6 (extracted_fields):');
      console.log(JSON.stringify(trace.extracted_fields, null, 2));
    }

    // Check processed_items
    if (trace.processed_items && Array.isArray(trace.processed_items)) {
      console.log(`\nprocessed_items: ${trace.processed_items.length} items`);
      const firstItem = trace.processed_items[0];
      if (firstItem?.error) {
        console.log('❌ First item has error:', firstItem.error.substring(0, 100));
      } else if (firstItem) {
        console.log('✅ First item succeeded');
        console.log('   vendor:', firstItem.vendor || '(not present)');
      }
    }
  }
}

main();
