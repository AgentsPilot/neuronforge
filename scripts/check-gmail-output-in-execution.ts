import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function main() {
  // Get most recent agent execution for invoice agent
  const { data: execution } = await supabase
    .from('agent_executions')
    .select('id, execution_log, created_at')
    .eq('agent_id', '43ffbc8a-406d-4a43-9f3f-4e7554160eda')
    .order('created_at', { ascending: false })
    .limit(1)
    .single();

  if (!execution) {
    console.log('No execution found');
    return;
  }

  console.log('Execution ID:', execution.id);
  console.log('Created at:', execution.created_at);

  const log = execution.execution_log as any;
  if (!log || !log.steps) {
    console.log('No step logs found');
    return;
  }

  const step1 = log.steps.find((s: any) => s.step_id === 'step1');
  if (!step1) {
    console.log('Step1 not found in logs');
    return;
  }

  console.log('\nStep1 status:', step1.status);
  console.log('\nStep1 output structure:');
  if (step1.output && step1.output.emails && step1.output.emails.length > 0) {
    const firstEmail = step1.output.emails[0];
    console.log('First email fields:', Object.keys(firstEmail).join(', '));
    if (firstEmail.attachments) {
      console.log('\n✅ Email HAS attachments field');
      console.log('Number of attachments:', firstEmail.attachments.length);
      if (firstEmail.attachments.length > 0) {
        console.log('First attachment:', JSON.stringify(firstEmail.attachments[0], null, 2));
      }
    } else {
      console.log('\n❌ Email DOES NOT have attachments field');
    }
  } else {
    console.log('No emails in output or output is empty');
  }
}

main();
