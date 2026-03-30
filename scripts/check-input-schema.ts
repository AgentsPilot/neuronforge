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
    .select('input_schema, pilot_steps')
    .eq('id', '43ffbc8a-406d-4a43-9f3f-4e7554160eda')
    .single();

  if (error) {
    console.error('Error:', error);
    return;
  }

  console.log('input_schema type:', typeof agent.input_schema);
  console.log('input_schema is array:', Array.isArray(agent.input_schema));
  console.log('input_schema value:');
  console.log(JSON.stringify(agent.input_schema, null, 2));

  console.log('\\n\\npilot_steps sample (first step):');
  if (agent.pilot_steps && agent.pilot_steps.length > 0) {
    console.log(JSON.stringify(agent.pilot_steps[0], null, 2));
  }
}

main().catch(console.error);
