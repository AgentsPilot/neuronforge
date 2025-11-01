#!/usr/bin/env tsx
// scripts/backfill-three-score-system.ts
// Backfill script to populate creation_score, execution_score, and combined_score for existing agents

import { createClient } from '@supabase/supabase-js';
import { EXECUTION_WEIGHTS, COMBINED_WEIGHTS } from '@/lib/types/intensity';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('❌ Missing environment variables');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

interface MetricsRow {
  id: string;
  agent_id: string;
  // Three scores (may be null for old records)
  creation_score: number | null;
  execution_score: number | null;
  combined_score: number | null;
  intensity_score: number;

  // Creation component scores
  creation_complexity_score: number | null;
  creation_token_efficiency_score: number | null;

  // Execution component scores
  token_complexity_score: number;
  execution_complexity_score: number;
  plugin_complexity_score: number;
  workflow_complexity_score: number;

  // Creation data
  creation_tokens_used: number | null;
}

async function backfillThreeScoreSystem() {
  console.log('🚀 Starting three-score system backfill...\n');

  // 1. Fetch all agent_intensity_metrics records
  const { data: metrics, error: fetchError } = await supabase
    .from('agent_intensity_metrics')
    .select('*');

  if (fetchError) {
    console.error('❌ Error fetching metrics:', fetchError);
    return;
  }

  if (!metrics || metrics.length === 0) {
    console.log('✅ No metrics found to backfill');
    return;
  }

  console.log(`📊 Found ${metrics.length} metrics records to process\n`);

  let updatedCount = 0;
  let skippedCount = 0;
  let errorCount = 0;

  for (const metric of metrics as MetricsRow[]) {
    try {
      // FORCE RECALCULATION for all agents since we changed the formula
      // Old formula was based on tokens (wrong), new formula is based on design complexity (correct)

      console.log(`\n📝 Processing agent ${metric.agent_id}...`);

      // === CALCULATE CREATION SCORE ===
      // Fetch agent design to calculate complexity
      const { data: agent } = await supabase
        .from('agents')
        .select('workflow_steps, input_schema, output_schema, connected_plugins, trigger_conditions, system_prompt')
        .eq('id', metric.agent_id)
        .single();

      let creation_score: number;
      let creation_complexity_score: number;
      let creation_token_efficiency_score: number;

      if (!agent) {
        // Can't fetch agent data - use default
        creation_score = 5.0;
        creation_complexity_score = 5.0;
        creation_token_efficiency_score = 5.0;
      } else {
        // Parse agent configuration (handle both string and object types from Supabase)
        const workflowSteps = typeof agent.workflow_steps === 'string'
          ? JSON.parse(agent.workflow_steps)
          : (agent.workflow_steps || []);
        const inputSchema = typeof agent.input_schema === 'string'
          ? JSON.parse(agent.input_schema)
          : (agent.input_schema || []);
        const outputSchema = typeof agent.output_schema === 'string'
          ? JSON.parse(agent.output_schema)
          : (agent.output_schema || []);
        const connectedPlugins = typeof agent.connected_plugins === 'string'
          ? JSON.parse(agent.connected_plugins)
          : (agent.connected_plugins || []);
        const triggerConditions = typeof agent.trigger_conditions === 'string'
          ? JSON.parse(agent.trigger_conditions)
          : (agent.trigger_conditions || {});

        // === CREATION SCORE ===
        // Based ONLY on agent design complexity
        // Simple agents (1-3) → Medium (4-6) → Complex (7-10)

        // Workflow complexity (1-9)
        const workflowScore = normalizeToScale(workflowSteps.length, 1, 10, 1, 9);

        // Plugin diversity (1-10)
        const pluginScore = normalizeToScale(connectedPlugins.length, 1, 5, 1, 10);

        // I/O Schema complexity (1-10)
        const ioFieldCount = inputSchema.length + outputSchema.length;
        const ioScore = normalizeToScale(ioFieldCount, 1, 8, 1, 10);

        // Trigger bonus (+0/+1/+2)
        let triggerBonus = 0;
        if (triggerConditions.schedule_cron) triggerBonus = 1;
        if (triggerConditions.event_triggers) triggerBonus = 2;

        const baseComplexity = (
          workflowScore * 0.5 +
          pluginScore * 0.3 +
          ioScore * 0.2
        );

        creation_complexity_score = clamp(Math.min(10, baseComplexity + triggerBonus), 0, 10);

        // Set efficiency dummy to same score for backward compatibility
        creation_token_efficiency_score = creation_complexity_score;

        // Calculate creation score (both components are now the same)
        creation_score = creation_complexity_score;
      }

      // === CALCULATE EXECUTION SCORE ===
      const execution_score = (
        metric.token_complexity_score * EXECUTION_WEIGHTS.TOKEN_COMPLEXITY +
        metric.execution_complexity_score * EXECUTION_WEIGHTS.EXECUTION_COMPLEXITY +
        metric.plugin_complexity_score * EXECUTION_WEIGHTS.PLUGIN_COMPLEXITY +
        metric.workflow_complexity_score * EXECUTION_WEIGHTS.WORKFLOW_COMPLEXITY
      );

      // === CALCULATE COMBINED SCORE ===
      const combined_score = (
        creation_score * COMBINED_WEIGHTS.CREATION +
        execution_score * COMBINED_WEIGHTS.EXECUTION
      );

      console.log(`   Creation: ${creation_score.toFixed(2)} (complexity: ${creation_complexity_score.toFixed(2)}, efficiency: ${creation_token_efficiency_score.toFixed(2)})`);
      console.log(`   Execution: ${execution_score.toFixed(2)}`);
      console.log(`   Combined: ${combined_score.toFixed(2)}`);

      // === UPDATE DATABASE ===
      const { error: updateError } = await supabase
        .from('agent_intensity_metrics')
        .update({
          creation_score,
          execution_score,
          combined_score,
          intensity_score: combined_score, // Sync deprecated field
          creation_complexity_score,
          creation_token_efficiency_score,
          updated_at: new Date().toISOString(),
        })
        .eq('id', metric.id);

      if (updateError) {
        console.error(`   ❌ Error updating agent ${metric.agent_id}:`, updateError.message);
        errorCount++;
      } else {
        console.log(`   ✅ Updated successfully`);
        updatedCount++;
      }

    } catch (error) {
      console.error(`   ❌ Exception processing agent ${metric.agent_id}:`, error);
      errorCount++;
    }
  }

  // === SUMMARY ===
  console.log('\n' + '='.repeat(60));
  console.log('📊 BACKFILL SUMMARY');
  console.log('='.repeat(60));
  console.log(`✅ Updated: ${updatedCount}`);
  console.log(`⏭️  Skipped (already had scores): ${skippedCount}`);
  console.log(`❌ Errors: ${errorCount}`);
  console.log(`📈 Total processed: ${metrics.length}`);
  console.log('='.repeat(60));
}

// Helper functions
function normalizeToScale(value: number, inMin: number, inMax: number, outMin: number, outMax: number): number {
  const clamped = Math.max(inMin, Math.min(inMax, value));
  return outMin + ((clamped - inMin) * (outMax - outMin)) / (inMax - inMin);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

// Run the backfill
backfillThreeScoreSystem()
  .then(() => {
    console.log('\n✅ Backfill completed');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Backfill failed:', error);
    process.exit(1);
  });
