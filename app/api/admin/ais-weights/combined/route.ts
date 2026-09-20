// app/api/admin/ais-weights/combined/route.ts
// API endpoint to update combined score weights (creation/execution blend)

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

import { requireAdmin } from '@/lib/admin/requireAdminRoute';
import { createLogger } from '@/lib/logger';

const logger = createLogger({ module: 'AisWeightsCombinedAdminAPI' });
export const dynamic = 'force-dynamic';

export async function PUT(request: NextRequest) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId });

  try {
    // Admin gate. Nothing above this line may touch a request body,
    // the database, a job queue, or an outbound message (FR-5).
    const gate = await requireAdmin(requestLogger);
    if (gate instanceof NextResponse) return gate;

    console.log('🔧 [Combined Weights] PUT request received');

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    const body = await request.json();
    console.log('🔧 [Combined Weights] Request body:', JSON.stringify(body, null, 2));

    const { weights } = body;
    console.log('📊 [Combined Weights] Updating combined weights:', weights);

    // Map frontend keys to database keys
    const configMap: Record<string, string> = {
      creation: 'ais_weight_creation',
      execution_blend: 'ais_weight_execution_blend'
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
          description: `Combined score weight for ${key}`,
          category: 'ais_combined_weights'
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

    console.log(`✅ [Combined Weights] Successfully updated ${successes.length} weights`);

    return NextResponse.json({
      success: true,
      message: `Updated ${successes.length} combined weight values`,
      updated: successes
    });

  } catch (error) {
    console.error('❌ [Combined Weights] API error:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Internal server error'
      },
      { status: 500 }
    );
  }
}
