/**
 * API Endpoint: Generate Semantic Plan
 *
 * POST /api/v6/generate-semantic-plan
 *
 * Phase 1: Understanding
 * Takes Enhanced Prompt → Generates Semantic Plan (with assumptions, ambiguities, reasoning)
 */

import { NextRequest, NextResponse } from 'next/server'
import { SemanticPlanGenerator } from '@/lib/agentkit/v6/semantic-plan/SemanticPlanGenerator'
import type { EnhancedPrompt } from '@/lib/agentkit/v6/generation/types'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { enhanced_prompt, config } = body

    if (!enhanced_prompt) {
      return NextResponse.json(
        { error: 'Missing required field: enhanced_prompt' },
        { status: 400 }
      )
    }

    // Validate enhanced prompt structure
    if (!enhanced_prompt.sections) {
      return NextResponse.json(
        { error: 'Invalid enhanced_prompt: missing sections' },
        { status: 400 }
      )
    }

    console.log('[API] Generating semantic plan...')

    // Initialize generator
    const generator = new SemanticPlanGenerator({
      provider: config?.provider || 'openai',
      model: config?.model,
      temperature: config?.temperature,
      max_tokens: config?.max_tokens,
      openai_api_key: process.env.OPENAI_API_KEY,
      anthropic_api_key: process.env.ANTHROPIC_API_KEY
    })

    // Generate semantic plan
    const semanticPlan = await generator.generate(enhanced_prompt as EnhancedPrompt)

    console.log('[API] Semantic plan generated successfully')
    console.log(`[API] Assumptions: ${semanticPlan.assumptions.length}`)
    console.log(`[API] Ambiguities: ${semanticPlan.ambiguities.length}`)

    return NextResponse.json({
      success: true,
      semantic_plan: semanticPlan,
      metadata: {
        phase: 'understanding',
        provider: config?.provider || 'openai',
        model: config?.model || 'gpt-4o',
        timestamp: new Date().toISOString()
      }
    })
  } catch (error) {
    console.error('[API] Error generating semantic plan:', error)

    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    const errorStack = error instanceof Error ? error.stack : undefined

    return NextResponse.json(
      {
        success: false,
        error: 'Failed to generate semantic plan',
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
