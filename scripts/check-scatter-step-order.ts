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

  console.log('Scatter-gather steps in order:');
  step4?.scatter?.steps?.forEach((step: any, index: number) => {
    console.log(`${index + 1}. ${step.id} (${step.type}${step.plugin ? ` - ${step.plugin}` : ''})`);
    if (step.id === 'step7') {
      console.log(`   ⚠️  Uses: folder_name = {{extracted_fields.vendor}}`);
    }
    if (step.id === 'step10') {
      console.log(`   ✅ Sanitizes extracted_fields with fallbacks`);
    }
  });
}

main();
