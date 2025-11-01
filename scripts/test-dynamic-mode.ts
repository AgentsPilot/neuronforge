// scripts/test-dynamic-mode.ts
// Test script to directly call the AIS ranges logic

import { createClient } from '@supabase/supabase-js';

async function testDynamicMode() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  console.log('🔍 Testing AIS ranges API logic...\n');

  // Get all AIS normalization ranges
  const { data, error } = await supabase
    .from('ais_normalization_ranges')
    .select('*')
    .order('category', { ascending: true });

  if (error) {
    console.error('❌ Error:', error);
    return;
  }

  if (!data || data.length === 0) {
    console.log('⚠️ No ranges found');
    return;
  }

  // Get active mode from first range
  const activeMode = data[0]?.active_mode || 0;
  const modeDescription = activeMode === 0 ? 'Best Practice' : 'Dynamic (Real Data)';

  console.log(`📊 Active Mode: ${activeMode} (${modeDescription})`);
  console.log(`📊 Total ranges: ${data.length}\n`);

  // Build ranges object based on active mode
  const ranges: Record<string, { min: number; max: number }> = {};
  let fallbackCount = 0;

  data.forEach((row: any) => {
    // Use best_practice or dynamic values based on active mode
    if (activeMode === 0) {
      // Best practice mode
      ranges[row.range_key] = {
        min: parseFloat(row.best_practice_min),
        max: parseFloat(row.best_practice_max)
      };
    } else {
      // Dynamic mode - use dynamic values if available and valid
      const dynamicMin = row.dynamic_min !== null ? parseFloat(row.dynamic_min) : null;
      const dynamicMax = row.dynamic_max !== null ? parseFloat(row.dynamic_max) : null;
      const bestPracticeMin = parseFloat(row.best_practice_min);
      const bestPracticeMax = parseFloat(row.best_practice_max);

      // Check if dynamic values are valid (max > min)
      const dynamicIsValid = dynamicMin !== null && dynamicMax !== null && dynamicMax > dynamicMin;

      if (dynamicIsValid) {
        // Use valid dynamic values
        ranges[row.range_key] = {
          min: dynamicMin!,
          max: dynamicMax!
        };
        console.log(`✅ ${row.range_key}: Using dynamic (${dynamicMin}, ${dynamicMax})`);
      } else {
        // Fall back to best practice if dynamic is null or invalid
        ranges[row.range_key] = {
          min: bestPracticeMin,
          max: bestPracticeMax
        };
        fallbackCount++;
        console.log(`⚠️ ${row.range_key}: Falling back to best practice (${bestPracticeMin}, ${bestPracticeMax}) - dynamic was (${dynamicMin}, ${dynamicMax})`);
      }
    }
  });

  console.log(`\n📊 Result Summary:`);
  console.log(`   Active Mode: ${modeDescription}`);
  console.log(`   Total Ranges: ${Object.keys(ranges).length}`);
  if (activeMode === 1) {
    console.log(`   Valid Dynamic Ranges: ${data.length - fallbackCount}`);
    console.log(`   Fallback Ranges: ${fallbackCount}`);
  }

  console.log('\n✅ Sample ranges:', {
    token_volume: ranges.token_volume,
    token_peak: ranges.token_peak,
    iterations: ranges.iterations,
    plugin_count: ranges.plugin_count
  });
}

testDynamicMode().catch(console.error);
