import { config } from 'dotenv';
import * as path from 'path';
config({ path: path.resolve(process.cwd(), '.env.local') });

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function main() {
  const { data } = await supabase
    .from('workflow_executions')
    .select('execution_trace, created_at')
    .eq('agent_id', '43ffbc8a-406d-4a43-9f3f-4e7554160eda')
    .order('created_at', { ascending: false })
    .limit(1)
    .single();

  console.log('Created at:', data.created_at);

  const trace = data.execution_trace;

  // Find all keys
  console.log('\nAll trace keys:', Object.keys(trace).sort());

  // Check stepExecutions
  if (trace.stepExecutions) {
    console.log('\n📋 Step Executions:');
    for (const [stepId, execution] of Object.entries(trace.stepExecutions as any)) {
      const exec = execution as any;
      console.log(`\n${stepId}:`);
      console.log('  Status:', exec.status);
      if (exec.error) {
        console.log('  Error:', exec.error.substring(0, 200));
      }
      if (exec.output) {
        console.log('  Output keys:', Object.keys(exec.output));
      }
    }
  }

  // Check failed steps
  if (trace.failedSteps) {
    console.log('\n❌ Failed steps:', trace.failedSteps);
  }

  // Check completed steps
  if (trace.completedSteps) {
    console.log('\n✅ Completed steps:', trace.completedSteps);
  }
}

main();
