import { config } from 'dotenv';
config({ path: '.env.local' });

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function main() {
  const executionId = '229b66ee-29ca-4944-8492-e25f3a822302';

  // Get execution trace
  const { data: traces } = await supabase
    .from('execution_trace')
    .select('*')
    .eq('execution_id', executionId)
    .order('created_at', { ascending: true });

  if (!traces || traces.length === 0) {
    console.log('No execution trace found');
    return;
  }

  console.log(`=== EXECUTION TRACE (${traces.length} entries) ===\n`);

  traces.forEach((trace: any, index: number) => {
    console.log(`\n[${index + 1}] ${trace.step_id || 'NO_STEP_ID'}`);
    console.log(`Event: ${trace.event_type}`);
    console.log(`Status: ${trace.status}`);
    console.log(`Timestamp: ${trace.created_at}`);

    if (trace.metadata) {
      const meta = typeof trace.metadata === 'string' ? JSON.parse(trace.metadata) : trace.metadata;

      // Show error if present
      if (meta.error || meta.errorMessage) {
        console.log(`ERROR: ${meta.error || meta.errorMessage}`);
      }

      // Show step details if present
      if (meta.plugin) {
        console.log(`Plugin: ${meta.plugin}`);
      }
      if (meta.operation || meta.action) {
        console.log(`Operation: ${meta.operation || meta.action}`);
      }

      // Show config for send_email steps
      if (trace.step_id === 'step16' || (meta.plugin === 'google-mail' && (meta.operation === 'send_email' || meta.action === 'send_email'))) {
        console.log('Config/Params:');
        console.log(JSON.stringify(meta.config || meta.params || {}, null, 2));
      }
    }
  });

  // Find step16 entries
  const step16Traces = traces.filter((t: any) => t.step_id === 'step16');
  if (step16Traces.length > 0) {
    console.log('\n\n=== STEP16 TRACE ENTRIES ===');
    step16Traces.forEach((trace: any) => {
      console.log(JSON.stringify(trace, null, 2));
    });
  }
}

main();
