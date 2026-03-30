// Check step2 output specifically
import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
import * as path from 'path';

config({ path: path.join(process.cwd(), '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const supabase = createClient(supabaseUrl, supabaseKey);

async function checkStep2Output() {
  // Get latest execution
  const { data: executions } = await supabase
    .from('workflow_executions')
    .select('*')
    .order('started_at', { ascending: false })
    .limit(1);

  if (!executions || executions.length === 0) {
    console.log('No executions found');
    return;
  }

  const execution = executions[0];
  console.log('Execution ID:', execution.id);
  console.log('Status:', execution.status);

  // Get execution trace
  const { data: traces } = await supabase
    .from('execution_trace')
    .select('*')
    .eq('execution_id', execution.id)
    .order('created_at', { ascending: false })
    .limit(1);

  if (traces && traces.length > 0) {
    const trace = traces[0];
    const cachedOutputs = trace.cached_outputs || {};

    console.log('\n=== CACHED OUTPUTS ===');
    console.log('Available steps:', Object.keys(cachedOutputs).sort().join(', '));

    // Check step1 (search emails)
    if (cachedOutputs.step1) {
      console.log('\n=== STEP1 OUTPUT (unread_emails) ===');
      const step1Data = cachedOutputs.step1;
      if (Array.isArray(step1Data)) {
        console.log(`Array with ${step1Data.length} emails`);
        if (step1Data.length > 0) {
          const firstEmail = step1Data[0];
          console.log('\nFirst email structure:');
          console.log('  Keys:', Object.keys(firstEmail).join(', '));
          if (firstEmail.attachments) {
            console.log('  Has attachments:', Array.isArray(firstEmail.attachments));
            if (Array.isArray(firstEmail.attachments)) {
              console.log('  Attachment count:', firstEmail.attachments.length);
              if (firstEmail.attachments.length > 0) {
                console.log('  First attachment:', JSON.stringify(firstEmail.attachments[0], null, 2));
              }
            }
          }
        }
      } else {
        console.log('Not an array:', typeof step1Data);
      }
    }

    // Check step2 (flatten)
    if (cachedOutputs.step2) {
      console.log('\n=== STEP2 OUTPUT (all_attachments) ===');
      const step2Data = cachedOutputs.step2;
      if (Array.isArray(step2Data)) {
        console.log(`Array with ${step2Data.length} items`);
        if (step2Data.length > 0) {
          console.log('\nFirst item structure:');
          console.log('  Keys:', Object.keys(step2Data[0]).join(', '));
          console.log('  Full item:', JSON.stringify(step2Data[0], null, 2));
        }
      } else {
        console.log('Not an array:', typeof step2Data);
        console.log('Value:', JSON.stringify(step2Data, null, 2).slice(0, 500));
      }
    } else {
      console.log('\n❌ STEP2 has no cached output!');
    }

    // Check step3 (filter)
    if (cachedOutputs.step3) {
      console.log('\n=== STEP3 OUTPUT (invoices) ===');
      const step3Data = cachedOutputs.step3;
      if (Array.isArray(step3Data)) {
        console.log(`Array with ${step3Data.length} items`);
        if (step3Data.length > 0) {
          console.log('First item:', JSON.stringify(step3Data[0], null, 2));
        }
      } else {
        console.log('Not an array:', typeof step3Data);
      }
    } else {
      console.log('\n❌ STEP3 has no cached output!');
    }
  }
}

checkStep2Output().catch(console.error);
