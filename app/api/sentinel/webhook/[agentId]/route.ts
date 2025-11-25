import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { v4 as uuidv4 } from 'uuid'
import { WorkflowPilot } from '@/lib/pilot'
import { runAgentKit } from '@/lib/agentkit/runAgentKit'
import { SystemConfigService } from '@/lib/services/SystemConfigService'

// Use service role client for webhook access (no authentication required)
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

/**
 * Sentinel Webhook Endpoint
 *
 * Purpose: Receives webhook events from external CRMs and triggers AgentPilot agents
 *
 * Endpoint: POST /api/sentinel/webhook/{agentId}
 *
 * Behavior:
 * - Accept POST requests only (no authentication)
 * - Parse JSON body from webhook request
 * - Extract agentId from URL parameter
 * - Fetch agent from Supabase
 * - Validate agent exists and mode is 'triggered'
 * - Execute agent asynchronously with webhook payload using full orchestration
 * - Return immediate 200 OK with execution ID
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ agentId: string }> }
) {
  const startTime = Date.now()

  try {
    // Extract agentId from URL parameter
    const { agentId } = await params

    if (!agentId) {
      return NextResponse.json(
        { error: 'Missing agentId parameter' },
        { status: 400 }
      )
    }

    console.log(`🔔 Sentinel: Received webhook for agent ${agentId}`)

    // Parse webhook payload
    let webhookPayload: any
    try {
      webhookPayload = await request.json()
    } catch (error) {
      console.error('❌ Sentinel: Failed to parse JSON payload', error)
      return NextResponse.json(
        { error: 'Invalid JSON payload' },
        { status: 400 }
      )
    }

    console.log('📦 Sentinel: Webhook payload:', JSON.stringify(webhookPayload, null, 2))

    // Fetch agent from database
    const { data: agent, error: agentError } = await supabaseAdmin
      .from('agents')
      .select('*')
      .eq('id', agentId)
      .single()

    if (agentError || !agent) {
      console.error('❌ Sentinel: Agent not found', agentError)
      return NextResponse.json(
        { error: 'Agent not found' },
        { status: 404 }
      )
    }

    console.log(`✅ Sentinel: Found agent "${agent.agent_name}" (${agent.id})`)

    // Validate agent mode is 'triggered'
    if (agent.mode !== 'triggered') {
      console.error(`❌ Sentinel: Agent mode is "${agent.mode}", expected "triggered"`)
      return NextResponse.json(
        {
          error: 'Invalid agent mode',
          message: `Agent must be in "triggered" mode. Current mode: "${agent.mode}"`
        },
        { status: 400 }
      )
    }

    // Validate agent status
    if (agent.status === 'archived') {
      return NextResponse.json(
        { error: 'Cannot execute archived agent' },
        { status: 400 }
      )
    }

    if (agent.status === 'inactive') {
      return NextResponse.json(
        { error: 'Cannot execute inactive agent' },
        { status: 400 }
      )
    }

    // Generate execution/session ID
    const executionId = uuidv4()
    const sessionId = executionId // Use same ID for session tracking

    console.log(`🚀 Sentinel: Starting execution ${executionId}`)

    // Execute agent asynchronously (non-blocking)
    executeAgentAsync(agent, webhookPayload, executionId, sessionId).catch(error => {
      console.error('❌ Sentinel: Async execution error', error)
    })

    // Return immediate 200 OK
    const responseTime = Date.now() - startTime
    console.log(`✅ Sentinel: Webhook accepted in ${responseTime}ms`)

    return NextResponse.json({
      success: true,
      executionId,
      message: 'Webhook received and agent execution started'
    })

  } catch (error: any) {
    console.error('❌ Sentinel: Unexpected error', error)
    return NextResponse.json(
      {
        error: 'Internal server error',
        message: error.message
      },
      { status: 500 }
    )
  }
}

/**
 * Execute agent asynchronously using the full orchestration architecture
 * This mirrors the logic from /api/run-agent but without authentication
 */
async function executeAgentAsync(
  agent: any,
  webhookPayload: any,
  executionId: string,
  sessionId: string
) {
  const startTime = Date.now()

  try {
    console.log(`⚙️ Sentinel: Executing agent ${agent.id} (${agent.agent_name})`)

    // **UNIFIED EXECUTION PATH** (same as /api/run-agent)
    let executionResult: any = null
    let executionType: 'pilot' | 'agentkit' = 'agentkit'
    let shouldExecute = true

    // Check if agent has workflow_steps AND pilot is enabled
    const hasWorkflowSteps = agent.workflow_steps && Array.isArray(agent.workflow_steps) && agent.workflow_steps.length > 0

    if (hasWorkflowSteps) {
      console.log(`🔍 Sentinel: Agent has ${agent.workflow_steps.length} workflow steps - checking pilot status...`)

      // Check if pilot is enabled in system config
      const pilotEnabled = await SystemConfigService.getBoolean(
        supabaseAdmin,
        'pilot_enabled',
        false // Default: disabled for safety
      )

      if (pilotEnabled) {
        console.log(`🎯 Sentinel: Using Workflow Pilot for agent "${agent.agent_name}"`)

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
          console.log(`📋 Sentinel: Using ${Object.keys(configInputValues).length} input values from saved configuration`)

          // Execute using WorkflowPilot
          const pilot = new WorkflowPilot(supabaseAdmin)
          executionResult = await pilot.execute(
            agent, // Pass full agent object
            agent.user_id,
            userInput,
            configInputValues,
            sessionId
          )

          executionType = 'pilot'
          shouldExecute = false // Don't execute AgentKit

        } catch (error: any) {
          console.error('❌ Sentinel: WorkflowPilot execution error:', error)

          // If pilot is disabled, fall through to AgentKit
          if (error.message?.includes('disabled in system configuration')) {
            console.warn('⚠️  Sentinel: Pilot disabled - falling back to AgentKit')
            // Fall through to AgentKit execution below
          } else {
            throw error // Re-throw other errors
          }
        }
      } else {
        console.warn(`⚠️  Sentinel: Agent has workflow_steps but pilot is disabled - falling back to AgentKit`)
      }
    }

    // **AGENTKIT EXECUTION PATH**
    // Execute with AgentKit if pilot didn't execute (shouldExecute is still true)
    if (shouldExecute) {
      console.log(`🤖 Sentinel: Using AgentKit execution for agent "${agent.agent_name}"`)

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
        console.log(`📋 Sentinel: Using ${Object.keys(configInputValues).length} input values from saved configuration`)

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

        executionType = 'agentkit'

      } catch (error: any) {
        console.error('❌ Sentinel: AgentKit execution error:', error)
        throw error
      }
    }

    const executionTime = Date.now() - startTime

    console.log(`✅ Sentinel: Agent execution completed in ${executionTime}ms`)
    console.log(`📊 Sentinel: Execution result:`, {
      executionId,
      agentId: agent.id,
      agentName: agent.agent_name,
      executionType,
      status: executionResult?.success ? 'completed' : 'failed',
      duration: executionTime
    })

    // Log execution to database
    await logExecution(agent.id, agent.user_id, executionId, webhookPayload, executionResult, executionTime, 'completed', executionType)

  } catch (error: any) {
    const executionTime = Date.now() - startTime

    console.error('❌ Sentinel: Agent execution failed', {
      executionId,
      agentId: agent.id,
      error: error.message,
      duration: executionTime
    })

    // Log failed execution
    await logExecution(agent.id, agent.user_id, executionId, webhookPayload, { error: error.message }, executionTime, 'failed')
  }
}

/**
 * Log execution to agent_executions table
 */
async function logExecution(
  agentId: string,
  userId: string,
  executionId: string,
  webhookPayload: any,
  result: any,
  executionTime: number,
  status: string = 'completed',
  executionType?: string
) {
  try {
    await supabaseAdmin
      .from('agent_executions')
      .insert({
        id: executionId,
        agent_id: agentId,
        user_id: userId,
        input: webhookPayload,
        output: result,
        status,
        execution_time_ms: executionTime,
        trigger_type: 'webhook',
        execution_type: executionType,
        created_at: new Date().toISOString()
      })

    console.log(`📝 Sentinel: Execution logged to database`)
  } catch (error) {
    console.error('❌ Sentinel: Failed to log execution', error)
    // Don't throw - logging failure shouldn't stop execution
  }
}

// Only allow POST requests
export async function GET() {
  return NextResponse.json(
    { error: 'Method not allowed. Use POST to send webhook data.' },
    { status: 405 }
  )
}

export async function PUT() {
  return NextResponse.json(
    { error: 'Method not allowed. Use POST to send webhook data.' },
    { status: 405 }
  )
}

export async function DELETE() {
  return NextResponse.json(
    { error: 'Method not allowed. Use POST to send webhook data.' },
    { status: 405 }
  )
}
