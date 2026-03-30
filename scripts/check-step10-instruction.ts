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
  const step10 = step4?.scatter?.steps?.find((s: any) => s.id === 'step10');

  if (step10) {
    console.log('Step10 config:');
    console.log(JSON.stringify({
      id: step10.id,
      type: step10.type,
      instruction: step10.config?.instruction,
      prompt: step10.prompt
    }, null, 2));
  } else {
    console.log('Step10 not found');
  }
}

main();
