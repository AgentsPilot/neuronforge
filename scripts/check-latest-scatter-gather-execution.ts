import { config } from 'dotenv';
config({ path: '.env.local' });

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function main() {
  // Get latest execution for this agent
  const { data: executions } = await supabase
    .from('workflow_executions')
    .select('id, execution_trace, created_at')
    .eq('agent_id', '43ffbc8a-406d-4a43-9f3f-4e7554160eda')
    .order('created_at', { ascending: false })
    .limit(1);

  if (!executions || executions.length === 0) {
    console.log('No executions found');
    return;
  }

  const execution = executions[0];
  console.log('Latest execution:', execution.id);
  console.log('Created at:', execution.created_at);

  const trace = execution.execution_trace;

  // Find step4 output (scatter-gather results)
  const step4Output = trace.step4;

  if (!step4Output) {
    console.log('No step4 output in trace');
    return;
  }

  console.log('\n=== Step4 (Scatter-Gather) Output ===');
  console.log('Type:', typeof step4Output);
  console.log('Is array:', Array.isArray(step4Output));

  if (Array.isArray(step4Output)) {
    console.log(`\nItems: ${step4Output.length}`);
    step4Output.forEach((item: any, index: number) => {
      console.log(`\n--- Item ${index} ---`);
      if (item.error) {
        console.log('❌ ERROR:', item.error);
      } else {
        console.log('✅ SUCCESS');
        console.log('Keys:', Object.keys(item));
        // Show first few keys' values
        Object.keys(item).slice(0, 5).forEach(key => {
          console.log(`  ${key}:`, typeof item[key] === 'object' ? JSON.stringify(item[key]).substring(0, 50) + '...' : item[key]);
        });
      }
    });
  }

  // Also check individual step outputs within the scatter
  console.log('\n=== Individual Step Outputs ===');
  ['step5', 'step6', 'step6_sanitize', 'step7'].forEach(stepId => {
    if (trace[stepId]) {
      console.log(`\n${stepId}:`, typeof trace[stepId]);
      if (typeof trace[stepId] === 'object' && !Array.isArray(trace[stepId])) {
        console.log('  Keys:', Object.keys(trace[stepId]));
      }
    } else {
      console.log(`\n${stepId}: NOT FOUND`);
    }
  });
}

main();
