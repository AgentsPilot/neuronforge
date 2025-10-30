// scripts/test-api-logic.ts
// Test the exact logic from the API route

import { createClient } from '@supabase/supabase-js';

async function testApiLogic() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  console.log('🔍 Testing AIS Ranges API Logic (with fallback)\n');

  // Get all AIS normalization ranges
  const { data, error } = await supabase
    .from('ais_normalization_ranges')
    .select('*')
    .order('category', { ascending: true });

  if (error) {
    console.error('Error fetching AIS ranges:', error);
    return;
  }

  if (!data || data.length === 0) {
    console.warn('No AIS ranges found');
    return;
  }

  // Get active mode from first range (all rows have same active_mode)
  const activeMode = data[0]?.active_mode || 0;
  const modeDescription = activeMode === 0 ? 'Best Practice' : 'Dynamic (Real Data)';

  console.log(`✅ Using AIS mode: ${modeDescription} (${activeMode})\n`);

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
      } else {
        // Fall back to best practice if dynamic is null or invalid
        ranges[row.range_key] = {
          min: bestPracticeMin,
          max: bestPracticeMax
        };
        fallbackCount++;
      }
    }
  });

  console.log(`✅ Loaded ${Object.keys(ranges).length} AIS ranges`);
  if (activeMode === 1 && fallbackCount > 0) {
    console.log(`⚠️ ${fallbackCount} ranges fell back to best practice due to invalid dynamic data`);
  }

  const result = {
    success: true,
    ranges,
    activeMode,
    modeDescription,
    fallbackCount: activeMode === 1 ? fallbackCount : 0
  };

  console.log('\n📊 API Response Summary:');
  console.log(`   Active Mode: ${result.activeMode}`);
  console.log(`   Mode Description: ${result.modeDescription}`);
  console.log(`   Fallback Count: ${result.fallbackCount}`);
  console.log(`   Total Ranges: ${Object.keys(result.ranges).length}`);

  console.log('\n📊 Sample Ranges:');
  console.log('   token_volume:', result.ranges.token_volume);
  console.log('   token_peak:', result.ranges.token_peak);
  console.log('   plugin_count:', result.ranges.plugin_count);
  console.log('   iterations:', result.ranges.iterations);
  console.log('   duration_ms:', result.ranges.duration_ms);

  console.log('\n✅ This is what the calculator will receive!');
}

testApiLogic().catch(console.error);
