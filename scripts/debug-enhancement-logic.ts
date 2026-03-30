import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
import * as path from 'path';

config({ path: path.resolve(process.cwd(), '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const supabase = createClient(supabaseUrl, supabaseKey);

async function main() {
  const agentId = '43ffbc8a-406d-4a43-9f3f-4e7554160eda';

  // Get latest BATCH CALIBRATION execution
  const { data: executions } = await supabase
    .from('agent_executions')
    .select('*')
    .eq('agent_id', agentId)
    .eq('batch_calibration_mode', true)
    .order('started_at', { ascending: false })
    .limit(1);

  if (!executions || executions.length === 0) {
    console.log('No batch calibration executions found');
    return;
  }

  const execution = executions[0];
  const trace = execution.trace as any;

  console.log('=== EXECUTION INFO ===');
  console.log('ID:', execution.id);
  console.log('Status:', execution.status);
  console.log('Batch Calibration:', execution.batch_calibration_mode);
  console.log('Started:', execution.started_at);

  if (!trace?.collectedIssues || trace.collectedIssues.length === 0) {
    console.log('\nNo collected issues found');
    return;
  }

  console.log('\n=== ALL COLLECTED ISSUES ===');
  trace.collectedIssues.forEach((issue: any, idx: number) => {
    console.log(`\n[${idx + 1}] ${issue.message}`);
    console.log('    Category:', issue.category);
    console.log('    AutoRepairAvailable:', issue.autoRepairAvailable);
    console.log('    AffectedSteps:', issue.affectedSteps?.map((s: any) => s.stepId).join(', '));
  });

  // Find the folder_name error
  const folderNameIssue = trace.collectedIssues.find((issue: any) =>
    issue.message && issue.message.includes('folder_name is required')
  );

  if (!folderNameIssue) {
    console.log('\n❌ No folder_name issue found');
    return;
  }

  console.log('\n=== FOLDER_NAME ISSUE DETAILS ===');
  console.log('Issue ID:', folderNameIssue.id);
  console.log('Category:', folderNameIssue.category);
  console.log('Message:', folderNameIssue.message);
  console.log('AutoRepairAvailable:', folderNameIssue.autoRepairAvailable);
  console.log('AffectedSteps:', JSON.stringify(folderNameIssue.affectedSteps, null, 2));

  // Test the enhancement logic conditions
  console.log('\n=== TESTING ENHANCEMENT CONDITIONS ===');

  const errorMessage = folderNameIssue.message;
  const requiredParamPattern = /(\w+)\s+is\s+required/i;
  const requiredMatch = errorMessage.match(requiredParamPattern);

  console.log('1. Regex match:', requiredMatch);
  if (requiredMatch) {
    console.log('   Required param:', requiredMatch[1]);
  }

  console.log('2. autoRepairAvailable:', folderNameIssue.autoRepairAvailable);
  console.log('   Condition (!autoRepairAvailable):', !folderNameIssue.autoRepairAvailable);

  if (requiredMatch && !folderNameIssue.autoRepairAvailable) {
    const requiredParam = requiredMatch[1];
    const stepId = folderNameIssue.affectedSteps?.[0]?.stepId;

    console.log('\n3. StepId from affectedSteps:', stepId);

    if (!stepId) {
      console.log('   ❌ NO STEP_ID - Enhancement will fail here');
      return;
    }

    // Get agent workflow
    const { data: agent } = await supabase
      .from('agents')
      .select('*')
      .eq('id', agentId)
      .single();

    const steps = agent?.pilot_steps || agent?.workflow_steps || [];
    console.log('\n4. Looking for scatter-gather step with ID:', stepId);
    console.log('   Available step IDs:', steps.map((s: any) => s.id || s.step_id));

    const scatterStep = steps.find((s: any) =>
      (s.id === stepId || s.step_id === stepId) && s.scatter?.steps
    );

    console.log('   Found scatter step:', !!scatterStep);

    if (!scatterStep) {
      console.log('   ❌ NO SCATTER STEP FOUND - Enhancement will fail here');
      console.log('   Looking for step with ID:', stepId);
      console.log('   Available steps:', steps.map((s: any) => ({
        id: s.id || s.step_id,
        hasScatter: !!s.scatter,
        hasScatterSteps: !!s.scatter?.steps
      })));
      return;
    }

    console.log('\n5. Scatter step found, checking nested steps');
    console.log('   Nested steps:', scatterStep.scatter.steps.map((s: any) => s.id || s.step_id));

    for (const nestedStep of scatterStep.scatter.steps) {
      const nestedStepId = nestedStep.id || nestedStep.step_id;
      console.log(`\n   Checking nested step: ${nestedStepId}`);
      console.log('   Has config:', !!nestedStep.config);

      if (nestedStep.config) {
        console.log('   Config keys:', Object.keys(nestedStep.config));
        console.log(`   Has requiredParam (${requiredParam}):`, requiredParam in nestedStep.config);

        if (requiredParam in nestedStep.config) {
          const paramValue = nestedStep.config[requiredParam];
          console.log('   Param value:', paramValue);
          console.log('   Is string:', typeof paramValue === 'string');
          console.log('   Includes {{:', typeof paramValue === 'string' && paramValue.includes('{{'));

          if (typeof paramValue === 'string' && paramValue.includes('{{')) {
            const varMatch = paramValue.match(/\{\{[^.]+\.([^}]+)\}\}/);
            const fieldName = varMatch ? varMatch[1] : null;
            console.log('   ✅ ALL CONDITIONS MET');
            console.log('   Field name extracted:', fieldName);
            console.log(`   Would create fallback: Unknown ${fieldName?.charAt(0).toUpperCase()}${fieldName?.slice(1)}`);
            return;
          } else {
            console.log('   ❌ Param value does not contain {{');
          }
        }
      }
    }

    console.log('\n   ❌ NO MATCHING NESTED STEP FOUND');
  } else {
    console.log('\n❌ Enhancement condition failed at first check');
  }
}

main().catch(console.error);
