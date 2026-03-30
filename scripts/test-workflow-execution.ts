// Test actual workflow execution with the fixed PILOT DSL
import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';

config({ path: path.join(process.cwd(), '.env.local') });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const userId = '08456106-aa50-4810-b12c-7ca84102da31';
const agentId = '43ffbc8a-406d-4a43-9f3f-4e7554160eda'; // Invoice extraction agent

async function testWorkflowExecution() {
  console.log('=== TESTING WORKFLOW EXECUTION ===\n');

  // Load the fixed PILOT DSL
  const pilotDslPath = path.join(process.cwd(), 'output/vocabulary-pipeline/pilot-dsl-steps.json');
  const pilotDsl = JSON.parse(fs.readFileSync(pilotDslPath, 'utf-8'));

  console.log(`Loaded PILOT DSL: ${pilotDsl.length} steps`);
  console.log(`Steps: ${pilotDsl.map((s: any) => s.step_id || s.id).join(', ')}\n`);

  // Trigger workflow execution via API
  const response = await fetch(`http://localhost:3000/api/v2/calibrate/batch`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      agent_id: agentId,
      user_id: userId,
      workflow_config: {
        drive_folder_name: 'TestAgent0312',
        amount_threshold_usd: 10,
        google_sheet_id: '1pM8WbXtPgaYqokHn_spgQAfR7SBuql3JUtE1ugDtOpc',
        sheet_tab_name: 'Expenses',
        user_email: 'offir.omer@gmail.com'
      },
      pilot_dsl: pilotDsl
    })
  });

  if (!response.ok) {
    console.error('❌ API request failed:', response.status, response.statusText);
    const text = await response.text();
    console.error('Response:', text);
    return;
  }

  const result = await response.json();
  console.log('✅ Workflow execution triggered');
  console.log('Execution ID:', result.execution_id || 'N/A');
  console.log('Status:', result.status || 'N/A');

  // Wait a bit for execution to start
  await new Promise(resolve => setTimeout(resolve, 2000));

  // Monitor execution
  console.log('\n=== MONITORING EXECUTION ===');
  const executionId = result.execution_id;

  if (!executionId) {
    console.log('No execution ID returned, checking latest execution...');
    const { data: executions } = await supabase
      .from('workflow_executions')
      .select('*')
      .order('started_at', { ascending: false })
      .limit(1);

    if (executions && executions.length > 0) {
      console.log(`Latest execution: ${executions[0].id} - Status: ${executions[0].status}`);
    }
    return;
  }

  // Poll for completion
  let attempts = 0;
  const maxAttempts = 60; // 2 minutes max

  while (attempts < maxAttempts) {
    await new Promise(resolve => setTimeout(resolve, 2000));

    const { data: execution } = await supabase
      .from('workflow_executions')
      .select('*')
      .eq('id', executionId)
      .single();

    if (!execution) {
      console.log('Execution not found in database yet...');
      attempts++;
      continue;
    }

    console.log(`[${new Date().toISOString()}] Status: ${execution.status}`);

    if (execution.status === 'completed') {
      console.log('\n✅ WORKFLOW COMPLETED SUCCESSFULLY!');
      console.log(`Duration: ${Math.round((new Date(execution.completed_at).getTime() - new Date(execution.started_at).getTime()) / 1000)}s`);

      if (execution.result) {
        console.log('\nResult:', JSON.stringify(execution.result, null, 2));
      }
      break;
    } else if (execution.status === 'failed') {
      console.log('\n❌ WORKFLOW FAILED');
      console.log('Error:', execution.error);
      break;
    }

    attempts++;
  }

  if (attempts >= maxAttempts) {
    console.log('\n⚠️ Timeout waiting for execution to complete');
  }
}

testWorkflowExecution().catch(console.error);
