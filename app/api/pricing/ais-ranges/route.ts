// app/api/pricing/ais-ranges/route.ts
// API endpoint to fetch active AIS normalization ranges for pricing calculator

import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    // Get all AIS normalization ranges
    const { data, error } = await supabase
      .from('ais_normalization_ranges')
      .select('*')
      .order('category', { ascending: true });

    if (error) {
      console.error('Error fetching AIS ranges:', error);
      return NextResponse.json(
        { success: false, error: 'Failed to fetch AIS ranges' },
        { status: 500 }
      );
    }

    if (!data || data.length === 0) {
      console.warn('No AIS ranges found');
      return NextResponse.json(
        { success: false, error: 'No ranges found' },
        { status: 404 }
      );
    }

    // Get active mode from first range (all rows have same active_mode)
    const activeMode = data[0]?.active_mode || 0;
    const modeDescription = activeMode === 0 ? 'Best Practice' : 'Dynamic (Real Data)';

    console.log(`✅ [Pricing Calculator] Using AIS mode: ${modeDescription} (${activeMode})`);

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
          console.log(`⚠️ [AIS Ranges] Falling back to best practice for ${row.range_key}: dynamic(${dynamicMin}, ${dynamicMax}) -> best_practice(${bestPracticeMin}, ${bestPracticeMax})`);
        }
      }
    });

    console.log(`✅ [Pricing Calculator] Loaded ${Object.keys(ranges).length} AIS ranges`);
    if (activeMode === 1 && fallbackCount > 0) {
      console.log(`⚠️ [Pricing Calculator] ${fallbackCount} ranges fell back to best practice due to invalid dynamic data`);
    }

    return NextResponse.json({
      success: true,
      ranges,
      activeMode,
      modeDescription,
      fallbackCount: activeMode === 1 ? fallbackCount : 0
    });
  } catch (error) {
    console.error('AIS ranges API error:', error);
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}
