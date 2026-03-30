import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function debugEmptyResults() {
  // Get latest execution
  const { data: execution } = await supabase
    .from('workflow_executions')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(1)
    .single();

  if (!execution) {
    console.log('❌ No execution found');
    return;
  }

  console.log('\n=== EXECUTION INFO ===');
  console.log('ID:', execution.id);
  console.log('Status:', execution.status);
  console.log('Steps Completed:', execution.steps_completed);
  console.log('Steps Failed:', execution.steps_failed);
  console.log('Steps Skipped:', execution.steps_skipped);

  const trace = execution.execution_trace || {};
  console.log('\n=== EXECUTION TRACE ===');
  console.log('Step count:', Object.keys(trace).length);

  // Check each step's output
  for (const [stepId, stepData] of Object.entries(trace)) {
    const data = stepData as any;
    console.log(`\n--- ${stepId} ---`);
    console.log('Status:', data.status);
    console.log('Error:', data.error || 'none');

    if (data.output) {
      console.log('Output type:', typeof data.output);
      if (Array.isArray(data.output)) {
        console.log('Output is array, length:', data.output.length);
        if (data.output.length > 0) {
          console.log('First item keys:', Object.keys(data.output[0] || {}));
        }
      } else if (typeof data.output === 'object') {
        console.log('Output keys:', Object.keys(data.output));
        // Check for common patterns
        if (data.output.emails) {
          console.log('  emails:', Array.isArray(data.output.emails) ? `array[${data.output.emails.length}]` : typeof data.output.emails);
        }
        if (data.output.attachments) {
          console.log('  attachments:', Array.isArray(data.output.attachments) ? `array[${data.output.attachments.length}]` : typeof data.output.attachments);
        }
      } else {
        console.log('Output value:', String(data.output).substring(0, 100));
      }
    } else {
      console.log('⚠️  No output');
    }
  }

  // Get the workflow steps to see what was expected
  const { data: agent } = await supabase
    .from('agents')
    .select('pilot_steps')
    .eq('id', execution.agent_id)
    .single();

  if (agent?.pilot_steps) {
    const steps = agent.pilot_steps as any[];
    console.log('\n=== WORKFLOW STEPS ===');
    steps.forEach((step, i) => {
      console.log(`\nStep ${i + 1}: ${step.step_id || step.id}`);
      console.log('  Type:', step.type);
      console.log('  Operation:', step.operation || 'n/a');
      if (step.config?.field) {
        console.log('  Field:', step.config.field);
      }
      if (step.input) {
        console.log('  Input:', step.input);
      }
      console.log('  Output var:', step.output_variable || 'n/a');
    });
  }

  console.log('\n=== ANALYSIS ===');

  // Check for empty arrays in critical steps
  const criticalSteps = ['matching_emails', 'all_attachments', 'pdf_attachments', 'extracted_data'];
  for (const stepVar of criticalSteps) {
    const stepData = trace[stepVar] as any;
    if (stepData?.output) {
      if (Array.isArray(stepData.output) && stepData.output.length === 0) {
        console.log(`⚠️  ${stepVar}: Empty array - workflow will produce no results`);
      } else if (typeof stepData.output === 'object' && stepData.output.emails && Array.isArray(stepData.output.emails) && stepData.output.emails.length === 0) {
        console.log(`⚠️  ${stepVar}: Empty emails array - no emails matched`);
      }
    }
  }
}

debugEmptyResults().catch(console.error);
