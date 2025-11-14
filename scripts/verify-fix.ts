// Script to verify the duplicate execution fix
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function verifyFix() {
  console.log('🔍 Verifying duplicate execution fix...\n');

  // Get the most recent execution
  const { data: recentExecution, error } = await supabase
    .from('agent_executions')
    .select('*')
    .order('started_at', { ascending: false })
    .limit(1)
    .single();

  if (error) {
    console.error('❌ Error querying recent execution:', error);
    return;
  }

  if (!recentExecution) {
    console.warn('⚠️  No executions found. Please run a test execution first.');
    return;
  }

  console.log('📊 Most Recent Execution:');
  console.log(`   ID: ${recentExecution.id}`);
  console.log(`   Short ID: ${recentExecution.id.slice(0, 8)}`);
  console.log(`   Started: ${recentExecution.started_at}`);
  console.log(`   Duration: ${recentExecution.execution_duration_ms}ms`);
  console.log(`   Status: ${recentExecution.status}`);

  // Check for the pilot flag
  console.log('\n🏷️  Execution Flags:');
  console.log(`   pilot: ${recentExecution.logs?.pilot}`);
  console.log(`   workflowExecution: ${recentExecution.logs?.workflowExecution}`);
  console.log(`   agentkit: ${recentExecution.logs?.agentkit}`);

  // UI Display Information
  console.log('\n🖥️  UI Display:');
  const displayName = recentExecution.logs?.pilot ? 'Workflow Pilot' : 'AgentKit';
  const credits = recentExecution.logs?.tokensUsed?.total
    ? Math.ceil(recentExecution.logs.tokensUsed.total / 10)
    : 0;
  const tokens = recentExecution.logs?.tokensUsed?.total || 0;

  console.log(`   Type: ${displayName}`);
  console.log(`   Credits: ${credits.toLocaleString()}`);
  console.log(`   Tokens: ${tokens.toLocaleString()}`);
  console.log(`   Steps: ${recentExecution.logs?.stepsCompleted || 0}/${(recentExecution.logs?.stepsCompleted || 0) + (recentExecution.logs?.stepsFailed || 0) + (recentExecution.logs?.stepsSkipped || 0)}`);

  // Check for duplicates with the same executionId
  if (recentExecution.logs?.executionId) {
    console.log('\n🔎 Checking for duplicates with same internal executionId...');
    const { data: duplicates, error: dupError } = await supabase
      .from('agent_executions')
      .select('id, started_at, logs')
      .order('started_at', { ascending: false })
      .limit(10);

    if (dupError) {
      console.error('❌ Error checking duplicates:', dupError);
      return;
    }

    const sameExecutionId = duplicates?.filter(
      exec => exec.logs?.executionId === recentExecution.logs.executionId && exec.id !== recentExecution.id
    );

    if (sameExecutionId && sameExecutionId.length > 0) {
      console.log(`   ⚠️  Found ${sameExecutionId.length} duplicate(s) with same executionId!`);
      sameExecutionId.forEach(dup => {
        console.log(`      - ${dup.id.slice(0, 8)} (started: ${dup.started_at})`);
        console.log(`        pilot: ${dup.logs?.pilot}, tokens: ${dup.logs?.tokensUsed?.total}`);
      });
    } else {
      console.log('   ✅ No duplicates found - fix is working!');
    }
  }

  // Check for temporal duplicates (same timestamp window)
  console.log('\n⏱️  Checking for temporal duplicates (same minute)...');
  const executionTime = new Date(recentExecution.started_at);
  const timeWindow = executionTime.toISOString().slice(0, 16); // YYYY-MM-DDTHH:MM

  const { data: allRecent, error: allError } = await supabase
    .from('agent_executions')
    .select('*')
    .gte('started_at', new Date(executionTime.getTime() - 60000).toISOString())
    .lte('started_at', new Date(executionTime.getTime() + 60000).toISOString())
    .order('started_at', { ascending: false });

  if (allError) {
    console.error('❌ Error checking temporal duplicates:', allError);
    return;
  }

  const sameDuration = allRecent?.filter(
    exec =>
      exec.execution_duration_ms === recentExecution.execution_duration_ms &&
      exec.agent_id === recentExecution.agent_id &&
      exec.id !== recentExecution.id
  );

  if (sameDuration && sameDuration.length > 0) {
    console.log(`   ⚠️  Found ${sameDuration.length} execution(s) with same duration in same time window!`);
    sameDuration.forEach(dup => {
      console.log(`      - ${dup.id.slice(0, 8)} (${dup.started_at})`);
      console.log(`        Duration: ${dup.execution_duration_ms}ms`);
      console.log(`        Tokens: ${dup.logs?.tokensUsed?.total}`);
      console.log(`        pilot: ${dup.logs?.pilot}, agentkit: ${dup.logs?.agentkit}`);
    });
  } else {
    console.log('   ✅ No temporal duplicates found - fix is working!');
  }

  console.log('\n✅ Verification complete!');
}

verifyFix().catch(console.error);
