/**
 * Verify Business Intelligence Data Flow
 * Run with: node verify-business-intelligence-flow.js [agentId]
 *
 * Checks that data flows correctly through:
 * 1. workflow_step_executions (per-step detail)
 * 2. execution_metrics (aggregated metrics)
 * 3. execution_insights (business intelligence)
 */

require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function verifyBusinessIntelligenceFlow(agentId) {
  console.log('🔍 Verifying Business Intelligence Data Flow');
  console.log('Agent ID:', agentId);
  console.log('='.repeat(80));

  // Get latest execution
  const { data: latestExecution, error: execError } = await supabase
    .from('agent_executions')
    .select('id, started_at, status')
    .eq('agent_id', agentId)
    .order('started_at', { ascending: false })
    .limit(1)
    .single();

  if (execError || !latestExecution) {
    console.error('❌ No executions found for agent');
    process.exit(1);
  }

  console.log(`\n✅ Latest Execution: ${latestExecution.id}`);
  console.log(`   Status: ${latestExecution.status}`);
  console.log(`   Started: ${new Date(latestExecution.started_at).toLocaleString()}`);

  // ========================================================================
  // PHASE 1: Verify workflow_step_executions (per-step detail)
  // ========================================================================
  console.log('\n' + '─'.repeat(80));
  console.log('PHASE 1: workflow_step_executions (Per-Step Detail)');
  console.log('─'.repeat(80));

  const { data: stepExecutions, error: stepsError } = await supabase
    .from('workflow_step_executions')
    .select('step_id, step_name, plugin, action, item_count, execution_time_ms, tokens_used, status')
    .eq('workflow_execution_id', latestExecution.id)
    .order('created_at', { ascending: true });

  if (stepsError) {
    console.error('❌ Error fetching step executions:', stepsError);
    process.exit(1);
  }

  if (!stepExecutions || stepExecutions.length === 0) {
    console.error('❌ No step executions found');
    process.exit(1);
  }

  console.log(`\n✅ Found ${stepExecutions.length} step executions\n`);

  let totalItems = 0;
  stepExecutions.forEach((step, idx) => {
    const icon = step.status === 'completed' ? '✅' : step.status === 'failed' ? '❌' : '⏸️';
    console.log(`${icon} Step ${idx + 1}: ${step.step_name || step.step_id}`);
    console.log(`   Plugin: ${step.plugin || 'N/A'}`);
    console.log(`   Action: ${step.action || 'N/A'}`);
    console.log(`   Item Count: ${step.item_count || 0}`);
    console.log(`   Execution Time: ${step.execution_time_ms || 0}ms`);
    console.log(`   Tokens: ${step.tokens_used || 0}`);
    console.log(`   Status: ${step.status}`);
    console.log();

    if (step.item_count) {
      totalItems += step.item_count;
    }
  });

  console.log(`📊 Total Items Across All Steps: ${totalItems}`);

  // Check for missing item_count
  const stepsWithoutCount = stepExecutions.filter(s =>
    s.plugin !== 'system' && s.status === 'completed' && !s.item_count
  );

  if (stepsWithoutCount.length > 0) {
    console.log(`\n⚠️  WARNING: ${stepsWithoutCount.length} step(s) missing item_count:`);
    stepsWithoutCount.forEach(s => {
      console.log(`   - ${s.step_name} (${s.plugin}.${s.action})`);
    });
  } else {
    console.log('\n✅ All non-system steps have item_count');
  }

  // ========================================================================
  // PHASE 2: Verify execution_metrics (aggregated metrics)
  // ========================================================================
  console.log('\n' + '─'.repeat(80));
  console.log('PHASE 2: execution_metrics (Aggregated Metrics)');
  console.log('─'.repeat(80));

  const { data: metrics, error: metricsError } = await supabase
    .from('execution_metrics')
    .select('*')
    .eq('execution_id', latestExecution.id)
    .single();

  if (metricsError) {
    console.log('\n❌ No execution_metrics found');
    console.log('   This should be created by MetricsCollector after execution completes');
    console.log('   Metrics:', metricsError);
  } else {
    console.log('\n✅ Found execution_metrics record\n');
    console.log(`   Total Items: ${metrics.total_items || 0}`);
    console.log(`   Duration: ${metrics.duration_ms || 0}ms`);
    console.log(`   Empty Results: ${metrics.has_empty_results ? 'Yes' : 'No'}`);
    console.log(`   Failed Steps: ${metrics.failed_step_count || 0}`);

    if (metrics.step_metrics && Array.isArray(metrics.step_metrics)) {
      console.log(`\n   Step Metrics (${metrics.step_metrics.length} steps):`);
      metrics.step_metrics.forEach((sm, idx) => {
        console.log(`   ${idx + 1}. ${sm.step_name}: ${sm.count} items (${sm.plugin}.${sm.action})`);
      });

      // Verify aggregation matches
      const metricsTotal = metrics.step_metrics.reduce((sum, sm) => sum + (sm.count || 0), 0);
      if (metricsTotal === totalItems) {
        console.log(`\n   ✅ Aggregation verified: ${metricsTotal} = ${totalItems}`);
      } else {
        console.log(`\n   ⚠️  Aggregation mismatch: ${metricsTotal} ≠ ${totalItems}`);
      }
    } else {
      console.log('\n   ⚠️  No step_metrics array found');
    }
  }

  // ========================================================================
  // PHASE 3: Check insights readiness
  // ========================================================================
  console.log('\n' + '─'.repeat(80));
  console.log('PHASE 3: Business Intelligence Readiness');
  console.log('─'.repeat(80));

  const { data: allMetrics, error: allMetricsError } = await supabase
    .from('execution_metrics')
    .select('id, executed_at, total_items')
    .eq('agent_id', agentId)
    .order('executed_at', { ascending: false })
    .limit(30);

  if (allMetricsError) {
    console.log('\n❌ Error fetching metrics history:', allMetricsError);
  } else {
    const count = allMetrics?.length || 0;
    console.log(`\n   Execution Count: ${count}`);
    console.log(`   Required for BI: 7`);

    if (count >= 7) {
      console.log(`   ✅ READY for business intelligence generation`);

      // Check if insights exist
      const { data: insights, error: insightsError } = await supabase
        .from('execution_insights')
        .select('id, insight_type, category, severity, title, status, created_at')
        .eq('agent_id', agentId)
        .order('created_at', { ascending: false })
        .limit(5);

      if (insightsError) {
        console.log('\n   ❌ Error fetching insights:', insightsError);
      } else if (!insights || insights.length === 0) {
        console.log('\n   ⚠️  No insights generated yet');
        console.log('      Insights are generated when you view the agent page');
        console.log('      Or you can trigger via: POST /api/v6/insights');
      } else {
        console.log(`\n   ✅ Found ${insights.length} insight(s):\n`);
        insights.forEach((insight, idx) => {
          const categoryLabel = insight.category === 'business_intelligence' ? '📊 Business' : '⚙️ Technical';
          const severityEmoji = {
            critical: '🔴',
            high: '🟠',
            medium: '🟡',
            low: '🟢'
          }[insight.severity] || '⚪';

          console.log(`   ${idx + 1}. ${categoryLabel} ${severityEmoji} ${insight.severity.toUpperCase()}`);
          console.log(`      ${insight.title}`);
          console.log(`      Type: ${insight.insight_type}`);
          console.log(`      Status: ${insight.status}`);
          console.log(`      Created: ${new Date(insight.created_at).toLocaleString()}`);
          console.log();
        });
      }
    } else {
      console.log(`   ⏳ Need ${7 - count} more execution(s) for business intelligence`);
      console.log(`      Current progress: ${count}/7`);
    }
  }

  // ========================================================================
  // Summary
  // ========================================================================
  console.log('\n' + '='.repeat(80));
  console.log('SUMMARY');
  console.log('='.repeat(80));

  const phase1Status = stepExecutions && stepExecutions.length > 0 && stepsWithoutCount.length === 0;
  const phase2Status = metrics !== null;
  const phase3Status = allMetrics && allMetrics.length >= 7;

  console.log(`\n✅ Phase 1 (Step Executions): ${phase1Status ? 'PASS' : 'FAIL'}`);
  console.log(`   - ${stepExecutions?.length || 0} steps recorded`);
  console.log(`   - ${stepsWithoutCount.length} missing item_count`);

  console.log(`\n${phase2Status ? '✅' : '❌'} Phase 2 (Execution Metrics): ${phase2Status ? 'PASS' : 'FAIL'}`);
  console.log(`   - Aggregated: ${metrics ? 'Yes' : 'No'}`);
  console.log(`   - Total items: ${metrics?.total_items || 0}`);

  console.log(`\n${phase3Status ? '✅' : '⏳'} Phase 3 (Business Intelligence): ${phase3Status ? 'READY' : 'NOT READY'}`);
  console.log(`   - ${allMetrics?.length || 0}/7 executions`);

  if (phase1Status && phase2Status && phase3Status) {
    console.log('\n🎉 All phases complete! Business intelligence system is fully operational.');
  } else if (phase1Status && phase2Status) {
    console.log(`\n⏳ Data collection working. Need ${7 - (allMetrics?.length || 0)} more runs for insights.`);
  } else {
    console.log('\n⚠️  Issues detected. Review errors above.');
  }

  console.log('\n' + '='.repeat(80));
}

const agentId = process.argv[2] || '408d16ab-fe92-46ac-8aa4-55b016dd42df';
verifyBusinessIntelligenceFlow(agentId)
  .then(() => process.exit(0))
  .catch(err => {
    console.error('Error:', err);
    process.exit(1);
  });
