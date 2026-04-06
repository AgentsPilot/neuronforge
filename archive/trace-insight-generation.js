require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function traceInsightGeneration() {
  const agentId = '08eb9918-e60f-4179-a5f4-bc83b95fc15c';

  console.log('\n🔍 TRACING INSIGHT GENERATION DATA FLOW\n');
  console.log('='.repeat(60));

  // 1. TrendAnalyzer fetches execution_metrics
  console.log('\n1️⃣ TrendAnalyzer.fetchRecentMetrics()');
  console.log('   Fetches from: execution_metrics table');

  const { data: metrics } = await supabase
    .from('execution_metrics')
    .select('*')
    .eq('agent_id', agentId)
    .order('executed_at', { ascending: false })
    .limit(3);

  console.log('   Fields used:');
  console.log('     - total_items (for volume trends)');
  console.log('     - step_metrics (for metric detection)');
  console.log('     - items_by_field (for category distribution)');
  console.log('     - duration_ms (for performance)');
  console.log('     - has_empty_results, failed_step_count (for health)');

  if (metrics && metrics.length > 0) {
    console.log('\n   Sample data from latest execution:');
    const latest = metrics[0];
    console.log('   total_items:', latest.total_items);
    console.log('   step_metrics:', JSON.stringify(latest.step_metrics, null, 4));
    console.log('   items_by_field:', JSON.stringify(latest.items_by_field, null, 4));
  }

  // 2. MetricDetector analyzes step_metrics
  console.log('\n\n2️⃣ MetricDetector.detectBusinessMetricStep()');
  console.log('   Input: step_metrics array from execution_metrics');
  console.log('   Fields analyzed per step:');
  console.log('     - step_name (semantic analysis)');
  console.log('     - count (volume filtering)');
  console.log('     - plugin (type identification)');
  console.log('     - action (purpose detection)');

  if (metrics && metrics[0]?.step_metrics) {
    console.log('\n   Scoring each step:');
    metrics[0].step_metrics.forEach((step, idx) => {
      console.log('   Step', idx + 1, ':', '"' + step.step_name + '"');
      console.log('     Count:', step.count);
      console.log('     Plugin:', step.plugin);
      console.log('     Action:', step.action);
    });
  }

  // 3. Check what workflow_step_executions contains
  console.log('\n\n3️⃣ Alternative: workflow_step_executions table');
  console.log('   (NOT currently used by TrendAnalyzer)');

  const { data: latestExecution } = await supabase
    .from('workflow_executions')
    .select('id')
    .eq('agent_id', agentId)
    .order('started_at', { ascending: false })
    .limit(1);

  if (latestExecution && latestExecution[0]) {
    const { data: stepExecutions } = await supabase
      .from('workflow_step_executions')
      .select('step_id, step_name, item_count, plugin, action, execution_metadata')
      .eq('workflow_execution_id', latestExecution[0].id)
      .order('created_at', { ascending: true });

    console.log('   Fields available:');
    console.log('     - step_id (unique identifier)');
    console.log('     - step_name (description)');
    console.log('     - item_count (items processed)');
    console.log('     - plugin (data source/destination)');
    console.log('     - action (operation type)');
    console.log('     - execution_metadata (field_names, etc.)');

    if (stepExecutions) {
      console.log('\n   Sample step execution:');
      const sample = stepExecutions.find(s => s.step_name.includes('Filter'));
      if (sample) {
        console.log('   ', JSON.stringify(sample, null, 6));
      }
    }
  }

  console.log('\n\n4️⃣ CRITICAL INSIGHT:');
  console.log('   ❌ workflow_step_executions has MORE detailed info');
  console.log('      - step_id (links to workflow definition)');
  console.log('      - execution_metadata (field_names)');
  console.log('   ✅ execution_metrics.step_metrics is a COPY');
  console.log('      - Created by MetricsCollector from workflow_step_executions');
  console.log('      - Already has step_name, count, plugin, action');

  console.log('\n\n5️⃣ CONCLUSION:');
  console.log('   We ARE using workflow_step_executions data!');
  console.log('   Flow: workflow_step_executions → MetricsCollector → execution_metrics.step_metrics');
  console.log('   MetricDetector analyzes: execution_metrics.step_metrics[]');
  console.log('   Each step metric has: { step_name, count, plugin, action }');

  console.log('\n' + '='.repeat(60) + '\n');
}

traceInsightGeneration().catch(console.error);
