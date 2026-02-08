require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function check() {
  const { data } = await supabase
    .from('execution_insights')
    .select('*')
    .eq('insight_type', 'schedule_optimization')
    .order('created_at', { ascending: false })
    .limit(1)
    .single();

  if (data) {
    console.log('SCHEDULE OPTIMIZATION INSIGHT:\n');
    console.log('Pattern Data:', JSON.stringify(data.pattern_data, null, 2));
    console.log('\nMetrics:', JSON.stringify(data.metrics, null, 2));
    console.log('\nThis pattern was likely detected because:');
    console.log('- Workflow runs at certain times');
    console.log('- Could be optimized for better timing');
    console.log('- 70% detection rate suggests consistent pattern');
  }
}

check();
