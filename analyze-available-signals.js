require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function analyzeSignals() {
  const agentId = '08eb9918-e60f-4179-a5f4-bc83b95fc15c';

  console.log('=== ANALYZING ALL AVAILABLE SIGNALS ===\n');

  // 1. Agent metadata
  const { data: agent } = await supabase
    .from('agents')
    .select('*')
    .eq('id', agentId)
    .single();

  console.log('1. AGENT METADATA:');
  console.log('   Name:', agent.agent_name);
  console.log('   Description:', agent.description);
  if (agent.system_prompt) {
    console.log('   System prompt:', agent.system_prompt.substring(0, 200) + '...');
  }
  console.log('');

  // 2. Workflow steps
  const { data: steps } = await supabase
    .from('workflow_steps')
    .select('*')
    .eq('agent_id', agentId)
    .order('step_order');

  console.log('2. WORKFLOW STEPS (Full Details):');
  steps.forEach((s, i) => {
    console.log((i+1) + '. ' + s.step_name);
    console.log('   Plugin: ' + s.plugin + '.' + s.action);
    if (s.user_prompt) {
      console.log('   User Prompt: ' + s.user_prompt.substring(0, 100));
    }
    if (s.config) {
      console.log('   Config: ' + JSON.stringify(s.config).substring(0, 150));
    }
    console.log('');
  });

  // 3. Recent execution with full details
  const { data: execution } = await supabase
    .from('workflow_executions')
    .select('*')
    .eq('agent_id', agentId)
    .order('started_at', { ascending: false })
    .limit(1)
    .single();

  console.log('3. EXECUTION DATA AVAILABLE:');
  console.log('   execution_results:', execution.execution_results ? 'YES' : 'NO');
  console.log('   final_output:', execution.final_output ? 'YES' : 'NO');
  console.log('   logs:', execution.logs ? 'YES' : 'NO');

  if (execution.execution_results) {
    console.log('\n   execution_results structure:');
    const result = JSON.stringify(execution.execution_results, null, 2);
    console.log('   ' + result.substring(0, 500));
  }

  // 4. Step executions with config
  const { data: stepExecs } = await supabase
    .from('workflow_step_executions')
    .select('*')
    .eq('workflow_execution_id', execution.id)
    .order('created_at')
    .limit(3);

  console.log('\n4. STEP EXECUTION DATA:');
  if (stepExecs && stepExecs.length > 0) {
    console.log('   Sample step:', stepExecs[0].step_name);
    console.log('   Has output_metadata:', stepExecs[0].output_metadata ? 'YES' : 'NO');
    console.log('   Has config:', stepExecs[0].config ? 'YES' : 'NO');
    if (stepExecs[0].output_metadata) {
      console.log('   output_metadata:', JSON.stringify(stepExecs[0].output_metadata).substring(0, 200));
    }
    if (stepExecs[0].config) {
      console.log('   config:', JSON.stringify(stepExecs[0].config).substring(0, 200));
    }
  }

  console.log('\n5. KEY INSIGHT SOURCES:');
  console.log('   - Agent name/description (business context)');
  console.log('   - Step user_prompts (what user asked for)');
  console.log('   - Step configs (Gmail queries, Sheet ranges, etc)');
  console.log('   - Plugin actions (what operations are performed)');
  console.log('   - Data flow (which steps transform/filter)');
}

analyzeSignals().catch(console.error);
