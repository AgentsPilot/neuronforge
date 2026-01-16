/**
 * API Endpoint: Ground Semantic Plan
 *
 * POST /api/v6/ground-semantic-plan
 *
 * Phase 2: Grounding (Validation)
 * Takes Semantic Plan + Data Source Metadata → Validates Assumptions → Returns Grounded Plan
 */

import { NextRequest, NextResponse } from 'next/server'
import { GroundingEngine } from '@/lib/agentkit/v6/semantic-plan/grounding/GroundingEngine'
import type { SemanticPlan } from '@/lib/agentkit/v6/semantic-plan/schemas/semantic-plan-types'
import type { DataSourceMetadata } from '@/lib/agentkit/v6/semantic-plan/grounding/DataSampler'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { semantic_plan, data_source_metadata, config } = body

    if (!semantic_plan) {
      return NextResponse.json(
        { error: 'Missing required field: semantic_plan' },
        { status: 400 }
      )
    }

    if (!data_source_metadata) {
      return NextResponse.json(
        { error: 'Missing required field: data_source_metadata' },
        { status: 400 }
      )
    }

    // Validate semantic plan structure
    if (!semantic_plan.assumptions || !Array.isArray(semantic_plan.assumptions)) {
      return NextResponse.json(
        { error: 'Invalid semantic_plan: missing assumptions array' },
        { status: 400 }
      )
    }

    // Validate data source metadata
    if (!data_source_metadata.type) {
      return NextResponse.json(
        { error: 'Invalid data_source_metadata: missing type' },
        { status: 400 }
      )
    }

    console.log('[API] Grounding semantic plan...')
    console.log(`[API] Assumptions to validate: ${semantic_plan.assumptions.length}`)

    // Initialize grounding engine
    const groundingEngine = new GroundingEngine()

    // Ground the plan
    const groundedPlan = await groundingEngine.ground({
      semantic_plan: semantic_plan as SemanticPlan,
      data_source_metadata: data_source_metadata as DataSourceMetadata,
      config: {
        min_confidence: config?.min_confidence,
        fail_fast: config?.fail_fast,
        require_confirmation_threshold: config?.require_confirmation_threshold,
        max_candidates: config?.max_candidates
      }
    })

    console.log('[API] Grounding complete')
    console.log(`[API] Validated: ${groundedPlan.validated_assumptions_count}/${groundedPlan.total_assumptions_count}`)
    console.log(`[API] Confidence: ${(groundedPlan.grounding_confidence * 100).toFixed(1)}%`)

    // Extract grounded facts for easy access
    const groundedFacts: Record<string, any> = {}
    groundedPlan.grounding_results.forEach(result => {
      if (result.validated && result.resolved_value) {
        groundedFacts[result.assumption_id] = result.resolved_value
      }
    })

    return NextResponse.json({
      success: true,
      grounded_plan: groundedPlan,
      grounded_facts: groundedFacts,
      metadata: {
        phase: 'grounding',
        validated_count: groundedPlan.validated_assumptions_count,
        total_count: groundedPlan.total_assumptions_count,
        confidence: groundedPlan.grounding_confidence,
        errors_count: groundedPlan.grounding_errors.length,
        timestamp: groundedPlan.grounding_timestamp
      }
    })
  } catch (error) {
    console.error('[API] Error grounding semantic plan:', error)

    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    const errorStack = error instanceof Error ? error.stack : undefined

    return NextResponse.json(
      {
        success: false,
        error: 'Failed to ground semantic plan',
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
