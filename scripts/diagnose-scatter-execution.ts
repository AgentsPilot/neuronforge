import { config } from 'dotenv';
config({ path: '.env.local' });

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function main() {
  // Get workflow config
  const { data: agent } = await supabase
    .from('agents')
    .select('pilot_steps')
    .eq('id', '43ffbc8a-406d-4a43-9f3f-4e7554160eda')
    .single();

  const step4 = agent.pilot_steps.find((s: any) => s.id === 'step4');

  console.log('=== WORKFLOW CONFIGURATION ===\n');

  const step6 = step4.scatter.steps.find((s: any) => s.id === 'step6');
  console.log('step6 output_variable:', step6.output_variable);

  const step6_sanitize = step4.scatter.steps.find((s: any) => s.id === 'step6_sanitize');
  if (step6_sanitize) {
    console.log('\n✅ step6_sanitize EXISTS');
    console.log('   input:', step6_sanitize.input);
    console.log('   output_variable:', step6_sanitize.output_variable);
    console.log('   instruction:', step6_sanitize.config.instruction?.substring(0, 100) + '...');

    // Check output schema
    if (step6_sanitize.output_schema?.properties?.vendor) {
      console.log('   vendor field required:', step6_sanitize.output_schema.properties.vendor.required);
      console.log('   vendor field description:', step6_sanitize.output_schema.properties.vendor.description);
    }
  } else {
    console.log('\n❌ step6_sanitize DOES NOT EXIST');
  }

  const step7 = step4.scatter.steps.find((s: any) => s.id === 'step7');
  console.log('\nstep7 folder_name config:', step7.config.folder_name);

  if (step7.config.folder_name.includes('extracted_fields_clean')) {
    console.log('✅ step7 uses extracted_fields_clean');
  } else {
    console.log('❌ step7 still uses extracted_fields (NOT UPDATED!)');
  }

  // Get latest execution
  const { data: executions } = await supabase
    .from('workflow_executions')
    .select('id, created_at, batch_calibration_mode')
    .eq('agent_id', '43ffbc8a-406d-4a43-9f3f-4e7554160eda')
    .order('created_at', { ascending: false })
    .limit(1);

  if (executions && executions.length > 0) {
    const exec = executions[0];
    console.log('\n=== LATEST EXECUTION ===');
    console.log('Execution ID:', exec.id);
    console.log('Created:', exec.created_at);
    console.log('Calibration mode:', exec.batch_calibration_mode);

    if (!exec.batch_calibration_mode) {
      console.log('\n⚠️  WARNING: Execution is NOT in calibration mode!');
      console.log('   This means fixes will not be applied automatically.');
    }
  }

  // Check step executions table for detailed logs
  const { data: stepExecs } = await supabase
    .from('step_executions')
    .select('step_id, status, error, output')
    .eq('workflow_execution_id', executions[0].id)
    .in('step_id', ['step6', 'step6_sanitize', 'step7']);

  if (stepExecs && stepExecs.length > 0) {
    console.log('\n=== STEP EXECUTION DETAILS ===');
    for (const stepExec of stepExecs) {
      console.log(`\n${stepExec.step_id}:`);
      console.log('  Status:', stepExec.status);
      if (stepExec.error) {
        console.log('  Error:', stepExec.error.substring(0, 100));
      }
      if (stepExec.output) {
        const output = typeof stepExec.output === 'string' ?
          JSON.parse(stepExec.output) : stepExec.output;
        if (output.vendor !== undefined) {
          console.log('  vendor value:', output.vendor);
        }
      }
    }
  }
}

main();
