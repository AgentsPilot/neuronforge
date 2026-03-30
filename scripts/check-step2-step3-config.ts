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

  const steps = agent.pilot_steps || [];
  const step2 = steps.find((s: any) => s.step_id === 'step2');
  const step3 = steps.find((s: any) => s.step_id === 'step3');

  console.log('=== STEP2 (flatten) ===');
  console.log('Config:', JSON.stringify(step2?.config, null, 2));
  console.log('\n=== STEP3 (filter) ===');
  console.log('Config:', JSON.stringify(step3?.config, null, 2));
  console.log('\n=== STEP2 OUTPUT ===');
  console.log('Step2 extracted 10 items (emails) according to logs');
  console.log('Step2 field:', step2?.config?.field);

  console.log('\n=== ISSUE ===');
  console.log('Step3 filtered to 0 items');
  console.log('This means step3 filter condition is not matching any items');
  console.log('Need to check what field step3 is checking');
}

main();
