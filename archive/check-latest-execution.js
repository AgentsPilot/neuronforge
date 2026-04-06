// Check latest execution for orchestration routing
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function checkLatestExecution() {
  console.log('🔍 Checking latest execution for agent 38469634-354d-4655-ac0b-5c446112430d...\n');

  // Get latest execution
  const { data: execution, error: execError } = await supabase
    .from('agent_executions')
    .select('id, status, created_at')
    .eq('agent_id', '38469634-354d-4655-ac0b-5c446112430d')
    .order('created_at', { ascending: false })
    .limit(1)
    .single();

  if (execError || !execution) {
    console.error('❌ Error fetching execution:', execError?.message);
    return;
  }

  console.log(`📊 Latest Execution: ${execution.id}`);
  console.log(`   Status: ${execution.status}`);
  console.log(`   Created: ${execution.created_at}\n`);

  // Get step executions
  const { data: steps, error: stepsError } = await supabase
    .from('workflow_step_executions')
    .select('*')
    .eq('workflow_execution_id', execution.id)
    .order('created_at');

  if (stepsError) {
    console.error('❌ Error fetching step executions:', stepsError.message);
    return;
  }

  if (!steps || steps.length === 0) {
    console.log('⚠️  No step execution records found in database');
    return;
  }

  console.log(`\n📋 Step Execution Records: ${steps.length}\n`);

  steps.forEach((step, index) => {
    console.log(`Step ${index + 1}: ${step.step_name}`);
    console.log(`  ID: ${step.step_id}`);
    console.log(`  Type: ${step.step_type}`);
    console.log(`  Status: ${step.status}`);

    // Check if orchestration routing data exists
    const hasRoutingData = !!(
      step.complexity_score ||
      step.selected_tier ||
      step.selected_model ||
      step.effective_complexity
    );

    if (hasRoutingData) {
      console.log(`  ✅ HAS ROUTING DATA:`);
      console.log(`     Complexity Score: ${step.complexity_score}`);
      console.log(`     Effective Complexity: ${step.effective_complexity}`);
      console.log(`     Agent AIS: ${step.agent_ais_score}`);
      console.log(`     Selected Tier: ${step.selected_tier}`);
      console.log(`     Selected Model: ${step.selected_model}`);
      console.log(`     Tokens Used: ${step.tokens_used}`);
      console.log(`     AIS Token Complexity: ${step.ais_token_complexity}`);
      console.log(`     AIS Execution Complexity: ${step.ais_execution_complexity}`);
    } else {
      console.log(`  ❌ NO ROUTING DATA (step executed without orchestration)`);
    }
    console.log('');
  });

  // Summary
  const stepsWithRouting = steps.filter(s => s.complexity_score || s.selected_tier);
  const stepsWithoutRouting = steps.filter(s => !s.complexity_score && !s.selected_tier);

  console.log(`\n📊 Summary:`);
  console.log(`   Total steps: ${steps.length}`);
  console.log(`   ✅ With routing data: ${stepsWithRouting.length}`);
  console.log(`   ❌ Without routing data: ${stepsWithoutRouting.length}`);

  if (stepsWithoutRouting.length > 0) {
    console.log(`\n⚠️  Steps without routing data:`);
    stepsWithoutRouting.forEach(s => {
      console.log(`   - ${s.step_name} (${s.step_type})`);
    });
  }

  if (stepsWithRouting.length === steps.length) {
    console.log('\n🎉 SUCCESS! All steps have orchestration routing data!');
  } else if (stepsWithRouting.length > 0) {
    console.log('\n⚠️  PARTIAL: Some steps have routing data, but not all');
  } else {
    console.log('\n❌ FAILURE: No steps have routing data - orchestration not working');
  }
}

checkLatestExecution()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
  });
