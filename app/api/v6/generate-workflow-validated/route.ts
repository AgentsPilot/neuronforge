/**
 * API Endpoint: Generate Workflow with Validation
 *
 * POST /api/v6/generate-workflow-validated
 *
 * Full V6 Pipeline with Validation Gates:
 * Enhanced Prompt → Hard Requirements → Semantic Plan → [Gate 1]
 *   → Grounding → [Gate 2] → IR → [Gate 3]
 *   → Compilation → [Gate 4] → Final Validation → [Gate 5]
 *   → PASS or FAIL
 *
 * Following OpenAI's compiler approach:
 * - Workflow creation is COMPILATION, not generation
 * - Each transformation is lossless, traceable, constraint-preserving
 * - A workflow that violates intent MUST BE REJECTED
 */

import { NextRequest, NextResponse } from 'next/server'
import { V6PipelineOrchestrator, type PipelineConfig } from '@/lib/agentkit/v6/pipeline/V6PipelineOrchestrator'
import type { EnhancedPrompt } from '@/lib/agentkit/v6/semantic-plan/SemanticPlanGenerator'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { enhanced_prompt, config } = body

    // Validate input
    if (!enhanced_prompt) {
      return NextResponse.json(
        { error: 'Missing required field: enhanced_prompt' },
        { status: 400 }
      )
    }

    if (!enhanced_prompt.sections) {
      return NextResponse.json(
        { error: 'Invalid enhanced_prompt: missing sections' },
        { status: 400 }
      )
    }

    console.log('[API] Starting validated workflow generation...')

    // Run pipeline with validation gates
    const orchestrator = new V6PipelineOrchestrator()
    const result = await orchestrator.run(
      enhanced_prompt as EnhancedPrompt,
      config
    )

    // Check result
    if (!result.success) {
      console.error('[API] ❌ Pipeline FAILED')
      console.error(`[API] Phase: ${result.error?.phase}`)
      console.error(`[API] Message: ${result.error?.message}`)

      // Return detailed error information
      return NextResponse.json(
        {
          success: false,
          error: {
            phase: result.error?.phase,
            message: result.error?.message,
            gate_result: result.error?.gate
          }
        },
        { status: 422 } // Unprocessable Entity - validation failed
      )
    }

    // Get lineage trace for debugging
    const lineage = orchestrator.getLineageTrace(
      result.requirementMap!,
      result.hardRequirements!
    )

    console.log('[API] ✅ Workflow generated and validated successfully')
    console.log(`[API] Requirements: ${result.hardRequirements?.requirements.length}`)
    console.log(`[API] Enforced: ${lineage.filter(l => l.status === 'enforced').length}`)

    // Return successful result
    return NextResponse.json({
      success: true,
      workflow: result.workflow,
      hard_requirements: {
        count: result.hardRequirements?.requirements.length,
        unit_of_work: result.hardRequirements?.unit_of_work,
        thresholds_count: result.hardRequirements?.thresholds.length,
        invariants_count: result.hardRequirements?.invariants.length,
        requirements: result.hardRequirements?.requirements
      },
      validation_results: {
        semantic: result.validationResults?.semantic.result,
        grounding: result.validationResults?.grounding.result,
        ir: result.validationResults?.ir.result,
        compilation: result.validationResults?.compilation.result,
        final: result.validationResults?.final.result
      },
      lineage: lineage,
      metadata: {
        total_requirements: result.hardRequirements?.requirements.length,
        enforced_requirements: lineage.filter(l => l.status === 'enforced').length,
        pipeline_complete: true
      }
    })
  } catch (error) {
    console.error('[API] Unexpected error:', error)

    return NextResponse.json(
      {
        success: false,
        error: {
          phase: 'api',
          message: error instanceof Error ? error.message : 'Unknown error occurred'
        }
      },
      { status: 500 }
    )
  }
}
