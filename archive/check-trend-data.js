require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

(async () => {
  // Get recent execution_metrics
  const { data: metrics, error } = await supabase
    .from('execution_metrics')
    .select('*')
    .eq('agent_id', '08eb9918-e60f-4179-a5f4-bc83b95fc15c')
    .order('executed_at', { ascending: false })
    .limit(20);
  
  if (error) {
    console.error('Error:', error);
    return;
  }

  console.log('📊 RECENT EXECUTION METRICS:\n');
  metrics.forEach((m, i) => {
    console.log(`#${i+1} - ${m.executed_at}`);
    console.log(`  total_items: ${m.total_items}`);
    console.log(`  items_by_field:`, JSON.stringify(m.items_by_field));
    console.log(`  field_names:`, m.field_names);
    console.log(`  has_empty_results: ${m.has_empty_results}`);
    console.log(`  duration_ms: ${m.duration_ms}`);
    console.log('');
  });
})();
