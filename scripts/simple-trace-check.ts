import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
import * as path from 'path';

config({ path: path.join(process.cwd(), '.env.local') });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

(async () => {
  const { data: traces } = await supabase
    .from('execution_trace')
    .select('cached_outputs')
    .order('created_at', { ascending: false })
    .limit(1)
    .single();

  if (traces && traces.cached_outputs) {
    const outputs = traces.cached_outputs;
    console.log('Step keys:', Object.keys(outputs).sort().join(', '));

    if (outputs.step2) {
      console.log('\n=== STEP2 ===');
      console.log(JSON.stringify(outputs.step2, null, 2));
    }

    if (outputs.step3) {
      console.log('\n=== STEP3 ===');
      console.log(JSON.stringify(outputs.step3, null, 2));
    }
  }
})();
