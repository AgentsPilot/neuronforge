// app/api/admin/ais-weights/creation/route.ts
// API endpoint to update creation component weights (workflow/plugins/io_schema)
// Phase 5: Make creation score components database-driven

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';

export async function PUT(request: NextRequest) {
  try {
    console.log('🔧 [Creation Weights] PUT request received');

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    const body = await request.json();
    console.log('🔧 [Creation Weights] Request body:', JSON.stringify(body, null, 2));

    const { weights } = body;
    console.log('📊 [Creation Weights] Updating creation component weights:', weights);

    // Validate weights sum to 1.0
    const sum = weights.workflow + weights.plugins + weights.io_schema;
    if (Math.abs(sum - 1.0) > 0.001) {
      return NextResponse.json({
        success: false,
        error: `Creation component weights must sum to 1.0 (currently ${sum.toFixed(3)})`
      }, { status: 400 });
    }

    // Map frontend keys to database keys
    const configMap: Record<string, string> = {
      workflow: 'ais_creation_workflow_weight',
      plugins: 'ais_creation_plugin_weight',
      io_schema: 'ais_creation_io_weight'
    };

    const errors = [];
    const successes = [];

    // Update each weight value
    for (const [key, value] of Object.entries(weights)) {
      const dbKey = configMap[key];

      if (!dbKey) {
        console.warn(`⚠️ Unknown weight key: ${key}`);
        errors.push(`Unknown weight key: ${key}`);
        continue;
      }

      console.log(`  🔄 Updating ${dbKey} = ${value} (type: ${typeof value})`);

      const { data: updateData, error } = await supabase
        .from('ais_system_config')
        .upsert({
          config_key: dbKey,
          config_value: value,
          description: `Weight for ${key} in creation score (Phase 5)`,
          category: 'ais_creation_weights'
        }, { onConflict: 'config_key' })
        .select();

      if (error) {
        console.error(`❌ Failed to update ${dbKey}:`, error);
        errors.push(`Failed to update ${key}: ${error.message}`);
      } else {
        console.log(`  ✅ Successfully updated ${dbKey}. Returned data:`, updateData);
        successes.push(key);
      }
    }

    if (errors.length > 0) {
      return NextResponse.json({
        success: false,
        error: errors.join(', '),
        partial: successes.length > 0,
        updated: successes
      }, { status: 500 });
    }

    console.log(`✅ [Creation Weights] Successfully updated ${successes.length} weights`);

    return NextResponse.json({
      success: true,
      message: `Updated ${successes.length} creation component weight values`,
      updated: successes
    });

  } catch (error) {
    console.error('❌ [Creation Weights] API error:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Internal server error'
      },
      { status: 500 }
    );
  }
}
