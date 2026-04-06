/**
 * Debug latest execution to see where data collection failed
 * Run with: node debug-latest-execution.js [agentId]
 */

require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function debugLatestExecution(agentId) {
  console.log('🔍 Debugging latest execution for agent:', agentId);
  console.log('='.repeat(80));

  // Get latest execution from agent_executions
  const { data: execution, error: execError } = await supabase
    .from('agent_executions')
    .select('id, started_at, completed_at, status')
    .eq('agent_id', agentId)
    .order('started_at', { ascending: false })
    .limit(1)
    .single();

  if (execError || !execution) {
    console.error('❌ No execution found:', execError);
    process.exit(1);
  }

  console.log(`\n✅ Latest Execution ID: ${execution.id}`);
  console.log(`   Started: ${new Date(execution.started_at).toLocaleString()}`);
  console.log(`   Completed: ${execution.completed_at ? new Date(execution.completed_at).toLocaleString() : 'N/A'}`);
  console.log(`   Status: ${execution.status}`);

  // Check workflow_step_executions
  console.log('\n' + '─'.repeat(80));
  console.log('STEP 1: Check workflow_step_executions (StepExecutor output)');
  console.log('─'.repeat(80));

  const { data: stepExecs, error: stepsError } = await supabase
    .from('workflow_step_executions')
    .select('*')
    .eq('workflow_execution_id', execution.id)
    .order('created_at', { ascending: true });

  if (stepsError) {
    console.error('\n❌ Error fetching step executions:', stepsError);
  } else if (!stepExecs || stepExecs.length === 0) {
    console.log('\n❌ No step executions found in workflow_step_executions table');
    console.log('   This means StepExecutor is not creating records');
  } else {
    console.log(`\n✅ Found ${stepExecs.length} step execution(s)\n`);

    stepExecs.forEach((step, idx) => {
      console.log(`Step ${idx + 1}: ${step.step_name || step.step_id}`);
      console.log(`   ID: ${step.id}`);
      console.log(`   Plugin: ${step.plugin || 'N/A'}`);
      console.log(`   Action: ${step.action || 'N/A'}`);
      console.log(`   Status: ${step.status}`);
      console.log(`   Item Count: ${step.item_count !== null ? step.item_count : '❌ NULL'}`);
      console.log(`   Execution Time: ${step.execution_time_ms || 0}ms`);
      console.log(`   Tokens Used: ${step.tokens_used || 0}`);

      if (step.execution_metadata) {
        const meta = step.execution_metadata;
        console.log(`   Metadata Keys: ${Object.keys(meta).join(', ')}`);
        if (meta.itemCount !== undefined) {
          console.log(`   Metadata.itemCount: ${meta.itemCount}`);
        }
      }
      console.log();
    });

    // Check if any have NULL item_count
    const nullCounts = stepExecs.filter(s => s.item_count === null);
    if (nullCounts.length > 0) {
      console.log(`⚠️  WARNING: ${nullCounts.length} step(s) have NULL item_count`);
      console.log('   This means StateManager.updateStepExecution() did not receive itemCount\n');
    }
  }

  // Check execution_metrics
  console.log('─'.repeat(80));
  console.log('STEP 2: Check execution_metrics (MetricsCollector output)');
  console.log('─'.repeat(80));

  const { data: metrics, error: metricsError } = await supabase
    .from('execution_metrics')
    .select('*')
    .eq('execution_id', execution.id)
    .single();

  if (metricsError || !metrics) {
    console.log('\n❌ No execution_metrics record found');
    console.log('   This means MetricsCollector.collectMetrics() was not called or failed');
    console.log(`   Error: ${metricsError?.message || 'Not found'}`);

    // Check if workflow_executions was updated
    const { data: workflowExec } = await supabase
      .from('workflow_executions')
      .select('status, completed_at')
      .eq('id', execution.id)
      .single();

    if (workflowExec) {
      console.log(`\n   Workflow Execution Status: ${workflowExec.status}`);
      console.log(`   Completed At: ${workflowExec.completed_at || 'N/A'}`);

      if (workflowExec.status !== 'completed') {
        console.log('\n   ⚠️  Execution did not complete successfully');
        console.log('      MetricsCollector only runs after successful completion');
      }
    }
  } else {
    console.log('\n✅ Found execution_metrics record\n');
    console.log(`   Total Items: ${metrics.total_items}`);
    console.log(`   Duration: ${metrics.duration_ms}ms`);
    console.log(`   Empty Results: ${metrics.has_empty_results}`);
    console.log(`   Failed Steps: ${metrics.failed_step_count}`);

    if (metrics.step_metrics && Array.isArray(metrics.step_metrics)) {
      console.log(`\n   Step Metrics (${metrics.step_metrics.length}):`);
      metrics.step_metrics.forEach((sm, idx) => {
        console.log(`   ${idx + 1}. ${sm.step_name || 'Unknown'}: count=${sm.count}, plugin=${sm.plugin}, action=${sm.action}`);
      });
    } else {
      console.log('\n   ⚠️  No step_metrics array');
    }
  }

  // Summary
  console.log('\n' + '='.repeat(80));
  console.log('DIAGNOSIS');
  console.log('='.repeat(80));

  const hasStepExecs = stepExecs && stepExecs.length > 0;
  const hasItemCounts = stepExecs && stepExecs.some(s => s.item_count !== null && s.item_count > 0);
  const hasMetrics = metrics !== null;

  console.log(`\n${hasStepExecs ? '✅' : '❌'} Step Executions Created: ${hasStepExecs ? 'Yes' : 'No'}`);
  console.log(`${hasItemCounts ? '✅' : '❌'} Item Counts Stored: ${hasItemCounts ? 'Yes' : 'No'}`);
  console.log(`${hasMetrics ? '✅' : '❌'} Execution Metrics Created: ${hasMetrics ? 'Yes' : 'No'}`);

  if (!hasStepExecs) {
    console.log('\n🔧 Fix: StepExecutor is not calling StateManager.logStepExecution()');
  } else if (!hasItemCounts) {
    console.log('\n🔧 Fix: StepExecutor.calculateItemCount() or StateManager.updateStepExecution() issue');
    console.log('   - Check that itemCount is being calculated');
    console.log('   - Check that it\'s being passed to StateManager');
  } else if (!hasMetrics) {
    console.log('\n🔧 Fix: MetricsCollector.collectMetrics() not being called or failing');
    console.log('   - Check StateManager.finalizeExecution() calls MetricsCollector');
    console.log('   - Check for errors in MetricsCollector logs');
  } else {
    console.log('\n✅ Everything looks good! Data is being collected correctly.');
  }

  console.log('\n' + '='.repeat(80));
}

const agentId = process.argv[2] || '408d16ab-fe92-46ac-8aa4-55b016dd42df';
debugLatestExecution(agentId)
  .then(() => process.exit(0))
  .catch(err => {
    console.error('Error:', err);
    process.exit(1);
  });
