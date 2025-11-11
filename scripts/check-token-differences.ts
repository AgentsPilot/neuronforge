// Script to check token differences in duplicate executions
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function checkTokenDifferences() {
  console.log('🔍 Analyzing token differences in duplicate executions...\n');

  // Get recent executions and find the ones with matching prefixes
  const { data: allExecs, error: allError } = await supabase
    .from('agent_executions')
    .select('*')
    .order('started_at', { ascending: false })
    .limit(20);

  if (allError) {
    console.error('❌ Error querying all:', allError);
    return;
  }

  // Find the two executions that match the user's IDs
  const executions = allExecs?.filter(e =>
    e.id.startsWith('f944c15e') || e.id.startsWith('5e815e70')
  );

  executions?.forEach(exec => {
    console.log(`\n📊 Execution ${exec.id.slice(0, 8)}:`);
    console.log(`   Started: ${exec.started_at}`);
    console.log(`   Duration: ${exec.execution_duration_ms}ms`);
    console.log(`   Status: ${exec.status}`);
    console.log(`\n   Logs object:`);
    console.log(JSON.stringify(exec.logs, null, 2));
  });

  // Compare the logs
  if (executions && executions.length === 2) {
    console.log('\n\n🔬 COMPARISON:');
    const [exec1, exec2] = executions;

    console.log(`\nExecution 1 (${exec1.id.slice(0, 8)}):`);
    console.log(`  - Tokens: ${exec1.logs?.tokensUsed?.total || 'N/A'}`);
    console.log(`  - Has executionId: ${!!exec1.logs?.executionId}`);
    console.log(`  - Steps Completed: ${exec1.logs?.stepsCompleted || 'N/A'}`);
    console.log(`  - Pilot flag: ${exec1.logs?.pilot}`);

    console.log(`\nExecution 2 (${exec2.id.slice(0, 8)}):`);
    console.log(`  - Tokens: ${exec2.logs?.tokensUsed?.total || 'N/A'}`);
    console.log(`  - Has executionId: ${!!exec2.logs?.executionId}`);
    console.log(`  - Steps Completed: ${exec2.logs?.stepsCompleted || 'N/A'}`);
    console.log(`  - Pilot flag: ${exec2.logs?.pilot}`);
  }
}

checkTokenDifferences().catch(console.error);
