import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function main() {
  const { data: agent, error } = await supabase
    .from('agents')
    .select('*')
    .eq('id', '43ffbc8a-406d-4a43-9f3f-4e7554160eda')
    .single();

  if (error) {
    console.error('Error:', error);
    return;
  }

  console.log('Available fields:', Object.keys(agent).join(', '));
  console.log('\\ninput_schema:', agent.input_schema ? 'exists' : 'null');
  console.log('workflow_config:', agent.workflow_config ? 'exists' : 'null');
  console.log('pilot_steps:', agent.pilot_steps ? agent.pilot_steps.length + ' steps' : 'null');
  console.log('workflow_steps:', agent.workflow_steps ? agent.workflow_steps.length + ' steps' : 'null');

  if (agent.workflow_config) {
    console.log('\\nworkflow_config content:');
    console.log(JSON.stringify(agent.workflow_config, null, 2));
  }
}

main().catch(console.error);
