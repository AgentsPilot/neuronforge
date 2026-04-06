// Analyze agent workflow for LLM steps
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const agentId = process.argv[2] || '38469634-354d-4655-ac0b-5c446112430d';

async function analyzeWorkflow() {
  const { data: agent, error } = await supabase
    .from('agents')
    .select('agent_name, pilot_steps, workflow_steps')
    .eq('id', agentId)
    .single();

  if (error || !agent) {
    console.error('Error fetching agent:', error || 'Agent not found');
    return;
  }

  console.log('Agent:', agent.agent_name);
  console.log('ID:', agentId);
  console.log('');

  // Try pilot_steps first, then workflow_steps
  const steps = agent.pilot_steps || agent.workflow_steps;

  if (!steps || !Array.isArray(steps) || steps.length === 0) {
    console.log('❌ No workflow steps found');
    return;
  }

  console.log('Workflow steps:');

  steps.forEach((s, i) => {
    const isLLM = ['generate', 'llm_decision', 'ai_processing', 'summarize', 'extract', 'transform'].includes(s.type);
    const emoji = isLLM ? '🤖 LLM' : '⚙️  Plugin';
    console.log(`  ${i+1}. [${emoji}] ${s.name} (${s.type})`);

    if (s.plugin && s.action) {
      console.log(`      Plugin: ${s.plugin}.${s.action}`);
    }
  });

  const llmSteps = steps.filter(s =>
    ['generate', 'llm_decision', 'ai_processing', 'summarize', 'extract', 'transform'].includes(s.type)
  );

  console.log('');
  console.log(`Total: ${steps.length} steps, ${llmSteps.length} LLM steps`);

  if (llmSteps.length === 0) {
    console.log('');
    console.log('❌ This agent has NO LLM steps - all steps are deterministic plugins');
    console.log('   Per-step AIS routing only applies to LLM steps');
    console.log('');
    console.log('💡 To test per-step routing, find an agent with LLM steps');
    console.log('');
    console.log('Searching for agents with LLM steps...');

    const { data: allAgents } = await supabase
      .from('agents')
      .select('id, agent_name, pilot_steps, workflow_steps')
      .limit(20);

    const agentsWithLLM = [];

    for (const testAgent of (allAgents || [])) {
      const testSteps = testAgent.pilot_steps || testAgent.workflow_steps || [];
      const testLLMSteps = testSteps.filter(s =>
        ['generate', 'llm_decision', 'ai_processing', 'summarize', 'extract', 'transform'].includes(s.type)
      );

      if (testLLMSteps.length > 0) {
        agentsWithLLM.push({
          id: testAgent.id,
          name: testAgent.agent_name,
          llmStepCount: testLLMSteps.length,
          llmSteps: testLLMSteps.map(s => s.name)
        });
      }
    }

    if (agentsWithLLM.length > 0) {
      console.log('');
      console.log(`Found ${agentsWithLLM.length} agent(s) with LLM steps:\n`);

      agentsWithLLM.slice(0, 5).forEach((a, i) => {
        console.log(`${i+1}. ${a.name}`);
        console.log(`   ID: ${a.id}`);
        console.log(`   LLM steps (${a.llmStepCount}): ${a.llmSteps.join(', ')}`);
        console.log('');
      });

      console.log('🎯 Run one of these agents to test per-step AIS routing!');
    } else {
      console.log('');
      console.log('⚠️  No agents with LLM steps found in database');
      console.log('   Create an agent with generate/summarize/transform steps to test routing');
    }
  } else {
    console.log('');
    console.log('✅ This agent HAS LLM steps - routing data should be logged!');
    console.log(`   LLM steps: ${llmSteps.map(s => s.name).join(', ')}`);
  }
}

analyzeWorkflow()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
  });
