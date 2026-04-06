// Final validation - check all fixes are working
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function validate() {
  const agentId = '38469634-354d-4655-ac0b-5c446112430d';

  // Get latest execution
  const { data: exec } = await supabase
    .from('agent_executions')
    .select('id, status, created_at')
    .eq('agent_id', agentId)
    .order('created_at', { ascending: false })
    .limit(1)
    .single();

  if (!exec) {
    console.log('❌ No executions found');
    return;
  }

  const age = Math.round((Date.now() - new Date(exec.created_at).getTime()) / 1000);
  console.log(`📊 Latest execution: ${exec.id}`);
  console.log(`   Status: ${exec.status} (${age}s ago)\n`);

  // Get step records
  const { data: steps } = await supabase
    .from('workflow_step_executions')
    .select('step_id, step_name, status, tokens_used, execution_time_ms, completed_at, complexity_score, selected_tier, selected_model, workflow_execution_id')
    .eq('workflow_execution_id', exec.id)
    .order('created_at');

  if (!steps || steps.length === 0) {
    console.log('❌ No step records found');
    return;
  }

  console.log(`Found ${steps.length} step records:\n`);

  steps.forEach((s, i) => {
    console.log(`Step ${i + 1}: ${s.step_name} (${s.step_id})`);
    console.log(`  Status: ${s.status}`);
    console.log(`  Tokens: ${s.tokens_used !== null ? s.tokens_used : 'NULL ❌'}`);
    console.log(`  Exec Time: ${s.execution_time_ms !== null ? s.execution_time_ms + 'ms' : 'NULL ❌'}`);
    console.log(`  Completed: ${s.completed_at || 'NULL ❌'}`);
    console.log(`  Complexity: ${s.complexity_score || 'N/A (non-orchestrated)'}`);
    console.log(`  Tier: ${s.selected_tier || 'N/A'}`);
    console.log(`  Model: ${s.selected_model || 'N/A'}`);
    console.log(`  Execution ID: ${s.workflow_execution_id}`);
    console.log('');
  });

  // Validation
  console.log('\n═══════════════════════════════════════');
  console.log('VALIDATION RESULTS:');
  console.log('═══════════════════════════════════════\n');

  // Check 1: Same execution_id
  const executionIds = new Set(steps.map(s => s.workflow_execution_id));
  const sameExecId = executionIds.size === 1 && executionIds.has(exec.id);
  console.log(`1. All steps have same execution_id: ${sameExecId ? '✅ YES' : '❌ NO'}`);

  // Check 2: All completed
  const allCompleted = steps.every(s => s.status === 'completed');
  console.log(`2. All steps completed: ${allCompleted ? '✅ YES' : '❌ NO'}`);
  if (!allCompleted) {
    const notCompleted = steps.filter(s => s.status !== 'completed');
    notCompleted.forEach(s => console.log(`   - ${s.step_name}: ${s.status}`));
  }

  // Check 3: All have tokens_used
  const allHaveTokens = steps.every(s => s.tokens_used !== null);
  console.log(`3. All have tokens_used: ${allHaveTokens ? '✅ YES' : '❌ NO'}`);
  if (!allHaveTokens) {
    const noTokens = steps.filter(s => s.tokens_used === null);
    noTokens.forEach(s => console.log(`   - ${s.step_name}: NULL`));
  }

  // Check 4: All have execution_time_ms
  const allHaveExecTime = steps.every(s => s.execution_time_ms !== null);
  console.log(`4. All have execution_time_ms: ${allHaveExecTime ? '✅ YES' : '❌ NO'}`);
  if (!allHaveExecTime) {
    const noExecTime = steps.filter(s => s.execution_time_ms === null);
    noExecTime.forEach(s => console.log(`   - ${s.step_name}: NULL`));
  }

  // Check 5: Step2 has routing data
  const step2 = steps.find(s => s.step_id === 'step2');
  const hasRoutingData = step2 && step2.complexity_score && step2.selected_tier && step2.selected_model;
  console.log(`5. Step2 has routing data: ${hasRoutingData ? '✅ YES' : '❌ NO'}`);
  if (step2 && hasRoutingData) {
    console.log(`   - Complexity: ${step2.complexity_score}`);
    console.log(`   - Tier: ${step2.selected_tier}`);
    console.log(`   - Model: ${step2.selected_model}`);
  }

  console.log('\n═══════════════════════════════════════');

  const allPassed = sameExecId && allCompleted && allHaveTokens && allHaveExecTime && hasRoutingData;
  if (allPassed) {
    console.log('🎉 ALL VALIDATION CHECKS PASSED! 🎉');
    console.log('✅ Per-step AIS tracking is 100% working!');
  } else {
    console.log('⚠️  Some validation checks failed - see above');
  }
  console.log('═══════════════════════════════════════\n');
}

validate()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
  });
