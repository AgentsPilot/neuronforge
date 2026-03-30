import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function main() {
  // Get most recent calibration session
  const { data: session } = await supabase
    .from('agent_calibration_sessions')
    .select('id, created_at, execution_result, execution_log')
    .eq('agent_id', '43ffbc8a-406d-4a43-9f3f-4e7554160eda')
    .order('created_at', { ascending: false })
    .limit(1)
    .single();

  if (!session) {
    console.log('No calibration session found');
    return;
  }

  console.log('Session ID:', session.id);
  console.log('Created:', session.created_at);

  // Check execution_result first
  const result = session.execution_result as any;
  if (result && result.output) {
    console.log('\n=== EXECUTION RESULT OUTPUT ===');
    console.log('Output keys:', Object.keys(result.output).join(', '));

    if (result.output.matching_emails) {
      const matchingEmails = result.output.matching_emails;
      console.log('\nmatching_emails type:', typeof matchingEmails);

      if (matchingEmails.emails && Array.isArray(matchingEmails.emails)) {
        console.log('Number of emails:', matchingEmails.emails.length);

        if (matchingEmails.emails.length > 0) {
          const firstEmail = matchingEmails.emails[0];
          console.log('\nFirst email fields:', Object.keys(firstEmail).join(', '));

          if (firstEmail.attachments) {
            console.log('\n✅ Email HAS attachments field');
            console.log('Attachments count:', firstEmail.attachments.length);
            if (firstEmail.attachments.length > 0) {
              console.log('First attachment:', JSON.stringify(firstEmail.attachments[0], null, 2));
            }
          } else {
            console.log('\n❌ Email DOES NOT have attachments field');
          }
        }
      }
    }
  }

  // Also check execution_log
  const log = session.execution_log as any;
  if (log && log.steps) {
    console.log('\n=== EXECUTION LOG ===');
    const step1 = log.steps.find((s: any) => s.step_id === 'step1' || s.step_id === 'step_1');
    if (step1) {
      console.log('Step1 status:', step1.status);
      if (step1.output) {
        console.log('Step1 output keys:', Object.keys(step1.output).join(', '));
        if (step1.output.emails) {
          console.log('Emails count:', step1.output.emails.length);
          if (step1.output.emails.length > 0) {
            console.log('First email fields:', Object.keys(step1.output.emails[0]).join(', '));
          }
        }
      }
    }
  }
}

main();
