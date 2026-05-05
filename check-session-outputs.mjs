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

async function checkSessionOutputs() {
  const { data: sessions } = await supabase
    .from('agent_calibration_sessions')
    .select('id, session_id, execution_summary')
    .order('created_at', { ascending: false })
    .limit(1);
  
  if (!sessions || sessions.length === 0) {
    console.log('No sessions found');
    return;
  }
  
  const session = sessions[0];
  console.log('\nSession ID:', session.session_id);
  
  if (session.execution_summary && session.execution_summary.step_outputs) {
    const step1 = session.execution_summary.step_outputs.step1;
    console.log('\nStep1 output exists:', !!step1);
    
    if (step1 && step1.emails) {
      console.log('Emails count:', step1.emails.length);
      if (step1.emails.length > 0) {
        const email = step1.emails[0];
        console.log('\nFirst email:');
        console.log('  Subject:', email.subject);
        console.log('  Attachments:', email.attachments ? email.attachments.length : 'NO ATTACHMENTS FIELD');
        
        if (email.attachments) {
          email.attachments.forEach((att, i) => {
            console.log('    Attachment ' + i + ':', att.filename, '-', att.mimeType);
          });
        }
      }
    }
    
    const step2 = session.execution_summary.step_outputs.step2;
    console.log('\nStep2 output:', Array.isArray(step2) ? 'array of length ' + step2.length : typeof step2);
  }
}

checkSessionOutputs().then(() => process.exit(0));
