// Analyze the last calibration execution to see what happened
import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
import * as path from 'path';

// Load .env.local from project root
config({ path: path.join(process.cwd(), '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing Supabase credentials in .env.local');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function analyzeLastCalibration() {
  // First check calibration_runs table
  const { data: calibRuns, error: calibError } = await supabase
    .from('calibration_runs')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(1);

  if (calibRuns && calibRuns.length > 0) {
    const calibRun = calibRuns[0];
    console.log('\n=== CALIBRATION RUN INFO ===');
    console.log('Calibration ID:', calibRun.id);
    console.log('Agent ID:', calibRun.agent_id);
    console.log('Status:', calibRun.status);
    console.log('Created:', calibRun.created_at);
    console.log('Completed:', calibRun.completed_at);
    console.log('Test Cases Passed:', calibRun.test_cases_passed);
    console.log('Test Cases Failed:', calibRun.test_cases_failed);

    if (calibRun.results) {
      console.log('\n=== CALIBRATION RESULTS ===');
      const results = calibRun.results;
      console.log('Summary:', results.summary || 'N/A');
      if (results.issues && Array.isArray(results.issues)) {
        console.log(`\nIssues found: ${results.issues.length}`);
        results.issues.forEach((issue: any, i: number) => {
          console.log(`\n${i + 1}. ${issue.stepId}: ${issue.title}`);
          console.log(`   Severity: ${issue.severity}`);
          console.log(`   Category: ${issue.category}`);
          console.log(`   Message: ${issue.message?.slice(0, 200)}...`);
        });
      }
      if (results.execution_summary) {
        console.log('\n=== EXECUTION SUMMARY ===');
        console.log(JSON.stringify(results.execution_summary, null, 2).slice(0, 1000));
      }
    }
    console.log('\n');
  }

  // Get the most recent workflow execution
  const { data: executions, error: execError } = await supabase
    .from('workflow_executions')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(1);

  if (execError || !executions || executions.length === 0) {
    console.error('Error fetching executions:', execError);
    return;
  }

  const execution = executions[0];
  console.log('\n=== EXECUTION INFO ===');
  console.log('Execution ID:', execution.id);
  console.log('Agent ID:', execution.agent_id);
  console.log('Status:', execution.status);
  console.log('Started:', execution.started_at);
  console.log('Ended:', execution.ended_at);
  console.log('Error:', execution.error_message);

  // Get step execution records
  const { data: steps, error: stepsError } = await supabase
    .from('step_executions')
    .select('*')
    .eq('execution_id', execution.id)
    .order('started_at', { ascending: true });

  if (stepsError) {
    console.error('Error fetching steps:', stepsError);
    return;
  }

  console.log('\n=== STEP EXECUTION SUMMARY ===');
  console.log(`Total steps in step_executions table: ${steps?.length || 0}\n`);

  if (steps && steps.length > 0) {
    for (const step of steps) {
      const status = step.status === 'completed' ? '✅' :
                     step.status === 'failed' ? '❌' :
                     step.status === 'running' ? '⏳' : '⚪';

      console.log(`${status} ${step.step_id}: ${step.step_name || '(unnamed)'}`);
      console.log(`   Status: ${step.status}`);
      console.log(`   Plugin: ${step.plugin || 'N/A'}`);
      console.log(`   Action: ${step.action || 'N/A'}`);

      if (step.error_message) {
        console.log(`   ❌ Error: ${step.error_message}`);
      }

      if (step.output_summary) {
        console.log(`   Output: ${JSON.stringify(step.output_summary).slice(0, 100)}...`);
      }

      console.log('');
    }
  } else {
    console.log('⚠️  No step execution records found! Checking execution_trace for cached outputs...\n');
  }

  // Get execution trace with cached outputs
  const { data: trace, error: traceError } = await supabase
    .from('execution_trace')
    .select('*')
    .eq('execution_id', execution.id)
    .order('created_at', { ascending: false })
    .limit(1);

  if (trace && trace.length > 0) {
    console.log('\n=== CACHED OUTPUTS ===');
    const cachedOutputs = trace[0].cached_outputs || {};
    console.log('Steps with cached outputs:', Object.keys(cachedOutputs).join(', '));

    // Check specifically for step18 (AI summary generation)
    if (cachedOutputs.step18) {
      console.log('\n=== STEP18 OUTPUT (summary_email_content) ===');
      console.log(JSON.stringify(cachedOutputs.step18, null, 2).slice(0, 500));
    } else {
      console.log('\n⚠️  WARNING: step18 (summary_email_content) has no cached output!');
    }

    // Check for step4 (drive folder creation)
    if (cachedOutputs.step4) {
      console.log('\n=== STEP4 OUTPUT (drive_folder) ===');
      console.log(JSON.stringify(cachedOutputs.step4, null, 2).slice(0, 300));
    } else {
      console.log('\n⚠️  WARNING: step4 (drive_folder) has no cached output!');
    }

    // Check for step5 (scatter_gather loop)
    if (cachedOutputs.step5) {
      console.log('\n=== STEP5 OUTPUT (processed_transactions) ===');
      const step5Data = cachedOutputs.step5;
      if (Array.isArray(step5Data)) {
        console.log(`Array with ${step5Data.length} items`);
        if (step5Data.length > 0) {
          console.log('First item:', JSON.stringify(step5Data[0], null, 2).slice(0, 300));
        }
      } else {
        console.log(JSON.stringify(step5Data, null, 2).slice(0, 300));
      }
    } else {
      console.log('\n⚠️  WARNING: step5 (processed_transactions) has no cached output!');
    }
  }

  // Get agent config
  const { data: agent, error: agentError } = await supabase
    .from('agents')
    .select('input_schema')
    .eq('id', execution.agent_id)
    .single();

  if (agent) {
    console.log('\n=== AGENT CONFIG (from input_schema) ===');
    const configFields = agent.input_schema?.filter((f: any) =>
      f.default_value !== undefined && f.default_value !== null && f.default_value !== ''
    );
    if (configFields && configFields.length > 0) {
      for (const field of configFields) {
        console.log(`${field.name}: ${field.default_value}`);
      }
    } else {
      console.log('⚠️  No config values found in input_schema!');
    }
  }
}

analyzeLastCalibration().catch(console.error);
