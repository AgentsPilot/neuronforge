/**
 * Generate Declarative IR API Endpoint
 *
 * Converts Enhanced Prompt → Declarative IR using LLM
 *
 * Flow:
 * 1. Receive Enhanced Prompt from client
 * 2. Call LLM with declarative system prompt (NO IDs, NO loops)
 * 3. Validate IR with forbidden token checking
 * 4. Return validated declarative IR or errors
 *
 * This is the FIRST step in the pure declarative pipeline:
 * Enhanced Prompt → Declarative IR → Compiler → PILOT DSL
 */

import { NextRequest, NextResponse } from 'next/server'
import { EnhancedPromptToDeclarativeIRGenerator } from '@/lib/agentkit/v6/generation/EnhancedPromptToDeclarativeIRGenerator'
import type { DeclarativeIRGenerationResult } from '@/lib/agentkit/v6/generation/EnhancedPromptToDeclarativeIRGenerator'

// ============================================================================
// Types
// ============================================================================

interface GenerateDeclarativeIRRequest {
  enhancedPrompt: {
    sections: {
      data: string[]
      actions?: string[]
      output?: string[]
      delivery: string[]
      processing_steps?: string[]
    }
    // Production format includes specifics with key resolved inputs like filter rules
    specifics?: {
      services_involved?: string[]
      user_inputs_required?: any[]
      resolved_user_inputs?: Array<{
        key: string
        value: any
      }>
    }
  }
  modelProvider?: 'openai' | 'anthropic'
  modelName?: string
}

interface GenerateDeclarativeIRResponse {
  success: boolean
  ir?: any
  errors?: string[]
  warnings?: string[]
  validation?: {
    valid: boolean
    errors?: any[]
  }
  metadata?: {
    model: string
    tokens_used: number
    generation_time_ms: number
    forbidden_tokens_found?: string[]
  }
}

// ============================================================================
// POST Handler
// ============================================================================

export async function POST(request: NextRequest) {
  console.log('[API] /api/v6/generate-declarative-ir - POST')

  const startTime = Date.now()

  try {
    // Parse request body
    const body: GenerateDeclarativeIRRequest = await request.json()
    console.log('[API] Generating declarative IR from enhanced prompt')

    // Validate request
    if (!body.enhancedPrompt || !body.enhancedPrompt.sections) {
      console.log('[API] ✗ Missing enhanced prompt')
      return NextResponse.json(
        {
          success: false,
          errors: ['Enhanced prompt is required']
        } as GenerateDeclarativeIRResponse,
        { status: 400 }
      )
    }

    // Validate required sections
    const { sections } = body.enhancedPrompt
    if (!sections.data || !sections.delivery) {
      console.log('[API] ✗ Missing required sections (data, delivery)')
      return NextResponse.json(
        {
          success: false,
          errors: ['Enhanced prompt must include data and delivery sections']
        } as GenerateDeclarativeIRResponse,
        { status: 400 }
      )
    }

    // STEP 1: Initialize generator
    console.log('[API] Step 1: Initializing declarative IR generator...')
    const generator = new EnhancedPromptToDeclarativeIRGenerator({
      model_provider: body.modelProvider || 'openai',
      model_name: body.modelName,
      temperature: 0.1
    })

    // STEP 2: Generate declarative IR
    console.log('[API] Step 2: Generating declarative IR with LLM...')
    const result: DeclarativeIRGenerationResult = await generator.generate(body.enhancedPrompt)

    if (!result.success || !result.ir) {
      console.log('[API] ✗ IR generation failed:', result.errors)

      return NextResponse.json(
        {
          success: false,
          errors: result.errors || ['Failed to generate declarative IR'],
          validation: result.validation,
          metadata: result.metadata
        } as GenerateDeclarativeIRResponse,
        { status: 400 }
      )
    }

    console.log('[API] ✓ Declarative IR generated successfully')
    console.log('[API] IR version:', result.ir.ir_version)
    console.log('[API] Goal:', result.ir.goal)

    // Check if validation passed
    if (result.validation && !result.validation.valid) {
      console.log('[API] ⚠ IR validation has warnings but succeeded')
    }

    // Return success response
    const response: GenerateDeclarativeIRResponse = {
      success: true,
      ir: result.ir,
      warnings: result.warnings,
      validation: result.validation,
      metadata: result.metadata
    }

    console.log('[API] ✓ Declarative IR generation completed in', result.metadata?.generation_time_ms, 'ms')

    return NextResponse.json(response, { status: 200 })
  } catch (error) {
    console.error('[API] ✗ Error generating declarative IR:', error)

    const errorMessage = error instanceof Error ? error.message : 'Unknown error'

    return NextResponse.json(
      {
        success: false,
        errors: [errorMessage]
      } as GenerateDeclarativeIRResponse,
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
