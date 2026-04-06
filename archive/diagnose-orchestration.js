// Diagnose why orchestration isn't creating step records
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function diagnose() {
  const agentId = '38469634-354d-4655-ac0b-5c446112430d';

  console.log('🔍 Diagnosing orchestration issue...\n');

  // 1. Get agent workflow steps
  const { data: agent } = await supabase
    .from('agents')
    .select('agent_name, pilot_steps, workflow_steps')
    .eq('id', agentId)
    .single();

  const steps = agent.pilot_steps || agent.workflow_steps || [];

  console.log('📋 Agent Workflow Steps:');
  steps.forEach((s, i) => {
    console.log(`  ${i + 1}. ${s.id} - ${s.name} (type: ${s.type})`);
  });
  console.log('');

  // 2. Get latest execution
  const { data: execution } = await supabase
    .from('agent_executions')
    .select('id, status')
    .eq('agent_id', agentId)
    .order('created_at', { ascending: false })
    .limit(1)
    .single();

  console.log(`📊 Latest Execution: ${execution.id}`);
  console.log(`   Status: ${execution.status}\n`);

  // 3. Check orchestration_executions
  const { data: orchExecs } = await supabase
    .from('orchestration_executions')
    .select('*')
    .eq('workflow_execution_id', execution.id);

  console.log(`🎯 Orchestration Executions: ${orchExecs?.length || 0}`);
  if (orchExecs && orchExecs.length > 0) {
    orchExecs.forEach(oe => {
      console.log(`   ID: ${oe.id}`);
      console.log(`   Steps Tracked: ${oe.total_steps_tracked}`);
      console.log(`   Intent Distribution:`, oe.intent_distribution);
    });
  }
  console.log('');

  // 4. Check workflow_step_executions
  const { data: stepExecs } = await supabase
    .from('workflow_step_executions')
    .select('step_id, step_name, step_type, status')
    .eq('workflow_execution_id', execution.id);

  console.log(`📝 Workflow Step Executions: ${stepExecs?.length || 0}`);
  if (stepExecs && stepExecs.length > 0) {
    stepExecs.forEach(se => {
      console.log(`   ${se.step_id} - ${se.step_name} (${se.step_type}) - ${se.status}`);
    });
  } else {
    console.log('   ❌ No step execution records found!');
  }
  console.log('');

  // 5. Analysis
  console.log('🔍 Analysis:');
  console.log(`   Workflow has ${steps.length} steps`);
  console.log(`   Orchestration tracked ${orchExecs?.[0]?.total_steps_tracked || 0} steps`);
  console.log(`   Database has ${stepExecs?.length || 0} step execution records`);
  console.log('');

  if (steps.length > 0 && (stepExecs?.length || 0) === 0) {
    console.log('❌ PROBLEM: Steps executed but no records created');
    console.log('   Possible causes:');
    console.log('   1. WorkflowOrchestrator.executeStep() returning null (step ID mismatch?)');
    console.log('   2. StateManager.logStepExecution() failing silently');
    console.log('   3. RLS policies blocking INSERT');
    console.log('   4. Steps bypassing orchestration entirely');
  }
}

diagnose()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('Fatal:', err);
    process.exit(1);
  });
