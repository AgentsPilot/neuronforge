import { config } from 'dotenv';
config({ path: '.env.local' });

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function main() {
  const executionId = '2591e758-8acf-439b-858c-3428fbec4aae';

  console.log('=== ANALYZING EXECUTION ===');
  console.log('Execution ID:', executionId);
  console.log('\nThis execution completed 7 steps before failing at step 8');
  console.log('Expected step order:');
  console.log('  1. step1 (search_emails)');
  console.log('  2. step2 (flatten attachments)');
  console.log('  3. step3 (filter PDFs)');
  console.log('  4. step4 (scatter_gather) - contains nested steps');
  console.log('  5. step11 (filter high value)');
  console.log('  6. step12 (conditional)');
  console.log('  7. step15 (AI email generation)');
  console.log('  8. step16 (send email) ← FAILED HERE');

  console.log('\n=== CRITICAL QUESTION ===');
  console.log('Did step4 (scatter_gather) actually process items?');
  console.log('If yes: Files should be in Drive, data in spreadsheet');
  console.log('If no: Flatten/filter returned 0 items again');

  console.log('\n=== CHECKING EXECUTION CONTEXT ===');

  // Check if there's an execution trace
  const { data: traces } = await supabase
    .from('execution_trace')
    .select('*')
    .eq('execution_id', executionId)
    .order('created_at', { ascending: true });

  if (traces && traces.length > 0) {
    console.log(`\nFound ${traces.length} trace entries:`);

    // Group by step
    const stepTraces = new Map<string, any[]>();
    traces.forEach((t: any) => {
      const stepId = t.step_id || 'unknown';
      if (!stepTraces.has(stepId)) {
        stepTraces.set(stepId, []);
      }
      stepTraces.get(stepId)!.push(t);
    });

    stepTraces.forEach((entries, stepId) => {
      console.log(`\n${stepId}:`);
      entries.forEach((e: any) => {
        console.log(`  - ${e.event_type}: ${e.status}`);
        if (e.metadata) {
          const meta = typeof e.metadata === 'string' ? JSON.parse(e.metadata) : e.metadata;
          if (meta.itemCount !== undefined) {
            console.log(`    Items: ${meta.itemCount}`);
          }
          if (meta.error) {
            console.log(`    Error: ${meta.error}`);
          }
        }
      });
    });
  } else {
    console.log('\n⚠️  No execution trace found');
    console.log('This means step outputs are not being logged');
  }

  console.log('\n=== HYPOTHESIS ===');
  console.log('Since no step execution traces exist, we need to:');
  console.log('1. Check Google Drive folder for uploaded files');
  console.log('2. Check Google Sheet for added rows');
  console.log('3. If neither exist, step2/step3 returned 0 items again');
  console.log('4. If they exist, scatter_gather DID work!');

  console.log('\n=== MANUAL VERIFICATION NEEDED ===');
  console.log('Google Drive folder: https://drive.google.com/drive/folders/1vz_vxsu4BF5xZgiDYviRmvzXtzgEdzAa');
  console.log('Google Sheet: https://docs.google.com/spreadsheets/d/1pM8WbXtPgaYqokHn_spgQAfR7SBuql3JUtE1ugDtOpc');
}

main();
