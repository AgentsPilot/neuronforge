const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function validate() {
  const execId = 'ae71c286-25a0-4e36-81c6-e961ffedb256';

  console.log('🔍 Validating execution:', execId);
  console.log('');

  const { data: steps } = await supabase
    .from('workflow_step_executions')
    .select('step_id, step_name, status, tokens_used, execution_time_ms, completed_at, complexity_score, selected_tier, selected_model, workflow_execution_id')
    .eq('workflow_execution_id', execId)
    .order('created_at');

  if (!steps || steps.length === 0) {
    console.log('No steps found');
    return;
  }

  console.log(`Found ${steps.length} step records:\n`);

  steps.forEach((s, i) => {
    console.log(`Step ${i + 1}: ${s.step_name} (${s.step_id})`);
    console.log(`  Status: ${s.status}`);
    console.log(`  Tokens: ${s.tokens_used !== null ? s.tokens_used : 'NULL'}`);
    console.log(`  Exec Time: ${s.execution_time_ms !== null ? s.execution_time_ms + 'ms' : 'NULL'}`);
    console.log(`  Completed: ${s.completed_at || 'NULL'}`);
    console.log(`  Complexity: ${s.complexity_score || 'N/A'}`);
    console.log(`  Tier: ${s.selected_tier || 'N/A'}`);
    console.log(`  Model: ${s.selected_model || 'N/A'}`);
    console.log('');
  });

  console.log('═══════════════════════════════════════');
  console.log('VALIDATION:');
  const allCompleted = steps.every(s => s.status === 'completed');
  const allHaveTokens = steps.every(s => s.tokens_used !== null);
  const allHaveExecTime = steps.every(s => s.execution_time_ms !== null);
  const step2 = steps.find(s => s.step_id === 'step2');
  const hasRouting = step2 && step2.complexity_score && step2.selected_tier;

  console.log(`✅ All completed: ${allCompleted ? 'YES' : 'NO'}`);
  console.log(`✅ All have tokens: ${allHaveTokens ? 'YES' : 'NO'}`);
  console.log(`✅ All have exec_time: ${allHaveExecTime ? 'YES' : 'NO'}`);
  console.log(`✅ Step2 has routing: ${hasRouting ? 'YES' : 'NO'}`);
  console.log('═══════════════════════════════════════');

  if (allCompleted && allHaveTokens && allHaveExecTime && hasRouting) {
    console.log('\n🎉 ALL VALIDATION CHECKS PASSED! 🎉');
  }
}

validate().then(() => process.exit(0));
