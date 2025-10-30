// Quick verification of combined score calculation
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(supabaseUrl, supabaseServiceKey);

const COMBINED_WEIGHTS = {
  CREATION: 0.3,
  EXECUTION: 0.7,
};

async function verifyScores() {
  console.log('\n🔍 Verifying Combined Score Calculations\n');

  const { data: metrics, error } = await supabase
    .from('agent_intensity_metrics')
    .select('agent_id, creation_score, execution_score, combined_score')
    .not('creation_score', 'is', null)
    .not('execution_score', 'is', null)
    .limit(15);

  if (error || !metrics) {
    console.error('Error fetching metrics:', error);
    return;
  }

  console.log('Weight Configuration:');
  console.log(`  Creation Weight: ${COMBINED_WEIGHTS.CREATION * 100}%`);
  console.log(`  Execution Weight: ${COMBINED_WEIGHTS.EXECUTION * 100}%`);
  console.log();

  let allCorrect = true;
  let incorrectCount = 0;

  for (const metric of metrics) {
    const expectedCombined = (
      metric.creation_score * COMBINED_WEIGHTS.CREATION +
      metric.execution_score * COMBINED_WEIGHTS.EXECUTION
    );

    const difference = Math.abs(metric.combined_score - expectedCombined);
    const isCorrect = difference < 0.01; // Allow small floating point differences

    if (!isCorrect) {
      allCorrect = false;
      incorrectCount++;
      console.log(`❌ Agent ${metric.agent_id.slice(0, 8)}...`);
      console.log(`   Creation: ${metric.creation_score.toFixed(2)}`);
      console.log(`   Execution: ${metric.execution_score.toFixed(2)}`);
      console.log(`   Stored Combined: ${metric.combined_score.toFixed(2)}`);
      console.log(`   Expected Combined: ${expectedCombined.toFixed(2)}`);
      console.log(`   Difference: ${difference.toFixed(4)}`);
      console.log();
    } else {
      console.log(`✅ Agent ${metric.agent_id.slice(0, 8)}... | C:${metric.creation_score.toFixed(2)} E:${metric.execution_score.toFixed(2)} → Combined:${metric.combined_score.toFixed(2)} (${expectedCombined.toFixed(2)})`);
    }
  }

  console.log('\n' + '='.repeat(80));
  if (allCorrect) {
    console.log(`✅ All ${metrics.length} agents have correctly calculated combined scores!`);
  } else {
    console.log(`⚠️  ${incorrectCount} of ${metrics.length} agents have incorrect combined scores`);
  }
  console.log('='.repeat(80) + '\n');

  // Show the formula
  console.log('\n📐 Formula:');
  console.log(`   Combined = (Creation × ${COMBINED_WEIGHTS.CREATION}) + (Execution × ${COMBINED_WEIGHTS.EXECUTION})`);
  console.log('\n   Example:');
  console.log(`   If Creation = 2.70 and Execution = 3.32:`);
  const exampleCombined = (2.70 * COMBINED_WEIGHTS.CREATION) + (3.32 * COMBINED_WEIGHTS.EXECUTION);
  console.log(`   Combined = (2.70 × 0.3) + (3.32 × 0.7)`);
  console.log(`   Combined = 0.81 + 2.324`);
  console.log(`   Combined = ${exampleCombined.toFixed(2)}`);
  console.log();
}

verifyScores();
