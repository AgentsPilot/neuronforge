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

async function verifyFixes() {
  const { data: agent } = await supabase
    .from('agents')
    .select('pilot_steps, input_schema')
    .eq('id', agentId)
    .single();
  
  if (!agent) return;
  
  // Check step1
  const step1 = agent.pilot_steps.find(s => s.step_id === 'step1');
  console.log('\n✅ Step1 structure after fixes:');
  console.log('  Has params:', !!step1.params);
  console.log('  Has action:', !!step1.action);
  console.log('  params.query:', step1.params?.query);
  console.log('  params.max_results:', step1.params?.max_results);
  
  // Check input_schema
  console.log('\n✅ input_schema after fixes:');
  console.log('  Type:', Array.isArray(agent.input_schema) ? 'array' : typeof agent.input_schema);
  console.log('  Length:', agent.input_schema?.length);
  if (Array.isArray(agent.input_schema)) {
    agent.input_schema.forEach(field => {
      console.log(`  - ${field.name}: default_value="${field.default_value}"`);
    });
  }
}

verifyFixes().then(() => process.exit(0));
