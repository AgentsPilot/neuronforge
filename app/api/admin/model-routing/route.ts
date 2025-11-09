// app/api/admin/model-routing/route.ts
// API endpoint for managing model routing configuration (Phase 3)

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';

/**
 * GET /api/admin/model-routing
 * Fetch current model routing configuration
 */
export async function GET() {
  try {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    const { data, error } = await supabase
      .from('model_routing_config')
      .select('*')
      .order('complexity_tier');

    if (error) {
      console.error('❌ [Model Routing API] Error fetching config:', error);
      return NextResponse.json(
        { success: false, error: error.message },
        { status: 500 }
      );
    }

    // Transform to expected format
    const config: any = {};
    data?.forEach(row => {
      config[row.complexity_tier] = {
        model: row.model_name,
        provider: row.provider,
        description: row.description
      };
    });

    return NextResponse.json({
      success: true,
      config
    });
  } catch (error) {
    console.error('❌ [Model Routing API] Exception:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Internal server error'
      },
      { status: 500 }
    );
  }
}

/**
 * PUT /api/admin/model-routing
 * Update model routing configuration
 *
 * Body format:
 * {
 *   config: {
 *     low: { model: 'gpt-4o-mini', provider: 'openai' },
 *     medium: { model: 'claude-3-5-haiku-20241022', provider: 'anthropic' },
 *     high: { model: 'gpt-4o', provider: 'openai' }
 *   }
 * }
 */
export async function PUT(request: NextRequest) {
  try {
    console.log('🔧 [Model Routing API] PUT request received');

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    const body = await request.json();
    console.log('🔧 [Model Routing API] Request body:', JSON.stringify(body, null, 2));

    const { config } = body;

    if (!config) {
      return NextResponse.json(
        { success: false, error: 'Missing config in request body' },
        { status: 400 }
      );
    }

    const errors: string[] = [];
    const successes: string[] = [];

    // Update each tier
    for (const [tier, settings] of Object.entries(config)) {
      if (tier !== 'low' && tier !== 'medium' && tier !== 'high') {
        console.warn(`⚠️ Invalid tier: ${tier}`);
        errors.push(`Invalid tier: ${tier}`);
        continue;
      }

      const { model, provider } = settings as { model: string; provider: string };

      if (!model || !provider) {
        console.warn(`⚠️ Missing model or provider for ${tier}`);
        errors.push(`Missing model or provider for ${tier}`);
        continue;
      }

      if (provider !== 'openai' && provider !== 'anthropic') {
        console.warn(`⚠️ Invalid provider for ${tier}: ${provider}`);
        errors.push(`Invalid provider for ${tier}: ${provider}`);
        continue;
      }

      console.log(`  🔄 Updating ${tier}: ${model} (${provider})`);

      const { error } = await supabase
        .from('model_routing_config')
        .update({
          model_name: model,
          provider: provider,
          updated_at: new Date().toISOString()
        })
        .eq('complexity_tier', tier);

      if (error) {
        console.error(`❌ Failed to update ${tier}:`, error);
        errors.push(`Failed to update ${tier}: ${error.message}`);
      } else {
        console.log(`  ✅ Successfully updated ${tier}`);
        successes.push(tier);
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

    console.log(`✅ [Model Routing API] Successfully updated ${successes.length} tiers`);

    return NextResponse.json({
      success: true,
      message: `Updated ${successes.length} model routing configurations`,
      updated: successes
    });

  } catch (error) {
    console.error('❌ [Model Routing API] Exception:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Internal server error'
      },
      { status: 500 }
    );
  }
}
