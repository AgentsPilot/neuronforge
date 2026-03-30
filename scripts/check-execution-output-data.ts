import { config } from 'dotenv';
config({ path: '.env.local' });

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function main() {
  const executionId = '229b66ee-29ca-4944-8492-e25f3a822302';

  const { data: execution } = await supabase
    .from('agent_executions')
    .select('*')
    .eq('id', executionId)
    .single();

  if (!execution) {
    console.log('Execution not found');
    return;
  }

  console.log('=== CHECKING ALL EXECUTION FIELDS ===\n');

  // List all fields
  const fields = Object.keys(execution);
  console.log('Available fields:', fields.join(', '));

  console.log('\n=== SEARCHING FOR OUTPUT DATA ===\n');

  // Check each field that might contain output
  const potentialOutputFields = [
    'result',
    'logs',
    'step_results',
    'execution_summary',
    'output',
    'data',
    'workflow_output'
  ];

  potentialOutputFields.forEach(field => {
    if (execution[field]) {
      console.log(`\n${field}:`);
      const value = execution[field];

      if (typeof value === 'object') {
        console.log(JSON.stringify(value, null, 2));
      } else {
        console.log(value);
      }
    } else {
      console.log(`\n${field}: null or undefined`);
    }
  });

  console.log('\n\n=== CHECKING GOOGLE DRIVE & SHEETS ===');
  console.log('To verify if files were actually uploaded and data added:');
  console.log('');
  console.log('1. Check Google Drive folder: https://drive.google.com/drive/folders/1vz_vxsu4BF5xZgiDYviRmvzXtzgEdzAa');
  console.log('2. Check Google Sheet: https://docs.google.com/spreadsheets/d/1pM8WbXtPgaYqokHn_spgQAfR7SBuql3JUtE1ugDtOpc');
  console.log('');
  console.log('If files exist in Drive and data exists in Sheet, then:');
  console.log('  → Workflow DID execute successfully through scatter_gather');
  console.log('  → Only step16 (send_email) failed');
  console.log('');
  console.log('If NO files in Drive or NO data in Sheet, then:');
  console.log('  → Workflow failed BEFORE or DURING scatter_gather');
  console.log('  → Need to check step2/step3 output (flatten/filter)');
}

main();
