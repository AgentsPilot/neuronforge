/**
 * Generate Workflow Plan API Endpoint
 *
 * Converts Enhanced Prompt → Logical IR → Natural Language Plan
 *
 * Flow:
 * 1. Receive Enhanced Prompt from client
 * 2. Generate IR using LLM (EnhancedPromptToIRGenerator)
 * 3. Validate IR
 * 4. Translate IR to natural language (IRToNaturalLanguageTranslator)
 * 5. Return plan to client for preview
 *
 * This is the first API call in the V6 workflow creation flow.
 */

import { NextRequest, NextResponse } from 'next/server'
// DEPRECATED: This route uses the Extended IR path which is being deprecated
// Use /api/v6/generate-declarative-ir for the production Declarative IR path
import { createIRGenerator } from '@/lib/agentkit/v6/generation/EnhancedPromptToIRGenerator_DEPRECATED'
import { createTranslator } from '@/lib/agentkit/v6/translation/IRToNaturalLanguageTranslator'
import type { EnhancedPrompt } from '@/lib/agentkit/v6/generation/EnhancedPromptToIRGenerator_DEPRECATED'
import type { NaturalLanguagePlan } from '@/lib/agentkit/v6/translation/IRToNaturalLanguageTranslator'
import type { ExtendedLogicalIR } from '@/lib/agentkit/v6/logical-ir/schemas/extended-ir-types'

// ============================================================================
// Types
// ============================================================================

interface GenerateWorkflowPlanRequest {
  enhancedPrompt: EnhancedPrompt
  modelProvider?: 'openai' | 'anthropic'
  userId?: string
}

interface GenerateWorkflowPlanResponse {
  success: boolean
  plan?: NaturalLanguagePlan
  ir?: ExtendedLogicalIR
  errors?: string[]
  warnings?: string[]
  metadata?: {
    generation_time_ms: number
    model_used: string
    tokens_used?: number
  }
}

// ============================================================================
// POST Handler
// ============================================================================

export async function POST(request: NextRequest) {
  console.log('[API] /api/v6/generate-workflow-plan - POST')

  const startTime = Date.now()

  try {
    // Parse request body
    const body: GenerateWorkflowPlanRequest = await request.json()
    console.log('[API] Enhanced prompt sections:', Object.keys(body.enhancedPrompt?.sections || {}))

    // Validate request
    if (!body.enhancedPrompt) {
      console.log('[API] ✗ Missing enhanced prompt')
      return NextResponse.json(
        {
          success: false,
          errors: ['Enhanced prompt is required']
        } as GenerateWorkflowPlanResponse,
        { status: 400 }
      )
    }

    // Validate enhanced prompt structure
    if (!body.enhancedPrompt.sections) {
      console.log('[API] ✗ Invalid enhanced prompt structure')
      return NextResponse.json(
        {
          success: false,
          errors: ['Enhanced prompt must have sections']
        } as GenerateWorkflowPlanResponse,
        { status: 400 }
      )
    }

    // STEP 1: Generate Logical IR
    console.log('[API] Step 1: Generating Logical IR...')
    const modelProvider = body.modelProvider || 'openai'
    const irGenerator = createIRGenerator(modelProvider)

    const irResult = await irGenerator.generate(body.enhancedPrompt)

    if (!irResult.success || !irResult.ir) {
      console.log('[API] ✗ IR generation failed:', irResult.errors)
      return NextResponse.json(
        {
          success: false,
          errors: irResult.errors || ['Failed to generate IR'],
          warnings: irResult.warnings
        } as GenerateWorkflowPlanResponse,
        { status: 500 }
      )
    }

    console.log('[API] ✓ IR generated successfully')
    console.log('[API] IR version:', irResult.ir.ir_version)
    console.log('[API] IR goal:', irResult.ir.goal)

    // STEP 2: Translate IR to Natural Language
    console.log('[API] Step 2: Translating IR to natural language...')
    const translator = createTranslator()
    const plan = translator.translate(irResult.ir)

    console.log('[API] ✓ Translation successful')
    console.log('[API] Plan steps:', plan.steps.length)

    // Calculate total time
    const totalTime = Date.now() - startTime

    // Return success response
    const response: GenerateWorkflowPlanResponse = {
      success: true,
      plan,
      ir: irResult.ir,
      warnings: irResult.warnings,
      metadata: {
        generation_time_ms: totalTime,
        model_used: irResult.metadata?.model || modelProvider,
        tokens_used: irResult.metadata?.tokens_used
      }
    }

    console.log('[API] ✓ Workflow plan generated in', totalTime, 'ms')

    return NextResponse.json(response, { status: 200 })
  } catch (error) {
    console.error('[API] ✗ Error generating workflow plan:', error)

    const errorMessage = error instanceof Error ? error.message : 'Unknown error'

    return NextResponse.json(
      {
        success: false,
        errors: [errorMessage]
      } as GenerateWorkflowPlanResponse,
      { status: 500 }
    )
  }
}

// ============================================================================
// OPTIONS Handler (for CORS)
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
