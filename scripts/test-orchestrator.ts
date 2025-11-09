/**
 * Test script for Workflow Orchestrator
 *
 * Usage: npx tsx scripts/test-orchestrator.ts
 */

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function testOrchestrator() {
  console.log('🧪 Workflow Orchestrator Test Suite\n');

  // Step 1: Check orchestrator configuration
  console.log('📋 Step 1: Checking orchestrator configuration...');
  const { data: config, error: configError } = await supabase
    .from('system_settings_config')
    .select('key, value')
    .eq('category', 'orchestrator')
    .order('key');

  if (configError) {
    console.error('❌ Failed to fetch config:', configError);
    return;
  }

  console.log('✅ Orchestrator configuration:');
  config?.forEach(setting => {
    console.log(`   - ${setting.key}: ${setting.value}`);
  });
  console.log('');

  // Step 2: Check for agents with workflow_steps
  console.log('📋 Step 2: Checking for agents with workflow_steps...');
  const { data: agents, error: agentsError } = await supabase
    .from('agents')
    .select('id, agent_name, workflow_steps, user_id')
    .not('workflow_steps', 'is', null)
    .limit(5);

  if (agentsError) {
    console.error('❌ Failed to fetch agents:', agentsError);
    return;
  }

  if (!agents || agents.length === 0) {
    console.log('⚠️  No agents with workflow_steps found.');
    console.log('\n📝 To test the orchestrator, you need to:');
    console.log('   1. Create an agent using the Smart Agent Builder');
    console.log('   2. Ensure the agent has workflow_steps defined');
    console.log('   3. Run this script again\n');
    return;
  }

  console.log(`✅ Found ${agents.length} agent(s) with workflow_steps:`);
  agents.forEach(agent => {
    const steps = agent.workflow_steps as any[];
    console.log(`   - ${agent.agent_name} (${agent.id})`);
    console.log(`     Steps: ${steps?.length || 0}`);
  });
  console.log('');

  // Step 3: Check workflow_executions table
  console.log('📋 Step 3: Checking workflow execution history...');
  const { data: executions, error: execError } = await supabase
    .from('workflow_executions')
    .select('id, agent_id, status, total_steps, completed_steps_count, started_at')
    .order('started_at', { ascending: false })
    .limit(10);

  if (execError) {
    console.error('❌ Failed to fetch executions:', execError);
    return;
  }

  if (!executions || executions.length === 0) {
    console.log('⚠️  No workflow executions found yet.');
    console.log('\n📝 To create a workflow execution:');
    console.log('   1. Go to the agent dashboard');
    console.log('   2. Run an agent that has workflow_steps');
    console.log('   3. Check the logs for orchestrator execution\n');
  } else {
    console.log(`✅ Found ${executions.length} workflow execution(s):`);
    executions.forEach(exec => {
      console.log(`   - ${exec.id.substring(0, 8)}... | Status: ${exec.status} | Steps: ${exec.completed_steps_count}/${exec.total_steps} | ${new Date(exec.started_at).toLocaleString()}`);
    });
  }
  console.log('');

  // Step 4: Test execution summary
  console.log('📋 Step 4: Execution Summary');
  console.log('━'.repeat(60));

  const orchestratorEnabled = config?.find(c => c.key === 'workflow_orchestrator_enabled')?.value;
  const agentsWithWorkflows = agents?.length || 0;
  const totalExecutions = executions?.length || 0;
  const successfulExecutions = executions?.filter(e => e.status === 'completed').length || 0;

  console.log(`Orchestrator Enabled: ${orchestratorEnabled ? '✅ YES' : '❌ NO'}`);
  console.log(`Agents with Workflows: ${agentsWithWorkflows}`);
  console.log(`Total Executions: ${totalExecutions}`);
  console.log(`Successful: ${successfulExecutions}`);
  console.log('');

  if (orchestratorEnabled && agentsWithWorkflows > 0) {
    console.log('✅ System is ready for orchestrator testing!');
    console.log('\n📝 Next steps:');
    console.log('   1. Navigate to the agent dashboard');
    console.log(`   2. Run agent: ${agents[0].agent_name}`);
    console.log('   3. Watch the logs for orchestrator execution');
    console.log('   4. Check workflow_executions table for results');
  } else if (!orchestratorEnabled) {
    console.log('⚠️  Orchestrator is DISABLED');
    console.log('   Enable it at: /admin/system-config');
  } else {
    console.log('⚠️  No agents with workflow_steps found');
    console.log('   Create one using the Smart Agent Builder');
  }

  console.log('\n━'.repeat(60));
}

testOrchestrator().catch(console.error);
