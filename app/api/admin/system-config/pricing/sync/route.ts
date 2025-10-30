import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

/**
 * POST /api/admin/system-config/pricing/sync
 * Sync latest pricing from external sources (OpenAI, Anthropic)
 *
 * This uses official pricing from provider documentation:
 * - OpenAI: https://openai.com/api/pricing/
 * - Anthropic: https://www.anthropic.com/pricing
 */
export async function POST() {
  try {
    console.log('[API] Starting pricing sync...');

    // Official pricing as of January 2025
    // Source: https://openai.com/api/pricing/ and https://www.anthropic.com/pricing
    const latestPricing = [
      // OpenAI Models
      {
        provider: 'openai',
        model_name: 'gpt-4o',
        input_cost_per_token: 0.0000025,  // $2.50 per 1M input tokens
        output_cost_per_token: 0.00001,    // $10.00 per 1M output tokens
        effective_date: new Date().toISOString()
      },
      {
        provider: 'openai',
        model_name: 'gpt-4o-mini',
        input_cost_per_token: 0.00000015,  // $0.15 per 1M input tokens
        output_cost_per_token: 0.0000006,  // $0.60 per 1M output tokens
        effective_date: new Date().toISOString()
      },
      {
        provider: 'openai',
        model_name: 'gpt-4-turbo',
        input_cost_per_token: 0.00001,     // $10.00 per 1M input tokens
        output_cost_per_token: 0.00003,    // $30.00 per 1M output tokens
        effective_date: new Date().toISOString()
      },
      {
        provider: 'openai',
        model_name: 'gpt-4',
        input_cost_per_token: 0.00003,     // $30.00 per 1M input tokens
        output_cost_per_token: 0.00006,    // $60.00 per 1M output tokens
        effective_date: new Date().toISOString()
      },
      {
        provider: 'openai',
        model_name: 'gpt-3.5-turbo',
        input_cost_per_token: 0.0000005,   // $0.50 per 1M input tokens
        output_cost_per_token: 0.0000015,  // $1.50 per 1M output tokens
        effective_date: new Date().toISOString()
      },

      // Anthropic Models
      {
        provider: 'anthropic',
        model_name: 'claude-3-opus-20240229',
        input_cost_per_token: 0.000015,    // $15.00 per 1M input tokens
        output_cost_per_token: 0.000075,   // $75.00 per 1M output tokens
        effective_date: new Date().toISOString()
      },
      {
        provider: 'anthropic',
        model_name: 'claude-3-sonnet-20240229',
        input_cost_per_token: 0.000003,    // $3.00 per 1M input tokens
        output_cost_per_token: 0.000015,   // $15.00 per 1M output tokens
        effective_date: new Date().toISOString()
      },
      {
        provider: 'anthropic',
        model_name: 'claude-3-haiku-20240307',
        input_cost_per_token: 0.00000025,  // $0.25 per 1M input tokens
        output_cost_per_token: 0.00000125, // $1.25 per 1M output tokens
        effective_date: new Date().toISOString()
      },
      {
        provider: 'anthropic',
        model_name: 'claude-3-5-sonnet-20241022',
        input_cost_per_token: 0.000003,    // $3.00 per 1M input tokens
        output_cost_per_token: 0.000015,   // $15.00 per 1M output tokens
        effective_date: new Date().toISOString()
      }
    ];

    const updatedModels: string[] = [];
    const createdModels: string[] = [];

    for (const pricing of latestPricing) {
      // Check if model exists
      const { data: existing } = await supabase
        .from('ai_model_pricing')
        .select('id')
        .eq('provider', pricing.provider)
        .eq('model_name', pricing.model_name)
        .single();

      if (existing) {
        // Update existing
        const { error } = await supabase
          .from('ai_model_pricing')
          .update({
            input_cost_per_token: pricing.input_cost_per_token,
            output_cost_per_token: pricing.output_cost_per_token,
            effective_date: pricing.effective_date
          })
          .eq('id', existing.id);

        if (error) {
          console.error(`[API] Failed to update ${pricing.model_name}:`, error);
        } else {
          updatedModels.push(pricing.model_name);
        }
      } else {
        // Create new
        const { error } = await supabase
          .from('ai_model_pricing')
          .insert(pricing);

        if (error) {
          console.error(`[API] Failed to create ${pricing.model_name}:`, error);
        } else {
          createdModels.push(pricing.model_name);
        }
      }
    }

    console.log('[API] Pricing sync complete:', {
      updated: updatedModels.length,
      created: createdModels.length
    });

    return NextResponse.json({
      success: true,
      message: `Pricing sync complete! Updated ${updatedModels.length} models, created ${createdModels.length} new models.`,
      data: {
        updated: updatedModels,
        created: createdModels
      }
    });

  } catch (error) {
    console.error('[API] Error syncing pricing:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to sync pricing'
      },
      { status: 500 }
    );
  }
}
