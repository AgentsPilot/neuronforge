import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
import * as path from 'path';

config({ path: path.resolve(process.cwd(), '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const supabase = createClient(supabaseUrl, supabaseKey);

async function main() {
  const { data: agents } = await supabase
    .from('agents')
    .select('id, agent_name')
    .or('agent_name.ilike.%expense%,agent_name.ilike.%invoice%')
    .order('created_at', { ascending: false })
    .limit(1);

  if (!agents || agents.length === 0) {
    console.log('No agents found');
    return;
  }

  const agentId = agents[0].id;
  console.log('=== Using agent:', agents[0].agent_name);

  // Get the most recent execution (any type)
  const { data: executions } = await supabase
    .from('agent_executions')
    .select('*')
    .eq('agent_id', agentId)
    .order('started_at', { ascending: false })
    .limit(1);

  if (!executions || executions.length === 0) {
    console.log('No executions found');
    return;
  }

  const execution = executions[0];
  console.log('\n=== LATEST EXECUTION ===');
  console.log('ID:', execution.id);
  console.log('Status:', execution.status);
  console.log('Batch Calibration:', execution.batch_calibration_mode);
  console.log('Started:', execution.started_at);
  console.log('Completed:', execution.completed_at);

  const trace = execution.trace as any;

  if (!trace) {
    console.log('No trace data');
    return;
  }

  // Check step2 (flatten)
  if (trace.steps) {
    const step2 = trace.steps.find((s: any) => s.stepId === 'step2');
    if (step2) {
      console.log('\n=== STEP2 (FLATTEN) ===');
      console.log('Status:', step2.status);
      console.log('Action:', step2.action);

      if (step2.output) {
        const output = step2.output;
        if (Array.isArray(output)) {
          console.log('Output: Array with', output.length, 'items');
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

    // Check step4 (scatter-gather)
    const step4 = trace.steps.find((s: any) => s.stepId === 'step4');
    if (step4) {
      console.log('\n=== STEP4 (SCATTER-GATHER) ===');
      console.log('Status:', step4.status);

      if (step4.output) {
        const output = step4.output;
        if (Array.isArray(output)) {
          console.log('Output: Array with', output.length, 'items');
          const validItems = output.filter((item: any) => !item.error);
          const errorItems = output.filter((item: any) => item.error);
          console.log('Valid:', validItems.length, 'Errors:', errorItems.length);

          if (validItems.length > 0) {
            console.log('First valid item:', JSON.stringify(validItems[0], null, 2).substring(0, 400));
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
  }

  // Check collected issues
  if (trace.collectedIssues && trace.collectedIssues.length > 0) {
    console.log('\n=== COLLECTED ISSUES ===');
    console.log('Total:', trace.collectedIssues.length);
    for (const issue of trace.collectedIssues.slice(0, 3)) {
      console.log(`\n- [${issue.category}] ${issue.message}`);
      if (issue.autoRepairProposal) {
        console.log('  Auto-repair:', issue.autoRepairProposal.type);
      }
    }
  }

  // Check final result
  if (execution.result) {
    console.log('\n=== FINAL RESULT ===');
    const result = execution.result as any;
    console.log('Success:', result.success);
    console.log('Message:', result.message);
    if (result.autoCalibration) {
      console.log('Iterations:', result.autoCalibration.iterations);
      console.log('Auto-fixes:', result.autoCalibration.autoFixesApplied);
    }
  }
}

main().catch(console.error);
