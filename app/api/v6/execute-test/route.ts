/**
 * V6 Test Execution Endpoint
 *
 * Executes a compiled PILOT DSL workflow without requiring a permanent agent record.
 * Creates a temporary in-memory agent for testing purposes only.
 *
 * This endpoint is designed for the V6 declarative test page to validate
 * that compiled workflows are executable with real plugins.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabaseServer'
import { WorkflowPilot } from '@/lib/pilot/WorkflowPilot'
import { randomUUID } from 'crypto'

// ============================================================================
// Types
// ============================================================================

interface ExecuteTestRequest {
  workflow: any[]
  plugins_required: string[]
  user_id?: string
  workflow_name?: string
  input_variables?: Record<string, any>
}

interface ExecuteTestResponse {
  success: boolean
  data?: {
    stepsCompleted: number
    stepsFailed: number
    stepsSkipped: number
    execution_time_ms: number
    tokens_used: number
    output: any
    completedStepIds: string[]
    failedStepIds: string[]
    skippedStepIds: string[]
  }
  error?: string
}

// ============================================================================
// POST Handler
// ============================================================================

export async function POST(request: NextRequest) {
  console.log('[V6-TEST-EXEC] Test execution request received')

  const startTime = Date.now()

  try {
    // Parse request body
    const body: ExecuteTestRequest = await request.json()
    console.log('[V6-TEST-EXEC] Workflow steps:', body.workflow?.length)
    console.log('[V6-TEST-EXEC] Plugins required:', body.plugins_required)

    // Validate request
    if (!body.workflow || !Array.isArray(body.workflow) || body.workflow.length === 0) {
      return NextResponse.json(
        {
          success: false,
          error: 'Workflow array is required and must not be empty'
        } as ExecuteTestResponse,
        { status: 400 }
      )
    }

    // Create Supabase client (admin client for user lookup)
    const supabase = createServerSupabaseClient()

    // Resolve user ID - handle both UUID and email formats
    let userId: string

    if (!body.user_id || body.user_id === 'test-user') {
      // Default test user - use a fixed UUID for testing
      userId = '00000000-0000-0000-0000-000000000000'
      console.log('[V6-TEST-EXEC] Using default test user UUID')
    } else if (body.user_id.includes('@')) {
      // Email provided - look up the user UUID from Supabase Auth
      console.log('[V6-TEST-EXEC] Looking up user by email:', body.user_id)

      // Use Supabase Admin API to query auth.users
      const { data: { users }, error } = await supabase.auth.admin.listUsers()

      if (error) {
        console.error('[V6-TEST-EXEC] Failed to list users:', error)
        // Fallback: use default test UUID if lookup fails
        userId = '00000000-0000-0000-0000-000000000000'
        console.log('[V6-TEST-EXEC] Lookup failed, using default test UUID')
      } else {
        const user = users.find(u => u.email === body.user_id)
        if (user) {
          userId = user.id
          console.log('[V6-TEST-EXEC] Resolved user UUID:', userId)
        } else {
          // User not found - use default test UUID
          userId = '00000000-0000-0000-0000-000000000000'
          console.log('[V6-TEST-EXEC] User not found, using default test UUID')
        }
      }
    } else {
      // Assume it's already a UUID
      userId = body.user_id
      console.log('[V6-TEST-EXEC] Using provided user UUID:', userId)
    }

    // Create temporary in-memory agent for execution
    // Use valid UUID format for agent ID (required by workflow_executions table)
    const temporaryAgent = {
      id: randomUUID(),
      user_id: userId,
      agent_name: body.workflow_name || 'V6 Test Workflow',
      user_prompt: 'Test execution of V6 compiled workflow',
      system_prompt: 'This is a temporary test agent',
      pilot_steps: body.workflow,
      plugins_required: body.plugins_required || [],
      status: 'active' as const,
      input_schema: undefined,
      output_schema: undefined,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    }

    console.log('[V6-TEST-EXEC] Created temporary agent:', temporaryAgent.id)

    // Initialize WorkflowPilot
    const pilot = new WorkflowPilot(supabase)

    // Execute workflow
    console.log('[V6-TEST-EXEC] Starting workflow execution...')

    const executionResult = await pilot.execute(
      temporaryAgent,
      userId,
      'Test execution',
      body.input_variables || {},
      undefined, // sessionId
      undefined, // stepEmitter
      false // debugMode
    )

    const executionTime = Date.now() - startTime

    console.log('[V6-TEST-EXEC] Execution complete in', executionTime, 'ms')
    console.log('[V6-TEST-EXEC] Success:', executionResult.success)
    console.log('[V6-TEST-EXEC] Steps completed:', executionResult.stepsCompleted)

    // Return result
    if (executionResult.success) {
      return NextResponse.json(
        {
          success: true,
          data: {
            stepsCompleted: executionResult.stepsCompleted,
            stepsFailed: executionResult.stepsFailed,
            stepsSkipped: executionResult.stepsSkipped,
            execution_time_ms: executionTime,
            tokens_used: executionResult.totalTokensUsed || 0,
            output: executionResult.output,
            completedStepIds: executionResult.completedStepIds || [],
            failedStepIds: executionResult.failedStepIds || [],
            skippedStepIds: executionResult.skippedStepIds || []
          }
        } as ExecuteTestResponse,
        { status: 200 }
      )
    } else {
      return NextResponse.json(
        {
          success: false,
          error: executionResult.error || 'Workflow execution failed'
        } as ExecuteTestResponse,
        { status: 500 }
      )
    }
  } catch (error) {
    console.error('[V6-TEST-EXEC] Execution error:', error)

    const errorMessage = error instanceof Error ? error.message : 'Unknown error'

    return NextResponse.json(
      {
        success: false,
        error: errorMessage
      } as ExecuteTestResponse,
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
