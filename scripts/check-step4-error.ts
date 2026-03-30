import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function checkStep4Error() {
  // Get latest execution
  const { data: execution } = await supabase
    .from('workflow_executions')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(1)
    .single();

  if (!execution) {
    console.log('❌ No execution found');
    return;
  }

  console.log('Execution ID:', execution.id);
  console.log('Status:', execution.status);
  console.log('\n=== CHECKING STEP4 ===\n');

  const trace = execution.execution_trace || {};

  if (trace.step4) {
    const step4Data = trace.step4;
    console.log('Step4 Status:', step4Data.status);
    console.log('Step4 Output Type:', typeof step4Data.output);
    console.log('Step4 Output:', JSON.stringify(step4Data.output, null, 2));

    if (step4Data.error) {
      console.log('\n❌ Step4 Error:', step4Data.error);
    }

    // Check if output contains error objects
    if (Array.isArray(step4Data.output)) {
      console.log('\n=== ANALYZING STEP4 OUTPUT ITEMS ===');
      step4Data.output.forEach((item: any, i: number) => {
        console.log(`\nItem ${i}:`);
        if (item.error) {
          console.log('  ❌ Error:', item.error);
        } else {
          console.log('  Keys:', Object.keys(item));
          // Show first 200 chars of each field
          Object.entries(item).forEach(([key, value]) => {
            const str = typeof value === 'string' ? value : JSON.stringify(value);
            console.log(`  ${key}:`, str.substring(0, 100));
          });
        }
      });
    }
  } else {
    console.log('❌ No step4 data in execution trace');
  }

  // Also check step11 (filter that returned empty)
  console.log('\n=== CHECKING STEP11 (Filter) ===\n');
  if (trace.step11) {
    const step11Data = trace.step11;
    console.log('Step11 Status:', step11Data.status);
    console.log('Step11 Output Type:', typeof step11Data.output);
    console.log('Step11 Output Length:', Array.isArray(step11Data.output) ? step11Data.output.length : 'N/A');
    console.log('Step11 Output:', JSON.stringify(step11Data.output, null, 2));

    if (step11Data.error) {
      console.log('\n❌ Step11 Error:', step11Data.error);
    }
  }

  // Check what step3 produced (input to step4)
  console.log('\n=== CHECKING STEP3 (Input to Step4) ===\n');
  if (trace.step3) {
    const step3Data = trace.step3;
    console.log('Step3 Status:', step3Data.status);
    console.log('Step3 Output Length:', Array.isArray(step3Data.output) ? step3Data.output.length : 'N/A');

    if (Array.isArray(step3Data.output) && step3Data.output.length > 0) {
      console.log('\nFirst item from step3:');
      console.log(JSON.stringify(step3Data.output[0], null, 2));
    }
  }
}

checkStep4Error().catch(console.error);
