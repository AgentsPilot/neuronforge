require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function testInsightGeneration() {
  const agentId = '08eb9918-e60f-4179-a5f4-bc83b95fc15c';
  const executionId = 'cc9c516e-6b34-4e28-9862-338283946b69';

  console.log('\n🧪 TESTING INSIGHT GENERATION\n');
  console.log('='.repeat(80));

  // Test if InsightAnalyzer will run
  console.log('\n1. Checking prerequisites...');

  const { data: agent } = await supabase
    .from('agents')
    .select('*')
    .eq('id', agentId)
    .single();

  const prodReady = agent.production_ready ? '✅' : '❌';
  const insightsEnabled = agent.insights_enabled ? '✅' : '❌';
  console.log(`   production_ready: ${prodReady}`);
  console.log(`   insights_enabled: ${insightsEnabled}`);

  // Check execution count
  const { data: executions, count } = await supabase
    .from('workflow_executions')
    .select('id, created_at', { count: 'exact' })
    .eq('agent_id', agentId)
    .eq('status', 'completed')
    .order('created_at', { ascending: false });

  console.log(`\n2. Execution history:`);
  console.log(`   Total completed executions: ${count}`);
  console.log(`   Minimum required: 7`);
  const canGenerate = count >= 7 ? '✅ YES' : '❌ NO';
  console.log(`   Can generate insights? ${canGenerate}`);

  // Check existing insights
  const { data: insights } = await supabase
    .from('execution_insights')
    .select('id, title, category, created_at')
    .eq('agent_id', agentId)
    .order('created_at', { ascending: false });

  console.log(`\n3. Existing insights:`);
  if (insights.length === 0) {
    console.log(`   ✅ NO insights (clean slate)`);
  } else {
    console.log(`   ⚠️  ${insights.length} insights found:`);
    insights.forEach(ins => {
      console.log(`      - "${ins.title}" (${ins.category}) - ${ins.created_at.slice(0,16)}`);
    });
  }

  // Check execution_metrics for latest execution
  const { data: metrics } = await supabase
    .from('execution_metrics')
    .select('*')
    .eq('execution_id', executionId)
    .maybeSingle();

  console.log(`\n4. Latest execution metrics:`);
  if (metrics) {
    console.log(`   ✅ Metrics exist`);
    console.log(`   total_items: ${metrics.total_items}`);
    const fieldKeys = Object.keys(metrics.items_by_field || {}).length;
    console.log(`   items_by_field keys: ${fieldKeys}`);
    const fieldCount = (metrics.field_names || []).length;
    console.log(`   field_names count: ${fieldCount}`);
  } else {
    console.log(`   ❌ No metrics found for execution ${executionId}`);
  }

  console.log('\n' + '='.repeat(80));
  console.log('\n💡 NEXT STEPS:\n');

  if (count >= 7 && agent.insights_enabled && agent.production_ready) {
    console.log('✅ All prerequisites met!');
    console.log('🔄 Insights should have generated automatically.');
    console.log('');
    console.log('If no insight appeared:');
    console.log('   1. Check server logs for errors');
    console.log('   2. Try running the agent again');
    console.log('   3. Check if InsightAnalyzer.analyze() is being called');
  } else {
    console.log('❌ Missing prerequisites:');
    if (count < 7) console.log('   - Need more executions');
    if (!agent.insights_enabled) console.log('   - insights_enabled is false');
    if (!agent.production_ready) console.log('   - production_ready is false');
  }

  console.log('');
}

testInsightGeneration().catch(console.error);
