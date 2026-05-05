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

async function checkExecutionOutputs() {
  const { data: execution } = await supabase
    .from('agent_executions')
    .select('id, step_outputs')
    .eq('agent_id', agentId)
    .order('created_at', { ascending: false })
    .limit(1)
    .single();
  
  if (!execution || !execution.step_outputs) {
    console.log('No execution found');
    return;
  }
  
  const step1Output = execution.step_outputs.step1;
  console.log('\nStep1 Output:');
  console.log(JSON.stringify(step1Output, null, 2));
  
  if (step1Output && step1Output.emails && step1Output.emails.length > 0) {
    console.log('\nFirst email:');
    const email = step1Output.emails[0];
    console.log('  Subject:', email.subject);
    console.log('  Has attachments array:', !!email.attachments);
    console.log('  Attachments count:', email.attachments ? email.attachments.length : 0);
    if (email.attachments && email.attachments.length > 0) {
      console.log('\n  Attachments:');
      email.attachments.forEach((att, i) => {
        console.log('    ' + i + ':', att.filename, '-', att.mimeType);
      });
    } else {
      console.log('\n  NO ATTACHMENTS FOUND!');
    }
  }
  
  const step2Output = execution.step_outputs.step2;
  console.log('\nStep2 Output (flattened attachments):');
  console.log('  Is array:', Array.isArray(step2Output));
  console.log('  Length:', step2Output ? step2Output.length : 0);
}

checkExecutionOutputs().then(() => process.exit(0));
