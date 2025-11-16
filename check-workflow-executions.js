// Check workflow executions to see if orchestration was used
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function checkWorkflowExecutions() {
  console.log('🔍 Checking workflow executions...\n');

  // Get recent workflow executions
  const { data: executions, error } = await supabase
    .from('workflow_executions')
    .select(`
      id,
      agent_id,
      status,
      execution_metadata,
      created_at
    `)
    .order('created_at', { ascending: false })
    .limit(5);

  if (error) {
    console.error('❌ Error:', error);
    return;
  }

  if (!executions || executions.length === 0) {
    console.log('⚠️  No workflow executions found');
    return;
  }

  console.log(`Found ${executions.length} recent workflow executions:\n`);

  executions.forEach((exec, i) => {
    const hasOrchestration = exec.execution_metadata?.orchestration ? true : false;
    console.log(`${i + 1}. Agent ID: ${exec.agent_id}`);
    console.log(`   Execution ID: ${exec.id}`);
    console.log(`   Status: ${exec.status}`);
    console.log(`   Orchestration: ${hasOrchestration ? '✅ ENABLED' : '❌ DISABLED'}`);

    if (exec.execution_metadata) {
      const meta = exec.execution_metadata;
      if (meta.orchestration) {
        console.log(`   📊 Orchestration metadata:`);
        console.log(`      - Execution ID: ${meta.orchestration.executionId || 'N/A'}`);
        console.log(`      - Token budget: ${meta.orchestration.totalBudget || 'N/A'}`);
      }
      if (meta.tokensUsed) {
        console.log(`   🎫 Tokens used: ${meta.tokensUsed}`);
      }
    }
    console.log(`   Created: ${exec.created_at}`);
    console.log();
  });

  // Now check if any steps from these executions have routing data
  console.log('🔍 Checking step executions for routing data...\n');

  const executionIds = executions.map(e => e.id);

  const { data: steps, error: stepsError } = await supabase
    .from('workflow_step_executions')
    .select(`
      workflow_execution_id,
      step_id,
      step_name,
      step_type,
      routed_at,
      selected_tier,
      selected_model,
      complexity_score
    `)
    .in('workflow_execution_id', executionIds)
    .order('created_at', { ascending: false });

  if (stepsError) {
    console.error('❌ Error fetching steps:', stepsError);
    return;
  }

  if (!steps || steps.length === 0) {
    console.log('⚠️  No step executions found for these workflow executions');
    return;
  }

  const stepsWithRouting = steps.filter(s => s.routed_at);
  const stepsWithoutRouting = steps.filter(s => !s.routed_at);

  console.log(`📋 Step execution summary:`);
  console.log(`   Total steps: ${steps.length}`);
  console.log(`   ✅ With routing data: ${stepsWithRouting.length}`);
  console.log(`   ❌ Without routing data: ${stepsWithoutRouting.length}`);
  console.log();

  if (stepsWithRouting.length > 0) {
    console.log('✅ Steps with routing data:');
    stepsWithRouting.forEach(step => {
      console.log(`   - ${step.step_name} (${step.step_type})`);
      console.log(`     Tier: ${step.selected_tier}, Model: ${step.selected_model}`);
      console.log(`     Complexity: ${step.complexity_score}`);
    });
  }

  if (stepsWithoutRouting.length > 0) {
    console.log('\n❌ Steps WITHOUT routing data (sample):');
    stepsWithoutRouting.slice(0, 5).forEach(step => {
      console.log(`   - ${step.step_name} (${step.step_type || 'unknown'})`);
    });
  }
}

checkWorkflowExecutions().then(() => process.exit(0)).catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
