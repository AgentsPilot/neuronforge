import { config } from 'dotenv';
config({ path: '.env.local' });

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function main() {
  // Get latest execution outputs
  const { data: outputs } = await supabase
    .from('execution_output_cache')
    .select('step_id, output_data, created_at')
    .order('created_at', { ascending: false })
    .limit(20);

  const step1Output = outputs?.find(o => o.step_id === 'step1');
  const step2Output = outputs?.find(o => o.step_id === 'step2');

  if (step1Output) {
    const data = JSON.parse(step1Output.output_data);
    console.log('=== STEP1 OUTPUT ===');
    console.log('Keys:', Object.keys(data));
    console.log('Emails count:', data.emails?.length || 0);

    if (data.emails && data.emails[0]) {
      console.log('\n=== FIRST EMAIL ===');
      console.log('Keys:', Object.keys(data.emails[0]));
      console.log('Has attachments:', data.emails[0].attachments ? 'YES' : 'NO');
      console.log('Attachments count:', data.emails[0].attachments?.length || 0);

      if (data.emails[0].attachments && data.emails[0].attachments[0]) {
        console.log('\n=== FIRST ATTACHMENT ===');
        console.log(JSON.stringify(data.emails[0].attachments[0], null, 2));
      } else {
        console.log('\n⚠️  Attachments array is EMPTY or undefined!');
        console.log('This is why flatten produces 0 items.');
      }
    }
  } else {
    console.log('No step1 output found in cache');
  }

  if (step2Output) {
    const data = JSON.parse(step2Output.output_data);
    console.log('\n=== STEP2 OUTPUT ===');
    console.log('Is array:', Array.isArray(data));
    console.log('Length:', Array.isArray(data) ? data.length : 'N/A');

    if (Array.isArray(data) && data[0]) {
      console.log('First item keys:', Object.keys(data[0]));
      console.log('Sample:', JSON.stringify(data[0], null, 2).substring(0, 200));
    }
  } else {
    console.log('\nNo step2 output found in cache');
  }
}

main();
