import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';

// Load environment variables
config({ path: path.resolve(process.cwd(), '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const supabase = createClient(supabaseUrl, supabaseKey);

async function main() {
  // Find the expense extraction agent
  const { data: agents } = await supabase
    .from('agents')
    .select('*')
    .or('agent_name.ilike.%expense%,agent_name.ilike.%invoice%')
    .order('created_at', { ascending: false })
    .limit(1);

  if (!agents || agents.length === 0) {
    console.log('No agents found');
    return;
  }

  const agent = agents[0];
  console.log('=== AGENT ===');
  console.log('Name:', agent.agent_name);
  console.log('ID:', agent.id);
  console.log('Status:', agent.status);

  // Check workflow steps
  const steps = agent.pilot_steps || agent.workflow_steps || [];
  console.log('\n=== WORKFLOW STEPS ===');
  console.log(`Total steps: ${steps.length}`);

  for (const step of steps) {
    const stepId = step.id || step.step_id;
    console.log(`\n[${stepId}] ${step.name || step.action}`);
    console.log('Action:', step.action);

    // For scatter-gather, show nested steps
    if (step.scatter?.steps) {
      console.log('Scatter-gather with', step.scatter.steps.length, 'nested steps:');
      for (const nested of step.scatter.steps) {
        console.log(`  - [${nested.id || nested.step_id}] ${nested.action}`);
        if (nested.config) {
          console.log('    Config keys:', Object.keys(nested.config));
        }
      }
    }

    // Show config for key steps
    if (stepId === 'step1') {
      console.log('Config:', JSON.stringify(step.config, null, 2));
    }

    if (stepId === 'step2' && step.action === 'flatten') {
      console.log('Flatten config:', JSON.stringify(step.config, null, 2));
    }

    if (stepId === 'step11' && step.action === 'filter') {
      console.log('Filter config:', JSON.stringify(step.config, null, 2));
    }

    if (step.output_variable) {
      console.log('Output variable:', step.output_variable);
    }
  }

  // Save full workflow for inspection
  const outputPath = path.join(process.cwd(), 'current-workflow.json');
  fs.writeFileSync(outputPath, JSON.stringify({
    agent_id: agent.id,
    agent_name: agent.agent_name,
    workflow_steps: steps
  }, null, 2));
  console.log('\n=== Full workflow saved to:', outputPath);
}

main().catch(console.error);
