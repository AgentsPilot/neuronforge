// /app/api/run-agent/route.ts
// Enhanced agent runner supporting both immediate execution and queue-based execution

import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createServerClient } from '@supabase/ssr'
import { v4 as uuidv4 } from 'uuid'
import { runAgentWithContext } from '@/lib/utils/runAgentWithContext'
import { extractPdfTextFromBase64 } from '@/lib/utils/extractPdfTextFromBase64'
import { addManualExecution } from '@/lib/queues/qstashQueue'
import { runAgentKit } from '@/lib/agentkit/runAgentKit' // NEW: AgentKit execution

export const runtime = 'nodejs'

interface RunAgentRequest {
  agent_id: string;
  input_variables?: Record<string, any>;
  override_user_prompt?: string;
  execution_id?: string;
  use_queue?: boolean; // New: whether to use queue-based execution
  use_agentkit?: boolean; // NEW: Use OpenAI AgentKit for execution
  execution_type?: string; // NEW: 'manual' (test mode) vs other types
  user_id?: string; // For queue-based execution
}

/**
 * Enhanced POST handler supporting both immediate and queue-based execution
 */
export async function POST(req: Request) {
  const body: RunAgentRequest = await req.json()
  const {
    agent_id,
    input_variables = {},
    override_user_prompt,
    execution_id,
    use_queue = false, // Default to immediate execution for backward compatibility
    use_agentkit = false, // NEW: Default to false (use old system)
    execution_type, // NEW: Track if this is test mode from AgentSandbox
    user_id: provided_user_id
  } = body

  const cookieStore = await cookies()
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get: (name) => cookieStore.get(name)?.value,
        set: async () => {},
        remove: async () => {},
      },
    }
  )

  // Get authenticated user
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Fetch agent
  const { data: agent, error: agentError } = await supabase
    .from('agents')
    .select('*')
    .eq('id', agent_id)
    .single()

  if (agentError || !agent) {
    console.error('❌ Agent fetch error:', agentError)
    return NextResponse.json({ error: 'Agent not found' }, { status: 404 })
  }

  // **NEW: AGENTKIT EXECUTION PATH**
  if (use_agentkit) {
    console.log(`🤖 Using AgentKit execution for agent "${agent.agent_name}" (${agent_id})`)

    try {
      const userInput = override_user_prompt || agent.user_prompt
      let inputValues = {}
      let inputSchema = null

      // CRITICAL FIX: Determine input source based on execution type
      //
      // execution_type='test': AgentSandbox Test Mode - use input_variables from UI
      // execution_type='run': AgentSandbox Run Mode / AgentList - fetch from agent_configurations
      // execution_type=undefined/other: Scheduled/API - fetch from agent_configurations
      //
      if (execution_type === 'test') {
        // TEST MODE (AgentSandbox): Use values entered in UI form (temporary, not saved)
        inputValues = input_variables || {}
        inputSchema = agent.input_schema
        console.log(`📋 AgentKit TEST MODE: Using ${Object.keys(inputValues).length} input values from UI (not saved)`, inputValues)
      } else {
        // RUN MODE (AgentSandbox Run / AgentList / Scheduled): Fetch saved configuration
        const { data: agentConfig, error: configError } = await supabase
          .from('agent_configurations')
          .select('input_values, input_schema')
          .eq('agent_id', agent_id)
          .eq('user_id', user.id)
          .order('created_at', { ascending: false })
          .limit(1)
          .single()

        inputValues = agentConfig?.input_values || {}
        inputSchema = agent.input_schema || agentConfig?.input_schema
        console.log(`📋 AgentKit RUN MODE (${execution_type || 'scheduled'}): Using ${Object.keys(inputValues).length} input values from saved configuration`, inputValues)
      }

      // Generate session ID for analytics tracking (UUID format)
      const sessionId = uuidv4()

      // Execute using OpenAI AgentKit with V2 Plugin System
      const result = await runAgentKit(
        user.id,
        {
          id: agent.id,
          agent_name: agent.agent_name,
          system_prompt: agent.system_prompt,
          enhanced_prompt: agent.enhanced_prompt,
          user_prompt: agent.user_prompt,
          plugins_required: agent.plugins_required || [],
          input_schema: inputSchema || agent.input_schema,
          output_schema: agent.output_schema,
          trigger_condintion: agent.trigger_condintion // Pass notification preference
        },
        userInput,
        inputValues, // Pass input values from UI (test mode) or saved config
        sessionId // Pass session ID for analytics tracking
      )

      // Check if agent should send email notification based on trigger_condintion
      const triggerConfig = agent.trigger_condintion?.error_handling || {};
      const shouldSendEmail = triggerConfig.on_failure === 'email';

      if (shouldSendEmail && result.success) {
        console.log('📧 AgentKit: Sending result via email as per trigger_condintion');

        // The result already contains the response - no need to send it again
        // The email should have been sent by the agent itself during execution
        // Just log that email delivery was configured
      }

      // Log execution to agent_executions table
      const now = new Date().toISOString()
      const { error: insertError } = await supabase.from('agent_executions').insert({
        agent_id: agent.id,
        user_id: user.id,
        execution_type: 'manual',
        status: result.success ? 'completed' : 'failed',
        scheduled_at: now, // Required field - use current time for manual executions
        started_at: new Date(Date.now() - result.executionTime).toISOString(),
        completed_at: now,
        execution_duration_ms: result.executionTime,
        error_message: result.error || null,
        logs: {
          agentkit: true,
          iterations: result.iterations,
          toolCalls: result.toolCalls,
          tokensUsed: result.tokensUsed,
          model: 'gpt-4o',
          inputValuesUsed: Object.keys(inputValues).length
        }
      })

      if (insertError) {
        console.error('Failed to log AgentKit execution:', insertError)
      }

      // ALSO log to agent_logs table for consistency with legacy system
      console.log('🪵 Inserting AgentKit result to agent_logs...')
      const { data: logData, error: logInsertError } = await supabase
        .from('agent_logs')
        .insert({
          agent_id: agent.id,
          user_id: user.id,
          run_output: JSON.stringify({
            response: result.response,
            success: result.success,
            agentkit: true,
            iterations: result.iterations,
            toolCallsCount: result.toolCalls.length,
            tokensUsed: result.tokensUsed.total,
            executionTimeMs: result.executionTime
          }),
          full_output: {
            message: result.response,
            agentkit_metadata: {
              model: 'gpt-4o',
              iterations: result.iterations,
              toolCalls: result.toolCalls,
              tokensUsed: result.tokensUsed
            }
          },
          status: result.success ? '✅ AgentKit execution completed successfully' : '❌ AgentKit execution failed',
          created_at: now,
        })
        .select('id')
        .single()

      if (logInsertError) {
        console.error('❌ Failed to insert AgentKit log into agent_logs:', logInsertError)
      } else {
        console.log('✅ AgentKit log inserted successfully')
      }

      // Update agent_stats with accurate success tracking
      const { error: statsError } = await supabase.rpc('increment_agent_stats', {
        agent_id_input: agent.id,
        user_id_input: user.id,
        success: result.success, // Use AgentKit's clean success boolean
      })

      if (statsError) {
        console.error('❌ Failed to update agent_stats:', statsError)
      } else {
        console.log('✅ agent_stats updated successfully')
      }

      return NextResponse.json({
        success: result.success,
        message: result.response,
        data: {
          agent_id: agent.id,
          agent_name: agent.agent_name,
          execution_type: 'agentkit',
          tool_calls_count: result.toolCalls.length,
          successful_tool_calls: result.toolCalls.filter(tc => tc.success).length,
          failed_tool_calls: result.toolCalls.filter(tc => !tc.success).length,
          tokens_used: result.tokensUsed.total,
          execution_time_ms: result.executionTime,
          iterations: result.iterations,
          input_values_used: Object.keys(inputValues).length
        },
        agentkit: true
      })

    } catch (error: any) {
      console.error('❌ AgentKit execution error:', error)
      return NextResponse.json({
        success: false,
        error: error.message || 'AgentKit execution failed',
        agentkit: true
      }, { status: 500 })
    }
  }

  // **QUEUE-BASED EXECUTION PATH**
  if (use_queue) {
    // Check if running locally - QStash cannot send to localhost
    const isLocalDev = process.env.NODE_ENV === 'development' ||
                       process.env.VERCEL_ENV === undefined ||
                       !process.env.QSTASH_URL ||
                       !process.env.QSTASH_TOKEN

    if (isLocalDev) {
      console.log('⚠️  QStash queue unavailable in local development - falling back to direct execution')
      console.log(`⚡ Using immediate execution for agent ${agent_id} (local dev fallback)`)

      // Fall through to immediate execution path below
      // Don't return here - let the immediate execution code run
    } else {
      console.log(`🔄 Using queue-based execution for agent ${agent_id}`)

      try {
      // Validate agent can be executed
      if (agent.status === 'archived') {
        return NextResponse.json({ error: 'Cannot execute archived agent' }, { status: 400 })
      }
      if (agent.status === 'inactive') {
        return NextResponse.json({ error: 'Cannot execute inactive agent' }, { status: 400 })
      }

      const executionUserId = provided_user_id || user.id

      // Check if agent is already running
      const { data: runningExecutions, error: runningError } = await supabase
        .from('agent_executions')
        .select('id')
        .eq('agent_id', agent_id)
        .in('status', ['pending', 'running'])
        .limit(1)

      if (runningError) {
        console.error('Error checking running executions:', runningError)
        return NextResponse.json(
          { error: 'Failed to check agent status', details: runningError.message },
          { status: 500 }
        )
      }

      if (runningExecutions && runningExecutions.length > 0) {
        return NextResponse.json(
          { 
            error: 'Agent is already running',
            message: 'Please wait for the current execution to complete before starting a new one',
            currentExecutionId: runningExecutions[0].id
          },
          { status: 409 }
        )
      }

      // Create execution record in new table
      const scheduledAt = new Date().toISOString()
      const { data: execution, error: executionError } = await supabase
        .from('agent_executions')
        .insert({
          agent_id: agent.id,
          user_id: executionUserId,
          execution_type: 'manual',
          scheduled_at: scheduledAt,
          status: 'pending',
          cron_expression: agent.schedule_cron,
          progress: 0,
          logs: {
            created_via: 'manual_api_queue',
            requested_at: scheduledAt,
            ip_address: req.headers.get('x-forwarded-for') || 'unknown',
            input_variables: Object.keys(input_variables).length > 0 ? input_variables : null,
            override_user_prompt: override_user_prompt || null,
          }
        })
        .select('id')
        .single()

      if (executionError || !execution) {
        console.error('Failed to create execution record:', executionError)
        return NextResponse.json(
          { error: 'Failed to create execution record', details: executionError?.message },
          { status: 500 }
        )
      }

      // Add job to queue - FIXED: Use correct function name and parameters
      const { jobId, executionId } = await addManualExecution(
        agent.id,          // agentId
        executionUserId,   // userId  
        execution.id,      // executionId
        input_variables,   // inputVariables
        override_user_prompt // overrideUserPrompt
      )

      console.log(`✅ Queued manual execution for agent ${agent.agent_name}`, {
        agentId: agent.id,
        executionId: execution.id,
        jobId,
      })

      return NextResponse.json({
        success: true,
        message: 'Agent execution queued successfully',
        data: {
          agent_id: agent.id,
          agent_name: agent.agent_name,
          execution_id: execution.id,
          job_id: jobId,
          execution_type: 'manual',
          status: 'pending',
          scheduled_at: scheduledAt,
          estimated_duration: '1-5 minutes',
        },
        queue_based: true,
      })

      } catch (queueError) {
        console.error('Failed to queue agent job:', queueError)
        return NextResponse.json(
          {
            error: 'Failed to queue agent execution',
            details: queueError instanceof Error ? queueError.message : 'Unknown error',
          },
          { status: 500 }
        )
      }
    }
  }

  // **EXISTING IMMEDIATE EXECUTION PATH** (preserves backward compatibility)
  console.log(`⚡ Using immediate execution for agent ${agent_id}`)

  // Initialize execution tracking if execution_id provided
  if (execution_id) {
    console.log(`🚀 Starting execution tracking for: ${execution_id}`)
    
    // Update execution record to running status
    const { error: execError } = await supabase
      .from('agent_configurations')
      .update({
        status: 'running',
        created_at: new Date().toISOString()
      })
      .eq('id', execution_id)

    if (execError) {
      console.error('❌ Failed to update execution record:', execError)
    } else {
      console.log('✅ Execution record updated to running status')
    }
  }

  // Extract text from uploaded PDF (if exists)
  try {
    for (const key in input_variables) {
      const value = input_variables[key]
      if (
        typeof value === 'string' &&
        value.startsWith('data:application/pdf;base64,')
      ) {
        console.log('📄 Detected PDF upload, extracting text...')
        
        if (execution_id) {
          const { error: logError } = await supabase.from('agent_execution_logs').insert({
            execution_id,
            agent_id: agent_id,
            user_id: user.id,
            timestamp: new Date().toISOString(),
            level: 'info',
            message: 'PDF upload detected, extracting text content',
            phase: 'documents'
          })
          
          if (logError) {
            console.error('Failed to insert PDF detection log:', logError)
          }
        }
        
        const text = await extractPdfTextFromBase64(value)
        input_variables.__uploaded_file_text = text
        
        if (execution_id) {
          const { error: logError } = await supabase.from('agent_execution_logs').insert({
            execution_id,
            agent_id: agent_id,
            user_id: user.id,
            timestamp: new Date().toISOString(),
            level: 'info',
            message: `PDF text extraction completed. Extracted ${text.length} characters`,
            phase: 'documents'
          })
          
          if (logError) {
            console.error('Failed to insert PDF completion log:', logError)
          }
        }
        break // Only process the first PDF for now
      }
    }
  } catch (err: any) {
    console.error('❌ Failed to extract PDF text:', err)
    if (execution_id) {
      const { error: logError } = await supabase.from('agent_execution_logs').insert({
        execution_id,
        agent_id: agent_id,
        user_id: user.id,
        timestamp: new Date().toISOString(),
        level: 'error',
        message: `PDF text extraction failed: ${err.message}`,
        phase: 'documents'
      })
      
      if (logError) {
        console.error('Failed to insert PDF error log:', logError)
      }
    }
  }

  try {
    const startTime = Date.now()

    if (execution_id) {
      const { error: logError } = await supabase.from('agent_execution_logs').insert({
        execution_id,
        agent_id: agent_id,
        user_id: user.id,
        timestamp: new Date().toISOString(),
        level: 'info',
        message: 'Starting agent execution with interpolated prompt',
        phase: 'prompt'
      })
      
      if (logError) {
        console.error('Failed to insert start execution log:', logError)
      }
    }

    const { message, parsed_output, pluginContext, send_status } = await runAgentWithContext({
      supabase,
      agent,
      userId: user.id,
      input_variables,
      override_user_prompt,
    })

    const endTime = Date.now()
    const executionDuration = endTime - startTime

    if (execution_id) {
      const { error: logError } = await supabase.from('agent_execution_logs').insert({
        execution_id,
        agent_id: agent_id,
        user_id: user.id,
        timestamp: new Date().toISOString(),
        level: 'info',
        message: `Agent execution completed successfully in ${executionDuration}ms`,
        phase: 'validation'
      })
      
      if (logError) {
        console.error('Failed to insert completion log:', logError)
      }

      // Update execution record with final metrics
      const { error: updateError } = await supabase.from('agent_configurations').update({
        status: 'completed',
        duration_ms: executionDuration,
        completed_at: new Date().toISOString()
      }).eq('id', execution_id)
      
      if (updateError) {
        console.error('Failed to update execution completion:', updateError)
      }
    }

    console.log('🪵 Inserting agent log...')
    const { data: logData, error: logInsertError } = await supabase
      .from('agent_logs')
      .insert({
        agent_id,
        user_id: user.id,
        run_output: parsed_output ? JSON.stringify(parsed_output) : null,
        full_output: message ? { message } : null,
        status: send_status,
        created_at: new Date().toISOString(),
      })
      .select('id')
      .single()

    if (logInsertError) {
      console.error('❌ Failed to insert log into agent_logs:', logInsertError)
    } else {
      console.log('✅ Agent log inserted successfully')

      // Insert output context if we have a log ID and output data
      if (logData?.id && (message || parsed_output || pluginContext)) {
        console.log('📝 Inserting agent output context...')
        
        const contextEntries = []
        
        // Add message as context if it exists
        if (message) {
          contextEntries.push({
            user_id: user.id,
            source_agent_id: agent_id,
            run_id: logData.id,
            context_key: 'agent_message',
            context_data: { message }
          })
        }
        
        // Add parsed output as context if it exists
        if (parsed_output) {
          contextEntries.push({
            user_id: user.id,
            source_agent_id: agent_id,
            run_id: logData.id,
            context_key: 'parsed_output',
            context_data: parsed_output
          })
        }
        
        // Add plugin context if it exists
        if (pluginContext && Object.keys(pluginContext).length > 0) {
          contextEntries.push({
            user_id: user.id,
            source_agent_id: agent_id,
            run_id: logData.id,
            context_key: 'plugin_context',
            context_data: pluginContext
          })
        }
        
        // Add input variables as context for future reference
        if (input_variables && Object.keys(input_variables).length > 0) {
          contextEntries.push({
            user_id: user.id,
            source_agent_id: agent_id,
            run_id: logData.id,
            context_key: 'input_variables',
            context_data: input_variables
          })
        }

        if (contextEntries.length > 0) {
          const { error: contextInsertError } = await supabase
            .from('agent_output_context')
            .insert(contextEntries)

          if (contextInsertError) {
            console.error('❌ Failed to insert agent output context:', contextInsertError)
          } else {
            console.log('✅ Agent output context inserted successfully')
          }
        }
      }
    }

    console.log('📊 Updating agent_stats...')
    const { error: statsError } = await supabase.rpc('increment_agent_stats', {
      agent_id_input: agent_id,
      user_id_input: user.id,
      success: send_status?.startsWith('✅') || send_status?.startsWith('📧') || send_status?.startsWith('🚨'),
    })

    if (statsError) {
      console.error('❌ Failed to update agent_stats:', statsError)
    } else {
      console.log('✅ agent_stats updated')
    }

    return NextResponse.json({
      result: {
        message,
        parsed_output,
        pluginContext,
        send_status,
      },
      execution_id: execution_id || null,
      queue_based: false,
    })

  } catch (err: any) {
    console.error('❌ runAgentWithContext error:', err)
    
    if (execution_id) {
      const { error: logError } = await supabase.from('agent_execution_logs').insert({
        execution_id,
        agent_id: agent_id,
        user_id: user.id,
        timestamp: new Date().toISOString(),
        level: 'error',
        message: `Critical error: ${err.message}`,
        phase: 'validation'
      })
      
      if (logError) {
        console.error('Failed to insert error log:', logError)
      }

      // Update execution record as failed
      const { error: updateError } = await supabase.from('agent_configurations').update({
        status: 'failed',
        completed_at: new Date().toISOString()
      }).eq('id', execution_id)
      
      if (updateError) {
        console.error('Failed to update execution as failed:', updateError)
      }
    }
    
    return NextResponse.json(
      { error: 'Failed to run agent using OpenAI' },
      { status: 500 }
    )
  }
}

/**
 * Get execution status for agents
 */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const agent_id = searchParams.get('agent_id');
    const execution_id = searchParams.get('execution_id');
    const status_only = searchParams.get('status_only');

    // If status_only is present but no agent_id or execution_id, return a valid JSON error
    if ((status_only === 'true' || status_only === '1') && !agent_id && !execution_id) {
      return NextResponse.json(
        { error: 'Must provide agent_id or execution_id for status query.' },
        { status: 400 }
      );
    }

    if (!agent_id && !execution_id) {
      return NextResponse.json(
        { error: 'Must provide either agent_id or execution_id' },
        { status: 400 }
      );
    }

    // Check required env vars
    if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
      return NextResponse.json(
        { error: 'Supabase environment variables missing' },
        { status: 500 }
      );
    }

    let cookieStore;
    try {
      cookieStore = await cookies();
    } catch (cookieError) {
      return NextResponse.json(
        { error: 'Failed to get cookies', details: cookieError instanceof Error ? cookieError.message : String(cookieError) },
        { status: 500 }
      );
    }

    let supabase;
    try {
      supabase = createServerClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        {
          cookies: {
            get: (name) => cookieStore.get(name)?.value,
            set: async () => {},
            remove: async () => {},
          },
        }
      );
    } catch (supabaseError) {
      return NextResponse.json(
        { error: 'Failed to create Supabase client', details: supabaseError instanceof Error ? supabaseError.message : String(supabaseError) },
        { status: 500 }
      );
    }

    let query = supabase
      .from('agent_executions')
      .select('id, agent_id, execution_type, status, progress, scheduled_at, started_at, completed_at, error_message, execution_duration_ms, retry_count')
      .order('created_at', { ascending: false });

    if (execution_id) {
      query = query.eq('id', execution_id);
    } else if (agent_id) {
      query = query.eq('agent_id', agent_id).limit(5); // Last 5 executions
    }

    const { data: executions, error } = await query;

    if (error) {
      return NextResponse.json(
        { error: 'Failed to fetch execution status', details: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      executions: executions || [],
      count: executions?.length || 0,
    });

  } catch (error) {
    // Always return valid JSON, never HTML
    return NextResponse.json(
      { error: 'Internal server error', message: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}

// Prevent caching
export const dynamic = 'force-dynamic';