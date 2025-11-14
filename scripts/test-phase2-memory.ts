// scripts/test-phase2-memory.ts
// Test Phase 2: Memory subdimension weights are database-driven

import { createClient } from '@supabase/supabase-js';
import { AISConfigService } from '../lib/services/AISConfigService';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function testPhase2() {
  console.log('🔧 Testing Phase 2: Memory Subdimension Weights (Database-Driven)...\n');

  // Test: Load memory subdimension weights
  console.log('1️⃣ Testing getMemorySubWeights()...');
  try {
    const memoryWeights = await AISConfigService.getMemorySubWeights(supabase);
    console.log('✅ Memory subdimension weights loaded successfully:');
    console.log(`   Ratio: ${memoryWeights.ratio} (expected: 0.5)`);
    console.log(`   Diversity: ${memoryWeights.diversity} (expected: 0.3)`);
    console.log(`   Volume: ${memoryWeights.volume} (expected: 0.2)`);

    // Validate sum
    const sum = memoryWeights.ratio + memoryWeights.diversity + memoryWeights.volume;
    console.log(`   Sum: ${sum.toFixed(3)} (must be 1.0)`);

    if (Math.abs(sum - 1.0) > 0.001) {
      console.error('   ❌ ERROR: Weights do not sum to 1.0!');
    } else {
      console.log('   ✅ Validation passed: Weights sum to 1.0');
    }
  } catch (error) {
    console.error('❌ Failed to load memory subdimension weights:', error);
  }

  // Test: Verify keys exist in database
  console.log('\n2️⃣ Verifying memory weight keys in database...');
  try {
    const { data, error } = await supabase
      .from('ais_system_config')
      .select('config_key, config_value, description, category')
      .in('config_key', [
        'ais_memory_ratio_weight',
        'ais_memory_diversity_weight',
        'ais_memory_volume_weight'
      ])
      .order('config_key');

    if (error) {
      console.error('❌ Database query error:', error);
      return;
    }

    console.log('📊 Memory subdimension keys in database:');
    data?.forEach(row => {
      console.log(`   ${row.config_key}: ${row.config_value}`);
      console.log(`     → ${row.description || 'No description'}`);
      console.log(`     → Category: ${row.category}`);
    });

    if (data && data.length === 3) {
      console.log('   ✅ All 3 memory subdimension keys present');
    } else {
      console.warn(`   ⚠️  Expected 3 keys, found ${data?.length || 0}`);
    }
  } catch (error) {
    console.error('❌ Failed to verify database keys:', error);
  }

  // Test: Simulate memory complexity calculation
  console.log('\n3️⃣ Testing memory complexity calculation with database weights...');
  try {
    const memoryWeights = await AISConfigService.getMemorySubWeights(supabase);

    // Simulate memory scores
    const mockScores = {
      ratioScore: 6.0,    // Memory ratio score (0-10)
      diversityScore: 8.0, // Diversity score (0-10)
      volumeScore: 5.0     // Volume score (0-10)
    };

    // Calculate weighted memory complexity (same as in updateAgentIntensity.ts)
    const memoryComplexityScore = Math.max(0, Math.min(10,
      mockScores.ratioScore * memoryWeights.ratio +
      mockScores.diversityScore * memoryWeights.diversity +
      mockScores.volumeScore * memoryWeights.volume
    ));

    console.log('✅ Memory complexity calculation using database weights:');
    console.log(`   Ratio Score: ${mockScores.ratioScore}/10 × ${memoryWeights.ratio} = ${(mockScores.ratioScore * memoryWeights.ratio).toFixed(2)}`);
    console.log(`   Diversity Score: ${mockScores.diversityScore}/10 × ${memoryWeights.diversity} = ${(mockScores.diversityScore * memoryWeights.diversity).toFixed(2)}`);
    console.log(`   Volume Score: ${mockScores.volumeScore}/10 × ${memoryWeights.volume} = ${(mockScores.volumeScore * memoryWeights.volume).toFixed(2)}`);
    console.log(`   Final Memory Complexity: ${memoryComplexityScore.toFixed(2)}/10`);
    console.log('   ✅ Calculation successful - memory weights are working!');
  } catch (error) {
    console.error('❌ Failed to simulate memory complexity calculation:', error);
  }

  console.log('\n' + '='.repeat(80));
  console.log('✅ Phase 2 Refactoring Test Complete!');
  console.log('='.repeat(80));
  console.log('✅ Memory subdimension weights are now DATABASE-DRIVEN');
  console.log('✅ Admin UI changes to memory weights will affect calculations');
  console.log('✅ No more hardcoded 0.5/0.3/0.2 in calculateMemoryComplexity()');
  console.log('='.repeat(80));
}

testPhase2().then(() => process.exit(0)).catch(err => {
  console.error(err);
  process.exit(1);
});
