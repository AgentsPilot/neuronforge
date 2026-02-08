/**
 * Backfill execution_metrics table from existing workflow_step_executions
 *
 * This script:
 * 1. Finds all agent_executions that don't have execution_metrics
 * 2. Queries workflow_step_executions for each
 * 3. Aggregates the data and creates execution_metrics records
 *
 * Run with: node backfill-execution-metrics.js [agentId]
 */

require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function backfillExecutionMetrics(agentId) {
  console.log('🔄 Backfilling execution_metrics for agent:', agentId);
  console.log('='.repeat(80));

  // Find all completed executions for this agent
  const { data: executions, error: execError } = await supabase
    .from('agent_executions')
    .select('id, started_at, completed_at, execution_duration_ms')
    .eq('agent_id', agentId)
    .eq('status', 'completed')
    .not('completed_at', 'is', null)
    .order('started_at', { ascending: false });

  if (execError) {
    console.error('❌ Error fetching executions:', execError);
    process.exit(1);
  }

  console.log(`\n📊 Found ${executions.length} completed execution(s)`);

  // Check which ones already have execution_metrics
  const { data: existingMetrics, error: metricsError } = await supabase
    .from('execution_metrics')
    .select('execution_id')
    .eq('agent_id', agentId);

  if (metricsError) {
    console.error('❌ Error fetching existing metrics:', metricsError);
    process.exit(1);
  }

  const existingIds = new Set(existingMetrics.map(m => m.execution_id));
  const missingExecutions = executions.filter(e => !existingIds.has(e.id));

  console.log(`   ${existingMetrics.length} already have execution_metrics`);
  console.log(`   ${missingExecutions.length} need backfilling`);

  if (missingExecutions.length === 0) {
    console.log('\n✅ All executions already have metrics. Nothing to backfill.');
    return;
  }

  console.log('\n' + '─'.repeat(80));
  console.log('BACKFILLING EXECUTION METRICS');
  console.log('─'.repeat(80));

  let successCount = 0;
  let skipCount = 0;
  let errorCount = 0;

  for (const execution of missingExecutions) {
    console.log(`\n📝 Processing execution: ${execution.id}`);
    console.log(`   Started: ${new Date(execution.started_at).toLocaleString()}`);

    try {
      // Query workflow_step_executions for this execution
      const { data: stepExecs, error: stepsError } = await supabase
        .from('workflow_step_executions')
        .select('step_id, step_name, plugin, action, item_count, status')
        .eq('workflow_execution_id', execution.id)
        .order('created_at', { ascending: true });

      if (stepsError) {
        console.log(`   ❌ Error fetching steps: ${stepsError.message}`);
        errorCount++;
        continue;
      }

      if (!stepExecs || stepExecs.length === 0) {
        console.log(`   ⏭️  No step executions found - skipping`);
        skipCount++;
        continue;
      }

      console.log(`   Found ${stepExecs.length} step execution(s)`);

      // Build execution_metrics
      const metrics = {
        execution_id: execution.id,
        agent_id: agentId,
        executed_at: execution.completed_at || execution.started_at,
        duration_ms: execution.execution_duration_ms || 0,
        total_items: 0,
        items_by_field: {},
        field_names: [],
        has_empty_results: false,
        failed_step_count: 0,
        step_metrics: [],
      };

      // Aggregate from step executions
      for (const stepExec of stepExecs) {
        // Count failed steps
        if (stepExec.status === 'failed') {
          metrics.failed_step_count++;
        }

        // Skip system steps and steps without item_count
        if (stepExec.plugin === 'system' || stepExec.item_count === null) {
          continue;
        }

        // Build step metric
        const stepMetric = {
          plugin: stepExec.plugin || 'unknown',
          action: stepExec.action || 'unknown',
          step_name: stepExec.step_name || stepExec.step_id,
          count: stepExec.item_count,
          fields: undefined,
        };

        metrics.step_metrics.push(stepMetric);

        // Aggregate total items
        metrics.total_items += stepExec.item_count;

        // Check for empty results
        if (stepExec.item_count === 0) {
          metrics.has_empty_results = true;
        }
      }

      console.log(`   Aggregated: ${metrics.total_items} items, ${metrics.step_metrics.length} step metrics`);

      // Insert into execution_metrics
      const { error: insertError } = await supabase
        .from('execution_metrics')
        .insert({
          execution_id: metrics.execution_id,
          agent_id: metrics.agent_id,
          executed_at: metrics.executed_at,
          duration_ms: metrics.duration_ms,
          total_items: metrics.total_items,
          items_by_field: metrics.items_by_field,
          field_names: metrics.field_names,
          has_empty_results: metrics.has_empty_results,
          failed_step_count: metrics.failed_step_count,
          step_metrics: metrics.step_metrics,
        });

      if (insertError) {
        console.log(`   ❌ Insert failed: ${insertError.message}`);
        errorCount++;
      } else {
        console.log(`   ✅ Created execution_metrics record`);
        successCount++;
      }

    } catch (error) {
      console.log(`   ❌ Error: ${error.message}`);
      errorCount++;
    }
  }

  // Summary
  console.log('\n' + '='.repeat(80));
  console.log('BACKFILL SUMMARY');
  console.log('='.repeat(80));
  console.log(`\n✅ Success: ${successCount}`);
  console.log(`⏭️  Skipped: ${skipCount} (no step data)`);
  console.log(`❌ Errors: ${errorCount}`);
  console.log(`📊 Total: ${missingExecutions.length}`);

  if (successCount > 0) {
    console.log(`\n🎉 Backfill complete! ${successCount} execution_metrics record(s) created.`);

    // Check if we now have enough for business intelligence
    const { data: allMetrics } = await supabase
      .from('execution_metrics')
      .select('id')
      .eq('agent_id', agentId);

    const totalCount = allMetrics?.length || 0;
    console.log(`\n📈 Total execution_metrics for agent: ${totalCount}`);
    console.log(`   Required for Business Intelligence: 7`);

    if (totalCount >= 7) {
      console.log(`\n✅ READY for business intelligence!`);
      console.log(`   You can now:`);
      console.log(`   1. View the agent page to see insights`);
      console.log(`   2. Call POST /api/v6/insights?agentId=${agentId}`);
      console.log(`   3. Run: node verify-business-intelligence-flow.js ${agentId}`);
    } else {
      console.log(`\n⏳ Need ${7 - totalCount} more execution(s) for business intelligence`);
    }
  }

  console.log('\n' + '='.repeat(80));
}

// Allow specific agent ID or backfill all agents
const agentId = process.argv[2];

if (!agentId) {
  console.error('❌ Error: Please provide an agent ID');
  console.error('Usage: node backfill-execution-metrics.js <agentId>');
  process.exit(1);
}

backfillExecutionMetrics(agentId)
  .then(() => process.exit(0))
  .catch(err => {
    console.error('Error:', err);
    process.exit(1);
  });
