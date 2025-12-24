// /app/api/run-agent-sandbox/route.ts
// Development-only sandbox endpoint for executing workflows without database operations
// Allows testing workflow definitions in-memory before saving to DB

import { NextResponse } from 'next/server'
import { v4 as uuidv4 } from 'uuid'
import { createAuthenticatedServerClient } from '@/lib/supabaseServerAuth'
import { createLogger } from '@/lib/logger'
import { WorkflowPilot } from '@/lib/pilot'
import { preparePluginTokens } from '@/lib/services/PluginTokenService'
import type { Agent, WorkflowStep, InputSchema, OutputSchema } from '@/lib/pilot/types'

export const runtime = 'nodejs'

// Create route-level logger
const routeLogger = createLogger({ module: 'API', route: '/api/run-agent-sandbox' })

interface SandboxRequest {
  // Agent definition (inline, not from DB)
  agent_name: string;
  pilot_steps: WorkflowStep[];
  plugins_required?: string[];

  // Optional agent fields
  system_prompt?: string;
  user_prompt?: string;
  input_schema?: InputSchema[];
  output_schema?: OutputSchema[];

  // Execution params
  input_variables?: Record<string, any>;

  // Debug mode (optional)
  debugMode?: boolean;
  debugRunId?: string;
}

/**
 * POST handler for sandbox workflow execution
 * Development-only - returns 404 in production
 */
export async function POST(req: Request) {
  // === PRODUCTION GUARD ===
  // This endpoint is strictly for development/testing
  if (process.env.NODE_ENV !== 'development') {
    return NextResponse.json(
      { error: 'Not found' },
      { status: 404 }
    )
  }

  const supabase = await createAuthenticatedServerClient()

  // === AUTHENTICATION ===
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // === PARSE REQUEST ===
  const body: SandboxRequest = await req.json()
  const {
    agent_name,
    pilot_steps,
    plugins_required = [],
    system_prompt,
    user_prompt = '',
    input_schema,
    output_schema,
    input_variables = {},
    debugMode = false,
    debugRunId,
  } = body

  // Create request-scoped logger with correlation context
  const correlationId = uuidv4()
  const logger = routeLogger.child({
    method: 'POST',
    correlationId,
    userId: user.id,
    agentName: agent_name,
    stepCount: pilot_steps?.length || 0,
    debugMode,
  })

  logger.info('Sandbox execution request received')

  // === VALIDATION ===
  if (!agent_name?.trim()) {
    logger.warn('Validation failed: agent_name is required')
    return NextResponse.json(
      { error: 'agent_name is required' },
      { status: 400 }
    )
  }

  if (!pilot_steps || !Array.isArray(pilot_steps) || pilot_steps.length === 0) {
    logger.warn('Validation failed: pilot_steps must be a non-empty array')
    return NextResponse.json(
      { error: 'pilot_steps must be a non-empty array' },
      { status: 400 }
    )
  }

  // === BUILD IN-MEMORY AGENT ===
  // Use a valid UUID format (StateManager requires valid UUID for database operations)
  const sandboxAgentId = uuidv4()
  const sandboxAgent: Agent = {
    id: sandboxAgentId,
    user_id: user.id,
    agent_name: agent_name,
    system_prompt,
    user_prompt,
    pilot_steps,
    plugins_required,
    input_schema,
    output_schema,
    status: 'active',
    created_at: new Date().toISOString(),
  }

  logger.debug({ sandboxAgentId, pluginsRequired: plugins_required }, 'In-memory agent created')

  // === PREPARE PLUGIN TOKENS ===
  // Refresh OAuth tokens for required plugins before execution
  let pluginTokenResult = null
  if (plugins_required.length > 0) {
    logger.info({ plugins: plugins_required }, 'Preparing plugin tokens')
    pluginTokenResult = await preparePluginTokens(user.id, plugins_required)

    if (pluginTokenResult.failed.length > 0) {
      logger.warn({
        ready: pluginTokenResult.ready,
        failed: pluginTokenResult.failed
      }, 'Some plugins failed token preparation')
    } else {
      logger.info({ ready: pluginTokenResult.ready }, 'All plugin tokens ready')
    }
  }

  // === EXECUTE VIA WORKFLOW PILOT ===
  const sessionId = uuidv4()
  const startTime = Date.now()

  try {
    logger.info({ stepCount: pilot_steps.length }, 'Starting workflow execution')

    const pilot = new WorkflowPilot(supabase)
    const result = await pilot.execute(
      sandboxAgent,
      user.id,
      user_prompt,
      input_variables,
      sessionId,
      undefined, // stepEmitter
      debugMode,
      debugRunId
    )

    const executionTime = Date.now() - startTime

    logger.info({
      success: result.success,
      executionTimeMs: executionTime,
      stepsCompleted: result.stepsCompleted,
      stepsFailed: result.stepsFailed,
      stepsSkipped: result.stepsSkipped,
      tokensUsed: result.totalTokensUsed,
    }, 'Sandbox execution completed')

    // === RETURN RESULT ===
    return NextResponse.json({
      success: result.success,
      sandbox: true,
      message: result.output?.message || 'Workflow completed',
      data: {
        agent_name: sandboxAgent.agent_name,
        execution_type: 'sandbox',
        executionId: result.executionId,
        stepsCompleted: result.stepsCompleted,
        stepsFailed: result.stepsFailed,
        stepsSkipped: result.stepsSkipped,
        totalSteps: result.stepsCompleted + result.stepsFailed + result.stepsSkipped,
        tokens_used: result.totalTokensUsed,
        execution_time_ms: executionTime,
        output: result.output,
        // Step tracking for visualization
        completedStepIds: result.completedStepIds || [],
        failedStepIds: result.failedStepIds || [],
        skippedStepIds: result.skippedStepIds || [],
      },
      pluginTokens: pluginTokenResult,
      debugRunId: result.debugRunId,
      error: result.error,
    })

  } catch (error: any) {
    const executionTime = Date.now() - startTime

    logger.error({
      err: error,
      executionTimeMs: executionTime,
    }, 'Sandbox execution failed')

    return NextResponse.json({
      success: false,
      sandbox: true,
      error: error.message || 'Sandbox execution failed',
      data: {
        agent_name: sandboxAgent.agent_name,
        execution_type: 'sandbox',
        execution_time_ms: executionTime,
      }
    }, { status: 500 })
  }
}

// Prevent caching
export const dynamic = 'force-dynamic'