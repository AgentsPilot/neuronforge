import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: join(__dirname, '.env.local') });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const agentId = '43ffbc8a-406d-4a43-9f3f-4e7554160eda';

async function checkWorkflow() {
  const { data: agent } = await supabase
    .from('agents')
    .select('pilot_steps')
    .eq('id', agentId)
    .single();
  
  if (!agent) return;
  
  // Find step1 (gmail search)
  const step1 = agent.pilot_steps.find(s => s.step_id === 'step1');
  if (step1) {
    console.log('\nStep1 (Gmail Search) full step:');
    console.log(JSON.stringify(step1, null, 2));
  }
  
  // Check saved config
  const { data: config } = await supabase
    .from('agent_configurations')
    .select('input_values')
    .eq('agent_id', agentId)
    .order('updated_at', { ascending: false })
    .limit(1)
    .single();
  
  if (config) {
    console.log('\n\nSaved configuration input_values:');
    console.log(JSON.stringify(config.input_values, null, 2));
    
    console.log('\n\nKeys in saved config:');
    console.log(Object.keys(config.input_values));
  }
}

checkWorkflow().then(() => process.exit(0));
