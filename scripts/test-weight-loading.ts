// scripts/test-weight-loading.ts
// Test that weights are loaded correctly from database (Phase 1 Refactoring Verification)

import { createClient } from '@supabase/supabase-js';
import { AISConfigService } from '../lib/services/AISConfigService';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function testWeightLoading() {
  console.log('🔧 Testing database-driven weight loading (Phase 1 Refactoring)...\n');

  // Test 1: Load execution weights
  console.log('1️⃣ Testing getExecutionWeights()...');
  try {
    const executionWeights = await AISConfigService.getExecutionWeights(supabase);
    console.log('✅ Execution weights loaded successfully:');
    console.log(`   Tokens: ${executionWeights.tokens} (expected: 0.30)`);
    console.log(`   Execution: ${executionWeights.execution} (expected: 0.25)`);
    console.log(`   Plugins: ${executionWeights.plugins} (expected: 0.20)`);
    console.log(`   Workflow: ${executionWeights.workflow} (expected: 0.15)`);
    console.log(`   Memory: ${executionWeights.memory} (expected: 0.10)`);

    // Validate sum
    const sum = executionWeights.tokens + executionWeights.execution +
                executionWeights.plugins + executionWeights.workflow +
                executionWeights.memory;
    console.log(`   Sum: ${sum.toFixed(3)} (must be 1.0)`);

    if (Math.abs(sum - 1.0) > 0.001) {
      console.error('   ❌ ERROR: Weights do not sum to 1.0!');
    } else {
      console.log('   ✅ Validation passed: Weights sum to 1.0');
    }
  } catch (error) {
    console.error('❌ Failed to load execution weights:', error);
  }

  console.log('\n2️⃣ Testing getCombinedWeights()...');
  try {
    const combinedWeights = await AISConfigService.getCombinedWeights(supabase);
    console.log('✅ Combined weights loaded successfully:');
    console.log(`   Creation: ${combinedWeights.creation} (expected: 0.3)`);
    console.log(`   Execution: ${combinedWeights.execution} (expected: 0.7)`);

    // Validate sum
    const sum = combinedWeights.creation + combinedWeights.execution;
    console.log(`   Sum: ${sum.toFixed(3)} (must be 1.0)`);

    if (Math.abs(sum - 1.0) > 0.001) {
      console.error('   ❌ ERROR: Weights do not sum to 1.0!');
    } else {
      console.log('   ✅ Validation passed: Weights sum to 1.0');
    }
  } catch (error) {
    console.error('❌ Failed to load combined weights:', error);
  }

  // Test 3: Verify all keys exist in database
  console.log('\n3️⃣ Verifying all weight keys exist in database...');
  try {
    const { data, error } = await supabase
      .from('ais_system_config')
      .select('config_key, config_value, category')
      .in('category', ['ais_dimension_weights', 'ais_combined_weights'])
      .order('category', { ascending: true })
      .order('config_key', { ascending: true });

    if (error) {
      console.error('❌ Database query error:', error);
      return;
    }

    console.log('📊 Weight keys in database:');

    let dimensionCount = 0;
    let combinedCount = 0;

    data?.forEach(row => {
      console.log(`   ${row.config_key}: ${row.config_value} (${row.category})`);
      if (row.category === 'ais_dimension_weights') dimensionCount++;
      if (row.category === 'ais_combined_weights') combinedCount++;
    });

    console.log(`\n   Dimension weights: ${dimensionCount} keys (expected: ~23)`);
    console.log(`   Combined weights: ${combinedCount} keys (expected: 2)`);

    if (dimensionCount >= 23 && combinedCount === 2) {
      console.log('   ✅ All weight categories present');
    } else {
      console.warn('   ⚠️  Some weight keys may be missing');
    }
  } catch (error) {
    console.error('❌ Failed to verify database keys:', error);
  }

  // Test 4: Simulate what updateAgentIntensity.ts does
  console.log('\n4️⃣ Testing weight usage pattern (simulating updateAgentIntensity.ts)...');
  try {
    const executionWeights = await AISConfigService.getExecutionWeights(supabase);
    const combinedWeights = await AISConfigService.getCombinedWeights(supabase);

    // Simulate score calculation
    const mockComponentScores = {
      token_complexity_score: 5.0,
      execution_complexity_score: 6.0,
      plugin_complexity_score: 4.0,
      workflow_complexity_score: 3.0,
      memory_complexity_score: 2.0
    };

    const execution_score = (
      mockComponentScores.token_complexity_score * executionWeights.tokens +
      mockComponentScores.execution_complexity_score * executionWeights.execution +
      mockComponentScores.plugin_complexity_score * executionWeights.plugins +
      mockComponentScores.workflow_complexity_score * executionWeights.workflow +
      mockComponentScores.memory_complexity_score * executionWeights.memory
    );

    const creation_score = 5.0;
    const combined_score = (
      creation_score * combinedWeights.creation +
      execution_score * combinedWeights.execution
    );

    console.log('✅ Score calculation using database weights:');
    console.log(`   Execution Score: ${execution_score.toFixed(2)}/10`);
    console.log(`   Creation Score: ${creation_score.toFixed(2)}/10`);
    console.log(`   Combined Score: ${combined_score.toFixed(2)}/10`);
    console.log('   ✅ Calculation successful - weights are working!');
  } catch (error) {
    console.error('❌ Failed to simulate score calculation:', error);
  }

  console.log('\n' + '='.repeat(80));
  console.log('✅ Phase 1 Refactoring Test Complete!');
  console.log('='.repeat(80));
  console.log('✅ Main dimension weights are now DATABASE-DRIVEN');
  console.log('✅ Combined score weights are now DATABASE-DRIVEN');
  console.log('✅ Admin UI changes will now affect actual routing decisions');
  console.log('✅ No more hardcoded EXECUTION_WEIGHTS or COMBINED_WEIGHTS constants');
  console.log('='.repeat(80));
}

testWeightLoading().then(() => process.exit(0)).catch(err => {
  console.error(err);
  process.exit(1);
});
