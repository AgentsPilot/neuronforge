import { config } from 'dotenv';
config({ path: '.env.local' });

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function main() {
  // Get agent's pilot_steps
  const { data: agent, error } = await supabase
    .from('agents')
    .select('pilot_steps, input_schema')
    .eq('id', '43ffbc8a-406d-4a43-9f3f-4e7554160eda')
    .single();

  if (error || !agent) {
    console.log('Error fetching agent:', error);
    return;
  }

  console.log('=== FLATTENING WORKFLOW STEPS ===\n');

  const steps = agent.pilot_steps || [];
  const flatSteps: any[] = [];

  function flattenSteps(stepsList: any[], parentPath: string = '') {
    for (const step of stepsList) {
      const stepPath = parentPath ? `${parentPath} > ${step.step_id}` : step.step_id;
      flatSteps.push({ ...step, path: stepPath });

      // If scatter_gather, flatten nested steps
      if (step.type === 'scatter_gather' && step.config?.steps) {
        flattenSteps(step.config.steps, stepPath);
      }
    }
  }

  flattenSteps(steps);

  console.log(`Total flattened steps: ${flatSteps.length}\n`);

  // Display all steps with numbers
  flatSteps.forEach((step, index) => {
    const stepNum = index + 1;
    console.log(`Step ${stepNum}: ${step.path}`);
    console.log(`  Type: ${step.type}`);
    if (step.plugin) {
      console.log(`  Plugin: ${step.plugin}`);
      console.log(`  Action: ${step.action || step.operation || 'N/A'}`);
    }
    console.log('');
  });

  // Highlight step 8
  if (flatSteps.length >= 8) {
    console.log('=== STEP 8 DETAILS ===\n');
    const step8 = flatSteps[7]; // 0-indexed
    console.log('Path:', step8.path);
    console.log('Type:', step8.type);
    console.log('Plugin:', step8.plugin);
    console.log('Action:', step8.action || step8.operation);
    console.log('\nConfig:');
    console.log(JSON.stringify(step8.config, null, 2));

    // Check if it's send_email
    if (step8.plugin === 'google-mail' && (step8.action === 'send_email' || step8.operation === 'send_email')) {
      console.log('\n=== ANALYSIS ===');
      console.log('This is the send_email step that failed with "Recipient address required"');

      // Check if recipients config exists
      if (step8.config?.recipients) {
        console.log('\nRecipients config found:');
        console.log(JSON.stringify(step8.config.recipients, null, 2));
      } else {
        console.log('\nERROR: No recipients config found!');
      }

      // Check for config variable references
      const configStr = JSON.stringify(step8.config);
      const configRefs = configStr.match(/\{\{config\.\w+\}\}/g);
      if (configRefs) {
        console.log('\nConfig variable references:');
        configRefs.forEach(ref => console.log('  -', ref));

        // Check input_schema for these values
        console.log('\n=== INPUT SCHEMA VALUES ===');
        if (agent.input_schema && Array.isArray(agent.input_schema)) {
          agent.input_schema.forEach((field: any) => {
            if (field.default_value !== undefined && field.default_value !== null && field.default_value !== '') {
              console.log(`${field.name} = ${field.default_value}`);
            }
          });
        }
      }
    }
  } else {
    console.log('ERROR: Workflow has fewer than 8 steps!');
  }
}

main();
