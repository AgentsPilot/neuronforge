import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'
import { SystemConfigService } from '@/lib/services/SystemConfigService'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export const dynamic = 'force-dynamic'

/**
 * GET /api/admin/helpbot-config
 * Fetch current helpbot configuration
 */
export async function GET() {
  try {
    const settings = await SystemConfigService.getByCategory(supabase, 'helpbot')

    // Transform to friendly format
    const config = {
      general: {
        model: settings.find((s) => s.key === 'helpbot_general_model')?.value || 'llama-3.1-8b-instant',
        temperature: settings.find((s) => s.key === 'helpbot_general_temperature')?.value || 0.2,
        maxTokens: settings.find((s) => s.key === 'helpbot_general_max_tokens')?.value || 300,
      },
      input: {
        model: settings.find((s) => s.key === 'helpbot_input_model')?.value || 'llama-3.1-8b-instant',
        temperature: settings.find((s) => s.key === 'helpbot_input_temperature')?.value || 0.3,
        maxTokens: settings.find((s) => s.key === 'helpbot_input_max_tokens')?.value || 400,
      },
      semantic: {
        enabled: settings.find((s) => s.key === 'helpbot_semantic_search_enabled')?.value ?? true,
        embeddingModel: settings.find((s) => s.key === 'helpbot_embedding_model')?.value || 'text-embedding-3-small',
        cacheThreshold: settings.find((s) => s.key === 'helpbot_semantic_threshold')?.value || 0.85,
        faqThreshold: settings.find((s) => s.key === 'helpbot_semantic_faq_threshold')?.value || 0.80,
        autoPromoteEnabled: settings.find((s) => s.key === 'helpbot_auto_promote_enabled')?.value ?? false,
        autoPromoteThreshold: settings.find((s) => s.key === 'helpbot_auto_promote_threshold')?.value || 10,
        autoPromoteMinThumbsUp: settings.find((s) => s.key === 'helpbot_auto_promote_min_thumbs_up')?.value || 3,
      },
      provider: settings.find((s) => s.key === 'helpbot_provider')?.value || 'groq',
      enabled: settings.find((s) => s.key === 'helpbot_enabled')?.value ?? true,
      cacheEnabled: settings.find((s) => s.key === 'helpbot_cache_enabled')?.value ?? true,
      faqEnabled: settings.find((s) => s.key === 'helpbot_faq_enabled')?.value ?? true,
    }

    return NextResponse.json({ success: true, config })
  } catch (error: any) {
    console.error('[HelpBot Config API] GET Error:', error)
    return NextResponse.json({ success: false, error: error.message }, { status: 500 })
  }
}

/**
 * PUT /api/admin/helpbot-config
 * Update helpbot configuration
 */
export async function PUT(request: NextRequest) {
  try {
    const { config } = await request.json()

    if (!config) {
      return NextResponse.json({ success: false, error: 'Config object required' }, { status: 400 })
    }

    const updates = {
      helpbot_general_model: config.general.model,
      helpbot_general_temperature: config.general.temperature,
      helpbot_general_max_tokens: config.general.maxTokens,
      helpbot_input_model: config.input.model,
      helpbot_input_temperature: config.input.temperature,
      helpbot_input_max_tokens: config.input.maxTokens,
      helpbot_semantic_search_enabled: config.semantic.enabled,
      helpbot_embedding_model: config.semantic.embeddingModel,
      helpbot_semantic_threshold: config.semantic.cacheThreshold,
      helpbot_semantic_faq_threshold: config.semantic.faqThreshold,
      helpbot_auto_promote_enabled: config.semantic.autoPromoteEnabled,
      helpbot_auto_promote_threshold: config.semantic.autoPromoteThreshold,
      helpbot_auto_promote_min_thumbs_up: config.semantic.autoPromoteMinThumbsUp,
      helpbot_provider: config.provider,
      helpbot_enabled: config.enabled,
      helpbot_cache_enabled: config.cacheEnabled,
      helpbot_faq_enabled: config.faqEnabled,
    }

    await SystemConfigService.setMultiple(supabase, updates)

    return NextResponse.json({
      success: true,
      message: 'HelpBot configuration updated successfully',
    })
  } catch (error: any) {
    console.error('[HelpBot Config API] PUT Error:', error)
    return NextResponse.json({ success: false, error: error.message }, { status: 500 })
  }
}
