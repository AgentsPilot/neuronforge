require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function checkLatestRun() {
  const agentId = '08eb9918-e60f-4179-a5f4-bc83b95fc15c';

  console.log('\n🔍 CHECKING LATEST RUN\n');
  console.log('='.repeat(80));

  // Get latest execution
  const { data: executions } = await supabase
    .from('workflow_executions')
    .select('id, status, created_at')
    .eq('agent_id', agentId)
    .order('created_at', { ascending: false })
    .limit(5);

  console.log('\n📋 Last 5 executions:');
  executions.forEach((exec, i) => {
    const shortId = exec.id.substring(0, 8);
    const timestamp = exec.created_at.substring(0, 19);
    console.log(`   ${i+1}. ${shortId}... - ${exec.status} - ${timestamp}`);
  });

  const latestExec = executions[0];
  console.log(`\n🔎 Analyzing latest: ${latestExec.id}`);
  console.log(`   Status: ${latestExec.status}`);

  // Check execution_metrics
  const { data: metrics } = await supabase
    .from('execution_metrics')
    .select('*')
    .eq('execution_id', latestExec.id)
    .maybeSingle();

  console.log('\n📊 Execution Metrics:');
  if (metrics) {
    console.log(`   ✅ EXISTS`);
    console.log(`   total_items: ${metrics.total_items}`);
    const fieldCount = (metrics.field_names || []).length;
    console.log(`   field_names count: ${fieldCount}`);
    const fieldKeys = Object.keys(metrics.items_by_field || {}).length;
    console.log(`   items_by_field keys: ${fieldKeys}`);
  } else {
    console.log(`   ❌ NOT FOUND`);
    console.log(`   → MetricsCollector did not run!`);
  }

  // Check insights
  const { data: insights } = await supabase
    .from('execution_insights')
    .select('id, title, category, created_at, status')
    .eq('agent_id', agentId)
    .order('created_at', { ascending: false })
    .limit(5);

  console.log('\n💡 Recent Insights:');
  if (insights.length === 0) {
    console.log(`   ❌ NO INSIGHTS`);
  } else {
    insights.forEach((ins, i) => {
      const timestamp = ins.created_at.substring(0, 19);
      console.log(`   ${i+1}. "${ins.title}"`);
      console.log(`      Created: ${timestamp} | Status: ${ins.status}`);
    });
  }

  // Check agent settings
  const { data: agent } = await supabase
    .from('agents')
    .select('production_ready, insights_enabled')
    .eq('id', agentId)
    .single();

  console.log('\n⚙️  Agent Settings:');
  const prodReady = agent.production_ready ? '✅' : '❌';
  const insightsEnabled = agent.insights_enabled ? '✅' : '❌';
  console.log(`   production_ready: ${prodReady}`);
  console.log(`   insights_enabled: ${insightsEnabled}`);

  // Count total executions
  const { count } = await supabase
    .from('workflow_executions')
    .select('*', { count: 'exact', head: true })
    .eq('agent_id', agentId)
    .eq('status', 'completed');

  console.log(`\n📈 Total completed executions: ${count}`);
  console.log(`   Minimum for insights: 7`);
  const eligible = count >= 7 ? '✅ YES' : '❌ NO';
  console.log(`   Eligible: ${eligible}`);

  console.log('\n' + '='.repeat(80));
  console.log('\n💡 DIAGNOSIS:\n');

  if (!agent.production_ready) {
    console.log('❌ production_ready is false - insights will not generate');
  } else if (!agent.insights_enabled) {
    console.log('❌ insights_enabled is false - insights will not generate');
  } else if (count < 7) {
    console.log('❌ Not enough executions (need 7+)');
  } else if (!metrics) {
    console.log('❌ MetricsCollector did not run for latest execution');
    console.log('   → Check if execution completed successfully');
    console.log('   → Check server logs for MetricsCollector errors');
  } else if (insights.length === 0) {
    console.log('❌ No insights generated despite meeting all requirements');
    console.log('   → Check server logs for InsightAnalyzer errors');
    console.log('   → Verify collectInsights() was called in WorkflowPilot');
    console.log('   → May be running asynchronously - check in a few seconds');
  } else {
    console.log('✅ System working - insights exist');
  }

  console.log('');
}

checkLatestRun().catch(console.error);
