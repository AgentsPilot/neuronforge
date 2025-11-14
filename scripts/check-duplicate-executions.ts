// Script to check for duplicate execution entries
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function checkDuplicates() {
  console.log('🔍 Checking for duplicate execution entries...\n');

  // Get recent executions
  const { data: executions, error } = await supabase
    .from('agent_executions')
    .select('*')
    .order('started_at', { ascending: false })
    .limit(20);

  if (error) {
    console.error('❌ Error querying agent_executions:', error);
    return;
  }

  console.log(`📊 Found ${executions?.length || 0} recent executions:\n`);

  // Group by timestamp to find potential duplicates
  const byTimestamp = new Map<string, any[]>();

  executions?.forEach(exec => {
    const timestamp = new Date(exec.started_at).toISOString().slice(0, 16); // Group by minute
    if (!byTimestamp.has(timestamp)) {
      byTimestamp.set(timestamp, []);
    }
    byTimestamp.get(timestamp)!.push(exec);
  });

  // Find duplicates (same timestamp)
  let foundDuplicates = false;
  byTimestamp.forEach((execs, timestamp) => {
    if (execs.length > 1) {
      foundDuplicates = true;
      console.log(`⚠️  Found ${execs.length} executions at ${timestamp}:`);
      execs.forEach(exec => {
        console.log(`   - ID: ${exec.id.slice(0, 8)}`);
        console.log(`     Agent: ${exec.agent_id}`);
        console.log(`     Duration: ${exec.execution_duration_ms}ms`);
        console.log(`     Status: ${exec.status}`);
        console.log(`     Steps Completed: ${exec.logs?.stepsCompleted || 'N/A'}`);
        console.log(`     Execution Type: ${exec.execution_type}`);
        console.log(`     Started: ${exec.started_at}`);
        console.log(`     Completed: ${exec.completed_at}`);
        console.log('');
      });
    }
  });

  if (!foundDuplicates) {
    console.log('✅ No duplicate executions found (same timestamp)\n');
  }

  // Show all recent executions
  console.log('\n📋 Recent executions (last 10):');
  executions?.slice(0, 10).forEach(exec => {
    console.log(`   ${exec.id.slice(0, 8)} | ${new Date(exec.started_at).toLocaleString()} | ${exec.execution_duration_ms}ms | Steps: ${exec.logs?.stepsCompleted || 'N/A'}`);
  });
}

checkDuplicates().catch(console.error);
