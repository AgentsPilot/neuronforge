import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
import * as path from 'path';

// Load environment variables
config({ path: path.resolve(process.cwd(), '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const supabase = createClient(supabaseUrl, supabaseKey);

async function main() {
  // Find the expense extraction agent
  const { data: agents } = await supabase
    .from('agents')
    .select('id, agent_name')
    .or('agent_name.ilike.%expense%,agent_name.ilike.%invoice%')
    .order('created_at', { ascending: false })
    .limit(5);

  console.log('Found agents:', agents?.map(a => ({ id: a.id, name: a.agent_name })));

  if (!agents || agents.length === 0) {
    console.log('No agents found');
    return;
  }

  const agentId = agents[0].id;
  console.log('\n=== Using agent:', agents[0].agent_name, '===');

  // Get the most recent batch calibration execution
  const { data: executions } = await supabase
    .from('agent_executions')
    .select('*')
    .eq('agent_id', agentId)
    .eq('batch_calibration_mode', true)
    .order('started_at', { ascending: false })
    .limit(3);

  console.log(`\nFound ${executions?.length || 0} batch calibration executions`);

  if (!executions || executions.length === 0) {
    console.log('No batch calibration executions found');
    return;
  }

  const execution = executions[0];
  console.log('\n=== LATEST BATCH EXECUTION ===');
  console.log('ID:', execution.id);
  console.log('Status:', execution.status);
  console.log('Started:', execution.started_at);
  console.log('Completed:', execution.completed_at);

  const trace = execution.trace as any;

  if (!trace) {
    console.log('No trace data available');
    return;
  }

  // Analyze step outputs
  if (trace.steps) {
    console.log('\n=== STEP ANALYSIS ===');

    // Step1: Gmail search
    const step1 = trace.steps.find((s: any) => s.stepId === 'step1');
    if (step1) {
      console.log('\n[Step1 - Gmail Search]');
      console.log('Status:', step1.status);
      if (step1.output) {
        const output = step1.output;
        if (Array.isArray(output)) {
          console.log(`Found ${output.length} emails`);
          if (output.length > 0) {
            console.log('First email has attachments?', !!output[0].attachments);
            if (output[0].attachments) {
              console.log('Attachments field type:', typeof output[0].attachments);
              console.log('Attachments:', Array.isArray(output[0].attachments) ? `array of ${output[0].attachments.length}` : output[0].attachments);
            }
          }
        } else if (output?.emails) {
          console.log(`Found ${output.emails.length} emails`);
          if (output.emails.length > 0) {
            console.log('Email structure:', Object.keys(output.emails[0]));
            console.log('First email has attachments?', !!output.emails[0].attachments);
          }
        }
      }
    }

    // Step2: Flatten operation
    const step2 = trace.steps.find((s: any) => s.stepId === 'step2');
    if (step2) {
      console.log('\n[Step2 - Flatten]');
      console.log('Status:', step2.status);
      if (step2.output) {
        const output = step2.output;
        if (Array.isArray(output)) {
          console.log(`Flattened to ${output.length} items`);
          if (output.length > 0) {
            console.log('First item:', JSON.stringify(output[0], null, 2).substring(0, 300));
          }
        } else {
          console.log('Output:', JSON.stringify(output, null, 2).substring(0, 300));
        }
      }
      if (step2.error) {
        console.log('ERROR:', step2.error);
      }
    }

    // Step6: Document extractor (in scatter-gather)
    const step4 = trace.steps.find((s: any) => s.stepId === 'step4');
    if (step4) {
      console.log('\n[Step4 - Scatter-Gather]');
      console.log('Status:', step4.status);
      if (step4.output) {
        const output = step4.output;
        if (Array.isArray(output)) {
          console.log(`Processed ${output.length} items`);
          // Check if any items have extraction results
          const validItems = output.filter((item: any) => !item.error);
          const errorItems = output.filter((item: any) => item.error);
          console.log(`Valid items: ${validItems.length}, Errors: ${errorItems.length}`);

          if (validItems.length > 0) {
            console.log('First valid item fields:', Object.keys(validItems[0]));
            console.log('Sample data:', JSON.stringify(validItems[0], null, 2).substring(0, 400));
          }
          if (errorItems.length > 0) {
            console.log('First error:', errorItems[0].error);
          }
        }
      }
      if (step4.error) {
        console.log('ERROR:', step4.error);
      }
    }

    // Step11: Filter
    const step11 = trace.steps.find((s: any) => s.stepId === 'step11');
    if (step11) {
      console.log('\n[Step11 - Filter]');
      console.log('Status:', step11.status);
      if (step11.output) {
        const output = step11.output;
        if (Array.isArray(output)) {
          console.log(`Filtered to ${output.length} items`);
        } else {
          console.log('Output:', JSON.stringify(output, null, 2).substring(0, 200));
        }
      }
      if (step11.error) {
        console.log('ERROR:', step11.error);
      }
    }

    // Step15: Append to sheets
    const step15 = trace.steps.find((s: any) => s.stepId === 'step15');
    if (step15) {
      console.log('\n[Step15 - Append to Sheets]');
      console.log('Status:', step15.status);
      if (step15.error) {
        console.log('ERROR:', step15.error);
      }
    }

    // Step16: Send email
    const step16 = trace.steps.find((s: any) => s.stepId === 'step16');
    if (step16) {
      console.log('\n[Step16 - Send Email]');
      console.log('Status:', step16.status);
      if (step16.error) {
        console.log('ERROR:', step16.error);
      }
    }
  }

  // Check collected issues
  if (trace.collectedIssues && trace.collectedIssues.length > 0) {
    console.log('\n=== COLLECTED ISSUES ===');
    console.log(`Total: ${trace.collectedIssues.length}`);
    for (const issue of trace.collectedIssues.slice(0, 5)) {
      console.log(`\n- [${issue.category}] ${issue.message}`);
      console.log(`  Steps: ${issue.affectedSteps?.map((s: any) => s.stepId).join(', ')}`);
    }
  }

  // Check final result
  if (execution.result) {
    console.log('\n=== FINAL RESULT ===');
    const result = execution.result as any;
    console.log(JSON.stringify(result, null, 2).substring(0, 800));
  }
}

main().catch(console.error);
