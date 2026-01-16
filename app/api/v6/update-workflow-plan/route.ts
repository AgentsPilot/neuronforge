/**
 * Update Workflow Plan API Endpoint
 *
 * Handles user corrections to workflow plans using natural language
 *
 * Flow:
 * 1. Receive user's correction message + current IR
 * 2. Extract correction intent using LLM (NaturalLanguageCorrectionHandler)
 * 3. Update IR based on intent
 * 4. Validate updated IR
 * 5. Re-translate to natural language
 * 6. Return updated plan to client
 *
 * This is called when user clicks "Edit Request" and submits a correction.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createCorrectionHandler } from '@/lib/agentkit/v6/translation/NaturalLanguageCorrectionHandler'
import { createTranslator } from '@/lib/agentkit/v6/translation/IRToNaturalLanguageTranslator'
import type { ExtendedLogicalIR } from '@/lib/agentkit/v6/logical-ir/schemas/extended-ir-types'
import type { NaturalLanguagePlan } from '@/lib/agentkit/v6/translation/IRToNaturalLanguageTranslator'
import type { CorrectionResult } from '@/lib/agentkit/v6/translation/NaturalLanguageCorrectionHandler'

// ============================================================================
// Types
// ============================================================================

interface UpdateWorkflowPlanRequest {
  correctionMessage: string
  currentIR: ExtendedLogicalIR
  modelProvider?: 'openai' | 'anthropic'
}

interface UpdateWorkflowPlanResponse {
  success: boolean
  plan?: NaturalLanguagePlan
  ir?: ExtendedLogicalIR
  changes?: string[]
  errors?: string[]
  clarificationNeeded?: string
}

// ============================================================================
// POST Handler
// ============================================================================

export async function POST(request: NextRequest) {
  console.log('[API] /api/v6/update-workflow-plan - POST')

  const startTime = Date.now()

  try {
    // Parse request body
    const body: UpdateWorkflowPlanRequest = await request.json()
    console.log('[API] Processing correction:', body.correctionMessage)

    // Validate request
    if (!body.correctionMessage) {
      console.log('[API] ✗ Missing correction message')
      return NextResponse.json(
        {
          success: false,
          errors: ['Correction message is required']
        } as UpdateWorkflowPlanResponse,
        { status: 400 }
      )
    }

    if (!body.currentIR) {
      console.log('[API] ✗ Missing current IR')
      return NextResponse.json(
        {
          success: false,
          errors: ['Current IR is required']
        } as UpdateWorkflowPlanResponse,
        { status: 400 }
      )
    }

    // STEP 1: Handle correction
    console.log('[API] Step 1: Processing correction with LLM...')
    const modelProvider = body.modelProvider || 'openai'
    const correctionHandler = createCorrectionHandler(modelProvider)

    const correctionResult: CorrectionResult = await correctionHandler.handleCorrection({
      userMessage: body.correctionMessage,
      currentIR: body.currentIR
    })

    if (!correctionResult.success || !correctionResult.updatedIR) {
      console.log('[API] ✗ Correction failed:', correctionResult.errors)
      return NextResponse.json(
        {
          success: false,
          errors: correctionResult.errors || ['Failed to process correction'],
          clarificationNeeded: correctionResult.clarificationNeeded
        } as UpdateWorkflowPlanResponse,
        { status: 400 }
      )
    }

    console.log('[API] ✓ Correction processed')
    console.log('[API] Changes:', correctionResult.changes)

    // STEP 2: Re-translate updated IR to natural language
    console.log('[API] Step 2: Re-translating IR to natural language...')
    const translator = createTranslator()
    const updatedPlan = translator.translate(correctionResult.updatedIR)

    console.log('[API] ✓ Re-translation successful')

    // Calculate total time
    const totalTime = Date.now() - startTime

    // Return success response
    const response: UpdateWorkflowPlanResponse = {
      success: true,
      plan: updatedPlan,
      ir: correctionResult.updatedIR,
      changes: correctionResult.changes
    }

    console.log('[API] ✓ Workflow plan updated in', totalTime, 'ms')

    return NextResponse.json(response, { status: 200 })
  } catch (error) {
    console.error('[API] ✗ Error updating workflow plan:', error)

    const errorMessage = error instanceof Error ? error.message : 'Unknown error'

    return NextResponse.json(
      {
        success: false,
        errors: [errorMessage]
      } as UpdateWorkflowPlanResponse,
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
