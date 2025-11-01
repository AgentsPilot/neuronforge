// Debug creation score calculation for a specific agent
import { createClient } from '@supabase/supabase-js';
import { AISConfigService } from '@/lib/services/AISConfigService';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function debugAgent() {
  console.log('\n🔍 Debugging Creation Score Calculation\n');

  // Find an agent with creation_score around 2.1
  const { data: metrics, error } = await supabase
    .from('agent_intensity_metrics')
    .select('agent_id, creation_score, execution_score, combined_score, creation_workflow_score, creation_plugin_score, creation_io_score, creation_trigger_score')
    .gte('creation_score', 2.0)
    .lte('creation_score', 2.3)
    .limit(1);

  if (error || !metrics || metrics.length === 0) {
    console.error('No agents found with creation_score around 2.1');
    return;
  }

  const metric = metrics[0];
  console.log('Agent ID:', metric.agent_id);
  console.log('\n📊 Stored Scores in Database:');
  console.log(`  Creation Score: ${metric.creation_score.toFixed(2)}`);
  console.log(`  Execution Score: ${metric.execution_score.toFixed(2)}`);
  console.log(`  Combined Score: ${metric.combined_score.toFixed(2)}`);
  console.log('\n📏 Creation Dimensions (stored):');
  console.log(`  Workflow: ${metric.creation_workflow_score.toFixed(2)}`);
  console.log(`  Plugin: ${metric.creation_plugin_score.toFixed(2)}`);
  console.log(`  I/O: ${metric.creation_io_score.toFixed(2)}`);
  console.log(`  Trigger: ${metric.creation_trigger_score.toFixed(2)}`);

  // Recalculate creation score from stored dimensions
  const recalculated_from_stored = (
    metric.creation_workflow_score * 0.5 +
    metric.creation_plugin_score * 0.3 +
    metric.creation_io_score * 0.2 +
    metric.creation_trigger_score
  );

  console.log('\n🧮 Recalculation from Stored Dimensions:');
  console.log(`  (${metric.creation_workflow_score.toFixed(2)} × 0.5) + (${metric.creation_plugin_score.toFixed(2)} × 0.3) + (${metric.creation_io_score.toFixed(2)} × 0.2) + ${metric.creation_trigger_score.toFixed(2)}`);
  console.log(`  = ${recalculated_from_stored.toFixed(2)}`);

  const stored_vs_recalc_diff = Math.abs(metric.creation_score - recalculated_from_stored);
  if (stored_vs_recalc_diff > 0.01) {
    console.log(`  ⚠️  MISMATCH: Stored (${metric.creation_score.toFixed(2)}) vs Recalculated (${recalculated_from_stored.toFixed(2)})`);
  } else {
    console.log(`  ✅ Match: Stored creation_score matches recalculated from dimensions`);
  }

  // Now check combined score
  const expected_combined = (metric.creation_score * 0.3) + (metric.execution_score * 0.7);
  console.log('\n🎯 Combined Score Check:');
  console.log(`  Expected: (${metric.creation_score.toFixed(2)} × 0.3) + (${metric.execution_score.toFixed(2)} × 0.7) = ${expected_combined.toFixed(2)}`);
  console.log(`  Stored: ${metric.combined_score.toFixed(2)}`);

  const combined_diff = Math.abs(metric.combined_score - expected_combined);
  if (combined_diff > 0.01) {
    console.log(`  ❌ MISMATCH: Difference of ${combined_diff.toFixed(4)}`);
  } else {
    console.log(`  ✅ Match: Combined score is correct`);
  }

  // Fetch agent design data and recalculate from scratch
  const { data: agent, error: agentError } = await supabase
    .from('agents')
    .select('workflow_steps, connected_plugins, input_schema, output_schema, trigger_conditions')
    .eq('id', metric.agent_id)
    .single();

  if (!agentError && agent) {
    const workflowSteps = typeof agent.workflow_steps === 'string' ? JSON.parse(agent.workflow_steps) : (agent.workflow_steps || []);
    const connectedPlugins = typeof agent.connected_plugins === 'string' ? JSON.parse(agent.connected_plugins) : (agent.connected_plugins || []);
    const inputSchema = typeof agent.input_schema === 'string' ? JSON.parse(agent.input_schema) : (agent.input_schema || []);
    const outputSchema = typeof agent.output_schema === 'string' ? JSON.parse(agent.output_schema) : (agent.output_schema || []);
    const triggerConditions = typeof agent.trigger_conditions === 'string' ? JSON.parse(agent.trigger_conditions) : (agent.trigger_conditions || {});

    console.log('\n📋 Agent Design Data:');
    console.log(`  Workflow Steps: ${workflowSteps.length}`);
    console.log(`  Connected Plugins: ${connectedPlugins.length}`);
    console.log(`  Input Fields: ${inputSchema.length}`);
    console.log(`  Output Fields: ${outputSchema.length}`);
    console.log(`  Total I/O Fields: ${inputSchema.length + outputSchema.length}`);
    console.log(`  Trigger Type: ${triggerConditions.schedule_cron ? 'scheduled' : (triggerConditions.event_triggers?.length > 0 ? 'event-based' : 'on-demand')}`);

    // Recalculate using AISConfigService
    const ranges = await AISConfigService.getRanges(supabase);
    const freshWorkflowScore = AISConfigService.normalize(workflowSteps.length, ranges.creation_workflow_steps);
    const freshPluginScore = AISConfigService.normalize(connectedPlugins.length, ranges.creation_plugins);
    const freshIoScore = AISConfigService.normalize(inputSchema.length + outputSchema.length, ranges.creation_io_fields);
    let freshTriggerBonus = 0;
    if (triggerConditions.schedule_cron) freshTriggerBonus = 1;
    if (triggerConditions.event_triggers && triggerConditions.event_triggers.length > 0) freshTriggerBonus = 2;

    console.log('\n🆕 Fresh Calculation from Agent Design:');
    console.log(`  Workflow Score: ${freshWorkflowScore.toFixed(2)}`);
    console.log(`  Plugin Score: ${freshPluginScore.toFixed(2)}`);
    console.log(`  I/O Score: ${freshIoScore.toFixed(2)}`);
    console.log(`  Trigger Bonus: ${freshTriggerBonus.toFixed(2)}`);

    const fresh_creation_score = (
      freshWorkflowScore * 0.5 +
      freshPluginScore * 0.3 +
      freshIoScore * 0.2 +
      freshTriggerBonus
    );

    console.log(`  Fresh Creation Score: ${fresh_creation_score.toFixed(2)}`);

    const fresh_vs_stored_diff = Math.abs(fresh_creation_score - metric.creation_score);
    if (fresh_vs_stored_diff > 0.01) {
      console.log(`  ⚠️  MISMATCH: Fresh (${fresh_creation_score.toFixed(2)}) vs Stored (${metric.creation_score.toFixed(2)})`);
      console.log(`  This means the API route will show different dimension scores than what's stored!`);
    } else {
      console.log(`  ✅ Match: Fresh calculation matches stored value`);
    }
  }

  console.log('\n');
}

debugAgent();
