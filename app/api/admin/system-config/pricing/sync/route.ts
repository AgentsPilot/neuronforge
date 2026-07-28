import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import { createLogger } from '@/lib/logger';

const logger = createLogger({ module: 'PricingSyncAPI' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

/**
 * POST /api/admin/system-config/pricing/sync
 * Sync latest pricing from external sources (OpenAI, Anthropic, Google, Kimi)
 *
 * This uses official pricing from provider documentation:
 * - OpenAI: https://openai.com/api/pricing/
 * - Anthropic: https://www.anthropic.com/pricing
 * - Google: https://ai.google.dev/pricing
 * - Kimi: https://platform.moonshot.cn/docs/pricing
 *
 * Pricing is stored as cost per single token (not per 1K or per 1M)
 * For display, multiply by appropriate factor (e.g., * 1000 for per-1K pricing)
 */
export async function POST() {
  try {
    logger.info('Starting pricing sync...');

    const effectiveDate = new Date().toISOString();

    // Complete pricing catalog - June 2026
    // Prices are per single token (divide per-1M prices by 1,000,000)
    const latestPricing = [
      // ============================================
      // OPENAI MODELS
      // ============================================

      // GPT-5.4 Series (March 2026 — Latest)
      {
        provider: 'openai',
        model_name: 'gpt-5.4',
        input_cost_per_token: 0.0000025,   // $2.50 per 1M input tokens
        output_cost_per_token: 0.000015,   // $15.00 per 1M output tokens
        effective_date: effectiveDate
      },
      {
        provider: 'openai',
        model_name: 'gpt-5.4-mini',
        input_cost_per_token: 0.00000075,  // $0.75 per 1M input tokens
        output_cost_per_token: 0.0000045,  // $4.50 per 1M output tokens
        effective_date: effectiveDate
      },
      {
        provider: 'openai',
        model_name: 'gpt-5.4-nano',
        input_cost_per_token: 0.0000002,   // $0.20 per 1M input tokens
        output_cost_per_token: 0.00000125, // $1.25 per 1M output tokens
        effective_date: effectiveDate
      },
      {
        provider: 'openai',
        model_name: 'gpt-5.4-pro',
        input_cost_per_token: 0.00003,     // $30.00 per 1M input tokens
        output_cost_per_token: 0.00018,    // $180.00 per 1M output tokens
        effective_date: effectiveDate
      },

      // GPT-5.2 Series
      {
        provider: 'openai',
        model_name: 'gpt-5.2',
        input_cost_per_token: 0.00000175,  // $1.75 per 1M input tokens
        output_cost_per_token: 0.000014,   // $14.00 per 1M output tokens
        effective_date: effectiveDate
      },

      // GPT-5.1 Series
      {
        provider: 'openai',
        model_name: 'gpt-5.1',
        input_cost_per_token: 0.00000125,  // $1.25 per 1M input tokens
        output_cost_per_token: 0.00001,    // $10.00 per 1M output tokens
        effective_date: effectiveDate
      },

      // GPT-5 Series
      {
        provider: 'openai',
        model_name: 'gpt-5',
        input_cost_per_token: 0.00000125,  // $1.25 per 1M input tokens
        output_cost_per_token: 0.00001,    // $10.00 per 1M output tokens
        effective_date: effectiveDate
      },
      {
        provider: 'openai',
        model_name: 'gpt-5-mini',
        input_cost_per_token: 0.00000025,  // $0.25 per 1M input tokens
        output_cost_per_token: 0.000002,   // $2.00 per 1M output tokens
        effective_date: effectiveDate
      },
      {
        provider: 'openai',
        model_name: 'gpt-5-nano',
        input_cost_per_token: 0.00000005,  // $0.05 per 1M input tokens
        output_cost_per_token: 0.0000004,  // $0.40 per 1M output tokens
        effective_date: effectiveDate
      },

      // GPT-4.1 Series
      {
        provider: 'openai',
        model_name: 'gpt-4.1',
        input_cost_per_token: 0.000002,    // $2.00 per 1M input tokens
        output_cost_per_token: 0.000008,   // $8.00 per 1M output tokens
        effective_date: effectiveDate
      },
      {
        provider: 'openai',
        model_name: 'gpt-4.1-mini',
        input_cost_per_token: 0.0000004,   // $0.40 per 1M input tokens
        output_cost_per_token: 0.0000016,  // $1.60 per 1M output tokens
        effective_date: effectiveDate
      },
      {
        provider: 'openai',
        model_name: 'gpt-4.1-nano',
        input_cost_per_token: 0.0000001,   // $0.10 per 1M input tokens
        output_cost_per_token: 0.0000004,  // $0.40 per 1M output tokens
        effective_date: effectiveDate
      },

      // o-Series (Reasoning Models)
      {
        provider: 'openai',
        model_name: 'o3',
        input_cost_per_token: 0.000002,    // $2.00 per 1M input tokens
        output_cost_per_token: 0.000008,   // $8.00 per 1M output tokens
        effective_date: effectiveDate
      },
      {
        provider: 'openai',
        model_name: 'o3-pro',
        input_cost_per_token: 0.00002,     // $20.00 per 1M input tokens
        output_cost_per_token: 0.00008,    // $80.00 per 1M output tokens
        effective_date: effectiveDate
      },
      {
        provider: 'openai',
        model_name: 'o4-mini',
        input_cost_per_token: 0.0000011,   // $1.10 per 1M input tokens
        output_cost_per_token: 0.0000044,  // $4.40 per 1M output tokens
        effective_date: effectiveDate
      },

      // GPT-4o Series (Legacy but still in use)
      {
        provider: 'openai',
        model_name: 'gpt-4o',
        input_cost_per_token: 0.0000025,   // $2.50 per 1M input tokens
        output_cost_per_token: 0.00001,    // $10.00 per 1M output tokens
        effective_date: effectiveDate
      },
      {
        provider: 'openai',
        model_name: 'gpt-4o-mini',
        input_cost_per_token: 0.00000015,  // $0.15 per 1M input tokens
        output_cost_per_token: 0.0000006,  // $0.60 per 1M output tokens
        effective_date: effectiveDate
      },

      // Legacy GPT-4 Models
      {
        provider: 'openai',
        model_name: 'gpt-4-turbo',
        input_cost_per_token: 0.00001,     // $10.00 per 1M input tokens
        output_cost_per_token: 0.00003,    // $30.00 per 1M output tokens
        effective_date: effectiveDate
      },
      {
        provider: 'openai',
        model_name: 'gpt-4',
        input_cost_per_token: 0.00003,     // $30.00 per 1M input tokens
        output_cost_per_token: 0.00006,    // $60.00 per 1M output tokens
        effective_date: effectiveDate
      },
      {
        provider: 'openai',
        model_name: 'gpt-3.5-turbo',
        input_cost_per_token: 0.0000005,   // $0.50 per 1M input tokens
        output_cost_per_token: 0.0000015,  // $1.50 per 1M output tokens
        effective_date: effectiveDate
      },

      // ============================================
      // ANTHROPIC MODELS
      // ============================================

      // Claude 4.6 Series (Feb 2026 — Latest)
      {
        provider: 'anthropic',
        model_name: 'claude-opus-4-6',
        input_cost_per_token: 0.000005,    // $5.00 per 1M input tokens
        output_cost_per_token: 0.000025,   // $25.00 per 1M output tokens
        effective_date: effectiveDate
      },
      {
        provider: 'anthropic',
        model_name: 'claude-sonnet-4-6',
        input_cost_per_token: 0.000003,    // $3.00 per 1M input tokens
        output_cost_per_token: 0.000015,   // $15.00 per 1M output tokens
        effective_date: effectiveDate
      },

      // Claude 4.5 Series
      {
        provider: 'anthropic',
        model_name: 'claude-opus-4-5-20251101',
        input_cost_per_token: 0.000005,    // $5.00 per 1M input tokens
        output_cost_per_token: 0.000025,   // $25.00 per 1M output tokens
        effective_date: effectiveDate
      },
      {
        provider: 'anthropic',
        model_name: 'claude-sonnet-4-5-20250929',
        input_cost_per_token: 0.000003,    // $3.00 per 1M input tokens
        output_cost_per_token: 0.000015,   // $15.00 per 1M output tokens
        effective_date: effectiveDate
      },
      {
        provider: 'anthropic',
        model_name: 'claude-haiku-4-5-20251001',
        input_cost_per_token: 0.000001,    // $1.00 per 1M input tokens
        output_cost_per_token: 0.000005,   // $5.00 per 1M output tokens
        effective_date: effectiveDate
      },

      // Claude 4.1 Series
      {
        provider: 'anthropic',
        model_name: 'claude-opus-4-1-20250805',
        input_cost_per_token: 0.000015,    // $15.00 per 1M input tokens
        output_cost_per_token: 0.000075,   // $75.00 per 1M output tokens
        effective_date: effectiveDate
      },

      // Claude 4 Series
      {
        provider: 'anthropic',
        model_name: 'claude-opus-4-20250514',
        input_cost_per_token: 0.000015,    // $15.00 per 1M input tokens
        output_cost_per_token: 0.000075,   // $75.00 per 1M output tokens
        effective_date: effectiveDate
      },
      {
        provider: 'anthropic',
        model_name: 'claude-sonnet-4-20250514',
        input_cost_per_token: 0.000003,    // $3.00 per 1M input tokens
        output_cost_per_token: 0.000015,   // $15.00 per 1M output tokens
        effective_date: effectiveDate
      },

      // Claude 3.5 Series
      {
        provider: 'anthropic',
        model_name: 'claude-3-5-sonnet-20241022',
        input_cost_per_token: 0.000003,    // $3.00 per 1M input tokens
        output_cost_per_token: 0.000015,   // $15.00 per 1M output tokens
        effective_date: effectiveDate
      },
      {
        provider: 'anthropic',
        model_name: 'claude-3-5-haiku-20241022',
        input_cost_per_token: 0.0000008,   // $0.80 per 1M input tokens
        output_cost_per_token: 0.000004,   // $4.00 per 1M output tokens
        effective_date: effectiveDate
      },

      // Claude 3 Series (Deprecated but may still have usage data)
      {
        provider: 'anthropic',
        model_name: 'claude-3-opus-20240229',
        input_cost_per_token: 0.000015,    // $15.00 per 1M input tokens
        output_cost_per_token: 0.000075,   // $75.00 per 1M output tokens
        effective_date: effectiveDate
      },
      {
        provider: 'anthropic',
        model_name: 'claude-3-sonnet-20240229',
        input_cost_per_token: 0.000003,    // $3.00 per 1M input tokens
        output_cost_per_token: 0.000015,   // $15.00 per 1M output tokens
        effective_date: effectiveDate
      },
      {
        provider: 'anthropic',
        model_name: 'claude-3-haiku-20240307',
        input_cost_per_token: 0.00000025,  // $0.25 per 1M input tokens
        output_cost_per_token: 0.00000125, // $1.25 per 1M output tokens
        effective_date: effectiveDate
      },

      // ============================================
      // GOOGLE MODELS
      // ============================================
      {
        provider: 'google',
        model_name: 'gemini-1.5-pro',
        input_cost_per_token: 0.00000125,  // $1.25 per 1M input tokens
        output_cost_per_token: 0.000005,   // $5.00 per 1M output tokens
        effective_date: effectiveDate
      },
      {
        provider: 'google',
        model_name: 'gemini-1.5-flash',
        input_cost_per_token: 0.000000075, // $0.075 per 1M input tokens
        output_cost_per_token: 0.0000003,  // $0.30 per 1M output tokens
        effective_date: effectiveDate
      },
      {
        provider: 'google',
        model_name: 'gemini-1.0-pro',
        input_cost_per_token: 0.0000005,   // $0.50 per 1M input tokens
        output_cost_per_token: 0.0000015,  // $1.50 per 1M output tokens
        effective_date: effectiveDate
      },

      // ============================================
      // KIMI MODELS (Moonshot AI)
      // ============================================

      // Kimi K2.5 Series (Jan 2026 — Latest)
      {
        provider: 'kimi',
        model_name: 'kimi-k2.5',
        input_cost_per_token: 0.0000006,   // $0.60 per 1M input tokens
        output_cost_per_token: 0.000003,   // $3.00 per 1M output tokens
        effective_date: effectiveDate
      },

      // Kimi K2 Series
      {
        provider: 'kimi',
        model_name: 'kimi-k2-0905-preview',
        input_cost_per_token: 0.0000006,   // $0.60 per 1M input tokens
        output_cost_per_token: 0.0000025,  // $2.50 per 1M output tokens
        effective_date: effectiveDate
      },
      {
        provider: 'kimi',
        model_name: 'kimi-k2-0711-preview',
        input_cost_per_token: 0.0000006,   // $0.60 per 1M input tokens
        output_cost_per_token: 0.0000025,  // $2.50 per 1M output tokens
        effective_date: effectiveDate
      },
      {
        provider: 'kimi',
        model_name: 'kimi-k2-turbo-preview',
        input_cost_per_token: 0.00000115,  // $1.15 per 1M input tokens
        output_cost_per_token: 0.000008,   // $8.00 per 1M output tokens
        effective_date: effectiveDate
      },
      {
        provider: 'kimi',
        model_name: 'kimi-k2-thinking',
        input_cost_per_token: 0.0000006,   // $0.60 per 1M input tokens
        output_cost_per_token: 0.0000025,  // $2.50 per 1M output tokens
        effective_date: effectiveDate
      },
      {
        provider: 'kimi',
        model_name: 'kimi-k2-thinking-turbo',
        input_cost_per_token: 0.00000115,  // $1.15 per 1M input tokens
        output_cost_per_token: 0.000008,   // $8.00 per 1M output tokens
        effective_date: effectiveDate
      }
    ];

    const updatedModels: string[] = [];
    const createdModels: string[] = [];
    const failedModels: string[] = [];

    logger.info({ totalModels: latestPricing.length }, 'Processing model pricing entries');

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
          logger.error({ err: error, model: pricing.model_name, provider: pricing.provider }, 'Failed to update model pricing');
          failedModels.push(pricing.model_name);
        } else {
          updatedModels.push(pricing.model_name);
        }
      } else {
        // Create new
        const { error } = await supabase
          .from('ai_model_pricing')
          .insert(pricing);

        if (error) {
          logger.error({ err: error, model: pricing.model_name, provider: pricing.provider }, 'Failed to create model pricing');
          failedModels.push(pricing.model_name);
        } else {
          createdModels.push(pricing.model_name);
        }
      }
    }

    logger.info({
      updated: updatedModels.length,
      created: createdModels.length,
      failed: failedModels.length,
      total: latestPricing.length
    }, 'Pricing sync complete');

    return NextResponse.json({
      success: true,
      message: `Pricing sync complete! Updated ${updatedModels.length} models, created ${createdModels.length} new models.${failedModels.length > 0 ? ` ${failedModels.length} failed.` : ''}`,
      data: {
        updated: updatedModels,
        created: createdModels,
        failed: failedModels,
        total: latestPricing.length
      }
    });

  } catch (error) {
    logger.error({ err: error }, 'Error syncing pricing');
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to sync pricing'
      },
      { status: 500 }
    );
  }
}
