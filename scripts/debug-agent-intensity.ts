#!/usr/bin/env tsx
// Debug script to check agent intensity metrics

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const supabase = createClient(supabaseUrl, supabaseServiceKey);

const agentId = '38469634-354d-4655-ac0b-5c446112430d';

async function debugAgent() {
  const { data, error } = await supabase
    .from('agent_intensity_metrics')
    .select('*')
    .eq('agent_id', agentId)
    .single();

  if (error) {
    console.error('Error:', error);
    return;
  }

  console.log('\n=== Agent Intensity Metrics ===\n');
  console.log('Agent ID:', agentId);
  console.log('\n--- Three Scores ---');
  console.log('Creation Score:', data.creation_score);
  console.log('Execution Score:', data.execution_score);
  console.log('Combined Score:', data.combined_score);
  console.log('Intensity Score (deprecated):', data.intensity_score);

  console.log('\n--- Creation Components ---');
  console.log('Creation Complexity Score:', data.creation_complexity_score);
  console.log('Creation Token Efficiency Score:', data.creation_token_efficiency_score);
  console.log('Creation Tokens Used:', data.creation_tokens_used);

  console.log('\n--- Execution Components ---');
  console.log('Token Complexity Score:', data.token_complexity_score);
  console.log('Execution Complexity Score:', data.execution_complexity_score);
  console.log('Plugin Complexity Score:', data.plugin_complexity_score);
  console.log('Workflow Complexity Score:', data.workflow_complexity_score);

  console.log('\n--- Expected Calculation ---');
  const expectedCreation = (data.creation_complexity_score * 0.5) + (data.creation_token_efficiency_score * 0.5);
  console.log('Expected Creation Score:', expectedCreation.toFixed(2));

  const expectedExecution = (
    data.token_complexity_score * 0.35 +
    data.execution_complexity_score * 0.25 +
    data.plugin_complexity_score * 0.25 +
    data.workflow_complexity_score * 0.15
  );
  console.log('Expected Execution Score:', expectedExecution.toFixed(2));

  const expectedCombined = (expectedCreation * 0.3) + (expectedExecution * 0.7);
  console.log('Expected Combined Score:', expectedCombined.toFixed(2));

  console.log('\n--- Mismatch Check ---');
  if (Math.abs(data.creation_score - expectedCreation) > 0.01) {
    console.log('⚠️  MISMATCH: Creation score in DB does not match calculated value!');
  }
  if (Math.abs(data.execution_score - expectedExecution) > 0.01) {
    console.log('⚠️  MISMATCH: Execution score in DB does not match calculated value!');
  }
  if (Math.abs(data.combined_score - expectedCombined) > 0.01) {
    console.log('⚠️  MISMATCH: Combined score in DB does not match calculated value!');
  }
}

debugAgent().catch(console.error);
