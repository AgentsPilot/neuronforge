import { config } from 'dotenv';
config({ path: '.env.local' });

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function main() {
  const agentId = '43ffbc8a-406d-4a43-9f3f-4e7554160eda';

  console.log('Fetching agent...');
  const { data: agent } = await supabase
    .from('agents')
    .select('pilot_steps')
    .eq('id', agentId)
    .single();

  if (!agent) {
    console.log('Agent not found');
    return;
  }

  // Find step4 (scatter-gather)
  const step4 = agent.pilot_steps.find((s: any) => s.id === 'step4');
  if (!step4) {
    console.log('Step4 not found');
    return;
  }

  // Remove step6_sanitize
  const originalStepCount = step4.scatter.steps.length;
  step4.scatter.steps = step4.scatter.steps.filter((s: any) =>
    s.id !== 'step6_sanitize' && s.step_id !== 'step6_sanitize'
  );

  console.log(`Removed sanitize step (${originalStepCount} -> ${step4.scatter.steps.length} steps)`);

  // Also revert step7-10 to use extracted_fields instead of extracted_fields_clean
  for (const step of step4.scatter.steps) {
    if (step.config) {
      const configStr = JSON.stringify(step.config);
      const updated = configStr
        .replace(/{{extracted_fields_clean\./g, '{{extracted_fields.')
        .replace(/{{extracted_fields_clean}}/g, '{{extracted_fields}}');
      step.config = JSON.parse(updated);
    }

    if (step.input) {
      if (typeof step.input === 'string') {
        step.input = step.input
          .replace(/{{extracted_fields_clean\./g, '{{extracted_fields.')
          .replace(/{{extracted_fields_clean}}/g, '{{extracted_fields}}');
      } else if (typeof step.input === 'object') {
        const inputStr = JSON.stringify(step.input);
        step.input = JSON.parse(
          inputStr
            .replace(/{{extracted_fields_clean\./g, '{{extracted_fields.')
            .replace(/{{extracted_fields_clean}}/g, '{{extracted_fields}}')
        );
      }
    }
  }

  console.log('Reverted downstream steps to use extracted_fields');

  // Save the updated workflow
  const { error } = await supabase
    .from('agents')
    .update({ pilot_steps: agent.pilot_steps })
    .eq('id', agentId);

  if (error) {
    console.error('Failed to update agent:', error);
    return;
  }

  console.log('✅ Agent reset successfully');
  console.log('\nNow trigger calibration to create the improved sanitize step:');
  console.log('1. Go to calibration UI');
  console.log('2. Or use the API: POST /api/v2/calibrate/batch?agentId=' + agentId);
}

main();
