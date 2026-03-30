import { config } from 'dotenv';
config({ path: '.env.local' });

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function main() {
  const { data: agent } = await supabase
    .from('agents')
    .select('pilot_steps')
    .eq('id', '43ffbc8a-406d-4a43-9f3f-4e7554160eda')
    .single();

  if (!agent) {
    console.log('Agent not found');
    return;
  }

  const steps = agent.pilot_steps || [];

  console.log('=== CRITICAL STEPS ANALYSIS ===\n');

  // Check step2 (flatten)
  const step2 = steps.find((s: any) => s.step_id === 'step2');
  if (step2) {
    console.log('STEP2 (flatten):');
    console.log('  Input:', step2.config?.input);
    console.log('  Field:', step2.config?.field);
    console.log('  Expected: field should be "attachments" (NOT "emails.attachments")');

    if (step2.config?.field === 'attachments') {
      console.log('  ✅ CORRECT - will extract items');
    } else if (step2.config?.field === 'emails.attachments') {
      console.log('  ❌ BROKEN - will extract 0 items (field path bug)');
    } else {
      console.log(`  ⚠️  UNEXPECTED - field is "${step2.config?.field}"`);
    }
  }

  // Check step3 (filter)
  console.log('\nSTEP3 (filter):');
  const step3 = steps.find((s: any) => s.step_id === 'step3');
  if (step3) {
    console.log('  Input:', step3.config?.input);
    console.log('  Operation:', step3.config?.operation);
    console.log('  Condition:', JSON.stringify(step3.config?.condition || step3.config?.filter_condition));
  }

  // Check step4 (scatter_gather)
  console.log('\nSTEP4 (scatter_gather):');
  const step4 = steps.find((s: any) => s.step_id === 'step4');
  if (step4) {
    console.log('  Input:', step4.config?.input);
    console.log('  Iterate over:', step4.config?.iterate_over);
    console.log('  Contains', step4.config?.steps?.length || 0, 'nested steps');

    // Check if scatter_gather has ANY items to process
    console.log('\n  If step2 flatten extracts 0 items OR step3 filter returns 0 items:');
    console.log('    → scatter_gather will iterate 0 times');
    console.log('    → NO files uploaded');
    console.log('    → NO data added to spreadsheet');
    console.log('    → step4 "completes" but with empty results');
  }

  // Check step16
  console.log('\nSTEP16 (send_email):');
  const step16 = steps.find((s: any) => s.step_id === 'step16');
  if (step16) {
    console.log('  Recipients.to:', JSON.stringify(step16.config?.recipients?.to));
    console.log('  Content.subject:', step16.config?.content?.subject);

    if (JSON.stringify(step16.config).includes('{{config.digest_recipient}}')) {
      console.log('  ✅ Has {{config.digest_recipient}} variable');
    }
  }

  console.log('\n\n=== EXECUTION FLOW ANALYSIS ===');
  console.log('\nBased on "7 steps completed, 1 failed":');
  console.log('');
  console.log('Scenario A: Flatten bug still exists');
  console.log('  step1 (search) → finds emails ✅');
  console.log('  step2 (flatten) → extracts 0 items ✅ (completes but wrong result)');
  console.log('  step3 (filter) → filters 0 items ✅ (completes but empty)');
  console.log('  step4 (scatter_gather) → iterates 0 times ✅ (completes but does nothing)');
  console.log('  step11 (transform) → operates on empty array ✅');
  console.log('  step12 (conditional) → checks condition ✅');
  console.log('  step15 (ai_processing) → generates email ✅');
  console.log('  step16 (send_email) → fails ❌ (config.digest_recipient issue)');
  console.log('');
  console.log('Result: NO files uploaded, NO spreadsheet rows, NO email sent');
  console.log('');
  console.log('Scenario B: Flatten fixed, but filter returns 0');
  console.log('  step2 extracts items, but step3 filter condition rejects all');
  console.log('  Same result: scatter_gather processes 0 items');
}

main();
