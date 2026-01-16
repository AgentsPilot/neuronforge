/**
 * Compile Workflow API Endpoint
 *
 * Converts Logical IR → PILOT_DSL Workflow (deterministic compilation)
 *
 * Flow:
 * 1. Receive Logical IR from client (after user approves plan)
 * 2. Compile IR using LogicalIRCompiler (deterministic, no LLM)
 * 3. Return PILOT_DSL workflow ready for execution
 *
 * This is called AFTER the user approves the workflow plan.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createCompiler } from '@/lib/agentkit/v6/compiler/LogicalIRCompiler'
import type { ExtendedLogicalIR } from '@/lib/agentkit/v6/logical-ir/schemas/extended-ir-types'
import type { CompilationResult } from '@/lib/agentkit/v6/compiler/LogicalIRCompiler'
import type { WorkflowStep } from '@/lib/agentkit/v4/types/pilot-dsl-types'
import { PluginManagerV2 } from '@/lib/server/plugin-manager-v2'

// ============================================================================
// Types
// ============================================================================

interface CompileWorkflowRequest {
  ir: ExtendedLogicalIR
  userId?: string
  agentId?: string
  availablePlugins?: string[]
}

interface CompileWorkflowResponse {
  success: boolean
  workflow?: {
    workflow_steps: WorkflowStep[]
    metadata: {
      ir_version: string
      goal: string
      compiled_at: string
      compiler_version: string
    }
  }
  errors?: string[]
  warnings?: string[]
  metadata?: {
    compilation_time_ms: number
    rule_used: string
    step_count: number
    deterministic_step_percentage: number
  }
}

// ============================================================================
// POST Handler
// ============================================================================

export async function POST(request: NextRequest) {
  console.log('[API] /api/v6/compile-workflow - POST')

  const startTime = Date.now()

  try {
    // Parse request body
    const body: CompileWorkflowRequest = await request.json()
    console.log('[API] Compiling IR with goal:', body.ir?.goal)

    // Validate request
    if (!body.ir) {
      console.log('[API] ✗ Missing IR')
      return NextResponse.json(
        {
          success: false,
          errors: ['Logical IR is required']
        } as CompileWorkflowResponse,
        { status: 400 }
      )
    }

    // Validate IR structure
    if (!body.ir.ir_version || !body.ir.goal || !body.ir.data_sources || !body.ir.delivery) {
      console.log('[API] ✗ Invalid IR structure')
      return NextResponse.json(
        {
          success: false,
          errors: ['Invalid IR structure - missing required fields']
        } as CompileWorkflowResponse,
        { status: 400 }
      )
    }

    // STEP 1: Get PluginManagerV2 instance
    console.log('[API] Step 1: Initializing PluginManagerV2...')
    const pluginManager = await PluginManagerV2.getInstance()
    console.log('[API] ✓ PluginManager initialized with', Object.keys(pluginManager.getAvailablePlugins()).length, 'plugins')

    // STEP 2: Create compiler with rules and plugin manager
    console.log('[API] Step 2: Creating compiler...')
    const compiler = await createCompiler(pluginManager)
    console.log('[API] ✓ Compiler created with', compiler.getRules().length, 'rules')

    // STEP 3: Pre-compilation validation
    console.log('[API] Step 3: Pre-compilation validation...')
    const validation = await compiler.validateBeforeCompilation(body.ir)

    if (!validation.valid) {
      console.log('[API] ✗ Pre-compilation validation failed:', validation.errors)
      return NextResponse.json(
        {
          success: false,
          errors: validation.errors,
          warnings: validation.warnings
        } as CompileWorkflowResponse,
        { status: 400 }
      )
    }

    if (validation.warnings.length > 0) {
      console.log('[API] ⚠ Validation warnings:', validation.warnings)
    }

    // STEP 4: Compile IR to workflow
    console.log('[API] Step 4: Compiling IR to workflow...')

    // Get available plugin names from PluginManager if not provided
    const availablePlugins = body.availablePlugins || Object.keys(pluginManager.getAvailablePlugins())

    const compilationResult: CompilationResult = await compiler.compile(body.ir, {
      available_plugins: availablePlugins,
      plugin_manager: pluginManager,
      user_id: body.userId,
      agent_id: body.agentId
    })

    if (!compilationResult.success || !compilationResult.workflow) {
      console.log('[API] ✗ Compilation failed:', compilationResult.errors)
      return NextResponse.json(
        {
          success: false,
          errors: compilationResult.errors || ['Compilation failed'],
          warnings: compilationResult.warnings
        } as CompileWorkflowResponse,
        { status: 500 }
      )
    }

    console.log('[API] ✓ Compilation successful')
    console.log('[API] Rule used:', compilationResult.metadata?.rule_used)
    console.log('[API] Steps generated:', compilationResult.metadata?.step_count)
    console.log('[API] Deterministic:', compilationResult.metadata?.deterministic_step_percentage.toFixed(1) + '%')

    // Calculate total time
    const totalTime = Date.now() - startTime

    // Return success response
    const response: CompileWorkflowResponse = {
      success: true,
      workflow: compilationResult.workflow,
      warnings: [...(validation.warnings || []), ...(compilationResult.warnings || [])],
      metadata: compilationResult.metadata
    }

    console.log('[API] ✓ Workflow compiled in', totalTime, 'ms')

    return NextResponse.json(response, { status: 200 })
  } catch (error) {
    console.error('[API] ✗ Error compiling workflow:', error)

    const errorMessage = error instanceof Error ? error.message : 'Unknown error'

    return NextResponse.json(
      {
        success: false,
        errors: [errorMessage]
      } as CompileWorkflowResponse,
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
