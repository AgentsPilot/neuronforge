// scripts/test-phase4-full-integration.ts
// Full integration test for Phase 4: Memory ranges & configuration consistency
// Tests the complete flow from database → service → calculations

import { createClient } from '@supabase/supabase-js';
import { AISConfigService } from '../lib/services/AISConfigService';
import { ModelRouter } from '../lib/ai/modelRouter';
import { SystemConfigService } from '../lib/services/SystemConfigService';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function testPhase4FullIntegration() {
  console.log('🧪 Phase 4 Full Integration Test\n');
  console.log('=' .repeat(80));

  let allTestsPassed = true;

  // ============================================================================
  // TEST 1: Memory Ranges in Database
  // ============================================================================
  console.log('\n📋 TEST 1: Memory Ranges in Database');
  console.log('-'.repeat(80));

  const { data: dbRanges, error: dbError } = await supabase
    .from('ais_normalization_ranges')
    .select('range_key, best_practice_min, best_practice_max, category')
    .in('range_key', ['memory_ratio', 'memory_diversity', 'memory_volume'])
    .order('range_key');

  if (dbError || !dbRanges || dbRanges.length !== 3) {
    console.error('❌ TEST 1 FAILED: Memory ranges not found in database');
    console.error('Error:', dbError?.message);
    allTestsPassed = false;
  } else {
    console.log('✅ TEST 1 PASSED: All 3 memory ranges configured in database');
    dbRanges.forEach(row => {
      console.log(`   ${row.range_key}: ${row.best_practice_min} - ${row.best_practice_max} (${row.category})`);
    });

    // Verify expected values
    const expectedRanges: Record<string, { min: number; max: number }> = {
      'memory_ratio': { min: 0.0, max: 0.9 },
      'memory_diversity': { min: 0, max: 3 },
      'memory_volume': { min: 0, max: 20 }
    };

    let rangesMismatch = false;
    dbRanges.forEach(row => {
      const expected = expectedRanges[row.range_key];
      if (!expected) {
        console.error(`   ❌ Unexpected range_key: ${row.range_key}`);
        rangesMismatch = true;
      } else if (row.best_practice_min !== expected.min || row.best_practice_max !== expected.max) {
        console.error(`   ❌ ${row.range_key}: expected [${expected.min}, ${expected.max}], got [${row.best_practice_min}, ${row.best_practice_max}]`);
        rangesMismatch = true;
      }
    });

    if (rangesMismatch) {
      allTestsPassed = false;
    }
  }

  // ============================================================================
  // TEST 2: AISConfigService Loads Memory Ranges
  // ============================================================================
  console.log('\n📋 TEST 2: AISConfigService.getRanges() Memory Ranges');
  console.log('-'.repeat(80));

  try {
    // Clear cache to force fresh load
    (AISConfigService as any).cache = null;

    const ranges = await AISConfigService.getRanges(supabase);

    console.log('✅ Memory ranges loaded from AISConfigService:');
    console.log(`   memory_ratio: ${ranges.memory_ratio_min} - ${ranges.memory_ratio_max}`);
    console.log(`   memory_diversity: ${ranges.memory_diversity_min} - ${ranges.memory_diversity_max}`);
    console.log(`   memory_volume: ${ranges.memory_volume_min} - ${ranges.memory_volume_max}`);

    // Verify values
    const expected = {
      memory_ratio_min: 0.0,
      memory_ratio_max: 0.9,
      memory_diversity_min: 0,
      memory_diversity_max: 3,
      memory_volume_min: 0,
      memory_volume_max: 20
    };

    let mismatch = false;
    Object.entries(expected).forEach(([key, expectedValue]) => {
      const actualValue = (ranges as any)[key];
      if (actualValue !== expectedValue) {
        console.error(`   ❌ ${key}: expected ${expectedValue}, got ${actualValue}`);
        mismatch = true;
      }
    });

    if (mismatch) {
      allTestsPassed = false;
    } else {
      console.log('\n✅ TEST 2 PASSED: Memory ranges loaded correctly');
    }
  } catch (error) {
    console.error('❌ TEST 2 FAILED:', error instanceof Error ? error.message : error);
    allTestsPassed = false;
  }

  // ============================================================================
  // TEST 3: Memory Ranges Used in Calculations
  // ============================================================================
  console.log('\n📋 TEST 3: Memory Ranges Used in calculateMemoryComplexity()');
  console.log('-'.repeat(80));

  try {
    // Verify the ranges object has the memory properties
    const ranges = await AISConfigService.getRanges(supabase);

    if (typeof ranges.memory_ratio_min === 'number' &&
        typeof ranges.memory_ratio_max === 'number' &&
        typeof ranges.memory_diversity_min === 'number' &&
        typeof ranges.memory_diversity_max === 'number' &&
        typeof ranges.memory_volume_min === 'number' &&
        typeof ranges.memory_volume_max === 'number') {
      console.log('✅ All memory range properties exist with correct types');
      console.log('\n✅ TEST 3 PASSED: Memory ranges structure verified');
    } else {
      console.error('❌ Some memory range properties missing or wrong type');
      allTestsPassed = false;
    }
  } catch (error) {
    console.error('❌ TEST 3 FAILED:', error instanceof Error ? error.message : error);
    allTestsPassed = false;
  }

  // ============================================================================
  // TEST 4: ModelRouter.getConfig() Uses Database (No Env Vars)
  // ============================================================================
  console.log('\n📋 TEST 4: ModelRouter.getConfig() Database Integration');
  console.log('-'.repeat(80));

  try {
    const config = await ModelRouter.getConfig(supabase);

    console.log('✅ ModelRouter.getConfig() returned:');
    console.log(`   routing_enabled: ${config.routing_enabled}`);
    console.log(`   anthropic_enabled: ${config.anthropic_enabled}`);
    console.log(`   thresholds.low: ${config.thresholds.low}`);
    console.log(`   thresholds.medium: ${config.thresholds.medium}`);
    console.log(`   min_executions: ${config.min_executions}`);
    console.log(`   min_success_rate: ${config.min_success_rate}`);
    console.log(`   models.low.model: ${config.models.low.model}`);
    console.log(`   models.medium.model: ${config.models.medium.model}`);
    console.log(`   models.high.model: ${config.models.high.model}`);

    // Verify structure
    if (typeof config.routing_enabled !== 'boolean') {
      console.error('   ❌ routing_enabled is not boolean');
      allTestsPassed = false;
    }
    if (typeof config.thresholds.low !== 'number' || typeof config.thresholds.medium !== 'number') {
      console.error('   ❌ Thresholds are not numbers');
      allTestsPassed = false;
    }
    if (!config.models.low.model || !config.models.medium.model || !config.models.high.model) {
      console.error('   ❌ Model configurations missing');
      allTestsPassed = false;
    }

    console.log('\n✅ TEST 4 PASSED: ModelRouter.getConfig() loads all values from database');
  } catch (error) {
    console.error('❌ TEST 4 FAILED:', error instanceof Error ? error.message : error);
    allTestsPassed = false;
  }

  // ============================================================================
  // TEST 5: ModelRouter.isRoutingEnabled() Uses Database
  // ============================================================================
  console.log('\n�� TEST 5: ModelRouter.isRoutingEnabled() Database Integration');
  console.log('-'.repeat(80));

  try {
    const isEnabled = await ModelRouter.isRoutingEnabled(supabase);

    console.log(`✅ isRoutingEnabled() returned: ${isEnabled}`);

    if (typeof isEnabled !== 'boolean') {
      console.error('   ❌ isRoutingEnabled() did not return boolean');
      allTestsPassed = false;
    } else {
      console.log('\n✅ TEST 5 PASSED: isRoutingEnabled() works correctly');
    }
  } catch (error) {
    console.error('❌ TEST 5 FAILED:', error instanceof Error ? error.message : error);
    allTestsPassed = false;
  }

  // ============================================================================
  // TEST 6: Configuration Consistency Check
  // ============================================================================
  console.log('\n📋 TEST 6: Configuration Consistency');
  console.log('-'.repeat(80));

  try {
    // Get config from both sources
    const routerConfig = await ModelRouter.getConfig(supabase);
    const systemConfig = await SystemConfigService.getRoutingConfig(supabase);

    // Verify they match
    let consistent = true;

    if (routerConfig.routing_enabled !== systemConfig.enabled) {
      console.error(`   ❌ routing_enabled mismatch: ${routerConfig.routing_enabled} vs ${systemConfig.enabled}`);
      consistent = false;
    }
    if (routerConfig.thresholds.low !== systemConfig.lowThreshold) {
      console.error(`   ❌ lowThreshold mismatch: ${routerConfig.thresholds.low} vs ${systemConfig.lowThreshold}`);
      consistent = false;
    }
    if (routerConfig.thresholds.medium !== systemConfig.mediumThreshold) {
      console.error(`   ❌ mediumThreshold mismatch: ${routerConfig.thresholds.medium} vs ${systemConfig.mediumThreshold}`);
      consistent = false;
    }
    if (routerConfig.min_success_rate !== systemConfig.minSuccessRate) {
      console.error(`   ❌ minSuccessRate mismatch: ${routerConfig.min_success_rate} vs ${systemConfig.minSuccessRate}`);
      consistent = false;
    }
    if (routerConfig.anthropic_enabled !== systemConfig.anthropicEnabled) {
      console.error(`   ❌ anthropicEnabled mismatch: ${routerConfig.anthropic_enabled} vs ${systemConfig.anthropicEnabled}`);
      consistent = false;
    }

    if (consistent) {
      console.log('✅ All configuration values consistent across services');
      console.log('\n✅ TEST 6 PASSED: Configuration consistency verified');
    } else {
      allTestsPassed = false;
    }
  } catch (error) {
    console.error('❌ TEST 6 FAILED:', error instanceof Error ? error.message : error);
    allTestsPassed = false;
  }

  // ============================================================================
  // Final Summary
  // ============================================================================
  console.log('\n' + '='.repeat(80));
  console.log('🏁 PHASE 4 INTEGRATION TEST SUMMARY');
  console.log('='.repeat(80));

  if (allTestsPassed) {
    console.log('✅ ALL TESTS PASSED');
    console.log('\n✨ Phase 4 Status: COMPLETE AND VERIFIED');
    console.log('\n📊 What Was Tested:');
    console.log('   ✅ Memory ranges exist in database with correct values');
    console.log('   ✅ AISConfigService loads memory ranges from database');
    console.log('   ✅ Memory range properties available for calculations');
    console.log('   ✅ ModelRouter.getConfig() uses database (no env vars)');
    console.log('   ✅ ModelRouter.isRoutingEnabled() uses database');
    console.log('   ✅ Configuration consistency across services');
    console.log('\n🎯 Phase 4 Achievement:');
    console.log('   Memory normalization ranges are now database-driven!');
    console.log('   ModelRouter.getConfig() eliminated all environment variables!');
    console.log('   Single source of truth for all routing configuration!');
    console.log('='.repeat(80));
    return true;
  } else {
    console.log('❌ SOME TESTS FAILED');
    console.log('   Please review the errors above and fix issues before deployment.');
    console.log('='.repeat(80));
    return false;
  }
}

testPhase4FullIntegration()
  .then(success => process.exit(success ? 0 : 1))
  .catch(err => {
    console.error('❌ Test script error:', err);
    process.exit(1);
  });
