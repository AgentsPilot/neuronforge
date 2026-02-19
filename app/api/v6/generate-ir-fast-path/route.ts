/**
 * Generate IR (Fast Path) API Endpoint
 *
 * POST /api/v6/generate-ir-fast-path
 *
 * Fast Path: Enhanced Prompt → IR Formalization (skips Semantic + Grounding)
 *
 * Used when:
 * - All services use OAuth authentication (well-known APIs)
 * - Plugins have fixed, documented schemas (no validation needed)
 * - Examples: Gmail, Google Sheets, HubSpot, Slack
 *
 * Benefits:
 * - 50% faster (2 LLM calls instead of 4)
 * - 75% cheaper (skip Semantic Plan + Grounding)
 * - No information loss (Enhanced Prompt has all data)
 *
 * Architecture:
 * Enhanced Prompt → IR Formalization (gpt-4o-mini) → Return IR
 */

import { NextRequest, NextResponse } from 'next/server'
import { IRFormalizer } from '@/lib/agentkit/v6/semantic-plan/IRFormalizer'
import { PluginManagerV2 } from '@/lib/server/plugin-manager-v2'
import type { DeclarativeLogicalIR } from '@/lib/agentkit/v6/logical-ir/schemas/declarative-ir-types'
import type { GroundedSemanticPlan } from '@/lib/agentkit/v6/semantic-plan/schemas/semantic-plan-types'
import { createLogger } from '@/lib/logger'

const logger = createLogger({ module: 'V6', route: '/api/v6/generate-ir-fast-path' })

// ============================================================================
// Types
// ============================================================================

interface GenerateIRFastPathRequest {
  enhanced_prompt: {
    sections: {
      data: string[]
      actions?: string[]
      output?: string[]
      delivery: string[]
      processing_steps?: string[]
    }
    specifics?: {
      services_involved?: string[]
      resolved_user_inputs?: Array<{
        key: string
        value: any
      }>
    }
  }
  config?: {
    provider?: 'openai' | 'anthropic'
    model?: string
    temperature?: number
    max_tokens?: number
  }
}

// ============================================================================
// POST Handler
// ============================================================================

export async function POST(request: NextRequest) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID()
  const requestLogger = logger.child({ correlationId })
  const startTime = Date.now()

  requestLogger.info('Fast Path IR generation started')

  try {
    const body: GenerateIRFastPathRequest = await request.json()

    // Validate request
    if (!body.enhanced_prompt || !body.enhanced_prompt.sections) {
      requestLogger.warn('Missing required field: enhanced_prompt')
      return NextResponse.json(
        { error: 'Missing required field: enhanced_prompt' },
        { status: 400 }
      )
    }

    const { enhanced_prompt, config = {} } = body
    const servicesInvolved = enhanced_prompt.specifics?.services_involved || []

    requestLogger.debug({
      servicesInvolved,
      hasProcessingSteps: !!enhanced_prompt.sections.processing_steps
    }, 'Request details')

    // ========================================================================
    // STEP 1: Create Minimal "Grounded Plan" for Fast Path
    // ========================================================================
    // Fast path skips actual Semantic Plan generation, but IRFormalizer
    // expects a GroundedSemanticPlan. Create a minimal one from Enhanced Prompt.

    requestLogger.info('Creating minimal grounded plan from Enhanced Prompt')

    const minimalGroundedPlan: GroundedSemanticPlan = {
      plan_version: '1.0',
      goal: enhanced_prompt.sections.data.join('; ') + ' → ' + enhanced_prompt.sections.delivery.join('; '),

      // Minimal understanding (extracted from Enhanced Prompt)
      understanding: {
        data_sources: enhanced_prompt.sections.data.map((d, idx) => ({
          type: 'api' as const,
          source_description: d,
          location: servicesInvolved[idx] || 'unknown',
          role: `Data source ${idx + 1}`,
          expected_fields: [] // No assumptions needed for fast path
        })),
        delivery: {
          pattern: 'summary' as const,
          recipients_description: enhanced_prompt.sections.delivery[0] || 'user',
          recipient_resolution_strategy: 'direct'
        }
      },

      // No assumptions for fast path (OAuth APIs have fixed schemas)
      assumptions: [],
      inferences: [],
      ambiguities: [],
      reasoning_trace: [],

      // Mark as grounded (even though we skipped actual grounding)
      grounded: true,
      grounding_results: [], // No validations needed for OAuth APIs
      grounding_errors: [],
      grounding_confidence: 1.0, // High confidence for known APIs
      grounding_timestamp: new Date().toISOString(),
      validated_assumptions_count: 0,
      total_assumptions_count: 0,
      all_assumptions_skipped: true, // Fast path indicator
      skipped_assumptions_count: 0
    }

    // ========================================================================
    // STEP 2: Initialize PluginManager and IRFormalizer
    // ========================================================================

    const pluginManager = await PluginManagerV2.getInstance()
    requestLogger.debug({ pluginCount: Object.keys(pluginManager.getAvailablePlugins()).length }, 'PluginManager initialized')

    // Use cheaper model for fast path (gpt-4o-mini instead of gpt-5.2)
    const model = config.model || 'gpt-4o-mini'
    const temperature = config.temperature ?? 0.1 // Slightly higher than 0 for processing_order reasoning

    requestLogger.info({ model, temperature }, 'Initializing IRFormalizer')

    const formalizer = new IRFormalizer({
      model,
      temperature,
      max_tokens: config.max_tokens,
      openai_api_key: process.env.OPENAI_API_KEY,
      pluginManager,
      servicesInvolved,
      resolvedUserInputs: enhanced_prompt.specifics?.resolved_user_inputs,
      enhancedPrompt: enhanced_prompt // For processing_order generation
    })

    // ========================================================================
    // STEP 3: Formalize to IR
    // ========================================================================

    requestLogger.info('Formalizing Enhanced Prompt to IR (fast path)')
    const formalizationStart = Date.now()

    const result = await formalizer.formalize(minimalGroundedPlan)

    const formalizationTime = Date.now() - formalizationStart

    requestLogger.info({
      duration: formalizationTime,
      groundedFactsUsed: Object.keys(result.formalization_metadata.grounded_facts_used).length,
      missingFacts: result.formalization_metadata.missing_facts.length
    }, 'Formalization complete')

    // ========================================================================
    // STEP 4: Validate Formalization
    // ========================================================================

    const validation = formalizer.validateFormalization(
      result.ir,
      result.formalization_metadata.grounded_facts_used
    )

    if (!validation.valid) {
      requestLogger.error({ validationErrors: validation.errors }, 'Formalization validation failed')
    }

    if (validation.warnings.length > 0) {
      requestLogger.warn({ validationWarnings: validation.warnings }, 'Formalization warnings')
    }

    // ========================================================================
    // STEP 5: Return IR
    // ========================================================================

    const totalTime = Date.now() - startTime

    requestLogger.info({
      totalTime,
      formalizationTime,
      pathway: 'fast',
      valid: validation.valid
    }, 'Fast path IR generation complete')

    return NextResponse.json({
      success: true,
      pathway: 'fast',
      ir: result.ir,
      formalization_metadata: result.formalization_metadata,
      validation: {
        valid: validation.valid,
        errors: validation.errors,
        warnings: validation.warnings
      },
      metadata: {
        phase: 'fast_path_formalization',
        model,
        temperature,
        confidence: result.formalization_metadata.formalization_confidence,
        timestamp: result.formalization_metadata.timestamp,
        total_time_ms: totalTime,
        formalization_time_ms: formalizationTime,
        time_saved_ms: 5000 + 500 // Estimated: ~5s semantic + ~0.5s grounding
      }
    })
  } catch (error) {
    const duration = Date.now() - startTime
    requestLogger.error({ err: error, duration }, 'Fast path IR generation failed')

    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    const errorStack = error instanceof Error ? error.stack : undefined

    return NextResponse.json(
      {
        success: false,
        pathway: 'fast',
        error: 'Failed to generate IR via fast path',
        details: errorMessage,
        stack: process.env.NODE_ENV === 'development' ? errorStack : undefined
      },
      { status: 500 }
    )
  }
}

// ============================================================================
// CORS Headers
// ============================================================================

export async function OPTIONS(request: NextRequest) {
  return new NextResponse(null, {
    status: 200,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization'
    }
  })
}
