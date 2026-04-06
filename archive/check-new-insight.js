require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function checkNewInsight() {
  const agentId = '08eb9918-e60f-4179-a5f4-bc83b95fc15c';

  const { data: insights } = await supabase
    .from('execution_insights')
    .select('*')
    .eq('agent_id', agentId)
    .order('created_at', { ascending: false })
    .limit(1);

  if (insights.length === 0) {
    console.log('No insights found');
    return;
  }

  const insight = insights[0];
  console.log('\n📊 LATEST INSIGHT\n');
  console.log('='.repeat(80));
  console.log(`Title: ${insight.title}`);
  console.log(`Category: ${insight.category}`);
  console.log(`Severity: ${insight.severity}`);
  console.log(`Type: ${insight.insight_type}`);
  console.log(`Created: ${insight.created_at}`);
  console.log('\nDescription:');
  console.log(insight.description);
  console.log('\nBusiness Impact:');
  console.log(insight.business_impact);
  console.log('\nRecommendation:');
  console.log(insight.recommendation);
  console.log('\n' + '='.repeat(80));

  // Check pattern_data
  if (insight.pattern_data) {
    console.log('\n📈 PATTERN DATA:\n');
    console.log(JSON.stringify(insight.pattern_data, null, 2).substring(0, 500));
  }
}

checkNewInsight().catch(console.error);
