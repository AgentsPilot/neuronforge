import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
import * as path from 'path';

config({ path: path.resolve(process.cwd(), '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const supabase = createClient(supabaseUrl, supabaseKey);

async function main() {
  // Get ALL recent executions with batch calibration mode
  const { data: executions } = await supabase
    .from('agent_executions')
    .select('id, agent_id, status, started_at, batch_calibration_mode, trace')
    .eq('batch_calibration_mode', true)
    .order('started_at', { ascending: false })
    .limit(20);

  console.log(`Found ${executions?.length || 0} batch calibration executions`);

  if (!executions || executions.length === 0) {
    console.log('\nNo batch calibration executions found in database');
    return;
  }

  // Find executions with folder_name error
  const executionsWithVendorError = executions.filter(exec => {
    const trace = exec.trace as any;
    return trace?.collectedIssues?.some((issue: any) =>
      issue.message && issue.message.includes('folder_name is required')
    );
  });

  console.log(`\nExecutions with folder_name error: ${executionsWithVendorError.length}`);

  if (executionsWithVendorError.length === 0) {
    console.log('\nNo executions found with "folder_name is required" error');
    console.log('\nShowing all batch calibration executions:');
    for (const exec of executions.slice(0, 5)) {
      const trace = exec.trace as any;
      console.log(`\n- Execution: ${exec.id}`);
      console.log(`  Agent: ${exec.agent_id}`);
      console.log(`  Status: ${exec.status}`);
      console.log(`  Issues: ${trace?.collectedIssues?.length || 0}`);
      if (trace?.collectedIssues?.length > 0) {
        trace.collectedIssues.slice(0, 3).forEach((issue: any) => {
          console.log(`    - ${issue.message}`);
        });
      }
    }
    return;
  }

  // Analyze the first execution with vendor error
  const execution = executionsWithVendorError[0];
  const trace = execution.trace as any;

  console.log('\n=== EXECUTION WITH VENDOR ERROR ===');
  console.log('Execution ID:', execution.id);
  console.log('Agent ID:', execution.agent_id);
  console.log('Status:', execution.status);
  console.log('Started:', execution.started_at);

  const folderNameIssue = trace.collectedIssues.find((issue: any) =>
    issue.message && issue.message.includes('folder_name is required')
  );

  console.log('\n=== FOLDER_NAME ISSUE ===');
  console.log('Issue ID:', folderNameIssue.id);
  console.log('Message:', folderNameIssue.message);
  console.log('Category:', folderNameIssue.category);
  console.log('AutoRepairAvailable:', folderNameIssue.autoRepairAvailable);
  console.log('Has AutoRepairProposal:', !!folderNameIssue.autoRepairProposal);

  if (folderNameIssue.autoRepairProposal) {
    console.log('\n=== AUTO-REPAIR PROPOSAL ===');
    console.log(JSON.stringify(folderNameIssue.autoRepairProposal, null, 2));
  }

  console.log('\nAffectedSteps:', JSON.stringify(folderNameIssue.affectedSteps, null, 2));
}

main().catch(console.error);
