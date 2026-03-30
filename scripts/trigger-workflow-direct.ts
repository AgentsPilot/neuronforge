// Trigger workflow execution directly via WorkflowPilot
import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';
import { WorkflowPilot } from '@/lib/pilot/WorkflowPilot';
import { createLogger } from '@/lib/logger';

config({ path: path.join(process.cwd(), '.env.local') });

const logger = createLogger({ module: 'test-workflow-direct', service: 'test' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const userId = '08456106-aa50-4810-b12c-7ca84102da31';
const agentId = '43ffbc8a-406d-4a43-9f3f-4e7554160eda';

async function testWorkflowDirect() {
  console.log('=== TESTING WORKFLOW EXECUTION DIRECTLY ===\n');

  // Load the fixed PILOT DSL
  const pilotDslPath = path.join(process.cwd(), 'output/vocabulary-pipeline/pilot-dsl-steps.json');
  const pilotDsl = JSON.parse(fs.readFileSync(pilotDslPath, 'utf-8'));

  console.log(`Loaded PILOT DSL: ${pilotDsl.length} steps`);

  const workflowConfig = {
    drive_folder_name: 'TestAgent0312',
    amount_threshold_usd: 10,
    google_sheet_id: '1pM8WbXtPgaYqokHn_spgQAfR7SBuql3JUtE1ugDtOpc',
    sheet_tab_name: 'Expenses',
    user_email: 'offir.omer@gmail.com'
  };

  console.log('Creating WorkflowPilot instance...');
  const pilot = new WorkflowPilot({
    userId,
    agentId,
    supabase,
    logger,
  });

  console.log('Starting workflow execution...\n');

  try {
    const result = await pilot.executeWorkflow(
      pilotDsl,
      workflowConfig,
      'test-execution-' + Date.now()
    );

    console.log('\n✅ WORKFLOW COMPLETED!');
    console.log('Result:', JSON.stringify(result, null, 2));
  } catch (error: any) {
    console.error('\n❌ WORKFLOW FAILED');
    console.error('Error:', error.message);
    if (error.stack) {
      console.error('Stack:', error.stack);
    }
  }
}

testWorkflowDirect().catch(console.error);
