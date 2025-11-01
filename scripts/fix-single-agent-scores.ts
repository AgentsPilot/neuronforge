#!/usr/bin/env tsx
// Fix creation scores for a single agent

import { createClient } from '@supabase/supabase-js';
import { CREATION_WEIGHTS } from '@/lib/types/intensity';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const supabase = createClient(supabaseUrl, supabaseServiceKey);

const agentId = '38469634-354d-4655-ac0b-5c446112430d';

function normalizeToScale(value: number, inMin: number, inMax: number, outMin: number, outMax: number): number {
  const clamped = Math.max(inMin, Math.min(inMax, value));
  return outMin + ((clamped - inMin) * (outMax - outMin)) / (inMax - inMin);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

async function fixAgent() {
  console.log(`\n🔧 Fixing creation scores for agent ${agentId}...\n`);

  // Get current metrics
  const { data: metrics, error: fetchError } = await supabase
    .from('agent_intensity_metrics')
    .select('*')
    .eq('agent_id', agentId)
    .single();

  if (fetchError || !metrics) {
    console.error('❌ Error fetching metrics:', fetchError);
    return;
  }

  console.log('Current values:');
  console.log('  Creation Tokens Used:', metrics.creation_tokens_used);
  console.log('  Creation Score:', metrics.creation_score);
  console.log('  Creation Complexity Score:', metrics.creation_complexity_score);
  console.log('  Creation Token Efficiency Score:', metrics.creation_token_efficiency_score);

  // Recalculate creation scores
  const creationTokens = metrics.creation_tokens_used;

  // Creation complexity: based on token volume (0-10000 range)
  const creation_complexity_score = clamp(
    normalizeToScale(creationTokens, 0, 10000, 0, 10),
    0,
    10
  );

  // Creation efficiency: based on tokens per phase (assume 4 phases)
  // Lower tokens per phase = higher efficiency = higher score (inverted)
  const avgTokensPerPhase = creationTokens / 4;
  const creation_token_efficiency_score = clamp(
    normalizeToScale(avgTokensPerPhase, 0, 5000, 10, 0),
    0,
    10
  );

  // Calculate weighted creation score
  const creation_score = clamp(
    (creation_complexity_score * CREATION_WEIGHTS.CREATION_COMPLEXITY +
      creation_token_efficiency_score * CREATION_WEIGHTS.CREATION_EFFICIENCY),
    0,
    10
  );

  console.log('\nRecalculated values:');
  console.log('  Creation Complexity Score:', creation_complexity_score.toFixed(2));
  console.log('  Creation Token Efficiency Score:', creation_token_efficiency_score.toFixed(2));
  console.log('  Creation Score:', creation_score.toFixed(2));

  // Update database
  const { error: updateError } = await supabase
    .from('agent_intensity_metrics')
    .update({
      creation_score,
      creation_complexity_score,
      creation_token_efficiency_score,
      updated_at: new Date().toISOString(),
    })
    .eq('agent_id', agentId);

  if (updateError) {
    console.error('\n❌ Error updating:', updateError);
    return;
  }

  // Recalculate combined score (creation 30% + execution 70%)
  const execution_score = (
    metrics.token_complexity_score * 0.35 +
    metrics.execution_complexity_score * 0.25 +
    metrics.plugin_complexity_score * 0.25 +
    metrics.workflow_complexity_score * 0.15
  );

  const combined_score = (creation_score * 0.3) + (execution_score * 0.7);

  console.log('\nRecalculated combined score:');
  console.log('  Execution Score:', execution_score.toFixed(2));
  console.log('  Combined Score:', combined_score.toFixed(2));

  // Update combined score
  const { error: combinedUpdateError } = await supabase
    .from('agent_intensity_metrics')
    .update({
      execution_score,
      combined_score,
      intensity_score: combined_score, // Keep deprecated field in sync
      updated_at: new Date().toISOString(),
    })
    .eq('agent_id', agentId);

  if (combinedUpdateError) {
    console.error('\n❌ Error updating combined score:', combinedUpdateError);
    return;
  }

  console.log('\n✅ Agent scores updated successfully!');
  console.log('\nFinal scores:');
  console.log(`  Creation: ${creation_score.toFixed(2)}/10`);
  console.log(`  Execution: ${execution_score.toFixed(2)}/10`);
  console.log(`  Combined: ${combined_score.toFixed(2)}/10`);
}

fixAgent().catch(console.error);
