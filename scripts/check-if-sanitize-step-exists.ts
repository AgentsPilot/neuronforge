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

  const step4 = agent.pilot_steps.find((s: any) => s.id === 'step4');

  console.log('=== Scatter-Gather Steps ===');
  step4?.scatter?.steps?.forEach((step: any, index: number) => {
    console.log(`${index + 1}. ${step.id || step.step_id} (${step.type})`);

    if (step.id === 'step6_sanitize' || step.step_id === 'step6_sanitize') {
      console.log('   ✅ SANITIZE STEP FOUND!');
      console.log('   Input:', step.input);
      console.log('   Output var:', step.output_variable);
      console.log('   Instruction:', step.config?.instruction?.substring(0, 100) + '...');
    }

    if (step.id === 'step7') {
      console.log('   Config:', JSON.stringify(step.config, null, 2));
    }
  });

  const sanitizeStep = step4?.scatter?.steps?.find((s: any) =>
    s.id === 'step6_sanitize' || s.step_id === 'step6_sanitize'
  );

  if (!sanitizeStep) {
    console.log('\n❌ SANITIZE STEP NOT FOUND - Fix was not applied!');
  } else {
    console.log('\n✅ Sanitize step exists');

    // Check if step7 uses extracted_fields_clean
    const step7 = step4?.scatter?.steps?.find((s: any) => s.id === 'step7');
    if (step7) {
      const usesClean = JSON.stringify(step7.config).includes('extracted_fields_clean');
      if (usesClean) {
        console.log('✅ Step7 uses extracted_fields_clean');
      } else {
        console.log('❌ Step7 still uses extracted_fields (not updated)');
      }
    }
  }
}

main();
