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

async function testHardcodeFilter() {
  const { data: agent } = await supabase
    .from('agents')
    .select('pilot_steps')
    .eq('id', agentId)
    .single();
  
  if (!agent) return;
  
  console.log('\nChecking for hardcoded constants that should be filtered:');
  
  const constantsToCheck = [
    'application/pdf',
    'anyone_with_link',
    'reader',
  ];
  
  constantsToCheck.forEach(constant => {
    const found = JSON.stringify(agent.pilot_steps).includes(constant);
    console.log('  - ' + constant + ': ' + (found ? 'Found in workflow' : 'Not found'));
  });
  
  console.log('\nAfter fix, these constants should NOT appear in hardcode detection results');
}

testHardcodeFilter().then(() => process.exit(0));
