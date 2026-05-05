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

async function findLegacySteps() {
  const { data: agent } = await supabase
    .from('agents')
    .select('pilot_steps')
    .eq('id', agentId)
    .single();
  
  if (!agent) return;
  
  console.log('\n🔍 Steps with legacy "operation" field:');
  agent.pilot_steps.forEach(step => {
    if (step.operation) {
      console.log(`  - ${step.step_id} (${step.type}): operation="${step.operation}"`);
    }
  });
  
  console.log('\n🔍 Steps with legacy "config" field:');
  agent.pilot_steps.forEach(step => {
    if (step.config) {
      console.log(`  - ${step.step_id} (${step.type}): has config`);
    }
  });
}

findLegacySteps().then(() => process.exit(0));
