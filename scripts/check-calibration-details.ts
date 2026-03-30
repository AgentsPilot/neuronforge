import { config } from 'dotenv';
config({ path: '.env.local' });

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function main() {
  const calibrationId = '2a2a83fd-6a59-42b8-9a3e-4ac308bf0d96';

  // Get calibration session
  const { data: session } = await supabase
    .from('calibration_sessions')
    .select('*')
    .eq('id', calibrationId)
    .single();

  if (!session) {
    console.log('Calibration session not found');
    return;
  }

  console.log('=== CALIBRATION SESSION ===');
  console.log('Status:', session.status);
  console.log('Created:', session.created_at);
  console.log('Updated:', session.updated_at);
  console.log('Total iterations:', session.total_iterations);
  console.log('Fixes applied:', session.fixes_applied);
  console.log('Execution ID:', session.execution_id);

  console.log('\n=== ISSUES FOUND ===');
  if (session.issues_found && Array.isArray(session.issues_found)) {
    console.log(`Total issues: ${session.issues_found.length}`);
    session.issues_found.forEach((issue: any, index: number) => {
      console.log(`\n[${index + 1}] ${issue.title || issue.type}`);
      console.log('Category:', issue.category);
      console.log('Severity:', issue.severity);
      console.log('Auto-repair available:', issue.autoRepairAvailable);
      if (issue.details) {
        console.log('Details:', issue.details);
      }
      if (issue.context) {
        console.log('Context:', JSON.stringify(issue.context, null, 2));
      }
    });
  } else {
    console.log('No issues found (or empty array)');
  }

  console.log('\n=== FINAL WORKFLOW STATE ===');
  if (session.final_workflow) {
    const workflow = typeof session.final_workflow === 'string'
      ? JSON.parse(session.final_workflow)
      : session.final_workflow;

    // Check step16 config specifically
    const steps = workflow.steps || [];
    const step16 = steps.find((s: any) => s.step_id === 'step16');

    if (step16) {
      console.log('Step16 config after calibration:');
      console.log(JSON.stringify(step16.config, null, 2));
    } else {
      console.log('Step16 not found in final workflow');
    }
  }

  console.log('\n=== ERROR LOG ===');
  if (session.error_log) {
    console.log(session.error_log);
  }
}

main();
