/**
 * V6 Test Execution Endpoint
 *
 * Executes a compiled PILOT DSL workflow without requiring a permanent agent record.
 * Creates a temporary in-memory agent for testing purposes only.
 *
 * This endpoint is designed for the V6 declarative test page to validate
 * that compiled workflows are executable with real plugins.
 *
 * ── ADMIN ONLY, and that is not over-caution ──────────────────────────────
 * The caller supplies `workflow` — arbitrary PILOT DSL — which this route executes
 * server-side through `WorkflowPilot` with a service-role Supabase client. That is a
 * remote code-execution surface in the shape of a test harness: an attacker-authored
 * multi-step program of plugin calls, LLM steps and control flow, run by the platform's
 * own engine.
 *
 * Until 2026-09-21 it was completely unauthenticated, and it took the account to run as
 * from `body.user_id`. A plain session gate would only have converted "anyone on the
 * internet" into "anyone who signed up", which is not a meaningful bound on arbitrary
 * server-side execution — so identity comes from `requireAdmin()` and the workflow always
 * runs as the calling admin. `scripts/qa-v6-execution-layer.ts` is our own script, so the
 * admin requirement costs nothing.
 *
 * Also removed in the same change; all three were parts of one bug:
 *   - `body.user_id` in every form. It is no longer read; the session is the only source.
 *   - The email-resolution branch, which called `supabase.auth.admin.listUsers()`
 *     unpaginated (so it only ever saw the first 50 accounts) to map an arbitrary email
 *     to a UUID.
 *   - The `00000000-0000-0000-0000-000000000000` fallback, which meant a FAILED or
 *     unmatched lookup still executed the workflow instead of refusing. Nothing here
 *     falls back any more: no admin, no execution.
 *
 * Middleware does not authenticate `/api/*` (middleware.ts:83), so this gate is the only
 * thing in front of the handler.
 *
 * See docs/workplans/IDENTITY_SWEEP_WORKPLAN.md § Slice 0.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabaseServer'
import { WorkflowPilot } from '@/lib/pilot/WorkflowPilot'
import { requireAdmin } from '@/lib/admin/requireAdminRoute'
import { createLogger } from '@/lib/logger'
import { randomUUID } from 'crypto'

const logger = createLogger({ module: 'API', route: '/api/v6/execute-test' })

// ============================================================================
// Types
// ============================================================================

interface ExecuteTestRequest {
  workflow: any[]
  plugins_required: string[]
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
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID()
  const requestLogger = logger.child({ correlationId })

  const startTime = Date.now()

  try {
    // Gate BEFORE request.json(). Parsing an attacker-authored workflow body is work we
    // should not do for an unauthenticated caller.
    const gate = await requireAdmin(requestLogger)
    if (gate instanceof NextResponse) return gate
    const { user } = gate

    // The workflow always runs as the calling admin. There is no "run as" parameter, and
    // there must never be one on this route.
    const userId = user.id

    // Parse request body
    const body: ExecuteTestRequest = await request.json()

    requestLogger.info(
      {
        adminUserId: userId,
        stepCount: body.workflow?.length,
        pluginCount: body.plugins_required?.length
      },
      'V6 test execution requested'
    )

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

    const supabase = createServerSupabaseClient()

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

    // Initialize WorkflowPilot
    const pilot = new WorkflowPilot(supabase)

    // Execute. `input_variables` and the workflow body are caller data and are never
    // logged — only their shape (counts, ids) is.
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

    requestLogger.info(
      {
        adminUserId: userId,
        temporaryAgentId: temporaryAgent.id,
        durationMs: executionTime,
        success: executionResult.success,
        stepsCompleted: executionResult.stepsCompleted,
        stepsFailed: executionResult.stepsFailed
      },
      'V6 test execution complete'
    )

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
    requestLogger.error({ err: error }, 'V6 test execution failed')

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
      // Retained as-is from before the gate was added: changing CORS is a separate
      // decision with its own blast radius. It grants nothing by itself — a browser
      // will not attach cookies to a cross-origin request under `*`, so a cross-site
      // caller cannot satisfy requireAdmin().
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization'
    }
  })
}
