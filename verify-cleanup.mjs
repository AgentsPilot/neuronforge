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

async function verifyCleanup() {
  const { data: agent } = await supabase
    .from('agents')
    .select('pilot_steps')
    .eq('id', agentId)
    .single();
  
  if (!agent) return;
  
  const step1 = agent.pilot_steps.find(s => s.step_id === 'step1');
  
  console.log('\n✅ Step1 after cleanup:');
  console.log('  Has action:', !!step1.action);
  console.log('  Has operation:', !!step1.operation, step1.operation ? '❌ SHOULD BE REMOVED' : '✅');
  console.log('  Has params:', !!step1.params);
  console.log('  Has config:', !!step1.config, step1.config ? '❌ SHOULD BE REMOVED' : '✅');
  
  console.log('\n  Step1 keys:', Object.keys(step1));
  
  // Check all steps for legacy fields
  const stepsWithOperation = agent.pilot_steps.filter(s => s.operation);
  const stepsWithConfig = agent.pilot_steps.filter(s => s.config);
  
  console.log('\n📊 Summary:');
  console.log('  Total steps:', agent.pilot_steps.length);
  console.log('  Steps with "operation":', stepsWithOperation.length, stepsWithOperation.length > 0 ? '❌' : '✅');
  console.log('  Steps with "config":', stepsWithConfig.length, stepsWithConfig.length > 0 ? '❌' : '✅');
  
  if (stepsWithOperation.length === 0 && stepsWithConfig.length === 0) {
    console.log('\n🎉 SUCCESS! All legacy fields removed!');
  } else {
    console.log('\n⚠️ Some legacy fields still present');
  }
}

verifyCleanup().then(() => process.exit(0));
