// app/api/admin/ais-weights/route.ts
// API endpoint to update AIS dimension weights

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';

export async function PUT(request: NextRequest) {
  try {
    console.log('🔧 [AIS Weights] PUT request received');

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    const body = await request.json();
    console.log('🔧 [AIS Weights] Request body:', JSON.stringify(body, null, 2));

    const { weights } = body;
    console.log('📊 [AIS Weights] Updating AIS weights:', weights);

    // Map frontend keys to database keys
    const configMap: Record<string, string> = {
      // Dimension weights
      tokens: 'ais_weight_tokens',
      execution: 'ais_weight_execution',
      plugins: 'ais_weight_plugins',
      workflow: 'ais_weight_workflow',
      memory: 'ais_weight_memory',
      // Token subdimensions
      token_volume: 'ais_token_volume_weight',
      token_peak: 'ais_token_peak_weight',
      token_io: 'ais_token_io_weight',
      // Execution subdimensions
      execution_iterations: 'ais_execution_iterations_weight',
      execution_duration: 'ais_execution_duration_weight',
      execution_failure: 'ais_execution_failure_weight',
      execution_retry: 'ais_execution_retry_weight',
      // Plugin subdimensions
      plugin_count: 'ais_plugin_count_weight',
      plugin_usage: 'ais_plugin_usage_weight',
      plugin_overhead: 'ais_plugin_overhead_weight',
      // Workflow subdimensions
      workflow_steps: 'ais_workflow_steps_weight',
      workflow_branches: 'ais_workflow_branches_weight',
      workflow_loops: 'ais_workflow_loops_weight',
      workflow_parallel: 'ais_workflow_parallel_weight',
      // Memory subdimensions
      memory_ratio: 'ais_memory_ratio_weight',
      memory_diversity: 'ais_memory_diversity_weight',
      memory_volume: 'ais_memory_volume_weight'
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
          description: `AIS weight configuration for ${key}`,
          category: 'ais_dimension_weights'
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

    console.log(`✅ [AIS Weights] Successfully updated ${successes.length} weights`);

    return NextResponse.json({
      success: true,
      message: `Updated ${successes.length} AIS weight values`,
      updated: successes
    });

  } catch (error) {
    console.error('❌ [AIS Weights] API error:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Internal server error'
      },
      { status: 500 }
    );
  }
}
