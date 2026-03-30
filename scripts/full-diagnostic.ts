import { config } from 'dotenv';
config({ path: '.env.local' });

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function main() {
  const agentId = '43ffbc8a-406d-4a43-9f3f-4e7554160eda';

  console.log('=== 1. WORKFLOW CONFIGURATION ===\n');

  const { data: agent } = await supabase
    .from('agents')
    .select('pilot_steps, updated_at')
    .eq('id', agentId)
    .single();

  console.log('Agent last updated:', agent.updated_at);

  const step4 = agent.pilot_steps.find((s: any) => s.id === 'step4');
  const scatterSteps = step4.scatter.steps.map((s: any) => ({
    id: s.id || s.step_id,
    type: s.type,
    plugin: s.plugin,
    output_variable: s.output_variable
  }));

  console.log('\nScatter-gather steps:');
  scatterSteps.forEach((s, i) => {
    console.log(`  ${i + 1}. ${s.id} (${s.type}${s.plugin ? ` - ${s.plugin}` : ''}) → ${s.output_variable || 'no output_variable'}`);
  });

  const step6 = step4.scatter.steps.find((s: any) => s.id === 'step6');
  const step6_sanitize = step4.scatter.steps.find((s: any) => s.id === 'step6_sanitize');
  const step7 = step4.scatter.steps.find((s: any) => s.id === 'step7');

  console.log('\n=== 2. STEP6 (extractor) ===');
  console.log('output_variable:', step6.output_variable);
  console.log('fields:', step6.config.fields.map((f: any) => f.name).join(', '));

  console.log('\n=== 3. STEP6_SANITIZE ===');
  if (step6_sanitize) {
    console.log('✅ EXISTS');
    console.log('input:', step6_sanitize.input);
    console.log('output_variable:', step6_sanitize.output_variable);
    console.log('instruction:', step6_sanitize.config.instruction?.substring(0, 80) + '...');
  } else {
    console.log('❌ DOES NOT EXIST');
  }

  console.log('\n=== 4. STEP7 (create folder) ===');
  console.log('folder_name config:', step7.config.folder_name);

  // Check what variable step7 is actually trying to use
  if (step7.config.folder_name.includes('extracted_fields_clean')) {
    console.log('⚠️  step7 references extracted_fields_clean');
  } else if (step7.config.folder_name.includes('extracted_fields')) {
    console.log('✅ step7 references extracted_fields');
  }

  console.log('\n=== 5. LATEST CALIBRATION SESSION ===');

  const { data: sessions } = await supabase
    .from('calibration_sessions')
    .select('*')
    .eq('agent_id', agentId)
    .order('created_at', { ascending: false })
    .limit(1);

  if (sessions && sessions.length > 0) {
    const session = sessions[0];
    console.log('Session ID:', session.id);
    console.log('Status:', session.status);
    console.log('Created:', session.created_at);
    console.log('Iterations:', session.total_iterations);
    console.log('Fixes applied:', session.fixes_applied);

    if (session.issues_found) {
      console.log('\nIssues found:', session.issues_found.length);
      session.issues_found.forEach((issue: any, i: number) => {
        console.log(`  ${i + 1}. ${issue.category}: ${issue.message?.substring(0, 60) || issue.title}`);
        if (issue.autoRepairProposal) {
          console.log(`     → Auto-repair: ${issue.autoRepairProposal.type}, confidence: ${issue.autoRepairProposal.confidence}`);
        }
      });
    }
  }

  console.log('\n=== 6. LATEST EXECUTION ===');

  const { data: executions } = await supabase
    .from('workflow_executions')
    .select('id, created_at, status, batch_calibration_mode')
    .eq('agent_id', agentId)
    .order('created_at', { ascending: false })
    .limit(1);

  if (executions && executions.length > 0) {
    const exec = executions[0];
    console.log('Execution ID:', exec.id);
    console.log('Status:', exec.status);
    console.log('Calibration mode:', exec.batch_calibration_mode);
    console.log('Created:', exec.created_at);

    // Get step execution details
    const { data: stepExecs } = await supabase
      .from('step_executions')
      .select('step_id, status, error')
      .eq('workflow_execution_id', exec.id)
      .order('created_at', { ascending: true });

    if (stepExecs) {
      console.log('\nStep execution statuses:');
      stepExecs.forEach(se => {
        const status = se.status || (se.error ? 'failed' : 'unknown');
        const errorMsg = se.error ? ` (${se.error.substring(0, 50)}...)` : '';
        console.log(`  ${se.step_id}: ${status}${errorMsg}`);
      });
    }
  }

  console.log('\n=== 7. DIAGNOSIS ===\n');

  // Summary
  if (!step6_sanitize) {
    console.log('❌ PROBLEM: step6_sanitize does not exist in workflow');
    console.log('   → Calibration did not insert the sanitize step');
    console.log('   → Check calibration detection logic');
  } else if (step6_sanitize.output_variable !== step6.output_variable) {
    console.log('❌ PROBLEM: step6_sanitize creates NEW variable instead of overwriting');
    console.log(`   step6 outputs: ${step6.output_variable}`);
    console.log(`   step6_sanitize outputs: ${step6_sanitize.output_variable}`);
    console.log(`   step7 expects: ${step7.config.folder_name}`);
    console.log('   → Variable mismatch causing undefined resolution');
  } else {
    console.log('✅ Configuration looks correct');
    console.log('   → Need to check actual execution logs to see why it fails');
  }
}

main();
