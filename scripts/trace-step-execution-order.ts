import { config } from 'dotenv';
config({ path: '.env.local' });

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function main() {
  const { data: agent } = await supabase
    .from('agents')
    .select('pilot_steps')
    .eq('id', '43ffbc8a-406d-4a43-9f3f-4e7554160eda')
    .single();

  if (!agent) {
    console.log('Agent not found');
    return;
  }

  console.log('=== TOP-LEVEL WORKFLOW STEPS ===\n');

  const steps = agent.pilot_steps || [];
  steps.forEach((step: any, index: number) => {
    const stepNum = index + 1;
    console.log(`Step ${stepNum}: ${step.step_id}`);
    console.log(`  Type: ${step.type}`);
    console.log(`  Name: ${step.name || 'N/A'}`);

    if (step.type === 'scatter_gather' && step.config?.steps) {
      console.log(`  Contains ${step.config.steps.length} nested steps:`);
      step.config.steps.forEach((nested: any, nestedIndex: number) => {
        console.log(`    ${nestedIndex + 1}. ${nested.step_id} (${nested.type})`);
      });
    }
    console.log('');
  });

  console.log('=== EXECUTION ANALYSIS ===');
  console.log('Logs show: stepsCompleted: 7, stepsFailed: 1');
  console.log('Total top-level steps:', steps.length);

  console.log('\n=== HYPOTHESIS ===');
  console.log('If 7 steps completed:');
  console.log('1. step1 (search_emails) - ✅');
  console.log('2. step2 (flatten) - ✅');
  console.log('3. step3 (filter) - ✅');
  console.log('4. step4 (scatter_gather) - ✅ (container executed)');
  console.log('5. step11 (transform) - ✅');
  console.log('6. step12 (conditional) - ✅');
  console.log('7. step15 (ai_processing) - ✅');
  console.log('8. step16 (send_email) - ❌ FAILED');
  console.log('');
  console.log('This matches step16 failing with "Recipient address required"');
}

main();
