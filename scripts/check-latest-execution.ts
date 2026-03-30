// Check the most recent execution for the invoice agent
import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
import * as path from 'path';

config({ path: path.join(process.cwd(), '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing Supabase credentials');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function checkLatestExecution() {
  const agentId = '43ffbc8a-406d-4a43-9f3f-4e7554160eda'; // Invoice agent

  // Get latest execution
  const { data: executions } = await supabase
    .from('workflow_executions')
    .select('*')
    .eq('agent_id', agentId)
    .order('started_at', { ascending: false })
    .limit(1);

  if (!executions || executions.length === 0) {
    console.log('No executions found');
    return;
  }

  const execution = executions[0];
  console.log('\n=== EXECUTION ===');
  console.log('ID:', execution.id);
  console.log('Status:', execution.status);
  console.log('Started:', execution.started_at);
  console.log('Error:', execution.error_message);

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
    console.log('Steps with outputs:', Object.keys(cachedOutputs).sort());

    // Check step6 (extraction)
    if (cachedOutputs.step6) {
      console.log('\n✅ Step6 (extracted_fields):');
      console.log(JSON.stringify(cachedOutputs.step6, null, 2).slice(0, 500));
    } else {
      console.log('\n❌ Step6 (extracted_fields) - NO OUTPUT');
    }

    // Check step6_sanitize
    if (cachedOutputs.step6_sanitize) {
      console.log('\n✅ Step6_sanitize (sanitized extracted_fields):');
      console.log(JSON.stringify(cachedOutputs.step6_sanitize, null, 2).slice(0, 500));
    } else {
      console.log('\n❌ Step6_sanitize - NO OUTPUT');
    }

    // Check step4 (drive folder)
    if (cachedOutputs.step4) {
      console.log('\n✅ Step4 (processed_items):');
      console.log(JSON.stringify(cachedOutputs.step4, null, 2).slice(0, 300));
    } else {
      console.log('\n❌ Step4 (processed_items) - NO OUTPUT');
    }

    // Check step5 (scatter_gather)
    if (cachedOutputs.step5) {
      console.log('\n✅ Step5 (processed_transactions):');
      const data = cachedOutputs.step5;
      if (Array.isArray(data)) {
        console.log(`  Array with ${data.length} items`);
        if (data.length > 0) {
          console.log('  First item:', JSON.stringify(data[0], null, 2).slice(0, 500));
        }
      } else {
        console.log(JSON.stringify(data, null, 2).slice(0, 300));
      }
    } else {
      console.log('\n❌ Step5 (processed_transactions) - NO OUTPUT');
    }

    // Check step18 (summary email)
    if (cachedOutputs.step18) {
      console.log('\n✅ Step18 (summary_email_content):');
      console.log(JSON.stringify(cachedOutputs.step18, null, 2).slice(0, 500));
    } else {
      console.log('\n❌ Step18 (summary_email_content) - NO OUTPUT');
    }

    // Check all steps for errors
    console.log('\n=== CHECKING FOR ERRORS IN CACHED OUTPUTS ===');
    for (const [stepId, output] of Object.entries(cachedOutputs)) {
      if (typeof output === 'object' && output !== null) {
        if ('error' in output || 'success' in output && !(output as any).success) {
          console.log(`\n⚠️  ${stepId}:`, JSON.stringify(output, null, 2).slice(0, 200));
        }
      }
    }
  }

  // Get step executions for detailed status
  const { data: steps } = await supabase
    .from('step_executions')
    .select('step_id, status, error_message, output_summary')
    .eq('execution_id', execution.id)
    .order('started_at', { ascending: true });

  if (steps && steps.length > 0) {
    console.log('\n=== STEP STATUSES ===');
    for (const step of steps) {
      const icon = step.status === 'completed' ? '✅' : step.status === 'failed' ? '❌' : '⏳';
      console.log(`${icon} ${step.step_id}: ${step.status}`);
      if (step.error_message) {
        console.log(`   Error: ${step.error_message.slice(0, 200)}`);
      }
    }
  }
}

checkLatestExecution().catch(console.error);
