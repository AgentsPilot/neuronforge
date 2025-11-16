// Quick script to check per-step routing logs
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function checkRoutingLogs() {
  console.log('🔍 Checking per-step routing logs...\n');

  // Check if columns exist
  const { data: columns, error: colError } = await supabase
    .from('workflow_step_executions')
    .select('*')
    .limit(1);

  if (colError) {
    console.error('❌ Error querying table:', colError);
    return;
  }

  if (columns && columns.length > 0) {
    const firstRow = columns[0];
    const routingColumns = [
      'complexity_score',
      'ais_token_complexity',
      'selected_tier',
      'selected_model',
      'effective_complexity',
      'routed_at'
    ];

    console.log('📊 Available routing columns:');
    routingColumns.forEach(col => {
      console.log(`   ${col in firstRow ? '✅' : '❌'} ${col}`);
    });
    console.log();
  }

  // Query recent routing logs
  const { data: logs, error } = await supabase
    .from('workflow_step_executions')
    .select(`
      step_id,
      step_name,
      complexity_score,
      ais_token_complexity,
      ais_execution_complexity,
      selected_tier,
      selected_model,
      effective_complexity,
      routing_reason,
      routed_at,
      created_at
    `)
    .not('routed_at', 'is', null)
    .order('routed_at', { ascending: false })
    .limit(5);

  if (error) {
    console.error('❌ Error querying routing logs:', error);
    return;
  }

  if (!logs || logs.length === 0) {
    console.log('⚠️  No routing logs found (routed_at IS NULL for all steps)');
    console.log('\nChecking all recent step executions:');

    const { data: allSteps, error: allError } = await supabase
      .from('workflow_step_executions')
      .select('step_id, step_name, status, created_at')
      .order('created_at', { ascending: false })
      .limit(5);

    if (allSteps && allSteps.length > 0) {
      console.log('\n📋 Recent step executions:');
      allSteps.forEach((step, i) => {
        console.log(`   ${i + 1}. ${step.step_name} (${step.step_id}) - ${step.status}`);
      });
    } else {
      console.log('   No step executions found');
    }

    return;
  }

  console.log(`✅ Found ${logs.length} routing log entries:\n`);
  logs.forEach((log, i) => {
    console.log(`${i + 1}. ${log.step_name || log.step_id}`);
    console.log(`   Complexity: ${log.complexity_score?.toFixed(2) || 'N/A'}`);
    console.log(`   AIS Token: ${log.ais_token_complexity?.toFixed(2) || 'N/A'}`);
    console.log(`   AIS Execution: ${log.ais_execution_complexity?.toFixed(2) || 'N/A'}`);
    console.log(`   Effective: ${log.effective_complexity?.toFixed(2) || 'N/A'}`);
    console.log(`   Tier: ${log.selected_tier || 'N/A'}`);
    console.log(`   Model: ${log.selected_model || 'N/A'}`);
    console.log(`   Reason: ${log.routing_reason ? log.routing_reason.substring(0, 60) : 'N/A'}`);
    console.log(`   Routed at: ${log.routed_at}`);
    console.log();
  });
}

checkRoutingLogs().then(() => process.exit(0)).catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
