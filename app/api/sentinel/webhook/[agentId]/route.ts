import { NextRequest, NextResponse } from 'next/server'
import { timingSafeEqual } from 'crypto'
import { createClient } from '@supabase/supabase-js'
import { z } from 'zod'
import { WorkflowPilot } from '@/lib/pilot'
import { runAgentKit } from '@/lib/agentkit/runAgentKit'
import { SystemConfigService } from '@/lib/services/SystemConfigService'
import { createLogger } from '@/lib/logger'
import {
  createExecution,
  completeExecution,
  failExecution
} from '@/lib/database/executionHelpers'

// `timingSafeEqual` is a Node built-in, so this route cannot run on the Edge runtime.
export const runtime = 'nodejs'

const logger = createLogger({ module: 'SentinelWebhookAPI' })

// Service-role client: this route has no user session by design (the caller is an
// external system, not a browser), so the queries below deliberately bypass RLS and are
// scoped in code to the single agent named in the URL.
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

/**
 * Upper bound on the webhook body, measured on the raw bytes before JSON parsing.
 * 128 KB is far above any realistic CRM event payload while keeping an unbounded body
 * from reaching JSON.parse and, downstream, an LLM prompt.
 */
const MAX_WEBHOOK_PAYLOAD_BYTES = 128 * 1024

/**
 * Deliberately permissive: the body is an arbitrary third-party CRM event, so we assert
 * only that it is a JSON object and let every unknown key through. `z.record` rejects
 * arrays, strings, numbers and null, which is the whole contract.
 *
 * NOTE: this does NOT prevent prompt injection. The untrusted body is still serialized
 * into the agent's user input and reaches the LLM. This validation bounds the payload's
 * size and shape at the API boundary; it makes no claim about its content.
 */
const webhookPayloadSchema = z.record(z.string(), z.unknown())

/** Identical response for every rejected request — see `isAuthorizedSentinelRequest`. */
function unauthorized(): NextResponse {
  return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
}

/**
 * Shared-secret gate for the webhook.
 *
 * This is a DEPLOYMENT GATE, not tenant isolation: one secret covers every user and
 * every agent, so any holder can trigger any user's agent, executing as that user with
 * their connected plugin credentials. It stops the anonymous internet and nothing more.
 * Per-agent secrets / HMAC signing are tracked as a separate requirement.
 *
 * Fails closed in EVERY environment, including development — deliberately unlike the
 * cron routes' `NODE_ENV === 'development'` bypass. This route executes real users'
 * agents against their real third-party accounts, so a dev bypass is one environment
 * mistake away from being a production hole. Set SENTINEL_WEBHOOK_SECRET in .env.local
 * to exercise it locally.
 */
function isAuthorizedSentinelRequest(request: NextRequest): boolean {
  const expected = process.env.SENTINEL_WEBHOOK_SECRET

  // Unset secret => the route is dormant and refuses everything.
  if (!expected) return false

  const authHeader = request.headers.get('authorization')
  if (!authHeader || !authHeader.startsWith('Bearer ')) return false

  const presented = authHeader.slice('Bearer '.length)

  const presentedBuffer = Buffer.from(presented)
  const expectedBuffer = Buffer.from(expected)

  // `timingSafeEqual` THROWS on a length mismatch, so the length check must come first.
  if (presentedBuffer.length !== expectedBuffer.length) return false

  return timingSafeEqual(presentedBuffer, expectedBuffer)
}

/**
 * Sentinel Webhook Endpoint
 *
 * Purpose: Receives webhook events from external CRMs and triggers AgentPilot agents
 *
 * Endpoint: POST /api/sentinel/webhook/{agentId}
 * Auth: `Authorization: Bearer <SENTINEL_WEBHOOK_SECRET>` — header only, no query
 *       fallback (query strings leak into access logs, referrers and browser history).
 *
 * Behavior:
 * - Reject unauthenticated callers before anything else happens
 * - Parse and bound the JSON body from the webhook request
 * - Fetch the agent, validate it exists and its mode is 'triggered'
 * - Execute the agent asynchronously with the webhook payload using full orchestration
 * - Return immediate 200 OK with the execution ID
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ agentId: string }> }
) {
  // FIRST STATEMENT, deliberately. Everything below this line — the URL parameter, the
  // body, the agent lookup — is only reachable by an authenticated caller. A gate placed
  // after the lookup would still leak an enumeration oracle: a real id answers "Invalid
  // agent mode" and a random one answers "Agent not found", which is enough for an
  // anonymous caller to confirm an agent exists and read its mode out of the error.
  if (!isAuthorizedSentinelRequest(request)) {
    logger.warn(
      { correlationId: request.headers.get('x-correlation-id') || crypto.randomUUID() },
      'Rejected unauthorized sentinel webhook request'
    )
    return unauthorized()
  }

  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID()
  const requestLogger = logger.child({ correlationId })
  const startTime = Date.now()

  try {
    // Extract agentId from URL parameter
    const { agentId } = await params

    if (!agentId) {
      return NextResponse.json(
        { success: false, error: 'Missing agentId parameter' },
        { status: 400 }
      )
    }

    requestLogger.info({ agentId }, 'Received sentinel webhook')

    // Read the raw body first so the size cap applies before JSON.parse sees it.
    const rawBody = await request.text()
    const payloadBytes = Buffer.byteLength(rawBody, 'utf8')

    if (payloadBytes > MAX_WEBHOOK_PAYLOAD_BYTES) {
      requestLogger.warn(
        { agentId, payloadBytes, maxBytes: MAX_WEBHOOK_PAYLOAD_BYTES },
        'Rejected oversized webhook payload'
      )
      return NextResponse.json(
        { success: false, error: 'Payload too large' },
        { status: 400 }
      )
    }

    let parsedBody: unknown
    try {
      parsedBody = JSON.parse(rawBody)
    } catch (error) {
      // Never log the body itself — it is untrusted third-party data that may carry
      // customer PII from the sending CRM. That includes the SyntaxError: V8 embeds a
      // verbatim ~10-character prefix of the input in BOTH `message` and `stack`
      // (`Unexpected token 'e', "email=alic"... is not valid JSON`), so logging the
      // error object re-opens the very leak the body dump was removed to close.
      // The error's name is the only part of it that carries no payload bytes.
      requestLogger.warn(
        { errName: (error as Error).name, agentId, payloadBytes },
        'Failed to parse JSON payload'
      )
      return NextResponse.json(
        { success: false, error: 'Invalid JSON payload' },
        { status: 400 }
      )
    }

    const validation = webhookPayloadSchema.safeParse(parsedBody)
    if (!validation.success) {
      requestLogger.warn({ agentId, payloadBytes }, 'Rejected non-object webhook payload')
      return NextResponse.json(
        { success: false, error: 'Webhook payload must be a JSON object' },
        { status: 400 }
      )
    }

    const webhookPayload = validation.data

    requestLogger.debug(
      { agentId, payloadBytes, payloadKeyCount: Object.keys(webhookPayload).length },
      'Webhook payload accepted'
    )

    // Fetch agent from database
    const { data: agent, error: agentError } = await supabaseAdmin
      .from('agents')
      .select('*')
      .eq('id', agentId)
      .single()

    if (agentError || !agent) {
      requestLogger.warn({ err: agentError, agentId }, 'Agent not found')
      return NextResponse.json(
        { success: false, error: 'Agent not found' },
        { status: 404 }
      )
    }

    requestLogger.info({ agentId: agent.id, agentName: agent.agent_name }, 'Found agent')

    // Validate agent mode is 'triggered'
    if (agent.mode !== 'triggered') {
      requestLogger.warn(
        { agentId: agent.id, mode: agent.mode },
        'Agent is not in triggered mode'
      )
      return NextResponse.json(
        {
          success: false,
          error: 'Invalid agent mode',
          message: `Agent must be in "triggered" mode. Current mode: "${agent.mode}"`
        },
        { status: 400 }
      )
    }

    // Validate agent status
    if (agent.status === 'archived') {
      return NextResponse.json(
        { success: false, error: 'Cannot execute archived agent' },
        { status: 400 }
      )
    }

    if (agent.status === 'inactive') {
      return NextResponse.json(
        { success: false, error: 'Cannot execute inactive agent' },
        { status: 400 }
      )
    }

    // Create the execution row up front so the id returned to the caller is the id of a
    // row that actually exists. (The previous hand-rolled insert ran after execution and
    // wrote four columns this table does not have, so it never once succeeded.)
    const startedAt = new Date().toISOString()
    const { data: execution, error: executionError } = await createExecution({
      agent_id: agent.id,
      user_id: agent.user_id,
      execution_type: 'triggered'
    })

    if (executionError || !execution) {
      // Swallowed on purpose: a bookkeeping failure must not cancel the run. The caller
      // gets a null id rather than an id that points at no row.
      requestLogger.error(
        { err: executionError, agentId: agent.id },
        'Failed to create execution record (non-blocking)'
      )
    }

    const executionId: string | null = execution?.id ?? null
    const sessionId = executionId ?? crypto.randomUUID()

    requestLogger.info({ agentId: agent.id, executionId, sessionId }, 'Starting execution')

    // Execute agent asynchronously (non-blocking)
    executeAgentAsync(
      agent,
      webhookPayload,
      executionId,
      sessionId,
      startedAt,
      correlationId
    ).catch(error => {
      requestLogger.error({ err: error, agentId: agent.id, executionId }, 'Async execution error')
    })

    // Return immediate 200 OK
    requestLogger.info(
      { agentId: agent.id, executionId, durationMs: Date.now() - startTime },
      'Webhook accepted'
    )

    return NextResponse.json({
      success: true,
      executionId,
      message: 'Webhook received and agent execution started'
    })

  } catch (error: any) {
    requestLogger.error({ err: error }, 'Unexpected error handling sentinel webhook')
    return NextResponse.json(
      {
        success: false,
        error: 'Internal server error',
        details: process.env.NODE_ENV === 'development' ? error?.message : undefined
      },
      { status: 500 }
    )
  }
}

/**
 * Execute agent asynchronously using the full orchestration architecture.
 * This mirrors the logic from /api/run-agent, authenticated by the shared secret rather
 * than a user session.
 */
async function executeAgentAsync(
  agent: any,
  webhookPayload: any,
  executionId: string | null,
  sessionId: string,
  startedAt: string,
  correlationId: string
) {
  const executionLogger = logger.child({ correlationId, executionId, agentId: agent.id })
  const startTime = Date.now()

  try {
    executionLogger.info({ agentName: agent.agent_name }, 'Executing agent')

    // **UNIFIED EXECUTION PATH** (same as /api/run-agent)
    let executionResult: any = null
    let executionPath: 'pilot' | 'agentkit' = 'agentkit'
    let shouldExecute = true

    // Check if agent has workflow_steps AND pilot is enabled
    const hasWorkflowSteps = agent.workflow_steps && Array.isArray(agent.workflow_steps) && agent.workflow_steps.length > 0

    if (hasWorkflowSteps) {
      executionLogger.debug(
        { stepCount: agent.workflow_steps.length },
        'Agent has workflow steps - checking pilot status'
      )

      // Check if pilot is enabled in system config
      const pilotEnabled = await SystemConfigService.getBoolean(
        supabaseAdmin,
        'pilot_enabled',
        false // Default: disabled for safety
      )

      if (pilotEnabled) {
        executionLogger.info({ agentName: agent.agent_name }, 'Using Workflow Pilot')

        try {
          const userInput = JSON.stringify(webhookPayload) // Pass raw webhook payload as user input

          // Fetch saved configuration for input values
          const { data: agentConfig } = await supabaseAdmin
            .from('agent_configurations')
            .select('input_values, input_schema')
            .eq('agent_id', agent.id)
            .eq('user_id', agent.user_id)
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle()

          const configInputValues = agentConfig?.input_values || {}
          executionLogger.debug(
            { inputValueCount: Object.keys(configInputValues).length },
            'Using input values from saved configuration'
          )

          // Execute using WorkflowPilot
          const pilot = new WorkflowPilot(supabaseAdmin)
          executionResult = await pilot.execute(
            agent, // Pass full agent object
            agent.user_id,
            userInput,
            configInputValues,
            sessionId
          )

          executionPath = 'pilot'
          shouldExecute = false // Don't execute AgentKit

        } catch (error: any) {
          executionLogger.error({ err: error }, 'WorkflowPilot execution error')

          // If pilot is disabled, fall through to AgentKit
          if (error.message?.includes('disabled in system configuration')) {
            executionLogger.warn('Pilot disabled - falling back to AgentKit')
            // Fall through to AgentKit execution below
          } else {
            throw error // Re-throw other errors
          }
        }
      } else {
        executionLogger.warn('Agent has workflow_steps but pilot is disabled - falling back to AgentKit')
      }
    }

    // **AGENTKIT EXECUTION PATH**
    // Execute with AgentKit if pilot didn't execute (shouldExecute is still true)
    if (shouldExecute) {
      executionLogger.info({ agentName: agent.agent_name }, 'Using AgentKit execution')

      try {
        const userInput = JSON.stringify(webhookPayload) // Pass raw webhook payload

        // Fetch saved configuration
        const { data: agentConfig } = await supabaseAdmin
          .from('agent_configurations')
          .select('input_values, input_schema')
          .eq('agent_id', agent.id)
          .eq('user_id', agent.user_id)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle()

        const configInputValues = agentConfig?.input_values || {}
        const inputSchema = agent.input_schema || agentConfig?.input_schema
        executionLogger.debug(
          { inputValueCount: Object.keys(configInputValues).length },
          'Using input values from saved configuration'
        )

        executionResult = await runAgentKit(
          agent.user_id,
          {
            id: agent.id,
            agent_name: agent.agent_name,
            system_prompt: agent.system_prompt,
            enhanced_prompt: agent.enhanced_prompt,
            user_prompt: agent.user_prompt,
            plugins_required: agent.plugins_required || [],
            input_schema: inputSchema,
            output_schema: agent.output_schema,
            trigger_condintion: agent.trigger_condintion
          },
          userInput,
          configInputValues,
          sessionId
        )

        executionPath = 'agentkit'

      } catch (error: any) {
        executionLogger.error({ err: error }, 'AgentKit execution error')
        throw error
      }
    }

    const executionTime = Date.now() - startTime

    executionLogger.info(
      {
        agentName: agent.agent_name,
        executionPath,
        status: executionResult?.success ? 'completed' : 'failed',
        durationMs: executionTime
      },
      'Agent execution completed'
    )

    // Record the outcome. Which engine ran is kept inside `result`, NOT in the row's
    // `execution_type` column, whose legal values are manual | scheduled | triggered.
    // The raw webhook body is deliberately not persisted (untrusted third-party data).
    if (executionId) {
      const { error } = await completeExecution(
        executionId,
        {
          success: executionResult?.success ?? false,
          executionPath,
          result: executionResult
        },
        startedAt
      )
      if (error) {
        executionLogger.error({ err: error }, 'Failed to record execution completion (non-blocking)')
      }
    }

  } catch (error: any) {
    const executionTime = Date.now() - startTime

    executionLogger.error({ err: error, durationMs: executionTime }, 'Agent execution failed')

    if (executionId) {
      const { error: failError } = await failExecution(
        executionId,
        error?.message ?? 'Unknown execution error',
        startedAt
      )
      if (failError) {
        executionLogger.error({ err: failError }, 'Failed to record execution failure (non-blocking)')
      }
    }
  }
}

// Only allow POST requests
export async function GET() {
  return NextResponse.json(
    { success: false, error: 'Method not allowed. Use POST to send webhook data.' },
    { status: 405 }
  )
}

export async function PUT() {
  return NextResponse.json(
    { success: false, error: 'Method not allowed. Use POST to send webhook data.' },
    { status: 405 }
  )
}

export async function DELETE() {
  return NextResponse.json(
    { success: false, error: 'Method not allowed. Use POST to send webhook data.' },
    { status: 405 }
  )
}
