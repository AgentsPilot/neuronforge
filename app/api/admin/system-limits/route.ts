// app/api/admin/system-limits/route.ts
// API endpoint to update system limits

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

import { requireAdmin } from '@/lib/admin/requireAdminRoute';
import { createLogger } from '@/lib/logger';

const logger = createLogger({ module: 'SystemLimitsAdminAPI' });
export const dynamic = 'force-dynamic';

export async function PUT(request: NextRequest) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId });

  try {
    // Admin gate. Nothing above this line may touch a request body,
    // the database, a job queue, or an outbound message (FR-5).
    const gate = await requireAdmin(requestLogger);
    if (gate instanceof NextResponse) return gate;

    console.log('🔧 [System Limits] PUT request received');

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    console.log('🔧 [System Limits] Supabase client created');

    const body = await request.json();
    console.log('🔧 [System Limits] Request body:', JSON.stringify(body, null, 2));

    const { limits } = body;
    console.log('🔧 [System Limits] Extracted limits:', JSON.stringify(limits, null, 2));

    console.log('⚙️ [System Limits] Updating system limits:', limits);

    // 🔒 PROTECTION: min_executions_for_score is now the single source of truth for routing threshold
    // No validation needed - routing uses this value directly
    if (limits.minExecutionsForScore !== undefined) {
      console.log(`🔒 [System Limits] min_executions_for_score set to ${limits.minExecutionsForScore} - this controls both score blending AND routing threshold`);
    }

    // Map frontend keys to database keys
    const configMap: Record<string, string> = {
      minAgentIntensity: 'min_agent_intensity',
      maxAgentIntensity: 'max_agent_intensity',
      minExecutionsForScore: 'min_executions_for_score'
    };

    const errors = [];
    const successes = [];

    // Update each limit value
    for (const [key, value] of Object.entries(limits)) {
      const dbKey = configMap[key];

      if (!dbKey) {
        console.warn(`⚠️ Unknown limit key: ${key}`);
        errors.push(`Unknown limit key: ${key}`);
        continue;
      }

      console.log(`  🔄 Updating ${dbKey} = ${value} (type: ${typeof value})`);

      // Update directly without pre-checking to avoid Supabase cache issues
      // Force updated_at to change so cache is invalidated
      const { data: updateData, error } = await supabase
        .from('ais_system_config')
        .update({
          config_value: value,
          updated_at: new Date().toISOString()
        })
        .eq('config_key', dbKey)
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

    console.log(`✅ [System Limits] Successfully updated ${successes.length} limits`);

    return NextResponse.json({
      success: true,
      message: `Updated ${successes.length} system limit values`,
      updated: successes
    });

  } catch (error) {
    console.error('❌ [System Limits] API error:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Internal server error'
      },
      { status: 500 }
    );
  }
}
