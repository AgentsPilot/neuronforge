const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function check() {
  // Get most recent step records
  const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();

  const { data: steps } = await supabase
    .from('workflow_step_executions')
    .select('*')
    .gte('created_at', fiveMinAgo)
    .order('created_at', { ascending: false })
    .limit(3);

  if (!steps || steps.length === 0) {
    console.log('❌ No recent steps found');
    return;
  }

  const execId = steps[0].workflow_execution_id;
  console.log('📊 Latest execution:', execId);
  console.log(`Found ${steps.length} recent steps\n`);

  // Get all steps for this execution
  const { data: allSteps } = await supabase
    .from('workflow_step_executions')
    .select('*')
    .eq('workflow_execution_id', execId)
    .order('created_at');

  console.log(`Total steps in execution: ${allSteps?.length || 0}\n`);

  allSteps?.forEach((s, i) => {
    console.log(`Step ${i + 1}: ${s.step_name} (${s.step_id})`);
    console.log(`  Type: ${s.step_type}`);
    console.log(`  Status: ${s.status}`);
    console.log(`  Started: ${s.started_at || 'NULL ❌'}`);
    console.log(`  Completed: ${s.completed_at || 'NULL'}`);
    console.log(`  Tokens: ${s.tokens_used !== null ? s.tokens_used : 'NULL ❌'}`);
    console.log(`  Exec Time: ${s.execution_time_ms ? s.execution_time_ms + 'ms' : 'NULL ❌'}`);
    console.log(`  Plugin: ${s.plugin || 'NULL'}`);
    console.log(`  Action: ${s.action || 'NULL'}`);
    if (s.complexity_score) {
      console.log(`  Complexity: ${s.complexity_score}`);
      console.log(`  Tier: ${s.selected_tier}`);
      console.log(`  Model: ${s.selected_model}`);
    }
    console.log('');
  });

  console.log('═══════════════════════════════════════');
  console.log('FINAL VALIDATION:');
  console.log('═══════════════════════════════════════');

  const allSameExecId = allSteps.every(s => s.workflow_execution_id === execId);
  const allCompleted = allSteps.every(s => s.status === 'completed');
  const allHaveStarted = allSteps.every(s => s.started_at !== null);
  const allHaveTokens = allSteps.every(s => s.tokens_used !== null);
  const allHaveExecTime = allSteps.every(s => s.execution_time_ms !== null);

  const step1 = allSteps.find(s => s.step_id === 'step1');
  const step2 = allSteps.find(s => s.step_id === 'step2');
  const step3 = allSteps.find(s => s.step_id === 'step3');

  const step1HasPlugin = step1 && step1.plugin !== null && step1.action !== null;
  const step2HasName = step2 && step2.step_name !== 'step2';
  const step2HasRouting = step2 && step2.complexity_score && step2.selected_tier;
  const step3HasPlugin = step3 && step3.plugin !== null && step3.action !== null;

  console.log(`1. All same execution_id: ${allSameExecId ? '✅ YES' : '❌ NO'}`);
  console.log(`2. All completed: ${allCompleted ? '✅ YES' : '❌ NO'}`);
  console.log(`3. All have started_at: ${allHaveStarted ? '✅ YES' : '❌ NO'}`);
  console.log(`4. All have tokens_used: ${allHaveTokens ? '✅ YES' : '❌ NO'}`);
  console.log(`5. All have exec_time: ${allHaveExecTime ? '✅ YES' : '❌ NO'}`);
  console.log(`6. Step 1 has plugin/action: ${step1HasPlugin ? '✅ YES' : '❌ NO'}`);
  console.log(`7. Step 2 has proper name: ${step2HasName ? '✅ YES (' + step2?.step_name + ')' : '❌ NO'}`);
  console.log(`8. Step 2 has routing: ${step2HasRouting ? '✅ YES' : '❌ NO'}`);
  console.log(`9. Step 3 has plugin/action: ${step3HasPlugin ? '✅ YES' : '❌ NO'}`);
  console.log('═══════════════════════════════════════');

  const allPassed = allSameExecId && allCompleted && allHaveStarted && allHaveTokens &&
                    allHaveExecTime && step1HasPlugin && step2HasName && step2HasRouting && step3HasPlugin;

  if (allPassed) {
    console.log('\n🎉🎉🎉 ALL CHECKS PASSED! 🎉🎉🎉');
    console.log('✅ Per-step AIS tracking is 100% complete!');
    console.log('✅ All metadata fields properly populated!');
  } else {
    console.log('\n⚠️  Some checks failed - see above');
  }
  console.log('═══════════════════════════════════════\n');
}

check().then(() => process.exit(0)).catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
