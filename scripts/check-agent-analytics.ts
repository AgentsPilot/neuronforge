import { config } from 'dotenv';
import { resolve } from 'path';
import { createClient } from '@supabase/supabase-js';

config({ path: resolve(__dirname, '../.env.local') });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const agentId = 'a27cf5db-915c-41dc-90d1-930a58b3f16c';

(async () => {
  console.log('📊 Checking token_usage analytics for agent:', agentId);
  console.log('');

  const { data, error } = await supabase
    .from('token_usage')
    .select('activity_type, feature, input_tokens, output_tokens, created_at')
    .eq('agent_id', agentId)
    .order('created_at', { ascending: false });

  if (error) {
    console.error('Error:', error);
  } else if (!data || data.length === 0) {
    console.log('❌ No records found in token_usage for this agent');
  } else {
    console.log(`Found ${data.length} records:\n`);
    data.forEach((record, i) => {
      const total = (record.input_tokens || 0) + (record.output_tokens || 0);
      console.log(`${i+1}. Activity: ${record.activity_type || 'N/A'}`);
      console.log(`   Feature: ${record.feature || 'N/A'}`);
      console.log(`   Tokens: ${total} (in: ${record.input_tokens}, out: ${record.output_tokens})`);
      console.log(`   Date: ${record.created_at}`);
      console.log('');
    });

    const totalTokens = data.reduce((sum, r) => sum + (r.input_tokens || 0) + (r.output_tokens || 0), 0);
    console.log(`Total tokens across all records: ${totalTokens}`);
  }
})();
