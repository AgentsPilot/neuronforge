/**
 * Test Per-Step AIS Tracking
 * Simulates a workflow execution to verify routing data is logged
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function testPerStepAIS() {
  console.log('🧪 Testing Per-Step AIS Tracking\n');
  console.log('=' .repeat(60));

  // Step 1: Find an agent with a workflow
  console.log('\n📋 Step 1: Finding test agent...');
  const { data: agents, error: agentError } = await supabase
    .from('agents')
    .select('id, agent_name, workflow_definition')
    .not('workflow_definition', 'is', null)
    .limit(5);

  if (agentError || !agents || agents.length === 0) {
    console.error('❌ No agents with workflows found');
    return;
  }

  const agent = agents[0];
  console.log(`✅ Found agent: ${agent.agent_name} (${agent.id})`);

  // Step 2: Check if agent has AIS score
  console.log('\n📊 Step 2: Checking agent AIS score...');
  const { data: aisData } = await supabase
    .from('agent_intensity_metrics')
    .select('combined_score, creation_score, execution_score')
    .eq('agent_id', agent.id)
    .single();

  if (aisData) {
    console.log(`✅ Agent AIS: ${aisData.combined_score.toFixed(2)} (creation: ${aisData.creation_score.toFixed(2)}, execution: ${aisData.execution_score.toFixed(2)})`);
  } else {
    console.log('⚠️  Agent has no AIS score yet (will use default 5.0)');
  }

  // Step 3: Parse workflow to find LLM steps
  console.log('\n🔍 Step 3: Analyzing workflow...');
  const workflow = agent.workflow_definition;
  const steps = workflow.steps || [];

  const llmSteps = steps.filter(s =>
    ['generate', 'llm_decision', 'ai_processing', 'summarize', 'extract', 'transform'].includes(s.type)
  );

  console.log(`   Total steps: ${steps.length}`);
  console.log(`   LLM steps: ${llmSteps.length}`);

  if (llmSteps.length === 0) {
    console.log('⚠️  No LLM steps in workflow (trying another agent)');

    // Try to find agent with LLM steps
    for (const testAgent of agents) {
      const testSteps = testAgent.workflow_definition?.steps || [];
      const testLLMSteps = testSteps.filter(s =>
        ['generate', 'llm_decision', 'ai_processing', 'summarize', 'extract', 'transform'].includes(s.type)
      );

      if (testLLMSteps.length > 0) {
        console.log(`✅ Found agent with LLM steps: ${testAgent.agent_name}`);
        console.log(`   LLM steps: ${testLLMSteps.map(s => s.name).join(', ')}`);
        break;
      }
    }
  } else {
    console.log(`   LLM steps: ${llmSteps.map(s => s.name).join(', ')}`);
  }

  // Step 4: Check orchestration configuration
  console.log('\n⚙️  Step 4: Verifying orchestration configuration...');

  const configChecks = [
    'orchestration_enabled',
    'orchestration_ais_routing_enabled',
    'orchestration_per_step_tracking_enabled'
  ];

  for (const key of configChecks) {
    const { data } = await supabase
      .from('system_settings_config')
      .select('value')
      .eq('key', key)
      .single();

    const enabled = data?.value === true || data?.value === 'true';
    console.log(`   ${enabled ? '✅' : '❌'} ${key}: ${enabled}`);
  }

  // Step 5: Simulate what would happen during execution
  console.log('\n🎯 Step 5: Simulating routing decision...');

  if (llmSteps.length > 0) {
    const testStep = llmSteps[0];
    console.log(`   Test step: ${testStep.name} (${testStep.type})`);

    // Simulate complexity analysis
    const mockComplexity = {
      complexityScore: 5.2,
      factors: {
        promptLength: 6.0,
        dataSize: 4.0,
        conditionCount: 3.0,
        contextDepth: 5.0,
        reasoningDepth: 7.0,
        outputComplexity: 6.0
      },
      rawMeasurements: {
        promptLength: 450,
        dataSize: 2048,
        conditionCount: 2,
        contextDepth: 4
      }
    };

    const agentAIS = aisData?.combined_score || 5.0;
    const effectiveComplexity = (agentAIS * 0.6) + (mockComplexity.complexityScore * 0.4);

    console.log(`   Agent AIS: ${agentAIS.toFixed(2)}`);
    console.log(`   Step complexity: ${mockComplexity.complexityScore.toFixed(2)}`);
    console.log(`   Effective complexity: ${effectiveComplexity.toFixed(2)} (60% agent + 40% step)`);

    // Determine tier
    let tier = 'balanced';
    if (effectiveComplexity < 3.0) tier = 'fast';
    else if (effectiveComplexity > 6.5) tier = 'powerful';

    console.log(`   📍 Routing tier: ${tier}`);

    // Show what would be logged
    console.log('\n📝 Would log to database:');
    console.log('   complexity_score:', mockComplexity.complexityScore);
    console.log('   ais_token_complexity:', ((mockComplexity.factors.promptLength + mockComplexity.factors.dataSize) / 2).toFixed(2));
    console.log('   ais_execution_complexity:', ((mockComplexity.factors.reasoningDepth + mockComplexity.factors.outputComplexity) / 2).toFixed(2));
    console.log('   ais_workflow_complexity:', mockComplexity.factors.conditionCount);
    console.log('   ais_memory_complexity:', mockComplexity.factors.contextDepth);
    console.log('   effective_complexity:', effectiveComplexity.toFixed(2));
    console.log('   selected_tier:', tier);
    console.log('   agent_ais_score:', agentAIS.toFixed(2));
  }

  // Step 6: Check recent actual executions
  console.log('\n📊 Step 6: Checking recent workflow executions...');

  const { data: recentExecs } = await supabase
    .from('workflow_executions')
    .select('id, agent_id, status, created_at')
    .eq('agent_id', agent.id)
    .order('created_at', { ascending: false })
    .limit(3);

  if (recentExecs && recentExecs.length > 0) {
    console.log(`   Found ${recentExecs.length} recent executions:`);

    for (const exec of recentExecs) {
      console.log(`\n   Execution: ${exec.id}`);
      console.log(`   Status: ${exec.status}`);
      console.log(`   Created: ${exec.created_at}`);

      // Check if any steps have routing data
      const { data: execSteps } = await supabase
        .from('workflow_step_executions')
        .select('step_name, routed_at, selected_tier, complexity_score')
        .eq('workflow_execution_id', exec.id);

      if (execSteps) {
        const withRouting = execSteps.filter(s => s.routed_at);
        console.log(`   Steps: ${execSteps.length} total, ${withRouting.length} with routing data`);

        if (withRouting.length > 0) {
          console.log('   ✅ Steps with routing:');
          withRouting.forEach(s => {
            console.log(`      - ${s.step_name}: tier=${s.selected_tier}, complexity=${s.complexity_score}`);
          });
        }
      }
    }
  } else {
    console.log('   No recent executions found for this agent');
  }

  // Step 7: Instructions for live testing
  console.log('\n' + '='.repeat(60));
  console.log('\n📝 TO TEST LIVE:\n');
  console.log('1. Run this agent from the UI:');
  console.log(`   Agent: ${agent.agent_name}`);
  console.log(`   ID: ${agent.id}`);
  console.log('');
  console.log('2. After execution, run this query to check routing data:');
  console.log('');
  console.log('   node -e "');
  console.log('   const { createClient } = require(\'@supabase/supabase-js\');');
  console.log('   require(\'dotenv\').config({ path: \'.env.local\' });');
  console.log('   const supabase = createClient(');
  console.log('     process.env.NEXT_PUBLIC_SUPABASE_URL,');
  console.log('     process.env.SUPABASE_SERVICE_ROLE_KEY');
  console.log('   );');
  console.log('   (async () => {');
  console.log('     const { data } = await supabase');
  console.log('       .from(\'workflow_step_executions\')');
  console.log('       .select(\'step_name, complexity_score, selected_tier, selected_model, routed_at\')');
  console.log('       .not(\'routed_at\', \'is\', null)');
  console.log('       .order(\'routed_at\', { ascending: false })');
  console.log('       .limit(5);');
  console.log('     console.log(\'Recent routing decisions:\', data);');
  console.log('   })();');
  console.log('   "');
  console.log('');
  console.log('3. Or use the check script:');
  console.log('   node check-routing-logs.js');
  console.log('');
  console.log('='.repeat(60));
}

testPerStepAIS()
  .then(() => {
    console.log('\n✅ Test completed');
    process.exit(0);
  })
  .catch(err => {
    console.error('\n❌ Test failed:', err);
    process.exit(1);
  });
