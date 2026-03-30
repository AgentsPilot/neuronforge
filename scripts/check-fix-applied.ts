import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';

config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function main() {
  // Get most recent agent
  const { data: agent, error: agentError } = await supabase
    .from('agents')
    .select('id, pilot_steps, updated_at')
    .order('updated_at', { ascending: false })
    .limit(1)
    .single();

  console.log('=== CHECKING IF FIX WAS APPLIED ===\n');

  if (agentError) {
    console.error('Error fetching agent:', agentError);
    return;
  }

  console.log('Agent ID:', agent?.id);
  console.log('Last Updated:', agent?.updated_at);

  // Find step6 in scatter-gather
  const step4 = agent?.pilot_steps?.find((s: any) => s.id === 'step4' || s.step_id === 'step4');
  const step6 = step4?.scatter?.steps?.find((s: any) => s.id === 'step6' || s.step_id === 'step6');

  if (step6?.config) {
    console.log('\n=== STEP6 CONFIG ===');
    console.log('Has file_url:', 'file_url' in step6.config);
    console.log('Has file_content:', 'file_content' in step6.config);

    if ('file_content' in step6.config && !('file_url' in step6.config)) {
      console.log('\n✅ SUCCESS! Parameter was renamed from "file_url" to "file_content"');
      console.log('Value:', step6.config.file_content);
    } else if ('file_url' in step6.config) {
      console.log('\n❌ NOT FIXED - Still has "file_url"');
      console.log('Value:', step6.config.file_url);
    }

    console.log('\nFull config:', JSON.stringify(step6.config, null, 2));
  } else {
    console.log('\n❌ Could not find step6');
  }

  // Check calibration session
  const { data: session } = await supabase
    .from('calibration_sessions')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(1)
    .single();

  console.log('\n=== LATEST CALIBRATION SESSION ===');
  console.log('Status:', session?.status);
  console.log('Created:', session?.created_at);
  console.log('Summary:', session?.summary);
}

main().catch(console.error);
