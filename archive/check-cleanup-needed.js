require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function checkCleanupNeeded() {
  const agentId = '08eb9918-e60f-4179-a5f4-bc83b95fc15c';

  console.log('\n🔍 CURRENT STATE ANALYSIS\n');
  console.log('='.repeat(80));

  // 1. Check execution_metrics table
  const { data: metrics } = await supabase
    .from('execution_metrics')
    .select('id, executed_at, total_items, items_by_field, detected_metric')
    .eq('agent_id', agentId)
    .order('executed_at', { ascending: false })
    .limit(5);

  console.log('\n📊 execution_metrics table (used for trend analysis):\n');
  if (metrics && metrics.length > 0) {
    console.log(`   ✅ EXISTS - ${metrics.length} recent records found`);
    console.log('');
    metrics.forEach((m, i) => {
      console.log(`   ${i+1}. ${m.executed_at.slice(0,16)}`);
      console.log(`      total_items: ${m.total_items}`);
      const fieldsStr = JSON.stringify(m.items_by_field);
      console.log(`      items_by_field: ${fieldsStr.slice(0,60)}${fieldsStr.length > 60 ? '...' : ''}`);
      if (m.detected_metric) {
        console.log(`      detected_metric: ${m.detected_metric.step_name || 'N/A'}`);
      }
      console.log('');
    });
  } else {
    console.log('   ❌ NO DATA - Table empty or not populated');
    console.log('   ⚠️  Need to run executions to populate this table');
  }

  console.log('='.repeat(80));

  // 2. Check execution_insights table
  const { data: insights } = await supabase
    .from('execution_insights')
    .select('id, created_at, title, insight_type, category, status')
    .eq('agent_id', agentId)
    .order('created_at', { ascending: false });

  console.log('\n💡 execution_insights table (displayed in UI):\n');
  if (insights && insights.length > 0) {
    console.log(`   Found ${insights.length} insights:\n`);
    insights.forEach((ins, i) => {
      const age = Math.floor((Date.now() - new Date(ins.created_at).getTime()) / (1000*60*60*24));
      console.log(`   ${i+1}. ${ins.title.slice(0,60)}`);
      console.log(`      ID: ${ins.id}`);
      console.log(`      Type: ${ins.insight_type} | Category: ${ins.category}`);
      console.log(`      Status: ${ins.status} | Age: ${age} days`);
      console.log('');
    });

    // Check for bad insights
    const badInsights = insights.filter(i =>
      i.title.toLowerCase().includes('inconsistent') ||
      i.title.toLowerCase().includes('erratic') ||
      i.title.toLowerCase().includes('surged 420') ||
      i.created_at < new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
    );

    if (badInsights.length > 0) {
      console.log('   🚨 Found insights that should be DELETED:\n');
      badInsights.forEach(ins => {
        console.log(`      - ${ins.id}`);
        console.log(`        "${ins.title}"`);
        console.log('');
      });
    }
  } else {
    console.log('   ❌ NO INSIGHTS - Table empty\n');
  }

  console.log('='.repeat(80));

  // 3. Check if agent has insights_enabled
  const { data: agent } = await supabase
    .from('agents')
    .select('agent_name, insights_enabled, production_ready')
    .eq('id', agentId)
    .single();

  console.log('\n⚙️  Agent Configuration:\n');
  console.log(`   Name: ${agent.agent_name}`);
  console.log(`   insights_enabled: ${agent.insights_enabled}`);
  console.log(`   production_ready: ${agent.production_ready}`);

  if (!agent.insights_enabled) {
    console.log('\n   ⚠️  insights_enabled is FALSE - insights will NOT be generated!');
  }
  if (!agent.production_ready) {
    console.log('   ⚠️  production_ready is FALSE - only run_mode=production generates insights');
  }

  console.log('\n' + '='.repeat(80));
  console.log('\n📋 WHAT YOU NEED TO DO\n');

  const needsCleanup = insights && insights.length > 0;
  const needsMetrics = !metrics || metrics.length === 0;
  const needsConfig = !agent.insights_enabled || !agent.production_ready;

  console.log('To get fresh, accurate insights showing in UI:\n');

  if (needsCleanup) {
    console.log('✅ Step 1: DELETE old insights (recommended)');
    console.log('   DELETE FROM execution_insights WHERE agent_id = \'08eb9918-e60f-4179-a5f4-bc83b95fc15c\';');
    console.log('   Reason: Clear misleading historical data\n');
  }

  if (needsMetrics) {
    console.log('⚠️  Step 2: RUN production execution');
    console.log('   - MetricsCollector runs automatically');
    console.log('   - Need 7+ executions for business insights\n');
  } else {
    console.log('✅ Step 2: execution_metrics has data (ready)\n');
  }

  if (needsConfig) {
    console.log('⚠️  Step 3: ENABLE insights in agent settings');
    console.log('   UPDATE agents SET insights_enabled = true, production_ready = true');
    console.log('   WHERE id = \'08eb9918-e60f-4179-a5f4-bc83b95fc15c\';\n');
  } else {
    console.log('✅ Step 3: Agent configured for insights (ready)\n');
  }

  console.log('📌 After cleanup:');
  console.log('   1. Run ONE production execution');
  console.log('   2. Fresh insight will generate (if 7+ total executions exist)');
  console.log('   3. View in UI at /v2/agents/[id] page\n');

  console.log('='.repeat(80));
  console.log('\n💡 DO WE NEED MORE DATA?\n');
  console.log('Current system tracks:\n');
  console.log('   ✅ Item counts per step (workflow_step_executions.item_count)');
  console.log('   ✅ Field names (workflow_step_executions.execution_metadata.field_names)');
  console.log('   ✅ Step names (workflow_step_executions.step_name)');
  console.log('   ✅ Execution timing (workflow_step_executions.execution_time_ms)');
  console.log('   ✅ Success/failure (workflow_step_executions.status)');
  console.log('   ✅ Workflow context (agents.created_from_prompt)');
  console.log('\nThis is ENOUGH data for business insights!');
  console.log('No additional data injection needed.\n');
}

checkCleanupNeeded().catch(console.error);
