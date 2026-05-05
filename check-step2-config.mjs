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

async function checkStep2() {
  const { data: agent } = await supabase
    .from('agents')
    .select('pilot_steps')
    .eq('id', agentId)
    .single();
  
  if (!agent) return;
  
  const step2 = agent.pilot_steps.find(s => s.step_id === 'step2');
  
  console.log('\nStep2 (Flatten) configuration:');
  console.log(JSON.stringify(step2.config, null, 2));
}

checkStep2().then(() => process.exit(0));
