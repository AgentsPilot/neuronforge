// Check routing data for specific agent
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const agentId = process.argv[2] || '38469634-354d-4655-ac0b-5c446112430d';

async function checkAgentRouting() {
  console.log('🔍 Checking agent execution routing data...\n');

  // Get agent info
  const { data: agent } = await supabase
    .from('agents')
    .select('agent_name')
    .eq('id', agentId)
    .single();

  console.log('Agent:', agent?.agent_name || 'Unknown');
  console.log('ID:', agentId);
  console.log('');

  // Get recent executions for this agent
  const { data: executions } = await supabase
    .from('workflow_executions')
    .select('id, status, created_at')
    .eq('agent_id', agentId)
    .order('created_at', { ascending: false })
    .limit(3);

  if (!executions || executions.length === 0) {
    console.log('❌ No executions found for this agent');
    return;
  }

  console.log(`📊 Found ${executions.length} recent execution(s):\n`);

  for (const exec of executions) {
    console.log(`Execution: ${exec.id}`);
    console.log(`  Status: ${exec.status}`);
    console.log(`  Created: ${exec.created_at}`);

    // Get steps for this execution
    const { data: steps } = await supabase
      .from('workflow_step_executions')
      .select(`
        step_id,
        step_name,
        step_type,
        complexity_score,
        ais_token_complexity,
        ais_execution_complexity,
        effective_complexity,
        selected_tier,
        selected_model,
        routing_reason,
        routed_at,
        created_at
      `)
      .eq('workflow_execution_id', exec.id)
      .order('created_at', { ascending: true });

    if (!steps || steps.length === 0) {
      console.log('  No steps found\n');
      continue;
    }

    const withRouting = steps.filter(s => s.routed_at);
    console.log(`  Steps: ${steps.length} total, ${withRouting.length} with routing data`);

    if (withRouting.length > 0) {
      console.log('  \n  ✅ STEPS WITH ROUTING DATA:\n');
      withRouting.forEach((s, i) => {
        console.log(`  ${i+1}. ${s.step_name} (${s.step_type})`);
        console.log(`     Complexity: ${s.complexity_score?.toFixed(2) || 'N/A'}`);
        console.log(`     AIS Token: ${s.ais_token_complexity?.toFixed(2) || 'N/A'}`);
        console.log(`     AIS Execution: ${s.ais_execution_complexity?.toFixed(2) || 'N/A'}`);
        console.log(`     Effective: ${s.effective_complexity?.toFixed(2) || 'N/A'}`);
        console.log(`     Tier: ${s.selected_tier || 'N/A'}`);
        console.log(`     Model: ${s.selected_model || 'N/A'}`);
        console.log(`     Reason: ${s.routing_reason ? s.routing_reason.substring(0, 60) : 'N/A'}`);
        console.log(`     Routed: ${s.routed_at}`);
        console.log('');
      });
    } else {
      console.log('  \n  ❌ NO ROUTING DATA (steps executed without WorkflowOrchestrator)\n');
      console.log('  Step details:');
      steps.slice(0, 5).forEach(s => {
        console.log(`    - ${s.step_name}: ${s.step_type || 'unknown'} (created: ${s.created_at})`);
      });
    }
    console.log('');
  }
}

checkAgentRouting()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('Error:', err);
    process.exit(1);
  });
