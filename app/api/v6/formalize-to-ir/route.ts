/**
 * API Endpoint: Formalize to IR
 *
 * POST /api/v6/formalize-to-ir
 *
 * Phase 3: Formalization
 * Takes Grounded Semantic Plan → Maps to Precise IR → Returns Executable IR
 */

import { NextRequest, NextResponse } from 'next/server'
import { IRFormalizer } from '@/lib/agentkit/v6/semantic-plan/IRFormalizer'
import { PluginManagerV2 } from '@/lib/server/plugin-manager-v2'
import type { GroundedSemanticPlan } from '@/lib/agentkit/v6/semantic-plan/schemas/semantic-plan-types'
import type { HardRequirements } from '@/lib/agentkit/v6/requirements/HardRequirementsExtractor'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { grounded_plan, config, enhanced_prompt, hard_requirements } = body

    if (!grounded_plan) {
      return NextResponse.json(
        { error: 'Missing required field: grounded_plan' },
        { status: 400 }
      )
    }

    // Validate grounded plan structure
    if (!grounded_plan.grounded) {
      return NextResponse.json(
        { error: 'Invalid grounded_plan: plan is not grounded (missing grounded=true)' },
        { status: 400 }
      )
    }

    if (!grounded_plan.grounding_results || !Array.isArray(grounded_plan.grounding_results)) {
      return NextResponse.json(
        { error: 'Invalid grounded_plan: missing grounding_results array' },
        { status: 400 }
      )
    }

    console.log('[API] Formalizing to IR...')
    console.log(`[API] Grounding confidence: ${(grounded_plan.grounding_confidence * 100).toFixed(1)}%`)

    // Log hard requirements if provided
    if (hard_requirements) {
      console.log('[API] Hard Requirements provided:')
      console.log(`  - Requirements count: ${hard_requirements.requirements?.length || 0}`)
      console.log(`  - Unit of work: ${hard_requirements.unit_of_work || 'none'}`)
      console.log(`  - Thresholds: ${hard_requirements.thresholds?.length || 0}`)
      console.log(`  - Routing rules: ${hard_requirements.routing_rules?.length || 0}`)
      console.log(`  - Invariants: ${hard_requirements.invariants?.length || 0}`)
    } else {
      console.log('[API] No hard requirements provided')
    }

    // Extract services_involved from Enhanced Prompt for scoped plugin loading
    const servicesInvolved = enhanced_prompt?.specifics?.services_involved || []
    console.log(`[API] Services involved: ${servicesInvolved.length > 0 ? servicesInvolved.join(', ') : 'none (will load all plugins)'}`)

    // Initialize PluginManagerV2 to provide available plugins to IRFormalizer
    const pluginManager = await PluginManagerV2.getInstance()
    console.log(`[API] PluginManager initialized with ${Object.keys(pluginManager.getAvailablePlugins()).length} plugins`)

    // Initialize formalizer
    const formalizer = new IRFormalizer({
      model: config?.model || 'gpt-5.2',
      temperature: config?.temperature ?? 0.0, // Very low for mechanical mapping
      max_tokens: config?.max_tokens,
      openai_api_key: process.env.OPENAI_API_KEY,
      pluginManager, // ← Pass PluginManagerV2 so LLM knows available plugins
      servicesInvolved: servicesInvolved.length > 0 ? servicesInvolved : undefined, // ← Pass services_involved for scoped loading
      enhancedPrompt: enhanced_prompt // ← Hybrid Order Architecture: Pass full Enhanced Prompt for processing_order derivation
    })

    // Formalize to IR
    // CRITICAL: Pass hard_requirements to enforce constraints during IR generation
    const result = await formalizer.formalize(
      grounded_plan as GroundedSemanticPlan,
      hard_requirements as HardRequirements | undefined
    )

    console.log('[API] Formalization complete')
    console.log(`[API] Grounded facts used: ${Object.keys(result.formalization_metadata.grounded_facts_used).length}`)
    console.log(`[API] Missing facts: ${result.formalization_metadata.missing_facts.length}`)

    // Validate formalization
    const validation = formalizer.validateFormalization(
      result.ir,
      result.formalization_metadata.grounded_facts_used
    )

    console.log(`[API] Formalization validation: ${validation.valid ? 'VALID' : 'INVALID'}`)
    if (validation.errors.length > 0) {
      console.error('[API] Formalization errors:', validation.errors)
    }
    if (validation.warnings.length > 0) {
      console.warn('[API] Formalization warnings:', validation.warnings)
    }

    return NextResponse.json({
      success: true,
      ir: result.ir,
      formalization_metadata: result.formalization_metadata,
      validation: {
        valid: validation.valid,
        errors: validation.errors,
        warnings: validation.warnings
      },
      hard_requirements: hard_requirements, // Include in response for downstream phases
      metadata: {
        phase: 'formalization',
        provider: config?.provider || 'openai',
        model: config?.model || 'gpt-4o',
        confidence: result.formalization_metadata.formalization_confidence,
        timestamp: result.formalization_metadata.timestamp,
        requirements_enforced: hard_requirements ? hard_requirements.requirements?.length || 0 : 0
      }
    })
  } catch (error) {
    console.error('[API] Error formalizing to IR:', error)

    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    const errorStack = error instanceof Error ? error.stack : undefined

    return NextResponse.json(
      {
        success: false,
        error: 'Failed to formalize to IR',
        details: errorMessage,
        stack: process.env.NODE_ENV === 'development' ? errorStack : undefined
      },
      { status: 500 }
    )
  }
}

// CORS headers (if needed)
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
