require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function checkInsightTypes() {
  const agentId = '08eb9918-e60f-4179-a5f4-bc83b95fc15c';

  const { data: insights } = await supabase
    .from('execution_insights')
    .select('created_at, title, insight_type, category')
    .eq('agent_id', agentId)
    .order('created_at', { ascending: false })
    .limit(10);

  console.log('\n🔍 Insight Types and Categories:\n');

  insights.forEach((i, idx) => {
    console.log(idx + 1 + '.', i.created_at);
    console.log('   Title:', i.title);
    console.log('   insight_type:', i.insight_type);
    console.log('   category:', i.category);
    console.log('');
  });

  console.log('Problem: findExistingInsight() queries by insight_type');
  console.log('But each insight has a DIFFERENT insight_type!');
  console.log('');
  console.log('Examples:');
  console.log('  - scale_opportunity');
  console.log('  - performance_degradation');
  console.log('  - schedule_optimization');
  console.log('');
  console.log('So cache lookup will NEVER find a match!');
  console.log('Each execution generates a new insight because types differ.');
}

checkInsightTypes().catch(console.error);
